-- Login funnel counters (docs/SPRINT_4.md 3.4, docs/ROADMAP.md decision 1).
-- One row per UTC day and kind; no user, IP or user agent. Written only by
-- the service through count_event (service_role); RLS on, no policies.
-- Each daily counter is capped so an abusive client can inflate a number
-- but cannot grow the table or the value without bound.
create table public.events (
  day   date   not null,
  kind  text   not null check (kind in ('login_view', 'login_start', 'signin_complete')),
  count bigint not null default 0,
  primary key (day, kind)
);
alter table public.events enable row level security;

create or replace function public.count_event(p_kind text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.events (day, kind, count)
    values ((now() at time zone 'utc')::date, p_kind, 1)
    on conflict (day, kind) do update set count = least(public.events.count + 1, 1000000);
$$;
revoke all on function public.count_event(text) from public, anon, authenticated;
