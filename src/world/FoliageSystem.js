import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const GRASS_COUNTS = {
  ultra: 65000,
  high: 35000,
  balanced: 16000
};
const MAX_GRASS = GRASS_COUNTS.ultra;
const GRASS_GRID_DIM = 32;

const MAX_FLOWERS = 4800;
const MAX_LILIES = 520;
const MAX_REEDS = 780;
const MAX_TREES_PER_TYPE = 220;
const MAX_BUSHES = 420;
const MAX_BOULDERS = 300;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function fract(x) {
  return x - Math.floor(x);
}

function seededRand(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

// Lush 3-blade splayed meadow tuft (each blade curved in 3 segments -> velvety overlapping carpet)
function createGrassBladeGeometry() {
  const segs = 3;
  const tuftBlades = [
    { yaw: 0.0, offsetR: 0.055, height: 0.37, width: 0.072, lean: 0.16 },
    { yaw: 2.12, offsetR: 0.075, height: 0.32, width: 0.068, lean: 0.21 },
    { yaw: 4.24, offsetR: 0.070, height: 0.28, width: 0.065, lean: 0.19 }
  ];

  const positions = [];
  const normals = [];
  const heightFracs = [];
  const indices = [];

  for (let b = 0; b < tuftBlades.length; b++) {
    const tb = tuftBlades[b];
    const cy = Math.cos(tb.yaw);
    const sy = Math.sin(tb.yaw);
    const ox = sy * tb.offsetR;
    const oz = cy * tb.offsetR;
    const vBase = positions.length / 3;

    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      const w = tb.width * (1.0 - t * 0.68);
      const y = tb.height * t;
      const arc = tb.height * t * t * (0.28 + tb.lean);
      const camberZ = w * 0.18;

      const lx0 = -w * 0.5;
      const lz0 = arc + camberZ;
      positions.push(ox + lx0 * cy + lz0 * sy, y, oz - lx0 * sy + lz0 * cy);
      normals.push(0, 1, 0);
      heightFracs.push(t);

      const lx1 = w * 0.5;
      const lz1 = arc + camberZ;
      positions.push(ox + lx1 * cy + lz1 * sy, y, oz - lx1 * sy + lz1 * cy);
      normals.push(0, 1, 0);
      heightFracs.push(t);
    }

    const tipArc = tb.height * (0.30 + tb.lean);
    positions.push(ox + tipArc * sy, tb.height, oz + tipArc * cy);
    normals.push(0, 1, 0);
    heightFracs.push(1.0);

    for (let i = 0; i < segs - 1; i++) {
      const l0 = vBase + i * 2;
      const r0 = l0 + 1;
      const l1 = l0 + 2;
      const r1 = l0 + 3;
      indices.push(l0, r0, l1);
      indices.push(r0, r1, l1);
    }
    const lastL = vBase + (segs - 1) * 2;
    const lastR = lastL + 1;
    const tip = vBase + segs * 2;
    indices.push(lastL, lastR, tip);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('aHeightFrac', new THREE.Float32BufferAttribute(heightFracs, 1));
  geo.setIndex(indices);
  return geo;
}

function tagPartAttribute(geo, partType, aoVal = 1.0) {
  const nonIdx = geo.index ? geo.toNonIndexed() : geo.clone();
  if (geo !== nonIdx) geo.dispose();
  const count = nonIdx.attributes.position.count;
  const partArr = new Float32Array(count);
  const aoArr = new Float32Array(count);
  partArr.fill(partType);
  aoArr.fill(aoVal);
  nonIdx.setAttribute('aPartMask', new THREE.BufferAttribute(partArr, 1));
  nonIdx.setAttribute('aLocalAO', new THREE.BufferAttribute(aoArr, 1));
  // Ensure UV exists for clean merging
  if (!nonIdx.attributes.uv) {
    nonIdx.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  return nonIdx;
}

// Wildflower cluster: 3 slender stems + basal leaves (part 0), 3 5-petal flower heads (part 1), sunny centers (part 2)
function createWildflowerClusterGeometry() {
  const parts = [];
  const offsets = [
    { x: 0.0, z: 0.0, h: 0.34, tiltX: 0.08, tiltZ: -0.05, scale: 1.0 },
    { x: 0.12, z: 0.08, h: 0.27, tiltX: -0.14, tiltZ: 0.12, scale: 0.86 },
    { x: -0.11, z: 0.07, h: 0.24, tiltX: 0.12, tiltZ: 0.14, scale: 0.8 }
  ];

  for (let s = 0; s < offsets.length; s++) {
    const o = offsets[s];
    // Stem
    const stem = new THREE.CylinderGeometry(0.008, 0.013, o.h, 4, 1);
    stem.translate(0, o.h * 0.5, 0);
    stem.rotateX(o.tiltX);
    stem.rotateZ(o.tiltZ);
    stem.translate(o.x, 0, o.z);
    parts.push(tagPartAttribute(stem, 0.0, 0.78));

    const headY = o.h * Math.cos(o.tiltX) * Math.cos(o.tiltZ);
    const headX = o.x - Math.sin(o.tiltZ) * o.h * 0.9;
    const headZ = o.z + Math.sin(o.tiltX) * o.h * 0.9;

    // 5 petals arranged radially
    const petalCount = 5;
    for (let p = 0; p < petalCount; p++) {
      const ang = (p / petalCount) * Math.PI * 2 + s * 0.7;
      const petal = new THREE.CircleGeometry(0.042 * o.scale, 5);
      petal.scale(0.78, 1.25, 1.0);
      petal.rotateX(-Math.PI * 0.42);
      petal.translate(0, 0.004, 0.044 * o.scale);
      petal.rotateY(ang);
      petal.translate(headX, headY, headZ);
      parts.push(tagPartAttribute(petal, 1.0, 1.0));
    }

    // Golden pollen center
    const center = new THREE.SphereGeometry(0.022 * o.scale, 5, 4);
    center.scale(1, 0.65, 1);
    center.translate(headX, headY + 0.008, headZ);
    parts.push(tagPartAttribute(center, 2.0, 1.0));
  }

  // Basal leaf blades
  for (let l = 0; l < 3; l++) {
    const ang = (l / 3) * Math.PI * 2 + 0.4;
    const leaf = new THREE.ConeGeometry(0.032, 0.18, 3);
    leaf.scale(1.0, 1.0, 0.35);
    leaf.translate(0, 0.09, 0);
    leaf.rotateX(0.55);
    leaf.rotateY(ang);
    parts.push(tagPartAttribute(leaf, 0.0, 0.65));
  }

  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  return merged;
}

// Notched water lily pad + lotus blossom (part 0 = green pad, part 1 = lotus petals)
function createLilyPadGeometry(withFlower = true) {
  const parts = [];
  // Notched pac-man lily pad disc (~330 degrees)
  const pad = new THREE.CylinderGeometry(0.32, 0.30, 0.014, 14, 1, false, 0.25, Math.PI * 2 - 0.5);
  pad.translate(0, 0.007, 0);
  parts.push(tagPartAttribute(pad, 0.0, 0.92));

  if (withFlower) {
    for (let p = 0; p < 6; p++) {
      const ang = (p / 6) * Math.PI * 2;
      const petal = new THREE.ConeGeometry(0.034, 0.11, 4);
      petal.scale(0.9, 1.0, 0.45);
      petal.translate(0, 0.055, 0);
      petal.rotateX(0.52);
      petal.rotateY(ang);
      petal.translate(0.02, 0.012, 0.01);
      parts.push(tagPartAttribute(petal, 1.0, 1.0));
    }
    const core = new THREE.SphereGeometry(0.025, 5, 4);
    core.translate(0.02, 0.035, 0.01);
    parts.push(tagPartAttribute(core, 2.0, 1.0));
  }

  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  return merged;
}

// Shoreline cattail reed cluster (part 0 = marsh blades/stems, part 1 = velvety brown cattail spikes)
function createCattailClusterGeometry() {
  const parts = [];
  const stalks = [
    { x: 0.0, z: 0.0, h: 1.18, tiltX: 0.05, tiltZ: -0.04, hasHead: true },
    { x: 0.13, z: 0.07, h: 1.02, tiltX: -0.08, tiltZ: 0.09, hasHead: true },
    { x: -0.11, z: 0.09, h: 0.92, tiltX: 0.14, tiltZ: 0.11, hasHead: false },
    { x: 0.07, z: -0.12, h: 0.84, tiltX: -0.15, tiltZ: -0.1, hasHead: false },
    { x: -0.09, z: -0.08, h: 0.76, tiltX: 0.11, tiltZ: -0.14, hasHead: false }
  ];

  for (let i = 0; i < stalks.length; i++) {
    const s = stalks[i];
    if (s.hasHead) {
      const stem = new THREE.CylinderGeometry(0.012, 0.018, s.h, 5, 1);
      stem.translate(0, s.h * 0.5, 0);
      stem.rotateX(s.tiltX);
      stem.rotateZ(s.tiltZ);
      stem.translate(s.x, 0, s.z);
      parts.push(tagPartAttribute(stem, 0.0, 0.8));

      const head = new THREE.CapsuleGeometry(0.034, 0.19, 4, 6);
      head.translate(0, s.h * 0.82, 0);
      head.rotateX(s.tiltX);
      head.rotateZ(s.tiltZ);
      head.translate(s.x, 0, s.z);
      parts.push(tagPartAttribute(head, 1.0, 0.92));
    } else {
      const blade = new THREE.ConeGeometry(0.028, s.h, 3);
      blade.scale(1.0, 1.0, 0.32);
      blade.translate(0, s.h * 0.5, 0);
      blade.rotateX(s.tiltX);
      blade.rotateZ(s.tiltZ);
      blade.translate(s.x, 0, s.z);
      parts.push(tagPartAttribute(blade, 0.0, 0.75));
    }
  }

  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  return merged;
}

// Gnarled tapered tree trunk + forked upper branches
function createTreeTrunkGeometry(archetype = 'oak') {
  const parts = [];
  if (archetype === 'oak') {
    const trunkH = 2.35;
    const trunk = new THREE.CylinderGeometry(0.19, 0.38, trunkH, 7, 4);
    const pos = trunk.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = clamp(y / trunkH + 0.5, 0, 1);
      // Organic root flare at base + gentle S-curve gnarl
      const flare = Math.pow(1.0 - t, 3.0) * 0.35;
      const swayX = Math.sin(t * Math.PI * 1.3) * 0.11;
      const swayZ = Math.cos(t * Math.PI * 1.1) * 0.08;
      pos.setX(i, pos.getX(i) * (1 + flare) + swayX);
      pos.setZ(i, pos.getZ(i) * (1 + flare) + swayZ);
    }
    trunk.computeVertexNormals();
    trunk.translate(0, trunkH * 0.5 - 0.12, 0);
    parts.push(trunk.toNonIndexed());
    trunk.dispose();

    // 3 supporting boughs reaching up into the multi-puff crown
    const boughs = [
      { ang: 0.3, tilt: 0.58, len: 1.35, y: 1.85, r: 0.12 },
      { ang: 2.35, tilt: 0.52, len: 1.25, y: 1.95, r: 0.11 },
      { ang: 4.35, tilt: 0.62, len: 1.15, y: 1.78, r: 0.1 }
    ];
    for (const b of boughs) {
      const bGeo = new THREE.CylinderGeometry(b.r * 0.45, b.r, b.len, 5, 1);
      bGeo.translate(0, b.len * 0.5, 0);
      bGeo.rotateZ(b.tilt);
      bGeo.rotateY(b.ang);
      bGeo.translate(0, b.y, 0);
      parts.push(bGeo.toNonIndexed());
      bGeo.dispose();
    }
  } else {
    // Tall slender birch / woodland spire trunk
    const trunkH = 3.1;
    const trunk = new THREE.CylinderGeometry(0.11, 0.26, trunkH, 7, 4);
    const pos = trunk.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = clamp(y / trunkH + 0.5, 0, 1);
      const flare = Math.pow(1.0 - t, 3.0) * 0.28;
      pos.setX(i, pos.getX(i) * (1 + flare) + Math.sin(t * 3.0) * 0.07);
      pos.setZ(i, pos.getZ(i) * (1 + flare) + Math.cos(t * 2.4) * 0.05);
    }
    trunk.computeVertexNormals();
    trunk.translate(0, trunkH * 0.5 - 0.12, 0);
    parts.push(trunk.toNonIndexed());
    trunk.dispose();
  }

  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  return merged;
}

// Ghibli / Tiny Glade multi-puff canopy with spherical-puff normal remapping + inner AO!
function createFluffyCanopyGeometry(archetype = 'oak') {
  const puffs = [];
  let crownCenterY = 3.3;

  if (archetype === 'oak') {
    crownCenterY = 3.35;
    // Central upper dome + billowing outer leaf puffs
    puffs.push({ x: 0.0, y: 3.85, z: 0.0, r: 1.25 });
    puffs.push({ x: 0.45, y: 3.55, z: 0.35, r: 1.08 });
    puffs.push({ x: -0.48, y: 3.6, z: 0.28, r: 1.05 });
    puffs.push({ x: 0.12, y: 3.52, z: -0.52, r: 1.08 });

    // Mid ring of 8 lush billowing puffs
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const rad = 1.05 + (i % 2) * 0.22;
      puffs.push({
        x: Math.cos(a) * rad,
        y: 3.05 + ((i * 3) % 4) * 0.14,
        z: Math.sin(a) * rad,
        r: 0.88 + (i % 3) * 0.1
      });
    }
    // Lower skirt accents (7 puffs)
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.55;
      const rad = 1.28 + (i % 2) * 0.15;
      puffs.push({
        x: Math.cos(a) * rad,
        y: 2.58 + (i % 3) * 0.12,
        z: Math.sin(a) * rad,
        r: 0.72 + (i % 2) * 0.09
      });
    }
  } else {
    // Tall tiered woodland spire / birch-pine crown (18 puffs)
    crownCenterY = 3.6;
    const tiers = [
      { y: 2.15, ringR: 1.02, puffR: 0.76, count: 6, phase: 0.0 },
      { y: 3.05, ringR: 0.78, puffR: 0.70, count: 5, phase: 0.55 },
      { y: 3.85, ringR: 0.52, puffR: 0.62, count: 4, phase: 1.1 },
      { y: 4.55, ringR: 0.24, puffR: 0.52, count: 2, phase: 0.3 }
    ];
    for (const tier of tiers) {
      for (let i = 0; i < tier.count; i++) {
        const a = (i / tier.count) * Math.PI * 2 + tier.phase;
        puffs.push({
          x: Math.cos(a) * tier.ringR,
          y: tier.y + (i % 2) * 0.12,
          z: Math.sin(a) * tier.ringR,
          r: tier.puffR
        });
      }
    }
    puffs.push({ x: 0.0, y: 5.05, z: 0.0, r: 0.48 });
  }

  return buildPuffClusterGeometry(puffs, new THREE.Vector3(0, crownCenterY, 0));
}

function createBushGeometry() {
  const puffs = [
    { x: 0.0, y: 0.52, z: 0.0, r: 0.52 },
    { x: 0.36, y: 0.38, z: 0.18, r: 0.42 },
    { x: -0.35, y: 0.40, z: 0.22, r: 0.40 },
    { x: 0.14, y: 0.36, z: -0.36, r: 0.43 },
    { x: -0.22, y: 0.34, z: -0.30, r: 0.38 },
    { x: 0.42, y: 0.28, z: -0.15, r: 0.34 },
    { x: -0.40, y: 0.28, z: 0.02, r: 0.35 }
  ];
  return buildPuffClusterGeometry(puffs, new THREE.Vector3(0, 0.36, 0));
}

function buildPuffClusterGeometry(puffs, clusterCenter) {
  const geoParts = [];
  const tmpPos = new THREE.Vector3();
  const puffCenter = new THREE.Vector3();
  const puffDir = new THREE.Vector3();
  const crownDir = new THREE.Vector3();
  const finalNorm = new THREE.Vector3();

  for (let p = 0; p < puffs.length; p++) {
    const pf = puffs[p];
    puffCenter.set(pf.x, pf.y, pf.z);
    const base = new THREE.IcosahedronGeometry(pf.r, 1);
    const nonIdx = base.index ? base.toNonIndexed() : base;
    if (nonIdx !== base) base.dispose();

    const posAttr = nonIdx.attributes.position;
    const normAttr = nonIdx.attributes.normal;
    const aoArr = new Float32Array(posAttr.count);
    const swayArr = new Float32Array(posAttr.count);

    for (let i = 0; i < posAttr.count; i++) {
      tmpPos.fromBufferAttribute(posAttr, i);
      // Organic crinkled leaf-clump silhouette displacement (deterministic from direction so shared vertices stay welded!)
      const nx = tmpPos.x / pf.r;
      const ny = tmpPos.y / pf.r;
      const nz = tmpPos.z / pf.r;
      const lobe =
        1.0 +
        0.13 * Math.sin(nx * 4.7 + p * 1.7) * Math.cos(nz * 4.3 - p * 0.9) +
        0.08 * Math.sin(ny * 5.9 + nx * 3.1);
      // Slightly flatten bottom of puff for cozy Ghibli cloud layering
      const squashY = ny < 0 ? 0.84 : 0.96;
      tmpPos.set(tmpPos.x * lobe + pf.x, tmpPos.y * lobe * squashY + pf.y, tmpPos.z * lobe + pf.z);
      posAttr.setXYZ(i, tmpPos.x, tmpPos.y, tmpPos.z);

      // Spherical-puff normal remapping blended with overall crown normal + subtle leaf bump!
      puffDir.subVectors(tmpPos, puffCenter).normalize();
      crownDir.subVectors(tmpPos, clusterCenter).normalize();
      finalNorm
        .copy(crownDir)
        .lerp(puffDir, 0.65)
        .addScaledVector(
          new THREE.Vector3(
            Math.sin(tmpPos.x * 9.3 + tmpPos.z * 5.1),
            Math.cos(tmpPos.y * 8.7),
            Math.sin(tmpPos.z * 9.1 - tmpPos.x * 4.7)
          ),
          0.14
        )
        .normalize();
      normAttr.setXYZ(i, finalNorm.x, finalNorm.y, finalNorm.z);

      // Soft ambient occlusion tucked inside lower/inner canopy
      const heightFactor = clamp((tmpPos.y - (clusterCenter.y - 1.1)) / 2.4, 0, 1);
      const radialFactor = clamp(tmpPos.distanceTo(clusterCenter) / 1.9, 0, 1);
      aoArr[i] = clamp(0.46 + 0.34 * heightFactor + 0.26 * radialFactor, 0.42, 1.05);
      swayArr[i] = clamp(tmpPos.y / 4.2, 0.05, 1.2);
    }

    nonIdx.setAttribute('aCanopyAO', new THREE.BufferAttribute(aoArr, 1));
    nonIdx.setAttribute('aSwayWeight', new THREE.BufferAttribute(swayArr, 1));
    geoParts.push(nonIdx);
  }

  const merged = mergeGeometries(geoParts, false);
  geoParts.forEach((g) => g.dispose());
  return merged;
}

// Faceted mossy limestone/granite boulder
function createMossyBoulderGeometry() {
  const base = new THREE.DodecahedronGeometry(0.65, 1);
  const pos = base.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n =
      1.0 +
      0.18 * Math.sin(v.x * 3.8 + 1.1) * Math.cos(v.z * 3.4 - 0.7) +
      0.11 * Math.cos(v.y * 4.9 + v.x * 2.3);
    v.multiplyScalar(n);
    v.y *= v.y < 0 ? 0.55 : 0.78;
    v.y += 0.22;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  base.computeVertexNormals();
  return base;
}

export class FoliageSystem {
  constructor({ scene, terrain, materials, worldSize = 120, waterLevel = -0.35 }) {
    this.scene = scene;
    this.terrain = terrain;
    this.materials = materials;
    this.worldSize = worldSize;
    this.halfSize = worldSize * 0.5;
    this.waterLevel = waterLevel;

    this.season = 'summer';
    this.quality = 'ultra';

    this.uniforms = {
      uTerrainMap: { value: this.terrain.getHeightDataTexture() },
      uWorldSize: { value: this.worldSize },
      uWaterLevel: { value: this.waterLevel },
      uTime: { value: 0 },
      uWindStrength: { value: 0.55 },
      uSunDirection: { value: new THREE.Vector3(0.55, 0.5, 0.4).normalize() },
      uNightFactor: { value: 0 },
      uSeasonMix: { value: new THREE.Vector3(1, 0, 0) } // summer, autumn, spring
    };

    this.group = new THREE.Group();
    this.group.name = 'TinyGladeFoliage';
    this.scene.add(this.group);

    this._dummy = new THREE.Object3D();
    this._tmpColor = new THREE.Color();
    this._shoreDirtyTimer = 0;
    this._shoreNeedsRebuild = true;

    this.trees = []; // { x, z, scale, rot, seed, archetype: 'oak'|'spire' }
    this.bushes = []; // { x, z, scale, rot, seed }
    this.boulders = []; // { x, z, scaleX, scaleY, scaleZ, rot, seed }
    this.flowers = []; // { x, z, scale, rot, species: 0..3 }

    this._initGrassField();
    this._initFloraMeshes();
    this._initWoodlandMeshes();

    this.seedInitialNature();
  }

  _initGrassField() {
    const bladeGeo = createGrassBladeGeometry();
    const bladeMeta = new Float32Array(MAX_GRASS * 4);

    // Spatial 32x32 buckets for instant O(local) grass instance sync when sculpting hills/ponds
    this._grassBuckets = Array.from({ length: GRASS_GRID_DIM * GRASS_GRID_DIM }, () => []);
    this._grassCoords = new Float32Array(MAX_GRASS * 2);

    // R2 quasi-random low-discrepancy sequence so ANY quality prefix (16k / 35k / 65k) covers the full meadow evenly!
    const g = 1.324717957244746;
    const a1 = 1.0 / g;
    const a2 = 1.0 / (g * g);

    for (let i = 0; i < MAX_GRASS; i++) {
      const u1 = fract(0.5 + (i + 1) * a1);
      const u2 = fract(0.5 + (i + 1) * a2);

      // Concentrate tuft density tightly into the central glade [-30, 30] with smooth feathering out to [-45, 45]
      const sx = u1 * 2.0 - 1.0;
      const sz = u2 * 2.0 - 1.0;
      const warpX = Math.sign(sx) * Math.pow(Math.abs(sx), 1.62);
      const warpZ = Math.sign(sz) * Math.pow(Math.abs(sz), 1.62);

      const jitterX = (seededRand(i * 1.73 + 0.1) - 0.5) * 0.36;
      const jitterZ = (seededRand(i * 2.91 + 0.7) - 0.5) * 0.36;
      const wx = clamp(warpX * 44.5 + jitterX, -45.5, 45.5);
      const wz = clamp(warpZ * 44.5 + jitterZ, -45.5, 45.5);
      const radialDist = Math.hypot(wx, wz);
      const outerFeather = 1.0 - clamp((radialDist - 35.0) / 11.5, 0.0, 0.72);
      const seed = seededRand(i * 3.17 + 19.3);
      const lushScale = (0.82 + seededRand(i * 5.11 + 7.7) * 0.52) * outerFeather;

      bladeMeta[i * 4] = wx;
      bladeMeta[i * 4 + 1] = wz;
      bladeMeta[i * 4 + 2] = seed;
      bladeMeta[i * 4 + 3] = lushScale;

      this._grassCoords[i * 2] = wx;
      this._grassCoords[i * 2 + 1] = wz;

      const bx = clamp(Math.floor(((wx + this.halfSize) / this.worldSize) * GRASS_GRID_DIM), 0, GRASS_GRID_DIM - 1);
      const bz = clamp(Math.floor(((wz + this.halfSize) / this.worldSize) * GRASS_GRID_DIM), 0, GRASS_GRID_DIM - 1);
      this._grassBuckets[bz * GRASS_GRID_DIM + bx].push(i);
    }

    bladeGeo.setAttribute('aBladeMeta', new THREE.InstancedBufferAttribute(bladeMeta, 4));

    const uniforms = this.uniforms;
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.74,
      metalness: 0.0,
      side: THREE.DoubleSide
    });

    grassMat.customProgramCacheKey = () => 'tiny-glade-gpu-grass-v1';
    grassMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aHeightFrac;
          attribute vec4 aBladeMeta;

          uniform sampler2D uTerrainMap;
          uniform float uWorldSize;
          uniform float uWaterLevel;
          uniform float uTime;
          uniform float uWindStrength;

          varying float vHeightFrac;
          varying float vBladeSeed;
          varying vec3 vGrassWorldPos;`
        )
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
          float bladeYawN = aBladeMeta.z * 6.2831853;
          float cYawN = cos(bladeYawN);
          float sYawN = sin(bladeYawN);
          vec3 rotNorm = vec3(
            objectNormal.x * cYawN + objectNormal.z * sYawN,
            objectNormal.y,
            -objectNormal.x * sYawN + objectNormal.z * cYawN
          );
          // Blend blade normal toward terrain up-vector for plush Ghibli meadow shading
          objectNormal = normalize(mix(rotNorm, vec3(0.0, 1.0, 0.0), 0.66));`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vHeightFrac = aHeightFrac;
          vBladeSeed = aBladeMeta.z;

          vec2 bladeXZ = aBladeMeta.xy;
          vec2 tUv = bladeXZ / uWorldSize + 0.5;
          vec4 tData = texture2D(uTerrainMap, tUv);
          float gpuH = tData.r;
          float gpuSlope = tData.g;
          float gpuPath = tData.b;
          float gpuOcc = tData.a;

          // Strict suppression where underwater, on paths (>0.25), inside buildings/walls (>0.25), or steep cliffs
          float hardBlock = step(gpuH, uWaterLevel + 0.05) +
                            step(0.25, gpuPath) +
                            step(0.25, gpuOcc) +
                            step(0.32, gpuSlope);
          float softScale = smoothstep(uWaterLevel + 0.05, uWaterLevel + 0.24, gpuH) *
                            (1.0 - smoothstep(0.08, 0.25, max(gpuPath, gpuOcc))) *
                            (1.0 - smoothstep(0.20, 0.32, gpuSlope));

          // Natural meadow tuft clumping variation
          float patchLush = 0.78 + 0.42 * sin(bladeXZ.x * 0.21 + 1.3) * cos(bladeXZ.y * 0.19 - 0.7);
          float finalBladeScale = (hardBlock > 0.5) ? 0.0 : (aBladeMeta.w * softScale * patchLush);

          if (finalBladeScale <= 0.01) {
            transformed = vec3(0.0, -80.0, 0.0);
            vGrassWorldPos = vec3(bladeXZ.x, -80.0, bladeXZ.y);
          } else {
            float yaw = aBladeMeta.z * 6.2831853;
            float cy = cos(yaw);
            float sy = sin(yaw);

            vec3 localP = vec3(
              transformed.x * (0.85 + 0.3 * aBladeMeta.z),
              transformed.y * finalBladeScale,
              transformed.z * finalBladeScale
            );

            vec3 rotP = vec3(
              localP.x * cy + localP.z * sy,
              localP.y,
              -localP.x * sy + localP.z * cy
            );

            // Rolling FBM-like wind gust waves sweeping across the meadow
            vec2 windDir = normalize(vec2(0.82, 0.57));
            float wavePhase = dot(bladeXZ, windDir) * 0.22 - uTime * (1.85 + uWindStrength * 1.15);
            float gustMacro = sin(wavePhase) * 0.55 + sin(wavePhase * 2.13 + bladeXZ.x * 0.11) * 0.30 + 0.25;
            float flutter = sin(uTime * 3.8 + aBladeMeta.z * 19.7) * 0.06;
            float bendAmt = (gustMacro * 0.24 * (0.45 + uWindStrength) + flutter) * pow(aHeightFrac, 1.65) * finalBladeScale;

            rotP.x += windDir.x * bendAmt;
            rotP.z += windDir.y * bendAmt;
            // Conserve blade length when bent by wind
            rotP.y -= abs(bendAmt) * 0.26;

            // Sit at exact live GPU terrain height from uTerrainMap!
            float cpuY = instanceMatrix[3].y;
            rotP.y += (gpuH - cpuY);

            transformed = rotP;
            vGrassWorldPos = vec3(bladeXZ.x + rotP.x, gpuH + rotP.y - (gpuH - cpuY), bladeXZ.y + rotP.z);
          }`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          uniform vec3 uSunDirection;
          uniform float uNightFactor;
          uniform vec3 uSeasonMix;

          varying float vHeightFrac;
          varying float vBladeSeed;
          varying vec3 vGrassWorldPos;`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          // Seasonal grass root & sunlit tip palettes harmonized seamlessly with terrain meadow albedo
          vec3 sumRoot = vec3(0.215, 0.405, 0.125);
          vec3 sumTip  = vec3(0.455, 0.645, 0.215);

          vec3 autRoot = vec3(0.355, 0.345, 0.125);
          vec3 autTip  = vec3(0.665, 0.515, 0.195);

          vec3 sprRoot = vec3(0.225, 0.445, 0.155);
          vec3 sprTip  = vec3(0.485, 0.705, 0.265);

          vec3 rootCol = sumRoot * uSeasonMix.x + autRoot * uSeasonMix.y + sprRoot * uSeasonMix.z;
          vec3 tipCol  = sumTip  * uSeasonMix.x + autTip  * uSeasonMix.y + sprTip  * uSeasonMix.z;

          // Subtle warm sunlit clover/straw variation + gentle cloud dapple
          vec3 warmStraw = vec3(0.58, 0.59, 0.24);
          tipCol = mix(tipCol, warmStraw, smoothstep(0.68, 0.98, vBladeSeed) * 0.28);

          float dapple = 0.5 + 0.5 * sin(vGrassWorldPos.x * 0.09 + uTime * 0.18) * cos(vGrassWorldPos.z * 0.08 - uTime * 0.13);
          vec3 bladeGrad = mix(rootCol, tipCol, smoothstep(0.05, 0.92, vHeightFrac));
          bladeGrad *= mix(0.92, 1.08, dapple);

          // Soft root-to-tip gradient so grass tufts melt seamlessly into sunlit turf
          float rootAO = mix(0.84, 1.08, pow(clamp(vHeightFrac, 0.0, 1.0), 0.7));
          diffuseColor.rgb *= bladeGrad * rootAO;`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          // Prevent DOUBLE_SIDED from flipping upward terrain-aligned grass normals downward on backfaces!
          vec3 grassViewUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          normal = normalize(mix(normal, grassViewUp, 0.88));`
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          // Warm backlit subsurface translucency when gazing toward low sun!
          vec3 viewRay = normalize(cameraPosition - vGrassWorldPos);
          float sunForward = clamp(dot(viewRay, -normalize(uSunDirection)), 0.0, 1.0);
          float sss = pow(sunForward, 3.2) * vHeightFrac;
          float grazingSun = clamp(uSunDirection.y, 0.0, 1.0) * vHeightFrac * 0.16;
          float dayGlow = clamp(1.0 - uNightFactor * 1.15, 0.0, 1.0);
          vec3 sssTint = mix(vec3(0.52, 0.76, 0.20), vec3(0.82, 0.62, 0.22), uSeasonMix.y);
          totalEmissiveRadiance += sssTint * (sss * 0.48 + grazingSun * 0.22) * dayGlow;`
        );
    };

    this.grassMesh = new THREE.InstancedMesh(bladeGeo, grassMat, MAX_GRASS);
    this.grassMesh.name = 'TinyGladeMeadowGrass';
    this.grassMesh.receiveShadow = true;
    this.grassMesh.castShadow = false;
    this.grassMesh.frustumCulled = false;
    this.grassMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.grassMesh);

    this.syncAllGrassMatrices();
  }

  syncAllGrassMatrices() {
    const matArr = this.grassMesh.instanceMatrix.array;
    for (let i = 0; i < MAX_GRASS; i++) {
      this._writeGrassInstanceMatrix(i, matArr);
    }
    this.grassMesh.instanceMatrix.needsUpdate = true;
  }

  syncGrassInBounds(minX, minZ, maxX, maxZ) {
    const bx0 = clamp(Math.floor(((minX + this.halfSize) / this.worldSize) * GRASS_GRID_DIM), 0, GRASS_GRID_DIM - 1);
    const bx1 = clamp(Math.floor(((maxX + this.halfSize) / this.worldSize) * GRASS_GRID_DIM), 0, GRASS_GRID_DIM - 1);
    const bz0 = clamp(Math.floor(((minZ + this.halfSize) / this.worldSize) * GRASS_GRID_DIM), 0, GRASS_GRID_DIM - 1);
    const bz1 = clamp(Math.floor(((maxZ + this.halfSize) / this.worldSize) * GRASS_GRID_DIM), 0, GRASS_GRID_DIM - 1);

    const matArr = this.grassMesh.instanceMatrix.array;
    let touched = false;
    for (let bz = bz0; bz <= bz1; bz++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const bucket = this._grassBuckets[bz * GRASS_GRID_DIM + bx];
        for (let k = 0; k < bucket.length; k++) {
          this._writeGrassInstanceMatrix(bucket[k], matArr);
          touched = true;
        }
      }
    }
    if (touched) {
      this.grassMesh.instanceMatrix.needsUpdate = true;
    }
  }

  _writeGrassInstanceMatrix(i, matArr) {
    const wx = this._grassCoords[i * 2];
    const wz = this._grassCoords[i * 2 + 1];
    const h = this.terrain.getHeightAt(wx, wz);
    const { pathMask, occupancyMask } = this.terrain.getMaskAt(wx, wz);
    const nY = this.terrain.getNormalAt(wx, wz, this._tmpNorm || (this._tmpNorm = new THREE.Vector3())).y;

    const blocked = h <= this.waterLevel + 0.05 || pathMask > 0.25 || occupancyMask > 0.25 || nY < 0.68;
    const base = i * 16;

    // Non-zero micro-scale when hidden prevents 0/0 NaN in defaultnormal_vertex during any depth override pass!
    const s = blocked ? 0.0005 : 1.0;
    matArr[base] = s;
    matArr[base + 1] = 0;
    matArr[base + 2] = 0;
    matArr[base + 3] = 0;

    matArr[base + 4] = 0;
    matArr[base + 5] = s;
    matArr[base + 6] = 0;
    matArr[base + 7] = 0;

    matArr[base + 8] = 0;
    matArr[base + 9] = 0;
    matArr[base + 10] = s;
    matArr[base + 11] = 0;

    matArr[base + 12] = wx;
    matArr[base + 13] = blocked ? -80.0 : h;
    matArr[base + 14] = wz;
    matArr[base + 15] = 1;
  }

  _createBotanicalPartMaterial(keySuffix, swayAmp = 0.08, stemColorHex = '#376829', centerColorHex = '#edb428') {
    const uniforms = this.uniforms;
    const stemColor = new THREE.Color(stemColorHex);
    const centerColor = new THREE.Color(centerColorHex);

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.72,
      metalness: 0.0,
      side: THREE.DoubleSide
    });

    mat.customProgramCacheKey = () => `tiny-glade-flora-part-${keySuffix}`;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.uniforms.uStemColor = { value: stemColor };
      shader.uniforms.uCenterColor = { value: centerColor };
      shader.uniforms.uSwayAmp = { value: swayAmp };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aPartMask;
          attribute float aLocalAO;
          uniform float uTime;
          uniform float uWindStrength;
          uniform float uSwayAmp;
          varying float vPartMask;
          varying float vLocalAO;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vPartMask = aPartMask;
          vLocalAO = aLocalAO;
          vec3 instPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float wPhase = uTime * 2.3 + instPos.x * 0.45 + instPos.z * 0.37;
          float sway = sin(wPhase) * uSwayAmp * (0.45 + uWindStrength) * clamp(transformed.y * 1.4, 0.0, 1.5);
          transformed.x += sway;
          transformed.z += sway * 0.65;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec3 uStemColor;
          uniform vec3 uCenterColor;
          uniform vec3 uSeasonMix;
          varying float vPartMask;
          varying float vLocalAO;`
        )
        .replace(
          '#include <color_fragment>',
          `// Keep stems lush botanical green & centers golden while petals/spikes take vibrant instanceColor!
          vec3 instPetalCol = vec3(1.0);
          #if defined( USE_COLOR_ALPHA )
            instPetalCol = vColor.rgb;
          #elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
            instPetalCol = vColor;
          #endif
          vec3 stemSeasonal = mix(uStemColor, vec3(0.46, 0.43, 0.18), uSeasonMix.y * 0.55);
          vec3 partCol = stemSeasonal;
          if (vPartMask > 1.5) {
            partCol = uCenterColor;
          } else if (vPartMask > 0.5) {
            partCol = instPetalCol;
          }
          diffuseColor.rgb *= partCol * vLocalAO;`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          vec3 floraViewUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          normal = normalize(mix(normal, floraViewUp, 0.55));`
        );
    };
    return mat;
  }

  _initFloraMeshes() {
    // 1. Meadow Wildflowers (daisies, poppies, buttercups, lavender)
    const flowerGeo = createWildflowerClusterGeometry();
    const flowerMat = this._createBotanicalPartMaterial('wildflowers', 0.075, '#336626', '#f2b824');
    this.flowerMesh = new THREE.InstancedMesh(flowerGeo, flowerMat, MAX_FLOWERS);
    this.flowerMesh.name = 'TinyGladeWildflowers';
    this.flowerMesh.count = 0;
    this.flowerMesh.receiveShadow = true;
    this.flowerMesh.castShadow = false;
    this.flowerMesh.frustumCulled = false;
    this.group.add(this.flowerMesh);

    // Ensure instanceColor buffer exists right at startup
    this._flowerPalette = [
      new THREE.Color('#fff8e8'), // Meadow Daisy
      new THREE.Color('#e24634'), // Field Poppy
      new THREE.Color('#f4bf2a'), // Golden Buttercup
      new THREE.Color('#8e70d6')  // Wild Lavender
    ];
    for (let i = 0; i < MAX_FLOWERS; i++) {
      this.flowerMesh.setColorAt(i, this._flowerPalette[i % 4]);
    }

    // 2. Pond Water Lily Pads (floating at waterLevel)
    const lilyGeo = createLilyPadGeometry(true);
    const lilyMat = this._createBotanicalPartMaterial('lilies', 0.02, '#356b32', '#f5cb42');
    this.lilyMesh = new THREE.InstancedMesh(lilyGeo, lilyMat, MAX_LILIES);
    this.lilyMesh.name = 'TinyGladeWaterLilies';
    this.lilyMesh.count = 0;
    this.lilyMesh.receiveShadow = true;
    this.lilyMesh.frustumCulled = false;
    for (let i = 0; i < MAX_LILIES; i++) {
      // Soft blush-pink & cream water-lily blossoms
      this.lilyMesh.setColorAt(i, i % 3 === 0 ? new THREE.Color('#f7b9c8') : new THREE.Color('#fff4ea'));
    }
    this.group.add(this.lilyMesh);

    // 3. Shoreline Cattail Reeds
    const reedGeo = createCattailClusterGeometry();
    const reedMat = this._createBotanicalPartMaterial('reeds', 0.09, '#456d30', '#54331d');
    this.reedMesh = new THREE.InstancedMesh(reedGeo, reedMat, MAX_REEDS);
    this.reedMesh.name = 'TinyGladeCattailReeds';
    this.reedMesh.count = 0;
    this.reedMesh.receiveShadow = true;
    this.reedMesh.castShadow = true;
    this.reedMesh.frustumCulled = false;
    for (let i = 0; i < MAX_REEDS; i++) {
      // Velvety dark chocolate cattail heads
      this.reedMesh.setColorAt(i, new THREE.Color('#4d2d18'));
    }
    this.group.add(this.reedMesh);
  }

  _createFluffyCanopyMaterial() {
    const uniforms = this.uniforms;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.82,
      metalness: 0.0
    });

    mat.customProgramCacheKey = () => 'tiny-glade-puff-canopy-v1';
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aCanopyAO;
          attribute float aSwayWeight;
          uniform float uTime;
          uniform float uWindStrength;
          varying float vCanopyAO;
          varying vec3 vCanopyWorldPos;
          varying vec3 vCanopyWorldNorm;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vCanopyAO = aCanopyAO;
          vec3 treeBase = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float phase = uTime * 1.55 + treeBase.x * 0.31 + treeBase.z * 0.27;
          float gust = sin(phase) * 0.075 * (0.4 + uWindStrength) * aSwayWeight;
          float leafFlutter = sin(uTime * 3.4 + transformed.x * 4.1 + transformed.z * 3.7) * 0.016 * aSwayWeight;
          transformed.x += gust + leafFlutter;
          transformed.z += gust * 0.72 - leafFlutter;`
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vec4 cWp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            cWp = instanceMatrix * cWp;
          #endif
          cWp = modelMatrix * cWp;
          vCanopyWorldPos = cWp.xyz;
          mat3 cIm = mat3(1.0);
          #ifdef USE_INSTANCING
            cIm = mat3(instanceMatrix);
          #endif
          vCanopyWorldNorm = normalize(mat3(modelMatrix) * cIm * objectNormal);`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec3 uSunDirection;
          uniform float uNightFactor;
          varying float vCanopyAO;
          varying vec3 vCanopyWorldPos;
          varying vec3 vCanopyWorldNorm;`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          // Painterly leaf-cluster dapple + top-vs-underside tone shift
          float leafNoise = sin(vCanopyWorldPos.x * 5.2 + vCanopyWorldPos.y * 4.3) *
                            cos(vCanopyWorldPos.z * 5.1 - vCanopyWorldPos.y * 3.7);
          float sunFacing = clamp(dot(normalize(vCanopyWorldNorm), normalize(uSunDirection)) * 0.5 + 0.5, 0.0, 1.0);
          vec3 coolShadowShift = diffuseColor.rgb * vec3(0.62, 0.78, 0.85);
          vec3 sunlitCrownShift = diffuseColor.rgb * vec3(1.16, 1.14, 0.92);
          diffuseColor.rgb = mix(coolShadowShift, sunlitCrownShift, smoothstep(0.18, 0.85, sunFacing));
          diffuseColor.rgb *= (0.93 + 0.09 * leafNoise) * vCanopyAO;`
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          // Warm backlit foliage rim translucency
          vec3 vDir = normalize(cameraPosition - vCanopyWorldPos);
          float backGlow = pow(clamp(dot(vDir, -normalize(uSunDirection)), 0.0, 1.0), 2.6);
          float rim = pow(1.0 - abs(dot(vDir, normalize(vCanopyWorldNorm))), 1.8);
          float dayWeight = clamp(1.0 - uNightFactor * 1.2, 0.0, 1.0);
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.15, 1.05, 0.65) * (backGlow * rim * 0.48 + sunFacing * 0.06) * dayWeight;`
        );
    };

    return mat;
  }

  _createMossyBoulderMaterial() {
    const uniforms = this.uniforms;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.86,
      metalness: 0.02
    });
    mat.customProgramCacheKey = () => 'tiny-glade-mossy-boulder-v1';
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vRockWorldNorm;
          varying vec3 vRockWorldPos;`
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vec4 rWp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            rWp = instanceMatrix * rWp;
          #endif
          vRockWorldPos = (modelMatrix * rWp).xyz;
          mat3 rIm = mat3(1.0);
          #ifdef USE_INSTANCING
            rIm = mat3(instanceMatrix);
          #endif
          vRockWorldNorm = normalize(mat3(modelMatrix) * rIm * objectNormal);`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec3 uSeasonMix;
          varying vec3 vRockWorldNorm;
          varying vec3 vRockWorldPos;`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float nGrain = 0.5 + 0.5 * sin(vRockWorldPos.x * 4.1 + vRockWorldPos.z * 3.7) * cos(vRockWorldPos.y * 5.3);
          vec3 stoneBase = mix(vec3(0.46, 0.45, 0.43), vec3(0.64, 0.60, 0.54), nGrain);
          vec3 mossCol = vec3(0.24, 0.44, 0.16) * uSeasonMix.x +
                         vec3(0.46, 0.42, 0.16) * uSeasonMix.y +
                         vec3(0.28, 0.52, 0.21) * uSeasonMix.z;
          float mossMask = smoothstep(0.48, 0.82, vRockWorldNorm.y + (nGrain - 0.5) * 0.22);
          diffuseColor.rgb *= mix(stoneBase, mossCol, mossMask * 0.78);`
        );
    };
    return mat;
  }

  _initWoodlandMeshes() {
    this.canopyMat = this._createFluffyCanopyMaterial();

    const oakBarkMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#5a4332'),
      roughness: 0.92,
      metalness: 0.0
    });
    const birchBarkMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#8c7a68'),
      roughness: 0.88,
      metalness: 0.0
    });

    this.oakTrunkMesh = new THREE.InstancedMesh(createTreeTrunkGeometry('oak'), oakBarkMat, MAX_TREES_PER_TYPE);
    this.oakCanopyMesh = new THREE.InstancedMesh(createFluffyCanopyGeometry('oak'), this.canopyMat, MAX_TREES_PER_TYPE);
    this.spireTrunkMesh = new THREE.InstancedMesh(createTreeTrunkGeometry('spire'), birchBarkMat, MAX_TREES_PER_TYPE);
    this.spireCanopyMesh = new THREE.InstancedMesh(
      createFluffyCanopyGeometry('spire'),
      this.canopyMat,
      MAX_TREES_PER_TYPE
    );

    for (const m of [this.oakTrunkMesh, this.oakCanopyMesh, this.spireTrunkMesh, this.spireCanopyMesh]) {
      m.count = 0;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
    }

    this.bushMesh = new THREE.InstancedMesh(createBushGeometry(), this.canopyMat, MAX_BUSHES);
    this.bushMesh.count = 0;
    this.bushMesh.castShadow = true;
    this.bushMesh.receiveShadow = true;
    this.bushMesh.frustumCulled = false;
    this.group.add(this.bushMesh);

    this.boulderMesh = new THREE.InstancedMesh(
      createMossyBoulderGeometry(),
      this._createMossyBoulderMaterial(),
      MAX_BOULDERS
    );
    this.boulderMesh.count = 0;
    this.boulderMesh.castShadow = true;
    this.boulderMesh.receiveShadow = true;
    this.boulderMesh.frustumCulled = false;
    this.group.add(this.boulderMesh);
  }

  seedInitialNature() {
    this.trees = [];
    this.bushes = [];
    this.boulders = [];
    this.flowers = [];

    // 1. Frame the distant glade perimeter (r = 41..55m) with picturesque woodland groves & mossy boulders
    const groveCount = 24;
    for (let i = 0; i < groveCount; i++) {
      const ang = (i / groveCount) * Math.PI * 2 + (seededRand(i * 7.1) - 0.5) * 0.22;
      const rad = 41.5 + seededRand(i * 13.3 + 2.1) * 13.0;
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad;
      this._tryAddTree(x, z, i * 17.3 + 1.0);
    }

    // 2. Scatter natural sunlit wildflower patches across the meadow
    const patchCenters = 16;
    for (let p = 0; p < patchCenters; p++) {
      const ang = seededRand(p * 19.7 + 4.2) * Math.PI * 2;
      const rad = 8.0 + seededRand(p * 23.1 + 9.4) * 34.0;
      const cx = Math.cos(ang) * rad;
      const cz = Math.sin(ang) * rad;
      const patchSpecies = p % 4;
      const blooms = 38;
      for (let k = 0; k < blooms; k++) {
        const a = seededRand(p * 101 + k * 7.3) * Math.PI * 2;
        const r = Math.sqrt(seededRand(p * 157 + k * 11.9)) * 4.8;
        const fx = cx + Math.cos(a) * r;
        const fz = cz + Math.sin(a) * r;
        const sp = seededRand(p * 31 + k * 3.7) < 0.75 ? patchSpecies : (patchSpecies + 1) % 4;
        this._tryAddFlower(fx, fz, sp, seededRand(p * 43 + k));
      }
    }

    // 3. Scatter a few natural mossy boulders on gentle slopes
    for (let b = 0; b < 18; b++) {
      const ang = seededRand(b * 29.3 + 3.1) * Math.PI * 2;
      const rad = 24.0 + seededRand(b * 37.9 + 8.5) * 28.0;
      this._tryAddBoulder(Math.cos(ang) * rad, Math.sin(ang) * rad, b * 19.1 + 5.0);
    }

    this._syncWoodlandInstances();
    this._syncFlowerInstances();
    this.rebuildShoreFlora();
  }

  _isSpotClearForTree(x, z, minTreeDist = 2.15) {
    if (Math.abs(x) > this.halfSize - 2.5 || Math.abs(z) > this.halfSize - 2.5) return false;
    const h = this.terrain.getHeightAt(x, z);
    if (h < this.waterLevel + 0.16) return false;
    const nY = this.terrain.getNormalAt(x, z, this._tmpNorm || (this._tmpNorm = new THREE.Vector3())).y;
    if (nY < 0.72) return false;
    const { pathMask, occupancyMask } = this.terrain.getMaskAt(x, z);
    if (pathMask > 0.12 || occupancyMask > 0.12) return false;
    if (this.terrain.isPointBlockedByFootprint(x, z, 1.35)) return false;

    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      if (Math.hypot(t.x - x, t.z - z) < minTreeDist) return false;
    }
    return true;
  }

  _tryAddTree(x, z, seedVal = Math.random() * 1000) {
    if (this.trees.length >= MAX_TREES_PER_TYPE * 2 - 4) return false;
    if (!this._isSpotClearForTree(x, z, 2.15)) return false;

    const r1 = seededRand(seedVal);
    const r2 = seededRand(seedVal + 17.7);
    const r3 = seededRand(seedVal + 53.3);
    const archetype = r1 < 0.58 ? 'oak' : 'spire';
    const scale = 0.76 + r2 * 0.54;
    const rot = r3 * Math.PI * 2;

    this.trees.push({ x, z, scale, rot, seed: r1 * 0.63 + r2 * 0.37, archetype });

    // Cozy companion hedgerow bush or mossy boulder near ~55% of planted trees
    if (this.bushes.length < MAX_BUSHES && seededRand(seedVal + 91.1) < 0.58) {
      const bAng = rot + 1.2;
      const bDist = 1.35 + seededRand(seedVal + 112.7) * 0.95;
      const bx = x + Math.cos(bAng) * bDist;
      const bz = z + Math.sin(bAng) * bDist;
      if (this._isSpotClearForSmallFlora(bx, bz, 0.7)) {
        this.bushes.push({
          x: bx,
          z: bz,
          scale: 0.72 + seededRand(seedVal + 141.3) * 0.55,
          rot: bAng,
          seed: seededRand(seedVal + 173.9)
        });
      }
    }
    if (this.boulders.length < MAX_BOULDERS && seededRand(seedVal + 211.5) < 0.28) {
      const rAng = rot - 1.6;
      const rx = x + Math.cos(rAng) * 1.65;
      const rz = z + Math.sin(rAng) * 1.65;
      this._tryAddBoulder(rx, rz, seedVal + 239.1);
    }
    return true;
  }

  _tryAddBoulder(x, z, seedVal = Math.random() * 1000) {
    if (this.boulders.length >= MAX_BOULDERS) return false;
    if (Math.abs(x) > this.halfSize - 2 || Math.abs(z) > this.halfSize - 2) return false;
    const h = this.terrain.getHeightAt(x, z);
    if (h < this.waterLevel - 0.15) return false;
    const { pathMask, occupancyMask } = this.terrain.getMaskAt(x, z);
    if (pathMask > 0.15 || occupancyMask > 0.15) return false;
    if (this.terrain.isPointBlockedByFootprint(x, z, 0.9)) return false;

    for (let i = 0; i < this.boulders.length; i++) {
      if (Math.hypot(this.boulders[i].x - x, this.boulders[i].z - z) < 1.2) return false;
    }

    this.boulders.push({
      x,
      z,
      scaleX: 0.65 + seededRand(seedVal + 1.3) * 0.85,
      scaleY: 0.55 + seededRand(seedVal + 7.9) * 0.65,
      scaleZ: 0.65 + seededRand(seedVal + 13.7) * 0.85,
      rot: seededRand(seedVal + 29.1) * Math.PI * 2,
      seed: seededRand(seedVal + 41.5)
    });
    return true;
  }

  _isSpotClearForSmallFlora(x, z, pad = 0.35) {
    if (Math.abs(x) > this.halfSize - 1.5 || Math.abs(z) > this.halfSize - 1.5) return false;
    const h = this.terrain.getHeightAt(x, z);
    if (h < this.waterLevel + 0.10) return false;
    const nY = this.terrain.getNormalAt(x, z, this._tmpNorm || (this._tmpNorm = new THREE.Vector3())).y;
    if (nY < 0.74) return false;
    const { pathMask, occupancyMask } = this.terrain.getMaskAt(x, z);
    if (pathMask > 0.18 || occupancyMask > 0.18) return false;
    if (this.terrain.isPointBlockedByFootprint(x, z, pad)) return false;
    return true;
  }

  _tryAddFlower(x, z, species = 0, seedVal = Math.random()) {
    if (this.flowers.length >= MAX_FLOWERS) return false;
    if (!this._isSpotClearForSmallFlora(x, z, 0.35)) return false;

    // Prevent excessive stacking when dragging flower brush over the same spot
    let nearby = 0;
    for (let i = this.flowers.length - 1; i >= Math.max(0, this.flowers.length - 220); i--) {
      const f = this.flowers[i];
      if (Math.abs(f.x - x) < 0.45 && Math.abs(f.z - z) < 0.45) {
        nearby++;
        if (nearby >= 2) return false;
      }
    }

    this.flowers.push({
      x,
      z,
      scale: 0.78 + seededRand(seedVal * 97.3 + 1.1) * 0.58,
      rot: seededRand(seedVal * 53.9 + 3.7) * Math.PI * 2,
      species: ((species % 4) + 4) % 4
    });
    return true;
  }

  paintTrees(x, z, radius = 5.5, count) {
    const r = Math.max(1.2, radius);
    const targetCount = count !== undefined ? Math.max(1, Math.round(count)) : Math.max(1, Math.round(r * 0.45));
    let added = 0;
    const attempts = targetCount * 6;

    for (let i = 0; i < attempts && added < targetCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = Math.sqrt(Math.random()) * r;
      const px = x + Math.cos(ang) * dist;
      const pz = z + Math.sin(ang) * dist;
      if (this._tryAddTree(px, pz, Math.random() * 10000 + i * 13.7)) {
        added++;
      }
    }

    if (added > 0) {
      this._syncWoodlandInstances();
    }
    return added;
  }

  paintFlowers(x, z, radius = 4.5, density = 1.0) {
    const r = Math.max(1.0, radius);
    const d = clamp(density ?? 1.0, 0.2, 4.0);
    const targetCount = Math.max(4, Math.round(r * r * 0.85 * d));
    const dominantSpecies = Math.floor(Math.random() * 4);
    let added = 0;

    for (let i = 0; i < targetCount * 2 && added < targetCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = Math.sqrt(Math.random()) * r;
      const px = x + Math.cos(ang) * dist;
      const pz = z + Math.sin(ang) * dist;
      const sp = Math.random() < 0.65 ? dominantSpecies : Math.floor(Math.random() * 4);
      if (this._tryAddFlower(px, pz, sp, Math.random() * 1000 + i)) {
        added++;
      }
    }

    if (added > 0) {
      this._syncFlowerInstances();
    }
    return added;
  }

  clearNatureAt(x, z, radius = 4.0) {
    const rSq = radius * radius;
    const prevCounts = this.trees.length + this.bushes.length + this.boulders.length + this.flowers.length;

    this.trees = this.trees.filter((t) => (t.x - x) * (t.x - x) + (t.z - z) * (t.z - z) > rSq);
    this.bushes = this.bushes.filter((b) => (b.x - x) * (b.x - x) + (b.z - z) * (b.z - z) > rSq);
    this.boulders = this.boulders.filter((b) => (b.x - x) * (b.x - x) + (b.z - z) * (b.z - z) > rSq);
    this.flowers = this.flowers.filter((f) => (f.x - x) * (f.x - x) + (f.z - z) * (f.z - z) > rSq);

    const nextCounts = this.trees.length + this.bushes.length + this.boulders.length + this.flowers.length;
    if (nextCounts !== prevCounts) {
      this._syncWoodlandInstances();
      this._syncFlowerInstances();
      return true;
    }
    return false;
  }

  pruneAndReground(bounds = null) {
    const isValidLand = (x, z, minClearMask = 0.22, pad = 0.5) => {
      const h = this.terrain.getHeightAt(x, z);
      if (h < this.waterLevel + 0.06) return false;
      const nY = this.terrain.getNormalAt(x, z, this._tmpNorm || (this._tmpNorm = new THREE.Vector3())).y;
      if (nY < 0.66) return false;
      const { pathMask, occupancyMask } = this.terrain.getMaskAt(x, z);
      if (pathMask > minClearMask || occupancyMask > minClearMask) return false;
      if (this.terrain.isPointBlockedByFootprint(x, z, pad)) return false;
      return true;
    };

    this.trees = this.trees.filter((t) => isValidLand(t.x, t.z, 0.18, 0.95));
    this.bushes = this.bushes.filter((b) => isValidLand(b.x, b.z, 0.22, 0.55));
    this.boulders = this.boulders.filter((b) => {
      const h = this.terrain.getHeightAt(b.x, b.z);
      if (h < this.waterLevel - 0.28) return false;
      const { pathMask, occupancyMask } = this.terrain.getMaskAt(b.x, b.z);
      if (pathMask > 0.2 || occupancyMask > 0.2) return false;
      return !this.terrain.isPointBlockedByFootprint(b.x, b.z, 0.65);
    });
    this.flowers = this.flowers.filter((f) => isValidLand(f.x, f.z, 0.22, 0.3));

    this._syncWoodlandInstances();
    this._syncFlowerInstances();

    if (bounds) {
      this.syncGrassInBounds(bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ);
      this._shoreNeedsRebuild = true;
    } else {
      this.syncAllGrassMatrices();
      this.rebuildShoreFlora();
    }
  }

  _computeSeasonalCanopyColor(seed, archetype, target) {
    if (this.season === 'autumn') {
      // Rich autumn tapestry: golden honey, glowing amber, burnt crimson, warm russet
      if (seed < 0.32) {
        target.set('#d89624').lerp(new THREE.Color('#ebb134'), seed * 2.5);
      } else if (seed < 0.64) {
        target.set('#c95f24').lerp(new THREE.Color('#df7b2a'), (seed - 0.32) * 2.5);
      } else if (seed < 0.86) {
        target.set('#a83526').lerp(new THREE.Color('#c74930'), (seed - 0.64) * 3.5);
      } else {
        target.set('#7b6c28');
      }
    } else if (this.season === 'spring') {
      // Fresh spring mint greens + soft cherry/apple blossom trees!
      if (archetype === 'oak' && seed > 0.66) {
        target.set('#f2b6c6').lerp(new THREE.Color('#fce2e9'), (seed - 0.66) * 2.8);
      } else {
        target.set('#4c9438').lerp(new THREE.Color('#7bc04d'), seed);
      }
    } else {
      // Lush sunlit summer emerald, sage & warm olive
      if (archetype === 'spire') {
        target.set('#2d612c').lerp(new THREE.Color('#4d8539'), seed);
      } else {
        target.set('#38702e').lerp(new THREE.Color('#64963b'), seed);
      }
    }
    return target;
  }

  _syncWoodlandInstances() {
    let oakCount = 0;
    let spireCount = 0;
    const dummy = this._dummy;
    const col = this._tmpColor;

    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      const y = this.terrain.getHeightAt(t.x, t.z);
      dummy.position.set(t.x, y - 0.06, t.z);
      dummy.rotation.set(0, t.rot, 0);
      dummy.scale.setScalar(t.scale);
      dummy.updateMatrix();

      this._computeSeasonalCanopyColor(t.seed, t.archetype, col);

      if (t.archetype === 'oak' && oakCount < MAX_TREES_PER_TYPE) {
        this.oakTrunkMesh.setMatrixAt(oakCount, dummy.matrix);
        this.oakCanopyMesh.setMatrixAt(oakCount, dummy.matrix);
        this.oakCanopyMesh.setColorAt(oakCount, col);
        oakCount++;
      } else if (spireCount < MAX_TREES_PER_TYPE) {
        this.spireTrunkMesh.setMatrixAt(spireCount, dummy.matrix);
        this.spireCanopyMesh.setMatrixAt(spireCount, dummy.matrix);
        this.spireCanopyMesh.setColorAt(spireCount, col);
        spireCount++;
      }
    }

    this.oakTrunkMesh.count = oakCount;
    this.oakCanopyMesh.count = oakCount;
    this.spireTrunkMesh.count = spireCount;
    this.spireCanopyMesh.count = spireCount;
    this.oakTrunkMesh.instanceMatrix.needsUpdate = true;
    this.oakCanopyMesh.instanceMatrix.needsUpdate = true;
    this.spireTrunkMesh.instanceMatrix.needsUpdate = true;
    this.spireCanopyMesh.instanceMatrix.needsUpdate = true;
    if (this.oakCanopyMesh.instanceColor) this.oakCanopyMesh.instanceColor.needsUpdate = true;
    if (this.spireCanopyMesh.instanceColor) this.spireCanopyMesh.instanceColor.needsUpdate = true;

    // Bushes
    const bushLimit = Math.min(this.bushes.length, MAX_BUSHES);
    for (let i = 0; i < bushLimit; i++) {
      const b = this.bushes[i];
      const y = this.terrain.getHeightAt(b.x, b.z);
      dummy.position.set(b.x, y - 0.04, b.z);
      dummy.rotation.set(0, b.rot, 0);
      dummy.scale.setScalar(b.scale);
      dummy.updateMatrix();
      this.bushMesh.setMatrixAt(i, dummy.matrix);
      this._computeSeasonalCanopyColor(b.seed * 0.85, 'oak', col);
      this.bushMesh.setColorAt(i, col);
    }
    this.bushMesh.count = bushLimit;
    this.bushMesh.instanceMatrix.needsUpdate = true;
    if (this.bushMesh.instanceColor) this.bushMesh.instanceColor.needsUpdate = true;

    // Mossy Boulders
    const boulderLimit = Math.min(this.boulders.length, MAX_BOULDERS);
    for (let i = 0; i < boulderLimit; i++) {
      const bd = this.boulders[i];
      const y = this.terrain.getHeightAt(bd.x, bd.z);
      dummy.position.set(bd.x, y - 0.14, bd.z);
      dummy.rotation.set((bd.seed - 0.5) * 0.25, bd.rot, (0.5 - bd.seed) * 0.25);
      dummy.scale.set(bd.scaleX, bd.scaleY, bd.scaleZ);
      dummy.updateMatrix();
      this.boulderMesh.setMatrixAt(i, dummy.matrix);
    }
    this.boulderMesh.count = boulderLimit;
    this.boulderMesh.instanceMatrix.needsUpdate = true;
  }

  _syncFlowerInstances() {
    const qualityMul = this.quality === 'balanced' ? 0.55 : this.quality === 'high' ? 0.82 : 1.0;
    const limit = Math.min(Math.floor(this.flowers.length * qualityMul), MAX_FLOWERS);
    const dummy = this._dummy;

    for (let i = 0; i < limit; i++) {
      const f = this.flowers[i];
      const y = this.terrain.getHeightAt(f.x, f.z);
      dummy.position.set(f.x, y - 0.02, f.z);
      dummy.rotation.set(0, f.rot, 0);
      dummy.scale.setScalar(f.scale);
      dummy.updateMatrix();
      this.flowerMesh.setMatrixAt(i, dummy.matrix);
      this.flowerMesh.setColorAt(i, this._flowerPalette[f.species % 4]);
    }
    this.flowerMesh.count = limit;
    this.flowerMesh.instanceMatrix.needsUpdate = true;
    if (this.flowerMesh.instanceColor) this.flowerMesh.instanceColor.needsUpdate = true;
  }

  // Automatic Water Lily Pads & Cattail Reeds along pond shorelines (waterLevel - 0.45 < h < waterLevel + 0.15)
  rebuildShoreFlora() {
    this._shoreNeedsRebuild = false;
    const dummy = this._dummy;
    let lilyCount = 0;
    let reedCount = 0;

    // Scan terrain on a ~0.85m jittered lattice inside [-52, 52] for pond margins
    const step = 0.85;
    let cellIdx = 0;
    for (let gz = -52; gz <= 52; gz += step) {
      for (let gx = -52; gx <= 52; gx += step) {
        cellIdx++;
        const r1 = seededRand(cellIdx * 13.37 + 1.9);
        const r2 = seededRand(cellIdx * 29.71 + 7.3);
        const wx = gx + (r1 - 0.5) * 0.72;
        const wz = gz + (r2 - 0.5) * 0.72;

        const h = this.terrain.getHeightAt(wx, wz);
        if (h <= this.waterLevel - 1.15 || h >= this.waterLevel + 0.16) continue;

        const { pathMask, occupancyMask } = this.terrain.getMaskAt(wx, wz);
        if (pathMask > 0.15 || occupancyMask > 0.15) continue;
        if (this.terrain.isPointBlockedByFootprint(wx, wz, 0.8)) continue;

        const nY = this.terrain.getNormalAt(wx, wz, this._tmpNorm || (this._tmpNorm = new THREE.Vector3())).y;
        const r3 = seededRand(cellIdx * 47.11 + 3.1);
        // Cluster organically in cozy marsh/lily drifts
        const patchNoise = 0.5 + 0.5 * Math.sin(wx * 0.35 + 1.2) * Math.cos(wz * 0.33 - 0.8);

        // Floating water lily pads on pond shelves (waterLevel - 1.05 < h < waterLevel - 0.08)
        if (
          h < this.waterLevel - 0.08 &&
          h > this.waterLevel - 1.05 &&
          patchNoise > 0.38 &&
          r3 < 0.38 &&
          lilyCount < MAX_LILIES
        ) {
          dummy.position.set(wx, this.waterLevel + 0.014, wz);
          dummy.rotation.set(0, r1 * Math.PI * 2, 0);
          dummy.scale.setScalar(0.76 + r2 * 0.52);
          dummy.updateMatrix();
          this.lilyMesh.setMatrixAt(lilyCount++, dummy.matrix);
        }

        // Damp shoreline bank (waterLevel - 0.38 < h < waterLevel + 0.15): cattail reed clusters!
        if (
          h >= this.waterLevel - 0.38 &&
          h < this.waterLevel + 0.15 &&
          nY >= 0.48 &&
          patchNoise > 0.32 &&
          r3 > 0.50 &&
          reedCount < MAX_REEDS
        ) {
          dummy.position.set(wx, Math.max(h, this.waterLevel - 0.18) - 0.04, wz);
          dummy.rotation.set(0, r2 * Math.PI * 2, 0);
          dummy.scale.setScalar(0.82 + r1 * 0.44);
          dummy.updateMatrix();
          this.reedMesh.setMatrixAt(reedCount++, dummy.matrix);
        }
      }
    }

    this.lilyMesh.count = lilyCount;
    this.reedMesh.count = reedCount;
    this.lilyMesh.instanceMatrix.needsUpdate = true;
    this.reedMesh.instanceMatrix.needsUpdate = true;
  }

  setSeason(season) {
    const s = String(season || 'summer').toLowerCase();
    this.season = s === 'autumn' || s === 'spring' ? s : 'summer';
    if (this.season === 'autumn') {
      this.uniforms.uSeasonMix.value.set(0, 1, 0);
    } else if (this.season === 'spring') {
      this.uniforms.uSeasonMix.value.set(0, 0, 1);
    } else {
      this.uniforms.uSeasonMix.value.set(1, 0, 0);
    }
    this._syncWoodlandInstances();
  }

  setQuality(tier) {
    const q = String(tier || 'ultra').toLowerCase();
    this.quality = GRASS_COUNTS[q] ? q : 'ultra';
    this.grassMesh.count = GRASS_COUNTS[this.quality];
    this.bushMesh.castShadow = this.quality !== 'balanced';
    this.reedMesh.castShadow = this.quality !== 'balanced';
    this._syncFlowerInstances();
  }

  update(dt, elapsed, envState = {}) {
    this.uniforms.uTime.value = elapsed;
    this.uniforms.uTerrainMap.value = this.terrain.getHeightDataTexture();
    if (envState.windStrength !== undefined) {
      this.uniforms.uWindStrength.value = envState.windStrength;
    }
    if (envState.sunDirection) {
      this.uniforms.uSunDirection.value.copy(envState.sunDirection);
    }
    if (envState.nightFactor !== undefined) {
      this.uniforms.uNightFactor.value = envState.nightFactor;
    }
    if (envState.season && envState.season !== this.season) {
      this.setSeason(envState.season);
    }

    if (this._shoreNeedsRebuild) {
      this._shoreDirtyTimer += dt;
      if (this._shoreDirtyTimer >= 0.14) {
        this._shoreDirtyTimer = 0;
        this.rebuildShoreFlora();
      }
    }
  }

  serialize() {
    return {
      trees: this.trees.map((t) => ({ ...t })),
      bushes: this.bushes.map((b) => ({ ...b })),
      boulders: this.boulders.map((bd) => ({ ...bd })),
      flowers: this.flowers.map((f) => ({ ...f })),
      season: this.season
    };
  }

  deserialize(data) {
    if (!data) return;
    if (data.season) {
      this.season = data.season;
      if (this.season === 'autumn') this.uniforms.uSeasonMix.value.set(0, 1, 0);
      else if (this.season === 'spring') this.uniforms.uSeasonMix.value.set(0, 0, 1);
      else this.uniforms.uSeasonMix.value.set(1, 0, 0);
    }
    this.trees = Array.isArray(data.trees) ? data.trees.map((t) => ({ ...t })) : [];
    this.bushes = Array.isArray(data.bushes) ? data.bushes.map((b) => ({ ...b })) : [];
    this.boulders = Array.isArray(data.boulders) ? data.boulders.map((bd) => ({ ...bd })) : [];
    this.flowers = Array.isArray(data.flowers) ? data.flowers.map((f) => ({ ...f })) : [];

    this._syncWoodlandInstances();
    this._syncFlowerInstances();
    this.syncAllGrassMatrices();
    this.rebuildShoreFlora();
  }

  clear() {
    this.seedInitialNature();
    this.syncAllGrassMatrices();
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material?.dispose();
      }
    });
  }
}
