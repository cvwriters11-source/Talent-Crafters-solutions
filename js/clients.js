/* Home page logo slider: two rows gliding in opposite directions, fading at the edges,
 * pausing on hover.
 *
 * TWO MODES
 *  - No client logos listed below  ->  "Sectors we recruit for" (icon tiles, safe for everyone).
 *  - One or more logos listed      ->  "Companies we work with" (your client logos).
 *
 * HOW TO ADD A CLIENT LOGO
 *  1. Save the official logo file in the folder  images/clients/  (PNG, SVG or JPG; a
 *     transparent background and about 300px wide works best). Get it from the company
 *     itself (its brand / media page or your contact there), with permission to use it.
 *  2. Add a line below, for example:
 *       { name: "Acme Holdings", logo: "images/clients/acme.png", url: "https://acme.co.za" },
 *     ("url" is optional; leave it out if the logo should not link anywhere.)
 *  3. Upload the changed files to the website.
 *
 * Only list a company if it is a real client or partner that has agreed to be shown.
 */
window.CLIENTS = [
  // { name: "Company name", logo: "images/clients/company.png", url: "https://company.co.za" },
];

const SECTORS = [
  ["🏦", "Banking & Finance"], ["⛏️", "Mining & Resources"], ["🚗", "Automotive"], ["🏭", "Manufacturing"],
  ["🥫", "Food & Beverage"], ["💻", "IT & Software"], ["⚙️", "Engineering"], ["📣", "Sales & Marketing"],
  ["👥", "Human Resources"], ["🏗️", "Construction"], ["🚚", "Logistics"], ["🩺", "Healthcare"],
  ["🎧", "Customer Service"], ["🗂️", "Administration"]
];

document.addEventListener("DOMContentLoaded", async () => {
  const section = document.getElementById("clients");
  const box = document.getElementById("client-logos");
  if (!section || !box) return;

  const safeHttp = u => /^https?:\/\//i.test(u || "");
  const safeImg = u => /^(images\/|https:\/\/)[^"'<>\s]+$/i.test(u || "");
  const list = (window.CLIENTS || []).filter(c => c && c.name && safeImg(c.logo));
  const MIN_PER_SET = 8; // enough tiles that one set always fills a wide screen

  const sectorTile = ([icon, label]) => {
    const item = document.createElement("div");
    item.className = "client-logo sector";
    const i = document.createElement("span"); i.className = "sector-icon"; i.textContent = icon; i.setAttribute("aria-hidden", "true");
    const t = document.createElement("span"); t.textContent = label;
    item.append(i, t);
    return item;
  };

  const logoTile = c => {
    const item = document.createElement("div");
    item.className = "client-logo";
    const img = document.createElement("img");
    img.src = c.logo; img.alt = c.name; img.loading = "lazy"; img.decoding = "async";
    if (safeHttp(c.url)) {
      const a = document.createElement("a");
      a.href = c.url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.title = c.name;
      a.appendChild(img);
      item.appendChild(a);
    } else {
      item.appendChild(img);
    }
    return item;
  };

  // Repeat the tiles until a set is long enough, then double it so the loop is seamless.
  function buildRow(items, makeTile, reverse, seconds) {
    const set = [];
    while (set.length < MIN_PER_SET) items.forEach(c => set.push(c));
    const row = document.createElement("div");
    row.className = "logo-row" + (reverse ? " reverse" : "");
    const track = document.createElement("div");
    track.className = "logo-track";
    track.style.setProperty("--dur", seconds + "s");
    [false, true].forEach(clone => set.forEach(c => {
      const t = makeTile(c);
      if (clone) { t.setAttribute("aria-hidden", "true"); t.querySelectorAll("a").forEach(a => a.tabIndex = -1); }
      track.appendChild(t);
    }));
    row.appendChild(track);
    return row;
  }

  function render(items, makeTile) {
    box.textContent = "";
    box.classList.add("logo-marquee");
    box.appendChild(buildRow(items, makeTile, false, 42));
    // A second, opposite-moving row (different order) when there is variety to show
    if (items.length !== 1) {
      const half = Math.ceil(items.length / 2);
      box.appendChild(buildRow(items.slice(half).concat(items.slice(0, half)), makeTile, true, 52));
    }
    section.hidden = false;
  }

  if (list.length) {
    document.getElementById("clients-title").textContent = "Companies we work with";
    document.getElementById("clients-sub").textContent = "Proud to partner with these organisations.";
    return render(list, logoTile);
  }

  document.getElementById("clients-title").textContent = "Sectors we recruit for";
  document.getElementById("clients-sub").textContent = "Specialist recruitment across South Africa's key industries.";
  render(SECTORS, sectorTile);

  // Reminder for the admin only
  try { await Auth.ready; } catch { return; }
  if (Auth.isAdmin()) document.getElementById("clients-admin-note").hidden = false;
});
