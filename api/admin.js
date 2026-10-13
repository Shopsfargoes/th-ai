// POST /api/admin { action, ...params }   (admins only)
// One function for the whole admin area, to stay well under Vercel's free-plan function limit.
import { supabaseAdmin as db } from '../lib/supabaseAdmin.js';
import { requireAdmin } from '../lib/requireAdmin.js';
import { activateByReference } from '../lib/billing.js';

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}
const bad = (m) => { throw new HttpError(400, m); };
const DAY = 86400000;
const PAGE = 25;

const isoDay = (d) => d.toISOString().slice(0, 10);
function lastDays(n) {
  const out = [], now = Date.now();
  for (let i = n - 1; i >= 0; i--) out.push(isoDay(new Date(now - i * DAY)));
  return out;
}
function num(v, label, nullable) {
  if (v === null || v === undefined || v === '') {
    if (nullable) return null;
    bad(label + ' is required.');
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 1000000000) bad(label + ' must be a whole number.');
  return n;
}
function str(v, label, max, required) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) bad(label + ' is required.');
  if (s.length > max) bad(label + ' is too long (max ' + max + ').');
  return s;
}
const must = (r) => { if (r.error) throw r.error; return r; };

async function logAction(adminId, action, target, details) {
  await db.from('admin_logs').insert({
    admin_id: adminId, action, target: target == null ? null : String(target), details: details || null,
  });
}

async function targetUser(id) {
  if (!id) bad('Missing user.');
  const { data } = await db.from('profiles').select('id, email, is_admin').eq('id', id).maybeSingle();
  if (!data) throw new HttpError(404, 'User not found.');
  return data;
}

const actions = {
  async me(p, admin) {
    const { data } = await db.from('profiles').select('email').eq('id', admin.id).maybeSingle();
    return { ok: true, email: data ? data.email : admin.email };
  },

  // ---------- dashboard ----------
  async stats() {
    const now = new Date();
    const nowIso = now.toISOString();
    const d7 = new Date(now - 7 * DAY).toISOString();
    const d30 = new Date(now - 30 * DAY).toISOString();
    const head = { count: 'exact', head: true };

    const [u, nu, subs] = await Promise.all([
      db.from('profiles').select('id', head),
      db.from('profiles').select('id', head).gte('created_at', d7),
      db.from('subscriptions').select('id', head).eq('status', 'active').gt('ends_at', nowIso),
    ]);

    const { data: pays } = await db.from('payments').select('amount_kobo, paid_at').eq('status', 'success').limit(10000);
    let revenueAll = 0, revenue30 = 0;
    (pays || []).forEach((x) => {
      revenueAll += Number(x.amount_kobo);
      if (x.paid_at && x.paid_at >= d30) revenue30 += Number(x.amount_kobo);
    });

    const days = lastDays(14);
    const { data: usage } = await db.from('usage_daily')
      .select('user_id, usage_date, requests').gte('usage_date', days[0]).limit(10000);
    const reqByDay = Object.fromEntries(days.map((d) => [d, 0]));
    const perUser = {};
    (usage || []).forEach((r) => {
      if (r.usage_date in reqByDay) reqByDay[r.usage_date] += r.requests;
      if (r.usage_date >= days[7]) perUser[r.user_id] = (perUser[r.user_id] || 0) + r.requests;
    });

    const { data: signups } = await db.from('profiles').select('created_at').gte('created_at', days[0] + 'T00:00:00Z').limit(10000);
    const signByDay = Object.fromEntries(days.map((d) => [d, 0]));
    (signups || []).forEach((r) => { const d = r.created_at.slice(0, 10); if (d in signByDay) signByDay[d]++; });

    const topIds = Object.entries(perUser).sort((a, b) => b[1] - a[1]).slice(0, 5);
    let top = [];
    if (topIds.length) {
      const { data: profs } = await db.from('profiles').select('id, email').in('id', topIds.map((t) => t[0]));
      const em = Object.fromEntries((profs || []).map((x) => [x.id, x.email]));
      top = topIds.map(([id, n]) => ({ email: em[id] || id, requests: n }));
    }

    return {
      users: u.count || 0,
      new_users_7d: nu.count || 0,
      active_subs: subs.count || 0,
      revenue_all_kobo: revenueAll,
      revenue_30d_kobo: revenue30,
      requests_today: reqByDay[days[13]],
      days,
      requests_by_day: days.map((d) => reqByDay[d]),
      signups_by_day: days.map((d) => signByDay[d]),
      top_users: top,
    };
  },

  // ---------- users ----------
  async 'users.list'(p) {
    const page = Math.max(0, Number(p.page) || 0);
    let q = db.from('profiles')
      .select('id, email, full_name, is_admin, suspended, created_at, last_login_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    const term = typeof p.q === 'string' ? p.q.replace(/[%_,()]/g, '').trim() : '';
    if (term) q = q.ilike('email', '%' + term + '%');
    const { data, count, error } = await q;
    if (error) throw error;

    const ids = (data || []).map((x) => x.id);
    let plans = {}, used = {};
    if (ids.length) {
      const { data: subs } = await db.from('subscriptions')
        .select('user_id, ends_at, plans(name)').in('user_id', ids).eq('status', 'active')
        .gt('ends_at', new Date().toISOString());
      (subs || []).forEach((s) => { plans[s.user_id] = { name: s.plans ? s.plans.name : '', ends_at: s.ends_at }; });
      const { data: us } = await db.from('usage_daily').select('user_id, requests').in('user_id', ids).eq('usage_date', isoDay(new Date()));
      (us || []).forEach((r) => { used[r.user_id] = r.requests; });
    }
    return {
      total: count || 0, page, page_size: PAGE,
      users: (data || []).map((x) => ({
        ...x,
        plan: plans[x.id] ? plans[x.id].name : null,
        plan_ends: plans[x.id] ? plans[x.id].ends_at : null,
        used_today: used[x.id] || 0,
      })),
    };
  },

  async 'users.set_status'(p, admin) {
    const t = await targetUser(p.user_id);
    if (t.id === admin.id || t.is_admin) bad('Admin accounts cannot be suspended here.');
    const suspended = p.suspended === true;
    must(await db.from('profiles').update({ suspended }).eq('id', t.id));
    await logAction(admin.id, suspended ? 'user.suspend' : 'user.unsuspend', t.email);
    return { ok: true };
  },

  async 'users.set_plan'(p, admin) {
    const t = await targetUser(p.user_id);
    must(await db.from('subscriptions').update({ status: 'cancelled' }).eq('user_id', t.id).eq('status', 'active'));
    if (p.plan_code === 'free') {
      await logAction(admin.id, 'user.plan_removed', t.email);
      return { ok: true };
    }
    const { data: plan } = await db.from('plans').select('id, name').eq('code', String(p.plan_code)).maybeSingle();
    if (!plan) bad('Unknown plan.');
    const days = num(p.days, 'Days');
    if (days < 1 || days > 366) bad('Days must be between 1 and 366.');
    const now = new Date();
    must(await db.from('subscriptions').insert({
      user_id: t.id, plan_id: plan.id, status: 'active',
      starts_at: now.toISOString(), ends_at: new Date(now.getTime() + days * DAY).toISOString(),
    }));
    await logAction(admin.id, 'user.plan_set', t.email, { plan: plan.name, days });
    return { ok: true };
  },

  async 'users.reset_usage'(p, admin) {
    const t = await targetUser(p.user_id);
    must(await db.from('usage_daily').delete().eq('user_id', t.id).eq('usage_date', isoDay(new Date())));
    await logAction(admin.id, 'user.usage_reset', t.email);
    return { ok: true };
  },

  // ---------- plans ----------
  async 'plans.list'() {
    const { data, error } = await db.from('plans')
      .select('id, code, name, price_ngn, requests_per_day, history_days, support_level, is_active').order('id');
    if (error) throw error;
    return { plans: data || [] };
  },

  async 'plans.update'(p, admin) {
    const id = num(p.id, 'Plan');
    const row = {
      name: str(p.name, 'Name', 60, true),
      price_ngn: num(p.price_ngn, 'Price', true),
      requests_per_day: num(p.requests_per_day, 'Requests per day', true),
      history_days: num(p.history_days, 'History days', true),
      is_active: p.is_active === true,
    };
    must(await db.from('plans').update(row).eq('id', id));
    await logAction(admin.id, 'plan.update', row.name, row);
    return { ok: true };
  },

  // ---------- payments ----------
  async 'payments.list'(p) {
    const page = Math.max(0, Number(p.page) || 0);
    let q = db.from('payments')
      .select('id, reference, amount_kobo, currency, status, paid_at, created_at, profiles(email), plans(name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (['pending', 'success', 'failed'].includes(p.status)) q = q.eq('status', p.status);
    const { data, count, error } = await q;
    if (error) throw error;
    return {
      total: count || 0, page, page_size: PAGE,
      payments: (data || []).map((x) => ({
        id: x.id, reference: x.reference, amount_kobo: x.amount_kobo, currency: x.currency, status: x.status,
        paid_at: x.paid_at, created_at: x.created_at,
        email: x.profiles ? x.profiles.email : null, plan: x.plans ? x.plans.name : null,
      })),
    };
  },

  async 'payments.verify'(p, admin) {
    const ref = str(p.reference, 'Reference', 100, true);
    const result = await activateByReference(ref);
    await logAction(admin.id, 'payment.verify', ref, { result: result.status });
    return { status: result.status };
  },

  // ---------- agents ----------
  async 'agents.list'() {
    const { data, error } = await db.from('agents')
      .select('id, slug, name, description, system_prompt, ai_model, accepts_files, uses_web, is_active, user_id, profiles(email)')
      .order('id');
    if (error) throw error;
    return {
      agents: (data || []).map((a) => ({
        id: a.id, slug: a.slug, name: a.name, description: a.description, system_prompt: a.system_prompt,
        ai_model: a.ai_model, accepts_files: a.accepts_files, uses_web: a.uses_web, is_active: a.is_active,
        owner: a.user_id ? (a.profiles ? a.profiles.email : 'unknown') : null,
      })),
    };
  },

  async 'agents.update'(p, admin) {
    const id = num(p.id, 'Agent');
    const row = {
      name: str(p.name, 'Name', 60, true),
      description: str(p.description, 'Description', 300, false) || null,
      system_prompt: str(p.system_prompt, 'Instructions', 2000, true),
      ai_model: str(p.ai_model, 'Model', 100, true),
      is_active: p.is_active === true,
      accepts_files: p.accepts_files === true,
    };
    must(await db.from('agents').update(row).eq('id', id));
    await logAction(admin.id, 'agent.update', row.name, { ai_model: row.ai_model, is_active: row.is_active });
    return { ok: true };
  },

  async 'agents.delete'(p, admin) {
    const id = num(p.id, 'Agent');
    const { data: a } = await db.from('agents').select('id, name, user_id').eq('id', id).maybeSingle();
    if (!a) throw new HttpError(404, 'Agent not found.');
    if (!a.user_id) bad('Built-in agents cannot be deleted. Turn them off instead.');
    must(await db.from('agents').delete().eq('id', id));
    await logAction(admin.id, 'agent.delete', a.name);
    return { ok: true };
  },

  // ---------- logs ----------
  async 'logs.list'() {
    const [a, e] = await Promise.all([
      db.from('admin_logs').select('id, action, target, details, created_at, profiles(email)')
        .order('created_at', { ascending: false }).limit(50),
      db.from('ai_errors').select('id, message, created_at, profiles(email), agents(name)')
        .order('created_at', { ascending: false }).limit(50),
    ]);
    if (a.error) throw a.error;
    if (e.error) throw e.error;
    return {
      actions: (a.data || []).map((x) => ({
        action: x.action, target: x.target, details: x.details, created_at: x.created_at,
        admin: x.profiles ? x.profiles.email : null,
      })),
      errors: (e.data || []).map((x) => ({
        message: x.message, created_at: x.created_at,
        email: x.profiles ? x.profiles.email : null, agent: x.agents ? x.agents.name : null,
      })),
    };
  },

  // ---------- settings ----------
  async 'settings.get'() {
    const { data } = await db.from('app_settings').select('key, value').in('key', ['maintenance_mode', 'fallback_models']);
    const m = Object.fromEntries((data || []).map((x) => [x.key, x.value]));
    return {
      maintenance_mode: m.maintenance_mode === true,
      fallback_models: Array.isArray(m.fallback_models) ? m.fallback_models : [],
    };
  },

  async 'settings.set'(p, admin) {
    const maintenance = p.maintenance_mode === true;
    const models = (Array.isArray(p.fallback_models) ? p.fallback_models : [])
      .map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
    if (models.length > 5) bad('Use at most 5 fallback models.');
    if (models.some((x) => x.length > 100)) bad('A model id is too long.');
    must(await db.from('app_settings').upsert([
      { key: 'maintenance_mode', value: maintenance },
      { key: 'fallback_models', value: models },
    ], { onConflict: 'key' }));
    await logAction(admin.id, 'settings.update', null, { maintenance, fallback_models: models });
    return { ok: true };
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { action, ...params } = req.body || {};
  const fn = Object.prototype.hasOwnProperty.call(actions, action) ? actions[action] : null;
  if (!fn) return res.status(400).json({ error: 'Unknown action.' });

  try {
    const out = await fn(params, admin);
    return res.status(200).json(out);
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    console.error('admin error (' + action + '):', e);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
}