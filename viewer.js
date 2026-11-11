/* Narang GLB/glTF viewer on three.js r149 (UMD). No data:/blob: URL fetches. */
(function () {
  function b64ToBytes(b64) {
    var bin = atob(b64), n = bin.length, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function readAccessor(gltf, buf, idx) {
    var a = gltf.accessors[idx], bv = gltf.bufferViews[a.bufferView];
    var comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    var Ctor = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[a.componentType];
    var off = (bv.byteOffset || 0) + (a.byteOffset || 0);
    var elBytes = Ctor.BYTES_PER_ELEMENT * comps;
    var stride = bv.byteStride || elBytes;
    var count = a.count * comps;
    if (stride === elBytes) {
      var copy = buf.slice(off, off + count * Ctor.BYTES_PER_ELEMENT);
      return { array: new Ctor(copy.buffer), size: comps };
    }
    var outArr = new Ctor(count), dv = new DataView(buf.buffer, buf.byteOffset);
    for (var i = 0; i < a.count; i++) {
      var src = new Ctor(buf.buffer.slice(buf.byteOffset + off + i * stride, buf.byteOffset + off + i * stride + elBytes));
      outArr.set(src, i * comps);
    }
    return { array: outArr, size: comps };
  }

  function create(host, url, opts) {
    var T = window.THREE, PI = Math.PI;
    opts = opts || {};
    var status = opts.onStatus || function () {};
    if (T.ColorManagement) T.ColorManagement.legacyMode = false;
    var canvas = host.querySelector('canvas');
    var renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.NoToneMapping;

    var scene = new T.Scene();
    var camera = new T.PerspectiveCamera(30, 1, 0.05, 100);
    scene.add(new T.HemisphereLight(0xffffff, 0xd8cbb0, 0.62));
    var key = new T.DirectionalLight(0xffffff, 0.95); key.position.set(2, 4, 5); scene.add(key);
    var fill = new T.DirectionalLight(0xffffff, 0.3); fill.position.set(-4, 1, 2); scene.add(fill);
    var back = new T.DirectionalLight(0xffffff, 0.4); back.position.set(0, 3, -5); scene.add(back);

    var root = new T.Group(); scene.add(root);
    var shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 256;
    var sctx = shadowCanvas.getContext('2d');
    var sg = sctx.createRadialGradient(128, 128, 6, 128, 128, 128);
    sg.addColorStop(0, 'rgba(90,64,20,0.32)'); sg.addColorStop(1, 'rgba(90,64,20,0)');
    sctx.fillStyle = sg; sctx.fillRect(0, 0, 256, 256);
    var shTex = new T.CanvasTexture(shadowCanvas);
    var shadow = new T.Mesh(new T.PlaneGeometry(2.6, 2.0), new T.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false }));
    shadow.rotation.x = -PI / 2; shadow.position.y = -1.52; scene.add(shadow);

    var yaw = 0, tYaw = 0, pitch = 0.1, tPitch = 0.1, dist = 7.2, tDist = 7.2, auto = false;
    var zoomed = false, pts = {}, pinch = 0, drag = false, px = 0, py = 0, raf = 0, last = performance.now(), dead = false;
    var VIEWS = { front: 0, left: -PI / 2, back: PI, right: PI / 2 };
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function onDown(e) { pts[e.pointerId] = [e.clientX, e.clientY]; var ids = Object.keys(pts); if (ids.length === 2) { var a = pts[ids[0]], b = pts[ids[1]]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); drag = false; return; } drag = true; px = e.clientX; py = e.clientY; auto = false; try { canvas.setPointerCapture(e.pointerId); } catch (x) {} if (opts.onUserMove) opts.onUserMove(); }
    function onMove(e) { if (pts[e.pointerId]) pts[e.pointerId] = [e.clientX, e.clientY]; var ids = Object.keys(pts); if (ids.length === 2) { var a = pts[ids[0]], b = pts[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) { tDist = clamp(tDist * pinch / d, 3.8, 16); zoomed = true; } pinch = d; return; } if (!drag) return; tYaw += (e.clientX - px) * 0.01; tPitch = clamp(tPitch + (e.clientY - py) * 0.006, -0.4, 0.75); px = e.clientX; py = e.clientY; }
    function onUp(e) { delete pts[e.pointerId]; pinch = 0; drag = false; }
    function onWheel(e) { e.preventDefault(); tDist = clamp(tDist + e.deltaY * 0.004, 3.8, 16); zoomed = true; }
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    function resize() {
      var w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); if (!zoomed) { tDist = Math.max(7.2, 6.4 / camera.aspect); dist = tDist; }
    }
    var ro = new ResizeObserver(resize); ro.observe(host); resize();

    function frame(now) {
      if (dead) return;
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (auto) tYaw += dt * 0.6;
      var k = Math.min(1, dt * 6);
      yaw += (tYaw - yaw) * k; pitch += (tPitch - pitch) * k; dist += (tDist - dist) * k;
      root.rotation.y = yaw;
      camera.position.set(0, dist * Math.sin(pitch), dist * Math.cos(pitch));
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    function makeTexture(gltf, buf, texIndex, srgb) {
      var tex = gltf.textures[texIndex], img = gltf.images[tex.source];
      var bv = gltf.bufferViews[img.bufferView];
      var bytes = buf.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
      var blob = new Blob([bytes], { type: img.mimeType || 'image/png' });
      return createImageBitmap(blob, { imageOrientation: 'none' }).then(function (bmp) {
        var t = new T.Texture(bmp);
        t.flipY = false;
        t.encoding = srgb ? T.sRGBEncoding : T.LinearEncoding;
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        t.needsUpdate = true;
        return t;
      });
    }

    status('loading');
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (gltf) {
      var uri = gltf.buffers[0].uri || '';
      var buf = b64ToBytes(uri.slice(uri.indexOf(',') + 1));
      var matDef = (gltf.materials || [])[0] || {};
      var pbr = matDef.pbrMetallicRoughness || {};
      var jobs = [
        pbr.baseColorTexture ? makeTexture(gltf, buf, pbr.baseColorTexture.index, true) : Promise.resolve(null),
        pbr.metallicRoughnessTexture ? makeTexture(gltf, buf, pbr.metallicRoughnessTexture.index, false) : Promise.resolve(null),
        matDef.normalTexture ? makeTexture(gltf, buf, matDef.normalTexture.index, false) : Promise.resolve(null)
      ];
      return Promise.all(jobs).then(function (tx) {
        if (dead) return;
        var mat = new T.MeshStandardMaterial({ color: 0xffffff, metalness: 0, roughness: 1 });
        if (tx[0]) mat.map = tx[0];
        if (tx[1]) mat.roughnessMap = tx[1];
        if (tx[2]) { mat.normalMap = tx[2]; mat.normalScale = new T.Vector2(1, 1); }
        var model = new T.Group();
        gltf.meshes.forEach(function (m) {
          m.primitives.forEach(function (p) {
            var g = new T.BufferGeometry();
            var pos = readAccessor(gltf, buf, p.attributes.POSITION);
            g.setAttribute('position', new T.BufferAttribute(pos.array, pos.size));
            if (p.attributes.NORMAL !== undefined) { var nr = readAccessor(gltf, buf, p.attributes.NORMAL); g.setAttribute('normal', new T.BufferAttribute(nr.array, nr.size)); }
            if (p.attributes.TEXCOORD_0 !== undefined) { var uv = readAccessor(gltf, buf, p.attributes.TEXCOORD_0); g.setAttribute('uv', new T.BufferAttribute(uv.array, uv.size)); }
            if (p.indices !== undefined) { var ix = readAccessor(gltf, buf, p.indices); g.setIndex(new T.BufferAttribute(ix.array, 1)); }
            if (p.attributes.NORMAL === undefined) g.computeVertexNormals();
            if (tx[2] && p.attributes.TEXCOORD_0 !== undefined) g.computeTangents && null;
            model.add(new T.Mesh(g, mat));
          });
        });
        // Tripo output faces +X; turn it so the face looks at +Z.
        model.rotation.y = -PI / 2;
        var holder = new T.Group(); holder.add(model);
        holder.updateMatrixWorld(true);
        var box = new T.Box3().setFromObject(holder);
        var size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
        var s = 3.0 / Math.max(size.x, size.y, size.z);
        holder.scale.setScalar(s);
        holder.position.set(-center.x * s, -center.y * s, -center.z * s);
        root.add(holder);
        shadow.position.y = -size.y * s / 2 - 0.02;
        status('ready');
      });
    }).catch(function (err) {
      console.error('narang viewer', err);
      status('error', String(err && err.message || err));
    });

    return {
      setView: function (id) {
        var t = VIEWS[id] || 0;
        tYaw = t + 2 * PI * Math.round((tYaw - t) / (2 * PI));
        tPitch = 0.1; auto = false;
      },
      setAuto: function (on) { auto = !!on; },
      dispose: function () {
        dead = true; cancelAnimationFrame(raf); ro.disconnect();
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onUp);
        canvas.removeEventListener('wheel', onWheel);
        scene.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
        renderer.dispose();
      }
    };
  }

  window.NarangViewer = { create: create };
})();
