-- =========================================================
-- ダブルブッキング防止: DB制約・RPC関数
-- Supabase SQL Editor で実行してください
-- =========================================================

-- 1. 予約テーブルにユニーク部分インデックス
--    キャンセル以外の予約は1枠1件のみ許可（最終防衛ライン）
CREATE UNIQUE INDEX IF NOT EXISTS reservations_slot_id_unique
ON reservations(slot_id)
WHERE slot_id IS NOT NULL AND status != 'cancelled';

-- 2. 予約済み枠IDを取得する関数（匿名ユーザーも呼び出し可）
--    個人情報は一切返さず slot_id のみ返す
CREATE OR REPLACE FUNCTION get_booked_slot_ids(slot_ids uuid[])
RETURNS TABLE(slot_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT DISTINCT r.slot_id
  FROM reservations r
  WHERE r.slot_id = ANY(slot_ids)
    AND r.status != 'cancelled';
$$;

GRANT EXECUTE ON FUNCTION get_booked_slot_ids(uuid[]) TO anon, authenticated;

-- 3. 空き確認＆予約登録を原子的に実行する関数
--    time_slots 行に FOR UPDATE ロックをかけることで
--    ミリ秒単位の同時リクエストも直列化される
CREATE OR REPLACE FUNCTION create_reservation_if_available(
  p_slot_id          uuid,
  p_reservation_date date,
  p_reservation_time time,
  p_name             text,
  p_customer_email   text,
  p_phone            text,
  p_notes            text  DEFAULT NULL,
  p_custom_answers   jsonb DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_row   reservations;
BEGIN
  -- 同一スロットへの同時アクセスを直列化する（行レベルロック）
  IF NOT EXISTS (
    SELECT 1 FROM time_slots WHERE id = p_slot_id FOR UPDATE
  ) THEN
    RETURN json_build_object(
      'error',   'SLOT_NOT_FOUND',
      'message', 'この予約枠は存在しません。ページを更新して再度お試しください。'
    );
  END IF;

  -- ロック取得後に既存予約を確認
  SELECT COUNT(*) INTO v_count
  FROM reservations
  WHERE slot_id = p_slot_id
    AND status != 'cancelled';

  IF v_count > 0 THEN
    RETURN json_build_object(
      'error',   'SLOT_TAKEN',
      'message', '大変申し訳ありません。タッチの差でこのお時間は満席となりました。別のお時間をお選びください。'
    );
  END IF;

  -- 空きが確認できたので予約を挿入
  INSERT INTO reservations (
    slot_id, reservation_date, reservation_time,
    name, customer_email, phone, notes, custom_answers, status
  )
  VALUES (
    p_slot_id, p_reservation_date, p_reservation_time,
    p_name, p_customer_email, p_phone, p_notes, p_custom_answers, 'confirmed'
  )
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION create_reservation_if_available(uuid, date, time, text, text, text, text, jsonb) TO anon, authenticated;
