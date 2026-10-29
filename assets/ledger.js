/* The hero's field. The docs example's hash, and its bits, written along rails that recede
   into the dark: every rail runs to one vanishing point just past the mark's right edge, so
   the type gets smaller, closer-set and fainter the further it goes. It lives inside the
   mark's footprint, weighted to its right side, the blue square and the one below it; the
   left squares carry at most a trace, and the copy and the gap before the mark stay black.
   It is shot with a shallow depth of field focused on the mark's plane, so only the stretch
   of each rail that passes the mark's right half is sharp; nearer and further it is out of
   focus.

   Every glyph stands upright on a wall that recedes: its baseline runs to the vanishing
   point, its width foreshortens with the wall and its height with distance. Blur is
   pre-rendered into one atlas, a row per depth-of-field level, and each glyph cross-fades
   between its two nearest rows. One WebGL2 context, one instanced draw per frame; the
   per-glyph maths is all in the vertex shader. */

const GLYPHS = 'x0123456789abcdef ';
const LV = [0, .035, .075, .13, .21, .32, .46];   // blur sigma, as a fraction of the font size
const FB = 32;                                     // atlas font size, in atlas pixels

function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

function buildAtlas(family) {
  const n = GLYPHS.length - 1;                     // the space is never drawn
  const rows = LV.map(b => { const sg = b * FB, pad = Math.ceil(sg * 2.7) + 3; return { sg, w: Math.ceil(FB * .8) + 2 * pad, h: Math.ceil(FB * 1.1) + 2 * pad }; });
  const cv = document.createElement('canvas');
  cv.width = Math.max(...rows.map(r => r.w)) * n; cv.height = rows.reduce((a, r) => a + r.h, 0);
  const x = cv.getContext('2d');
  x.font = `400 ${FB}px ${family}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff';
  let y = 0;
  for (const r of rows) {
    r.y = y;
    for (let g = 0; g < n; g++) {
      const cx = g * r.w + r.w / 2, cy = y + r.h / 2;
      if (r.sg > 0) {
        // a canvas shadow is a Gaussian blur with sigma = shadowBlur / 2, and it works everywhere
        x.shadowColor = '#fff'; x.shadowBlur = r.sg * 2; x.shadowOffsetX = 8192;
        x.fillText(GLYPHS[g], cx - 8192, cy);
        x.shadowBlur = 0; x.shadowOffsetX = 0;
      } else x.fillText(GLYPHS[g], cx, cy);
    }
    y += r.h;
  }
  const adv = [...GLYPHS].map(ch => x.measureText(ch).width / FB);
  return { cv, rows, adv };
}

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aQ;
layout(location=1) in vec4 aRail;   // angle, distance from the vanishing point at the mark's plane (mark sizes), window near, far
layout(location=2) in vec4 aChar;   // position (em), rail period (em), speed (em/s), phase (em)
layout(location=3) in vec4 aLook;   // glyph, blue, alpha, lit
uniform vec2 uRes, uVP, uAtlas;
uniform float uMs, uH1, uKap, uAp, uDz, uZN, uT, uZf, uIntro;
uniform vec4 uMask;                 // copy right, copy top, stacked, -
uniform vec4 uFoot;                 // the mark as drawn: left, top, right, bottom (css px)
uniform float uLV[7];
uniform vec3 uCell[7];              // per level: atlas y, cell w, cell h (atlas px)
out vec2 vUV0, vUV1, vOff;
flat out vec2 vHalf0;
flat out float vF, vA, vBlue, vFar, vBehind;
float ss(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
void cull() { gl_Position = vec4(2., 2., 2., 1.); vA = 0.; vF = 0.; vBlue = 0.; vFar = 0.; vBehind = 0.; vHalf0 = vec2(0.); vUV0 = vUV1 = vOff = vec2(0.); }
void main() {
  float e = mod(aChar.x + aChar.w + uT * aChar.z, aChar.y);
  float z = uZN + e * uDz;
  float wz = ss(uZN, uZN * (uMask.z > .5 ? 3. : 2.2), z) * ss(aRail.z - .1, aRail.z + .25, z) * ss(aRail.w + .6, aRail.w - .8, z) * exp(-max(0., z - 1.) * .62);
  vec2 dir = vec2(cos(aRail.x), sin(aRail.x));
  float iz = 1. / z;
  vec2 P = uVP + dir * aRail.y * uMs * iz;
  float fs = uH1 * iz;
  // the field is the mark's: inside its footprint, rising from a trace over the left squares
  // to full over the right ones, and on past its right edge to the vanishing point. The copy,
  // and the gap between the copy and the mark, are dark.
  float fw = uFoot.z - uFoot.x;
  float m = ss(uFoot.x + fw * .36, uFoot.x + fw * .74, P.x)
          * ss(uFoot.y - fw * .05, uFoot.y + fw * .09, P.y) * ss(uFoot.w + fw * .05, uFoot.w - fw * .09, P.y);
  if (uMask.z > .5) m *= 1. - ss(uMask.y - uRes.y * .05, uMask.y, P.y);
  else m *= ss(uMask.x, uMask.x + uRes.x * .04, P.x);
  // gathered into the mark's right half, the rails are close-set, so each is kept quiet
  float a = (uMask.z > .5 ? .21 : .19) * aLook.z * wz * m * uIntro * (aLook.w > .5 ? 2.1 : 1.);
  if (a < .003 || fs < 1.3 || P.x < -200. || P.x > uRes.x + 200. || P.y < -200. || P.y > uRes.y + 200.) { cull(); return; }
  // circle of confusion for a lens focused at uZf, as a fraction of the glyph's size
  float coc = uAp * abs(z - uZf) * iz, beta = coc / fs;
  int l = 0;
  for (int i = 0; i < 6; i++) if (uLV[i + 1] <= beta) l = i + 1;
  int l1 = min(l + 1, 6);
  float f = l < 6 ? clamp((beta - uLV[l]) / (uLV[l + 1] - uLV[l]), 0., 1.) : 0.;
  if (l == 6) { a *= min(1., pow(uLV[6] / beta, 1.4)); l1 = 6; }
  if (a < .003) { cull(); return; }
  vec3 c0 = uCell[l], c1 = uCell[l1];
  // the quad covers the larger of the two cells; offsets are in atlas px from the glyph's centre
  vec2 off = aQ * c1.yz * .5;
  vOff = off; vHalf0 = c0.yz * .5;
  vUV0 = (vec2(aLook.x * c0.y + c0.y * .5, c0.x + c0.z * .5) + off) / uAtlas;
  vUV1 = (vec2(aLook.x * c1.y + c1.y * .5, c1.x + c1.z * .5) + off) / uAtlas;
  vF = f; vA = a; vBlue = aLook.y; vFar = ss(1.1, 4.5, z); vBehind = ss(.97, 1.08, z);
  // upright on a receding wall: the baseline runs to the vanishing point, foreshortened
  float fr = min(1.25, length(P - uVP) * uKap);
  vec2 hx = -dir * fr * fs / ${FB.toFixed(1)}, vy = vec2(0., fs / ${FB.toFixed(1)});
  vec2 S = P + hx * off.x + vy * off.y;
  gl_Position = vec4(S.x / uRes.x * 2. - 1., 1. - S.y / uRes.y * 2., 0., 1.);
}`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uDpr;
uniform vec4 uGlass;     // the blue square: centre, half size (css px)
uniform float uGlassR;
in vec2 vUV0, vUV1, vOff;
flat in vec2 vHalf0;
flat in float vF, vA, vBlue, vFar, vBehind;
out vec4 o;
void main() {
  float a0 = texture(uTex, vUV0).a * float(all(lessThan(abs(vOff), vHalf0)));
  float a1 = texture(uTex, vUV1).a;
  float k = mix(a0, a1, vF) * vA;
  // distance cools the type towards the blue, the way air does
  vec3 c = mix(mix(vec3(1.), vec3(.62, .76, 1.), vFar * .8), vec3(.306, .62, 1.), vBlue);
  // seen through the blue square, what passes behind the mark's plane takes its colour
  vec2 p = vec2(gl_FragCoord.x / uDpr, uRes.y - gl_FragCoord.y / uDpr);
  vec2 q = abs(p - uGlass.xy) - (uGlass.zw - uGlassR);
  float sd = length(max(q, 0.)) + min(max(q.x, q.y), 0.) - uGlassR;
  float gs = (1. - smoothstep(-1., 1., sd)) * vBehind;
  c = mix(c, vec3(.36, .66, 1.), gs);
  k *= 1. + gs * .7;
  o = vec4(c * k, k);
}`;

export function mountLedger(o) {
  const { host, canvas, anchor, copy, hash, reduced = false } = o;
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  if (!gl) throw new Error('webgl2');
  const family = '"Geist", system-ui, -apple-system, "Segoe UI", sans-serif';
  const bits = [...hash].map(c => parseInt(c, 16).toString(2).padStart(4, '0')).join('');
  const gIndex = ch => GLYPHS.indexOf(ch);

  // ---- the program ----
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const U = {}; for (const n of ['uDpr', 'uGlass', 'uGlassR', 'uRes', 'uVP', 'uAtlas', 'uMs', 'uH1', 'uKap', 'uAp', 'uDz', 'uZN', 'uT', 'uZf', 'uIntro', 'uMask', 'uFoot', 'uLV', 'uCell', 'uTex']) U[n] = gl.getUniformLocation(prog, n);
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const qb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, qb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ib);
  for (let i = 1; i <= 3; i++) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, 4, gl.FLOAT, false, 48, (i - 1) * 16); gl.vertexAttribDivisor(i, 1); }
  const tex = gl.createTexture();
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  gl.clearColor(0, 0, 0, 0);

  let atlas = null, count = 0, G = null;
  function upload() {
    atlas = buildAtlas(family);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.cv);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(U.uTex, 0);
    gl.uniform2f(U.uAtlas, atlas.cv.width, atlas.cv.height);
    gl.uniform1fv(U.uLV, LV);
    gl.uniform3fv(U.uCell, atlas.rows.flatMap(r => [r.y, r.w, r.h]));
  }

  // ---- the rails: what each one carries, and where it runs ----
  function build(small, span) {
    const R = rng(20261028);
    const hexEntry = () => {
      const L = [12, 16, 24, 40, 64][(R() * 5) | 0], st = (R() * 64) | 0;
      let s = ''; for (let i = 0; i < L; i++) s += hash[(st + i) % 64];
      return L === 64 || R() < .45 ? '0x' + s : s;
    };
    const bitEntry = () => {
      const nb = 2 + ((R() * 4) | 0), st = ((R() * 32) | 0) * 8, w = [];
      for (let i = 0; i < nb; i++) { const k = (st + i * 8) % 256; w.push(bits.slice(k, k + 8)); }
      return w.join(' ');
    };
    const N = small ? 30 : 34, data = [];
    for (let i = 0; i < N; i++) {
      const bin = R() < .34;
      // spread over the mark's height, a little denser near the horizon
      const u = (i + R() * .8) / N * 2 - 1, ang = Math.PI + Math.sign(u) * Math.pow(Math.abs(u), 1.25) * .64 + .03;
      // where a rail crosses the mark's plane, in mark sizes from the vanishing point: most
      // cross over the right squares, so that is where the type is sharp
      const rho = .42 + Math.pow(R(), .9) * .62, v = (1.1 + R() * 2.4) * .62, alpha = (bin ? .72 : 1) * (.5 + R() * .5);
      const za = .26 + R() * .4, zb = 2.2 + R() * 4, phase = R() * 900;
      let text = '', entries = [];
      while (true) {
        const e = bin ? bitEntry() : hexEntry(), gap = ' '.repeat(5 + ((R() * 14) | 0));
        entries.push([text.length, text.length + e.length]);
        text += e + gap;
        let w = 0; for (const ch of text) w += atlas.adv[gIndex(ch)] * 1.18;
        if (w > span + 20) break;
      }
      // one entry on some rails carries a little more light; on some of those, the blue
      const lit = R() < .45 ? entries[(R() * entries.length) | 0] : null, blue = !!lit && R() < .5;
      let period = 0; for (const ch of text) period += atlas.adv[gIndex(ch)] * 1.18;
      let pos = 0;
      for (let k = 0; k < text.length; k++) {
        const g = gIndex(text[k]), isLit = lit && k >= lit[0] && k < lit[1];
        if (g < GLYPHS.length - 1) data.push(ang, rho, za, zb, pos, period, v, phase, g, isLit && blue ? 1 : 0, alpha, isLit ? 1 : 0);
        pos += atlas.adv[g] * 1.18;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, ib);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    count = data.length / 12;
  }

  const ZN = .26, ZF = 6.5;
  let built = '';
  function layout() {
    const hr = host.getBoundingClientRect(), W = hr.width, H = hr.height;
    if (!W || !H) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    const mr = anchor.getBoundingClientRect(), cr = copy.getBoundingClientRect();
    const ms = mr.width, ox = mr.left - hr.left, oy = mr.top - hr.top, mx = ox + ms / 2, my = oy + mr.height / 2;
    const stacked = cr.top - hr.top > my, small = W < 700;
    // the vanishing point: a little past the mark's right edge, slightly above its middle, so
    // the rails cross the blue square and the one below it on their way into the dark. It is
    // set by the mark alone and may fall past the viewport's edge: where the mark sits near
    // the edge (every desktop width below about 1384px) a point pulled back on screen would
    // move each rail's sharp stretch left, off the right squares and into the mask.
    const vx = mx + ms * .86, vy = my - ms * .05;
    // the wall the type stands on is foreshortened over the mark's own size, not the screen's
    const h1 = Math.max(stacked ? 9 : 10.5, ms * .025), kap = 1.05 / (ms * 1.25), dz = h1 * kap * 1.18;
    G = { W, H, ms, vx, vy, h1, kap, dz, ap: Math.max(5, ms * .022), stacked };
    const span = (ZF - ZN) / dz, key = `${small}|${Math.ceil(span / 50)}`;
    if (key !== built) { build(small, span); built = key; }
    gl.uniform2f(U.uRes, W, H); gl.uniform2f(U.uVP, vx, vy);
    gl.uniform1f(U.uMs, ms); gl.uniform1f(U.uH1, h1); gl.uniform1f(U.uKap, kap); gl.uniform1f(U.uAp, G.ap);
    gl.uniform1f(U.uDz, dz); gl.uniform1f(U.uZN, ZN);
    gl.uniform4f(U.uMask, cr.right - hr.left, cr.top - hr.top, stacked ? 1 : 0, 0);
    // the mark as drawn, and the blue square's centreline, from its own geometry (viewBox 56 56 400 400)
    const k = ms / 400;
    gl.uniform4f(U.uFoot, ox + (63.6 - 56) * k, oy + (62.3 - 56) * k, ox + (448.4 - 56) * k, oy + (449.9 - 56) * k);
    gl.uniform4f(U.uGlass, ox + ((272.9 + 448.2) / 2 - 56) * k, oy + ((62.3 + 237.1) / 2 - 56) * k, (448.2 - 272.9) / 2 * k, (237.1 - 62.3) / 2 * k);
    gl.uniform1f(U.uGlassR, 42 * k); gl.uniform1f(U.uDpr, dpr);
    return true;
  }

  const t0 = performance.now();
  const stat = { instances: 0, frames: 0, running: false };
  window.__ledgerStats = stat;
  const easeOut = t => 1 - Math.pow(1 - t, 3), easeIO = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  function frame(now) {
    const t = reduced ? 30 : (now - t0) / 1000;
    gl.uniform1f(U.uT, t);
    gl.uniform1f(U.uIntro, reduced ? 1 : easeOut(clamp((t - .1) / 1.8)));
    // a focus pull on arrival: from close to the lens out to the mark's plane
    gl.uniform1f(U.uZf, reduced ? 1 : .4 + .6 * easeIO(clamp((t - .15) / 2.4)));
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    stat.instances = count; stat.frames++;
  }

  // ---- the loop: only while the hero is on screen and the tab is visible ----
  let raf = 0, onScreen = true, lost = false;
  const tick = now => { raf = 0; frame(now); loop(); };
  const loop = () => { stat.running = onScreen && !document.hidden && !reduced && !lost; if (stat.running && !raf) raf = requestAnimationFrame(tick); };
  const stop = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } stat.running = false; };
  const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; if (!onScreen) stop(); else loop(); }, { rootMargin: '-12% 0px 0px 0px' });
  const vis = () => { if (document.hidden) stop(); else loop(); };
  let pend = 0;
  const ro = new ResizeObserver(() => { cancelAnimationFrame(pend); pend = requestAnimationFrame(() => { if (!lost && layout()) frame(performance.now()); }); });
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; stop(); });

  upload();
  if (!layout()) throw new Error('no size');
  frame(performance.now());
  io.observe(host); ro.observe(host); document.addEventListener('visibilitychange', vis);
  loop();
  return {
    refresh() { if (lost) return; upload(); built = ''; if (layout()) frame(performance.now()); },
    destroy() { stop(); io.disconnect(); ro.disconnect(); document.removeEventListener('visibilitychange', vis); },
  };
}
