-- Server-side scan history (docs/SPRINT_6.md 3.1).
-- One row per finished analysis: what the Dashboard and Scans show, without
-- the report body (reports expire after 30 days; history is kept 180 days by
-- the daily cleanup). Written and read only by the service through the
-- service_role key; RLS on, no policies, like every other table.

create table public.scans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  owner      text not null,
  repo       text not null,
  sha        text not null,
  verdict    text not null check (verdict in ('pass', 'fail', 'incomplete')),
  p1         integer not null default 0,
  p2         integer not null default 0,
  p3         integer not null default 0,
  p4         integer not null default 0,
  report_id  uuid references public.reports (id) on delete set null,
  created_at timestamptz not null default now()
);
create index scans_user_idx      on public.scans (user_id, created_at desc);
create index scans_user_repo_idx on public.scans (user_id, owner, repo, created_at desc);
create index scans_created_idx   on public.scans (created_at);
alter table public.scans enable row level security;
