create table public.profiles (
  id uuid primary key references auth.users(id),
  display_name text
);
alter table public.profiles enable row level security;

create table posts (
  id bigserial primary key,
  author uuid references auth.users(id),
  body text
);
-- forgot RLS on posts

create table if not exists "Comments" (id bigserial primary key, body text);
alter table "Comments" enable row level security;

create table auth.audit_ext (id bigserial primary key);
