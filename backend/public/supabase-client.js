/**
 * Browser Supabase client for the PWA (not Next.js — no @supabase/ssr needed).
 */
(function () {
  let client;
  let initPromise;

  async function init() {
    if (!initPromise) {
      initPromise = (async () => {
        const cfg = await fetch('/api/v1/supabase-config').then((r) => r.json());
        if (!cfg.configured) {
          console.info('Supabase client not configured (optional).');
          return null;
        }
        const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.49.8');
        client = createClient(cfg.url, cfg.publishableKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        });
        return client;
      })().catch((err) => {
        console.warn('Supabase init failed:', err);
        initPromise = null;
        return null;
      });
    }
    return initPromise;
  }

  window.SupabaseClient = {
    init,
    async get() {
      return init();
    },
    async getSession() {
      const supabase = await init();
      if (!supabase) return null;
      const { data } = await supabase.auth.getSession();
      return data.session;
    },
  };
})();
