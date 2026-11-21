-- Registration: Creative CV client flag + cover letter file on the profile.
-- Applied to Supabase project lexcymhobrlvzohmlajw.

alter table public.profiles
  add column if not exists creative_cv boolean not null default false,
  add column if not exists cover_path text,
  add column if not exists cover_name text not null default '',
  add column if not exists cover_updated timestamptz;

-- Constraints may already exist from apply_migration; ignore failures when re-run locally.
do $$ begin
  alter table public.profiles add constraint profiles_cover_path_folder
    check (cover_path is null or cover_path like id::text || '/%');
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table public.profiles add constraint profiles_cover_name_len
    check (char_length(cover_name) <= 200);
exception when duplicate_object then null;
end $$;

grant update (creative_cv, cover_path, cover_name, cover_updated) on public.profiles to authenticated;
