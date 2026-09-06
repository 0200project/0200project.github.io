/* motion.js — the scroll feel on every page: smooth scroll, and blocks that settle into
   place as they enter, reading their position from the scroll and reversing with it.
   Nothing here waits on a timer, so the page is complete at rest at any scroll position.
   Skipped under prefers-reduced-motion, on a page that runs its own choreography
   (body[data-motion="own"]), and for every live region: panels that read the chain or the
   API, payment surfaces, forms. Those are never animated. */
(function () {
  'use strict';
  if (document.body.dataset.motion === 'own') return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!window.gsap || !window.ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);

  if (window.Lenis && !window.__lenis) {
    var lenis = new Lenis({ lerp: 0.085, smoothWheel: true });
    window.__lenis = lenis;
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
  }

  var LIVE = '#live-panel, #chain, #pay-panel, #pass-wallet-panel, #pr-success, #pg-out, #pg-body, .pg-wrap, .status-banner, .status-body, form';
  var SEL = '.section-head, .card, .prop, .row, .log-entry, .pr-card, .tool-featured, .directory > *, .grid-3 > *, .grid-2 > *, .codeblock, .table-wrap, .docs-content > h2';
  var seen = [];
  gsap.utils.toArray(SEL).forEach(function (el) {
    if (el.closest(LIVE) || el.querySelector(LIVE)) return;
    if (seen.some(function (s) { return s.contains(el) || el.contains(s); })) return;
    var r = el.getBoundingClientRect();
    if (!r.height) return;
    // Already on the first screen when the page opened: it is at rest, it does not arrive.
    if (r.top + window.scrollY < window.scrollY + window.innerHeight) return;
    seen.push(el);
    gsap.from(el, { y: 24, opacity: 0, ease: 'none', scrollTrigger: { trigger: el, start: 'top 96%', end: 'top 76%', scrub: true } });
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
})();
