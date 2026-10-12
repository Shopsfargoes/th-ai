-- TH_AI: Row-level security + grants
-- Run SECOND. Principle: the browser can only READ its own data.
-- Anything that writes money, usage, messages or admin data goes through
-- /api functions using the service role key.

-- Start from zero access, then grant only what is needed
revoke all on all tables in schema public from anon, authenticated;

alter table public.profiles       enable row level security;
alter table public.plans          enable row level security;
alter table public.subscriptions  enable row level security;
alter table public.payments       enable row level security;
alter table public.agents         enable row level security;
alter table public.conversations  enable row level security;
alter table public.messages       enable row level security;
alter table public.usage_daily    enable row level security;
alter table public.admin_logs     enable row level security;
alter table public.app_settings   enable row level security;
-- admin_logs and app_settings: no policies = no browser access (service role only)

-- ---------- PROFILES ----------
grant select on public.profiles to authenticated;
grant update (full_name, avatar_url, last_login_at) on public.profiles to authenticated;

create policy "own profile: read"   on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "own profile: update" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- is_admin and suspended cannot be changed from the browser (column grants above)

-- ---------- PLANS (public pricing page) ----------
grant select on public.plans to anon, authenticated;
create policy "plans: public read" on public.plans
  for select to anon, authenticated using (is_active);

-- ---------- SUBSCRIPTIONS / PAYMENTS / USAGE (read own) ----------
grant select on public.subscriptions to authenticated;
create policy "own subscriptions" on public.subscriptions
  for select to authenticated using (user_id = auth.uid());

grant select on public.payments to authenticated;
create policy "own payments" on public.payments
  for select to authenticated using (user_id = auth.uid());

grant select on public.usage_daily to authenticated;
create policy "own usage" on public.usage_daily
  for select to authenticated using (user_id = auth.uid());

-- ---------- AGENTS ----------
grant select on public.agents to authenticated;
-- Users may create custom agents but only set these columns
-- (they cannot choose the AI model or switch on web/file features)
grant insert (user_id, name, description, system_prompt) on public.agents to authenticated;
grant update (name, description, system_prompt) on public.agents to authenticated;
grant delete on public.agents to authenticated;

create policy "agents: read built-in and own" on public.agents
  for select to authenticated
  using (is_active and (user_id is null or user_id = auth.uid()));
create policy "agents: create own" on public.agents
  for insert to authenticated with check (user_id = auth.uid());
create policy "agents: edit own" on public.agents
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "agents: delete own" on public.agents
  for delete to authenticated using (user_id = auth.uid());

-- ---------- CONVERSATIONS ----------
-- Created by /api/chat (service role). Browser can read, rename and delete its own.
grant select, delete on public.conversations to authenticated;
grant update (title) on public.conversations to authenticated;

create policy "own conversations: read" on public.conversations
  for select to authenticated using (user_id = auth.uid());
create policy "own conversations: rename" on public.conversations
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own conversations: delete" on public.conversations
  for delete to authenticated using (user_id = auth.uid());

-- ---------- MESSAGES (read-only from browser, written by /api/chat) ----------
grant select on public.messages to authenticated;
create policy "own messages: read" on public.messages
  for select to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.user_id = auth.uid()
  ));
