// Deployed to Supabase project lexcymhobrlvzohmlajw (verify_jwt = true).
// Lets an active admin fully delete a candidate/company login. Needs the service
// role key, which must never be shipped in the website, hence a server function.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;

    // 1. Who is calling? (validated against Supabase Auth, not trusted from the body)
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json(401, { error: "Not signed in" });

    // 2. Must be an active admin (checked with the service role, ignoring client claims)
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: me } = await admin.from("profiles").select("role,status,name,email").eq("id", user.id).maybeSingle();
    if (!me || me.role !== "admin" || me.status !== "active") return json(403, { error: "Admin access required" });
    // The session must also have passed the email login code (when that requirement is switched on).
    const { data: verified } = await caller.rpc("is_verified_admin");
    if (verified !== true) return json(403, { error: "Please log in again and enter your email code." });

    // 3. Validate the target
    const body = await req.json().catch(() => ({}));
    const userId = String(body.userId ?? "");
    if (!UUID.test(userId)) return json(400, { error: "Invalid user id" });
    if (userId === user.id) return json(400, { error: "You cannot delete your own account" });

    const { data: target } = await admin.from("profiles").select("id,role,name,email,company").eq("id", userId).maybeSingle();
    if (!target) return json(404, { error: "User not found" });
    if (target.role === "admin") return json(403, { error: "Admin accounts cannot be deleted here" });

    // 4. Erase the person's uploaded documents (CV), then delete the login (profile + applications
    //    cascade), then record it in the audit log
    const docs = admin.storage.from("candidate-documents");
    const { data: files } = await docs.list(userId, { limit: 100 });
    if (files && files.length) await docs.remove(files.map((f) => `${userId}/${f.name}`));

    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) return json(500, { error: "Could not delete the account" });

    await admin.from("activity_log").insert({
      actor_id: user.id,
      actor_name: me.name,
      actor_email: me.email,
      actor_role: "admin",
      action: "user_deleted",
      details: `Deleted ${target.role} ${target.company || target.name} (${target.email}) and their applications`,
    });

    return json(200, { ok: true });
  } catch (_e) {
    return json(500, { error: "Unexpected error" });
  }
});
