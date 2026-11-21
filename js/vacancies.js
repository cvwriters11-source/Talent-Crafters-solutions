/* Job card rendering, details modal and apply flow (used on Home + Vacancies).
 * Vacancies are loaded from the database into window.VACANCIES.
 */
window.VACANCIES = [];

async function loadVacancies() {
  window.VACANCIES = await Vacancies.list();
  return window.VACANCIES;
}

// Company logo + name row. Falls back to the company's initial when there is no logo.
function companyHTML(job) {
  const e = escapeHTML;
  const initial = (job.company || "?").trim().charAt(0).toUpperCase() || "?";
  const logo = job.logo
    ? `<img src="${e(job.logo)}" alt="" loading="lazy" width="48" height="48">`
    : `<span class="logo-initial" aria-hidden="true">${e(initial)}</span>`;
  return `<div class="job-company"><span class="logo-box sm">${logo}</span><span class="job-company-name">${e(job.company)}</span></div>`;
}

// Plain text -> safe HTML: blank line = new paragraph, lines starting with "- " / "* " / "• " = bullets.
function descriptionHTML(text) {
  const e = escapeHTML;
  const bullet = /^[-*•]\s+/;
  return String(text || "").trim().split(/\n\s*\n/).map(block => {
    const out = [];
    let para = [], items = [];
    const flush = () => {
      if (para.length) out.push(`<p>${para.map(e).join("<br>")}</p>`);
      if (items.length) out.push(`<ul>${items.map(i => `<li>${e(i)}</li>`).join("")}</ul>`);
      para = []; items = [];
    };
    block.split("\n").map(l => l.trim()).filter(Boolean).forEach(l => {
      if (bullet.test(l)) { if (para.length) flush(); items.push(l.replace(bullet, "")); }
      else { if (items.length) flush(); para.push(l); }
    });
    flush();
    return out.join("");
  }).join("");
}

function jobCardHTML(job) {
  const e = escapeHTML;
  return `
    <article class="card job-card" data-id="${e(job.id)}">
      ${companyHTML(job)}
      <div class="meta">
        <span class="tag type">${e(job.type)}</span>
        <span class="tag">${e(job.category)}</span>
      </div>
      <h3>${e(job.title)}</h3>
      <p>&#128205; ${e(job.location)}</p>
      <p>${e(job.summary)}</p>
      <div class="foot">
        <span class="salary">${e(job.salary)}</span>
        <button class="btn btn-primary btn-sm" data-details="${e(job.id)}">View &amp; Apply</button>
      </div>
    </article>`;
}

function bindJobCards(container) {
  container.querySelectorAll("[data-details]").forEach(btn =>
    btn.addEventListener("click", () => openJobModal(btn.dataset.details)));
}

async function openJobModal(id) {
  const job = VACANCIES.find(j => j.id === id);
  if (!job) return;
  const e = escapeHTML;
  await Auth.ready;
  const user = Auth.current();

  let applied = false;
  if (user && user.role === "candidate") {
    try { applied = (await Auth.applications(user.id)).some(a => a.jobId === id); } catch { /* shown as not applied */ }
  }

  // The Apply button is always shown, but only logged-in job seekers can submit (also enforced by the database).
  let action;
  if (!user) action = `
    <a class="btn btn-primary" href="account.html?next=vacancies.html">Apply now</a>
    <p class="hint" style="margin-top:10px">Job seekers need an account to apply. <a href="account.html?next=vacancies.html">Log in</a> or <a href="account.html?next=vacancies.html#register">register free</a>.</p>`;
  else if (user.role !== "candidate") action = `
    <button class="btn btn-primary" disabled>Apply now</button>
    <p class="hint" style="margin-top:10px">Only job-seeker accounts can apply for vacancies.</p>`;
  else if (user.approval !== "approved") action = `
    <button class="btn btn-primary" disabled>Apply now</button>
    <p class="hint" style="margin-top:10px">${user.approval === "rejected" ? "Your account was not approved, so you can't apply." : "Your account is awaiting approval. You can apply as soon as our team approves it."}</p>`;
  else if (applied) action = `<button class="btn btn-primary" disabled>Already applied</button>`;
  else if (!user.cvPath) action = `
    <a class="btn btn-primary" href="account.html">Upload your CV to apply</a>
    <p class="hint" style="margin-top:10px">Add your CV on your account page first, then come back and apply.</p>`;
  else action = `
    <div class="field">
      <label for="cover-letter">Cover letter <span style="font-weight:400;color:var(--muted)">(optional)</span></label>
      <textarea id="cover-letter" maxlength="4000" rows="5" placeholder="Tell us briefly why you are a good fit for this role."></textarea>
      <p class="hint">Your CV (${e(user.cvName || "on file")}) is sent with your application.</p>
    </div>
    <button class="btn btn-primary" id="apply-btn">Submit application</button>`;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop open";
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${e(job.title)}">
      <button class="modal-close" aria-label="Close">&times;</button>
      ${companyHTML(job)}
      <div class="meta" style="display:flex;gap:8px;margin-bottom:8px">
        <span class="tag type">${e(job.type)}</span><span class="tag">${e(job.category)}</span>
      </div>
      <h2>${e(job.title)}</h2>
      <p style="color:var(--muted)">&#128205; ${e(job.location)} &middot; ${e(job.salary)} &middot; Posted ${e(job.posted)}</p>
      <h4>About the role</h4>
      <div class="job-desc">${descriptionHTML(job.description || job.summary)}</div>
      ${job.requirements.length ? `<h4>Requirements</h4><ul>${job.requirements.map(r => `<li>${e(r)}</li>`).join("")}</ul>` : ""}
      <div style="margin-top:24px">${action}</div>
    </div>`;
  document.body.appendChild(backdrop);

  const close = () => { backdrop.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = ev => { if (ev.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  backdrop.addEventListener("click", ev => { if (ev.target === backdrop) close(); });
  backdrop.querySelector(".modal-close").addEventListener("click", close);

  const applyBtn = backdrop.querySelector("#apply-btn");
  if (applyBtn) applyBtn.addEventListener("click", async () => {
    applyBtn.disabled = true;
    try {
      const letter = backdrop.querySelector("#cover-letter");
      const ok = await Auth.apply(job, letter ? letter.value : "");
      close();
      toast(ok ? "Application submitted for " + job.title : "You've already applied for " + job.title);
    } catch (err) {
      applyBtn.disabled = false;
      toast(err.message);
    }
  });
}
