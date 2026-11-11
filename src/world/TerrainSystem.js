import * as THREE from 'three';

const GRID_SIZE = 256;
const SPLAT_SIZE = 512;
const DETAIL_SIZE = 256;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

// Fast deterministic integer hash -> [0, 1)
function hash2i(ix, iy, seed = 1337) {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function periodicValueNoise(u, v, period, seed) {
  const x = u * period;
  const y = v * period;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const ix0 = ((x0 % period) + period) % period;
  const iy0 = ((y0 % period) + period) % period;
  const ix1 = (ix0 + 1) % period;
  const iy1 = (iy0 + 1) % period;

  const n00 = hash2i(ix0, iy0, seed);
  const n10 = hash2i(ix1, iy0, seed);
  const n01 = hash2i(ix0, iy1, seed);
  const n11 = hash2i(ix1, iy1, seed);

  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

function periodicFbm(u, v, basePeriod, octaves, seed) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = basePeriod;
  for (let i = 0; i < octaves; i++) {
    sum += amp * periodicValueNoise(u, v, freq, seed + i * 97);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / (norm || 1);
}

// Seamless tileable Worley stone / pebble height (returns crown height 0..1)
function periodicWorleyCrown(u, v, cells, seed, jitter = 0.82) {
  const x = u * cells;
  const y = v * cells;
  const cx = Math.floor(x);
  const cy = Math.floor(y);

  let d1 = 1e9;
  let d2 = 1e9;
  let winId = 0;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx;
      const ny = cy + dy;
      const wx = ((nx % cells) + cells) % cells;
      const wy = ((ny % cells) + cells) % cells;
      const rx = hash2i(wx, wy, seed);
      const ry = hash2i(wx, wy, seed + 7919);
      const px = nx + 0.5 + (rx - 0.5) * jitter;
      const py = ny + 0.5 + (ry - 0.5) * jitter;
      const ddx = x - px;
      const ddy = y - py;
      // Slight elliptical stone aspect variation
      const aspect = 0.85 + 0.3 * hash2i(wx, wy, seed + 31337);
      const dist = Math.sqrt(ddx * ddx * aspect + (ddy * ddy) / aspect);
      if (dist < d1) {
        d2 = d1;
        d1 = dist;
        winId = hash2i(wx, wy, seed + 65537);
      } else if (dist < d2) {
        d2 = dist;
      }
    }
  }

  // Distance to mortar edge: 0 at cell boundary, positive toward center
  const edge = d2 - d1;
  const mortarMask = smoothstep(0.035, 0.22, edge);
  const dome = Math.sqrt(clamp(1.0 - d1 * d1 * 1.45, 0.0, 1.0));
  return clamp(mortarMask * (0.35 + 0.65 * dome) * (0.82 + 0.18 * winId), 0, 1);
}

// World-space non-periodic value FBM for organic rolling terrain generation
function valueNoise2D(x, z, seed = 42) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const n00 = hash2i(x0, z0, seed);
  const n10 = hash2i(x0 + 1, z0, seed);
  const n01 = hash2i(x0, z0 + 1, seed);
  const n11 = hash2i(x0 + 1, z0 + 1, seed);
  return (n00 + (n10 - n00) * sx) * (1 - sz) + (n01 + (n11 - n01) * sx) * sz;
}

function worldFbm2D(x, z, seed = 42) {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < 4; i++) {
    v += amp * valueNoise2D(x * freq, z * freq, seed + i * 131);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return v / norm;
}

function createProceduralDetailTexture() {
  const data = new Uint8Array(DETAIL_SIZE * DETAIL_SIZE * 4);
  for (let y = 0; y < DETAIL_SIZE; y++) {
    const v = y / DETAIL_SIZE;
    for (let x = 0; x < DETAIL_SIZE; x++) {
      const u = x / DETAIL_SIZE;
      const idx = (y * DETAIL_SIZE + x) * 4;

      // R: multi-octave soft soil / meadow patch noise
      const fbm = periodicFbm(u, v, 4, 4, 101);
      // G: rounded cobblestones (14x14 stones per tile)
      const cobble = periodicWorleyCrown(u, v, 14, 503, 0.78);
      // B: fine river & path border pebbles (26x26 pebbles per tile)
      const pebbles = periodicWorleyCrown(u, v, 26, 907, 0.9);
      // A: stratified limestone/granite rock layers + fracture cracks
      const strataWave = Math.sin((v * 8.0 + periodicFbm(u, v, 6, 2, 1409) * 0.85) * Math.PI * 2.0);
      const rockBlocks = periodicWorleyCrown(u * 0.5 + 0.13, v, 10, 2027, 0.65);
      const rock = clamp(0.45 * (strataWave * 0.5 + 0.5) + 0.55 * rockBlocks, 0, 1);

      data[idx] = Math.round(fbm * 255);
      data[idx + 1] = Math.round(cobble * 255);
      data[idx + 2] = Math.round(pebbles * 255);
      data[idx + 3] = Math.round(rock * 255);
    }
  }
  const tex = new THREE.DataTexture(data, DETAIL_SIZE, DETAIL_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function resamplePolyline(rawPoints, spacing = 0.55) {
  if (!Array.isArray(rawPoints) || rawPoints.length === 0) return [];
  const cleaned = [];
  for (let i = 0; i < rawPoints.length; i++) {
    const p = rawPoints[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    if (cleaned.length === 0) {
      cleaned.push({ x: p.x, z: p.z });
    } else {
      const prev = cleaned[cleaned.length - 1];
      if (Math.hypot(p.x - prev.x, p.z - prev.z) > 0.08) {
        cleaned.push({ x: p.x, z: p.z });
      }
    }
  }
  if (cleaned.length < 2) return cleaned;
  if (cleaned.length === 2) {
    const a = cleaned[0];
    const b = cleaned[1];
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(2, Math.ceil(dist / spacing));
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
    return out;
  }

  const vecs = cleaned.map((p) => new THREE.Vector3(p.x, 0, p.z));
  const curve = new THREE.CatmullRomCurve3(vecs, false, 'centripetal', 0.5);
  const length = curve.getLength();
  const divs = Math.max(4, Math.ceil(length / spacing));
  const sampled = curve.getSpacedPoints(divs);
  return sampled.map((v) => ({ x: v.x, z: v.z }));
}

function distToSegment2D(px, pz, ax, az, bx, bz) {
  const vx = bx - ax;
  const vz = bz - az;
  const lenSq = vx * vx + vz * vz;
  let t = 0;
  if (lenSq > 1e-8) {
    t = clamp(((px - ax) * vx + (pz - az) * vz) / lenSq, 0, 1);
  }
  const cx = ax + vx * t;
  const cz = az + vz * t;
  const dx = px - cx;
  const dz = pz - cz;
  const dist = Math.sqrt(dx * dx + dz * dz);
  // Signed side for cross-track coordinate
  const cross = vx * (pz - az) - vz * (px - ax);
  const sign = cross >= 0 ? 1 : -1;
  return { dist, signedDist: dist * sign, cx, cz, t };
}

function pointToObbSignedDist(px, pz, fp) {
  const dx = px - (fp.x || 0);
  const dz = pz - (fp.z || 0);
  const rot = fp.rotation || 0;
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const hx = (fp.width || 4) * 0.5;
  const hz = (fp.depth || 4) * 0.5;
  const qx = Math.abs(lx) - hx;
  const qz = Math.abs(lz) - hz;
  const outDist = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
  const inDist = Math.min(Math.max(qx, qz), 0);
  return outDist + inDist;
}

export class TerrainSystem {
  constructor({ scene, materials, worldSize = 120, waterLevel = -0.35 }) {
    this.scene = scene;
    this.materials = materials;
    this.worldSize = worldSize;
    this.halfSize = worldSize * 0.5;
    this.waterLevel = waterLevel;
    this.gridSize = GRID_SIZE;

    const count = GRID_SIZE * GRID_SIZE;
    this.heights = new Float32Array(count);
    this.normals = new Float32Array(count * 3);
    this.pathMask = new Float32Array(count);
    this.buildingMask = new Float32Array(count);
    this.occupancyMask = new Float32Array(count);
    this._smoothScratch = new Float32Array(count);

    this.paths = [];
    this.footprints = [];
    this._nextPathId = 1;
    this.season = 'summer';

    // Shared 256x256 RGBA HalfFloat DataTexture contract:
    // .r = height (m), .g = slope (1 - normal.y), .b = pathMask, .a = occupancyMask
    this._halfFloatData = new Uint16Array(count * 4);
    this.heightDataTexture = new THREE.DataTexture(
      this._halfFloatData,
      GRID_SIZE,
      GRID_SIZE,
      THREE.RGBAFormat,
      THREE.HalfFloatType
    );
    this.heightDataTexture.minFilter = THREE.LinearFilter;
    this.heightDataTexture.magFilter = THREE.LinearFilter;
    this.heightDataTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.heightDataTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.heightDataTexture.flipY = false;
    this.heightDataTexture.generateMipmaps = false;

    // High-res 512x512 path splat texture for cobble, country dirt tracks, and border pebbles
    this._splatData = new Uint8Array(SPLAT_SIZE * SPLAT_SIZE * 4);
    for (let i = 0; i < SPLAT_SIZE * SPLAT_SIZE; i++) {
      this._splatData[i * 4 + 2] = 128;
    }
    this.splatTexture = new THREE.DataTexture(
      this._splatData,
      SPLAT_SIZE,
      SPLAT_SIZE,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    this.splatTexture.minFilter = THREE.LinearFilter;
    this.splatTexture.magFilter = THREE.LinearFilter;
    this.splatTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.splatTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.splatTexture.flipY = false;
    this.splatTexture.generateMipmaps = false;
    this.splatTexture.needsUpdate = true;

    this.detailTexture = createProceduralDetailTexture();

    this.uniforms = {
      uSplatTex: { value: this.splatTexture },
      uDetailTex: { value: this.detailTexture },
      uWorldSize: { value: this.worldSize },
      uWaterLevel: { value: this.waterLevel },
      uTime: { value: 0 },
      uSeasonMix: { value: new THREE.Vector3(1, 0, 0) }, // x=summer, y=autumn, z=spring
      uNightFactor: { value: 0 },
      uSunDirection: { value: new THREE.Vector3(0.55, 0.5, 0.4).normalize() }
    };

    this._rayHits = [];
    this._buildGeometryAndMesh();
    this.initRollingMeadow(42);
  }

  _buildGeometryAndMesh() {
    const N = GRID_SIZE;
    const segs = N - 1;
    const positions = new Float32Array(N * N * 3);
    const normals = new Float32Array(N * N * 3);
    const uvs = new Float32Array(N * N * 2);

    for (let iz = 0; iz < N; iz++) {
      const vz = iz / segs;
      const wz = (vz - 0.5) * this.worldSize;
      for (let ix = 0; ix < N; ix++) {
        const vx = ix / segs;
        const wx = (vx - 0.5) * this.worldSize;
        const idx = iz * N + ix;
        positions[idx * 3] = wx;
        positions[idx * 3 + 1] = 0;
        positions[idx * 3 + 2] = wz;

        normals[idx * 3] = 0;
        normals[idx * 3 + 1] = 1;
        normals[idx * 3 + 2] = 0;

        uvs[idx * 2] = vx;
        uvs[idx * 2 + 1] = vz;
      }
    }

    const indices = new Uint32Array(segs * segs * 6);
    let ptr = 0;
    for (let iz = 0; iz < segs; iz++) {
      for (let ix = 0; ix < segs; ix++) {
        const a = iz * N + ix;
        const b = a + 1;
        const c = a + N;
        const d = c + 1;
        // Checkerboard diagonal split for isotropic hill & pond sculpting
        if ((ix + iz) % 2 === 0) {
          indices[ptr++] = a;
          indices[ptr++] = c;
          indices[ptr++] = b;
          indices[ptr++] = b;
          indices[ptr++] = c;
          indices[ptr++] = d;
        } else {
          indices[ptr++] = a;
          indices[ptr++] = c;
          indices[ptr++] = d;
          indices[ptr++] = a;
          indices[ptr++] = d;
          indices[ptr++] = b;
        }
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(positions, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.normAttr = new THREE.BufferAttribute(normals, 3);
    this.normAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('normal', this.normAttr);
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    this.material = this._createTerrainMaterial();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'TinyGladeTerrain';
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.scene.add(this.mesh);

    // Subtle diorama earth rim skirt around [-60, 60] perimeter so edges look like a crafted tabletop model
    this._buildDioramaSkirt();
  }

  _buildDioramaSkirt() {
    const N = GRID_SIZE;
    const segs = N - 1;
    const perimeterCount = segs * 4;
    const vertCount = (perimeterCount + 1) * 2;
    const skirtPos = new Float32Array(vertCount * 3);
    const skirtNorm = new Float32Array(vertCount * 3);
    const skirtIdx = new Uint32Array(perimeterCount * 6);

    // Store perimeter grid index lookup so skirt top follows sculpted edge heights
    this._skirtGridIndices = new Uint32Array(perimeterCount + 1);
    let p = 0;
    // North edge (iz = 0, ix: 0 -> 255)
    for (let ix = 0; ix < segs; ix++) this._skirtGridIndices[p++] = ix;
    // East edge (ix = 255, iz: 0 -> 255)
    for (let iz = 0; iz < segs; iz++) this._skirtGridIndices[p++] = iz * N + segs;
    // South edge (iz = 255, ix: 255 -> 0)
    for (let ix = segs; ix > 0; ix--) this._skirtGridIndices[p++] = segs * N + ix;
    // West edge (ix = 0, iz: 255 -> 0)
    for (let iz = segs; iz >= 0; iz--) this._skirtGridIndices[p++] = iz * N;

    for (let i = 0; i <= perimeterCount; i++) {
      const gIdx = this._skirtGridIndices[i];
      const ix = gIdx % N;
      const iz = Math.floor(gIdx / N);
      const wx = (ix / segs - 0.5) * this.worldSize;
      const wz = (iz / segs - 0.5) * this.worldSize;

      const topV = i * 2;
      const botV = topV + 1;
      skirtPos[topV * 3] = wx;
      skirtPos[topV * 3 + 1] = 0;
      skirtPos[topV * 3 + 2] = wz;

      skirtPos[botV * 3] = wx;
      skirtPos[botV * 3 + 1] = -6.5;
      skirtPos[botV * 3 + 2] = wz;

      const len = Math.hypot(wx, wz) || 1;
      skirtNorm[topV * 3] = wx / len;
      skirtNorm[topV * 3 + 1] = 0.15;
      skirtNorm[topV * 3 + 2] = wz / len;
      skirtNorm[botV * 3] = wx / len;
      skirtNorm[botV * 3 + 1] = -0.15;
      skirtNorm[botV * 3 + 2] = wz / len;
    }

    let k = 0;
    for (let i = 0; i < perimeterCount; i++) {
      const t0 = i * 2;
      const b0 = t0 + 1;
      const t1 = t0 + 2;
      const b1 = t0 + 3;
      skirtIdx[k++] = t0;
      skirtIdx[k++] = t1;
      skirtIdx[k++] = b0;
      skirtIdx[k++] = t1;
      skirtIdx[k++] = b1;
      skirtIdx[k++] = b0;
    }

    const skirtGeo = new THREE.BufferGeometry();
    this._skirtPosAttr = new THREE.BufferAttribute(skirtPos, 3);
    skirtGeo.setAttribute('position', this._skirtPosAttr);
    skirtGeo.setAttribute('normal', new THREE.BufferAttribute(skirtNorm, 3));
    skirtGeo.setIndex(new THREE.BufferAttribute(skirtIdx, 1));

    const skirtMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#4a3c2f'),
      roughness: 0.94,
      metalness: 0.0,
      side: THREE.DoubleSide
    });

    this.skirtMesh = new THREE.Mesh(skirtGeo, skirtMat);
    this.skirtMesh.name = 'TinyGladeDioramaSkirt';
    this.skirtMesh.receiveShadow = true;
    this.scene.add(this.skirtMesh);
  }

  _syncSkirtHeights() {
    if (!this._skirtPosAttr || !this._skirtGridIndices) return;
    const arr = this._skirtPosAttr.array;
    const count = this._skirtGridIndices.length;
    for (let i = 0; i < count; i++) {
      const gIdx = this._skirtGridIndices[i];
      arr[i * 6 + 1] = this.heights[gIdx];
    }
    this._skirtPosAttr.needsUpdate = true;
  }

  _createTerrainMaterial() {
    const uniforms = this.uniforms;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.88,
      metalness: 0.02
    });

    mat.customProgramCacheKey = () => 'tiny-glade-terrain-pbr-v1';
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vTerrainWorldPos;
          varying vec3 vTerrainWorldNormal;`
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vTerrainWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D uSplatTex;
          uniform sampler2D uDetailTex;
          uniform float uWorldSize;
          uniform float uWaterLevel;
          uniform float uTime;
          uniform vec3 uSeasonMix;
          uniform float uNightFactor;
          uniform vec3 uSunDirection;

          varying vec3 vTerrainWorldPos;
          varying vec3 vTerrainWorldNormal;

          // Triplanar sample of procedural detail texture
          vec4 sampleTriplanarDetail(vec3 wPos, vec3 wNorm, float scale) {
            vec3 blend = abs(wNorm);
            blend = pow(max(blend, vec3(0.0001)), vec3(4.0));
            blend /= (blend.x + blend.y + blend.z);
            vec4 xProj = texture2D(uDetailTex, wPos.zy * scale);
            vec4 yProj = texture2D(uDetailTex, wPos.xz * scale);
            vec4 zProj = texture2D(uDetailTex, wPos.xy * scale);
            return xProj * blend.x + yProj * blend.y + zProj * blend.z;
          }`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec2 terrainUv = vTerrainWorldPos.xz / uWorldSize + 0.5;
          vec4 splat = texture2D(uSplatTex, terrainUv);

          // Multi-scale procedural world detail
          vec4 detMacro = texture2D(uDetailTex, vTerrainWorldPos.xz * 0.032);
          vec4 detMid = texture2D(uDetailTex, vTerrainWorldPos.xz * 0.145);
          vec4 detFine = texture2D(uDetailTex, vTerrainWorldPos.xz * 0.42);

          float upness = clamp(vTerrainWorldNormal.y, 0.0, 1.0);
          float hWorld = vTerrainWorldPos.y;

          // 1. Seasonal sunlit meadow base (harmonized seamlessly with 3-blade meadow grass tufts)
          vec3 summerRich = vec3(0.195, 0.375, 0.115);
          vec3 summerLush = vec3(0.285, 0.465, 0.155);
          vec3 summerClover = vec3(0.385, 0.525, 0.195);

          vec3 autumnRich = vec3(0.315, 0.315, 0.120);
          vec3 autumnLush = vec3(0.485, 0.405, 0.155);
          vec3 autumnClover = vec3(0.595, 0.445, 0.185);

          vec3 springRich = vec3(0.195, 0.405, 0.140);
          vec3 springLush = vec3(0.325, 0.535, 0.205);
          vec3 springClover = vec3(0.445, 0.615, 0.265);

          vec3 meadowDark = summerRich * uSeasonMix.x + autumnRich * uSeasonMix.y + springRich * uSeasonMix.z;
          vec3 meadowMid = summerLush * uSeasonMix.x + autumnLush * uSeasonMix.y + springLush * uSeasonMix.z;
          vec3 meadowWarm = summerClover * uSeasonMix.x + autumnClover * uSeasonMix.y + springClover * uSeasonMix.z;

          float fineTurf = texture2D(uDetailTex, vTerrainWorldPos.xz * 0.95).r;
          float meadowPatch = smoothstep(0.25, 0.78, detMacro.r * 0.68 + detMid.r * 0.32);
          vec3 meadowCol = mix(meadowDark, meadowMid, meadowPatch);
          meadowCol = mix(meadowCol, meadowWarm, smoothstep(0.52, 0.88, detMid.r * 0.55 + detMacro.r * 0.45) * 0.55);
          meadowCol *= mix(0.92, 1.07, fineTurf);

          // Subtle moving cloud-dapple across open sunlit turf
          vec2 cloudUv = vTerrainWorldPos.xz * 0.014 + vec2(uTime * 0.006, uTime * 0.0035);
          float cloudDapple = texture2D(uDetailTex, cloudUv).r;
          meadowCol *= mix(0.90, 1.06, smoothstep(0.28, 0.74, cloudDapple));

          // 2. Triplanar limestone & granite cliff rock on steep slopes (normal.y < 0.72)
          float cliffMask = smoothstep(0.76, 0.55, upness);
          vec4 triRock = sampleTriplanarDetail(vTerrainWorldPos, vTerrainWorldNormal, 0.22);
          vec4 triRockMacro = sampleTriplanarDetail(vTerrainWorldPos * 0.37 + 3.1, vTerrainWorldNormal, 0.09);
          vec3 limestoneLight = vec3(0.63, 0.59, 0.52);
          vec3 graniteCool = vec3(0.42, 0.43, 0.45);
          vec3 rockCrevice = vec3(0.23, 0.21, 0.19);
          vec3 cliffCol = mix(graniteCool, limestoneLight, smoothstep(0.28, 0.72, triRockMacro.r));
          cliffCol = mix(rockCrevice, cliffCol, smoothstep(0.12, 0.75, triRock.a));
          // Mossy shelf tint on semi-upward rock ledges
          float rockLedgeMoss = smoothstep(0.48, 0.72, upness) * smoothstep(0.45, 0.75, triRockMacro.a);
          cliffCol = mix(cliffCol, meadowDark * 0.92, rockLedgeMoss * 0.55);

          // 3. Organic sandy-earth shoreline, scattered river gravel & damp pond bed near/below waterLevel
          float shoreFactor = smoothstep(uWaterLevel + 0.30, uWaterLevel - 0.02, hWorld);
          float deepBedFactor = smoothstep(uWaterLevel - 0.08, uWaterLevel - 0.95, hWorld);
          float wetBand = smoothstep(uWaterLevel + 0.16, uWaterLevel + 0.02, hWorld) *
                          (1.0 - smoothstep(uWaterLevel - 0.08, uWaterLevel - 0.45, hWorld));
          float pebbleCrown = mix(detFine.b, texture2D(uDetailTex, vTerrainWorldPos.xz * 0.73 + 0.31).b, 0.5);
          vec3 drySand = mix(vec3(0.52, 0.46, 0.36), vec3(0.60, 0.54, 0.42), detMid.r);
          vec3 riverPebbleCol = mix(vec3(0.46, 0.43, 0.38), vec3(0.62, 0.57, 0.49), smoothstep(0.32, 0.85, pebbleCrown));
          vec3 shoreCol = mix(drySand, riverPebbleCol, 0.42 * smoothstep(0.45, 0.82, detMid.r * 0.5 + pebbleCrown * 0.5));
          vec3 pondBedCol = mix(vec3(0.26, 0.30, 0.24), vec3(0.16, 0.22, 0.20), deepBedFactor);
          shoreCol = mix(shoreCol, pondBedCol, smoothstep(uWaterLevel + 0.02, uWaterLevel - 0.38, hWorld));
          // Wet water-lap darkening right along shoreline
          shoreCol *= mix(1.0, 0.68, wetBand);

          // 4. Painted Cobblestone & Country Dirt Paths (fade out cleanly on underwater pond beds where bridges span!)
          float aboveWaterPath = smoothstep(uWaterLevel - 0.06, uWaterLevel + 0.06, hWorld);
          float cobbleW = splat.r * aboveWaterPath;
          float dirtW = splat.g * aboveWaterPath;
          float crossCoord = abs(splat.b * 2.0 - 1.0); // 0 at centerline, 1 at outer border
          float borderPebbleW = splat.a * aboveWaterPath;

          // Cobblestone: multi-tone Cotswold limestone, warm ochre & slate stones + recessed mossy/sandy mortar
          vec4 cobbleTex = texture2D(uDetailTex, vTerrainWorldPos.xz * 0.52);
          float stoneCrown = cobbleTex.g;
          float stoneToneVar = texture2D(uDetailTex, vTerrainWorldPos.xz * 0.19 + vec2(0.37, 0.71)).r;
          vec3 stoneWarm = vec3(0.68, 0.62, 0.53);
          vec3 stoneCool = vec3(0.51, 0.52, 0.54);
          vec3 stoneOchre = vec3(0.69, 0.58, 0.44);
          vec3 stoneTopCol = mix(stoneCool, stoneWarm, smoothstep(0.22, 0.68, stoneToneVar));
          stoneTopCol = mix(stoneTopCol, stoneOchre, smoothstep(0.68, 0.92, stoneToneVar) * 0.65);
          vec3 mortarCol = mix(vec3(0.31, 0.28, 0.23), meadowDark * 0.95, smoothstep(0.55, 0.95, crossCoord) * 0.45);
          vec3 cobbleCol = mix(mortarCol, stoneTopCol, smoothstep(0.14, 0.52, stoneCrown));

          // Country dirt path: packed warm earth wheel-tracks + charming grassy median strip along center
          vec3 packedEarth = mix(vec3(0.42, 0.32, 0.22), vec3(0.55, 0.44, 0.31), detMid.r);
          packedEarth = mix(packedEarth, riverPebbleCol, smoothstep(0.58, 0.88, detFine.b) * 0.35);
          float centerGrassStrip = (1.0 - smoothstep(0.0, 0.34, crossCoord)) * smoothstep(0.35, 0.75, detMid.r);
          vec3 dirtPathCol = mix(packedEarth, meadowCol * 0.95, centerGrassStrip * 0.68);

          // Scattered border pebbles & worn verge along path margins
          float vergeStone = smoothstep(0.48, 0.82, detFine.b) * borderPebbleW;

          // Compose biomes in clean physical order
          vec3 finalAlbedo = meadowCol;
          finalAlbedo = mix(finalAlbedo, shoreCol, shoreFactor);
          finalAlbedo = mix(finalAlbedo, cliffCol, cliffMask);
          // Verge pebbles & worn earth transition
          finalAlbedo = mix(finalAlbedo, packedEarth * 0.92, borderPebbleW * 0.35 * (1.0 - cliffMask));
          finalAlbedo = mix(finalAlbedo, stoneWarm * 0.95, vergeStone * 0.65);
          // Paths on top
          float dirtBlend = smoothstep(0.08, 0.58, dirtW + (detMid.r - 0.5) * 0.16) * step(0.01, dirtW);
          float cobbleBlend = smoothstep(0.10, 0.55, cobbleW + (stoneCrown - 0.45) * 0.24) * step(0.01, cobbleW);
          finalAlbedo = mix(finalAlbedo, dirtPathCol, dirtBlend);
          finalAlbedo = mix(finalAlbedo, cobbleCol, cobbleBlend);

          diffuseColor.rgb *= finalAlbedo;

          // Synthesize unified micro-height for Mikkelsen screen-space bump normals & roughness
          float terrainMicroH = detFine.r * 0.08 * (1.0 - cliffMask);
          terrainMicroH = mix(terrainMicroH, pebbleCrown * 0.28, shoreFactor);
          terrainMicroH = mix(terrainMicroH, triRock.a * 0.55, cliffMask);
          terrainMicroH = mix(terrainMicroH, detFine.b * 0.18 + detMid.r * 0.12, dirtBlend);
          terrainMicroH = mix(terrainMicroH, stoneCrown * 0.48, cobbleBlend);
          terrainMicroH += vergeStone * 0.22;`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          float biomeRough = 0.89; // velvety meadow turf
          biomeRough = mix(biomeRough, 0.76, shoreFactor);
          biomeRough = mix(biomeRough, 0.24, wetBand); // glistening wet waterline!
          biomeRough = mix(biomeRough, mix(0.86, 0.68, triRock.a), cliffMask);
          biomeRough = mix(biomeRough, 0.86, dirtBlend);
          biomeRough = mix(biomeRough, mix(0.92, 0.56, smoothstep(0.2, 0.65, stoneCrown)), cobbleBlend);
          roughnessFactor = clamp(biomeRough, 0.18, 0.98);`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          vec3 dPosX = dFdx(vViewPosition);
          vec3 dPosY = dFdy(vViewPosition);
          float dHx = dFdx(terrainMicroH);
          float dHy = dFdy(terrainMicroH);
          vec3 r1 = cross(dPosY, normal);
          vec3 r2 = cross(normal, dPosX);
          float det = dot(dPosX, r1);
          if (abs(det) > 1e-7) {
            vec3 surfGrad = sign(det) * (dHx * r1 + dHy * r2);
            normal = normalize(abs(det) * normal - surfGrad * 0.16);
          }`
        );
    };

    return mat;
  }

  initRollingMeadow(seed = 42) {
    const N = GRID_SIZE;
    const segs = N - 1;
    for (let iz = 0; iz < N; iz++) {
      const wz = (iz / segs - 0.5) * this.worldSize;
      for (let ix = 0; ix < N; ix++) {
        const wx = (ix / segs - 0.5) * this.worldSize;
        const r = Math.hypot(wx, wz);

        // Gentle central meadow clearing (+0.32m..+0.62m) surrounded by rolling pastoral foothills (+1.2m..+3.6m)
        const nBroad = worldFbm2D(wx * 0.026 + 11.3, wz * 0.026 - 7.1, seed);
        const nMed = worldFbm2D(wx * 0.068 - 3.7, wz * 0.068 + 5.9, seed + 59);
        const centerCalm = smoothstep(10.0, 34.0, r);
        const rimLift = smoothstep(30.0, 58.0, r);

        let h = 0.34 + (nBroad - 0.35) * 0.55 + (nMed - 0.5) * 0.25;
        h += centerCalm * ((nBroad - 0.25) * 1.45 + (nMed - 0.45) * 0.45);
        h += rimLift * (1.35 + nBroad * 1.65);

        // Guarantee untouched starter meadow sits above waterLevel (-0.35) so ponds only appear where carved
        this.heights[iz * N + ix] = Math.max(0.22, h);
      }
    }

    this.paths = [];
    this.footprints = [];
    this.pathMask.fill(0);
    this.buildingMask.fill(0);
    this.occupancyMask.fill(0);
    for (let i = 0; i < SPLAT_SIZE * SPLAT_SIZE; i++) {
      this._splatData[i * 4] = 0;
      this._splatData[i * 4 + 1] = 0;
      this._splatData[i * 4 + 2] = 128;
      this._splatData[i * 4 + 3] = 0;
    }
    this.splatTexture.needsUpdate = true;

    this._syncRegion(0, 0, segs, segs, true);
    this._syncSkirtHeights();
  }

  getHeightAt(x, z) {
    const N = GRID_SIZE;
    const segs = N - 1;
    const fx = clamp((x + this.halfSize) / this.worldSize, 0, 1) * segs;
    const fz = clamp((z + this.halfSize) / this.worldSize, 0, 1) * segs;
    const ix = Math.min(segs - 1, Math.floor(fx));
    const iz = Math.min(segs - 1, Math.floor(fz));
    const tx = fx - ix;
    const tz = fz - iz;

    const row0 = iz * N + ix;
    const row1 = row0 + N;
    const h00 = this.heights[row0];
    const h10 = this.heights[row0 + 1];
    const h01 = this.heights[row1];
    const h11 = this.heights[row1 + 1];

    return (h00 + (h10 - h00) * tx) * (1 - tz) + (h01 + (h11 - h01) * tx) * tz;
  }

  getNormalAt(x, z, target = new THREE.Vector3()) {
    const N = GRID_SIZE;
    const segs = N - 1;
    const fx = clamp((x + this.halfSize) / this.worldSize, 0, 1) * segs;
    const fz = clamp((z + this.halfSize) / this.worldSize, 0, 1) * segs;
    const ix = Math.min(segs - 1, Math.floor(fx));
    const iz = Math.min(segs - 1, Math.floor(fz));
    const tx = fx - ix;
    const tz = fz - iz;

    const i00 = (iz * N + ix) * 3;
    const i10 = i00 + 3;
    const i01 = i00 + N * 3;
    const i11 = i01 + 3;

    const nx =
      (this.normals[i00] + (this.normals[i10] - this.normals[i00]) * tx) * (1 - tz) +
      (this.normals[i01] + (this.normals[i11] - this.normals[i01]) * tx) * tz;
    const ny =
      (this.normals[i00 + 1] + (this.normals[i10 + 1] - this.normals[i00 + 1]) * tx) * (1 - tz) +
      (this.normals[i01 + 1] + (this.normals[i11 + 1] - this.normals[i01 + 1]) * tx) * tz;
    const nz =
      (this.normals[i00 + 2] + (this.normals[i10 + 2] - this.normals[i00 + 2]) * tx) * (1 - tz) +
      (this.normals[i01 + 2] + (this.normals[i11 + 2] - this.normals[i01 + 2]) * tx) * tz;

    return target.set(nx, Math.max(0.01, ny), nz).normalize();
  }

  getMaskAt(x, z) {
    const N = GRID_SIZE;
    const segs = N - 1;
    const ix = Math.round(clamp((x + this.halfSize) / this.worldSize, 0, 1) * segs);
    const iz = Math.round(clamp((z + this.halfSize) / this.worldSize, 0, 1) * segs);
    const idx = iz * N + ix;
    return {
      pathMask: this.pathMask[idx],
      occupancyMask: this.occupancyMask[idx]
    };
  }

  getHeightDataTexture() {
    return this.heightDataTexture;
  }

  raycast(raycaster) {
    this._rayHits.length = 0;
    raycaster.intersectObject(this.mesh, false, this._rayHits);
    if (this._rayHits.length > 0) {
      return this._rayHits[0].point.clone();
    }
    return null;
  }

  sculpt(x, z, radius = 6, strength = 1.0, mode = 'raise', dt) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || radius <= 0.1) return false;
    const N = GRID_SIZE;
    const segs = N - 1;
    const cellStep = this.worldSize / segs;

    // Support both continuous interactive frame brushing (dt ~ 0.016) AND one-shot preset calls (dt === undefined)
    const isOneShot = dt === undefined || dt === null;
    const effDt = isOneShot ? 0.42 : clamp(dt, 0.001, 0.12);

    const padR = radius + cellStep * 2;
    const ix0 = Math.max(0, Math.floor(((x - padR + this.halfSize) / this.worldSize) * segs));
    const ix1 = Math.min(segs, Math.ceil(((x + padR + this.halfSize) / this.worldSize) * segs));
    const iz0 = Math.max(0, Math.floor(((z - padR + this.halfSize) / this.worldSize) * segs));
    const iz1 = Math.min(segs, Math.ceil(((z + padR + this.halfSize) / this.worldSize) * segs));
    if (ix0 > ix1 || iz0 > iz1) return false;

    const flattenTarget = mode === 'flatten' ? this.getHeightAt(x, z) : 0;

    if (mode === 'smooth') {
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          this._smoothScratch[iz * N + ix] = this.heights[iz * N + ix];
        }
      }
    }

    let modified = false;
    for (let iz = iz0; iz <= iz1; iz++) {
      const wz = (iz / segs - 0.5) * this.worldSize;
      for (let ix = ix0; ix <= ix1; ix++) {
        const wx = (ix / segs - 0.5) * this.worldSize;
        const dist = Math.hypot(wx - x, wz - z);
        if (dist >= radius) continue;

        const u = dist / radius;
        // Smooth cosine/quartic falloff with zero crease at brush edge
        const falloff = (1 - u * u) * (1 - u * u);
        const idx = iz * N + ix;
        const curH = this.heights[idx];
        let nextH = curH;

        if (mode === 'raise') {
          nextH = curH + falloff * strength * effDt * 3.2;
        } else if (mode === 'lower') {
          nextH = curH - falloff * strength * effDt * 3.2;
        } else if (mode === 'pond') {
          // Carve smooth natural pond basin down to -1.8m with gentle shoreline banks
          const bedNoise = (valueNoise2D(wx * 0.22, wz * 0.22, 709) - 0.5) * 0.22;
          const basinProfile = smoothstep(1.0, 0.32, u);
          const bankRimTarget = this.waterLevel + 0.16;
          const basinTarget = -1.8 + bedNoise;
          const desiredH = bankRimTarget + (basinTarget - bankRimTarget) * basinProfile;
          const blendRate = isOneShot
            ? clamp(falloff * strength * 1.15, 0, 1)
            : clamp(falloff * strength * effDt * 5.2, 0, 1);
          // Carve down toward pond profile (and gently settle steep overhanging banks)
          if (curH > desiredH) {
            nextH = curH + (desiredH - curH) * blendRate;
          } else if (u > 0.78 && curH < desiredH) {
            nextH = curH + (desiredH - curH) * blendRate * 0.25;
          }
        } else if (mode === 'flatten') {
          const rate = clamp(falloff * strength * (isOneShot ? 0.95 : effDt * 5.5), 0, 1);
          nextH = curH + (flattenTarget - curH) * rate;
        } else if (mode === 'smooth') {
          let sum = 0;
          let wSum = 0;
          for (let dz = -1; dz <= 1; dz++) {
            const nz = clamp(iz + dz, 0, segs);
            for (let dx = -1; dx <= 1; dx++) {
              const nx = clamp(ix + dx, 0, segs);
              const w = dx === 0 && dz === 0 ? 4 : dx === 0 || dz === 0 ? 2 : 1;
              const src =
                nx >= ix0 && nx <= ix1 && nz >= iz0 && nz <= iz1
                  ? this._smoothScratch[nz * N + nx]
                  : this.heights[nz * N + nx];
              sum += src * w;
              wSum += w;
            }
          }
          const avg = sum / wSum;
          const rate = clamp(falloff * strength * (isOneShot ? 0.9 : effDt * 6.5), 0, 1);
          nextH = curH + (avg - curH) * rate;
        }

        nextH = clamp(nextH, -3.5, 18.0);
        if (Math.abs(nextH - curH) > 1e-5) {
          this.heights[idx] = nextH;
          modified = true;
        }
      }
    }

    if (modified) {
      this._syncRegion(
        Math.max(0, ix0 - 2),
        Math.max(0, iz0 - 2),
        Math.min(segs, ix1 + 2),
        Math.min(segs, iz1 + 2),
        false
      );
      if (ix0 <= 1 || ix1 >= segs - 1 || iz0 <= 1 || iz1 >= segs - 1) {
        this._syncSkirtHeights();
      }
    }
    return modified;
  }

  _syncRegion(ix0, iz0, ix1, iz1, recomputeBounds = false) {
    const N = GRID_SIZE;
    const segs = N - 1;
    const step2 = (this.worldSize / segs) * 2;
    const posArr = this.posAttr.array;
    const normArr = this.normAttr.array;

    // 1. Update vertex Y positions
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const idx = iz * N + ix;
        posArr[idx * 3 + 1] = this.heights[idx];
      }
    }

    // 2. Recompute central-difference normals cleanly
    for (let iz = iz0; iz <= iz1; iz++) {
      const izPrev = Math.max(0, iz - 1);
      const izNext = Math.min(segs, iz + 1);
      const dzSpan = izNext === izPrev ? step2 * 0.5 : ((izNext - izPrev) * this.worldSize) / segs;

      for (let ix = ix0; ix <= ix1; ix++) {
        const ixPrev = Math.max(0, ix - 1);
        const ixNext = Math.min(segs, ix + 1);
        const dxSpan = ixNext === ixPrev ? step2 * 0.5 : ((ixNext - ixPrev) * this.worldSize) / segs;

        const hL = this.heights[iz * N + ixPrev];
        const hR = this.heights[iz * N + ixNext];
        const hD = this.heights[izPrev * N + ix];
        const hU = this.heights[izNext * N + ix];

        let nx = -(hR - hL) / dxSpan;
        let ny = 1.0;
        let nz = -(hU - hD) / dzSpan;
        const invLen = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx *= invLen;
        ny *= invLen;
        nz *= invLen;

        const nIdx = (iz * N + ix) * 3;
        this.normals[nIdx] = nx;
        this.normals[nIdx + 1] = ny;
        this.normals[nIdx + 2] = nz;

        normArr[nIdx] = nx;
        normArr[nIdx + 1] = ny;
        normArr[nIdx + 2] = nz;
      }
    }

    this.posAttr.needsUpdate = true;
    this.normAttr.needsUpdate = true;
    if (recomputeBounds) {
      this.geometry.computeBoundingBox();
      this.geometry.computeBoundingSphere();
    } else if (this.geometry.boundingSphere) {
      // Ensure sculpting tall hills never frustum-culls the terrain
      this.geometry.boundingSphere.radius = Math.max(this.geometry.boundingSphere.radius, this.worldSize * 0.85);
    }

    // 3. Update HalfFloat heightDataTexture for exact sub-texel alignment with WaterSystem & FoliageSystem
    this._updateHeightTextureRegion(ix0, iz0, ix1, iz1);
  }

  _updateHeightTextureRegion(ix0 = 0, iz0 = 0, ix1 = GRID_SIZE - 1, iz1 = GRID_SIZE - 1) {
    const N = GRID_SIZE;
    const segs = N - 1;
    const toHalf = THREE.DataUtils.toHalfFloat;
    const data = this._halfFloatData;
    const nVec = new THREE.Vector3();

    const tx0 = Math.max(0, ix0 - 1);
    const tx1 = Math.min(N - 1, ix1 + 1);
    const tz0 = Math.max(0, iz0 - 1);
    const tz1 = Math.min(N - 1, iz1 + 1);

    for (let tz = tz0; tz <= tz1; tz++) {
      // Exact texel center world coordinate matching GLSL uv = worldXZ / worldSize + 0.5
      const v = (tz + 0.5) / N;
      const wz = (v - 0.5) * this.worldSize;
      const gIz = Math.round(clamp(v, 0, 1) * segs);

      for (let tx = tx0; tx <= tx1; tx++) {
        const u = (tx + 0.5) / N;
        const wx = (u - 0.5) * this.worldSize;
        const gIx = Math.round(clamp(u, 0, 1) * segs);
        const gIdx = gIz * N + gIx;

        const h = this.getHeightAt(wx, wz);
        this.getNormalAt(wx, wz, nVec);
        const slope = clamp(1.0 - nVec.y, 0, 1);
        const pMask = this.pathMask[gIdx];
        const occMask = Math.max(pMask, this.buildingMask[gIdx]);
        this.occupancyMask[gIdx] = occMask;

        const outIdx = (tz * N + tx) * 4;
        data[outIdx] = toHalf(h);
        data[outIdx + 1] = toHalf(slope);
        data[outIdx + 2] = toHalf(pMask);
        data[outIdx + 3] = toHalf(occMask);
      }
    }

    this.heightDataTexture.needsUpdate = true;
  }

  addPath(points, opts = {}) {
    const width = clamp(opts.width ?? 2.2, 0.8, 7.0);
    const style = opts.style === 'dirt' ? 'dirt' : 'cobble';
    const resampled = resamplePolyline(points, 0.55);
    if (resampled.length < 2) return null;

    const id = opts.id || `path_${this._nextPathId++}`;
    const numMatch = /^path_(\d+)$/.exec(id);
    if (numMatch) {
      this._nextPathId = Math.max(this._nextPathId, Number(numMatch[1]) + 1);
    }

    const pathObj = { id, points: resampled, width, style };
    this.paths.push(pathObj);

    // Gently level cross-slope along above-water path segments while strictly preserving ponds for bridges!
    this._levelTerrainAlongPath(pathObj);
    this._rebuildPathMasks();
    return id;
  }

  _levelTerrainAlongPath(pathObj) {
    const pts = pathObj.points;
    if (pts.length < 2) return;
    const N = GRID_SIZE;
    const segs = N - 1;
    const halfW = pathObj.width * 0.5;
    const margin = halfW + 1.1;

    // Sample centerline heights first so leveling converges cleanly toward smooth spine
    const spineH = new Float32Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      spineH[i] = this.getHeightAt(pts[i].x, pts[i].z);
    }
    // Lightly smooth above-water spine heights along path length
    const smoothedSpine = new Float32Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      const hPrev = spineH[Math.max(0, i - 1)];
      const hCur = spineH[i];
      const hNext = spineH[Math.min(pts.length - 1, i + 1)];
      // Never pull underwater or near-bank points upward (preserves pond span for BridgeAndClutter!)
      if (hCur < this.waterLevel + 0.08 || hPrev < this.waterLevel + 0.05 || hNext < this.waterLevel + 0.05) {
        smoothedSpine[i] = hCur;
      } else {
        smoothedSpine[i] = hPrev * 0.22 + hCur * 0.56 + hNext * 0.22;
      }
    }

    let minIx = segs;
    let maxIx = 0;
    let minIz = segs;
    let maxIz = 0;
    let changed = false;

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const ha = smoothedSpine[i];
      const hb = smoothedSpine[i + 1];
      // Skip underwater / shoreline span completely so pond depth stays intact for arched bridges
      if (ha < this.waterLevel + 0.08 || hb < this.waterLevel + 0.08) continue;

      const x0 = Math.min(a.x, b.x) - margin;
      const x1 = Math.max(a.x, b.x) + margin;
      const z0 = Math.min(a.z, b.z) - margin;
      const z1 = Math.max(a.z, b.z) + margin;

      const ix0 = Math.max(0, Math.floor(((x0 + this.halfSize) / this.worldSize) * segs));
      const ix1 = Math.min(segs, Math.ceil(((x1 + this.halfSize) / this.worldSize) * segs));
      const iz0 = Math.max(0, Math.floor(((z0 + this.halfSize) / this.worldSize) * segs));
      const iz1 = Math.min(segs, Math.ceil(((z1 + this.halfSize) / this.worldSize) * segs));

      for (let iz = iz0; iz <= iz1; iz++) {
        const wz = (iz / segs - 0.5) * this.worldSize;
        for (let ix = ix0; ix <= ix1; ix++) {
          const idx = iz * N + ix;
          const curH = this.heights[idx];
          if (curH < this.waterLevel + 0.08) continue;

          const wx = (ix / segs - 0.5) * this.worldSize;
          const { dist, t } = distToSegment2D(wx, wz, a.x, a.z, b.x, b.z);
          if (dist >= margin) continue;

          const targetH = Math.max(this.waterLevel + 0.08, ha + (hb - ha) * t);
          const blend = (1.0 - smoothstep(halfW * 0.65, margin, dist)) * 0.45;
          this.heights[idx] = curH + (targetH - curH) * blend;
          changed = true;
          if (ix < minIx) minIx = ix;
          if (ix > maxIx) maxIx = ix;
          if (iz < minIz) minIz = iz;
          if (iz > maxIz) maxIz = iz;
        }
      }
    }

    if (changed) {
      this._syncRegion(
        Math.max(0, minIx - 2),
        Math.max(0, minIz - 2),
        Math.min(segs, maxIx + 2),
        Math.min(segs, maxIz + 2),
        false
      );
    }
  }

  removePathNear(x, z, radius = 3.0) {
    if (this.paths.length === 0) return false;
    const nextPaths = [];
    let modified = false;

    for (let pIdx = 0; pIdx < this.paths.length; pIdx++) {
      const path = this.paths[pIdx];
      const pts = path.points;
      let hitAny = false;
      const keep = new Uint8Array(pts.length);

      for (let i = 0; i < pts.length; i++) {
        const d = Math.hypot(pts[i].x - x, pts[i].z - z);
        let segHit = d <= radius;
        if (!segHit && i < pts.length - 1) {
          const s = distToSegment2D(x, z, pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z);
          if (s.dist <= radius + path.width * 0.35) segHit = true;
        }
        if (segHit) {
          hitAny = true;
          keep[i] = 0;
        } else {
          keep[i] = 1;
        }
      }

      if (!hitAny) {
        nextPaths.push(path);
        continue;
      }

      modified = true;
      // Split surviving contiguous runs >= 4 points (~2.2m) into clean sub-paths
      let run = [];
      let pieceIdx = 0;
      for (let i = 0; i <= pts.length; i++) {
        if (i < pts.length && keep[i]) {
          run.push(pts[i]);
        } else {
          if (run.length >= 4) {
            const subId = pieceIdx === 0 ? path.id : `path_${this._nextPathId++}`;
            pieceIdx++;
            nextPaths.push({
              id: subId,
              points: run.map((pt) => ({ x: pt.x, z: pt.z })),
              width: path.width,
              style: path.style
            });
          }
          run = [];
        }
      }
    }

    if (modified) {
      this.paths = nextPaths;
      this._rebuildPathMasks();
    }
    return modified;
  }

  getPaths() {
    return this.paths.map((p) => ({
      id: p.id,
      points: p.points.map((pt) => ({ x: pt.x, z: pt.z })),
      width: p.width,
      style: p.style
    }));
  }

  _rebuildPathMasks() {
    this.pathMask.fill(0);
    for (let i = 0; i < SPLAT_SIZE * SPLAT_SIZE; i++) {
      this._splatData[i * 4] = 0;
      this._splatData[i * 4 + 1] = 0;
      this._splatData[i * 4 + 2] = 128;
      this._splatData[i * 4 + 3] = 0;
    }

    const N = GRID_SIZE;
    const segs = N - 1;
    const splatSegs = SPLAT_SIZE - 1;

    for (let pIdx = 0; pIdx < this.paths.length; pIdx++) {
      const path = this.paths[pIdx];
      const pts = path.points;
      if (pts.length < 2) continue;

      const halfW = path.width * 0.5;
      const borderSpan = 0.55;
      const reach = halfW + borderSpan;
      const isDirt = path.style === 'dirt';

      for (let s = 0; s < pts.length - 1; s++) {
        const a = pts[s];
        const b = pts[s + 1];
        const minX = Math.min(a.x, b.x) - reach;
        const maxX = Math.max(a.x, b.x) + reach;
        const minZ = Math.min(a.z, b.z) - reach;
        const maxZ = Math.max(a.z, b.z) + reach;

        // 1. Rasterize into 512x512 visual splatTexture
        const sx0 = Math.max(0, Math.floor(((minX + this.halfSize) / this.worldSize) * splatSegs));
        const sx1 = Math.min(splatSegs, Math.ceil(((maxX + this.halfSize) / this.worldSize) * splatSegs));
        const sz0 = Math.max(0, Math.floor(((minZ + this.halfSize) / this.worldSize) * splatSegs));
        const sz1 = Math.min(splatSegs, Math.ceil(((maxZ + this.halfSize) / this.worldSize) * splatSegs));

        for (let sz = sz0; sz <= sz1; sz++) {
          const wz = ((sz + 0.5) / SPLAT_SIZE - 0.5) * this.worldSize;
          for (let sx = sx0; sx <= sx1; sx++) {
            const wx = ((sx + 0.5) / SPLAT_SIZE - 0.5) * this.worldSize;
            const { dist, signedDist } = distToSegment2D(wx, wz, a.x, a.z, b.x, b.z);
            if (dist >= reach) continue;

            const w = 1.0 - smoothstep(halfW * 0.72, halfW + 0.18, dist);
            const pebbleHalo =
              smoothstep(halfW * 0.65, halfW * 0.95, dist) * (1.0 - smoothstep(halfW + 0.05, reach, dist));

            const pBase = (sz * SPLAT_SIZE + sx) * 4;
            const wByte = Math.round(w * 255);
            const curMax = Math.max(this._splatData[pBase], this._splatData[pBase + 1]);

            if (isDirt) {
              if (wByte > this._splatData[pBase + 1]) this._splatData[pBase + 1] = wByte;
            } else {
              if (wByte > this._splatData[pBase]) this._splatData[pBase] = wByte;
            }

            if (wByte >= curMax && wByte > 8) {
              const crossNorm = clamp(signedDist / (halfW || 1), -1, 1) * 0.5 + 0.5;
              this._splatData[pBase + 2] = Math.round(crossNorm * 255);
            }

            const pByte = Math.round(pebbleHalo * 255);
            if (pByte > this._splatData[pBase + 3]) {
              this._splatData[pBase + 3] = pByte;
            }
          }
        }

        // 2. Rasterize into 256x256 pathMask (used to suppress grass & flowers cleanly on paths)
        const gx0 = Math.max(0, Math.floor(((minX + this.halfSize) / this.worldSize) * segs));
        const gx1 = Math.min(segs, Math.ceil(((maxX + this.halfSize) / this.worldSize) * segs));
        const gz0 = Math.max(0, Math.floor(((minZ + this.halfSize) / this.worldSize) * segs));
        const gz1 = Math.min(segs, Math.ceil(((maxZ + this.halfSize) / this.worldSize) * segs));

        for (let gz = gz0; gz <= gz1; gz++) {
          const wz = (gz / segs - 0.5) * this.worldSize;
          for (let gx = gx0; gx <= gx1; gx++) {
            const wx = (gx / segs - 0.5) * this.worldSize;
            const { dist } = distToSegment2D(wx, wz, a.x, a.z, b.x, b.z);
            if (dist >= halfW + 0.45) continue;
            // Pad slightly so grass never clips inside path cobbles
            const pm = 1.0 - smoothstep(halfW - 0.05, halfW + 0.42, dist);
            const gIdx = gz * N + gx;
            if (pm > this.pathMask[gIdx]) this.pathMask[gIdx] = pm;
          }
        }
      }
    }

    this.splatTexture.needsUpdate = true;
    this._updateHeightTextureRegion(0, 0, segs, segs);
  }

  syncFootprints(footprints = []) {
    this.footprints = Array.isArray(footprints) ? footprints : [];
    this.buildingMask.fill(0);

    const N = GRID_SIZE;
    const segs = N - 1;
    // Generous pad ensures bilinear sampling never lets grass blades poke inside building floors or walls
    const padSolid = 0.38;
    const padFade = 0.78;

    for (let f = 0; f < this.footprints.length; f++) {
      const fp = this.footprints[f];
      if (!fp) continue;

      if (fp.type === 'obb') {
        const boundR = Math.hypot((fp.width || 4) * 0.5, (fp.depth || 4) * 0.5) + padFade + 0.5;
        const gx0 = Math.max(0, Math.floor(((fp.x - boundR + this.halfSize) / this.worldSize) * segs));
        const gx1 = Math.min(segs, Math.ceil(((fp.x + boundR + this.halfSize) / this.worldSize) * segs));
        const gz0 = Math.max(0, Math.floor(((fp.z - boundR + this.halfSize) / this.worldSize) * segs));
        const gz1 = Math.min(segs, Math.ceil(((fp.z + boundR + this.halfSize) / this.worldSize) * segs));

        for (let gz = gz0; gz <= gz1; gz++) {
          const wz = (gz / segs - 0.5) * this.worldSize;
          for (let gx = gx0; gx <= gx1; gx++) {
            const wx = (gx / segs - 0.5) * this.worldSize;
            const sd = pointToObbSignedDist(wx, wz, fp);
            if (sd >= padFade) continue;
            const m = 1.0 - smoothstep(padSolid, padFade, sd);
            const idx = gz * N + gx;
            if (m > this.buildingMask[idx]) this.buildingMask[idx] = m;
          }
        }
      } else if (fp.type === 'circle') {
        const r = fp.radius || 2.5;
        const boundR = r + padFade + 0.5;
        const gx0 = Math.max(0, Math.floor(((fp.x - boundR + this.halfSize) / this.worldSize) * segs));
        const gx1 = Math.min(segs, Math.ceil(((fp.x + boundR + this.halfSize) / this.worldSize) * segs));
        const gz0 = Math.max(0, Math.floor(((fp.z - boundR + this.halfSize) / this.worldSize) * segs));
        const gz1 = Math.min(segs, Math.ceil(((fp.z + boundR + this.halfSize) / this.worldSize) * segs));

        for (let gz = gz0; gz <= gz1; gz++) {
          const wz = (gz / segs - 0.5) * this.worldSize;
          for (let gx = gx0; gx <= gx1; gx++) {
            const wx = (gx / segs - 0.5) * this.worldSize;
            const sd = Math.hypot(wx - fp.x, wz - fp.z) - r;
            if (sd >= padFade) continue;
            const m = 1.0 - smoothstep(padSolid, padFade, sd);
            const idx = gz * N + gx;
            if (m > this.buildingMask[idx]) this.buildingMask[idx] = m;
          }
        }
      } else if (fp.type === 'polyline' && Array.isArray(fp.points) && fp.points.length >= 2) {
        const hw = fp.halfWidth ?? 0.45;
        const reach = hw + padFade;
        const pts = fp.points;
        for (let s = 0; s < pts.length - 1; s++) {
          const a = pts[s];
          const b = pts[s + 1];
          const gx0 = Math.max(0, Math.floor(((Math.min(a.x, b.x) - reach + this.halfSize) / this.worldSize) * segs));
          const gx1 = Math.min(segs, Math.ceil(((Math.max(a.x, b.x) + reach + this.halfSize) / this.worldSize) * segs));
          const gz0 = Math.max(0, Math.floor(((Math.min(a.z, b.z) - reach + this.halfSize) / this.worldSize) * segs));
          const gz1 = Math.min(segs, Math.ceil(((Math.max(a.z, b.z) + reach + this.halfSize) / this.worldSize) * segs));

          for (let gz = gz0; gz <= gz1; gz++) {
            const wz = (gz / segs - 0.5) * this.worldSize;
            for (let gx = gx0; gx <= gx1; gx++) {
              const wx = (gx / segs - 0.5) * this.worldSize;
              const { dist } = distToSegment2D(wx, wz, a.x, a.z, b.x, b.z);
              const sd = dist - hw;
              if (sd >= padFade) continue;
              const m = 1.0 - smoothstep(0.22, padFade, sd);
              const idx = gz * N + gx;
              if (m > this.buildingMask[idx]) this.buildingMask[idx] = m;
            }
          }
        }
      }
    }

    this._updateHeightTextureRegion(0, 0, segs, segs);
  }

  isPointBlockedByFootprint(x, z, extraRadius = 0.0) {
    for (let f = 0; f < this.footprints.length; f++) {
      const fp = this.footprints[f];
      if (!fp) continue;
      if (fp.type === 'obb') {
        if (pointToObbSignedDist(x, z, fp) < extraRadius) return true;
      } else if (fp.type === 'circle') {
        if (Math.hypot(x - fp.x, z - fp.z) < (fp.radius || 2.5) + extraRadius) return true;
      } else if (fp.type === 'polyline' && Array.isArray(fp.points)) {
        const hw = (fp.halfWidth ?? 0.45) + extraRadius;
        for (let s = 0; s < fp.points.length - 1; s++) {
          const a = fp.points[s];
          const b = fp.points[s + 1];
          if (distToSegment2D(x, z, a.x, a.z, b.x, b.z).dist < hw) return true;
        }
      }
    }
    return false;
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
  }

  update(dt, elapsed, envState = {}) {
    this.uniforms.uTime.value = elapsed;
    if (envState.nightFactor !== undefined) {
      this.uniforms.uNightFactor.value = envState.nightFactor;
    }
    if (envState.sunDirection) {
      this.uniforms.uSunDirection.value.copy(envState.sunDirection);
    }
    if (envState.season && envState.season !== this.season) {
      this.setSeason(envState.season);
    }
  }

  serialize() {
    // Compact millimeter-precision Int16 Base64 encoding for fast HistoryManager snapshots & JSON saves
    const count = this.heights.length;
    const q = new Int16Array(count);
    for (let i = 0; i < count; i++) {
      q[i] = Math.round(clamp(this.heights[i], -32, 32) * 1000);
    }
    const bytes = new Uint8Array(q.buffer);
    let bin = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    const heightsB64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64');

    return {
      heightsB64,
      paths: this.getPaths(),
      season: this.season,
      nextPathId: this._nextPathId
    };
  }

  deserialize(data) {
    if (!data) return;
    if (typeof data.heightsB64 === 'string') {
      const bin =
        typeof atob === 'function'
          ? atob(data.heightsB64)
          : Buffer.from(data.heightsB64, 'base64').toString('binary');
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      const q = new Int16Array(bytes.buffer);
      const len = Math.min(this.heights.length, q.length);
      for (let i = 0; i < len; i++) {
        this.heights[i] = q[i] / 1000;
      }
    } else if (Array.isArray(data.heights)) {
      const len = Math.min(this.heights.length, data.heights.length);
      for (let i = 0; i < len; i++) {
        this.heights[i] = data.heights[i];
      }
    }

    this.paths = Array.isArray(data.paths)
      ? data.paths.map((p) => ({
          id: p.id || `path_${this._nextPathId++}`,
          points: Array.isArray(p.points) ? p.points.map((pt) => ({ x: pt.x, z: pt.z })) : [],
          width: p.width ?? 2.2,
          style: p.style === 'dirt' ? 'dirt' : 'cobble'
        }))
      : [];

    if (Number.isFinite(data.nextPathId)) {
      this._nextPathId = data.nextPathId;
    }
    if (data.season) {
      this.setSeason(data.season);
    }

    this._syncRegion(0, 0, GRID_SIZE - 1, GRID_SIZE - 1, true);
    this._syncSkirtHeights();
    this._rebuildPathMasks();
  }

  clear() {
    this.initRollingMeadow(42);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.heightDataTexture.dispose();
    this.splatTexture.dispose();
    this.detailTexture.dispose();
    if (this.skirtMesh) {
      this.scene.remove(this.skirtMesh);
      this.skirtMesh.geometry.dispose();
      this.skirtMesh.material.dispose();
    }
  }
}
