-- TH_AI: seed data. Run THIRD. Safe to re-run.

-- Naira prices are placeholders. Edit them to your own pricing.
insert into public.plans (code, name, price_ngn, requests_per_day, history_days, support_level) values
  ('basic',    'Basic Plan',    7500,  500,  30,   'basic'),
  ('standard', 'Standard Plan', 49500, 1500, 90,   '24/7'),
  ('premium',  'Premium Plan',  82500, 5000, 365,  'premium'),
  ('custom',   'Custom Plan',   null,  null, null, 'unlimited')
on conflict (code) do nothing;

insert into public.agents (slug, name, description, system_prompt, uses_web, accepts_files) values
  ('basic-tutor', 'Basic Tutor Bot',
   'Teaches basic vocabulary and sentence construction with translations and phonetics.',
   'You are a patient language tutor for beginners. Teach basic vocabulary and sentence construction. Always give the translation and a phonetic pronunciation.',
   false, false),
  ('advance-tutor', 'Advance Tutor Bot',
   'Provides summaries on relevant topics sourced from the web for advanced learners.',
   'You are a tutor for advanced learners. Provide clear, well-structured summaries of relevant topics.',
   true, false),
  ('practice-tutor', 'Practice Tutor Bot',
   'Generates lessons and exercises based on user-provided content or downloaded documents for specialized learning.',
   'You create lessons and practice exercises from the content the user provides. Include answers separately.',
   false, true),
  ('general-chatbot', 'General Chatbot',
   'A bilingual agent facilitating communication between foreigners and locals, capable of processing images, documents, and voice inputs.',
   'You are a bilingual assistant helping foreigners and locals communicate. Translate and explain clearly.',
   false, true)
on conflict (slug) do nothing;

insert into public.app_settings (key, value) values
  ('maintenance_mode', 'false'::jsonb),
  ('fallback_models',  '[]'::jsonb)   -- fill with OpenRouter model ids later
on conflict (key) do nothing;

-- AFTER you sign up through the app, make yourself admin:
-- update public.profiles set is_admin = true where email = 'you@example.com';
