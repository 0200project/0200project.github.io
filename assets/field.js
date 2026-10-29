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
 *     there is no camera to argue with. With `anchor`, the box is fitted to that
 *     element instead, so one canvas can be larger than the mark it draws.
 *   - Under prefers-reduced-motion the field renders FORMED and STILL. No
 *     convergence, no breathe, no cursor response. The shape is the point;
 *     the motion is optional.
 *   - No WebGL → the caller's fallback element is shown and nothing throws.
 *   - Hidden tab or scrolled away → the loop pauses. A particle field nobody
 *     can see should not spend a battery.
 *   - Accent points are the brand blue and stay the brand blue: normal alpha
 *     blending, never additive, so overlap does not whiten them.
 *
 * Glyph mode (`glyphs`): each point is drawn as a character sampled from a
 * texture atlas instead of a round dot, still one draw call. With `sources`,
 * each point starts at a position the caller reads from the page (the
 * characters of a hash, say) and travels from there into the shape; `stream`
 * adds that many copies that keep making the same trip, slowly, once the shape
 * has formed. Without these options the field behaves exactly as before.
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

/* One interleaved vertex per particle: target xy, start xy, phase, accent, jitter, glyph, stream. */
const STRIDE = 9;
function buildVertices(points, rand, extra) {
  const { phases, glyphIndex, streamOf, jitter = 1 } = extra;
  const n = points.length, m = streamOf.length, v = new Float32Array((n + m) * STRIDE);
  // per-point jitter first, then the scatter: the draw order the seed has always fed
  // (glyph mode passes jitter 0: a character keeps its size, so the type grid holds)
  for (let i = 0; i < n; i++) v[i * STRIDE + 6] = (rand() - 0.5) * 0.06 * jitter;
  // scattered start: a loose sphere, projected flat, so the mark reads as arriving
  for (let i = 0; i < n; i++) {
    const th = rand() * Math.PI * 2, ph = Math.acos(2 * rand() - 1), rr = 1.6 + rand() * 1.2;
    const o = i * STRIDE, p = points[i];
    v[o] = p[0]; v[o + 1] = p[1];
    v[o + 2] = rr * Math.sin(ph) * Math.cos(th); v[o + 3] = rr * Math.sin(ph) * Math.sin(th);
    v[o + 4] = rand(); v[o + 5] = p[2] ? 1 : 0;
    if (phases) v[o + 4] = phases[i];
    v[o + 7] = glyphIndex ? glyphIndex[i] : 0;
  }
  // stream copies: the same target, start and glyph as the point they copy, on their own clock
  for (let k = 0; k < m; k++) {
    const s = streamOf[k], o = (n + k) * STRIDE, src = s * STRIDE;
    for (let j = 0; j < STRIDE; j++) v[o + j] = v[src + j];
    v[o + 4] = rand(); v[o + 6] = 0; v[o + 8] = 1;
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
  uniform float uDrift;        // how far a formed point wanders; 0 holds the grid exactly
  uniform float uDpr;
  uniform float uSize;
  uniform float uStartSize;    // size at the start position, in css px
  uniform float uSourced;      // 1 when starts are read from the page: points appear as they leave
  uniform float uStreamRate;   // stream trips per second
  uniform vec2  uScale;        // world → clip, keeps the box centred and contained
  uniform vec2  uOffset;       // clip-space centre of the box
  uniform vec3  uAccent;
  uniform vec3  uInk;
  attribute vec2 aTarget;
  attribute vec2 aStart;
  attribute float aPhase;
  attribute float aAccent;
  attribute float aJit;
  attribute float aGlyph;
  attribute float aStream;
  varying vec3 vColor;
  varying float vFade;
  varying float vTwinkle;
  varying float vGlyph;
  varying float vShow;

  float ease(float t){ return t < 0.5 ? 4.0*t*t*t : 1.0 - pow(-2.0*t + 2.0, 3.0) / 2.0; }

  void main() {
    float p = ease(clamp(uProgress, 0.0, 1.0));
    // each particle arrives on its own schedule, so the mark resolves rather than snaps
    float mine = clamp((p - aPhase * 0.35) / 0.65, 0.0, 1.0);
    float travel = ease(mine);
    float show = 1.0;
    if (aStream > 0.5) {
      // a stream copy exists only once the mark has formed, and fades in leaving, out arriving
      float s = fract(uTime * uStreamRate + aPhase);
      travel = ease(s);
      show = uBreathe * step(0.999, uProgress) * smoothstep(0.02, 0.16, s) * (1.0 - smoothstep(0.82, 1.0, s)) * 0.6;
      mine = 1.0;
    } else if (uSourced > 0.5) {
      show = smoothstep(0.02, 0.22, mine);   // invisible while it still sits on its source
    }
    vec2 pos = mix(aStart, aTarget, travel);

    // ambient breathe: tiny, slow, per-particle phase
    float b = uBreathe * 0.012 * uDrift;
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
    vGlyph = aGlyph;
    vShow = show;
    // once formed, each point breathes in brightness on its own phase; idle scales it
    vTwinkle = 1.0 - 0.28 * uIdle * uBreathe * (0.5 + 0.5 * sin(uTime * 1.3 + aPhase * 6.2831)) * mine;
    gl_Position = vec4(pos * uScale + uOffset, 0.0, 1.0);
    float sz = uStartSize > 0.0 ? mix(uStartSize, uSize, travel) : uSize;
    gl_PointSize = sz * uDpr * (1.0 + push * 5.0) * (1.0 + aJit);
  }
`;

const FRAG_DOT = /* glsl */`
  precision mediump float;
  uniform float uAlpha;
  varying vec3 vColor;
  varying float vFade;
  varying float vTwinkle;
  varying float vShow;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c);
    if (d > 0.25) discard;
    float a = smoothstep(0.25, 0.0, d);          // soft round point
    a *= mix(0.25, 1.0, vFade) * uAlpha * vTwinkle * vShow;
    gl_FragColor = vec4(vColor, a);
  }
`;

/* The glyph is read from a square atlas of uCols × uCols cells; the point sprite is the cell. */
const FRAG_GLYPH = /* glsl */`
  precision mediump float;
  uniform float uAlpha;
  uniform float uCols;
  uniform sampler2D uAtlas;
  varying vec3 vColor;
  varying float vFade;
  varying float vTwinkle;
  varying float vGlyph;
  varying float vShow;
  void main() {
    float g = floor(vGlyph + 0.5);
    vec2 cell = vec2(mod(g, uCols), floor(g / uCols));
    float a = texture2D(uAtlas, (cell + gl_PointCoord) / uCols).a;
    a *= mix(0.25, 1.0, vFade) * uAlpha * vTwinkle * vShow;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

/* A power-of-two atlas of the glyphs, white on transparent, one per cell. */
function glyphAtlas(chars, font) {
  const cols = Math.ceil(Math.sqrt(chars.length)), cell = 64;
  let side = 1; while (side < cols * cell) side *= 2;
  const c = document.createElement('canvas'); c.width = c.height = side;
  const x = c.getContext('2d');
  if (!x) return null;
  x.fillStyle = x.strokeStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = font;
  // a hairline of stroke on top of the fill: at eight pixels a regular weight goes grey
  x.lineWidth = 1.6; x.lineJoin = 'round';
  const step = side / cols;
  for (let i = 0; i < chars.length; i++) {
    const gx = (i % cols + 0.5) * step, gy = (Math.floor(i / cols) + 0.54) * step;
    x.fillText(chars[i], gx, gy); x.strokeText(chars[i], gx, gy);
  }
  return { canvas: c, cols: side / step };
}

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
    preserveDrawingBuffer = false, seed = 2, cursor = true, idle = 1, drift = idle,
    // glyph mode and sourced starts (all optional)
    anchor = null, extent = 0, glyphs = null, glyphFont = '500 44px "Geist Mono", ui-monospace, monospace',
    glyphIndex = null, phases = null, sources = null, sizeUnits = 0, startSize = 0,
    stream = 0, streamRate = 0.1, converge = 2200,
  } = opts;
  // The fallback ships visible (for a page with no script) and is hidden by a page rule while
  // script runs; `show` is the class that puts it back.
  const revealFallback = () => {
    if (!fallback) return;
    const h = fallback.closest('[hidden]'); if (h) h.hidden = false;
    fallback.hidden = false; fallback.classList.add('show');
  };
  const showFallback = () => { revealFallback(); canvas.hidden = true; };
  const noop = { destroy() {}, refresh() {} };
  if (!points || !points.length) { showFallback(); return noop; }

  let gl = null;
  try {
    const attrs = { alpha: true, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: preserveDrawingBuffer === true };
    gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
  } catch (e) { gl = null; }
  if (!gl) { showFallback(); return noop; }

  const rand = mulberry32(seed), n = points.length;
  // stream copies are chosen after the base field, so a field without them draws as it always has
  const streamOf = [];
  const jitter = glyphs ? 0 : 1;
  const data = buildVertices(points, rand, { phases, glyphIndex, streamOf: [], jitter });
  let all = data;
  if (sources && stream > 0) {
    const pick = mulberry32(seed + 17);
    for (let k = 0; k < stream; k++) streamOf.push(Math.floor(pick() * n));
    all = buildVertices(points, mulberry32(seed), { phases, glyphIndex, streamOf, jitter });
  }
  const total = n + streamOf.length;
  const accentRgb = hexToRgb(accent), inkRgb = hexToRgb(ink);
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
  const atlas = glyphs ? glyphAtlas(glyphs, glyphFont) : null;
  if (glyphs && !atlas) { showFallback(); return noop; }

  // ── GL resources: built once, and again after a context restore ───────
  let prog = null, buf = null, tex = null, U = {};
  function build() {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, atlas ? FRAG_GLYPH : FRAG_DOT));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
    gl.useProgram(prog);
    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, all, gl.STATIC_DRAW);
    const B = STRIDE * 4;
    [['aTarget', 2, 0], ['aStart', 2, 8], ['aPhase', 1, 16], ['aAccent', 1, 20], ['aJit', 1, 24], ['aGlyph', 1, 28], ['aStream', 1, 32]].forEach(([name, sz, off]) => {
      const loc = gl.getAttribLocation(prog, name);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, sz, gl.FLOAT, false, B, off);
    });
    U = {};
    ['uTime', 'uProgress', 'uMouse', 'uMouseOn', 'uBreathe', 'uIdle', 'uDrift', 'uDpr', 'uSize', 'uStartSize', 'uSourced', 'uStreamRate', 'uScale', 'uOffset', 'uAccent', 'uInk', 'uAlpha', 'uCols', 'uAtlas']
      .forEach(k => { U[k] = gl.getUniformLocation(prog, k); });
    gl.uniform1f(U.uSize, size); gl.uniform1f(U.uAlpha, alpha);
    gl.uniform3fv(U.uAccent, accentRgb); gl.uniform3fv(U.uInk, inkRgb);
    gl.uniform1f(U.uBreathe, reducedMotion ? 0 : 1); gl.uniform1f(U.uIdle, idle); gl.uniform1f(U.uDrift, drift); gl.uniform1f(U.uProgress, reducedMotion ? 1 : 0);
    gl.uniform2f(U.uMouse, 99, 99); gl.uniform1f(U.uMouseOn, 0); gl.uniform1f(U.uTime, 0);
    gl.uniform1f(U.uSourced, sources ? 1 : 0); gl.uniform1f(U.uStreamRate, streamRate); gl.uniform1f(U.uStartSize, 0);
    gl.uniform2f(U.uOffset, 0, 0);
    if (atlas) {
      tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(U.uAtlas, 0); gl.uniform1f(U.uCols, atlas.cols);
    }
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND);
    // straight-alpha fragments into a premultiplied canvas: colour by SRC_ALPHA, coverage by ONE
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
  }

  // ── sizing: the ±1 box centred and contained, with a margin, on any aspect ──
  // (or fitted to the anchor element, wherever it sits inside the canvas)
  let bx = 0, by = 0, ppu = 1;
  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1, r = dpr();
    const pw = Math.max(1, Math.round(w * r)), ph = Math.max(1, Math.round(h * r));
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    gl.viewport(0, 0, pw, ph);
    let bs = Math.min(w, h); bx = w / 2; by = h / 2;
    if (anchor) {
      const a = anchor.getBoundingClientRect(), c = canvas.getBoundingClientRect();
      if (a.width > 0) { bx = a.left - c.left + a.width / 2; by = a.top - c.top + a.height / 2; bs = Math.min(a.width, a.height); }
    }
    const half = extent > 0 ? extent : 1 / Math.max(0.05, 1 - 2 * margin);
    ppu = bs / 2 / half;
    gl.uniform2f(U.uScale, 2 * ppu / w, 2 * ppu / h);
    gl.uniform2f(U.uOffset, 2 * bx / w - 1, 1 - 2 * by / h);
    gl.uniform1f(U.uDpr, r);
    if (sizeUnits > 0) gl.uniform1f(U.uSize, sizeUnits * ppu);
    if (sources) {
      // the starts are where the page says they are, in this canvas, now
      const s = sources();
      if (s && s.length === n) {
        for (let i = 0; i < total; i++) {
          const src = i < n ? i : streamOf[i - n], o = i * STRIDE;
          all[o + 2] = (s[src][0] - bx) / ppu; all[o + 3] = -(s[src][1] - by) / ppu;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, all, gl.STATIC_DRAW);
      }
      gl.uniform1f(U.uStartSize, typeof startSize === 'function' ? startSize() : startSize);
    }
  }

  // ── cursor (world units, the same box the points live in) ────────────
  let tx = 99, ty = 99, mx = 99, my = 99, mouseOn = 0, mouseOnTarget = 0;
  function toWorld(cx, cy) {
    const b = canvas.getBoundingClientRect();
    tx = (cx - b.left - bx) / ppu;
    ty = -(cy - b.top - by) / ppu;
  }
  const onMove = e => { toWorld(e.clientX, e.clientY); mouseOnTarget = 1; };
  const onLeave = () => { mouseOnTarget = 0; };
  // The stage is pointer-events:none, so the listeners live on the section the caller names.
  const host = hostOpt || canvas.closest('section') || canvas.parentElement || canvas;

  // ── loop ──────────────────────────────────────────────────────────────
  let raf = 0, t0 = performance.now(), running = false, formedAt = null, onScreen = true, time = 0, introPending = false;
  const CONVERGE_MS = converge;
  function draw() {
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.POINTS, 0, total);
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
  // Measured on the host, not the canvas: the canvas may be transformed past the host's clip,
  // where its own rect says "on screen" while nothing of it can be seen.
  const seeable = () => { if (document.hidden) return false; const r = host.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight; };
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
    if (anchor) ro.observe(anchor);
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
  // mark is formed within a second and a half of when it should have been. On a normal screen
  // the loop gets there first and this never fires.
  const formedNet = setTimeout(() => {
    if (formedAt !== null || reducedMotion) return;
    gl.uniform1f(U.uProgress, 1); draw(); introPending = false; formedAt = performance.now();
    canvas.dispatchEvent(new CustomEvent('field:formed'));
  }, Math.max(4000, CONVERGE_MS + 1500));

  // A still image is fine when nobody is looking: hidden tab, or hero scrolled away.
  const onVis = () => { if (document.hidden) stop(); else go(); };
  document.addEventListener('visibilitychange', onVis);
  // The observer is the authority. seeable() only covers a first report made before layout,
  // when the canvas has no box yet to intersect with.
  io = new IntersectionObserver(([e]) => {
    onScreen = e.isIntersecting || (e.boundingClientRect.height === 0 && seeable());
    if (!onScreen) stop(); else go();
  });
  io.observe(canvas);

  // Mid-session context loss (GPU reset, too many contexts): show the static image, and
  // put the canvas back when the browser restores it.
  const onLost = ev => { ev.preventDefault(); stop(); revealFallback(); };
  const onRestored = () => { try { build(); resize(); } catch (e) { showFallback(); return; } if (fallback) { fallback.hidden = true; fallback.classList.remove('show'); } go(); };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  return {
    // Layout moved without the canvas resizing (webfonts landed, a column reflowed): re-read it.
    refresh() { try { resize(); if (reducedMotion || !running) draw(); } catch (e) { /* the next resize retries */ } },
    destroy() {
      stop(); clearTimeout(formedNet); ro.disconnect(); io.disconnect();
      host.removeEventListener('pointermove', onMove); host.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored);
      if (buf) gl.deleteBuffer(buf); if (prog) gl.deleteProgram(prog); if (tex) gl.deleteTexture(tex);
      // Release the GPU context, then hide the canvas: Chrome paints a canvas whose
      // context has been lost as an opaque white rectangle, not as transparent.
      const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
      canvas.hidden = true;
    },
  };
}
