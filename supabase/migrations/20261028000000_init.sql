-- Gateseeker hosted service: first schema.
-- Run once in the Supabase SQL editor (or `supabase db push`).
--
-- Access model: the browser never talks to these tables. Only the Vercel
-- function, holding the service_role key, reads and writes them; the service
-- role bypasses row level security. RLS is still enabled on every table with
-- NO policies, so the anon and authenticated roles get nothing, which is the
-- state GSK-SUPABASE-001 checks for in other people's projects.

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  owner       text not null,
  repo        text not null,
  ref         text,
  sha         text not null,
  cached_from uuid,
  body        jsonb not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index reports_cache_idx   on public.reports (owner, repo, sha, created_at desc);
create index reports_user_idx    on public.reports (user_id, created_at desc);
create index reports_expires_idx on public.reports (expires_at);
alter table public.reports enable row level security;

create table public.scan_quota (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  window_start timestamptz not null,
  used         integer not null default 0
);
alter table public.scan_quota enable row level security;

create table public.waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  wants      text,
  user_id    uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index waitlist_email_idx on public.waitlist (lower(email));
alter table public.waitlist enable row level security;

-- Atomic per-user quota: one row per user, a fixed window that restarts when
-- it has elapsed. Returns {allowed, used, limit, reset_at}.
create or replace function public.claim_scan(p_user uuid, p_limit integer, p_window_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r       public.scan_quota;
  v_now   timestamptz := now();
  v_reset timestamptz;
begin
  insert into public.scan_quota (user_id, window_start, used)
    values (p_user, v_now, 0)
    on conflict (user_id) do nothing;
  select * into r from public.scan_quota where user_id = p_user for update;
  if r.window_start + make_interval(secs => p_window_seconds) <= v_now then
    r.window_start := v_now;
    r.used := 0;
  end if;
  v_reset := r.window_start + make_interval(secs => p_window_seconds);
  if r.used >= p_limit then
    update public.scan_quota set window_start = r.window_start, used = r.used where user_id = p_user;
    return jsonb_build_object('allowed', false, 'used', r.used, 'limit', p_limit, 'reset_at', v_reset);
  end if;
  update public.scan_quota set window_start = r.window_start, used = r.used + 1 where user_id = p_user;
  return jsonb_build_object('allowed', true, 'used', r.used + 1, 'limit', p_limit, 'reset_at', v_reset);
end
$$;
revoke all on function public.claim_scan(uuid, integer, integer) from public, anon, authenticated;
