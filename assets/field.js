/* field.js — the 0200project mark as a particle field.
 *
 * One engine, one input: a pre-sampled point cloud ([x, y, isAccent] in a
 * -1..1 box) taken from the real mark PNGs — /assets/logo-512.png for the brand
 * mark, /assets/xo2-512.png for the coin. Raw WebGL1, no imports, no library:
 * the whole thing is one program, one buffer, one draw call. The rules:
 *
 *   - Particles start scattered and CONVERGE onto the shape once, on load.
 *     That is the only choreographed moment. After it, motion is ambient:
 *     a slow breathe, and displacement around the cursor.
 *   - The -1..1 box is centred in the canvas and scaled to fit inside it, with
 *     a margin on every side, on any aspect. The canvas's own box IS the layout;
 *     there is no camera to argue with.
 *   - Under prefers-reduced-motion the field renders FORMED and STILL. No
 *     convergence, no breathe, no cursor response. The shape is the point;
 *     the motion is optional.
 *   - No WebGL → the caller's fallback element is shown and nothing throws.
 *   - Hidden tab or scrolled away → the loop pauses. A particle field nobody
 *     can see should not spend a battery.
 *   - Accent points are the brand blue and stay the brand blue: normal alpha
 *     blending, never additive, so overlap does not whiten them.
 *
 * Nothing here asserts anything about the product. It is a picture of the logo.
 */

/* Deterministic PRNG so the field looks identical on every load. */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* '#rgb' or '#rrggbb' → [r, g, b] in 0..1. */
function hexToRgb(hex) {
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3) h = h.replace(/./g, c => c + c);
  const v = parseInt(h, 16);
  return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
}

/* One interleaved vertex per particle: target xy, start xy, phase, accent, jitter. */
const STRIDE = 7;
function buildVertices(points, rand) {
  const n = points.length, v = new Float32Array(n * STRIDE);
  // per-point jitter first, then the scatter: the draw order the seed has always fed
  for (let i = 0; i < n; i++) v[i * STRIDE + 6] = (rand() - 0.5) * 0.06;
  // scattered start: a loose sphere, projected flat, so the mark reads as arriving
  for (let i = 0; i < n; i++) {
    const th = rand() * Math.PI * 2, ph = Math.acos(2 * rand() - 1), rr = 1.6 + rand() * 1.2;
    const o = i * STRIDE, p = points[i];
    v[o] = p[0]; v[o + 1] = p[1];
    v[o + 2] = rr * Math.sin(ph) * Math.cos(th); v[o + 3] = rr * Math.sin(ph) * Math.sin(th);
    v[o + 4] = rand(); v[o + 5] = p[2] ? 1 : 0;
  }
  return v;
}

const VERT = /* glsl */`
  uniform float uTime;
  uniform float uProgress;     // 0 scattered → 1 formed
  uniform vec2  uMouse;        // world units
  uniform float uMouseOn;
  uniform float uBreathe;      // 0 under reduced motion
  uniform float uIdle;         // how alive the formed mark stays: 1 is a whisper
  uniform float uDpr;
  uniform float uSize;
  uniform vec2  uScale;        // world → clip, keeps the box centred and contained
  uniform vec3  uAccent;
  uniform vec3  uInk;
  attribute vec2 aTarget;
  attribute vec2 aStart;
  attribute float aPhase;
  attribute float aAccent;
  attribute float aJit;
  varying vec3 vColor;
  varying float vFade;
  varying float vTwinkle;

  float ease(float t){ return t < 0.5 ? 4.0*t*t*t : 1.0 - pow(-2.0*t + 2.0, 3.0) / 2.0; }

  void main() {
    float p = ease(clamp(uProgress, 0.0, 1.0));
    // each particle arrives on its own schedule, so the mark resolves rather than snaps
    float mine = clamp((p - aPhase * 0.35) / 0.65, 0.0, 1.0);
    vec2 pos = mix(aStart, aTarget, ease(mine));

    // ambient breathe: tiny, slow, per-particle phase
    float b = uBreathe * 0.012 * uIdle;
    pos.x += sin(uTime * 0.6 + aPhase * 6.2831) * b;
    pos.y += cos(uTime * 0.5 + aPhase * 6.2831 * 1.7) * b;

    // cursor: displace outward within a radius, fall off smoothly
    vec2 d = pos - uMouse;
    float dist = length(d);
    float r = 0.28;
    float push = uMouseOn * smoothstep(r, 0.0, dist) * 0.16;
    pos += normalize(d + 0.0001) * push;

    vColor = mix(uInk, uAccent, aAccent);
    vFade = mine;
    // once formed, each point breathes in brightness on its own phase; idle scales it
    vTwinkle = 1.0 - 0.28 * uIdle * uBreathe * (0.5 + 0.5 * sin(uTime * 1.3 + aPhase * 6.2831)) * mine;
    gl_Position = vec4(pos * uScale, 0.0, 1.0);
    gl_PointSize = uSize * uDpr * (1.0 + push * 5.0) * (1.0 + aJit);
  }
`;

const FRAG = /* glsl */`
  precision mediump float;
  uniform float uAlpha;
  varying vec3 vColor;
  varying float vFade;
  varying float vTwinkle;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c);
    if (d > 0.25) discard;
    float a = smoothstep(0.25, 0.0, d);          // soft round point
    a *= mix(0.25, 1.0, vFade) * uAlpha * vTwinkle;
    gl_FragColor = vec4(vColor, a);
  }
`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
  return s;
}

export function mountField(canvas, opts = {}) {
  const {
    points = null, host: hostOpt = null, reducedMotion = false, fallback = null,
    size = 5, alpha = 0.9, accent = '#0350fd', ink = '#ffffff', margin = 0.06,
    preserveDrawingBuffer = false, seed = 2, cursor = true, idle = 1,
  } = opts;
  const showFallback = () => {
    if (fallback) { const h = fallback.closest('[hidden]'); if (h) h.hidden = false; fallback.hidden = false; }
    canvas.hidden = true;
  };
  const noop = { destroy() {} };
  if (!points || !points.length) { showFallback(); return noop; }

  let gl = null;
  try {
    const attrs = { alpha: true, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: preserveDrawingBuffer === true };
    gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
  } catch (e) { gl = null; }
  if (!gl) { showFallback(); return noop; }

  const data = buildVertices(points, mulberry32(seed));
  const n = points.length;
  const accentRgb = hexToRgb(accent), inkRgb = hexToRgb(ink);
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

  // ── GL resources: built once, and again after a context restore ───────
  let prog = null, buf = null, U = {};
  function build() {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
    gl.useProgram(prog);
    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const B = STRIDE * 4;
    [['aTarget', 2, 0], ['aStart', 2, 8], ['aPhase', 1, 16], ['aAccent', 1, 20], ['aJit', 1, 24]].forEach(([name, sz, off]) => {
      const loc = gl.getAttribLocation(prog, name);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, sz, gl.FLOAT, false, B, off);
    });
    U = {};
    ['uTime', 'uProgress', 'uMouse', 'uMouseOn', 'uBreathe', 'uIdle', 'uDpr', 'uSize', 'uScale', 'uAccent', 'uInk', 'uAlpha']
      .forEach(k => { U[k] = gl.getUniformLocation(prog, k); });
    gl.uniform1f(U.uSize, size); gl.uniform1f(U.uAlpha, alpha);
    gl.uniform3fv(U.uAccent, accentRgb); gl.uniform3fv(U.uInk, inkRgb);
    gl.uniform1f(U.uBreathe, reducedMotion ? 0 : 1); gl.uniform1f(U.uIdle, idle); gl.uniform1f(U.uProgress, reducedMotion ? 1 : 0);
    gl.uniform2f(U.uMouse, 99, 99); gl.uniform1f(U.uMouseOn, 0); gl.uniform1f(U.uTime, 0);
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND);
    // straight-alpha fragments into a premultiplied canvas: colour by SRC_ALPHA, coverage by ONE
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
  }

  // ── sizing: the ±1 box centred and contained, with a margin, on any aspect ──
  let halfW = 1, halfH = 1;
  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1, r = dpr();
    const pw = Math.max(1, Math.round(w * r)), ph = Math.max(1, Math.round(h * r));
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    gl.viewport(0, 0, pw, ph);
    const half = 1 / Math.max(0.05, 1 - 2 * margin), aspect = w / h;
    halfW = aspect >= 1 ? half * aspect : half;
    halfH = aspect >= 1 ? half : half / aspect;
    gl.uniform2f(U.uScale, 1 / halfW, 1 / halfH);
    gl.uniform1f(U.uDpr, r);
  }

  // ── cursor (world units, the same box the points live in) ────────────
  let tx = 99, ty = 99, mx = 99, my = 99, mouseOn = 0, mouseOnTarget = 0;
  function toWorld(cx, cy) {
    const b = canvas.getBoundingClientRect();
    tx = (((cx - b.left) / b.width) * 2 - 1) * halfW;
    ty = -(((cy - b.top) / b.height) * 2 - 1) * halfH;
  }
  const onMove = e => { toWorld(e.clientX, e.clientY); mouseOnTarget = 1; };
  const onLeave = () => { mouseOnTarget = 0; };
  // The stage is pointer-events:none, so the listeners live on the section the caller names.
  const host = hostOpt || canvas.closest('section') || canvas.parentElement || canvas;

  // ── loop ──────────────────────────────────────────────────────────────
  let raf = 0, t0 = performance.now(), running = false, formedAt = null, onScreen = true, time = 0, introPending = false;
  const CONVERGE_MS = 2200;
  function draw() {
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.POINTS, 0, n);
  }
  function frame(now) {
    if (!running) return;
    time = (now - t0) / 1000;
    gl.uniform1f(U.uTime, time);
    const p = Math.min(1, (now - t0) / CONVERGE_MS);
    gl.uniform1f(U.uProgress, p);
    if (p === 1 && formedAt === null) { formedAt = now; canvas.dispatchEvent(new CustomEvent('field:formed')); }
    mx += (tx - mx) * 0.12; my += (ty - my) * 0.12;
    mouseOn += (mouseOnTarget - mouseOn) * 0.08;
    gl.uniform2f(U.uMouse, mx, my);
    gl.uniform1f(U.uMouseOn, mouseOn);
    draw();
    raf = requestAnimationFrame(frame);
  }
  const seeable = () => { if (document.hidden) return false; const r = canvas.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight; };
  const stop = () => {
    running = false; cancelAnimationFrame(raf);
    // Interrupted before the mark formed (tab hidden, hero scrolled away): leave the FORMED
    // mark as the still frame, and run the intro again when it is next looked at. Never paint
    // that still on a canvas someone can see: the observer's first report can precede layout,
    // and a formed mark that then scatters and re-forms reads as a flash.
    if (!reducedMotion && formedAt === null && !seeable()) { gl.uniform1f(U.uProgress, 1); draw(); introPending = true; }
  };
  const go = () => {
    if (reducedMotion) { draw(); return; }
    if (running || !onScreen || document.hidden) return;
    if (introPending) { introPending = false; time = 0; formedAt = null; gl.uniform1f(U.uProgress, 0); }
    running = true; t0 = performance.now() - time * 1000; raf = requestAnimationFrame(frame);
  };

  let ro = null, io = null;
  try {
    build();
    resize();
    ro = new ResizeObserver(() => { resize(); if (reducedMotion) draw(); });
    ro.observe(canvas);
    if (reducedMotion) {
      // Formed and still: one frame, and one more whenever the canvas is resized. No loop.
      draw();
      canvas.dispatchEvent(new CustomEvent('field:formed'));
    } else {
      if (cursor) {
        host.addEventListener('pointermove', onMove, { passive: true });
        host.addEventListener('pointerleave', onLeave, { passive: true });
      }
      if (document.hidden) {
        // Mounted in a tab nobody can see (prerender, thumbnail, background tab): show the
        // FORMED mark as the still frame, and run the convergence the first time it is looked at.
        gl.uniform1f(U.uProgress, 1); draw(); introPending = true;
      } else {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    }
  } catch (e) { if (ro) ro.disconnect(); showFallback(); return noop; }

  // Whatever drives the clock (a throttled tab, a prerender with no animation frames), the
  // mark is formed within four seconds of mounting. On a normal screen the loop gets there
  // at 2.2s and this never fires.
  const formedNet = setTimeout(() => {
    if (formedAt !== null || reducedMotion) return;
    gl.uniform1f(U.uProgress, 1); draw(); introPending = false; formedAt = performance.now();
    canvas.dispatchEvent(new CustomEvent('field:formed'));
  }, 4000);

  // A still image is fine when nobody is looking: hidden tab, or hero scrolled away.
  const onVis = () => { if (document.hidden) stop(); else go(); };
  document.addEventListener('visibilitychange', onVis);
  io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting || seeable(); if (!onScreen) stop(); else go(); });
  io.observe(canvas);

  // Mid-session context loss (GPU reset, too many contexts): show the static image, and
  // put the canvas back when the browser restores it.
  const onLost = ev => { ev.preventDefault(); stop(); if (fallback) { const h = fallback.closest('[hidden]'); if (h) h.hidden = false; fallback.hidden = false; } };
  const onRestored = () => { try { build(); resize(); } catch (e) { showFallback(); return; } if (fallback) fallback.hidden = true; go(); };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  return {
    destroy() {
      stop(); clearTimeout(formedNet); ro.disconnect(); io.disconnect();
      host.removeEventListener('pointermove', onMove); host.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored);
      if (buf) gl.deleteBuffer(buf); if (prog) gl.deleteProgram(prog);
      // Release the GPU context, then hide the canvas: Chrome paints a canvas whose
      // context has been lost as an opaque white rectangle, not as transparent.
      const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
      canvas.hidden = true;
    },
  };
}
