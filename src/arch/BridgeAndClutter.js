import * as THREE from 'three';
import {
  GeometryCollector,
  mulberry32,
  hashSeed,
  resolveWallColor,
  jitterStoneColor,
  resampleCatmullRomXZ,
  sampleSplineAtS,
  pointToSegment2D,
} from './GeometryUtils.js';

/**
 * Inspects all paths against terrain height < waterLevel - 0.04 and automatically builds
 * charming arched cobblestone & timber bridges across every contiguous underwater span!
 */
export function buildAutoBridges(paths, ctx) {
  const {
    materials,
    getTerrainHeight = () => 0,
    waterLevel = -0.35,
  } = ctx;

  const bridges = [];
  if (!Array.isArray(paths) || paths.length === 0) return bridges;

  let bridgeCounter = 0;

  for (let pIdx = 0; pIdx < paths.length; pIdx++) {
    const path = paths[pIdx];
    if (!path || !Array.isArray(path.points) || path.points.length < 2) continue;

    const spline = resampleCatmullRomXZ(path.points, 0.3);
    const { samples, totalLength } = spline;
    if (samples.length < 3 || totalLength < 1.2) continue;

    const heights = samples.map((pt) => getTerrainHeight(pt.x, pt.z));
    const wetThreshold = waterLevel - 0.04;

    // Identify raw underwater index intervals
    const rawSpans = [];
    let inWater = false;
    let spanStartIdx = 0;

    for (let i = 0; i < samples.length; i++) {
      const wet = heights[i] < wetThreshold;
      if (wet && !inWater) {
        inWater = true;
        spanStartIdx = i;
      } else if (!wet && inWater) {
        inWater = false;
        rawSpans.push({ i0: spanStartIdx, i1: i - 1 });
      }
    }
    if (inWater) {
      rawSpans.push({ i0: spanStartIdx, i1: samples.length - 1 });
    }

    if (rawSpans.length === 0) continue;

    // Merge wet spans separated by tiny dry islands (< 1.8m)
    const mergedSpans = [rawSpans[0]];
    for (let k = 1; k < rawSpans.length; k++) {
      const prev = mergedSpans[mergedSpans.length - 1];
      const cur = rawSpans[k];
      const gapLen = samples[cur.i0].s - samples[prev.i1].s;
      if (gapLen < 1.8) {
        prev.i1 = cur.i1;
      } else {
        mergedSpans.push(cur);
      }
    }

    // Build a 3D bridge for each qualifying underwater span
    for (let k = 0; k < mergedSpans.length; k++) {
      const wetSpan = mergedSpans[k];
      const wetLen = samples[wetSpan.i1].s - samples[wetSpan.i0].s;
      if (wetLen < 0.7) continue;

      const approach = 1.65;
      const sStart = Math.max(0, samples[wetSpan.i0].s - approach);
      const sEnd = Math.min(totalLength, samples[wetSpan.i1].s + approach);
      const spanLen = sEnd - sStart;
      if (spanLen < 1.6) continue;

      const bridgeId = `bridge_${path.id || pIdx}_${bridgeCounter++}`;
      const bridgeObj = constructSingleBridge({
        id: bridgeId,
        pathId: path.id,
        samples,
        sStart,
        sEnd,
        spanLen,
        width: Math.max(2.2, (path.width || 2.2) * 1.08),
        materials,
        getTerrainHeight,
        waterLevel,
        seed: hashSeed(bridgeId, 509),
      });

      if (bridgeObj) {
        bridges.push(bridgeObj);
      }
    }
  }

  return bridges;
}

function constructSingleBridge({
  id,
  pathId,
  samples,
  sStart,
  sEnd,
  spanLen,
  width,
  materials,
  getTerrainHeight,
  waterLevel,
  seed,
}) {
  const rng = mulberry32(seed);
  const segCount = Math.max(8, Math.ceil(spanLen / 0.45));
  const halfW = width * 0.5;

  const spanSamples = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i <= segCount; i++) {
    const u = i / segCount;
    const s = sStart + u * spanLen;
    const pose = sampleSplineAtS(samples, s);
    const bedY = getTerrainHeight(pose.x, pose.z);
    spanSamples.push({ ...pose, u, bedY });
    if (pose.x < minX) minX = pose.x;
    if (pose.x > maxX) maxX = pose.x;
    if (pose.z < minZ) minZ = pose.z;
    if (pose.z > maxZ) maxZ = pose.z;
  }

  const bankY0 = Math.max(spanSamples[0].bedY, waterLevel + 0.04);
  const bankY1 = Math.max(spanSamples[spanSamples.length - 1].bedY, waterLevel + 0.04);
  const avgBank = 0.5 * (bankY0 + bankY1);
  const minClearCrown = waterLevel + 0.78;
  const naturalArchRise = Math.max(0.48, Math.min(1.42, spanLen * 0.105));
  const archRise = Math.max(naturalArchRise, minClearCrown - avgBank);

  function evalDeckY(u) {
    const uc = Math.max(0, Math.min(1, u));
    const baseLine = bankY0 + (bankY1 - bankY0) * uc;
    // Smooth sinusoidal arch hump with gentle ease-in at bank approaches
    const hump = Math.pow(Math.sin(Math.PI * uc), 0.92) * archRise;
    return baseLine + hump;
  }

  const midPose = spanSamples[Math.floor(spanSamples.length * 0.5)];
  const anchorX = midPose.x;
  const anchorY = waterLevel;
  const anchorZ = midPose.z;

  const group = new THREE.Group();
  group.name = `arch_bridge_${id}`;
  group.userData.archEntityId = id;
  group.userData.archEntityType = 'bridge';
  group.position.set(anchorX, anchorY, anchorZ);

  const cobbleGC = new GeometryCollector();
  const stoneGC = new GeometryCollector();
  const timberGC = new GeometryCollector();
  const emissiveGC = new GeometryCollector();
  const lanternPositions = [];

  const baseStone = resolveWallColor(materials, 'cotswold').lerp(resolveWallColor(materials, 'limestone'), 0.5);
  const upVec = new THREE.Vector3(0, 1, 0);

  // 1. Crowned Cobblestone Roadway Deck + Timber Sub-Deck Planks + Stone Curb Blocks
  const deckThick = 0.18;
  for (let i = 0; i < segCount; i++) {
    const a = spanSamples[i];
    const b = spanSamples[i + 1];
    const yA = evalDeckY(a.u);
    const yB = evalDeckY(b.u);

    // Slight entrance flare at u near 0 or 1
    const flareA = 1 + 0.12 * Math.pow(Math.max(0, 1 - Math.min(a.u, 1 - a.u) / 0.14), 2);
    const flareB = 1 + 0.12 * Math.pow(Math.max(0, 1 - Math.min(b.u, 1 - b.u) / 0.14), 2);
    const hwA = halfW * flareA;
    const hwB = halfW * flareB;

    const pAL = new THREE.Vector3(a.x - a.nx * hwA - anchorX, yA - anchorY, a.z - a.nz * hwA - anchorZ);
    const pAC = new THREE.Vector3(a.x - anchorX, yA + 0.038 - anchorY, a.z - anchorZ);
    const pAR = new THREE.Vector3(a.x + a.nx * hwA - anchorX, yA - anchorY, a.z + a.nz * hwA - anchorZ);

    const pBL = new THREE.Vector3(b.x - b.nx * hwB - anchorX, yB - anchorY, b.z - b.nz * hwB - anchorZ);
    const pBC = new THREE.Vector3(b.x - anchorX, yB + 0.038 - anchorY, b.z - anchorZ);
    const pBR = new THREE.Vector3(b.x + b.nx * hwB - anchorX, yB - anchorY, b.z + b.nz * hwB - anchorZ);

    // Cobblestone crowned top surface (2 strips for center crown)
    cobbleGC.pushQuad(pAL, pAC, pBC, pBL, upVec, 0.55, [1, 1, 1]);
    cobbleGC.pushQuad(pAC, pAR, pBR, pBC, upVec, 0.55, [1, 1, 1]);

    // Underside timber deck soffit
    const uAL = pAL.clone().setY(pAL.y - deckThick);
    const uAR = pAR.clone().setY(pAR.y - deckThick);
    const uBL = pBL.clone().setY(pBL.y - deckThick);
    const uBR = pBR.clone().setY(pBR.y - deckThick);
    timberGC.pushQuad(uAL, uBL, uBR, uAR, new THREE.Vector3(0, -1, 0), 0.5, [0.78, 0.74, 0.7]);

    // Left & Right 3D Beveled Stone Curb Blocks along bridge edges
    for (const side of [-1, 1]) {
      const cInA = hwA - 0.16;
      const cOutA = hwA + 0.08;
      const cInB = hwB - 0.16;
      const cOutB = hwB + 0.08;

      const sIn = side < 0 ? -cOutA : cInA;
      const sOut = side < 0 ? -cInA : cOutA;
      const eIn = side < 0 ? -cOutB : cInB;
      const eOut = side < 0 ? -cInB : cOutB;

      const curbHex = [
        new THREE.Vector3(a.x + a.nx * sIn - anchorX, yA - deckThick - 0.04 - anchorY, a.z + a.nz * sIn - anchorZ),
        new THREE.Vector3(b.x + b.nx * eIn - anchorX, yB - deckThick - 0.04 - anchorY, b.z + b.nz * eIn - anchorZ),
        new THREE.Vector3(b.x + b.nx * eOut - anchorX, yB - deckThick - 0.04 - anchorY, b.z + b.nz * eOut - anchorZ),
        new THREE.Vector3(a.x + a.nx * sOut - anchorX, yA - deckThick - 0.04 - anchorY, a.z + a.nz * sOut - anchorZ),
        new THREE.Vector3(a.x + a.nx * sIn - anchorX, yA + 0.085 - anchorY, a.z + a.nz * sIn - anchorZ),
        new THREE.Vector3(b.x + b.nx * eIn - anchorX, yB + 0.085 - anchorY, b.z + b.nz * eIn - anchorZ),
        new THREE.Vector3(b.x + b.nx * eOut - anchorX, yB + 0.085 - anchorY, b.z + b.nz * eOut - anchorZ),
        new THREE.Vector3(a.x + a.nx * sOut - anchorX, yA + 0.085 - anchorY, a.z + b.nz * sOut - anchorZ),
      ];
      stoneGC.pushBeveledStone(curbHex, jitterStoneColor(baseStone, rng, 0.96, 0.07));
    }
  }

  // 2. Arched Stone Vault / Voussoir Ribs & Deep Pond-Bed Piers (ZERO floating!)
  // Stone bank abutments at both ends (u in [0, 0.14] and [0.86, 1.0])
  const abutmentRanges = [
    [0, Math.min(2, segCount - 1)],
    [Math.max(0, segCount - 2), segCount],
  ];
  for (let aIdx = 0; aIdx < 2; aIdx++) {
    const [i0, i1] = abutmentRanges[aIdx];
    const p0 = spanSamples[i0];
    const p1 = spanSamples[i1];
    const top0 = evalDeckY(p0.u) - deckThick + 0.02;
    const top1 = evalDeckY(p1.u) - deckThick + 0.02;
    const bot = Math.min(p0.bedY, p1.bedY) - 0.55;
    const wAb = halfW + 0.12;
    const abHex = [
      new THREE.Vector3(p0.x - p0.nx * (wAb + 0.1) - anchorX, bot - anchorY, p0.z - p0.nz * (wAb + 0.1) - anchorZ),
      new THREE.Vector3(p1.x - p1.nx * (wAb + 0.1) - anchorX, bot - anchorY, p1.z - p1.nz * (wAb + 0.1) - anchorZ),
      new THREE.Vector3(p1.x + p1.nx * (wAb + 0.1) - anchorX, bot - anchorY, p1.z + p1.nz * (wAb + 0.1) - anchorZ),
      new THREE.Vector3(p0.x + p0.nx * (wAb + 0.1) - anchorX, bot - anchorY, p0.z + p0.nz * (wAb + 0.1) - anchorZ),
      new THREE.Vector3(p0.x - p0.nx * wAb - anchorX, top0 - anchorY, p0.z - p0.nz * wAb - anchorZ),
      new THREE.Vector3(p1.x - p1.nx * wAb - anchorX, top1 - anchorY, p1.z - p1.nz * wAb - anchorZ),
      new THREE.Vector3(p1.x + p1.nx * wAb - anchorX, top1 - anchorY, p1.z + p1.nz * wAb - anchorZ),
      new THREE.Vector3(p0.x + p0.nx * wAb - anchorX, top0 - anchorY, p0.z + p0.nz * wAb - anchorZ),
    ];
    stoneGC.pushBeveledStone(abHex, jitterStoneColor(baseStone, rng, 0.78, 0.06));
  }

  // Graceful Stone Voussoir Arch Vault spanning between banks (or multi-pier timber/stone bents on long spans)
  const archStartIdx = Math.min(2, Math.floor(segCount * 0.14));
  const archEndIdx = Math.max(segCount - 2, Math.ceil(segCount * 0.86));
  for (let i = archStartIdx; i < archEndIdx; i++) {
    const a = spanSamples[i];
    const b = spanSamples[i + 1];
    const v0 = (i - archStartIdx) / Math.max(1, archEndIdx - archStartIdx);
    const v1 = (i + 1 - archStartIdx) / Math.max(1, archEndIdx - archStartIdx);

    const springBase = Math.min(bankY0, bankY1) - 0.35;
    const crownUnder = evalDeckY(0.5) - deckThick - 0.06;
    const archSoffit0 = springBase + Math.sin(Math.PI * v0) * (crownUnder - springBase);
    const archSoffit1 = springBase + Math.sin(Math.PI * v1) * (crownUnder - springBase);
    const deckUnder0 = evalDeckY(a.u) - deckThick + 0.02;
    const deckUnder1 = evalDeckY(b.u) - deckThick + 0.02;

    const isKey = Math.abs(0.5 * (v0 + v1) - 0.5) < 0.07;
    const archW = isKey ? halfW + 0.1 : halfW + 0.04;
    const archHex = [
      new THREE.Vector3(a.x - a.nx * archW - anchorX, archSoffit0 - (isKey ? 0.06 : 0) - anchorY, a.z - a.nz * archW - anchorZ),
      new THREE.Vector3(b.x - b.nx * archW - anchorX, archSoffit1 - (isKey ? 0.06 : 0) - anchorY, b.z - b.nz * archW - anchorZ),
      new THREE.Vector3(b.x + b.nx * archW - anchorX, archSoffit1 - (isKey ? 0.06 : 0) - anchorY, b.z + b.nz * archW - anchorZ),
      new THREE.Vector3(a.x + a.nx * archW - anchorX, archSoffit0 - (isKey ? 0.06 : 0) - anchorY, a.z + a.nz * archW - anchorZ),
      new THREE.Vector3(a.x - a.nx * archW - anchorX, deckUnder0 - anchorY, a.z - a.nz * archW - anchorZ),
      new THREE.Vector3(b.x - b.nx * archW - anchorX, deckUnder1 - anchorY, b.z - b.nz * archW - anchorZ),
      new THREE.Vector3(b.x + b.nx * archW - anchorX, deckUnder1 - anchorY, b.z + b.nz * archW - anchorZ),
      new THREE.Vector3(a.x + a.nx * archW - anchorX, deckUnder0 - anchorY, a.z + a.nz * archW - anchorZ),
    ];
    stoneGC.pushBeveledStone(archHex, jitterStoneColor(baseStone, rng, isKey ? 1.04 : 0.89, 0.07));
  }

  // Heavy Timber Trestle Piers reaching pond bed on longer bridges (> 8.5m)
  if (spanLen > 8.5) {
    const numBents = Math.max(1, Math.floor(spanLen / 6.5) - 1);
    for (let bIdx = 1; bIdx <= numBents; bIdx++) {
      const uBent = bIdx / (numBents + 1);
      const sBent = sStart + uBent * spanLen;
      const pose = sampleSplineAtS(samples, sBent);
      const bedY = getTerrainHeight(pose.x, pose.z) - 0.48;
      const topY = evalDeckY(uBent) - deckThick;
      if (topY - bedY > 0.35) {
        for (const side of [-1, 1]) {
          const px = pose.x + pose.nx * side * (halfW * 0.72) - anchorX;
          const pz = pose.z + pose.nz * side * (halfW * 0.72) - anchorZ;
          timberGC.pushCylinder(
            new THREE.Vector3(px, bedY - anchorY, pz),
            new THREE.Vector3(px, topY - anchorY, pz),
            0.13,
            0.11,
            8,
            [0.82, 0.78, 0.74]
          );
        }
      }
    }
  }

  // 3. Four Corner Stone Bollard Piers + Rustic Timber Railings & Lantern Posts!
  for (const uEnd of [0, 1]) {
    const pose = uEnd === 0 ? spanSamples[0] : spanSamples[spanSamples.length - 1];
    const dy = evalDeckY(uEnd);
    const hwEnd = halfW * 1.12;
    for (const side of [-1, 1]) {
      const bx = pose.x + pose.nx * side * (hwEnd + 0.04) - anchorX;
      const bz = pose.z + pose.nz * side * (hwEnd + 0.04) - anchorZ;
      const bBot = pose.bedY - 0.35 - anchorY;
      const bTop = dy + 0.88 - anchorY;
      stoneGC.pushBeveledStone(
        [
          new THREE.Vector3(bx - 0.19, bBot, bz - 0.19),
          new THREE.Vector3(bx + 0.19, bBot, bz - 0.19),
          new THREE.Vector3(bx + 0.19, bBot, bz + 0.19),
          new THREE.Vector3(bx - 0.19, bBot, bz + 0.19),
          new THREE.Vector3(bx - 0.16, bTop, bz - 0.16),
          new THREE.Vector3(bx + 0.16, bTop, bz - 0.16),
          new THREE.Vector3(bx + 0.16, bTop, bz + 0.16),
          new THREE.Vector3(bx - 0.16, bTop, bz + 0.16),
        ],
        jitterStoneColor(baseStone, rng, 0.96, 0.06)
      );
      // Pyramidal cap
      stoneGC.pushBeveledStone(
        [
          new THREE.Vector3(bx - 0.19, bTop, bz - 0.19),
          new THREE.Vector3(bx + 0.19, bTop, bz - 0.19),
          new THREE.Vector3(bx + 0.19, bTop, bz + 0.19),
          new THREE.Vector3(bx - 0.19, bTop, bz + 0.19),
          new THREE.Vector3(bx - 0.06, bTop + 0.16, bz - 0.06),
          new THREE.Vector3(bx + 0.06, bTop + 0.16, bz - 0.06),
          new THREE.Vector3(bx + 0.06, bTop + 0.16, bz + 0.06),
          new THREE.Vector3(bx - 0.06, bTop + 0.16, bz + 0.06),
        ],
        jitterStoneColor(baseStone, rng, 1.05, 0.05)
      );
    }
  }

  // Timber railing posts & curved handrails
  const postBays = Math.max(3, Math.round(spanLen / 1.45));
  const midPostIdx = Math.round(postBays * 0.5);
  const hasBridgeLanterns = spanLen >= 4.2;

  for (let b = 0; b <= postBays; b++) {
    const u = b / postBays;
    const pose = sampleSplineAtS(samples, sStart + u * spanLen);
    const dy = evalDeckY(u);
    const flare = 1 + 0.12 * Math.pow(Math.max(0, 1 - Math.min(u, 1 - u) / 0.14), 2);
    const railOff = halfW * flare + 0.02;

    const isLanternPost = hasBridgeLanterns && b === midPostIdx;

    for (const side of [-1, 1]) {
      if (b === 0 || b === postBays) continue; // Corner stone bollards already occupy ends
      const px = pose.x + pose.nx * side * railOff - anchorX;
      const pz = pose.z + pose.nz * side * railOff - anchorZ;
      const postH = isLanternPost && side === 1 ? 1.95 : 0.84;

      timberGC.pushCylinder(
        new THREE.Vector3(px, dy - 0.05 - anchorY, pz),
        new THREE.Vector3(px, dy + postH - anchorY, pz),
        0.058,
        0.05,
        6,
        [0.92, 0.88, 0.84]
      );

      // Hanging lantern on mid-span bridge post!
      if (isLanternPost && side === 1) {
        const armInX = px - pose.nx * side * 0.28;
        const armInZ = pz - pose.nz * side * 0.28;
        const topLY = dy + postH - anchorY;
        const tanAx = new THREE.Vector3(pose.tx, 0, pose.tz);
        const normAx = new THREE.Vector3(pose.nx, 0, pose.nz);
        timberGC.pushOrientedBox(
          new THREE.Vector3(0.5 * (px + armInX), topLY - 0.04, 0.5 * (pz + armInZ)),
          tanAx,
          upVec,
          normAx,
          0.025,
          0.028,
          0.18,
          [0.3, 0.3, 0.32]
        );
        timberGC.pushCylinder(
          new THREE.Vector3(armInX, topLY - 0.14, armInZ),
          new THREE.Vector3(armInX, topLY - 0.06, armInZ),
          0.12,
          0.02,
          6,
          [0.26, 0.26, 0.28]
        );
        emissiveGC.pushCylinder(
          new THREE.Vector3(armInX, topLY - 0.29, armInZ),
          new THREE.Vector3(armInX, topLY - 0.14, armInZ),
          0.068,
          0.078,
          6,
          [1, 1, 1]
        );
        lanternPositions.push({
          position: new THREE.Vector3(armInX + anchorX, topLY - 0.22 + anchorY, armInZ + anchorZ),
          intensity: 1.0,
        });
      }
    }

    if (b < postBays) {
      const uNext = (b + 1) / postBays;
      const poseNext = sampleSplineAtS(samples, sStart + uNext * spanLen);
      const dyNext = evalDeckY(uNext);
      const flareNext = 1 + 0.12 * Math.pow(Math.max(0, 1 - Math.min(uNext, 1 - uNext) / 0.14), 2);
      const railOffNext = halfW * flareNext + 0.02;

      for (const side of [-1, 1]) {
        for (const railH of [0.42, 0.8]) {
          const pA = new THREE.Vector3(
            pose.x + pose.nx * side * railOff - anchorX,
            dy + railH - anchorY,
            pose.z + pose.nz * side * railOff - anchorZ
          );
          const pB = new THREE.Vector3(
            poseNext.x + poseNext.nx * side * railOffNext - anchorX,
            dyNext + railH - anchorY,
            poseNext.z + poseNext.nz * side * railOffNext - anchorZ
          );
          const dir = new THREE.Vector3().subVectors(pB, pA);
          const len = dir.length();
          if (len > 0.04) {
            dir.multiplyScalar(1 / len);
            const zAx = new THREE.Vector3().crossVectors(dir, upVec).normalize();
            const yAx = new THREE.Vector3().crossVectors(zAx, dir).normalize();
            const mid = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);
            timberGC.pushOrientedBox(mid, dir, yAx, zAx, len * 0.5 + 0.02, railH > 0.6 ? 0.045 : 0.032, 0.038, [0.95, 0.91, 0.86]);
          }
        }
      }
    }
  }

  if (!cobbleGC.isEmpty) {
    const m = new THREE.Mesh(cobbleGC.toBufferGeometry(), materials.cobble || materials.stoneWall);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  if (!stoneGC.isEmpty) {
    const m = new THREE.Mesh(stoneGC.toBufferGeometry(), materials.stoneWall);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  if (!timberGC.isEmpty) {
    const m = new THREE.Mesh(timberGC.toBufferGeometry(), materials.timber);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  if (!emissiveGC.isEmpty) {
    const m = new THREE.Mesh(emissiveGC.toBufferGeometry(), materials.lanternEmissive);
    m.castShadow = false;
    m.receiveShadow = false;
    group.add(m);
  }

  const bboxPad = halfW + 0.6;
  return {
    id,
    entityType: 'bridge',
    type: 'bridge',
    pathId,
    group,
    anchor: new THREE.Vector3(anchorX, anchorY, anchorZ),
    position: { x: anchorX, y: evalDeckY(0.5), z: anchorZ },
    halfWidth: halfW,
    spanSamples,
    evalDeckY,
    lanternPositions,
    bbox: {
      minX: minX - bboxPad,
      maxX: maxX + bboxPad,
      minZ: minZ - bboxPad,
      maxZ: maxZ + bboxPad,
    },
  };
}

/**
 * Evaluates bridge roadway surface height at world (x, z) if (x, z) lies on any active bridge,
 * else returns null. Used by First-Person Stroll & path walkers!
 */
export function evalBridgeHeightAt(bridges, x, z) {
  if (!bridges || bridges.length === 0) return null;
  let bestHeight = null;

  for (let b = 0; b < bridges.length; b++) {
    const br = bridges[b];
    if (x < br.bbox.minX || x > br.bbox.maxX || z < br.bbox.minZ || z > br.bbox.maxZ) continue;

    const pts = br.spanSamples;
    let minDist = Infinity;
    let bestU = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const hit = pointToSegment2D(x, z, p0.x, p0.z, p1.x, p1.z);
      if (hit.dist < minDist) {
        minDist = hit.dist;
        bestU = p0.u + (p1.u - p0.u) * hit.t;
      }
    }

    const flare = 1 + 0.12 * Math.pow(Math.max(0, 1 - Math.min(bestU, 1 - bestU) / 0.14), 2);
    if (minDist <= br.halfWidth * flare + 0.22) {
      const h = br.evalDeckY(bestU);
      if (bestHeight === null || h > bestHeight) {
        bestHeight = h;
      }
    }
  }

  return bestHeight;
}

/**
 * Builds manual or procedural clutter entities:
 * 'lantern' | 'window' | 'door' | 'chimney' | 'flag' | 'bench' | 'flowerbox' | 'ivy'
 */
export function buildClutterEntity(spec, ctx) {
  const id = spec.id || 'clutter_0';
  const type = spec.type || spec.subtype || spec.kind || 'lantern';
  const { materials, getTerrainHeight = () => 0 } = ctx;

  const px = Number.isFinite(spec.x) ? spec.x : Number(spec.position?.x || 0);
  const pz = Number.isFinite(spec.z) ? spec.z : Number(spec.position?.z || 0);
  const terrainY = getTerrainHeight(px, pz);
  const hasExplicitY = Number.isFinite(spec.y) || Number.isFinite(spec.position?.y);
  const py = hasExplicitY
    ? (Number.isFinite(spec.y) ? spec.y : Number(spec.position.y))
    : terrainY;

  // Determine orientation yaw from normal (if snapped to wall) or spec.rotation
  let yaw = Number.isFinite(spec.rotation) ? spec.rotation : 0;
  let hasWallNormal = false;
  if (spec.normal && (Math.abs(spec.normal.x) > 0.05 || Math.abs(spec.normal.z) > 0.05)) {
    const horizLen = Math.hypot(spec.normal.x, spec.normal.z);
    if (horizLen > 0.45 && Math.abs(spec.normal.y || 0) < 0.72) {
      yaw = Math.atan2(spec.normal.x, spec.normal.z);
      hasWallNormal = true;
    }
  }

  const group = new THREE.Group();
  group.name = `arch_clutter_${type}_${id}`;
  group.userData.archEntityId = id;
  group.userData.archEntityType = 'clutter';
  group.position.set(px, py, pz);
  group.rotation.y = yaw;

  const rng = mulberry32(spec.seed ?? hashSeed(id, 733));
  const stoneGC = new GeometryCollector();
  const timberGC = new GeometryCollector();
  const windowGC = new GeometryCollector();
  const foliageGC = new GeometryCollector();
  const emissiveGC = new GeometryCollector();

  const chimneyPositions = [];
  const lanternPositions = [];
  let flagAnim = null;

  const xAx = new THREE.Vector3(1, 0, 0);
  const yAx = new THREE.Vector3(0, 1, 0);
  const zAx = new THREE.Vector3(0, 0, 1);
  const baseStone = resolveWallColor(materials, spec.wallStyle || 'limestone');

  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  function localToWorld(lx, ly, lz) {
    return new THREE.Vector3(
      px + lx * cosY + lz * sinY,
      py + ly,
      pz - lx * sinY + lz * cosY
    );
  }

  if (type === 'lantern') {
    const isWallMounted = Boolean(spec.wallMounted) || hasWallNormal || py > terrainY + 0.55;
    if (isWallMounted) {
      // Wrought-iron wall backplate + scroll arm + hanging amber lantern
      timberGC.pushOrientedBox(new THREE.Vector3(0, 0, 0.015), xAx, yAx, zAx, 0.05, 0.14, 0.015, [0.26, 0.26, 0.28]);
      timberGC.pushOrientedBox(new THREE.Vector3(0, 0.08, 0.16), xAx, yAx, zAx, 0.02, 0.024, 0.16, [0.26, 0.26, 0.28]);
      timberGC.pushOrientedBox(
        new THREE.Vector3(0, 0.0, 0.1),
        xAx,
        new THREE.Vector3(0, 0.7, 0.7).normalize(),
        new THREE.Vector3(0, -0.7, 0.7).normalize(),
        0.016,
        0.12,
        0.016,
        [0.26, 0.26, 0.28]
      );
      timberGC.pushCylinder(new THREE.Vector3(0, -0.02, 0.28), new THREE.Vector3(0, 0.07, 0.28), 0.11, 0.02, 6, [0.25, 0.25, 0.28]);
      emissiveGC.pushCylinder(new THREE.Vector3(0, -0.17, 0.28), new THREE.Vector3(0, -0.02, 0.28), 0.068, 0.078, 6, [1, 1, 1]);
      timberGC.pushCylinder(new THREE.Vector3(0, -0.21, 0.28), new THREE.Vector3(0, -0.17, 0.28), 0.03, 0.075, 6, [0.25, 0.25, 0.28]);
      lanternPositions.push({ position: localToWorld(0, -0.1, 0.34), intensity: 1.0 });
    } else {
      // Pathside ground lamppost with stone plinth, oak post, crook arm, and hanging lantern!
      stoneGC.pushBeveledStone(
        [
          new THREE.Vector3(-0.22, -0.25, -0.22),
          new THREE.Vector3(0.22, -0.25, -0.22),
          new THREE.Vector3(0.22, -0.25, 0.22),
          new THREE.Vector3(-0.22, -0.25, 0.22),
          new THREE.Vector3(-0.17, 0.22, -0.17),
          new THREE.Vector3(0.17, 0.22, -0.17),
          new THREE.Vector3(0.17, 0.22, 0.17),
          new THREE.Vector3(-0.17, 0.22, 0.17),
        ],
        jitterStoneColor(baseStone, rng, 0.88, 0.06)
      );
      timberGC.pushCylinder(new THREE.Vector3(0, 0.2, 0), new THREE.Vector3(0, 2.28, 0), 0.07, 0.055, 8, [0.9, 0.86, 0.82]);
      timberGC.pushOrientedBox(new THREE.Vector3(0, 2.2, 0.22), xAx, yAx, zAx, 0.028, 0.032, 0.26, [0.3, 0.3, 0.32]);
      timberGC.pushCylinder(new THREE.Vector3(0, 2.06, 0.42), new THREE.Vector3(0, 2.16, 0.42), 0.125, 0.025, 6, [0.26, 0.26, 0.28]);
      emissiveGC.pushCylinder(new THREE.Vector3(0, 1.9, 0.42), new THREE.Vector3(0, 2.06, 0.42), 0.075, 0.085, 6, [1, 1, 1]);
      timberGC.pushCylinder(new THREE.Vector3(0, 1.85, 0.42), new THREE.Vector3(0, 1.9, 0.42), 0.03, 0.08, 6, [0.26, 0.26, 0.28]);
      lanternPositions.push({ position: localToWorld(0, 1.98, 0.42), intensity: 1.05 });
    }
  } else if (type === 'flag') {
    // Tall mast pole + finial orb + dynamic wind-rippling cloth pennant!
    const mastH = Number.isFinite(spec.mastHeight) ? spec.mastHeight : 2.15;
    timberGC.pushCylinder(new THREE.Vector3(0, -0.15, 0), new THREE.Vector3(0, mastH, 0), 0.048, 0.032, 8, [0.85, 0.8, 0.74]);
    timberGC.pushCylinder(new THREE.Vector3(0, mastH, 0), new THREE.Vector3(0, mastH + 0.12, 0), 0.068, 0.068, 8, [0.92, 0.78, 0.42]);

    flagAnim = createWavingBannerMesh(materials, mastH - 0.08, spec.color, rng);
    group.add(flagAnim.mesh);
  } else if (type === 'chimney') {
    const chH = 1.65;
    const rows = 6;
    for (let r = 0; r < rows; r++) {
      const y0 = -0.2 + (r / rows) * chH;
      const y1 = -0.2 + ((r + 1) / rows) * chH;
      const hw = 0.34 * (1 - (r / rows) * 0.12);
      stoneGC.pushBeveledStone(
        [
          new THREE.Vector3(-hw, y0, -hw),
          new THREE.Vector3(hw, y0, -hw),
          new THREE.Vector3(hw, y0, hw),
          new THREE.Vector3(-hw, y0, hw),
          new THREE.Vector3(-hw, y1, -hw),
          new THREE.Vector3(hw, y1, -hw),
          new THREE.Vector3(hw, y1, hw),
          new THREE.Vector3(-hw, y1, hw),
        ],
        jitterStoneColor(baseStone, rng, 0.95, 0.08)
      );
    }
    const topY = -0.2 + chH;
    stoneGC.pushBeveledStone(
      [
        new THREE.Vector3(-0.38, topY, -0.38),
        new THREE.Vector3(0.38, topY, -0.38),
        new THREE.Vector3(0.38, topY, 0.38),
        new THREE.Vector3(-0.38, topY, 0.38),
        new THREE.Vector3(-0.38, topY + 0.12, -0.38),
        new THREE.Vector3(0.38, topY + 0.12, -0.38),
        new THREE.Vector3(0.38, topY + 0.12, 0.38),
        new THREE.Vector3(-0.38, topY + 0.12, 0.38),
      ],
      jitterStoneColor(baseStone, rng, 1.04, 0.05)
    );
    stoneGC.pushCylinder(new THREE.Vector3(0, topY + 0.11, 0), new THREE.Vector3(0, topY + 0.42, 0), 0.15, 0.13, 8, [0.74, 0.38, 0.26]);
    chimneyPositions.push(localToWorld(0, topY + 0.45, 0));
  } else if (type === 'window') {
    const hw = 0.44;
    const hh = 0.56;
    windowGC.pushQuad(
      new THREE.Vector3(-hw, -hh, 0.03),
      new THREE.Vector3(hw, -hh, 0.03),
      new THREE.Vector3(hw, hh, 0.03),
      new THREE.Vector3(-hw, hh, 0.03),
      zAx,
      1.1
    );
    for (const s of [-1, 1]) {
      timberGC.pushOrientedBox(new THREE.Vector3(s * hw, 0, 0.055), xAx, yAx, zAx, 0.035, hh + 0.04, 0.04, [0.9, 0.87, 0.82]);
      timberGC.pushOrientedBox(new THREE.Vector3(0, s * hh, 0.055), xAx, yAx, zAx, hw + 0.05, 0.035, 0.04, [0.9, 0.87, 0.82]);
      timberGC.pushOrientedBox(new THREE.Vector3(s * (hw + 0.24), 0, 0.065), xAx, yAx, zAx, 0.18, hh * 0.95, 0.022, [0.85, 0.82, 0.78]);
    }
    timberGC.pushOrientedBox(new THREE.Vector3(0, 0, 0.045), xAx, yAx, zAx, 0.018, hh, 0.018, [0.88, 0.85, 0.8]);
    timberGC.pushOrientedBox(new THREE.Vector3(0, 0.06, 0.045), xAx, yAx, zAx, hw, 0.018, 0.018, [0.88, 0.85, 0.8]);
    stoneGC.pushBeveledStone(
      [
        new THREE.Vector3(-hw - 0.12, hh + 0.03, -0.04),
        new THREE.Vector3(hw + 0.12, hh + 0.03, -0.04),
        new THREE.Vector3(hw + 0.12, hh + 0.03, 0.1),
        new THREE.Vector3(-hw - 0.12, hh + 0.03, 0.1),
        new THREE.Vector3(-hw - 0.12, hh + 0.18, -0.04),
        new THREE.Vector3(hw + 0.12, hh + 0.18, -0.04),
        new THREE.Vector3(hw + 0.12, hh + 0.18, 0.1),
        new THREE.Vector3(-hw - 0.12, hh + 0.18, 0.1),
      ],
      jitterStoneColor(baseStone, rng, 1.02, 0.05)
    );
  } else if (type === 'door') {
    const dw = 1.08;
    const dh = 1.95;
    for (let p = 0; p < 5; p++) {
      const lx = -dw * 0.5 + (p + 0.5) * (dw / 5);
      timberGC.pushOrientedBox(new THREE.Vector3(lx, dh * 0.48, 0.035), xAx, yAx, zAx, dw * 0.092, dh * 0.48, 0.035, [0.88, 0.84, 0.78]);
    }
    for (const s of [-1, 1]) {
      stoneGC.pushBeveledStone(
        [
          new THREE.Vector3(s * (dw * 0.5 + 0.11) - 0.11, 0, -0.04),
          new THREE.Vector3(s * (dw * 0.5 + 0.11) + 0.11, 0, -0.04),
          new THREE.Vector3(s * (dw * 0.5 + 0.11) + 0.11, 0, 0.12),
          new THREE.Vector3(s * (dw * 0.5 + 0.11) - 0.11, 0, 0.12),
          new THREE.Vector3(s * (dw * 0.5 + 0.11) - 0.11, dh, -0.04),
          new THREE.Vector3(s * (dw * 0.5 + 0.11) + 0.11, dh, -0.04),
          new THREE.Vector3(s * (dw * 0.5 + 0.11) + 0.11, dh, 0.12),
          new THREE.Vector3(s * (dw * 0.5 + 0.11) - 0.11, dh, 0.12),
        ],
        jitterStoneColor(baseStone, rng, 0.98, 0.06)
      );
    }
    stoneGC.pushBeveledStone(
      [
        new THREE.Vector3(-dw * 0.5 - 0.24, dh, -0.04),
        new THREE.Vector3(dw * 0.5 + 0.24, dh, -0.04),
        new THREE.Vector3(dw * 0.5 + 0.24, dh, 0.14),
        new THREE.Vector3(-dw * 0.5 - 0.24, dh, 0.14),
        new THREE.Vector3(-dw * 0.5 - 0.24, dh + 0.24, -0.04),
        new THREE.Vector3(dw * 0.5 + 0.24, dh + 0.24, -0.04),
        new THREE.Vector3(dw * 0.5 + 0.24, dh + 0.24, 0.14),
        new THREE.Vector3(-dw * 0.5 - 0.24, dh + 0.24, 0.14),
      ],
      jitterStoneColor(baseStone, rng, 1.04, 0.05)
    );
  } else if (type === 'bench') {
    const bw = 0.85;
    for (const sx of [-1, 1]) {
      stoneGC.pushBeveledStone(
        [
          new THREE.Vector3(sx * 0.62 - 0.1, -0.12, -0.24),
          new THREE.Vector3(sx * 0.62 + 0.1, -0.12, -0.24),
          new THREE.Vector3(sx * 0.62 + 0.1, -0.12, 0.24),
          new THREE.Vector3(sx * 0.62 - 0.1, -0.12, 0.24),
          new THREE.Vector3(sx * 0.62 - 0.08, 0.44, -0.22),
          new THREE.Vector3(sx * 0.62 + 0.08, 0.44, -0.22),
          new THREE.Vector3(sx * 0.62 + 0.08, 0.44, 0.22),
          new THREE.Vector3(sx * 0.62 - 0.08, 0.44, 0.22),
        ],
        jitterStoneColor(baseStone, rng, 0.9, 0.06)
      );
      timberGC.pushOrientedBox(new THREE.Vector3(sx * 0.62, 0.68, -0.2), xAx, yAx, zAx, 0.038, 0.28, 0.038, [0.9, 0.86, 0.82]);
    }
    timberGC.pushOrientedBox(new THREE.Vector3(0, 0.47, -0.07), xAx, yAx, zAx, bw, 0.032, 0.11, [0.96, 0.92, 0.88]);
    timberGC.pushOrientedBox(new THREE.Vector3(0, 0.47, 0.11), xAx, yAx, zAx, bw, 0.032, 0.11, [0.94, 0.9, 0.86]);
    timberGC.pushOrientedBox(new THREE.Vector3(0, 0.82, -0.2), xAx, yAx, zAx, bw, 0.09, 0.028, [0.95, 0.91, 0.87]);
  } else if (type === 'flowerbox') {
    timberGC.pushOrientedBox(new THREE.Vector3(0, 0.11, 0.14), xAx, yAx, zAx, 0.52, 0.11, 0.14, [0.9, 0.86, 0.8]);
    for (let i = 0; i < 6; i++) {
      const lx = -0.4 + (i / 5) * 0.8;
      const lz = 0.14 + (rng() - 0.5) * 0.08;
      foliageGC.pushCylinder(
        new THREE.Vector3(lx, 0.18, lz),
        new THREE.Vector3(lx, 0.36 + rng() * 0.06, lz),
        0.13,
        0.09,
        6,
        [0.96, 1.0, 0.92]
      );
    }
  } else if (type === 'ivy') {
    // Climbing woody vine tendrils + lush ivy leaf cluster puffs clinging to masonry
    timberGC.pushCylinder(new THREE.Vector3(-0.08, -0.55, 0.03), new THREE.Vector3(0.12, 0.65, 0.04), 0.028, 0.014, 5, [0.76, 0.72, 0.68]);
    timberGC.pushCylinder(new THREE.Vector3(0.05, -0.35, 0.03), new THREE.Vector3(-0.28, 0.42, 0.04), 0.022, 0.012, 5, [0.76, 0.72, 0.68]);
    for (let i = 0; i < 14; i++) {
      const lx = (rng() - 0.5) * 0.78;
      const ly = -0.5 + rng() * 1.25;
      const lz = 0.05 + rng() * 0.08;
      const rad = 0.1 + rng() * 0.09;
      foliageGC.pushCylinder(
        new THREE.Vector3(lx, ly - rad * 0.45, lz),
        new THREE.Vector3(lx, ly + rad * 0.45, lz),
        rad,
        rad * 0.78,
        6,
        [0.92 + rng() * 0.08, 1.0, 0.9]
      );
    }
  }

  if (!stoneGC.isEmpty) {
    const m = new THREE.Mesh(stoneGC.toBufferGeometry(), materials.stoneWall);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  if (!timberGC.isEmpty) {
    const m = new THREE.Mesh(timberGC.toBufferGeometry(), materials.timber);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  if (!windowGC.isEmpty) {
    const m = new THREE.Mesh(windowGC.toBufferGeometry(), materials.windowGlass);
    m.castShadow = false;
    m.receiveShadow = true;
    group.add(m);
  }
  if (!foliageGC.isEmpty) {
    const m = new THREE.Mesh(foliageGC.toBufferGeometry(), materials.foliage);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  if (!emissiveGC.isEmpty) {
    const m = new THREE.Mesh(emissiveGC.toBufferGeometry(), materials.lanternEmissive);
    m.castShadow = false;
    m.receiveShadow = false;
    group.add(m);
  }

  return {
    group,
    anchor: new THREE.Vector3(px, py, pz),
    chimneyPositions,
    lanternPositions,
    flagAnim,
  };
}

/**
 * Creates a subdivided swallowtail medieval pennant banner using materials.fabric
 * with rest positions stored so updateFlagBanner() animates realistic traveling wind waves.
 */
function createWavingBannerMesh(materials, attachY, customColor, rng) {
  const segsU = 12;
  const segsV = 4;
  const bannerLen = 1.38;
  const bannerHeight = 0.46;

  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const indices = [];

  // If materials.fabric is near-white untinted, apply rich heraldic crimson/ochre vertex/instance color
  const fabMat = materials?.fabric || materials?.roofTile;
  const matIsUntinted = !fabMat?.color || (fabMat.color.r > 0.9 && fabMat.color.g > 0.9 && fabMat.color.b > 0.9);
  const bannerTint = new THREE.Color(customColor || (matIsUntinted ? '#b63b34' : '#ffffff'));

  for (let iv = 0; iv <= segsV; iv++) {
    const v = iv / segsV;
    for (let iu = 0; iu <= segsU; iu++) {
      const u = iu / segsU;
      // Tapered swallowtail medieval pennant silhouette
      const taper = 1 - u * 0.62;
      const x = 0.03 + u * bannerLen;
      const y = attachY - (v - 0.15) * bannerHeight * taper - u * u * 0.08;
      const z = 0;

      positions.push(x, y, z);
      normals.push(0, 0, 1);
      uvs.push(u, v);

      const trimGold = (v < 0.12 || v > 0.88) && matIsUntinted;
      if (trimGold) {
        colors.push(0.92, 0.74, 0.32);
      } else {
        colors.push(bannerTint.r, bannerTint.g, bannerTint.b);
      }
    }
  }

  const stride = segsU + 1;
  for (let iv = 0; iv < segsV; iv++) {
    for (let iu = 0; iu < segsU; iu++) {
      const a = iv * stride + iu;
      const b = a + 1;
      const c = a + stride + 1;
      const d = a + stride;
      // Swallowtail V-notch cutout on final two columns near center V
      if (iu >= segsU - 2 && iv >= 1 && iv <= segsV - 2) continue;
      indices.push(a, b, c, a, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.Float32BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);

  // Use 1-count InstancedMesh when untinted so instanceColor tints fabric even if fabric.vertexColors is false!
  let mesh;
  if (matIsUntinted) {
    mesh = new THREE.InstancedMesh(geo, fabMat, 1);
    mesh.setMatrixAt(0, new THREE.Matrix4());
    mesh.setColorAt(0, bannerTint);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  } else {
    mesh = new THREE.Mesh(geo, fabMat);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = false;

  return {
    mesh,
    geometry: geo,
    restPositions: new Float32Array(positions),
    phase: rng() * Math.PI * 2,
    segsU,
    segsV,
  };
}

/**
 * Animates a waving flag banner in-place with zero per-frame heap allocations.
 */
export function updateFlagBanner(flagAnim, elapsed, windStrength = 0.5) {
  if (!flagAnim || !flagAnim.geometry) return;
  const posAttr = flagAnim.geometry.attributes.position;
  const normAttr = flagAnim.geometry.attributes.normal;
  const rest = flagAnim.restPositions;
  const arr = posAttr.array;
  const nArr = normAttr.array;

  const wind = Math.max(0.18, windStrength);
  const speed = 4.2 + wind * 4.5;
  const amp = 0.08 + wind * 0.16;
  const stride = flagAnim.segsU + 1;

  for (let iv = 0; iv <= flagAnim.segsV; iv++) {
    const v = iv / flagAnim.segsV;
    for (let iu = 0; iu <= flagAnim.segsU; iu++) {
      const idx3 = (iv * stride + iu) * 3;
      const u = iu / flagAnim.segsU;
      const env = u * Math.pow(u, 0.35);
      const wave1 = Math.sin(u * 7.2 - elapsed * speed + flagAnim.phase);
      const wave2 = Math.sin(u * 13.5 - elapsed * speed * 1.45 + v * 1.8 + flagAnim.phase) * 0.35;
      const zOff = (wave1 + wave2) * amp * env;
      const yLift = wind * 0.08 * u;

      arr[idx3] = rest[idx3] - Math.abs(zOff) * 0.12;
      arr[idx3 + 1] = rest[idx3 + 1] + yLift;
      arr[idx3 + 2] = zOff;

      const dzdu = Math.cos(u * 7.2 - elapsed * speed + flagAnim.phase) * 7.2 * amp * env;
      const invL = 1 / Math.hypot(1, dzdu);
      nArr[idx3] = -dzdu * invL;
      nArr[idx3 + 1] = 0.12;
      nArr[idx3 + 2] = invL;
    }
  }

  posAttr.needsUpdate = true;
  normAttr.needsUpdate = true;
}
