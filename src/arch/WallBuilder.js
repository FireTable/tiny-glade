import * as THREE from 'three';
import {
  GeometryCollector,
  mulberry32,
  hashSeed,
  resolveWallColor,
  jitterStoneColor,
  scaleRGB,
  resampleCatmullRomXZ,
  sampleSplineAtS,
  polylineIntersections2D,
} from './GeometryUtils.js';

/**
 * Builds a procedural reactive Tiny Glade Stone Wall ('wall') or Rustic Wooden Fence ('fence')
 * along a Catmull-Rom spline, complete with staggered 3D beveled stone courses, battered base,
 * coping / crenellated battlements, endpoint/corner/intersection piers, and automatic
 * 3D Stone Voussoir Archways (or low-wall gate posts) wherever paths cross!
 */
export function buildWallEntity(wallSpec, ctx) {
  const {
    id = 'wall_0',
    type = 'wall',
    points = [],
    height = type === 'fence' ? 1.15 : 2.4,
    thickness = type === 'fence' ? 0.18 : 0.58,
    wallStyle = 'limestone',
    crenellated = false,
    seed = hashSeed(id, 101),
  } = wallSpec;

  const {
    materials,
    getTerrainHeight = () => 0,
    paths = [],
    otherWalls = [],
  } = ctx;

  const group = new THREE.Group();
  group.name = `arch_${type}_${id}`;
  group.userData.archEntityId = id;
  group.userData.archEntityType = 'wall';

  const spline = resampleCatmullRomXZ(points, 0.28);
  const { samples, corners, totalLength } = spline;

  if (samples.length < 2 || totalLength < 0.25) {
    return {
      group,
      anchor: new THREE.Vector3(points[0]?.x || 0, 0, points[0]?.z || 0),
      openings: [],
      footprintPolylines: [],
      splineSamples: samples,
      totalLength: 0,
      topY: 0,
      baseY: 0,
    };
  }

  // Anchor group at spline midpoint on terrain so elastic scale-in pops upward locally
  const midSample = sampleSplineAtS(samples, totalLength * 0.5);
  const anchorX = midSample.x;
  const anchorZ = midSample.z;
  const anchorY = getTerrainHeight(anchorX, anchorZ);
  group.position.set(anchorX, anchorY, anchorZ);

  // Sample terrain along spline + smooth crest profile
  const rawH = samples.map((pt) => getTerrainHeight(pt.x, pt.z));
  const smoothH = new Float32Array(samples.length);
  const win = 4;
  for (let i = 0; i < samples.length; i++) {
    let sum = 0;
    let cnt = 0;
    for (let k = Math.max(0, i - win); k <= Math.min(samples.length - 1, i + win); k++) {
      sum += rawH[k];
      cnt++;
    }
    smoothH[i] = sum / Math.max(1, cnt);
  }

  function evalTerrainAtS(s) {
    if (s <= 0) return rawH[0];
    if (s >= totalLength) return rawH[rawH.length - 1];
    let lo = 0;
    let hi = samples.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (samples[m].s <= s) lo = m;
      else hi = m;
    }
    const span = Math.max(1e-5, samples[hi].s - samples[lo].s);
    const t = (s - samples[lo].s) / span;
    return rawH[lo] + (rawH[hi] - rawH[lo]) * t;
  }

  function evalSmoothGroundAtS(s) {
    if (s <= 0) return smoothH[0];
    if (s >= totalLength) return smoothH[smoothH.length - 1];
    let lo = 0;
    let hi = samples.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (samples[m].s <= s) lo = m;
      else hi = m;
    }
    const span = Math.max(1e-5, samples[hi].s - samples[lo].s);
    const t = (s - samples[lo].s) / span;
    return smoothH[lo] + (smoothH[hi] - smoothH[lo]) * t;
  }

  // Detect all wall-path intersections for auto-archways / gate openings
  const rawOpenings = [];
  for (let pIdx = 0; pIdx < paths.length; pIdx++) {
    const path = paths[pIdx];
    if (!path || !Array.isArray(path.points) || path.points.length < 2) continue;
    const pathResampled = path.points.length > 2
      ? resampleCatmullRomXZ(path.points, 0.55).samples
      : path.points;
    const hits = polylineIntersections2D(samples, pathResampled, 2.0);
    for (let hIdx = 0; hIdx < hits.length; hIdx++) {
      const hit = hits[hIdx];
      const skew = Math.min(1.28, 1.0 / Math.max(0.7, hit.sinAngle || 1.0));
      const archWidth = Math.max(2.0, (path.width || 2.2) * 1.15) * skew;
      const halfW = archWidth * 0.5;
      if (totalLength < archWidth + 0.5) {
        // Very short wall crossed by path: center opening if possible
        const clampedHalf = Math.max(0.8, (totalLength - 0.5) * 0.5);
        rawOpenings.push({
          sCenter: totalLength * 0.5,
          sStart: totalLength * 0.5 - clampedHalf,
          sEnd: totalLength * 0.5 + clampedHalf,
          width: clampedHalf * 2,
          x: hit.x,
          z: hit.z,
        });
      } else {
        const sCenter = Math.max(halfW + 0.22, Math.min(totalLength - halfW - 0.22, hit.s));
        rawOpenings.push({
          sCenter,
          sStart: sCenter - halfW,
          sEnd: sCenter + halfW,
          width: archWidth,
          x: hit.x,
          z: hit.z,
        });
      }
    }
  }

  // Sort & merge overlapping openings
  rawOpenings.sort((a, b) => a.sStart - b.sStart);
  const openings = [];
  for (let i = 0; i < rawOpenings.length; i++) {
    const cur = rawOpenings[i];
    if (openings.length === 0) {
      openings.push({ ...cur });
    } else {
      const prev = openings[openings.length - 1];
      if (cur.sStart <= prev.sEnd + 0.55) {
        prev.sEnd = Math.max(prev.sEnd, cur.sEnd);
        prev.sCenter = 0.5 * (prev.sStart + prev.sEnd);
        prev.width = prev.sEnd - prev.sStart;
      } else {
        openings.push({ ...cur });
      }
    }
  }

  // Enrich each opening with arch geometry parameters
  const isLowWall = height < 1.5 || type === 'fence';
  for (let i = 0; i < openings.length; i++) {
    const op = openings[i];
    const centerSample = sampleSplineAtS(samples, op.sCenter);
    const groundY = getTerrainHeight(centerSample.x, centerSample.z);
    op.groundY = groundY;
    op.isArch = !isLowWall;

    if (op.isArch) {
      // Exact brief clear height formula: min(wall.height - 0.45, 2.5), ensuring walkable arch
      const clearH = Math.min(Math.max(height - 0.45, 1.35), 2.5);
      const halfSpan = op.width * 0.5;
      const archRise = Math.min(halfSpan * 0.52, Math.max(0.48, clearH * 0.44));
      const springY = groundY + clearH - archRise;
      const archR = (archRise * archRise + halfSpan * halfSpan) / (2 * archRise);
      const circleCenterY = groundY + clearH - archR;
      const thetaMax = Math.asin(Math.min(0.995, halfSpan / archR));
      const voussoirDepth = 0.34;

      op.clearHeight = clearH;
      op.archRise = archRise;
      op.springY = springY;
      op.archR = archR;
      op.circleCenterY = circleCenterY;
      op.thetaMax = thetaMax;
      op.voussoirDepth = voussoirDepth;
      op.crownOuterY = groundY + clearH + voussoirDepth;
    }
  }

  const rng = mulberry32(seed);

  if (type === 'fence') {
    buildWoodenFenceGeometry({
      group,
      samples,
      totalLength,
      height,
      thickness,
      openings,
      evalTerrainAtS,
      anchorX,
      anchorY,
      anchorZ,
      materials,
      rng,
    });
  } else {
    // Detect wall-wall intersections for automatic masonry piers
    const wallCrossStations = [];
    for (let wIdx = 0; wIdx < otherWalls.length; wIdx++) {
      const ow = otherWalls[wIdx];
      if (!ow || ow.id === id || !ow.points || ow.points.length < 2) continue;
      const owSamples = ow._cachedSamples || resampleCatmullRomXZ(ow.points, 0.5).samples;
      const wHits = polylineIntersections2D(samples, owSamples, 1.8);
      for (let k = 0; k < wHits.length; k++) {
        wallCrossStations.push(wHits[k].s);
      }
    }

    buildStoneWallGeometry({
      group,
      samples,
      corners,
      totalLength,
      height,
      thickness,
      wallStyle,
      crenellated,
      openings,
      wallCrossStations,
      evalTerrainAtS,
      evalSmoothGroundAtS,
      anchorX,
      anchorY,
      anchorZ,
      materials,
      rng,
    });
  }

  // Split footprint polylines around archway/gate openings so occupancy/creatures respect openings
  const footprintPolylines = [];
  const halfWidth = Math.max(0.25, thickness * 0.5 + 0.14);
  let segStartS = 0;
  for (let i = 0; i < openings.length; i++) {
    const op = openings[i];
    if (op.sStart - segStartS > 0.35) {
      footprintPolylines.push({
        type: 'polyline',
        points: sliceSplinePoints(samples, segStartS, op.sStart),
        halfWidth,
      });
    }
    segStartS = op.sEnd;
  }
  if (totalLength - segStartS > 0.35) {
    footprintPolylines.push({
      type: 'polyline',
      points: sliceSplinePoints(samples, segStartS, totalLength),
      halfWidth,
    });
  }

  return {
    group,
    anchor: new THREE.Vector3(anchorX, anchorY, anchorZ),
    openings,
    footprintPolylines,
    splineSamples: samples,
    totalLength,
    baseY: anchorY,
    topY: anchorY + height,
  };
}

function sliceSplinePoints(samples, s0, s1) {
  const pts = [];
  const a = sampleSplineAtS(samples, s0);
  pts.push({ x: a.x, z: a.z });
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].s > s0 + 0.05 && samples[i].s < s1 - 0.05) {
      pts.push({ x: samples[i].x, z: samples[i].z });
    }
  }
  const b = sampleSplineAtS(samples, s1);
  pts.push({ x: b.x, z: b.z });
  return pts;
}

function makeHexAtSplineSpan(samples, s0, s1, yBot0, yBot1, yTop0, yTop1, halfThickBot, halfThickTop, ax, ay, az) {
  const p0 = sampleSplineAtS(samples, s0);
  const p1 = sampleSplineAtS(samples, s1);

  return [
    new THREE.Vector3(p0.x - p0.nx * halfThickBot - ax, yBot0 - ay, p0.z - p0.nz * halfThickBot - az),
    new THREE.Vector3(p1.x - p1.nx * halfThickBot - ax, yBot1 - ay, p1.z - p1.nz * halfThickBot - az),
    new THREE.Vector3(p1.x + p1.nx * halfThickBot - ax, yBot1 - ay, p1.z + p1.nz * halfThickBot - az),
    new THREE.Vector3(p0.x + p0.nx * halfThickBot - ax, yBot0 - ay, p0.z + p0.nz * halfThickBot - az),
    new THREE.Vector3(p0.x - p0.nx * halfThickTop - ax, yTop0 - ay, p0.z - p0.nz * halfThickTop - az),
    new THREE.Vector3(p1.x - p1.nx * halfThickTop - ax, yTop1 - ay, p1.z - p1.nz * halfThickTop - az),
    new THREE.Vector3(p1.x + p1.nx * halfThickTop - ax, yTop1 - ay, p1.z + p1.nz * halfThickTop - az),
    new THREE.Vector3(p0.x + p0.nx * halfThickTop - ax, yTop0 - ay, p0.z + p0.nz * halfThickTop - az),
  ];
}

function buildStoneWallGeometry({
  group,
  samples,
  corners,
  totalLength,
  height,
  thickness,
  wallStyle,
  crenellated,
  openings,
  wallCrossStations,
  evalTerrainAtS,
  evalSmoothGroundAtS,
  anchorX,
  anchorY,
  anchorZ,
  materials,
  rng,
}) {
  const stoneGC = new GeometryCollector();
  const baseWallColor = resolveWallColor(materials, wallStyle);
  const halfThick = thickness * 0.5;

  // Evaluate top wall crest Y(s), adding a graceful Tiny Glade hump over archways if wall height is tight
  function evalCrestY(s) {
    let y = evalSmoothGroundAtS(s) + height;
    for (let i = 0; i < openings.length; i++) {
      const op = openings[i];
      if (!op.isArch) continue;
      const neededTop = op.crownOuterY + 0.24;
      const baseHere = evalSmoothGroundAtS(op.sCenter) + height;
      const hump = Math.max(0, neededTop - baseHere);
      if (hump > 0.01) {
        const dist = Math.abs(s - op.sCenter);
        const span = op.width * 0.95 + 0.7;
        if (dist < span) {
          const u = dist / span;
          const bell = 0.5 * (1 + Math.cos(Math.PI * u));
          y += hump * bell;
        }
      }
    }
    return y;
  }

  // Helper: check if station s falls inside an opening and return opening info
  function findOpeningForSpan(s0, s1) {
    const sMid = 0.5 * (s0 + s1);
    for (let i = 0; i < openings.length; i++) {
      const op = openings[i];
      if (sMid > op.sStart - 0.02 && sMid < op.sEnd + 0.02) {
        return op;
      }
    }
    return null;
  }

  // Extrados seat curve inside the proud voussoir ring so spandrel courses tuck seamlessly behind voussoirs
  function evalArchExtradosY(op, s) {
    const dx = s - op.sCenter;
    const rSeat = op.archR + op.voussoirDepth - 0.05;
    const sq = rSeat * rSeat - dx * dx;
    if (sq <= 0) return op.springY;
    return op.circleCenterY + Math.sqrt(sq);
  }

  // 1a. Recessed Solid Mortar Core along wall & arch spandrels (100% zero daylight leaks on straight or curved walls!)
  const coreHalfThick = Math.max(0.06, halfThick - 0.045);
  const mortarCoreCol = jitterStoneColor(baseWallColor, rng, 0.65, 0.02);

  // Build wall-body mortar core spans outside openings
  let coreSegStart = 0;
  const wallCoreSpans = [];
  for (let i = 0; i < openings.length; i++) {
    const op = openings[i];
    if (op.sStart - coreSegStart > 0.08) {
      wallCoreSpans.push([coreSegStart, op.sStart]);
    }
    coreSegStart = op.sEnd;
  }
  if (totalLength - coreSegStart > 0.08) {
    wallCoreSpans.push([coreSegStart, totalLength]);
  }

  for (let wIdx = 0; wIdx < wallCoreSpans.length; wIdx++) {
    const [ws0, ws1] = wallCoreSpans[wIdx];
    const spanLen = ws1 - ws0;
    const steps = Math.max(1, Math.ceil(spanLen / 0.52));
    const ds = spanLen / steps;
    for (let k = 0; k < steps; k++) {
      const cs0 = Math.max(ws0, ws0 + k * ds - (k > 0 ? 0.02 : 0));
      const cs1 = Math.min(ws1, ws0 + (k + 1) * ds + (k < steps - 1 ? 0.02 : 0));
      const g0 = Math.min(evalTerrainAtS(cs0), evalSmoothGroundAtS(cs0)) - 0.32;
      const g1 = Math.min(evalTerrainAtS(cs1), evalSmoothGroundAtS(cs1)) - 0.32;
      const t0 = evalCrestY(cs0) - 0.04;
      const t1 = evalCrestY(cs1) - 0.04;
      if (t0 - g0 < 0.08 || t1 - g1 < 0.08) continue;
      stoneGC.pushBeveledStone(
        makeHexAtSplineSpan(samples, cs0, cs1, g0, g1, t0, t1, coreHalfThick, coreHalfThick, anchorX, anchorY, anchorZ),
        mortarCoreCol,
        { bevelXZ: 0.01, bevelY: 0.01 }
      );
    }
  }

  // Build arch-spandrel mortar core inside every arch opening (seals voussoir radial bevels + spandrel up to coping!)
  for (let i = 0; i < openings.length; i++) {
    const op = openings[i];
    if (!op.isArch) continue;
    const rArchCore = op.archR + 0.035;
    const spSteps = Math.max(14, Math.ceil(op.width / 0.16));
    const ds = op.width / spSteps;
    for (let k = 0; k < spSteps; k++) {
      const ms0 = Math.max(0, op.sStart + k * ds - 0.025);
      const ms1 = Math.min(totalLength, op.sStart + (k + 1) * ds + 0.025);
      const dx0 = ms0 - op.sCenter;
      const dx1 = ms1 - op.sCenter;
      const b0 = op.circleCenterY + Math.sqrt(Math.max(0, rArchCore * rArchCore - dx0 * dx0));
      const b1 = op.circleCenterY + Math.sqrt(Math.max(0, rArchCore * rArchCore - dx1 * dx1));
      const t0 = evalCrestY(ms0) - 0.04;
      const t1 = evalCrestY(ms1) - 0.04;
      if (t0 - b0 < 0.03 && t1 - b1 < 0.03) continue;
      stoneGC.pushBeveledStone(
        makeHexAtSplineSpan(
          samples,
          ms0,
          ms1,
          Math.min(b0, t0 - 0.03),
          Math.min(b1, t1 - 0.03),
          t0,
          t1,
          coreHalfThick,
          coreHalfThick,
          anchorX,
          anchorY,
          anchorZ
        ),
        mortarCoreCol,
        { bevelXZ: 0.01, bevelY: 0.01 }
      );
    }
  }

  // 1b. Battered Stone Plinth Base (sits deep into terrain so zero stones ever float on slopes)
  const baseStep = 0.78;
  const numBase = Math.max(1, Math.ceil(totalLength / baseStep));
  const actualBaseStep = totalLength / numBase;
  for (let i = 0; i < numBase; i++) {
    const s0 = i * actualBaseStep;
    const s1 = (i + 1) * actualBaseStep;
    const op = findOpeningForSpan(s0, s1);
    if (op) continue; // Keep pathway clear across opening

    const g0 = Math.min(evalTerrainAtS(s0), evalSmoothGroundAtS(s0));
    const g1 = Math.min(evalTerrainAtS(s1), evalSmoothGroundAtS(s1));
    const yBot0 = g0 - 0.42;
    const yBot1 = g1 - 0.42;
    const yTop0 = evalSmoothGroundAtS(s0) + 0.24;
    const yTop1 = evalSmoothGroundAtS(s1) + 0.24;

    const hex = makeHexAtSplineSpan(
      samples,
      s0,
      s1,
      yBot0,
      yBot1,
      yTop0,
      yTop1,
      halfThick + 0.09,
      halfThick + 0.03,
      anchorX,
      anchorY,
      anchorZ
    );
    const rgb = jitterStoneColor(baseWallColor, rng, 0.74, 0.08);
    stoneGC.pushBeveledStone(hex, rgb, { bevelXZ: 0.07, bevelY: 0.12 });
  }

  // 2. Staggered Horizontal Stone Courses following smooth terrain & airtight arch spandrel wedges
  const courseH = 0.31;
  const maxCourses = Math.max(2, Math.round((height - 0.24) / courseH));
  const nominalStoneLen = 0.66;

  // Ordered clip/snap stations so stones never leave <11cm runt gaps at jambs or arch crowns
  const clipBoundaries = [];
  for (let k = 0; k < openings.length; k++) {
    const op = openings[k];
    clipBoundaries.push(op.sStart);
    if (op.isArch) clipBoundaries.push(op.sCenter);
    clipBoundaries.push(op.sEnd);
  }
  clipBoundaries.push(totalLength);

  function evalCourseYAtS(s, frac) {
    const b = evalSmoothGroundAtS(s) + 0.23;
    const cr = evalCrestY(s) - 0.14;
    return b + frac * (cr - b);
  }

  for (let c = 0; c < maxCourses; c++) {
    const frac0 = c / maxCourses;
    const frac1 = (c + 1) / maxCourses;
    const stagger = (c & 1) ? nominalStoneLen * 0.5 : 0;

    // Ground-contact AO factor rises from 0.80 at bottom course to 1.0 above 0.9m
    const approxHAboveGround = 0.24 + frac0 * (height - 0.24);
    const courseAO = 0.80 + 0.20 * Math.min(1, approxHAboveGround / 0.95);

    let cursorS = 0;
    let firstInRow = stagger > 0.05;
    while (cursorS < totalLength - 0.04) {
      let stepLen = firstInRow
        ? stagger
        : nominalStoneLen * (0.86 + rng() * 0.28);
      firstInRow = false;
      let nextS = Math.min(totalLength, cursorS + stepLen);

      // Clip or snap cleanly against opening jambs, arch crown, and wall end (zero dropped runt slivers!)
      for (let k = 0; k < clipBoundaries.length; k++) {
        const bS = clipBoundaries[k];
        if (bS <= cursorS + 0.005) continue;
        if (nextS > bS) {
          nextS = bS;
        } else if (bS - nextS < 0.22) {
          nextS = bS;
        }
        break;
      }

      let s0 = cursorS;
      let s1 = nextS;
      cursorS = nextS;
      if (s1 - s0 < 0.08) continue;

      const op = findOpeningForSpan(s0, s1);
      if (op && !op.isArch) continue; // Low-wall gate gap stays completely open

      let yBot0 = evalCourseYAtS(s0, frac0);
      let yBot1 = evalCourseYAtS(s1, frac0);
      let yTop0 = evalCourseYAtS(s0, frac1);
      let yTop1 = evalCourseYAtS(s1, frac1);

      if (op && op.isArch) {
        const isLeftHaunch = 0.5 * (s0 + s1) <= op.sCenter;
        let seat0 = evalArchExtradosY(op, s0);
        let seat1 = evalArchExtradosY(op, s1);

        if (isLeftHaunch) {
          // Extrados rises from s0 -> s1: clearance is max at s0, min at s1
          if (yTop0 - seat0 < 0.03) continue; // Completely inside arch opening / voussoirs
          if (yTop1 - seat1 < 0.03) {
            let lo = s0;
            let hi = s1;
            for (let it = 0; it < 10; it++) {
              const mid = 0.5 * (lo + hi);
              if (evalCourseYAtS(mid, frac1) - evalArchExtradosY(op, mid) >= 0.025) lo = mid;
              else hi = mid;
            }
            s1 = Math.min(op.sCenter, lo + 0.045);
            if (s1 - s0 < 0.07) continue;
            yBot1 = evalCourseYAtS(s1, frac0);
            yTop1 = evalCourseYAtS(s1, frac1);
            seat1 = evalArchExtradosY(op, s1);
          }
        } else {
          // Right haunch: extrados falls from s0 -> s1: clearance is min at s0, max at s1
          if (yTop1 - seat1 < 0.03) continue; // Completely inside arch opening / voussoirs
          if (yTop0 - seat0 < 0.03) {
            let lo = s0;
            let hi = s1;
            for (let it = 0; it < 10; it++) {
              const mid = 0.5 * (lo + hi);
              if (evalCourseYAtS(mid, frac1) - evalArchExtradosY(op, mid) >= 0.025) hi = mid;
              else lo = mid;
            }
            s0 = Math.max(op.sCenter, hi - 0.045);
            if (s1 - s0 < 0.07) continue;
            yBot0 = evalCourseYAtS(s0, frac0);
            yTop0 = evalCourseYAtS(s0, frac1);
            seat0 = evalArchExtradosY(op, s0);
          }
        }

        yBot0 = Math.min(Math.max(yBot0, seat0 - 0.015), yTop0 - 0.025);
        yBot1 = Math.min(Math.max(yBot1, seat1 - 0.015), yTop1 - 0.025);
      }

      const proudJitter = (rng() - 0.5) * 0.022;
      const hex = makeHexAtSplineSpan(
        samples,
        s0,
        s1,
        yBot0,
        yBot1,
        yTop0,
        yTop1,
        halfThick + proudJitter,
        halfThick + proudJitter * 0.8,
        anchorX,
        anchorY,
        anchorZ
      );
      const rgb = jitterStoneColor(baseWallColor, rng, courseAO, 0.09);
      stoneGC.pushBeveledStone(hex, rgb, { bevelXZ: 0.085, bevelY: 0.14 });
    }
  }

  // 3. Top Coping Stones OR Crenellated Battlements
  if (crenellated) {
    // Continuous corbel stringcourse + alternating stone merlons
    const ledgeStep = 0.62;
    const numLedge = Math.max(1, Math.ceil(totalLength / ledgeStep));
    const dLedge = totalLength / numLedge;
    for (let i = 0; i < numLedge; i++) {
      const s0 = i * dLedge;
      const s1 = (i + 1) * dLedge;
      const op = findOpeningForSpan(s0, s1);
      if (op && !op.isArch) continue;

      const c0 = evalCrestY(s0);
      const c1 = evalCrestY(s1);
      const hex = makeHexAtSplineSpan(
        samples,
        s0,
        s1,
        c0 - 0.15,
        c1 - 0.15,
        c0,
        c1,
        halfThick + 0.02,
        halfThick + 0.07,
        anchorX,
        anchorY,
        anchorZ
      );
      stoneGC.pushBeveledStone(hex, jitterStoneColor(baseWallColor, rng, 0.98, 0.06));
    }

    // Merlons
    const merlonPitch = 1.24;
    const merlonLen = 0.72;
    const merlonH = 0.52;
    for (let s = 0.18; s + merlonLen <= totalLength - 0.15; s += merlonPitch) {
      const s0 = s;
      const s1 = s + merlonLen;
      const op = findOpeningForSpan(s0, s1);
      if (op && !op.isArch) continue;

      const c0 = evalCrestY(s0);
      const c1 = evalCrestY(s1);
      // Lower & upper merlon blocks + cap slab
      const mid0 = c0 + merlonH * 0.5;
      const mid1 = c1 + merlonH * 0.5;
      stoneGC.pushBeveledStone(
        makeHexAtSplineSpan(samples, s0, s1, c0 - 0.01, c1 - 0.01, mid0, mid1, halfThick + 0.02, halfThick + 0.01, anchorX, anchorY, anchorZ),
        jitterStoneColor(baseWallColor, rng, 1.0, 0.07)
      );
      stoneGC.pushBeveledStone(
        makeHexAtSplineSpan(samples, s0 + 0.01, s1 - 0.01, mid0, mid1, c0 + merlonH, c1 + merlonH, halfThick + 0.01, halfThick, anchorX, anchorY, anchorZ),
        jitterStoneColor(baseWallColor, rng, 1.02, 0.07)
      );
      // Cap stone
      stoneGC.pushBeveledStone(
        makeHexAtSplineSpan(
          samples,
          s0 - 0.04,
          s1 + 0.04,
          c0 + merlonH - 0.01,
          c1 + merlonH - 0.01,
          c0 + merlonH + 0.11,
          c1 + merlonH + 0.11,
          halfThick + 0.06,
          halfThick + 0.03,
          anchorX,
          anchorY,
          anchorZ
        ),
        jitterStoneColor(baseWallColor, rng, 1.05, 0.05)
      );
    }
  } else {
    // Classic overhanging beveled saddle coping stones
    const capStep = 0.56;
    const numCaps = Math.max(1, Math.ceil(totalLength / capStep));
    const dCap = totalLength / numCaps;
    for (let i = 0; i < numCaps; i++) {
      const s0 = i * dCap;
      const s1 = (i + 1) * dCap;
      const op = findOpeningForSpan(s0, s1);
      if (op && !op.isArch) continue;

      const c0 = evalCrestY(s0);
      const c1 = evalCrestY(s1);
      const hex = makeHexAtSplineSpan(
        samples,
        s0,
        s1,
        c0 - 0.15,
        c1 - 0.15,
        c0 + 0.04,
        c1 + 0.04,
        halfThick + 0.065,
        halfThick + 0.025,
        anchorX,
        anchorY,
        anchorZ
      );
      const capColor = jitterStoneColor(baseWallColor, rng, 1.04, 0.06);
      stoneGC.pushBeveledStone(hex, capColor, { bevelXZ: 0.11, bevelY: 0.22 });
    }
  }

  // 4. SIGNATURE TINY GLADE 3D STONE VOUSSOIR ARCHWAYS & LOW-WALL GATE PIERS
  for (let i = 0; i < openings.length; i++) {
    const op = openings[i];
    if (op.isArch) {
      buildStoneVoussoirArch(stoneGC, samples, totalLength, op, halfThick, baseWallColor, rng, anchorX, anchorY, anchorZ);
    } else {
      // Low wall (< 1.5m): two flanking square stone gate posts with pyramidal caps
      const pierH = height + 0.34;
      buildStonePierAtS(stoneGC, samples, totalLength, op.sStart - 0.22, 0.46, halfThick + 0.12, evalTerrainAtS(op.sStart), pierH, baseWallColor, rng, anchorX, anchorY, anchorZ);
      buildStonePierAtS(stoneGC, samples, totalLength, op.sEnd + 0.22, 0.46, halfThick + 0.12, evalTerrainAtS(op.sEnd), pierH, baseWallColor, rng, anchorX, anchorY, anchorZ);
    }
  }

  // 5. Automatic Stone Piers / Buttresses at endpoints, sharp corners, wall intersections, and long spans
  const pierStations = [0.22, Math.max(0.22, totalLength - 0.22)];
  for (let i = 0; i < corners.length; i++) {
    pierStations.push(corners[i].s);
  }
  for (let i = 0; i < wallCrossStations.length; i++) {
    pierStations.push(wallCrossStations[i]);
  }
  if (height >= 2.7 && totalLength > 10.0) {
    const buttressCount = Math.floor(totalLength / 8.5);
    for (let b = 1; b <= buttressCount; b++) {
      pierStations.push((b / (buttressCount + 1)) * totalLength);
    }
  }

  // Deduplicate pier stations and avoid colliding with archway jamb piers
  const acceptedPiers = [];
  for (let i = 0; i < pierStations.length; i++) {
    const ps = Math.max(0.2, Math.min(totalLength - 0.2, pierStations[i]));
    let blocked = false;
    for (let k = 0; k < openings.length; k++) {
      if (ps > openings[k].sStart - 0.85 && ps < openings[k].sEnd + 0.85) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    for (let k = 0; k < acceptedPiers.length; k++) {
      if (Math.abs(acceptedPiers[k] - ps) < 1.3) {
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      acceptedPiers.push(ps);
      const groundHere = Math.min(evalTerrainAtS(ps), evalSmoothGroundAtS(ps));
      const pierTopOffset = (crenellated ? height + 0.56 : height + 0.22) + (evalSmoothGroundAtS(ps) - groundHere);
      buildStonePierAtS(
        stoneGC,
        samples,
        totalLength,
        ps,
        0.48,
        halfThick + 0.13,
        groundHere,
        pierTopOffset,
        baseWallColor,
        rng,
        anchorX,
        anchorY,
        anchorZ
      );
    }
  }

  if (!stoneGC.isEmpty) {
    const geo = stoneGC.toBufferGeometry();
    const mesh = new THREE.Mesh(geo, materials.stoneWall);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

/**
 * Builds a full 3D radial stone Voussoir Arch + prominent Keystone + flanking stone Jamb Pillars!
 */
function buildStoneVoussoirArch(stoneGC, samples, totalLength, op, halfThick, baseWallColor, rng, ax, ay, az) {
  const jambLen = 0.44;
  const jambHalfThick = halfThick + 0.11;

  // Flanking stone jamb pillars (left & right of opening)
  const jambSides = [
    { s0: Math.max(0, op.sStart - jambLen), s1: op.sStart },
    { s0: op.sEnd, s1: Math.min(totalLength, op.sEnd + jambLen) },
  ];

  for (let side = 0; side < 2; side++) {
    const { s0, s1 } = jambSides[side];
    if (s1 - s0 < 0.12) continue;

    const botY = op.groundY - 0.42;
    const topY = op.springY;
    const totalH = Math.max(0.45, topY - botY);
    const numBlocks = Math.max(3, Math.round(totalH / 0.32));

    // Stepped plinth foot
    stoneGC.pushBeveledStone(
      makeHexAtSplineSpan(samples, Math.max(0, s0 - 0.04), Math.min(totalLength, s1 + 0.04), botY, botY, op.groundY + 0.24, op.groundY + 0.24, jambHalfThick + 0.05, jambHalfThick + 0.01, ax, ay, az),
      jitterStoneColor(baseWallColor, rng, 0.76, 0.06)
    );

    // Stacked dressed quoin jamb blocks
    const shaftBot = op.groundY + 0.23;
    const shaftTop = topY - 0.13;
    const shaftBlocks = Math.max(2, numBlocks - 1);
    for (let b = 0; b < shaftBlocks; b++) {
      const y0 = shaftBot + (b / shaftBlocks) * (shaftTop - shaftBot);
      const y1 = shaftBot + ((b + 1) / shaftBlocks) * (shaftTop - shaftBot);
      const longQuoin = (b & 1) === 0 ? 0.05 : 0.0;
      const js0 = side === 0 ? Math.max(0, s0 - longQuoin) : s0;
      const js1 = side === 1 ? Math.min(totalLength, s1 + longQuoin) : s1;
      const ao = 0.84 + 0.16 * Math.min(1, (b + 0.5) / shaftBlocks);
      stoneGC.pushBeveledStone(
        makeHexAtSplineSpan(samples, js0, js1, y0, y0, y1, y1, jambHalfThick, jambHalfThick, ax, ay, az),
        jitterStoneColor(baseWallColor, rng, ao, 0.07)
      );
    }

    // Projecting impost capital block right at arch springline
    stoneGC.pushBeveledStone(
      makeHexAtSplineSpan(
        samples,
        Math.max(0, s0 - 0.05),
        Math.min(totalLength, s1 + 0.05),
        topY - 0.14,
        topY - 0.14,
        topY + 0.01,
        topY + 0.01,
        jambHalfThick + 0.04,
        jambHalfThick + 0.05,
        ax,
        ay,
        az
      ),
      jitterStoneColor(baseWallColor, rng, 1.03, 0.05)
    );
  }

  // Radial Voussoir Wedge Stones + Prominent Central Keystone (curved cleanly along wall spline!)
  const cy = op.circleCenterY;

  function sampleArchStation(u) {
    const rawS = op.sCenter + u;
    if (rawS < 0) {
      const p0 = sampleSplineAtS(samples, 0);
      return { x: p0.x + p0.tx * rawS, z: p0.z + p0.tz * rawS, nx: p0.nx, nz: p0.nz };
    }
    if (rawS > totalLength) {
      const p1 = sampleSplineAtS(samples, totalLength);
      const ext = rawS - totalLength;
      return { x: p1.x + p1.tx * ext, z: p1.z + p1.tz * ext, nx: p1.nx, nz: p1.nz };
    }
    return sampleSplineAtS(samples, rawS);
  }

  const numVoussoirs = op.width > 3.1 ? 13 : 11; // Always odd so central block is the Keystone!
  const midIdx = (numVoussoirs - 1) >> 1;
  const totalAng = op.thetaMax * 2;
  const dAng = totalAng / numVoussoirs;

  for (let v = 0; v < numVoussoirs; v++) {
    const isKeystone = v === midIdx;
    const a0 = -op.thetaMax + v * dAng;
    const a1 = a0 + dAng;

    const rIn = isKeystone ? op.archR - 0.045 : op.archR;
    const rOut = isKeystone ? op.archR + op.voussoirDepth + 0.11 : op.archR + op.voussoirDepth;
    const vHalfThick = isKeystone ? halfThick + 0.115 : halfThick + 0.075;

    const sin0 = Math.sin(a0);
    const cos0 = Math.cos(a0);
    const sin1 = Math.sin(a1);
    const cos1 = Math.cos(a1);

    // Inner arc poses (intrados) and outer arc poses (extrados) bent along the wall spline
    const pIn0 = sampleArchStation(rIn * sin0);
    const in0Y = cy + rIn * cos0;

    const pIn1 = sampleArchStation(rIn * sin1);
    const in1Y = cy + rIn * cos1;

    const pOut0 = sampleArchStation(rOut * sin0);
    const out0Y = cy + rOut * cos0;

    const pOut1 = sampleArchStation(rOut * sin1);
    const out1Y = cy + rOut * cos1;

    const wedgeHex = [
      new THREE.Vector3(pIn0.x - pIn0.nx * vHalfThick - ax, in0Y - ay, pIn0.z - pIn0.nz * vHalfThick - az),
      new THREE.Vector3(pIn1.x - pIn1.nx * vHalfThick - ax, in1Y - ay, pIn1.z - pIn1.nz * vHalfThick - az),
      new THREE.Vector3(pIn1.x + pIn1.nx * vHalfThick - ax, in1Y - ay, pIn1.z + pIn1.nz * vHalfThick - az),
      new THREE.Vector3(pIn0.x + pIn0.nx * vHalfThick - ax, in0Y - ay, pIn0.z + pIn0.nz * vHalfThick - az),
      new THREE.Vector3(pOut0.x - pOut0.nx * vHalfThick - ax, out0Y - ay, pOut0.z - pOut0.nz * vHalfThick - az),
      new THREE.Vector3(pOut1.x - pOut1.nx * vHalfThick - ax, out1Y - ay, pOut1.z - pOut1.nz * vHalfThick - az),
      new THREE.Vector3(pOut1.x + pOut1.nx * vHalfThick - ax, out1Y - ay, pOut1.z + pOut1.nz * vHalfThick - az),
      new THREE.Vector3(pOut0.x + pOut0.nx * vHalfThick - ax, out0Y - ay, pOut0.z + pOut0.nz * vHalfThick - az),
    ];

    const rgb = jitterStoneColor(baseWallColor, rng, isKeystone ? 1.07 : 1.01, 0.065);
    stoneGC.pushBeveledStone(wedgeHex, rgb, {
      bevelXZ: isKeystone ? 0.1 : 0.08,
      bevelY: 0.11,
    });
  }
}

/**
 * Builds a sturdy square/rectangular stone pier / buttress centered at station s along the wall spline.
 */
function buildStonePierAtS(stoneGC, samples, totalLength, s, pierLen, pierHalfThick, groundY, pierH, baseWallColor, rng, ax, ay, az) {
  const pose = sampleSplineAtS(samples, Math.max(0, Math.min(totalLength, s)));
  const tx = pose.tx;
  const tz = pose.tz;
  const nx = pose.nx;
  const nz = pose.nz;
  const cx = pose.x;
  const cz = pose.z;

  function makePierRing(halfL, halfW, y) {
    return [
      new THREE.Vector3(cx - tx * halfL - nx * halfW - ax, y - ay, cz - tz * halfL - nz * halfW - az),
      new THREE.Vector3(cx + tx * halfL - nx * halfW - ax, y - ay, cz + tz * halfL - nz * halfW - az),
      new THREE.Vector3(cx + tx * halfL + nx * halfW - ax, y - ay, cz + tz * halfL + nz * halfW - az),
      new THREE.Vector3(cx - tx * halfL + nx * halfW - ax, y - ay, cz - tz * halfL + nz * halfW - az),
    ];
  }

  const hl = pierLen * 0.5;
  // Battered plinth base
  const bFoot = makePierRing(hl + 0.06, pierHalfThick + 0.06, groundY - 0.44);
  const tFoot = makePierRing(hl + 0.02, pierHalfThick + 0.02, groundY + 0.28);
  stoneGC.pushBeveledStone([...bFoot, ...tFoot], jitterStoneColor(baseWallColor, rng, 0.75, 0.06));

  // Stacked pier courses
  const courses = Math.max(3, Math.round((pierH - 0.28) / 0.34));
  for (let c = 0; c < courses; c++) {
    const y0 = groundY + 0.27 + (c / courses) * (pierH - 0.27);
    const y1 = groundY + 0.27 + ((c + 1) / courses) * (pierH - 0.27);
    const taper = 1 - (c / courses) * 0.06;
    const r0 = makePierRing(hl * taper, pierHalfThick * taper, y0);
    const r1 = makePierRing(hl * taper, pierHalfThick * taper, y1);
    const ao = 0.84 + 0.18 * (c / courses);
    stoneGC.pushBeveledStone([...r0, ...r1], jitterStoneColor(baseWallColor, rng, ao, 0.07));
  }

  // Pyramidal stone pier cap
  const capBaseY = groundY + pierH - 0.01;
  const rCap0 = makePierRing(hl + 0.055, pierHalfThick + 0.055, capBaseY);
  const rCap1 = makePierRing(hl * 0.38, pierHalfThick * 0.38, capBaseY + 0.22);
  stoneGC.pushBeveledStone([...rCap0, ...rCap1], jitterStoneColor(baseWallColor, rng, 1.06, 0.05), {
    bevelXZ: 0.06,
    bevelY: 0.14,
  });
}

/**
 * Builds a charming Rustic Split-Oak Wooden Fence along the spline, with post stone collars,
 * mortised timber rails, and tall capped gate posts + open swung garden gates at path crossings!
 */
function buildWoodenFenceGeometry({
  group,
  samples,
  totalLength,
  height,
  thickness,
  openings,
  evalTerrainAtS,
  anchorX,
  anchorY,
  anchorZ,
  materials,
  rng,
}) {
  const timberGC = new GeometryCollector();
  const stoneGC = new GeometryCollector();
  const baseStoneCol = resolveWallColor(materials, 'limestone');

  const upVec = new THREE.Vector3(0, 1, 0);

  // Build spans between path openings
  const spans = [];
  let cursor = 0;
  for (let i = 0; i < openings.length; i++) {
    const op = openings[i];
    if (op.sStart - cursor > 0.35) {
      spans.push({ s0: cursor, s1: op.sStart, startIsGate: i > 0, endIsGate: true });
    }
    cursor = op.sEnd;
  }
  if (totalLength - cursor > 0.35) {
    spans.push({ s0: cursor, s1: totalLength, startIsGate: openings.length > 0, endIsGate: false });
  }

  const targetPostSpacing = 1.55;
  const postHalfW = Math.max(0.065, thickness * 0.42);

  function addFencePost(s, isGatePost) {
    const pose = sampleSplineAtS(samples, s);
    const gy = evalTerrainAtS(s);
    const postH = isGatePost ? height + 0.32 : height + (rng() - 0.5) * 0.06;
    const tiltN = isGatePost ? 0 : (rng() - 0.5) * 0.035;
    const tiltT = isGatePost ? 0 : (rng() - 0.5) * 0.03;

    const yAxis = new THREE.Vector3(pose.nx * tiltN + pose.tx * tiltT, 1, pose.nz * tiltN + pose.tz * tiltT).normalize();
    const xAxis = new THREE.Vector3(pose.tx, 0, pose.tz).normalize();
    const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
    xAxis.crossVectors(yAxis, zAxis).normalize();

    const hw = isGatePost ? postHalfW * 1.38 : postHalfW;
    const botY = gy - 0.25;
    const topY = gy + postH;
    const center = new THREE.Vector3(
      pose.x - anchorX,
      0.5 * (botY + topY) - anchorY,
      pose.z - anchorZ
    );

    const woodShade = 0.92 + rng() * 0.14;
    timberGC.pushOrientedBox(center, xAxis, yAxis, zAxis, hw, 0.5 * (topY - botY), hw, [woodShade, woodShade, woodShade]);

    // Small weathered cap on post top
    const capCenter = new THREE.Vector3(pose.x - anchorX, topY + 0.035 - anchorY, pose.z - anchorZ);
    timberGC.pushOrientedBox(capCenter, xAxis, upVec, zAxis, hw * 1.24, 0.04, hw * 1.24, [1.02, 1.0, 0.96]);

    // Small mossy stone footing collar at ground level
    const stoneR0 = [
      new THREE.Vector3(pose.x - pose.tx * (hw + 0.07) - pose.nx * (hw + 0.07) - anchorX, gy - 0.22 - anchorY, pose.z - pose.tz * (hw + 0.07) - pose.nz * (hw + 0.07) - anchorZ),
      new THREE.Vector3(pose.x + pose.tx * (hw + 0.07) - pose.nx * (hw + 0.07) - anchorX, gy - 0.22 - anchorY, pose.z + pose.tz * (hw + 0.07) - pose.nz * (hw + 0.07) - anchorZ),
      new THREE.Vector3(pose.x + pose.tx * (hw + 0.07) + pose.nx * (hw + 0.07) - anchorX, gy - 0.22 - anchorY, pose.z + pose.tz * (hw + 0.07) + pose.nz * (hw + 0.07) - anchorZ),
      new THREE.Vector3(pose.x - pose.tx * (hw + 0.07) + pose.nx * (hw + 0.07) - anchorX, gy - 0.22 - anchorY, pose.z - pose.tz * (hw + 0.07) + pose.nz * (hw + 0.07) - anchorZ),
    ];
    const stoneR1 = [
      new THREE.Vector3(pose.x - pose.tx * (hw + 0.04) - pose.nx * (hw + 0.04) - anchorX, gy + 0.11 - anchorY, pose.z - pose.tz * (hw + 0.04) - pose.nz * (hw + 0.04) - anchorZ),
      new THREE.Vector3(pose.x + pose.tx * (hw + 0.04) - pose.nx * (hw + 0.04) - anchorX, gy + 0.11 - anchorY, pose.z + pose.tz * (hw + 0.04) - pose.nz * (hw + 0.04) - anchorZ),
      new THREE.Vector3(pose.x + pose.tx * (hw + 0.04) + pose.nx * (hw + 0.04) - anchorX, gy + 0.11 - anchorY, pose.z + pose.tz * (hw + 0.04) + pose.nz * (hw + 0.04) - anchorZ),
      new THREE.Vector3(pose.x - pose.tx * (hw + 0.04) + pose.nx * (hw + 0.04) - anchorX, gy + 0.11 - anchorY, pose.z - pose.tz * (hw + 0.04) + pose.nz * (hw + 0.04) - anchorZ),
    ];
    stoneGC.pushBeveledStone([...stoneR0, ...stoneR1], jitterStoneColor(baseStoneCol, rng, 0.78, 0.07));
  }

  const numRails = height > 1.35 ? 3 : 2;

  for (let spIdx = 0; spIdx < spans.length; spIdx++) {
    const sp = spans[spIdx];
    const len = sp.s1 - sp.s0;
    const bays = Math.max(1, Math.round(len / targetPostSpacing));
    const dS = len / bays;

    for (let b = 0; b <= bays; b++) {
      const s = sp.s0 + b * dS;
      const isGate = (b === 0 && sp.startIsGate) || (b === bays && sp.endIsGate);
      addFencePost(s, isGate);
    }

    for (let b = 0; b < bays; b++) {
      const sA = sp.s0 + b * dS;
      const sB = sp.s0 + (b + 1) * dS;
      const pA = sampleSplineAtS(samples, sA);
      const pB = sampleSplineAtS(samples, sB);
      const gA = evalTerrainAtS(sA);
      const gB = evalTerrainAtS(sB);

      for (let r = 0; r < numRails; r++) {
        const railFrac = numRails === 2 ? (r === 0 ? 0.36 : 0.78) : 0.28 + r * 0.27;
        const yA = gA + height * railFrac;
        const yB = gB + height * railFrac;

        const aVec = new THREE.Vector3(pA.x - anchorX, yA - anchorY, pA.z - anchorZ);
        const bVec = new THREE.Vector3(pB.x - anchorX, yB - anchorY, pB.z - anchorZ);
        const dir = new THREE.Vector3().subVectors(bVec, aVec);
        const segLen = dir.length();
        if (segLen < 0.05) continue;
        dir.multiplyScalar(1 / segLen);

        const zAx = new THREE.Vector3().crossVectors(dir, upVec).normalize();
        const yAx = new THREE.Vector3().crossVectors(zAx, dir).normalize();
        const mid = new THREE.Vector3().addVectors(aVec, bVec).multiplyScalar(0.5);
        const shade = 0.94 + rng() * 0.1;
        timberGC.pushOrientedBox(mid, dir, yAx, zAx, segLen * 0.5 + 0.02, 0.048, 0.026, [shade, shade, shade]);
      }
    }
  }

  // If fence has path openings that had no adjacent span (e.g. very short fence), still place gate posts
  for (let i = 0; i < openings.length; i++) {
    const op = openings[i];
    if (op.sStart <= 0.35) addFencePost(Math.max(0.05, op.sStart), true);
    if (totalLength - op.sEnd <= 0.35) addFencePost(Math.min(totalLength - 0.05, op.sEnd), true);
  }

  if (!timberGC.isEmpty) {
    const timberMesh = new THREE.Mesh(timberGC.toBufferGeometry(), materials.timber);
    timberMesh.castShadow = true;
    timberMesh.receiveShadow = true;
    group.add(timberMesh);
  }
  if (!stoneGC.isEmpty) {
    const stoneMesh = new THREE.Mesh(stoneGC.toBufferGeometry(), materials.stoneWall);
    stoneMesh.castShadow = true;
    stoneMesh.receiveShadow = true;
    group.add(stoneMesh);
  }
}
