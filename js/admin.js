/* Admin dashboard: candidates, companies, applications, vacancies, messages, activity log.
 * All data comes from Supabase. Access is enforced by the database (RLS + triggers):
 * if someone bypasses this page they still get nothing. The activity log is written
 * by database triggers, so entries can't be forged or edited from the browser.
 */
document.addEventListener("DOMContentLoaded", async () => {
  const e = escapeHTML;
  const root = document.getElementById("admin-root");
  root.innerHTML = `<p class="empty">Loading...</p>`;

  await Auth.ready;
  if (!Auth.isAdmin()) {
    root.innerHTML = `
      <div class="card center" style="max-width:520px;margin:24px auto">
        <h3>Administrators only</h3>
        <p style="margin:8px 0 18px">Please log in with an admin account to view this page.</p>
        <a class="btn btn-primary" href="account.html?next=admin.html">Login</a>
      </div>`;
    return;
  }

  const APP_STATUSES = ["New", "Reviewed", "Shortlisted", "Interviewed", "Offered", "Placed", "Rejected"];
  const JOB_TYPES = ["Full-time", "Part-time", "Contract", "Internship", "Temporary"];
  const ACTIONS = {
    register: ["Registered", "info"], login: ["Login", "ok"], apply: ["Applied for job", "info"],
    contact_message: ["Contact message", ""], user_suspended: ["Account suspended", "bad"],
    user_reactivated: ["Account reactivated", "ok"], user_deleted: ["Account deleted", "bad"],
    user_approved: ["Account approved", "ok"], user_rejected: ["Account rejected", "bad"], user_approval_reset: ["Approval revoked", "warn"],
    cv_uploaded: ["CV uploaded", "info"], cv_removed: ["CV removed", "warn"], job_alerts_sent: ["Job alerts sent", "info"],
    notes_updated: ["Notes updated", "warn"], application_status: ["Application status", "warn"],
    vacancy_created: ["Vacancy created", "info"], vacancy_updated: ["Vacancy updated", "warn"],
    vacancy_deleted: ["Vacancy deleted", "bad"], export: ["Data export", "warn"],
    leads_sync: ["Leads search", "info"], lead_status: ["Lead status", "warn"],
    lead_notes: ["Lead notes", "warn"], lead_deleted: ["Lead removed", "bad"],
    popup_updated: ["Pop-up updated", "info"]
  };
  const LEAD_STATUSES = ["New", "Researching", "Contacted", "Replied", "Not interested", "Do not contact"];
  const fmt = iso => iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "-";
  // Compact two-line date for table cells: date on top, time underneath.
  const fmtCell = iso => iso
    ? `<span class="date">${e(new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }))}<small>${e(new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</small></span>`
    : "-";
  const actionBadge = a => { const [l, c] = ACTIONS[a] || [a, ""]; return `<span class="badge ${c}">${e(l)}</span>`; };
  const statusBadge = u => u.status === "suspended" ? `<span class="badge bad">Suspended</span>` : `<span class="badge ok">Active</span>`;
  const approvalBadge = u => ({
    pending: `<span class="badge warn">Pending approval</span>`,
    rejected: `<span class="badge bad">Rejected</span>`
  })[u.approval] || `<span class="badge ok">Approved</span>`;
  const empty = t => `<p class="empty">${t}</p>`;

  /* ---------- Data (loaded once per render, then used synchronously) ---------- */
  let data = { users: [], apps: [], msgs: [], log: [], vacancies: [], leads: [] };
  async function load() {
    const [users, apps, msgs, log, vacancies, leads] = await Promise.all([
      Auth.allUsers(), Auth.allApplications(), Auth.allMessages(), Auth.allLog(), Vacancies.all(),
      Leads.list().catch(() => [])
    ]);
    data = { users, apps, msgs, log, vacancies, leads };
  }
  const fail = err => toast(err.message || "Something went wrong.");

  /* ---------- CSV export (guards against spreadsheet formula injection) ---------- */
  function downloadCSV(name, header, rows) {
    const cell = v => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const csv = [header, ...rows].map(r => r.map(cell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = name + "-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    Auth.logExport(name).catch(() => {});
    toast("Export downloaded");
  }

  /* ---------- Modal ---------- */
  function openModal(html) {
    const back = document.createElement("div");
    back.className = "modal-backdrop open";
    back.innerHTML = `<div class="modal wide" role="dialog" aria-modal="true"><button class="modal-close" aria-label="Close">&times;</button>${html}</div>`;
    document.body.appendChild(back);
    const close = () => { back.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = ev => { if (ev.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    back.addEventListener("click", ev => { if (ev.target === back) close(); });
    back.querySelector(".modal-close").addEventListener("click", close);
    return { el: back, close };
  }

  /* ---------- Tabs ---------- */
  const state = { tab: "overview" };
  const TABS = [
    ["overview", "Overview"], ["candidates", "Candidates"], ["companies", "Companies"], ["applications", "Applications"],
    ["vacancies", "Vacancies"], ["leads", "Leads"], ["messages", "Messages"], ["popup", "Pop-up"], ["log", "Activity log"]
  ];

  async function render(reload = true) {
    if (reload) {
      try { await load(); } catch (err) { root.innerHTML = empty(e(err.message)); return; }
    }
    const counts = {
      candidates: data.users.filter(u => u.role === "candidate").length,
      companies: data.users.filter(u => u.role === "employer").length,
      applications: data.apps.length,
      vacancies: data.vacancies.length,
      leads: data.leads.length,
      messages: data.msgs.length
    };
    root.innerHTML = `
      <div class="tabs wrap" role="tablist">
        ${TABS.map(([id, label]) => `<button class="tab ${state.tab === id ? "active" : ""}" data-tab="${id}" role="tab">${label}${counts[id] !== undefined ? `<span class="count">${counts[id]}</span>` : ""}</button>`).join("")}
      </div>
      <div id="tab-body"></div>`;
    root.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => { state.tab = t.dataset.tab; render(false); }));
    ({ overview, candidates: () => usersTab("candidate"), companies: () => usersTab("employer"), applications, vacancies, leads: leadsTab, messages, popup: popupTab, log: activityLog })[state.tab]();
  }

  /* ---------- Welcome / review pop-up ---------- */
  async function popupTab() {
    const body = document.getElementById("tab-body");
    body.innerHTML = empty("Loading pop-up settings...");
    let p;
    try { p = await Popup.get(); }
    catch (err) { body.innerHTML = empty(e(err.message)); return; }
    if (!p) { body.innerHTML = empty("The pop-up is not set up yet."); return; }

    body.innerHTML = `
      <div class="card" style="max-width:640px">
        <h3 style="color:var(--navy);margin-bottom:6px">Welcome / review pop-up</h3>
        <p class="hint" style="margin-bottom:16px">Shown to visitors on the public pages (Home, About, Vacancies, Contact). Not shown on Admin, Login or Unsubscribe. Saving always makes it appear again for people who already closed it.</p>
        <div id="pop-msg" class="form-msg" role="alert"></div>
        <form id="pop-form" novalidate>
          <label class="fchip fchip-toggle" style="margin-bottom:16px"><input type="checkbox" id="pop-on" ${p.enabled ? "checked" : ""}><span>Show this pop-up on the website</span></label>
          <div class="field"><label for="pop-title">Greeting / title</label><input id="pop-title" maxlength="120" value="${e(p.title)}" required></div>
          <div class="field"><label for="pop-msg-text">Message</label><textarea id="pop-msg-text" maxlength="600" style="min-height:90px" required>${e(p.message)}</textarea></div>
          <div class="row">
            <div class="field"><label for="pop-btn">Button text</label><input id="pop-btn" maxlength="40" value="${e(p.buttonText)}" required></div>
            <div class="field"><label for="pop-link">Button link (must start with https://)</label><input id="pop-link" type="url" maxlength="300" value="${e(p.link)}" placeholder="https://g.page/r/..." required></div>
          </div>
          <div class="row">
            <div class="field"><label for="pop-delay">Show after (seconds)</label><input id="pop-delay" type="number" min="0" max="120" value="${e(p.delay)}"></div>
            <div class="field"><label for="pop-repeat">Ask again after (days)</label>
              <input id="pop-repeat" type="number" min="0" max="365" value="${e(p.repeatDays)}">
              <p class="hint">0 = once per visit. Someone who clicks the review button is not asked again for a year.</p>
            </div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
            <button class="btn btn-primary" type="submit">Save pop-up</button>
            <button class="btn btn-outline-dark" type="button" id="pop-preview">Preview</button>
          </div>
        </form>
      </div>`;

    const $ = id => body.querySelector("#" + id);
    const say = (t, c) => { const m = $("pop-msg"); m.textContent = t; m.className = "form-msg show " + c; };
    const read = () => ({
      enabled: $("pop-on").checked,
      title: $("pop-title").value.trim(),
      message: $("pop-msg-text").value.trim(),
      buttonText: $("pop-btn").value.trim() || "Leave us a review",
      link: $("pop-link").value.trim(),
      delay: Math.max(0, Math.min(120, Number($("pop-delay").value) || 0)),
      repeatDays: Math.max(0, Math.min(365, Number($("pop-repeat").value) || 0))
    });
    $("pop-preview").addEventListener("click", () => {
      const v = read();
      if (!v.title) return say("Please enter a greeting first.", "error");
      showSitePopup(v, { preview: true });
    });
    $("pop-form").addEventListener("submit", async ev => {
      ev.preventDefault();
      const v = read();
      if (!v.title || !v.message) return say("Title and message are required.", "error");
      if (!/^https:\/\/\S+$/i.test(v.link)) return say("The button link must start with https://", "error");
      const btn = ev.submitter; btn.disabled = true;
      try { await Popup.save(v); say(v.enabled ? "Saved. The pop-up is switched on." : "Saved. The pop-up is switched off.", "success"); }
      catch (err) { say(err.message, "error"); }
      finally { btn.disabled = false; }
    });
  }

  /* ---------- Overview ---------- */
  function overview() {
    const { users, apps, msgs, log, vacancies } = data;
    const today = new Date().toDateString();
    const cards = [
      ["Awaiting approval", users.filter(u => u.role !== "admin" && u.approval === "pending").length],
      ["Candidates", users.filter(u => u.role === "candidate").length],
      ["Companies", users.filter(u => u.role === "employer").length],
      ["Applications", apps.length],
      ["New applications", apps.filter(a => a.status === "New").length],
      ["Open vacancies", vacancies.filter(v => v.active).length],
      ["Suspended accounts", users.filter(u => u.status === "suspended").length],
      ["Messages", msgs.length],
      ["Actions today", log.filter(l => new Date(l.ts).toDateString() === today).length]
    ];
    const recent = [...log].reverse().slice(0, 10);
    document.getElementById("tab-body").innerHTML = `
      <div class="admin-stats">${cards.map(([l, n]) => `<div class="stat-card"><strong>${n}</strong><span>${l}</span></div>`).join("")}</div>
      <h3 style="color:var(--navy);margin-bottom:10px">Recent activity</h3>
      <div class="table-wrap">${recent.length ? logTable(recent) : empty("No activity recorded yet.")}</div>`;
  }

  /* ---------- Candidates / Companies ---------- */
  function usersTab(role) {
    const isCo = role === "employer";
    const body = document.getElementById("tab-body");
    body.innerHTML = `
      <div class="toolbar">
        <input type="search" id="q" placeholder="Search ${isCo ? "companies" : "candidates"}..." aria-label="Search">
        <select id="ap" aria-label="Approval"><option value="">All approvals</option><option value="pending">Pending approval</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select>
        <select id="st" aria-label="Status"><option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option></select>
        <span class="spacer"></span>
        <button class="btn btn-outline-dark btn-sm" id="export">Export CSV</button>
      </div>
      <div class="table-wrap" id="tbl"></div>`;

    const filtered = () => {
      const q = body.querySelector("#q").value.trim().toLowerCase(), st = body.querySelector("#st").value, ap = body.querySelector("#ap").value;
      return data.users.filter(u => u.role === role
        && (!st || u.status === st)
        && (!ap || u.approval === ap)
        && (!q || [u.name, u.email, u.phone, u.company].join(" ").toLowerCase().includes(q)));
    };
    const paint = () => {
      const list = filtered();
      body.querySelector("#tbl").innerHTML = list.length ? `
        <table class="data"><thead><tr>
          ${isCo ? "<th>Company</th><th>Contact person</th>" : "<th>Name</th>"}
          <th>Email</th><th>Phone</th><th>Registered</th><th>Last login</th>${isCo ? "" : "<th>Applications</th>"}<th>Approval</th><th>Status</th><th></th>
        </tr></thead><tbody>
        ${list.map(u => `<tr>
          ${isCo ? `<td><strong>${e(u.company)}</strong></td><td>${e(u.name)}</td>` : `<td><strong>${e(u.name)}</strong></td>`}
          <td>${e(u.email)}</td><td>${e(u.phone || "-")}</td><td>${fmtCell(u.created)}</td><td>${fmtCell(u.lastLogin)}</td>
          ${isCo ? "" : `<td>${data.apps.filter(a => a.userId === u.id).length}</td>`}
          <td>${approvalBadge(u)}</td><td>${statusBadge(u)}</td>
          <td class="actions"><button class="btn ${u.approval === "pending" ? "btn-accent" : "btn-primary"} btn-sm" data-view="${e(u.id)}">${u.approval === "pending" ? "Review" : "Manage"}</button>
            <button class="btn btn-danger btn-sm" data-del="${e(u.id)}" aria-label="Delete ${e(isCo ? u.company : u.name)}">Delete</button></td>
        </tr>`).join("")}
        </tbody></table>` : empty(`No ${isCo ? "companies" : "candidates"} found.`);
    };
    body.querySelector("#q").addEventListener("input", paint);
    body.querySelector("#st").addEventListener("input", paint);
    body.querySelector("#ap").addEventListener("input", paint);
    body.querySelector("#tbl").addEventListener("click", async ev => {
      const b = ev.target.closest("[data-view]");
      if (b) return openUser(b.dataset.view);
      const d = ev.target.closest("[data-del]");
      if (!d) return;
      const u = data.users.find(x => x.id === d.dataset.del);
      if (!u || !confirm("Permanently delete " + (isCo ? u.company : u.name) + " (" + u.email + ")? This removes their login, CV and applications and cannot be undone. The activity log keeps a record.")) return;
      d.disabled = true;
      try { await Auth.removeUser(u.id); await render(); toast("Account deleted"); } catch (err) { d.disabled = false; fail(err); }
    });
    body.querySelector("#export").addEventListener("click", () =>
      downloadCSV(isCo ? "companies" : "candidates",
        [isCo ? "Company" : "Name", ...(isCo ? ["Contact person"] : []), "Email", "Phone", "Registered", "Last login", ...(isCo ? [] : ["Applications"]), "Approval", "Status", "Notes"],
        filtered().map(u => [isCo ? u.company : u.name, ...(isCo ? [u.name] : []), u.email, u.phone, u.created, u.lastLogin, ...(isCo ? [] : [data.apps.filter(a => a.userId === u.id).length]), u.approval, u.status, u.notes])));
    paint();
  }

  function openUser(id) {
    const u = data.users.find(x => x.id === id);
    if (!u) return;
    const isCo = u.role === "employer";
    const apps = data.apps.filter(a => a.userId === id);
    const history = data.log.filter(l => l.actorId === id || (l.details || "").includes(u.email)).reverse().slice(0, 60);
    const suspended = u.status === "suspended";

    const m = openModal(`
      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap"><span class="badge info">${isCo ? "Company" : "Candidate"}</span>${approvalBadge(u)}${statusBadge(u)}</div>
      <h2>${e(isCo ? u.company : u.name)}</h2>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 4px">
        ${u.approval !== "approved" ? `<button class="btn btn-primary btn-sm" id="approve">Approve account</button>` : `<button class="btn btn-outline-dark btn-sm" id="unapprove">Revoke approval</button>`}
        ${u.approval === "pending" ? `<button class="btn btn-accent btn-sm" id="reject">Reject</button>` : ""}
      </div>
      <dl class="detail-grid">
        ${isCo ? `<dt>Contact person</dt><dd>${e(u.name)}</dd>` : ""}
        <dt>Email</dt><dd>${e(u.email)}</dd>
        <dt>Phone</dt><dd>${e(u.phone || "-")}</dd>
        <dt>Registered</dt><dd>${fmt(u.created)}</dd>
        <dt>Last login</dt><dd>${fmt(u.lastLogin)}</dd>
      </dl>
      ${isCo ? "" : `
        <h4>CV</h4>
        ${u.cvPath
          ? `<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><strong>${e(u.cvName || "CV")}</strong><span class="muted small">Uploaded ${fmt(u.cvUpdated)}</span><button class="btn btn-primary btn-sm" id="open-cv">Open CV</button></div>`
          : `<p class="muted small">No CV uploaded yet.</p>`}
        <h4>Applications (${apps.length})</h4>
        ${apps.length ? `<ul class="timeline" style="margin-bottom:8px">${apps.map(a => `<li><strong>${e(a.title)}</strong> &middot; ${e(a.location)} &middot; ${fmt(a.date)} <span class="badge warn">${e(a.status)}</span>
          ${a.coverLetter ? `<details style="margin-top:6px"><summary style="cursor:pointer;color:var(--gold-dark);font-weight:600">Cover letter</summary><div class="cover-letter">${e(a.coverLetter)}</div></details>` : `<span class="muted small"> &middot; no cover letter</span>`}</li>`).join("")}</ul>` : `<p class="muted small">No applications yet.</p>`}`}
      <h4>Password</h4>
      <p class="muted small" style="margin-bottom:8px">Passwords are stored encrypted, so nobody (including admins) can view them. If this person is locked out, send them a reset link.</p>
      <button class="btn btn-outline-dark btn-sm" id="send-reset">Send password reset email</button>
      <h4>Admin notes</h4>
      <textarea id="notes" maxlength="4000" style="min-height:80px" placeholder="Internal notes (not visible to the user)">${e(u.notes || "")}</textarea>
      <div style="margin:8px 0 4px"><button class="btn btn-outline-dark btn-sm" id="save-notes">Save notes</button></div>
      <h4>Activity (${history.length}${history.length === 60 ? "+" : ""})</h4>
      ${history.length ? `<ul class="timeline">${history.map(l => `<li>${actionBadge(l.action)} ${e(l.details)} <span class="muted">&middot; ${fmt(l.ts)}</span></li>`).join("")}</ul>` : `<p class="muted small">No activity recorded.</p>`}
      <div style="display:flex;gap:10px;margin-top:22px;flex-wrap:wrap">
        <button class="btn btn-sm ${suspended ? "btn-primary" : "btn-accent"}" id="toggle">${suspended ? "Reactivate account" : "Suspend account"}</button>
        <button class="btn btn-sm btn-danger" id="delete">Delete account</button>
      </div>`);

    const act = async (btn, fn, msg) => {
      btn.disabled = true;
      try { await fn(); m.close(); await render(); toast(msg); } catch (err) { btn.disabled = false; fail(err); }
    };
    const $ = s => m.el.querySelector(s);
    $("#save-notes").addEventListener("click", ev => act(ev.target, () => Auth.setNotes(id, $("#notes").value), "Notes saved"));
    const on = (sel, fn) => { const b = $(sel); if (b) b.addEventListener("click", fn); };
    on("#approve", ev => act(ev.target, () => Auth.setApproval(id, "approved"), "Account approved"));
    on("#unapprove", ev => {
      if (!confirm("Revoke approval? They will not be able to apply for vacancies until approved again.")) return;
      act(ev.target, () => Auth.setApproval(id, "pending"), "Approval revoked");
    });
    on("#reject", ev => {
      if (!confirm("Reject this account? They will see that it was not approved and cannot apply.")) return;
      act(ev.target, () => Auth.setApproval(id, "rejected"), "Account rejected");
    });
    on("#open-cv", async ev => {
      ev.target.disabled = true;
      try { window.open(await Auth.cvUrl(u.cvPath), "_blank", "noopener"); } catch (err) { fail(err); }
      finally { ev.target.disabled = false; }
    });
    on("#send-reset", async ev => {
      if (!confirm("Email a password reset link to " + u.email + "?")) return;
      ev.target.disabled = true;
      try { await Auth.requestPasswordReset(u.email); toast("Reset link sent to " + u.email); }
      catch (err) { fail(err); }
      finally { ev.target.disabled = false; }
    });
    $("#toggle").addEventListener("click", ev => {
      if (!suspended && !confirm("Suspend this account? They will be unable to apply or manage their account until reactivated.")) return;
      act(ev.target, () => Auth.setStatus(id, suspended ? "active" : "suspended"), suspended ? "Account reactivated" : "Account suspended");
    });
    $("#delete").addEventListener("click", ev => {
      if (!confirm("Permanently delete this account, login and applications? This cannot be undone (the activity log keeps a record).")) return;
      act(ev.target, () => Auth.removeUser(id), "Account deleted");
    });
  }

  /* ---------- Applications ---------- */
  function applications() {
    const body = document.getElementById("tab-body");
    body.innerHTML = `
      <div class="toolbar">
        <input type="search" id="q" placeholder="Search by candidate or job..." aria-label="Search">
        <select id="st" aria-label="Status"><option value="">All statuses</option>${APP_STATUSES.map(s => `<option>${s}</option>`).join("")}</select>
        <span class="spacer"></span>
        <button class="btn btn-outline-dark btn-sm" id="export">Export CSV</button>
      </div>
      <div class="table-wrap" id="tbl"></div>`;
    const rows = () => {
      const q = body.querySelector("#q").value.trim().toLowerCase(), st = body.querySelector("#st").value;
      return data.apps.map(a => ({ ...a, user: data.users.find(u => u.id === a.userId) }))
        .filter(a => (!st || a.status === st) && (!q || [a.title, a.location, a.user && a.user.name, a.user && a.user.email].join(" ").toLowerCase().includes(q)));
    };
    const paint = () => {
      const list = rows();
      body.querySelector("#tbl").innerHTML = list.length ? `
        <table class="data"><thead><tr><th>Candidate</th><th>Email</th><th>Vacancy</th><th>Location</th><th>Applied</th><th>CV / Letter</th><th>Status</th></tr></thead><tbody>
        ${list.map(a => `<tr>
          <td><strong>${e(a.user ? a.user.name : "Unknown")}</strong></td><td>${e(a.user ? a.user.email : "-")}</td>
          <td>${e(a.title)}</td><td>${e(a.location)}</td><td>${fmtCell(a.date)}</td>
          <td>${a.user ? `<button class="btn btn-outline-dark btn-sm" data-open="${e(a.user.id)}">${a.user.cvPath ? "CV" : "No CV"}${a.coverLetter ? " + letter" : ""}</button>` : "-"}</td>
          <td><select data-app="${e(a.id)}" aria-label="Application status">${APP_STATUSES.map(s => `<option ${s === a.status ? "selected" : ""}>${s}</option>`).join("")}</select></td>
        </tr>`).join("")}</tbody></table>` : empty("No applications found.");
    };
    body.querySelector("#q").addEventListener("input", paint);
    body.querySelector("#st").addEventListener("input", paint);
    body.querySelector("#tbl").addEventListener("click", ev => { const o = ev.target.closest("[data-open]"); if (o) openUser(o.dataset.open); });
    body.querySelector("#tbl").addEventListener("change", async ev => {
      const s = ev.target.closest("[data-app]");
      if (!s) return;
      s.disabled = true;
      try { await Auth.setAppStatus(s.dataset.app, s.value); toast("Status updated"); await render(); }
      catch (err) { fail(err); await render(); }
    });
    body.querySelector("#export").addEventListener("click", () =>
      downloadCSV("applications", ["Candidate", "Email", "Vacancy", "Location", "Applied", "Status"],
        rows().map(a => [a.user && a.user.name, a.user && a.user.email, a.title, a.location, a.date, a.status])));
    paint();
  }

  /* ---------- Vacancies ---------- */
  function vacancies() {
    const body = document.getElementById("tab-body");
    body.innerHTML = `
      <div class="toolbar">
        <input type="search" id="q" placeholder="Search vacancies..." aria-label="Search">
        <select id="st" aria-label="Status"><option value="">Open and closed</option><option value="open">Open</option><option value="closed">Closed</option></select>
        <span class="spacer"></span>
        <button class="btn btn-primary btn-sm" id="add">+ New vacancy</button>
      </div>
      <div class="table-wrap" id="tbl"></div>`;
    const paint = () => {
      const q = body.querySelector("#q").value.trim().toLowerCase(), st = body.querySelector("#st").value;
      const list = data.vacancies.filter(v => (!st || (st === "open") === v.active) && (!q || [v.title, v.company, v.location, v.category].join(" ").toLowerCase().includes(q)));
      body.querySelector("#tbl").innerHTML = list.length ? `
        <table class="data"><thead><tr><th>Title</th><th>Company</th><th>Location</th><th>Type</th><th>Category</th><th>Posted</th><th>Applications</th><th>Status</th><th></th></tr></thead><tbody>
        ${list.map(v => `<tr>
          <td><strong>${e(v.title)}</strong></td>
          <td><span class="co-cell">${v.logo ? `<img class="logo-thumb" src="${e(v.logo)}" alt="" loading="lazy">` : ""}${e(v.company)}</span></td>
          <td>${e(v.location)}</td><td>${e(v.type)}</td><td>${e(v.category)}</td><td>${e(v.posted)}</td>
          <td>${data.apps.filter(a => a.jobId === v.id).length}</td>
          <td>${v.active ? `<span class="badge ok">Open</span>` : `<span class="badge">Closed</span>`}</td>
          <td class="actions">
            <button class="btn btn-outline-dark btn-sm" data-edit="${e(v.id)}">Edit</button>
            <button class="btn btn-outline-dark btn-sm" data-toggle="${e(v.id)}">${v.active ? "Close" : "Reopen"}</button>
          </td></tr>`).join("")}</tbody></table>` : empty("No vacancies found.");
    };
    body.querySelector("#q").addEventListener("input", paint);
    body.querySelector("#st").addEventListener("input", paint);
    body.querySelector("#add").addEventListener("click", () => openVacancy());
    body.querySelector("#tbl").addEventListener("click", async ev => {
      const ed = ev.target.closest("[data-edit]"), tg = ev.target.closest("[data-toggle]");
      if (ed) return openVacancy(ed.dataset.edit);
      if (tg) {
        const v = data.vacancies.find(x => x.id === tg.dataset.toggle);
        tg.disabled = true;
        try { await Vacancies.setActive(v.id, !v.active); await render(); toast(v.active ? "Vacancy closed" : "Vacancy reopened"); }
        catch (err) { tg.disabled = false; fail(err); }
      }
    });
    paint();
  }

  function openVacancy(id) {
    const v = id ? data.vacancies.find(x => x.id === id) : null;
    const f = v || { title: "", company: "Confidential Client", location: "", type: "Full-time", category: "", salary: "", summary: "", description: "", requirements: [] };
    const m = openModal(`
      <h2>${v ? "Edit vacancy" : "New vacancy"}</h2>
      <form id="vform" novalidate style="margin-top:14px">
        <div class="field"><label for="v-title">Job title</label><input id="v-title" maxlength="160" value="${e(f.title)}" required></div>
        <div class="row">
          <div class="field"><label for="v-loc">Location</label><input id="v-loc" maxlength="120" value="${e(f.location)}" required></div>
          <div class="field"><label for="v-type">Type</label><select id="v-type">${JOB_TYPES.map(t => `<option ${t === f.type ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        </div>
        <div class="row">
          <div class="field"><label for="v-cat">Category (field of work)</label><select id="v-cat" required>
            <option value="">Choose a field...</option>
            ${[...new Set([...(window.TC_FIELDS || []), f.category].filter(Boolean))].map(c => `<option ${c === f.category ? "selected" : ""}>${e(c)}</option>`).join("")}
          </select></div>
          <div class="field"><label for="v-sal">Salary</label><input id="v-sal" maxlength="120" value="${e(f.salary)}" placeholder="e.g. Market related"></div>
        </div>
        <div class="field"><label for="v-co">Company (shown publicly)</label><input id="v-co" maxlength="160" value="${e(f.company)}" list="v-co-list" autocomplete="off">
          <datalist id="v-co-list">${[...new Set(data.vacancies.map(x => x.company))].map(c => `<option value="${e(c)}">`).join("")}</datalist></div>
        <div class="field"><label for="v-logo">Company logo</label>
          <div class="logo-field">
            <div class="logo-box" id="v-logo-prev" aria-hidden="true"></div>
            <div>
              <input type="file" id="v-logo" accept="image/png,image/jpeg,image/webp">
              <div style="margin-top:6px"><button type="button" class="btn btn-outline-dark btn-sm" id="v-logo-rm">Remove logo</button></div>
              <p class="hint" style="margin-top:6px">PNG, JPG or WebP, under 1 MB. Only upload logos you have permission to use.</p>
            </div>
          </div>
        </div>
        <div class="field"><label for="v-sum">Short summary (shown on the job card)</label><textarea id="v-sum" maxlength="1000" style="min-height:70px">${e(f.summary)}</textarea></div>
        <div class="field"><label for="v-desc">Full job description (shown when a candidate opens the job)</label>
          <textarea id="v-desc" maxlength="10000" style="min-height:200px" placeholder="About the company, key responsibilities, working hours, benefits, how to apply...&#10;&#10;Leave a blank line between paragraphs. Start a line with - to make a bullet point.">${e(f.description || "")}</textarea></div>
        <div class="field"><label for="v-req">Requirements (one per line)</label><textarea id="v-req" style="min-height:90px">${e(f.requirements.join("\n"))}</textarea></div>
        ${v && v.alertsSentAt
          ? `<p class="hint">Job alert emails were sent for this vacancy on ${e(fmt(v.alertsSentAt))} to ${e(v.alertsCount ?? 0)} candidate(s).</p>`
          : (!v || v.active) ? `<label class="check" style="display:flex;gap:10px;align-items:flex-start;margin:6px 0 14px">
              <input type="checkbox" id="v-alert" ${v ? "" : "checked"} style="margin-top:4px">
              <span><strong>Email matching candidates</strong><br><span class="hint">Sends a job alert from hr@talentcrafters.co.za to registered, approved candidates whose field of work matches this category. Sent once only.</span></span>
            </label>` : ""}
        <div id="v-err" class="form-msg error" role="alert"></div>
        <button class="btn btn-primary" type="submit">${v ? "Save changes" : "Create vacancy"}</button>
      </form>`);
    const $ = s => m.el.querySelector(s);

    // Logo handling: keep the saved URL until a new file is chosen or the logo is removed.
    let logoUrl = f.logo || "", logoFile = null, blobUrl = null;
    const paintLogo = () => {
      const src = blobUrl || logoUrl;
      $("#v-logo-prev").innerHTML = src ? `<img src="${e(src)}" alt="">` : `<span>No logo</span>`;
      $("#v-logo-rm").hidden = !src;
    };
    $("#v-logo").addEventListener("change", ev => {
      const file = ev.target.files[0], err = $("#v-err");
      err.className = "form-msg error";
      if (!file) return;
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 1048576) {
        ev.target.value = "";
        err.textContent = "Please choose a PNG, JPG or WebP image under 1 MB.";
        err.className = "form-msg error show";
        return;
      }
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      logoFile = file; blobUrl = URL.createObjectURL(file);
      paintLogo();
    });
    $("#v-logo-rm").addEventListener("click", () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      logoFile = null; blobUrl = null; logoUrl = ""; $("#v-logo").value = "";
      paintLogo();
    });
    // Picking a company that already has a logo on another vacancy reuses that logo.
    $("#v-co").addEventListener("change", () => {
      if (logoFile || logoUrl) return;
      const name = $("#v-co").value.trim().toLowerCase();
      const hit = data.vacancies.find(x => x.logo && x.company.toLowerCase() === name);
      if (hit) { logoUrl = hit.logo; paintLogo(); }
    });
    paintLogo();

    $("#vform").addEventListener("submit", async ev => {
      ev.preventDefault();
      const err = $("#v-err");
      const val = {
        title: $("#v-title").value.trim(), location: $("#v-loc").value.trim(), type: $("#v-type").value,
        category: $("#v-cat").value, salary: $("#v-sal").value.trim(), company: $("#v-co").value.trim(),
        summary: $("#v-sum").value.trim(), description: $("#v-desc").value.trim(), requirements: $("#v-req").value.split("\n").map(s => s.trim()).filter(Boolean)
      };
      if (!val.title || !val.location || !val.category) { err.textContent = "Title, location and category are required."; err.className = "form-msg error show"; return; }
      const btn = ev.submitter || $("#vform button[type=submit]");
      btn.disabled = true;
      try {
        val.logo = logoFile ? await Vacancies.uploadLogo(logoFile) : logoUrl;
        const vid = v ? (await Vacancies.update(id, val), id) : await Vacancies.create(val);
        const wantAlert = $("#v-alert") && $("#v-alert").checked;
        let note = "";
        if (wantAlert) {
          try {
            const r = await Vacancies.sendAlerts(vid);
            note = r.sent ? ` and emailed ${r.sent} candidate${r.sent === 1 ? "" : "s"}` : " (no candidates in this field yet, so no emails were sent)";
          } catch (e3) { note = ". Alert emails were NOT sent: " + e3.message; }
        }
        m.close(); await render(); toast((v ? "Vacancy saved" : "Vacancy created") + note);
      } catch (e2) { btn.disabled = false; err.textContent = e2.message; err.className = "form-msg error show"; }
    });
  }

  /* ---------- Leads (companies with open jobs, found via Adzuna) ---------- */
  const safeUrl = u => /^https?:\/\//i.test(u) ? u : "#";
  const money = (a, b) => {
    const f = n => "R" + Math.round(n).toLocaleString("en-ZA");
    return a && b && a !== b ? f(a) + " - " + f(b) : (a || b) ? f(a || b) : "";
  };
  const leadBadge = s => `<span class="badge ${s === "Do not contact" ? "bad" : s === "New" ? "info" : s === "Not interested" ? "" : "ok"}">${e(s)}</span>`;

  function leadsTab() {
    const body = document.getElementById("tab-body");
    body.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <h3 style="color:var(--navy);margin-bottom:4px">Find companies with open jobs</h3>
        <p class="muted small" style="margin-bottom:12px">Searches current job adverts in South Africa and lists the companies hiring. Leave the keyword empty to scan common roles.</p>
        <form id="sync-form" class="toolbar" style="margin:0">
          <input id="s-what" maxlength="60" placeholder="Keyword (optional), e.g. accountant" aria-label="Keyword">
          <input id="s-where" maxlength="60" placeholder="Location (optional), e.g. Boksburg" aria-label="Location">
          <select id="s-pages" aria-label="Depth"><option value="1">Quick search</option><option value="2">Deeper search</option></select>
          <button class="btn btn-primary btn-sm" type="submit" id="s-go">Find companies now</button>
        </form>
        <div id="s-msg" class="form-msg" role="status"></div>
      </div>
      <div class="toolbar">
        <input type="search" id="q" placeholder="Search companies, roles, locations..." aria-label="Search">
        <select id="st" aria-label="Status"><option value="">All statuses</option>${LEAD_STATUSES.map(s => `<option>${s}</option>`).join("")}</select>
        <span class="spacer"></span>
        <button class="btn btn-outline-dark btn-sm" id="export">Export CSV</button>
      </div>
      <p class="results-count" id="count"></p>
      <div class="table-wrap" id="tbl"></div>
      <p class="hint" style="margin-top:12px">Private to admins. Job data provided by <a href="https://www.adzuna.co.za" target="_blank" rel="noopener noreferrer">Adzuna</a>; each role links to the original advert. Companies marked "Do not contact" are kept so they are never re-added as new.</p>`;

    const filtered = () => {
      const q = body.querySelector("#q").value.trim().toLowerCase(), st = body.querySelector("#st").value;
      return data.leads.filter(c => (!st || c.status === st)
        && (!q || (c.name + " " + c.jobs.map(j => j.title + " " + j.location).join(" ")).toLowerCase().includes(q)));
    };
    const paint = () => {
      const list = filtered();
      body.querySelector("#count").textContent = `${list.length} ${list.length === 1 ? "company" : "companies"}`;
      body.querySelector("#tbl").innerHTML = list.length ? `
        <table class="data"><thead><tr><th>Company</th><th>Open roles</th><th>Examples</th><th>Locations</th><th>Last seen</th><th>Status</th><th></th></tr></thead><tbody>
        ${list.map(c => {
          const locs = [...new Set(c.jobs.map(j => j.location).filter(Boolean))];
          return `<tr>
            <td><strong>${e(c.name)}</strong></td><td>${c.jobs.length}</td>
            <td class="small">${c.jobs.slice(0, 2).map(j => e(j.title)).join("<br>")}${c.jobs.length > 2 ? `<br><span class="muted">+${c.jobs.length - 2} more</span>` : ""}</td>
            <td class="small">${e(locs.slice(0, 2).join(", "))}${locs.length > 2 ? ` <span class="muted">+${locs.length - 2}</span>` : ""}</td>
            <td class="small" style="white-space:nowrap">${fmt(c.lastSeen)}</td>
            <td>${leadBadge(c.status)}</td>
            <td><button class="btn btn-primary btn-sm" data-lead="${e(c.id)}">Open</button></td></tr>`;
        }).join("")}</tbody></table>`
        : empty(data.leads.length ? "No companies match your filters." : "No leads yet. Use \"Find companies now\" above.");
    };
    ["q", "st"].forEach(id => body.querySelector("#" + id).addEventListener("input", paint));
    body.querySelector("#tbl").addEventListener("click", ev => { const b = ev.target.closest("[data-lead]"); if (b) openLead(b.dataset.lead); });
    body.querySelector("#export").addEventListener("click", () =>
      downloadCSV("leads", ["Company", "Status", "Open roles", "Role titles", "Locations", "Ad links", "First seen", "Last seen", "Notes"],
        filtered().map(c => [c.name, c.status, c.jobs.length, c.jobs.map(j => j.title).join("; "),
          [...new Set(c.jobs.map(j => j.location).filter(Boolean))].join("; "), c.jobs.map(j => j.url).join(" "), c.firstSeen, c.lastSeen, c.notes])));

    body.querySelector("#sync-form").addEventListener("submit", async ev => {
      ev.preventDefault();
      const btn = body.querySelector("#s-go"), msg = body.querySelector("#s-msg");
      btn.disabled = true; btn.textContent = "Searching...";
      msg.textContent = "Searching current job adverts. This can take up to a minute."; msg.className = "form-msg show";
      try {
        const r = await Leads.sync({
          what: body.querySelector("#s-what").value.trim(), where: body.querySelector("#s-where").value.trim(),
          pages: Number(body.querySelector("#s-pages").value)
        });
        await render();
        toast(`Found ${r.jobs} jobs from ${r.companies} companies (${r.newCompanies} new)`);
      } catch (err) {
        btn.disabled = false; btn.textContent = "Find companies now";
        msg.textContent = err.message; msg.className = "form-msg error show";
      }
    });
    paint();
  }

  function openLead(id) {
    const c = data.leads.find(x => x.id === id);
    if (!c) return;
    const history = data.log.filter(l => (l.details || "").includes(c.name) && l.action.startsWith("lead_")).reverse().slice(0, 30);
    const m = openModal(`
      <div style="margin-bottom:8px">${leadBadge(c.status)}</div>
      <h2>${e(c.name)}</h2>
      <p class="muted small">First seen ${fmt(c.firstSeen)} &middot; last seen ${fmt(c.lastSeen)}</p>
      <div class="field" style="margin-top:14px"><label for="l-status">Status</label>
        <select id="l-status">${LEAD_STATUSES.map(s => `<option ${s === c.status ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      <h4>Open roles (${c.jobs.length})</h4>
      <ul class="timeline">${c.jobs.map(j => `<li>
        <a href="${e(safeUrl(j.url))}" target="_blank" rel="noopener noreferrer"><strong>${e(j.title)}</strong></a>
        <div class="muted small">${[j.location, j.category, j.type, money(j.salaryMin, j.salaryMax), j.posted ? "Posted " + fmt(j.posted) : ""].filter(Boolean).map(e).join(" &middot; ")}</div></li>`).join("")}</ul>
      <p class="hint">To reach the decision maker, open the advert or the company's own website and use their official contact channels. Respect each company's opt-out requests.</p>
      <h4>Notes</h4>
      <textarea id="l-notes" maxlength="4000" style="min-height:80px" placeholder="Internal notes: who you spoke to, follow-up date...">${e(c.notes)}</textarea>
      <div style="margin:8px 0 4px"><button class="btn btn-outline-dark btn-sm" id="l-save">Save status and notes</button></div>
      ${history.length ? `<h4>History</h4><ul class="timeline">${history.map(l => `<li>${actionBadge(l.action)} ${e(l.details)} <span class="muted">&middot; ${fmt(l.ts)}</span></li>`).join("")}</ul>` : ""}
      <div style="margin-top:22px"><button class="btn btn-sm btn-danger" id="l-del">Remove lead</button></div>`);
    const $ = s => m.el.querySelector(s);
    const act = async (btn, fn, msg) => {
      btn.disabled = true;
      try { await fn(); m.close(); await render(); toast(msg); } catch (err) { btn.disabled = false; fail(err); }
    };
    $("#l-save").addEventListener("click", ev => act(ev.target, async () => {
      if ($("#l-status").value !== c.status) await Leads.setStatus(id, $("#l-status").value);
      if ($("#l-notes").value !== c.notes) await Leads.setNotes(id, $("#l-notes").value);
    }, "Saved"));
    $("#l-del").addEventListener("click", ev => {
      if (!confirm("Remove this company and its listed roles? A new search may add it again.")) return;
      act(ev.target, () => Leads.remove(id), "Lead removed");
    });
  }

  /* ---------- Messages ---------- */
  function messages() {
    const list = [...data.msgs].reverse();
    document.getElementById("tab-body").innerHTML = list.length
      ? list.map(m => `<div class="msg-card"><strong>${e(m.name)}</strong> <span class="badge">${e(m.topic)}</span>
          <div class="muted small">${e(m.email)}${m.phone ? " &middot; " + e(m.phone) : ""} &middot; ${fmt(m.date)}</div><p>${e(m.message)}</p></div>`).join("")
      : empty("No contact messages yet.");
  }

  /* ---------- Activity log ---------- */
  function logTable(list) {
    return `<table class="data"><thead><tr><th>When</th><th>Who</th><th>Role</th><th>Action</th><th>Details</th></tr></thead><tbody>
      ${list.map(l => `<tr>
        <td class="small">${fmtCell(l.ts)}</td>
        <td><strong>${e(l.actorName)}</strong><div class="muted small">${e(l.actorEmail)}</div></td>
        <td><span class="badge">${e(l.actorRole)}</span></td>
        <td>${actionBadge(l.action)}</td><td>${e(l.details)}</td>
      </tr>`).join("")}</tbody></table>`;
  }

  function activityLog() {
    const body = document.getElementById("tab-body");
    body.innerHTML = `
      <div class="toolbar">
        <input type="search" id="q" placeholder="Search by person or details..." aria-label="Search">
        <select id="act" aria-label="Action"><option value="">All actions</option>${Object.entries(ACTIONS).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join("")}</select>
        <select id="role" aria-label="Role"><option value="">All roles</option><option value="candidate">Candidates</option><option value="employer">Companies</option><option value="admin">Admins</option><option value="visitor">Visitors</option></select>
        <span class="spacer"></span>
        <button class="btn btn-outline-dark btn-sm" id="export">Export CSV</button>
      </div>
      <p class="results-count" id="count"></p>
      <div class="table-wrap" id="tbl"></div>
      <p class="hint" style="margin-top:12px">Entries are recorded by the database itself and can't be edited or deleted from this dashboard.</p>`;
    const LIMIT = 300;
    const filtered = () => {
      const q = body.querySelector("#q").value.trim().toLowerCase(), a = body.querySelector("#act").value, r = body.querySelector("#role").value;
      return [...data.log].reverse().filter(l => (!a || l.action === a) && (!r || l.actorRole === r)
        && (!q || [l.actorName, l.actorEmail, l.details].join(" ").toLowerCase().includes(q)));
    };
    const paint = () => {
      const all = filtered(), list = all.slice(0, LIMIT);
      body.querySelector("#count").textContent = all.length > LIMIT ? `Showing latest ${LIMIT} of ${all.length} entries (export for the full list)` : `${all.length} ${all.length === 1 ? "entry" : "entries"}`;
      body.querySelector("#tbl").innerHTML = list.length ? logTable(list) : empty("No activity matches your filters.");
    };
    ["q", "act", "role"].forEach(id => body.querySelector("#" + id).addEventListener("input", paint));
    body.querySelector("#export").addEventListener("click", () =>
      downloadCSV("activity-log", ["When", "Who", "Email", "Role", "Action", "Details"],
        filtered().map(l => [l.ts, l.actorName, l.actorEmail, l.actorRole, (ACTIONS[l.action] || [l.action])[0], l.details])));
    paint();
  }

  render();
});
