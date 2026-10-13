// Thin Paystack API helpers. Amounts are in KOBO (naira x 100).
const BASE = 'https://api.paystack.co';

function secret() {
  const k = process.env.PAYSTACK_SECRET_KEY;
  if (!k) throw new Error('PAYSTACK_SECRET_KEY is not set');
  return k;
}

export async function initTransaction(body) {
  const r = await fetch(BASE + '/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + secret(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.status) throw new Error(j.message || 'Paystack initialize failed');
  return j.data; // { authorization_url, access_code, reference }
}

export async function verifyTransaction(reference) {
  const r = await fetch(BASE + '/transaction/verify/' + encodeURIComponent(reference), {
    headers: { Authorization: 'Bearer ' + secret() },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.status) throw new Error(j.message || 'Paystack verify failed');
  return j.data; // { status, amount, currency, ... }
}