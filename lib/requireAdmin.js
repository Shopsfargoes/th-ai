// Like requireUser, but the account must have is_admin = true in profiles.
import { supabaseAdmin } from './supabaseAdmin.js';
import { requireUser } from './requireUser.js';

export async function requireAdmin(req, res) {
  const user = await requireUser(req, res);
  if (!user) return null;

  const { data: profile } = await supabaseAdmin
    .from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
  if (!profile || profile.is_admin !== true) {
    res.status(403).json({ error: 'Not allowed.' });
    return null;
  }
  return user;
}