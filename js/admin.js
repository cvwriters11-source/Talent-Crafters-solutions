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
    notes_updated: ["Notes updated", "warn"], application_status: ["Application status", "warn"],
    vacancy_created: ["Vacancy created", "info"], vacancy_updated: ["Vacancy updated", "warn"],
    vacancy_deleted: ["Vacancy deleted", "bad"], export: ["Data export", "warn"],
    leads_sync: ["Leads search", "info"], lead_status: ["Lead status", "warn"],
    lead_notes: ["Lead notes", "warn"], lead_deleted: ["Lead removed", "bad"]
  };
  const LEAD_STATUSES = ["New", "Researching", "Contacted", "Replied", "Not interested", "Do not contact"];
  const fmt = iso => iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "-";
  const actionBadge = a => { const [l, c] = ACTIONS[a] || [a, ""]; return `<span class="badge ${c}">${e(l)}</span>`; };
  const statusBadge = u => u.status === "suspended" ? `<span class="badge bad">Suspended</span>` : `<span class="badge ok">Active</span>`;
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
    ["vacancies", "Vacancies"], ["leads", "Leads"], ["messages", "Messages"], ["log", "Activity log"]
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
    ({ overview, candidates: () => usersTab("candidate"), companies: () => usersTab("employer"), applications, vacancies, leads: leadsTab, messages, log: activityLog })[state.tab]();
  }

  /* ---------- Overview ---------- */
  function overview() {
    const { users, apps, msgs, log, vacancies } = data;
    const today = new Date().toDateString();
    const cards = [
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
        <select id="st" aria-label="Status"><option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option></select>
        <span class="spacer"></span>
        <button class="btn btn-outline-dark btn-sm" id="export">Export CSV</button>
      </div>
      <div class="table-wrap" id="tbl"></div>`;

    const filtered = () => {
      const q = body.querySelector("#q").value.trim().toLowerCase(), st = body.querySelector("#st").value;
      return data.users.filter(u => u.role === role
        && (!st || u.status === st)
        && (!q || [u.name, u.email, u.phone, u.company].join(" ").toLowerCase().includes(q)));
    };
    const paint = () => {
      const list = filtered();
      body.querySelector("#tbl").innerHTML = list.length ? `
        <table class="data"><thead><tr>
          ${isCo ? "<th>Company</th><th>Contact person</th>" : "<th>Name</th>"}
          <th>Email</th><th>Phone</th><th>Registered</th><th>Last login</th>${isCo ? "" : "<th>Applications</th>"}<th>Status</th><th></th>
        </tr></thead><tbody>
        ${list.map(u => `<tr>
          ${isCo ? `<td><strong>${e(u.company)}</strong></td><td>${e(u.name)}</td>` : `<td><strong>${e(u.name)}</strong></td>`}
          <td>${e(u.email)}</td><td>${e(u.phone || "-")}</td><td>${fmt(u.created)}</td><td>${fmt(u.lastLogin)}</td>
          ${isCo ? "" : `<td>${data.apps.filter(a => a.userId === u.id).length}</td>`}
          <td>${statusBadge(u)}</td>
          <td><button class="btn btn-primary btn-sm" data-view="${e(u.id)}">Manage</button></td>
        </tr>`).join("")}
        </tbody></table>` : empty(`No ${isCo ? "companies" : "candidates"} found.`);
    };
    body.querySelector("#q").addEventListener("input", paint);
    body.querySelector("#st").addEventListener("input", paint);
    body.querySelector("#tbl").addEventListener("click", ev => { const b = ev.target.closest("[data-view]"); if (b) openUser(b.dataset.view); });
    body.querySelector("#export").addEventListener("click", () =>
      downloadCSV(isCo ? "companies" : "candidates",
        [isCo ? "Company" : "Name", ...(isCo ? ["Contact person"] : []), "Email", "Phone", "Registered", "Last login", ...(isCo ? [] : ["Applications"]), "Status", "Notes"],
        filtered().map(u => [isCo ? u.company : u.name, ...(isCo ? [u.name] : []), u.email, u.phone, u.created, u.lastLogin, ...(isCo ? [] : [data.apps.filter(a => a.userId === u.id).length]), u.status, u.notes])));
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
      <div style="display:flex;gap:8px;margin-bottom:8px"><span class="badge info">${isCo ? "Company" : "Candidate"}</span>${statusBadge(u)}</div>
      <h2>${e(isCo ? u.company : u.name)}</h2>
      <dl class="detail-grid">
        ${isCo ? `<dt>Contact person</dt><dd>${e(u.name)}</dd>` : ""}
        <dt>Email</dt><dd>${e(u.email)}</dd>
        <dt>Phone</dt><dd>${e(u.phone || "-")}</dd>
        <dt>Registered</dt><dd>${fmt(u.created)}</dd>
        <dt>Last login</dt><dd>${fmt(u.lastLogin)}</dd>
      </dl>
      ${isCo ? "" : `
        <h4>Applications (${apps.length})</h4>
        ${apps.length ? `<ul class="timeline" style="margin-bottom:8px">${apps.map(a => `<li><strong>${e(a.title)}</strong> &middot; ${e(a.location)} &middot; ${fmt(a.date)} <span class="badge warn">${e(a.status)}</span></li>`).join("")}</ul>` : `<p class="muted small">No applications yet.</p>`}`}
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
        <table class="data"><thead><tr><th>Candidate</th><th>Email</th><th>Vacancy</th><th>Location</th><th>Applied</th><th>Status</th></tr></thead><tbody>
        ${list.map(a => `<tr>
          <td><strong>${e(a.user ? a.user.name : "Unknown")}</strong></td><td>${e(a.user ? a.user.email : "-")}</td>
          <td>${e(a.title)}</td><td>${e(a.location)}</td><td>${fmt(a.date)}</td>
          <td><select data-app="${e(a.id)}" aria-label="Application status">${APP_STATUSES.map(s => `<option ${s === a.status ? "selected" : ""}>${s}</option>`).join("")}</select></td>
        </tr>`).join("")}</tbody></table>` : empty("No applications found.");
    };
    body.querySelector("#q").addEventListener("input", paint);
    body.querySelector("#st").addEventListener("input", paint);
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
          <td style="white-space:nowrap">
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
          <div class="field"><label for="v-cat">Category</label><input id="v-cat" maxlength="80" value="${e(f.category)}" placeholder="e.g. Finance" required></div>
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
        category: $("#v-cat").value.trim(), salary: $("#v-sal").value.trim(), company: $("#v-co").value.trim(),
        summary: $("#v-sum").value.trim(), description: $("#v-desc").value.trim(), requirements: $("#v-req").value.split("\n").map(s => s.trim()).filter(Boolean)
      };
      if (!val.title || !val.location || !val.category) { err.textContent = "Title, location and category are required."; err.className = "form-msg error show"; return; }
      const btn = ev.submitter || $("#vform button[type=submit]");
      btn.disabled = true;
      try {
        val.logo = logoFile ? await Vacancies.uploadLogo(logoFile) : logoUrl;
        v ? await Vacancies.update(id, val) : await Vacancies.create(val);
        m.close(); await render(); toast(v ? "Vacancy saved" : "Vacancy created");
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
        <td class="small" style="white-space:nowrap">${fmt(l.ts)}</td>
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
