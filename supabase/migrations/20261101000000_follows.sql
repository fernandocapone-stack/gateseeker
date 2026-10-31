-- Followed repositories and the daily monitor's state (docs/SPRINT_6.md 3.3, 3.4).
-- Owner and repo are stored in lower case (GitHub names are case-insensitive).
-- Written and read only by the service with the service_role key; RLS on,
-- no policies, like every other table.

create table public.follows (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  owner           text not null,
  repo            text not null,
  created_at      timestamptz not null default now(),
  last_scan_at    timestamptz,
  last_report_id  uuid references public.reports (id) on delete set null,
  last_verdict    text check (last_verdict in ('pass', 'fail', 'incomplete')),
  last_new_urgent integer not null default 0,
  failures        integer not null default 0,
  paused_reason   text,
  unique (user_id, owner, repo)
);
create index follows_due_idx on public.follows (last_scan_at nulls first) where paused_reason is null;
alter table public.follows enable row level security;

-- Follow with the per-account limit checked in the same transaction.
-- Returns {ok: true, follow: {...}} or {ok: false, reason: "limit"}; an
-- existing follow is returned as is.
create or replace function public.follow_repo(p_user uuid, p_owner text, p_repo text, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.follows;
  n        integer;
  created  public.follows;
begin
  perform pg_advisory_xact_lock(hashtext(p_user::text));
  select * into existing from public.follows where user_id = p_user and owner = p_owner and repo = p_repo;
  if found then
    return jsonb_build_object('ok', true, 'follow', to_jsonb(existing));
  end if;
  select count(*) into n from public.follows where user_id = p_user;
  if n >= p_limit then
    return jsonb_build_object('ok', false, 'reason', 'limit');
  end if;
  insert into public.follows (user_id, owner, repo) values (p_user, p_owner, p_repo) returning * into created;
  return jsonb_build_object('ok', true, 'follow', to_jsonb(created));
end
$$;
revoke all on function public.follow_repo(uuid, text, text, integer) from public, anon, authenticated;
