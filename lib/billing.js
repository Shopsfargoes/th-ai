// Confirms a payment with Paystack and activates the plan. Safe to call many times
// (callback page + webhook can both call it): only the first success creates a subscription.
import { supabaseAdmin as db } from './supabaseAdmin.js';
import { verifyTransaction } from './paystack.js';

const PLAN_DAYS = 30;

export async function activateByReference(reference) {
  const { data: pay } = await db
    .from('payments')
    .select('id, user_id, plan_id, amount_kobo, currency, status')
    .eq('reference', reference)
    .maybeSingle();
  if (!pay) return { ok: false, status: 'unknown' };
  if (pay.status === 'success') return { ok: true, status: 'success', plan_id: pay.plan_id };

  // Ask Paystack directly. This is the source of truth, never the browser or webhook body.
  let tx;
  try {
    tx = await verifyTransaction(reference);
  } catch (e) {
    console.error('verify error:', e.message);
    return { ok: false, status: 'pending' }; // not found yet / network hiccup
  }

  if (tx.status === 'failed') {
    await db.from('payments').update({ status: 'failed' }).eq('id', pay.id).eq('status', 'pending');
    return { ok: false, status: 'failed' };
  }
  if (tx.status !== 'success') return { ok: false, status: 'pending' }; // abandoned / ongoing

  // Amount and currency must match what we asked for
  if (tx.currency !== pay.currency || Number(tx.amount) !== Number(pay.amount_kobo)) {
    console.error('payment mismatch for', reference);
    await db.from('payments').update({ status: 'failed' }).eq('id', pay.id).eq('status', 'pending');
    return { ok: false, status: 'failed' };
  }

  // Claim it: only one caller flips pending -> success
  const { data: claimed } = await db
    .from('payments')
    .update({ status: 'success', paid_at: new Date().toISOString() })
    .eq('id', pay.id)
    .eq('status', 'pending')
    .select('id');
  if (!claimed || !claimed.length) return { ok: true, status: 'success', plan_id: pay.plan_id };

  try {
    const now = new Date();
    const end = new Date(now.getTime() + PLAN_DAYS * 24 * 60 * 60 * 1000);
    await db.from('subscriptions').update({ status: 'cancelled' }).eq('user_id', pay.user_id).eq('status', 'active');
    const { error } = await db.from('subscriptions').insert({
      user_id: pay.user_id,
      plan_id: pay.plan_id,
      status: 'active',
      starts_at: now.toISOString(),
      ends_at: end.toISOString(),
    });
    if (error) throw error;
  } catch (e) {
    console.error('subscription error:', e.message);
    await db.from('payments').update({ status: 'pending', paid_at: null }).eq('id', pay.id); // allow a retry
    return { ok: false, status: 'pending' };
  }
  return { ok: true, status: 'success', plan_id: pay.plan_id };
}