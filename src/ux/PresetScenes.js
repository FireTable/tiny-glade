/**
 * PresetScenes.js
 * Curated Tiny Glade showcase dioramas demonstrating reactive stone archways,
 * automatic water bridges, multi-wing compound castles/cottages, and lush foliage.
 */

export const PRESET_SCENES = [
  { id: 'lakeside-keep', label: 'Lakeside Keep (Default)' },
  { id: 'cotswold-hamlet', label: 'Cotswold Brook Hamlet' },
  { id: 'moonlit-abbey', label: 'Starlit Castle Ruins' },
  { id: 'empty-meadow', label: 'Fresh Meadow' },
];

function sculptHill(world, x, z, radius, targetHeight) {
  if (!world?.sculpt || !world?.getHeightAt) return;
  for (let i = 0; i < 28; i++) {
    const h = world.getHeightAt(x, z);
    if (h >= targetHeight) break;
    world.sculpt(x, z, radius, 1.85, 'raise', 0.12);
  }
  world.sculpt(x, z, radius * 1.15, 0.85, 'smooth', 0.1);
}

function sculptBasin(world, x, z, radius, targetDepthY = -1.48) {
  if (!world?.sculpt || !world?.getHeightAt) return;
  for (let i = 0; i < 22; i++) {
    const h = world.getHeightAt(x, z);
    if (h <= targetDepthY) break;
    world.sculpt(x, z, radius, 1.9, 'pond', 0.14);
  }
  // Fallback in case 'pond' mode clamps above targetDepthY
  for (let i = 0; i < 14; i++) {
    const h = world.getHeightAt(x, z);
    if (h <= targetDepthY) break;
    world.sculpt(x, z, radius * 0.88, 1.8, 'lower', 0.12);
  }
}

/**
 * Carves a continuous, dam-free water channel or crescent pond along Catmull-Rom knots
 * ({ x, z, r, d }) using tightly overlapping stamps every `stepMeters`.
 */
function carveSplineWaterway(world, knots, stepMeters = 1.35) {
  if (!Array.isArray(knots) || knots.length === 0) return;
  if (knots.length === 1) {
    sculptBasin(world, knots[0].x, knots[0].z, knots[0].r, knots[0].d);
    return;
  }

  const catmull = (v0, v1, v2, v3, t) => {
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      0.5 *
      (2 * v1 +
        (-v0 + v2) * t +
        (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 +
        (-v0 + 3 * v1 - 3 * v2 + v3) * t3)
    );
  };

  for (let i = 0; i < knots.length - 1; i++) {
    const p0 = knots[Math.max(0, i - 1)];
    const p1 = knots[i];
    const p2 = knots[i + 1];
    const p3 = knots[Math.min(knots.length - 1, i + 2)];

    const segDist = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const steps = Math.max(2, Math.ceil(segDist / stepMeters));
    const endStep = i === knots.length - 2 ? steps : steps - 1;

    for (let s = 0; s <= endStep; s++) {
      const t = s / steps;
      const x = catmull(p0.x, p1.x, p2.x, p3.x, t);
      const z = catmull(p0.z, p1.z, p2.z, p3.z, t);
      const r = p1.r + (p2.r - p1.r) * t;
      const d = p1.d + (p2.d - p1.d) * t;
      sculptBasin(world, x, z, r, d);
    }
  }
}

function ensureDryBank(world, x, z, radius, minHeight = 0.35) {
  if (!world?.sculpt || !world?.getHeightAt) return;
  for (let i = 0; i < 18; i++) {
    const h = world.getHeightAt(x, z);
    if (h >= minHeight) break;
    world.sculpt(x, z, radius, 1.5, 'raise', 0.1);
  }
  world.sculpt(x, z, radius, 0.7, 'smooth', 0.08);
}

function placeGroundClutter(world, arch, type, x, z, rotation = 0, yOffset = 0, extra = {}) {
  if (!arch?.addClutter) return null;
  const groundY = world?.getHeightAt ? world.getHeightAt(x, z) : 0;
  const y = groundY + yOffset;
  return arch.addClutter({
    type,
    subtype: type,
    clutterType: type,
    x,
    y,
    z,
    position: { x, y, z },
    normal: { x: 0, y: 1, z: 0 },
    rotation,
    hostId: null,
    hostType: 'terrain',
    surface: 'ground',
    ...extra,
  });
}

function placeRoofClutter(
  world,
  arch,
  type,
  x,
  z,
  baseHeight,
  roofHeight,
  roofFraction = 1.0,
  rotation = 0,
  hostId = null
) {
  if (!arch?.addClutter) return null;
  const groundY = world?.getHeightAt ? world.getHeightAt(x, z) : 0;
  const y = groundY + baseHeight + roofHeight * roofFraction;
  return arch.addClutter({
    type,
    subtype: type,
    clutterType: type,
    x,
    y,
    z,
    position: { x, y, z },
    normal: { x: 0, y: 1, z: 0 },
    rotation,
    hostId,
    hostType: 'building',
    surface: 'roof',
  });
}

function finalizeScene({ world, arch, pipeline }, envConfig) {
  if (world?.getPaths && arch?.setPaths) {
    arch.setPaths(world.getPaths());
  }
  if (arch?.onTerrainChanged) {
    arch.onTerrainChanged(null);
  }
  if (world?.syncFootprints && arch?.getFootprints) {
    world.syncFootprints(arch.getFootprints());
  }
  if (pipeline?.water?.updateTerrainTexture && world?.getHeightDataTexture) {
    pipeline.water.updateTerrainTexture(world.getHeightDataTexture(), 120);
  }
  if (envConfig.season && world?.setSeason) {
    world.setSeason(envConfig.season);
  }
  if (pipeline?.setWeather) {
    pipeline.setWeather({
      season: envConfig.season ?? 'summer',
      cloudiness: envConfig.cloudiness ?? 0.28,
      mist: envConfig.mist ?? 0.32,
      windStrength: envConfig.windStrength ?? 0.42,
    });
  }
  if (typeof envConfig.timeOfDay === 'number' && pipeline?.setTimeOfDay) {
    pipeline.setTimeOfDay(envConfig.timeOfDay);
  }
  if (pipeline?.syncPointLights && arch?.getLanternPositions) {
    pipeline.syncPointLights(arch.getLanternPositions());
  }
}

function buildLakesideKeep({ world, arch, pipeline }) {
  // 1. Gentle rolling backdrop hills & elevated manor knoll
  sculptHill(world, -22, -25, 16, 4.3);
  sculptHill(world, -5, -28, 18, 4.9);
  sculptHill(world, 15, -24, 16, 3.8);
  sculptHill(world, -26, -6, 14, 2.9);
  sculptHill(world, 24, -8, 14, 2.6);

  // Sunlit manor plateau
  sculptHill(world, -2.5, -4.8, 13.5, 1.35);
  sculptHill(world, 3.5, -3.5, 10.5, 1.15);
  world.sculpt?.(0, -1, 14, 0.9, 'smooth', 0.14);

  // Ensure crisp dry bridge abutments & dry courtyard wall footing BEFORE carving pond
  ensureDryBank(world, 1.2, 5.6, 4.2, 0.62);
  ensureDryBank(world, 1.4, 8.4, 3.4, 0.34);
  ensureDryBank(world, 1.7, 21.4, 5.2, 0.48);
  sculptHill(world, 8.5, 25.5, 11.0, 1.1);

  // 2. Smooth continuous curved emerald moat / pond sweeping across the foreground glade
  const pondArc = [
    { x: -13.2, z: 11.2, r: 4.5, d: -1.34 },
    { x: -8.4, z: 13.2, r: 4.9, d: -1.48 },
    { x: -3.4, z: 14.3, r: 5.1, d: -1.56 },
    { x: 1.5, z: 14.5, r: 5.1, d: -1.60 },
    { x: 6.6, z: 13.7, r: 5.0, d: -1.52 },
    { x: 11.4, z: 11.8, r: 4.7, d: -1.40 },
    { x: 14.8, z: 8.8, r: 4.3, d: -1.24 },
  ];
  carveSplineWaterway(world, pondArc, 1.5);

  pipeline?.water?.updateTerrainTexture?.(world.getHeightDataTexture(), 120);

  // 3. Multi-wing manor + cylindrical castle keep + crenellated watch turret
  arch.addBuilding({
    type: 'cottage',
    x: -1.8,
    z: -4.2,
    width: 7.4,
    depth: 5.2,
    height: 4.1,
    roofHeight: 3.3,
    roofCurve: 0.28,
    rotation: 0.08,
    roofColor: 'terracotta',
    wallStyle: 'cotswold',
    tudor: true,
    crenellated: false,
    seed: 101,
  });

  // Overlapping east manor wing (L-plan)
  arch.addBuilding({
    type: 'cottage',
    x: 3.0,
    z: -2.5,
    width: 5.2,
    depth: 4.4,
    height: 3.5,
    roofHeight: 2.8,
    roofCurve: 0.32,
    rotation: -1.48,
    roofColor: 'terracotta',
    wallStyle: 'cotswold',
    tudor: false,
    crenellated: false,
    seed: 202,
  });

  // Tall cylindrical stone castle tower with flared slate witch-hat roof
  arch.addBuilding({
    type: 'tower',
    x: -6.2,
    z: -5.8,
    radius: 3.05,
    height: 7.8,
    roofHeight: 4.6,
    roofCurve: 0.44,
    rotation: 0.3,
    roofColor: 'slate',
    wallStyle: 'limestone',
    crenellated: false,
    seed: 303,
  });

  // Crenellated stone watch turret guarding courtyard corner
  arch.addBuilding({
    type: 'tower',
    x: 6.2,
    z: -5.2,
    radius: 2.25,
    height: 5.6,
    roofHeight: 2.1,
    roofCurve: 0.22,
    rotation: -0.4,
    roofColor: 'slate',
    wallStyle: 'cotswold',
    crenellated: true,
    seed: 404,
  });

  // Western dovecote gatehouse tower
  arch.addBuilding({
    type: 'tower',
    x: -8.6,
    z: 1.8,
    radius: 1.95,
    height: 4.4,
    roofHeight: 2.8,
    roofCurve: 0.36,
    rotation: 0.7,
    roofColor: 'terracotta',
    wallStyle: 'cotswold',
    crenellated: false,
    seed: 505,
  });

  // 4. Curved Cotswold stone courtyard wall & crenellated keep curtain wall
  arch.addWall(
    [
      { x: -7.2, z: 2.7 },
      { x: -5.0, z: 4.8 },
      { x: -1.6, z: 5.55 },
      { x: 3.6, z: 5.55 },
      { x: 6.4, z: 4.2 },
      { x: 8.0, z: 1.2 },
      { x: 7.2, z: -3.0 },
    ],
    {
      type: 'wall',
      height: 2.75,
      wallStyle: 'cotswold',
      style: 'cotswold',
      crenellated: false,
    }
  );

  arch.addWall(
    [
      { x: -8.2, z: -5.2 },
      { x: -10.3, z: -2.8 },
      { x: -9.6, z: 0.3 },
    ],
    {
      type: 'wall',
      height: 3.05,
      wallStyle: 'limestone',
      style: 'limestone',
      crenellated: true,
    }
  );

  // Rustic wooden orchard fence along eastern meadow
  arch.addWall(
    [
      { x: 10.5, z: -1.5 },
      { x: 13.8, z: 0.5 },
      { x: 15.6, z: 3.8 },
    ],
    {
      type: 'fence',
      height: 1.15,
      wallStyle: 'timber',
      style: 'timber',
      crenellated: false,
    }
  );

  // 5. Winding cobblestone path crossing BOTH the courtyard stone wall (auto-archway!)
  //    AND the curved emerald pond (auto-bridge!)
  world.addPath(
    [
      { x: -0.4, z: -0.6 },
      { x: 0.6, z: 2.5 },
      { x: 1.25, z: 5.6 }, // Clean ~90-deg intersection through Cotswold stone wall -> Voussoir Archway!
      { x: 1.4, z: 8.8 },
      { x: 1.48, z: 11.8 },
      { x: 1.5, z: 14.5 }, // Spans deep emerald pond -> Arched Cobblestone Bridge!
      { x: 1.55, z: 17.6 },
      { x: 1.7, z: 20.8 },
      { x: 3.4, z: 24.6 },
      { x: 6.4, z: 28.2 },
    ],
    { width: 2.4, style: 'cobble' }
  );

  // Gentle country dirt path branching along the sunny south meadow
  world.addPath(
    [
      { x: 1.7, z: 20.8 },
      { x: -2.6, z: 21.4 },
      { x: -7.4, z: 20.4 },
      { x: -12.0, z: 18.2 },
    ],
    { width: 1.85, style: 'dirt' }
  );

  // Sync paths immediately so archways & water bridges generate before clutter/footprints
  arch.setPaths(world.getPaths());
  world.syncFootprints(arch.getFootprints());

  // 6. Tower pennant flags, extra wing chimney, warm wrought-iron lanterns & garden bench
  placeRoofClutter(world, arch, 'flag', -6.2, -5.8, 7.8, 4.6, 1.02, 0.25);
  placeRoofClutter(world, arch, 'flag', 6.2, -5.2, 5.6, 2.1, 1.02, 0.4);
  placeRoofClutter(world, arch, 'chimney', 3.2, -2.8, 3.5, 2.8, 0.68, -1.48);

  placeGroundClutter(world, arch, 'lantern', -0.2, 6.25, 0.1, 0);
  placeGroundClutter(world, arch, 'lantern', 2.75, 6.15, -0.2, 0);
  placeGroundClutter(world, arch, 'lantern', 0.0, 9.5, 0.0, 0);
  placeGroundClutter(world, arch, 'lantern', 2.95, 19.8, 3.1, 0);
  placeGroundClutter(world, arch, 'lantern', -0.2, -1.3, 0.08, 0);
  placeGroundClutter(world, arch, 'lantern', -7.2, 3.3, 0.6, 0);

  placeGroundClutter(world, arch, 'bench', -3.6, 8.6, 0.28, 0);
  placeGroundClutter(world, arch, 'flowerbox', 1.8, -0.4, -1.48, 0);

  // 7. Flanking groves of fluffy trees & meadow wildflowers (framing vista without blocking center)
  const treeGroves = [
    { x: -16, z: -13, r: 8.5, c: 9 },
    { x: -7, z: -18, r: 9.0, c: 10 },
    { x: 11, z: -14, r: 8.5, c: 9 },
    { x: 19, z: -3, r: 7.5, c: 7 },
    { x: -19, z: 5, r: 7.5, c: 7 },
    { x: -17, z: 20, r: 7.0, c: 5 },
    { x: 23, z: 15, r: 7.0, c: 5 },
  ];
  for (const g of treeGroves) {
    world.paintTrees?.(g.x, g.z, g.r, g.c);
  }

  const flowerPatches = [
    { x: -6.5, z: 8.5, r: 4.5, d: 0.85 },
    { x: 6.8, z: 7.8, r: 4.5, d: 0.85 },
    { x: -5.5, z: 23.0, r: 6.5, d: 0.9 },
    { x: 9.5, z: 22.5, r: 6.5, d: 0.9 },
    { x: 13.5, z: 3.0, r: 5.0, d: 0.8 },
    { x: -14.0, z: -2.0, r: 5.5, d: 0.75 },
  ];
  for (const f of flowerPatches) {
    world.paintFlowers?.(f.x, f.z, f.r, f.d);
  }

  const envConfig = {
    timeOfDay: 16.7, // Warm Golden Hour
    season: 'summer',
    cloudiness: 0.26,
    mist: 0.34,
    windStrength: 0.45,
  };
  finalizeScene({ world, arch, pipeline }, envConfig);

  return {
    id: 'lakeside-keep',
    label: 'Lakeside Keep (Default)',
    ...envConfig,
    cameraTarget: { x: 0.0, y: 1.8, z: 3.5 },
  };
}

function buildCotswoldHamlet({ world, arch, pipeline }) {
  // Rolling Cotswold valley banks on either side of a meandering central brook
  sculptHill(world, -22, -14, 15, 3.2);
  sculptHill(world, 22, -16, 16, 3.5);
  sculptHill(world, -14, 6, 12, 1.3);
  sculptHill(world, 13, -3, 12, 1.35);

  // Shape dry banks BEFORE carving the brook so no land dams interrupt the stream
  ensureDryBank(world, -9.2, -0.8, 3.2, 0.46);
  ensureDryBank(world, 1.4, -6.4, 3.2, 0.48);
  ensureDryBank(world, -2.2, 10.4, 3.2, 0.46);
  ensureDryBank(world, 9.0, 3.8, 3.2, 0.48);

  // Continuous meandering S-curve brook through center (tightly overlapped stamps -> zero dams)
  const brookKnots = [
    { x: -26.0, z: -27.5, r: 4.0, d: -1.36 },
    { x: -19.5, z: -21.2, r: 4.1, d: -1.42 },
    { x: -13.5, z: -15.0, r: 4.1, d: -1.46 },
    { x: -8.6, z: -9.4, r: 4.2, d: -1.50 },
    { x: -4.4, z: -4.0, r: 4.2, d: -1.55 }, // Bridge #1 crossing
    { x: -1.2, z: 0.6, r: 4.3, d: -1.56 },
    { x: 1.4, z: 4.1, r: 4.3, d: -1.56 },
    { x: 3.6, z: 7.0, r: 4.2, d: -1.55 },   // Bridge #2 crossing
    { x: 7.8, z: 12.2, r: 4.2, d: -1.50 },
    { x: 13.4, z: 18.2, r: 4.3, d: -1.45 },
    { x: 19.8, z: 24.2, r: 4.4, d: -1.40 },
    { x: 26.5, z: 29.8, r: 4.5, d: -1.36 },
  ];
  carveSplineWaterway(world, brookKnots, 1.25);

  pipeline?.water?.updateTerrainTexture?.(world.getHeightDataTexture(), 120);

  // West bank: Honey-stone Tudor cottage + cozy bakehouse wing
  arch.addBuilding({
    type: 'cottage',
    x: -11.8,
    z: 3.6,
    width: 6.4,
    depth: 4.8,
    height: 3.7,
    roofHeight: 3.1,
    roofCurve: 0.30,
    rotation: 0.52,
    roofColor: 'terracotta',
    wallStyle: 'cotswold',
    tudor: true,
    seed: 611,
  });

  arch.addBuilding({
    type: 'cottage',
    x: -14.8,
    z: 6.8,
    width: 4.5,
    depth: 4.0,
    height: 3.1,
    roofHeight: 2.5,
    roofCurve: 0.35,
    rotation: -1.02,
    roofColor: 'ochre',
    wallStyle: 'cotswold',
    tudor: false,
    seed: 612,
  });

  // East bank: Half-timbered miller's cottage + round stone granary tower
  arch.addBuilding({
    type: 'cottage',
    x: 11.4,
    z: -3.4,
    width: 6.6,
    depth: 4.9,
    height: 3.8,
    roofHeight: 3.2,
    roofCurve: 0.28,
    rotation: -2.55,
    roofColor: 'moss',
    wallStyle: 'plaster',
    tudor: true,
    seed: 613,
  });

  arch.addBuilding({
    type: 'tower',
    x: 14.8,
    z: -6.2,
    radius: 2.2,
    height: 5.2,
    roofHeight: 3.4,
    roofCurve: 0.40,
    rotation: 0.2,
    roofColor: 'ochre',
    wallStyle: 'cotswold',
    crenellated: false,
    seed: 614,
  });

  // East cottage stone garden wall (intersected by upper bridge path -> auto archway!)
  arch.addWall(
    [
      { x: 4.8, z: -8.6 },
      { x: 5.1, z: -6.8 },
      { x: 5.8, z: -3.2 },
      { x: 8.8, z: 0.6 },
    ],
    {
      type: 'wall',
      height: 2.6,
      wallStyle: 'cotswold',
      style: 'cotswold',
      crenellated: false,
    }
  );

  // Rustic wooden garden fences framing west cottage meadow
  arch.addWall(
    [
      { x: -16.5, z: 1.0 },
      { x: -13.2, z: -1.8 },
      { x: -9.8, z: -2.4 },
    ],
    { type: 'fence', height: 1.1, wallStyle: 'timber', style: 'timber' }
  );

  arch.addWall(
    [
      { x: -12.5, z: 10.6 },
      { x: -8.2, z: 12.0 },
      { x: -4.2, z: 11.4 },
    ],
    { type: 'fence', height: 1.1, wallStyle: 'timber', style: 'timber' }
  );

  // Bridge #1 (upper cobble path joining west cottage, brook, and east stone archway)
  world.addPath(
    [
      { x: -9.6, z: 1.2 },
      { x: -8.2, z: -1.2 },
      { x: -4.5, z: -4.0 }, // Crosses brook -> Bridge #1
      { x: 0.8, z: -5.8 },
      { x: 5.3, z: -5.4 }, // Crosses east stone wall -> Stone Archway!
      { x: 8.6, z: -4.4 },
    ],
    { width: 2.2, style: 'cobble' }
  );

  // Bridge #2 (lower cobble lane joining east cottage garden back across the brook)
  world.addPath(
    [
      { x: 10.2, z: 0.6 },
      { x: 8.4, z: 4.2 },
      { x: 3.5, z: 7.0 }, // Crosses brook -> Bridge #2
      { x: -1.6, z: 9.8 },
      { x: -6.8, z: 8.2 },
      { x: -9.6, z: 5.8 },
    ],
    { width: 2.15, style: 'cobble' }
  );

  arch.setPaths(world.getPaths());
  world.syncFootprints(arch.getFootprints());

  // Lanterns, benches & spring blossom groves
  placeGroundClutter(world, arch, 'lantern', -7.2, -1.8, 0, 0);
  placeGroundClutter(world, arch, 'lantern', 4.2, -6.2, 0, 0);
  placeGroundClutter(world, arch, 'lantern', 7.4, 4.8, 0, 0);
  placeGroundClutter(world, arch, 'lantern', -1.2, 8.8, 0, 0);
  placeGroundClutter(world, arch, 'bench', -6.2, 3.8, 0.9, 0);
  placeGroundClutter(world, arch, 'bench', 5.8, 1.8, -2.2, 0);

  const groves = [
    { x: -20, z: -5, r: 8.0, c: 8 },
    { x: -18, z: 15, r: 8.0, c: 8 },
    { x: 19, z: -12, r: 8.5, c: 9 },
    { x: 18, z: 8, r: 8.0, c: 8 },
    { x: -4, z: -18, r: 7.0, c: 6 },
  ];
  for (const g of groves) {
    world.paintTrees?.(g.x, g.z, g.r, g.c);
  }

  const flowers = [
    { x: -8, z: 5, r: 5.5, d: 0.95 },
    { x: 7, z: -1, r: 5.5, d: 0.95 },
    { x: -4, z: 16, r: 7.5, d: 0.9 },
    { x: 12, z: 10, r: 6.5, d: 0.9 },
    { x: -15, z: -8, r: 6.0, d: 0.85 },
  ];
  for (const f of flowers) {
    world.paintFlowers?.(f.x, f.z, f.r, f.d);
  }

  const envConfig = {
    timeOfDay: 8.4, // Crisp spring morning sunlight
    season: 'spring',
    cloudiness: 0.22,
    mist: 0.28,
    windStrength: 0.38,
  };
  finalizeScene({ world, arch, pipeline }, envConfig);

  return {
    id: 'cotswold-hamlet',
    label: 'Cotswold Brook Hamlet',
    ...envConfig,
    cameraTarget: { x: 0.0, y: 1.2, z: 1.5 },
  };
}

function buildMoonlitAbbey({ world, arch, pipeline }) {
  // Elevated rocky citadel crag ringed by a misty moat
  sculptHill(world, 0, -6.5, 16.0, 2.8);
  sculptHill(world, -6, -8.0, 12.0, 3.1);
  sculptHill(world, 6, -7.5, 12.0, 2.9);
  sculptHill(world, -22, -22, 16.0, 4.6);
  sculptHill(world, 22, -20, 16.0, 4.4);

  // Shape dry causeway banks BEFORE carving the misty moat
  ensureDryBank(world, 0.6, 3.6, 4.0, 1.45);
  ensureDryBank(world, 0.9, 8.2, 3.8, 0.72);
  ensureDryBank(world, 1.4, 21.0, 5.2, 0.50);

  // Continuous misty crescent moat around southern & eastern approaches
  const moatArc = [
    { x: -14.2, z: 10.5, r: 4.7, d: -1.42 },
    { x: -9.0, z: 13.0, r: 4.9, d: -1.55 },
    { x: -3.5, z: 14.2, r: 5.1, d: -1.62 },
    { x: 1.2, z: 14.4, r: 5.1, d: -1.62 },
    { x: 6.2, z: 13.6, r: 4.9, d: -1.55 },
    { x: 11.2, z: 11.5, r: 4.7, d: -1.45 },
    { x: 15.0, z: 8.2, r: 4.4, d: -1.32 },
  ];
  carveSplineWaterway(world, moatArc, 1.5);

  pipeline?.water?.updateTerrainTexture?.(world.getHeightDataTexture(), 120);

  // Granite citadel towers & abbey hall
  arch.addBuilding({
    type: 'tower',
    x: -4.2,
    z: -7.5,
    radius: 3.25,
    height: 8.6,
    roofHeight: 4.8,
    roofCurve: 0.46,
    rotation: 0.2,
    roofColor: 'slate',
    wallStyle: 'granite',
    crenellated: false,
    seed: 701,
  });

  arch.addBuilding({
    type: 'cottage',
    x: 1.2,
    z: -6.2,
    width: 7.6,
    depth: 5.4,
    height: 4.6,
    roofHeight: 3.6,
    roofCurve: 0.30,
    rotation: -0.05,
    roofColor: 'plum',
    wallStyle: 'granite',
    tudor: false,
    seed: 702,
  });

  arch.addBuilding({
    type: 'tower',
    x: 6.8,
    z: -5.4,
    radius: 2.5,
    height: 6.4,
    roofHeight: 2.3,
    roofCurve: 0.25,
    rotation: -0.5,
    roofColor: 'slate',
    wallStyle: 'granite',
    crenellated: true,
    seed: 703,
  });

  arch.addBuilding({
    type: 'tower',
    x: -8.6,
    z: -1.5,
    radius: 2.35,
    height: 5.8,
    roofHeight: 2.2,
    roofCurve: 0.22,
    rotation: 0.8,
    roofColor: 'plum',
    wallStyle: 'granite',
    crenellated: true,
    seed: 704,
  });

  // Inner crenellated granite curtain wall (Archway #1)
  arch.addWall(
    [
      { x: -7.4, z: -0.2 },
      { x: -3.6, z: 3.4 },
      { x: 3.8, z: 3.5 },
      { x: 7.2, z: 0.2 },
      { x: 7.2, z: -3.6 },
    ],
    {
      type: 'wall',
      height: 3.05,
      wallStyle: 'granite',
      style: 'granite',
      crenellated: true,
    }
  );

  // Outer crenellated barbican curtain wall (Archway #2)
  arch.addWall(
    [
      { x: -8.8, z: 5.4 },
      { x: -3.4, z: 8.2 },
      { x: 4.4, z: 8.1 },
      { x: 9.2, z: 4.8 },
    ],
    {
      type: 'wall',
      height: 2.85,
      wallStyle: 'granite',
      style: 'granite',
      crenellated: true,
    }
  );

  // Causeway cobble path piercing BOTH curtain walls (double archways!) and crossing the misty moat
  world.addPath(
    [
      { x: 0.3, z: -1.2 },
      { x: 0.6, z: 3.6 },  // Inner curtain wall -> Stone Voussoir Archway #1
      { x: 0.9, z: 8.2 },  // Outer barbican wall -> Stone Voussoir Archway #2
      { x: 1.1, z: 11.2 },
      { x: 1.2, z: 14.4 }, // Misty moat -> Arched Castle Bridge
      { x: 1.3, z: 17.8 },
      { x: 1.6, z: 21.2 },
      { x: 4.2, z: 26.5 },
    ],
    { width: 2.45, style: 'cobble' }
  );

  arch.setPaths(world.getPaths());
  world.syncFootprints(arch.getFootprints());

  // Fortress flags & 8 warm amber lanterns for rich night point-light pools
  placeRoofClutter(world, arch, 'flag', -4.2, -7.5, 8.6, 4.8, 1.02, 0.5);
  placeRoofClutter(world, arch, 'flag', 6.8, -5.4, 6.4, 2.3, 1.02, -0.3);

  placeGroundClutter(world, arch, 'lantern', -0.9, 4.1, 0, 0);
  placeGroundClutter(world, arch, 'lantern', 2.1, 4.0, 0, 0);
  placeGroundClutter(world, arch, 'lantern', -0.6, 8.7, 0, 0);
  placeGroundClutter(world, arch, 'lantern', 2.4, 8.6, 0, 0);
  placeGroundClutter(world, arch, 'lantern', -0.2, 10.6, 0, 0);
  placeGroundClutter(world, arch, 'lantern', 2.6, 19.6, 0, 0);
  placeGroundClutter(world, arch, 'lantern', 1.2, -2.8, 0, 0);
  placeGroundClutter(world, arch, 'lantern', -5.4, -2.0, 0, 0);

  // Autumn crimson/gold woodland framing the moonlit ruins
  const autumnGroves = [
    { x: -17, z: -12, r: 9.0, c: 9 },
    { x: 16, z: -12, r: 9.0, c: 9 },
    { x: -19, z: 5, r: 7.5, c: 7 },
    { x: 18, z: 4, r: 7.5, c: 7 },
    { x: -13, z: 22, r: 7.5, c: 6 },
    { x: 22, z: 18, r: 6.5, c: 5 },
  ];
  for (const g of autumnGroves) {
    world.paintTrees?.(g.x, g.z, g.r, g.c);
  }

  world.paintFlowers?.(-5, 20, 6.0, 0.7);
  world.paintFlowers?.(8, 20, 6.0, 0.7);

  const envConfig = {
    timeOfDay: 21.6, // Starry moonlit night with glowing windows & lanterns
    season: 'autumn',
    cloudiness: 0.20,
    mist: 0.56,
    windStrength: 0.48,
  };
  finalizeScene({ world, arch, pipeline }, envConfig);

  return {
    id: 'moonlit-abbey',
    label: 'Starlit Castle Ruins',
    ...envConfig,
    cameraTarget: { x: 0.0, y: 2.4, z: 2.5 },
  };
}

function buildEmptyMeadow({ world, arch, pipeline }) {
  // Gently rolling untouched sunlit meadow with a tranquil side pond & scattered groves
  sculptHill(world, -20, -22, 16, 2.8);
  sculptHill(world, 18, -24, 17, 3.1);
  sculptHill(world, -24, 12, 14, 1.9);

  // Small natural pond off to the east-southeast for ducks, reeds & reflections
  sculptBasin(world, 11.5, 7.5, 5.2, -1.45);
  sculptBasin(world, 8.2, 9.2, 4.2, -1.25);

  pipeline?.water?.updateTerrainTexture?.(world.getHeightDataTexture(), 120);

  arch.setPaths(world.getPaths());
  world.syncFootprints(arch.getFootprints());

  // Perimeter tree clusters leaving the central meadow wide open for building & sheep
  world.paintTrees?.(-18, -14, 8.5, 7);
  world.paintTrees?.(16, -15, 8.5, 7);
  world.paintTrees?.(-20, 14, 7.5, 5);
  world.paintTrees?.(20, 15, 7.0, 5);

  world.paintFlowers?.(-6, 4, 7.0, 0.75);
  world.paintFlowers?.(4, -6, 6.5, 0.75);
  world.paintFlowers?.(-10, -8, 6.0, 0.7);

  const envConfig = {
    timeOfDay: 15.5, // Warm sunlit afternoon
    season: 'summer',
    cloudiness: 0.24,
    mist: 0.18,
    windStrength: 0.40,
  };
  finalizeScene({ world, arch, pipeline }, envConfig);

  return {
    id: 'empty-meadow',
    label: 'Fresh Meadow',
    ...envConfig,
    cameraTarget: { x: 0.0, y: 0.8, z: 0.0 },
  };
}

/**
 * Clears current world & architecture and constructs the requested preset diorama.
 */
export function buildPresetScene(presetId, { world, arch, pipeline }) {
  arch?.clear?.();
  world?.clear?.();

  switch (presetId) {
    case 'cotswold-hamlet':
      return buildCotswoldHamlet({ world, arch, pipeline });
    case 'moonlit-abbey':
      return buildMoonlitAbbey({ world, arch, pipeline });
    case 'empty-meadow':
      return buildEmptyMeadow({ world, arch, pipeline });
    case 'lakeside-keep':
    default:
      return buildLakesideKeep({ world, arch, pipeline });
  }
}
