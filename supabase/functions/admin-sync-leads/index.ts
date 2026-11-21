// Deployed to Supabase project lexcymhobrlvzohmlajw (verify_jwt = true).
// Lets an active admin pull companies with currently open jobs from the Adzuna API
// (South Africa) into the private lead_companies / lead_jobs tables.
// Secrets required (Supabase Dashboard > Edge Functions > Secrets):
//   ADZUNA_APP_ID, ADZUNA_APP_KEY
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const DEFAULT_TERMS = ["accountant", "administrator", "sales", "engineer", "developer", "manager"];
const MAX_CALLS = 12; // stay well inside Adzuna's free-tier rate limits

const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

type AdzunaJob = {
  id?: string | number;
  title?: string;
  created?: string;
  redirect_url?: string;
  contract_type?: string;
  salary_min?: number;
  salary_max?: number;
  company?: { display_name?: string };
  location?: { display_name?: string };
  category?: { label?: string };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;

    // 1. Who is calling?
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json(401, { error: "Not signed in" });

    // 2. Must be an active admin
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: me } = await admin.from("profiles").select("role,status,name,email").eq("id", user.id).maybeSingle();
    if (!me || me.role !== "admin" || me.status !== "active") return json(403, { error: "Admin access required" });
    // The session must also have passed the email login code (when that requirement is switched on).
    const { data: verified } = await caller.rpc("is_verified_admin");
    if (verified !== true) return json(403, { error: "Please log in again and enter your email code." });

    // 3. API keys must be configured
    const appId = Deno.env.get("ADZUNA_APP_ID");
    const appKey = Deno.env.get("ADZUNA_APP_KEY");
    if (!appId || !appKey) {
      return json(503, { error: "The Adzuna API keys are not set up yet. Add ADZUNA_APP_ID and ADZUNA_APP_KEY as secrets for the admin-sync-leads function in Supabase." });
    }

    // 4. Validate input
    const body = await req.json().catch(() => ({}));
    const what = clean(body.what, 60);
    const where = clean(body.where, 60);
    const pages = Math.min(2, Math.max(1, Math.trunc(Number(body.pages) || 1)));
    const terms = what ? [what] : DEFAULT_TERMS;
    const calls: Array<{ term: string; page: number }> = [];
    for (const term of terms) for (let p = 1; p <= pages; p++) calls.push({ term, page: p });
    calls.length = Math.min(calls.length, MAX_CALLS);

    // 5. Fetch (sequential, to be polite to the API)
    const found = new Map<string, { name: string; job: AdzunaJob }[]>();
    let totalJobs = 0;
    for (const c of calls) {
      const q = new URLSearchParams({
        app_id: appId,
        app_key: appKey,
        results_per_page: "50",
        what: c.term,
        sort_by: "date",
        max_days_old: "30",
        "content-type": "application/json",
      });
      if (where) q.set("where", where);
      const res = await fetch(`https://api.adzuna.com/v1/api/jobs/za/search/${c.page}?${q}`);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) return json(502, { error: "Adzuna rejected the API keys. Check ADZUNA_APP_ID and ADZUNA_APP_KEY." });
        if (res.status === 429) return json(429, { error: "Adzuna rate limit reached. Please try again in a few minutes." });
        return json(502, { error: `Adzuna returned an error (${res.status})` });
      }
      const data = await res.json().catch(() => ({}));
      for (const job of (data.results ?? []) as AdzunaJob[]) {
        const name = clean(job.company?.display_name, 200);
        if (!name || /^(confidential|private advertiser|anonymous)/i.test(name)) continue;
        if (!job.id || !job.title || !/^https?:\/\//.test(job.redirect_url ?? "")) continue;
        const key = name.toLowerCase();
        if (!found.has(key)) found.set(key, []);
        found.get(key)!.push({ name, job });
        totalJobs++;
      }
    }

    if (found.size === 0) return json(200, { ok: true, companies: 0, newCompanies: 0, jobs: 0 });

    // 6. Save companies (existing ones keep their status and notes)
    const keys = [...found.keys()];
    const { data: existing } = await admin.from("lead_companies").select("id,name_key").in("name_key", keys);
    const have = new Set((existing ?? []).map((r: { name_key: string }) => r.name_key));
    const fresh = keys.filter((k) => !have.has(k)).map((k) => ({ name: found.get(k)![0].name }));
    if (fresh.length) {
      const { error } = await admin.from("lead_companies").insert(fresh);
      if (error) return json(500, { error: "Could not save companies" });
    }
    const { data: all } = await admin.from("lead_companies").select("id,name_key").in("name_key", keys);
    const idByKey = new Map((all ?? []).map((r: { id: string; name_key: string }) => [r.name_key, r.id]));
    const now = new Date().toISOString();
    await admin.from("lead_companies").update({ last_seen: now }).in("name_key", keys);

    // 7. Save jobs (deduplicated by Adzuna id)
    const rows = new Map<string, Record<string, unknown>>();
    for (const [key, list] of found) {
      const company_id = idByKey.get(key);
      if (!company_id) continue;
      for (const { job } of list) {
        const external_id = String(job.id);
        rows.set(external_id, {
          company_id,
          source: "adzuna",
          external_id,
          title: clean(job.title, 300),
          location: clean(job.location?.display_name, 200),
          category: clean(job.category?.label, 120),
          contract_type: clean(job.contract_type, 60),
          salary_min: typeof job.salary_min === "number" ? job.salary_min : null,
          salary_max: typeof job.salary_max === "number" ? job.salary_max : null,
          url: job.redirect_url,
          posted_at: job.created ?? null,
          last_seen: now,
        });
      }
    }
    const { error: jobErr } = await admin.from("lead_jobs").upsert([...rows.values()], { onConflict: "source,external_id" });
    if (jobErr) return json(500, { error: "Could not save jobs" });

    // 8. Audit log
    await admin.from("activity_log").insert({
      actor_id: user.id,
      actor_name: me.name,
      actor_email: me.email,
      actor_role: "admin",
      action: "leads_sync",
      details: `Searched Adzuna${what ? ` for "${what}"` : ""}${where ? ` in ${where}` : ""}: ${rows.size} jobs from ${keys.length} companies (${fresh.length} new)`,
    });

    return json(200, { ok: true, companies: keys.length, newCompanies: fresh.length, jobs: rows.size });
  } catch (_e) {
    return json(500, { error: "Unexpected error" });
  }
});
