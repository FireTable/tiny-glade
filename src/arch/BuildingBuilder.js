import * as THREE from 'three';
import {
  GeometryCollector,
  getSharedShingleGeometry,
  mulberry32,
  hashSeed,
  resolveWallColor,
  resolveRoofColor,
  jitterStoneColor,
  scaleRGB,
  evalRoofProfile,
  evalRoofSlopeAngle,
  pointToOBBSignedDist2D,
} from './GeometryUtils.js';

const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();
const _col = new THREE.Color();

/**
 * Builds a complete Tiny Glade Cottage ('cottage') or Cylindrical Castle Keep ('tower')
 * with terrain-adaptive battered stone foundations, individual 3D beveled stone courses,
 * corner quoins, optional Tudor jettying upper story, stepped 3D roof shingle courses,
 * adjacency-aware opening suppression & joint buttresses, arched oak entrance door with
 * automatic stone stairs down to terrain, glowing leaded windows, flowerboxes, porch lanterns,
 * and smoking stone chimneys.
 */
export function buildBuildingEntity(spec, ctx) {
  const type = spec.type === 'tower' ? 'tower' : 'cottage';
  const id = spec.id || `${type}_0`;
  const x = Number.isFinite(spec.x) ? spec.x : 0;
  const z = Number.isFinite(spec.z) ? spec.z : 0;
  const rotation = Number.isFinite(spec.rotation) ? spec.rotation : 0;
  const width = Math.max(2.2, Number.isFinite(spec.width) ? spec.width : 5.5);
  const depth = Math.max(2.2, Number.isFinite(spec.depth) ? spec.depth : 4.5);
  const radius = Math.max(1.4, Number.isFinite(spec.radius) ? spec.radius : 2.8);
  const height = Math.max(1.6, Number.isFinite(spec.height) ? spec.height : 3.8);
  const roofHeight = Math.max(0.4, Number.isFinite(spec.roofHeight) ? spec.roofHeight : 3.0);
  const roofCurve = Math.max(-0.45, Math.min(0.85, Number.isFinite(spec.roofCurve) ? spec.roofCurve : 0.25));
  const roofColor = spec.roofColor || 'terracotta';
  const wallStyle = spec.wallStyle || 'limestone';
  const crenellated = Boolean(spec.crenellated);
  const tudor = Boolean(spec.tudor);
  const seed = Number.isFinite(spec.seed) ? spec.seed : hashSeed(id, 307);

  const {
    materials,
    getTerrainHeight = () => 0,
    waterLevel = -0.35,
    otherBuildings = [],
  } = ctx;

  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);

  function localToWorldXZ(lx, lz) {
    return {
      wx: x + lx * cosR + lz * sinR,
      wz: z - lx * sinR + lz * cosR,
    };
  }

  // Sample terrain across the building footprint to size the battered stone foundation plinth
  let minTerrainY = Infinity;
  let maxTerrainY = -Infinity;
  const centerTerrainY = getTerrainHeight(x, z);

  if (type === 'cottage') {
    const hw = width * 0.5;
    const hd = depth * 0.5;
    for (let ix = -2; ix <= 2; ix++) {
      for (let iz = -2; iz <= 2; iz++) {
        const { wx, wz } = localToWorldXZ((ix / 2) * hw, (iz / 2) * hd);
        const h = getTerrainHeight(wx, wz);
        if (h < minTerrainY) minTerrainY = h;
        if (h > maxTerrainY) maxTerrainY = h;
      }
    }
  } else {
    minTerrainY = centerTerrainY;
    maxTerrainY = centerTerrainY;
    const rings = [0.5, 1.0];
    for (let rIdx = 0; rIdx < rings.length; rIdx++) {
      const rr = radius * rings[rIdx];
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const { wx, wz } = localToWorldXZ(Math.cos(ang) * rr, Math.sin(ang) * rr);
        const h = getTerrainHeight(wx, wz);
        if (h < minTerrainY) minTerrainY = h;
        if (h > maxTerrainY) maxTerrainY = h;
      }
    }
  }

  if (!Number.isFinite(minTerrainY)) minTerrainY = 0;
  if (!Number.isFinite(maxTerrainY)) maxTerrainY = 0;

  // Ground floor sits cleanly above gently sloped edges, while battered stone foundation
  // reaches at least 0.45m below minTerrainY so buildings NEVER float on hills or pond banks!
  const floorY = Math.max(centerTerrainY + 0.16, Math.min(centerTerrainY + 1.35, maxTerrainY - 0.08));
  const foundationBottomWorldY = minTerrainY - 0.45;
  const localFoundBottom = Math.min(-0.48, foundationBottomWorldY - floorY);

  const group = new THREE.Group();
  group.name = `arch_${type}_${id}`;
  group.userData.archEntityId = id;
  group.userData.archEntityType = 'building';
  group.position.set(x, floorY, z);
  group.rotation.y = rotation;

  // Helper: check if world position (wx, wy, wz) is buried inside an adjacent/overlapping building
  function isPointBuriedInNeighbor(wx, wy, wz, margin = 0.28) {
    for (let i = 0; i < otherBuildings.length; i++) {
      const ob = otherBuildings[i];
      if (!ob || ob.id === id) continue;
      const obTop = (ob.baseY ?? getTerrainHeight(ob.x, ob.z)) + (ob.height || 3.8) + (ob.roofHeight || 2.5) * 0.45;
      if (wy > obTop + 0.25) continue;

      if (ob.type === 'tower') {
        const dist = Math.hypot(wx - ob.x, wz - ob.z) - (ob.radius || 2.8);
        if (dist < margin) return true;
      } else {
        const sDist = pointToOBBSignedDist2D(wx, wz, ob.x, ob.z, ob.width || 5.5, ob.depth || 4.5, ob.rotation || 0);
        if (sDist < margin) return true;
      }
    }
    return false;
  }

  const rng = mulberry32(seed);
  const stoneGC = new GeometryCollector();
  const plasterGC = new GeometryCollector();
  const timberGC = new GeometryCollector();
  const windowGC = new GeometryCollector();
  const foliageGC = new GeometryCollector();
  const emissiveGC = new GeometryCollector();
  const shingleInstances = []; // Array<{ matrix: THREE.Matrix4, color: THREE.Color }>
  const chimneyPositions = [];
  const lanternPositions = [];

  const baseWallColor = resolveWallColor(materials, wallStyle);
  const quoinBaseColor = baseWallColor.clone().lerp(new THREE.Color('#e8dfd0'), 0.22);
  const baseRoofColor = resolveRoofColor(materials, roofColor);

  const buildCtx = {
    id,
    x,
    z,
    rotation,
    floorY,
    localFoundBottom,
    width,
    depth,
    radius,
    height,
    roofHeight,
    roofCurve,
    roofColor,
    wallStyle,
    crenellated,
    tudor,
    hasChimney: spec.chimney !== false,
    rng,
    materials,
    getTerrainHeight,
    waterLevel,
    otherBuildings,
    localToWorldXZ,
    isPointBuriedInNeighbor,
    baseWallColor,
    quoinBaseColor,
    baseRoofColor,
    stoneGC,
    plasterGC,
    timberGC,
    windowGC,
    foliageGC,
    emissiveGC,
    shingleInstances,
    chimneyPositions,
    lanternPositions,
  };

  if (type === 'cottage') {
    constructCottage(buildCtx);
  } else {
    constructTower(buildCtx);
  }

  // Assemble meshes into group (minimal draw calls: 1 per active material!)
  if (!stoneGC.isEmpty) {
    const m = new THREE.Mesh(stoneGC.toBufferGeometry(), materials.stoneWall);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  if (!plasterGC.isEmpty) {
    const m = new THREE.Mesh(plasterGC.toBufferGeometry(), materials.plaster || materials.stoneWall);
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
  if (shingleInstances.length > 0) {
    const shingleGeo = getSharedShingleGeometry();
    const inst = new THREE.InstancedMesh(shingleGeo, materials.roofTile, shingleInstances.length);
    for (let i = 0; i < shingleInstances.length; i++) {
      const item = shingleInstances[i];
      inst.setMatrixAt(i, item.matrix);
      inst.setColorAt(i, item.color);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    group.add(inst);
  }

  const eaveY = floorY + height;
  const peakY = eaveY + (crenellated ? Math.max(0.62, roofHeight * 0.8) : roofHeight);

  const footprint = type === 'tower'
    ? { type: 'circle', x, z, radius: radius + 0.28 }
    : { type: 'obb', x, z, width: width + 0.48, depth: depth + 0.48, rotation };

  return {
    group,
    anchor: new THREE.Vector3(x, floorY, z),
    baseY: floorY,
    eaveY,
    peakY,
    foundationBottomY: foundationBottomWorldY,
    chimneyPositions,
    lanternPositions,
    footprint,
  };
}

function makeAxisHex(x0, x1, y0, y1, z0, z1) {
  return [
    new THREE.Vector3(x0, y0, z0),
    new THREE.Vector3(x1, y0, z0),
    new THREE.Vector3(x1, y0, z1),
    new THREE.Vector3(x0, y0, z1),
    new THREE.Vector3(x0, y1, z0),
    new THREE.Vector3(x1, y1, z0),
    new THREE.Vector3(x1, y1, z1),
    new THREE.Vector3(x0, y1, z1),
  ];
}

function pushShingleInstance(list, pos, eulerXYZ, scaleXYZ, baseRoofColor, rng, shadeBias = 1.0) {
  _pos.copy(pos);
  _euler.set(eulerXYZ.x, eulerXYZ.y, eulerXYZ.z, 'YXZ');
  _quat.setFromEuler(_euler);
  _scale.set(scaleXYZ.x, scaleXYZ.y, scaleXYZ.z);
  _mat4.compose(_pos, _quat, _scale);

  const v = shadeBias * (0.91 + rng() * 0.18);
  const warm = (rng() - 0.5) * 0.04;
  _col.setRGB(
    Math.min(1, Math.max(0.03, baseRoofColor.r * v + warm)),
    Math.min(1, Math.max(0.03, baseRoofColor.g * v + warm * 0.3)),
    Math.min(1, Math.max(0.03, baseRoofColor.b * v - warm * 0.4))
  );

  list.push({
    matrix: _mat4.clone(),
    color: _col.clone(),
  });
}

/* ============================================================================
 * COTTAGE BUILDER (Rectangular Plan, Quoins, Tudor Option, Witch-Hat Gable Roof)
 * ============================================================================ */
function constructCottage(c) {
  const {
    floorY,
    localFoundBottom,
    width,
    depth,
    height,
    roofHeight,
    roofCurve,
    wallStyle,
    crenellated,
    tudor,
    hasChimney,
    rng,
    getTerrainHeight,
    waterLevel,
    localToWorldXZ,
    isPointBuriedInNeighbor,
    baseWallColor,
    quoinBaseColor,
    baseRoofColor,
    stoneGC,
    plasterGC,
    timberGC,
    windowGC,
    foliageGC,
    emissiveGC,
    shingleInstances,
    chimneyPositions,
    lanternPositions,
  } = c;

  const hw = width * 0.5;
  const hd = depth * 0.5;
  const xAxis = new THREE.Vector3(1, 0, 0);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);

  // Determine Tudor split story height
  const hasTudorUpper = tudor && height >= 2.5;
  const splitY = hasTudorUpper ? Math.max(1.5, Math.min(height - 1.1, height * 0.48)) : height;
  const jetty = hasTudorUpper ? 0.21 : 0;

  // 1. Solid Opaque Backing Shell (zero light leaks through stone mortar crevices)
  const coreGC = wallStyle === 'plaster' && !tudor ? plasterGC : stoneGC;
  const coreCol = wallStyle === 'plaster' && !tudor ? [0.98, 0.96, 0.92] : jitterStoneColor(baseWallColor, rng, 0.68, 0.02);
  coreGC.pushOrientedBox(
    new THREE.Vector3(0, 0.5 * (localFoundBottom + splitY), 0),
    xAxis,
    yAxis,
    zAxis,
    hw - 0.04,
    0.5 * (splitY - localFoundBottom),
    hd - 0.04,
    coreCol
  );
  if (hasTudorUpper) {
    plasterGC.pushOrientedBox(
      new THREE.Vector3(0, 0.5 * (splitY + height), 0),
      xAxis,
      yAxis,
      zAxis,
      hw + jetty - 0.03,
      0.5 * (height - splitY),
      hd + jetty - 0.03,
      [0.99, 0.97, 0.93]
    );
  }

  // 2. Battered Stone Foundation Plinth (reaches below minTerrainY so ZERO floating!)
  buildRectFoundationPlinth(c, hw, hd, localFoundBottom);

  // 3. Plan Exterior Openings (Door + Windows) avoiding buried neighbor walls!
  // Facade definitions: 0: +Z (front), 1: -Z (back), 2: +X (right), 3: -X (left)
  const facades = [
    { idx: 0, span: width, halfOut: hd, outX: 0, outZ: 1, tanX: 1, tanZ: 0 },
    { idx: 1, span: width, halfOut: hd, outX: 0, outZ: -1, tanX: -1, tanZ: 0 },
    { idx: 2, span: depth, halfOut: hw, outX: 1, outZ: 0, tanX: 0, tanZ: -1 },
    { idx: 3, span: depth, halfOut: hw, outX: -1, outZ: 0, tanX: 0, tanZ: 1 },
  ];

  // Pick best unobstructed facade for the arched oak entrance door
  let doorFacadeIdx = -1;
  let doorOffsetT = 0;
  let bestDoorScore = -Infinity;

  for (let f = 0; f < facades.length; f++) {
    const fac = facades[f];
    if (fac.span < 2.1) continue;
    const probeDist = fac.halfOut + 0.65;
    const { wx, wz } = localToWorldXZ(fac.outX * probeDist, fac.outZ * probeDist);
    if (isPointBuriedInNeighbor(wx, floorY + 1.0, wz, 0.35)) continue;
    const groundHere = getTerrainHeight(wx, wz);
    if (groundHere < waterLevel - 0.05) continue;
    const drop = floorY - groundHere;
    if (drop > 2.6) continue;
    // Prefer front (+Z) or back (-Z) long facades and gentle stair drop
    const longBonus = f < 2 ? 1.5 : 0.4;
    const score = longBonus - Math.abs(drop - 0.35) * 0.8;
    if (score > bestDoorScore) {
      bestDoorScore = score;
      doorFacadeIdx = f;
      doorOffsetT = fac.span > 4.6 ? (rng() < 0.5 ? -0.55 : 0.55) : 0;
    }
  }

  // Collect window/door cutout rectangles per facade so stone courses frame around them cleanly
  const facadeCutouts = [[], [], [], []];

  if (doorFacadeIdx >= 0) {
    const doorW = 1.12;
    const doorH = Math.min(2.15, height - 0.45);
    facadeCutouts[doorFacadeIdx].push({
      kind: 'door',
      uCenter: doorOffsetT,
      halfW: doorW * 0.5 + 0.16,
      yBot: 0,
      yTop: doorH + 0.22,
    });
    buildArchedOakDoorAndStairs(c, facades[doorFacadeIdx], doorOffsetT, doorW, doorH);
  }

  // Populate ground & upper floor windows on unobstructed wall bays
  const hasTwoRows = height >= 3.45;
  const rowHeights = hasTwoRows
    ? [Math.min(1.22, splitY * 0.52), Math.max(splitY + 0.68, height - 1.05)]
    : [Math.min(height * 0.52, 1.55)];

  for (let f = 0; f < facades.length; f++) {
    const fac = facades[f];
    const usableSpan = fac.span - 1.35;
    if (usableSpan < 0.9) continue;
    const numBays = Math.max(1, Math.min(4, Math.floor(fac.span / 2.15)));

    for (let r = 0; r < rowHeights.length; r++) {
      const winY = rowHeights[r];
      if (winY + 0.65 > height - 0.22) continue;
      const isUpperJetty = hasTudorUpper && winY > splitY;
      const outSurface = fac.halfOut + (isUpperJetty ? jetty : 0);

      for (let b = 0; b < numBays; b++) {
        const u = numBays === 1 ? 0 : ((b / (numBays - 1)) - 0.5) * (usableSpan - 0.5);
        // Check overlap with door on same facade
        let overlapsDoor = false;
        for (let k = 0; k < facadeCutouts[f].length; k++) {
          const cut = facadeCutouts[f][k];
          if (Math.abs(u - cut.uCenter) < cut.halfW + 0.62 && winY - 0.6 < cut.yTop + 0.18) {
            overlapsDoor = true;
            break;
          }
        }
        if (overlapsDoor) continue;

        // Check neighbor building burial
        const lx = fac.outX * (outSurface + 0.45) + fac.tanX * u;
        const lz = fac.outZ * (outSurface + 0.45) + fac.tanZ * u;
        const { wx, wz } = localToWorldXZ(lx, lz);
        if (isPointBuriedInNeighbor(wx, floorY + winY, wz, 0.32)) continue;

        const winW = 0.82;
        const winH = 1.04;
        if (!isUpperJetty) {
          facadeCutouts[f].push({
            kind: 'window',
            uCenter: u,
            halfW: winW * 0.5 + 0.08,
            yBot: winY - winH * 0.5 - 0.06,
            yTop: winY + winH * 0.5 + 0.08,
          });
        }

        const addFlowerbox = r === 0 && rng() < 0.65;
        buildFramedWindow(c, fac, u, winY, outSurface, winW, winH, {
          shutters: !crenellated,
          flowerbox: addFlowerbox,
          tudorFrame: isUpperJetty,
        });
      }
    }
  }

  // 4. Exterior 3D Stone Wall Courses (when wallStyle !== 'plaster' or on stone ground story)
  const buildStoneCoursesToY = wallStyle === 'plaster' && !tudor ? 0 : splitY;
  if (buildStoneCoursesToY > 0.2) {
    for (let f = 0; f < 4; f++) {
      buildFacadeStoneCourses(c, facades[f], buildStoneCoursesToY, facadeCutouts[f]);
    }
  }

  // 5. Alternating Long/Short Corner Stone Quoins (all 4 corners up to splitY or full height!)
  const quoinTopY = hasTudorUpper ? splitY : height;
  buildCornerQuoins(c, hw, hd, quoinTopY);

  // 6. Adjacency Joint Buttresses where neighbor buildings overlap/abut our walls
  buildAdjacencyButtresses(c, facades, quoinTopY);

  // 7. Optional Tudor Jettying Upper Timber-Framed Story
  if (hasTudorUpper) {
    buildTudorUpperStory(c, hw, hd, splitY, height, jetty);
  }

  // 8. Roof / Gables / Battlements
  if (crenellated) {
    buildCottageBattlementsAndKeepRoof(c, hw + jetty, hd + jetty, height, roofHeight, roofCurve);
  } else {
    buildCottageWitchHatGableRoof(c, hw, hd, jetty, hasTudorUpper, height, roofHeight, roofCurve);
  }

  // 9. Stone Cottage Chimney (near ridge shoulder, exporting smoke world pos!)
  if (hasChimney && roofHeight >= 1.0) {
    const chimSideX = (rng() < 0.5 ? 1 : -1) * Math.min(hw * 0.56, Math.max(0.55, hw - 0.85));
    const chimOffZ = (rng() < 0.5 ? 1 : -1) * Math.min(hd * 0.22, 0.55);
    buildCottageChimney(c, chimSideX, chimOffZ, hd + jetty, height, roofHeight, roofCurve);
  }
}

function buildRectFoundationPlinth(c, hw, hd, localFoundBottom) {
  const { stoneGC, baseWallColor, rng, getTerrainHeight, localToWorldXZ, floorY } = c;
  const plinthTop = 0.08;
  const totalDrop = plinthTop - localFoundBottom;
  const courseH = 0.36;
  const numCourses = Math.max(2, Math.min(14, Math.ceil(totalDrop / courseH)));
  const dH = totalDrop / numCourses;

  // Molded water-table plinth ledge around perimeter at y = -0.06 .. +0.10
  const wtPad = 0.085;
  const facades = [
    { z0: hd - 0.15, z1: hd + wtPad, x0: -hw - wtPad, x1: hw + wtPad, alongX: true },
    { z0: -hd - wtPad, z1: -hd + 0.15, x0: -hw - wtPad, x1: hw + wtPad, alongX: true },
    { z0: -hd, z1: hd, x0: hw - 0.15, x1: hw + wtPad, alongX: false },
    { z0: -hd, z1: hd, x0: -hw - wtPad, x1: -hw + 0.15, alongX: false },
  ];

  for (let s = 0; s < facades.length; s++) {
    const side = facades[s];
    const span = side.alongX ? side.x1 - side.x0 : side.z1 - side.z0;
    const blocks = Math.max(2, Math.round(span / 0.74));
    for (let b = 0; b < blocks; b++) {
      const t0 = b / blocks;
      const t1 = (b + 1) / blocks;
      const x0 = side.alongX ? side.x0 + t0 * span : side.x0;
      const x1 = side.alongX ? side.x0 + t1 * span : side.x1;
      const z0 = side.alongX ? side.z0 : side.z0 + t0 * span;
      const z1 = side.alongX ? side.z1 : side.z0 + t1 * span;
      stoneGC.pushBeveledStone(
        makeAxisHex(x0, x1, -0.08, 0.09, z0, z1),
        jitterStoneColor(baseWallColor, rng, 0.88, 0.06),
        { bevelXZ: 0.07, bevelY: 0.18 }
      );
    }
  }

  // Battered foundation stone courses extending below terrain at every perimeter column
  const perimSides = [
    { outX: 0, outZ: 1, tanX: 1, tanZ: 0, halfOut: hd, span: hw * 2 },
    { outX: 0, outZ: -1, tanX: -1, tanZ: 0, halfOut: hd, span: hw * 2 },
    { outX: 1, outZ: 0, tanX: 0, tanZ: -1, halfOut: hw, span: hd * 2 },
    { outX: -1, outZ: 0, tanX: 0, tanZ: 1, halfOut: hw, span: hd * 2 },
  ];

  for (let row = 0; row < numCourses; row++) {
    const yTop = -0.07 - row * dH;
    const yBot = yTop - dH;
    const batterTop = 0.07 + (row / numCourses) * 0.18;
    const batterBot = 0.07 + ((row + 1) / numCourses) * 0.18;
    const ao = Math.max(0.62, 0.82 - row * 0.05);

    for (let f = 0; f < 4; f++) {
      const side = perimSides[f];
      const fullSpan = side.span + batterBot * 2;
      const cols = Math.max(3, Math.round(fullSpan / 0.72));
      const stagger = (row & 1) ? 0.32 : 0;

      for (let col = 0; col < cols; col++) {
        const u0 = -fullSpan * 0.5 + (col / cols) * fullSpan + (col === 0 ? 0 : stagger * 0.2);
        const u1 = -fullSpan * 0.5 + ((col + 1) / cols) * fullSpan;
        const uMid = 0.5 * (u0 + u1);
        const lx = side.outX * (side.halfOut + batterBot) + side.tanX * uMid;
        const lz = side.outZ * (side.halfOut + batterBot) + side.tanZ * uMid;
        const { wx, wz } = localToWorldXZ(lx, lz);
        const localTerr = getTerrainHeight(wx, wz) - floorY;

        // Skip blocks completely buried more than 0.6m below local terrain surface
        if (yTop < localTerr - 0.55) continue;

        const outIn = side.halfOut - 0.18;
        const outBot = side.halfOut + batterBot;
        const outTop = side.halfOut + batterTop;

        const hex = makeFacadeHex(side, u0, u1, yBot, yTop, outIn, outBot, outTop);
        stoneGC.pushBeveledStone(hex, jitterStoneColor(baseWallColor, rng, ao, 0.08));
      }
    }
  }
}

function makeFacadeHex(fac, u0, u1, y0, y1, innerD, outerBotD, outerTopD) {
  const { outX, outZ, tanX, tanZ } = fac;
  function pt(u, y, d) {
    return new THREE.Vector3(outX * d + tanX * u, y, outZ * d + tanZ * u);
  }
  return [
    pt(u0, y0, innerD),
    pt(u1, y0, innerD),
    pt(u1, y0, outerBotD),
    pt(u0, y0, outerBotD),
    pt(u0, y1, innerD),
    pt(u1, y1, innerD),
    pt(u1, y1, outerTopD),
    pt(u0, y1, outerTopD),
  ];
}

function buildFacadeStoneCourses(c, fac, topY, cutouts) {
  const { stoneGC, baseWallColor, rng } = c;
  const courseH = 0.31;
  const startY = 0.08;
  const rows = Math.max(2, Math.round((topY - startY) / courseH));
  const dY = (topY - startY) / rows;
  const halfSpan = fac.span * 0.5 - 0.28; // Leave corner margin for dressed quoins
  if (halfSpan <= 0.15) return;

  const nominalW = 0.62;

  for (let r = 0; r < rows; r++) {
    const y0 = startY + r * dY;
    const y1 = y0 + dY;
    const ao = 0.83 + 0.17 * Math.min(1, (r * dY) / 1.0);
    let cursor = -halfSpan;
    let first = (r & 1) === 1;

    while (cursor < halfSpan - 0.05) {
      const w = first ? nominalW * 0.52 : nominalW * (0.85 + rng() * 0.3);
      first = false;
      let next = Math.min(halfSpan, cursor + w);
      if (halfSpan - next < 0.2) next = halfSpan;

      // Clip against window/door cutouts
      let skip = false;
      for (let k = 0; k < cutouts.length; k++) {
        const cut = cutouts[k];
        if (y1 <= cut.yBot + 0.01 || y0 >= cut.yTop - 0.01) continue;
        const c0 = cut.uCenter - cut.halfW;
        const c1 = cut.uCenter + cut.halfW;
        if (cursor >= c0 - 0.02 && cursor < c1 - 0.02) {
          cursor = Math.min(halfSpan, c1);
          skip = true;
          break;
        }
        if (cursor < c0 - 0.02 && next > c0) {
          next = c0;
        }
      }
      if (skip) continue;

      const u0 = cursor;
      const u1 = next;
      cursor = next;
      if (u1 - u0 < 0.1) continue;

      const proud = fac.halfOut + 0.022 + (rng() - 0.5) * 0.018;
      const hex = makeFacadeHex(fac, u0, u1, y0, y1, fac.halfOut - 0.12, proud, proud);
      stoneGC.pushBeveledStone(hex, jitterStoneColor(baseWallColor, rng, ao, 0.085), {
        bevelXZ: 0.08,
        bevelY: 0.14,
      });
    }
  }
}

function buildCornerQuoins(c, hw, hd, topY) {
  const { stoneGC, quoinBaseColor, rng } = c;
  const startY = 0.08;
  const quoinH = 0.34;
  const numQuoins = Math.max(3, Math.round((topY - startY) / quoinH));
  const dY = (topY - startY) / numQuoins;
  const proud = 0.052;

  const corners = [
    { sx: 1, sz: 1 },
    { sx: -1, sz: 1 },
    { sx: 1, sz: -1 },
    { sx: -1, sz: -1 },
  ];

  for (let q = 0; q < numQuoins; q++) {
    const y0 = startY + q * dY;
    const y1 = y0 + dY;
    const longAlongX = (q & 1) === 0;
    const lenX = longAlongX ? 0.58 : 0.34;
    const lenZ = longAlongX ? 0.34 : 0.58;
    const ao = 0.86 + 0.16 * Math.min(1, q / 3);

    for (let cIdx = 0; cIdx < 4; cIdx++) {
      const { sx, sz } = corners[cIdx];
      const xOuter = sx * (hw + proud);
      const xInner = sx * (hw - lenX + proud);
      const zOuter = sz * (hd + proud);
      const zInner = sz * (hd - lenZ + proud);

      const x0 = Math.min(xOuter, xInner);
      const x1 = Math.max(xOuter, xInner);
      const z0 = Math.min(zOuter, zInner);
      const z1 = Math.max(zOuter, zInner);

      stoneGC.pushBeveledStone(
        makeAxisHex(x0, x1, y0, y1, z0, z1),
        jitterStoneColor(quoinBaseColor, rng, ao, 0.055),
        { bevelXZ: 0.09, bevelY: 0.14 }
      );
    }
  }
}

function buildAdjacencyButtresses(c, facades, topY) {
  const { stoneGC, baseWallColor, rng, localToWorldXZ, isPointBuriedInNeighbor, floorY } = c;
  for (let f = 0; f < 4; f++) {
    const fac = facades[f];
    const samples = 5;
    for (let i = 1; i < samples; i++) {
      const uPrev = ((i - 1) / samples - 0.5) * fac.span;
      const uCur = (i / samples - 0.5) * fac.span;
      const pPrev = localToWorldXZ(fac.outX * (fac.halfOut + 0.25) + fac.tanX * uPrev, fac.outZ * (fac.halfOut + 0.25) + fac.tanZ * uPrev);
      const pCur = localToWorldXZ(fac.outX * (fac.halfOut + 0.25) + fac.tanX * uCur, fac.outZ * (fac.halfOut + 0.25) + fac.tanZ * uCur);
      const bPrev = isPointBuriedInNeighbor(pPrev.wx, floorY + 1.2, pPrev.wz, 0.25);
      const bCur = isPointBuriedInNeighbor(pCur.wx, floorY + 1.2, pCur.wz, 0.25);
      // Transition edge where another wing joins this facade -> build connecting stone buttress!
      if (bPrev !== bCur) {
        const uJoint = 0.5 * (uPrev + uCur);
        const bH = Math.max(1.6, topY * 0.85);
        const steps = 3;
        for (let s = 0; s < steps; s++) {
          const y0 = (s / steps) * bH;
          const y1 = ((s + 1) / steps) * bH;
          const proj = 0.34 - s * 0.08;
          const hex = makeFacadeHex(fac, uJoint - 0.22, uJoint + 0.22, y0, y1, fac.halfOut - 0.05, fac.halfOut + proj, fac.halfOut + proj - 0.04);
          stoneGC.pushBeveledStone(hex, jitterStoneColor(baseWallColor, rng, 0.92, 0.06));
        }
      }
    }
  }
}

function buildTudorUpperStory(c, hw, hd, splitY, topY, jetty) {
  const { timberGC } = c;
  const xAxis = new THREE.Vector3(1, 0, 0);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);

  const jw = hw + jetty;
  const jd = hd + jetty;
  const beamThick = 0.085;
  const upperH = topY - splitY;

  // Carved timber jetty corbel brackets under overhang around all 4 sides
  const numCorbelsX = Math.max(3, Math.round((hw * 2) / 1.1));
  for (let i = 0; i <= numCorbelsX; i++) {
    const lx = -hw + (i / numCorbelsX) * (hw * 2);
    for (const sz of [-1, 1]) {
      timberGC.pushOrientedBox(
        new THREE.Vector3(lx, splitY - 0.14, sz * (hd + jetty * 0.48)),
        xAxis,
        yAxis,
        zAxis,
        0.065,
        0.14,
        jetty * 0.55 + 0.06,
        [0.92, 0.9, 0.88]
      );
    }
  }
  const numCorbelsZ = Math.max(2, Math.round((hd * 2) / 1.15));
  for (let i = 1; i < numCorbelsZ; i++) {
    const lz = -hd + (i / numCorbelsZ) * (hd * 2);
    for (const sx of [-1, 1]) {
      timberGC.pushOrientedBox(
        new THREE.Vector3(sx * (hw + jetty * 0.48), splitY - 0.14, lz),
        xAxis,
        yAxis,
        zAxis,
        jetty * 0.55 + 0.06,
        0.14,
        0.065,
        [0.92, 0.9, 0.88]
      );
    }
  }

  // Horizontal sill bressummer beams & top wall-plate beams
  for (const by of [splitY + 0.06, topY - 0.06]) {
    for (const sz of [-1, 1]) {
      timberGC.pushOrientedBox(new THREE.Vector3(0, by, sz * jd), xAxis, yAxis, zAxis, jw + 0.05, 0.075, beamThick * 0.5, [1, 1, 1]);
    }
    for (const sx of [-1, 1]) {
      timberGC.pushOrientedBox(new THREE.Vector3(sx * jw, by, 0), xAxis, yAxis, zAxis, beamThick * 0.5, 0.075, jd + 0.05, [1, 1, 1]);
    }
  }

  // 4 corner oak posts + vertical timber studs + diagonal corner wind-braces
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      timberGC.pushOrientedBox(
        new THREE.Vector3(sx * jw, splitY + upperH * 0.5, sz * jd),
        xAxis,
        yAxis,
        zAxis,
        0.09,
        upperH * 0.5,
        0.09,
        [0.96, 0.94, 0.92]
      );
    }
  }

  // Studs along +Z/-Z
  const studsX = Math.max(3, Math.round((jw * 2) / 1.15));
  for (let i = 1; i < studsX; i++) {
    const lx = -jw + (i / studsX) * (jw * 2);
    for (const sz of [-1, 1]) {
      timberGC.pushOrientedBox(
        new THREE.Vector3(lx, splitY + upperH * 0.5, sz * jd),
        xAxis,
        yAxis,
        zAxis,
        0.055,
        upperH * 0.5,
        0.045,
        [0.98, 0.96, 0.94]
      );
    }
  }

  // Studs along +X/-X
  const studsZ = Math.max(2, Math.round((jd * 2) / 1.15));
  for (let i = 1; i < studsZ; i++) {
    const lz = -jd + (i / studsZ) * (jd * 2);
    for (const sx of [-1, 1]) {
      timberGC.pushOrientedBox(
        new THREE.Vector3(sx * jw, splitY + upperH * 0.5, lz),
        xAxis,
        yAxis,
        zAxis,
        0.045,
        upperH * 0.5,
        0.055,
        [0.98, 0.96, 0.94]
      );
    }
  }

  // Diagonal Tudor corner braces on front/back facades
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const p0 = new THREE.Vector3(sx * (jw - 0.08), splitY + upperH * 0.25, sz * jd);
      const p1 = new THREE.Vector3(sx * Math.max(0.2, jw - 0.95), topY - 0.08, sz * jd);
      const dir = new THREE.Vector3().subVectors(p1, p0);
      const len = dir.length();
      if (len > 0.25) {
        dir.multiplyScalar(1 / len);
        const up = new THREE.Vector3().crossVectors(zAxis, dir).normalize();
        const mid = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);
        timberGC.pushOrientedBox(mid, dir, up, zAxis, len * 0.5, 0.048, 0.042, [0.95, 0.93, 0.9]);
      }
    }
  }
}

function buildCottageWitchHatGableRoof(c, hw, hd, jetty, isTudorGable, eaveLocalY, roofHeight, roofCurve) {
  const {
    wallStyle,
    tudor,
    rng,
    baseWallColor,
    baseRoofColor,
    stoneGC,
    plasterGC,
    timberGC,
    shingleInstances,
    localToWorldXZ,
    isPointBuriedInNeighbor,
    floorY,
  } = c;

  const wallW = hw + jetty;
  const wallD = hd + jetty;
  const overX = 0.36;
  const overZ = 0.42;
  const roofHalfSpanX = wallW + overX;
  const roofHalfSpanZ = wallD + overZ;

  const xAxis = new THREE.Vector3(1, 0, 0);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);

  function evalSubRoofY(zAbs) {
    const tRoof = roofHalfSpanZ > 0 ? Math.max(0, Math.min(1, (roofHalfSpanZ - zAbs) / roofHalfSpanZ)) : 1;
    return eaveLocalY - 0.14 + evalRoofProfile(tRoof, roofCurve) * (roofHeight + 0.14) - 0.04;
  }

  // Seal +Z/-Z eaves wall-plate junction up to exact sub-roof soffit height
  const yDeckWallD = evalSubRoofY(wallD);
  if (yDeckWallD > eaveLocalY - 0.02) {
    const eaveFillMidY = 0.5 * (eaveLocalY - 0.06 + yDeckWallD + 0.03);
    const eaveFillHalfH = Math.max(0.04, 0.5 * (yDeckWallD + 0.03 - (eaveLocalY - 0.06)));
    const eaveBackingGC = isTudorGable || (wallStyle === 'plaster' && !tudor) ? plasterGC : stoneGC;
    const eaveBackingCol =
      eaveBackingGC === plasterGC ? [0.96, 0.94, 0.9] : jitterStoneColor(baseWallColor, rng, 0.68, 0.02);
    for (const sz of [-1, 1]) {
      eaveBackingGC.pushOrientedBox(
        new THREE.Vector3(0, eaveFillMidY, sz * (wallD - 0.06)),
        xAxis,
        yAxis,
        zAxis,
        Math.max(0.1, wallW - 0.04),
        eaveFillHalfH,
        0.05,
        eaveBackingCol
      );
      timberGC.pushOrientedBox(
        new THREE.Vector3(0, 0.5 * (eaveLocalY - 0.03 + yDeckWallD + 0.02), sz * (wallD - 0.015)),
        xAxis,
        yAxis,
        zAxis,
        Math.max(0.1, wallW + 0.02),
        Math.max(0.045, 0.5 * (yDeckWallD - eaveLocalY) + 0.03),
        0.045,
        [0.9, 0.86, 0.82]
      );
    }
  }

  // Pre-check attic lancet windows on ±X gables so stone courses frame cleanly around them
  const gableGC = isTudorGable || (wallStyle === 'plaster' && !tudor) ? plasterGC : stoneGC;
  const atticWinW = 0.58;
  const atticWinH = 0.72;
  const atticWinY = eaveLocalY + roofHeight * 0.34;
  const hasAtticWin = { '-1': false, '1': false };
  if (roofHeight >= 1.75 && wallD >= 1.6) {
    for (const sx of [-1, 1]) {
      const { wx, wz } = localToWorldXZ(sx * (wallW + 0.45), 0);
      if (!isPointBuriedInNeighbor(wx, floorY + eaveLocalY + roofHeight * 0.35, wz, 0.3)) {
        hasAtticWin[String(sx)] = true;
      }
    }
  }

  function emitGableBand(sx, yBot, yTop, zHalfBot, zHalfTop, rowIdx) {
    if (yTop - yBot < 0.015 || zHalfBot < 0.04) return;
    const zTopClamped = Math.max(0.02, zHalfTop);

    if (gableGC === plasterGC) {
      const px0 = sx > 0 ? wallW - 0.18 : -(wallW - 0.015);
      const px1 = sx > 0 ? wallW - 0.015 : -(wallW - 0.18);
      plasterGC.pushBeveledStone(
        [
          new THREE.Vector3(px0, yBot - 0.03, -zHalfBot),
          new THREE.Vector3(px1, yBot - 0.03, -zHalfBot),
          new THREE.Vector3(px1, yBot - 0.03, zHalfBot),
          new THREE.Vector3(px0, yBot - 0.03, zHalfBot),
          new THREE.Vector3(px0, yTop + 0.02, -zTopClamped),
          new THREE.Vector3(px1, yTop + 0.02, -zTopClamped),
          new THREE.Vector3(px1, yTop + 0.02, zTopClamped),
          new THREE.Vector3(px0, yTop + 0.02, zTopClamped),
        ],
        [0.98, 0.96, 0.92],
        { bevelXZ: 0.01, bevelY: 0.01 }
      );
      return;
    }

    // Solid inset mortar core backing (zero sky/background leaks through bevels or eave seam)
    const cx0 = sx > 0 ? wallW - 0.2 : -(wallW - 0.04);
    const cx1 = sx > 0 ? wallW - 0.04 : -(wallW - 0.2);
    const czBot = Math.max(0.03, zHalfBot - 0.03);
    const czTop = Math.max(0.02, zTopClamped - 0.03);
    stoneGC.pushBeveledStone(
      [
        new THREE.Vector3(cx0, yBot - 0.04, -czBot),
        new THREE.Vector3(cx1, yBot - 0.04, -czBot),
        new THREE.Vector3(cx1, yBot - 0.04, czBot),
        new THREE.Vector3(cx0, yBot - 0.04, czBot),
        new THREE.Vector3(cx0, yTop + 0.02, -czTop),
        new THREE.Vector3(cx1, yTop + 0.02, -czTop),
        new THREE.Vector3(cx1, yTop + 0.02, czTop),
        new THREE.Vector3(cx0, yTop + 0.02, czTop),
      ],
      jitterStoneColor(baseWallColor, rng, 0.66, 0.02),
      { bevelXZ: 0.01, bevelY: 0.01 }
    );

    // Individual beveled gable stone blocks clipped neatly under the curved roof slope & attic window
    const rowSpan = zHalfBot * 2;
    const nStones = Math.max(1, Math.round(rowSpan / 0.62));
    const cutAttic =
      hasAtticWin[String(sx)] &&
      yTop > atticWinY - atticWinH * 0.5 - 0.09 &&
      yBot < atticWinY + atticWinH * 0.5 + 0.14;
    const cutHalfZ = atticWinW * 0.5 + 0.03;

    // Build staggered stone joints along Z
    const joints = [-zHalfBot];
    const stagger = (rowIdx & 1) === 1 && nStones > 1 ? 0.5 : 0;
    for (let k = 0; k < nStones; k++) {
      const nextZ = -zHalfBot + ((k + 1 - stagger) / nStones) * rowSpan;
      if (nextZ > -zHalfBot + 0.12 && nextZ < zHalfBot - 0.12) {
        joints.push(nextZ);
      }
    }
    joints.push(zHalfBot);

    for (let k = 0; k < joints.length - 1; k++) {
      const raw0 = joints[k];
      const raw1 = joints[k + 1];
      const segs = [];
      if (cutAttic && raw1 > -cutHalfZ && raw0 < cutHalfZ) {
        if (raw0 < -cutHalfZ) segs.push([raw0, -cutHalfZ]);
        if (raw1 > cutHalfZ) segs.push([cutHalfZ, raw1]);
      } else {
        segs.push([raw0, raw1]);
      }

      for (let m = 0; m < segs.length; m++) {
        const [uz0, uz1] = segs[m];
        if (uz1 - uz0 < 0.08) continue;
        const uzTop0 = Math.max(-zTopClamped, Math.min(zTopClamped, uz0));
        const uzTop1 = Math.max(-zTopClamped, Math.min(zTopClamped, uz1));
        if (uzTop1 - uzTop0 < 0.015 && zTopClamped > 0.12) continue;

        const proud = wallW + 0.018 + (rng() - 0.5) * 0.014;
        const gx0 = sx > 0 ? wallW - 0.14 : -proud;
        const gx1 = sx > 0 ? proud : -(wallW - 0.14);
        const hex = [
          new THREE.Vector3(gx0, yBot - 0.015, uz0),
          new THREE.Vector3(gx1, yBot - 0.015, uz0),
          new THREE.Vector3(gx1, yBot - 0.015, uz1),
          new THREE.Vector3(gx0, yBot - 0.015, uz1),
          new THREE.Vector3(gx0, yTop + 0.008, uzTop0),
          new THREE.Vector3(gx1, yTop + 0.008, uzTop0),
          new THREE.Vector3(gx1, yTop + 0.008, uzTop1),
          new THREE.Vector3(gx0, yTop + 0.008, uzTop1),
        ];
        stoneGC.pushBeveledStone(hex, jitterStoneColor(baseWallColor, rng, 0.96, 0.075));
      }
    }
  }

  // 1a. Base Gable Courses bridging eaveLocalY -> yDeckWallD across full [-wallD, +wallD] (zero horizontal slit!)
  let gableRowCounter = 0;
  if (yDeckWallD > eaveLocalY + 0.01) {
    const baseSpanY = yDeckWallD - eaveLocalY;
    const baseRows = Math.max(1, Math.round(baseSpanY / 0.3));
    for (let br = 0; br < baseRows; br++) {
      const by0 = eaveLocalY + (br / baseRows) * baseSpanY - (br === 0 ? 0.01 : 0);
      const by1 = eaveLocalY + ((br + 1) / baseRows) * baseSpanY;
      for (const sx of [-1, 1]) {
        emitGableBand(sx, by0, by1, wallD, wallD, gableRowCounter);
      }
      gableRowCounter++;
    }
  }

  // 1b. Triangular Curved Gable Walls at x = ±wallW rising smoothly along sub-roof profile
  const gableSliceSteps = 10;
  for (let s = 0; s < gableSliceSteps; s++) {
    const t0 = s / gableSliceSteps;
    const t1 = (s + 1) / gableSliceSteps;
    const zOuter0 = wallD * (1 - t0);
    const zOuter1 = wallD * (1 - t1);
    const y0 = Math.max(eaveLocalY, evalSubRoofY(zOuter0));
    const y1 = Math.max(y0 + 0.03, evalSubRoofY(zOuter1) + 0.015);

    for (const sx of [-1, 1]) {
      emitGableBand(sx, y0, y1, zOuter0, zOuter1, gableRowCounter);
    }
    gableRowCounter++;
  }

  // Tudor gable king-post & struts + small gable lancet/attic window!
  for (const sx of [-1, 1]) {
    if (isTudorGable) {
      const gx = sx * (wallW + 0.01);
      timberGC.pushOrientedBox(
        new THREE.Vector3(gx, eaveLocalY + roofHeight * 0.45, 0),
        xAxis,
        yAxis,
        zAxis,
        0.045,
        roofHeight * 0.42,
        0.06,
        [0.95, 0.93, 0.9]
      );
    }

    if (hasAtticWin[String(sx)]) {
      const fac = { outX: sx, outZ: 0, tanX: 0, tanZ: sx > 0 ? -1 : 1, halfOut: wallW };
      const winOutSurf = isTudorGable ? wallW : wallW + 0.008;
      buildFramedWindow(c, fac, 0, atticWinY, winOutSurf, atticWinW, atticWinH, {
        shutters: false,
        flowerbox: false,
        tudorFrame: isTudorGable,
      });
    }
  }

  // 2. Curved Sub-Roof Deck + Exposed Timber Rafter Tails + Carved Bargeboards + Gable Finials
  const profSegs = 12;
  for (let s = 0; s < profSegs; s++) {
    const t0 = s / profSegs;
    const t1 = (s + 1) / profSegs;
    const z0 = roofHalfSpanZ * (1 - t0);
    const z1 = roofHalfSpanZ * (1 - t1);
    const y0 = eaveLocalY - 0.14 + evalRoofProfile(t0, roofCurve) * (roofHeight + 0.14);
    const y1 = eaveLocalY - 0.14 + evalRoofProfile(t1, roofCurve) * (roofHeight + 0.14);

    for (const sz of [-1, 1]) {
      const pA0 = new THREE.Vector3(-roofHalfSpanX + 0.04, y0 - 0.04, sz * z0);
      const pB0 = new THREE.Vector3(roofHalfSpanX - 0.04, y0 - 0.04, sz * z0);
      const pB1 = new THREE.Vector3(roofHalfSpanX - 0.04, y1 - 0.04, sz * z1);
      const pA1 = new THREE.Vector3(-roofHalfSpanX + 0.04, y1 - 0.04, sz * z1);
      // Sub-roof upper & soffit underside quads
      timberGC.pushQuad(pA0, pB0, pB1, pA1, new THREE.Vector3(0, 1, sz * 0.5), 0.5, [0.78, 0.74, 0.7]);
      timberGC.pushQuad(pA0, pA1, pB1, pB0, new THREE.Vector3(0, -1, -sz * 0.3), 0.5, [0.68, 0.64, 0.6]);

      // Curved Gable Bargeboards at x = ±roofHalfSpanX
      for (const sx of [-1, 1]) {
        const bx = sx * (roofHalfSpanX - 0.03);
        const segStart = new THREE.Vector3(bx, y0 - 0.03, sz * z0);
        const segEnd = new THREE.Vector3(bx, y1 - 0.03, sz * z1);
        const dir = new THREE.Vector3().subVectors(segEnd, segStart);
        const len = dir.length();
        if (len > 0.02) {
          dir.multiplyScalar(1 / len);
          const up = new THREE.Vector3().crossVectors(dir, xAxis).normalize();
          if (up.y < 0) up.negate();
          const mid = new THREE.Vector3().addVectors(segStart, segEnd).multiplyScalar(0.5);
          timberGC.pushOrientedBox(mid, dir, up, xAxis, len * 0.5 + 0.015, 0.075, 0.042, [0.96, 0.93, 0.89]);
        }
      }
    }
  }

  // Exposed Timber Rafter Tails along +Z and -Z eaves
  const numRafters = Math.max(4, Math.round((roofHalfSpanX * 2) / 0.58));
  for (let i = 0; i <= numRafters; i++) {
    const rx = -roofHalfSpanX + 0.14 + (i / numRafters) * (roofHalfSpanX * 2 - 0.28);
    const eavePitch = evalRoofSlopeAngle(0.08, roofCurve, roofHalfSpanZ, roofHeight + 0.14);
    for (const sz of [-1, 1]) {
      const rMid = new THREE.Vector3(rx, eaveLocalY - 0.08, sz * (wallD + overZ * 0.48));
      const slopeDir = new THREE.Vector3(0, -Math.sin(eavePitch), sz * Math.cos(eavePitch)).normalize();
      const upDir = new THREE.Vector3().crossVectors(slopeDir, xAxis).normalize();
      if (upDir.y < 0) upDir.negate();
      timberGC.pushOrientedBox(rMid, xAxis, upDir, slopeDir, 0.038, 0.052, overZ * 0.56, [0.9, 0.86, 0.82]);
    }
  }

  // Turned Timber Gable Finial Spires & Collar Tie Beams at x = ±(roofHalfSpanX - 0.03)
  const apexY = eaveLocalY + roofHeight;
  for (const sx of [-1, 1]) {
    const fx = sx * (roofHalfSpanX - 0.03);
    timberGC.pushCylinder(
      new THREE.Vector3(fx, apexY - 0.28, 0),
      new THREE.Vector3(fx, apexY + 0.42, 0),
      0.055,
      0.018,
      6,
      [0.98, 0.95, 0.9]
    );
    // Decorative collar tie under gable peak
    timberGC.pushOrientedBox(
      new THREE.Vector3(fx, apexY - 0.34, 0),
      xAxis,
      yAxis,
      zAxis,
      0.038,
      0.048,
      Math.min(0.52, roofHalfSpanZ * 0.26),
      [0.94, 0.9, 0.86]
    );
  }

  // 3. Stepped Individual 3D Roof Shingle Courses (InstancedMesh -> 1 draw call!)
  const slopeApproxLen = Math.hypot(roofHalfSpanZ, roofHeight + 0.14);
  const numCourses = Math.max(5, Math.round(slopeApproxLen / 0.27));
  const tileLen = (slopeApproxLen / numCourses) * 1.24; // Overlapping courses!
  const nominalTileW = 0.35;
  const fullLenX = roofHalfSpanX * 2;
  const tilesPerRow = Math.max(4, Math.round(fullLenX / nominalTileW));
  const tileW = fullLenX / tilesPerRow;

  for (let r = 0; r < numCourses; r++) {
    // Place course top edge at tTop, overhanging downward toward eave
    const tTop = (r + 1) / numCourses;
    const tMid = (r + 0.5) / numCourses;
    const zTop = roofHalfSpanZ * (1 - tTop);
    const yTop = eaveLocalY - 0.14 + evalRoofProfile(tTop, roofCurve) * (roofHeight + 0.14);
    const pitch = evalRoofSlopeAngle(tMid, roofCurve, roofHalfSpanZ, roofHeight + 0.14);
    const rowShade = 0.92 + 0.12 * (r / numCourses); // Subtle eave-to-ridge gradient
    const odd = (r & 1) === 1;

    for (const sz of [-1, 1]) {
      const countHere = odd ? tilesPerRow + 1 : tilesPerRow;
      for (let k = 0; k < countHere; k++) {
        let tx0 = -roofHalfSpanX + (odd ? (k - 0.5) * tileW : k * tileW);
        let tx1 = tx0 + tileW;
        tx0 = Math.max(-roofHalfSpanX, tx0);
        tx1 = Math.min(roofHalfSpanX, tx1);
        const actualW = tx1 - tx0;
        if (actualW < 0.08) continue;

        const cx = 0.5 * (tx0 + tx1);
        const yawY = sz > 0 ? 0 : Math.PI;
        const jitterPitch = (rng() - 0.5) * 0.032;
        const jitterRoll = (rng() - 0.5) * 0.025;

        pushShingleInstance(
          shingleInstances,
          new THREE.Vector3(cx, yTop + 0.022, sz * zTop),
          { x: pitch + jitterPitch, y: yawY + jitterRoll * 0.3, z: jitterRoll },
          { x: actualW * 0.985, y: 0.048, z: tileLen },
          baseRoofColor,
          rng,
          rowShade
        );
      }
    }
  }

  // 4. Saddle Ridge Cap Tiles along z = 0 crest!
  const numRidgeCaps = Math.max(4, Math.round(fullLenX / 0.38));
  const capLen = fullLenX / numRidgeCaps;
  for (let k = 0; k < numRidgeCaps; k++) {
    const cx = -roofHalfSpanX + (k + 0.5) * capLen;
    for (const sz of [-1, 1]) {
      pushShingleInstance(
        shingleInstances,
        new THREE.Vector3(cx, apexY + 0.045, sz * -0.02),
        { x: 0.42, y: sz > 0 ? 0 : Math.PI, z: 0 },
        { x: capLen * 0.97, y: 0.055, z: 0.24 },
        baseRoofColor,
        rng,
        1.08
      );
    }
  }

  // 5. Optional Charming Roof Dormer Window on wide/tall cottages!
  if (roofHeight >= 2.0 && hw >= 2.2) {
    for (const sz of [1, -1]) {
      const { wx, wz } = localToWorldXZ(0, sz * (wallD + 0.8));
      if (!isPointBuriedInNeighbor(wx, floorY + eaveLocalY + 1.0, wz, 0.5)) {
        buildRoofDormer(c, 0, sz, roofHalfSpanZ, eaveLocalY, roofHeight, roofCurve);
        break; // Place 1 hero dormer on the clearest main roof slope
      }
    }
  }
}

function buildRoofDormer(c, lx, sz, roofHalfSpanZ, eaveLocalY, roofHeight, roofCurve) {
  const { plasterGC, timberGC, windowGC, shingleInstances, baseRoofColor, rng } = c;
  const xAxis = new THREE.Vector3(1, 0, 0);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);

  const tDorm = 0.34;
  const dormBaseY = eaveLocalY - 0.14 + evalRoofProfile(tDorm, roofCurve) * (roofHeight + 0.14);
  const dormFaceZ = sz * (roofHalfSpanZ * (1 - tDorm) + 0.18);
  const dormBackZ = sz * (roofHalfSpanZ * 0.25);
  const dormW = 1.08;
  const dormH = 0.92;
  const dormMidZ = 0.5 * (dormFaceZ + dormBackZ);
  const dormDepth = Math.abs(dormFaceZ - dormBackZ);

  // Dormer cheeks & face
  plasterGC.pushOrientedBox(
    new THREE.Vector3(lx, dormBaseY + dormH * 0.46, dormMidZ),
    xAxis,
    yAxis,
    zAxis,
    dormW * 0.5,
    dormH * 0.46,
    dormDepth * 0.5,
    [0.98, 0.96, 0.92]
  );

  // Timber frame around dormer front
  for (const sx of [-1, 1]) {
    timberGC.pushOrientedBox(
      new THREE.Vector3(lx + sx * (dormW * 0.5), dormBaseY + dormH * 0.46, dormFaceZ),
      xAxis,
      yAxis,
      zAxis,
      0.045,
      dormH * 0.48,
      0.045,
      [0.95, 0.92, 0.88]
    );
  }

  // Glowing dormer window pane + cross mullion
  const glassZ = dormFaceZ + sz * 0.025;
  const gHalfW = 0.32;
  const gHalfH = 0.32;
  const gMidY = dormBaseY + dormH * 0.48;
  windowGC.pushQuad(
    new THREE.Vector3(lx - gHalfW, gMidY - gHalfH, glassZ),
    new THREE.Vector3(lx + gHalfW, gMidY - gHalfH, glassZ),
    new THREE.Vector3(lx + gHalfW, gMidY + gHalfH, glassZ),
    new THREE.Vector3(lx - gHalfW, gMidY + gHalfH, glassZ),
    new THREE.Vector3(0, 0, sz),
    1.2
  );
  timberGC.pushOrientedBox(new THREE.Vector3(lx, gMidY, glassZ + sz * 0.015), xAxis, yAxis, zAxis, 0.022, gHalfH, 0.02, [0.92, 0.9, 0.88]);
  timberGC.pushOrientedBox(new THREE.Vector3(lx, gMidY, glassZ + sz * 0.015), xAxis, yAxis, zAxis, gHalfW, 0.022, 0.02, [0.92, 0.9, 0.88]);

  // Mini pitched shingle dormer roof
  const dApexY = dormBaseY + dormH + 0.42;
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const cz = dormBackZ + ((k + 0.5) / 4) * (dormFaceZ + sz * 0.14 - dormBackZ);
      pushShingleInstance(
        shingleInstances,
        new THREE.Vector3(lx, dApexY, cz),
        { x: 0.62, y: sx > 0 ? Math.PI * 0.5 : -Math.PI * 0.5, z: 0 },
        { x: dormDepth * 0.34, y: 0.045, z: dormW * 0.72 },
        baseRoofColor,
        rng,
        1.03
      );
    }
  }
}

function buildCottageBattlementsAndKeepRoof(c, hw, hd, eaveY, roofHeight, roofCurve) {
  const { stoneGC, baseWallColor, rng } = c;
  const outPad = 0.12;
  const merlonH = 0.56;

  // Projecting stone corbel machicolations & parapet stringcourse
  const sides = [
    { outX: 0, outZ: 1, tanX: 1, tanZ: 0, halfOut: hd, span: hw * 2 },
    { outX: 0, outZ: -1, tanX: -1, tanZ: 0, halfOut: hd, span: hw * 2 },
    { outX: 1, outZ: 0, tanX: 0, tanZ: -1, halfOut: hw, span: hd * 2 },
    { outX: -1, outZ: 0, tanX: 0, tanZ: 1, halfOut: hw, span: hd * 2 },
  ];

  for (let f = 0; f < 4; f++) {
    const s = sides[f];
    const corbels = Math.max(3, Math.round(s.span / 0.68));
    for (let i = 0; i < corbels; i++) {
      const uMid = -s.span * 0.5 + ((i + 0.5) / corbels) * s.span;
      stoneGC.pushBeveledStone(
        makeFacadeHex(s, uMid - 0.13, uMid + 0.13, eaveY - 0.24, eaveY, s.halfOut - 0.05, s.halfOut + 0.05, s.halfOut + outPad),
        jitterStoneColor(baseWallColor, rng, 0.9, 0.05)
      );
    }
    // Parapet sill & merlons
    const merlons = Math.max(2, Math.round((s.span + outPad * 2) / 1.18));
    const pitch = (s.span + outPad * 2) / merlons;
    for (let m = 0; m < merlons; m++) {
      const u0 = -(s.span * 0.5 + outPad) + m * pitch + 0.08;
      const u1 = u0 + pitch * 0.62;
      stoneGC.pushBeveledStone(
        makeFacadeHex(s, u0, u1, eaveY, eaveY + merlonH, s.halfOut - 0.16, s.halfOut + outPad, s.halfOut + outPad),
        jitterStoneColor(baseWallColor, rng, 1.0, 0.07)
      );
      stoneGC.pushBeveledStone(
        makeFacadeHex(s, u0 - 0.03, u1 + 0.03, eaveY + merlonH, eaveY + merlonH + 0.1, s.halfOut - 0.19, s.halfOut + outPad + 0.04, s.halfOut + outPad + 0.02),
        jitterStoneColor(baseWallColor, rng, 1.05, 0.05)
      );
    }
  }

  // Paved roof deck
  stoneGC.pushBeveledStone(
    makeAxisHex(-hw, hw, eaveY - 0.08, eaveY + 0.05, -hd, hd),
    jitterStoneColor(baseWallColor, rng, 0.88, 0.04)
  );

  // Inset pitched watch roof inside battlements if roofHeight >= 0.9
  if (roofHeight >= 0.9 && hw > 1.3 && hd > 1.3) {
    buildCottageWitchHatGableRoof(c, hw * 0.68, hd * 0.68, 0, false, eaveY + 0.05, roofHeight * 0.78, roofCurve);
  }
}

function buildCottageChimney(c, lx, lz, halfD, eaveY, roofHeight, roofCurve) {
  const { stoneGC, baseWallColor, rng, chimneyPositions, localToWorldXZ, floorY } = c;
  const tAtZ = Math.max(0, Math.min(1, 1 - Math.abs(lz) / Math.max(0.5, halfD + 0.4)));
  const roofSurfaceY = eaveY + evalRoofProfile(tAtZ, roofCurve) * roofHeight;
  const botY = Math.max(eaveY - 0.5, roofSurfaceY - 0.65);
  const topY = eaveY + roofHeight + 0.85;
  const courses = Math.max(4, Math.round((topY - botY) / 0.28));
  const dY = (topY - botY) / courses;

  for (let i = 0; i < courses; i++) {
    const y0 = botY + i * dY;
    const y1 = y0 + dY;
    const taper = 1 - (i / courses) * 0.12;
    const hw = 0.34 * taper;
    const hd = 0.34 * taper;
    stoneGC.pushBeveledStone(
      makeAxisHex(lx - hw, lx + hw, y0, y1, lz - hd, lz + hd),
      jitterStoneColor(baseWallColor, rng, 0.96, 0.08)
    );
  }

  // Corbeled chimney crown
  stoneGC.pushBeveledStone(
    makeAxisHex(lx - 0.38, lx + 0.38, topY, topY + 0.13, lz - 0.38, lz + 0.38),
    jitterStoneColor(baseWallColor, rng, 1.04, 0.05)
  );

  // Terracotta flue pot
  stoneGC.pushCylinder(
    new THREE.Vector3(lx, topY + 0.12, lz),
    new THREE.Vector3(lx, topY + 0.42, lz),
    0.15,
    0.13,
    8,
    [0.74, 0.38, 0.26]
  );

  const { wx, wz } = localToWorldXZ(lx, lz);
  chimneyPositions.push(new THREE.Vector3(wx, floorY + topY + 0.44, wz));
}

/* ============================================================================
 * SHARED SMART DRESSING: ARCHED OAK DOORS, TERRAIN STAIRS, WINDOWS, FLOWERBOXES
 * ============================================================================ */
function buildArchedOakDoorAndStairs(c, fac, uCenter, doorW, doorH) {
  const {
    stoneGC,
    timberGC,
    emissiveGC,
    quoinBaseColor,
    baseWallColor,
    rng,
    getTerrainHeight,
    localToWorldXZ,
    floorY,
    lanternPositions,
  } = c;

  const { outX, outZ, tanX, tanZ, halfOut } = fac;
  const tanAxis = new THREE.Vector3(tanX, 0, tanZ);
  const upAxis = new THREE.Vector3(0, 1, 0);
  const outAxis = new THREE.Vector3(outX, 0, outZ);

  const archRadius = doorW * 0.5;
  const springY = Math.max(0.95, doorH - archRadius);

  // 1. Recessed Oak Plank Door + Iron Hinge Straps
  const numPlanks = 5;
  const plankW = doorW / numPlanks;
  for (let p = 0; p < numPlanks; p++) {
    const u = uCenter - doorW * 0.5 + (p + 0.5) * plankW;
    const relU = Math.abs(u - uCenter);
    const archTopHere = springY + Math.sqrt(Math.max(0, archRadius * archRadius - relU * relU));
    const pMid = new THREE.Vector3(
      outX * (halfOut + 0.01) + tanX * u,
      archTopHere * 0.5,
      outZ * (halfOut + 0.01) + tanZ * u
    );
    const shade = 0.85 + rng() * 0.12;
    timberGC.pushOrientedBox(pMid, tanAxis, upAxis, outAxis, plankW * 0.47, archTopHere * 0.5, 0.035, [shade, shade * 0.95, shade * 0.9]);
  }

  // Dark wrought-iron strap hinges across door planks
  for (const hy of [0.45, Math.min(springY - 0.12, 1.35)]) {
    const hMid = new THREE.Vector3(
      outX * (halfOut + 0.05) + tanX * (uCenter - doorW * 0.12),
      hy,
      outZ * (halfOut + 0.05) + tanZ * (uCenter - doorW * 0.12)
    );
    timberGC.pushOrientedBox(hMid, tanAxis, upAxis, outAxis, doorW * 0.34, 0.032, 0.014, [0.28, 0.28, 0.3]);
  }

  // 2. 3D Stone Jamb Blocks & Radial Voussoir Door Arch Surround
  for (const side of [-1, 1]) {
    const u0 = side < 0 ? uCenter - doorW * 0.5 - 0.22 : uCenter + doorW * 0.5;
    const u1 = side < 0 ? uCenter - doorW * 0.5 : uCenter + doorW * 0.5 + 0.22;
    const jBlocks = 4;
    for (let b = 0; b < jBlocks; b++) {
      const y0 = (b / jBlocks) * springY;
      const y1 = ((b + 1) / jBlocks) * springY;
      stoneGC.pushBeveledStone(
        makeFacadeHex(fac, u0, u1, y0, y1, halfOut - 0.04, halfOut + 0.09, halfOut + 0.09),
        jitterStoneColor(quoinBaseColor, rng, 0.96, 0.05)
      );
    }
  }

  const numVoussoirs = 7;
  for (let v = 0; v < numVoussoirs; v++) {
    const isKey = v === 3;
    const a0 = -Math.PI * 0.5 + (v / numVoussoirs) * Math.PI;
    const a1 = -Math.PI * 0.5 + ((v + 1) / numVoussoirs) * Math.PI;
    const rIn = archRadius;
    const rOut = isKey ? archRadius + 0.28 : archRadius + 0.22;
    const dOut = isKey ? halfOut + 0.12 : halfOut + 0.095;
    const dIn = halfOut - 0.04;

    const uIn0 = uCenter + Math.sin(a0) * rIn;
    const yIn0 = springY + Math.cos(a0) * rIn;
    const uIn1 = uCenter + Math.sin(a1) * rIn;
    const yIn1 = springY + Math.cos(a1) * rIn;
    const uOut0 = uCenter + Math.sin(a0) * rOut;
    const yOut0 = springY + Math.cos(a0) * rOut;
    const uOut1 = uCenter + Math.sin(a1) * rOut;
    const yOut1 = springY + Math.cos(a1) * rOut;

    function fp(u, y, d) {
      return new THREE.Vector3(outX * d + tanX * u, y, outZ * d + tanZ * u);
    }
    stoneGC.pushBeveledStone(
      [
        fp(uIn0, yIn0, dIn),
        fp(uIn1, yIn1, dIn),
        fp(uIn1, yIn1, dOut),
        fp(uIn0, yIn0, dOut),
        fp(uOut0, yOut0, dIn),
        fp(uOut1, yOut1, dIn),
        fp(uOut1, yOut1, dOut),
        fp(uOut0, yOut0, dOut),
      ],
      jitterStoneColor(quoinBaseColor, rng, isKey ? 1.06 : 1.0, 0.05)
    );
  }

  // Charming Timber Porch Hood Canopy above door arch
  const hoodY = doorH + 0.34;
  const hoodMid = new THREE.Vector3(
    outX * (halfOut + 0.26) + tanX * uCenter,
    hoodY,
    outZ * (halfOut + 0.26) + tanZ * uCenter
  );
  const hoodSlope = new THREE.Vector3(outX * 0.96, -0.28, outZ * 0.96).normalize();
  const hoodUp = new THREE.Vector3().crossVectors(hoodSlope, tanAxis).normalize();
  if (hoodUp.y < 0) hoodUp.negate();
  timberGC.pushOrientedBox(hoodMid, tanAxis, hoodUp, hoodSlope, doorW * 0.68, 0.042, 0.32, [0.94, 0.9, 0.86]);

  // 3. Automatic Stone Entrance Step Stairs reaching down to exact getTerrainHeight!
  const landingProbe = localToWorldXZ(
    outX * (halfOut + 0.95) + tanX * uCenter,
    outZ * (halfOut + 0.95) + tanZ * uCenter
  );
  const groundAtFoot = getTerrainHeight(landingProbe.wx, landingProbe.wz);
  const totalRise = Math.max(0.16, floorY - groundAtFoot);
  const numSteps = Math.max(1, Math.min(14, Math.ceil(totalRise / 0.2)));
  const stepRise = totalRise / numSteps;
  const stepRun = 0.3;
  const stairHalfW = doorW * 0.64;

  for (let s = 0; s < numSteps; s++) {
    const dInner = halfOut + 0.04 + s * stepRun;
    const dOuter = dInner + stepRun + 0.03;
    const topY = -s * stepRise + 0.02;
    const stepProbe = localToWorldXZ(outX * dOuter + tanX * uCenter, outZ * dOuter + tanZ * uCenter);
    const stepGroundLocal = getTerrainHeight(stepProbe.wx, stepProbe.wz) - floorY;
    const botY = Math.min(topY - stepRise - 0.18, stepGroundLocal - 0.28);

    stoneGC.pushBeveledStone(
      makeFacadeHex(fac, uCenter - stairHalfW, uCenter + stairHalfW, botY, topY, halfOut, dOuter, dOuter),
      jitterStoneColor(baseWallColor, rng, 0.88 - s * 0.02, 0.07),
      { bevelXZ: 0.06, bevelY: 0.14 }
    );
  }

  // 4. Warm Porch Wall Lantern right beside entrance door!
  const lanternU = uCenter + doorW * 0.5 + 0.36;
  const lanternY = Math.min(springY + 0.28, doorH);
  const lanternOut = halfOut + 0.24;
  const lPos = new THREE.Vector3(
    outX * lanternOut + tanX * lanternU,
    lanternY,
    outZ * lanternOut + tanZ * lanternU
  );

  // Iron bracket arm + lantern cap + HDR emissive amber core
  timberGC.pushOrientedBox(
    new THREE.Vector3(outX * (halfOut + 0.12) + tanX * lanternU, lanternY + 0.1, outZ * (halfOut + 0.12) + tanZ * lanternU),
    tanAxis,
    upAxis,
    outAxis,
    0.022,
    0.024,
    0.14,
    [0.25, 0.25, 0.28]
  );
  timberGC.pushCylinder(
    new THREE.Vector3(lPos.x, lPos.y + 0.06, lPos.z),
    new THREE.Vector3(lPos.x, lPos.y + 0.15, lPos.z),
    0.11,
    0.02,
    6,
    [0.25, 0.25, 0.28]
  );
  emissiveGC.pushCylinder(
    new THREE.Vector3(lPos.x, lPos.y - 0.08, lPos.z),
    new THREE.Vector3(lPos.x, lPos.y + 0.06, lPos.z),
    0.065,
    0.075,
    6,
    [1, 1, 1]
  );

  // Report lantern light position slightly further out from wall so point light illuminates stone & stairs cleanly
  const lightWorld = localToWorldXZ(
    outX * (halfOut + 0.38) + tanX * lanternU,
    outZ * (halfOut + 0.38) + tanZ * lanternU
  );
  lanternPositions.push({
    position: new THREE.Vector3(lightWorld.wx, floorY + lanternY, lightWorld.wz),
    intensity: 1.0,
  });
}

function buildFramedWindow(c, fac, uCenter, yCenter, outSurface, winW, winH, opts = {}) {
  const { stoneGC, timberGC, windowGC, foliageGC, quoinBaseColor, rng } = c;
  const { outX, outZ, tanX, tanZ } = fac;
  const tanAxis = new THREE.Vector3(tanX, 0, tanZ);
  const upAxis = new THREE.Vector3(0, 1, 0);
  const outAxis = new THREE.Vector3(outX, 0, outZ);

  const hw = winW * 0.5;
  const hh = winH * 0.5;

  // 1. Glowing Leaded-Glass Window Pane (cleanly proud of backing wall, recessed inside frame)
  const glassD = outSurface + 0.018;
  function gp(du, dy) {
    return new THREE.Vector3(outX * glassD + tanX * (uCenter + du), yCenter + dy, outZ * glassD + tanZ * (uCenter + du));
  }
  windowGC.pushQuad(gp(-hw, -hh), gp(hw, -hh), gp(hw, hh), gp(-hw, hh), outAxis, 1.1);

  // 2. Wooden Outer Casement Frame & Cross Mullions (deeply socketed inward for curved tower drums)
  const frameCenterD = outSurface - 0.03;
  const frameHalfDepth = 0.11;
  const fThick = 0.056;
  for (const s of [-1, 1]) {
    timberGC.pushOrientedBox(
      new THREE.Vector3(outX * frameCenterD + tanX * (uCenter + s * hw), yCenter, outZ * frameCenterD + tanZ * (uCenter + s * hw)),
      tanAxis,
      upAxis,
      outAxis,
      fThick * 0.5,
      hh + fThick * 0.5,
      frameHalfDepth,
      [0.92, 0.89, 0.85]
    );
    timberGC.pushOrientedBox(
      new THREE.Vector3(outX * frameCenterD + tanX * uCenter, yCenter + s * hh, outZ * frameCenterD + tanZ * uCenter),
      tanAxis,
      upAxis,
      outAxis,
      hw + fThick,
      fThick * 0.5,
      frameHalfDepth,
      [0.92, 0.89, 0.85]
    );
  }
  // Vertical & horizontal mullions
  timberGC.pushOrientedBox(
    new THREE.Vector3(outX * (glassD + 0.015) + tanX * uCenter, yCenter, outZ * (glassD + 0.015) + tanZ * uCenter),
    tanAxis,
    upAxis,
    outAxis,
    0.018,
    hh,
    0.018,
    [0.88, 0.85, 0.82]
  );
  timberGC.pushOrientedBox(
    new THREE.Vector3(outX * (glassD + 0.015) + tanX * uCenter, yCenter + hh * 0.12, outZ * (glassD + 0.015) + tanZ * uCenter),
    tanAxis,
    upAxis,
    outAxis,
    hw,
    0.018,
    0.018,
    [0.88, 0.85, 0.82]
  );

  // 3. Stone Sill & Lintel (deeply socketed inward so ends never gap on narrow tower drums)
  if (!opts.tudorFrame) {
    const fHelper = { outX, outZ, tanX, tanZ };
    stoneGC.pushBeveledStone(
      makeFacadeHex(fHelper, uCenter - hw - 0.12, uCenter + hw + 0.12, yCenter + hh + 0.02, yCenter + hh + 0.18, outSurface - 0.18, outSurface + 0.09, outSurface + 0.09),
      jitterStoneColor(quoinBaseColor, rng, 1.02, 0.05)
    );
    stoneGC.pushBeveledStone(
      makeFacadeHex(fHelper, uCenter - hw - 0.1, uCenter + hw + 0.1, yCenter - hh - 0.12, yCenter - hh - 0.01, outSurface - 0.18, outSurface + 0.11, outSurface + 0.11),
      jitterStoneColor(quoinBaseColor, rng, 0.98, 0.05)
    );
  }

  // 4. Open Wooden Shutters flanking cottage window
  if (opts.shutters) {
    const shutW = hw * 0.88;
    for (const side of [-1, 1]) {
      const su = uCenter + side * (hw + shutW * 0.5 + 0.05);
      const sd = outSurface + 0.055;
      timberGC.pushOrientedBox(
        new THREE.Vector3(outX * sd + tanX * su, yCenter, outZ * sd + tanZ * su),
        tanAxis,
        upAxis,
        outAxis,
        shutW * 0.5,
        hh * 0.96,
        0.022,
        [0.86, 0.84, 0.8]
      );
    }
  }

  // 5. Charming Cottage Window Flowerbox with Greenery & Blossoms
  if (opts.flowerbox) {
    const boxY = yCenter - hh - 0.18;
    const boxD = outSurface + 0.15;
    timberGC.pushOrientedBox(
      new THREE.Vector3(outX * boxD + tanX * uCenter, boxY, outZ * boxD + tanZ * uCenter),
      tanAxis,
      upAxis,
      outAxis,
      hw + 0.08,
      0.09,
      0.11,
      [0.88, 0.84, 0.78]
    );
    const puffs = 5;
    for (let p = 0; p < puffs; p++) {
      const pu = uCenter + ((p / (puffs - 1)) - 0.5) * (winW * 0.9);
      const pd = boxD + (rng() - 0.5) * 0.05;
      const py = boxY + 0.11 + rng() * 0.05;
      foliageGC.pushCylinder(
        new THREE.Vector3(outX * pd + tanX * pu, py - 0.06, outZ * pd + tanZ * pu),
        new THREE.Vector3(outX * pd + tanX * pu, py + 0.08, outZ * pd + tanZ * pu),
        0.11,
        0.08,
        6,
        [0.95, 1.0, 0.92]
      );
    }
  }
}

/* ============================================================================
 * TOWER BUILDER (Cylindrical Keep, Radial Stone Courses, Conical Roof / Turret)
 * ============================================================================ */
function constructTower(c) {
  const {
    floorY,
    localFoundBottom,
    radius,
    height,
    roofHeight,
    roofCurve,
    crenellated,
    tudor,
    rng,
    getTerrainHeight,
    waterLevel,
    localToWorldXZ,
    isPointBuriedInNeighbor,
    baseWallColor,
    baseRoofColor,
    stoneGC,
    plasterGC,
    timberGC,
    windowGC,
    shingleInstances,
  } = c;

  const hasTudorDrum = tudor && height >= 2.8;
  const stoneTopY = hasTudorDrum ? height * 0.64 : height;
  const upperRadius = hasTudorDrum ? radius + 0.24 : radius;

  // 1. Solid Opaque Inner Cylinder Core (zero light leaks through radial stone seams)
  stoneGC.pushCylinder(
    new THREE.Vector3(0, localFoundBottom, 0),
    new THREE.Vector3(0, stoneTopY, 0),
    radius - 0.05,
    radius - 0.05,
    20,
    jitterStoneColor(baseWallColor, rng, 0.66, 0.02)
  );
  if (hasTudorDrum) {
    plasterGC.pushCylinder(
      new THREE.Vector3(0, stoneTopY - 0.05, 0),
      new THREE.Vector3(0, height, 0),
      upperRadius - 0.03,
      upperRadius - 0.03,
      12,
      [0.98, 0.96, 0.92]
    );
  }

  // 2. Pick Unobstructed Entrance Door Angle & Upper Lancet Window Angles First (so masonry rings clip cleanly!)
  let doorAngle = null;
  let bestDoorScore = -Infinity;
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2 + Math.PI * 0.5; // Start at +Z front
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const { wx, wz } = localToWorldXZ(ca * (radius + 0.65), sa * (radius + 0.65));
    if (isPointBuriedInNeighbor(wx, floorY + 1.0, wz, 0.38)) continue;
    const gH = getTerrainHeight(wx, wz);
    if (gH < waterLevel - 0.05) continue;
    const dropHere = floorY - gH;
    if (dropHere > 2.6) continue;
    const frontBonus = k === 0 ? 1.2 : 0;
    const score = frontBonus - Math.abs(dropHere - 0.35) * 0.8;
    if (score > bestDoorScore) {
      bestDoorScore = score;
      doorAngle = ang;
    }
  }

  const doorW = 1.08;
  const doorHalfAng =
    doorAngle !== null ? Math.asin(Math.min(0.92, (doorW * 0.5 + 0.2) / Math.max(0.9, radius - 0.04))) : 0;
  const doorTopY = Math.min(2.15, stoneTopY - 0.35);
  const towerCutouts = [];

  if (doorAngle !== null) {
    const ca = Math.cos(doorAngle);
    const sa = Math.sin(doorAngle);
    const doorFac = {
      outX: ca,
      outZ: sa,
      tanX: -sa,
      tanZ: ca,
      halfOut: radius - 0.04,
    };
    buildArchedOakDoorAndStairs(c, doorFac, 0, doorW, doorTopY);
    towerCutouts.push({
      ang: doorAngle,
      halfAng: doorHalfAng,
      yBot: -0.08,
      yTop: doorTopY + 0.24,
      isDoor: true,
    });
  }

  // 3. Battered Circular Stone Foundation Plinth (reaches below minTerrainY!)
  const plinthTop = 0.09;
  const drop = plinthTop - localFoundBottom;
  const pRows = Math.max(2, Math.min(14, Math.ceil(drop / 0.36)));
  const dPY = drop / pRows;
  const pSegs = Math.max(12, Math.round((2 * Math.PI * radius) / 0.72));

  // Molded water-table stone ring at y = -0.06 .. +0.10 (clipped across door threshold)
  pushRadialStoneCourse(
    stoneGC,
    pSegs,
    -0.06,
    0.1,
    radius - 0.12,
    radius + 0.095,
    radius + 0.065,
    0,
    baseWallColor,
    rng,
    0.9,
    towerCutouts
  );

  for (let r = 0; r < pRows; r++) {
    const yTop = -0.05 - r * dPY;
    const yBot = yTop - dPY;
    const rOuterTop = radius + 0.08 + (r / pRows) * 0.22;
    const rOuterBot = radius + 0.08 + ((r + 1) / pRows) * 0.22;
    const ao = Math.max(0.62, 0.82 - r * 0.05);
    const rotOffset = (r & 1) ? Math.PI / pSegs : 0;

    for (let s = 0; s < pSegs; s++) {
      const a0 = (s / pSegs) * Math.PI * 2 + rotOffset;
      const a1 = ((s + 1) / pSegs) * Math.PI * 2 + rotOffset;
      const aMid = 0.5 * (a0 + a1);
      const { wx, wz } = localToWorldXZ(Math.cos(aMid) * rOuterBot, Math.sin(aMid) * rOuterBot);
      const localTerr = getTerrainHeight(wx, wz) - floorY;
      if (yTop < localTerr - 0.55) continue;

      const hex = makeRadialWedgeHex(a0, a1, yBot, yTop, radius - 0.16, rOuterBot, rOuterTop);
      stoneGC.pushBeveledStone(hex, jitterStoneColor(baseWallColor, rng, ao, 0.08));
    }
  }

  // Upper medieval lancet windows
  const tudorSides = 12;
  const winLevels = height >= 4.2 ? [height * 0.48, height * 0.78] : [height * 0.56];
  for (let lv = 0; lv < winLevels.length; lv++) {
    const wy = winLevels[lv];
    if (wy + 0.65 > height - 0.28) continue;
    const inTudorZone = hasTudorDrum && wy > stoneTopY;
    const rSurf = inTudorZone ? (upperRadius - 0.03) * Math.cos(Math.PI / tudorSides) : radius;
    const numWins = radius >= 2.6 ? 4 : 3;
    const usedPanels = new Set();

    for (let w = 0; w < numWins; w++) {
      let ang = (w / numWins) * Math.PI * 2 + lv * (Math.PI / numWins) + 0.4;
      if (inTudorZone) {
        const panelIdx = Math.round((ang / (Math.PI * 2)) * tudorSides - 0.5);
        const normPanel = ((panelIdx % tudorSides) + tudorSides) % tudorSides;
        if (usedPanels.has(normPanel)) continue;
        usedPanels.add(normPanel);
        ang = ((normPanel + 0.5) / tudorSides) * Math.PI * 2;
      }

      if (doorAngle !== null && wy < doorTopY + 0.75) {
        const diffDoor = Math.abs(Math.atan2(Math.sin(ang - doorAngle), Math.cos(ang - doorAngle)));
        if (diffDoor < doorHalfAng + 0.45) continue;
      }
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const { wx, wz } = localToWorldXZ(ca * (rSurf + 0.5), sa * (rSurf + 0.5));
      if (isPointBuriedInNeighbor(wx, floorY + wy, wz, 0.35)) continue;

      const winW = 0.68;
      const winH = 1.06;
      if (!inTudorZone) {
        towerCutouts.push({
          ang,
          halfAng: Math.asin(Math.min(0.88, (winW * 0.5 + 0.022) / Math.max(0.9, radius - 0.04))),
          yBot: wy - winH * 0.5 - 0.11,
          yTop: wy + winH * 0.5 + 0.16,
          isDoor: false,
        });
      }

      const fac = { outX: ca, outZ: sa, tanX: -sa, tanZ: ca, halfOut: rSurf };
      const winOutSurf = inTudorZone ? rSurf : radius + 0.008;
      buildFramedWindow(c, fac, 0, wy, winOutSurf, winW, winH, {
        shutters: false,
        flowerbox: false,
        tudorFrame: inTudorZone,
      });
    }
  }

  // 4. Staggered Radial 3D Beveled Stone Courses up to stoneTopY (exact jamb/sill/lintel clipping!)
  const courseH = 0.32;
  const numCourses = Math.max(4, Math.round((stoneTopY - 0.09) / courseH));
  const dCY = (stoneTopY - 0.09) / numCourses;
  const stonesPerRing = Math.max(12, Math.round((2 * Math.PI * radius) / 0.66));
  const dAng = (Math.PI * 2) / stonesPerRing;

  for (let row = 0; row < numCourses; row++) {
    const y0 = 0.09 + row * dCY;
    const y1 = y0 + dCY;
    const ao = 0.84 + 0.16 * Math.min(1, (row * dCY) / 1.1);
    const offAng = (row & 1) ? dAng * 0.5 : 0;

    for (let s = 0; s < stonesPerRing; s++) {
      const a0 = s * dAng + offAng;
      const a1 = a0 + dAng;
      const aMid = 0.5 * (a0 + a1);

      const clippedSpans = clipRadialInterval(a0, a1, y0, y1, towerCutouts);
      for (let m = 0; m < clippedSpans.length; m++) {
        const [sa0, sa1] = clippedSpans[m];
        if ((sa1 - sa0) * radius < 0.07) continue;
        const proudR = radius + 0.018 + (rng() - 0.5) * 0.016;
        const hex = makeRadialWedgeHex(sa0, sa1, y0, y1, radius - 0.14, proudR, proudR);
        stoneGC.pushBeveledStone(hex, jitterStoneColor(baseWallColor, rng, ao, 0.085), {
          bevelXZ: 0.08,
          bevelY: 0.14,
        });
      }

      // Emit tight sub-sill and supra-lintel/supra-arch dressed stone fillers where courses straddle openings
      for (let k = 0; k < towerCutouts.length; k++) {
        const cut = towerCutouts[k];
        if (y1 <= cut.yBot || y0 >= cut.yTop) continue;
        const cMid = aMid + Math.atan2(Math.sin(cut.ang - aMid), Math.cos(cut.ang - aMid));
        const ia0 = Math.max(a0, cMid - cut.halfAng);
        const ia1 = Math.min(a1, cMid + cut.halfAng);
        if ((ia1 - ia0) * radius < 0.07) continue;

        if (!cut.isDoor && y0 < cut.yBot - 0.025 && y1 > cut.yBot) {
          const proudSub = radius + 0.016 + (rng() - 0.5) * 0.012;
          stoneGC.pushBeveledStone(
            makeRadialWedgeHex(ia0, ia1, y0, cut.yBot + 0.015, radius - 0.14, proudSub, proudSub),
            jitterStoneColor(baseWallColor, rng, ao, 0.075),
            { bevelXZ: 0.07, bevelY: 0.12 }
          );
        }
        if (y1 > cut.yTop + 0.025 && y0 < cut.yTop) {
          const proudSup = radius + 0.016 + (rng() - 0.5) * 0.012;
          stoneGC.pushBeveledStone(
            makeRadialWedgeHex(ia0, ia1, cut.yTop - 0.015, y1, radius - 0.14, proudSup, proudSup),
            jitterStoneColor(baseWallColor, rng, ao, 0.075),
            { bevelXZ: 0.07, bevelY: 0.12 }
          );
        }
      }
    }
  }

  // Mid-height stone stringcourse ring on tall towers (cleanly split around windows & door!)
  if (stoneTopY >= 3.4) {
    const bandY = stoneTopY * 0.54;
    pushRadialStoneCourse(
      stoneGC,
      stonesPerRing,
      bandY - 0.07,
      bandY + 0.07,
      radius - 0.1,
      radius + 0.065,
      radius + 0.065,
      0.12,
      baseWallColor,
      rng,
      1.02,
      towerCutouts,
      0.08,
      0.045 / Math.max(1.0, radius),
      0.045
    );
  }

  // 5. Optional Tudor Polygonal Jettying Turret Drum
  if (hasTudorDrum) {
    const sides = 12;
    const upperH = height - stoneTopY;
    for (let i = 0; i < sides; i++) {
      const ang = (i / sides) * Math.PI * 2;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const outAx = new THREE.Vector3(ca, 0, sa);
      const tanAx = new THREE.Vector3(-sa, 0, ca);
      const upAx = new THREE.Vector3(0, 1, 0);

      // Radial oak jetty corbel bracket
      timberGC.pushOrientedBox(
        new THREE.Vector3(ca * (radius + 0.11), stoneTopY - 0.14, sa * (radius + 0.11)),
        tanAx,
        upAx,
        outAx,
        0.06,
        0.14,
        0.16,
        [0.92, 0.89, 0.85]
      );
      // Vertical corner post
      timberGC.pushOrientedBox(
        new THREE.Vector3(ca * upperRadius, stoneTopY + upperH * 0.5, sa * upperRadius),
        tanAx,
        upAx,
        outAx,
        0.055,
        upperH * 0.5,
        0.05,
        [0.95, 0.92, 0.88]
      );

      // Top & bottom ring beams
      const nextAng = ((i + 1) / sides) * Math.PI * 2;
      const midAng = 0.5 * (ang + nextAng);
      const chordLen = 2 * upperRadius * Math.sin(Math.PI / sides);
      const mCa = Math.cos(midAng);
      const mSa = Math.sin(midAng);
      const mOut = new THREE.Vector3(mCa, 0, mSa);
      const mTan = new THREE.Vector3(-mSa, 0, mCa);
      for (const ry of [stoneTopY + 0.06, height - 0.06]) {
        timberGC.pushOrientedBox(
          new THREE.Vector3(mCa * (upperRadius - 0.02), ry, mSa * (upperRadius - 0.02)),
          mTan,
          upAx,
          mOut,
          chordLen * 0.52,
          0.06,
          0.05,
          [0.95, 0.92, 0.88]
        );
      }
    }
  }

  // 6. Tower Top: Crenellated Stone Battlements (+ Watch Turret) OR Sweeping Conical Witch-Hat Roof!
  if (crenellated) {
    buildTowerBattlementsAndWatchTurret(c, upperRadius, height, roofHeight, roofCurve);
  } else {
    buildConicalShingleRoof(c, upperRadius + 0.42, height, roofHeight, roofCurve, true);
  }

  // Suppress unused warning if windowGC unused on tiny solid towers
  void windowGC;
  void baseRoofColor;
  void shingleInstances;
}

function makeRadialWedgeHex(a0, a1, y0, y1, rIn, rOutBot, rOutTop) {
  const c0 = Math.cos(a0);
  const s0 = Math.sin(a0);
  const c1 = Math.cos(a1);
  const s1 = Math.sin(a1);

  return [
    new THREE.Vector3(c0 * rIn, y0, s0 * rIn),
    new THREE.Vector3(c1 * rIn, y0, s1 * rIn),
    new THREE.Vector3(c1 * rOutBot, y0, s1 * rOutBot),
    new THREE.Vector3(c0 * rOutBot, y0, s0 * rOutBot),
    new THREE.Vector3(c0 * rIn, y1, s0 * rIn),
    new THREE.Vector3(c1 * rIn, y1, s1 * rIn),
    new THREE.Vector3(c1 * rOutTop, y1, s1 * rOutTop),
    new THREE.Vector3(c0 * rOutTop, y1, s0 * rOutTop),
  ];
}

function clipRadialInterval(a0, a1, y0, y1, cutouts, extraAngPad = 0, extraYPad = 0) {
  if (!cutouts || cutouts.length === 0) return [[a0, a1]];
  let spans = [[a0, a1]];
  const aMid = 0.5 * (a0 + a1);

  for (let k = 0; k < cutouts.length; k++) {
    const cut = cutouts[k];
    if (y1 <= cut.yBot - extraYPad || y0 >= cut.yTop + extraYPad) continue;
    const cMid = aMid + Math.atan2(Math.sin(cut.ang - aMid), Math.cos(cut.ang - aMid));
    const hA = cut.halfAng + extraAngPad;
    const c0 = cMid - hA;
    const c1 = cMid + hA;

    const nextSpans = [];
    for (let i = 0; i < spans.length; i++) {
      const [s0, s1] = spans[i];
      if (c1 <= s0 || c0 >= s1) {
        nextSpans.push([s0, s1]);
      } else {
        if (c0 > s0) nextSpans.push([s0, c0]);
        if (c1 < s1) nextSpans.push([c1, s1]);
      }
    }
    spans = nextSpans;
    if (spans.length === 0) break;
  }
  return spans;
}

function pushRadialStoneCourse(
  stoneGC,
  segs,
  y0,
  y1,
  rIn,
  rOutBot,
  rOutTop,
  angOffset,
  baseColor,
  rng,
  ao,
  cutouts = null,
  minArcLen = 0.07,
  extraAngPad = 0,
  extraYPad = 0
) {
  const dA = (Math.PI * 2) / segs;
  const refR = Math.max(0.5, rOutTop);
  for (let i = 0; i < segs; i++) {
    const a0 = i * dA + angOffset;
    const a1 = a0 + dA;
    const spans = clipRadialInterval(a0, a1, y0, y1, cutouts, extraAngPad, extraYPad);
    for (let m = 0; m < spans.length; m++) {
      const [sa0, sa1] = spans[m];
      if ((sa1 - sa0) * refR < minArcLen) continue;
      stoneGC.pushBeveledStone(
        makeRadialWedgeHex(sa0, sa1, y0, y1, rIn, rOutBot, rOutTop),
        jitterStoneColor(baseColor, rng, ao, 0.065)
      );
    }
  }
}

function buildTowerBattlementsAndWatchTurret(c, baseR, eaveY, roofHeight, roofCurve) {
  const { stoneGC, baseWallColor, rng } = c;
  const parR = baseR + 0.16;
  const corbels = Math.max(12, Math.round((2 * Math.PI * baseR) / 0.65));

  // Projecting stone corbel machicolations
  for (let i = 0; i < corbels; i++) {
    const aMid = (i / corbels) * Math.PI * 2;
    const halfCorbelA = 0.13 / baseR;
    stoneGC.pushBeveledStone(
      makeRadialWedgeHex(aMid - halfCorbelA, aMid + halfCorbelA, eaveY - 0.26, eaveY - 0.04, baseR - 0.08, baseR + 0.04, parR),
      jitterStoneColor(baseWallColor, rng, 0.92, 0.05)
    );
  }

  // Walkway ring & paved roof deck
  pushRadialStoneCourse(stoneGC, corbels, eaveY - 0.06, eaveY + 0.08, baseR - 0.22, parR + 0.02, parR + 0.02, 0, baseWallColor, rng, 0.98);
  stoneGC.pushCylinder(
    new THREE.Vector3(0, eaveY - 0.08, 0),
    new THREE.Vector3(0, eaveY + 0.04, 0),
    baseR,
    baseR,
    18,
    jitterStoneColor(baseWallColor, rng, 0.86, 0.04)
  );

  // Circular Merlons & Crenels
  const numMerlons = Math.max(8, Math.round((2 * Math.PI * parR) / 1.18));
  const dPitch = (Math.PI * 2) / numMerlons;
  const merlonAng = dPitch * 0.6;
  const merlonH = 0.56;

  for (let m = 0; m < numMerlons; m++) {
    const a0 = m * dPitch;
    const a1 = a0 + merlonAng;
    stoneGC.pushBeveledStone(
      makeRadialWedgeHex(a0, a1, eaveY + 0.07, eaveY + 0.07 + merlonH, parR - 0.34, parR, parR),
      jitterStoneColor(baseWallColor, rng, 1.0, 0.07)
    );
    // Merlon cap slab
    stoneGC.pushBeveledStone(
      makeRadialWedgeHex(a0 - 0.015, a1 + 0.015, eaveY + 0.07 + merlonH, eaveY + 0.17 + merlonH, parR - 0.37, parR + 0.04, parR + 0.02),
      jitterStoneColor(baseWallColor, rng, 1.05, 0.05)
    );
  }

  // Charming Central Watch Turret inside the battlements (when roofHeight >= 0.95)
  if (roofHeight >= 0.95) {
    const turretR = baseR * 0.54;
    const drumH = Math.min(1.05, roofHeight * 0.32);
    stoneGC.pushCylinder(
      new THREE.Vector3(0, eaveY, 0),
      new THREE.Vector3(0, eaveY + drumH, 0),
      turretR - 0.04,
      turretR - 0.04,
      14,
      jitterStoneColor(baseWallColor, rng, 0.75, 0.03)
    );
    const tSegs = Math.max(10, Math.round((2 * Math.PI * turretR) / 0.58));
    pushRadialStoneCourse(stoneGC, tSegs, eaveY + 0.03, eaveY + drumH * 0.5, turretR - 0.12, turretR, turretR, 0, baseWallColor, rng, 0.95);
    pushRadialStoneCourse(stoneGC, tSegs, eaveY + drumH * 0.5, eaveY + drumH, turretR - 0.12, turretR, turretR, Math.PI / tSegs, baseWallColor, rng, 0.98);

    buildConicalShingleRoof(c, turretR + 0.28, eaveY + drumH, roofHeight * 0.78, roofCurve, false);
  }
}

function buildConicalShingleRoof(c, eaveRadius, baseLocalY, coneH, roofCurve, includeLucarne) {
  const { timberGC, shingleInstances, baseRoofColor, rng, localToWorldXZ, isPointBuriedInNeighbor, floorY } = c;

  // 1. Radial Exposed Timber Eave Rafters & Solid Sub-Cone
  const rafters = Math.max(12, Math.round((2 * Math.PI * eaveRadius) / 0.65));
  const eavePitch = evalRoofSlopeAngle(0.08, roofCurve, eaveRadius, coneH);
  for (let i = 0; i < rafters; i++) {
    const ang = (i / rafters) * Math.PI * 2;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const tanAx = new THREE.Vector3(-sa, 0, ca);
    const slopeDir = new THREE.Vector3(ca * Math.cos(eavePitch), -Math.sin(eavePitch), sa * Math.cos(eavePitch)).normalize();
    const upDir = new THREE.Vector3().crossVectors(slopeDir, tanAx).normalize();
    if (upDir.y < 0) upDir.negate();
    const midR = eaveRadius - 0.24;
    timberGC.pushOrientedBox(
      new THREE.Vector3(ca * midR, baseLocalY - 0.04, sa * midR),
      tanAx,
      upDir,
      slopeDir,
      0.036,
      0.048,
      0.28,
      [0.88, 0.84, 0.8]
    );
  }

  // Multi-ring curved sub-cone backing so zero sky light ever leaks between radial shingles
  const coneRings = 8;
  for (let r = 0; r < coneRings; r++) {
    const t0 = r / coneRings;
    const t1 = (r + 1) / coneRings;
    const r0 = Math.max(0.02, eaveRadius * (1 - t0) - 0.05);
    const r1 = Math.max(0.01, eaveRadius * (1 - t1) - 0.04);
    const y0 = baseLocalY - 0.1 + evalRoofProfile(t0, roofCurve) * (coneH + 0.1) - 0.03;
    const y1 = baseLocalY - 0.1 + evalRoofProfile(t1, roofCurve) * (coneH + 0.1) - 0.03;
    timberGC.pushCylinder(
      new THREE.Vector3(0, y0, 0),
      new THREE.Vector3(0, y1, 0),
      r0,
      r1,
      18,
      [0.72, 0.68, 0.64],
      r === 0
    );
  }

  // 2. Radially Fanned Conical Courses of 3D Shingles (InstancedMesh!)
  const slopeLen = Math.hypot(eaveRadius, coneH + 0.1);
  const numRows = Math.max(6, Math.round(slopeLen / 0.28));
  const tileLen = (slopeLen / numRows) * 1.26;
  const nominalW = 0.34;

  for (let row = 0; row < numRows; row++) {
    const tTop = Math.min(0.97, (row + 1) / numRows);
    const tMid = (row + 0.5) / numRows;
    const rTop = Math.max(0.06, eaveRadius * (1 - tTop));
    const rMid = Math.max(0.12, eaveRadius * (1 - tMid));
    const yTop = baseLocalY - 0.1 + evalRoofProfile(tTop, roofCurve) * (coneH + 0.1);
    const pitch = evalRoofSlopeAngle(tMid, roofCurve, eaveRadius, coneH + 0.1);
    const circum = 2 * Math.PI * rMid;
    const tilesInRing = Math.max(6, Math.round(circum / nominalW));
    const dAng = (Math.PI * 2) / tilesInRing;
    const angOff = (row & 1) ? dAng * 0.5 : 0;
    const tileW = (2 * Math.PI * ((rTop + rMid) * 0.55)) / tilesInRing;
    const rowShade = 0.91 + 0.13 * (row / numRows);

    for (let k = 0; k < tilesInRing; k++) {
      const ang = k * dAng + angOff;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      // In Three.js YXZ Euler, yaw = atan2(ca, sa) aligns local +Z outward along (ca, 0, sa)!
      const yaw = Math.atan2(ca, sa);

      pushShingleInstance(
        shingleInstances,
        new THREE.Vector3(ca * rTop, yTop + 0.02, sa * rTop),
        {
          x: pitch + (rng() - 0.5) * 0.03,
          y: yaw + (rng() - 0.5) * 0.02,
          z: (rng() - 0.5) * 0.02,
        },
        {
          x: Math.max(0.1, tileW * 1.06),
          y: 0.046,
          z: tileLen,
        },
        baseRoofColor,
        rng,
        rowShade
      );
    }
  }

  // 3. Turned-Timber & Wrought-Iron Spire Finial at Apex!
  const apexY = baseLocalY + coneH;
  timberGC.pushCylinder(
    new THREE.Vector3(0, apexY - 0.18, 0),
    new THREE.Vector3(0, apexY + 0.25, 0),
    0.13,
    0.05,
    8,
    [0.35, 0.34, 0.36]
  );
  timberGC.pushCylinder(
    new THREE.Vector3(0, apexY + 0.24, 0),
    new THREE.Vector3(0, apexY + 0.78, 0),
    0.042,
    0.012,
    6,
    [0.28, 0.28, 0.3]
  );
  // Decorative finial sphere/orb
  timberGC.pushCylinder(
    new THREE.Vector3(0, apexY + 0.42, 0),
    new THREE.Vector3(0, apexY + 0.56, 0),
    0.075,
    0.075,
    8,
    [0.88, 0.74, 0.42]
  );

  // 4. Cute Gabled Lucarne Dormer peeking out of conical tower roof
  if (includeLucarne && coneH >= 2.1 && eaveRadius >= 2.2) {
    const { wx, wz } = localToWorldXZ(0, eaveRadius + 0.5);
    if (!isPointBuriedInNeighbor(wx, floorY + baseLocalY + 0.8, wz, 0.4)) {
      buildRoofDormer(c, 0, 1, eaveRadius, baseLocalY, coneH, roofCurve);
    }
  }
}
