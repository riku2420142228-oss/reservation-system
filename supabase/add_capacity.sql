-- =========================================================
-- 定員（capacity）機能の追加
-- Supabase SQL Editor で実行してください
-- =========================================================

-- 1. time_slots テーブルに capacity カラムを追加
ALTER TABLE time_slots
  ADD COLUMN IF NOT EXISTS capacity INTEGER NOT NULL DEFAULT 1;

ALTER TABLE time_slots
  ADD CONSTRAINT IF NOT EXISTS capacity_min CHECK (capacity >= 1);

-- 2. 旧ユニークインデックスを削除
--    capacity > 1 のスロットでは複数予約が必要なため
DROP INDEX IF EXISTS reservations_slot_id_unique;

-- 3. スロットごとの予約件数とキャパシティを返す新関数
--    匿名ユーザーも呼び出し可（個人情報は返さない）
CREATE OR REPLACE FUNCTION get_slot_booking_counts(slot_ids uuid[])
RETURNS TABLE(slot_id uuid, booking_count bigint, capacity integer)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    ts.id          AS slot_id,
    COUNT(r.id)    AS booking_count,
    ts.capacity    AS capacity
  FROM time_slots ts
  LEFT JOIN reservations r
    ON r.slot_id = ts.id
   AND r.status != 'cancelled'
  WHERE ts.id = ANY(slot_ids)
  GROUP BY ts.id, ts.capacity;
$$;

GRANT EXECUTE ON FUNCTION get_slot_booking_counts(uuid[]) TO anon, authenticated;

-- 4. 後方互換: get_booked_slot_ids もキャパシティベースの満席判定に更新
CREATE OR REPLACE FUNCTION get_booked_slot_ids(slot_ids uuid[])
RETURNS TABLE(slot_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT ts.id AS slot_id
  FROM time_slots ts
  WHERE ts.id = ANY(slot_ids)
    AND (
      SELECT COUNT(*) FROM reservations r
      WHERE r.slot_id = ts.id AND r.status != 'cancelled'
    ) >= ts.capacity;
$$;

GRANT EXECUTE ON FUNCTION get_booked_slot_ids(uuid[]) TO anon, authenticated;

-- 5. create_reservation_if_available を再作成（キャパシティベースの満席判定）
DROP FUNCTION IF EXISTS create_reservation_if_available(uuid, date, time, text, text, text, text, jsonb);

CREATE FUNCTION create_reservation_if_available(
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
  v_count    integer;
  v_capacity integer;
  v_row      reservations;
BEGIN
  -- 行レベルロックでスロットへの同時アクセスを直列化する
  SELECT capacity INTO v_capacity
  FROM time_slots
  WHERE id = p_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'error',   'SLOT_NOT_FOUND',
      'message', 'この予約枠は存在しません。ページを更新して再度お試しください。'
    );
  END IF;

  -- キャンセル以外の予約数を確認
  SELECT COUNT(*) INTO v_count
  FROM reservations
  WHERE slot_id = p_slot_id
    AND status != 'cancelled';

  -- 予約数が定員以上なら満席
  IF v_count >= v_capacity THEN
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
