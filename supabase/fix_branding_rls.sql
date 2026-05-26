-- =========================================================
-- branding_settings RLS ポリシー修正
-- Supabase Dashboard > SQL Editor で実行してください
-- =========================================================

-- 既存の write ポリシーを削除
drop policy if exists "branding_settings_write_authenticated" on branding_settings;
drop policy if exists "branding_settings_write_all" on branding_settings;

-- SELECT: 誰でも読み取り可能（既存のポリシーを再作成）
drop policy if exists "branding_settings_select_all" on branding_settings;
create policy "branding_settings_select_all" on branding_settings
  for select using (true);

-- INSERT / UPDATE / DELETE: 制限なし（管理画面からの保存を許可）
create policy "branding_settings_write_all" on branding_settings
  for all using (true) with check (true);

-- =========================================================
-- Supabase Storage: logos バケットのポリシー修正
-- ロゴのアップロード・閲覧も許可する場合は以下も実行
-- =========================================================

-- logos バケットへの SELECT（公開読み取り）
drop policy if exists "logos_public_read" on storage.objects;
create policy "logos_public_read" on storage.objects
  for select using (bucket_id = 'logos');

-- logos バケットへの INSERT（アップロード）
drop policy if exists "logos_public_insert" on storage.objects;
create policy "logos_public_insert" on storage.objects
  for insert with check (bucket_id = 'logos');

-- logos バケットへの UPDATE（上書き）
drop policy if exists "logos_public_update" on storage.objects;
create policy "logos_public_update" on storage.objects
  for update using (bucket_id = 'logos') with check (bucket_id = 'logos');
