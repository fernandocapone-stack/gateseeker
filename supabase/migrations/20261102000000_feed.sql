-- Curated advisory sets published without a redeploy (docs/SPRINT_6.md 3.5),
-- and the queue that puts followed repositories in front after a new set.
-- Written and read only by the service with the service_role key; RLS on,
-- no policies, like every other table.

-- One row per published set. The service checks the HMAC signature on the
-- way in and again every time it loads the latest row; payload is the exact
-- JSON text that was signed.
create table public.feed_sets (
  id           bigint generated always as identity primary key,
  published_at timestamptz not null,
  digest       text not null,
  payload      text not null,
  signature    text not null,
  created_at   timestamptz not null default now()
);
create index feed_sets_latest_idx on public.feed_sets (published_at desc);
alter table public.feed_sets enable row level security;

-- Ecosystems of the repository at its last rescan (npm, Packagist), and when
-- a new advisory for one of them queued it in front of the daily order.
alter table public.follows add column ecosystems text[];
alter table public.follows add column queued_at timestamptz;
create index follows_queued_idx on public.follows (queued_at) where queued_at is not null and paused_reason is null;
