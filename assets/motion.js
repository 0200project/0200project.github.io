/* motion.js — the scroll feel on every page: smooth scroll, and blocks that settle into
   place as they come into view, with one soft fade-and-rise, once (the same move as the
   facts on /xo2/). The move is played on the clock, not scrubbed by the scroll, and it is
   only applied while it plays: a block's resting state is the block itself, fully drawn,
   so wherever the page stops, everything on screen is complete. A block already in sight
   when it is first met (the first screen, a jump to an anchor, a restored position) does
   not move.
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
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { ScrollTrigger.refresh(); });

  if (!('IntersectionObserver' in window) || !Element.prototype.animate) return;
  var LIVE = '#live-panel, #chain, #pay-panel, #pass-wallet-panel, #pr-success, #pg-out, #pg-body, .pg-wrap, .status-banner, .status-body, form';
  var SEL = '.section-head, .card, .prop, .row, .log-entry, .pr-card, .tool-featured, .directory > *, .grid-3 > *, .grid-2 > *, .codeblock, .table-wrap, .docs-content > h2';
  var RISE = [{ opacity: 0, transform: 'translateY(1.5rem)' }, { opacity: 1, transform: 'none' }];
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      // it rises into view only while it is still below the screen's edge; once in sight, it stays put
      if (e.boundingClientRect.top < window.innerHeight) return;
      e.target.animate(RISE, { duration: 1200, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'backwards' });
    });
  }, { rootMargin: '0px 0px 48px 0px' });
  var seen = [];
  Array.prototype.forEach.call(document.querySelectorAll(SEL), function (el) {
    if (el.closest(LIVE) || el.querySelector(LIVE)) return;
    if (seen.some(function (s) { return s.contains(el) || el.contains(s); })) return;
    var r = el.getBoundingClientRect();
    if (!r.height) return;
    // Already on the first screen when the page opened: it is at rest, it does not arrive.
    if (r.top < window.innerHeight) return;
    seen.push(el);
    io.observe(el);
  });
})();
