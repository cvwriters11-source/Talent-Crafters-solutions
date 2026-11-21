-- Talent Crafters: initial schema, RLS and server-side activity logging.
-- Applied to Supabase project lexcymhobrlvzohmlajw.

-- ---------------------------------------------------------------------------
-- Private schema for helper/trigger functions (not exposed through the Data API)
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'candidate' check (role in ('candidate', 'employer', 'admin')),
  name text not null default '' check (char_length(name) <= 120),
  email text not null,
  phone text not null default '' check (char_length(phone) <= 40),
  company text not null default '' check (char_length(company) <= 160),
  status text not null default 'active' check (status in ('active', 'suspended')),
  notes text not null default '' check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  last_login timestamptz
);

create table public.vacancies (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  company text not null default 'Confidential Client' check (char_length(company) <= 160),
  location text not null check (char_length(location) between 1 and 120),
  type text not null check (type in ('Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary')),
  category text not null check (char_length(category) between 1 and 80),
  salary text not null default '' check (char_length(salary) <= 120),
  summary text not null default '' check (char_length(summary) <= 1000),
  requirements text[] not null default '{}',
  active boolean not null default true,
  posted date not null default current_date
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  job_id uuid not null references public.vacancies (id) on delete restrict,
  status text not null default 'New'
    check (status in ('New', 'Reviewed', 'Shortlisted', 'Interviewed', 'Offered', 'Placed', 'Rejected')),
  created_at timestamptz not null default now(),
  unique (user_id, job_id)
);
create index applications_job_id_idx on public.applications (job_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 200),
  phone text not null default '' check (char_length(phone) <= 40),
  topic text not null check (char_length(topic) between 1 and 80),
  message text not null check (char_length(message) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index messages_user_id_idx on public.messages (user_id);

create table public.activity_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid, -- deliberately no FK: history must survive account deletion
  actor_name text not null default 'Visitor',
  actor_email text not null default '',
  actor_role text not null default 'visitor',
  action text not null check (char_length(action) <= 60),
  details text not null default '' check (char_length(details) <= 1000)
);
create index activity_log_created_at_idx on public.activity_log (created_at desc);
create index activity_log_actor_id_idx on public.activity_log (actor_id);

-- ---------------------------------------------------------------------------
-- Helper functions (security definer, private schema, empty search_path)
-- ---------------------------------------------------------------------------
create function private.is_admin() returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin' and status = 'active'
  );
$$;

create function private.is_active_candidate() returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'candidate' and status = 'active'
  );
$$;

revoke all on function private.is_admin() from public;
revoke all on function private.is_active_candidate() from public;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_active_candidate() to authenticated;

-- Server-side activity log writer. Only callable from other trigger functions.
create function private.write_log(
  p_action text, p_details text, p_actor uuid default auth.uid(),
  p_name text default null, p_email text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_name text; v_email text; v_role text;
begin
  select name, email, role into v_name, v_email, v_role from public.profiles where id = p_actor;
  insert into public.activity_log (actor_id, actor_name, actor_email, actor_role, action, details)
  values (
    p_actor,
    coalesce(v_name, p_name, 'Visitor'),
    coalesce(v_email, p_email, ''),
    coalesce(v_role, 'visitor'),
    p_action,
    left(coalesce(p_details, ''), 1000)
  );
end;
$$;
revoke all on function private.write_log(text, text, uuid, text, text) from public;

-- ---------------------------------------------------------------------------
-- Triggers: new user -> profile (role can only ever be candidate or employer)
-- ---------------------------------------------------------------------------
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
  v_company text;
begin
  v_role := case when new.raw_user_meta_data ->> 'role' = 'employer' then 'employer' else 'candidate' end;
  v_company := case when v_role = 'employer' then left(coalesce(new.raw_user_meta_data ->> 'company', ''), 160) else '' end;

  insert into public.profiles (id, role, name, email, phone, company)
  values (
    new.id, v_role,
    left(coalesce(new.raw_user_meta_data ->> 'name', ''), 120),
    new.email,
    left(coalesce(new.raw_user_meta_data ->> 'phone', ''), 40),
    v_company
  );

  perform private.write_log(
    'register',
    'New ' || v_role || ' account' || case when v_company <> '' then ' for ' || v_company else '' end,
    new.id
  );
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Login tracking (server-side: fired when Supabase Auth records a sign-in)
create function private.handle_login() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.last_sign_in_at is not null and new.last_sign_in_at is distinct from old.last_sign_in_at then
    update public.profiles set last_login = new.last_sign_in_at where id = new.id;
    perform private.write_log('login', 'Logged in', new.id);
  end if;
  return new;
end;
$$;
revoke all on function private.handle_login() from public;
create trigger on_auth_user_login
  after update of last_sign_in_at on auth.users
  for each row execute function private.handle_login();

-- ---------------------------------------------------------------------------
-- Profile guard: users can't escalate role, change email or touch admin-only fields
-- (auth.uid() is null for direct SQL, the service role and the auth system itself)
-- ---------------------------------------------------------------------------
create function private.guard_profile_update() returns trigger
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
    if old.id = (select auth.uid()) and new.status <> old.status then
      raise exception 'You cannot change your own status';
    end if;
  elsif new.status <> old.status or new.notes <> old.notes then
    raise exception 'This change is not allowed';
  end if;

  return new;
end;
$$;
revoke all on function private.guard_profile_update() from public;
create trigger profiles_guard
  before update on public.profiles
  for each row execute function private.guard_profile_update();

create function private.log_profile_update() returns trigger
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
  if new.notes <> old.notes then
    perform private.write_log('notes_updated', 'Updated notes for ' || v_label);
  end if;
  return new;
end;
$$;
revoke all on function private.log_profile_update() from public;
create trigger profiles_log
  after update on public.profiles
  for each row execute function private.log_profile_update();

-- ---------------------------------------------------------------------------
-- Application + message + vacancy logging
-- ---------------------------------------------------------------------------
create function private.log_application_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  select title, location into v from public.vacancies where id = new.job_id;
  perform private.write_log('apply', 'Applied for ' || v.title || ' (' || v.location || ')', new.user_id);
  return new;
end;
$$;
revoke all on function private.log_application_insert() from public;
create trigger applications_log_insert
  after insert on public.applications
  for each row execute function private.log_application_insert();

create function private.log_application_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v record; p record;
begin
  if new.status <> old.status then
    select title into v from public.vacancies where id = new.job_id;
    select name into p from public.profiles where id = new.user_id;
    perform private.write_log(
      'application_status',
      coalesce(p.name, 'Unknown') || ' - ' || v.title || ': ' || old.status || ' → ' || new.status
    );
  end if;
  return new;
end;
$$;
revoke all on function private.log_application_update() from public;
create trigger applications_log_update
  after update on public.applications
  for each row execute function private.log_application_update();

create function private.log_message_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.write_log(
    'contact_message', 'Contact form (' || new.topic || ')',
    new.user_id, new.name, new.email
  );
  return new;
end;
$$;
revoke all on function private.log_message_insert() from public;
create trigger messages_log_insert
  after insert on public.messages
  for each row execute function private.log_message_insert();

create function private.log_vacancy_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_log('vacancy_created', 'Created vacancy ' || new.title || ' (' || new.location || ')');
    return new;
  elsif tg_op = 'UPDATE' then
    perform private.write_log(
      'vacancy_updated',
      case when new.active <> old.active then (case when new.active then 'Reopened ' else 'Closed ' end) else 'Updated ' end
        || 'vacancy ' || new.title
    );
    return new;
  else
    perform private.write_log('vacancy_deleted', 'Deleted vacancy ' || old.title);
    return old;
  end if;
end;
$$;
revoke all on function private.log_vacancy_change() from public;
create trigger vacancies_log
  after insert or update or delete on public.vacancies
  for each row execute function private.log_vacancy_change();

-- ---------------------------------------------------------------------------
-- Privileges (least privilege; RLS below is the second layer)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

grant select on public.vacancies to anon;
grant select, insert, update, delete on public.vacancies to authenticated;

grant select on public.profiles to authenticated;
grant update (name, phone, company, status, notes) on public.profiles to authenticated;

grant select on public.applications to authenticated;
grant insert (job_id) on public.applications to authenticated;
grant update (status) on public.applications to authenticated;

grant insert (user_id, name, email, phone, topic, message) on public.messages to anon, authenticated;
grant select on public.messages to authenticated;

-- activity_log is append-only for everyone; only admins may read it
grant select on public.activity_log to authenticated;
grant insert (actor_id, actor_name, actor_email, actor_role, action, details) on public.activity_log to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.vacancies enable row level security;
alter table public.applications enable row level security;
alter table public.messages enable row level security;
alter table public.activity_log enable row level security;

-- profiles
create policy "profiles: read own or admin" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.is_admin());
create policy "profiles: update own or admin" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or private.is_admin())
  with check (id = (select auth.uid()) or private.is_admin());

-- vacancies
create policy "vacancies: public reads open" on public.vacancies
  for select to anon using (active);
create policy "vacancies: authenticated read open, admin all" on public.vacancies
  for select to authenticated using (active or private.is_admin());
create policy "vacancies: admin insert" on public.vacancies
  for insert to authenticated with check (private.is_admin());
create policy "vacancies: admin update" on public.vacancies
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "vacancies: admin delete" on public.vacancies
  for delete to authenticated using (private.is_admin());

-- applications
create policy "applications: read own or admin" on public.applications
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());
create policy "applications: active candidates apply to open vacancies" on public.applications
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'New'
    and private.is_active_candidate()
    and exists (select 1 from public.vacancies v where v.id = job_id and v.active)
  );
create policy "applications: admin update status" on public.applications
  for update to authenticated using (private.is_admin()) with check (private.is_admin());

-- messages (contact form is public, reading is admin-only)
create policy "messages: anyone can send" on public.messages
  for insert to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));
create policy "messages: admin read" on public.messages
  for select to authenticated using (private.is_admin());

-- activity_log
create policy "activity_log: admin read" on public.activity_log
  for select to authenticated using (private.is_admin());
create policy "activity_log: admin may record exports" on public.activity_log
  for insert to authenticated
  with check (
    private.is_admin() and action = 'export'
    and actor_id = (select auth.uid()) and actor_role = 'admin'
  );
