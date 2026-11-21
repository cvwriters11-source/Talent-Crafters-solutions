-- Full job description shown in the vacancy popup (the short `summary` stays on the cards).
-- Applied to Supabase project lexcymhobrlvzohmlajw.
alter table public.vacancies
  add column description text not null default '' check (char_length(description) <= 10000);
