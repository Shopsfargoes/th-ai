// Phase 0 test endpoint: proves Vercel can talk to Supabase.
// Visit /api/health after deploying. Remove or lock this down before launch.
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

export default async function handler(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('plans')
      .select('code, name, price_ngn')
      .order('id');
    if (error) throw error;
    res.status(200).json({ ok: true, plans: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
