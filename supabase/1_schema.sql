-- TH_AI: Supabase / Postgres schema
-- Run FIRST in Supabase > SQL Editor.

-- ---------- PROFILES (one row per auth user) ----------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text unique,
  full_name     text,
  avatar_url    text,
  is_admin      boolean not null default false,
  suspended     boolean not null default false,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

-- Auto-create a profile whenever someone signs up (email or Google)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- PLANS ----------
create table public.plans (
  id               smallint generated always as identity primary key,
  code             text not null unique,          -- basic, standard, premium, custom
  name             text not null,
  price_ngn        integer,                       -- in NAIRA (x100 = kobo for Paystack). null = custom quote
  requests_per_day integer,                       -- null = unlimited
  history_days     integer,                       -- null = unlimited
  support_level    text not null default 'basic',
  is_active        boolean not null default true
);

-- ---------- SUBSCRIPTIONS ----------
create table public.subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  plan_id    smallint not null references public.plans(id),
  status     text not null default 'active' check (status in ('active','expired','cancelled')),
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  created_at timestamptz not null default now()
);
create index idx_subs_user_status on public.subscriptions (user_id, status);

-- ---------- PAYMENTS (Paystack transactions) ----------
create table public.payments (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  plan_id     smallint not null references public.plans(id),
  reference   text not null unique,               -- Paystack reference
  amount_kobo bigint not null,
  currency    text not null default 'NGN',
  status      text not null default 'pending' check (status in ('pending','success','failed')),
  paid_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index idx_payments_user on public.payments (user_id);

-- ---------- AGENTS (chat models / bots) ----------
-- Built-in bots: user_id is null. Custom Agent Bots belong to a user.
create table public.agents (
  id            bigint generated always as identity primary key,
  user_id       uuid references public.profiles(id) on delete cascade,
  slug          text unique,
  name          text not null,
  description   text,
  system_prompt text not null,
  ai_model      text not null default 'default',  -- OpenRouter model id (see lib/openrouter.js)
  uses_web      boolean not null default false,
  accepts_files boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------- CONVERSATIONS ----------
create table public.conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  agent_id   bigint not null references public.agents(id),
  title      text not null default 'New Chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_conv_user_updated on public.conversations (user_id, updated_at desc);

-- ---------- MESSAGES ----------
create table public.messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant')),
  content         text not null,
  created_at      timestamptz not null default now()
);
create index idx_messages_conv on public.messages (conversation_id, id);

-- ---------- DAILY USAGE (plan request limits) ----------
create table public.usage_daily (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  usage_date date not null default current_date,
  requests   integer not null default 0,
  primary key (user_id, usage_date)
);

-- Atomic increment, called from /api/chat with the service role
create or replace function public.increment_usage(p_user uuid)
returns integer
language sql
security definer set search_path = public
as $$
  insert into public.usage_daily (user_id, usage_date, requests)
  values (p_user, current_date, 1)
  on conflict (user_id, usage_date)
  do update set requests = public.usage_daily.requests + 1
  returning requests;
$$;
revoke execute on function public.increment_usage(uuid) from public, anon, authenticated;

-- ---------- ADMIN LOGS ----------
create table public.admin_logs (
  id         bigint generated always as identity primary key,
  admin_id   uuid references public.profiles(id) on delete set null,
  action     text not null,
  target     text,
  details    jsonb,
  created_at timestamptz not null default now()
);

-- ---------- APP SETTINGS (maintenance mode, fallback models...) ----------
create table public.app_settings (
  key   text primary key,
  value jsonb not null
);
