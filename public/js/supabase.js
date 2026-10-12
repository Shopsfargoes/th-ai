// Browser Supabase client (public anon key only). Needs config.js loaded first.
(function () {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.TH_CONFIG || {};
    window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  })();