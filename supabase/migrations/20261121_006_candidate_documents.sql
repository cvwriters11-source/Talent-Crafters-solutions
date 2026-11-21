-- Candidate CVs (private storage) and cover letters on applications.
-- Applied to Supabase project lexcymhobrlvzohmlajw.
--
-- * CVs live in the PRIVATE bucket 'candidate-documents', one folder per user: <user id>/<file>.
--   Only the owner and a verified admin can read them; nobody else, and never publicly.
-- * A candidate must have a CV on file to apply (enforced by the database, not just the page).
-- * The cover letter is plain text stored with each application.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column cv_path text check (cv_path is null or cv_path like id::text || '/%'),
  add column cv_name text not null default '' check (char_length(cv_name) <= 200),
  add column cv_updated timestamptz;

grant update (cv_path, cv_name, cv_updated) on public.profiles to authenticated;

alter table public.applications
  add column cover_letter text not null default '' check (char_length(cover_letter) <= 4000);

revoke insert on public.applications from authenticated;
grant insert (job_id, cover_letter) on public.applications to authenticated;

-- Applying now also needs a CV on file.
drop policy "applications: active candidates apply to open vacancies" on public.applications;
create policy "applications: active candidates apply to open vacancies" on public.applications
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'New'
    and private.is_active_candidate()
    and exists (select 1 from public.vacancies v where v.id = job_id and v.active)
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.cv_path is not null)
  );

-- ---------------------------------------------------------------------------
-- Private storage bucket + policies
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'candidate-documents', 'candidate-documents', false, 5242880,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "candidate docs: owner uploads" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'candidate-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and private.session_verified()
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'candidate' and p.status = 'active')
  );

create policy "candidate docs: owner or admin reads" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'candidate-documents'
    and (
      ((storage.foldername(name))[1] = (select auth.uid())::text and private.session_verified())
      or private.is_admin()
    )
  );

create policy "candidate docs: owner replaces" on storage.objects
  for update to authenticated
  using (bucket_id = 'candidate-documents' and (storage.foldername(name))[1] = (select auth.uid())::text and private.session_verified())
  with check (bucket_id = 'candidate-documents' and (storage.foldername(name))[1] = (select auth.uid())::text and private.session_verified());

create policy "candidate docs: owner deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'candidate-documents' and (storage.foldername(name))[1] = (select auth.uid())::text and private.session_verified());

-- ---------------------------------------------------------------------------
-- Audit trail: record CV uploads/removals (the file name only, never the contents)
-- ---------------------------------------------------------------------------
create or replace function private.log_profile_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_label text := coalesce(nullif(new.company, ''), new.name) || ' (' || new.email || ')';
begin
  if new.status <> old.status then
    perform private.write_log(
      case when new.status = 'suspended' then 'user_suspended' else 'user_reactivated' end,
      case when new.status = 'suspended' then 'Suspended ' else 'Reactivated ' end || v_label
    );
  end if;
  if new.approval <> old.approval then
    perform private.write_log(
      case new.approval when 'approved' then 'user_approved' when 'rejected' then 'user_rejected' else 'user_approval_reset' end,
      case new.approval when 'approved' then 'Approved ' when 'rejected' then 'Rejected ' else 'Set to pending: ' end || v_label
    );
  end if;
  if new.notes <> old.notes then
    perform private.write_log('notes_updated', 'Updated notes for ' || v_label);
  end if;
  if new.cv_path is distinct from old.cv_path then
    perform private.write_log(
      case when new.cv_path is null then 'cv_removed' else 'cv_uploaded' end,
      case when new.cv_path is null then 'Removed CV: ' else 'Uploaded CV (' || new.cv_name || '): ' end || v_label
    );
  end if;
  return new;
end;
$$;
