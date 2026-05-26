import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// 環境変数が不足している場合はエラーをthrowするためのカスタムエラー
export class SupabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupabaseConfigError';
  }
}

// 環境変数のチェック関数
function validateSupabaseConfig() {
  if (!supabaseUrl) {
    throw new SupabaseConfigError(
      'SupabaseのURLが設定されていません。.env.localファイルにNEXT_PUBLIC_SUPABASE_URLを設定してください。'
    );
  }
  if (!supabaseAnonKey) {
    throw new SupabaseConfigError(
      'SupabaseのAPIキーが設定されていません。.env.localファイルにNEXT_PUBLIC_SUPABASE_ANON_KEYを設定してください。'
    );
  }
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

// 予約データの型
export interface Reservation {
  id?: string;
  slot_id?: string | null;
  reservation_date: string;
  reservation_time: string;
  name: string;
  customer_email: string;
  phone: string;
  notes?: string;
  custom_answers?: Record<string, string>;
  created_at?: string;
}

// 予約済み枠IDを取得する（UI表示用・匿名ユーザー可）
export async function fetchBookedSlotIds(slotIds: string[]): Promise<Set<string>> {
  if (slotIds.length === 0) return new Set();
  const { data, error } = await supabase.rpc('get_booked_slot_ids', {
    slot_ids: slotIds,
  });
  if (error) {
    console.warn('予約済み枠の取得に失敗（UI表示のみ影響、保存時の検証は別途実施）:', error);
    return new Set();
  }
  return new Set((data ?? []).map((r: { slot_id: string }) => r.slot_id));
}

// スロットごとの予約件数と定員を取得する（残席表示用）
export interface SlotBookingCount {
  count: number;
  capacity: number;
}

export async function fetchSlotBookingCounts(slotIds: string[]): Promise<Map<string, SlotBookingCount>> {
  if (slotIds.length === 0) return new Map();
  const { data, error } = await supabase.rpc('get_slot_booking_counts', {
    slot_ids: slotIds,
  });
  if (error) {
    console.warn('予約件数の取得に失敗:', error);
    return new Map();
  }
  const map = new Map<string, SlotBookingCount>();
  for (const row of (data ?? []) as { slot_id: string; booking_count: number; capacity: number }[]) {
    map.set(row.slot_id, { count: Number(row.booking_count), capacity: row.capacity });
  }
  return map;
}

// 予約を保存する関数（原子的チェック＆インサート）
export async function createReservation(reservation: Omit<Reservation, 'id' | 'created_at'>) {
  try {
    validateSupabaseConfig();
  } catch (configError) {
    throw configError;
  }

  // slot_id がない場合は直接インサート（管理者操作などの後方互換）
  if (!reservation.slot_id) {
    const { data, error } = await supabase
      .from('reservations')
      .insert([reservation])
      .select()
      .single();
    if (error) {
      const enhancedError = new Error(error.message) as Error & { originalError?: unknown; code?: string };
      enhancedError.originalError = error;
      enhancedError.code = error.code;
      throw enhancedError;
    }
    return data;
  }

  // 原子的チェック＆インサート（FOR UPDATE ロックで同時実行を防止）
  const { data, error } = await supabase.rpc('create_reservation_if_available', {
    p_slot_id:          reservation.slot_id,
    p_reservation_date: reservation.reservation_date,
    p_reservation_time: reservation.reservation_time,
    p_name:             reservation.name,
    p_customer_email:   reservation.customer_email,
    p_phone:            reservation.phone,
    p_notes:            reservation.notes ?? null,
    p_custom_answers:   reservation.custom_answers ?? null,
  });

  if (error) {
    let message = error.message;
    if (error.code === '23505') {
      message = '大変申し訳ありません。タッチの差でこのお時間は満席となりました。別のお時間をお選びください。';
    }
    const enhancedError = new Error(message) as Error & { originalError?: unknown; code?: string };
    enhancedError.originalError = error;
    enhancedError.code = error.code;
    throw enhancedError;
  }

  // アプリケーションレベルのエラー（満席・枠なし）
  if (data?.error) {
    throw new Error(data.message ?? '予約の保存に失敗しました。');
  }

  return data;
}

// =========================================================
// 認証関連
// =========================================================

export async function signInWithPassword(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    let message = error.message;
    if (message.includes('Invalid login credentials')) {
      message = 'メールアドレスまたはパスワードが正しくありません。';
    } else if (message.includes('Email not confirmed')) {
      message = 'メールアドレスが未確認です。確認メールをご確認ください。';
    }
    const e = new Error(message) as Error & { originalError?: unknown };
    e.originalError = error;
    throw e;
  }
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

// =========================================================
// カテゴリ
// =========================================================

export interface Category {
  id: string;
  name: string;
  color: string;
  created_at?: string;
}

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Category[];
}

export async function createCategory(input: { name: string; color: string }): Promise<Category> {
  const { data, error } = await supabase
    .from('categories')
    .insert([input])
    .select()
    .single();
  if (error) throw error;
  return data as Category;
}

export async function updateCategory(id: string, input: Partial<{ name: string; color: string }>): Promise<Category> {
  const { data, error } = await supabase
    .from('categories')
    .update(input)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Category;
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') {
      throw new Error('このカテゴリは予約枠に使われているため削除できません。先に該当する予約枠を削除してください。');
    }
    throw error;
  }
}

// =========================================================
// 予約枠（10分単位）
// =========================================================

export interface TimeSlot {
  id: string;
  slot_date: string;   // YYYY-MM-DD
  start_time: string;  // HH:MM:SS
  end_time: string;    // HH:MM:SS
  category_id: string;
  staff_id?: string | null;
  capacity?: number;
  created_at?: string;
}

export async function fetchTimeSlotsByDate(date: string): Promise<TimeSlot[]> {
  const { data, error } = await supabase
    .from('time_slots')
    .select('*')
    .eq('slot_date', date)
    .order('start_time', { ascending: true });
  if (error) throw error;
  return (data ?? []) as TimeSlot[];
}

export async function fetchTimeSlotsInRange(startDate: string, endDate: string): Promise<TimeSlot[]> {
  const { data, error } = await supabase
    .from('time_slots')
    .select('*')
    .gte('slot_date', startDate)
    .lte('slot_date', endDate)
    .order('slot_date', { ascending: true })
    .order('start_time', { ascending: true });
  if (error) throw error;
  return (data ?? []) as TimeSlot[];
}

export async function createTimeSlot(
  slot: Omit<TimeSlot, 'id' | 'created_at'>
): Promise<TimeSlot> {
  const { data, error } = await supabase
    .from('time_slots')
    .insert([slot])
    .select()
    .single();
  if (error) throw error;
  return data as TimeSlot;
}

export async function createTimeSlots(
  slots: Array<Omit<TimeSlot, 'id' | 'created_at'>>
): Promise<TimeSlot[]> {
  if (slots.length === 0) return [];
  const { data, error } = await supabase
    .from('time_slots')
    .insert(slots)
    .select();
  if (error) throw error;
  return (data ?? []) as TimeSlot[];
}

export async function updateTimeSlot(id: string, input: { capacity: number }): Promise<TimeSlot> {
  const { data, error } = await supabase
    .from('time_slots')
    .update(input)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as TimeSlot;
}

export async function deleteTimeSlot(id: string): Promise<void> {
  const { error } = await supabase.from('time_slots').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteTimeSlotsByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('time_slots').delete().in('id', ids);
  if (error) throw error;
}

// =========================================================
// スタッフ
// =========================================================

export interface Staff {
  id: string;
  name: string;
  color: string;
  created_at?: string;
}

export async function fetchStaffs(): Promise<Staff[]> {
  const { data, error } = await supabase
    .from('staffs')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Staff[];
}

export async function createStaff(input: { name: string; color: string }): Promise<Staff> {
  const { data, error } = await supabase
    .from('staffs')
    .insert([input])
    .select()
    .single();
  if (error) throw error;
  return data as Staff;
}

export async function updateStaff(id: string, input: Partial<{ name: string; color: string }>): Promise<Staff> {
  const { data, error } = await supabase
    .from('staffs')
    .update(input)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Staff;
}

export async function deleteStaff(id: string): Promise<void> {
  const { error } = await supabase.from('staffs').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') {
      throw new Error('このスタッフは予約枠に割り当てられているため削除できません。先に該当する予約枠を変更してください。');
    }
    throw error;
  }
}

// =========================================================
// 管理用予約一覧
// =========================================================

export interface AdminReservation {
  id: string;
  slot_id?: string | null;
  reservation_date?: string | null;
  reservation_time?: string | null;
  name: string;
  customer_email: string;
  phone?: string | null;
  notes?: string | null;
  status: string;
  custom_answers?: Record<string, unknown> | null;
  created_at?: string;
  // time_slots join から解決
  slot_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  category_id?: string | null;
  staff_id?: string | null;
}

export async function fetchReservationsInRange(
  startDate: string,
  endDate: string
): Promise<AdminReservation[]> {
  const { data, error } = await supabase
    .from('reservations')
    .select(`
      id, name, customer_email, phone, notes, status, custom_answers, created_at,
      slot_id, reservation_date, reservation_time,
      time_slots(slot_date, start_time, end_time, category_id, staff_id)
    `)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return ((data ?? []) as any[])
    .map((r) => {
      const slot = Array.isArray(r.time_slots) ? r.time_slots[0] : r.time_slots;
      const slotDate: string | null = slot?.slot_date ?? r.reservation_date ?? null;
      return {
        id: r.id,
        slot_id: r.slot_id ?? null,
        reservation_date: r.reservation_date ?? null,
        reservation_time: r.reservation_time ?? null,
        name: r.name,
        customer_email: r.customer_email,
        phone: r.phone ?? null,
        notes: r.notes ?? null,
        status: r.status ?? 'confirmed',
        custom_answers: r.custom_answers ?? null,
        created_at: r.created_at,
        slot_date: slotDate,
        start_time: slot?.start_time ?? r.reservation_time ?? null,
        end_time: slot?.end_time ?? null,
        category_id: slot?.category_id ?? null,
        staff_id: slot?.staff_id ?? null,
      } as AdminReservation;
    })
    .filter((r) => {
      if (!r.slot_date) return true;
      return r.slot_date >= startDate && r.slot_date <= endDate;
    });
}

export async function updateReservationStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase
    .from('reservations')
    .update({ status })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteReservation(id: string): Promise<void> {
  const { error } = await supabase.from('reservations').delete().eq('id', id);
  if (error) throw error;
}

// =========================================================
// カスタムフォームフィールド（問診票）
// =========================================================

export interface FormField {
  id: string;
  field_name: string;
  field_type: 'text' | 'number' | 'select' | 'textarea';
  is_required: boolean;
  options: string[] | null;
  display_order: number;
  created_at?: string;
}

export async function fetchFormFields(): Promise<FormField[]> {
  const { data, error } = await supabase
    .from('form_fields')
    .select('*')
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as FormField[];
}

export async function createFormField(input: {
  field_name: string;
  field_type: FormField['field_type'];
  is_required: boolean;
  options: string[] | null;
  display_order: number;
}): Promise<FormField> {
  const { data, error } = await supabase
    .from('form_fields')
    .insert([input])
    .select()
    .single();
  if (error) throw error;
  return data as FormField;
}

export async function updateFormField(
  id: string,
  input: Partial<{
    field_name: string;
    field_type: FormField['field_type'];
    is_required: boolean;
    options: string[] | null;
    display_order: number;
  }>
): Promise<FormField> {
  const { data, error } = await supabase
    .from('form_fields')
    .update(input)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as FormField;
}

export async function deleteFormField(id: string): Promise<void> {
  const { error } = await supabase.from('form_fields').delete().eq('id', id);
  if (error) throw error;
}

// =========================================================
// ブランディング設定
// =========================================================

export interface BrandingSettings {
  id: number;
  theme_color: string;
  logo_url: string | null;
  background_color?: string | null;
  company_name?: string | null;
}

export async function fetchBrandingSettings(): Promise<BrandingSettings | null> {
  try {
    const { data, error } = await supabase
      .from('branding_settings')
      .select('*')
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return data as BrandingSettings | null;
  } catch {
    return null;
  }
}

export async function saveBrandingSettings(
  input: { theme_color: string; logo_url?: string | null; background_color?: string | null },
): Promise<BrandingSettings> {
  const { data, error } = await supabase
    .from('branding_settings')
    .upsert({
      id: 1,
      theme_color: input.theme_color,
      logo_url: input.logo_url ?? null,
      background_color: input.background_color ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as BrandingSettings;
}

export async function uploadLogo(file: File): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'png';
  const fileName = `logo-${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from('logos')
    .upload(fileName, file, { upsert: true, cacheControl: '3600' });
  if (error) {
    if (error.message.toLowerCase().includes('bucket')) {
      throw new Error(
        '「logos」ストレージバケットが見つかりません。\n' +
        'Supabaseダッシュボードの Storage > New bucket から「logos」という名前の公開バケットを作成してください。'
      );
    }
    throw error;
  }
  const { data } = supabase.storage.from('logos').getPublicUrl(fileName);
  return data.publicUrl;
}
