-- Company logos on vacancies.
-- Logos live in a public Storage bucket (so job cards can show them); only admins can write to it.
-- Applied to Supabase project lexcymhobrlvzohmlajw.

alter table public.vacancies
  add column logo_url text not null default ''
  check (
    logo_url = ''
    or logo_url like 'https://lexcymhobrlvzohmlajw.supabase.co/storage/v1/object/public/company-logos/%'
  );

-- Public bucket: files are readable by URL, but there is deliberately no SELECT policy,
-- so nobody can list the bucket. Images only (no SVG), max 1 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-logos', 'company-logos', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

create policy "company-logos: admin upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'company-logos' and private.is_admin());
create policy "company-logos: admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'company-logos' and private.is_admin())
  with check (bucket_id = 'company-logos' and private.is_admin());
create policy "company-logos: admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'company-logos' and private.is_admin());
