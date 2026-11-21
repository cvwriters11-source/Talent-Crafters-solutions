// Deployed to Supabase project lexcymhobrlvzohmlajw (verify_jwt = true).
// Emails a newly posted vacancy to registered, approved candidates whose field of work matches its
// category (and who haven't switched alerts off). Only a verified, active admin can trigger it.
// The SMTP password lives in Supabase Vault and is read here with the service role; it is never
// sent to the browser.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SITE = "https://www.talentcrafters.co.za";
const SMTP_HOST = "mail.talentcrafters.co.za";
const SMTP_PORT = 465; // Supabase edge functions can't use 25/587
const SMTP_USER = "noreply@talentcrafters.co.za";
const FROM_NAME = "Talent Crafters HR";
const FROM_ADDRESS = "hr@talentcrafters.co.za";
const MAX_RECIPIENTS = 150; // stays within typical hosting hourly mail limits

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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

    // 2. Must be an active, verified admin
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: me } = await admin.from("profiles").select("role,status,name,email").eq("id", user.id).maybeSingle();
    if (!me || me.role !== "admin" || me.status !== "active") return json(403, { error: "Admin access required" });
    const { data: verified } = await caller.rpc("is_verified_admin");
    if (verified !== true) return json(403, { error: "Please log in again and enter your email code." });

    // 3. The vacancy
    const body = await req.json().catch(() => ({}));
    const vacancyId = String(body.vacancyId ?? "");
    if (!UUID.test(vacancyId)) return json(400, { error: "Invalid vacancy id" });

    const { data: job } = await admin.from("vacancies")
      .select("id,title,company,location,type,category,salary,summary,active,alerts_sent_at")
      .eq("id", vacancyId).maybeSingle();
    if (!job) return json(404, { error: "Vacancy not found" });
    if (!job.active) return json(400, { error: "That vacancy is closed, so no alerts were sent." });
    if (job.alerts_sent_at) return json(409, { error: "Alerts for this vacancy were already sent." });

    // Claim it first so two clicks can never send twice
    const { data: claimed } = await admin.from("vacancies")
      .update({ alerts_sent_at: new Date().toISOString() })
      .eq("id", vacancyId).is("alerts_sent_at", null).select("id");
    if (!claimed || !claimed.length) return json(409, { error: "Alerts for this vacancy were already sent." });
    const release = () => admin.from("vacancies").update({ alerts_sent_at: null, alerts_count: null }).eq("id", vacancyId);

    // 4. Who gets it: approved, active candidates in this field with alerts on
    const { data: people } = await admin.from("profiles")
      .select("name,email,alert_token")
      .eq("role", "candidate").eq("status", "active").eq("approval", "approved").eq("job_alerts", true)
      .contains("fields", [job.category])
      .limit(MAX_RECIPIENTS);
    const list = people ?? [];
    if (!list.length) {
      await admin.from("vacancies").update({ alerts_count: 0 }).eq("id", vacancyId);
      return json(200, { ok: true, sent: 0, failed: 0, matched: 0 });
    }

    // 5. Send (one personalised email each, with its own unsubscribe link)
    const { data: pw } = await admin.rpc("get_smtp_password");
    if (!pw) { await release(); return json(500, { error: "Email sending is not configured." }); }

    const client = new SMTPClient({
      connection: { hostname: SMTP_HOST, port: SMTP_PORT, tls: true, auth: { username: SMTP_USER, password: pw as string } },
    });

    let sent = 0, failed = 0, firstError = "";
    let useFrom = FROM_ADDRESS;
    for (const p of list) {
      const unsub = `${SITE}/unsubscribe.html?t=${p.alert_token}`;
      const first = esc((p.name || "").trim().split(/\s+/)[0] || "there");
      const meta = [job.company, job.location, job.type, job.salary].filter(Boolean).map(esc).join(" &middot; ");
      const html = `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<div style="max-width:560px;margin:0 auto;padding:24px">
  <div style="background:#0b1f4e;color:#fff;padding:18px 24px;border-radius:12px 12px 0 0;border-bottom:4px solid #c9922a">
    <strong style="font-size:18px">Talent Crafters</strong>
  </div>
  <div style="background:#fff;padding:28px 24px;border-radius:0 0 12px 12px">
    <p style="margin:0 0 14px">Hi ${first},</p>
    <p style="margin:0 0 18px">A new job has just been posted on our website in <strong>${esc(job.category)}</strong>, your field of work:</p>
    <div style="border:1px solid #e2e8f0;border-radius:10px;padding:16px 18px;margin-bottom:20px">
      <div style="font-size:19px;font-weight:bold;color:#0b1f4e;margin-bottom:6px">${esc(job.title)}</div>
      <div style="color:#64748b;font-size:14px;margin-bottom:${job.summary ? "10px" : "0"}">${meta}</div>
      ${job.summary ? `<div style="font-size:14px;line-height:1.5">${esc(job.summary)}</div>` : ""}
    </div>
    <p style="margin:0 0 22px"><a href="${SITE}/vacancies.html" style="background:#0b1f4e;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold;display:inline-block">View the job and apply</a></p>
    <p style="margin:0;color:#64748b;font-size:13px">Make sure your CV is uploaded on your account page so you can apply quickly.</p>
  </div>
  <p style="color:#94a3b8;font-size:12px;line-height:1.5;text-align:center;margin:16px 8px 0">
    You are receiving this because you registered as a candidate on talentcrafters.co.za and chose ${esc(job.category)} as a field of work.<br>
    <a href="${unsub}" style="color:#94a3b8">Unsubscribe from job alerts</a> &middot; or change your fields on your <a href="${SITE}/account.html" style="color:#94a3b8">account page</a>.
  </p>
</div></body></html>`;
      const text = `Hi ${(p.name || "").trim().split(/\s+/)[0] || "there"},\n\nA new job has just been posted on our website in ${job.category}, your field of work:\n\n${job.title}\n${[job.company, job.location, job.type, job.salary].filter(Boolean).join(" | ")}\n${job.summary ? "\n" + job.summary + "\n" : ""}\nView the job and apply: ${SITE}/vacancies.html\n\nYou are receiving this because you registered as a candidate on talentcrafters.co.za and chose ${job.category} as a field of work.\nUnsubscribe from job alerts: ${unsub}\n`;
      const mail = (fromAddr: string) => ({
        from: `${FROM_NAME} <${fromAddr}>`,
        replyTo: `${FROM_NAME} <${FROM_ADDRESS}>`,
        to: p.email,
        subject: `New job: ${job.title} in ${job.location}`,
        content: text,
        html,
        headers: { "List-Unsubscribe": `<${unsub}>` },
      });
      try {
        try {
          await client.send(mail(useFrom));
        } catch (first) {
          // Some mail servers refuse a From address that isn't the logged-in mailbox. Fall back once to
          // sending as the authenticated mailbox (replies still go to hr@).
          if (useFrom === SMTP_USER) throw first;
          useFrom = SMTP_USER;
          await client.send(mail(useFrom));
        }
        sent++;
      } catch (e) {
        failed++;
        if (!firstError) firstError = String((e as Error).message ?? e).slice(0, 300);
      }
    }
    try { await client.close(); } catch { /* ignore */ }

    if (sent === 0) {
      await release();
      return json(502, { error: "The emails could not be sent: " + (firstError || "unknown error") });
    }

    await admin.from("vacancies").update({ alerts_count: sent }).eq("id", vacancyId);
    await admin.from("activity_log").insert({
      actor_id: user.id, actor_name: me.name, actor_email: me.email, actor_role: "admin",
      action: "job_alerts_sent",
      details: `Emailed ${sent} candidate${sent === 1 ? "" : "s"} about ${job.title} (${job.category})${failed ? `, ${failed} failed` : ""}`,
    });
    return json(200, { ok: true, sent, failed, matched: list.length, from: useFrom });
  } catch (_e) {
    return json(500, { error: "Unexpected error" });
  }
});
