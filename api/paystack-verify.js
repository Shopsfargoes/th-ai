
// POST /api/paystack-verify { reference } -> { status: success | pending | failed, plan? }
import { supabaseAdmin as db } from '../lib/supabaseAdmin.js';
import { requireUser } from '../lib/requireUser.js';
import { activateByReference } from '../lib/billing.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const reference = req.body && typeof req.body.reference === 'string' ? req.body.reference : '';
    if (!reference) return res.status(400).json({ error: 'Missing payment reference.' });

    // The payment must belong to the logged-in user
    const { data: pay } = await db
      .from('payments').select('user_id, plan_id').eq('reference', reference).maybeSingle();
    if (!pay || pay.user_id !== user.id) return res.status(404).json({ error: 'Payment not found.' });

    const result = await activateByReference(reference);
    let planName = null;
    if (result.status === 'success') {
      const { data: plan } = await db.from('plans').select('name').eq('id', pay.plan_id).maybeSingle();
      planName = plan ? plan.name : null;
    }
    return res.status(200).json({ status: result.status, plan: planName });
  } catch (e) {
    console.error('paystack-verify error:', e.message);
    return res.status(500).json({ error: 'We could not confirm your payment yet. Please refresh in a moment.' });
  }
}