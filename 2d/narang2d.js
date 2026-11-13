// 나랑이 2.5D — the original art, mesh-warped in WebGL, with a live face and effects.
//
//   import { createNarang2D } from './narang2d.js';
//   const n = createNarang2D(document.getElementById('stage'), { assets: './assets/' });
//   n.setExpression('laugh'); n.jump(); n.sleep('lie'); n.wake();
//
// Layers (all in the art's own 1024 px space):
//   base.webp      the character with eyes, brows and mouth painted out
//   eye/brow/mouth sprites cut from the art (default face = the art, untouched)
//   sleep.webp     the sleeping art, black background turned transparent (glow kept)
// The base is drawn as a 48 x 48 grid whose vertices are moved every frame
// (breathing, head turn with depth parallax, horn and leaf springs, squash and stretch),
// so nothing is cut apart and no holes open up.

const PI = Math.PI, TAU = PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));
const rand = (a, b) => a + Math.random() * (b - a);
const easeOutBack = (t) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

// ---------------------------------------------------------------- the art's anatomy (px in the 1024 art)
const A = {
  neck: { x: 480, y: 760 },          // head pivot
  ground: { x: 480, y: 968 },        // breathing / squash anchor
  face: { x: 478, y: 560, rx: 330, ry: 300 },   // depth dome for the 2.5D head turn
  hornBase: { x: 610, y: 250 }, hornTip: { x: 880, y: 95 },
  leaf: { x: 748, y: 800 }, leafPivot: { x: 700, y: 792 },
  handL: { x: 350, y: 862 }, handR: { x: 606, y: 862 },
  tablet: { x0: 350, x1: 600, y0: 745, y1: 920 },
  heart: { x: 478, y: 828 },
  headset: { x: 903, y: 578 },
  zzz: { x: 640, y: 300 }
};
const FR = { x: 228, y: 356, w: 500, h: 384 };   // face layer rectangle
const VIEW = { x: 40, y: -120, w: 960, h: 1130 }; // what the stage shows (room above for jumps and Zzz)
const LIE = { k: 0.97, x: 82, y: 323 };            // sleeping art placed in the same space
const LIE_A = { headset: { x: 670, y: 433 }, zzz: { x: 297, y: 219 }, ground: { x: 452, y: 647 } };   // in sleep.webp px
const GRID = 48;

export const EXPRESSIONS = {
  //          eyes L / R            brows lift, tilt   eye scale  mouth type, sx, sy   blush
  smile:    { eL: 'art',   eR: 'art',   bl: 0,   bt: 0,    es: 1,    m: 'art',   mx: 1,    my: 1,    blush: 0 },
  laugh:    { eL: 'happy', eR: 'happy', bl: -9,  bt: 0,    es: 1,    m: 'art',   mx: 1.12, my: 1.38, blush: 0.55 },
  wink:     { eL: 'happy', eR: 'art',   bl: -5,  bt: 0,    es: 1,    m: 'art',   mx: 1,    my: 0.9,  blush: 0.3 },
  surprise: { eL: 'art',   eR: 'art',   bl: -17, bt: 0,    es: 1.1,  m: 'o',     mx: 1,    my: 1,    blush: 0 },
  sad:      { eL: 'sad',   eR: 'sad',   bl: -3,  bt: 0.28, es: 1,    m: 'frown', mx: 1,    my: 1,    blush: 0 },
  love:     { eL: 'heart', eR: 'heart', bl: -7,  bt: 0,    es: 1,    m: 'art',   mx: 1.05, my: 1.18, blush: 0.85 },
  sleepy:   { eL: 'half',  eR: 'half',  bl: 2,   bt: 0,    es: 1,    m: 'art',   mx: 0.85, my: 0.6,  blush: 0.1 },
  yawn:     { eL: 'happy', eR: 'happy', bl: -10, bt: 0,    es: 1,    m: 'o',     mx: 1.5,  my: 1.7,  blush: 0.15 },
  sleep:    { eL: 'sleep', eR: 'sleep', bl: 3,   bt: 0,    es: 1,    m: 'sleep', mx: 1,    my: 1,    blush: 0.2 }
};

export function canRender2D() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}

/**
 * @param {HTMLElement} host  an element with a size; three canvases are added inside it
 * @param {object} [o]
 * @param {string} [o.assets='./assets/']
 * @param {'awake'|'sleep'} [o.mood='awake']
 * @param {'sit'|'lie'} [o.sleepPose='sit']
 * @param {boolean} [o.lookAtPointer=true]
 * @param {boolean} [o.tap=true]          tap: jump (head), hearts (tablet), wake (asleep)
 * @param {boolean} [o.idle=true]         idle life: looking around, tablet glances, wiggles
 * @param {boolean} [o.reducedMotion]     default: the OS setting
 * @param {number}  [o.maxPixelRatio=2]
 * @param {(api) => void} [o.onReady]
 * @param {(state) => void} [o.onChange]
 */
export function createNarang2D(host, o = {}) {
  const opts = Object.assign({
    assets: './assets/', mood: 'awake', sleepPose: 'sit', lookAtPointer: true, tap: true, idle: true, maxPixelRatio: 2,
    reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  }, o);
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const mk = (z) => {
    const c = document.createElement('canvas');
    c.style.cssText = `position:absolute;inset:0;width:100%;height:100%;display:block;z-index:${z};touch-action:manipulation`;
    host.appendChild(c); return c;
  };
  const back = mk(0), cv = mk(1), front = mk(2);
  const bx = back.getContext('2d'), fx = front.getContext('2d');
  let gl = cv.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: true }) || cv.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: true });
  let c2 = null;   // canvas-2D fallback when WebGL is missing
  if (!gl) c2 = cv.getContext('2d');

  // ---------------------------------------------------------------- state
  let dead = false, ready = false, raf = 0, last = 0, visible = true;
  let W = 1, H = 1, dpr = 1, S = 1, OX = 0, OY = 0;   // art px -> css px: x * S + OX
  const img = {}; let L = null;
  const face = document.createElement('canvas'); face.width = FR.w; face.height = FR.h;
  const fctx = face.getContext('2d');
  let faceSig = '';

  // animation state
  let mode = opts.mood === 'sleep' ? 'sleep' : 'awake';
  let pose = opts.mood === 'sleep' ? (opts.sleepPose === 'lie' ? 'lie' : 'sit') : 'awake';
  let baseExpr = 'smile';
  let expr = mode === 'sleep' ? 'sleep' : 'smile', prevExpr = expr, exprT = 1;   // crossfade 0..1
  const num = Object.assign({}, EXPRESSIONS[expr]);                              // smoothed numbers
  let seq = null;            // running sequence {type, t0, dur, ...}
  let talking = false, userTalk = false, sayTalk = false, say = null, bubble = null;
  let blink = 1, nextBlink = 1.5, blinkT = -1, blinkN = 1;
  const look = { x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0 };
  let pointerT = -10, idleLookT = 0, idleNext = 6;
  const horn = { a: 0, v: 0 }, leaf = { a: 0, v: 0 };
  let lastHeadX = 0, lastHeadV = 0;
  const P = { breath: 0, sq: 0, jy: 0, sway: 0, head: 0, hx: 0, hy: 0, tap: 0, tapL: 0, tapR: 0, arms: 0, droop: 0, nod: 0, shk: 0 };
  let lieS = 1, lieDY = 0;   // the lying art pops in / sinks out
  let lieEyes = 0, lieRise = 0, lieSway = 0;   // waking up while lying: eyes open, the body stretches up, a wriggle
  // poses: separate pictures (wave, cheer, point, think, surprise) that the character pops between
  let PZ = null; const pz = {};                       // poses.json and per-pose mesh / texture
  let poseCur = 'idle', posePrev = 'idle', poseT0 = -10, poseHoldEnd = 0;
  let LSQ = 0, LJY = 0, puffDone = true;                               // squash / hop of the layer being drawn (pose pop)
  let aSit = pose === 'lie' ? 0 : 1, aLie = pose === 'lie' ? 1 : 0, night = pose === 'lie' ? 1 : 0;
  let heartGlow = 1, headsetGlow = 1, now = 0;
  const parts = [];
  const stars = Array.from({ length: 40 }, () => ({ x: Math.random(), y: Math.random() * 0.75, p: Math.random() * TAU, s: rand(0.6, 1.6) }));

  // ---------------------------------------------------------------- mesh
  const NV = (GRID + 1) * (GRID + 1);
  const rest = new Float32Array(NV * 2), uv = new Float32Array(NV * 2), pos = new Float32Array(NV * 2);
  const wHead = new Float32Array(NV), wDepth = new Float32Array(NV), wHorn = new Float32Array(NV), wLeaf = new Float32Array(NV);
  const wHL = new Float32Array(NV), wHR = new Float32Array(NV), wTab = new Float32Array(NV), wSet = new Float32Array(NV);
  const lrest = new Float32Array(NV * 2), lpos = new Float32Array(NV * 2), wLHead = new Float32Array(NV);
  const idx = [];
  for (let j = 0; j <= GRID; j++) for (let i = 0; i <= GRID; i++) {
    const k = j * (GRID + 1) + i, x = (i / GRID) * 1024, y = (j / GRID) * 1024;
    rest[k * 2] = x; rest[k * 2 + 1] = y; uv[k * 2] = i / GRID; uv[k * 2 + 1] = j / GRID;
    wHead[k] = headW(x, y); wDepth[k] = depthW(x, y); wHorn[k] = hornW(x, y); wLeaf[k] = leafW(x, y);
    wHL[k] = handW(x, y, A.handL); wHR[k] = handW(x, y, A.handR); wTab[k] = tabW(x, y); wSet[k] = setW(x, y);
    if (i < GRID && j < GRID) { const a = k, b = k + 1, c = k + GRID + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  }
  function buildLie(w, h) {   // the lying art's grid, once its size is known
    for (let j = 0; j <= GRID; j++) for (let i = 0; i <= GRID; i++) {
      const k = j * (GRID + 1) + i, ly = (j / GRID) * h;
      lrest[k * 2] = (i / GRID) * w; lrest[k * 2 + 1] = ly; wLHead[k] = 1 - smooth(470, 560, ly);
    }
  }

  function headW(x, y) {
    let h = 1 - smooth(700, 772, y);
    const inTabX = smooth(323, 347, x) * (1 - smooth(603, 627, x));
    h *= 1 - smooth(726, 746, y) * inTabX;
    return h;
  }
  function depthW(x, y) {
    const e = ((x - A.face.x) / A.face.rx) ** 2 + ((y - A.face.y) / A.face.ry) ** 2;
    return clamp(1 - e, 0, 1);
  }
  function hornW(x, y) {
    const ux = A.hornTip.x - A.hornBase.x, uy = A.hornTip.y - A.hornBase.y, len = Math.hypot(ux, uy);
    const dx = x - A.hornBase.x, dy = y - A.hornBase.y;
    const t = (dx * ux + dy * uy) / (len * len), perp = Math.abs(dx * uy - dy * ux) / len;
    return smooth(0, 1, t) * (1 - smooth(120, 175, perp));
  }
  function leafW(x, y) { return (1 - smooth(25, 85, Math.hypot(x - A.leaf.x, y - A.leaf.y))) * smooth(690, 715, x); }
  function handW(x, y, c) { const e = Math.hypot((x - c.x) / 78, (y - c.y) / 82); return 1 - smooth(0.7, 1.15, e); }
  function setW(x, y) { const e = Math.hypot((x - 860) / 82, (y - 575) / 135); return 1 - smooth(0.75, 1.1, e); }
  function tabW(x, y) {
    return smooth(A.tablet.x0 - 20, A.tablet.x0 + 5, x) * (1 - smooth(A.tablet.x1 - 5, A.tablet.x1 + 20, x)) *
      smooth(A.tablet.y0 - 15, A.tablet.y0 + 5, y) * (1 - smooth(A.tablet.y1 - 5, A.tablet.y1 + 15, y));
  }

  // one deform for mesh vertices and for effect anchors (so glows and particles stick to the body)
  function deform(x, y, wh, wd, whn, wlf, whl, whr, wtb, whs, out) {
    let px = x, py = y;
    if (wlf > 0) { const a = leaf.a * wlf, c = Math.cos(a), s = Math.sin(a), dx = px - A.leafPivot.x, dy = py - A.leafPivot.y; px = A.leafPivot.x + dx * c - dy * s; py = A.leafPivot.y + dx * s + dy * c; }
    // hands: taps (each hand on its own) and lifting the tablet together
    py += P.tapL * whl + P.tapR * whr;
    const arm = Math.max(whl, whr, wtb); py -= P.arms * arm;
    if (whn > 0) { const a = horn.a * whn, c = Math.cos(a), s = Math.sin(a), dx = px - A.hornBase.x, dy = py - A.hornBase.y; px = A.hornBase.x + dx * c - dy * s; py = A.hornBase.y + dx * s + dy * c; }
    if (wh > 0) {
      const a = P.head, c = Math.cos(a), s = Math.sin(a), dx = px - A.neck.x, dy = py - A.neck.y;
      let qx = A.neck.x + dx * c - dy * s + P.hx, qy = A.neck.y + dx * s + dy * c + P.hy;
      // 2.5D turn: the face slides over the dome, the horn and the ear cup (further back) move the other way
      const lx = look.x + P.shk;
      qx += lx * 24 * wd - lx * 8 * whn - lx * 7 * whs + P.shk * 10;
      qy += look.y * 14 * wd + P.nod * (6 + 12 * wd);   // nod: the face dips more than the hood rim
      px += (qx - px) * wh; py += (qy - py) * wh;
    }
    // whole body: breathing, squash and stretch, jump, sway
    return body(px, py, out);
  }
  function body(px, py, out) {
    const q = P.sq + LSQ, sy = 1 + P.breath * 0.012 - q, sx = 1 - P.breath * 0.006 + q * 0.6;
    let dx = (px - A.ground.x) * sx, dy = (py - A.ground.y) * sy;
    if (P.sway) { const c = Math.cos(P.sway), s = Math.sin(P.sway); const ex = dx * c - dy * s; dy = dx * s + dy * c; dx = ex; }
    out[0] = A.ground.x + dx; out[1] = A.ground.y + dy + P.jy + LJY;
    return out;
  }

  // ---------------------------------------------------------------- poses
  function buildPose(name, d, im) {
    const N = (GRID + 1) * (GRID + 1), rest = new Float32Array(N * 2), wh = new Float32Array(N);
    const wl = d.limbs.map(() => new Float32Array(N));
    for (let j = 0; j <= GRID; j++) for (let i = 0; i <= GRID; i++) {
      const k = j * (GRID + 1) + i, x = d.x + (i / GRID) * d.w, y = d.y + (j / GRID) * d.h;
      rest[k * 2] = x; rest[k * 2 + 1] = y;
      wh[k] = 1 - smooth(d.neck[1] - 120, d.neck[1] - 10, y);
      d.limbs.forEach((l, n) => { wl[n][k] = limbW(l, x, y); });
    }
    pz[name] = { d, im, rest, pos: new Float32Array(N * 2), wh, wl, tex: null };
  }
  function limbW(l, x, y) { const e = Math.hypot((x - l.c[0]) / l.r[0], (y - l.c[1]) / l.r[1]); return 1 - smooth(0.8, 1.3, e); }
  function poseAge() { return now - poseT0; }
  function poseNames() { return posePrev === poseCur ? [poseCur] : [posePrev, poseCur]; }
  // pop between poses: the old one squashes and vanishes, the new one appears squashed, springs up and settles
  function layerOf(name) {
    const t = poseAge();
    if (name === poseCur) {
      const u = t - 0.1;
      if (t > 1.2) return { a: 1, sq: 0, jy: 0 };
      return { a: t >= 0.1 ? 1 : 0, sq: u < 0 ? 0.1 : 0.1 * Math.cos(u * 14) * Math.exp(-u * 6), jy: u < 0 ? 0 : -24 * Math.sin(PI * clamp(u / 0.3, 0, 1)) };
    }
    if (name === posePrev && t < 0.1) return { a: 1, sq: 0.1 * easeOut(clamp(t / 0.11, 0, 1)), jy: 0 };
    return null;
  }
  function deformPose(z, x, y, wh, k, out) {
    const d = z.d, t = poseAge(), amt = poseCur === z.d.name ? smooth(0.25, 0.6, t) : 1;
    let px = x, py = y;
    d.limbs.forEach((l, n) => {
      const w = k >= 0 ? z.wl[n][k] : limbW(l, x, y); if (w <= 0) return;
      const ph = TAU * l.hz * now + l.phase;
      if (l.kind === 'rot') {
        const a = l.amp * Math.sin(ph) * amt * w, c = Math.cos(a), s = Math.sin(a), dx = px - l.pivot[0], dy = py - l.pivot[1];
        px = l.pivot[0] + dx * c - dy * s; py = l.pivot[1] + dx * s + dy * c;
      } else { const m = l.amp * (0.5 + 0.5 * Math.sin(ph)) * amt * w; px += l.dir[0] * m; py += l.dir[1] * m; }
    });
    if (wh > 0) {
      const a = (P.head * 0.7 + (d.tilt || 0) * Math.sin(now * 1.3) + look.x * 0.03 - P.shk * 0.04) * wh, c = Math.cos(a), s = Math.sin(a);
      const dx = px - d.neck[0], dy = py - d.neck[1];
      px = d.neck[0] + dx * c - dy * s + (look.x * 10 + P.shk * 14) * wh; py = d.neck[1] + dx * s + dy * c + (look.y * 7 + P.nod * 12) * wh;
    }
    return body(px, py, out);
  }
  function mapPose(name, x, y) { const z = pz[name]; return deformPose(z, x, y, 1 - smooth(z.d.neck[1] - 120, z.d.neck[1] - 10, y), -1, [0, 0]); }
  function switchPose(name, instant) {
    if (name === poseCur) return;
    posePrev = instant ? name : (poseAge() < 0.1 ? posePrev : poseCur); poseCur = name; poseT0 = instant ? now - 10 : now; puffDone = !!instant;
    if (!instant) hornKick(name === 'idle' ? 1.5 : -2.5);
    faceSig = ''; kick();
  }
  function setPose(name, hold) {
    if (!(name === 'idle' || pz[name]) || mode !== 'awake') return false;
    switchPose(name); poseHoldEnd = hold ? now + hold : 0; emit(); return true;
  }
  const tmp = [0, 0];
  function mapPoint(x, y) {   // an art point through the current deformation
    return deform(x, y, headW(x, y), depthW(x, y), hornW(x, y), leafW(x, y), handW(x, y, A.handL), handW(x, y, A.handR), tabW(x, y), setW(x, y), [0, 0]);
  }
  function lieToArt(x, y) { const g = A.ground; return [g.x + (LIE.x + x * LIE.k - g.x) * lieS, g.y + (LIE.y + y * LIE.k - g.y) * lieS + lieDY]; }
  function lieView() { const g = A.ground; return [LIE.k * lieS, g.x + (LIE.x - g.x) * lieS, g.y + (LIE.y - g.y) * lieS + lieDY]; }
  function lieShape(x, y, wh, out) {
    const b = P.breath, sy = (1 + b * 0.02) * (1 + lieRise * 0.17), sx = (1 - b * 0.006) * (1 - lieRise * 0.05);
    const sway = Math.sin(now * TAU / 4.6 + 0.5) * 0.006 + lieSway;
    if (wh > 0) { const dx = x - 450, dy = y - 560, c = Math.cos(sway * wh), s2 = Math.sin(sway * wh); x = 450 + dx * c - dy * s2; y = 560 + dx * s2 + dy * c; }
    out[0] = LIE_A.ground.x + (x - LIE_A.ground.x) * sx; out[1] = LIE_A.ground.y + (y - LIE_A.ground.y) * sy;
    return out;
  }
  function mapLie(x, y) { const q = lieShape(x, y, 1 - smooth(470, 560, y), [0, 0]); return lieToArt(q[0], q[1]); }

  // ---------------------------------------------------------------- WebGL
  let prog, buf = {}, tex = {}, U = {};
  function initGL() {
    const is2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    const vs = `attribute vec2 aPos; attribute vec2 aUV; uniform vec3 uView; uniform vec2 uRes; varying vec2 vUV;
      void main(){ vec2 p = aPos * uView.x + uView.yz; vUV = aUV; gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0); gl_Position.y = -gl_Position.y; }`;
    const fs = `precision mediump float; varying vec2 vUV; uniform sampler2D uTex; uniform sampler2D uFace; uniform vec4 uFR; uniform float uUseFace; uniform float uAlpha;
      void main(){
        vec4 c = texture2D(uTex, vUV);
        if (uUseFace > 0.5) {
          vec2 f = (vUV - uFR.xy) / uFR.zw;
          if (f.x > 0.0 && f.x < 1.0 && f.y > 0.0 && f.y < 1.0) { vec4 t = texture2D(uFace, f); c = t + c * (1.0 - t.a); }
        }
        gl_FragColor = c * uAlpha;
      }`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    for (const n of ['uView', 'uRes', 'uTex', 'uFace', 'uFR', 'uUseFace', 'uAlpha']) U[n] = gl.getUniformLocation(prog, n);
    U.aPos = gl.getAttribLocation(prog, 'aPos'); U.aUV = gl.getAttribLocation(prog, 'aUV');
    buf.pos = gl.createBuffer(); buf.ppos = gl.createBuffer(); buf.lpos = gl.createBuffer(); buf.uv = gl.createBuffer(); buf.idx = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.uv); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    const mkTex = (src) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      const pot = (n) => (n & (n - 1)) === 0;
      if (is2 || (pot(src.width) && pot(src.height))) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
      else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      return t;
    };
    tex.base = mkTex(img.base); tex.sleep = mkTex(img.sleep);
    for (const n in pz) pz[n].tex = mkTex(pz[n].im);
    tex.face = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex.face);
    for (const [p, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, face);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(U.uTex, 0); gl.uniform1i(U.uFace, 1);
    gl.uniform4f(U.uFR, FR.x / 1024, FR.y / 1024, FR.w / 1024, FR.h / 1024);
  }

  function drawGL(faceDirty) {
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.uRes, W, H);
    if (faceDirty) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex.face); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, face); }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.uv); gl.enableVertexAttribArray(U.aUV); gl.vertexAttribPointer(U.aUV, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.idx);
    if (aLie > 0.001) {
      const lv = lieView(); gl.uniform3f(U.uView, S * lv[0], OX + lv[1] * S, OY + lv[2] * S);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.lpos); gl.bufferData(gl.ARRAY_BUFFER, lpos, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(U.aPos); gl.vertexAttribPointer(U.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex.sleep);
      gl.uniform1f(U.uUseFace, 0); gl.uniform1f(U.uAlpha, aLie);
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
    }
    const li = layerOf('idle');
    if (aSit > 0.001 && li) {
      gl.uniform3f(U.uView, S, OX, OY);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.pos); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(U.aPos); gl.vertexAttribPointer(U.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex.base);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex.face);
      gl.uniform1f(U.uUseFace, 1); gl.uniform1f(U.uAlpha, aSit * li.a);
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
    }
    for (const n of poseNames()) {
      if (n === 'idle' || !pz[n]) continue;
      const lay = layerOf(n); if (!lay || aSit <= 0.001) continue;
      gl.uniform3f(U.uView, S, OX, OY);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.ppos); gl.bufferData(gl.ARRAY_BUFFER, pz[n].pos, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(U.aPos); gl.vertexAttribPointer(U.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, pz[n].tex);
      gl.uniform1f(U.uUseFace, 0); gl.uniform1f(U.uAlpha, aSit * lay.a);
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
    }
  }

  // canvas-2D fallback: no warping, only bob and squash
  function draw2D() {
    c2.setTransform(dpr, 0, 0, dpr, 0, 0); c2.clearRect(0, 0, W, H);
    const sy = 1 + P.breath * 0.012 - P.sq, sx = 1 - P.breath * 0.006 + P.sq * 0.6;
    if (aLie > 0.001) {
      const lv = lieView(); c2.save(); c2.globalAlpha = aLie; c2.translate(OX + lv[1] * S, OY + lv[2] * S); c2.scale(S * lv[0], S * lv[0]);
      c2.drawImage(img.sleep, 0, 0); c2.restore();
    }
    if (aSit > 0.001) {
      c2.save(); c2.globalAlpha = aSit;
      c2.translate(OX + A.ground.x * S, OY + (A.ground.y + P.jy) * S); c2.scale(S * sx, S * sy); c2.translate(-A.ground.x, -A.ground.y);
      if (poseCur === 'idle' || !pz[poseCur]) { c2.drawImage(img.base, 0, 0); c2.drawImage(face, FR.x, FR.y); }
      else { const d = pz[poseCur].d; c2.drawImage(pz[poseCur].im, d.x, d.y, d.w, d.h); }
      c2.restore();
    }
  }

  // ---------------------------------------------------------------- face drawing
  const SK = () => `rgb(${L.skin[0]},${L.skin[1]},${L.skin[2]})`;
  function drawSpriteAt(name, cx, cy, sx, sy, rot = 0) {
    const s = L[name]; fctx.save(); fctx.translate(cx - FR.x, cy - FR.y); if (rot) fctx.rotate(rot); fctx.scale(sx, sy);
    fctx.drawImage(img[name], s.x - s.cx, s.y - s.cy); fctx.restore();
  }
  function eyeCentre(side) { const s = L[side < 0 ? 'eye_l' : 'eye_r']; return { x: s.cx, y: s.cy, rx: s.rx, ry: s.ry }; }
  function drawEye(type, side, alpha, pop) {
    if (alpha <= 0.01) return;
    const e = eyeCentre(side), gx = look.x * 5, gy = look.y * 4;
    const x = e.x + gx, y = e.y + gy, rx = e.rx, ry = e.ry, sc = num.es * pop;
    fctx.save(); fctx.globalAlpha = alpha;
    const name = side < 0 ? 'eye_l' : 'eye_r';
    const lidLine = (k) => {   // closed eye during a blink
      fctx.globalAlpha = alpha * k; fctx.strokeStyle = '#3A1E0C'; fctx.lineWidth = 8; fctx.lineCap = 'round';
      fctx.beginPath(); fctx.moveTo(x - FR.x - rx * 0.85, y - FR.y + ry * 0.05); fctx.quadraticCurveTo(x - FR.x, y - FR.y + ry * 0.38, x - FR.x + rx * 0.85, y - FR.y + ry * 0.05); fctx.stroke();
    };
    if (type === 'art' || type === 'sad' || type === 'half') {
      const open = type === 'half' ? 0.42 * blink : blink;
      const vis = smooth(0.06, 0.3, open);   // the squashed eye fades into a closed lid line
      fctx.globalAlpha = alpha * vis;
      drawSpriteAt(name, x, y + ry * (1 - open) * 0.35, sc, sc * Math.max(open, 0.04));
      if (type === 'sad' || type === 'half') {
        // the upper part of the eye is cut away, so the real skin of the base shows (an eyelid), drooping outwards when sad
        const t = type === 'sad' ? 0.3 : 0, ox = side < 0 ? -1 : 1;
        const ly = y - FR.y - ry * (type === 'sad' ? 0.42 : 0.1) * Math.max(open, 0.2);
        const xl = x - FR.x - rx * 1.7, xr = x - FR.x + rx * 1.7, yl = ly - ox * t * rx * 0.85, yr = ly + ox * t * rx * 0.85;
        fctx.save(); fctx.beginPath(); fctx.ellipse(x - FR.x, y - FR.y, rx * sc + 34, ry * sc + 34, 0, 0, TAU); fctx.clip();
        fctx.globalCompositeOperation = 'destination-out'; fctx.globalAlpha = 1;
        fctx.beginPath(); fctx.moveTo(xl, yl - 300); fctx.lineTo(xr, yr - 300); fctx.lineTo(xr, yr); fctx.lineTo(xl, yl); fctx.closePath();
        fctx.filter = 'blur(1.5px)'; fctx.fill(); fctx.filter = 'none';
        fctx.restore();
        fctx.save(); fctx.globalAlpha = alpha * vis; fctx.strokeStyle = '#3A1E0C'; fctx.lineWidth = 7; fctx.lineCap = 'round';
        const k = 0.5; fctx.beginPath(); fctx.moveTo(lerp(x - FR.x, xl, k), lerp(ly, yl, k)); fctx.lineTo(lerp(x - FR.x, xr, k), lerp(ly, yr, k)); fctx.stroke();
        fctx.restore();
      }
      if (open < 0.3) lidLine(1 - vis);
    } else if (type === 'happy') {
      fctx.translate(x - FR.x, y - FR.y); fctx.scale(pop, pop);
      fctx.strokeStyle = '#3A1E0C'; fctx.lineWidth = 13; fctx.lineCap = 'round';
      fctx.beginPath(); fctx.moveTo(-rx * 0.9, ry * 0.2); fctx.quadraticCurveTo(0, -ry * 0.7, rx * 0.9, ry * 0.2); fctx.stroke();
    } else if (type === 'sleep') {   // the crescent of the sleeping art: bowed down, tapered, outer end a little raised
      fctx.translate(x - FR.x, y - FR.y + ry * 0.12); fctx.scale(pop, pop);
      const w = rx * 1.02, lift = ry * 0.14, lx = -w, rx2 = w, ly = side < 0 ? -lift : 0, ry2 = side > 0 ? -lift : 0;
      const g = fctx.createLinearGradient(0, 0, 0, ry * 0.5); g.addColorStop(0, '#3A1A08'); g.addColorStop(1, '#5A2E14');
      fctx.fillStyle = g; fctx.strokeStyle = '#3A1D0E'; fctx.lineWidth = 2; fctx.lineJoin = 'round';
      fctx.beginPath(); fctx.moveTo(lx, ly); fctx.quadraticCurveTo(0, ry * 0.42, rx2, ry2); fctx.quadraticCurveTo(0, ry * 0.66, lx, ly); fctx.closePath(); fctx.fill(); fctx.stroke();
    } else if (type === 'heart') {
      const beat = 1 + 0.08 * Math.max(0, Math.sin(now * 9));
      fctx.translate(x - FR.x, y - FR.y); fctx.scale(pop * beat, pop * beat * Math.max(blink, 0.1));
      const s = rx * 1.05;
      const hp = new Path2D(); hp.moveTo(0, s * 0.85);
      hp.bezierCurveTo(-s * 1.25, s * 0.05, -s * 0.9, -s * 1.05, 0, -s * 0.45);
      hp.bezierCurveTo(s * 0.9, -s * 1.05, s * 1.25, s * 0.05, 0, s * 0.85);
      const g = fctx.createLinearGradient(0, -s, 0, s); g.addColorStop(0, '#FF6F7E'); g.addColorStop(1, '#D9283F');
      fctx.fillStyle = g; fctx.fill(hp); fctx.strokeStyle = '#8E1424'; fctx.lineWidth = 4; fctx.stroke(hp);
      fctx.fillStyle = 'rgba(255,255,255,0.92)'; fctx.beginPath(); fctx.ellipse(-s * 0.42, -s * 0.38, s * 0.2, s * 0.13, -0.6, 0, TAU); fctx.fill();
    }
    fctx.restore();
  }
  function drawMouth(type, alpha, pop) {
    if (alpha <= 0.01) return;
    const m = L.mouth; fctx.save(); fctx.globalAlpha = alpha;
    const cx = m.cx + look.x * 7 - FR.x, top = m.y + 14 + look.y * 5 - FR.y;
    if (type === 'art') {
      let my = num.my;
      if (talking) my *= 0.35 + 0.75 * Math.abs(Math.sin(now * 13) * Math.sin(now * 7.3 + 1));
      fctx.translate(cx, top); fctx.scale(num.mx * pop, my * pop); fctx.drawImage(img.mouth, m.x - m.cx, -14);
    } else if (type === 'o') {
      const rw = 17 * num.mx * pop, rh = 21 * num.my * pop;
      fctx.translate(cx, top + 30);
      fctx.shadowColor = 'rgba(176,128,96,0.5)'; fctx.shadowBlur = 6;
      const g = fctx.createLinearGradient(0, -rh, 0, rh); g.addColorStop(0, '#6E0204'); g.addColorStop(1, '#C23A40');
      fctx.fillStyle = g; fctx.beginPath(); fctx.ellipse(0, 0, rw, rh, 0, 0, TAU); fctx.fill(); fctx.shadowColor = 'transparent';
      fctx.fillStyle = '#FC7A7E'; fctx.beginPath(); fctx.ellipse(0, rh * 0.5, rw * 0.62, rh * 0.38, 0, 0, TAU); fctx.fill();
    } else if (type === 'frown') {
      fctx.translate(cx, top + 34); fctx.scale(pop, pop);
      fctx.strokeStyle = '#A8262F'; fctx.lineWidth = 7; fctx.lineCap = 'round';
      fctx.beginPath(); fctx.moveTo(-30, 10); fctx.quadraticCurveTo(0, -14, 30, 10); fctx.stroke();
    } else if (type === 'sleep') {
      fctx.translate(cx, top + 24); fctx.scale(pop, pop);
      fctx.strokeStyle = '#B0222E'; fctx.lineWidth = 6; fctx.lineCap = 'round';
      fctx.beginPath(); fctx.moveTo(-27, 0); fctx.quadraticCurveTo(0, 20, 27, 0); fctx.stroke();
    }
    fctx.restore();
  }
  function drawBrows() {
    for (const side of [-1, 1]) {
      const n = side < 0 ? 'brow_l' : 'brow_r', s = L[n];
      drawSpriteAt(n, s.cx + look.x * 9, s.cy + num.bl + look.y * 6, 1, 1, num.bt * side * -1);
    }
  }
  function drawBlush() {
    if (num.blush < 0.02) return;
    for (const [x, y] of [[272, 650], [698, 632]]) {
      const g = fctx.createRadialGradient(x - FR.x, y - FR.y, 0, x - FR.x, y - FR.y, 52);
      g.addColorStop(0, `rgba(255,120,130,${0.42 * num.blush})`); g.addColorStop(1, 'rgba(255,120,130,0)');
      fctx.fillStyle = g; fctx.beginPath(); fctx.ellipse(x - FR.x, y - FR.y, 60, 48, 0, 0, TAU); fctx.fill();
    }
  }
  function drawFace() {
    const E0 = EXPRESSIONS[prevExpr], E1 = EXPRESSIONS[expr], k = easeInOut(exprT);
    const sig = [prevExpr, expr, k.toFixed(2), blink.toFixed(2), look.x.toFixed(2), look.y.toFixed(2), num.bl.toFixed(1), num.bt.toFixed(2), num.es.toFixed(3),
      num.mx.toFixed(2), num.my.toFixed(2), num.blush.toFixed(2), talking ? (now * 30 | 0) : 0, (E1.eL === 'heart' || E0.eL === 'heart') ? (now * 30 | 0) : 0].join('|');
    if (sig === faceSig) return false;
    faceSig = sig;
    fctx.clearRect(0, 0, FR.w, FR.h);
    drawBrows();
    for (const side of [-1, 1]) {
      const key = side < 0 ? 'eL' : 'eR';
      if (E0[key] === E1[key] || k >= 1) drawEye(E1[key], side, 1, 1);
      else { drawEye(E0[key], side, 1 - k, 1 - 0.25 * k); drawEye(E1[key], side, k, 0.75 + 0.25 * k); }
    }
    if (E0.m === E1.m || k >= 1) drawMouth(E1.m, 1, 1);
    else { drawMouth(E0.m, 1 - k, 1 - 0.2 * k); drawMouth(E1.m, k, 0.8 + 0.2 * k); }
    drawBlush();
    return true;
  }

  // ---------------------------------------------------------------- effects (front / back canvases)
  function toCss(p) { return [p[0] * S + OX, p[1] * S + OY]; }
  function spawn(type, x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = rand(-PI, 0), sp = rand(120, 300);
      if (type === 'spark') parts.push({ type, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: rand(0.7, 1.1), age: 0, s: rand(14, 26), r: rand(0, PI), c: Math.random() < 0.5 ? '#FFD84A' : '#FFFFFF' });
      else if (type === 'heart') parts.push({ type, x: x + rand(-40, 40), y, vx: rand(-70, 70), vy: rand(-260, -160), life: rand(1.1, 1.6), age: 0, s: rand(18, 30), r: rand(-0.3, 0.3), c: Math.random() < 0.6 ? '#9BE15D' : '#FF7A8A' });
      else if (type === 'z') parts.push({ type, x, y, vx: rand(40, 70), vy: rand(-70, -50), life: 2.6, age: 0, s: rand(30, 40), r: rand(-0.2, 0.1), c: '#8A6A3A' });
      else if (type === 'note') parts.push({ type, x, y, vx: rand(30, 80), vy: rand(-120, -80), life: 1.6, age: 0, s: 34, r: 0, c: '#E0A800' });
      else if (type === 'q' || type === 'ex') parts.push({ type, x, y, vx: 0, vy: -40, life: 1.8, age: 0, s: 84, r: type === 'q' ? 0.15 : -0.1, c: type === 'q' ? '#3D8BFF' : '#FF5A5A' });
    }
  }
  function drawStar(ctx, x, y, s, r) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(r); ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU, rr = i % 2 ? s * 0.28 : s; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function heartPath(ctx, x, y, s) {
    ctx.beginPath(); ctx.moveTo(x, y + s * 0.85);
    ctx.bezierCurveTo(x - s * 1.25, y + s * 0.05, x - s * 0.9, y - s * 1.05, x, y - s * 0.45);
    ctx.bezierCurveTo(x + s * 0.9, y - s * 1.05, x + s * 1.25, y + s * 0.05, x, y + s * 0.85);
  }
  function glow(ctx, p, r, col, a, sx = 1, sy = 1) {
    if (a <= 0.01) return;
    const [x, y] = toCss(p); ctx.save(); ctx.translate(x, y); ctx.scale(sx, sy);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * S);
    g.addColorStop(0, `rgba(${col},${0.55 * a})`); g.addColorStop(0.45, `rgba(${col},${0.22 * a})`); g.addColorStop(1, `rgba(${col},0)`);
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * S, 0, TAU); ctx.fill(); ctx.restore();
  }
  function drawBack() {
    bx.setTransform(dpr, 0, 0, dpr, 0, 0); bx.clearRect(0, 0, W, H);
    if (night > 0.01) {   // night sky for the lying sleep
      // night <-> day goes through a warm dawn instead of a grey half-transparent navy
      const k = smooth(0.3, 1, night);   // dawn -> violet -> night sky (a straight mix of navy and peach turns muddy)
      const mix3 = (a, b, c) => (k < 0.5 ? a.map((v, i) => Math.round(v + (b[i] - v) * k * 2)) : b.map((v, i) => Math.round(v + (c[i] - v) * (k - 0.5) * 2)));
      const c0 = mix3([255, 214, 150], [222, 150, 178], [38, 48, 94]), c1 = mix3([255, 236, 200], [120, 92, 158], [11, 16, 40]);
      bx.globalAlpha = smooth(0, 0.35, night);
      const g = bx.createRadialGradient(W / 2, H * 0.62, 0, W / 2, H * 0.62, Math.max(W, H) * 0.8);
      g.addColorStop(0, `rgb(${c0})`); g.addColorStop(1, `rgb(${c1})`);
      bx.fillStyle = g; bx.fillRect(0, 0, W, H);
      bx.globalAlpha = smooth(0.5, 1, night);
      for (const s of stars) {
        const tw = 0.45 + 0.55 * Math.sin(now * s.s * 1.7 + s.p);
        bx.fillStyle = `rgba(255,246,210,${0.75 * tw})`; drawStar(bx, s.x * W, s.y * H, 2.2 * s.s, 0);
      }
      bx.globalAlpha = 1;
    }
    // ground shadow
    const g0 = aSit * (1 - smooth(0, 120, -P.jy) * 0.6) + aLie * 0.7;
    const [gx, gy] = toCss([A.ground.x, A.ground.y + 6]);
    const k = 1 - smooth(0, 140, -P.jy) * 0.35;
    const gr = bx.createRadialGradient(gx, gy, 0, gx, gy, 330 * S * k);
    gr.addColorStop(0, `rgba(80,60,20,${0.22 * g0})`); gr.addColorStop(1, 'rgba(80,60,20,0)');
    bx.save(); bx.translate(gx, gy); bx.scale(1, 0.12); bx.translate(-gx, -gy); bx.fillStyle = gr; bx.beginPath(); bx.arc(gx, gy, 330 * S * k, 0, TAU); bx.fill(); bx.restore();
  }
  function drawFront(dt) {
    fx.setTransform(dpr, 0, 0, dpr, 0, 0); fx.clearRect(0, 0, W, H);
    // glowing headset and tablet heart
    const li = layerOf('idle');
    if (aSit > 0.01 && li) {
      LSQ = li.sq; LJY = li.jy;
      glow(fx, mapPoint(A.headset.x, A.headset.y), 95, '150,240,60', headsetGlow * aSit * li.a * 0.9, 0.55, 1);
      const hb = heartGlow; glow(fx, mapPoint(A.heart.x, A.heart.y), 70 + 18 * (hb - 1), '160,255,80', hb * aSit * li.a * 0.75);
    }
    for (const n of [poseCur]) {
      const z = pz[n], lay = n !== 'idle' && z && layerOf(n);
      if (!lay || aSit <= 0.01) continue;
      LSQ = lay.sq; LJY = lay.jy; const d = z.d, a = aSit * lay.a;
      glow(fx, mapPose(n, d.headset[0], d.headset[1]), 90, '150,240,60', headsetGlow * a * 0.9, 0.55, 1);
      if (d.heart) glow(fx, mapPose(n, d.heart[0], d.heart[1]), 68, '160,255,80', heartGlow * a * 0.75);
      if (blink < 0.985) for (const e of d.eyes) {   // eyelid closing over the painted eye
        const c = toCss(mapPose(n, e.x, e.y)), rx = e.rx * S, ry = e.ry * S, lid = c[1] - ry * 1.12 + ry * 2.24 * (1 - blink);
        // the lid: skin colour of the face around the eye, with a soft rim so no hard oval shows
        // the lid: the skin patch painted under this eye (made at build time), uncovered from the top down
        if (z.lids) {
          const m = 16, sx = e.x - d.x - e.rx - m, sy = e.y - d.y - e.ry - m, sw = (e.rx + m) * 2, sh = (e.ry + m) * 2;
          fx.save(); fx.globalAlpha = a; fx.beginPath(); fx.rect(c[0] - sw * S, c[1] - sh * S, sw * 2 * S, lid - (c[1] - sh * S)); fx.clip();
          fx.drawImage(z.lids, sx, sy, sw, sh, c[0] - sw / 2 * S, c[1] - sh / 2 * S, sw * S, sh * S);
          fx.restore();
        }
        fx.save(); fx.globalAlpha = a; fx.strokeStyle = '#3A1E0C'; fx.lineCap = 'round'; fx.lineWidth = Math.max(1.5, ry * 0.11);
        const hw = rx * Math.sqrt(Math.max(0, 1 - ((lid - c[1]) / (ry * 1.12)) ** 2)) * 1.05;
        if (hw > 1) { fx.beginPath(); fx.moveTo(c[0] - hw, lid); fx.quadraticCurveTo(c[0], lid + ry * 0.16 * (1 - blink), c[0] + hw, lid); fx.stroke(); }
        fx.restore();
      }
    }
    LSQ = 0; LJY = 0;
    if (aLie > 0.01) glow(fx, mapLie(LIE_A.headset.x, LIE_A.headset.y), 80, '150,240,60', headsetGlow * aLie * 0.8, 0.6, 1);
    if (aLie > 0.01 && lieEyes > 0.005 && img.sleep_lids && L.sleep.eyes) {
      const kk = S * LIE.k * lieS * (1 + lieRise * 0.06);
      fx.save(); fx.globalAlpha = aLie * smooth(0, 0.2, lieEyes);
      for (const e of L.sleep.lids) {   // skin over the closed-eye crescents
        const c = toCss(mapLie(e.x, e.y));
        fx.drawImage(img.sleep_lids, e.x - e.rx, e.y - e.ry, e.rx * 2, e.ry * 2, c[0] - e.rx * kk, c[1] - e.ry * kk, e.rx * 2 * kk, e.ry * 2 * kk);
      }
      fx.globalAlpha = aLie;
      L.sleep.eyes.forEach((e, i) => {   // the original open eyes, scaled to this face and tilted with it
        const n = i ? 'eye_r' : 'eye_l', sp = L[n], c = toCss(mapLie(e.x, e.y)), open = Math.max(0.04, lieEyes);
        fx.save(); fx.translate(c[0], c[1] + sp.ry * e.s * kk * (1 - open) * 0.4); fx.rotate(e.rot); fx.scale(e.s * kk, e.s * kk * open);
        fx.drawImage(img[n], sp.x - sp.cx, sp.y - sp.cy); fx.restore();
      });
      fx.restore();
    }
    // particles
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.age += dt;
      if (p.age >= p.life) { parts.splice(i, 1); continue; }
      const u = p.age / p.life;
      if (p.type === 'spark') { p.vy += 380 * dt; p.vx *= 0.98; }
      else if (p.type === 'heart') { p.vy *= 0.985; p.vx *= 0.97; p.x += Math.sin(p.age * 6) * 0.6; }
      else if (p.type === 'z') { p.vx = 50 + Math.sin(p.age * 2.4) * 30; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const [x, y] = toCss([p.x, p.y]); const sz = p.s * S;
      const a = u < 0.15 ? u / 0.15 : 1 - smooth(0.6, 1, u);
      fx.save(); fx.globalAlpha = a; fx.fillStyle = p.c;
      if (p.type === 'spark') drawStar(fx, x, y, sz * (u < 0.2 ? u / 0.2 : 1), p.r + p.age * 3);
      else if (p.type === 'heart') { heartPath(fx, x, y, sz * 0.6 * Math.min(1, u * 5)); fx.fill(); }
      else if (p.type === 'z' || p.type === 'note' || p.type === 'q' || p.type === 'ex') {
        fx.translate(x, y); fx.rotate(p.r); const s = sz * (p.type === 'q' || p.type === 'ex' ? Math.min(1, 0.4 + u * 6) * (1 + 0.06 * Math.sin(p.age * 12)) : 0.6 + u * 0.7);
        fx.font = `900 ${s}px "Arial Rounded MT Bold","Pretendard",system-ui,sans-serif`; fx.textAlign = 'center'; fx.textBaseline = 'middle';
        fx.lineWidth = s * 0.16; fx.strokeStyle = night > 0.5 ? 'rgba(20,24,60,0.9)' : 'rgba(255,255,255,0.95)'; fx.lineJoin = 'round';
        const t = p.type === 'z' ? 'Z' : p.type === 'note' ? '♪' : p.type === 'q' ? '?' : '!'; fx.strokeText(t, 0, 0); fx.fillStyle = night > 0.5 ? '#FFE9A8' : p.c; fx.fillText(t, 0, 0);
      }
      fx.restore();
    }
  }

  // ---------------------------------------------------------------- behaviour
  function setExpr(name) {
    if (!EXPRESSIONS[name] || name === expr) return;
    prevExpr = exprT < 0.5 ? prevExpr : expr; expr = name; exprT = 0; kick();
  }
  function emit() { if (opts.onChange) opts.onChange(api.state); }
  function hornKick(v) { horn.v += v; }

  const SEQ = {
    jump: { dur: 1.0, run(t, s) {
      let sq = 0, jy = 0; const H0 = opts.reducedMotion ? 30 : 95;
      if (t < 0.13) sq = 0.07 * easeOut(t / 0.13);
      else if (t < 0.56) { const u = (t - 0.13) / 0.43; jy = -H0 * Math.sin(PI * u); sq = -0.07 * Math.max(0, 1 - u * 2.4) + 0.02 * smooth(0.7, 1, u); if (!s.k1) { s.k1 = 1; hornKick(-3.2); } if (u > 0.45 && !s.sp) { s.sp = 1; const p = mapPoint(480, 330); spawn('spark', p[0], p[1], 9); } }
      else if (t < 0.7) { sq = 0.085 * Math.sin(PI * (t - 0.56) / 0.14); if (!s.k2) { s.k2 = 1; hornKick(4); leaf.v += 3; } }
      else { const u = (t - 0.7) / 0.3; sq = -0.025 * Math.sin(u * PI * 2) * (1 - u); }
      P.sq = sq; P.jy = jy; P.arms = jy < 0 ? -jy * 0.08 : 0;
    }, start() { setExpr('laugh'); }, end() { P.sq = 0; P.jy = 0; P.arms = 0; setExpr(baseExpr); } },

    love: { dur: 1.9, run(t, s) {
      if (!s.b) { s.b = 1; const p = mapPoint(A.heart.x, A.heart.y - 30); spawn('heart', p[0], p[1], 9); }
      heartGlow = 1 + 0.9 * Math.max(0, Math.sin(t * 9)) * (1 - t / 1.9);
      const u = clamp(t / 0.5, 0, 1); P.jy = -26 * Math.sin(PI * u) * (opts.reducedMotion ? 0.3 : 1); P.arms = 10 * Math.sin(PI * clamp(t / 1.2, 0, 1));
      P.head = 0.05 * Math.sin(t * 7) * (1 - t / 1.9);
    }, start() { setExpr('love'); hornKick(-2); }, end() { heartGlow = 1; P.jy = 0; P.arms = 0; P.head = 0; setExpr(baseExpr); } },

    tablet: { dur: 3.2, run(t, s) {   // look down at the tablet, tap it, smile
      const down = smooth(0, 0.4, t) * (1 - smooth(2.5, 2.9, t));
      look.tx = -0.08 * down; look.ty = 0.95 * down;
      const tap = t > 0.6 && t < 2.2 ? Math.max(0, Math.sin((t - 0.6) * TAU * 1.9)) : 0;
      const left = Math.floor((t - 0.6) * 1.9) % 2 === 0;
      P.tapL = left ? tap * 7 : 0; P.tapR = left ? 0 : tap * 7;
      heartGlow = 1 + tap * 0.6;
      if (tap > 0.95 && !s['h' + Math.floor(t * 2)]) { s['h' + Math.floor(t * 2)] = 1; const p = mapPoint(A.heart.x, A.heart.y - 20); spawn('heart', p[0], p[1], 1); }
      if (t > 2.6 && !s.l) { s.l = 1; setExpr('laugh'); hornKick(1.5); }
    }, start() { pointerT = -10; }, end() { P.tapL = P.tapR = 0; heartGlow = 1; setExpr(baseExpr); } },

    wiggle: { dur: 1.5, run(t) {
      P.head = 0.07 * Math.sin(t * TAU / 0.75) * (1 - t / 1.5); P.sway = 0.025 * Math.sin(t * TAU / 0.75 + 0.6) * (1 - t / 1.5);
      if (t > 1.1) { const p = mapPoint(780, 280); if (!this.n) { this.n = 1; spawn('note', p[0], p[1], 1); } }
    }, start() { this.n = 0; setExpr('laugh'); }, end() { P.head = 0; P.sway = 0; setExpr(baseExpr); } },

    doze: { dur: 2.6, run(t, s) {   // yawn, eyes close, head droops
      if (t < 0.9) { if (!s.y) { s.y = 1; setExpr('yawn'); } P.sq = -0.03 * Math.sin(PI * t / 0.9); }
      else if (t < 1.6) { if (!s.h) { s.h = 1; setExpr('sleepy'); } }
      else if (!s.z) { s.z = 1; setExpr('sleep'); }
      P.droop = smooth(0.9, 2.4, t);
    }, end() { P.sq = 0; P.droop = 1; } },

    wake: { dur: 1.8, run(t, s) {
      P.droop = 1 - smooth(0, 0.5, t);
      if (t > 0.35 && !s.a) { s.a = 1; prevExpr = expr = 'smile'; exprT = 1; blink = 0.05; }
      if (t > 0.35 && t < 0.95) blink = [0.35, 0.05, 0.6, 0.1, 1][Math.min(4, Math.floor((t - 0.35) / 0.12))];
      if (t > 0.95 && !s.b) { s.b = 1; blink = 1; setExpr('surprise'); hornKick(-2.5); const p = mapPoint(480, 330); spawn('spark', p[0], p[1], 7); }
      if (t > 0.95) { const u = (t - 0.95) / 0.85; P.sq = -0.05 * Math.sin(PI * clamp(u * 1.6, 0, 1)); }
      if (t > 1.45 && !s.c) { s.c = 1; setExpr('smile'); }
    }, end() { P.sq = 0; P.droop = 0; blink = 1; setExpr(baseExpr); } },

    toLie: { dur: 1.7, run(t, s) {   // night falls, the sitting one sinks down, the lying one pops up
      night = smooth(0, 1.1, t);
      const sink = smooth(0.15, 0.7, t); P.sq = 0.11 * sink; P.jy = 22 * sink;
      aSit = 1 - smooth(0.42, 0.72, t);
      const u = clamp((t - 0.6) / 0.65, 0, 1); aLie = smooth(0.6, 0.95, t); lieS = 0.88 + 0.12 * easeOutBack(u); lieDY = 28 * (1 - easeOut(u));
      if (t > 0.62 && !s.p) { s.p = 1; const p = lieToArt(450, 380); spawn('spark', p[0], p[1], 9); }
    }, end() { P.sq = 0; P.jy = 0; aSit = 0; aLie = 1; night = 1; lieS = 1; lieDY = 0; } },
    fromLie: { dur: 1.75, run(t, s) {
      // 0-0.5 wriggle
      lieSway = 0.035 * Math.sin(t * TAU * 2.2) * (1 - smooth(0.2, 0.55, t));
      // 0.5-0.9 eyes flutter open
      lieEyes = t < 0.5 ? 0 : t < 0.6 ? 0.4 * (t - 0.5) / 0.1 : t < 0.68 ? 0.4 - 0.35 * (t - 0.6) / 0.08 : Math.min(1, 0.05 + (t - 0.68) / 0.14);
      if (t > 0.74 && !s.ex) { s.ex = 1; const p = lieToArt(560, 120); spawn('ex', p[0], p[1], 1); hornKick(-1.5); }
      night = 1 - smooth(0.55, 1.5, t);
      // 0.95-1.2 stretch up off the floor
      lieRise = easeInOut(clamp((t - 0.95) / 0.25, 0, 1)); lieDY = -16 * lieRise;
      // 1.2 pop: sitting up
      if (t >= 1.2) {
        if (!s.pop) { s.pop = 1; aLie = 0; aSit = 1; for (let i = parts.length - 1; i >= 0; i--) if (parts[i].type === 'ex') parts.splice(i, 1); const p = mapPoint(480, 520); spawn('spark', p[0], p[1], 10); hornKick(-3); }
        const u = t - 1.2; P.sq = 0.1 * Math.cos(u * 12) * Math.exp(-u * 6); P.jy = -32 * Math.sin(PI * clamp(u / 0.32, 0, 1));
      }
    }, start() {
      prevExpr = expr = 'smile'; exprT = 1; blink = 1; P.droop = 0; aLie = 1; aSit = 0; lieEyes = 0; lieRise = 0;
      for (let i = parts.length - 1; i >= 0; i--) if (parts[i].type === 'z') parts.splice(i, 1);
    }, end() { aSit = 1; aLie = 0; night = 0; lieS = 1; lieDY = 0; lieEyes = 0; lieRise = 0; lieSway = 0; P.sq = 0; P.jy = 0; } },

    lieToSit: { dur: 1.2, run(t) {   // still asleep: from lying back to sitting (eyes stay closed)
      const out = smooth(0, 0.35, t); aLie = 1 - out; lieS = 1 - 0.1 * out; lieDY = 22 * out;
      aSit = smooth(0.25, 0.5, t); const u = Math.max(0, t - 0.25); P.sq = t < 0.25 ? 0.1 : 0.1 * Math.cos(u * 10) * Math.exp(-u * 5);
      night = 1 - smooth(0.2, 1.2, t);
    }, start() { prevExpr = expr = 'sleep'; exprT = 1; P.droop = 1; }, end() { aSit = 1; aLie = 0; night = 0; lieS = 1; lieDY = 0; P.sq = 0; } },

    nod: { dur: 1.15, run(t) {   // yes, yes
      P.nod = Math.max(0, Math.sin(t * TAU / 0.52)) * (1 - smooth(0.7, 1.15, t)); P.sq = 0.012 * P.nod;
    }, start() { setExpr('laugh'); }, end() { P.nod = 0; P.sq = 0; setExpr(baseExpr); } },

    shake: { dur: 1.3, run(t) {   // no, no
      P.shk = 0.9 * Math.sin(t * TAU / 0.44) * (1 - smooth(0.55, 1.3, t)); P.head = -0.045 * P.shk;
    }, end() { P.shk = 0; P.head = 0; } },

    hello: { dur: 1.7, run(t, s) {   // hop, wink, sparkle, wiggle
      const u = clamp(t / 0.5, 0, 1); P.jy = -48 * Math.sin(PI * u) * (opts.reducedMotion ? 0.3 : 1);
      P.sq = t < 0.08 ? 0.05 * (t / 0.08) : (t > 0.5 && t < 0.62 ? 0.06 * Math.sin(PI * (t - 0.5) / 0.12) : 0);
      if (t > 0.1 && !s.w) { s.w = 1; setExpr('wink'); hornKick(-2.5); }
      if (t > 0.3 && !s.p) { s.p = 1; const p = mapPoint(250, 300); spawn('spark', p[0], p[1], 6); const q = mapPoint(780, 260); spawn('note', q[0], q[1], 1); }
      P.head = 0; P.sway = 0;
      if (t > 0.62) { const v = t - 0.62; P.head = 0.06 * Math.sin(v * TAU / 0.6) * Math.max(0, 1 - v / 1.05); P.sway = 0.02 * Math.sin(v * TAU / 0.6 + 0.5) * Math.max(0, 1 - v / 1.05); }
      if (t > 1.2 && !s.l) { s.l = 1; setExpr('laugh'); }
    }, end() { P.jy = 0; P.sq = 0; P.head = 0; P.sway = 0; setExpr(baseExpr); } }
  };
  const queue = [];
  function play(type, then) {
    if (seq && SEQ[seq.type].end) SEQ[seq.type].end.call(SEQ[seq.type], seq);
    seq = { type, t0: now, then };
    if (SEQ[type].start) SEQ[type].start.call(SEQ[type], seq);
    emit(); kick();
  }
  function runSeq() {
    if (!seq) return;
    const d = SEQ[seq.type], t = now - seq.t0;
    d.run.call(d, Math.min(t, d.dur), seq);
    if (t >= d.dur) {
      const then = seq.then; if (d.end) d.end.call(d, seq); seq = null;
      if (then) then(); else emit();
    }
  }

  function goSleep(kind) {
    kind = kind === 'lie' ? 'lie' : 'sit';
    if (poseCur !== 'idle') { switchPose('idle', true); poseHoldEnd = 0; }
    if (mode === 'sleep' && pose === kind) return;
    if (mode === 'sleep' && pose === 'sit' && kind === 'lie') { pose = 'lie'; play('toLie', emit); return; }
    if (mode === 'sleep' && pose === 'lie' && kind === 'sit') { pose = 'sit'; play('lieToSit', emit); return; }
    mode = 'sleep'; pose = kind; baseExpr = 'smile';
    play('doze', () => { if (kind === 'lie') play('toLie', emit); else emit(); });
  }
  function goWake() {
    if (mode !== 'sleep') return;
    const wasLie = pose === 'lie'; mode = 'awake'; pose = 'awake';
    if (wasLie) play('fromLie', () => { if (pz.cheer) { setPose('cheer', 1.3); const p = mapPose('cheer', 476, 300); spawn('spark', p[0], p[1], 8); } else emit(); }); else play('wake');
  }

  // idle life
  function idle(dt) {
    if (!opts.idle || mode !== 'awake' || seq || opts.reducedMotion) return;
    idleNext -= dt;
    if (now - pointerT > 2.5) {
      idleLookT -= dt;
      if (idleLookT <= 0) { idleLookT = rand(1.8, 4.2); const c = Math.random() < 0.35; look.tx = c ? 0 : rand(-0.7, 0.7); look.ty = c ? 0 : rand(-0.35, 0.35); }
    }
    if (idleNext <= 0) {
      idleNext = rand(6, 11); if (poseCur !== 'idle') return;
      const r = Math.random();
      if (r < 0.14 && pz.wave) setPose('wave', 2.2); else if (r < 0.24 && pz.think) { setPose('think', 2.4); const p = mapPose('think', 560, 60); spawn('q', p[0], p[1], 1); } else if (r < 0.4) play('tablet'); else if (r < 0.55) play('wiggle'); else if (r < 0.65) play('nod'); else if (r < 0.75) play('hello'); else if (r < 0.87) { setExpr('wink'); setTimeout(() => { if (expr === 'wink' && !seq) setExpr(baseExpr); }, 900); } else play('jump');
    }
  }

  // ---------------------------------------------------------------- frame
  function step(t) {
    if (last && t <= last) return;   // the clock went backwards (advance() ran ahead of the page): nothing to do
    const dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016); last = t; now += dt;
    const rm = opts.reducedMotion;
    runSeq(); idle(dt);
    if (poseCur !== 'idle' && poseHoldEnd && now > poseHoldEnd) { poseHoldEnd = 0; switchPose('idle'); emit(); }
    if (posePrev !== poseCur && poseAge() >= 0.1 && !puffDone) {   // the swap: a little puff hides the cut
      puffDone = true; const c = poseCur !== 'idle' && pz[poseCur] ? mapPose(poseCur, pz[poseCur].d.neck[0], pz[poseCur].d.neck[1] - 150) : mapPoint(480, 600);
      if (!opts.reducedMotion) for (let i = 0; i < 5; i++) spawn('spark', c[0] + rand(-300, 300), c[1] + rand(-280, 120), 1);
    }
    if (posePrev !== poseCur && poseAge() > 0.2) posePrev = poseCur;
    // expression crossfade and smoothed numbers
    exprT = Math.min(1, exprT + dt / 0.16);
    const E = EXPRESSIONS[expr], kk = 1 - Math.exp(-dt * 14);
    for (const n of ['bl', 'bt', 'es', 'mx', 'my', 'blush']) num[n] += (E[n] - num[n]) * kk;
    // blinking (single or double); the wake sequence drives the eyes itself
    if (!(seq && seq.type === 'wake')) {
      if (blinkT < 0) {
        blink = 1; nextBlink -= dt;
        if (nextBlink <= 0 && mode === 'awake') { blinkT = 0; blinkN = Math.random() < 0.22 ? 2 : 1; }
      } else {
        blinkT += dt; const d = 0.17, cyc = 0.25, i = Math.floor(blinkT / cyc), u = blinkT - i * cyc;
        blink = i < blinkN && u < d ? 1 - Math.sin(PI * u / d) * 0.96 : 1;
        if (blinkT >= blinkN * cyc) { blinkT = -1; nextBlink = rand(2.2, 5.5); }
      }
    }
    // look: spring toward target
    const kL = 1 - Math.exp(-dt * (seq && seq.type === 'tablet' ? 6 : 4.5));
    const ltx = mode === 'sleep' ? 0 : look.tx, lty = mode === 'sleep' ? 0.35 : look.ty;
    const ox = look.x; look.x += (ltx * (rm ? 0.4 : 1) - look.x) * kL; look.y += (lty * (rm ? 0.4 : 1) - look.y) * kL;
    // breathing
    const asleep = mode === 'sleep' || (seq && seq.type === 'doze');
    const per = asleep ? 4.6 : 3.2;
    P.breath = Math.sin(now * TAU / per) * (asleep ? 1.6 : 1) * (rm ? 0.5 : 1);
    // head: droop when asleep + a slow nod, tilt toward the look direction
    const nod = asleep ? Math.sin(now * TAU / per + 0.8) * 0.012 : 0;
    const baseHead = P.droop * 0.07 + look.x * 0.045 + nod;
    if (!(seq && (seq.type === 'wiggle' || seq.type === 'love' || seq.type === 'shake' || seq.type === 'hello'))) P.head += (baseHead - P.head) * (1 - Math.exp(-dt * 8));
    else P.head = clamp(P.head + baseHead * 0.3, -0.16, 0.16);   // the sequence set P.head this frame; add the look tilt once
    P.hy = P.droop * 16 + (asleep ? P.breath * 2 : 0);
    P.hx = P.droop * 6;
    // springs: horn and leaf, driven by head motion
    const headX = P.head * 300 + (look.x + P.shk) * 24 + P.nod * 6 + P.jy * 0.02, hv = (headX - lastHeadX) / Math.max(dt, 1e-3), ha = (hv - lastHeadV) / Math.max(dt, 1e-3);
    lastHeadX = headX; lastHeadV = hv;
    const drive = clamp(-ha * 0.00012, -6, 6);
    horn.v += (-60 * horn.a - 5.5 * horn.v + drive) * dt; horn.a += horn.v * dt; horn.a = clamp(horn.a, -0.12, 0.12);
    const breeze = rm ? 0 : Math.sin(now * 2.1) * 0.6 + Math.sin(now * 3.7) * 0.3;
    leaf.v += (-50 * leaf.a - 4 * leaf.v + breeze * 0.8 + drive * 0.5) * dt; leaf.a += leaf.v * dt; leaf.a = clamp(leaf.a, -0.2, 0.2);
    // glows
    headsetGlow = asleep ? 0.55 + 0.35 * Math.sin(now * 1.4) : 0.85 + 0.15 * Math.sin(now * 2.2);
    if (!(seq && (seq.type === 'love' || seq.type === 'tablet'))) heartGlow = 1 + (asleep ? -0.3 : 0.12 * Math.max(0, Math.sin(now * 4.4)) * Math.max(0, Math.sin(now * 2.2)));
    // Zzz
    if (asleep && !rm && Math.floor(now / 1.5) !== Math.floor((now - dt) / 1.5)) {
      const p = aLie > 0.5 ? mapLie(LIE_A.zzz.x, LIE_A.zzz.y) : mapPoint(A.zzz.x, A.zzz.y); spawn('z', p[0], p[1], 1);
    }
    // mesh
    for (const n of poseNames()) {   // pose meshes
      const z = pz[n], lay = n !== 'idle' && z && layerOf(n);
      if (!lay || aSit <= 0.001) continue;
      LSQ = lay.sq; LJY = lay.jy;
      for (let k = 0; k < NV; k++) { deformPose(z, z.rest[k * 2], z.rest[k * 2 + 1], z.wh[k], k, tmp); z.pos[k * 2] = tmp[0]; z.pos[k * 2 + 1] = tmp[1]; }
    }
    const lIdle = layerOf('idle'); LSQ = lIdle ? lIdle.sq : 0; LJY = lIdle ? lIdle.jy : 0;
    if (aSit > 0.001 && lIdle) {
      const out = tmp;
      for (let k = 0; k < NV; k++) {
        deform(rest[k * 2], rest[k * 2 + 1], wHead[k], wDepth[k], wHorn[k], wLeaf[k], wHL[k], wHR[k], wTab[k], wSet[k], out);
        pos[k * 2] = out[0]; pos[k * 2 + 1] = out[1];
      }
    }
    if (aLie > 0.001) {
      for (let k = 0; k < NV; k++) { lieShape(lrest[k * 2], lrest[k * 2 + 1], wLHead[k], tmp); lpos[k * 2] = tmp[0]; lpos[k * 2 + 1] = tmp[1]; }
    }
    updateSay();
    talking = userTalk || sayTalk;
    const fd = drawFace();
    if (gl) drawGL(fd); else draw2D();
    drawBack(); drawFront(dt);
  }

  // ---------------------------------------------------------------- speech bubble
  function ensureStyle() {
    if (document.getElementById('n2d-style')) return;
    const st = document.createElement('style'); st.id = 'n2d-style';
    st.textContent = `.n2d-bubble{position:absolute;left:0;top:0;z-index:3;max-width:min(78%,320px);padding:10px 15px;border-radius:18px;background:#fff;color:#3b2a12;
font:600 15px/1.45 "Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;box-shadow:0 6px 18px rgba(80,60,20,.18);
transform-origin:var(--tail,50%) 100%;transform:translate(-50%,-100%) scale(.5);opacity:0;transition:transform .24s cubic-bezier(.3,1.6,.5,1),opacity .18s;
pointer-events:none;word-break:keep-all;overflow-wrap:anywhere;text-align:center;white-space:pre-line}
.n2d-bubble.on{transform:translate(-50%,-100%) scale(1);opacity:1}
.n2d-bubble::after{content:"";position:absolute;left:var(--tail,50%);bottom:-8px;width:16px;height:16px;background:#fff;transform:translateX(-50%) rotate(45deg);border-radius:3px}
.n2d-bubble .n2d-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}`;
    document.head.appendChild(st);
  }
  function updateSay() {
    if (!say) { sayTalk = false; return; }
    const el = now - say.t0, n = Math.min(say.text.length, Math.floor(el / 0.055));
    if (n !== say.shown) { say.shown = n; say.vis.textContent = say.text.slice(0, n); }
    sayTalk = n < say.text.length && el < say.typeEnd;
    // place it over the head, inside the stage
    const a = aLie > 0.5 ? toCss(lieToArt(300, 160)) : poseCur !== 'idle' && pz[poseCur] ? toCss(mapPose(poseCur, pz[poseCur].d.neck[0] - 60, pz[poseCur].d.y + 90)) : toCss(mapPoint(470, 120));
    const bw = bubble.offsetWidth || 120, left = clamp(a[0], bw / 2 + 6, W - bw / 2 - 6), top = Math.max(a[1], (bubble.offsetHeight || 40) + 14);
    bubble.style.left = left + 'px'; bubble.style.top = top + 'px';
    bubble.style.setProperty('--tail', clamp(a[0] - left + bw / 2, 22, bw - 22) + 'px');
    if (el > say.typeEnd + say.hold && !say.closing) { say.closing = true; bubble.classList.remove('on'); }
    if (el > say.typeEnd + say.hold + 0.25) { const r = say.resolve; say = null; sayTalk = false; r(); }
  }
  function drawBubbleTo(x) {   // the bubble into snapshots (preview videos)
    // untransformed size and the anchor point (bottom centre); the pop-in is redone here on animation time
    const k = dpr, w = bubble.offsetWidth, hh = bubble.offsetHeight, ax = parseFloat(bubble.style.left) || 0, ay = parseFloat(bubble.style.top) || 0;
    const pop = 0.5 + 0.5 * easeOutBack(clamp((now - say.t0) / 0.24, 0, 1));
    const bw = w * k, bh = hh * k, bx0 = (ax - w / 2) * k, by0 = (ay - hh) * k;
    const tail = (parseFloat(bubble.style.getPropertyValue('--tail')) || w / 2) * k;
    x.save(); x.translate(bx0 + tail, by0 + bh); x.scale(pop, pop); x.translate(-(bx0 + tail), -(by0 + bh)); x.shadowColor = 'rgba(80,60,20,0.18)'; x.shadowBlur = 18 * k; x.shadowOffsetY = 6 * k; x.fillStyle = '#fff';
    x.beginPath(); x.roundRect(bx0, by0, bw, bh, 18 * k); x.fill(); x.shadowColor = 'transparent';
    x.beginPath(); x.moveTo(bx0 + tail - 10 * k, by0 + bh - 1); x.lineTo(bx0 + tail, by0 + bh + 10 * k); x.lineTo(bx0 + tail + 10 * k, by0 + bh - 1); x.fill();
    x.fillStyle = '#3b2a12'; x.font = `600 ${15 * k}px "Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    // wrap like the page does (keep words together), using the full text so lines do not jump while typing
    const full = say.text, shown = say.vis.textContent.length, maxW = bw - 22 * k, words = full.split(' '), lines = [];
    let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (x.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
    lines.push(line);
    let left = shown; const vis = lines.map((l) => { const take = Math.max(0, Math.min(l.length, left)); left -= take + 1; return l.slice(0, take); });
    const lh = 15 * 1.45 * k; x.textAlign = 'left'; vis.forEach((l, i) => x.fillText(l, bx0 + bw / 2 - x.measureText(lines[i]).width / 2, by0 + bh / 2 + (i - (lines.length - 1) / 2) * lh));
    x.restore();
  }

  // ---------------------------------------------------------------- loop, size, input
  function loop(t) { raf = 0; if (dead || !ready || !visible) return; step(t); raf = requestAnimationFrame(loop); }
  function kick() { if (!raf && ready && visible && !dead) { last = 0; raf = requestAnimationFrame(loop); } }
  function resize() {
    const r = host.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height);
    dpr = Math.min(window.devicePixelRatio || 1, opts.maxPixelRatio);
    for (const c of [back, cv, front]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    S = Math.min(W / VIEW.w, H / VIEW.h); OX = (W - VIEW.w * S) / 2 - VIEW.x * S; OY = (H - VIEW.h * S) / 2 - VIEW.y * S;
    if (gl) { gl.viewport(0, 0, cv.width, cv.height); }
    faceSig = ''; kick();
  }
  const ro = new ResizeObserver(resize); ro.observe(host);
  const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((es) => { visible = es[0].isIntersecting && !document.hidden; kick(); }) : null;
  if (io) io.observe(host);
  const onVis = () => { visible = !document.hidden; kick(); };
  document.addEventListener('visibilitychange', onVis);
  const onMove = (e) => {
    if (!opts.lookAtPointer || mode !== 'awake' || (seq && seq.type === 'tablet')) return;
    const r = host.getBoundingClientRect(); const c = toCss(mapPoint(478, 560));
    look.tx = clamp((e.clientX - r.left - c[0]) / (r.width * 0.45), -1, 1);
    look.ty = clamp((e.clientY - r.top - c[1]) / (r.height * 0.5), -0.6, 0.7);
    pointerT = now;
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  const onDown = (e) => {
    if (!opts.tap || !ready) return;
    const r = host.getBoundingClientRect(), x = (e.clientX - r.left - OX) / S, y = (e.clientY - r.top - OY) / S;
    if (mode === 'sleep') { if (!seq) goWake(); return; }
    if (seq && seq.type !== 'tablet' && seq.type !== 'wiggle') return;
    const onTab = x > A.tablet.x0 - 30 && x < A.tablet.x1 + 30 && y > A.tablet.y0 - 20 && y < A.tablet.y1 + 20;
    if (onTab) play('love');
    else if (x > 60 && x < 980 && y > 40 && y < 990) play('jump');
  };
  front.addEventListener('pointerdown', onDown);

  // ---------------------------------------------------------------- load
  const load = (n) => new Promise((res, rej) => { const im = new Image(); im.decoding = 'async'; im.onload = () => res(im); im.onerror = () => rej(new Error('narang2d: ' + n)); im.src = opts.assets + n + '.webp'; });
  Promise.all([fetch(opts.assets + 'layout.json').then((r) => r.json()), fetch(opts.assets + 'poses.json').then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((j) => (j ? Promise.all(Object.entries(j).map(([n, d]) => new Promise((res) => { const im = new Image(); im.onload = () => { if (!d.lids) return res([n, d, im, null]); const lm = new Image(); lm.onload = () => res([n, d, im, lm]); lm.onerror = () => res([n, d, im, null]); lm.src = opts.assets + d.lids; }; im.onerror = () => res(null); im.src = opts.assets + d.img; }))) : [])), ...['base', 'sleep', 'eye_l', 'eye_r', 'brow_l', 'brow_r', 'mouth', 'sleep_lids'].map((n) => load(n).catch(() => null))])
    .then(([lay, poseList, ...ims]) => {
      if (dead) return;
      L = lay; buildLie(lay.sleep.w, lay.sleep.h);
      for (const e of poseList) if (e) { e[1].name = e[0]; buildPose(e[0], e[1], e[2]); pz[e[0]].lids = e[3]; } ['base', 'sleep', 'eye_l', 'eye_r', 'brow_l', 'brow_r', 'mouth', 'sleep_lids'].forEach((n, i) => { img[n] = ims[i]; });
      if (gl) { try { initGL(); } catch (err) { console.warn('narang2d: WebGL failed, using 2D', err); gl = null; } }
      if (!gl && !c2) { cv.remove(); const n = mk(1); host.insertBefore(n, front); c2 = n.getContext('2d'); }
      if (mode === 'sleep') { P.droop = 1; }
      ready = true; resize(); emit();
      if (opts.onReady) opts.onReady(api);
    })
    .catch((err) => { console.error(err); host.dataset.narangError = '1'; });

  // ---------------------------------------------------------------- api
  const api = {
    /** smile | laugh | wink | surprise | sad | love — stays until changed */
    setExpression(name) {
      if (!EXPRESSIONS[name] || name === 'sleep') return;
      if (mode === 'sleep') { baseExpr = name; goWake(); return; }
      baseExpr = name; if (!seq) setExpr(name);
    },
    jump() { if (ready && mode === 'awake' && !(seq && seq.type !== 'tablet' && seq.type !== 'wiggle')) play('jump'); },
    love() { if (ready && mode === 'awake' && !(seq && seq.type !== 'tablet' && seq.type !== 'wiggle')) play('love'); },
    lookAtTablet() { if (ready && mode === 'awake' && !seq) play('tablet'); },
    wiggle() { if (ready && mode === 'awake' && !seq) play('wiggle'); },
    /** mouth moves as if speaking (e.g. while a guide message is read out) */
    talk(on) { userTalk = !!on; faceSig = ''; kick(); },
    /** speech bubble over the head, typed out while the mouth talks. Resolves when it closes. */
    say(text, { hold } = {}) {
      text = String(text || '');
      if (!ready || !text) return Promise.resolve();
      if (mode === 'sleep') goWake();
      ensureStyle();
      if (!bubble) {
        bubble = document.createElement('div'); bubble.className = 'n2d-bubble';
        bubble.innerHTML = '<span class="n2d-v" aria-hidden="true"></span><span class="n2d-sr" role="status" aria-live="polite"></span>';
        host.appendChild(bubble);
      }
      if (say) { const r = say.resolve; say = null; r(); }
      const vis = bubble.querySelector('.n2d-v');
      bubble.querySelector('.n2d-sr').textContent = text;
      bubble.classList.remove('on'); bubble.style.width = 'auto';
      // measure the full text once so the bubble does not grow while typing
      vis.textContent = text; const w = bubble.offsetWidth; bubble.style.width = w + 'px'; vis.textContent = '';
      void bubble.offsetWidth; bubble.classList.add('on');
      const typeEnd = text.length * 0.055 + 0.1;
      return new Promise((resolve) => { say = { text, t0: now, shown: -1, vis, typeEnd, hold: hold != null ? hold : Math.max(1.4, text.length * 0.05), resolve }; kick(); });
    },
    nod() { if (ready && mode === 'awake' && !(seq && seq.type !== 'tablet' && seq.type !== 'wiggle')) play('nod'); },
    shake() { if (ready && mode === 'awake' && !(seq && seq.type !== 'tablet' && seq.type !== 'wiggle')) play('shake'); },
    hello(text) {
      if (!ready || mode !== 'awake') return;
      if (pz.wave) { setPose('wave', text ? Math.max(2.6, String(text).length * 0.06 + 1.6) : 2.6); const p = mapPose('wave', 131, 612); spawn('spark', p[0], p[1], 6); }
      else if (!(seq && seq.type !== 'tablet' && seq.type !== 'wiggle')) play('hello');
      if (text) api.say(text);
    },
    /** poses: idle | wave | cheer | point | think | surprise. hold = seconds before going back to idle (0 = stay) */
    setPose(name, hold = 0) { return setPose(name, hold); },
    get poses() { return ['idle', ...Object.keys(pz)]; },
    cheer(text) { if (setPose('cheer', text ? Math.max(2.4, String(text).length * 0.06 + 1.6) : 2.4)) { const p = mapPose('cheer', 476, 300); spawn('spark', p[0], p[1], 14); spawn('note', p[0] + 200, p[1], 1); } if (text) api.say(text); },
    /** point to the side while saying the way */
    guide(text) { if (setPose('point', text ? Math.max(3, String(text).length * 0.06 + 1.8) : 3)) { const p = mapPose('point', 923, 594); spawn('spark', p[0], p[1], 4); } if (text) api.say(text); },
    think(text) { if (setPose('think', text ? Math.max(2.6, String(text).length * 0.06 + 1.6) : 2.6)) { const p = mapPose('think', 600, 20); spawn('q', p[0], p[1], 1); } if (text) api.say(text); },
    surprised(text) { if (setPose('surprise', text ? Math.max(1.9, String(text).length * 0.06 + 1.6) : 1.9)) { const p = mapPose('surprise', 850, -40); spawn('ex', p[0], p[1], 1); } if (text) api.say(text); },
    /** 'sit' (자기 1, 앉아서) | 'lie' (자기 2, 엎드려 · 밤 배경) */
    sleep(kind = 'sit') { if (ready && !(seq && seq.type !== 'tablet' && seq.type !== 'wiggle')) goSleep(kind); },
    wake() { if (ready && !seq) goWake(); },
    /** look at a point given in -1..1 of the stage, or null to go back to idle looking */
    lookAt(x, y) { if (x == null) { pointerT = -10; return; } look.tx = clamp(x, -1, 1); look.ty = clamp(y, -0.6, 0.7); pointerT = now + 1e6; },
    setIdle(on) { opts.idle = !!on; },
    setReducedMotion(on) { opts.reducedMotion = !!on; },
    get state() { return { mode, pose: mode === 'awake' ? poseCur : pose, sleepPose: mode === 'sleep' ? pose : null, expression: baseExpr, busy: !!seq, talking: userTalk, saying: !!say }; },
    get _debug() { return { blink, expr, prevExpr, exprT, aSit, aLie, night, now, seq: seq && seq.type, P: Object.assign({}, P), horn: horn.a, leaf: leaf.a, look: { x: look.x, y: look.y } }; },
    /** run the animation forward by `sec` seconds at 60 fps (tests, posters; works in a hidden tab) */
    advance(sec) { if (!ready) return; let t = (last || performance.now()); for (let i = 0; i < Math.round(sec * 60); i++) { t += 1000 / 60; step(t); } },
    /** PNG data URL of the character layers (for posters / checks) */
    snapshot(type = 'image/png', bg = null, quality = 0.9) {
      const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; const x = c.getContext('2d');
      step((last || performance.now()) + 1); if (bg) { x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height); } x.drawImage(back, 0, 0); x.drawImage(cv, 0, 0); x.drawImage(front, 0, 0);
      if (bubble && say && !say.closing) drawBubbleTo(x);
      return c.toDataURL(type, quality);
    },
    dispose() {
      if (dead) return; dead = true; cancelAnimationFrame(raf);
      ro.disconnect(); if (io) io.disconnect(); document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onMove); front.removeEventListener('pointerdown', onDown);
      if (gl && prog) { for (const t of Object.values(tex)) gl.deleteTexture(t); for (const b of Object.values(buf)) gl.deleteBuffer(b); gl.deleteProgram(prog); }
      back.remove(); cv.remove(); front.remove(); if (bubble) bubble.remove();
    }
  };
  return api;
}
