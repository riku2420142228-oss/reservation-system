-- =========================================================
-- 予約システム用スキーマ（完全版）
-- Supabase SQL Editor で実行してください
-- =========================================================

-- --------------------------
-- staffs: スタッフ
-- --------------------------
create table if not exists staffs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#64748b',
  created_at timestamptz not null default now()
);

create index if not exists staffs_name_idx on staffs(name);

-- --------------------------
-- categories: 予約枠のカテゴリ
-- --------------------------
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#3b82f6',
  created_at timestamptz not null default now()
);

-- --------------------------
-- time_slots: 予約枠
-- unique制約なし（同一時間帯に複数枠登録可能）
-- --------------------------
create table if not exists time_slots (
  id uuid primary key default gen_random_uuid(),
  slot_date date not null,
  start_time time not null,
  end_time time not null,
  category_id uuid not null references categories(id) on delete restrict,
  staff_id uuid references staffs(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create index if not exists time_slots_slot_date_idx on time_slots(slot_date);
create index if not exists time_slots_category_id_idx on time_slots(category_id);
create index if not exists time_slots_staff_id_idx on time_slots(staff_id);

-- --------------------------
-- reservations: 顧客からの予約申込
-- --------------------------
create table if not exists reservations (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid references time_slots(id) on delete set null,
  reservation_date date,
  reservation_time time,
  name text not null,
  customer_email text not null,
  phone text,
  notes text,
  status text not null default 'confirmed',
  created_at timestamptz not null default now()
);

create index if not exists reservations_reservation_date_idx on reservations(reservation_date);
create index if not exists reservations_slot_id_idx on reservations(slot_id);

-- --------------------------
-- form_fields: 予約フォームのカスタム質問項目
-- --------------------------
create table if not exists form_fields (
  id uuid primary key default gen_random_uuid(),
  field_name text not null,
  field_type text not null check (field_type in ('text', 'number', 'select', 'textarea')),
  is_required boolean not null default false,
  options jsonb,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists form_fields_display_order_idx on form_fields(display_order);
create index if not exists form_fields_created_at_idx on form_fields(created_at);

-- --------------------------
-- RLS
-- --------------------------
alter table staffs enable row level security;
alter table categories enable row level security;
alter table time_slots enable row level security;
alter table reservations enable row level security;

-- staffs
drop policy if exists "staffs_select_all" on staffs;
create policy "staffs_select_all" on staffs
  for select using (true);

drop policy if exists "staffs_write_authenticated" on staffs;
create policy "staffs_write_authenticated" on staffs
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- categories
drop policy if exists "categories_select_all" on categories;
create policy "categories_select_all" on categories
  for select using (true);

drop policy if exists "categories_write_authenticated" on categories;
create policy "categories_write_authenticated" on categories
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- time_slots
drop policy if exists "time_slots_select_all" on time_slots;
create policy "time_slots_select_all" on time_slots
  for select using (true);

drop policy if exists "time_slots_write_authenticated" on time_slots;
create policy "time_slots_write_authenticated" on time_slots
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- form_fields
alter table form_fields enable row level security;

drop policy if exists "form_fields_select_all" on form_fields;
create policy "form_fields_select_all" on form_fields
  for select using (true);

drop policy if exists "form_fields_write_authenticated" on form_fields;
create policy "form_fields_write_authenticated" on form_fields
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- reservations: 一般ユーザーはinsertのみ、認証済みは全操作可
drop policy if exists "reservations_insert_all" on reservations;
create policy "reservations_insert_all" on reservations
  for insert with check (true);

drop policy if exists "reservations_select_authenticated" on reservations;
create policy "reservations_select_authenticated" on reservations
  for select using (auth.uid() is not null);

drop policy if exists "reservations_update_authenticated" on reservations;
create policy "reservations_update_authenticated" on reservations
  for update using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "reservations_delete_authenticated" on reservations;
create policy "reservations_delete_authenticated" on reservations
  for delete using (auth.uid() is not null);

-- reservations に custom_answers カラムを追加（存在しない場合のみ）
alter table reservations add column if not exists custom_answers jsonb;

-- branding_settings に background_color カラムを追加（存在しない場合のみ）
alter table branding_settings add column if not exists background_color text default '#F3F4F6';

-- --------------------------
-- branding_settings: ブランディング設定
-- --------------------------
create table if not exists branding_settings (
  id uuid primary key default gen_random_uuid(),
  theme_color text not null default '#3B82F6',
  logo_url text,
  updated_at timestamptz not null default now()
);

alter table branding_settings enable row level security;

drop policy if exists "branding_settings_select_all" on branding_settings;
create policy "branding_settings_select_all" on branding_settings
  for select using (true);

drop policy if exists "branding_settings_write_authenticated" on branding_settings;
create policy "branding_settings_write_all" on branding_settings
  for all using (true) with check (true);

-- デフォルト設定を1件挿入（初回のみ）
insert into branding_settings (theme_color) values ('#3B82F6')
on conflict do nothing;

-- =========================================================
-- Supabase Storage: logos バケット（手動作成が必要）
-- =========================================================
-- Supabase Dashboard > Storage > New bucket で以下を作成:
--   バケット名: logos
--   Public bucket: ON（公開）
-- =========================================================

-- --------------------------
-- デフォルトデータ
-- --------------------------
insert into categories (name, color) values
  ('治療', '#3b82f6'),
  ('トレーニング', '#10b981')
on conflict (name) do nothing;
