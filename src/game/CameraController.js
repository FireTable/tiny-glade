import * as THREE from 'three';

const PRESET_ORBIT_POSES = {
  'lakeside-keep': { target: [0.0, 3.1, 3.2], yaw: 0.32, pitch: 0.27, distance: 38.5 },
  'cotswold-hamlet': { target: [0.0, 2.5, 1.5], yaw: -0.46, pitch: 0.29, distance: 37.5 },
  'moonlit-abbey': { target: [0.0, 4.1, 2.2], yaw: 0.30, pitch: 0.25, distance: 42.0 },
  'empty-meadow': { target: [1.5, 2.0, 1.5], yaw: 0.52, pitch: 0.28, distance: 35.0 },
};

function damp(current, target, lambda, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

function dampAngle(current, target, lambda, dt) {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * (1 - Math.exp(-lambda * dt));
}

function isEditableElement(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export class CameraController {
  constructor({
    camera,
    domElement,
    world,
    arch,
    waterLevel = -0.35,
    worldHalfBound = 55,
    onWalkModeChange = null,
  }) {
    this.camera = camera;
    this.domElement = domElement;
    this.world = world;
    this.arch = arch;
    this.waterLevel = waterLevel;
    this.worldHalfBound = worldHalfBound;
    this.onWalkModeChange = onWalkModeChange;

    this.currentPresetId = 'lakeside-keep';

    // Orbit state (smoothed & desired)
    this.target = new THREE.Vector3(0, 3.1, 3.2);
    this.desiredTarget = this.target.clone();
    this.yaw = 0.32;
    this.desiredYaw = 0.32;
    this.pitch = 0.27;
    this.desiredPitch = 0.27;
    this.distance = 38.5;
    this.desiredDistance = 38.5;

    this.minDistance = 4.2;
    this.maxDistance = 90.0;
    this.minPitch = 0.08;
    this.maxPitch = 1.40;
    this.orbitFov = 45;
    this.walkFov = 60;

    // Walk / First-Person Stroll state
    this.walkMode = false;
    this.walkBlend = 0; // 0 = orbit, 1 = walk
    this.walkPos = new THREE.Vector3(0, 1.65, 14);
    this.walkVelocity = new THREE.Vector3();
    this.walkYaw = Math.PI;
    this.desiredWalkYaw = Math.PI;
    this.walkPitch = 0.04;
    this.desiredWalkPitch = 0.04;
    this.walkEyeY = 1.65;
    this.walkBobPhase = 0;

    // Transition snapshot from/to walk mode
    this._orbitPos = new THREE.Vector3();
    this._orbitLookAt = new THREE.Vector3();
    this._walkCamPos = new THREE.Vector3();
    this._walkLookAt = new THREE.Vector3();
    this._blendedLookAt = new THREE.Vector3();

    // Smoothed world-space focus point for Tilt-Shift DoF
    this.focusWorldPos = new THREE.Vector3(0, 1.2, 0);
    this._desiredFocusPos = new THREE.Vector3(0, 1.2, 0);
    this._focusRaycastTimer = 0;

    // Input state
    this._keys = new Set();
    this._dragMode = null; // 'orbit' | 'pan' | 'walk-look' | null
    this._activePointerId = null;
    this._lastPointerX = 0;
    this._lastPointerY = 0;

    // Pre-allocated scratch math objects (zero per-frame GC)
    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._planeHit = new THREE.Vector3();
    this._forwardXZ = new THREE.Vector3();
    this._rightXZ = new THREE.Vector3();
    this._moveDir = new THREE.Vector3();

    this._bindEvents();
    this._syncOrbitImmediate();
  }

  _bindEvents() {
    this._onContextMenu = (e) => e.preventDefault();

    this._onPointerDown = (e) => {
      if (this.walkMode) {
        if (e.button === 0 || e.button === 2) {
          this._startDrag('walk-look', e);
        }
        return;
      }

      if (e.button === 1 || (e.button === 2 && e.shiftKey)) {
        e.preventDefault();
        this._startDrag('pan', e);
      } else if (e.button === 2 || (e.button === 0 && e.altKey)) {
        e.preventDefault();
        this._startDrag('orbit', e);
      }
    };

    this._onPointerMove = (e) => {
      if (this.walkMode && document.pointerLockElement === this.domElement) {
        const sens = 0.0022;
        this.desiredWalkYaw -= (e.movementX || 0) * sens;
        this.desiredWalkPitch = THREE.MathUtils.clamp(
          this.desiredWalkPitch - (e.movementY || 0) * sens,
          -1.18,
          1.18
        );
        return;
      }

      if (!this._dragMode || e.pointerId !== this._activePointerId) return;

      const dx = e.clientX - this._lastPointerX;
      const dy = e.clientY - this._lastPointerY;
      this._lastPointerX = e.clientX;
      this._lastPointerY = e.clientY;

      if (this._dragMode === 'orbit') {
        const rotSpeed = 0.0052;
        this.desiredYaw -= dx * rotSpeed;
        this.desiredPitch = THREE.MathUtils.clamp(
          this.desiredPitch + dy * rotSpeed,
          this.minPitch,
          this.maxPitch
        );
      } else if (this._dragMode === 'pan') {
        const rect = this.domElement.getBoundingClientRect();
        const viewHeight = Math.max(1, rect.height);
        const worldPerPixel =
          (2 * this.desiredDistance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5))) /
          viewHeight;

        this._computeHorizontalAxes();
        this.desiredTarget.addScaledVector(this._rightXZ, -dx * worldPerPixel);
        this.desiredTarget.addScaledVector(this._forwardXZ, dy * worldPerPixel);
        this._clampTargetXZ();
        this._adaptTargetHeight();
      } else if (this._dragMode === 'walk-look') {
        const lookSpeed = 0.0042;
        this.desiredWalkYaw -= dx * lookSpeed;
        this.desiredWalkPitch = THREE.MathUtils.clamp(
          this.desiredWalkPitch - dy * lookSpeed,
          -1.18,
          1.18
        );
      }
    };

    this._onPointerUp = (e) => {
      if (e.pointerId === this._activePointerId) {
        this._endDrag(e.pointerId);
      }
    };

    this._onDblClick = () => {
      if (this.walkMode && this.domElement.requestPointerLock) {
        try {
          this.domElement.requestPointerLock();
        } catch {
          // Pointer lock optional; drag-look always works.
        }
      }
    };

    this._onWheel = (e) => {
      if (this.walkMode) return;
      e.preventDefault();

      // Normalize trackpad & mouse wheel deltas cleanly
      const rawDelta = e.deltaMode === 1 ? e.deltaY * 18 : e.deltaY;
      const zoomFactor = Math.exp(THREE.MathUtils.clamp(rawDelta, -180, 180) * 0.0014);
      const prevDist = this.desiredDistance;
      const nextDist = THREE.MathUtils.clamp(
        prevDist * zoomFactor,
        this.minDistance,
        this.maxDistance
      );

      // Zoom gently toward cursor world point when zooming in
      if (nextDist < prevDist) {
        const hitPoint = this._raycastScreenPoint(e.clientX, e.clientY);
        if (hitPoint) {
          const pull = THREE.MathUtils.clamp((1 - nextDist / prevDist) * 0.55, 0, 0.35);
          this.desiredTarget.lerp(hitPoint, pull);
          this._clampTargetXZ();
        }
      }

      this.desiredDistance = nextDist;
    };

    this._onKeyDown = (e) => {
      if (isEditableElement(e.target)) return;
      if (e.ctrlKey || e.metaKey) return;

      const code = e.code;
      if (
        code === 'KeyW' ||
        code === 'KeyA' ||
        code === 'KeyS' ||
        code === 'KeyD' ||
        code === 'KeyQ' ||
        code === 'KeyE' ||
        code === 'ArrowUp' ||
        code === 'ArrowDown' ||
        code === 'ArrowLeft' ||
        code === 'ArrowRight' ||
        code === 'ShiftLeft' ||
        code === 'ShiftRight'
      ) {
        this._keys.add(code);
      } else if (code === 'Home' || code === 'KeyR') {
        if (!this.walkMode) {
          this.framePreset(this.currentPresetId, false);
        }
      } else if (code === 'Escape' && this.walkMode) {
        if (document.pointerLockElement === this.domElement) {
          document.exitPointerLock?.();
        } else {
          this.setWalkMode(false);
          this.onWalkModeChange?.(false);
        }
      }
    };

    this._onKeyUp = (e) => {
      this._keys.delete(e.code);
    };

    this._onWindowBlur = () => {
      this._keys.clear();
      if (this._activePointerId !== null) {
        this._endDrag(this._activePointerId);
      }
    };

    this.domElement.addEventListener('contextmenu', this._onContextMenu);
    this.domElement.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
    this.domElement.addEventListener('dblclick', this._onDblClick);
    this.domElement.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onWindowBlur);
  }

  _startDrag(mode, e) {
    this._dragMode = mode;
    this._activePointerId = e.pointerId;
    this._lastPointerX = e.clientX;
    this._lastPointerY = e.clientY;
    try {
      this.domElement.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointer events in tests may not register an active pointer id.
    }
  }

  _endDrag(pointerId) {
    this._dragMode = null;
    this._activePointerId = null;
    try {
      if (this.domElement.hasPointerCapture?.(pointerId)) {
        this.domElement.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignore release errors.
    }
  }

  /**
   * Called by InteractionController when user left-drags on empty meadow in `select` mode.
   */
  beginExternalOrbitDrag(e) {
    if (this.walkMode) return;
    this._startDrag('orbit', e);
  }

  isDragging() {
    return this._dragMode !== null;
  }

  isWalkMode() {
    return this.walkMode;
  }

  toggleWalkMode() {
    const next = !this.walkMode;
    this.setWalkMode(next);
    return next;
  }

  setWalkMode(active) {
    const next = Boolean(active);
    if (next === this.walkMode) return;
    this.walkMode = next;

    if (next) {
      this._endDrag(this._activePointerId);
      const spawn = this._findBestWalkSpawn();
      this.walkPos.set(spawn.x, spawn.y, spawn.z);
      this.walkEyeY = spawn.y;
      this.walkYaw = spawn.yaw;
      this.desiredWalkYaw = spawn.yaw;
      this.walkPitch = 0.03;
      this.desiredWalkPitch = 0.03;
      this.walkVelocity.set(0, 0, 0);
    } else {
      if (document.pointerLockElement === this.domElement) {
        document.exitPointerLock?.();
      }
      // Smoothly lift orbit target near where player stood
      const groundH = Math.max(
        this.world?.getHeightAt?.(this.walkPos.x, this.walkPos.z) ?? 0,
        this.waterLevel
      );
      const lookDist = 10;
      const tx = THREE.MathUtils.clamp(
        this.walkPos.x - Math.sin(this.walkYaw) * lookDist,
        -this.worldHalfBound,
        this.worldHalfBound
      );
      const tz = THREE.MathUtils.clamp(
        this.walkPos.z - Math.cos(this.walkYaw) * lookDist,
        -this.worldHalfBound,
        this.worldHalfBound
      );
      this.desiredTarget.set(tx, groundH + 1.0, tz);
      this.target.copy(this.desiredTarget);
      this.desiredYaw = this.walkYaw;
      this.yaw = this.walkYaw;
      this.desiredPitch = 0.48;
      this.desiredDistance = Math.max(24, Math.min(38, this.desiredDistance));
    }
  }

  _findBestWalkSpawn() {
    // Prefer placing the stroller on a dry cobble path segment looking across a bridge/archway toward center!
    const paths = this.world?.getPaths?.() || [];
    let bestPathPt = null;
    let bestLookPt = null;
    let bestScore = Infinity;

    for (const path of paths) {
      const pts = path?.points;
      if (!Array.isArray(pts) || pts.length < 2) continue;
      const styleBonus = path.style === 'cobble' ? 0 : 4.0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const th = this.world?.getHeightAt?.(p.x, p.z) ?? 0;
        const bh = this.arch?.getDeckOrStructureHeightAt?.(p.x, p.z);
        const onBridge = bh !== null && bh !== undefined;
        // Prefer dry path approach right before a bridge or archway!
        if (onBridge || th < this.waterLevel + 0.05) continue;

        const dx = p.x - this.desiredTarget.x;
        const dz = p.z - this.desiredTarget.z;
        const dist = Math.hypot(dx, dz);
        // Ideal stroll start is ~14m–17m out on the approach path so both bridge & archway sit right ahead!
        const distScore = Math.abs(dist - 15.5) + styleBonus;
        if (distScore < bestScore) {
          bestScore = distScore;
          bestPathPt = p;
          const nextP = pts[Math.min(pts.length - 1, i + 4)];
          const prevP = pts[Math.max(0, i - 4)];
          const dNext =
            (nextP.x - this.desiredTarget.x) ** 2 + (nextP.z - this.desiredTarget.z) ** 2;
          const dPrev =
            (prevP.x - this.desiredTarget.x) ** 2 + (prevP.z - this.desiredTarget.z) ** 2;
          bestLookPt = dNext <= dPrev ? nextP : prevP;
        }
      }
    }

    if (bestPathPt) {
      const supportH = this._getWalkSupportHeight(bestPathPt.x, bestPathPt.z);
      const lx = (bestLookPt?.x ?? this.desiredTarget.x) - bestPathPt.x;
      const lz = (bestLookPt?.z ?? this.desiredTarget.z) - bestPathPt.z;
      const yaw = Math.hypot(lx, lz) > 0.1 ? Math.atan2(-lx, -lz) : this.yaw;
      return { x: bestPathPt.x, y: supportH + 1.65, z: bestPathPt.z, yaw };
    }

    // Fallback: radial search around desiredTarget for dry walkable ground
    let sx = THREE.MathUtils.clamp(
      this.desiredTarget.x + Math.sin(this.yaw) * 10,
      -this.worldHalfBound,
      this.worldHalfBound
    );
    let sz = THREE.MathUtils.clamp(
      this.desiredTarget.z + Math.cos(this.yaw) * 10,
      -this.worldHalfBound,
      this.worldHalfBound
    );

    if ((this.world?.getHeightAt?.(sx, sz) ?? 0) < this.waterLevel) {
      for (let r = 3; r <= 24; r += 3) {
        let found = false;
        for (let a = 0; a < 12; a++) {
          const ang = (a / 12) * Math.PI * 2;
          const cx = THREE.MathUtils.clamp(
            this.desiredTarget.x + Math.cos(ang) * r,
            -this.worldHalfBound,
            this.worldHalfBound
          );
          const cz = THREE.MathUtils.clamp(
            this.desiredTarget.z + Math.sin(ang) * r,
            -this.worldHalfBound,
            this.worldHalfBound
          );
          if ((this.world?.getHeightAt?.(cx, cz) ?? 0) >= this.waterLevel + 0.05) {
            sx = cx;
            sz = cz;
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }

    const supportH = this._getWalkSupportHeight(sx, sz);
    const yaw = Math.atan2(-(this.desiredTarget.x - sx), -(this.desiredTarget.z - sz));
    return { x: sx, y: supportH + 1.65, z: sz, yaw };
  }

  _getWalkSupportHeight(x, z) {
    const terrainH = this.world?.getHeightAt?.(x, z) ?? 0;
    const structureH = this.arch?.getDeckOrStructureHeightAt?.(x, z);
    const support = Math.max(terrainH, structureH ?? -999);
    return Math.max(support, this.waterLevel - 0.15);
  }

  framePreset(presetId = 'lakeside-keep', immediate = false) {
    this.currentPresetId = presetId;
    const pose = PRESET_ORBIT_POSES[presetId] || PRESET_ORBIT_POSES['lakeside-keep'];
    this.setOrbitPose(
      {
        target: pose.target,
        yaw: pose.yaw,
        pitch: pose.pitch,
        distance: pose.distance,
      },
      immediate
    );
  }

  resetView(immediate = false) {
    this.framePreset(this.currentPresetId, immediate);
  }

  setOrbitPose({ target, yaw, pitch, distance }, immediate = false) {
    if (this.walkMode) {
      this.setWalkMode(false);
      this.onWalkModeChange?.(false);
    }
    if (Array.isArray(target)) {
      this.desiredTarget.set(target[0], target[1], target[2]);
    } else if (target && typeof target.x === 'number') {
      this.desiredTarget.copy(target);
    }
    if (typeof yaw === 'number') this.desiredYaw = yaw;
    if (typeof pitch === 'number') {
      this.desiredPitch = THREE.MathUtils.clamp(pitch, this.minPitch, this.maxPitch);
    }
    if (typeof distance === 'number') {
      this.desiredDistance = THREE.MathUtils.clamp(distance, this.minDistance, this.maxDistance);
    }
    this._clampTargetXZ();

    if (immediate) {
      this._syncOrbitImmediate();
    }
  }

  _syncOrbitImmediate() {
    this.target.copy(this.desiredTarget);
    this.yaw = this.desiredYaw;
    this.pitch = this.desiredPitch;
    this.distance = this.desiredDistance;
    this.walkBlend = this.walkMode ? 1 : 0;
    const targetFov = this.walkMode ? this.walkFov : this.orbitFov;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }
    this._computeOrbitTransform(this._orbitPos, this._orbitLookAt);
    this.camera.position.copy(this._orbitPos);
    this.camera.lookAt(this._orbitLookAt);
    this.focusWorldPos.copy(this.target);
    this._desiredFocusPos.copy(this.target);
  }

  _computeHorizontalAxes() {
    const yaw = this.walkMode ? this.walkYaw : this.yaw;
    // Camera looks toward (-sin(yaw), *, -cos(yaw))
    this._forwardXZ.set(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
    this._rightXZ.set(Math.cos(yaw), 0, -Math.sin(yaw)).normalize();
  }

  _clampTargetXZ() {
    this.desiredTarget.x = THREE.MathUtils.clamp(
      this.desiredTarget.x,
      -this.worldHalfBound,
      this.worldHalfBound
    );
    this.desiredTarget.z = THREE.MathUtils.clamp(
      this.desiredTarget.z,
      -this.worldHalfBound,
      this.worldHalfBound
    );
  }

  _adaptTargetHeight() {
    if (!this.world?.getHeightAt) return;
    const groundY = Math.max(
      this.world.getHeightAt(this.desiredTarget.x, this.desiredTarget.z),
      this.waterLevel
    );
    this.desiredTarget.y = THREE.MathUtils.clamp(
      groundY + 0.85,
      this.waterLevel + 0.3,
      26.0
    );
  }

  _raycastScreenPoint(clientX, clientY) {
    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this._ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this._raycaster.setFromCamera(this._ndc, this.camera);

    const terrainHit = this.world?.raycastTerrain?.(this._raycaster);
    if (terrainHit) return terrainHit;

    this._groundPlane.constant = -this.desiredTarget.y;
    if (this._raycaster.ray.intersectPlane(this._groundPlane, this._planeHit)) {
      return this._planeHit;
    }
    return null;
  }

  _computeOrbitTransform(outPos, outLookAt) {
    const cosPitch = Math.cos(this.pitch);
    const sinPitch = Math.sin(this.pitch);
    const cx = this.target.x + Math.sin(this.yaw) * cosPitch * this.distance;
    const cz = this.target.z + Math.cos(this.yaw) * cosPitch * this.distance;
    let cy = this.target.y + sinPitch * this.distance;

    const terrainAtCam = this.world?.getHeightAt?.(cx, cz) ?? 0;
    const minCamY = Math.max(terrainAtCam, this.waterLevel) + 0.8;
    if (cy < minCamY) {
      cy = minCamY;
    }

    outPos.set(cx, cy, cz);
    outLookAt.copy(this.target);
  }

  _updateOrbitInputs(dt) {
    const fast = this._keys.has('ShiftLeft') || this._keys.has('ShiftRight') ? 1.85 : 1.0;

    if (this._keys.has('KeyQ')) {
      this.desiredYaw += 1.45 * dt * fast;
    }
    if (this._keys.has('KeyE')) {
      this.desiredYaw -= 1.45 * dt * fast;
    }

    let moveF = 0;
    let moveR = 0;
    if (this._keys.has('KeyW') || this._keys.has('ArrowUp')) moveF += 1;
    if (this._keys.has('KeyS') || this._keys.has('ArrowDown')) moveF -= 1;
    if (this._keys.has('KeyD') || this._keys.has('ArrowRight')) moveR += 1;
    if (this._keys.has('KeyA') || this._keys.has('ArrowLeft')) moveR -= 1;

    if (moveF !== 0 || moveR !== 0) {
      this._computeHorizontalAxes();
      this._moveDir
        .set(0, 0, 0)
        .addScaledVector(this._forwardXZ, moveF)
        .addScaledVector(this._rightXZ, moveR)
        .normalize();
      const panSpeed = Math.max(7.0, this.desiredDistance * 0.58) * fast;
      this.desiredTarget.addScaledVector(this._moveDir, panSpeed * dt);
      this._clampTargetXZ();
      this._adaptTargetHeight();
    }
  }

  _updateWalkInputs(dt) {
    const brisk = this._keys.has('ShiftLeft') || this._keys.has('ShiftRight');

    if (this._keys.has('KeyQ')) {
      this.desiredWalkYaw += 1.65 * dt;
    }
    if (this._keys.has('KeyE')) {
      this.desiredWalkYaw -= 1.65 * dt;
    }

    this.walkYaw = dampAngle(this.walkYaw, this.desiredWalkYaw, 16, dt);
    this.walkPitch = damp(this.walkPitch, this.desiredWalkPitch, 16, dt);

    let moveF = 0;
    let moveR = 0;
    if (this._keys.has('KeyW') || this._keys.has('ArrowUp')) moveF += 1;
    if (this._keys.has('KeyS') || this._keys.has('ArrowDown')) moveF -= 1;
    if (this._keys.has('KeyD') || this._keys.has('ArrowRight')) moveR += 1;
    if (this._keys.has('KeyA') || this._keys.has('ArrowLeft')) moveR -= 1;

    this._computeHorizontalAxes();
    this._moveDir.set(0, 0, 0);
    if (moveF !== 0 || moveR !== 0) {
      this._moveDir
        .addScaledVector(this._forwardXZ, moveF)
        .addScaledVector(this._rightXZ, moveR)
        .normalize();
    }

    const walkSpeed = brisk ? 7.6 : 4.2;
    const targetVx = this._moveDir.x * walkSpeed;
    const targetVz = this._moveDir.z * walkSpeed;
    this.walkVelocity.x = damp(this.walkVelocity.x, targetVx, 12, dt);
    this.walkVelocity.z = damp(this.walkVelocity.z, targetVz, 12, dt);

    const nextX = THREE.MathUtils.clamp(
      this.walkPos.x + this.walkVelocity.x * dt,
      -this.worldHalfBound,
      this.worldHalfBound
    );
    const nextZ = THREE.MathUtils.clamp(
      this.walkPos.z + this.walkVelocity.z * dt,
      -this.worldHalfBound,
      this.worldHalfBound
    );

    // Prevent wading into deep water unless walking on an arched pond bridge!
    const nextBridgeH = this.arch?.getDeckOrStructureHeightAt?.(nextX, nextZ);
    const nextTerrainH = this.world?.getHeightAt?.(nextX, nextZ) ?? 0;
    if (nextBridgeH !== null && nextBridgeH !== undefined) {
      this.walkPos.x = nextX;
      this.walkPos.z = nextZ;
    } else if (nextTerrainH >= this.waterLevel - 0.16) {
      this.walkPos.x = nextX;
      this.walkPos.z = nextZ;
    } else {
      // Try sliding along X or Z separately along pond bank
      const tryXBridge = this.arch?.getDeckOrStructureHeightAt?.(nextX, this.walkPos.z);
      const tryXTerrain = this.world?.getHeightAt?.(nextX, this.walkPos.z) ?? 0;
      if (tryXBridge != null || tryXTerrain >= this.waterLevel - 0.16) {
        this.walkPos.x = nextX;
      }
      const tryZBridge = this.arch?.getDeckOrStructureHeightAt?.(this.walkPos.x, nextZ);
      const tryZTerrain = this.world?.getHeightAt?.(this.walkPos.x, nextZ) ?? 0;
      if (tryZBridge != null || tryZTerrain >= this.waterLevel - 0.16) {
        this.walkPos.z = nextZ;
      }
    }

    const supportH = this._getWalkSupportHeight(this.walkPos.x, this.walkPos.z);
    const speedMag = Math.hypot(this.walkVelocity.x, this.walkVelocity.z);
    if (speedMag > 0.2) {
      this.walkBobPhase += dt * (brisk ? 11.5 : 8.2);
    }
    const bobOffset =
      speedMag > 0.2
        ? Math.sin(this.walkBobPhase) * 0.022 * Math.min(1, speedMag / 4.2)
        : 0;

    this.walkEyeY = damp(this.walkEyeY, supportH + 1.65, 16, dt);
    this.walkPos.y = this.walkEyeY + bobOffset;

    this._walkCamPos.copy(this.walkPos);
    const cosP = Math.cos(this.walkPitch);
    this._walkLookAt.set(
      this._walkCamPos.x - Math.sin(this.walkYaw) * cosP * 10,
      this._walkCamPos.y + Math.sin(this.walkPitch) * 10,
      this._walkCamPos.z - Math.cos(this.walkYaw) * cosP * 10
    );
  }

  _updateAutofocus(dt) {
    this._focusRaycastTimer -= dt;
    if (this._focusRaycastTimer <= 0) {
      this._focusRaycastTimer = 0.075; // ~13Hz center raycast for crisp zero-overhead autofocus
      this._ndc.set(0, 0);
      this._raycaster.setFromCamera(this._ndc, this.camera);

      let found = null;
      const archHit = this.arch?.raycast?.(this._raycaster);
      if (archHit?.point) {
        found = archHit.point;
      }
      const terrainHit = this.world?.raycastTerrain?.(this._raycaster);
      if (terrainHit) {
        if (
          !found ||
          this.camera.position.distanceToSquared(terrainHit) <
            this.camera.position.distanceToSquared(found)
        ) {
          found = terrainHit;
        }
      }

      if (found) {
        this._desiredFocusPos.copy(found);
      } else if (!this.walkMode) {
        this._desiredFocusPos.copy(this.target);
      } else {
        this._desiredFocusPos.copy(this._walkLookAt);
      }
    }

    const focusLambda = 10;
    this.focusWorldPos.x = damp(this.focusWorldPos.x, this._desiredFocusPos.x, focusLambda, dt);
    this.focusWorldPos.y = damp(this.focusWorldPos.y, this._desiredFocusPos.y, focusLambda, dt);
    this.focusWorldPos.z = damp(this.focusWorldPos.z, this._desiredFocusPos.z, focusLambda, dt);
  }

  getFocusWorldPos() {
    return this.focusWorldPos;
  }

  getFocusDistance() {
    return this.camera.position.distanceTo(this.focusWorldPos);
  }

  update(dt) {
    const safeDt = Math.min(0.05, Math.max(0.0001, dt));

    if (!this.walkMode) {
      this._updateOrbitInputs(safeDt);
    }

    // Critically damped orbit smoothing
    const orbitLambda = 14;
    this.target.x = damp(this.target.x, this.desiredTarget.x, orbitLambda, safeDt);
    this.target.y = damp(this.target.y, this.desiredTarget.y, orbitLambda, safeDt);
    this.target.z = damp(this.target.z, this.desiredTarget.z, orbitLambda, safeDt);
    this.yaw = dampAngle(this.yaw, this.desiredYaw, orbitLambda, safeDt);
    this.pitch = damp(this.pitch, this.desiredPitch, orbitLambda, safeDt);
    this.distance = damp(this.distance, this.desiredDistance, orbitLambda, safeDt);

    this._computeOrbitTransform(this._orbitPos, this._orbitLookAt);

    if (this.walkMode || this.walkBlend > 0.001) {
      this._updateWalkInputs(safeDt);
    }

    // Smooth blend between Orbit and First-Person Stroll
    const targetBlend = this.walkMode ? 1 : 0;
    if (Math.abs(this.walkBlend - targetBlend) > 0.0005) {
      this.walkBlend = damp(this.walkBlend, targetBlend, 8.5, safeDt);
      if (Math.abs(this.walkBlend - targetBlend) <= 0.001) {
        this.walkBlend = targetBlend;
      }
      const targetFov = THREE.MathUtils.lerp(this.orbitFov, this.walkFov, this.walkBlend);
      if (Math.abs(this.camera.fov - targetFov) > 0.01) {
        this.camera.fov = targetFov;
        this.camera.updateProjectionMatrix();
      }
    }

    if (this.walkBlend <= 0.0005) {
      this.camera.position.copy(this._orbitPos);
      this.camera.lookAt(this._orbitLookAt);
    } else if (this.walkBlend >= 0.9995) {
      this.camera.position.copy(this._walkCamPos);
      this.camera.lookAt(this._walkLookAt);
    } else {
      const s = this.walkBlend * this.walkBlend * (3 - 2 * this.walkBlend);
      this.camera.position.lerpVectors(this._orbitPos, this._walkCamPos, s);
      this._blendedLookAt.lerpVectors(this._orbitLookAt, this._walkLookAt, s);
      this.camera.lookAt(this._blendedLookAt);
    }

    this._updateAutofocus(safeDt);
  }

  dispose() {
    this.domElement.removeEventListener('contextmenu', this._onContextMenu);
    this.domElement.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
    this.domElement.removeEventListener('dblclick', this._onDblClick);
    this.domElement.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onWindowBlur);
  }
}
