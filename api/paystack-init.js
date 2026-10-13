// POST /api/paystack-init { plan_code } -> { authorization_url, reference }
import { randomUUID } from 'node:crypto';
import { supabaseAdmin as db } from '../lib/supabaseAdmin.js';
import { requireUser } from '../lib/requireUser.js';
import { initTransaction } from '../lib/paystack.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const code = req.body && req.body.plan_code;
    const { data: plan } = await db
      .from('plans')
      .select('id, code, name, price_ngn')
      .eq('code', code)
      .eq('is_active', true)
      .maybeSingle();
    if (!plan || !plan.price_ngn) return res.status(400).json({ error: 'This plan is not available for online payment.' });

    const reference = 'thai_' + randomUUID().replace(/-/g, '');
    const amountKobo = plan.price_ngn * 100;

    const { error } = await db.from('payments').insert({
      user_id: user.id,
      plan_id: plan.id,
      reference,
      amount_kobo: amountKobo,
      currency: 'NGN',
      status: 'pending',
    });
    if (error) throw error;

    const site = process.env.SITE_URL || 'https://' + req.headers.host;
    const tx = await initTransaction({
      email: user.email,
      amount: amountKobo,
      currency: 'NGN',
      reference,
      callback_url: site + '/payment-status',
      metadata: { user_id: user.id, plan_code: plan.code },
    });

    return res.status(200).json({ authorization_url: tx.authorization_url, reference });
  } catch (e) {
    console.error('paystack-init error:', e.message);
    return res.status(500).json({ error: 'We could not start the payment. Please try again.' });
  }
}