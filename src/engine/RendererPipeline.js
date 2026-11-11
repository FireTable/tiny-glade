import * as THREE from 'three';
import { MaterialLibrary } from './MaterialLibrary.js';
import { AtmosphereSky } from './AtmosphereSky.js';
import { WaterSystem } from './WaterSystem.js';
import { PostFX } from './PostFX.js';

const POINT_LIGHT_POOL_SIZE = 8;

const QUALITY_DPR_CAP = {
  ultra: 2.0,
  high: 1.75,
  balanced: 1.25,
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

export function createRendererPipeline(canvasOrOpts, opts = {}) {
  let canvas = canvasOrOpts;
  if (
    canvasOrOpts &&
    typeof HTMLCanvasElement !== 'undefined' &&
    !(canvasOrOpts instanceof HTMLCanvasElement) &&
    canvasOrOpts.canvas
  ) {
    opts = canvasOrOpts;
    canvas = opts.canvas;
  }

  const initialQuality = (opts.quality || 'high').toLowerCase();
  const waterLevel = opts.waterLevel ?? -0.35;
  const worldSize = opts.worldSize ?? 120;

  // WebGL2 HDR Renderer
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // Handled by WebGL2 4x MSAA HDR target in PostFX
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
    depth: true,
    preserveDrawingBuffer: false,
  });

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();

  const initW = Math.max(
    1,
    opts.width || (canvas && canvas.clientWidth) || (typeof window !== 'undefined' ? window.innerWidth : 1280)
  );
  const initH = Math.max(
    1,
    opts.height || (canvas && canvas.clientHeight) || (typeof window !== 'undefined' ? window.innerHeight : 720)
  );

  const camera = new THREE.PerspectiveCamera(opts.fov || 42, initW / initH, 0.25, 480);
  camera.position.set(26, 20, 28);
  camera.lookAt(0, 1.5, 0);

  // Shared live atmospheric & lens state
  const envState = {
    timeOfDay: opts.timeOfDay ?? 16.7,
    nightFactor: 0.0,
    twilightFactor: 0.0,
    season: opts.season || 'summer',
    cloudiness: opts.cloudiness ?? 0.32,
    mist: opts.mist ?? 0.35,
    windStrength: opts.windStrength ?? 0.45,
    quality: initialQuality,
    waterLevel,
    worldSize,
    sunDirection: new THREE.Vector3(0.5, 0.42, 0.75).normalize(),
    moonDirection: new THREE.Vector3(-0.5, 0.55, -0.66).normalize(),
    sunColor: new THREE.Color('#ffd195'),
    skyHorizonColor: new THREE.Color('#f2ba85'),
    skyZenithColor: new THREE.Color('#2c63b8'),
    groundBounceColor: new THREE.Color('#4b5d35'),
    ambientIntensity: 0.85,
    dof: {
      enabled: opts.dofEnabled ?? true,
      aperture: opts.aperture ?? 0.28,
      focusDistance: opts.focusDistance ?? 28.0,
      autoFocus: true,
    },
  };

  // Core Subsystems
  const materials = new MaterialLibrary(renderer, { waterLevel });
  const sky = new AtmosphereSky(renderer, scene, {
    quality: initialQuality,
    cloudiness: envState.cloudiness,
    windStrength: envState.windStrength,
  });
  const water = new WaterSystem({
    scene,
    worldSize,
    waterLevel,
  });

  const drawBufSize = new THREE.Vector2();
  const applyRendererSize = (cssW, cssH, qualityTier) => {
    const rawDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const dpr = Math.min(rawDpr, QUALITY_DPR_CAP[qualityTier] || 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(cssW, cssH, false);
    renderer.getDrawingBufferSize(drawBufSize);
  };
  applyRendererSize(initW, initH, initialQuality);

  const postFX = new PostFX(renderer, {
    width: drawBufSize.x,
    height: drawBufSize.y,
    quality: initialQuality,
    dofEnabled: envState.dof.enabled,
    aperture: envState.dof.aperture,
    focusDistance: envState.dof.focusDistance,
  });

  // Pre-allocated pool of 8 warm PointLights (kept visible=true so NUM_POINT_LIGHTS never triggers shader recompiles!)
  const pointLightPool = [];
  for (let i = 0; i < POINT_LIGHT_POOL_SIZE; i++) {
    const pl = new THREE.PointLight(0xffaa55, 0.0, 11.0, 2.0);
    pl.name = `LanternPointLight_${i}`;
    pl.castShadow = false;
    pl.position.set(0, -500, 0);
    scene.add(pl);
    pointLightPool.push(pl);
  }

  let cachedLanterns = [];
  const lanternSortScratch = [];

  function syncPointLights(lanternList) {
    cachedLanterns = [];
    if (Array.isArray(lanternList)) {
      for (let i = 0; i < lanternList.length; i++) {
        const item = lanternList[i];
        if (!item) continue;
        const pos = item.position || item;
        if (typeof pos.x === 'number' && typeof pos.y === 'number' && typeof pos.z === 'number') {
          cachedLanterns.push({
            x: pos.x,
            y: pos.y,
            z: pos.z,
            intensity: typeof item.intensity === 'number' ? item.intensity : 1.0,
            distSq: 0,
          });
        }
      }
    }
    refreshPointLightPool(internalElapsed);
  }

  function refreshPointLightPool(elapsedSec) {
    const nightGlow = smoothstep(0.04, 0.68, envState.nightFactor);
    const total = cachedLanterns.length;

    if (total === 0 || nightGlow <= 0.002) {
      for (let i = 0; i < POINT_LIGHT_POOL_SIZE; i++) {
        pointLightPool[i].intensity = 0.0;
        pointLightPool[i].position.set(0, -500, 0);
      }
      return;
    }

    lanternSortScratch.length = 0;
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;

    for (let i = 0; i < total; i++) {
      const entry = cachedLanterns[i];
      if (entry.intensity <= 0) continue;
      const dx = entry.x - cx;
      const dy = entry.y - cy;
      const dz = entry.z - cz;
      entry.distSq = dx * dx + dy * dy + dz * dz;
      lanternSortScratch.push(entry);
    }

    if (lanternSortScratch.length > POINT_LIGHT_POOL_SIZE) {
      lanternSortScratch.sort((a, b) => a.distSq - b.distSq);
    }

    const activeCount = Math.min(POINT_LIGHT_POOL_SIZE, lanternSortScratch.length);
    for (let i = 0; i < POINT_LIGHT_POOL_SIZE; i++) {
      const light = pointLightPool[i];
      if (i < activeCount) {
        const l = lanternSortScratch[i];
        const phase = l.x * 2.7 + l.z * 1.9 + i * 1.3;
        const flicker =
          1.0 + 0.055 * Math.sin(elapsedSec * 6.4 + phase) * Math.cos(elapsedSec * 3.7 + phase * 0.8);
        light.position.set(l.x, l.y + 0.08, l.z);
        light.intensity = l.intensity * nightGlow * 4.4 * flicker;
      } else {
        light.intensity = 0.0;
        light.position.set(0, -500, 0);
      }
    }
  }

  // Zero-overhead WeakSet guard ensuring every mesh with vertexColors material has valid color & uv attributes
  const verifiedGeometries = new WeakSet();
  function ensureSceneMeshAttributes() {
    scene.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry || !obj.material) return;
      const geom = obj.geometry;
      if (verifiedGeometries.has(geom)) return;
      const posAttr = geom.attributes.position;
      if (!posAttr) return;

      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      let primaryVcMat = null;
      let needsUv = false;

      for (let i = 0; i < mats.length; i++) {
        const m = mats[i];
        if (!m) continue;
        if (m.vertexColors && !primaryVcMat) {
          primaryVcMat = m;
        }
        if (m.map || m.normalMap || m.roughnessMap || m.aoMap) {
          needsUv = true;
        }
      }

      const vCount = posAttr.count;

      if (primaryVcMat && !geom.attributes.color) {
        let r = 1.0;
        let g = 1.0;
        let b = 1.0;
        const hasInstanceColor = Boolean(obj.isInstancedMesh && obj.instanceColor);
        if (
          !hasInstanceColor &&
          primaryVcMat.userData &&
          primaryVcMat.userData.tgIsRootMaterial &&
          primaryVcMat.userData.tgDefaultTint
        ) {
          r = primaryVcMat.userData.tgDefaultTint.r;
          g = primaryVcMat.userData.tgDefaultTint.g;
          b = primaryVcMat.userData.tgDefaultTint.b;
        }
        const colors = new Float32Array(vCount * 3);
        for (let i = 0; i < vCount; i++) {
          const i3 = i * 3;
          colors[i3] = r;
          colors[i3 + 1] = g;
          colors[i3 + 2] = b;
        }
        geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }

      if (needsUv && !geom.attributes.uv) {
        const uvs = new Float32Array(vCount * 2);
        const normAttr = geom.attributes.normal;
        for (let i = 0; i < vCount; i++) {
          const px = posAttr.getX(i);
          const py = posAttr.getY(i);
          const pz = posAttr.getZ(i);
          let u = px * 0.5;
          let v = pz * 0.5;
          if (normAttr) {
            const nx = Math.abs(normAttr.getX(i));
            const ny = Math.abs(normAttr.getY(i));
            const nz = Math.abs(normAttr.getZ(i));
            if (nx >= ny && nx >= nz) {
              u = pz * 0.5;
              v = py * 0.5;
            } else if (nz >= nx && nz >= ny) {
              u = px * 0.5;
              v = py * 0.5;
            }
          }
          uvs[i * 2] = u;
          uvs[i * 2 + 1] = v;
        }
        geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      }

      if (primaryVcMat || !needsUv || geom.attributes.uv) {
        verifiedGeometries.add(geom);
      }
    });
  }

  let internalElapsed = 0.0;
  let lastCssW = initW;
  let lastCssH = initH;

  // Real-time smoothed performance telemetry
  let lastFrameTimestamp = typeof performance !== 'undefined' ? performance.now() : 0;
  let smoothedFrameMs = 16.67;
  let smoothedFps = 60.0;

  function setTimeOfDay(hours) {
    if (typeof hours === 'number' && Number.isFinite(hours)) {
      envState.timeOfDay = ((hours % 24) + 24) % 24;
    }
  }

  function setSeason(season) {
    if (season === 'summer' || season === 'autumn' || season === 'spring') {
      envState.season = season;
      materials.updateUniforms({ season });
    }
  }

  function setWeather(weatherOpts = {}) {
    if (!weatherOpts || typeof weatherOpts !== 'object') return;

    if (typeof weatherOpts.season === 'string') {
      const s = weatherOpts.season.toLowerCase();
      if (s === 'summer' || s === 'autumn' || s === 'spring') {
        envState.season = s;
      }
    }

    const cloudVal = weatherOpts.cloudiness ?? weatherOpts.clouds;
    if (typeof cloudVal === 'number' && Number.isFinite(cloudVal)) {
      envState.cloudiness = clamp(cloudVal, 0.0, 1.0);
    }

    const mistVal = weatherOpts.mist ?? weatherOpts.valleyMist ?? weatherOpts.mistDensity;
    if (typeof mistVal === 'number' && Number.isFinite(mistVal)) {
      envState.mist = clamp(mistVal, 0.0, 1.0);
    }

    const windVal = weatherOpts.windStrength ?? weatherOpts.wind;
    if (typeof windVal === 'number' && Number.isFinite(windVal)) {
      envState.windStrength = clamp(windVal, 0.0, 2.0);
    }

    if (typeof weatherOpts.timeOfDay === 'number' && Number.isFinite(weatherOpts.timeOfDay)) {
      setTimeOfDay(weatherOpts.timeOfDay);
    }
  }

  function setDoF(optsOrEnabled, aperture, focusDistance) {
    postFX.setDoF(optsOrEnabled, aperture, focusDistance);
    envState.dof.enabled = postFX.dofState.enabled;
    envState.dof.aperture = postFX.dofState.aperture;
    envState.dof.focusDistance = postFX.dofState.focusDistance;
    envState.dof.autoFocus = postFX.dofState.autoFocus;
  }

  function setQuality(tier) {
    const q = (tier || 'high').toLowerCase();
    if (q !== 'ultra' && q !== 'high' && q !== 'balanced') return;
    envState.quality = q;
    applyRendererSize(lastCssW, lastCssH, q);
    sky.setQuality(q);
    postFX.setQuality(q);
    postFX.resize(drawBufSize.x, drawBufSize.y);
  }

  function resize(width, height) {
    const w = Math.max(
      1,
      Math.floor(
        width ||
          (canvas && canvas.clientWidth) ||
          (typeof window !== 'undefined' ? window.innerWidth : 1280)
      )
    );
    const h = Math.max(
      1,
      Math.floor(
        height ||
          (canvas && canvas.clientHeight) ||
          (typeof window !== 'undefined' ? window.innerHeight : 720)
      )
    );
    lastCssW = w;
    lastCssH = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    applyRendererSize(w, h, envState.quality);
    postFX.resize(drawBufSize.x, drawBufSize.y);
  }

  function update(dt = 0.016, elapsed, focusWorldPos) {
    const safeDt = clamp(dt || 0.016, 0.0, 0.1);
    if (typeof elapsed === 'number' && Number.isFinite(elapsed)) {
      internalElapsed = elapsed;
    } else {
      internalElapsed += safeDt;
    }

    // Smoothly track screen-center autofocus target when provided
    if (focusWorldPos && postFX.dofState.autoFocus) {
      if (typeof focusWorldPos === 'number' && focusWorldPos > 0) {
        const targetDist = clamp(focusWorldPos, 2.5, 140.0);
        postFX.dofState.focusDistance +=
          (targetDist - postFX.dofState.focusDistance) * Math.min(1.0, safeDt * 7.5);
        envState.dof.focusDistance = postFX.dofState.focusDistance;
      } else if (typeof focusWorldPos.x === 'number') {
        const dx = focusWorldPos.x - camera.position.x;
        const dy = focusWorldPos.y - camera.position.y;
        const dz = focusWorldPos.z - camera.position.z;
        const dist = clamp(Math.sqrt(dx * dx + dy * dy + dz * dz), 2.5, 140.0);
        postFX.dofState.focusDistance +=
          (dist - postFX.dofState.focusDistance) * Math.min(1.0, safeDt * 7.5);
        envState.dof.focusDistance = postFX.dofState.focusDistance;
      }
    }

    sky.update(internalElapsed, envState, camera, focusWorldPos);

    materials.updateUniforms({
      sunDirection: envState.sunDirection,
      nightFactor: envState.nightFactor,
      season: envState.season,
      elapsed: internalElapsed,
      windStrength: envState.windStrength,
      waterLevel: envState.waterLevel,
    });

    water.update(safeDt, internalElapsed, envState, camera);
    refreshPointLightPool(internalElapsed);
  }

  function render() {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const deltaMs = now - lastFrameTimestamp;
    lastFrameTimestamp = now;
    if (deltaMs > 0.5 && deltaMs < 500) {
      smoothedFrameMs = smoothedFrameMs * 0.88 + deltaMs * 0.12;
      smoothedFps = 1000.0 / Math.max(smoothedFrameMs, 0.1);
    }

    ensureSceneMeshAttributes();
    renderer.info.reset();
    postFX.render(scene, camera, envState, internalElapsed);
  }

  function captureScreenshotDataURL(mimeType = 'image/png', quality = 0.95) {
    render();
    return renderer.domElement.toDataURL(mimeType, quality);
  }

  function getStats() {
    return {
      fps: Math.round(smoothedFps),
      frameMs: Number(smoothedFrameMs.toFixed(2)),
      drawCalls: postFX.lastSceneCalls ?? renderer.info.render.calls,
      triangles: postFX.lastSceneTriangles ?? renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      quality: envState.quality,
    };
  }

  function dispose() {
    for (let i = 0; i < pointLightPool.length; i++) {
      scene.remove(pointLightPool[i]);
      pointLightPool[i].dispose();
    }
    water.dispose();
    sky.dispose();
    materials.dispose();
    postFX.dispose();
    renderer.dispose();
  }

  // Initialize environment state & IBL immediately on creation so frame 0 has full physical lighting
  update(0.016, 0.0, null);

  return {
    renderer,
    scene,
    camera,
    sunLight: sky.sunLight,
    moonLight: sky.moonLight,
    hemisphereLight: sky.hemisphereLight,
    sky,
    materials,
    water,
    postFX,
    envState,
    setTimeOfDay,
    setSeason,
    setWeather,
    setDoF,
    setQuality,
    syncPointLights,
    update,
    render,
    resize,
    captureScreenshotDataURL,
    getStats,
    dispose,
  };
}

export class RendererPipeline {
  constructor(canvas, opts = {}) {
    Object.assign(this, createRendererPipeline(canvas, opts));
  }
}
