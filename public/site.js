// Úvodní stránka: skóre v hlavičce přibývá s každou „vyhranou“ sekcí; sekce se při scrollu odhalí.
(function () {
  const root = document.documentElement;
  const score = document.querySelector('[data-score]');
  const points = document.querySelectorAll('[data-point]');
  if (!('IntersectionObserver' in window) || !score) return;

  root.classList.add('js');
  let us = 0;
  const seen = new WeakSet();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting || seen.has(e.target)) continue;
        seen.add(e.target);
        e.target.classList.add('in');
        us++;
        score.textContent = String(us).padStart(2, '0');
        score.classList.remove('bump');
        void score.offsetWidth; // restart animace
        score.classList.add('bump');
      }
    },
    { threshold: 0.35 },
  );
  points.forEach((p) => io.observe(p));
})();
