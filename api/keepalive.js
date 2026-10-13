// Called once a day by a Vercel cron job so the free Supabase project is never idle for a week.
import { supabaseAdmin as db } from '../lib/supabaseAdmin.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET; // optional: Vercel sends it automatically if you set it
  if (secret && req.headers.authorization !== 'Bearer ' + secret) {
    return res.status(401).json({ ok: false });
  }
  const { error } = await db.from('plans').select('id').limit(1);
  if (error) {
    console.error('keepalive error:', error.message);
    return res.status(500).json({ ok: false });
  }
  return res.status(200).json({ ok: true, at: new Date().toISOString() });
}