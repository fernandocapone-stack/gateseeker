-- Email alerts of the monitor (docs/SPRINT_6.md 3.6, 3.7). No email address
-- is stored: the service reads it from Supabase Auth when it sends.
-- Written and read only by the service with the service_role key; RLS on,
-- no policies, like every other table.

-- The alert waiting to be sent (closed list of fields: report id, count, and
-- per finding priority, identifier, label) and when the last one was sent,
-- for the limit of one email per repository per day.
alter table public.follows add column pending_alert jsonb;
alter table public.follows add column last_alert_at timestamptz;

-- Emails sent per UTC day, under the provider's daily limit.
create table public.email_quota (
  day  date primary key,
  sent integer not null default 0
);
alter table public.email_quota enable row level security;

-- Takes one send from today's allowance; false when the cap is reached.
create or replace function public.claim_email(p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'utc')::date;
  n     integer;
begin
  insert into public.email_quota (day, sent) values (today, 0) on conflict (day) do nothing;
  update public.email_quota set sent = sent + 1 where day = today and sent < p_limit returning sent into n;
  return n is not null;
end
$$;
revoke all on function public.claim_email(integer) from public, anon, authenticated;

-- Aggregate counters for the monitor and the emails, next to the login funnel.
alter table public.events drop constraint events_kind_check;
alter table public.events add constraint events_kind_check check (kind in (
  'login_view', 'login_start', 'signin_complete',
  'rescan_complete', 'rescan_incomplete', 'rescan_failed',
  'email_follow_confirm', 'email_alert', 'email_paused', 'email_capped', 'email_failed',
  'email_click', 'unsubscribe'
));

-- follow_repo now also says whether the follow is new (the confirmation email
-- goes only then). Same lock and limit as before.
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
    return jsonb_build_object('ok', true, 'created', false, 'follow', to_jsonb(existing));
  end if;
  select count(*) into n from public.follows where user_id = p_user;
  if n >= p_limit then
    return jsonb_build_object('ok', false, 'reason', 'limit');
  end if;
  insert into public.follows (user_id, owner, repo) values (p_user, p_owner, p_repo) returning * into created;
  return jsonb_build_object('ok', true, 'created', true, 'follow', to_jsonb(created));
end
$$;
revoke all on function public.follow_repo(uuid, text, text, integer) from public, anon, authenticated;
