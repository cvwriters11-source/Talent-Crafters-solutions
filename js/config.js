/* Supabase connection (project "Talent Crafters", region eu-west-2).
 * The publishable key is designed to be public: all access is limited by the
 * Row Level Security rules in the database. NEVER put a service_role / secret key here.
 */
window.TC_CONFIG = {
  url: "https://lexcymhobrlvzohmlajw.supabase.co",
  key: "sb_publishable_bo0wQnkwO-PcJsnIIKbP0w_TCNAYZNL"
};

window.sb = window.supabase.createClient(window.TC_CONFIG.url, window.TC_CONFIG.key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
