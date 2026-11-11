import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const SHEEP_COUNT = 9;
const MAX_DUCKS = 6;
const BUTTERFLY_COUNT = 28;
const BIRD_COUNT = 7;
const FIREFLY_COUNT = 168;
const MAX_SMOKE_PUFFS = 180;
const MAX_BURST_PARTICLES = 220;
const MAX_HEART_PARTICLES = 48;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

// Fluffy multi-puff wool geometry for adorable Tiny Glade sheep
function createSheepGeometries() {
  const woolParts = [];
  const puffs = [
    { x: 0.0, y: 0.46, z: 0.0, rx: 0.30, ry: 0.27, rz: 0.34 },
    { x: 0.0, y: 0.48, z: 0.20, rx: 0.26, ry: 0.25, rz: 0.25 },
    { x: 0.0, y: 0.45, z: -0.21, rx: 0.25, ry: 0.24, rz: 0.25 },
    { x: 0.14, y: 0.44, z: 0.04, rx: 0.22, ry: 0.22, rz: 0.26 },
    { x: -0.14, y: 0.44, z: 0.04, rx: 0.22, ry: 0.22, rz: 0.26 },
    { x: 0.11, y: 0.47, z: -0.12, rx: 0.20, ry: 0.20, rz: 0.20 },
    { x: -0.11, y: 0.47, z: -0.12, rx: 0.20, ry: 0.20, rz: 0.20 },
    // Cute fluffy tail puff
    { x: 0.0, y: 0.46, z: -0.40, rx: 0.10, ry: 0.10, rz: 0.11 }
  ];

  for (const pf of puffs) {
    const g = new THREE.IcosahedronGeometry(1.0, 1);
    g.scale(pf.rx, pf.ry, pf.rz);
    g.translate(pf.x, pf.y, pf.z);
    const nonIdx = g.index ? g.toNonIndexed() : g;
    woolParts.push(nonIdx);
    if (nonIdx !== g) g.dispose();
  }
  const bodyWoolGeo = mergeGeometries(woolParts, false);
  woolParts.forEach((g) => g.dispose());

  // 4 slender dark legs
  const legParts = [];
  const legCoords = [
    { x: 0.13, z: 0.18 },
    { x: -0.13, z: 0.18 },
    { x: 0.13, z: -0.18 },
    { x: -0.13, z: -0.18 }
  ];
  for (const lc of legCoords) {
    const leg = new THREE.CylinderGeometry(0.038, 0.028, 0.34, 6);
    leg.translate(lc.x, 0.17, lc.z);
    legParts.push(leg.toNonIndexed());
    leg.dispose();
  }
  const legsGeo = mergeGeometries(legParts, false);
  legParts.forEach((g) => g.dispose());

  // Articulated head (dark face + floppy side ears) + forehead wool cap
  const headDarkParts = [];
  const snout = new THREE.BoxGeometry(0.18, 0.17, 0.24);
  snout.translate(0, -0.02, 0.11);
  // Taper snout slightly at front
  const sPos = snout.attributes.position;
  for (let i = 0; i < sPos.count; i++) {
    if (sPos.getZ(i) > 0.15) {
      sPos.setX(i, sPos.getX(i) * 0.74);
      sPos.setY(i, sPos.getY(i) * 0.78 - 0.01);
    }
  }
  snout.computeVertexNormals();
  headDarkParts.push(snout.toNonIndexed());
  snout.dispose();

  for (const side of [-1, 1]) {
    const ear = new THREE.BoxGeometry(0.13, 0.045, 0.065);
    ear.rotateZ(side * -0.35);
    ear.translate(side * 0.14, 0.01, 0.04);
    headDarkParts.push(ear.toNonIndexed());
    ear.dispose();
  }
  const headDarkGeo = mergeGeometries(headDarkParts, false);
  headDarkParts.forEach((g) => g.dispose());

  const headCapGeo = new THREE.IcosahedronGeometry(0.115, 1);
  headCapGeo.scale(1.05, 0.85, 1.0);
  headCapGeo.translate(0, 0.085, 0.05);

  return { bodyWoolGeo, legsGeo, headDarkGeo, headCapGeo };
}

// Graceful pond swan / duck geometry (white body + curved neck + orange bill)
function createDuckGeometries() {
  const whiteParts = [];
  const body = new THREE.SphereGeometry(0.22, 8, 6);
  body.scale(0.82, 0.65, 1.28);
  body.translate(0, 0.09, 0);
  whiteParts.push(body.toNonIndexed());
  body.dispose();

  const tail = new THREE.ConeGeometry(0.11, 0.22, 5);
  tail.rotateX(-Math.PI * 0.36);
  tail.translate(0, 0.14, -0.26);
  whiteParts.push(tail.toNonIndexed());
  tail.dispose();

  const neck = new THREE.CylinderGeometry(0.042, 0.058, 0.24, 6);
  neck.rotateX(0.22);
  neck.translate(0, 0.24, 0.17);
  whiteParts.push(neck.toNonIndexed());
  neck.dispose();

  const head = new THREE.SphereGeometry(0.068, 7, 6);
  head.scale(0.9, 0.9, 1.1);
  head.translate(0, 0.35, 0.21);
  whiteParts.push(head.toNonIndexed());
  head.dispose();

  const duckBodyGeo = mergeGeometries(whiteParts, false);
  whiteParts.forEach((g) => g.dispose());

  const beakGeo = new THREE.ConeGeometry(0.036, 0.11, 5);
  beakGeo.rotateX(Math.PI * 0.52);
  beakGeo.translate(0, 0.34, 0.30);

  return { duckBodyGeo, beakGeo };
}

// V-wing geometry where abs(x) drives rapid wing flapping in vertex shader
function createWingedCritterGeometry(span = 0.18, chord = 0.12) {
  const positions = new Float32Array([
    // Left wing
    0, 0, chord * 0.5,
    0, 0, -chord * 0.5,
    -span, 0.02, 0.0,
    // Right wing
    0, 0, -chord * 0.5,
    0, 0, chord * 0.5,
    span, 0.02, 0.0
  ]);
  const normals = new Float32Array([
    0, 1, 0, 0, 1, 0, 0, 1, 0,
    0, 1, 0, 0, 1, 0, 0, 1, 0
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geo;
}

// Cute 3D plump heart geometry for petting sheep/ducks
function createHeartGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.11);
  shape.bezierCurveTo(0.02, -0.09, 0.15, 0.01, 0.15, 0.09);
  shape.bezierCurveTo(0.15, 0.16, 0.07, 0.19, 0, 0.11);
  shape.bezierCurveTo(-0.07, 0.19, -0.15, 0.16, -0.15, 0.09);
  shape.bezierCurveTo(-0.15, 0.01, -0.02, -0.09, 0, -0.11);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.05,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.018,
    bevelSegments: 2,
    curveSegments: 8
  });
  geo.center();
  return geo;
}

export class WildlifeAndParticles {
  constructor({ scene, terrain, worldSize = 120, waterLevel = -0.35, onWaterRipple }) {
    this.scene = scene;
    this.terrain = terrain;
    this.worldSize = worldSize;
    this.halfSize = worldSize * 0.5;
    this.waterLevel = waterLevel;
    this.onWaterRipple = typeof onWaterRipple === 'function' ? onWaterRipple : null;

    this.group = new THREE.Group();
    this.group.name = 'TinyGladeWildlifeAndParticles';
    this.scene.add(this.group);

    this.quality = 'ultra';
    this._dummy = new THREE.Object3D();
    this._tmpVec = new THREE.Vector3();
    this._tmpColor = new THREE.Color();

    this._initSheep();
    this._initPondDucks();
    this._initSkyAndMeadowLife();
    this._initSmokeAndBurstPools();
  }

  _initSheep() {
    const { bodyWoolGeo, legsGeo, headDarkGeo, headCapGeo } = createSheepGeometries();
    this._sheepGeos = [bodyWoolGeo, legsGeo, headDarkGeo, headCapGeo];

    this.woolMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#f5efe2'),
      roughness: 0.92,
      metalness: 0.0
    });
    this.woolWarmMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#ede2ce'),
      roughness: 0.92,
      metalness: 0.0
    });
    this.darkLimbMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#3b322c'),
      roughness: 0.82,
      metalness: 0.0
    });

    this.sheepList = [];
    for (let i = 0; i < SHEEP_COUNT; i++) {
      const root = new THREE.Group();
      const woolMat = i % 3 === 0 ? this.woolWarmMat : this.woolMat;

      const bodyMesh = new THREE.Mesh(bodyWoolGeo, woolMat);
      bodyMesh.castShadow = true;
      bodyMesh.receiveShadow = true;

      const legsMesh = new THREE.Mesh(legsGeo, this.darkLimbMat);
      legsMesh.castShadow = true;

      const headPivot = new THREE.Group();
      headPivot.position.set(0, 0.52, 0.34);
      const headDark = new THREE.Mesh(headDarkGeo, this.darkLimbMat);
      headDark.castShadow = true;
      const headCap = new THREE.Mesh(headCapGeo, woolMat);
      headCap.castShadow = true;
      headPivot.add(headDark, headCap);

      root.add(bodyMesh, legsMesh, headPivot);
      const scale = 0.86 + (i % 4) * 0.09;
      root.scale.setScalar(scale);
      this.group.add(root);

      const angle = (i / SHEEP_COUNT) * Math.PI * 2 + 0.4;
      const rad = 11.0 + (i % 3) * 6.5;
      const sx = Math.cos(angle) * rad;
      const sz = Math.sin(angle) * rad;

      this.sheepList.push({
        root,
        bodyMesh,
        legsMesh,
        headPivot,
        x: sx,
        z: sz,
        y: 0,
        yaw: angle + Math.PI * 0.5,
        targetYaw: angle + Math.PI * 0.5,
        targetX: sx,
        targetZ: sz,
        scale,
        state: i % 2 === 0 ? 'graze' : 'walk',
        stateTimer: 1.5 + (i * 0.7) % 4.0,
        joyTimer: 0,
        joyStartYaw: 0,
        stridePhase: i * 1.3
      });
    }

    this.regroundAndSafePlaceSheep();
  }

  _isSafeSheepSpot(x, z) {
    if (Math.hypot(x, z) > 48.0) return false;
    const h = this.terrain.getHeightAt(x, z);
    if (h < this.waterLevel + 0.20) return false;
    const nY = this.terrain.getNormalAt(x, z, this._tmpVec).y;
    if (nY < 0.77) return false;
    if (this.terrain.isPointBlockedByFootprint(x, z, 1.15)) return false;
    return true;
  }

  regroundAndSafePlaceSheep() {
    for (let i = 0; i < this.sheepList.length; i++) {
      const s = this.sheepList[i];
      if (!this._isSafeSheepSpot(s.x, s.z)) {
        // Search outward spiral for nearest sunny meadow patch
        let found = false;
        for (let r = 2.0; r <= 38.0 && !found; r += 2.2) {
          for (let a = 0; a < 12; a++) {
            const ang = (a / 12) * Math.PI * 2 + i * 0.5;
            const tx = s.x + Math.cos(ang) * r;
            const tz = s.z + Math.sin(ang) * r;
            if (this._isSafeSheepSpot(tx, tz)) {
              s.x = tx;
              s.z = tz;
              s.targetX = tx;
              s.targetZ = tz;
              found = true;
              break;
            }
          }
        }
      }
      s.y = this.terrain.getHeightAt(s.x, s.z);
      s.root.position.set(s.x, s.y, s.z);
    }
  }

  _initPondDucks() {
    const { duckBodyGeo, beakGeo } = createDuckGeometries();
    this._duckGeos = [duckBodyGeo, beakGeo];

    const featherMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#faf6ee'),
      roughness: 0.65,
      metalness: 0.0
    });
    const beakMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#e68225'),
      roughness: 0.55,
      metalness: 0.0
    });

    this.ducks = [];
    for (let i = 0; i < MAX_DUCKS; i++) {
      const root = new THREE.Group();
      const body = new THREE.Mesh(duckBodyGeo, featherMat);
      body.castShadow = true;
      body.receiveShadow = true;
      const beak = new THREE.Mesh(beakGeo, beakMat);
      root.add(body, beak);
      root.visible = false;
      this.group.add(root);

      this.ducks.push({
        root,
        active: false,
        x: 0,
        z: 0,
        yaw: i * 1.1,
        turnRate: 0.35,
        speed: 0.62 + (i % 3) * 0.14,
        rippleTimer: (i * 0.23) % 0.7,
        joyTimer: 0
      });
    }
    this._duckScanTimer = 0;
  }

  refreshPondDucks() {
    // Collect valid pond basin spots (h < waterLevel - 0.25)
    const pondSpots = [];
    for (let z = -50; z <= 50; z += 3.5) {
      for (let x = -50; x <= 50; x += 3.5) {
        const h = this.terrain.getHeightAt(x, z);
        if (h < this.waterLevel - 0.26) {
          pondSpots.push({ x, z });
        }
      }
    }

    if (pondSpots.length === 0) {
      for (const d of this.ducks) {
        d.active = false;
        d.root.visible = false;
      }
      return;
    }

    const desiredCount = Math.min(MAX_DUCKS, Math.max(2, Math.floor(pondSpots.length / 4)));
    for (let i = 0; i < MAX_DUCKS; i++) {
      const d = this.ducks[i];
      if (i >= desiredCount) {
        d.active = false;
        d.root.visible = false;
        continue;
      }

      const curH = this.terrain.getHeightAt(d.x, d.z);
      if (!d.active || curH >= this.waterLevel - 0.22) {
        const spot = pondSpots[(i * 7 + 3) % pondSpots.length];
        d.x = spot.x + (Math.random() - 0.5) * 1.2;
        d.z = spot.z + (Math.random() - 0.5) * 1.2;
        d.yaw = Math.random() * Math.PI * 2;
        d.active = true;
      }
      d.root.visible = true;
      d.root.position.set(d.x, this.waterLevel - 0.02, d.z);
    }
  }

  _createFlappingMaterial(flapSpeed = 18.0, flapAmp = 0.85, roughness = 0.65) {
    const uniforms = {
      uTime: { value: 0 }
    };
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness,
      metalness: 0.0,
      side: THREE.DoubleSide
    });
    mat.userData.uniforms = uniforms;
    mat.customProgramCacheKey = () => `tiny-glade-flap-${flapSpeed}`;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float phase = instanceMatrix[3][0] * 1.7 + instanceMatrix[3][2] * 1.3;
          float wingDist = abs(transformed.x);
          float flap = sin(uTime * ${flapSpeed.toFixed(1)} + phase) * ${flapAmp.toFixed(2)};
          transformed.y += wingDist * flap;
          transformed.x *= cos(flap * 0.45);`
        );
    };
    return mat;
  }

  _initSkyAndMeadowLife() {
    // 1. Fluttering daytime meadow butterflies
    const bflyGeo = createWingedCritterGeometry(0.11, 0.09);
    this.butterflyMat = this._createFlappingMaterial(19.0, 0.95, 0.55);
    this.butterflyMesh = new THREE.InstancedMesh(bflyGeo, this.butterflyMat, BUTTERFLY_COUNT);
    this.butterflyMesh.frustumCulled = false;
    const bflyColors = [
      new THREE.Color('#fff5d6'),
      new THREE.Color('#f7a438'),
      new THREE.Color('#8ec8f6'),
      new THREE.Color('#f6b8d0')
    ];
    this._butterflies = [];
    for (let i = 0; i < BUTTERFLY_COUNT; i++) {
      this.butterflyMesh.setColorAt(i, bflyColors[i % bflyColors.length]);
      const ang = (i / BUTTERFLY_COUNT) * Math.PI * 2;
      const rad = 6 + (i * 5.3) % 34;
      this._butterflies.push({
        cx: Math.cos(ang) * rad,
        cz: Math.sin(ang) * rad,
        rx: 2.2 + (i % 4) * 0.9,
        rz: 1.8 + ((i + 1) % 4) * 0.85,
        speed: 0.65 + (i % 5) * 0.12,
        phase: i * 1.7
      });
    }
    this.group.add(this.butterflyMesh);

    // 2. Circling daytime songbirds soaring over the glade
    const birdGeo = createWingedCritterGeometry(0.34, 0.15);
    this.birdMat = this._createFlappingMaterial(8.5, 0.55, 0.75);
    this.birdMesh = new THREE.InstancedMesh(birdGeo, this.birdMat, BIRD_COUNT);
    this.birdMesh.frustumCulled = false;
    this.birdMesh.castShadow = false;
    this._birds = [];
    for (let i = 0; i < BIRD_COUNT; i++) {
      this.birdMesh.setColorAt(i, i % 2 === 0 ? new THREE.Color('#4a4542') : new THREE.Color('#6b5c4f'));
      this._birds.push({
        cx: ((i % 3) - 1) * 10,
        cz: (((i + 1) % 3) - 1) * 10,
        orbitR: 16 + i * 3.5,
        alt: 14.5 + (i % 4) * 2.4,
        speed: 0.24 + (i % 3) * 0.05,
        phase: (i / BIRD_COUNT) * Math.PI * 2
      });
    }
    this.group.add(this.birdMesh);

    // 3. Warm glowing evening/night fireflies (concentrated over ponds & central glade, visible at nightFactor > 0.30)
    const ffPositions = new Float32Array(FIREFLY_COUNT * 3);
    const ffSeeds = new Float32Array(FIREFLY_COUNT);
    this._fireflyAnchors = [];
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const ang = (i / FIREFLY_COUNT) * Math.PI * 2 * 5.3;
      const rad = 2.0 + Math.pow((i + 0.5) / FIREFLY_COUNT, 0.72) * 24.0;
      const ax = Math.cos(ang) * rad;
      const az = Math.sin(ang) * rad;
      this._fireflyAnchors.push({ ax, az, phase: i * 2.399 });
      ffPositions[i * 3] = ax;
      ffPositions[i * 3 + 1] = 1.0;
      ffPositions[i * 3 + 2] = az;
      ffSeeds[i] = (i * 0.6180339887) % 1.0;
    }

    const ffGeo = new THREE.BufferGeometry();
    this._ffPosAttr = new THREE.BufferAttribute(ffPositions, 3);
    this._ffPosAttr.setUsage(THREE.DynamicDrawUsage);
    ffGeo.setAttribute('position', this._ffPosAttr);
    ffGeo.setAttribute('aSeed', new THREE.BufferAttribute(ffSeeds, 1));

    this.fireflyUniforms = {
      uTime: { value: 0 },
      uVisibility: { value: 0 },
      uPixelRatio: { value: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1 }
    };

    const ffMat = new THREE.ShaderMaterial({
      uniforms: this.fireflyUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float aSeed;
        uniform float uTime;
        uniform float uVisibility;
        uniform float uPixelRatio;
        varying float vPulse;
        varying float vSeed;
        void main() {
          vSeed = aSeed;
          float wave = 0.5 + 0.5 * sin(uTime * (1.75 + aSeed * 1.45) + aSeed * 31.4);
          float blink = 0.38 + 0.62 * smoothstep(0.10, 0.88, wave);
          vPulse = blink * uVisibility;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPos;
          float dist = max(2.0, -mvPos.z);
          gl_PointSize = clamp((210.0 + 115.0 * vPulse) * uPixelRatio / dist, 7.0 * uPixelRatio, 24.0 * uPixelRatio);
        }
      `,
      fragmentShader: `
        varying float vPulse;
        varying float vSeed;
        void main() {
          if (vPulse <= 0.005) discard;
          vec2 uv = gl_PointCoord - 0.5;
          float r = length(uv) * 2.0;
          if (r > 1.0) discard;
          float core = exp(-r * r * 5.8);
          float halo = pow(1.0 - r, 2.1) * 0.72;
          vec3 warmAmber = vec3(5.6, 4.1, 0.95);
          vec3 limeGold  = vec3(3.6, 5.4, 1.05);
          vec3 col = mix(warmAmber, limeGold, vSeed) * (core + halo);
          gl_FragColor = vec4(col * vPulse, clamp((core + halo) * vPulse, 0.0, 1.0));
        }
      `
    });

    this.fireflyPoints = new THREE.Points(ffGeo, ffMat);
    this.fireflyPoints.name = 'TinyGladeFireflies';
    this.fireflyPoints.frustumCulled = false;
    this.fireflyPoints.visible = false;
    this.group.add(this.fireflyPoints);
    this.refreshFireflyAnchors();
  }

  _initSmokeAndBurstPools() {
    // 1. Soft billowing chimney smoke puffs
    const smokeGeo = new THREE.IcosahedronGeometry(0.28, 1);
    const smokeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#ebe6df'),
      roughness: 0.96,
      metalness: 0.0,
      transparent: true,
      opacity: 0.42,
      depthWrite: false
    });
    this.smokeMesh = new THREE.InstancedMesh(smokeGeo, smokeMat, MAX_SMOKE_PUFFS);
    this.smokeMesh.count = MAX_SMOKE_PUFFS;
    this.smokeMesh.frustumCulled = false;
    this.smokeMesh.castShadow = false;
    this.group.add(this.smokeMesh);

    this._smokePool = Array.from({ length: MAX_SMOKE_PUFFS }, () => ({
      active: false,
      age: 0,
      life: 1,
      x: 0,
      y: -100,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      scale0: 0.4,
      rot: 0
    }));
    this._smokeCursor = 0;
    this._smokeSpawnAccum = 0;

    // 2. General tactile burst particles (build, demolish, splash, golden sparkles)
    const burstGeo = new THREE.DodecahedronGeometry(0.12, 0);
    const burstMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.68,
      metalness: 0.05
    });
    this.burstMesh = new THREE.InstancedMesh(burstGeo, burstMat, MAX_BURST_PARTICLES);
    this.burstMesh.count = MAX_BURST_PARTICLES;
    this.burstMesh.frustumCulled = false;
    this.group.add(this.burstMesh);

    this._burstPool = Array.from({ length: MAX_BURST_PARTICLES }, () => ({
      active: false,
      age: 0,
      life: 1,
      x: 0,
      y: -100,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      gravity: 0,
      scale: 0.1,
      color: new THREE.Color(0xffffff)
    }));
    this._burstCursor = 0;

    // 3. Dedicated 3D floating hearts pool for petting sheep & ducks!
    const heartGeo = createHeartGeometry();
    const heartMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color('#ff5c7c'),
      emissiveIntensity: 0.45,
      roughness: 0.45,
      metalness: 0.0
    });
    this.heartMesh = new THREE.InstancedMesh(heartGeo, heartMat, MAX_HEART_PARTICLES);
    this.heartMesh.count = MAX_HEART_PARTICLES;
    this.heartMesh.frustumCulled = false;
    this.group.add(this.heartMesh);

    this._heartPool = Array.from({ length: MAX_HEART_PARTICLES }, () => ({
      active: false,
      age: 0,
      life: 1,
      x: 0,
      y: -100,
      z: 0,
      vy: 0,
      phase: 0,
      scale: 1
    }));
    this._heartCursor = 0;

    // Initialize all pooled instances hidden safely underground with non-zero scale
    const dummy = this._dummy;
    dummy.position.set(0, -100, 0);
    dummy.scale.setScalar(0.001);
    dummy.updateMatrix();
    for (let i = 0; i < MAX_SMOKE_PUFFS; i++) this.smokeMesh.setMatrixAt(i, dummy.matrix);
    for (let i = 0; i < MAX_BURST_PARTICLES; i++) {
      this.burstMesh.setMatrixAt(i, dummy.matrix);
      this.burstMesh.setColorAt(i, this._tmpColor.setHex(0xffffff));
    }
    for (let i = 0; i < MAX_HEART_PARTICLES; i++) {
      this.heartMesh.setMatrixAt(i, dummy.matrix);
      this.heartMesh.setColorAt(i, this._tmpColor.set('#ff6b8b'));
    }
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    this.burstMesh.instanceMatrix.needsUpdate = true;
    this.heartMesh.instanceMatrix.needsUpdate = true;
  }

  emitBurst(position, kind = 'build') {
    if (!position) return;
    const px = position.x ?? 0;
    const py = position.y ?? this.terrain.getHeightAt(px, position.z ?? 0);
    const pz = position.z ?? 0;

    if (kind === 'hearts') {
      // Spawn 6 adorable floating 3D pink hearts + 10 golden star sparkles!
      for (let i = 0; i < 6; i++) {
        const h = this._heartPool[this._heartCursor];
        this._heartCursor = (this._heartCursor + 1) % MAX_HEART_PARTICLES;
        h.active = true;
        h.age = 0;
        h.life = 1.25 + Math.random() * 0.55;
        const ang = (i / 6) * Math.PI * 2 + Math.random() * 0.4;
        const r = 0.16 + Math.random() * 0.25;
        h.x = px + Math.cos(ang) * r;
        h.y = py + 0.55 + Math.random() * 0.35;
        h.z = pz + Math.sin(ang) * r;
        h.vy = 1.15 + Math.random() * 0.55;
        h.phase = Math.random() * Math.PI * 2;
        h.scale = 0.85 + Math.random() * 0.45;
      }
      for (let i = 0; i < 10; i++) {
        this._spawnParticle({
          x: px + (Math.random() - 0.5) * 0.6,
          y: py + 0.45 + Math.random() * 0.3,
          z: pz + (Math.random() - 0.5) * 0.6,
          vx: (Math.random() - 0.5) * 1.8,
          vy: 1.4 + Math.random() * 1.4,
          vz: (Math.random() - 0.5) * 1.8,
          gravity: 1.8,
          life: 0.75 + Math.random() * 0.4,
          scale: 0.45 + Math.random() * 0.35,
          hex: i % 2 === 0 ? '#ffde66' : '#ff9ebb'
        });
      }
      return;
    }

    if (kind === 'splash') {
      if (this.onWaterRipple) this.onWaterRipple(px, pz, 0.85);
      for (let i = 0; i < 20; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 0.8 + Math.random() * 2.4;
        this._spawnParticle({
          x: px + Math.cos(ang) * 0.25,
          y: Math.max(py, this.waterLevel) + 0.06,
          z: pz + Math.sin(ang) * 0.25,
          vx: Math.cos(ang) * spd,
          vy: 1.8 + Math.random() * 2.4,
          vz: Math.sin(ang) * spd,
          gravity: 7.5,
          life: 0.55 + Math.random() * 0.35,
          scale: 0.5 + Math.random() * 0.45,
          hex: i % 3 === 0 ? '#ffffff' : '#9be8ee'
        });
      }
      return;
    }

    if (kind === 'demolish') {
      const palette = ['#b8ab99', '#8c7862', '#a85c42', '#dfd7c8'];
      for (let i = 0; i < 26; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 1.1 + Math.random() * 3.4;
        this._spawnParticle({
          x: px + (Math.random() - 0.5) * 0.9,
          y: py + 0.3 + Math.random() * 0.9,
          z: pz + (Math.random() - 0.5) * 0.9,
          vx: Math.cos(ang) * spd,
          vy: 1.5 + Math.random() * 3.0,
          vz: Math.sin(ang) * spd,
          gravity: 8.2,
          life: 0.65 + Math.random() * 0.5,
          scale: 0.65 + Math.random() * 0.85,
          hex: palette[i % palette.length]
        });
      }
      return;
    }

    // Default: 'build' — soft limestone mortar puffs & golden sparkles
    const buildPalette = ['#efe8dc', '#dfd3be', '#ffe28a'];
    for (let i = 0; i < 18; i++) {
      const ang = (i / 18) * Math.PI * 2 + Math.random() * 0.3;
      const spd = 0.7 + Math.random() * 1.9;
      this._spawnParticle({
        x: px + Math.cos(ang) * 0.5,
        y: py + 0.18 + Math.random() * 0.45,
        z: pz + Math.sin(ang) * 0.5,
        vx: Math.cos(ang) * spd,
        vy: 0.85 + Math.random() * 1.45,
        vz: Math.sin(ang) * spd,
        gravity: 2.2,
        life: 0.6 + Math.random() * 0.45,
        scale: 0.6 + Math.random() * 0.65,
        hex: buildPalette[i % buildPalette.length]
      });
    }
  }

  _spawnParticle({ x, y, z, vx, vy, vz, gravity, life, scale, hex }) {
    const idx = this._burstCursor;
    this._burstCursor = (this._burstCursor + 1) % MAX_BURST_PARTICLES;
    const p = this._burstPool[idx];
    p.active = true;
    p.age = 0;
    p.life = life;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.gravity = gravity;
    p.scale = scale;
    p.color.set(hex);
    this.burstMesh.setColorAt(idx, p.color);
    if (this.burstMesh.instanceColor) this.burstMesh.instanceColor.needsUpdate = true;
  }

  interactCreature(raycaster) {
    if (!raycaster || !raycaster.ray) return null;
    const ray = raycaster.ray;
    let bestHit = null;
    let bestDist = Infinity;

    // 1. Check fluffy sheep (generous 1.05m hit sphere so clicking sheep feels effortless)
    for (let i = 0; i < this.sheepList.length; i++) {
      const s = this.sheepList[i];
      this._tmpVec.set(s.x, s.y + 0.45 * s.scale, s.z);
      const distSq = ray.distanceSqToPoint(this._tmpVec);
      if (distSq <= 1.15 * 1.15) {
        const camDist = ray.origin.distanceTo(this._tmpVec);
        if (camDist < bestDist) {
          bestDist = camDist;
          bestHit = { kind: 'sheep', obj: s };
        }
      }
    }

    // 2. Check gliding pond ducks
    for (let i = 0; i < this.ducks.length; i++) {
      const d = this.ducks[i];
      if (!d.active || !d.root.visible) continue;
      this._tmpVec.set(d.x, this.waterLevel + 0.2, d.z);
      const distSq = ray.distanceSqToPoint(this._tmpVec);
      if (distSq <= 0.95 * 0.95) {
        const camDist = ray.origin.distanceTo(this._tmpVec);
        if (camDist < bestDist) {
          bestDist = camDist;
          bestHit = { kind: 'duck', obj: d };
        }
      }
    }

    if (!bestHit) return null;

    if (bestHit.kind === 'sheep') {
      const s = bestHit.obj;
      s.state = 'joy';
      s.joyTimer = 1.25;
      s.joyStartYaw = s.yaw;
      const pos = new THREE.Vector3(s.x, s.y + 0.4, s.z);
      this.emitBurst(pos, 'hearts');
      return { type: 'sheep', position: pos };
    }

    const d = bestHit.obj;
    d.joyTimer = 1.0;
    const pos = new THREE.Vector3(d.x, this.waterLevel + 0.25, d.z);
    if (this.onWaterRipple) this.onWaterRipple(d.x, d.z, 0.85);
    this.emitBurst(pos, 'hearts');
    return { type: 'duck', position: pos };
  }

  setQuality(tier) {
    const q = String(tier || 'ultra').toLowerCase();
    this.quality = q;
    const castSheep = q !== 'balanced';
    for (const s of this.sheepList) {
      s.bodyMesh.castShadow = castSheep;
      s.legsMesh.castShadow = castSheep;
    }
  }

  update(dt, elapsed, envState = {}, chimneyPositions = []) {
    const clampedDt = clamp(dt, 0.001, 0.1);
    const nightFactor = envState.nightFactor ?? 0;
    const windStrength = envState.windStrength ?? 0.55;

    this._updateSheep(clampedDt, elapsed);
    this._updatePondDucks(clampedDt, elapsed);
    this._updateSkyAndFireflies(clampedDt, elapsed, nightFactor);
    this._updateSmokeAndBursts(clampedDt, elapsed, windStrength, chimneyPositions);
  }

  _updateSheep(dt, elapsed) {
    for (let i = 0; i < this.sheepList.length; i++) {
      const s = this.sheepList[i];
      const groundY = this.terrain.getHeightAt(s.x, s.z);
      s.y = groundY;

      if (s.joyTimer > 0) {
        s.joyTimer = Math.max(0, s.joyTimer - dt);
        const u = 1.0 - s.joyTimer / 1.25;
        // Joyful parabolic hop + 360 happy spin + wiggle!
        const hopH = Math.sin(Math.min(1, u * 1.15) * Math.PI) * 0.88;
        s.yaw = s.joyStartYaw + Math.sin(u * Math.PI * 0.5) * Math.PI * 2;
        s.headPivot.rotation.set(-0.22, Math.sin(elapsed * 18) * 0.25, 0);
        s.root.position.set(s.x, groundY + Math.max(0, hopH), s.z);
        s.root.rotation.set(0, s.yaw, Math.sin(u * Math.PI * 4) * 0.12);
        if (s.joyTimer === 0) {
          s.state = 'idle';
          s.stateTimer = 1.5;
        }
        continue;
      }

      // If building or pond was just placed under this sheep, step safely aside
      if (!this._isSafeSheepSpot(s.x, s.z)) {
        this.regroundAndSafePlaceSheep();
      }

      s.stateTimer -= dt;
      if (s.stateTimer <= 0) {
        const roll = Math.random();
        if (roll < 0.45) {
          s.state = 'graze';
          s.stateTimer = 2.6 + Math.random() * 3.4;
        } else if (roll < 0.65) {
          s.state = 'idle';
          s.stateTimer = 1.4 + Math.random() * 2.0;
        } else {
          // Pick a nearby sunlit meadow waypoint
          let picked = false;
          for (let attempt = 0; attempt < 8; attempt++) {
            const ang = s.yaw + (Math.random() - 0.5) * 2.4;
            const dist = 2.5 + Math.random() * 5.5;
            const nx = s.x + Math.cos(ang) * dist;
            const nz = s.z + Math.sin(ang) * dist;
            if (this._isSafeSheepSpot(nx, nz)) {
              s.targetX = nx;
              s.targetZ = nz;
              s.state = 'walk';
              s.stateTimer = 4.5;
              picked = true;
              break;
            }
          }
          if (!picked) {
            s.state = 'graze';
            s.stateTimer = 2.0;
          }
        }
      }

      let bounceY = 0;
      let rollZ = 0;

      if (s.state === 'walk') {
        const dx = s.targetX - s.x;
        const dz = s.targetZ - s.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.35) {
          s.state = 'graze';
          s.stateTimer = 2.8 + Math.random() * 2.5;
        } else {
          const desiredYaw = Math.atan2(dx, dz);
          let diff = desiredYaw - s.yaw;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          s.yaw += diff * Math.min(1, dt * 4.5);

          const speed = 0.92;
          const stepX = s.x + Math.sin(s.yaw) * speed * dt;
          const stepZ = s.z + Math.cos(s.yaw) * speed * dt;

          if (this._isSafeSheepSpot(stepX, stepZ)) {
            s.x = stepX;
            s.z = stepZ;
            s.stridePhase += dt * 9.5;
            bounceY = Math.abs(Math.sin(s.stridePhase)) * 0.065;
            rollZ = Math.sin(s.stridePhase) * 0.055;
            s.headPivot.rotation.set(0.08 + Math.sin(s.stridePhase * 2) * 0.06, 0, 0);
          } else {
            s.yaw += 1.1;
            s.state = 'idle';
            s.stateTimer = 1.0;
          }
        }
      } else if (s.state === 'graze') {
        // Head lowered nibbling grass with gentle chew motion
        const nibble = Math.sin(elapsed * 7.5 + i * 2.1) * 0.06;
        s.headPivot.rotation.set(0.62 + nibble, Math.sin(elapsed * 1.4 + i) * 0.14, 0);
      } else {
        // Idle looking peacefully around the glade
        s.headPivot.rotation.set(-0.08, Math.sin(elapsed * 1.6 + i * 1.9) * 0.32, 0);
      }

      s.y = this.terrain.getHeightAt(s.x, s.z);
      s.root.position.set(s.x, s.y + bounceY, s.z);
      s.root.rotation.set(0, s.yaw, rollZ);
    }
  }

  _updatePondDucks(dt, elapsed) {
    this._duckScanTimer -= dt;
    if (this._duckScanTimer <= 0) {
      this._duckScanTimer = 1.6;
      this.refreshPondDucks();
    }

    for (let i = 0; i < this.ducks.length; i++) {
      const d = this.ducks[i];
      if (!d.active || !d.root.visible) continue;

      let joyHop = 0;
      if (d.joyTimer > 0) {
        d.joyTimer = Math.max(0, d.joyTimer - dt);
        const u = 1.0 - d.joyTimer;
        joyHop = Math.sin(u * Math.PI) * 0.42;
        d.yaw += dt * 5.5;
      } else {
        d.yaw += Math.sin(elapsed * 0.55 + i * 2.1) * 0.35 * dt;
      }

      const nx = d.x + Math.sin(d.yaw) * d.speed * dt;
      const nz = d.z + Math.cos(d.yaw) * d.speed * dt;
      const nextH = this.terrain.getHeightAt(nx, nz);

      if (nextH < this.waterLevel - 0.22 && Math.hypot(nx, nz) < 53) {
        d.x = nx;
        d.z = nz;
      } else {
        // Gracefully curve back into deeper pond water
        d.yaw += 1.65 + Math.random() * 0.8;
      }

      const bob = Math.sin(elapsed * 2.6 + i * 1.7) * 0.018;
      d.root.position.set(d.x, this.waterLevel - 0.02 + bob + joyHop, d.z);
      d.root.rotation.set(Math.sin(elapsed * 2.2 + i) * 0.03, d.yaw, Math.cos(elapsed * 1.9 + i) * 0.035);

      d.rippleTimer -= dt;
      if (d.rippleTimer <= 0) {
        d.rippleTimer = 0.65 + (i % 3) * 0.15;
        if (this.onWaterRipple) {
          this.onWaterRipple(d.x, d.z, 0.4);
        }
      }
    }
  }

  _updateSkyAndFireflies(dt, elapsed, nightFactor) {
    this.butterflyMat.userData.uniforms.uTime.value = elapsed;
    this.birdMat.userData.uniforms.uTime.value = elapsed;

    const dayScale = clamp(1.0 - smoothstep(0.28, 0.55, nightFactor), 0, 1);
    const dummy = this._dummy;

    // 1. Daytime meadow butterflies
    this.butterflyMesh.visible = dayScale > 0.02;
    if (this.butterflyMesh.visible) {
      const activeCount = this.quality === 'balanced' ? Math.floor(BUTTERFLY_COUNT * 0.5) : BUTTERFLY_COUNT;
      this.butterflyMesh.count = activeCount;
      for (let i = 0; i < activeCount; i++) {
        const b = this._butterflies[i];
        const t = elapsed * b.speed + b.phase;
        const x = b.cx + Math.sin(t) * b.rx;
        const z = b.cz + Math.sin(t * 2.0) * b.rz;
        const dx = Math.cos(t) * b.rx;
        const dz = Math.cos(t * 2.0) * 2.0 * b.rz;
        const baseH = Math.max(this.terrain.getHeightAt(x, z), this.waterLevel);
        const y = baseH + 0.65 + Math.sin(elapsed * 3.1 + b.phase) * 0.32;

        dummy.position.set(x, y, z);
        dummy.rotation.set(0, Math.atan2(dx, dz), 0);
        dummy.scale.setScalar((0.85 + (i % 3) * 0.2) * dayScale);
        dummy.updateMatrix();
        this.butterflyMesh.setMatrixAt(i, dummy.matrix);
      }
      this.butterflyMesh.instanceMatrix.needsUpdate = true;
    }

    // 2. Circling daytime songbirds
    this.birdMesh.visible = dayScale > 0.02;
    if (this.birdMesh.visible) {
      for (let i = 0; i < BIRD_COUNT; i++) {
        const bd = this._birds[i];
        const ang = elapsed * bd.speed + bd.phase;
        const x = bd.cx + Math.cos(ang) * bd.orbitR;
        const z = bd.cz + Math.sin(ang) * bd.orbitR;
        const y = bd.alt + Math.sin(ang * 2.0 + i) * 1.4;
        const tangentYaw = Math.atan2(-Math.sin(ang), Math.cos(ang));

        dummy.position.set(x, y, z);
        dummy.rotation.set(0, tangentYaw, -0.22); // banked turn!
        dummy.scale.setScalar(dayScale);
        dummy.updateMatrix();
        this.birdMesh.setMatrixAt(i, dummy.matrix);
      }
      this.birdMesh.instanceMatrix.needsUpdate = true;
    }

    // 3. Magical warm fireflies at dusk & night (nightFactor > 0.30)
    const ffVis = smoothstep(0.30, 0.56, nightFactor);
    this.fireflyUniforms.uVisibility.value = ffVis;
    this.fireflyUniforms.uTime.value = elapsed;
    this.fireflyUniforms.uPixelRatio.value =
      typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    this.fireflyPoints.visible = ffVis > 0.01;

    if (this.fireflyPoints.visible) {
      const arr = this._ffPosAttr.array;
      for (let i = 0; i < FIREFLY_COUNT; i++) {
        const a = this._fireflyAnchors[i];
        const wx = a.ax + Math.sin(elapsed * 0.48 + a.phase) * 1.45;
        const wz = a.az + Math.cos(elapsed * 0.41 + a.phase * 1.3) * 1.45;
        const surfaceY = Math.max(this.terrain.getHeightAt(wx, wz), this.waterLevel);
        const wy = surfaceY + 0.42 + (0.5 + 0.5 * Math.sin(elapsed * 0.9 + a.phase)) * 1.35;
        arr[i * 3] = wx;
        arr[i * 3 + 1] = wy;
        arr[i * 3 + 2] = wz;
      }
      this._ffPosAttr.needsUpdate = true;
    }
  }

  _updateSmokeAndBursts(dt, elapsed, windStrength, chimneyPositions) {
    const dummy = this._dummy;

    // 1. Spawn gentle chimney smoke puffs
    if (Array.isArray(chimneyPositions) && chimneyPositions.length > 0) {
      this._smokeSpawnAccum += dt * chimneyPositions.length * 4.5;
      while (this._smokeSpawnAccum >= 1.0) {
        this._smokeSpawnAccum -= 1.0;
        const src = chimneyPositions[Math.floor(Math.random() * chimneyPositions.length)];
        if (src) {
          const sp = this._smokePool[this._smokeCursor];
          this._smokeCursor = (this._smokeCursor + 1) % MAX_SMOKE_PUFFS;
          sp.active = true;
          sp.age = 0;
          sp.life = 2.8 + Math.random() * 1.4;
          sp.x = (src.x ?? 0) + (Math.random() - 0.5) * 0.14;
          sp.y = (src.y ?? 3) + 0.08;
          sp.z = (src.z ?? 0) + (Math.random() - 0.5) * 0.14;
          sp.vx = (0.32 + windStrength * 0.55) + (Math.random() - 0.5) * 0.18;
          sp.vy = 0.72 + Math.random() * 0.28;
          sp.vz = (0.22 + windStrength * 0.35) + (Math.random() - 0.5) * 0.18;
          sp.scale0 = 0.35 + Math.random() * 0.25;
          sp.rot = Math.random() * Math.PI * 2;
        }
      }
    }

    let smokeDirty = false;
    for (let i = 0; i < MAX_SMOKE_PUFFS; i++) {
      const sp = this._smokePool[i];
      if (!sp.active) continue;
      smokeDirty = true;
      sp.age += dt;
      if (sp.age >= sp.life) {
        sp.active = false;
        dummy.position.set(0, -100, 0);
        dummy.scale.setScalar(0.001);
        dummy.updateMatrix();
        this.smokeMesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      const u = sp.age / sp.life;
      sp.x += (sp.vx + Math.sin(elapsed * 1.8 + i) * 0.14) * dt;
      sp.y += sp.vy * (1.0 - u * 0.35) * dt;
      sp.z += (sp.vz + Math.cos(elapsed * 1.5 + i) * 0.14) * dt;

      const grow = Math.sin(Math.min(1, u * 4.5) * Math.PI * 0.5);
      const fade = 1.0 - smoothstep(0.55, 1.0, u);
      const s = Math.max(0.001, sp.scale0 * (0.65 + u * 2.15) * grow * fade);
      dummy.position.set(sp.x, sp.y, sp.z);
      dummy.rotation.set(sp.rot + u * 1.2, sp.rot * 0.7, u * 0.8);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      this.smokeMesh.setMatrixAt(i, dummy.matrix);
    }
    if (smokeDirty) this.smokeMesh.instanceMatrix.needsUpdate = true;

    // 2. Update action burst particles
    let burstDirty = false;
    for (let i = 0; i < MAX_BURST_PARTICLES; i++) {
      const p = this._burstPool[i];
      if (!p.active) continue;
      burstDirty = true;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        dummy.position.set(0, -100, 0);
        dummy.scale.setScalar(0.001);
        dummy.updateMatrix();
        this.burstMesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      const floorY = Math.max(this.terrain.getHeightAt(p.x, p.z), this.waterLevel);
      if (p.y < floorY + 0.04 && p.vy < 0) {
        p.y = floorY + 0.04;
        p.vy *= -0.35;
        p.vx *= 0.65;
        p.vz *= 0.65;
      }

      const u = p.age / p.life;
      const s = Math.max(0.001, p.scale * (1.0 - smoothstep(0.45, 1.0, u)));
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(p.age * 4.0, p.age * 3.0, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      this.burstMesh.setMatrixAt(i, dummy.matrix);
    }
    if (burstDirty) this.burstMesh.instanceMatrix.needsUpdate = true;

    // 3. Update floating 3D hearts
    let heartDirty = false;
    for (let i = 0; i < MAX_HEART_PARTICLES; i++) {
      const h = this._heartPool[i];
      if (!h.active) continue;
      heartDirty = true;
      h.age += dt;
      if (h.age >= h.life) {
        h.active = false;
        dummy.position.set(0, -100, 0);
        dummy.scale.setScalar(0.001);
        dummy.updateMatrix();
        this.heartMesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      const u = h.age / h.life;
      h.y += h.vy * (1.0 - u * 0.45) * dt;
      const pop = smoothstep(0.0, 0.18, u) * (1.0 - smoothstep(0.68, 1.0, u));
      dummy.position.set(
        h.x + Math.sin(elapsed * 4.5 + h.phase) * 0.12,
        h.y,
        h.z + Math.cos(elapsed * 4.0 + h.phase) * 0.12
      );
      dummy.rotation.set(0, elapsed * 2.2 + h.phase, Math.sin(elapsed * 5.0 + h.phase) * 0.18);
      dummy.scale.setScalar(Math.max(0.001, h.scale * pop));
      dummy.updateMatrix();
      this.heartMesh.setMatrixAt(i, dummy.matrix);
    }
    if (heartDirty) this.heartMesh.instanceMatrix.needsUpdate = true;
  }

  refreshFireflyAnchors() {
    if (!this._fireflyAnchors) return;
    // Gather pond/shoreline spots & open meadow spots inside central diorama [-26, 26]
    const waterSpots = [];
    const meadowSpots = [];
    for (let z = -24; z <= 26; z += 2.6) {
      for (let x = -25; x <= 25; x += 2.6) {
        const h = this.terrain.getHeightAt(x, z);
        if (h < this.waterLevel + 0.25) {
          waterSpots.push({ x, z });
        } else if (!this.terrain.isPointBlockedByFootprint(x, z, 0.8)) {
          meadowSpots.push({ x, z });
        }
      }
    }

    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const a = this._fireflyAnchors[i];
      const jitterX = Math.sin(i * 12.9898) * 1.25;
      const jitterZ = Math.cos(i * 78.233) * 1.25;
      if (i % 2 === 0 && waterSpots.length > 0) {
        const ws = waterSpots[(i * 7 + 3) % waterSpots.length];
        a.ax = ws.x + jitterX;
        a.az = ws.z + jitterZ;
      } else if (meadowSpots.length > 0) {
        const ms = meadowSpots[(i * 11 + 5) % meadowSpots.length];
        a.ax = ms.x + jitterX;
        a.az = ms.z + jitterZ;
      }
    }
  }

  onWorldModified() {
    this.regroundAndSafePlaceSheep();
    this.refreshPondDucks();
    this.refreshFireflyAnchors();
  }

  dispose() {
    this.scene.remove(this.group);
    this._sheepGeos.forEach((g) => g.dispose());
    this._duckGeos.forEach((g) => g.dispose());
    this.woolMat.dispose();
    this.woolWarmMat.dispose();
    this.darkLimbMat.dispose();
    this.group.traverse((obj) => {
      if (obj.isMesh || obj.isPoints) {
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material?.dispose();
      }
    });
  }
}
