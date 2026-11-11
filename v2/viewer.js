/* Narang 3D viewer v2 — three.js r149 UMD.
   Loads a .glb directly, paints a swappable face on top of the model, and runs idle / jump / sleep / wake motion. */
(function () {
  var T = window.THREE, PI = Math.PI;

  // ---------- GLB parsing ----------
  function parseGLB(ab) {
    var dv = new DataView(ab);
    if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('GLB 형식이 아닙니다');
    var jl = dv.getUint32(12, true);
    var json = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 20, jl)));
    var bo = 20 + jl, bl = dv.getUint32(bo, true);
    return { g: json, bin: new Uint8Array(ab, bo + 8, bl) };
  }

  function buildGeometry(g, bin, prim) {
    var geo = new T.BufferGeometry(), cache = {};
    function attr(i) {
      var a = g.accessors[i], bv = g.bufferViews[a.bufferView];
      var n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
      var base = bin.byteOffset + (bv.byteOffset || 0);
      if (bv.byteStride && bv.byteStride !== n * 4) {
        var ib = cache[a.bufferView];
        if (!ib) { ib = cache[a.bufferView] = new T.InterleavedBuffer(new Float32Array(bin.buffer, base, bv.byteLength / 4), bv.byteStride / 4); }
        return new T.InterleavedBufferAttribute(ib, n, (a.byteOffset || 0) / 4);
      }
      return new T.BufferAttribute(new Float32Array(bin.buffer, base + (a.byteOffset || 0), a.count * n), n);
    }
    geo.setAttribute('position', attr(prim.attributes.POSITION));
    if (prim.attributes.NORMAL !== undefined) geo.setAttribute('normal', attr(prim.attributes.NORMAL));
    if (prim.attributes.TEXCOORD_0 !== undefined) geo.setAttribute('uv', attr(prim.attributes.TEXCOORD_0));
    if (prim.indices !== undefined) {
      var ia = g.accessors[prim.indices], ibv = g.bufferViews[ia.bufferView];
      var C = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array }[ia.componentType];
      geo.setIndex(new T.BufferAttribute(new C(bin.buffer, bin.byteOffset + (ibv.byteOffset || 0) + (ia.byteOffset || 0), ia.count), 1));
    }
    if (prim.attributes.NORMAL === undefined) geo.computeVertexNormals();
    return geo;
  }

  // average normals across UV seams so a low-poly scan shades smoothly
  function smoothNormals(geo) {
    var pos = geo.attributes.position, n = pos.count, map = new Map(), key = new Int32Array(n), acc = [];
    for (var i = 0; i < n; i++) {
      var k = Math.round(pos.getX(i) * 1e4) + ',' + Math.round(pos.getY(i) * 1e4) + ',' + Math.round(pos.getZ(i) * 1e4);
      var id = map.get(k); if (id === undefined) { id = acc.length / 3; map.set(k, id); acc.push(0, 0, 0); }
      key[i] = id;
    }
    var idx = geo.index, tri = idx ? idx.count / 3 : n / 3, a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
    for (var f = 0; f < tri; f++) {
      var i0 = idx ? idx.getX(f * 3) : f * 3, i1 = idx ? idx.getX(f * 3 + 1) : f * 3 + 1, i2 = idx ? idx.getX(f * 3 + 2) : f * 3 + 2;
      a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
      c.sub(b); a.sub(b); c.cross(a);
      [i0, i1, i2].forEach(function (v) { var o = key[v] * 3; acc[o] += c.x; acc[o + 1] += c.y; acc[o + 2] += c.z; });
    }
    var out = new Float32Array(n * 3);
    for (var j = 0; j < n; j++) {
      var o = key[j] * 3, x = acc[o], y = acc[o + 1], z = acc[o + 2], L = Math.hypot(x, y, z) || 1;
      out[j * 3] = x / L; out[j * 3 + 1] = y / L; out[j * 3 + 2] = z / L;
    }
    geo.setAttribute('normal', new T.BufferAttribute(out, 3));
  }

  function loadTex(g, bin, ti, srgb, aniso) {
    var img = g.images[g.textures[ti].source], bv = g.bufferViews[img.bufferView];
    var bytes = new Uint8Array(bin.buffer, bin.byteOffset + (bv.byteOffset || 0), bv.byteLength);
    return createImageBitmap(new Blob([bytes], { type: img.mimeType || 'image/png' }), { imageOrientation: 'none' }).then(function (bmp) {
      var t = new T.Texture(bmp);
      t.flipY = false; t.encoding = srgb ? T.sRGBEncoding : T.LinearEncoding; t.anisotropy = aniso; t.needsUpdate = true;
      return t;
    });
  }

  // ---------- soft studio environment for reflections ----------
  function makeEnv(renderer) {
    var pm = new T.PMREMGenerator(renderer), es = new T.Scene();
    var geo = new T.SphereGeometry(10, 32, 16), pos = geo.attributes.position, cols = [];
    var lo = new T.Color('#d9c9ab'), hi = new T.Color('#fffaf2'), c = new T.Color();
    for (var i = 0; i < pos.count; i++) { c.lerpColors(lo, hi, (pos.getY(i) / 10 + 1) / 2); cols.push(c.r, c.g, c.b); }
    geo.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    es.add(new T.Mesh(geo, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide })));
    function panel(w, h, p, k) {
      var m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(k, k, k * 0.96), side: T.DoubleSide }));
      m.position.set(p[0], p[1], p[2]); m.lookAt(0, 0, 0); es.add(m);
    }
    panel(7, 4, [2, 6, 6], 2.6);
    panel(4, 7, [-7, 1, 3], 1.3);
    panel(6, 3, [0, 4, -7], 1.8);
    panel(8, 2, [0, -6, 4], 0.6);
    var rt = pm.fromScene(es, 0.04); pm.dispose();
    return rt.texture;
  }

  // ---------- face drawing ----------
  // Feature positions measured on the model (object space; +x = front, +z = character's right).
  var FACE = { zc: 0.035, yc: -0.06, size: 0.56, px: 512 };
  var F = {
    eyeA: { z: 0.184, y: -0.059 }, // shows on the viewer's left
    eyeB: { z: -0.122, y: -0.054 }, // shows on the viewer's right
    eyeHW: 0.054, eyeHH: 0.073,
    mouth: { z: 0.028, top: -0.112 }, mouthHW: 0.07,
    browY: 0.088, browHW: 0.042
  };
  function cx(z) { return (0.5 - (z - FACE.zc) / FACE.size) * FACE.px; }
  function cy(y) { return (0.5 - (y - FACE.yc) / FACE.size) * FACE.px; }
  function cl(v) { return v / FACE.size * FACE.px; }

  var EXPR = {
    smile:    { eA: 1,    eB: 1,    sm: 1,  sz: 1,    mo: 0.72, cu: 1,    mw: 1,    rd: 0, bl: 0,    bt: 0 },
    laugh:    { eA: 0,    eB: 0,    sm: 1,  sz: 1,    mo: 1,    cu: 1,    mw: 1.12, rd: 0, bl: 0.35, bt: 0 },
    wink:     { eA: 1,    eB: 0,    sm: 1,  sz: 1,    mo: 0.5,  cu: 1,    mw: 0.95, rd: 0, bl: 0.15, bt: 0 },
    surprise: { eA: 1,    eB: 1,    sm: 1,  sz: 1.14, mo: 0.85, cu: 0,    mw: 0.55, rd: 1, bl: 0.9,  bt: 0 },
    sad:      { eA: 0.82, eB: 0.82, sm: 1,  sz: 1,    mo: 0,    cu: -0.9, mw: 0.62, rd: 0, bl: 0.1,  bt: 1 },
    sleep:    { eA: 0,    eB: 0,    sm: -1, sz: 1,    mo: 0,    cu: 0.55, mw: 0.42, rd: 0, bl: -0.25, bt: 0 }
  };

  function drawEye(ctx, x, y, rx, ry, open, smile) {
    if (open > 0.14) {
      var h = ry * Math.min(open, 1.0);
      ctx.save();
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 2 * PI); ctx.clip();
      ctx.beginPath(); ctx.rect(x - rx - 2, y - h, 2 * rx + 4, 2 * h); ctx.clip();
      ctx.fillStyle = '#22130A'; ctx.fillRect(x - rx - 2, y - ry - 2, 2 * rx + 4, 2 * ry + 4);
      var g = ctx.createRadialGradient(x, y + ry * 0.35, ry * 0.08, x, y + ry * 0.15, ry * 0.95);
      g.addColorStop(0, '#D08A44'); g.addColorStop(0.5, '#86491E'); g.addColorStop(1, '#2C170A');
      ctx.beginPath(); ctx.ellipse(x, y + ry * 0.05, rx * 0.84, ry * 0.86, 0, 0, 2 * PI); ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); ctx.ellipse(x, y + ry * 0.02, rx * 0.44, ry * 0.46, 0, 0, 2 * PI); ctx.fillStyle = '#170B04'; ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath(); ctx.ellipse(x + rx * 0.26, y - ry * 0.36, rx * 0.3, ry * 0.25, -0.3, 0, 2 * PI); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x - rx * 0.3, y + ry * 0.42, rx * 0.12, ry * 0.1, 0, 0, 2 * PI); ctx.fill();
      ctx.restore();
      if (open < 0.97) { // eyelid edge while half-closed
        ctx.strokeStyle = '#3A2010'; ctx.lineWidth = rx * 0.16; ctx.lineCap = 'round';
        var ly = y - h;
        ctx.beginPath(); ctx.moveTo(x - rx * 0.92, ly + ry * 0.05); ctx.quadraticCurveTo(x, ly - ry * 0.08, x + rx * 0.92, ly + ry * 0.05); ctx.stroke();
      }
    } else {
      ctx.strokeStyle = '#3A2010'; ctx.lineWidth = rx * 0.24; ctx.lineCap = 'round';
      var up = smile >= 0; // ^ for happy, ‿ for sleepy
      var ends = up ? y + ry * 0.18 : y - ry * 0.02, ctrl = up ? y - ry * 0.55 : y + ry * 0.5;
      ctx.beginPath(); ctx.moveTo(x - rx * 0.95, ends); ctx.quadraticCurveTo(x, ctrl, x + rx * 0.95, ends); ctx.stroke();
    }
  }

  function drawBrow(ctx, x, y, hw, lift, tilt, side) {
    ctx.save();
    ctx.translate(x, y - lift * hw * 0.55);
    ctx.rotate(side * tilt * 0.38);
    ctx.strokeStyle = '#6E3B1C'; ctx.lineWidth = hw * 0.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-hw, hw * 0.16); ctx.quadraticCurveTo(0, -hw * 0.34, hw, hw * 0.16); ctx.stroke();
    ctx.restore();
  }

  function drawMouth(ctx, x, top, hw, open, curve, wid, round) {
    var w = hw * wid;
    if (open > 0.06) {
      var depth = hw * 1.0 * open, corner = top - curve * hw * 0.18;
      ctx.save();
      ctx.beginPath();
      if (round > 0.5) {
        ctx.ellipse(x, top + depth * 0.55, w * 0.62, depth * 0.62, 0, 0, 2 * PI);
      } else {
        ctx.moveTo(x - w, corner);
        ctx.quadraticCurveTo(x, top + hw * 0.12, x + w, corner);
        ctx.bezierCurveTo(x + w * 0.95, top + depth * 1.3, x - w * 0.95, top + depth * 1.3, x - w, corner);
      }
      ctx.closePath();
      var mg = ctx.createLinearGradient(0, top, 0, top + depth * 1.1);
      mg.addColorStop(0, '#6E1012'); mg.addColorStop(1, '#A8222A');
      ctx.fillStyle = mg; ctx.fill();
      ctx.clip();
      // big soft tongue filling the lower half, like the original art
      var tg = ctx.createRadialGradient(x, top + depth * 1.05, depth * 0.1, x, top + depth * 1.0, w * 0.75);
      tg.addColorStop(0, '#F59AA0'); tg.addColorStop(1, '#E2646D');
      ctx.fillStyle = tg;
      ctx.beginPath(); ctx.ellipse(x, top + depth * (round > 0.5 ? 1.0 : 0.98), w * 0.68, depth * 0.52, 0, 0, 2 * PI); ctx.fill();
      ctx.restore();
    } else {
      ctx.strokeStyle = '#B0303A'; ctx.lineWidth = hw * 0.13; ctx.lineCap = 'round';
      var ey = top + hw * 0.18 - curve * hw * 0.1;
      ctx.beginPath(); ctx.moveTo(x - w * 0.75, ey); ctx.quadraticCurveTo(x, ey + curve * hw * 0.55, x + w * 0.75, ey); ctx.stroke();
    }
  }

  function drawFace(ctx, p, blink) {
    ctx.clearRect(0, 0, FACE.px, FACE.px);
    var rx = cl(F.eyeHW) * p.sz, ry = cl(F.eyeHH) * p.sz;
    drawBrow(ctx, cx(F.eyeA.z), cy(F.browY), cl(F.browHW), p.bl, p.bt, -1);
    drawBrow(ctx, cx(F.eyeB.z), cy(F.browY), cl(F.browHW), p.bl, p.bt, 1);
    drawEye(ctx, cx(F.eyeA.z), cy(F.eyeA.y), rx, ry, p.eA * blink, p.sm);
    drawEye(ctx, cx(F.eyeB.z), cy(F.eyeB.y), rx, ry, p.eB * blink, p.sm);
    drawMouth(ctx, cx(F.mouth.z), cy(F.mouth.top), cl(F.mouthHW), p.mo, p.cu, p.mw, p.rd);
  }

  // ---------- small canvas sprites ----------
  function spriteTex(size, draw) {
    var c = document.createElement('canvas'); c.width = c.height = size;
    draw(c.getContext('2d'), size);
    var t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t;
  }

  function create(host, url, opts) {
    opts = opts || {};
    var status = opts.onStatus || function () {};
    if (T.ColorManagement) T.ColorManagement.legacyMode = false;
    var canvas = host.querySelector('canvas');
    var renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setClearColor(new T.Color(opts.background || '#FFF6DD'), 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.NoToneMapping;
    var aniso = renderer.capabilities.getMaxAnisotropy();

    var scene = new T.Scene();
    scene.environment = makeEnv(renderer);
    var camera = new T.PerspectiveCamera(30, 1, 0.05, 100);
    scene.add(new T.HemisphereLight(0xffffff, 0xd8cbb0, 0.25));
    var key = new T.DirectionalLight(0xfff6e8, 0.75); key.position.set(2, 4, 5); scene.add(key);

    var root = new T.Group(); scene.add(root);        // yaw
    var pose = new T.Group(); root.add(pose);         // pivot at the feet: tilt, hop, squash
    pose.position.y = -1.5;
    var slp = new T.Group(); root.add(slp); slp.position.y = -1.5; slp.visible = false; // lying-down model
    var sleeperReady = false;

    // ground shadow
    var shTex = spriteTex(256, function (x, s) {
      var gr = x.createRadialGradient(s / 2, s / 2, 6, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(90,64,20,0.34)'); gr.addColorStop(1, 'rgba(90,64,20,0)');
      x.fillStyle = gr; x.fillRect(0, 0, s, s);
    });
    var shadow = new T.Mesh(new T.PlaneGeometry(2.6, 2.0), new T.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false }));
    shadow.rotation.x = -PI / 2; shadow.position.y = -1.52; root.add(shadow);

    // face canvas
    var faceCanvas = document.createElement('canvas'); faceCanvas.width = faceCanvas.height = FACE.px;
    var faceCtx = faceCanvas.getContext('2d');
    var faceTex = new T.CanvasTexture(faceCanvas); faceTex.encoding = T.sRGBEncoding; faceTex.anisotropy = aniso;

    // glow, zzz and sparkle sprites
    var glowTex = spriteTex(128, function (x, s) {
      var gr = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(225,255,140,1)'); gr.addColorStop(0.35, 'rgba(182,242,58,0.55)'); gr.addColorStop(1, 'rgba(182,242,58,0)');
      x.fillStyle = gr; x.fillRect(0, 0, s, s);
    });
    function glowSprite(scale) {
      var s = new T.Sprite(new T.SpriteMaterial({ map: glowTex, blending: T.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
      s.scale.setScalar(scale); return s;
    }
    var zTex = spriteTex(128, function (x, s) {
      x.font = '800 96px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.lineWidth = 14; x.strokeStyle = '#FFFFFF'; x.strokeText('Z', s / 2, s / 2 + 6);
      x.fillStyle = '#8A6A1F'; x.fillText('Z', s / 2, s / 2 + 6);
    });
    var zs = [0, 1, 2].map(function () {
      var s = new T.Sprite(new T.SpriteMaterial({ map: zTex, transparent: true, depthWrite: false, opacity: 0 }));
      root.add(s); return s;
    });
    var starTex = spriteTex(64, function (x, s) {
      x.translate(s / 2, s / 2); x.fillStyle = '#fff';
      x.beginPath();
      for (var i = 0; i < 8; i++) { var r = i % 2 ? 6 : 30, a = i * PI / 4; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      x.closePath(); x.fill();
    });
    var NS = 70, sPos = new Float32Array(NS * 3), sCol = new Float32Array(NS * 3), sVel = [], sHue = [], sLife = new Float32Array(NS);
    for (var i = 0; i < NS; i++) { sVel.push(new T.Vector3()); sHue.push(null); }
    var sGeo = new T.BufferGeometry();
    sGeo.setAttribute('position', new T.BufferAttribute(sPos, 3));
    sGeo.setAttribute('color', new T.BufferAttribute(sCol, 3));
    var sparks = new T.Points(sGeo, new T.PointsMaterial({ size: 0.16, map: starTex, vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }));
    sparks.frustumCulled = false;
    root.add(sparks);
    var sparkHue = [new T.Color('#FFE36A'), new T.Color('#C8FF5C'), new T.Color('#FFFFFF')];
    function burst(n) {
      var made = 0;
      for (var i = 0; i < NS && made < n; i++) {
        if (sLife[i] > 0) continue;
        var a = Math.random() * 2 * PI;
        sPos[i * 3] = Math.cos(a) * 0.9; sPos[i * 3 + 1] = 0.3 + Math.random() * 0.8; sPos[i * 3 + 2] = Math.sin(a) * 0.9;
        sVel[i].set(Math.cos(a) * (1.2 + Math.random()), 1.2 + Math.random() * 1.6, Math.sin(a) * (1.2 + Math.random()));
        sLife[i] = 0.9 + Math.random() * 0.5; sHue[i] = sparkHue[(Math.random() * 3) | 0];
        made++;
      }
    }

    // ---------- camera control ----------
    var yaw = 0, tYaw = 0, pitch = 0.1, tPitch = 0.1, dist = 7.2, tDist = 7.2, auto = false, zoomed = false;
    var pts = {}, pinch = 0, drag = false, px = 0, py = 0, downAt = 0, moved = 0;
    var VIEWS = { front: 0, left: -PI / 2, back: PI, right: PI / 2 };
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function onDown(e) {
      pts[e.pointerId] = [e.clientX, e.clientY];
      var ids = Object.keys(pts);
      if (ids.length === 2) { var a = pts[ids[0]], b = pts[ids[1]]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); drag = false; return; }
      drag = true; px = e.clientX; py = e.clientY; downAt = performance.now(); moved = 0;
      try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
    }
    function onMove(e) {
      if (pts[e.pointerId]) pts[e.pointerId] = [e.clientX, e.clientY];
      var ids = Object.keys(pts);
      if (ids.length === 2) {
        var a = pts[ids[0]], b = pts[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) { tDist = clamp(tDist * pinch / d, 3.8, 16); zoomed = true; }
        pinch = d; moved = 99; return;
      }
      if (!drag) return;
      var dx = e.clientX - px, dy = e.clientY - py; moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 6) {
        if (auto) { auto = false; if (opts.onAuto) opts.onAuto(false); }
        if (opts.onUserMove) opts.onUserMove();
        tYaw += dx * 0.01; tPitch = clamp(tPitch + dy * 0.006, -0.4, 0.75);
      }
      px = e.clientX; py = e.clientY;
    }
    function onUp(e) {
      var wasTap = drag && moved <= 6 && performance.now() - downAt < 350 && Object.keys(pts).length === 1;
      delete pts[e.pointerId]; pinch = 0; drag = false;
      if (wasTap) api.hop();
    }
    function onWheel(e) { e.preventDefault(); tDist = clamp(tDist + e.deltaY * 0.004, 3.8, 16); zoomed = true; }
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    function resize() {
      var w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      if (!zoomed) { tDist = Math.max(7.4, 6.6 / camera.aspect); dist = tDist; }
    }
    var ro = new ResizeObserver(resize); ro.observe(host); resize();

    // ---------- character state ----------
    var cur = Object.assign({}, EXPR.smile), tgt = EXPR.smile, exprName = 'smile';
    var blink = 1, nextBlink = performance.now() + 2500, blinkT = -1;
    var mode = 'awake';            // awake | sleep
    var seq = null;                // {type, t0, back}
    var tiltX = 0, tiltZ = 0, glow = 1, zzzOn = false, faceSig = '';
    var glowEar = null, glowHeart = null, ready = false;

    function setExpr(name) { if (EXPR[name] && exprName !== name) { tgt = EXPR[name]; exprName = name; if (opts.onExpr) opts.onExpr(name); } }
    function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
    function backOut(t) { var c1 = 1.9; t = t - 1; return t * t * ((c1 + 1) * t + c1) + 1; }

    var raf = 0, last = performance.now(), dead = false;
    function frame(now) {
      if (dead) return;
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      var t = now / 1000;

      // camera
      if (auto) tYaw += dt * 0.6;
      var k = Math.min(1, dt * 6);
      yaw += (tYaw - yaw) * k; pitch += (tPitch - pitch) * k; dist += (tDist - dist) * k;
      root.rotation.y = yaw;
      camera.position.set(0, dist * Math.sin(pitch), dist * Math.cos(pitch));
      camera.lookAt(0, 0, 0);

      // body motion
      var sleeping = mode === 'sleep';
      var lying = sleeping && sleeperReady;
      var breathe = Math.sin(t * (sleeping ? 1.6 : 2.4));
      var hopY = 0, sq = 0, shake = 0, tx = sleeping ? 0.2 : 0, tz = sleeping ? -0.1 : 0, glowT = sleeping ? 0.12 : 1;
      var flutter = 1, seatS = 1, slpS = 1, slpShake = 0, showSeat = !lying, showSlp = lying;
      if (seq) {
        var s = (now - seq.t0) / 1000;
        if (seq.type === 'hop') {
          var hp = clamp(s / 0.62, 0, 1);
          hopY = 0.55 * Math.sin(PI * hp);
          sq = hp < 1 ? 0.1 * Math.sin(PI * hp) : 0;
          if (s > 0.62 && s < 0.82) sq = -0.1 * Math.sin(PI * (s - 0.62) / 0.2);
          if (s > 1.3) { var back = seq.back; seq = null; setExpr(back); }
        } else if (seq.type === 'sleepIn') {
          // close eyes and nod (0-0.5), shrink with a puff (0.5-0.78), pop up lying down (0.78-1.25)
          var a0 = ease(s / 0.5); tx = 0.2 * a0; tz = -0.1 * a0; glowT = 0.12;
          if (s >= 0.5 && s < 0.78) { seatS = 1 - 0.42 * ease((s - 0.5) / 0.28); if (!seq.burst) { seq.burst = true; burst(16); } }
          else if (s >= 0.78) {
            showSeat = false; showSlp = true;
            slpS = 0.58 + 0.42 * backOut(clamp((s - 0.78) / 0.45, 0, 1));
            if (s > 1.25) { seq = null; mode = 'sleep'; zzzOn = true; if (opts.onMode) opts.onMode('sleep'); }
          }
        } else if (seq.type === 'wake' && seq.slp && s < 0.9) {
          // lying model wiggles (0-0.6), shrinks with a puff (0.6-0.9)
          showSeat = false; showSlp = true; tx = 0.2; tz = -0.1; glowT = 0.12;
          if (s < 0.6) slpShake = Math.sin(s * 40) * 0.05 * (1 - s / 0.6);
          else { slpS = 1 - 0.42 * ease((s - 0.6) / 0.3); if (!seq.burst0) { seq.burst0 = true; burst(16); } }
        } else if (seq.type === 'wake') {
          showSeat = true; showSlp = false;
          if (seq.slp) { seatS = 0.58 + 0.42 * backOut(clamp((s - 0.9) / 0.4, 0, 1)); s -= 0.3; }
          // 0–0.6 twitch, 0.6–1.2 eyes flutter, head comes up, 1.2 lights on, 1.55 jump, 2.2 laugh, 3.3 smile
          if (s < 0.6) { shake = Math.sin(s * 45) * 0.035 * (1 - s / 0.6); tx = 0.2; tz = -0.1; glowT = 0.12; }
          else {
            var up = ease((s - 0.75) / 0.6);
            tx = 0.2 * (1 - up); tz = -0.1 * (1 - up);
            if (s < 2.2) setExpr('surprise');
            else if (s < 3.3) setExpr('laugh');
            else { setExpr('smile'); mode = 'awake'; seq = null; if (opts.onMode) opts.onMode('awake'); }
            var f = s - 0.6;
            flutter = f < 0.18 ? 0.35 : f < 0.3 ? 0 : f < 0.48 ? 0.55 : f < 0.58 ? 0.05 : 1;
            glowT = s > 1.2 ? 1 : 0.12;
            if (s > 1.55 && s < 2.2) {
              var jp = (s - 1.55) / 0.65; hopY = 0.6 * Math.sin(PI * jp); sq = 0.1 * Math.sin(PI * jp);
              if (seq && !seq.burst) { seq.burst = true; burst(40); }
            } else if (s >= 2.2 && s < 2.4) sq = -0.1 * Math.sin(PI * (s - 2.2) / 0.2);
          }
        }
      }
      var kk = Math.min(1, dt * 4);
      tiltX += (tx - tiltX) * kk; tiltZ += (tz - tiltZ) * kk; glow += (glowT - glow) * Math.min(1, dt * 3);
      var bAmp = sleeping ? 0.022 : 0.012;
      pose.visible = showSeat; slp.visible = showSlp;
      var sxz = 1 + (1 - seatS) * 0.6;
      pose.position.y = -1.5 + hopY;
      pose.rotation.set(tiltX + shake * 0.3, 0, tiltZ + shake + (sleeping ? 0 : Math.sin(t * 0.8) * 0.025));
      pose.scale.set((1 - sq * 0.5 - breathe * bAmp * 0.5) * sxz, (1 + sq + breathe * bAmp) * seatS, (1 - sq * 0.5 - breathe * bAmp * 0.5) * sxz);
      var lxz = slpS * (1 + (1 - slpS) * 0.5) * (1 - breathe * 0.012);
      slp.scale.set(lxz, slpS * (1 + breathe * 0.03), lxz);
      slp.rotation.z = slpShake;
      shadow.scale.set((showSlp ? 1.25 : 1) * (1 - hopY * 0.35), 1, 1 - hopY * 0.35);
      shadow.material.opacity = 1 - hopY * 0.8;

      // blink
      if (!sleeping && !seq && now > nextBlink && blinkT < 0) blinkT = now;
      if (blinkT >= 0) {
        var bp = (now - blinkT) / 160;
        blink = bp >= 1 ? 1 : 1 - Math.sin(PI * bp);
        if (bp >= 1) { blinkT = -1; nextBlink = now + 2200 + Math.random() * 3200; }
      } else blink = 1;

      // expression easing and redraw
      var ek = Math.min(1, dt * 10);
      for (var key2 in tgt) cur[key2] += (tgt[key2] - cur[key2]) * ek;
      var eyeMul = blink * flutter;
      var sig = [cur.eA, cur.eB, cur.sm, cur.sz, cur.mo, cur.cu, cur.mw, cur.rd, cur.bl, cur.bt, eyeMul].map(function (v) { return Math.round(v * 200); }).join(',');
      if (sig !== faceSig) { faceSig = sig; drawFace(faceCtx, cur, eyeMul); faceTex.needsUpdate = true; }

      // glow sprites
      if (glowEar) {
        var pulse = 0.85 + 0.15 * Math.sin(t * 3);
        glowEar.material.opacity = 0.55 * glow * pulse; glowHeart.material.opacity = 0.6 * glow * pulse;
      }

      // zzz
      var zBase = slp.visible ? 0.15 : 0.55;
      zs.forEach(function (z, i) {
        var ph = ((t * 0.45) + i / 3) % 1;
        var target = (zzzOn && mode === 'sleep') ? Math.sin(PI * ph) : 0;
        z.material.opacity += (target - z.material.opacity) * Math.min(1, dt * (target > 0 ? 5 : 12));
        z.position.set(-0.95 - ph * 0.4, zBase + ph * 0.8, 0.35);
        z.scale.setScalar(0.2 + ph * 0.24);
      });

      // sparkles
      for (var i = 0; i < NS; i++) {
        if (sLife[i] > 0) {
          sLife[i] -= dt; sVel[i].y -= dt * 2.4;
          sPos[i * 3] += sVel[i].x * dt; sPos[i * 3 + 1] += sVel[i].y * dt; sPos[i * 3 + 2] += sVel[i].z * dt;
          var c = sHue[i], a = clamp(sLife[i] / 0.6, 0, 1);
          sCol[i * 3] = c.r * a; sCol[i * 3 + 1] = c.g * a; sCol[i * 3 + 2] = c.b * a;
        } else { sCol[i * 3] = sCol[i * 3 + 1] = sCol[i * 3 + 2] = 0; }
      }
      sGeo.attributes.position.needsUpdate = true; sGeo.attributes.color.needsUpdate = true;

      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    // ---------- load the model ----------
    status('loading');
    fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }).then(function (ab) {
      var gl = parseGLB(ab), g = gl.g, bin = gl.bin;
      var md = g.materials[0], pbr = md.pbrMetallicRoughness || {};
      return Promise.all([
        loadTex(g, bin, pbr.baseColorTexture.index, true, aniso),
        pbr.metallicRoughnessTexture ? loadTex(g, bin, pbr.metallicRoughnessTexture.index, false, aniso) : null,
        md.normalTexture ? loadTex(g, bin, md.normalTexture.index, false, aniso) : null
      ]).then(function (tx) {
        if (dead) return;
        var mat = new T.MeshPhysicalMaterial({
          map: tx[0], roughness: 0.85, metalness: 0, envMapIntensity: 0.55,
          sheen: 0.3, sheenRoughness: 0.45, sheenColor: new T.Color('#ffe8a0')
        });
        if (tx[1]) mat.roughnessMap = tx[1];
        if (tx[2]) { mat.normalMap = tx[2]; mat.normalScale = new T.Vector2(0.8, 0.8); }
        mat.onBeforeCompile = function (sh) {
          sh.uniforms.faceMap = { value: faceTex };
          sh.uniforms.faceC = { value: new T.Vector2(FACE.zc, FACE.yc) };
          sh.uniforms.faceS = { value: FACE.size };
          sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjN;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;\nvObjN = normal;');
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjN;\nuniform sampler2D faceMap;\nuniform vec2 faceC;\nuniform float faceS;')
            .replace('#include <map_fragment>', [
              '#include <map_fragment>',
              'float faceGloss = 0.0;',
              '{',
              '  vec2 fuv = vec2(0.5 - (vObjPos.z - faceC.x) / faceS, (vObjPos.y - faceC.y) / faceS + 0.5);',
              '  if (vObjPos.x > 0.17 && fuv.x > 0.0 && fuv.x < 1.0 && fuv.y > 0.0 && fuv.y < 1.0) {',
              '    vec4 f = texture2D(faceMap, fuv);',
              '    diffuseColor.rgb = mix(diffuseColor.rgb, f.rgb, f.a);',
              '    float fl = dot(f.rgb, vec3(0.3, 0.59, 0.11));',
              '    faceGloss = f.a * (1.0 - smoothstep(0.05, 0.35, fl));',
              '  }',
              '}'
            ].join('\n'))
            .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.15, faceGloss);');
        };
        var model = new T.Group();
        g.meshes.forEach(function (m) { m.primitives.forEach(function (p) { model.add(new T.Mesh(buildGeometry(g, bin, p), mat)); }); });
        glowEar = glowSprite(0.2); glowEar.position.set(0.064, -0.077, -0.5); model.add(glowEar);
        glowHeart = glowSprite(0.12); glowHeart.position.set(0.36, -0.333, 0.032); model.add(glowHeart);
        model.rotation.y = -PI / 2;            // the model looks down +X; turn it to face the camera
        var holder = new T.Group(); holder.add(model);
        holder.updateMatrixWorld(true);
        var box = new T.Box3().setFromObject(holder), size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
        var s = 3.0 / Math.max(size.x, size.y, size.z);
        holder.scale.setScalar(s);
        holder.position.set(-center.x * s, -box.min.y * s, -center.z * s);
        pose.add(holder);
        ready = true;
        status('ready');
        loadSleeper();
      });
    }).catch(function (err) { console.error('narang viewer', err); status('error', String(err && err.message || err)); });

    function loadSleeper() {
      if (!opts.sleepUrl) return;
      fetch(opts.sleepUrl).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }).then(function (ab) {
        var gl = parseGLB(ab), g = gl.g, bin = gl.bin, pbr = g.materials[0].pbrMetallicRoughness || {};
        return loadTex(g, bin, pbr.baseColorTexture.index, true, aniso).then(function (tex) {
          if (dead) return;
          var mat = new T.MeshPhysicalMaterial({ map: tex, roughness: 0.85, metalness: 0, envMapIntensity: 0.55, sheen: 0.3, sheenRoughness: 0.45, sheenColor: new T.Color('#ffe8a0') });
          var m = new T.Group();
          g.meshes.forEach(function (mm) { mm.primitives.forEach(function (p) { var geo = buildGeometry(g, bin, p); smoothNormals(geo); m.add(new T.Mesh(geo, mat)); }); });
          var holder = new T.Group(); holder.add(m); holder.updateMatrixWorld(true);
          var box = new T.Box3().setFromObject(holder), size = box.getSize(new T.Vector3()), c = box.getCenter(new T.Vector3());
          var k = 2.35 / size.y;
          holder.scale.setScalar(k); holder.position.set(-c.x * k, -box.min.y * k, -c.z * k);
          slp.add(holder); sleeperReady = true;
        });
      }).catch(function (e) { console.warn('lying model', e); });
    }

    var api = {
      setView: function (id) { var tv = VIEWS[id] || 0; tYaw = tv + 2 * PI * Math.round((tYaw - tv) / (2 * PI)); tPitch = 0.1; auto = false; },
      setAuto: function (on) { auto = !!on; },
      setExpr: function (name) {
        if (seq && (seq.type === 'wake' || seq.type === 'sleepIn')) return;
        if (name === 'sleep') { api.sleep(); return; }
        if (mode === 'sleep' && sleeperReady) { api.wake(); return; }
        if (mode === 'sleep') { mode = 'awake'; zzzOn = false; if (opts.onMode) opts.onMode('awake'); }
        seq = null; setExpr(name);
      },
      hop: function () {
        if (!ready || mode === 'sleep' || (seq && (seq.type === 'wake' || seq.type === 'sleepIn'))) return;
        var back = seq && seq.type === 'hop' ? seq.back : exprName;
        seq = { type: 'hop', t0: performance.now(), back: back };
        setExpr('laugh'); burst(14);
      },
      sleep: function () {
        if (mode === 'sleep' || (seq && (seq.type === 'wake' || seq.type === 'sleepIn'))) return;
        setExpr('sleep');
        if (sleeperReady) { seq = { type: 'sleepIn', t0: performance.now() }; if (opts.onMode) opts.onMode('sleeping'); return; }
        seq = null; mode = 'sleep'; zzzOn = true; if (opts.onMode) opts.onMode('sleep');
      },
      wake: function () {
        if (mode !== 'sleep' || (seq && seq.type === 'wake')) return;
        zzzOn = false;
        seq = { type: 'wake', t0: performance.now(), slp: sleeperReady }; if (opts.onMode) opts.onMode('waking');
      },
      dispose: function () {
        dead = true; cancelAnimationFrame(raf); ro.disconnect();
        canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp);
        canvas.removeEventListener('wheel', onWheel);
        renderer.dispose();
      }
    };
    return api;
  }

  window.NarangViewer = { create: create };
})();
