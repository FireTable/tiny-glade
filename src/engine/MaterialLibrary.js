import * as THREE from 'three';

const ROOF_PALETTES = {
  terracotta: '#b8573b',
  slate: '#47586c',
  moss: '#556e48',
  ochre: '#c48d3f',
  plum: '#6d4b5b',
};

const WALL_PALETTES = {
  limestone: '#d9d2c5',
  cotswold: '#dfc89f',
  granite: '#9aa0a6',
  plaster: '#efe6d5',
};

const SEASON_CONFIG = {
  summer: { tint: new THREE.Vector3(1.0, 1.0, 1.0), moss: 0.42 },
  spring: { tint: new THREE.Vector3(0.95, 1.06, 0.92), moss: 0.52 },
  autumn: { tint: new THREE.Vector3(1.14, 0.92, 0.74), moss: 0.34 },
};

// Fast deterministic 32-bit integer hash in [0, 1)
function hash2i(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

function fade(t) {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6));
  return t * t * (3.0 - 2.0 * t);
}

// Tileable periodic value noise on [0, 1) x [0, 1) with integer period
function periodicNoise(u, v, period, seed) {
  const px = u * period;
  const py = v * period;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = fade(px - ix);
  const fy = fade(py - iy);

  const x0 = ((ix % period) + period) % period;
  const y0 = ((iy % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;

  const n00 = hash2i(x0, y0, seed);
  const n10 = hash2i(x1, y0, seed);
  const n01 = hash2i(x0, y1, seed);
  const n11 = hash2i(x1, y1, seed);

  return lerp(lerp(n00, n10, fx), lerp(n01, n11, fx), fy);
}

function periodicFbm(u, v, basePeriod, octaves, seed, persistence = 0.5) {
  let sum = 0.0;
  let amp = 1.0;
  let norm = 0.0;
  let period = basePeriod;
  for (let i = 0; i < octaves; i++) {
    sum += amp * periodicNoise(u, v, period, seed + i * 97);
    norm += amp;
    amp *= persistence;
    period *= 2;
  }
  return sum / norm;
}

// Tileable periodic Worley cellular noise returning f1, f2, edge (f2 - f1), and cellHash
function periodicWorley(u, v, cells, seed, jitter = 0.85, out) {
  const px = u * cells;
  const py = v * cells;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;

  let d1 = 99.0;
  let d2 = 99.0;
  let bestHash = 0.5;

  for (let dy = -1; dy <= 1; dy++) {
    const cy = (((iy + dy) % cells) + cells) % cells;
    for (let dx = -1; dx <= 1; dx++) {
      const cx = (((ix + dx) % cells) + cells) % cells;
      const rx = dx + 0.5 + (hash2i(cx, cy, seed) - 0.5) * jitter - fx;
      const ry = dy + 0.5 + (hash2i(cx, cy, seed + 311) - 0.5) * jitter - fy;
      const dist = Math.sqrt(rx * rx + ry * ry);
      if (dist < d1) {
        d2 = d1;
        d1 = dist;
        bestHash = hash2i(cx, cy, seed + 733);
      } else if (dist < d2) {
        d2 = dist;
      }
    }
  }

  out.f1 = d1;
  out.f2 = d2;
  out.edge = d2 - d1;
  out.id = bestHash;
  return out;
}

function createDataTex(data, size, isSRGB, maxAnisotropy) {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = isSRGB ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

function synthesizePBRSet(size, normalStrength, maxAnisotropy, evalPixel) {
  const total = size * size;
  const heights = new Float32Array(total);
  const albedoData = new Uint8Array(total * 4);
  const roughData = new Uint8Array(total * 4);
  const aoData = new Uint8Array(total * 4);
  const normalData = new Uint8Array(total * 4);

  const sample = { r: 1, g: 1, b: 1, height: 0.5, rough: 0.8, ao: 1.0 };
  const invSize = 1.0 / size;

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * invSize;
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * invSize;
      evalPixel(u, v, sample);

      const idx = row + x;
      heights[idx] = sample.height;

      const p4 = idx * 4;
      albedoData[p4] = Math.round(clamp01(sample.r) * 255);
      albedoData[p4 + 1] = Math.round(clamp01(sample.g) * 255);
      albedoData[p4 + 2] = Math.round(clamp01(sample.b) * 255);
      albedoData[p4 + 3] = 255;

      const rg = Math.round(clamp01(sample.rough) * 255);
      roughData[p4] = rg;
      roughData[p4 + 1] = rg;
      roughData[p4 + 2] = rg;
      roughData[p4 + 3] = 255;

      const ao = Math.round(clamp01(sample.ao) * 255);
      aoData[p4] = ao;
      aoData[p4 + 1] = ao;
      aoData[p4 + 2] = ao;
      aoData[p4 + 3] = 255;
    }
  }

  // Wrapped 3x3 Sobel filter over periodic heightfield for seamless tangent normals
  const mask = size - 1;
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1) & mask) * size;
    const yc = y * size;
    const yp = ((y + 1) & mask) * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1) & mask;
      const xp = (x + 1) & mask;

      const tl = heights[ym + xm];
      const tc = heights[ym + x];
      const tr = heights[ym + xp];
      const ml = heights[yc + xm];
      const mr = heights[yc + xp];
      const bl = heights[yp + xm];
      const bc = heights[yp + x];
      const br = heights[yp + xp];

      const dX = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
      const dY = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr);

      let nx = -dX * normalStrength;
      let ny = -dY * normalStrength;
      let nz = 1.0;
      const invLen = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const p4 = (yc + x) * 4;
      normalData[p4] = Math.round((nx * 0.5 + 0.5) * 255);
      normalData[p4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalData[p4 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normalData[p4 + 3] = 255;
    }
  }

  return {
    map: createDataTex(albedoData, size, true, maxAnisotropy),
    normalMap: createDataTex(normalData, size, false, maxAnisotropy),
    roughnessMap: createDataTex(roughData, size, false, maxAnisotropy),
    aoMap: createDataTex(aoData, size, false, maxAnisotropy),
  };
}

export class MaterialLibrary {
  constructor(renderer, opts = {}) {
    const maxAnisotropy = Math.min(
      opts.maxAnisotropy || (renderer ? renderer.capabilities.getMaxAnisotropy() : 8) || 8,
      16
    );
    const texSize = opts.textureSize || 512;

    this._textures = [];
    this._materials = [];

    this.sharedUniforms = {
      uSunDirection: { value: new THREE.Vector3(0.55, 0.42, 0.72).normalize() },
      uNightFactor: { value: 0.0 },
      uSeasonTint: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
      uMossAmount: { value: 0.42 },
      uElapsed: { value: 0.0 },
      uWindStrength: { value: 0.45 },
      uWaterLevel: { value: opts.waterLevel ?? -0.35 },
    };

    const wCell = { f1: 0, f2: 0, edge: 0, id: 0 };
    const wCellFine = { f1: 0, f2: 0, edge: 0, id: 0 };

    // 1. Stone Wall PBR Set: quarried limestone/ashlar facets, mortar micro-fissures, mineral grain
    const stoneMaps = synthesizePBRSet(texSize, 2.35, maxAnisotropy, (u, v, out) => {
      const warpX = periodicFbm(u, v, 6, 3, 101) - 0.5;
      const warpY = periodicFbm(u, v, 6, 3, 211) - 0.5;
      const wu = (u + warpX * 0.05 + 1.0) % 1.0;
      const wv = (v + warpY * 0.035 + 1.0) % 1.0;

      periodicWorley(wu, wv, 7, 307, 0.82, wCell);
      periodicWorley(u, v, 20, 419, 0.9, wCellFine);
      const grain = periodicFbm(u, v, 16, 4, 523, 0.55);
      const strata = periodicFbm(u * 0.5, v, 10, 3, 617, 0.5);
      const pores = smoothstep(0.22, 0.04, wCellFine.f1);

      const crevice = smoothstep(0.0, 0.13, wCell.edge);
      const facetSlope = (wCell.id - 0.5) * 0.16;
      out.height =
        crevice * (0.62 + facetSlope + grain * 0.24 + strata * 0.14) - pores * 0.12;

      const warmShift = (wCell.id - 0.5) * 0.06;
      const baseTone = lerp(0.76, 0.95 + (grain - 0.5) * 0.12, crevice) - pores * 0.06;
      out.r = baseTone + warmShift * 0.65 + (1.0 - crevice) * 0.03;
      out.g = baseTone + warmShift * 0.25;
      out.b = baseTone - warmShift * 0.45 - (1.0 - crevice) * 0.02;
      out.rough = lerp(0.95, 0.78 + (1.0 - grain) * 0.14, crevice) + pores * 0.05;
      out.ao = lerp(0.56, 0.98 - pores * 0.12, crevice);
    });
    this._registerMapSet(stoneMaps);

    // 2. Roof Tile PBR Set: overlapping weathered shingles with subtle course shadow & grain
    const roofMaps = synthesizePBRSet(texSize, 2.6, maxAnisotropy, (u, v, out) => {
      const courses = 9.0;
      const cols = 7.0;
      const fyCourse = v * courses;
      const rowIdx = Math.floor(fyCourse);
      const rowFrac = fyCourse - rowIdx;
      const stagger = (rowIdx & 1) * 0.5;
      const fxCol = u * cols + stagger;
      const colIdx = ((Math.floor(fxCol) % cols) + cols) % cols;
      const rMod = ((rowIdx % courses) + courses) % courses;
      const colFrac = fxCol - Math.floor(fxCol);

      const tileId = hash2i(colIdx, rMod, 911);
      const tiltJitter = (hash2i(colIdx, rMod, 977) - 0.5) * 0.08;
      const striation = periodicFbm(u * 2.0, v, 24, 3, 1031, 0.55);
      const chip = periodicFbm(u, v, 14, 3, 1103, 0.5);

      const sideGap = smoothstep(0.0, 0.065, Math.min(colFrac, 1.0 - colFrac));
      const lipCurve = Math.sin(colFrac * Math.PI) * 0.035;
      const underLip = smoothstep(0.04, 0.16 + lipCurve * 0.5, rowFrac);
      const slopeHeight = 0.28 + (1.0 - rowFrac) * 0.52 + tiltJitter;

      out.height =
        sideGap * underLip * slopeHeight + striation * 0.12 + (chip - 0.5) * 0.06;

      const shade =
        lerp(0.68, 0.94 + (tileId - 0.5) * 0.11, sideGap * underLip) +
        (striation - 0.5) * 0.08;
      out.r = shade + (tileId - 0.5) * 0.03;
      out.g = shade;
      out.b = shade - (tileId - 0.5) * 0.02;
      out.rough = lerp(0.92, 0.66 + (1.0 - striation) * 0.2, sideGap * underLip);
      out.ao = lerp(0.48, 0.99, smoothstep(0.0, 0.22, rowFrac) * sideGap);
    });
    this._registerMapSet(roofMaps);

    // 3. Timber PBR Set: warm oak planks, elongated wood fibers, growth rings, subtle knots
    const timberMaps = synthesizePBRSet(texSize, 1.9, maxAnisotropy, (u, v, out) => {
      const planks = 4.0;
      const pu = u * planks;
      const pIdx = ((Math.floor(pu) % planks) + planks) % planks;
      const pFrac = pu - Math.floor(pu);
      const plankSeed = hash2i(pIdx, 3, 1301);

      const fibers = periodicFbm(u, v, 8, 4, 1409, 0.58);
      const fineGrain = periodicNoise((u * 4.0) % 1.0, v, 48, 1481);
      const ringCoord =
        (u * 5.0 + plankSeed * 2.0 + (fibers - 0.5) * 0.45) * Math.PI * 6.0;
      const rings = 0.5 + 0.5 * Math.sin(ringCoord);

      const seam = smoothstep(0.0, 0.045, Math.min(pFrac, 1.0 - pFrac));
      out.height = seam * (0.55 + rings * 0.2 + fineGrain * 0.18 + fibers * 0.1);

      const tone =
        lerp(0.62, 0.88 + (plankSeed - 0.5) * 0.1, seam) *
        (0.88 + rings * 0.12 + (fineGrain - 0.5) * 0.07);
      out.r = tone * 1.03;
      out.g = tone * 0.97;
      out.b = tone * 0.9;
      out.rough = lerp(0.95, 0.72 + (1.0 - rings) * 0.16, seam);
      out.ao = lerp(0.52, 0.98, seam);
    });
    this._registerMapSet(timberMaps);

    // 4. Plaster PBR Set: hand-troweled limewash stucco daub
    const plasterMaps = synthesizePBRSet(texSize, 1.35, maxAnisotropy, (u, v, out) => {
      const swirlX = periodicFbm(u, v, 5, 3, 1601) - 0.5;
      const swirlY = periodicFbm(u, v, 5, 3, 1699) - 0.5;
      const su = (u + swirlX * 0.08 + 1.0) % 1.0;
      const sv = (v + swirlY * 0.08 + 1.0) % 1.0;

      const daub = periodicFbm(su, sv, 7, 4, 1747, 0.55);
      const sandGrit = periodicNoise(u, v, 64, 1811);
      out.height = daub * 0.72 + sandGrit * 0.28;

      const lum = 0.93 + (daub - 0.5) * 0.09 + (sandGrit - 0.5) * 0.04;
      out.r = lum * 1.01;
      out.g = lum * 0.995;
      out.b = lum * 0.965;
      out.rough = 0.84 + (1.0 - daub) * 0.12;
      out.ao = 0.88 + daub * 0.12;
    });
    this._registerMapSet(plasterMaps);

    // 5. Cobblestone PBR Set: rounded river cobbles with recessed sandy mortar
    const cobbleMaps = synthesizePBRSet(texSize, 3.1, maxAnisotropy, (u, v, out) => {
      const warpU = (u + (periodicFbm(u, v, 8, 2, 1907) - 0.5) * 0.025 + 1.0) % 1.0;
      const warpV = (v + (periodicFbm(u, v, 8, 2, 1993) - 0.5) * 0.025 + 1.0) % 1.0;
      periodicWorley(warpU, warpV, 10, 2053, 0.82, wCell);
      const micro = periodicFbm(u, v, 24, 3, 2137, 0.5);

      const mortarMask = smoothstep(0.03, 0.18, wCell.edge);
      const crown = Math.sqrt(clamp01(1.0 - wCell.f1 * 1.35));
      out.height = mortarMask * (0.35 + crown * 0.55) + micro * 0.12;

      const stoneVar = (wCell.id - 0.5) * 0.18;
      const stoneLum = 0.86 + stoneVar + (micro - 0.5) * 0.08;
      const mortarLum = 0.68 + (micro - 0.5) * 0.08;

      out.r = lerp(mortarLum * 1.04, stoneLum + stoneVar * 0.25, mortarMask);
      out.g = lerp(mortarLum * 1.0, stoneLum, mortarMask);
      out.b = lerp(mortarLum * 0.92, stoneLum - stoneVar * 0.2, mortarMask);
      out.rough = lerp(0.95, 0.55 + (1.0 - crown) * 0.22 + (1.0 - micro) * 0.1, mortarMask);
      out.ao = lerp(0.44, 0.86 + crown * 0.14, mortarMask);
    });
    this._registerMapSet(cobbleMaps);

    // 6. Foliage PBR Set: painterly leaf clusters & subtle waxy veins
    const foliageMaps = synthesizePBRSet(texSize, 1.85, maxAnisotropy, (u, v, out) => {
      periodicWorley(u, v, 14, 2311, 0.9, wCell);
      const leafFbm = periodicFbm(u, v, 12, 4, 2399, 0.55);
      const leafDome = smoothstep(0.62, 0.05, wCell.f1);

      out.height = leafDome * 0.68 + leafFbm * 0.32;
      const lum = 0.82 + leafDome * 0.15 + (wCell.id - 0.5) * 0.1 + (leafFbm - 0.5) * 0.08;
      out.r = lum * 0.96;
      out.g = lum * 1.03;
      out.b = lum * 0.91;
      out.rough = 0.62 + (1.0 - leafDome) * 0.24;
      out.ao = 0.66 + leafDome * 0.34;
    });
    this._registerMapSet(foliageMaps);

    // 7. Window Glass PBR Set: leaded diamond/cottage casement mullions + wavy blown glass
    const windowMaps = synthesizePBRSet(texSize, 1.6, maxAnisotropy, (u, v, out) => {
      const gridU = Math.abs(((u * 3.0) % 1.0) - 0.5);
      const gridV = Math.abs(((v * 4.0) % 1.0) - 0.5);
      const diagA = Math.abs((((u * 3.0 + v * 3.0) % 1.0) + 1.0) % 1.0 - 0.5);
      const diagB = Math.abs((((u * 3.0 - v * 3.0) % 1.0) + 1.0) % 1.0 - 0.5);

      const rectLead = Math.min(gridU, gridV);
      const diamLead = Math.min(diagA, diagB);
      const leadDist = Math.min(rectLead, diamLead * 1.35 + 0.02);
      const glassMask = smoothstep(0.028, 0.058, leadDist);

      const wavy = periodicFbm(u, v, 6, 3, 2557, 0.5);
      out.height = lerp(0.88, 0.35 + wavy * 0.25, glassMask);

      // Encode glass mask in albedo brightness so mullions silhouette cleanly at night
      out.r = lerp(0.18, 0.85, glassMask);
      out.g = lerp(0.19, 0.9, glassMask);
      out.b = lerp(0.21, 0.96, glassMask);
      out.rough = lerp(0.68, 0.09 + wavy * 0.08, glassMask);
      out.ao = lerp(0.55, 1.0, glassMask);
    });
    this._registerMapSet(windowMaps);

    // 8. Fabric PBR Set: woven canvas / medieval pennant cloth weave
    const fabricMaps = synthesizePBRSet(texSize, 1.45, maxAnisotropy, (u, v, out) => {
      const warp = 0.5 + 0.5 * Math.sin(u * Math.PI * 96.0);
      const weft = 0.5 + 0.5 * Math.sin(v * Math.PI * 96.0);
      const checker = ((Math.floor(u * 48.0) + Math.floor(v * 48.0)) & 1) === 0;
      const thread = checker ? warp * 0.7 + 0.3 : weft * 0.7 + 0.3;
      const folds = periodicFbm(u, v, 5, 3, 2713, 0.5);

      out.height = thread * 0.45 + folds * 0.55;
      const lum = 0.88 + thread * 0.09 + (folds - 0.5) * 0.08;
      out.r = lum;
      out.g = lum * 0.99;
      out.b = lum * 0.96;
      out.rough = 0.82 + (1.0 - thread) * 0.14;
      out.ao = 0.82 + thread * 0.18;
    });
    this._registerMapSet(fabricMaps);

    // Create enhanced MeshStandardMaterials
    // Neutral white base on stoneWall & roofTile so vertexColors / instanceColor / cloned color tint accurately without double-darkening
    this.stoneWall = this._createEnhancedMaterial('stoneWall', {
      color: 0xffffff,
      map: stoneMaps.map,
      normalMap: stoneMaps.normalMap,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughnessMap: stoneMaps.roughnessMap,
      aoMap: stoneMaps.aoMap,
      aoMapIntensity: 0.75,
      roughness: 0.88,
      metalness: 0.02,
      vertexColors: true,
    }, {
      triplanarScale: 0.42,
      triplanarMix: 0.85,
      mossWeight: 0.95,
      groundAoWeight: 1.0,
      defaultTintHex: WALL_PALETTES.limestone,
    });

    this.roofTile = this._createEnhancedMaterial('roofTile', {
      color: 0xffffff,
      map: roofMaps.map,
      normalMap: roofMaps.normalMap,
      normalScale: new THREE.Vector2(1.05, 1.05),
      roughnessMap: roofMaps.roughnessMap,
      aoMap: roofMaps.aoMap,
      aoMapIntensity: 0.7,
      roughness: 0.78,
      metalness: 0.03,
      vertexColors: true,
    }, {
      triplanarScale: 0.55,
      triplanarMix: 0.72,
      mossWeight: 0.72,
      groundAoWeight: 0.35,
      defaultTintHex: ROOF_PALETTES.terracotta,
    });

    this.timber = this._createEnhancedMaterial('timber', {
      color: '#8a5e3c',
      map: timberMaps.map,
      normalMap: timberMaps.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughnessMap: timberMaps.roughnessMap,
      aoMap: timberMaps.aoMap,
      aoMapIntensity: 0.65,
      roughness: 0.84,
      metalness: 0.02,
      vertexColors: true,
    }, {
      triplanarScale: 0.52,
      triplanarMix: 0.82,
      mossWeight: 0.35,
      groundAoWeight: 0.75,
      defaultTintHex: '#ffffff',
    });

    this.plaster = this._createEnhancedMaterial('plaster', {
      color: WALL_PALETTES.plaster,
      map: plasterMaps.map,
      normalMap: plasterMaps.normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughnessMap: plasterMaps.roughnessMap,
      aoMap: plasterMaps.aoMap,
      aoMapIntensity: 0.55,
      roughness: 0.9,
      metalness: 0.01,
      vertexColors: true,
    }, {
      triplanarScale: 0.38,
      triplanarMix: 0.88,
      mossWeight: 0.25,
      groundAoWeight: 0.85,
      defaultTintHex: '#ffffff',
    });

    this.cobble = this._createEnhancedMaterial('cobble', {
      color: '#a8a196',
      map: cobbleMaps.map,
      normalMap: cobbleMaps.normalMap,
      normalScale: new THREE.Vector2(1.15, 1.15),
      roughnessMap: cobbleMaps.roughnessMap,
      aoMap: cobbleMaps.aoMap,
      aoMapIntensity: 0.85,
      roughness: 0.8,
      metalness: 0.03,
      vertexColors: true,
    }, {
      triplanarScale: 0.48,
      triplanarMix: 0.9,
      mossWeight: 0.8,
      groundAoWeight: 0.9,
      defaultTintHex: '#ffffff',
    });

    this.foliage = this._createEnhancedMaterial('foliage', {
      color: '#527a3d',
      map: foliageMaps.map,
      normalMap: foliageMaps.normalMap,
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughnessMap: foliageMaps.roughnessMap,
      aoMap: foliageMaps.aoMap,
      aoMapIntensity: 0.65,
      roughness: 0.76,
      metalness: 0.0,
      side: THREE.DoubleSide,
      vertexColors: true,
    }, {
      triplanarScale: 0.65,
      triplanarMix: 0.78,
      mossWeight: 0.0,
      groundAoWeight: 0.45,
      isFoliage: true,
      swayScale: 0.038,
      defaultTintHex: '#ffffff',
    });

    this.windowGlass = this._createEnhancedMaterial('windowGlass', {
      color: '#2c4156',
      map: windowMaps.map,
      normalMap: windowMaps.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: windowMaps.roughnessMap,
      aoMap: windowMaps.aoMap,
      aoMapIntensity: 0.5,
      roughness: 0.14,
      metalness: 0.18,
      envMapIntensity: 1.55,
    }, {
      triplanarScale: 1.35,
      triplanarMix: 0.92,
      mossWeight: 0.0,
      groundAoWeight: 0.0,
      isWindowGlass: true,
    });

    this.lanternEmissive = this._createEnhancedMaterial('lanternEmissive', {
      color: '#ffe0a3',
      emissive: new THREE.Color('#ff9d3b'),
      emissiveIntensity: 1.2,
      roughness: 0.28,
      metalness: 0.0,
    }, {
      triplanarScale: 1.0,
      triplanarMix: 0.0,
      mossWeight: 0.0,
      groundAoWeight: 0.0,
      isLantern: true,
    });

    this.fabric = this._createEnhancedMaterial('fabric', {
      color: 0xffffff,
      map: fabricMaps.map,
      normalMap: fabricMaps.normalMap,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughnessMap: fabricMaps.roughnessMap,
      aoMap: fabricMaps.aoMap,
      aoMapIntensity: 0.5,
      roughness: 0.88,
      metalness: 0.01,
      side: THREE.DoubleSide,
      vertexColors: true,
    }, {
      triplanarScale: 0.85,
      triplanarMix: 0.6,
      mossWeight: 0.0,
      groundAoWeight: 0.2,
      isFabric: true,
      swayScale: 0.015,
      defaultTintHex: '#c95b45',
    });
  }

  _registerMapSet(set) {
    this._textures.push(set.map, set.normalMap, set.roughnessMap, set.aoMap);
  }

  _createEnhancedMaterial(kind, matParams, shaderOpts) {
    const mat = new THREE.MeshStandardMaterial(matParams);
    mat.name = kind;
    this._enhanceMaterialInstance(mat, kind, shaderOpts);
    this._materials.push(mat);
    return mat;
  }

  _enhanceMaterialInstance(mat, kind, shaderOpts) {
    const shared = this.sharedUniforms;
    const libraryRef = this;

    mat.userData.tgKind = kind;
    mat.userData.tgDefaultTint = shaderOpts.defaultTintHex
      ? new THREE.Color(shaderOpts.defaultTintHex)
      : null;
    mat.userData.tgIsRootMaterial = true;

    const cacheKey = `tg-pbr-v1-${kind}-${shaderOpts.isFoliage ? 1 : 0}-${shaderOpts.isWindowGlass ? 1 : 0}-${shaderOpts.isLantern ? 1 : 0}-${shaderOpts.isFabric ? 1 : 0}`;
    mat.customProgramCacheKey = () => cacheKey;

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSunDirection = shared.uSunDirection;
      shader.uniforms.uNightFactor = shared.uNightFactor;
      shader.uniforms.uSeasonTint = shared.uSeasonTint;
      shader.uniforms.uMossAmount = shared.uMossAmount;
      shader.uniforms.uElapsed = shared.uElapsed;
      shader.uniforms.uWindStrength = shared.uWindStrength;
      shader.uniforms.uWaterLevel = shared.uWaterLevel;
      shader.uniforms.uTriplanarScale = { value: shaderOpts.triplanarScale ?? 0.45 };
      shader.uniforms.uTriplanarMix = { value: shaderOpts.triplanarMix ?? 0.8 };
      shader.uniforms.uMossWeight = { value: shaderOpts.mossWeight ?? 0.0 };
      shader.uniforms.uGroundAoWeight = { value: shaderOpts.groundAoWeight ?? 0.0 };
      shader.uniforms.uSwayScale = { value: shaderOpts.swayScale ?? 0.0 };

      // Vertex shader: world-space position & normal varyings + gentle foliage/fabric flutter
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uElapsed;
          uniform float uWindStrength;
          uniform float uSwayScale;
          varying vec3 vTgWorldPos;
          varying vec3 vTgWorldNormal;
          varying vec3 vTgLocalPos;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vTgLocalPos = position;
          if (uSwayScale > 0.0001) {
            vec4 swayWp = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
              swayWp = instanceMatrix * swayWp;
            #endif
            swayWp = modelMatrix * swayWp;
            float phase = swayWp.x * 1.35 + swayWp.z * 1.05 + swayWp.y * 0.8;
            float gust = sin(uElapsed * 2.3 + phase) * 0.65 + sin(uElapsed * 4.7 + phase * 1.9) * 0.35;
            float flutter = uSwayScale * (0.25 + uWindStrength * 0.95);
            transformed.x += gust * flutter;
            transformed.z += cos(uElapsed * 2.8 + phase * 1.15) * flutter * 0.7;
          }`
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          {
            vec4 tgWp = vec4(transformed, 1.0);
            #ifdef USE_BATCHING
              tgWp = batchingMatrix * tgWp;
            #endif
            #ifdef USE_INSTANCING
              tgWp = instanceMatrix * tgWp;
            #endif
            tgWp = modelMatrix * tgWp;
            vTgWorldPos = tgWp.xyz;

            vec3 tgWn = objectNormal;
            #ifdef USE_BATCHING
              tgWn = mat3(batchingMatrix) * tgWn;
            #endif
            #ifdef USE_INSTANCING
              tgWn = mat3(instanceMatrix) * tgWn;
            #endif
            vTgWorldNormal = normalize(mat3(modelMatrix) * tgWn);
          }`
        );

      // Fragment shader: triplanar PBR detail, moss weathering, ground/water contact AO, backlit foliage, window glow & lantern HDR
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uSunDirection;
        uniform float uNightFactor;
        uniform vec3 uSeasonTint;
        uniform float uMossAmount;
        uniform float uElapsed;
        uniform float uWindStrength;
        uniform float uWaterLevel;
        uniform float uTriplanarScale;
        uniform float uTriplanarMix;
        uniform float uMossWeight;
        uniform float uGroundAoWeight;
        varying vec3 vTgWorldPos;
        varying vec3 vTgWorldNormal;
        varying vec3 vTgLocalPos;

        float tgOrganicPatch(vec3 p) {
          float a = sin(p.x * 0.85 + cos(p.z * 0.72) * 1.4);
          float b = cos(p.z * 1.35 - sin(p.x * 1.18) * 1.2);
          float c = sin((p.x + p.z) * 2.6 + p.y * 1.7);
          return clamp(0.5 + 0.24 * a + 0.20 * b + 0.14 * c, 0.0, 1.0);
        }

        vec3 tgTriWeights(vec3 nW) {
          vec3 w = pow(abs(nW), vec3(4.0));
          return w / max(w.x + w.y + w.z, 1e-5);
        }

        vec4 tgSampleTriplanarSRGB(sampler2D tex, vec3 wp, vec3 w, float scale) {
          vec3 p = wp * scale;
          return texture2D(tex, p.yz) * w.x + texture2D(tex, p.xz) * w.y + texture2D(tex, p.xy) * w.z;
        }

        vec3 tgSampleTriplanarNormalWorld(sampler2D nTex, vec3 wp, vec3 nW, vec3 w, float scale, float strength) {
          vec3 p = wp * scale;
          vec3 tX = texture2D(nTex, p.yz).xyz * 2.0 - 1.0;
          vec3 tY = texture2D(nTex, p.xz).xyz * 2.0 - 1.0;
          vec3 tZ = texture2D(nTex, p.xy).xyz * 2.0 - 1.0;
          tX.xy *= strength;
          tY.xy *= strength;
          tZ.xy *= strength;
          vec3 sgn = sign(nW + vec3(1e-5));
          vec3 nX = vec3(tX.z * sgn.x, tX.x, tX.y);
          vec3 nY = vec3(tY.x, tY.z * sgn.y, tY.y);
          vec3 nZ = vec3(tZ.x, tZ.y, tZ.z * sgn.z);
          return normalize(nX * w.x + nY * w.y + nZ * w.z + nW * 0.35);
        }`
      );

      // Triplanar + UV Albedo & Weathering
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `vec3 tgNw = normalize(vTgWorldNormal);
        vec3 tgTw = tgTriWeights(tgNw);
        float tgMossMask = 0.0;
        #ifdef USE_MAP
          vec4 tgUvTexel = texture2D(map, vMapUv);
          vec4 tgTriTexel = tgSampleTriplanarSRGB(map, vTgWorldPos, tgTw, uTriplanarScale);
          vec4 sampledDiffuseColor = mix(tgUvTexel, tgTriTexel, uTriplanarMix);
          diffuseColor *= sampledDiffuseColor;
        #endif
        if (uMossWeight > 0.001) {
          float upFace = smoothstep(0.38, 0.86, tgNw.y);
          float patchVal = tgOrganicPatch(vTgWorldPos);
          float dampBoost = smoothstep(2.8, -0.1, vTgWorldPos.y - uWaterLevel) * 0.35;
          tgMossMask = clamp((upFace * (0.45 + 0.75 * patchVal) + dampBoost * patchVal) * uMossAmount * uMossWeight, 0.0, 0.78);
          vec3 mossBase = vec3(0.20, 0.31, 0.14) * uSeasonTint;
          diffuseColor.rgb = mix(diffuseColor.rgb, mossBase, tgMossMask * 0.72);
        }
        ${shaderOpts.isFoliage ? `
          float folVar = tgOrganicPatch(vTgWorldPos * 0.65);
          vec3 seasonalLeaf = mix(vec3(0.92, 1.03, 0.90), uSeasonTint, 0.85);
          diffuseColor.rgb *= seasonalLeaf * (0.86 + 0.28 * folVar);
        ` : ''}
        if (uGroundAoWeight > 0.001) {
          float aboveWater = vTgWorldPos.y - uWaterLevel;
          float wetDarken = smoothstep(0.38, -0.04, aboveWater);
          diffuseColor.rgb *= mix(1.0, 0.66, wetDarken * uGroundAoWeight);
        }`
      );

      // Triplanar Roughness + Moss / Wetness modulation
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          float rUv = texture2D(roughnessMap, vRoughnessMapUv).g;
          float rTri = tgSampleTriplanarSRGB(roughnessMap, vTgWorldPos, tgTw, uTriplanarScale).g;
          roughnessFactor *= mix(rUv, rTri, uTriplanarMix);
        #endif
        roughnessFactor = mix(roughnessFactor, 0.93, tgMossMask);
        if (uGroundAoWeight > 0.001) {
          float wetSheen = smoothstep(0.24, -0.02, vTgWorldPos.y - uWaterLevel);
          roughnessFactor = mix(roughnessFactor, 0.34, wetSheen * uGroundAoWeight * 0.7);
        }
        ${shaderOpts.isWindowGlass ? `
          float winGlowRough = smoothstep(0.10, 0.68, uNightFactor);
          roughnessFactor = mix(roughnessFactor, 0.36, winGlowRough * 0.65);
        ` : ''}`
      );

      // World-space Triplanar Normal Perturbation (eliminates UV seam/derivative artifacts on procedural meshes)
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#ifdef USE_NORMALMAP_TANGENTSPACE
          vec3 mapN = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
          mapN.xy *= normalScale;
          vec3 uvPerturbed = normalize(tbn * mapN);
          vec3 triWorldN = tgSampleTriplanarNormalWorld(normalMap, vTgWorldPos, tgNw * (gl_FrontFacing ? 1.0 : -1.0), tgTw, uTriplanarScale, normalScale.x);
          vec3 triViewN = normalize((viewMatrix * vec4(triWorldN, 0.0)).xyz);
          normal = normalize(mix(uvPerturbed, triViewN, uTriplanarMix));
        #else
          #include <normal_fragment_maps>
        #endif`
      );

      // Triplanar AO + Ground-contact AO darkening
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <aomap_fragment>',
        `#ifdef USE_AOMAP
          float aoUv = texture2D(aoMap, vAoMapUv).r;
          float aoTri = tgSampleTriplanarSRGB(aoMap, vTgWorldPos, tgTw, uTriplanarScale).r;
          float ambientOcclusion = (mix(aoUv, aoTri, uTriplanarMix) - 1.0) * aoMapIntensity + 1.0;
          if (uGroundAoWeight > 0.001) {
            float contactAo = mix(0.76, 1.0, smoothstep(-0.1, 0.85, vTgWorldPos.y - uWaterLevel));
            ambientOcclusion *= mix(1.0, contactAo, uGroundAoWeight * 0.55);
          }
          reflectedLight.indirectDiffuse *= ambientOcclusion;
          #if defined(USE_ENVMAP) && defined(STANDARD)
            float dotNV = saturate(dot(geometryNormal, geometryViewDir));
            reflectedLight.indirectSpecular *= computeSpecularOcclusion(dotNV, ambientOcclusion, material.roughness);
          #endif
        #endif`
      );

      // Special emissive / subsurface contributions (foliage backlit SSS, candlelit windows, HDR lanterns)
      if (shaderOpts.isFoliage || shaderOpts.isWindowGlass || shaderOpts.isLantern) {
        shader.fragmentShader = shader.fragmentShader.replace(
          'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
          `
          ${shaderOpts.isFoliage ? `
            vec3 sunViewDir = normalize((viewMatrix * vec4(uSunDirection, 0.0)).xyz);
            float dayVis = clamp(1.0 - uNightFactor * 1.15, 0.0, 1.0);
            float backScatter = pow(clamp(dot(-geometryViewDir, sunViewDir), 0.0, 1.0), 2.8);
            float wrapLit = clamp(dot(geometryNormal, sunViewDir) * 0.5 + 0.5, 0.0, 1.0);
            vec3 sssTint = diffuseColor.rgb * vec3(1.35, 1.22, 0.58);
            totalEmissiveRadiance += sssTint * (backScatter * 0.52 + wrapLit * 0.14) * dayVis;
          ` : ''}
          ${shaderOpts.isWindowGlass ? `
            float nightGlow = smoothstep(0.06, 0.66, uNightFactor);
            if (nightGlow > 0.001) {
              vec3 viewWorld = normalize(cameraPosition - vTgWorldPos);
              vec2 roomCoord = vec2(vTgWorldPos.x + vTgWorldPos.z, vTgWorldPos.y * 1.35) - viewWorld.xz * 0.22;
              float roomSeed = floor(vTgWorldPos.x * 0.45) * 7.1 + floor(vTgWorldPos.z * 0.45) * 13.3;
              float flicker = 1.0 + 0.055 * sin(uElapsed * 4.6 + roomSeed) * cos(uElapsed * 2.9 + roomSeed * 0.7);
              float curtain = smoothstep(0.12, 0.48, abs(fract(roomCoord.x * 0.85) - 0.5));
              float hearthGrad = 0.68 + 0.45 * (1.0 - fract(roomCoord.y * 0.75));
              float paneMask = smoothstep(0.22, 0.68, diffuseColor.b / max(diffuse.b, 0.05));
              float tempShift = fract(sin(roomSeed * 12.9898) * 43758.5453);
              vec3 candleWarm = mix(vec3(1.0, 0.56, 0.18), vec3(1.0, 0.72, 0.34), tempShift);
              vec3 interiorRadiance = candleWarm * hearthGrad * (1.0 - curtain * 0.42) * paneMask * flicker;
              diffuseColor.rgb = mix(diffuseColor.rgb, candleWarm * 0.35 * paneMask, nightGlow * 0.75);
              totalEmissiveRadiance += interiorRadiance * nightGlow * 2.85;
            }
          ` : ''}
          ${shaderOpts.isLantern ? `
            float lanternPhase = vTgWorldPos.x * 3.1 + vTgWorldPos.z * 2.3;
            float flamePulse = 1.0 + 0.07 * sin(uElapsed * 6.8 + lanternPhase) * sin(uElapsed * 4.1 + lanternPhase * 0.6);
            float duskBoost = mix(0.75, 3.25, smoothstep(0.04, 0.62, uNightFactor));
            totalEmissiveRadiance = vec3(1.0, 0.62, 0.22) * duskBoost * flamePulse;
          ` : ''}
          vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;`
        );
      }
    };

    // Preserve onBeforeCompile, customProgramCacheKey, and clone behavior when callers call material.clone()
    const baseClone = THREE.MeshStandardMaterial.prototype.clone;
    mat.clone = function () {
      const cloned = baseClone.call(this);
      libraryRef._enhanceMaterialInstance(cloned, kind, shaderOpts);
      cloned.userData.tgIsRootMaterial = false;
      libraryRef._materials.push(cloned);
      return cloned;
    };
  }

  getRoofColorTHREE(paletteId) {
    const hex = ROOF_PALETTES[paletteId] || ROOF_PALETTES.terracotta;
    return new THREE.Color(hex);
  }

  getWallColorTHREE(styleId) {
    const hex = WALL_PALETTES[styleId] || WALL_PALETTES.limestone;
    return new THREE.Color(hex);
  }

  updateUniforms({
    sunDirection,
    nightFactor,
    season,
    elapsed,
    windStrength,
    waterLevel,
    mossAmount,
  } = {}) {
    if (sunDirection) {
      this.sharedUniforms.uSunDirection.value.copy(sunDirection).normalize();
    }
    if (typeof nightFactor === 'number') {
      this.sharedUniforms.uNightFactor.value = clamp01(nightFactor);
    }
    if (season && SEASON_CONFIG[season]) {
      const cfg = SEASON_CONFIG[season];
      this.sharedUniforms.uSeasonTint.value.copy(cfg.tint);
      if (typeof mossAmount !== 'number') {
        this.sharedUniforms.uMossAmount.value = cfg.moss;
      }
    }
    if (typeof mossAmount === 'number') {
      this.sharedUniforms.uMossAmount.value = clamp01(mossAmount);
    }
    if (typeof elapsed === 'number') {
      this.sharedUniforms.uElapsed.value = elapsed;
    }
    if (typeof windStrength === 'number') {
      this.sharedUniforms.uWindStrength.value = Math.max(0.0, windStrength);
    }
    if (typeof waterLevel === 'number') {
      this.sharedUniforms.uWaterLevel.value = waterLevel;
    }
  }

  dispose() {
    for (let i = 0; i < this._textures.length; i++) {
      this._textures[i].dispose();
    }
    for (let i = 0; i < this._materials.length; i++) {
      this._materials[i].dispose();
    }
    this._textures.length = 0;
    this._materials.length = 0;
  }
}

export function createMaterialLibrary(renderer, opts = {}) {
  return new MaterialLibrary(renderer, opts);
}
