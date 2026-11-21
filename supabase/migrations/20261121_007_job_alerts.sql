-- Job alert emails: candidates choose their field(s) of work; when an admin posts a job and ticks
-- "Email matching candidates", the send-job-alerts edge function emails everyone who is a registered,
-- approved, active candidate with that field selected and alerts switched on.
-- Applied to Supabase project lexcymhobrlvzohmlajw.
--
-- The SMTP password for the sending mailbox is kept in Supabase Vault (encrypted at rest), NOT in this
-- file or in the website code. It was stored with:
--   select vault.create_secret('<password>', 'smtp_password', 'noreply mailbox');

-- ---------------------------------------------------------------------------
-- Candidate preferences
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column fields text[] not null default '{}'
    check (cardinality(fields) <= 20),
  add column job_alerts boolean not null default true,
  add column alert_token uuid not null default gen_random_uuid() unique;

grant update (fields, job_alerts) on public.profiles to authenticated;

-- Which vacancies already had their alert emails sent (stops accidental double sends).
alter table public.vacancies
  add column alerts_sent_at timestamptz,
  add column alerts_count integer;

-- ---------------------------------------------------------------------------
-- Registration can include the chosen fields (stored by the signup trigger)
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
  v_company text;
  v_fields text[];
begin
  v_role := case when new.raw_user_meta_data ->> 'role' = 'employer' then 'employer' else 'candidate' end;
  v_company := case when v_role = 'employer' then left(coalesce(new.raw_user_meta_data ->> 'company', ''), 160) else '' end;

  v_fields := '{}';
  if v_role = 'candidate' and jsonb_typeof(new.raw_user_meta_data -> 'fields') = 'array' then
    select coalesce(array_agg(f), '{}') into v_fields from (
      select distinct left(x, 80) as f
      from jsonb_array_elements_text(new.raw_user_meta_data -> 'fields') as x
      limit 20
    ) s;
  end if;

  insert into public.profiles (id, role, name, email, phone, company, fields)
  values (
    new.id, v_role,
    left(coalesce(new.raw_user_meta_data ->> 'name', ''), 120),
    new.email,
    left(coalesce(new.raw_user_meta_data ->> 'phone', ''), 40),
    v_company,
    v_fields
  );

  perform private.write_log(
    'register',
    'New ' || v_role || ' account' || case when v_company <> '' then ' for ' || v_company else '' end,
    new.id
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- One-click unsubscribe from the email link (the token is a random uuid only the recipient has)
-- ---------------------------------------------------------------------------
create function public.unsubscribe_job_alerts(p_token uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  update public.profiles set job_alerts = false
  where alert_token = p_token
  returning id into v_id;
  return v_id is not null;
end;
$$;
revoke all on function public.unsubscribe_job_alerts(uuid) from public;
grant execute on function public.unsubscribe_job_alerts(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Lets ONLY the edge function (service role) read the SMTP password from the Vault
-- ---------------------------------------------------------------------------
create function public.get_smtp_password() returns text
language sql security definer stable set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'smtp_password' limit 1;
$$;
revoke all on function public.get_smtp_password() from public, anon, authenticated;
grant execute on function public.get_smtp_password() to service_role;
