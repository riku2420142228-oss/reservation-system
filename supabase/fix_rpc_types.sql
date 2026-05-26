-- =========================================================
-- RPC 関数の型修正スクリプト
-- 【目的】 uuid = text / time = text 型エラーを解消する
-- 【手順】 Supabase Dashboard > SQL Editor でこのファイルをまるごと実行
-- =========================================================

-- Step 1: 既存の関数を全バリアント削除
--   CREATE OR REPLACE は引数の型を変更できないため、一度 DROP する必要がある
DO $$
DECLARE
  rec record;
BEGIN
  -- create_reservation_if_available の全バリアントを削除
  FOR rec IN
    SELECT oid::regprocedure AS sig
    FROM pg_proc
    WHERE proname = 'create_reservation_if_available'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || rec.sig;
  END LOOP;

  -- get_booked_slot_ids の全バリアントを削除（念のため再作成）
  FOR rec IN
    SELECT oid::regprocedure AS sig
    FROM pg_proc
    WHERE proname = 'get_booked_slot_ids'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || rec.sig;
  END LOOP;
END;
$$;

-- Step 2: 予約済み枠IDを取得する関数（匿名ユーザー可・個人情報なし）
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

-- Step 3: 空き確認＆予約登録を原子的に実行する関数
--   引数型を正しく uuid / date / time で定義することで
--   "operator does not exist: uuid = text" を解消する
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

GRANT EXECUTE ON FUNCTION create_reservation_if_available(uuid, date, time, text, text, text, text, jsonb)
  TO anon, authenticated;

-- Step 4: ユニーク制約インデックス（キャンセル以外は1枠1件）
CREATE UNIQUE INDEX IF NOT EXISTS reservations_slot_id_unique
  ON reservations(slot_id)
  WHERE slot_id IS NOT NULL AND status != 'cancelled';

-- 確認クエリ（実行後に関数の引数型が正しいか確認できる）
SELECT
  p.proname AS function_name,
  pg_get_function_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('create_reservation_if_available', 'get_booked_slot_ids')
ORDER BY p.proname;
