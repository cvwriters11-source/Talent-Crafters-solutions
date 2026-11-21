/* Supabase connection (project "Talent Crafters", region eu-west-2).
 * The publishable key is designed to be public: all access is limited by the
 * Row Level Security rules in the database. NEVER put a service_role / secret key here.
 */
window.TC_CONFIG = {
  url: "https://lexcymhobrlvzohmlajw.supabase.co",
  key: "sb_publishable_bo0wQnkwO-PcJsnIIKbP0w_TCNAYZNL"
};

/* Fields of work. The same list is used for vacancy categories and for the fields candidates choose
 * for job alerts, so a job only reaches candidates whose field matches exactly. */
window.TC_FIELDS = [
  "Administration", "Customer Service", "Engineering", "Finance", "Human Resources", "IT & Software",
  "Sales & Marketing", "Healthcare", "Education", "Hospitality & Tourism", "Construction & Property",
  "Logistics & Supply Chain", "Manufacturing & Production", "Legal", "Retail", "Security", "Mining & Energy", "Other"
];

window.sb = window.supabase.createClient(window.TC_CONFIG.url, window.TC_CONFIG.key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
