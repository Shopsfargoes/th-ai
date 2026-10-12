// Verifies the logged-in user from the "Authorization: Bearer <token>" header.
// Returns the user, or sends an error response and returns null.
import { supabaseAdmin } from './supabaseAdmin.js';

export async function requireUser(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Please log in to continue.' });
    return null;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data || !data.user) {
    res.status(401).json({ error: 'Your session has expired. Please log in again.' });
    return null;
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('suspended')
    .eq('id', data.user.id)
    .maybeSingle();
  if (profile && profile.suspended) {
    res.status(403).json({ error: 'This account is not active. Please contact support.' });
    return null;
  }

  return data.user;
}