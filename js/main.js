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

  document.addEventListener("DOMContentLoaded", () => {
    paintHeader(Auth.hint());          // instant first paint from the display hint
    renderFooter();
    Auth.ready.then(() => {            // then correct it from the real session
      const u = Auth.current();
      paintHeader(u ? { name: u.name, role: u.role } : null);
    });
  });
})();
