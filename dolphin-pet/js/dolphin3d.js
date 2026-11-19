/* ============================================================
 * 小海豚 3D 引擎
 * - 程序化建模（无需外部 glb，可选加载真实模型覆盖）
 * - 动作通过整体旋转 / 位移 / 缩放 / 鳍摆动实现（模型无骨骼）
 * - 支持拖拽旋转、视线跟随、漂浮拖拽、2D 三视图降级
 * ============================================================ */
(function () {
  'use strict';

  const rig = document.getElementById('heroRig');
  const canvas = document.getElementById('hero3dCanvas');
  const loading = document.getElementById('hero3dLoading');
  const mode3dBtn = document.getElementById('mode3dBtn');
  const mode2dBtn = document.getElementById('mode2dBtn');
  const hero2d = document.getElementById('hero2d');

  const MODEL_URL = 'model3d/小海豚-web.glb';
  const IS_REDUCED = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  const state = {
    ready: false,
    loading3d: false,
    mode: IS_REDUCED ? '2d' : '3d',
    dragging: false,
    moved: false,
    dragMode: 'rotate', // rotate | move
    lastX: 0,
    lastY: 0,
    targetRotY: 0.85,
    rotY: 0.85,
    targetPitch: 0.02,
    pitch: 0.02,
    velocity: 0.008,
    action: null,
    actionUntil: 0,
    sleeping: false,
    speaking: false,
    gazeX: 0,
    gazeY: 0,
    gazeTX: 0,
    gazeTY: 0,
    raf: 0,
  };

  const listeners = { pet: [], drag: [], double: [] };

  let THREE;
  let renderer;
  let scene;
  let camera;
  let clock;
  let root;      // 外层：只做全局定位
  let dolphin;   // 内层：姿态 / 缩放
  let tailGroup;
  let pecL;
  let pecR;
  let eyeL;
  let eyeR;
  let basePos = null;
  let baseScale = 1;

  /* ---------------- 模式切换 ---------------- */
  function setMode(mode) {
    state.mode = mode;
    if (rig) rig.classList.toggle('mode-2d', mode !== '3d');
    const hint = rig && rig.querySelector('.rig-hint');
    if (hint) {
      hint.textContent = mode === '3d'
        ? '拖拽旋转 · 单击摸摸 · 双击欢呼'
        : '单击摸摸 · 双击欢呼 · 可切回 3D';
    }
    if (mode3dBtn && mode2dBtn) {
      const is3d = mode === '3d';
      mode3dBtn.classList.toggle('is-active', is3d);
      mode2dBtn.classList.toggle('is-active', !is3d);
      mode3dBtn.setAttribute('aria-pressed', String(is3d));
      mode2dBtn.setAttribute('aria-pressed', String(!is3d));
    }
    if (mode === '3d' && state.ready && !state.raf) loop();
    if (mode === '3d' && !state.ready && !state.loading3d) init3d();
  }

  /* ---------------- 场景 ---------------- */
  function setupScene() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0.18, 4.9);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    scene.add(new THREE.HemisphereLight(0xcfeaff, 0x0a2236, 1.15));

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3.2, 4.6, 4.5);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xbfa8ff, 0.85);
    fill.position.set(-4, 1.2, 3.2);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0x7fe2ff, 1.5);
    rim.position.set(-1.5, 2.6, -5);
    scene.add(rim);

    const glow = new THREE.PointLight(0x5ad8ff, 1.6, 9, 2);
    glow.position.set(0, -1.6, 2.4);
    scene.add(glow);

    clock = new THREE.Clock();
  }

  /* ---------------- 程序化海豚 ---------------- */
  function lerpColor(a, b, t) {
    return new THREE.Color(
      a.r + (b.r - a.r) * t,
      a.g + (b.g - a.g) * t,
      a.b + (b.b - a.b) * t
    );
  }

  function buildBodyGeometry() {
    const SEG = 52;
    const pts = [];
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      // 0 = 吻端, 1 = 尾柄
      let r = 0.305 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 1.22);
      r *= 1 - 0.18 * t;                 // 向尾部收细
      r = Math.max(r, 0.004);
      pts.push(new THREE.Vector2(r, 0.5 - t)); // 沿 Y 轴，长度 1
    }
    const geo = new THREE.LatheGeometry(pts, 40);
    geo.rotateX(Math.PI / 2);      // 轴线转到 Z
    geo.scale(1, 0.9, 2.42);       // 比例：长 2.42，扁一点
    geo.computeBoundingBox();

    // 背深腹浅的顶点色
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const top = new THREE.Color(0x4f9ad8);
    const mid = new THREE.Color(0x8cc8ef);
    const bottom = new THREE.Color(0xf2fbff);
    const bb = geo.boundingBox;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const k = (y - bb.min.y) / Math.max(bb.max.y - bb.min.y, 0.0001);
      const c = k < 0.55 ? lerpColor(bottom, mid, k / 0.55) : lerpColor(mid, top, (k - 0.55) / 0.45);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }

  function extrudeShape(shape, depth) {
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelSize: 0.008,
      bevelThickness: 0.008,
      bevelSegments: 2,
      curveSegments: 18,
    });
    geo.translate(0, 0, -depth / 2);
    return geo;
  }

  function buildDolphin() {
    const group = new THREE.Group();

    const skin = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.34,
      metalness: 0.02,
      clearcoat: 0.65,
      clearcoatRoughness: 0.28,
    });
    const finMat = new THREE.MeshPhysicalMaterial({
      color: 0x4a92cf,
      roughness: 0.42,
      metalness: 0.03,
      clearcoat: 0.45,
      clearcoatRoughness: 0.35,
      side: THREE.DoubleSide,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0c2233, roughness: 0.25 });
    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    // 身体
    const body = new THREE.Mesh(buildBodyGeometry(), skin);
    group.add(body);

    // 背鳍（后掠的镰刀形）
    const dorsal = new THREE.Shape();
    dorsal.moveTo(-0.19, 0);
    dorsal.quadraticCurveTo(-0.04, 0.30, 0.06, 0.37);
    dorsal.quadraticCurveTo(0.13, 0.14, 0.25, 0.0);
    dorsal.closePath();
    const dorsalMesh = new THREE.Mesh(extrudeShape(dorsal, 0.03), finMat);
    dorsalMesh.rotation.y = Math.PI / 2;   // 立起来，沿 Z 展开
    dorsalMesh.position.set(0, 0.235, 0.06);
    group.add(dorsalMesh);

    // 胸鳍（左右）
    function makePec(sign) {
      const s = new THREE.Shape();
      s.moveTo(0, 0);
      s.quadraticCurveTo(0.20, -0.03, 0.36, -0.20);
      s.quadraticCurveTo(0.18, -0.26, 0.02, -0.11);
      s.closePath();
      const mesh = new THREE.Mesh(extrudeShape(s, 0.028), finMat);
      mesh.position.set(sign * 0.19, -0.075, 0.32);
      mesh.rotation.y = sign * Math.PI / 2;
      mesh.rotation.z = sign * -0.42;
      mesh.rotation.x = 0.22;
      if (sign < 0) mesh.scale.x = -1;
      return mesh;
    }
    pecR = makePec(1);
    pecL = makePec(-1);
    group.add(pecR, pecL);

    // 尾鳍
    tailGroup = new THREE.Group();
    tailGroup.position.set(0, 0, -1.18);
    const fluke = new THREE.Shape();
    fluke.moveTo(-0.36, 0.01);
    fluke.quadraticCurveTo(-0.14, 0.15, 0.02, 0.03);
    fluke.quadraticCurveTo(0.18, 0.15, 0.36, 0.01);
    fluke.quadraticCurveTo(0.18, -0.02, 0.02, -0.015);
    fluke.quadraticCurveTo(-0.14, -0.02, -0.36, 0.01);
    fluke.closePath();
    const flukeMesh = new THREE.Mesh(extrudeShape(fluke, 0.026), finMat);
    flukeMesh.rotation.x = -Math.PI / 2;
    tailGroup.add(flukeMesh);
    group.add(tailGroup);

    // 眼睛（白色眼白 + 深色瞳孔 + 高光）
    const scleraGeo = new THREE.SphereGeometry(0.064, 20, 16);
    const pupilGeo = new THREE.SphereGeometry(0.046, 18, 14);
    const shineGeo = new THREE.SphereGeometry(0.016, 10, 8);
    function makeEye(sign) {
      const eye = new THREE.Group();
      eye.position.set(sign * 0.183, 0.078, 0.70);
      const sclera = new THREE.Mesh(scleraGeo, whiteMat);
      const pupil = new THREE.Mesh(pupilGeo, darkMat);
      pupil.position.set(sign * 0.022, 0.004, 0.012);
      const shine = new THREE.Mesh(shineGeo, whiteMat);
      shine.position.set(sign * 0.034, 0.024, 0.044);
      eye.add(sclera, pupil, shine);
      return eye;
    }
    eyeR = makeEye(1);
    eyeL = makeEye(-1);
    group.add(eyeR, eyeL);

    // 嘴角线（左右各一条，贴合吻部曲面）
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x1d4a6b, roughness: 0.5 });
    [1, -1].forEach((sign) => {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(sign * 0.115, -0.005, 1.06),
        new THREE.Vector3(sign * 0.158, -0.066, 0.97),
        new THREE.Vector3(sign * 0.145, -0.108, 0.86),
      ]);
      const mouth = new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.011, 6, false), mouthMat);
      group.add(mouth);
    });

    // 头顶呼吸孔
    const blow = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 8), darkMat);
    blow.position.set(0, 0.245, 0.24);
    blow.scale.set(1, 0.35, 1);
    group.add(blow);

    return group;
  }

  function fitModel(object) {
    if (!object) return;
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    object.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 2.55 / maxDim;
    object.scale.setScalar(scale);
    object.position.multiplyScalar(scale);
  }

  function prepareLoadedModel(gltf) {
    const model = gltf.scene || gltf.scenes[0];
    model.traverse((child) => {
      if (child.isMesh) {
        child.frustumCulled = false;
        if (child.material && 'roughness' in child.material) {
          child.material.roughness = Math.min(child.material.roughness, 0.55);
        }
      }
    });
    return model;
  }

  /* ---------------- 尺寸 ---------------- */
  function resize() {
    if (!renderer) return;
    const w = canvas.clientWidth || 460;
    const h = canvas.clientHeight || 495;
    const pr = renderer.getPixelRatio();
    if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  /* ---------------- 动画循环 ---------------- */
  function loop() {
    if (!state.ready || state.mode !== '3d') {
      state.raf = 0;
      return;
    }
    state.raf = requestAnimationFrame(loop);
    resize();
    tick(clock.getElapsedTime());
    renderer.render(scene, camera);
  }

  const ACTION_TABLE = {
    wave: { duration: 1600 },
    happy: { duration: 1500 },
    shy: { duration: 1300 },
    cheer: { duration: 1700 },
    bounce: { duration: 1500 },
    playful: { duration: 1600 },
    spin: { duration: 1100 },
    eat: { duration: 1900 },
    nod: { duration: 900 },
    dance: { duration: 2400 },
    stretch: { duration: 1800 },
  };

  function tick(t) {
    if (!dolphin) return;

    // 惯性 + 自动漂移
    if (!state.dragging) {
      state.targetRotY += state.velocity;
      state.velocity *= 0.94;
      if (Math.abs(state.velocity) < 0.0002) state.velocity = 0;
      if (!state.action && state.dragMode !== 'move') state.targetRotY += 0.0016;
    }
    state.rotY += (state.targetRotY - state.rotY) * 0.12;
    state.pitch += (state.targetPitch - state.pitch) * 0.1;
    state.gazeX += (state.gazeTX - state.gazeX) * 0.06;
    state.gazeY += (state.gazeTY - state.gazeY) * 0.06;

    const sleepK = state.sleeping ? 1 : 0;
    const speed = sleepK ? 0.45 : 1;

    let bob = Math.sin(t * 1.5 * speed) * 0.045;
    let tilt = Math.sin(t * 0.9 * speed) * 0.045;
    let roll = 0;
    let driftX = Math.sin(t * 0.42 * speed) * 0.11;
    let driftZ = Math.cos(t * 0.33 * speed) * 0.05;
    let scale = 1;
    let extraY = 0;

    if (state.sleeping) {
      bob = Math.sin(t * 0.8) * 0.02 - 0.06;
      tilt = -0.06;
      driftX *= 0.35;
    }

    // 胸鳍常态摆动
    const finSwing = Math.sin(t * 2.4 * speed) * 0.16;
    let finWave = 0;

    // 动作
    const now = performance.now();
    if (state.action && now < state.actionUntil) {
      const dur = state.action.duration;
      const p = 1 - (state.actionUntil - now) / dur;
      const wave = Math.sin(p * Math.PI);
      switch (state.action.name) {
        case 'wave':
          finWave = Math.sin(p * Math.PI * 4) * 0.55 + 0.35;
          tilt += wave * 0.28;
          bob += wave * 0.12;
          break;
        case 'happy':
          bob += wave * 0.2;
          scale += wave * 0.05;
          tilt += Math.sin(p * Math.PI * 4) * 0.06;
          break;
        case 'shy':
          tilt -= wave * 0.18;
          extraY -= wave * 0.09;
          roll += Math.sin(p * Math.PI * 2) * 0.08;
          break;
        case 'cheer':
          bob += wave * 0.3;
          scale += wave * 0.09;
          tilt += wave * 0.14;
          finWave = wave * 0.8;
          break;
        case 'bounce':
          bob += Math.abs(Math.sin(p * Math.PI * 3)) * 0.26;
          break;
        case 'playful':
          tilt += Math.sin(p * Math.PI * 6) * 0.15;
          driftX += Math.sin(p * Math.PI * 2) * 0.16;
          break;
        case 'spin':
          bob += wave * 0.14;
          break;
        case 'eat':
          bob += Math.abs(Math.sin(p * Math.PI * 3)) * 0.06;
          extraY -= wave * 0.05;
          tilt += Math.sin(p * Math.PI * 6) * 0.06;
          break;
        case 'nod':
          tilt += Math.sin(p * Math.PI * 2) * 0.18;
          break;
        case 'dance':
          tilt += Math.sin(p * Math.PI * 5) * 0.2;
          bob += Math.abs(Math.sin(p * Math.PI * 4)) * 0.16;
          roll += Math.sin(p * Math.PI * 3) * 0.14;
          break;
        case 'stretch':
          scale += wave * 0.07;
          extraY += wave * 0.06;
          break;
      }
    } else if (state.action) {
      state.action = null;
    }

    if (state.action && state.action.name === 'spin') {
      state.targetRotY += 0.16;
    }

    // 说话时轻微点头
    if (state.speaking && !state.action) {
      tilt += Math.sin(t * 7) * 0.035;
    }

    // 视线跟随（拖拽时不抢方向）
    const gazeYaw = state.dragging ? 0 : state.gazeX * 0.32;
    const gazePitch = state.dragging ? 0 : state.gazeY * 0.22;

    dolphin.rotation.y = state.rotY + gazeYaw;
    dolphin.rotation.z = tilt + roll;
    dolphin.rotation.x = state.pitch + gazePitch + 0.02 + Math.sin(t * 0.7) * 0.02;

    const base = basePos || { x: 0, y: 0, z: 0 };
    dolphin.position.set(base.x + driftX, base.y + bob + extraY, base.z + driftZ);
    dolphin.scale.setScalar(baseScale * scale);

    if (tailGroup) tailGroup.rotation.x = Math.sin(t * 3.2 * speed) * (state.sleeping ? 0.08 : 0.16);
    if (pecR) pecR.rotation.z = -0.35 + finSwing + finWave;
    if (pecL) pecL.rotation.z = 0.35 - finSwing - finWave;

    if (eyeR && eyeL) {
      const close = state.sleeping ? 0.12 : 1;
      eyeR.scale.y += (close - eyeR.scale.y) * 0.15;
      eyeL.scale.y += (close - eyeL.scale.y) * 0.15;
    }
  }

  /* ---------------- 指针交互 ---------------- */
  function onPointerDown(e) {
    if (state.mode !== '3d' || e.button === 2) return;
    state.dragging = true;
    state.moved = false;
    state.lastX = e.clientX;
    state.lastY = e.clientY;
    if (canvas.setPointerCapture) {
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    }
  }

  function onPointerMove(e) {
    // 视线跟随（即使未按下）
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width && rect.height) {
        state.gazeTX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        state.gazeTY = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      }
    }
    if (!state.dragging || state.mode !== '3d') return;
    const dx = e.clientX - state.lastX;
    const dy = e.clientY - state.lastY;
    state.lastX = e.clientX;
    state.lastY = e.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 3) state.moved = true;

    if (state.dragMode === 'move') {
      emit('drag', { dx, dy });
      return;
    }
    const delta = dx * 0.011;
    state.targetRotY += delta;
    state.velocity = delta * 0.3;
    state.targetPitch = Math.max(-0.45, Math.min(0.45, state.targetPitch + dy * 0.006));
  }

  function onPointerUp(e) {
    if (!state.dragging) return;
    state.dragging = false;
    if (canvas.releasePointerCapture) {
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    }
    if (state.moved) {
      setTimeout(() => { state.moved = false; }, 60);
      return;
    }
    if (state.mode === '3d') emit('pet', null);
  }

  function onDblClick() {
    if (state.mode !== '3d') return;
    emit('double', null);
  }

  function emit(type, payload) {
    (listeners[type] || []).forEach((fn) => {
      try { fn(payload); } catch (err) { console.warn('[Dolphin3D] listener error', err); }
    });
  }

  /* ---------------- 对外 API ---------------- */
  const api = {
    ready: () => state.ready,
    mode: () => state.mode,
    setMode,
    setDragMode(mode) { state.dragMode = mode === 'move' ? 'move' : 'rotate'; },
    on(type, fn) {
      if (listeners[type]) listeners[type].push(fn);
      return api;
    },
    play(name) {
      if (!state.ready) return;
      if (state.mode === '2d') { play2d(name); return; }
      const conf = ACTION_TABLE[name] || { duration: 1400 };
      state.action = { name, duration: conf.duration };
      state.actionUntil = performance.now() + conf.duration;
    },
    turn() {
      if (!state.ready) return;
      state.targetRotY += Math.PI * 2;
      state.velocity = 0.04;
    },
    speaking(on) {
      state.speaking = !!on;
    },
    setSleeping(on) {
      state.sleeping = !!on;
      if (hero2d) hero2d.classList.toggle('act-sleep', !!on);
      if (on) api.play('stretch');
    },
    play2d,
  };

  let play2dTimer = 0;
  function play2d(name) {
    if (!hero2d) return;
    const map = {
      wave: 'act-happy', happy: 'act-happy', shy: 'act-shy', cheer: 'act-cheer',
      bounce: 'act-happy', playful: 'act-shy', spin: 'act-spin', eat: 'act-happy',
      nod: 'act-happy', dance: 'act-cheer', stretch: 'act-shy',
    };
    const cls = map[name] || 'act-happy';
    hero2d.classList.remove('act-happy', 'act-shy', 'act-cheer', 'act-spin');
    if (!state.sleeping) hero2d.classList.remove('act-sleep');
    void hero2d.offsetWidth;
    hero2d.classList.add(cls);
    clearTimeout(play2dTimer);
    play2dTimer = setTimeout(() => hero2d.classList.remove(cls), 2400);
  }

  window.Dolphin3D = api;

  /* ---------------- 初始化 ---------------- */
  function init() {
    if (!canvas || !rig) return;

    if (mode3dBtn) mode3dBtn.addEventListener('click', (e) => { e.stopPropagation(); setMode('3d'); });
    if (mode2dBtn) mode2dBtn.addEventListener('click', (e) => { e.stopPropagation(); setMode('2d'); });

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('dblclick', onDblClick);

    setMode(state.mode);
    if (state.mode === '2d' && loading) loading.remove();
  }

  async function init3d() {
    if (state.loading3d || state.ready) return;
    state.loading3d = true;

    try {
      if (!THREE) THREE = await import('three');
      if (!renderer) setupScene();
      if (!root) {
        root = new THREE.Group();
        scene.add(root);
      }

      let loaded = null;
      try {
        const { GLTFLoader } = await import('./assets/three/examples/jsm/loaders/GLTFLoader.js');
        loaded = await new Promise((resolve, reject) => {
          new GLTFLoader().load(MODEL_URL, resolve, undefined, reject);
        });
      } catch (modelErr) {
        console.info('[Dolphin3D] 未找到 glb 模型，使用程序化海豚', modelErr);
      }

      if (dolphin) root.remove(dolphin);
      tailGroup = pecL = pecR = eyeL = eyeR = null;
      dolphin = loaded ? prepareLoadedModel(loaded) : buildDolphin();
      fitModel(dolphin);
      basePos = dolphin.position.clone();
      baseScale = dolphin.scale.x;
      root.add(dolphin);

      state.ready = true;
      state.loading3d = false;
      rig.classList.add('three-ready');
      rig.classList.remove('mode-2d');
      if (loading) loading.remove();
      clock.start();
      if (!state.raf) loop();
    } catch (err) {
      state.loading3d = false;
      console.warn('[Dolphin3D] 3D 初始化失败，已回退到 2D 三视图', err);
      if (loading) loading.remove();
      setMode('2d');
    }
  }

  // 页面隐藏时暂停渲染，回来再续
  document.addEventListener('visibilitychange', () => {
    if (!state.ready) return;
    if (document.hidden) {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    } else if (state.mode === '3d' && !state.raf) {
      clock.getDelta();
      loop();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
