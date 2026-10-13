// GET /api/usage -> { plan, ends_at, limit, used, history_days }
import { requireUser } from '../lib/requireUser.js';
import { getUsage } from '../lib/limits.js';

export default async function handler(req, res) {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const { exceeded, ...info } = await getUsage(user.id);
    res.status(200).json(info);
  } catch (e) {
    console.error('usage error:', e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
}