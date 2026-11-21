-- Leads: companies with open jobs discovered via the Adzuna API (admin-only, private).

create table public.lead_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  name_key text generated always as (lower(btrim(name))) stored unique,
  status text not null default 'New'
    check (status in ('New', 'Researching', 'Contacted', 'Replied', 'Not interested', 'Do not contact')),
  notes text not null default '' check (char_length(notes) <= 4000),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table public.lead_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lead_companies (id) on delete cascade,
  source text not null default 'adzuna',
  external_id text not null,
  title text not null check (char_length(title) <= 300),
  location text not null default '' check (char_length(location) <= 200),
  category text not null default '' check (char_length(category) <= 120),
  contract_type text not null default '' check (char_length(contract_type) <= 60),
  salary_min numeric,
  salary_max numeric,
  url text not null check (url ~ '^https?://'),
  posted_at timestamptz,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (source, external_id)
);
create index lead_jobs_company_id_idx on public.lead_jobs (company_id);

-- Privileges: admins read, update status/notes, delete. Rows are inserted only by the
-- server function (service role), never from the browser.
revoke all on public.lead_companies, public.lead_jobs from anon, authenticated;
grant select, delete on public.lead_companies to authenticated;
grant update (status, notes) on public.lead_companies to authenticated;
grant select on public.lead_jobs to authenticated;

alter table public.lead_companies enable row level security;
alter table public.lead_jobs enable row level security;

create policy "lead_companies: admin read" on public.lead_companies
  for select to authenticated using (private.is_admin());
create policy "lead_companies: admin update" on public.lead_companies
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "lead_companies: admin delete" on public.lead_companies
  for delete to authenticated using (private.is_admin());
create policy "lead_jobs: admin read" on public.lead_jobs
  for select to authenticated using (private.is_admin());

-- Audit trail for admin changes to leads
create function private.log_lead_company_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> old.status then
    perform private.write_log('lead_status', new.name || ': ' || old.status || ' → ' || new.status);
  end if;
  if new.notes <> old.notes then
    perform private.write_log('lead_notes', 'Updated notes for lead ' || new.name);
  end if;
  return new;
end;
$$;
revoke all on function private.log_lead_company_update() from public;
create trigger lead_companies_log_update
  after update on public.lead_companies
  for each row execute function private.log_lead_company_update();

create function private.log_lead_company_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.write_log('lead_deleted', 'Removed lead ' || old.name);
  return old;
end;
$$;
revoke all on function private.log_lead_company_delete() from public;
create trigger lead_companies_log_delete
  after delete on public.lead_companies
  for each row execute function private.log_lead_company_delete();
