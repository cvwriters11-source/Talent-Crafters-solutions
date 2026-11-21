/* Shared page shell: site details, header/footer, toast, HTML escaping.
 * Data and authentication live in api.js (Supabase).
 */
(function () {
  const SITE = {
    name: "Talent Crafters",
    tagline: "Connecting Potential with Opportunity",
    // TODO: replace with the real phone number
    email: "hr@talentcrafters.co.za",
    phone: "+27 00 000 0000",
    address: "10 Kaap St, Boksburg, 1459",
    hours: "Mon – Fri, 08:00 – 17:00"
  };
  window.SITE = SITE;

  /* ---------- Toast ---------- */
  window.toast = function (msg) {
    let t = document.querySelector(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg;
    requestAnimationFrame(() => t.classList.add("show"));
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove("show"), 3500);
  };

  window.escapeHTML = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- Header / Footer ---------- */
  const page = () => location.pathname.split("/").pop() || "index.html";

  // `who` = { name, role } or null. Only affects what is displayed; the database enforces access.
  function headerHTML(who) {
    const links = [["index.html", "Home"], ["about.html", "About"], ["vacancies.html", "Vacancies"], ["contact.html", "Contact Us"]];
    if (who && who.role === "admin") links.push(["admin.html", "Admin"]);
    const cur = page();
    const li = links.map(([h, t]) => `<li><a href="${h}" class="${cur === h ? "active" : ""}">${t}</a></li>`).join("");
    const authLink = who
      ? `<li><a href="account.html" class="${cur === "account.html" ? "active" : ""}">Hi, ${escapeHTML((who.name || "there").split(" ")[0])}</a></li>`
      : `<li><a href="account.html" class="btn btn-accent btn-sm">Register / Login</a></li>`;
    return `
      <div class="container nav">
        <a href="index.html" class="logo" aria-label="${SITE.name} home">
          <img src="images/logo.jpg" alt="${SITE.name} - ${SITE.tagline}">
        </a>
        <button class="nav-toggle" aria-label="Toggle menu" aria-expanded="false">&#9776;</button>
        <ul class="nav-links">${li}${authLink}</ul>
      </div>`;
  }

  function paintHeader(who) {
    let h = document.getElementById("site-header");
    if (!h) return;
    if (h.tagName !== "HEADER") {
      const el = document.createElement("header");
      el.id = "site-header"; el.className = "site-header";
      h.replaceWith(el); h = el;
    }
    h.innerHTML = headerHTML(who);
    const toggle = h.querySelector(".nav-toggle"), nav = h.querySelector(".nav-links");
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open);
    });
  }

  function renderFooter() {
    document.getElementById("site-footer").outerHTML = `
      <footer class="site-footer">
        <div class="container">
          <div class="footer-grid">
            <div>
              <a href="index.html" class="footer-logo"><img src="images/logo.jpg" alt="${SITE.name}"></a>
              <p>We connect talented people with organisations that value them. Honest advice, fast turnaround, lasting placements.</p>
            </div>
            <div>
              <h4>Explore</h4>
              <ul>
                <li><a href="index.html">Home</a></li>
                <li><a href="about.html">About</a></li>
                <li><a href="vacancies.html">Vacancies</a></li>
                <li><a href="contact.html">Contact Us</a></li>
              </ul>
            </div>
            <div>
              <h4>Candidates</h4>
              <ul>
                <li><a href="account.html">Register</a></li>
                <li><a href="account.html">Login</a></li>
                <li><a href="vacancies.html">Browse jobs</a></li>
              </ul>
            </div>
            <div>
              <h4>Contact</h4>
              <ul>
                <li><a href="mailto:${SITE.email}">${SITE.email}</a></li>
                <li>${SITE.phone}</li>
                <li>${SITE.hours}</li>
              </ul>
            </div>
          </div>
          <div class="copyright">&copy; ${new Date().getFullYear()} ${SITE.name}. All rights reserved.</div>
        </div>
      </footer>`;
  }

  // Show/hide ("eye") button on every password field. The toggle never stores or sends the value anywhere.
  const EYE = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const EYE_OFF = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a19.8 19.8 0 0 1 5.06-5.94M9.9 4.24A10.9 10.9 0 0 1 12 5c7 0 11 7 11 7a19.7 19.7 0 0 1-3.17 4.19M14.12 14.12A3 3 0 1 1 9.88 9.88"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
  function addPasswordToggles() {
    document.querySelectorAll('input[type="password"]').forEach(input => {
      if (input.closest(".pw-wrap")) return;
      const wrap = document.createElement("div");
      wrap.className = "pw-wrap";
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pw-toggle";
      btn.setAttribute("aria-label", "Show password");
      btn.setAttribute("aria-pressed", "false");
      btn.innerHTML = EYE;
      btn.addEventListener("click", () => {
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        btn.innerHTML = show ? EYE_OFF : EYE;
        btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
        btn.setAttribute("aria-pressed", String(show));
        input.focus();
      });
      wrap.appendChild(btn);
    });
  }

  /* ---------- Welcome / review pop-up (admin controls the text and link) ----------
   * Rules: appears once after 3 seconds (not again on the same page); registration is blocked
   * until they click the review button; once they have an account (are logged in) it never shows. */
  const REVIEWED_KEY = "tc_reviewed";
  const SEEN_KEY = "tc_popup_seen";
  const NO_POPUP_PAGES = ["admin.html", "unsubscribe.html"];
  let popupCfg = null;

  window.hasLeftReview = function () {
    try { return localStorage.getItem(REVIEWED_KEY) === "1"; } catch { return false; }
  };
  window.markLeftReview = function () {
    try { localStorage.setItem(REVIEWED_KEY, "1"); } catch { /* private mode */ }
  };

  // Shows the pop-up. `preview` (admin) never marks a review.
  window.showSitePopup = function (p, { preview = false } = {}) {
    if (document.querySelector(".tc-popup-backdrop")) return;
    const e = escapeHTML;
    const link = /^https:\/\/\S+$/i.test(p.link || "") ? p.link : "";
    const wrap = document.createElement("div");
    wrap.className = "tc-popup-backdrop";
    wrap.innerHTML = `
      <div class="tc-popup" role="dialog" aria-modal="true" aria-labelledby="tc-popup-title">
        <button type="button" class="tc-popup-close" aria-label="Close">&times;</button>
        <img class="tc-popup-logo" src="images/logo.jpg" alt="${SITE.name}">
        <div class="tc-popup-stars" aria-hidden="true">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
        <h2 id="tc-popup-title">${e(p.title)}</h2>
        <p>${e(p.message)}</p>
        ${link ? `<a class="tc-popup-btn" href="${e(link)}" target="_blank" rel="noopener noreferrer">${e(p.buttonText)}</a>` : ""}
        <button type="button" class="tc-popup-later">Close</button>
      </div>`;
    document.body.appendChild(wrap);
    if (!preview) {
      try { sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* ignore */ }
    }

    const dismiss = reviewed => {
      wrap.remove();
      document.removeEventListener("keydown", onKey);
      if (preview) return;
      if (reviewed) markLeftReview();
    };
    const onKey = ev => { if (ev.key === "Escape") dismiss(false); };
    document.addEventListener("keydown", onKey);
    wrap.addEventListener("click", ev => { if (ev.target === wrap) dismiss(false); });
    wrap.querySelector(".tc-popup-close").addEventListener("click", () => dismiss(false));
    wrap.querySelector(".tc-popup-later").addEventListener("click", () => dismiss(false));
    const btn = wrap.querySelector(".tc-popup-btn");
    if (btn) { btn.addEventListener("click", () => setTimeout(() => dismiss(true), 0)); btn.focus(); }
    else wrap.querySelector(".tc-popup-later").focus();
  };

  // Force the pop-up open (used when someone tries to register without reviewing).
  window.requireReviewPopup = function () {
    if (hasLeftReview()) return false;
    if (popupCfg) { showSitePopup(popupCfg); return true; }
    if (!window.Popup) return true;
    Popup.get().then(p => {
      if (p && p.enabled) { popupCfg = p; showSitePopup(p); }
    }).catch(() => {});
    return true;
  };

  function startPopup() {
    if (NO_POPUP_PAGES.includes(page()) || !window.Popup) return;
    Auth.ready.then(() => {
      if (Auth.current()) return; // registered / logged-in visitors are never asked again
      if (hasLeftReview()) return;
      try { if (sessionStorage.getItem(SEEN_KEY) === "1") return; } catch { /* ignore */ }
      Popup.get().then(p => {
        if (!p || !p.enabled || !p.title.trim()) return;
        popupCfg = p;
        // Appear once, after 3 seconds only (admin can change the delay).
        const wait = Math.max(0, Number(p.delay) || 3) * 1000;
        setTimeout(() => {
          if (!hasLeftReview() && !Auth.current()) showSitePopup(p);
        }, wait);
      }).catch(() => { /* the pop-up is optional; never break the page */ });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    startPopup();
    addPasswordToggles();
    paintHeader(Auth.hint());          // instant first paint from the display hint
    renderFooter();
    Auth.ready.then(() => {            // then correct it from the real session
      const u = Auth.current();
      paintHeader(u ? { name: u.name, role: u.role } : null);
    });
  });
})();
