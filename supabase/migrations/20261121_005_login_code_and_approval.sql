-- Email login codes (enforced by the database) + admin approval of new accounts.
-- Applied to Supabase project lexcymhobrlvzohmlajw.
--
-- How the login code works: after the password is accepted, the site emails a 6-digit code through
-- Supabase Auth. Entering it creates a session whose JWT `amr` claim lists a non-password method.
-- While private.settings 'require_login_code' = 'true', every protected policy below requires such a
-- session, so a password-only session (e.g. someone calling the API directly) sees nothing.

-- ---------------------------------------------------------------------------
-- Settings (private, not exposed through the Data API). Starts OFF so a broken
-- email setup can never lock the admin out; switch on after a successful test:
--   update private.settings set value = 'true' where key = 'require_login_code';
-- ---------------------------------------------------------------------------
create table private.settings (
  key text primary key,
  value text not null
);
revoke all on private.settings from public, anon, authenticated;
insert into private.settings (key, value) values ('require_login_code', 'false');

create function private.session_verified() returns boolean
language sql security definer stable set search_path = '' as $$
  select coalesce((select value from private.settings where key = 'require_login_code'), 'false') <> 'true'
    or exists (
      select 1
      from jsonb_array_elements(coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb)) a
      where a ->> 'method' not in ('password', 'token_refresh')
    );
$$;
revoke all on function private.session_verified() from public;
grant execute on function private.session_verified() to authenticated;

-- The site asks this so it knows whether to show the code step (it only reveals a yes/no).
create function public.login_code_required() returns boolean
language sql security definer stable set search_path = '' as $$
  select coalesce((select value from private.settings where key = 'require_login_code'), 'false') = 'true';
$$;
revoke all on function public.login_code_required() from public;
grant execute on function public.login_code_required() to anon, authenticated;

-- Edge functions use this (with the caller's own JWT) to confirm "verified, active admin".
create function public.is_verified_admin() returns boolean
language sql security invoker stable set search_path = '' as $$
  select private.is_admin();
$$;
revoke all on function public.is_verified_admin() from public;
grant execute on function public.is_verified_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Approval of new accounts. Existing accounts are approved; new ones start pending.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column approval text not null default 'approved'
  check (approval in ('pending', 'approved', 'rejected'));
alter table public.profiles alter column approval set default 'pending';

grant update (approval) on public.profiles to authenticated;

-- Helpers now require a verified session; candidates must also be approved to apply.
create or replace function private.is_admin() returns boolean
language sql security definer stable set search_path = '' as $$
  select private.session_verified() and exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin' and status = 'active'
  );
$$;

create or replace function private.is_active_candidate() returns boolean
language sql security definer stable set search_path = '' as $$
  select private.session_verified() and exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'candidate' and status = 'active' and approval = 'approved'
  );
$$;

-- Policies that used a bare "own row" test now also need a verified session.
drop policy "profiles: update own or admin" on public.profiles;
create policy "profiles: update own or admin" on public.profiles
  for update to authenticated
  using ((id = (select auth.uid()) and private.session_verified()) or private.is_admin())
  with check ((id = (select auth.uid()) and private.session_verified()) or private.is_admin());

drop policy "applications: read own or admin" on public.applications;
create policy "applications: read own or admin" on public.applications
  for select to authenticated
  using ((user_id = (select auth.uid()) and private.session_verified()) or private.is_admin());

-- Only admins may change approval (same rule as status and notes).
create or replace function private.guard_profile_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if new.id <> old.id or new.email <> old.email or new.created_at <> old.created_at
     or new.role <> old.role or new.last_login is distinct from old.last_login then
    raise exception 'This change is not allowed';
  end if;

  if private.is_admin() then
    if old.role = 'admin' and old.id <> (select auth.uid()) then
      raise exception 'Admin accounts cannot be modified';
    end if;
    if old.id = (select auth.uid()) and (new.status <> old.status or new.approval <> old.approval) then
      raise exception 'You cannot change your own status';
    end if;
  elsif new.status <> old.status or new.notes <> old.notes or new.approval <> old.approval then
    raise exception 'This change is not allowed';
  end if;

  return new;
end;
$$;

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
  return new;
end;
$$;
