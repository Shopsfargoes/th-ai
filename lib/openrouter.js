// Calls OpenRouter with automatic fallback to other models.
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'openrouter/free'; // OpenRouter's router that picks an available free model
const ATTEMPTS = 3;
const TIMEOUT_MS = 15000;

export function resolveModel(m) {
  return !m || m === 'default' ? DEFAULT_MODEL : m;
}

export async function chatCompletion({ messages, model, fallbacks = [] }) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY is not set');

  const candidates = [resolveModel(model), ...fallbacks.map(resolveModel), DEFAULT_MODEL];
  const models = [...new Set(candidates)].slice(0, ATTEMPTS);

  let lastError = new Error('No model available');
  for (const m of models) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(API_URL, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
          'X-Title': 'TH_AI',
        },
        body: JSON.stringify({ model: m, messages }),
      });
      const json = await r.json().catch(() => ({}));
      const text = json && json.choices && json.choices[0] && json.choices[0].message
        ? json.choices[0].message.content
        : null;
      if (r.ok && text && text.trim()) {
        return { text: text.trim(), model: json.model || m };
      }
      lastError = new Error((json && json.error && json.error.message) || 'OpenRouter returned ' + r.status);
    } catch (e) {
      lastError = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}