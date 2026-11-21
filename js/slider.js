/* Home page hero slideshow: crossfade, auto-advance, dots, arrows, pause.
 * Respects "reduce motion", pauses on hover/focus and when the tab is hidden. */
document.addEventListener("DOMContentLoaded", () => {
  const hero = document.querySelector(".hero");
  if (!hero) return;
  const slides = [...hero.querySelectorAll(".hero-slide")];
  if (slides.length < 2) return;

  const dotsBox = hero.querySelector(".hero-dots");
  const pauseBtn = hero.querySelector(".hero-pause");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const INTERVAL = 5500;
  let index = 0, timer = null, userPaused = reduce, hovering = false;

  const dots = slides.map((_, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hero-dot";
    b.setAttribute("aria-label", "Show picture " + (i + 1) + " of " + slides.length);
    b.addEventListener("click", () => { show(i); restart(); });
    dotsBox.appendChild(b);
    return b;
  });

  function show(i) {
    index = (i + slides.length) % slides.length;
    slides.forEach((s, n) => s.classList.toggle("active", n === index));
    dots.forEach((d, n) => n === index ? d.setAttribute("aria-current", "true") : d.removeAttribute("aria-current"));
  }

  const stop = () => { clearInterval(timer); timer = null; };
  const start = () => { stop(); if (!userPaused && !hovering && !document.hidden) timer = setInterval(() => show(index + 1), INTERVAL); };
  const restart = start;

  hero.querySelectorAll(".hero-arrow").forEach(a =>
    a.addEventListener("click", () => { show(index + Number(a.dataset.dir)); restart(); }));

  const syncPauseBtn = () => {
    pauseBtn.textContent = userPaused ? "Play" : "Pause";
    pauseBtn.setAttribute("aria-label", userPaused ? "Play slideshow" : "Pause slideshow");
  };
  pauseBtn.addEventListener("click", () => { userPaused = !userPaused; syncPauseBtn(); start(); });

  hero.addEventListener("mouseenter", () => { hovering = true; stop(); });
  hero.addEventListener("mouseleave", () => { hovering = false; start(); });
  document.addEventListener("visibilitychange", start);
  hero.addEventListener("keydown", ev => {
    if (ev.key === "ArrowLeft") { show(index - 1); restart(); }
    if (ev.key === "ArrowRight") { show(index + 1); restart(); }
  });

  syncPauseBtn();
  show(0);
  start();
});
