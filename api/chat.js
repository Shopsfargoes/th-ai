// POST /api/chat  { message, conversation_id?, agent_id? }  (Authorization: Bearer <token>)
import { supabaseAdmin as db } from '../lib/supabaseAdmin.js';
import { requireUser } from '../lib/requireUser.js';
import { chatCompletion } from '../lib/openrouter.js';
import { getUsage, recordUsage } from '../lib/limits.js';

const MAX_LEN = 4000;
const HISTORY = 20;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const { message, conversation_id, agent_id } = req.body || {};
    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) return res.status(400).json({ error: 'Please enter a message.' });
    if (text.length > MAX_LEN) {
      return res.status(400).json({ error: 'Message is too long (max ' + MAX_LEN + ' characters).' });
    }

    // Maintenance mode (set in app_settings)
    const { data: maint } = await db.from('app_settings').select('value').eq('key', 'maintenance_mode').maybeSingle();
    if (maint && maint.value === true) {
      return res.status(503).json({ error: 'We are performing maintenance. Please try again shortly.' });
    }

    // Daily limit
    const usage = await getUsage(user.id);
    if (usage.exceeded) {
      return res.status(429).json({
        error: "You've reached your daily limit. Upgrade your plan to keep chatting.",
        code: 'limit',
      });
    }

    // Existing conversation must belong to this user
    let convo = null;
    if (conversation_id) {
      const { data } = await db
        .from('conversations')
        .select('id, agent_id, title')
        .eq('id', conversation_id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!data) return res.status(404).json({ error: 'Conversation not found.' });
      convo = data;
    }

    // Pick the agent (built-in, or one this user created)
    let q = db.from('agents').select('id, system_prompt, ai_model').eq('is_active', true);
    if (convo) q = q.eq('id', convo.agent_id);
    else if (agent_id) q = q.eq('id', agent_id);
    else q = q.eq('slug', 'general-chatbot');
    const { data: agent } = await q.or('user_id.is.null,user_id.eq.' + user.id).maybeSingle();
    if (!agent) return res.status(404).json({ error: 'This assistant is unavailable.' });

    // Recent history
    let history = [];
    if (convo) {
      const { data } = await db
        .from('messages')
        .select('role, content')
        .eq('conversation_id', convo.id)
        .order('id', { ascending: false })
        .limit(HISTORY);
      history = (data || []).reverse();
    }

    const { data: fb } = await db.from('app_settings').select('value').eq('key', 'fallback_models').maybeSingle();
    const fallbacks = fb && Array.isArray(fb.value) ? fb.value : [];

    let reply;
    try {
      reply = await chatCompletion({
        model: agent.ai_model,
        fallbacks,
        messages: [
          { role: 'system', content: agent.system_prompt },
          ...history,
          { role: 'user', content: text },
        ],
      });
    } catch (e) {
      console.error('OpenRouter error:', e.message);
      return res.status(503).json({ error: "We're experiencing high demand right now. Please try again in a moment." });
    }

    // Save everything only after the AI answered
    let conversationId = convo ? convo.id : null;
    let title = convo ? convo.title : null;
    if (!convo) {
      title = text.replace(/\s+/g, ' ').slice(0, 50);
      const { data: created, error } = await db
        .from('conversations')
        .insert({ user_id: user.id, agent_id: agent.id, title })
        .select('id')
        .single();
      if (error) throw error;
      conversationId = created.id;
    }

    const { error: msgErr } = await db.from('messages').insert([
      { conversation_id: conversationId, role: 'user', content: text },
      { conversation_id: conversationId, role: 'assistant', content: reply.text },
    ]);
    if (msgErr) throw msgErr;

    await db.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
    await recordUsage(user.id);

    return res.status(200).json({ conversation_id: conversationId, title, reply: reply.text });
  } catch (err) {
    console.error('chat error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}