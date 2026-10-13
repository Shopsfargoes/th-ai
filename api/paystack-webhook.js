// POST /api/paystack-webhook  (set this URL in the Paystack dashboard)
// The body is never trusted: we only take the reference and ask Paystack to confirm it.
import { activateByReference } from '../lib/billing.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    if (!req.headers['x-paystack-signature']) return res.status(400).json({ error: 'Bad request' });
    const ev = req.body || {};
    if (ev.event === 'charge.success' && ev.data && typeof ev.data.reference === 'string') {
      await activateByReference(ev.data.reference);
    }
  } catch (e) {
    console.error('webhook error:', e.message);
  }
  return res.status(200).json({ received: true });
}