/**
 * Narang 3D — ES module for three@0.187 (npm).
 *
 *   import { createNarang, canRender3D } from './narang.js';
 *   const n = createNarang(canvas, { model: '/narang_lite.glb', sleepModel: '/sleep.glb', mood: 'sleep' });
 *   n.wake(); n.setMood('awake'); n.jump(); n.wave(); n.dispose();
 *
 * The canvas is sized from its parent element (ResizeObserver). Rendering pauses while the
 * canvas is off screen or the tab is hidden. Background is transparent unless `background` is set.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const PI = Math.PI;

/** True when WebGL2 is available (the caller can show a still image otherwise). */
export function canRender3D() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch (e) { return false; }
}

// ---------------------------------------------------------------- face layout
// Measured on the seated model in its own (glTF) space: +x = front, +y = up, +z = character's right.
const FACE = { zc: 0.035, yc: -0.06, size: 0.56, px: 512 };
export const FACE_LAYOUT = {
  eyeA: { z: 0.172, y: -0.057 },          // appears on the viewer's left
  eyeB: { z: -0.098, y: -0.054 },         // appears on the viewer's right
  eyeHW: 0.066, eyeHH: 0.087,             // matched to the art: centres within 1px, area within 3%
  mouth: { z: 0.031, top: -0.1 }, mouthHW: 0.061,   // width = 0.45 x eye spacing, as in the art
  nose: { z: 0.031, y: -0.074, r: 0.011 },
  cheekA: { z: 0.252, y: -0.148 }, cheekB: { z: -0.198, y: -0.13 }, cheekRZ: 0.055, cheekRY: 0.044,   // drawn, no longer baked in the texture
  browY: 0.092, browHW: 0.045
};
const F = FACE_LAYOUT;
const HAND = { x: 0.33, y: -0.385, z: 0.19, r: 0.11 };   // the hand on the viewer's left
const fx = (z) => (0.5 - (z - FACE.zc) / FACE.size) * FACE.px;
const fy = (y) => (0.5 - (y - FACE.yc) / FACE.size) * FACE.px;
const fl = (v) => v / FACE.size * FACE.px;

export const EXPRESSIONS = {
  smile:    { eA: 1,    eB: 1,    sm: 1,  sz: 1,    mo: 0.72, cu: 1,    mw: 1,    rd: 0, bl: 0,     bt: 0 },
  laugh:    { eA: 0,    eB: 0,    sm: 1,  sz: 1,    mo: 1,    cu: 1,    mw: 1.12, rd: 0, bl: 0.35,  bt: 0 },
  wink:     { eA: 1,    eB: 0,    sm: 1,  sz: 1,    mo: 0.5,  cu: 1,    mw: 0.95, rd: 0, bl: 0.15,  bt: 0 },
  surprise: { eA: 1,    eB: 1,    sm: 1,  sz: 1.12, mo: 0.85, cu: 0,    mw: 0.55, rd: 1, bl: 0.9,   bt: 0 },
  sad:      { eA: 0.82, eB: 0.82, sm: 1,  sz: 1,    mo: 0,    cu: -0.9, mw: 0.62, rd: 0, bl: 0.1,   bt: 1 },
  sleep:    { eA: 0,    eB: 0,    sm: -1, sz: 1,    mo: 0,    cu: 0.55, mw: 0.42, rd: 0, bl: -0.25, bt: 0 }
};

// Eye drawn after the original art: dark rim, warm amber lower half, big soft highlight.
function drawEye(ctx, x, y, rx, ry, open, smile, side) {
  if (open > 0.14) {
    const h = ry * Math.min(open, 1);
    ctx.save();
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 2 * PI); ctx.clip();
    ctx.beginPath(); ctx.rect(x - rx - 2, y - h, 2 * rx + 4, 2 * h); ctx.clip();
    ctx.fillStyle = '#341E0C'; ctx.fillRect(x - rx - 2, y - ry - 2, 2 * rx + 4, 2 * ry + 4);
    const g = ctx.createLinearGradient(0, y - ry, 0, y + ry);
    g.addColorStop(0, '#2B1607'); g.addColorStop(0.45, '#4A2710'); g.addColorStop(0.78, '#A8621C'); g.addColorStop(1, '#D08024');
    ctx.beginPath(); ctx.ellipse(x, y + ry * 0.04, rx * 0.86, ry * 0.88, 0, 0, 2 * PI); ctx.fillStyle = g; ctx.fill();
    const pg = ctx.createRadialGradient(x, y - ry * 0.05, 0, x, y - ry * 0.05, rx * 0.55);
    pg.addColorStop(0, '#190B01'); pg.addColorStop(0.6, 'rgba(25,11,1,0.85)'); pg.addColorStop(1, 'rgba(25,11,1,0)');
    ctx.fillStyle = pg; ctx.beginPath(); ctx.ellipse(x, y - ry * 0.05, rx * 0.6, ry * 0.6, 0, 0, 2 * PI); ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.ellipse(x - rx * 0.24, y - ry * 0.36, rx * 0.33, ry * 0.27, 0.25, 0, 2 * PI); ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.ellipse(x + rx * 0.3, y + ry * 0.38, rx * 0.1, ry * 0.08, 0, 0, 2 * PI); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
    if (open < 0.97) {
      ctx.strokeStyle = '#3A2010'; ctx.lineWidth = rx * 0.16; ctx.lineCap = 'round';
      const ly = y - h;
      ctx.beginPath(); ctx.moveTo(x - rx * 0.92, ly + ry * 0.05); ctx.quadraticCurveTo(x, ly - ry * 0.08, x + rx * 0.92, ly + ry * 0.05); ctx.stroke();
    }
  } else {
    if (smile >= 0) {   // happy closed eye: ^
      ctx.strokeStyle = '#3A2010'; ctx.lineWidth = rx * 0.22; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x - rx * 0.95, y + ry * 0.18); ctx.quadraticCurveTo(x, y - ry * 0.55, x + rx * 0.95, y + ry * 0.18); ctx.stroke();
    } else {            // sleeping eye: thin crescent bowed downward, tapered ends, outer end slightly raised (as in the art)
      const w = rx * 1.08, lift = ry * 0.16, cy0 = y + ry * 0.05;
      const lx = x - w, rxx = x + w, ly = cy0 - (side < 0 ? lift : 0), ry2 = cy0 - (side > 0 ? lift : 0);
      const g = ctx.createLinearGradient(0, cy0, 0, cy0 + ry * 0.6);
      g.addColorStop(0, '#2E1608'); g.addColorStop(1, '#5A2E14');
      ctx.fillStyle = g; ctx.strokeStyle = '#3A1D0E'; ctx.lineWidth = Math.max(1, rx * 0.04); ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(lx, ly);
      ctx.quadraticCurveTo(x, cy0 + ry * 0.44, rxx, ry2);
      ctx.quadraticCurveTo(x, cy0 + ry * 0.7, lx, ly);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
}

function drawBrow(ctx, x, y, hw, lift, tilt, side) {
  ctx.save();
  ctx.translate(x, y - lift * hw * 0.55);
  ctx.rotate(side * tilt * 0.38);
  ctx.strokeStyle = '#965420'; ctx.lineWidth = hw * 0.24; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-hw * 1.05, hw * 0.22); ctx.quadraticCurveTo(0, -hw * 0.36, hw * 1.05, hw * 0.22); ctx.stroke();
  ctx.restore();
}

function drawMouth(ctx, x, top, hw, open, curve, wid, round) {
  const w = hw * wid;
  if (open > 0.06) {
    const depth = hw * 1.3 * open, corner = top - curve * hw * 0.18;
    const mp = new Path2D();
    if (round > 0.5) mp.ellipse(x, top + depth * 0.55, w * 0.62, depth * 0.62, 0, 0, 2 * PI);
    else {
      mp.moveTo(x - w, corner);
      mp.quadraticCurveTo(x, top + hw * 0.12, x + w, corner);
      mp.bezierCurveTo(x + w * 0.95, top + depth * 1.3, x - w * 0.95, top + depth * 1.3, x - w, corner);
      mp.closePath();
    }
    const mg = ctx.createLinearGradient(0, top, 0, top + depth * 1.1);
    mg.addColorStop(0, '#8A3A30'); mg.addColorStop(1, '#B4473F');
    ctx.save();
    ctx.fillStyle = mg; ctx.fill(mp); ctx.clip(mp);
    const tg = ctx.createRadialGradient(x, top + depth * 1.05, depth * 0.1, x, top + depth, w * 0.75);
    tg.addColorStop(0, '#FB8E92'); tg.addColorStop(1, '#F06C72');
    ctx.fillStyle = tg;
    ctx.beginPath(); ctx.ellipse(x, top + depth * 0.98, w * 0.68, depth * 0.52, 0, 0, 2 * PI); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(110,30,24,0.8)'; ctx.lineWidth = Math.max(1.2, hw * 0.035); ctx.lineJoin = 'round'; ctx.stroke(mp);
  } else {
    ctx.strokeStyle = '#A8262F'; ctx.lineWidth = hw * 0.085; ctx.lineCap = 'round';
    const ey = top + hw * 0.18 - curve * hw * 0.1;
    ctx.beginPath(); ctx.moveTo(x - w * 0.75, ey); ctx.quadraticCurveTo(x, ey + curve * hw * 0.55, x + w * 0.75, ey); ctx.stroke();
  }
}

function drawNose(ctx, x, y, r) {
  const sh = ctx.createRadialGradient(x, y + r * 0.9, 0, x, y + r * 0.9, r * 1.8);
  sh.addColorStop(0, 'rgba(196,150,120,0.35)'); sh.addColorStop(1, 'rgba(196,150,120,0)');
  ctx.fillStyle = sh; ctx.beginPath(); ctx.ellipse(x, y + r * 0.9, r * 1.8, r * 1.1, 0, 0, 2 * PI); ctx.fill();
  const hl = ctx.createRadialGradient(x - r * 0.25, y - r * 0.3, 0, x, y, r * 1.1);
  hl.addColorStop(0, 'rgba(255,255,255,0.95)'); hl.addColorStop(0.6, 'rgba(255,250,245,0.6)'); hl.addColorStop(1, 'rgba(255,250,245,0)');
  ctx.fillStyle = hl; ctx.beginPath(); ctx.ellipse(x, y, r * 1.2, r, 0, 0, 2 * PI); ctx.fill();
}

// feathered skin-colour patches over where the model's own eyes/brows/mouth were erased,
// so no seams or leftover specks show through (mostly visible when the eyes are closed)
function skinPatch(ctx, x, y, rx, ry) {
  ctx.save(); ctx.translate(x, y); ctx.scale(rx, ry);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, 'rgba(248,235,222,1)'); g.addColorStop(0.7, 'rgba(248,235,222,0.9)'); g.addColorStop(1, 'rgba(248,235,222,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, 2 * PI); ctx.fill(); ctx.restore();
}

function drawCheek(ctx, x, y, rx, ry) {
  ctx.save(); ctx.translate(x, y); ctx.scale(rx, ry);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, 'rgba(243,138,146,1)'); g.addColorStop(0.6, 'rgba(244,145,152,0.92)'); g.addColorStop(1, 'rgba(246,150,156,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, 2 * PI); ctx.fill(); ctx.restore();
}

function drawFace(ctx, p, eyeMul) {
  ctx.clearRect(0, 0, FACE.px, FACE.px);
  for (const e of [F.eyeA, F.eyeB]) {
    skinPatch(ctx, fx(e.z), fy(e.y), fl(F.eyeHW) * 1.7, fl(F.eyeHH) * 1.4);
    skinPatch(ctx, fx(e.z), fy(F.browY + 0.02), fl(F.browHW) * 1.8, fl(0.05));
  }
  skinPatch(ctx, fx(F.mouth.z), fy(F.mouth.top - 0.03), fl(F.mouthHW) * 1.5, fl(0.05));
  skinPatch(ctx, fx(0.035), fy(-0.06), fl(0.06), fl(0.07));   // bridge between the eyes
  drawNose(ctx, fx(F.nose.z), fy(F.nose.y), fl(F.nose.r));
  // cheeks sit a little lower and further out when asleep, as in the sleeping art
  const zz = Math.max(0, -p.sm);
  drawCheek(ctx, fx(F.cheekA.z + 0.014 * zz), fy(F.cheekA.y - 0.022 * zz), fl(F.cheekRZ), fl(F.cheekRY));
  drawCheek(ctx, fx(F.cheekB.z - 0.014 * zz), fy(F.cheekB.y - 0.022 * zz), fl(F.cheekRZ), fl(F.cheekRY));
  const rx = fl(F.eyeHW) * p.sz, ry = fl(F.eyeHH) * p.sz;
  drawBrow(ctx, fx(F.eyeA.z), fy(F.browY), fl(F.browHW), p.bl, p.bt, -1);
  drawBrow(ctx, fx(F.eyeB.z), fy(F.browY), fl(F.browHW), p.bl, p.bt, 1);
  drawEye(ctx, fx(F.eyeA.z), fy(F.eyeA.y), rx, ry, p.eA * eyeMul, p.sm, -1);
  drawEye(ctx, fx(F.eyeB.z), fy(F.eyeB.y), rx, ry, p.eB * eyeMul, p.sm, 1);
  drawMouth(ctx, fx(F.mouth.z), fy(F.mouth.top), fl(F.mouthHW), p.mo, p.cu, p.mw, p.rd);
}

// ---------------------------------------------------------------- helpers
function canvasTexture(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeEnvironment(renderer) {
  const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16), pos = geo.attributes.position, cols = [];
  const lo = new THREE.Color('#d9c9ab'), hi = new THREE.Color('#fffaf2'), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) { c.lerpColors(lo, hi, (pos.getY(i) / 10 + 1) / 2); cols.push(c.r, c.g, c.b); }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const disposables = [geo];
  const bgMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }); disposables.push(bgMat);
  es.add(new THREE.Mesh(geo, bgMat));
  const panel = (w, h, p, k) => {
    const g = new THREE.PlaneGeometry(w, h), m = new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k * 0.96), side: THREE.DoubleSide });
    disposables.push(g, m);
    const mesh = new THREE.Mesh(g, m); mesh.position.set(p[0], p[1], p[2]); mesh.lookAt(0, 0, 0); es.add(mesh);
  };
  panel(7, 4, [2, 6, 6], 2.6); panel(4, 7, [-7, 1, 3], 1.3); panel(6, 3, [0, 4, -7], 1.8); panel(8, 2, [0, -6, 4], 0.6);
  const rt = pm.fromScene(es, 0.04);
  pm.dispose(); disposables.forEach((d) => d.dispose());
  return rt;
}

// smooth normals for models that ship without them (merges UV seams)
function smoothNormals(geo) {
  const pos = geo.attributes.position, n = pos.count, map = new Map(), key = new Int32Array(n), acc = [];
  for (let i = 0; i < n; i++) {
    const k = Math.round(pos.getX(i) * 1e4) + ',' + Math.round(pos.getY(i) * 1e4) + ',' + Math.round(pos.getZ(i) * 1e4);
    let id = map.get(k); if (id === undefined) { id = acc.length / 3; map.set(k, id); acc.push(0, 0, 0); }
    key[i] = id;
  }
  const idx = geo.index, tri = idx ? idx.count / 3 : n / 3, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let f = 0; f < tri; f++) {
    const i0 = idx ? idx.getX(f * 3) : f * 3, i1 = idx ? idx.getX(f * 3 + 1) : f * 3 + 1, i2 = idx ? idx.getX(f * 3 + 2) : f * 3 + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    c.sub(b); a.sub(b); c.cross(a);
    for (const v of [i0, i1, i2]) { const o = key[v] * 3; acc[o] += c.x; acc[o + 1] += c.y; acc[o + 2] += c.z; }
  }
  const out = new Float32Array(n * 3);
  for (let j = 0; j < n; j++) {
    const o = key[j] * 3, L = Math.hypot(acc[o], acc[o + 1], acc[o + 2]) || 1;
    out[j * 3] = acc[o] / L; out[j * 3 + 1] = acc[o + 1] / L; out[j * 3 + 2] = acc[o + 2] / L;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(out, 3));
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const backOut = (t) => { const c1 = 1.9; t -= 1; return t * t * ((c1 + 1) * t + c1) + 1; };

// ---------------------------------------------------------------- main
/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} o
 * @param {string} o.model           seated model (.glb)
 * @param {string} [o.sleepModel]    lying-down model (.glb); without it 'lie' falls back to 'sit'
 * @param {'sleep'|'awake'|'happy'} [o.mood='awake']
 * @param {'sit'|'lie'} [o.sleepPose='sit']
 * @param {boolean} [o.reducedMotion]  default: the OS "reduce motion" setting
 * @param {boolean} [o.lookAtPointer=true]
 * @param {boolean} [o.dragToRotate=true]
 * @param {boolean} [o.tapToJump=true]
 * @param {string|null} [o.background=null]  null = transparent
 * @param {number} [o.maxPixelRatio=2]
 * @param {(api) => void} [o.onReady]
 * @param {(err) => void} [o.onError]
 * @param {(state: {mood, pose, busy}) => void} [o.onChange]
 */
export function createNarang(canvas, o = {}) {
  const opts = Object.assign({
    mood: 'awake', sleepPose: 'sit', lookAtPointer: true, dragToRotate: true, tapToJump: true,
    background: null, maxPixelRatio: 2,
    reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  }, o);
  const host = canvas.parentElement || canvas;
  const transparent = opts.background == null;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: transparent, premultipliedAlpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxPixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;           // keeps the mascot's yellow saturated
  if (transparent) renderer.setClearColor(0x000000, 0); else renderer.setClearColor(new THREE.Color(opts.background), 1);
  const aniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  const envRT = makeEnvironment(renderer);
  scene.environment = envRT.texture;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
  // key light from the upper left like the illustration, soft fill from the right, little flat ambient
  // Values fitted against the illustration's face / hood colours (see compare.html).
  // Note: in three r16x+ the scene environment is scaled by scene.environmentIntensity, not material.envMapIntensity.
  scene.environmentIntensity = 0.9;
  const hemi = new THREE.HemisphereLight(0xffffff, 0xcdbfa8, 0.1); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.05); key.position.set(-2, 6.5, 3.5); scene.add(key);   // higher: forehead light, chin a little darker, as in the art
  const fill = new THREE.DirectionalLight(0xffffff, 0.2); fill.position.set(4, 0.5, 3); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xfff6e0, 0.7); rim.position.set(1.5, 3, -5); scene.add(rim);   // soft-vinyl edge light (tuned below)

  const root = new THREE.Group(); scene.add(root);       // yaw (drag / view)
  const look = new THREE.Group(); root.add(look);        // small turn toward the pointer
  const pose = new THREE.Group(); look.add(pose); pose.position.y = -1.5;   // seated model, pivot at the feet
  const slp = new THREE.Group(); look.add(slp); slp.position.y = -1.5; slp.visible = false;  // lying model

  // owned resources, freed in dispose()
  const owned = [];
  const own = (x) => { owned.push(x); return x; };

  // ground shadow
  const shTex = own(canvasTexture(256, (x, s) => {
    const gr = x.createRadialGradient(s / 2, s / 2, 6, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(90,64,20,0.34)'); gr.addColorStop(1, 'rgba(90,64,20,0)');
    x.fillStyle = gr; x.fillRect(0, 0, s, s);
  }));
  const shadow = new THREE.Mesh(own(new THREE.PlaneGeometry(2.6, 2.0)), own(new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false })));
  shadow.rotation.x = -PI / 2; shadow.position.y = -1.52; root.add(shadow);

  // face canvas
  const faceCanvas = document.createElement('canvas'); faceCanvas.width = faceCanvas.height = FACE.px;
  const faceCtx = faceCanvas.getContext('2d');
  const faceTex = own(new THREE.CanvasTexture(faceCanvas)); faceTex.colorSpace = THREE.SRGBColorSpace; faceTex.anisotropy = aniso;

  // sprites
  const glowTex = own(canvasTexture(128, (x, s) => {
    const gr = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(225,255,140,1)'); gr.addColorStop(0.35, 'rgba(182,242,58,0.55)'); gr.addColorStop(1, 'rgba(182,242,58,0)');
    x.fillStyle = gr; x.fillRect(0, 0, s, s);
  }));
  const glowSprite = (scale) => {
    const s = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })));
    s.scale.setScalar(scale); return s;
  };
  const zTex = own(canvasTexture(128, (x, s) => {
    x.font = '800 96px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 14; x.strokeStyle = '#FFFFFF'; x.strokeText('Z', s / 2, s / 2 + 6);
    x.fillStyle = '#8A6A1F'; x.fillText('Z', s / 2, s / 2 + 6);
  }));
  const zs = [0, 1, 2].map(() => { const s = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: zTex, transparent: true, depthWrite: false, opacity: 0 }))); root.add(s); return s; });
  const starTex = own(canvasTexture(64, (x, s) => {
    x.translate(s / 2, s / 2); x.fillStyle = '#fff'; x.beginPath();
    for (let i = 0; i < 8; i++) { const r = i % 2 ? 6 : 30, a = i * PI / 4; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    x.closePath(); x.fill();
  }));
  // sparkles fade by vertex alpha (safe on a transparent canvas)
  const NS = 70, sPos = new Float32Array(NS * 3), sCol = new Float32Array(NS * 4), sVel = [], sHue = [], sLife = new Float32Array(NS);
  for (let i = 0; i < NS; i++) { sVel.push(new THREE.Vector3()); sHue.push(null); }
  const sGeo = own(new THREE.BufferGeometry());
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  sGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 4));
  const sparks = new THREE.Points(sGeo, own(new THREE.PointsMaterial({ size: 0.16, map: starTex, vertexColors: true, transparent: true, depthWrite: false })));
  sparks.frustumCulled = false; root.add(sparks);
  const sparkHue = [new THREE.Color('#FFD84A'), new THREE.Color('#B6F23A'), new THREE.Color('#FFFFFF')];
  function burst(n) {
    if (opts.reducedMotion) return;
    let made = 0;
    for (let i = 0; i < NS && made < n; i++) {
      if (sLife[i] > 0) continue;
      const a = Math.random() * 2 * PI;
      sPos[i * 3] = Math.cos(a) * 0.9; sPos[i * 3 + 1] = 0.3 + Math.random() * 0.8; sPos[i * 3 + 2] = Math.sin(a) * 0.9;
      sVel[i].set(Math.cos(a) * (1.2 + Math.random()), 1.2 + Math.random() * 1.6, Math.sin(a) * (1.2 + Math.random()));
      sLife[i] = 0.9 + Math.random() * 0.5; sHue[i] = sparkHue[(Math.random() * 3) | 0];
      made++;
    }
  }

  // ---------------------------------------------------------------- input
  let yaw = 0, tYaw = 0, pitch = 0.1, tPitch = 0.1, dist = 6.5, tDist = 6.5, auto = false, zoomed = !!opts.cameraDistance, camY = opts.cameraTargetY || 0;
  if (opts.cameraDistance) { dist = tDist = opts.cameraDistance; }
  let lookX = 0, lookY = 0, tLookX = 0, tLookY = 0, lastPointer = 0;
  const pts = new Map(); let pinch = 0, drag = false, px = 0, py = 0, downAt = 0, moved = 0;
  const VIEWS = { front: 0, left: -PI / 2, back: PI, right: PI / 2 };
  const aimAt = (clientX, clientY) => {
    if (!opts.lookAtPointer) return;
    const r = canvas.getBoundingClientRect();
    const nx = clamp(((clientX - r.left) / r.width) * 2 - 1, -1.5, 1.5);
    const ny = clamp(((clientY - r.top) / r.height) * 2 - 1, -1.5, 1.5);
    tLookX = nx * 0.38; tLookY = ny * 0.16; lastPointer = performance.now();
  };
  const onWinMove = (e) => { if (e.pointerType === 'mouse') aimAt(e.clientX, e.clientY); };
  const onDown = (e) => {
    aimAt(e.clientX, e.clientY);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); drag = false; return; }
    drag = true; px = e.clientX; py = e.clientY; downAt = performance.now(); moved = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
  };
  const onMove = (e) => {
    if (pts.has(e.pointerId)) pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) { tDist = clamp(tDist * pinch / d, 3.8, 16); zoomed = true; }
      pinch = d; moved = 99; return;
    }
    if (!drag || !opts.dragToRotate) return;
    const dx = e.clientX - px, dy = e.clientY - py; moved += Math.abs(dx) + Math.abs(dy);
    if (moved > 6) { auto = false; tYaw += dx * 0.01; tPitch = clamp(tPitch + dy * 0.006, -0.4, 0.75); }
    px = e.clientX; py = e.clientY;
  };
  const onUp = (e) => {
    const wasTap = drag && moved <= 6 && performance.now() - downAt < 350 && pts.size === 1;
    pts.delete(e.pointerId); pinch = 0; drag = false;
    if (wasTap && opts.tapToJump) api.jump();
  };
  const onWheel = (e) => { if (!opts.dragToRotate) return; e.preventDefault(); tDist = clamp(tDist + e.deltaY * 0.004, 3.8, 16); zoomed = true; };
  window.addEventListener('pointermove', onWinMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  function placeCamera() {
    camera.position.set(0, camY + dist * Math.sin(pitch), dist * Math.cos(pitch));
    camera.lookAt(0, camY, 0);
  }

  function resize() {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    if (!zoomed) { tDist = Math.max(6.5, 5.9 / camera.aspect); dist = tDist; }   // fill the box, leave headroom for the jump
  }
  const ro = new ResizeObserver(resize); ro.observe(host); resize(); placeCamera();

  // pause when off screen / tab hidden
  let onScreen = true;
  const io = new IntersectionObserver((ents) => { onScreen = ents.some((e) => e.isIntersecting); kick(); }, { threshold: 0 });
  io.observe(canvas);
  const onVis = () => kick();
  document.addEventListener('visibilitychange', onVis);

  // ---------------------------------------------------------------- character state
  const cur = Object.assign({}, EXPRESSIONS.smile); let tgt = EXPRESSIONS.smile, exprName = 'smile';
  let blink = 1, nextBlink = performance.now() + 2500, blinkT = -1;
  let mode = 'awake', sleepKind = 'sit', moodName = 'awake', seq = null;
  let tiltX = 0, tiltZ = 0, glow = 1, zzzOn = false, faceSig = '', wave = 0, waveT = -1;
  let glowEar = null, glowHeart = null, ready = false, sleeperReady = false, dead = false;
  const faceUniforms = { faceMap: { value: faceTex }, uRaw: { value: new THREE.Matrix4() }, uRawInv: { value: new THREE.Matrix4() }, uWave: { value: 0 }, uWaveT: { value: 0 } };

  const emit = () => opts.onChange && opts.onChange({ mood: moodName, pose: mode === 'sleep' ? sleepKind : 'awake', busy: !!seq });
  const setExpr = (name) => { if (EXPRESSIONS[name] && exprName !== name) { tgt = EXPRESSIONS[name]; exprName = name; } };

  let raf = 0, last = performance.now();
  function kick() { if (!raf && !dead && onScreen && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  function frame(now) {
    raf = 0;
    if (dead || !onScreen || document.hidden) return;
    step(now);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  // advance all animation state by one frame (also used by snapshot() while the loop is paused)
  function step(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = now / 1000, rm = opts.reducedMotion;

    if (auto && !rm) tYaw += dt * 0.6;
    if (now - lastPointer > 2500) { tLookX = 0; tLookY = 0; }
    const k = rm ? 1 : Math.min(1, dt * 6), lk = rm ? 1 : Math.min(1, dt * 3);
    yaw += (tYaw - yaw) * k; pitch += (tPitch - pitch) * k; dist += (tDist - dist) * k;
    lookX += (tLookX - lookX) * lk; lookY += (tLookY - lookY) * lk;
    root.rotation.y = yaw;
    const sleepingNow = mode === 'sleep';
    look.rotation.set(sleepingNow || rm ? 0 : lookY, sleepingNow || rm ? 0 : lookX, 0);
    placeCamera();

    // body
    const sleeping = mode === 'sleep', lying = sleeping && sleepKind === 'lie' && sleeperReady;
    const breathe = rm ? 0 : Math.sin(t * (sleeping ? 1.6 : 2.4));
    let hopY = 0, sq = 0, shake = 0, tx = sleeping ? 0.2 : 0, tz = sleeping ? -0.1 : 0, glowT = sleeping ? 0.12 : 1;
    let flutter = 1, seatS = 1, slpS = 1, slpShake = 0, showSeat = !lying, showSlp = lying;
    if (seq) {
      let s = (now - seq.t0) / 1000;
      if (rm) s = 99;   // reduced motion: jump straight to each sequence's end state
      if (seq.type === 'hop') {
        const hp = clamp(s / 0.62, 0, 1);
        hopY = 0.55 * Math.sin(PI * hp); sq = hp < 1 ? 0.1 * Math.sin(PI * hp) : 0;
        if (s > 0.62 && s < 0.82) sq = -0.1 * Math.sin(PI * (s - 0.62) / 0.2);
        if (s > 1.3) { const back = seq.back; seq = null; setExpr(back); emit(); }
      } else if (seq.type === 'sleepIn') {
        const a0 = ease(s / 0.5); tx = 0.2 * a0; tz = -0.1 * a0; glowT = 0.12;
        if (s >= 0.5 && s < 0.78) { seatS = 1 - 0.42 * ease((s - 0.5) / 0.28); if (!seq.burst) { seq.burst = true; burst(16); } }
        else if (s >= 0.78) {
          showSeat = false; showSlp = true;
          slpS = 0.58 + 0.42 * backOut(clamp((s - 0.78) / 0.45, 0, 1));
          if (s > 1.25) { seq = null; mode = 'sleep'; zzzOn = true; emit(); }
        }
      } else if (seq.type === 'wake' && seq.slp && s < 0.9) {
        showSeat = false; showSlp = true; tx = 0.2; tz = -0.1; glowT = 0.12;
        if (s < 0.6) slpShake = Math.sin(s * 40) * 0.05 * (1 - s / 0.6);
        else { slpS = 1 - 0.42 * ease((s - 0.6) / 0.3); if (!seq.burst0) { seq.burst0 = true; burst(16); } }
      } else if (seq.type === 'wake') {
        showSeat = true; showSlp = false;
        if (seq.slp) { seatS = 0.58 + 0.42 * backOut(clamp((s - 0.9) / 0.4, 0, 1)); s -= 0.3; }
        if (s < 0.6) { shake = Math.sin(s * 45) * 0.035 * (1 - s / 0.6); tx = 0.2; tz = -0.1; glowT = 0.12; }
        else {
          const up = ease((s - 0.75) / 0.6);
          tx = 0.2 * (1 - up); tz = -0.1 * (1 - up);
          const end = seq.end || 'smile';
          if (s < 2.2) setExpr('surprise');
          else if (s < 3.3) setExpr('laugh');
          else { setExpr(end); mode = 'awake'; seq = null; emit(); }
          const f = s - 0.6;
          flutter = f < 0.18 ? 0.35 : f < 0.3 ? 0 : f < 0.48 ? 0.55 : f < 0.58 ? 0.05 : 1;
          glowT = s > 1.2 ? 1 : 0.12;
          if (s > 1.55 && s < 2.2) { const jp = (s - 1.55) / 0.65; hopY = 0.6 * Math.sin(PI * jp); sq = 0.1 * Math.sin(PI * jp); if (seq && !seq.burst) { seq.burst = true; burst(40); } }
          else if (s >= 2.2 && s < 2.4) sq = -0.1 * Math.sin(PI * (s - 2.2) / 0.2);
        }
      }
    }
    if (rm) { hopY = 0; sq = 0; shake = 0; flutter = 1; slpShake = 0; seatS = 1; slpS = 1; }
    const kk = rm ? 1 : Math.min(1, dt * 4);
    tiltX += (tx - tiltX) * kk; tiltZ += (tz - tiltZ) * kk; glow += (glowT - glow) * (rm ? 1 : Math.min(1, dt * 3));
    const bAmp = sleeping ? 0.022 : 0.012;
    pose.visible = showSeat; slp.visible = showSlp;
    const sxz = 1 + (1 - seatS) * 0.6;
    pose.position.y = -1.5 + hopY;
    pose.rotation.set(tiltX + shake * 0.3, 0, tiltZ + shake + (sleeping || rm ? 0 : Math.sin(t * 0.8) * 0.025));
    pose.scale.set((1 - sq * 0.5 - breathe * bAmp * 0.5) * sxz, (1 + sq + breathe * bAmp) * seatS, (1 - sq * 0.5 - breathe * bAmp * 0.5) * sxz);
    const lxz = slpS * (1 + (1 - slpS) * 0.5) * (1 - breathe * 0.012);
    slp.scale.set(lxz, slpS * (1 + breathe * 0.03), lxz); slp.rotation.z = slpShake;
    shadow.scale.set((showSlp ? 1.25 : 1) * (1 - hopY * 0.35), 1, 1 - hopY * 0.35);
    shadow.material.opacity = 1 - hopY * 0.8;

    // hand wave (vertex shader bends the hand on the viewer's left)
    if (waveT >= 0) {
      const ws = (now - waveT) / 1000;
      wave = ws < 0.3 ? ease(ws / 0.3) : ws < 1.9 ? 1 : 1 - ease((ws - 1.9) / 0.35);
      if (ws > 2.25) { waveT = -1; wave = 0; }
    }
    faceUniforms.uWave.value = rm ? 0 : wave; faceUniforms.uWaveT.value = t;

    // blink
    if (!sleeping && !seq && !rm && now > nextBlink && blinkT < 0) blinkT = now;
    if (blinkT >= 0) { const bp = (now - blinkT) / 160; blink = bp >= 1 ? 1 : 1 - Math.sin(PI * bp); if (bp >= 1) { blinkT = -1; nextBlink = now + 2200 + Math.random() * 3200; } } else blink = 1;

    // face
    const ek = rm ? 1 : Math.min(1, dt * 10);
    for (const kx in tgt) cur[kx] += (tgt[kx] - cur[kx]) * ek;
    const eyeMul = blink * flutter;
    const sig = [cur.eA, cur.eB, cur.sm, cur.sz, cur.mo, cur.cu, cur.mw, cur.rd, cur.bl, cur.bt, eyeMul].map((v) => Math.round(v * 200)).join(',');
    if (sig !== faceSig) { faceSig = sig; drawFace(faceCtx, cur, eyeMul); faceTex.needsUpdate = true; }

    if (glowEar) { const pulse = rm ? 1 : 0.85 + 0.15 * Math.sin(t * 3); glowEar.material.opacity = 0.55 * glow * pulse; glowHeart.material.opacity = 0.6 * glow * pulse; }

    const zBase = slp.visible ? 0.15 : 0.55;
    zs.forEach((z, i) => {
      const ph = rm ? 0.5 + i * 0.15 : ((t * 0.45) + i / 3) % 1;
      const target = (zzzOn && mode === 'sleep') ? (rm ? 0.8 : Math.sin(PI * ph)) : 0;
      z.material.opacity += (target - z.material.opacity) * (rm ? 1 : Math.min(1, dt * (target > 0 ? 5 : 12)));
      z.position.set(-0.95 - ph * 0.4, zBase + ph * 0.8, 0.35); z.scale.setScalar(0.2 + ph * 0.24);
    });

    for (let i = 0; i < NS; i++) {
      if (sLife[i] > 0) {
        sLife[i] -= dt; sVel[i].y -= dt * 2.4;
        sPos[i * 3] += sVel[i].x * dt; sPos[i * 3 + 1] += sVel[i].y * dt; sPos[i * 3 + 2] += sVel[i].z * dt;
        const c = sHue[i]; sCol[i * 4] = c.r; sCol[i * 4 + 1] = c.g; sCol[i * 4 + 2] = c.b; sCol[i * 4 + 3] = clamp(sLife[i] / 0.6, 0, 1);
      } else sCol[i * 4 + 3] = 0;
    }
    sGeo.attributes.position.needsUpdate = true; sGeo.attributes.color.needsUpdate = true;
  }
  kick();

  // ---------------------------------------------------------------- materials
  function patchSeated(mat, rawMatrix) {
    faceUniforms.uRaw.value.copy(rawMatrix); faceUniforms.uRawInv.value.copy(rawMatrix).invert();
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, faceUniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
varying vec3 vRaw;
varying vec3 vFaceN;
uniform mat4 uRaw; uniform mat4 uRawInv; uniform float uWave; uniform float uWaveT;`)
        .replace('#include <begin_vertex>', `vec3 transformed = vec3( position );
{
  vec3 p = (uRaw * vec4(position, 1.0)).xyz;   // undo mesh quantization -> model space
  vRaw = p;
  {
    // normal of a smooth cubic surface fitted to the face skin (x = f(y, z)); used where eyes / mouth were filled,
    // so that area shades round and clean instead of flat
    float y = p.y, z = p.z;
    float dxdy = -0.09546 + 2.0 * -0.02022 * y + -0.13298 * z + 3.0 * 3.072 * y * y + 2.0 * -0.3765 * y * z + 1.17503 * z * z;
    float dxdz = 0.0784 + 2.0 * -1.09165 * z + -0.13298 * y + 3.0 * -0.07482 * z * z + -0.3765 * y * y + 2.0 * 1.17503 * y * z;
    vFaceN = normalize(normalMatrix * normalize(vec3(1.0, -dxdy, -dxdz)));
  }
  if (uWave > 0.001) {
    vec3 c = vec3(${HAND.x.toFixed(3)}, ${HAND.y.toFixed(3)}, ${HAND.z.toFixed(3)});
    float w = (1.0 - smoothstep(0.045, ${HAND.r.toFixed(3)}, distance(p, c))) * smoothstep(0.1, 0.15, p.z);
    vec3 pivot = c + vec3(-0.06, 0.02, -0.03);
    float a = uWave * (0.35 + 0.55 * sin(uWaveT * 10.0));
    vec3 q = p - pivot;
    float ca = cos(a * w), sa = sin(a * w);
    q = vec3(q.x, q.y * ca - q.z * sa, q.y * sa + q.z * ca);
    p = mix(p, pivot + q + vec3(0.02, 0.09, 0.04) * uWave, w);
    transformed = (uRawInv * vec4(p, 1.0)).xyz;
  }
}`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vRaw;
varying vec3 vFaceN;
uniform sampler2D faceMap;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
float faceGloss = 0.0;
float coatMask = 0.0;
{
  vec2 fuv = vec2(0.5 - (vRaw.z - ${FACE.zc.toFixed(3)}) / ${FACE.size.toFixed(3)}, (vRaw.y - (${FACE.yc.toFixed(3)})) / ${FACE.size.toFixed(3)} + 0.5);
  if (vRaw.x > 0.17 && fuv.x > 0.0 && fuv.x < 1.0 && fuv.y > 0.0 && fuv.y < 1.0) {
    vec4 f = texture2D(faceMap, fuv);
    diffuseColor.rgb = mix(diffuseColor.rgb, f.rgb, f.a);
    float fl = dot(f.rgb, vec3(0.3, 0.59, 0.11));
    faceGloss = f.a * (1.0 - smoothstep(0.05, 0.35, fl)) * (1.0 - smoothstep(0.12, 0.22, f.r - f.g));   // glossy eyes only, not the mouth
  }
  // colour grade (after the face so drawn skin and model skin match): skin a touch less yellow, mascot yellow deeper
  {
    vec3 dc = diffuseColor.rgb;
    float sat = max(max(dc.r, dc.g), dc.b) - min(min(dc.r, dc.g), dc.b);
    float skin = 1.0 - smoothstep(0.25, 0.4, sat);
    float yel = smoothstep(0.4, 0.7, sat) * smoothstep(0.35, 0.55, dc.g) * step(dc.b, dc.g);   // yellow only, not the pink cheeks
    diffuseColor.b *= 1.0 + 0.12 * skin - 0.6 * yel;
    diffuseColor.g *= 1.0 - 0.015 * skin;
  }
  // clear coat only on the headset, the horn logo and the tablet: neutral (low-saturation) colours in those areas
  vec3 dc = diffuseColor.rgb;
  float sat = max(max(dc.r, dc.g), dc.b) - min(min(dc.r, dc.g), dc.b);
  float neutral = 1.0 - smoothstep(0.05, 0.12, sat);
  float area = max(max(step(vRaw.z, -0.34), step(0.3, vRaw.y)), step(vRaw.y, -0.25) * step(0.25, vRaw.x) * step(abs(vRaw.z - 0.03), 0.13));
  coatMask = neutral * area;
}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.15, faceGloss);
roughnessFactor = mix(roughnessFactor, 0.35, coatMask);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // the filled mouth cavity has folded triangles facing different ways; shade it as one smooth face surface
  float mw = (1.0 - smoothstep(0.06, 0.1, abs(vRaw.z - 0.03))) * (1.0 - smoothstep(0.05, 0.085, abs(vRaw.y + 0.15)));
  // same for the two eye areas (and the strip between them), which were filled too
  // the whole filled centre of the face (eyes, bridge, mouth); edges keep the model's own curvature
  float fc = 1.0 - smoothstep(0.65, 1.0, length(vec2((vRaw.z - 0.035) / 0.25, (vRaw.y + 0.08) / 0.16)));
  mw = max(mw, fc * 0.9) * step(0.18, vRaw.x);
  normal = normalize(mix(normal, normalize(vFaceN), mw));
}`)
        .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat *= coatMask;
#endif`);
    };
    mat.customProgramCacheKey = () => 'narang-seated';
  }

  // ---------------------------------------------------------------- loading
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const loaded = [];   // gltf scenes to dispose

  function physical(src, extra) {
    return own(new THREE.MeshPhysicalMaterial(Object.assign({
      map: src.map || null, normalMap: src.normalMap || null, roughnessMap: src.roughnessMap || null,
      vertexColors: !!src.vertexColors,   // baked ambient occlusion (COLOR_0) when the model has it
      normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.55, metalness: 0, envMapIntensity: 0.3,   // soft-vinyl, not clay
      sheen: 0.4, sheenRoughness: 0.45, sheenColor: new THREE.Color('#fff3e6')
    }, extra)));
  }

  loader.loadAsync(opts.model).then((gltf) => {
    if (dead) { disposeTree(gltf.scene); return; }
    loaded.push(gltf.scene);
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    model.traverse((m) => {
      if (!m.isMesh) return;
      const old = m.material;
      const mat = physical(old, { clearcoat: 1, clearcoatRoughness: 0.12 });
      old.dispose();
      m.material = mat;
      // model-space matrix of this mesh (includes KHR_mesh_quantization dequantisation)
      patchSeated(mat, m.matrixWorld);
    });
    glowEar = glowSprite(0.2); glowEar.position.set(0.064, -0.077, -0.5); model.add(glowEar);
    glowHeart = glowSprite(0.12); glowHeart.position.set(0.36, -0.333, 0.032); model.add(glowHeart);
    const turn = new THREE.Group(); turn.rotation.y = -PI / 2; turn.add(model);   // model faces +X; face the camera
    const holder = new THREE.Group(); holder.add(turn); holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const s = 3.0 / Math.max(size.x, size.y, size.z);
    holder.scale.setScalar(s); holder.position.set(-center.x * s, -box.min.y * s, -center.z * s);
    pose.add(holder);
    ready = true;
    applyMood(opts.mood, true);
    if (opts.onReady) opts.onReady(api);
    kick();
    if (opts.sleepModel) return loader.loadAsync(opts.sleepModel).then((g2) => {
      if (dead) { disposeTree(g2.scene); return; }
      loaded.push(g2.scene);
      g2.scene.traverse((m) => {
        if (!m.isMesh) return;
        if (!m.geometry.attributes.normal) smoothNormals(m.geometry);
        const old = m.material; m.material = physical(old); old.dispose();
      });
      const h = new THREE.Group(); h.add(g2.scene); h.updateMatrixWorld(true);
      const b2 = new THREE.Box3().setFromObject(h), sz = b2.getSize(new THREE.Vector3()), c2 = b2.getCenter(new THREE.Vector3());
      const k2 = 2.35 / sz.y;
      h.scale.setScalar(k2); h.position.set(-c2.x * k2, -b2.min.y * k2, -c2.z * k2);
      slp.add(h); sleeperReady = true;
      if (mode === 'sleep' && opts.sleepPose === 'lie' && sleepKind === 'sit' && !seq) { sleepKind = 'lie'; emit(); }
      kick();
    });
  }).catch((err) => { if (opts.onError) opts.onError(err); else console.error('narang', err); });

  function disposeTree(obj) {
    obj.traverse((m) => {
      if (m.geometry) m.geometry.dispose();
      const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
      mats.forEach((mt) => { for (const kx in mt) { const v = mt[kx]; if (v && v.isTexture) v.dispose(); } mt.dispose(); });
    });
  }

  // ---------------------------------------------------------------- mood control
  function sleep(kind, instant) {
    if (!ready) { opts.mood = 'sleep'; if (kind) opts.sleepPose = kind; return; }
    if (mode === 'sleep' || (seq && (seq.type === 'wake' || seq.type === 'sleepIn'))) return;
    setExpr('sleep'); moodName = 'sleep';
    sleepKind = (kind || opts.sleepPose) === 'lie' && sleeperReady ? 'lie' : 'sit';
    if (instant || opts.reducedMotion || sleepKind === 'sit') {
      seq = null; mode = 'sleep'; zzzOn = true; if (instant) { cur.eA = 0; cur.eB = 0; tiltX = 0.2; tiltZ = -0.1; glow = 0.12; }
    } else seq = { type: 'sleepIn', t0: performance.now() };
    emit(); kick();
  }
  function wake(end) {
    if (!ready) { opts.mood = end === 'laugh' ? 'happy' : 'awake'; return; }
    if (mode !== 'sleep' || (seq && seq.type === 'wake')) return;
    zzzOn = false; moodName = end === 'laugh' ? 'happy' : 'awake';
    seq = { type: 'wake', t0: performance.now(), slp: sleepKind === 'lie' && sleeperReady, end: end || 'smile' };
    emit(); kick();
  }
  function applyMood(m, instant) {
    if (m === 'sleep') return sleep(opts.sleepPose, instant);
    const expr = m === 'happy' ? 'laugh' : 'smile';
    if (mode === 'sleep') return wake(expr);
    if (seq && seq.type !== 'hop') return;
    moodName = m === 'happy' ? 'happy' : 'awake';
    if (seq && seq.type === 'hop') seq.back = expr; else setExpr(expr);
    emit(); kick();
  }

  const api = {
    /** 'sleep' | 'awake' | 'happy' */
    setMood: (m) => applyMood(m, false),
    get mood() { return moodName; },
    get pose() { return mode === 'sleep' ? sleepKind : 'awake'; },
    sleep: (kind) => sleep(kind, false),
    wake: () => wake('smile'),
    /** laugh + hop + sparkles, then return to the current expression */
    jump() {
      if (!ready || mode === 'sleep' || (seq && seq.type !== 'hop')) return;
      const back = seq && seq.type === 'hop' ? seq.back : exprName;
      seq = { type: 'hop', t0: performance.now(), back }; setExpr('laugh'); burst(14); emit(); kick();
    },
    /** wiggle the hand on the viewer's left for ~2 s. Experimental: no skeleton, the hand is bent in the vertex shader, so a big lift stretches it. */
    wave() { if (!ready || mode === 'sleep') return; waveT = performance.now(); kick(); },
    /** smile | laugh | wink | surprise | sad | sleep */
    setExpression(name) {
      if (!EXPRESSIONS[name] || (seq && seq.type !== 'hop')) return;
      if (name === 'sleep') return sleep('sit');
      if (mode === 'sleep') return wake(name);
      if (seq) seq.back = name; else setExpr(name);
      kick();
    },
    setView(id) { const tv = VIEWS[id] || 0; tYaw = tv + 2 * PI * Math.round((tYaw - tv) / (2 * PI)); tPitch = 0.1; auto = false; kick(); },
    setAutoRotate(on) { auto = !!on; kick(); },
    setReducedMotion(on) { opts.reducedMotion = !!on; kick(); },
    /** move the camera: distance from the model and the height it looks at */
    frameView(distance, targetY = 0) { if (distance) { tDist = dist = distance; zoomed = true; } camY = targetY; kick(); },
    /** render now and return a PNG data URL (e.g. to make a poster image) */
    snapshot(type = 'image/png') { const now = performance.now(); last = now - 16; step(now); renderer.render(scene, camera); return canvas.toDataURL(type); },
    /** for tuning only: three objects behind the character */
    get debug() { return { THREE, renderer, scene, camera, hemi, key, fill, rim, env: envRT }; },
    /** redraw the face after changing FACE_LAYOUT (tuning only) */
    redrawFace() { faceSig = ''; kick(); },
    /**
     * Free everything. The same canvas can be passed to createNarang() again afterwards
     * (React StrictMode mounts twice). Pass { releaseContext: true } only when the canvas
     * itself is being thrown away, to give the WebGL context back to the browser at once.
     */
    dispose({ releaseContext = false } = {}) {
      if (dead) return;
      dead = true; cancelAnimationFrame(raf); raf = 0;
      ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onWinMove);
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      loaded.forEach(disposeTree);
      owned.forEach((x) => x.dispose && x.dispose());
      envRT.dispose();
      renderer.dispose();
      if (releaseContext) renderer.forceContextLoss();
    }
  };
  return api;
}
