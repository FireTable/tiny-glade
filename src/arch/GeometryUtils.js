import * as THREE from 'three';

const WALL_PALETTE_FALLBACK = {
  limestone: '#d9d2c5',
  cotswold: '#dfc89f',
  granite: '#9aa0a6',
  plaster: '#efe6d5',
};

const ROOF_PALETTE_FALLBACK = {
  terracotta: '#b8573b',
  slate: '#47586c',
  moss: '#556e48',
  ochre: '#c48d3f',
  plum: '#6d4b5b',
};

const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _vD = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _norm = new THREE.Vector3();
const _center = new THREE.Vector3();
const _hint = new THREE.Vector3();
const _uAxis = new THREE.Vector3();
const _vAxis = new THREE.Vector3();
const _tmpColor = new THREE.Color();

let _sharedShingleGeo = null;

/**
 * Deterministic 32-bit PRNG (Mulberry32).
 */
export function mulberry32(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hashes an arbitrary string or number into an integer seed.
 */
export function hashSeed(input, salt = 0) {
  let h = (2166136261 ^ (salt | 0)) >>> 0;
  const s = String(input ?? 'glade');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1337;
}

/**
 * Safely resolves wall base THREE.Color from MaterialLibrary or fallback palette.
 */
export function resolveWallColor(materials, wallStyle = 'limestone') {
  if (materials && typeof materials.getWallColorTHREE === 'function') {
    const c = materials.getWallColorTHREE(wallStyle);
    if (c && c.isColor) return c.clone();
  }
  return new THREE.Color(WALL_PALETTE_FALLBACK[wallStyle] || WALL_PALETTE_FALLBACK.limestone);
}

/**
 * Safely resolves roof base THREE.Color from MaterialLibrary or fallback palette.
 */
export function resolveRoofColor(materials, roofColor = 'terracotta') {
  if (materials && typeof materials.getRoofColorTHREE === 'function') {
    const c = materials.getRoofColorTHREE(roofColor);
    if (c && c.isColor) return c.clone();
  }
  return new THREE.Color(ROOF_PALETTE_FALLBACK[roofColor] || ROOF_PALETTE_FALLBACK.terracotta);
}

/**
 * Computes subtle warm/cool stone color variation + ground-contact AO darkening.
 * Returns [r, g, b] in linear/working THREE.Color channel space.
 */
export function jitterStoneColor(baseColor, rng, aoFactor = 1.0, variation = 0.085) {
  const lum = 1.0 + (rng() - 0.5) * 2.0 * variation;
  const warmShift = (rng() - 0.5) * 0.055;
  const occ = Math.max(0.45, Math.min(1.12, aoFactor));
  _tmpColor.copy(baseColor);
  const r = Math.min(1.0, Math.max(0.02, (_tmpColor.r * lum + warmShift) * occ));
  const g = Math.min(1.0, Math.max(0.02, (_tmpColor.g * lum + warmShift * 0.45) * occ));
  const b = Math.min(1.0, Math.max(0.02, (_tmpColor.b * lum - warmShift * 0.65) * occ));
  return [r, g, b];
}

export function scaleRGB(rgb, factor) {
  return [
    Math.min(1.0, Math.max(0.01, rgb[0] * factor)),
    Math.min(1.0, Math.max(0.01, rgb[1] * factor)),
    Math.min(1.0, Math.max(0.01, rgb[2] * factor)),
  ];
}

/**
 * Evaluates normalized Tiny Glade curved roof profile:
 * t in [0, 1] from eave (t = 0, y = 0) to apex (t = 1, y = 1).
 * Uses y(t) = pow(t, 1.0 + roofCurve * 1.4) with subtle flared eave easing near t = 0.
 */
export function evalRoofProfile(t, roofCurve = 0.25) {
  const tc = Math.max(0, Math.min(1, t));
  const exp = Math.max(0.38, Math.min(2.6, 1.0 + roofCurve * 1.4));
  // Blend a gentle flare kick in the bottom 16% so eaves sweep gracefully outward
  const baseY = Math.pow(tc, exp);
  const eaveFlare = tc < 0.18 ? (1.0 - tc / 0.18) * 0.035 * Math.max(0, roofCurve + 0.25) * tc : 0;
  return Math.max(0, Math.min(1, baseY - eaveFlare));
}

/**
 * Evaluates roof surface pitch angle (radians above horizontal) at normalized run t in [0, 1].
 */
export function evalRoofSlopeAngle(t, roofCurve, horizontalSpan, roofHeight) {
  const eps = 0.015;
  const t0 = Math.max(0, t - eps);
  const t1 = Math.min(1, t + eps);
  const dy = (evalRoofProfile(t1, roofCurve) - evalRoofProfile(t0, roofCurve)) * roofHeight;
  const dx = Math.max(1e-4, (t1 - t0) * horizontalSpan);
  return Math.atan2(dy, dx);
}

/**
 * Trilinear interpolation inside an 8-corner hexahedron:
 * corners8 = [b0, b1, b2, b3, t0, t1, t2, t3]
 * Bottom quad (v=0): b0(0,0,0), b1(1,0,0), b2(1,0,1), b3(0,0,1)
 * Top quad    (v=1): t0(0,1,0), t1(1,1,0), t2(1,1,1), t3(0,1,1)
 */
function trilinearHex(corners8, u, v, w, out) {
  const [b0, b1, b2, b3, t0, t1, t2, t3] = corners8;
  const u0 = 1 - u;
  const v0 = 1 - v;
  const w0 = 1 - w;

  const wb0 = u0 * v0 * w0;
  const wb1 = u * v0 * w0;
  const wb2 = u * v0 * w;
  const wb3 = u0 * v0 * w;
  const wt0 = u0 * v * w0;
  const wt1 = u * v * w0;
  const wt2 = u * v * w;
  const wt3 = u0 * v * w;

  out.set(
    b0.x * wb0 + b1.x * wb1 + b2.x * wb2 + b3.x * wb3 + t0.x * wt0 + t1.x * wt1 + t2.x * wt2 + t3.x * wt3,
    b0.y * wb0 + b1.y * wb1 + b2.y * wb2 + b3.y * wb3 + t0.y * wt0 + t1.y * wt1 + t2.y * wt2 + t3.y * wt3,
    b0.z * wb0 + b1.z * wb1 + b2.z * wb2 + b3.z * wb3 + t0.z * wt0 + t1.z * wt1 + t2.z * wt2 + t3.z * wt3
  );
  return out;
}

/**
 * High-speed typed-array geometry collector for building tactile multi-stone / multi-beam
 * meshes in a single BufferGeometry per material with guaranteed outward CCW normals,
 * metric UVs, and vertex colors.
 */
export class GeometryCollector {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.uvs = [];
    this.colors = [];
    this.indices = [];
    this.vertexCount = 0;
  }

  get isEmpty() {
    return this.indices.length === 0;
  }

  pushVertex(p, n, u, v, rgb) {
    this.positions.push(p.x, p.y, p.z);
    this.normals.push(n.x, n.y, n.z);
    this.uvs.push(u, v);
    this.colors.push(rgb[0], rgb[1], rgb[2]);
    return this.vertexCount++;
  }

  /**
   * Emits a flat-shaded triangle with guaranteed outward normal alignment if outwardHint is supplied.
   */
  pushTri(a, b, c, outwardHint = null, uvScale = 0.5, colA = [1, 1, 1], colB = colA, colC = colA) {
    _e1.subVectors(b, a);
    _e2.subVectors(c, a);
    _norm.crossVectors(_e1, _e2);
    const lenSq = _norm.lengthSq();
    if (lenSq < 1e-12) return;
    _norm.multiplyScalar(1 / Math.sqrt(lenSq));

    let p1 = a;
    let p2 = b;
    let p3 = c;
    let c1 = colA;
    let c2 = colB;
    let c3 = colC;

    if (outwardHint && _norm.dot(outwardHint) < 0) {
      _norm.negate();
      p2 = c;
      p3 = b;
      c2 = colC;
      c3 = colB;
    }

    _uAxis.copy(_e1);
    const uLen = _uAxis.length();
    if (uLen > 1e-6) _uAxis.multiplyScalar(1 / uLen);
    else _uAxis.set(1, 0, 0);
    _vAxis.crossVectors(_norm, _uAxis).normalize();

    const u1 = p1.dot(_uAxis) * uvScale;
    const v1 = p1.dot(_vAxis) * uvScale;
    const u2 = p2.dot(_uAxis) * uvScale;
    const v2 = p2.dot(_vAxis) * uvScale;
    const u3 = p3.dot(_uAxis) * uvScale;
    const v3 = p3.dot(_vAxis) * uvScale;

    const i1 = this.pushVertex(p1, _norm, u1, v1, c1);
    const i2 = this.pushVertex(p2, _norm, u2, v2, c2);
    const i3 = this.pushVertex(p3, _norm, u3, v3, c3);
    this.indices.push(i1, i2, i3);
  }

  /**
   * Emits a flat-shaded quad (a, b, c, d) with guaranteed outward winding against outwardHint.
   */
  pushQuad(a, b, c, d, outwardHint = null, uvScale = 0.5, colTop = [1, 1, 1], colBot = colTop) {
    _e1.subVectors(b, a);
    _e2.subVectors(d, a);
    _norm.crossVectors(_e1, _e2);
    if (_norm.lengthSq() < 1e-12) {
      _e1.subVectors(c, b);
      _e2.subVectors(d, b);
      _norm.crossVectors(_e1, _e2);
    }
    const lenSq = _norm.lengthSq();
    if (lenSq < 1e-12) return;
    _norm.multiplyScalar(1 / Math.sqrt(lenSq));

    let flip = false;
    if (outwardHint && _norm.dot(outwardHint) < 0) {
      _norm.negate();
      flip = true;
    }

    _uAxis.subVectors(b, a);
    const uLen = _uAxis.length();
    if (uLen > 1e-6) _uAxis.multiplyScalar(1 / uLen);
    else _uAxis.set(1, 0, 0);
    _vAxis.crossVectors(_norm, _uAxis).normalize();

    const ua = a.dot(_uAxis) * uvScale;
    const va = a.dot(_vAxis) * uvScale;
    const ub = b.dot(_uAxis) * uvScale;
    const vb = b.dot(_vAxis) * uvScale;
    const uc = c.dot(_uAxis) * uvScale;
    const vc = c.dot(_vAxis) * uvScale;
    const ud = d.dot(_uAxis) * uvScale;
    const vd = d.dot(_vAxis) * uvScale;

    // Assign colors based on relative vertical height across the quad for subtle vertical gradient
    const avgY = 0.25 * (a.y + b.y + c.y + d.y);
    const ca = a.y >= avgY ? colTop : colBot;
    const cb = b.y >= avgY ? colTop : colBot;
    const cc = c.y >= avgY ? colTop : colBot;
    const cd = d.y >= avgY ? colTop : colBot;

    const ia = this.pushVertex(a, _norm, ua, va, ca);
    const ib = this.pushVertex(b, _norm, ub, vb, cb);
    const ic = this.pushVertex(c, _norm, uc, vc, cc);
    const id = this.pushVertex(d, _norm, ud, vd, cd);

    if (!flip) {
      this.indices.push(ia, ib, ic, ia, ic, id);
    } else {
      this.indices.push(ia, id, ic, ia, ic, ib);
    }
  }

  /**
   * Emits a watertight 28-triangle 3D chamfered/beveled stone block from 8 arbitrary hexahedron corners:
   * corners8 = [b0, b1, b2, b3, t0, t1, t2, t3].
   * Produces tactile beveled top/bottom stone edges, subtle mortar grooves, and micro-shaded bevel facets.
   */
  pushBeveledStone(corners8, stoneRGB, opts = {}) {
    const bevelXZ = opts.bevelXZ ?? 0.085;
    const bevelY = opts.bevelY ?? 0.13;
    const gapXZ = opts.gapXZ ?? 0.012;
    const uvScale = opts.uvScale ?? 0.55;
    const includeBottom = opts.includeBottom !== false;

    _center.set(0, 0, 0);
    for (let i = 0; i < 8; i++) _center.add(corners8[i]);
    _center.multiplyScalar(0.125);

    const uIn0 = bevelXZ + gapXZ;
    const uIn1 = 1 - bevelXZ - gapXZ;
    const wIn0 = bevelXZ + gapXZ;
    const wIn1 = 1 - bevelXZ - gapXZ;
    const uOut0 = gapXZ;
    const uOut1 = 1 - gapXZ;
    const wOut0 = gapXZ;
    const wOut1 = 1 - gapXZ;
    const vBot = bevelY;
    const vTop = 1 - bevelY;

    // 16 vertices across 4 vertical rings (bottom cap, lower waist, upper waist, top cap)
    const rings = new Array(16);
    for (let i = 0; i < 16; i++) rings[i] = new THREE.Vector3();

    // Ring 0..3: bottom inset cap (v = 0)
    trilinearHex(corners8, uIn0, 0, wIn0, rings[0]);
    trilinearHex(corners8, uIn1, 0, wIn0, rings[1]);
    trilinearHex(corners8, uIn1, 0, wIn1, rings[2]);
    trilinearHex(corners8, uIn0, 0, wIn1, rings[3]);

    // Ring 4..7: lower waist (v = vBot)
    trilinearHex(corners8, uOut0, vBot, wOut0, rings[4]);
    trilinearHex(corners8, uOut1, vBot, wOut0, rings[5]);
    trilinearHex(corners8, uOut1, vBot, wOut1, rings[6]);
    trilinearHex(corners8, uOut0, vBot, wOut1, rings[7]);

    // Ring 8..11: upper waist (v = vTop)
    trilinearHex(corners8, uOut0, vTop, wOut0, rings[8]);
    trilinearHex(corners8, uOut1, vTop, wOut0, rings[9]);
    trilinearHex(corners8, uOut1, vTop, wOut1, rings[10]);
    trilinearHex(corners8, uOut0, vTop, wOut1, rings[11]);

    // Ring 12..15: top inset cap (v = 1)
    trilinearHex(corners8, uIn0, 1, wIn0, rings[12]);
    trilinearHex(corners8, uIn1, 1, wIn0, rings[13]);
    trilinearHex(corners8, uIn1, 1, wIn1, rings[14]);
    trilinearHex(corners8, uIn0, 1, wIn1, rings[15]);

    const colTopCap = scaleRGB(stoneRGB, 1.04);
    const colTopBevel = scaleRGB(stoneRGB, 1.02);
    const colFaceUpper = stoneRGB;
    const colFaceLower = scaleRGB(stoneRGB, 0.93);
    const colBotBevel = scaleRGB(stoneRGB, 0.78);
    const colBotCap = scaleRGB(stoneRGB, 0.72);

    // Top cap
    _vA.addVectors(rings[12], rings[14]).multiplyScalar(0.5);
    _hint.subVectors(_vA, _center);
    this.pushQuad(rings[12], rings[13], rings[14], rings[15], _hint, uvScale, colTopCap, colTopCap);

    // Bottom cap (optional when buried, kept by default for clean shadow volumes)
    if (includeBottom) {
      _vA.addVectors(rings[0], rings[2]).multiplyScalar(0.5);
      _hint.subVectors(_vA, _center);
      this.pushQuad(rings[0], rings[3], rings[2], rings[1], _hint, uvScale, colBotCap, colBotCap);
    }

    // 4 sides: bottom chamfer, main face, top chamfer
    for (let s = 0; s < 4; s++) {
      const n = (s + 1) & 3;

      // Main face
      _vA.addVectors(rings[4 + s], rings[8 + n]).multiplyScalar(0.5);
      _hint.subVectors(_vA, _center);
      this.pushQuad(
        rings[4 + s],
        rings[4 + n],
        rings[8 + n],
        rings[8 + s],
        _hint,
        uvScale,
        colFaceUpper,
        colFaceLower
      );

      // Top chamfer
      _vA.addVectors(rings[8 + s], rings[12 + n]).multiplyScalar(0.5);
      _hint.subVectors(_vA, _center);
      this.pushQuad(
        rings[8 + s],
        rings[8 + n],
        rings[12 + n],
        rings[12 + s],
        _hint,
        uvScale,
        colTopCap,
        colTopBevel
      );

      // Bottom mortar chamfer
      _vA.addVectors(rings[s], rings[4 + n]).multiplyScalar(0.5);
      _hint.subVectors(_vA, _center);
      this.pushQuad(
        rings[s],
        rings[n],
        rings[4 + n],
        rings[4 + s],
        _hint,
        uvScale,
        colFaceLower,
        colBotBevel
      );
    }
  }

  /**
   * Emits an axis/oriented rectangular box defined by center, local orthonormal axes (xAxis, yAxis, zAxis),
   * and half-extents (hx, hy, hz). Ideal for timber beams, rafters, shutters, stairs, and brackets.
   */
  pushOrientedBox(center, xAxis, yAxis, zAxis, hx, hy, hz, rgb = [1, 1, 1], uvScale = 0.6) {
    const pts = new Array(8);
    const signs = [
      [-1, -1, -1],
      [1, -1, -1],
      [1, -1, 1],
      [-1, -1, 1],
      [-1, 1, -1],
      [1, 1, -1],
      [1, 1, 1],
      [-1, 1, 1],
    ];
    for (let i = 0; i < 8; i++) {
      const [sx, sy, sz] = signs[i];
      pts[i] = new THREE.Vector3(
        center.x + xAxis.x * sx * hx + yAxis.x * sy * hy + zAxis.x * sz * hz,
        center.y + xAxis.y * sx * hx + yAxis.y * sy * hy + zAxis.y * sz * hz,
        center.z + xAxis.z * sx * hx + yAxis.z * sy * hy + zAxis.z * sz * hz
      );
    }

    const colTop = scaleRGB(rgb, 1.03);
    const colSide = rgb;
    const colBot = scaleRGB(rgb, 0.85);

    const faces = [
      [4, 5, 6, 7, yAxis, colTop, colTop],
      [0, 3, 2, 1, _vD.copy(yAxis).negate().clone(), colBot, colBot],
      [0, 1, 5, 4, _vD.copy(zAxis).negate().clone(), colTop, colSide],
      [2, 3, 7, 6, zAxis, colTop, colSide],
      [1, 2, 6, 5, xAxis, colTop, colSide],
      [3, 0, 4, 7, _vD.copy(xAxis).negate().clone(), colTop, colSide],
    ];

    for (let f = 0; f < 6; f++) {
      const [i0, i1, i2, i3, hintVec, cT, cB] = faces[f];
      this.pushQuad(pts[i0], pts[i1], pts[i2], pts[i3], hintVec, uvScale, cT, cB);
    }
  }

  /**
   * Emits a chamfered/tapered cylinder or polygonal prism (posts, chimney pots, finials, branches).
   */
  pushCylinder(pBottom, pTop, rBottom, rTop, radialSegs = 8, rgb = [1, 1, 1], capEnds = true, uvScale = 0.65) {
    const axis = new THREE.Vector3().subVectors(pTop, pBottom);
    const len = axis.length();
    if (len < 1e-5) return;
    axis.multiplyScalar(1 / len);

    const ref = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(ref, axis).normalize();
    const v = new THREE.Vector3().crossVectors(axis, u).normalize();

    const botRing = [];
    const topRing = [];
    for (let i = 0; i < radialSegs; i++) {
      const ang = (i / radialSegs) * Math.PI * 2;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      botRing.push(
        new THREE.Vector3(
          pBottom.x + (u.x * ca + v.x * sa) * rBottom,
          pBottom.y + (u.y * ca + v.y * sa) * rBottom,
          pBottom.z + (u.z * ca + v.z * sa) * rBottom
        )
      );
      topRing.push(
        new THREE.Vector3(
          pTop.x + (u.x * ca + v.x * sa) * rTop,
          pTop.y + (u.y * ca + v.y * sa) * rTop,
          pTop.z + (u.z * ca + v.z * sa) * rTop
        )
      );
    }

    const mid = new THREE.Vector3().addVectors(pBottom, pTop).multiplyScalar(0.5);
    const colTop = scaleRGB(rgb, 1.02);
    const colBot = scaleRGB(rgb, 0.9);

    for (let i = 0; i < radialSegs; i++) {
      const j = (i + 1) % radialSegs;
      _vA.addVectors(botRing[i], topRing[j]).multiplyScalar(0.5);
      _hint.subVectors(_vA, mid);
      this.pushQuad(botRing[i], botRing[j], topRing[j], topRing[i], _hint, uvScale, colTop, colBot);
    }

    if (capEnds && rTop > 1e-4) {
      for (let i = 1; i < radialSegs - 1; i++) {
        this.pushTri(topRing[0], topRing[i], topRing[i + 1], axis, uvScale, colTop, colTop, colTop);
      }
    }
    if (capEnds && rBottom > 1e-4) {
      _hint.copy(axis).negate();
      for (let i = 1; i < radialSegs - 1; i++) {
        this.pushTri(botRing[0], botRing[i + 1], botRing[i], _hint, uvScale, colBot, colBot, colBot);
      }
    }
  }

  /**
   * Builds an indexed THREE.BufferGeometry with position, normal, uv, and color attributes.
   */
  toBufferGeometry() {
    const geo = new THREE.BufferGeometry();
    if (this.vertexCount === 0) return geo;

    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    if (this.vertexCount > 65535) {
      geo.setIndex(new THREE.Uint32BufferAttribute(this.indices, 1));
    } else {
      geo.setIndex(new THREE.Uint16BufferAttribute(this.indices, 1));
    }
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }
}

/**
 * Returns a shared unit beveled roof shingle BufferGeometry (1x1x1 bounds centered in X,
 * y in [-0.5, 0.5], z from 0 (upper tucked edge) to 1 (lower overhanging lip)).
 * Includes white (1, 1, 1) vertex colors so InstancedMesh.instanceColor works regardless of
 * whether MaterialLibrary sets vertexColors: true or false on roofTile.
 */
export function getSharedShingleGeometry() {
  if (_sharedShingleGeo) return _sharedShingleGeo;

  const gc = new GeometryCollector();
  // Slightly tapered clay/slate shingle with beveled front lip
  const corners = [
    new THREE.Vector3(-0.47, -0.5, 0.0),
    new THREE.Vector3(0.47, -0.5, 0.0),
    new THREE.Vector3(0.5, -0.5, 1.0),
    new THREE.Vector3(-0.5, -0.5, 1.0),
    new THREE.Vector3(-0.46, 0.35, 0.0),
    new THREE.Vector3(0.46, 0.35, 0.0),
    new THREE.Vector3(0.49, 0.5, 1.0),
    new THREE.Vector3(-0.49, 0.5, 1.0),
  ];
  gc.pushBeveledStone(corners, [1, 1, 1], {
    bevelXZ: 0.07,
    bevelY: 0.16,
    gapXZ: 0.005,
    uvScale: 1.0,
    includeBottom: true,
  });

  _sharedShingleGeo = gc.toBufferGeometry();
  _sharedShingleGeo.userData.isSharedArchGeo = true;
  return _sharedShingleGeo;
}

/**
 * Resamples an XZ polyline along a smooth centripetal Catmull-Rom curve while preserving
 * sharp vertices (> 52 deg turn) as corner stations.
 * Returns { samples: Array<{ x, z, s, tx, tz, nx, nz, curvature }>, corners: Array<{ x, z, s, turnAngle }>, totalLength }.
 */
export function resampleCatmullRomXZ(rawPoints, spacing = 0.32) {
  const clean = [];
  for (let i = 0; i < (rawPoints?.length || 0); i++) {
    const p = rawPoints[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    if (clean.length > 0) {
      const prev = clean[clean.length - 1];
      if (Math.hypot(p.x - prev.x, p.z - prev.z) < 0.04) continue;
    }
    clean.push({ x: p.x, z: p.z });
  }

  if (clean.length < 2) {
    return { samples: clean.map((p) => ({ x: p.x, z: p.z, s: 0, tx: 1, tz: 0, nx: 0, nz: 1, curvature: 0 })), corners: [], totalLength: 0 };
  }

  // Detect sharp corners in input polyline
  const sharpIndices = new Set();
  const sharpAngles = new Map();
  for (let i = 1; i < clean.length - 1; i++) {
    const ax = clean[i].x - clean[i - 1].x;
    const az = clean[i].z - clean[i - 1].z;
    const bx = clean[i + 1].x - clean[i].x;
    const bz = clean[i + 1].z - clean[i].z;
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    if (la > 1e-4 && lb > 1e-4) {
      const dot = Math.max(-1, Math.min(1, (ax * bx + az * bz) / (la * lb)));
      const angle = Math.acos(dot);
      if (angle > 0.88) {
        sharpIndices.add(i);
        sharpAngles.set(i, angle);
      }
    }
  }

  // Split at sharp corners so sharp 90-deg turns stay crisp while curved runs stay silky smooth
  const runs = [];
  let runStart = 0;
  for (let i = 1; i < clean.length; i++) {
    if (sharpIndices.has(i)) {
      runs.push({ pts: clean.slice(runStart, i + 1), endCornerIdx: i });
      runStart = i;
    }
  }
  runs.push({ pts: clean.slice(runStart), endCornerIdx: -1 });

  const dense = [];
  const corners = [];
  let runningLen = 0;

  for (let r = 0; r < runs.length; r++) {
    const { pts, endCornerIdx } = runs[r];
    if (pts.length === 2) {
      const dx = pts[1].x - pts[0].x;
      const dz = pts[1].z - pts[0].z;
      const segLen = Math.hypot(dx, dz);
      const steps = Math.max(1, Math.ceil(segLen / spacing));
      const startK = r === 0 ? 0 : 1;
      for (let k = startK; k <= steps; k++) {
        const t = k / steps;
        const x = pts[0].x + dx * t;
        const z = pts[0].z + dz * t;
        if (dense.length > 0) {
          runningLen += Math.hypot(x - dense[dense.length - 1].x, z - dense[dense.length - 1].z);
        }
        dense.push({ x, z, s: runningLen });
      }
    } else {
      const vec3s = pts.map((p) => new THREE.Vector3(p.x, 0, p.z));
      const curve = new THREE.CatmullRomCurve3(vec3s, false, 'centripetal', 0.5);
      const approxLen = curve.getLength();
      const steps = Math.max(2, Math.ceil(approxLen / spacing));
      const startK = r === 0 ? 0 : 1;
      for (let k = startK; k <= steps; k++) {
        const pt = curve.getPoint(k / steps);
        if (dense.length > 0) {
          runningLen += Math.hypot(pt.x - dense[dense.length - 1].x, pt.z - dense[dense.length - 1].z);
        }
        dense.push({ x: pt.x, z: pt.z, s: runningLen });
      }
    }

    if (endCornerIdx >= 0 && dense.length > 0) {
      const last = dense[dense.length - 1];
      corners.push({
        x: last.x,
        z: last.z,
        s: last.s,
        turnAngle: sharpAngles.get(endCornerIdx) || 1.0,
      });
    }
  }

  // Compute smooth tangents, left/right normals, and signed curvature
  const n = dense.length;
  for (let i = 0; i < n; i++) {
    const pPrev = dense[Math.max(0, i - 1)];
    const pNext = dense[Math.min(n - 1, i + 1)];
    let tx = pNext.x - pPrev.x;
    let tz = pNext.z - pPrev.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    dense[i].tx = tx;
    dense[i].tz = tz;
    dense[i].nx = -tz;
    dense[i].nz = tx;
    dense[i].curvature = 0;
  }

  for (let i = 1; i < n - 1; i++) {
    const ds = Math.max(1e-3, dense[i + 1].s - dense[i - 1].s);
    const dtx = dense[i + 1].tx - dense[i - 1].tx;
    const dtz = dense[i + 1].tz - dense[i - 1].tz;
    dense[i].curvature = (dense[i].tx * dtz - dense[i].tz * dtx) / ds;
  }

  return {
    samples: dense,
    corners,
    totalLength: runningLen,
  };
}

/**
 * Interpolates { x, z, tx, tz, nx, nz } at arc-length station s along resampled spline samples.
 */
export function sampleSplineAtS(samples, s) {
  if (!samples || samples.length === 0) {
    return { x: 0, z: 0, s: 0, tx: 1, tz: 0, nx: 0, nz: 1 };
  }
  if (samples.length === 1 || s <= 0) return { ...samples[0] };
  const last = samples[samples.length - 1];
  if (s >= last.s) return { ...last };

  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].s <= s) lo = mid;
    else hi = mid;
  }

  const a = samples[lo];
  const b = samples[hi];
  const span = Math.max(1e-6, b.s - a.s);
  const t = Math.max(0, Math.min(1, (s - a.s) / span));
  let tx = a.tx + (b.tx - a.tx) * t;
  let tz = a.tz + (b.tz - a.tz) * t;
  const tl = Math.hypot(tx, tz) || 1;
  tx /= tl;
  tz /= tl;

  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    s,
    tx,
    tz,
    nx: -tz,
    nz: tx,
  };
}

/**
 * Exact 2D line segment intersection between (a1 -> a2) and (b1 -> b2).
 */
export function segmentIntersection2D(a1, a2, b1, b2) {
  const rX = a2.x - a1.x;
  const rZ = a2.z - a1.z;
  const sX = b2.x - b1.x;
  const sZ = b2.z - b1.z;

  const denom = rX * sZ - rZ * sX;
  if (Math.abs(denom) < 1e-8) return null;

  const qpX = b1.x - a1.x;
  const qpZ = b1.z - a1.z;

  const t = (qpX * sZ - qpZ * sX) / denom;
  const u = (qpX * rZ - qpZ * rX) / denom;

  if (t >= -1e-5 && t <= 1 + 1e-5 && u >= -1e-5 && u <= 1 + 1e-5) {
    const tc = Math.max(0, Math.min(1, t));
    const rl = Math.hypot(rX, rZ) || 1;
    const sl = Math.hypot(sX, sZ) || 1;
    const cosAngle = Math.abs((rX * sX + rZ * sZ) / (rl * sl));
    const sinAngle = Math.sqrt(Math.max(0, 1 - cosAngle * cosAngle));
    return {
      x: a1.x + rX * tc,
      z: a1.z + rZ * tc,
      t: tc,
      u: Math.max(0, Math.min(1, u)),
      cosAngle,
      sinAngle,
    };
  }
  return null;
}

/**
 * Finds all distinct crossings between resampled spline samplesA (with .s) and polyline pointsB.
 */
export function polylineIntersections2D(samplesA, pointsB, minSeparation = 1.5) {
  if (!samplesA || samplesA.length < 2 || !pointsB || pointsB.length < 2) return [];
  const rawHits = [];

  for (let i = 0; i < samplesA.length - 1; i++) {
    const a1 = samplesA[i];
    const a2 = samplesA[i + 1];
    const segLen = a2.s - a1.s;
    for (let j = 0; j < pointsB.length - 1; j++) {
      const b1 = pointsB[j];
      const b2 = pointsB[j + 1];
      const hit = segmentIntersection2D(a1, a2, b1, b2);
      if (hit) {
        rawHits.push({
          x: hit.x,
          z: hit.z,
          s: a1.s + hit.t * segLen,
          cosAngle: hit.cosAngle,
          sinAngle: hit.sinAngle,
        });
      }
    }
  }

  if (rawHits.length === 0) return [];
  rawHits.sort((a, b) => a.s - b.s);

  const merged = [rawHits[0]];
  for (let i = 1; i < rawHits.length; i++) {
    const prev = merged[merged.length - 1];
    if (Math.abs(rawHits[i].s - prev.s) < minSeparation) {
      prev.s = 0.5 * (prev.s + rawHits[i].s);
      prev.x = 0.5 * (prev.x + rawHits[i].x);
      prev.z = 0.5 * (prev.z + rawHits[i].z);
      prev.sinAngle = Math.min(prev.sinAngle, rawHits[i].sinAngle);
    } else {
      merged.push(rawHits[i]);
    }
  }
  return merged;
}

/**
 * Closest point & distance from (px, pz) to segment (ax, az) -> (bx, bz).
 */
export function pointToSegment2D(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  let t = 0;
  if (lenSq > 1e-8) {
    t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  }
  const cx = ax + dx * t;
  const cz = az + dz * t;
  return {
    dist: Math.hypot(px - cx, pz - cz),
    t,
    closestX: cx,
    closestZ: cz,
  };
}

/**
 * Closest point & arc-length station from (px, pz) to an XZ polyline.
 */
export function pointToPolyline2D(px, pz, points) {
  if (!points || points.length === 0) {
    return { dist: Infinity, arcS: 0, totalLen: 0, closestX: px, closestZ: pz, tx: 1, tz: 0 };
  }
  if (points.length === 1) {
    return {
      dist: Math.hypot(px - points[0].x, pz - points[0].z),
      arcS: 0,
      totalLen: 0,
      closestX: points[0].x,
      closestZ: points[0].z,
      tx: 1,
      tz: 0,
    };
  }

  let bestDist = Infinity;
  let bestS = 0;
  let bestX = points[0].x;
  let bestZ = points[0].z;
  let bestTx = 1;
  let bestTz = 0;
  let accumS = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    const res = pointToSegment2D(px, pz, a.x, a.z, b.x, b.z);
    if (res.dist < bestDist) {
      bestDist = res.dist;
      bestS = accumS + res.t * segLen;
      bestX = res.closestX;
      bestZ = res.closestZ;
      if (segLen > 1e-5) {
        bestTx = (b.x - a.x) / segLen;
        bestTz = (b.z - a.z) / segLen;
      }
    }
    accumS += segLen;
  }

  return {
    dist: bestDist,
    arcS: bestS,
    totalLen: accumS,
    closestX: bestX,
    closestZ: bestZ,
    tx: bestTx,
    tz: bestTz,
  };
}

/**
 * Signed 2D distance from world point (px, pz) to an oriented rectangle (cx, cz, width, depth, rotation).
 * Negative inside, positive outside.
 */
export function pointToOBBSignedDist2D(px, pz, cx, cz, width, depth, rotation = 0) {
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const dx = px - cx;
  const dz = pz - cz;
  const lx = Math.abs(dx * cos - dz * sin) - width * 0.5;
  const lz = Math.abs(dx * sin + dz * cos) - depth * 0.5;
  const outDist = Math.hypot(Math.max(lx, 0), Math.max(lz, 0));
  const inDist = Math.min(Math.max(lx, lz), 0);
  return outDist + inDist;
}

/**
 * Disposes owned BufferGeometries inside a Group/Object3D hierarchy without touching shared geometries
 * or shared MaterialLibrary materials.
 */
export function disposeHierarchy(root) {
  if (!root) return;
  root.traverse((obj) => {
    if (obj.geometry && !obj.geometry.userData?.isSharedArchGeo) {
      obj.geometry.dispose();
    }
    if (obj.material && obj.material.userData?.isOwnedPreviewMat) {
      obj.material.dispose();
    }
  });
}
