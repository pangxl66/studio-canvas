-- Studio Canvas SaaS MVP schema
-- Run this file in the Supabase SQL editor after creating the project.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  plan text not null default $$free$$,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_quota int not null default 50,
  remaining_quota int not null default 50,
  reset_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default $$Untitled Project$$,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists projects_user_updated_idx
  on public.projects(user_id, updated_at desc);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  feature text not null,
  model text,
  input_chars int not null default 0,
  output_chars int not null default 0,
  estimated_tokens int not null default 0,
  quota_cost int not null default 1,
  "status" text not null default $$success$$,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_user_created_idx
  on public.usage_events(user_id, created_at desc);

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  "status" text not null default $$inactive$$,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.credit_wallets enable row level security;
alter table public.projects enable row level security;
alter table public.usage_events enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Users can read own wallet" on public.credit_wallets;
create policy "Users can read own wallet"
on public.credit_wallets for select
using (auth.uid() = user_id);

drop policy if exists "Users can read own projects" on public.projects;
create policy "Users can read own projects"
on public.projects for select
using (auth.uid() = user_id);

drop policy if exists "Users can create own projects" on public.projects;
create policy "Users can create own projects"
on public.projects for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own projects" on public.projects;
create policy "Users can update own projects"
on public.projects for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can read own usage events" on public.usage_events;
create policy "Users can read own usage events"
on public.usage_events for select
using (auth.uid() = user_id);

drop policy if exists "Users can read own subscriptions" on public.subscriptions;
create policy "Users can read own subscriptions"
on public.subscriptions for select
using (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  insert into public.credit_wallets (user_id, monthly_quota, remaining_quota)
  values (new.id, 50, 50)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.reserve_credit_quota(p_user_id uuid, p_cost int)
returns table(ok boolean, remaining_quota int)
language plpgsql
security definer
set search_path = public
as $$
declare
  next_remaining int;
  safe_cost int := greatest(coalesce(p_cost, 1), 1);
begin
  update public.credit_wallets as wallet
  set
    remaining_quota = wallet.remaining_quota - safe_cost,
    updated_at = now()
  where wallet.user_id = p_user_id
    and wallet.remaining_quota >= safe_cost
  returning wallet.remaining_quota into next_remaining;

  if found then
    return query select true, next_remaining;
    return;
  end if;

  select credit_wallets.remaining_quota
  into next_remaining
  from public.credit_wallets
  where user_id = p_user_id;

  return query select false, coalesce(next_remaining, 0);
end;
$$;

create or replace function public.refund_credit_quota(p_user_id uuid, p_cost int)
returns table(remaining_quota int)
language plpgsql
security definer
set search_path = public
as $$
declare
  next_remaining int;
  safe_cost int := greatest(coalesce(p_cost, 1), 1);
begin
  update public.credit_wallets as wallet
  set
    remaining_quota = least(wallet.monthly_quota, wallet.remaining_quota + safe_cost),
    updated_at = now()
  where wallet.user_id = p_user_id
  returning wallet.remaining_quota into next_remaining;

  return query select coalesce(next_remaining, 0);
end;
$$;

revoke all on function public.reserve_credit_quota(uuid, int) from public;
revoke all on function public.refund_credit_quota(uuid, int) from public;
grant execute on function public.reserve_credit_quota(uuid, int) to service_role;
grant execute on function public.refund_credit_quota(uuid, int) to service_role;
