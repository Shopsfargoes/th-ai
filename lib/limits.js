// Daily request limits. Users without an active subscription get DEFAULT_DAILY_LIMIT.
import { supabaseAdmin } from './supabaseAdmin.js';

const DEFAULT_LIMIT = Number(process.env.DEFAULT_DAILY_LIMIT || 20);

export async function getUsage(userId) {
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('plans(requests_per_day)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .gt('ends_at', new Date().toISOString())
    .order('ends_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const plan = sub ? sub.plans : null;
  const limit = plan ? plan.requests_per_day : DEFAULT_LIMIT; // null = unlimited

  const today = new Date().toISOString().slice(0, 10);
  const { data: row } = await supabaseAdmin
    .from('usage_daily')
    .select('requests')
    .eq('user_id', userId)
    .eq('usage_date', today)
    .maybeSingle();

  const used = row ? row.requests : 0;
  return { limit, used, exceeded: limit != null && used >= limit };
}

export async function recordUsage(userId) {
  await supabaseAdmin.rpc('increment_usage', { p_user: userId });
}