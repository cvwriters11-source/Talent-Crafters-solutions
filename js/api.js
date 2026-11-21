/* Data layer: Supabase-backed Auth, Vacancies and admin API.
 * Authorization is enforced by the database (RLS + triggers), NOT by this file.
 * Anything checked here (e.g. isAdmin) only controls what the UI shows.
 */
(function () {
  const sb = window.sb;
  const HINT = "tc_hint"; // display-only hint so the header paints instantly; never used for access control

  function friendly(e) {
    if (!e) return null;
    const m = String(e.message || "").toLowerCase();
    if (e.status === 429 || e.code === "over_email_send_rate_limit" || e.code === "over_request_rate_limit")
      return "Too many attempts right now. Please wait a few minutes and try again.";
    if (e.code === "user_already_exists" || m.includes("already registered")) return "An account with this email already exists.";
    if (e.code === "email_address_invalid" || e.code === "validation_failed") return "That email address doesn't look valid. Please check it and try again.";
    if (e.code === "signup_disabled") return "Registration is currently closed. Please contact " + SITE.email + ".";
    if (e.code === "weak_password") return "That password is too weak. Use at least 8 characters.";
    if (e.code === "email_not_confirmed") return "Please confirm your email address first (check your inbox).";
    if (e.code === "invalid_credentials") return "Incorrect email or password.";
    if (e.code === "42501" || m.includes("row-level security") || m.includes("not allowed") || m.includes("cannot be modified"))
      return "You are not allowed to do that.";
    return null;
  }
  const fail = (e, fallback) => { throw new Error(friendly(e) || fallback); };

  const mapProfile = p => ({
    id: p.id, name: p.name, email: p.email, phone: p.phone, role: p.role, company: p.company,
    status: p.status, notes: p.notes, created: p.created_at, lastLogin: p.last_login
  });
  const mapApp = a => ({
    id: a.id, userId: a.user_id, jobId: a.job_id, status: a.status, date: a.created_at,
    title: a.vacancies ? a.vacancies.title : "(removed vacancy)", location: a.vacancies ? a.vacancies.location : ""
  });
  const mapVacancy = v => ({
    id: v.id, title: v.title, company: v.company, location: v.location, type: v.type, category: v.category,
    salary: v.salary, summary: v.summary, requirements: v.requirements || [], posted: v.posted, active: v.active
  });

  let user = null;

  async function loadSession() {
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { user = null; localStorage.removeItem(HINT); return; }
      const { data: p } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
      if (!p || p.status === "suspended") {
        await sb.auth.signOut();
        user = null; localStorage.removeItem(HINT);
        return;
      }
      user = mapProfile(p);
      localStorage.setItem(HINT, JSON.stringify({ name: user.name, role: user.role }));
    } catch {
      user = null;
    }
  }

  window.Auth = {
    ready: loadSession(),
    hint() { try { return JSON.parse(localStorage.getItem(HINT)); } catch { return null; } },
    current() { return user; },

    async register({ name, email, phone, role, company, password }) {
      email = email.trim().toLowerCase();
      role = role === "employer" ? "employer" : "candidate"; // admin can never be requested from the client
      if (role === "employer" && !(company || "").trim()) throw new Error("Please enter your company name.");
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { name: name.trim(), phone: (phone || "").trim(), role, company: (company || "").trim() } }
      });
      if (error) fail(error, "Could not create your account. Please try again.");
      // With email confirmation on, an existing address returns a user with no identities.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0)
        throw new Error("An account with this email already exists.");
      if (!data.session) return { needsConfirmation: true };
      await loadSession();
      return { needsConfirmation: false };
    },

    async login(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) fail(error, "Could not log in. Please try again.");
      await loadSession();
      if (!user) throw new Error("This account has been suspended. Please contact " + SITE.email + ".");
      return user;
    },

    async changePassword(newPassword) {
      const { error } = await sb.auth.updateUser({ password: newPassword });
      if (error) {
        if (error.code === "same_password") throw new Error("Your new password must be different from the current one.");
        fail(error, "Could not change your password. Please log in again and retry.");
      }
    },

    async logout() {
      await sb.auth.signOut();
      user = null;
      localStorage.removeItem(HINT);
    },

    async applications(userId) {
      const { data, error } = await sb.from("applications")
        .select("id, user_id, job_id, status, created_at, vacancies(title, location)")
        .eq("user_id", userId).order("created_at", { ascending: false });
      if (error) fail(error, "Could not load your applications.");
      return data.map(mapApp);
    },

    // Returns false when the user already applied.
    async apply(job) {
      const { error } = await sb.from("applications").insert({ job_id: job.id });
      if (error) {
        if (error.code === "23505") return false;
        fail(error, "Could not submit your application.");
      }
      return true;
    },

    async addMessage(m) {
      const { error } = await sb.from("messages").insert({
        name: m.name, email: m.email, phone: m.phone || "", topic: m.topic, message: m.message,
        user_id: user ? user.id : null
      });
      if (error) fail(error, "Could not send your message. Please try again.");
    },

    /* ----- Admin API (UI convenience only; the database enforces admin-only access) ----- */
    isAdmin() { return !!user && user.role === "admin"; },

    async allUsers() {
      const { data, error } = await sb.from("profiles").select("*").order("created_at", { ascending: false });
      if (error) fail(error, "Could not load users.");
      return data.map(mapProfile);
    },
    async allApplications() {
      const { data, error } = await sb.from("applications")
        .select("id, user_id, job_id, status, created_at, vacancies(title, location)")
        .order("created_at", { ascending: false });
      if (error) fail(error, "Could not load applications.");
      return data.map(mapApp);
    },
    async allMessages() {
      const { data, error } = await sb.from("messages").select("*").order("created_at", { ascending: true });
      if (error) fail(error, "Could not load messages.");
      return data.map(m => ({ id: m.id, name: m.name, email: m.email, phone: m.phone, topic: m.topic, message: m.message, date: m.created_at }));
    },
    // Returned oldest-first. Latest 2000 entries (older ones stay in the database).
    async allLog() {
      const { data, error } = await sb.from("activity_log").select("*").order("created_at", { ascending: false }).limit(2000);
      if (error) fail(error, "Could not load the activity log.");
      return data.reverse().map(l => ({
        id: l.id, ts: l.created_at, action: l.action, details: l.details,
        actorId: l.actor_id, actorName: l.actor_name, actorEmail: l.actor_email, actorRole: l.actor_role
      }));
    },

    async _updateProfile(id, patch) {
      const { data, error } = await sb.from("profiles").update(patch).eq("id", id).select("id");
      if (error) fail(error, "That change could not be saved.");
      if (!data || !data.length) throw new Error("You are not allowed to do that.");
    },
    setStatus(id, status) { return this._updateProfile(id, { status }); },
    setNotes(id, notes) { return this._updateProfile(id, { notes }); },

    async removeUser(id) {
      const { data, error } = await sb.functions.invoke("admin-delete-user", { body: { userId: id } });
      if (error) {
        let msg = null;
        try { msg = (await error.context.json()).error; } catch { /* ignore */ }
        throw new Error(msg || "Could not delete the account.");
      }
      if (!data || !data.ok) throw new Error("Could not delete the account.");
    },

    async setAppStatus(appId, status) {
      const { data, error } = await sb.from("applications").update({ status }).eq("id", appId).select("id");
      if (error) fail(error, "Could not update the application.");
      if (!data || !data.length) throw new Error("You are not allowed to do that.");
    },

    async logExport(what) {
      if (!user) return;
      await sb.from("activity_log").insert({
        actor_id: user.id, actor_name: user.name, actor_email: user.email, actor_role: "admin",
        action: "export", details: "Exported " + what + " as CSV"
      });
    }
  };

  window.Vacancies = {
    async list() {
      const { data, error } = await sb.from("vacancies").select("*").eq("active", true).order("posted", { ascending: false });
      if (error) fail(error, "Could not load vacancies.");
      return data.map(mapVacancy);
    },
    async all() { // admin: includes closed vacancies
      const { data, error } = await sb.from("vacancies").select("*").order("posted", { ascending: false });
      if (error) fail(error, "Could not load vacancies.");
      return data.map(mapVacancy);
    },
    _fields(v) {
      return {
        title: v.title, company: v.company || "Confidential Client", location: v.location, type: v.type,
        category: v.category, salary: v.salary || "", summary: v.summary || "", requirements: v.requirements || []
      };
    },
    async create(v) {
      const { error } = await sb.from("vacancies").insert(this._fields(v));
      if (error) fail(error, "Could not create the vacancy. Check all required fields.");
    },
    async update(id, v) {
      const { data, error } = await sb.from("vacancies").update(this._fields(v)).eq("id", id).select("id");
      if (error) fail(error, "Could not save the vacancy.");
      if (!data || !data.length) throw new Error("You are not allowed to do that.");
    },
    async setActive(id, active) {
      const { data, error } = await sb.from("vacancies").update({ active }).eq("id", id).select("id");
      if (error) fail(error, "Could not update the vacancy.");
      if (!data || !data.length) throw new Error("You are not allowed to do that.");
    },
    async remove(id) {
      const { data, error } = await sb.from("vacancies").delete().eq("id", id).select("id");
      if (error) {
        if (error.code === "23503") throw new Error("This vacancy has applications, so it can't be deleted. Close it instead.");
        fail(error, "Could not delete the vacancy.");
      }
      if (!data || !data.length) throw new Error("You are not allowed to do that.");
    }
  };

  /* Admin-only: companies with open jobs found through the Adzuna API.
     Tables are private (RLS); the search itself runs in the admin-sync-leads edge function
     so the API keys never reach the browser. */
  window.Leads = {
    async list() {
      const { data, error } = await sb.from("lead_companies")
        .select("id,name,status,notes,first_seen,last_seen,lead_jobs(id,title,location,category,contract_type,salary_min,salary_max,url,posted_at,last_seen)")
        .order("last_seen", { ascending: false }).limit(2000);
      if (error) fail(error, "Could not load leads.");
      return data.map(c => ({
        id: c.id, name: c.name, status: c.status, notes: c.notes || "", firstSeen: c.first_seen, lastSeen: c.last_seen,
        jobs: (c.lead_jobs || []).map(j => ({
          id: j.id, title: j.title, location: j.location, category: j.category, type: j.contract_type,
          salaryMin: j.salary_min, salaryMax: j.salary_max, url: j.url, posted: j.posted_at, lastSeen: j.last_seen
        })).sort((a, b) => String(b.posted || "").localeCompare(String(a.posted || "")))
      }));
    },
    async sync({ what, where, pages }) {
      const { data, error } = await sb.functions.invoke("admin-sync-leads", { body: { what, where, pages } });
      if (error) {
        let msg = null;
        try { msg = (await error.context.json()).error; } catch { /* ignore */ }
        throw new Error(msg || "The search could not be completed.");
      }
      if (!data || !data.ok) throw new Error("The search could not be completed.");
      return data;
    },
    async _update(id, patch) {
      const { data, error } = await sb.from("lead_companies").update(patch).eq("id", id).select("id");
      if (error) fail(error, "That change could not be saved.");
      if (!data || !data.length) throw new Error("You are not allowed to do that.");
    },
    setStatus(id, status) { return this._update(id, { status }); },
    setNotes(id, notes) { return this._update(id, { notes }); },
    async remove(id) {
      const { data, error } = await sb.from("lead_companies").delete().eq("id", id).select("id");
      if (error) fail(error, "Could not remove the lead.");
      if (!data || !data.length) throw new Error("You are not allowed to do that.");
    }
  };
})();
