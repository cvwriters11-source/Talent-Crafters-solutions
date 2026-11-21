/* Two-pane vacancy browser for vacancies.html: job list on the left, the selected job in full on the right.
 * Uses window.VACANCIES (js/vacancies.js) and the shared applyBlock()/bindApply() helpers.
 * On phones the list and the job are shown one at a time with a Back button. */
(function () {
  const e = escapeHTML;
  const $ = id => document.getElementById(id);
  const SAVED_KEY = "tc_saved_jobs";

  const getSaved = () => { try { return new Set(JSON.parse(localStorage.getItem(SAVED_KEY)) || []); } catch { return new Set(); } };
  const putSaved = s => { try { localStorage.setItem(SAVED_KEY, JSON.stringify([...s])); } catch { /* private mode: saving just won't persist */ } };

  let saved = getSaved();
  let user = null;
  let applied = new Set();
  let shown = [];
  let selectedId = null;

  const toDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? new Date(s + "T00:00:00") : new Date(s);
  const fmtDay = s => toDate(s).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
  const fmtLong = s => toDate(s).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const isNew = j => Date.now() - toDate(j.posted).getTime() < 7 * 864e5;
  const ref = j => "TC-" + String(j.id).replace(/-/g, "").slice(0, 8).toUpperCase();
  const logoHTML = (j, cls) => {
    const initial = (j.company || "?").trim().charAt(0).toUpperCase() || "?";
    return `<span class="logo-box ${cls}">${j.logo ? `<img src="${e(j.logo)}" alt="" loading="lazy">` : `<span class="logo-initial" aria-hidden="true">${e(initial)}</span>`}</span>`;
  };
  const heart = id => `<button type="button" class="vheart ${saved.has(id) ? "on" : ""}" data-save="${e(id)}" aria-pressed="${saved.has(id)}" aria-label="${saved.has(id) ? "Remove from saved jobs" : "Save job"}">${saved.has(id) ? "&#9829;" : "&#9825;"}</button>`;

  function cardHTML(j) {
    return `
    <article class="vcard${j.id === selectedId ? " selected" : ""}" data-id="${e(j.id)}" tabindex="0" aria-label="${e(j.title)}, ${e(j.location)}">
      <div class="vcard-top">
        ${applied.has(j.id) ? `<span class="vbadge done">&#10003; Applied</span>` : isNew(j) ? `<span class="vbadge new">New</span>` : `<span class="vbadge">${e(j.type)}</span>`}
        <span class="vcard-date">${e(fmtDay(j.posted))}</span>
        ${heart(j.id)}
      </div>
      <h3>${e(j.title)}</h3>
      <div class="vcard-row">
        <span class="vcard-loc">&#128205; ${e(j.location)}</span>
        <span class="vcard-co">${logoHTML(j, "xs")}<span>${e(j.company)}</span></span>
      </div>
      <button type="button" class="btn btn-primary vcard-apply" data-apply="${e(j.id)}">${applied.has(j.id) ? "Applied" : "Apply Now"}</button>
    </article>`;
  }

  function applyTop(j) {
    const top = applyBlock(j, user, applied.has(j.id)).top;
    if (top.href) return `<a class="btn btn-primary vd-apply" href="${e(top.href)}">${e(top.label)}</a>`;
    if (top.disabled) return `<button class="btn btn-primary vd-apply" disabled>${e(top.label)}</button>`;
    return `<button class="btn btn-primary vd-apply" type="button" data-scroll-apply>${e(top.label)}</button>`;
  }

  function detailHTML(j) {
    const desc = (j.description || "").trim();
    const sameAsSummary = !desc || desc === (j.summary || "").trim();
    const others = VACANCIES.filter(x => x.id !== j.id && x.company === j.company);
    const confidential = /confidential/i.test(j.company);
    const alertHref = user && user.role === "candidate" ? "account.html" : "account.html?next=vacancies.html#register";
    return `
    <div class="vd-bar">
      <button type="button" class="vd-back" id="vd-back">&#8249; All jobs</button>
      ${isNew(j) ? `<span class="vbadge new">New</span>` : `<span class="vbadge">${e(j.type)}</span>`}
      <span class="vd-spacer"></span>
      <button type="button" class="vd-icon ${saved.has(j.id) ? "on" : ""}" data-save="${e(j.id)}" aria-pressed="${saved.has(j.id)}"><span>${saved.has(j.id) ? "&#9829;" : "&#9825;"}</span><small>${saved.has(j.id) ? "Saved" : "Save"}</small></button>
      <a class="vd-icon" href="${alertHref}" title="Get an email when new jobs are posted in your field"><span>&#128276;</span><small>Alert</small></a>
      ${applyTop(j)}
    </div>
    <div class="vd-body">
      <div class="vd-head">
        ${logoHTML(j, "lg")}
        <div>
          <h2>${e(j.title)}</h2>
          <div class="vd-co">${e(j.company)}</div>
          <div class="vd-date">&#128339; ${e(fmtLong(j.posted))}</div>
        </div>
      </div>
      <dl class="vd-meta">
        <div><dt>Industry</dt><dd>${e(j.category)}</dd></div>
        <div><dt>Location</dt><dd>${e(j.location)}</dd></div>
        <div><dt>Contract type</dt><dd>${e(j.type)}</dd></div>
        <div><dt>Salary</dt><dd>${e(j.salary || "Not specified")}</dd></div>
      </dl>
      <div class="vd-tabs" role="tablist">
        <button type="button" class="active" role="tab" data-tab="spec">Job Specification</button>
        <button type="button" role="tab" data-tab="company">Company</button>
        <span class="vd-ref">Reference Number <strong>${e(ref(j))}</strong></span>
      </div>
      <div id="vd-spec" class="vd-pane">
        <section class="vd-box"><h3>Job Summary</h3><div class="job-desc">${descriptionHTML(j.summary)}</div></section>
        ${sameAsSummary ? "" : `<section class="vd-box"><h3>About the role</h3><div class="job-desc">${descriptionHTML(desc)}</div></section>`}
        ${j.requirements.length ? `<section class="vd-box"><h3>Requirements</h3><ul>${j.requirements.map(r => `<li>${e(r)}</li>`).join("")}</ul></section>` : ""}
        <section class="vd-box vd-applybox" id="vd-apply"><h3>Apply for this job</h3>${applyBlock(j, user, applied.has(j.id)).html}</section>
      </div>
      <div id="vd-company" class="vd-pane" hidden>
        <section class="vd-box">
          <h3>${e(j.company)}</h3>
          <p>${confidential ? "This client has chosen to remain confidential. Talent Crafters manages the recruitment on their behalf, so you apply through us." : "Recruitment for this company is managed by Talent Crafters."}</p>
        </section>
        ${others.length ? `<section class="vd-box"><h3>More jobs at ${e(j.company)}</h3><ul class="vd-others">${others.map(o => `<li><a href="#" data-open="${e(o.id)}">${e(o.title)}</a> <span>&middot; ${e(o.location)}</span></li>`).join("")}</ul></section>` : ""}
      </div>
    </div>`;
  }

  function renderDetail() {
    const j = VACANCIES.find(x => x.id === selectedId);
    const pane = $("vdetail");
    if (!j) { pane.innerHTML = `<div class="vd-empty">Select a job to see the details.</div>`; return; }
    pane.innerHTML = detailHTML(j);
    pane.scrollTop = 0;
    bindApply(pane, j, ok => {
      applied.add(j.id);
      renderList(); renderDetail();
    });
  }

  function renderList() {
    $("vlist").innerHTML = shown.map(cardHTML).join("");
  }

  function select(id, { open = false } = {}) {
    selectedId = id;
    try { history.replaceState(null, "", "?job=" + encodeURIComponent(id)); } catch { /* ignore */ }
    renderList(); renderDetail();
    if (open) $("vwrap").classList.add("show-detail");
  }

  function toggleSave(id) {
    saved.has(id) ? saved.delete(id) : saved.add(id);
    putSaved(saved);
    renderList(); renderDetail();
    toast(saved.has(id) ? "Job saved on this device" : "Removed from saved jobs");
  }

  function applyNow(id) {
    select(id, { open: true });
    const j = VACANCIES.find(x => x.id === id);
    const top = applyBlock(j, user, applied.has(id)).top;
    if (top.href) { location.href = top.href; return; }
    if (!top.disabled) $("vd-apply").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function refresh() {
    const q = $("q").value.trim().toLowerCase();
    const sort = $("sort").value;
    shown = VACANCIES.filter(j =>
      (!q || (j.title + " " + j.summary + " " + j.category + " " + j.location + " " + j.company).toLowerCase().includes(q)) &&
      (!$("category").value || j.category === $("category").value) &&
      (!$("location").value || j.location === $("location").value) &&
      (!$("type").value || j.type === $("type").value) &&
      (!$("savedonly").checked || saved.has(j.id))
    ).sort((a, b) =>
      sort === "oldest" ? a.posted.localeCompare(b.posted) :
      sort === "title" ? a.title.localeCompare(b.title) :
      b.posted.localeCompare(a.posted));

    $("count").textContent = shown.length + (shown.length === 1 ? " job" : " jobs") + " on Talent Crafters";
    const none = shown.length === 0;
    $("empty").hidden = !none;
    $("vwrap").hidden = none;
    if (none) return;
    if (!shown.some(j => j.id === selectedId)) selectedId = shown[0].id;
    renderList(); renderDetail();
  }

  window.initVacancyBrowser = async function () {
    $("count").textContent = "Loading jobs...";
    try { await loadVacancies(); }
    catch {
      $("count").textContent = "";
      $("empty").hidden = false;
      $("empty").querySelector("h3").textContent = "Vacancies could not be loaded";
      $("empty").querySelector("p").textContent = "Please check your connection and refresh the page.";
      return;
    }
    await Auth.ready;
    user = Auth.current();
    if (user && user.role === "candidate") {
      try { (await Auth.applications(user.id)).forEach(a => applied.add(a.jobId)); } catch { /* shown as not applied */ }
    }

    const unique = key => [...new Set(VACANCIES.map(j => j[key]))].sort();
    ["category", "location", "type"].forEach(id =>
      unique(id).forEach(v => $(id).insertAdjacentHTML("beforeend", `<option>${e(v)}</option>`)));

    const want = new URLSearchParams(location.search).get("job");
    if (want && VACANCIES.some(j => j.id === want)) selectedId = want;

    ["q", "category", "location", "type", "sort", "savedonly"].forEach(id => $(id).addEventListener("input", refresh));

    $("vlist").addEventListener("click", ev => {
      const sv = ev.target.closest("[data-save]"), ap = ev.target.closest("[data-apply]"), card = ev.target.closest(".vcard");
      if (sv) { ev.stopPropagation(); return toggleSave(sv.dataset.save); }
      if (ap) return applyNow(ap.dataset.apply);
      if (card) select(card.dataset.id, { open: true });
    });
    $("vlist").addEventListener("keydown", ev => {
      const card = ev.target.closest(".vcard");
      if (card && ev.target === card && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); select(card.dataset.id, { open: true }); }
    });
    $("vdetail").addEventListener("click", ev => {
      const t = ev.target;
      if (t.closest("#vd-back")) return $("vwrap").classList.remove("show-detail");
      const sv = t.closest("[data-save]"); if (sv) return toggleSave(sv.dataset.save);
      if (t.closest("[data-scroll-apply]")) return $("vd-apply").scrollIntoView({ behavior: "smooth", block: "center" });
      const tab = t.closest("[data-tab]");
      if (tab) {
        $("vdetail").querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("active", b === tab));
        $("vd-spec").hidden = tab.dataset.tab !== "spec";
        $("vd-company").hidden = tab.dataset.tab !== "company";
        return;
      }
      const other = t.closest("[data-open]");
      if (other) { ev.preventDefault(); select(other.dataset.open); }
    });

    refresh();
    // A shared link (?job=...) should open straight to that job on phones too.
    if (want && selectedId === want) $("vwrap").classList.add("show-detail");
  };
})();
