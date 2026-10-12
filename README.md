# TH_AI

AI learning chatbots and agents. Vercel (static frontend + Node `/api`) + Supabase (Postgres, Auth) + OpenRouter + Paystack (NGN).

## Structure
- `public/`   static site (HTML/CSS/JS)
- `api/`      serverless endpoints (each file = one URL)
- `lib/`      shared server helpers (not public)
- `supabase/` SQL: schema, policies, seed

## Phase 0 setup
1. Create an empty GitHub repo and push this folder.
2. In Vercel: Add New > Project > import the repo (Framework preset: Other).
3. Add environment variables (Settings > Environment Variables), from `.env.example`:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Edit `public/js/config.js` with your Supabase URL and anon key, commit, push.
5. Open your Vercel URL. Both setup checks should show a green "working".

## Rules
- The service_role key lives only in Vercel environment variables.
- Never commit `.env` files.
