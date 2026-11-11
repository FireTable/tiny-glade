import * as THREE from 'three';
import {
  disposeHierarchy,
  hashSeed,
  pointToPolyline2D,
  pointToOBBSignedDist2D,
} from './GeometryUtils.js';
import { buildWallEntity } from './WallBuilder.js';
import { buildBuildingEntity } from './BuildingBuilder.js';
import {
  buildAutoBridges,
  evalBridgeHeightAt,
  buildClutterEntity,
  updateFlagBanner,
} from './BridgeAndClutter.js';

const _instMatrix = new THREE.Matrix4();
const _worldMatrix = new THREE.Matrix4();
const _normalMatrix = new THREE.Matrix3();

/**
 * Master reactive procedural architecture manager for Tiny Glade.
 * Owns procedural Stone Walls & Wooden Fences (with automatic path-intersection Voussoir Archways),
 * Cottages & Cylindrical Castle Towers (with sloped foundations, quoins, Tudor jettying, layered
 * roof shingles, smart doors/stairs/windows, and adjacency merging), Automatic Water Bridges,
 * and Architectural Clutter (lanterns, flags, chimneys, windows, doors, benches, flowerboxes, ivy).
 */
export class ArchitectureManager {
  constructor({ scene, materials, getTerrainHeight, waterLevel = -0.35 }) {
    this.scene = scene;
    this.materials = materials;
    this.getTerrainHeight = typeof getTerrainHeight === 'function' ? getTerrainHeight : () => 0;
    this.waterLevel = Number.isFinite(waterLevel) ? waterLevel : -0.35;

    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'ArchitectureRoot';

    this.wallsGroup = new THREE.Group();
    this.wallsGroup.name = 'ArchWalls';
    this.buildingsGroup = new THREE.Group();
    this.buildingsGroup.name = 'ArchBuildings';
    this.bridgesGroup = new THREE.Group();
    this.bridgesGroup.name = 'ArchBridges';
    this.clutterGroup = new THREE.Group();
    this.clutterGroup.name = 'ArchClutter';
    this.previewGroup = new THREE.Group();
    this.previewGroup.name = 'ArchPreview';

    this.rootGroup.add(
      this.wallsGroup,
      this.buildingsGroup,
      this.bridgesGroup,
      this.clutterGroup,
      this.previewGroup
    );
    if (this.scene) {
      this.scene.add(this.rootGroup);
    }

    // Pure JSON-safe entity records (safe for JSON.stringify in InteractionController & HistoryManager!)
    this._walls = new Map();     // id -> wallData
    this._buildings = new Map(); // id -> buildingData
    this._clutter = new Map();   // id -> clutterData
    this._bridges = new Map();   // id -> bridgeRuntime

    // Runtime Three.js objects & cached outputs separated from entity data to guarantee zero circular refs
    this._wallRuntime = new Map();
    this._buildingRuntime = new Map();
    this._clutterRuntime = new Map();

    // Active spring scale-in animations: id -> { group, progress, velocity, target }
    this._springs = new Map();

    this._paths = [];
    this._idCounter = 1;

    // Reusable translucent placement ghost material
    this._ghostMaterial = new THREE.MeshStandardMaterial({
      color: 0xeef6ff,
      emissive: new THREE.Color(0x4b6b88),
      emissiveIntensity: 0.35,
      roughness: 0.5,
      metalness: 0.05,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });
    this._previewCacheKey = '';
    this._previewContentGroup = null;
  }

  _nextId(prefix) {
    while (true) {
      const candidate = `${prefix}_${this._idCounter++}`;
      if (
        !this._walls.has(candidate) &&
        !this._buildings.has(candidate) &&
        !this._clutter.has(candidate)
      ) {
        return candidate;
      }
    }
  }

  /* ============================================================================
   * WALLS & FENCES
   * ============================================================================ */

  addWall(points, opts = {}) {
    let rawPts = points;
    let options = opts || {};
    if (points && !Array.isArray(points) && Array.isArray(points.points)) {
      rawPts = points.points;
      options = points;
    }
    if (!Array.isArray(rawPts) || rawPts.length < 2) return null;

    const cleanPoints = [];
    for (let i = 0; i < rawPts.length; i++) {
      const p = rawPts[i];
      if (!p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.z))) continue;
      const nx = Number(p.x);
      const nz = Number(p.z);
      if (cleanPoints.length > 0) {
        const prev = cleanPoints[cleanPoints.length - 1];
        if (Math.hypot(nx - prev.x, nz - prev.z) < 0.04) continue;
      }
      cleanPoints.push({ x: nx, z: nz });
    }
    if (cleanPoints.length < 2) return null;

    const id = options.id || this._nextId(options.type === 'fence' ? 'fence' : 'wall');
    const type = options.type === 'fence' ? 'fence' : 'wall';
    const wallStyle = options.wallStyle || options.style || (type === 'fence' ? 'timber' : 'limestone');
    const height = THREE.MathUtils.clamp(
      Number(options.height ?? (type === 'fence' ? 1.15 : 2.5)),
      0.65,
      8.0
    );
    const thickness = Number(options.thickness ?? (type === 'fence' ? 0.18 : 0.58));

    const wallData = {
      id,
      entityType: 'wall',
      type,
      points: cleanPoints,
      height,
      thickness,
      wallStyle,
      style: wallStyle,
      crenellated: type === 'wall' ? Boolean(options.crenellated) : false,
      seed: Number.isFinite(options.seed) ? options.seed : hashSeed(id, 101),
      baseY: 0,
      topY: height,
    };

    this._walls.set(id, wallData);
    this._rebuildWall(id, options.animate !== false);
    this._rebuildIntersectingNeighborWalls(id);
    return id;
  }

  updateWall(id, patch = {}) {
    const data = this._walls.get(id);
    if (!data || !patch) return null;

    const pointsChanged = Array.isArray(patch.points) && patch.points.length >= 2;
    if (pointsChanged) {
      data.points = patch.points.map((p) => ({ x: Number(p.x), z: Number(p.z) }));
    }
    if (patch.type === 'wall' || patch.type === 'fence') {
      data.type = patch.type;
    }
    if (patch.height !== undefined && Number.isFinite(Number(patch.height))) {
      data.height = THREE.MathUtils.clamp(Number(patch.height), 0.65, 8.0);
    }
    if (patch.thickness !== undefined && Number.isFinite(Number(patch.thickness))) {
      data.thickness = Math.max(0.12, Number(patch.thickness));
    }
    if (patch.wallStyle !== undefined || patch.style !== undefined) {
      data.wallStyle = patch.wallStyle || patch.style;
      data.style = data.wallStyle;
    }
    if (patch.crenellated !== undefined) {
      data.crenellated = data.type === 'wall' ? Boolean(patch.crenellated) : false;
    }

    this._rebuildWall(id, false);
    if (pointsChanged) {
      this._rebuildIntersectingNeighborWalls(id);
    }
    return this.getEntity(id);
  }

  _rebuildWall(id, animatePop = false) {
    const data = this._walls.get(id);
    if (!data) return;

    const prevRt = this._wallRuntime.get(id);
    if (prevRt) {
      this.wallsGroup.remove(prevRt.group);
      disposeHierarchy(prevRt.group);
      this._springs.delete(id);
    }

    const otherWalls = [];
    for (const [oid, ow] of this._walls.entries()) {
      if (oid === id || ow.type !== 'wall') continue;
      const oRt = this._wallRuntime.get(oid);
      otherWalls.push({
        ...ow,
        _cachedSamples: oRt?.splineSamples || null,
      });
    }

    const built = buildWallEntity(data, {
      materials: this.materials,
      getTerrainHeight: this.getTerrainHeight,
      waterLevel: this.waterLevel,
      paths: this._paths,
      otherWalls,
    });

    data.baseY = built.baseY;
    data.topY = built.topY;
    data.x = built.anchor.x;
    data.z = built.anchor.z;

    const bbox = computePointsBBox(data.points, data.thickness + 1.2);
    this._wallRuntime.set(id, {
      ...built,
      bbox,
    });

    this.wallsGroup.add(built.group);
    if (animatePop) {
      this._triggerSpringPop(id, built.group);
    }
  }

  _rebuildIntersectingNeighborWalls(changedWallId) {
    const targetRt = this._wallRuntime.get(changedWallId);
    const targetData = this._walls.get(changedWallId);
    if (!targetRt || !targetData || targetData.type !== 'wall') return;

    for (const [oid, ow] of this._walls.entries()) {
      if (oid === changedWallId || ow.type !== 'wall') continue;
      const oRt = this._wallRuntime.get(oid);
      if (oRt && boxesOverlap2D(targetRt.bbox, oRt.bbox)) {
        this._rebuildWall(oid, false);
      }
    }
  }

  /* ============================================================================
   * BUILDINGS (COTTAGES & TOWERS WITH AUTOMATIC ADJACENCY MERGING)
   * ============================================================================ */

  addBuilding(spec = {}) {
    const type = spec.type === 'tower' ? 'tower' : 'cottage';
    const id = spec.id || this._nextId(type);
    const x = Number.isFinite(Number(spec.x)) ? Number(spec.x) : Number(spec.position?.x || 0);
    const z = Number.isFinite(Number(spec.z)) ? Number(spec.z) : Number(spec.position?.z || 0);
    const rotation = Number.isFinite(Number(spec.rotation)) ? Number(spec.rotation) : 0;
    const width = THREE.MathUtils.clamp(Number(spec.width ?? 5.5), 2.2, 16.0);
    const depth = THREE.MathUtils.clamp(Number(spec.depth ?? 4.5), 2.2, 16.0);
    const radius = THREE.MathUtils.clamp(Number(spec.radius ?? 2.8), 1.4, 9.0);
    const height = THREE.MathUtils.clamp(Number(spec.height ?? (type === 'tower' ? 5.6 : 3.8)), 1.6, 15.0);
    const roofHeight = THREE.MathUtils.clamp(Number(spec.roofHeight ?? (type === 'tower' ? 3.8 : 3.0)), 0.4, 10.0);
    const roofCurve = THREE.MathUtils.clamp(Number(spec.roofCurve ?? 0.25), -0.5, 0.85);
    const roofColor = spec.roofColor || spec.roof || 'terracotta';
    const wallStyle = spec.wallStyle || spec.style || 'limestone';

    const bData = {
      id,
      entityType: 'building',
      type,
      x,
      z,
      rotation,
      width,
      depth,
      radius,
      height,
      roofHeight,
      roofCurve,
      roofColor,
      wallStyle,
      style: wallStyle,
      crenellated: Boolean(spec.crenellated),
      tudor: Boolean(spec.tudor),
      chimney: spec.chimney !== false,
      seed: Number.isFinite(spec.seed) ? spec.seed : hashSeed(id, 307),
      baseY: this.getTerrainHeight(x, z),
      eaveY: 0,
      peakY: 0,
    };

    this._buildings.set(id, bData);
    this._rebuildBuilding(id, spec.animate !== false);

    // Rebuild nearby overlapping/abutting buildings so buried windows/doors suppress & buttresses merge
    const neighbors = this._findNearbyBuildingIds(bData);
    for (let i = 0; i < neighbors.length; i++) {
      this._rebuildBuilding(neighbors[i], false);
    }

    return id;
  }

  updateBuilding(id, patch = {}) {
    const bData = this._buildings.get(id);
    if (!bData || !patch) return null;

    const prevNeighbors = this._findNearbyBuildingIds(bData);

    if (patch.x !== undefined && Number.isFinite(Number(patch.x))) bData.x = Number(patch.x);
    if (patch.z !== undefined && Number.isFinite(Number(patch.z))) bData.z = Number(patch.z);
    if (patch.rotation !== undefined && Number.isFinite(Number(patch.rotation))) bData.rotation = Number(patch.rotation);
    if (patch.width !== undefined && Number.isFinite(Number(patch.width))) {
      bData.width = THREE.MathUtils.clamp(Number(patch.width), 2.2, 16.0);
    }
    if (patch.depth !== undefined && Number.isFinite(Number(patch.depth))) {
      bData.depth = THREE.MathUtils.clamp(Number(patch.depth), 2.2, 16.0);
    }
    if (patch.radius !== undefined && Number.isFinite(Number(patch.radius))) {
      bData.radius = THREE.MathUtils.clamp(Number(patch.radius), 1.4, 9.0);
    }
    if (patch.height !== undefined && Number.isFinite(Number(patch.height))) {
      bData.height = THREE.MathUtils.clamp(Number(patch.height), 1.6, 15.0);
    }
    if (patch.roofHeight !== undefined && Number.isFinite(Number(patch.roofHeight))) {
      bData.roofHeight = THREE.MathUtils.clamp(Number(patch.roofHeight), 0.4, 10.0);
    }
    if (patch.roofCurve !== undefined && Number.isFinite(Number(patch.roofCurve))) {
      bData.roofCurve = THREE.MathUtils.clamp(Number(patch.roofCurve), -0.5, 0.85);
    }
    if (patch.roofColor !== undefined) bData.roofColor = patch.roofColor;
    if (patch.wallStyle !== undefined || patch.style !== undefined) {
      bData.wallStyle = patch.wallStyle || patch.style;
      bData.style = bData.wallStyle;
    }
    if (patch.crenellated !== undefined) bData.crenellated = Boolean(patch.crenellated);
    if (patch.tudor !== undefined) bData.tudor = Boolean(patch.tudor);

    this._rebuildBuilding(id, false);

    const currNeighbors = this._findNearbyBuildingIds(bData);
    const affected = new Set([...prevNeighbors, ...currNeighbors]);
    for (const nid of affected) {
      this._rebuildBuilding(nid, false);
    }

    return this.getEntity(id);
  }

  _findNearbyBuildingIds(targetData) {
    const rTarget = targetData.type === 'tower'
      ? targetData.radius
      : 0.5 * Math.hypot(targetData.width, targetData.depth);
    const ids = [];

    for (const [oid, ob] of this._buildings.entries()) {
      if (oid === targetData.id) continue;
      const rOther = ob.type === 'tower'
        ? ob.radius
        : 0.5 * Math.hypot(ob.width, ob.depth);
      const dist = Math.hypot(ob.x - targetData.x, ob.z - targetData.z);
      if (dist <= rTarget + rOther + 1.6) {
        ids.push(oid);
      }
    }
    return ids;
  }

  _rebuildBuilding(id, animatePop = false) {
    const bData = this._buildings.get(id);
    if (!bData) return;

    const prevRt = this._buildingRuntime.get(id);
    if (prevRt) {
      this.buildingsGroup.remove(prevRt.group);
      disposeHierarchy(prevRt.group);
      this._springs.delete(id);
    }

    const otherBuildings = [];
    for (const [oid, ob] of this._buildings.entries()) {
      if (oid !== id) otherBuildings.push(ob);
    }

    const built = buildBuildingEntity(bData, {
      materials: this.materials,
      getTerrainHeight: this.getTerrainHeight,
      waterLevel: this.waterLevel,
      otherBuildings,
    });

    bData.baseY = built.baseY;
    bData.y = built.baseY;
    bData.eaveY = built.eaveY;
    bData.peakY = built.peakY;

    const boundR = (bData.type === 'tower' ? bData.radius : 0.5 * Math.hypot(bData.width, bData.depth)) + 1.5;
    this._buildingRuntime.set(id, {
      ...built,
      bbox: {
        minX: bData.x - boundR,
        maxX: bData.x + boundR,
        minZ: bData.z - boundR,
        maxZ: bData.z + boundR,
      },
    });

    this.buildingsGroup.add(built.group);
    if (animatePop) {
      this._triggerSpringPop(id, built.group);
    }
  }

  /* ============================================================================
   * CLUTTER & AUTOMATIC WATER BRIDGES
   * ============================================================================ */

  addClutter(spec = {}) {
    const type = spec.type || spec.subtype || spec.clutterType || spec.kind || 'lantern';
    const id = spec.id || this._nextId(type);

    const x = Number.isFinite(Number(spec.x)) ? Number(spec.x) : Number(spec.position?.x || 0);
    const z = Number.isFinite(Number(spec.z)) ? Number(spec.z) : Number(spec.position?.z || 0);
    const groundY = this.getTerrainHeight(x, z);

    const hasExplicitY =
      (spec.y !== undefined && Number.isFinite(Number(spec.y))) ||
      (spec.position?.y !== undefined && Number.isFinite(Number(spec.position.y)));
    let y = hasExplicitY
      ? Number(spec.y ?? spec.position.y)
      : groundY;

    // Smart roof peak snap if a flag/chimney is added over a building without an explicit Y
    if (!hasExplicitY && (type === 'flag' || type === 'chimney')) {
      for (const b of this._buildings.values()) {
        const hitB = b.type === 'tower'
          ? Math.hypot(x - b.x, z - b.z) <= b.radius + 0.5
          : pointToOBBSignedDist2D(x, z, b.x, b.z, b.width, b.depth, b.rotation) <= 0.4;
        if (hitB) {
          y = b.peakY || (groundY + b.height + b.roofHeight);
          break;
        }
      }
    }

    const normal = spec.normal
      ? {
          x: Number(spec.normal.x || 0),
          y: Number(spec.normal.y || 0),
          z: Number(spec.normal.z || 0),
        }
      : { x: 0, y: 1, z: 0 };

    const groundOffset = Number.isFinite(spec.groundOffset) ? spec.groundOffset : (y - groundY);
    const surface = spec.surface || (Math.abs(groundOffset) > 0.45 ? 'elevated' : 'ground');

    const cData = {
      id,
      entityType: 'clutter',
      type,
      subtype: type,
      x,
      y,
      z,
      groundOffset,
      rotation: Number.isFinite(Number(spec.rotation)) ? Number(spec.rotation) : 0,
      normal,
      hostId: spec.hostId || null,
      hostType: spec.hostType || 'terrain',
      surface,
      wallMounted: Boolean(spec.wallMounted),
      color: spec.color || null,
      wallStyle: spec.wallStyle || 'limestone',
      seed: Number.isFinite(spec.seed) ? spec.seed : hashSeed(id, 733),
    };

    this._clutter.set(id, cData);
    this._rebuildClutter(id, spec.animate !== false);
    return id;
  }

  _rebuildClutter(id, animatePop = false) {
    const cData = this._clutter.get(id);
    if (!cData) return;

    const prevRt = this._clutterRuntime.get(id);
    if (prevRt) {
      this.clutterGroup.remove(prevRt.group);
      disposeHierarchy(prevRt.group);
      this._springs.delete(id);
    }

    const built = buildClutterEntity(cData, {
      materials: this.materials,
      getTerrainHeight: this.getTerrainHeight,
      waterLevel: this.waterLevel,
    });

    this._clutterRuntime.set(id, built);
    this.clutterGroup.add(built.group);
    if (animatePop) {
      this._triggerSpringPop(id, built.group);
    }
  }

  /* ============================================================================
   * PATHS & TERRAIN REACTIVE ADAPTATION
   * ============================================================================ */

  setPaths(pathList) {
    this._paths = Array.isArray(pathList)
      ? pathList
          .filter((p) => p && Array.isArray(p.points) && p.points.length >= 2)
          .map((p) => ({
            id: p.id,
            width: Number(p.width ?? 2.2),
            style: p.style || 'cobble',
            points: p.points.map((pt) => ({ x: Number(pt.x), z: Number(pt.z) })),
          }))
      : [];

    // Rebuild all walls & fences so path crossings automatically carve 3D stone archways / gate posts!
    for (const wid of this._walls.keys()) {
      this._rebuildWall(wid, false);
    }

    // Rebuild automatic arched cobblestone & timber bridges over underwater spans!
    this._rebuildBridges();
  }

  _rebuildBridges() {
    for (const br of this._bridges.values()) {
      this.bridgesGroup.remove(br.group);
      disposeHierarchy(br.group);
      this._springs.delete(br.id);
    }
    this._bridges.clear();

    const builtBridges = buildAutoBridges(this._paths, {
      materials: this.materials,
      getTerrainHeight: this.getTerrainHeight,
      waterLevel: this.waterLevel,
    });

    for (let i = 0; i < builtBridges.length; i++) {
      const br = builtBridges[i];
      this._bridges.set(br.id, br);
      this.bridgesGroup.add(br.group);
    }
  }

  onTerrainChanged(bboxOrNull = null) {
    const bbox = normalizeBBox(bboxOrNull);

    for (const [bid, bRt] of this._buildingRuntime.entries()) {
      if (!bbox || boxesOverlap2D(bbox, bRt.bbox)) {
        this._rebuildBuilding(bid, false);
      }
    }

    for (const [wid, wRt] of this._wallRuntime.entries()) {
      if (!bbox || boxesOverlap2D(bbox, wRt.bbox)) {
        this._rebuildWall(wid, false);
      }
    }

    for (const [cid, cData] of this._clutter.entries()) {
      if (
        !bbox ||
        (cData.x >= bbox.minX - 1.5 &&
          cData.x <= bbox.maxX + 1.5 &&
          cData.z >= bbox.minZ - 1.5 &&
          cData.z <= bbox.maxZ + 1.5)
      ) {
        const newGroundY = this.getTerrainHeight(cData.x, cData.z);
        cData.y = newGroundY + (cData.groundOffset || 0);
        this._rebuildClutter(cid, false);
      }
    }

    // Always keep water bridges synchronized with sculpted ponds & banks
    this._rebuildBridges();
  }

  /* ============================================================================
   * REMOVAL / DEMOLISH
   * ============================================================================ */

  removeEntityById(id) {
    if (!id) return false;

    if (this._buildings.has(id)) {
      const bData = this._buildings.get(id);
      const neighbors = this._findNearbyBuildingIds(bData);
      const rt = this._buildingRuntime.get(id);
      if (rt) {
        this.buildingsGroup.remove(rt.group);
        disposeHierarchy(rt.group);
      }
      this._buildings.delete(id);
      this._buildingRuntime.delete(id);
      this._springs.delete(id);

      // Remove hosted clutter attached to this building
      this._removeClutterHostedOn(id);

      // Refresh previously adjacent buildings so suppressed windows/doors reappear!
      for (let i = 0; i < neighbors.length; i++) {
        this._rebuildBuilding(neighbors[i], false);
      }
      return true;
    }

    if (this._walls.has(id)) {
      const wData = this._walls.get(id);
      const wRt = this._wallRuntime.get(id);
      const wallBox = wRt?.bbox || null;
      if (wRt) {
        this.wallsGroup.remove(wRt.group);
        disposeHierarchy(wRt.group);
      }
      this._walls.delete(id);
      this._wallRuntime.delete(id);
      this._springs.delete(id);
      this._removeClutterHostedOn(id);

      if (wData.type === 'wall' && wallBox) {
        for (const [oid, ow] of this._walls.entries()) {
          if (ow.type !== 'wall') continue;
          const oRt = this._wallRuntime.get(oid);
          if (oRt && boxesOverlap2D(wallBox, oRt.bbox)) {
            this._rebuildWall(oid, false);
          }
        }
      }
      return true;
    }

    if (this._clutter.has(id)) {
      const rt = this._clutterRuntime.get(id);
      if (rt) {
        this.clutterGroup.remove(rt.group);
        disposeHierarchy(rt.group);
      }
      this._clutter.delete(id);
      this._clutterRuntime.delete(id);
      this._springs.delete(id);
      return true;
    }

    if (this._bridges.has(id)) {
      const br = this._bridges.get(id);
      this.bridgesGroup.remove(br.group);
      disposeHierarchy(br.group);
      this._bridges.delete(id);
      this._springs.delete(id);
      return true;
    }

    return false;
  }

  _removeClutterHostedOn(hostId) {
    const toRemove = [];
    for (const [cid, cData] of this._clutter.entries()) {
      if (cData.hostId === hostId) toRemove.push(cid);
    }
    for (let i = 0; i < toRemove.length; i++) {
      this.removeEntityById(toRemove[i]);
    }
  }

  removeAt(x, z, radius = 2.5) {
    const removed = [];
    const r = Math.max(0.4, Number(radius) || 2.5);

    // 1. Check clutter within radius
    const clutterHits = [];
    for (const [cid, cData] of this._clutter.entries()) {
      if (Math.hypot(cData.x - x, cData.z - z) <= r + 0.45) {
        clutterHits.push({
          id: cid,
          type: cData.type,
          position: { x: cData.x, y: cData.y, z: cData.z },
        });
      }
    }
    for (let i = 0; i < clutterHits.length; i++) {
      if (this.removeEntityById(clutterHits[i].id)) {
        removed.push({ type: clutterHits[i].type, position: clutterHits[i].position });
      }
    }

    // 2. Check walls & fences within radius
    const wallHits = [];
    for (const [wid, wData] of this._walls.entries()) {
      const rt = this._wallRuntime.get(wid);
      const poly = rt?.splineSamples || wData.points;
      const hit = pointToPolyline2D(x, z, poly);
      if (hit.dist <= r + (wData.thickness || 0.5) * 0.5) {
        wallHits.push({
          id: wid,
          type: wData.type,
          position: { x: hit.closestX, y: this.getTerrainHeight(hit.closestX, hit.closestZ) + 0.8, z: hit.closestZ },
        });
      }
    }
    for (let i = 0; i < wallHits.length; i++) {
      if (this.removeEntityById(wallHits[i].id)) {
        removed.push({ type: wallHits[i].type, position: wallHits[i].position });
      }
    }

    // 3. Check buildings within radius
    const buildingHits = [];
    for (const [bid, bData] of this._buildings.entries()) {
      const dist = bData.type === 'tower'
        ? Math.hypot(x - bData.x, z - bData.z) - bData.radius
        : pointToOBBSignedDist2D(x, z, bData.x, bData.z, bData.width, bData.depth, bData.rotation);
      if (dist <= r) {
        buildingHits.push({
          id: bid,
          type: bData.type,
          position: { x: bData.x, y: bData.baseY + bData.height * 0.5, z: bData.z },
        });
      }
    }
    for (let i = 0; i < buildingHits.length; i++) {
      if (this.removeEntityById(buildingHits[i].id)) {
        removed.push({ type: buildingHits[i].type, position: buildingHits[i].position });
      }
    }

    return removed;
  }

  /* ============================================================================
   * LIVE TRANSLUCENT GHOST PLACEMENT PREVIEW
   * ============================================================================ */

  setPreview(previewSpecOrNull) {
    if (!previewSpecOrNull) {
      this._clearPreviewGeometry();
      this.previewGroup.visible = false;
      return;
    }

    this.previewGroup.visible = true;
    const spec = previewSpecOrNull;
    const rawType = spec.type || spec.subtype || spec.clutterType || 'cottage';

    // Wall / Fence spline preview
    if (rawType === 'wall' || rawType === 'fence') {
      if (!Array.isArray(spec.points) || spec.points.length < 2) {
        this._clearPreviewGeometry();
        return;
      }
      const key = `${rawType}|${spec.height || 2.5}|${spec.crenellated ? 1 : 0}|` +
        spec.points.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`).join(';');

      if (key === this._previewCacheKey && this._previewContentGroup) return;
      this._clearPreviewGeometry();
      this._previewCacheKey = key;

      const built = buildWallEntity(
        {
          id: 'preview_wall',
          type: rawType,
          points: spec.points,
          height: spec.height ?? (rawType === 'fence' ? 1.15 : 2.65),
          wallStyle: spec.wallStyle || 'limestone',
          crenellated: Boolean(spec.crenellated),
          seed: 901,
        },
        {
          materials: this.materials,
          getTerrainHeight: this.getTerrainHeight,
          waterLevel: this.waterLevel,
          paths: this._paths,
          otherWalls: [],
        }
      );

      this._applyGhostMaterial(built.group);
      this._previewContentGroup = built.group;
      this.previewGroup.add(built.group);
      return;
    }

    // Cottage / Tower placement ghost (cached shape so hovering only updates transform!)
    if (rawType === 'cottage' || rawType === 'tower') {
      const px = Number(spec.x || 0);
      const pz = Number(spec.z || 0);
      const rot = Number(spec.rotation || 0);
      const shapeKey = `bldg|${rawType}|${(spec.width || 5.5).toFixed(2)}|${(spec.depth || 4.5).toFixed(2)}|${(spec.radius || 2.8).toFixed(2)}|${(spec.height || 3.8).toFixed(2)}|${(spec.roofHeight || 3.0).toFixed(2)}|${(spec.roofCurve ?? 0.25).toFixed(2)}|${spec.crenellated ? 1 : 0}|${spec.tudor ? 1 : 0}`;

      if (shapeKey !== this._previewCacheKey || !this._previewContentGroup) {
        this._clearPreviewGeometry();
        this._previewCacheKey = shapeKey;

        const built = buildBuildingEntity(
          {
            ...spec,
            id: 'preview_bldg',
            type: rawType,
            x: 0,
            z: 0,
            rotation: 0,
            seed: 902,
          },
          {
            materials: this.materials,
            getTerrainHeight: () => 0,
            waterLevel: -999,
            otherBuildings: [],
          }
        );

        this._applyGhostMaterial(built.group);
        this._previewContentGroup = built.group;
        this.previewGroup.add(built.group);
      }

      const groundY = this.getTerrainHeight(px, pz) + 0.12;
      this._previewContentGroup.position.set(px, groundY, pz);
      this._previewContentGroup.rotation.y = rot;
      return;
    }

    // Clutter placement ghost
    const clutterType = spec.subtype || spec.clutterType || rawType;
    const cx = Number(spec.x ?? spec.position?.x ?? 0);
    const cy = Number(spec.y ?? spec.position?.y ?? this.getTerrainHeight(cx, Number(spec.z || 0)));
    const cz = Number(spec.z ?? spec.position?.z ?? 0);
    const hasWallN = spec.normal && Math.hypot(spec.normal.x || 0, spec.normal.z || 0) > 0.45 && Math.abs(spec.normal.y || 0) < 0.72;
    const cKey = `clutter|${clutterType}|${hasWallN ? 'wall' : 'ground'}`;

    if (cKey !== this._previewCacheKey || !this._previewContentGroup) {
      this._clearPreviewGeometry();
      this._previewCacheKey = cKey;

      const built = buildClutterEntity(
        {
          id: 'preview_clutter',
          type: clutterType,
          x: 0,
          y: hasWallN ? 2.0 : 0,
          z: 0,
          wallMounted: Boolean(hasWallN),
          rotation: 0,
          seed: 903,
        },
        {
          materials: this.materials,
          getTerrainHeight: () => 0,
          waterLevel: this.waterLevel,
        }
      );

      this._applyGhostMaterial(built.group);
      this._previewContentGroup = built.group;
      this.previewGroup.add(built.group);
    }

    let yaw = Number(spec.rotation || 0);
    if (hasWallN) {
      yaw = Math.atan2(spec.normal.x, spec.normal.z);
    }
    this._previewContentGroup.position.set(cx, cy, cz);
    this._previewContentGroup.rotation.y = yaw;
  }

  _applyGhostMaterial(group) {
    group.traverse((obj) => {
      if (obj.isMesh) {
        obj.material = this._ghostMaterial;
        obj.castShadow = false;
        obj.receiveShadow = false;
        obj.renderOrder = 25;
      }
    });
  }

  _clearPreviewGeometry() {
    if (this._previewContentGroup) {
      this.previewGroup.remove(this._previewContentGroup);
      disposeHierarchy(this._previewContentGroup);
      this._previewContentGroup = null;
    }
    this._previewCacheKey = '';
  }

  /* ============================================================================
   * RAYCASTING, QUERIES & WALK-MODE SUPPORT
   * ============================================================================ */

  raycast(raycaster) {
    if (!raycaster) return null;
    const targets = [
      this.buildingsGroup,
      this.wallsGroup,
      this.clutterGroup,
      this.bridgesGroup,
    ];
    const hits = raycaster.intersectObjects(targets, true);
    if (hits.length === 0) return null;

    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      let cur = hit.object;
      let entityId = null;
      let entityType = null;

      while (cur && cur !== this.rootGroup) {
        if (cur.userData && cur.userData.archEntityId) {
          entityId = cur.userData.archEntityId;
          entityType = cur.userData.archEntityType;
          break;
        }
        cur = cur.parent;
      }

      if (!entityId) continue;

      const worldNormal = new THREE.Vector3(0, 1, 0);
      if (hit.face && hit.face.normal) {
        worldNormal.copy(hit.face.normal);
        if (hit.object.isInstancedMesh && hit.instanceId !== undefined) {
          hit.object.getMatrixAt(hit.instanceId, _instMatrix);
          _worldMatrix.multiplyMatrices(hit.object.matrixWorld, _instMatrix);
          _normalMatrix.getNormalMatrix(_worldMatrix);
          worldNormal.applyMatrix3(_normalMatrix).normalize();
        } else {
          worldNormal.transformDirection(hit.object.matrixWorld).normalize();
        }
      }

      // Ensure normal faces against ray direction for clean exterior snapping
      if (worldNormal.dot(raycaster.ray.direction) > 0) {
        worldNormal.negate();
      }

      return {
        id: entityId,
        entityType: entityType || 'building',
        entity: this.getEntity(entityId),
        point: hit.point.clone(),
        normal: worldNormal,
      };
    }

    return null;
  }

  getEntity(id) {
    if (!id) return null;
    if (this._buildings.has(id)) {
      return { ...this._buildings.get(id) };
    }
    if (this._walls.has(id)) {
      const w = this._walls.get(id);
      return {
        ...w,
        points: w.points.map((p) => ({ x: p.x, z: p.z })),
      };
    }
    if (this._clutter.has(id)) {
      const c = this._clutter.get(id);
      return {
        ...c,
        normal: c.normal ? { ...c.normal } : { x: 0, y: 1, z: 0 },
      };
    }
    if (this._bridges.has(id)) {
      const br = this._bridges.get(id);
      return {
        id: br.id,
        entityType: 'bridge',
        type: 'bridge',
        pathId: br.pathId,
        position: { ...br.position },
      };
    }
    return null;
  }

  /**
   * Returns exact bridge deck roadway height at (x, z) if (x, z) is on a bridge, else null.
   * Enables smooth First-Person Stroll across arched pond bridges!
   */
  getDeckOrStructureHeightAt(x, z) {
    if (this._bridges.size === 0) return null;
    return evalBridgeHeightAt(Array.from(this._bridges.values()), x, z);
  }

  getFootprints() {
    const out = [];

    for (const rt of this._buildingRuntime.values()) {
      if (rt.footprint) out.push(rt.footprint);
    }

    for (const rt of this._wallRuntime.values()) {
      if (Array.isArray(rt.footprintPolylines)) {
        for (let i = 0; i < rt.footprintPolylines.length; i++) {
          out.push(rt.footprintPolylines[i]);
        }
      }
    }

    return out;
  }

  getChimneyPositions() {
    const positions = [];
    for (const rt of this._buildingRuntime.values()) {
      if (Array.isArray(rt.chimneyPositions)) {
        for (let i = 0; i < rt.chimneyPositions.length; i++) {
          positions.push(rt.chimneyPositions[i]);
        }
      }
    }
    for (const rt of this._clutterRuntime.values()) {
      if (Array.isArray(rt.chimneyPositions)) {
        for (let i = 0; i < rt.chimneyPositions.length; i++) {
          positions.push(rt.chimneyPositions[i]);
        }
      }
    }
    return positions;
  }

  getLanternPositions() {
    const lanterns = [];

    // 1. Explicit clutter lanterns first
    for (const rt of this._clutterRuntime.values()) {
      if (Array.isArray(rt.lanternPositions)) {
        for (let i = 0; i < rt.lanternPositions.length; i++) {
          lanterns.push(rt.lanternPositions[i]);
        }
      }
    }

    // 2. Bridge mid-span lanterns
    for (const br of this._bridges.values()) {
      if (Array.isArray(br.lanternPositions)) {
        for (let i = 0; i < br.lanternPositions.length; i++) {
          lanterns.push(br.lanternPositions[i]);
        }
      }
    }

    // 3. Building porch lanterns
    for (const rt of this._buildingRuntime.values()) {
      if (Array.isArray(rt.lanternPositions)) {
        for (let i = 0; i < rt.lanternPositions.length; i++) {
          lanterns.push(rt.lanternPositions[i]);
        }
      }
    }

    return lanterns;
  }

  /* ============================================================================
   * FRAME UPDATE (ELASTIC SPRING POP-IN + WIND-WAVING FLAGS)
   * ============================================================================ */

  _triggerSpringPop(id, group) {
    if (!group) return;
    group.scale.set(0.18, 0.06, 0.18);
    this._springs.set(id, {
      group,
      y: 0.06,
      vy: 0,
      xz: 0.18,
      vxz: 0,
    });
  }

  update(dt, elapsed = 0, envState = null) {
    const clampedDt = Math.min(0.05, Math.max(0.001, Number(dt) || 0.016));

    // 1. Elastic spring pop-in on newly placed buildings, walls, and clutter
    if (this._springs.size > 0) {
      const stiffness = 240;
      const damping = 18.5;

      for (const [id, sp] of this._springs.entries()) {
        const ay = (1.0 - sp.y) * stiffness - sp.vy * damping;
        sp.vy += ay * clampedDt;
        sp.y += sp.vy * clampedDt;

        const axz = (1.0 - sp.xz) * (stiffness * 0.85) - sp.vxz * (damping * 0.92);
        sp.vxz += axz * clampedDt;
        sp.xz += sp.vxz * clampedDt;

        const sy = Math.max(0.02, sp.y);
        const sxz = Math.max(0.02, sp.xz);
        sp.group.scale.set(sxz, sy, sxz);

        if (
          Math.abs(1.0 - sp.y) < 0.002 &&
          Math.abs(sp.vy) < 0.01 &&
          Math.abs(1.0 - sp.xz) < 0.002 &&
          Math.abs(sp.vxz) < 0.01
        ) {
          sp.group.scale.set(1, 1, 1);
          this._springs.delete(id);
        }
      }
    }

    // 2. Animate waving tower & clutter flags
    const windStrength = envState?.windStrength ?? 0.45;
    for (const rt of this._clutterRuntime.values()) {
      if (rt.flagAnim) {
        updateFlagBanner(rt.flagAnim, elapsed, windStrength);
      }
    }
  }

  /* ============================================================================
   * SERIALIZATION & CLEANUP
   * ============================================================================ */

  serialize() {
    return {
      version: 1,
      idCounter: this._idCounter,
      walls: Array.from(this._walls.values()).map((w) => ({
        id: w.id,
        type: w.type,
        points: w.points.map((p) => ({ x: p.x, z: p.z })),
        height: w.height,
        thickness: w.thickness,
        wallStyle: w.wallStyle,
        crenellated: w.crenellated,
        seed: w.seed,
      })),
      buildings: Array.from(this._buildings.values()).map((b) => ({
        id: b.id,
        type: b.type,
        x: b.x,
        z: b.z,
        rotation: b.rotation,
        width: b.width,
        depth: b.depth,
        radius: b.radius,
        height: b.height,
        roofHeight: b.roofHeight,
        roofCurve: b.roofCurve,
        roofColor: b.roofColor,
        wallStyle: b.wallStyle,
        crenellated: b.crenellated,
        tudor: b.tudor,
        chimney: b.chimney,
        seed: b.seed,
      })),
      clutter: Array.from(this._clutter.values()).map((c) => ({
        id: c.id,
        type: c.type,
        x: c.x,
        y: c.y,
        z: c.z,
        groundOffset: c.groundOffset,
        rotation: c.rotation,
        normal: c.normal ? { ...c.normal } : { x: 0, y: 1, z: 0 },
        hostId: c.hostId,
        hostType: c.hostType,
        surface: c.surface,
        wallMounted: c.wallMounted,
        color: c.color,
        wallStyle: c.wallStyle,
        seed: c.seed,
      })),
      paths: this._paths.map((p) => ({
        id: p.id,
        width: p.width,
        style: p.style,
        points: p.points.map((pt) => ({ x: pt.x, z: pt.z })),
      })),
    };
  }

  deserialize(data) {
    this.clear();
    if (!data || typeof data !== 'object') return;

    if (Number.isFinite(data.idCounter)) {
      this._idCounter = Math.max(1, data.idCounter);
    }

    if (Array.isArray(data.paths)) {
      this._paths = data.paths
        .filter((p) => p && Array.isArray(p.points) && p.points.length >= 2)
        .map((p) => ({
          id: p.id,
          width: Number(p.width ?? 2.2),
          style: p.style || 'cobble',
          points: p.points.map((pt) => ({ x: Number(pt.x), z: Number(pt.z) })),
        }));
    }

    if (Array.isArray(data.buildings)) {
      for (let i = 0; i < data.buildings.length; i++) {
        this.addBuilding({ ...data.buildings[i], animate: false });
      }
    }

    if (Array.isArray(data.walls)) {
      for (let i = 0; i < data.walls.length; i++) {
        const w = data.walls[i];
        this.addWall(w.points, { ...w, animate: false });
      }
    }

    if (Array.isArray(data.clutter)) {
      for (let i = 0; i < data.clutter.length; i++) {
        this.addClutter({ ...data.clutter[i], animate: false });
      }
    }

    this._rebuildBridges();
  }

  clear() {
    this._clearPreviewGeometry();
    this.previewGroup.visible = false;

    for (const rt of this._wallRuntime.values()) {
      this.wallsGroup.remove(rt.group);
      disposeHierarchy(rt.group);
    }
    for (const rt of this._buildingRuntime.values()) {
      this.buildingsGroup.remove(rt.group);
      disposeHierarchy(rt.group);
    }
    for (const rt of this._clutterRuntime.values()) {
      this.clutterGroup.remove(rt.group);
      disposeHierarchy(rt.group);
    }
    for (const br of this._bridges.values()) {
      this.bridgesGroup.remove(br.group);
      disposeHierarchy(br.group);
    }

    this._walls.clear();
    this._buildings.clear();
    this._clutter.clear();
    this._bridges.clear();
    this._wallRuntime.clear();
    this._buildingRuntime.clear();
    this._clutterRuntime.clear();
    this._springs.clear();
    this._paths = [];
  }
}

function computePointsBBox(points, pad = 1.0) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return {
    minX: minX - pad,
    maxX: maxX + pad,
    minZ: minZ - pad,
    maxZ: maxZ + pad,
  };
}

function normalizeBBox(bbox) {
  if (!bbox || typeof bbox !== 'object') return null;
  if (
    Number.isFinite(bbox.minX) &&
    Number.isFinite(bbox.maxX) &&
    Number.isFinite(bbox.minZ) &&
    Number.isFinite(bbox.maxZ)
  ) {
    return bbox;
  }
  if (Number.isFinite(bbox.x) && Number.isFinite(bbox.z) && Number.isFinite(bbox.radius)) {
    return {
      minX: bbox.x - bbox.radius,
      maxX: bbox.x + bbox.radius,
      minZ: bbox.z - bbox.radius,
      maxZ: bbox.z + bbox.radius,
    };
  }
  return null;
}

function boxesOverlap2D(a, b) {
  if (!a || !b) return true;
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxZ < b.minZ || a.minZ > b.maxZ);
}
