-- Admin-controlled welcome / review pop-up shown to website visitors.
-- One row only (id is always true). Everyone can read it (it is public website content); only a verified
-- admin can change it. Every save bumps `version`, which makes visitors who already closed it see it again.

create table public.site_popup (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  title text not null default '' check (char_length(title) <= 120),
  message text not null default '' check (char_length(message) <= 600),
  button_text text not null default 'Leave us a review' check (char_length(button_text) between 1 and 40),
  link_url text not null default '' check (link_url = '' or link_url ~* '^https://[^[:space:]]+$'),
  delay_seconds integer not null default 3 check (delay_seconds between 0 and 120),
  repeat_days integer not null default 0 check (repeat_days between 0 and 365),
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

insert into public.site_popup (title, message, button_text, link_url)
values (
  'Hello, and welcome to Talent Crafters!',
  'What do you think about us? Please press the button below and tell us what is on your mind.',
  'Leave us a review',
  'https://g.page/r/CVileb3jY4eUEBE/review'
);

alter table public.site_popup enable row level security;

revoke all on public.site_popup from anon, authenticated;
grant select on public.site_popup to anon, authenticated;
grant update (enabled, title, message, button_text, link_url, delay_seconds, repeat_days) on public.site_popup to authenticated;

create policy "site_popup: public read" on public.site_popup
  for select to anon, authenticated using (true);

create policy "site_popup: admin update" on public.site_popup
  for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

create function private.site_popup_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.id := true;
  new.version := old.version + 1;
  new.updated_at := now();
  perform private.write_log('popup_updated', case when new.enabled then 'Pop-up saved (switched on)' else 'Pop-up saved (switched off)' end);
  return new;
end;
$$;

create trigger site_popup_touch before update on public.site_popup
  for each row execute function private.site_popup_touch();
