import * as THREE from 'three';

const CURSOR_SEGMENTS = 64;
const MAX_STROKE_VERTS = 256;

function resamplePolylineXZ(points, targetStep = 1.0) {
  if (!Array.isArray(points) || points.length === 0) return [];
  if (points.length === 1) return [{ x: points[0].x, z: points[0].z }];

  const cleaned = [{ x: points[0].x, z: points[0].z }];
  for (let i = 1; i < points.length; i++) {
    const prev = cleaned[cleaned.length - 1];
    const p = points[i];
    if (Math.hypot(p.x - prev.x, p.z - prev.z) > 0.05) {
      cleaned.push({ x: p.x, z: p.z });
    }
  }
  if (cleaned.length < 2) return cleaned;

  const arc = [0];
  for (let i = 1; i < cleaned.length; i++) {
    const d = Math.hypot(
      cleaned[i].x - cleaned[i - 1].x,
      cleaned[i].z - cleaned[i - 1].z
    );
    arc.push(arc[i - 1] + d);
  }
  const totalLen = arc[arc.length - 1];
  if (totalLen < 0.1) return cleaned;

  const steps = Math.max(1, Math.round(totalLen / targetStep));
  const out = [];
  let segIdx = 0;

  for (let s = 0; s <= steps; s++) {
    const dist = (s / steps) * totalLen;
    while (segIdx < cleaned.length - 2 && arc[segIdx + 1] < dist) {
      segIdx++;
    }
    const segLen = Math.max(1e-5, arc[segIdx + 1] - arc[segIdx]);
    const t = THREE.MathUtils.clamp((dist - arc[segIdx]) / segLen, 0, 1);
    out.push({
      x: THREE.MathUtils.lerp(cleaned[segIdx].x, cleaned[segIdx + 1].x, t),
      z: THREE.MathUtils.lerp(cleaned[segIdx].z, cleaned[segIdx + 1].z, t),
    });
  }
  return out;
}

export class InteractionController {
  constructor({
    scene,
    camera,
    domElement,
    pipeline,
    world,
    arch,
    audio,
    hud,
    cameraController,
    waterLevel = -0.35,
    worldHalfBound = 56,
    onCommitHistory = null,
    onLanternsChanged = null,
  }) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.pipeline = pipeline;
    this.world = world;
    this.arch = arch;
    this.audio = audio;
    this.hud = hud;
    this.cameraController = cameraController;
    this.waterLevel = waterLevel;
    this.worldHalfBound = worldHalfBound;
    this.onCommitHistory = onCommitHistory;
    this.onLanternsChanged = onLanternsChanged;

    this.activeTool = 'select';
    this.walkMode = false;
    this.photoMode = false;
    this.previewRotation = 0;

    // Selection state
    this.selectedId = null;
    this.selectedType = null; // 'building' | 'wall'

    // Pointer & interaction state
    this._pointerInCanvas = false;
    this._pointerNDC = new THREE.Vector2();
    this._downClientX = 0;
    this._downClientY = 0;
    this._lastClientX = 0;
    this._lastClientY = 0;
    this._activePointerId = null;
    this._interactionState = 'idle'; // 'idle' | 'handle-drag' | 'spline-draw' | 'sculpt' | 'nature' | 'demolish' | 'select-pending'

    // Handle drag state
    this._activeHandle = null;
    this._handleDragPlane = new THREE.Plane();
    this._handleStartHit = new THREE.Vector3();
    this._handleCurrHit = new THREE.Vector3();
    this._handleInitialEntity = null;
    this._handleAudioStep = 0;
    this._hoveredHandleType = null;
    this._pendingEntityPatch = null;

    // Spline stroke state ('wall' | 'fence' | 'path')
    this._strokePoints = [];
    this._strokeCursorPoint = null;
    this._strokeAudioCount = 0;

    // Continuous brush state ('terrain' | 'nature' | 'demolish')
    this._brushWorldPos = new THREE.Vector3();
    this._hasBrushPos = false;
    this._strokeMutated = false;
    this._sculptArchSyncTimer = 0;
    this._brushAudioTimer = 0;
    this._lastNaturePaintPos = new THREE.Vector3(9999, 0, 9999);

    // Reusable raycaster & math scratch
    this._raycaster = new THREE.Raycaster();
    this._horizPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._planeFallbackHit = new THREE.Vector3();
    this._clampedTerrainHit = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._camRight = new THREE.Vector3();
    this._tmpVecA = new THREE.Vector3();
    this._tmpVecB = new THREE.Vector3();

    // Scene helper groups
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'InteractionHelpers';
    this.scene.add(this.rootGroup);

    this._initCursorRing();
    this._initStrokeRibbon();
    this._initHandlesGroup();
    this._bindEvents();
  }

  _initCursorRing() {
    const vertCount = (CURSOR_SEGMENTS + 1) * 2;
    const positions = new Float32Array(vertCount * 3);
    const indices = [];
    for (let i = 0; i < CURSOR_SEGMENTS; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }

    this._cursorGeom = new THREE.BufferGeometry();
    this._cursorGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this._cursorGeom.setIndex(indices);

    this._cursorMat = new THREE.MeshBasicMaterial({
      color: 0xffefc2,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });

    this._cursorMesh = new THREE.Mesh(this._cursorGeom, this._cursorMat);
    this._cursorMesh.frustumCulled = false;
    this._cursorMesh.renderOrder = 30;
    this._cursorMesh.visible = false;
    this.rootGroup.add(this._cursorMesh);
  }

  _initStrokeRibbon() {
    const positions = new Float32Array(MAX_STROKE_VERTS * 2 * 3);
    const indices = [];
    for (let i = 0; i < MAX_STROKE_VERTS - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }

    this._strokeGeom = new THREE.BufferGeometry();
    this._strokeGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this._strokeGeom.setIndex(indices);
    this._strokeGeom.setDrawRange(0, 0);

    this._strokeMat = new THREE.MeshBasicMaterial({
      color: 0xf7dca4,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this._strokeMesh = new THREE.Mesh(this._strokeGeom, this._strokeMat);
    this._strokeMesh.frustumCulled = false;
    this._strokeMesh.renderOrder = 28;
    this._strokeMesh.visible = false;
    this.rootGroup.add(this._strokeMesh);
  }

  _initHandlesGroup() {
    this.handlesGroup = new THREE.Group();
    this.handlesGroup.name = 'ManipulationHandles3D';
    this.handlesGroup.visible = false;
    this.rootGroup.add(this.handlesGroup);

    // Conformal footprint selection outline ribbon
    const outlineVerts = (CURSOR_SEGMENTS + 1) * 2;
    this._outlineGeom = new THREE.BufferGeometry();
    this._outlineGeom.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(outlineVerts * 3), 3)
    );
    const outlineIdx = [];
    for (let i = 0; i < CURSOR_SEGMENTS; i++) {
      const a = i * 2;
      outlineIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this._outlineGeom.setIndex(outlineIdx);
    this._outlineMat = new THREE.MeshBasicMaterial({
      color: 0xffe6a3,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    this._outlineMesh = new THREE.Mesh(this._outlineGeom, this._outlineMat);
    this._outlineMesh.frustumCulled = false;
    this._outlineMesh.renderOrder = 45;
    this.handlesGroup.add(this._outlineMesh);

    this._handleEntries = [];
    this._handleHitProxies = [];

    // Shared geometries for sleek tactile handles
    this._coneGeo = new THREE.ConeGeometry(0.24, 0.44, 16);
    this._shaftGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.52, 12);
    this._finialGeo = new THREE.OctahedronGeometry(0.28, 0);
    this._tabConeGeo = new THREE.ConeGeometry(0.20, 0.36, 14);
    this._knobGeo = new THREE.SphereGeometry(0.23, 16, 12);
    this._hitSphereGeo = new THREE.SphereGeometry(0.58, 10, 8);
  }

  _clearDynamicHandles() {
    for (const entry of this._handleEntries) {
      this.handlesGroup.remove(entry.group);
      entry.mat.dispose();
      entry.rimMat?.dispose();
    }
    this._handleEntries.length = 0;
    this._handleHitProxies.length = 0;
  }

  _createHandleWidget(handleType, colorHex, buildVisualsFn, meta = {}) {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.97,
      depthTest: false,
      depthWrite: false,
    });
    const rimMat = new THREE.MeshBasicMaterial({
      color: 0x2c2118,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.88,
      depthTest: false,
      depthWrite: false,
    });

    buildVisualsFn(group, mat);
    const meshes = [];
    group.traverse((child) => {
      if (child.isMesh) {
        child.renderOrder = 52;
        meshes.push(child);
      }
    });
    for (const m of meshes) {
      const rim = new THREE.Mesh(m.geometry, rimMat);
      rim.position.copy(m.position);
      rim.rotation.copy(m.rotation);
      rim.scale.copy(m.scale).multiplyScalar(1.25);
      rim.renderOrder = 51;
      group.add(rim);
    }

    // Invisible generous hit-proxy so handles are effortless to grab
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitMesh = new THREE.Mesh(this._hitSphereGeo, hitMat);
    hitMesh.userData = { isHandle: true, handleType, ...meta, parentGroup: group };
    group.add(hitMesh);

    this.handlesGroup.add(group);
    const entry = { handleType, group, mat, rimMat, baseColor: colorHex, hitMat, meta };
    this._handleEntries.push(entry);
    this._handleHitProxies.push(hitMesh);
    return entry;
  }

  _rebuildHandlesForSelection() {
    this._clearDynamicHandles();

    if (!this.selectedId || this.walkMode || this.photoMode) {
      this.handlesGroup.visible = false;
      return;
    }

    const allowedTools =
      this.activeTool === 'select' ||
      this.activeTool === 'cottage' ||
      this.activeTool === 'tower' ||
      this.activeTool === 'wall';
    if (!allowedTools) {
      this.handlesGroup.visible = false;
      return;
    }

    const entity = this.arch?.getEntity?.(this.selectedId);
    if (!entity) {
      this.selectedId = null;
      this.selectedType = null;
      this.handlesGroup.visible = false;
      this.hud?.showSelectionInspector?.(null);
      return;
    }

    this.handlesGroup.visible = true;

    if (this.selectedType === 'building' || entity.type === 'cottage' || entity.type === 'tower') {
      this.selectedType = 'building';
      const x = entity.x ?? 0;
      const z = entity.z ?? 0;
      const rot = entity.rotation ?? 0;
      const baseY = entity.baseY ?? (this.world?.getHeightAt?.(x, z) ?? 0);
      const wallH = entity.height ?? 3.8;
      const roofH = entity.roofHeight ?? 3.0;
      const peakY = Number.isFinite(entity.peakY) && entity.peakY > baseY
        ? entity.peakY
        : baseY + wallH + roofH;

      // Update ground footprint outline
      this._updateBuildingOutline(entity);

      // 1. Vertical Wall-Height Handle (ivory double arrow above roof)
      const heightHandle = this._createHandleWidget('height', 0xfff5dc, (g, mat) => {
        const upCone = new THREE.Mesh(this._coneGeo, mat);
        upCone.position.y = 0.34;
        const downCone = new THREE.Mesh(this._coneGeo, mat);
        downCone.rotation.x = Math.PI;
        downCone.position.y = -0.34;
        const shaft = new THREE.Mesh(this._shaftGeo, mat);
        g.add(upCone, downCone, shaft);
      });
      heightHandle.group.position.set(x, peakY + 1.55, z);

      // 2. Roof Pitch & Curve Handle (warm amber finial diamond right at roof peak)
      const roofHandle = this._createHandleWidget('roof', 0xf3ae49, (g, mat) => {
        const finial = new THREE.Mesh(this._finialGeo, mat);
        finial.scale.set(1.05, 1.35, 1.05);
        g.add(finial);
      });
      roofHandle.group.position.set(x, peakY + 0.35, z);

      // 3. Footprint Size / Radius Handles
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const localToWorld = (lx, lz) => {
        const wx = x + lx * cosR + lz * sinR;
        const wz = z - lx * sinR + lz * cosR;
        const wy = Math.max(this.world?.getHeightAt?.(wx, wz) ?? baseY, this.waterLevel) + 0.28;
        return new THREE.Vector3(wx, wy, wz);
      };

      if (entity.type === 'tower') {
        const r = (entity.radius ?? 2.8) + 0.58;
        const dirs = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
        for (const [dx, dz] of dirs) {
          const h = this._createHandleWidget('radius', 0xf5d487, (g, mat) => {
            const c = new THREE.Mesh(this._tabConeGeo, mat);
            c.rotation.x = Math.PI * 0.5;
            g.add(c);
          });
          const pos = localToWorld(dx * r, dz * r);
          h.group.position.copy(pos);
          h.group.lookAt(pos.x + (pos.x - x), pos.y, pos.z + (pos.z - z));
        }

        // Rotation knob
        const rotHandle = this._createHandleWidget('rotate', 0xa8dfa0, (g, mat) => {
          g.add(new THREE.Mesh(this._knobGeo, mat));
        });
        rotHandle.group.position.copy(localToWorld(0, r + 1.05));
      } else {
        const hw = (entity.width ?? 5.5) * 0.5 + 0.58;
        const hd = (entity.depth ?? 4.5) * 0.5 + 0.58;

        for (const sign of [-1, 1]) {
          const wHandle = this._createHandleWidget('width', 0xf5d487, (g, mat) => {
            const c = new THREE.Mesh(this._tabConeGeo, mat);
            c.rotation.x = Math.PI * 0.5;
            g.add(c);
          });
          const wPos = localToWorld(sign * hw, 0);
          wHandle.group.position.copy(wPos);
          wHandle.group.lookAt(wPos.x + (wPos.x - x), wPos.y, wPos.z + (wPos.z - z));

          const dHandle = this._createHandleWidget('depth', 0xf5d487, (g, mat) => {
            const c = new THREE.Mesh(this._tabConeGeo, mat);
            c.rotation.x = Math.PI * 0.5;
            g.add(c);
          });
          const dPos = localToWorld(0, sign * hd);
          dHandle.group.position.copy(dPos);
          dHandle.group.lookAt(dPos.x + (dPos.x - x), dPos.y, dPos.z + (dPos.z - z));
        }

        // Uniform corner footprint tab (drag radially to resize width & depth together)
        const cornerHandle = this._createHandleWidget('radius', 0xffdf99, (g, mat) => {
          g.add(new THREE.Mesh(this._knobGeo, mat));
        });
        cornerHandle.group.position.copy(localToWorld(hw, hd));

        // Rotation knob
        const rotHandle = this._createHandleWidget('rotate', 0xa8dfa0, (g, mat) => {
          g.add(new THREE.Mesh(this._knobGeo, mat));
        });
        rotHandle.group.position.copy(localToWorld(0, hd + 1.05));
      }
    } else if (this.selectedType === 'wall' || Array.isArray(entity.points)) {
      this.selectedType = 'wall';
      const pts = entity.points || [];
      if (pts.length >= 2) {
        this._updateWallOutline(pts);
        const midIdx = Math.floor(pts.length * 0.5);
        const mp = pts[midIdx];
        const baseY = this.world?.getHeightAt?.(mp.x, mp.z) ?? 0;
        const wallH = entity.height ?? 2.6;

        const heightHandle = this._createHandleWidget('height', 0xfff5dc, (g, mat) => {
          const upCone = new THREE.Mesh(this._coneGeo, mat);
          upCone.position.y = 0.34;
          const downCone = new THREE.Mesh(this._coneGeo, mat);
          downCone.rotation.x = Math.PI;
          downCone.position.y = -0.34;
          const shaft = new THREE.Mesh(this._shaftGeo, mat);
          g.add(upCone, downCone, shaft);
        });
        heightHandle.group.position.set(mp.x, baseY + wallH + 0.85, mp.z);
      }
    }
  }

  _updateBuildingOutline(entity) {
    const attr = this._outlineGeom.getAttribute('position');
    const arr = attr.array;
    const x = entity.x ?? 0;
    const z = entity.z ?? 0;
    const rot = entity.rotation ?? 0;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const band = 0.11;

    for (let i = 0; i <= CURSOR_SEGMENTS; i++) {
      const t = (i / CURSOR_SEGMENTS) * Math.PI * 2;
      let lxInner;
      let lzInner;
      let lxOuter;
      let lzOuter;

      if (entity.type === 'tower') {
        const r = (entity.radius ?? 2.8) + 0.18;
        const c = Math.cos(t);
        const s = Math.sin(t);
        lxInner = c * r;
        lzInner = s * r;
        lxOuter = c * (r + band);
        lzOuter = s * (r + band);
      } else {
        // Superellipse / rounded rectangle perimeter around cottage OBB
        const hw = (entity.width ?? 5.5) * 0.5 + 0.2;
        const hd = (entity.depth ?? 4.5) * 0.5 + 0.2;
        const c = Math.cos(t);
        const s = Math.sin(t);
        const maxAxis = Math.max(Math.abs(c), Math.abs(s), 1e-4);
        const ux = c / maxAxis;
        const uz = s / maxAxis;
        lxInner = ux * hw;
        lzInner = uz * hd;
        lxOuter = ux * (hw + band);
        lzOuter = uz * (hd + band);
      }

      const wx0 = x + lxInner * cosR + lzInner * sinR;
      const wz0 = z - lxInner * sinR + lzInner * cosR;
      const wy0 = Math.max(this.world?.getHeightAt?.(wx0, wz0) ?? 0, this.waterLevel) + 0.08;

      const wx1 = x + lxOuter * cosR + lzOuter * sinR;
      const wz1 = z - lxOuter * sinR + lzOuter * cosR;
      const wy1 = Math.max(this.world?.getHeightAt?.(wx1, wz1) ?? 0, this.waterLevel) + 0.08;

      const base = i * 6;
      arr[base] = wx0;
      arr[base + 1] = wy0;
      arr[base + 2] = wz0;
      arr[base + 3] = wx1;
      arr[base + 4] = wy1;
      arr[base + 5] = wz1;
    }

    attr.needsUpdate = true;
    this._outlineMesh.visible = true;
  }

  _updateWallOutline(points) {
    const resampled = resamplePolylineXZ(points, 0.5);
    if (resampled.length < 2) {
      this._outlineMesh.visible = false;
      return;
    }
    const attr = this._outlineGeom.getAttribute('position');
    const arr = attr.array;
    const halfBand = 0.45;

    for (let i = 0; i <= CURSOR_SEGMENTS; i++) {
      const f = (i / CURSOR_SEGMENTS) * (resampled.length - 1);
      const idx = Math.min(resampled.length - 2, Math.floor(f));
      const frac = f - idx;
      const p0 = resampled[idx];
      const p1 = resampled[idx + 1];
      const px = THREE.MathUtils.lerp(p0.x, p1.x, frac);
      const pz = THREE.MathUtils.lerp(p0.z, p1.z, frac);
      let tx = p1.x - p0.x;
      let tz = p1.z - p0.z;
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      const nx = -tz;
      const nz = tx;

      const wx0 = px - nx * halfBand;
      const wz0 = pz - nz * halfBand;
      const wy0 = Math.max(this.world?.getHeightAt?.(wx0, wz0) ?? 0, this.waterLevel) + 0.08;

      const wx1 = px + nx * halfBand;
      const wz1 = pz + nz * halfBand;
      const wy1 = Math.max(this.world?.getHeightAt?.(wx1, wz1) ?? 0, this.waterLevel) + 0.08;

      const base = i * 6;
      arr[base] = wx0;
      arr[base + 1] = wy0;
      arr[base + 2] = wz0;
      arr[base + 3] = wx1;
      arr[base + 4] = wy1;
      arr[base + 5] = wz1;
    }
    attr.needsUpdate = true;
    this._outlineMesh.visible = true;
  }

  _normalizeOptions(raw = {}) {
    const o = raw || {};
    const terrainBrush = Number(o.terrainBrushSize ?? o.brushSize ?? o.radius ?? 6.0);
    const natureBrush = Number(o.natureBrushSize ?? o.brushSize ?? o.radius ?? 7.0);
    const demolishBrush = Number(o.demolishRadius ?? o.brushSize ?? o.radius ?? 3.0);
    let activeBrush = terrainBrush;
    if (this.activeTool === 'nature') activeBrush = natureBrush;
    else if (this.activeTool === 'demolish') activeBrush = demolishBrush;

    return {
      roofColor: o.roofColor || 'terracotta',
      wallStyle: o.wallStyle || (o.style && o.style !== 'cobble' && o.style !== 'dirt' && o.style !== 'timber' ? o.style : 'cotswold'),
      tudor: Boolean(o.tudor),
      crenellated: Boolean(o.crenellated),
      pathStyle: o.pathStyle || (o.style === 'dirt' || o.style === 'cobble' ? o.style : 'cobble'),
      pathWidth: THREE.MathUtils.clamp(Number(o.pathWidth ?? o.width ?? 2.2), 1.0, 6.0),
      clutterSubtype: o.clutterType || o.clutterSubtype || o.subtype || 'lantern',
      terrainMode: o.terrainMode || o.sculptMode || o.mode || 'raise',
      brushSize: THREE.MathUtils.clamp(activeBrush, 1.2, 18.0),
      demolishRadius: THREE.MathUtils.clamp(demolishBrush, 1.2, 10.0),
      brushStrength: THREE.MathUtils.clamp(
        Number(o.terrainStrength ?? o.brushStrength ?? o.strength ?? 1.0),
        0.1,
        3.0
      ),
      natureSubtype: o.natureType || o.natureSubtype || o.natureMode || o.subtype || 'trees',
    };
  }

  getNormalizedOptions() {
    return this._normalizeOptions(this.hud?.getToolOptions?.() || {});
  }

  setActiveTool(toolId) {
    if (!toolId) return;
    this.activeTool = toolId;
    this.arch?.setPreview?.(null);
    this._strokeMesh.visible = false;

    if (
      toolId !== 'select' &&
      toolId !== 'cottage' &&
      toolId !== 'tower' &&
      toolId !== 'wall'
    ) {
      this.clearSelection();
    } else {
      this._rebuildHandlesForSelection();
    }

    this._refreshHoverPreview();
  }

  setWalkMode(active) {
    this.walkMode = Boolean(active);
    if (this.walkMode) {
      this.arch?.setPreview?.(null);
      this._cursorMesh.visible = false;
      this._strokeMesh.visible = false;
      this.handlesGroup.visible = false;
      this.domElement.style.cursor = 'grab';
    } else {
      this.domElement.style.cursor = 'default';
      this._rebuildHandlesForSelection();
    }
  }

  setPhotoMode(active) {
    this.photoMode = Boolean(active);
    if (this.photoMode) {
      this.arch?.setPreview?.(null);
      this._cursorMesh.visible = false;
      this._strokeMesh.visible = false;
      this.handlesGroup.visible = false;
    } else {
      this._rebuildHandlesForSelection();
    }
  }

  selectEntity(id, entityType = null) {
    if (!id) {
      this.clearSelection();
      return;
    }
    const entity = this.arch?.getEntity?.(id);
    if (!entity) {
      this.clearSelection();
      return;
    }
    this.selectedId = id;
    this.selectedType =
      entityType ||
      (entity.type === 'cottage' || entity.type === 'tower' ? 'building' : 'wall');
    this._rebuildHandlesForSelection();
    this.hud?.showSelectionInspector?.(entity);
  }

  clearSelection() {
    this.selectedId = null;
    this.selectedType = null;
    this._clearDynamicHandles();
    this.handlesGroup.visible = false;
    this.hud?.showSelectionInspector?.(null);
  }

  getSelectedEntity() {
    if (!this.selectedId) return null;
    return this.arch?.getEntity?.(this.selectedId) || null;
  }

  deleteSelectedEntity(targetEntityOrNull = null) {
    const targetId = targetEntityOrNull?.id || this.selectedId;
    if (!targetId) return false;
    const entity = this.arch?.getEntity?.(targetId) || targetEntityOrNull;
    const bx = entity?.x ?? entity?.points?.[0]?.x ?? 0;
    const bz = entity?.z ?? entity?.points?.[0]?.z ?? 0;
    const by = (this.world?.getHeightAt?.(bx, bz) ?? 0) + 1.2;

    if (this.arch?.removeEntityById?.(targetId)) {
      this.clearSelection();
      this.world?.syncFootprints?.(this.arch.getFootprints());
      this.onLanternsChanged?.();
      this.world?.emitBurst?.(new THREE.Vector3(bx, by, bz), 'demolish');
      this.audio?.playDemolish?.();
      this.onCommitHistory?.();
      return true;
    }
    return false;
  }

  /**
   * Called when HUD tool/inspector options change (e.g. clicking a roof color swatch!).
   */
  onToolOptionsChanged(rawOpts) {
    const opts = this._normalizeOptions(rawOpts ?? this.hud?.getToolOptions?.());

    if (this.selectedId) {
      const entity = this.arch?.getEntity?.(this.selectedId);
      if (entity) {
        if (this.selectedType === 'building') {
          const patch = {};
          if (rawOpts?.roofColor !== undefined && rawOpts.roofColor !== entity.roofColor) {
            patch.roofColor = opts.roofColor;
          }
          if (
            (rawOpts?.wallStyle !== undefined || rawOpts?.style !== undefined) &&
            opts.wallStyle !== entity.wallStyle
          ) {
            patch.wallStyle = opts.wallStyle;
          }
          if (rawOpts?.tudor !== undefined && Boolean(rawOpts.tudor) !== Boolean(entity.tudor)) {
            patch.tudor = Boolean(rawOpts.tudor);
          }
          if (
            rawOpts?.crenellated !== undefined &&
            Boolean(rawOpts.crenellated) !== Boolean(entity.crenellated)
          ) {
            patch.crenellated = Boolean(rawOpts.crenellated);
          }

          if (Object.keys(patch).length > 0) {
            this.arch.updateBuilding(this.selectedId, patch);
            this.world?.syncFootprints?.(this.arch.getFootprints());
            this.onLanternsChanged?.();
            this.audio?.playRoofClick?.();
            this._rebuildHandlesForSelection();
            this.hud?.showSelectionInspector?.(this.arch.getEntity(this.selectedId));
            this.onCommitHistory?.();
          }
        } else if (this.selectedType === 'wall') {
          const patch = {};
          if (rawOpts?.wallStyle !== undefined || rawOpts?.style !== undefined) {
            patch.wallStyle = opts.wallStyle;
            patch.style = opts.wallStyle;
          }
          if (rawOpts?.crenellated !== undefined) {
            patch.crenellated = Boolean(rawOpts.crenellated);
          }
          if (Object.keys(patch).length > 0) {
            this.arch.updateWall(this.selectedId, patch);
            this.arch.setPaths(this.world.getPaths());
            this.audio?.playBrickPop?.(0);
            this._rebuildHandlesForSelection();
            this.hud?.showSelectionInspector?.(this.arch.getEntity(this.selectedId));
            this.onCommitHistory?.();
          }
        }
      }
    }

    this._refreshHoverPreview();
  }

  _bindEvents() {
    this._onPointerDown = (e) => {
      this.audio?.unlock?.();
      if (this.walkMode || this.photoMode) return;
      if (e.button !== 0 || e.altKey) return; // Right/Middle/Alt-Left belong to CameraController

      this._updateRaycasterFromEvent(e);
      this._downClientX = e.clientX;
      this._downClientY = e.clientY;
      this._lastClientX = e.clientX;
      this._lastClientY = e.clientY;
      this._activePointerId = e.pointerId;

      // 1. Check 3D manipulation handles first whenever visible!
      if (this.handlesGroup.visible && this._handleHitProxies.length > 0) {
        const handleHits = this._raycaster.intersectObjects(this._handleHitProxies, false);
        if (handleHits.length > 0) {
          e.preventDefault();
          this._beginHandleDrag(handleHits[0].object.userData, e);
          return;
        }
      }

      // 2. Dispatch by active tool
      switch (this.activeTool) {
        case 'select':
          this._handleSelectPointerDown(e);
          break;
        case 'cottage':
        case 'tower':
          this._handleBuildingPointerDown(e);
          break;
        case 'wall':
        case 'fence':
        case 'path':
          this._beginSplineStroke(e);
          break;
        case 'terrain':
          this._beginTerrainSculpt(e);
          break;
        case 'nature':
          this._beginNaturePaint(e);
          break;
        case 'clutter':
          this._handleClutterPlacement(e);
          break;
        case 'demolish':
          this._beginDemolish(e);
          break;
        default:
          break;
      }
    };

    this._onPointerMove = (e) => {
      if (this.walkMode || this.photoMode) return;
      this._pointerInCanvas = true;
      this._lastClientX = e.clientX;
      this._lastClientY = e.clientY;
      this._updateRaycasterFromEvent(e);

      if (this._interactionState === 'handle-drag' && e.pointerId === this._activePointerId) {
        this._updateHandleDrag();
        return;
      }

      if (this._interactionState === 'spline-draw' && e.pointerId === this._activePointerId) {
        this._updateSplineStroke();
        return;
      }

      if (this._interactionState === 'sculpt' && e.pointerId === this._activePointerId) {
        const hit = this._raycastTerrainClamped();
        if (hit) {
          this._brushWorldPos.copy(hit);
          this._hasBrushPos = true;
          this._updateCursorRingAt(hit.x, hit.z);
        }
        return;
      }

      if (this._interactionState === 'nature' && e.pointerId === this._activePointerId) {
        this._continueNaturePaint();
        return;
      }

      if (this._interactionState === 'demolish' && e.pointerId === this._activePointerId) {
        this._continueDemolish();
        return;
      }

      // Idle hover feedback
      if (!this.cameraController?.isDragging?.()) {
        this._updateHandleHover();
        this._refreshHoverPreview();
      }
    };

    this._onPointerUp = (e) => {
      if (e.pointerId !== this._activePointerId) return;
      this._finishActiveInteraction(e);
    };

    this._onPointerLeave = () => {
      this._pointerInCanvas = false;
      if (this._interactionState === 'idle') {
        this._cursorMesh.visible = false;
        this.arch?.setPreview?.(null);
      }
    };

    this._onKeyDown = (e) => {
      if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (this.walkMode) return;

      if (e.code === 'BracketLeft') {
        this.previewRotation -= Math.PI / 12;
        this._refreshHoverPreview();
      } else if (e.code === 'BracketRight') {
        this.previewRotation += Math.PI / 12;
        this._refreshHoverPreview();
      } else if ((e.code === 'Delete' || e.code === 'Backspace') && !e.defaultPrevented && this.selectedId) {
        this.deleteSelectedEntity();
      } else if (e.code === 'Escape') {
        if (this._interactionState === 'spline-draw') {
          this._strokePoints.length = 0;
          this._strokeMesh.visible = false;
          this.arch?.setPreview?.(null);
          this._interactionState = 'idle';
        } else if (this.selectedId) {
          this.clearSelection();
        }
      }
    };

    this.domElement.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
    this.domElement.addEventListener('pointerleave', this._onPointerLeave);
    window.addEventListener('keydown', this._onKeyDown);
  }

  _capturePointer(pointerId) {
    try {
      this.domElement.setPointerCapture(pointerId);
    } catch {
      // Synthetic pointer events in automated browsers may skip capture.
    }
  }

  _releasePointer(pointerId) {
    try {
      if (this.domElement.hasPointerCapture?.(pointerId)) {
        this.domElement.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignore release errors.
    }
  }

  _updateRaycasterFromEvent(e) {
    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this._pointerNDC.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this._raycaster.setFromCamera(this._pointerNDC, this.camera);
  }

  _raycastTerrainClamped() {
    let hit = this.world?.raycastTerrain?.(this._raycaster);
    if (!hit) {
      this._horizPlane.constant = -this.waterLevel;
      if (this._raycaster.ray.intersectPlane(this._horizPlane, this._planeFallbackHit)) {
        hit = this._planeFallbackHit;
      }
    }
    if (!hit) return null;
    return this._clampedTerrainHit.set(
      THREE.MathUtils.clamp(hit.x, -this.worldHalfBound, this.worldHalfBound),
      hit.y,
      THREE.MathUtils.clamp(hit.z, -this.worldHalfBound, this.worldHalfBound)
    );
  }

  getHandleScreenPositions() {
    if (!this.handlesGroup.visible || this._handleEntries.length === 0) return [];
    const rect = this.domElement.getBoundingClientRect();
    const out = [];
    for (const entry of this._handleEntries) {
      const worldPos = entry.group.position.clone();
      const ndc = worldPos.clone().project(this.camera);
      out.push({
        handleType: entry.handleType,
        x: rect.left + (ndc.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-ndc.y * 0.5 + 0.5) * rect.height,
        worldPos,
      });
    }
    return out;
  }

  _updateHandleHover() {
    if (!this.handlesGroup.visible || this._handleHitProxies.length === 0) {
      if (this._hoveredHandleType) {
        this._hoveredHandleType = null;
        this.domElement.style.cursor = 'default';
      }
      return;
    }

    const hits = this._raycaster.intersectObjects(this._handleHitProxies, false);
    const hoveredGroup = hits.length > 0 ? hits[0].object.userData.parentGroup : null;
    const hoveredType = hits.length > 0 ? hits[0].object.userData.handleType : null;

    for (const entry of this._handleEntries) {
      const isHover = entry.group === hoveredGroup;
      entry.group.scale.setScalar(isHover ? 1.22 : 1.0);
      entry.mat.color.setHex(isHover ? 0xffffff : entry.baseColor);
    }

    this._hoveredHandleType = hoveredType;
    if (hoveredType === 'height' || hoveredType === 'roof') {
      this.domElement.style.cursor = 'ns-resize';
    } else if (
      hoveredType === 'radius' ||
      hoveredType === 'width' ||
      hoveredType === 'depth'
    ) {
      this.domElement.style.cursor = 'ew-resize';
    } else if (hoveredType === 'rotate') {
      this.domElement.style.cursor = 'grab';
    } else {
      this.domElement.style.cursor = 'default';
    }
  }

  _refreshHoverPreview() {
    if (!this._pointerInCanvas || this.walkMode || this.photoMode) {
      this._cursorMesh.visible = false;
      this.arch?.setPreview?.(null);
      return;
    }

    if (this._hoveredHandleType) {
      this._cursorMesh.visible = false;
      this.arch?.setPreview?.(null);
      return;
    }

    const opts = this.getNormalizedOptions();
    const terrainPt = this._raycastTerrainClamped();

    if (
      this.activeTool === 'terrain' ||
      this.activeTool === 'nature' ||
      this.activeTool === 'path' ||
      this.activeTool === 'demolish'
    ) {
      this.arch?.setPreview?.(null);
      if (terrainPt) {
        this._updateCursorRingAt(terrainPt.x, terrainPt.z, opts);
      } else {
        this._cursorMesh.visible = false;
      }
      return;
    }

    if (this.activeTool === 'wall' || this.activeTool === 'fence') {
      if (terrainPt) {
        this._updateCursorRingAt(terrainPt.x, terrainPt.z, { ...opts, brushSize: 0.65 });
      }
      this.arch?.setPreview?.(null);
      return;
    }

    this._cursorMesh.visible = false;

    if (this.activeTool === 'cottage' || this.activeTool === 'tower') {
      if (!terrainPt) {
        this.arch?.setPreview?.(null);
        return;
      }
      this.arch?.setPreview?.({
        type: this.activeTool,
        x: terrainPt.x,
        z: terrainPt.z,
        rotation: this.previewRotation,
        width: 5.5,
        depth: 4.5,
        radius: 2.8,
        height: this.activeTool === 'tower' ? 5.6 : 3.8,
        roofHeight: this.activeTool === 'tower' ? 3.8 : 3.0,
        roofCurve: 0.25,
        roofColor: opts.roofColor,
        wallStyle: opts.wallStyle,
        crenellated: opts.crenellated,
        tudor: opts.tudor,
      });
      return;
    }

    if (this.activeTool === 'clutter') {
      const spec = this._computeClutterPlacementSpec(opts);
      this.arch?.setPreview?.(spec ? { ...spec, isPreview: true } : null);
      return;
    }

    this.arch?.setPreview?.(null);
  }

  _updateCursorRingAt(cx, cz, optsOverride = null) {
    const opts = optsOverride || this.getNormalizedOptions();
    let radius = opts.brushSize;
    let colorHex = 0xffefc2;

    if (this.activeTool === 'path') {
      radius = opts.pathWidth * 0.5;
      colorHex = 0xf5d38e;
    } else if (this.activeTool === 'terrain') {
      radius = opts.brushSize;
      colorHex = opts.terrainMode === 'pond' ? 0x8ce2eb : 0xffefc2;
    } else if (this.activeTool === 'nature') {
      radius = opts.brushSize;
      colorHex = opts.natureSubtype === 'clear' ? 0xf09a7e : 0xd5f2b6;
    } else if (this.activeTool === 'demolish') {
      radius = opts.demolishRadius;
      colorHex = 0xf28d72;
    } else if (this.activeTool === 'wall' || this.activeTool === 'fence') {
      radius = 0.55;
      colorHex = 0xf5dfb0;
    }

    this._cursorMat.color.setHex(colorHex);
    const bandWidth = Math.max(0.08, Math.min(0.18, radius * 0.045));
    const innerR = Math.max(0.08, radius - bandWidth * 0.5);
    const outerR = radius + bandWidth * 0.5;

    const attr = this._cursorGeom.getAttribute('position');
    const arr = attr.array;

    for (let i = 0; i <= CURSOR_SEGMENTS; i++) {
      const a = (i / CURSOR_SEGMENTS) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);

      const x0 = cx + c * innerR;
      const z0 = cz + s * innerR;
      const y0 = Math.max(this.world?.getHeightAt?.(x0, z0) ?? 0, this.waterLevel) + 0.07;

      const x1 = cx + c * outerR;
      const z1 = cz + s * outerR;
      const y1 = Math.max(this.world?.getHeightAt?.(x1, z1) ?? 0, this.waterLevel) + 0.07;

      const idx = i * 6;
      arr[idx] = x0;
      arr[idx + 1] = y0;
      arr[idx + 2] = z0;
      arr[idx + 3] = x1;
      arr[idx + 4] = y1;
      arr[idx + 5] = z1;
    }

    attr.needsUpdate = true;
    this._cursorMesh.visible = true;
  }

  // =========================================================================
  // 1. 3D HANDLE DRAGGING
  // =========================================================================
  _beginHandleDrag(handleData, e) {
    const entity = this.arch?.getEntity?.(this.selectedId);
    if (!entity) return;

    this._capturePointer(e.pointerId);
    this._interactionState = 'handle-drag';
    this._activeHandle = handleData.handleType;
    this._handleAudioStep = 0;
    this._handleInitialEntity = JSON.parse(JSON.stringify(entity));

    const anchor = handleData.parentGroup.position.clone();
    this.camera.getWorldDirection(this._camDir);

    if (this._activeHandle === 'height' || this._activeHandle === 'roof') {
      // Vertical plane facing camera horizontally
      const horizNormal = new THREE.Vector3(this._camDir.x, 0, this._camDir.z);
      if (horizNormal.lengthSq() < 1e-4) horizNormal.set(0, 0, 1);
      horizNormal.normalize();
      this._handleDragPlane.setFromNormalAndCoplanarPoint(horizNormal, anchor);
    } else {
      // Horizontal plane through handle base
      this._handleDragPlane.setFromNormalAndCoplanarPoint(
        new THREE.Vector3(0, 1, 0),
        anchor
      );
    }

    if (!this._raycaster.ray.intersectPlane(this._handleDragPlane, this._handleStartHit)) {
      this._handleStartHit.copy(anchor);
    }
    this.domElement.style.cursor = 'grabbing';
  }

  _updateHandleDrag() {
    if (!this._activeHandle || !this.selectedId || !this._handleInitialEntity) return;
    if (!this._raycaster.ray.intersectPlane(this._handleDragPlane, this._handleCurrHit)) return;

    const init = this._handleInitialEntity;
    const delta = this._tmpVecA.subVectors(this._handleCurrHit, this._handleStartHit);

    if (this.selectedType === 'building') {
      const cx = init.x ?? 0;
      const cz = init.z ?? 0;
      const rot = init.rotation ?? 0;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const patch = {};
      let stepMetric = 0;

      if (this._activeHandle === 'height') {
        const nextH = THREE.MathUtils.clamp((init.height ?? 3.8) + delta.y, 1.8, 13.5);
        patch.height = nextH;
        stepMetric = Math.floor(Math.abs(nextH - (init.height ?? 3.8)) / 0.25);
      } else if (this._activeHandle === 'roof') {
        const nextRoofH = THREE.MathUtils.clamp((init.roofHeight ?? 3.0) + delta.y, 0.55, 9.5);
        this.camera.getWorldDirection(this._camDir);
        this._camRight.crossVectors(this._camDir, this.camera.up).normalize();
        const horizDelta = delta.dot(this._camRight);
        const nextCurve = THREE.MathUtils.clamp(
          (init.roofCurve ?? 0.25) + horizDelta * 0.22,
          -0.5,
          0.85
        );
        patch.roofHeight = nextRoofH;
        patch.roofCurve = nextCurve;
        stepMetric = Math.floor(
          (Math.abs(nextRoofH - (init.roofHeight ?? 3.0)) + Math.abs(horizDelta) * 0.5) / 0.24
        );
      } else if (this._activeHandle === 'radius') {
        const startDist = Math.max(
          0.5,
          Math.hypot(this._handleStartHit.x - cx, this._handleStartHit.z - cz)
        );
        const currDist = Math.max(
          0.5,
          Math.hypot(this._handleCurrHit.x - cx, this._handleCurrHit.z - cz)
        );
        const ratio = currDist / startDist;
        if (init.type === 'tower') {
          const nextR = THREE.MathUtils.clamp(
            (init.radius ?? 2.8) + (currDist - startDist),
            1.4,
            8.0
          );
          patch.radius = nextR;
          stepMetric = Math.floor(Math.abs(nextR - (init.radius ?? 2.8)) / 0.22);
        } else {
          patch.width = THREE.MathUtils.clamp((init.width ?? 5.5) * ratio, 2.6, 15.0);
          patch.depth = THREE.MathUtils.clamp((init.depth ?? 4.5) * ratio, 2.6, 15.0);
          stepMetric = Math.floor(Math.abs(patch.width - (init.width ?? 5.5)) / 0.25);
        }
      } else if (this._activeHandle === 'width') {
        const relStart =
          (this._handleStartHit.x - cx) * cosR - (this._handleStartHit.z - cz) * sinR;
        const relCurr =
          (this._handleCurrHit.x - cx) * cosR - (this._handleCurrHit.z - cz) * sinR;
        const deltaW = ( Math.abs(relCurr) - Math.abs(relStart) ) * 2;
        patch.width = THREE.MathUtils.clamp((init.width ?? 5.5) + deltaW, 2.6, 15.0);
        stepMetric = Math.floor(Math.abs(patch.width - (init.width ?? 5.5)) / 0.25);
      } else if (this._activeHandle === 'depth') {
        const relStart =
          (this._handleStartHit.x - cx) * sinR + (this._handleStartHit.z - cz) * cosR;
        const relCurr =
          (this._handleCurrHit.x - cx) * sinR + (this._handleCurrHit.z - cz) * cosR;
        const deltaD = ( Math.abs(relCurr) - Math.abs(relStart) ) * 2;
        patch.depth = THREE.MathUtils.clamp((init.depth ?? 4.5) + deltaD, 2.6, 15.0);
        stepMetric = Math.floor(Math.abs(patch.depth - (init.depth ?? 4.5)) / 0.25);
      } else if (this._activeHandle === 'rotate') {
        const a0 = Math.atan2(this._handleStartHit.x - cx, this._handleStartHit.z - cz);
        const a1 = Math.atan2(this._handleCurrHit.x - cx, this._handleCurrHit.z - cz);
        patch.rotation = (init.rotation ?? 0) + (a1 - a0);
        stepMetric = Math.floor(Math.abs(a1 - a0) / 0.14);
      }

      this._pendingEntityPatch = { kind: 'building', id: this.selectedId, patch, stepMetric };
    } else if (this.selectedType === 'wall' && this._activeHandle === 'height') {
      const nextH = THREE.MathUtils.clamp((init.height ?? 2.6) + delta.y, 0.75, 7.2);
      const stepMetric = Math.floor(Math.abs(nextH - (init.height ?? 2.6)) / 0.22);
      this._pendingEntityPatch = {
        kind: 'wall',
        id: this.selectedId,
        patch: { height: nextH },
        stepMetric,
      };
    }
  }

  _flushPendingEntityPatch() {
    if (!this._pendingEntityPatch) return;
    const { kind, id, patch, stepMetric } = this._pendingEntityPatch;
    this._pendingEntityPatch = null;

    if (kind === 'building') {
      this.arch.updateBuilding(id, patch);
    } else if (kind === 'wall') {
      this.arch.updateWall(id, patch);
      this.arch.setPaths(this.world.getPaths());
    }

    this.world?.syncFootprints?.(this.arch.getFootprints());
    this.onLanternsChanged?.();
    this._rebuildHandlesForSelection();

    if (stepMetric !== this._handleAudioStep) {
      this._handleAudioStep = stepMetric;
      if (this._activeHandle === 'roof') {
        this.audio?.playRoofClick?.();
      } else {
        this.audio?.playBrickPop?.(Math.abs(stepMetric));
      }
    }
  }

  // =========================================================================
  // 2. SELECT / PET SHEEP / EMPTY-GROUND ORBIT
  // =========================================================================
  _handleSelectPointerDown(e) {
    // 1. Check creatures first or architecture depending on closest hit!
    const archHit = this.arch?.raycast?.(this._raycaster);
    const creatureHit = this.world?.interactCreature?.(this._raycaster);

    if (creatureHit) {
      if (creatureHit.type === 'sheep') {
        this.audio?.playSheepBleat?.();
        this.hud?.showToast?.('Baa! The sheep hops happily.');
      } else {
        this.audio?.playWaterSplash?.();
        if (creatureHit.position) {
          this.pipeline?.water?.addRipple?.(creatureHit.position.x, creatureHit.position.z, 0.85);
        }
        this.hud?.showToast?.('Gentle ripples spread across the pond.');
      }
      return;
    }

    if (archHit && (archHit.entityType === 'building' || archHit.entityType === 'wall')) {
      this.selectEntity(archHit.id, archHit.entityType);
      this.audio?.playUiTick?.();
      return;
    }

    // Clicked empty ground or pond -> deselect & hand off left-drag to CameraController orbit!
    if (this.selectedId) {
      this.clearSelection();
    }
    const terrainPt = this._raycastTerrainClamped();
    if (terrainPt && (this.world?.getHeightAt?.(terrainPt.x, terrainPt.z) ?? 0) < this.waterLevel) {
      this.pipeline?.water?.addRipple?.(terrainPt.x, terrainPt.z, 0.75);
    }
    this.cameraController?.beginExternalOrbitDrag?.(e);
  }

  // =========================================================================
  // 3. COTTAGE & TOWER PLACEMENT (OR CLICK-TO-SELECT)
  // =========================================================================
  _handleBuildingPointerDown(e) {
    const archHit = this.arch?.raycast?.(this._raycaster);
    // If clicking right near the center of an existing building without Shift, select it so handles appear!
    if (archHit && archHit.entityType === 'building' && !e.shiftKey) {
      const ent = archHit.entity || this.arch.getEntity(archHit.id);
      if (ent) {
        const distToCenter = Math.hypot(
          (archHit.point?.x ?? 0) - (ent.x ?? 0),
          (archHit.point?.z ?? 0) - (ent.z ?? 0)
        );
        if (distToCenter < 1.75) {
          this.selectEntity(archHit.id, 'building');
          this.audio?.playUiTick?.();
          return;
        }
      }
    }

    const terrainPt = this._raycastTerrainClamped();
    if (!terrainPt) return;

    const opts = this.getNormalizedOptions();
    const isTower = this.activeTool === 'tower';
    const spec = {
      type: isTower ? 'tower' : 'cottage',
      x: terrainPt.x,
      z: terrainPt.z,
      rotation: this.previewRotation,
      width: 5.5,
      depth: 4.5,
      radius: 2.8,
      height: isTower ? 5.6 : 3.8,
      roofHeight: isTower ? 3.8 : 3.0,
      roofCurve: 0.25,
      roofColor: opts.roofColor,
      wallStyle: opts.wallStyle,
      crenellated: opts.crenellated,
      tudor: opts.tudor,
    };

    this.arch.setPreview(null);
    const newId = this.arch.addBuilding(spec);
    this.world?.syncFootprints?.(this.arch.getFootprints());
    this.onLanternsChanged?.();

    const groundY = this.world?.getHeightAt?.(terrainPt.x, terrainPt.z) ?? 0;
    this.world?.emitBurst?.(new THREE.Vector3(terrainPt.x, groundY + 0.6, terrainPt.z), 'build');
    this.audio?.playBrickPop?.(0);
    this.audio?.playBuildComplete?.();

    if (newId) {
      this.selectEntity(newId, 'building');
    }
    this.onCommitHistory?.();
  }

  // =========================================================================
  // 4. SPLINE DRAWING ('wall', 'fence', 'path')
  // =========================================================================
  _beginSplineStroke(e) {
    // Allow clicking an existing wall in `wall` mode to select it if user doesn't drag
    const archHit =
      this.activeTool === 'wall' ? this.arch?.raycast?.(this._raycaster) : null;
    this._potentialWallSelectId =
      archHit && archHit.entityType === 'wall' ? archHit.id : null;

    const terrainPt = this._raycastTerrainClamped();
    if (!terrainPt) return;

    this._capturePointer(e.pointerId);
    this._interactionState = 'spline-draw';
    this._strokePoints = [{ x: terrainPt.x, z: terrainPt.z }];
    this._strokeCursorPoint = { x: terrainPt.x, z: terrainPt.z };
    this._strokeAudioCount = 0;
    this._cursorMesh.visible = false;
  }

  _updateSplineStroke() {
    const terrainPt = this._raycastTerrainClamped();
    if (!terrainPt || this._strokePoints.length === 0) return;

    this._strokeCursorPoint = { x: terrainPt.x, z: terrainPt.z };
    const lastPt = this._strokePoints[this._strokePoints.length - 1];
    const dist = Math.hypot(terrainPt.x - lastPt.x, terrainPt.z - lastPt.z);

    if (dist >= 1.0) {
      const steps = Math.min(12, Math.floor(dist / 1.0));
      for (let i = 1; i <= steps; i++) {
        const t = (i * 1.0) / dist;
        this._strokePoints.push({
          x: THREE.MathUtils.lerp(lastPt.x, terrainPt.x, t),
          z: THREE.MathUtils.lerp(lastPt.z, terrainPt.z, t),
        });
        this._strokeAudioCount++;
        if (this.activeTool === 'path') {
          this.audio?.playPathStroke?.();
        } else {
          this.audio?.playBrickPop?.(this._strokeAudioCount);
        }
      }
    }

    const previewPts = [...this._strokePoints];
    const tail = previewPts[previewPts.length - 1];
    if (Math.hypot(terrainPt.x - tail.x, terrainPt.z - tail.z) > 0.15) {
      previewPts.push({ x: terrainPt.x, z: terrainPt.z });
    }

    const opts = this.getNormalizedOptions();
    if (previewPts.length >= 2) {
      this._updateStrokeRibbonGeometry(
        previewPts,
        this.activeTool === 'path' ? opts.pathWidth : 0.75
      );
      if (this.activeTool === 'wall' || this.activeTool === 'fence') {
        this.arch?.setPreview?.({
          type: this.activeTool,
          points: resamplePolylineXZ(previewPts, 1.0),
          wallStyle: opts.wallStyle,
          style: opts.wallStyle,
          height: this.activeTool === 'fence' ? 1.15 : 2.7,
          crenellated: opts.crenellated,
        });
      }
    }
  }

  _updateStrokeRibbonGeometry(points, width) {
    const resampled = resamplePolylineXZ(points, 0.75);
    const count = Math.min(MAX_STROKE_VERTS, resampled.length);
    if (count < 2) {
      this._strokeMesh.visible = false;
      return;
    }

    const halfW = width * 0.5;
    const attr = this._strokeGeom.getAttribute('position');
    const arr = attr.array;

    for (let i = 0; i < count; i++) {
      const p = resampled[i];
      const pPrev = resampled[Math.max(0, i - 1)];
      const pNext = resampled[Math.min(count - 1, i + 1)];
      let tx = pNext.x - pPrev.x;
      let tz = pNext.z - pPrev.z;
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      const nx = -tz;
      const nz = tx;

      const x0 = p.x - nx * halfW;
      const z0 = p.z - nz * halfW;
      const y0 = Math.max(this.world?.getHeightAt?.(x0, z0) ?? 0, this.waterLevel) + 0.09;

      const x1 = p.x + nx * halfW;
      const z1 = p.z + nz * halfW;
      const y1 = Math.max(this.world?.getHeightAt?.(x1, z1) ?? 0, this.waterLevel) + 0.09;

      const base = i * 6;
      arr[base] = x0;
      arr[base + 1] = y0;
      arr[base + 2] = z0;
      arr[base + 3] = x1;
      arr[base + 4] = y1;
      arr[base + 5] = z1;
    }

    attr.needsUpdate = true;
    this._strokeGeom.setDrawRange(0, (count - 1) * 6);
    this._strokeMesh.visible = true;
  }

  _commitSplineStroke() {
    this._strokeMesh.visible = false;
    this.arch?.setPreview?.(null);

    const pts = [...this._strokePoints];
    if (this._strokeCursorPoint && pts.length > 0) {
      const last = pts[pts.length - 1];
      if (Math.hypot(this._strokeCursorPoint.x - last.x, this._strokeCursorPoint.z - last.z) > 0.15) {
        pts.push(this._strokeCursorPoint);
      }
    }
    this._strokePoints = [];
    this._strokeCursorPoint = null;

    let totalLen = 0;
    for (let i = 1; i < pts.length; i++) {
      totalLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    }

    if (totalLen < 0.75) {
      if (this._potentialWallSelectId) {
        this.selectEntity(this._potentialWallSelectId, 'wall');
        this.audio?.playUiTick?.();
      }
      this._potentialWallSelectId = null;
      return;
    }
    this._potentialWallSelectId = null;

    const finalPts = resamplePolylineXZ(pts, 1.0);
    const opts = this.getNormalizedOptions();
    const midPt = finalPts[Math.floor(finalPts.length * 0.5)];
    const midY = Math.max(this.world?.getHeightAt?.(midPt.x, midPt.z) ?? 0, this.waterLevel);

    if (this.activeTool === 'wall' || this.activeTool === 'fence') {
      const wallId = this.arch.addWall(finalPts, {
        type: this.activeTool,
        wallStyle: opts.wallStyle,
        style: opts.wallStyle,
        height: this.activeTool === 'fence' ? 1.15 : 2.75,
        crenellated: this.activeTool === 'wall' ? opts.crenellated : false,
      });
      // Immediately open 3D stone archways where drawn across existing paths!
      this.arch.setPaths(this.world.getPaths());
      this.world?.syncFootprints?.(this.arch.getFootprints());
      this.onLanternsChanged?.();
      this.world?.emitBurst?.(new THREE.Vector3(midPt.x, midY + 1.0, midPt.z), 'build');
      this.audio?.playBuildComplete?.();
      if (wallId && this.activeTool === 'wall') {
        this.selectEntity(wallId, 'wall');
      }
      this.onCommitHistory?.();
    } else if (this.activeTool === 'path') {
      this.world.addPath(finalPts, {
        width: opts.pathWidth,
        style: opts.pathStyle,
      });
      // Re-adapt walls & foundations to smoothed path bed, carve wall archways & build water bridges!
      this.arch.onTerrainChanged(null);
      this.arch.setPaths(this.world.getPaths());
      this.pipeline?.water?.updateTerrainTexture?.(this.world.getHeightDataTexture(), 120);
      this.world?.syncFootprints?.(this.arch.getFootprints());
      this.onLanternsChanged?.();
      this.world?.emitBurst?.(new THREE.Vector3(midPt.x, midY + 0.4, midPt.z), 'build');
      this.audio?.playBuildComplete?.();
      this.onCommitHistory?.();
    }
  }

  // =========================================================================
  // 5. TERRAIN & POND SCULPTING
  // =========================================================================
  _beginTerrainSculpt(e) {
    const hit = this._raycastTerrainClamped();
    if (!hit) return;
    this._capturePointer(e.pointerId);
    this._interactionState = 'sculpt';
    this._brushWorldPos.copy(hit);
    this._hasBrushPos = true;
    this._strokeMutated = false;
    this._sculptArchSyncTimer = 0;
    this._brushAudioTimer = 0;
    // Apply an immediate initial sculpt pulse on click
    this._applyTerrainSculptStep(0.032);
  }

  _applyTerrainSculptStep(dt) {
    if (!this._hasBrushPos) return;
    const opts = this.getNormalizedOptions();
    const x = this._brushWorldPos.x;
    const z = this._brushWorldPos.z;
    const radius = opts.brushSize;
    const mode = opts.terrainMode;

    const changed = this.world?.sculpt?.(x, z, radius, opts.brushStrength, mode, dt);
    if (!changed) return;

    this._strokeMutated = true;
    this.pipeline?.water?.updateTerrainTexture?.(this.world.getHeightDataTexture(), 120);
    this._updateCursorRingAt(x, z, opts);

    this._sculptArchSyncTimer += dt;
    if (this._sculptArchSyncTimer >= 0.095) {
      this._sculptArchSyncTimer = 0;
      const pad = radius + 2.5;
      this.arch?.onTerrainChanged?.({
        minX: x - pad,
        maxX: x + pad,
        minZ: z - pad,
        maxZ: z + pad,
      });
    }

    this._brushAudioTimer += dt;
    if (this._brushAudioTimer >= 0.24) {
      this._brushAudioTimer = 0;
      const h = this.world?.getHeightAt?.(x, z) ?? 0;
      if (mode === 'pond' || h < this.waterLevel + 0.08) {
        this.audio?.playWaterSplash?.();
        this.pipeline?.water?.addRipple?.(x, z, 0.9);
        this.world?.emitBurst?.(new THREE.Vector3(x, this.waterLevel + 0.08, z), 'splash');
      } else {
        this.audio?.playPathStroke?.();
      }
    }
  }

  // =========================================================================
  // 6. NATURE PAINTING ('trees', 'flowers', 'clear')
  // =========================================================================
  _beginNaturePaint(e) {
    const hit = this._raycastTerrainClamped();
    if (!hit) return;
    this._capturePointer(e.pointerId);
    this._interactionState = 'nature';
    this._strokeMutated = false;
    this._lastNaturePaintPos.set(9999, 0, 9999);
    this._applyNatureAt(hit);
  }

  _continueNaturePaint() {
    const hit = this._raycastTerrainClamped();
    if (!hit) return;
    this._updateCursorRingAt(hit.x, hit.z);
    const opts = this.getNormalizedOptions();
    const minSpacing = Math.max(1.4, opts.brushSize * 0.38);
    if (Math.hypot(hit.x - this._lastNaturePaintPos.x, hit.z - this._lastNaturePaintPos.z) >= minSpacing) {
      this._applyNatureAt(hit);
    }
  }

  _applyNatureAt(hit) {
    const opts = this.getNormalizedOptions();
    this._lastNaturePaintPos.copy(hit);
    const r = opts.brushSize;
    const y = Math.max(this.world?.getHeightAt?.(hit.x, hit.z) ?? 0, this.waterLevel);

    if (opts.natureSubtype === 'clear') {
      this.world?.clearNatureAt?.(hit.x, hit.z, r);
      this.audio?.playDemolish?.();
      this.world?.emitBurst?.(new THREE.Vector3(hit.x, y + 0.4, hit.z), 'demolish');
    } else if (opts.natureSubtype === 'flowers') {
      this.world?.paintFlowers?.(hit.x, hit.z, r, 0.85);
      this.audio?.playPathStroke?.();
    } else {
      const count = Math.max(1, Math.min(6, Math.round(r * 0.42)));
      this.world?.paintTrees?.(hit.x, hit.z, r, count);
      this.audio?.playBrickPop?.(0);
      this.world?.emitBurst?.(new THREE.Vector3(hit.x, y + 0.6, hit.z), 'build');
    }
    this._strokeMutated = true;
  }

  // =========================================================================
  // 7. CLUTTER PLACEMENT ('lantern', 'window', 'door', 'chimney', 'flag', 'flowerbox', 'bench', 'ivy')
  // =========================================================================
  _computeClutterPlacementSpec(opts) {
    const subtype = opts.clutterSubtype;
    const archHit = this.arch?.raycast?.(this._raycaster);

    if (archHit && archHit.point) {
      const normal = archHit.normal ? archHit.normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
      const horizMag = Math.hypot(normal.x, normal.z);
      const wallMounted = horizMag > 0.45 && Math.abs(normal.y) < 0.72;
      const horizRot = horizMag > 0.12 ? Math.atan2(normal.x, normal.z) : this.previewRotation;
      return {
        type: subtype,
        subtype,
        clutterType: subtype,
        x: archHit.point.x,
        y: archHit.point.y,
        z: archHit.point.z,
        position: archHit.point.clone(),
        normal,
        rotation: horizRot,
        wallMounted,
        hostId: archHit.id,
        hostType: archHit.entityType,
        surface: normal.y > 0.55 ? 'roof' : 'wall',
      };
    }

    const terrainPt = this._raycastTerrainClamped();
    if (!terrainPt) return null;
    const groundY = this.world?.getHeightAt?.(terrainPt.x, terrainPt.z) ?? 0;

    return {
      type: subtype,
      subtype,
      clutterType: subtype,
      x: terrainPt.x,
      y: groundY,
      z: terrainPt.z,
      position: new THREE.Vector3(terrainPt.x, groundY, terrainPt.z),
      normal: new THREE.Vector3(0, 1, 0),
      rotation: this.previewRotation,
      hostId: null,
      hostType: 'terrain',
      surface: 'ground',
    };
  }

  _handleClutterPlacement() {
    const opts = this.getNormalizedOptions();
    const spec = this._computeClutterPlacementSpec(opts);
    if (!spec) return;

    if (
      spec.hostType === 'terrain' &&
      (spec.subtype === 'window' || spec.subtype === 'door' || spec.subtype === 'chimney')
    ) {
      this.hud?.showToast?.(`Click on a cottage, tower, or wall to attach a ${spec.subtype}.`);
      return;
    }

    this.arch.setPreview(null);
    const id = this.arch.addClutter(spec);
    if (id) {
      this.onLanternsChanged?.();
      this.world?.emitBurst?.(
        new THREE.Vector3(spec.x, (spec.y ?? 0) + 0.3, spec.z),
        'build'
      );
      this.audio?.playBrickPop?.(2);
      this.onCommitHistory?.();
    }
  }

  // =========================================================================
  // 8. DEMOLISH
  // =========================================================================
  _beginDemolish(e) {
    this._capturePointer(e.pointerId);
    this._interactionState = 'demolish';
    this._strokeMutated = false;

    // Also check direct raycast hit on first click so clicking a tall tower roof removes it cleanly
    const archHit = this.arch?.raycast?.(this._raycaster);
    if (archHit && archHit.id) {
      if (this.arch.removeEntityById(archHit.id)) {
        if (this.selectedId === archHit.id) this.clearSelection();
        this.world?.syncFootprints?.(this.arch.getFootprints());
        this.onLanternsChanged?.();
        if (archHit.point) this.world?.emitBurst?.(archHit.point, 'demolish');
        this.audio?.playDemolish?.();
        this._strokeMutated = true;
      }
    }

    this._continueDemolish();
  }

  _continueDemolish() {
    const hit = this._raycastTerrainClamped();
    if (!hit) return;
    this._updateCursorRingAt(hit.x, hit.z);
    const opts = this.getNormalizedOptions();
    const r = opts.demolishRadius;

    const removedArch = this.arch?.removeAt?.(hit.x, hit.z, r) || [];
    const removedPath = this.world?.removePathNear?.(hit.x, hit.z, r) || false;
    this.world?.clearNatureAt?.(hit.x, hit.z, r);

    if (removedArch.length > 0 || removedPath) {
      if (this.selectedId && !this.arch.getEntity(this.selectedId)) {
        this.clearSelection();
      }
      if (removedPath) {
        this.arch.setPaths(this.world.getPaths());
        this.pipeline?.water?.updateTerrainTexture?.(this.world.getHeightDataTexture(), 120);
      }
      this.world?.syncFootprints?.(this.arch.getFootprints());
      this.onLanternsChanged?.();
      const y = Math.max(this.world?.getHeightAt?.(hit.x, hit.z) ?? 0, this.waterLevel);
      this.world?.emitBurst?.(new THREE.Vector3(hit.x, y + 0.8, hit.z), 'demolish');
      this.audio?.playDemolish?.();
      this._strokeMutated = true;
    }
  }

  // =========================================================================
  // FINISH INTERACTION & FRAME UPDATE
  // =========================================================================
  _finishActiveInteraction(e) {
    this._releasePointer(e.pointerId);
    const prevState = this._interactionState;
    this._interactionState = 'idle';
    this._activePointerId = null;

    if (prevState === 'handle-drag') {
      this._flushPendingEntityPatch();
      this._activeHandle = null;
      this._handleInitialEntity = null;
      this.domElement.style.cursor = 'default';
      if (this.selectedId) {
        const ent = this.arch?.getEntity?.(this.selectedId);
        this.hud?.showSelectionInspector?.(ent);
        if (ent && ent.x !== undefined) {
          const gy = this.world?.getHeightAt?.(ent.x, ent.z) ?? 0;
          this.world?.emitBurst?.(new THREE.Vector3(ent.x, gy + 0.8, ent.z), 'build');
        }
      }
      this.audio?.playBuildComplete?.();
      this.onCommitHistory?.();
    } else if (prevState === 'spline-draw') {
      this._commitSplineStroke();
    } else if (prevState === 'sculpt') {
      this._hasBrushPos = false;
      if (this._strokeMutated) {
        this.arch?.onTerrainChanged?.(null);
        this.arch?.setPaths?.(this.world.getPaths());
        this.world?.syncFootprints?.(this.arch.getFootprints());
        this.pipeline?.water?.updateTerrainTexture?.(this.world.getHeightDataTexture(), 120);
        this.onLanternsChanged?.();
        this.onCommitHistory?.();
      }
    } else if (prevState === 'nature' || prevState === 'demolish') {
      if (this._strokeMutated) {
        this.onCommitHistory?.();
      }
    }
  }

  update(dt) {
    if (this._interactionState === 'handle-drag') {
      this._flushPendingEntityPatch();
    } else if (this._interactionState === 'sculpt') {
      this._applyTerrainSculptStep(dt);
    }
  }

  dispose() {
    this.domElement.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
    this.domElement.removeEventListener('pointerleave', this._onPointerLeave);
    window.removeEventListener('keydown', this._onKeyDown);
  }
}
