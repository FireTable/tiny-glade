import * as THREE from 'three';
import { TerrainSystem } from './TerrainSystem.js';
import { FoliageSystem } from './FoliageSystem.js';
import { WildlifeAndParticles } from './WildlifeAndParticles.js';

export class WorldManager {
  constructor({ scene, materials = null, worldSize = 120, waterLevel = -0.35, onWaterRipple = null }) {
    this.scene = scene;
    this.materials = materials;
    this.worldSize = worldSize;
    this.waterLevel = waterLevel;
    this.onWaterRipple = onWaterRipple;

    this.season = 'summer';
    this.quality = 'ultra';

    this.terrain = new TerrainSystem({
      scene,
      materials,
      worldSize,
      waterLevel
    });

    this.foliage = new FoliageSystem({
      scene,
      terrain: this.terrain,
      materials,
      worldSize,
      waterLevel
    });

    this.wildlife = new WildlifeAndParticles({
      scene,
      terrain: this.terrain,
      worldSize,
      waterLevel,
      onWaterRipple
    });
  }

  getHeightAt(x, z) {
    return this.terrain.getHeightAt(x, z);
  }

  getNormalAt(x, z, target = new THREE.Vector3()) {
    return this.terrain.getNormalAt(x, z, target);
  }

  getHeightDataTexture() {
    return this.terrain.getHeightDataTexture();
  }

  raycastTerrain(raycaster) {
    return this.terrain.raycast(raycaster);
  }

  sculpt(x, z, radius = 6.0, strength = 1.0, mode = 'raise', dt) {
    const changed = this.terrain.sculpt(x, z, radius, strength, mode, dt);
    if (changed) {
      const pad = radius + 1.5;
      this.foliage.pruneAndReground({
        minX: x - pad,
        minZ: z - pad,
        maxX: x + pad,
        maxZ: z + pad
      });
      this.wildlife.regroundAndSafePlaceSheep();
      if (mode === 'pond' && this.onWaterRipple && Math.random() < 0.25) {
        this.onWaterRipple(x, z, 0.45);
      }
    }
    return changed;
  }

  addPath(points, opts = {}) {
    const pathId = this.terrain.addPath(points, opts);
    if (pathId) {
      this.foliage.pruneAndReground(null);
      this.wildlife.regroundAndSafePlaceSheep();
    }
    return pathId;
  }

  removePathNear(x, z, radius = 3.0) {
    const removed = this.terrain.removePathNear(x, z, radius);
    if (removed) {
      this.foliage.syncAllGrassMatrices();
      this.foliage.rebuildShoreFlora();
    }
    return removed;
  }

  getPaths() {
    return this.terrain.getPaths();
  }

  paintTrees(x, z, radius = 5.5, count) {
    return this.foliage.paintTrees(x, z, radius, count);
  }

  paintFlowers(x, z, radius = 4.5, density = 1.0) {
    return this.foliage.paintFlowers(x, z, radius, density);
  }

  clearNatureAt(x, z, radius = 4.0) {
    return this.foliage.clearNatureAt(x, z, radius);
  }

  syncFootprints(footprints = []) {
    this.terrain.syncFootprints(footprints);
    this.foliage.pruneAndReground(null);
    this.wildlife.onWorldModified();
  }

  interactCreature(raycaster) {
    return this.wildlife.interactCreature(raycaster);
  }

  emitBurst(position, kind = 'build') {
    this.wildlife.emitBurst(position, kind);
  }

  setSeason(season) {
    const s = String(season || 'summer').toLowerCase();
    this.season = s === 'autumn' || s === 'spring' ? s : 'summer';
    this.terrain.setSeason(this.season);
    this.foliage.setSeason(this.season);
  }

  setQuality(tier) {
    const q = String(tier || 'ultra').toLowerCase();
    this.quality = q === 'balanced' || q === 'high' ? q : 'ultra';
    this.foliage.setQuality(this.quality);
    this.wildlife.setQuality(this.quality);
  }

  update(dt, elapsed, envState = {}, chimneyPositions = []) {
    this.terrain.update(dt, elapsed, envState);
    this.foliage.update(dt, elapsed, envState);
    this.wildlife.update(dt, elapsed, envState, chimneyPositions);
  }

  serialize() {
    return {
      version: 1,
      season: this.season,
      terrain: this.terrain.serialize(),
      foliage: this.foliage.serialize()
    };
  }

  deserialize(data) {
    if (!data) return;
    if (data.terrain) {
      this.terrain.deserialize(data.terrain);
    }
    if (data.foliage) {
      this.foliage.deserialize(data.foliage);
    } else {
      this.foliage.syncAllGrassMatrices();
      this.foliage.rebuildShoreFlora();
    }
    if (data.season) {
      this.setSeason(data.season);
    }
    this.wildlife.onWorldModified();
  }

  clear() {
    this.terrain.clear();
    this.foliage.clear();
    this.wildlife.onWorldModified();
  }

  dispose() {
    this.wildlife.dispose();
    this.foliage.dispose();
    this.terrain.dispose();
  }
}
