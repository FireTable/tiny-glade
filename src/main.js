import { createRendererPipeline } from './engine/RendererPipeline.js';
import { ArchitectureManager } from './arch/ArchitectureManager.js';
import { WorldManager } from './world/WorldManager.js';
import { AudioEngine } from './ux/AudioEngine.js';
import { HistoryManager } from './ux/HistoryManager.js';
import { PRESET_SCENES, buildPresetScene } from './ux/PresetScenes.js';
import { HUDController } from './ux/HUDController.js';
import { CameraController } from './game/CameraController.js';
import { InteractionController } from './game/InteractionController.js';

const WORLD_SIZE = 120;
const WATER_LEVEL = -0.35;

function setLoadingError(message) {
  const overlay = document.getElementById('loading-overlay');
  const statusEl = document.getElementById('loading-status');
  if (overlay) overlay.classList.add('has-error');
  if (statusEl) statusEl.textContent = message;
}

function hideLoadingOverlay() {
  const overlay = document.getElementById('loading-overlay');
  if (!overlay || overlay.classList.contains('is-hidden')) return;
  overlay.classList.add('is-hidden');
}

function downloadDataURL(dataUrl, filename) {
  if (!dataUrl) return;
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function bootstrap() {
  const canvas = document.getElementById('glade-canvas');
  const hudRoot = document.getElementById('hud-root');
  if (!canvas || !hudRoot) {
    setLoadingError('Missing #glade-canvas or #hud-root container.');
    return;
  }

  let pipeline;
  try {
    pipeline = createRendererPipeline(canvas, {
      quality: 'high',
      waterLevel: WATER_LEVEL,
      worldSize: WORLD_SIZE,
    });
  } catch (err) {
    console.error('[tiny-glade] Failed to initialize WebGL2 pipeline:', err);
    setLoadingError(`WebGL2 initialization failed: ${err?.message || err}`);
    return;
  }

  const audio = new AudioEngine();
  const history = new HistoryManager();

  const world = new WorldManager({
    scene: pipeline.scene,
    materials: pipeline.materials,
    worldSize: WORLD_SIZE,
    waterLevel: WATER_LEVEL,
    onWaterRipple: (x, z, strength = 0.6) => {
      pipeline.water?.addRipple?.(x, z, strength);
    },
  });
  world.setQuality?.('high');

  const arch = new ArchitectureManager({
    scene: pipeline.scene,
    materials: pipeline.materials,
    getTerrainHeight: (x, z) => world.getHeightAt(x, z),
    waterLevel: WATER_LEVEL,
  });

  // Initial water height texture bind
  pipeline.water?.updateTerrainTexture?.(world.getHeightDataTexture(), WORLD_SIZE);

  let hud = null;
  let interaction = null;

  const syncWorldArchAndLights = () => {
    arch.setPaths(world.getPaths());
    world.syncFootprints(arch.getFootprints());
    pipeline.water?.updateTerrainTexture?.(world.getHeightDataTexture(), WORLD_SIZE);
    pipeline.syncPointLights?.(arch.getLanternPositions());
  };

  const syncLanternLights = () => {
    pipeline.syncPointLights?.(arch.getLanternPositions());
  };

  const captureSnapshot = () => ({
    world: world.serialize(),
    arch: arch.serialize(),
    env: {
      timeOfDay: pipeline.envState?.timeOfDay ?? 16.7,
      season: pipeline.envState?.season ?? 'summer',
      cloudiness: pipeline.envState?.cloudiness ?? 0.35,
      mist: pipeline.envState?.mist ?? pipeline.envState?.fogDensity ?? 0.35,
      windStrength: pipeline.envState?.windStrength ?? 0.45,
    },
  });

  let lastCommittedSnapshot = null;

  const updateHistoryButtons = () => {
    hud?.setHistoryState?.(history.canUndo(), history.canRedo());
  };

  const resetHistoryWithCurrentState = () => {
    history.clear();
    lastCommittedSnapshot = captureSnapshot();
    updateHistoryButtons();
  };

  const commitHistoryStep = () => {
    if (lastCommittedSnapshot) {
      history.pushState(lastCommittedSnapshot);
    }
    lastCommittedSnapshot = captureSnapshot();
    updateHistoryButtons();
  };

  const applySnapshot = (snapshot) => {
    if (!snapshot) return;
    interaction?.clearSelection?.();
    if (snapshot.world) {
      world.deserialize(snapshot.world);
    }
    if (snapshot.arch) {
      arch.deserialize(snapshot.arch);
    }
    if (snapshot.env) {
      if (typeof snapshot.env.timeOfDay === 'number') {
        pipeline.setTimeOfDay?.(snapshot.env.timeOfDay);
        hud?.updateTimeOfDay?.(snapshot.env.timeOfDay);
      }
      if (snapshot.env.season) {
        world.setSeason?.(snapshot.env.season);
      }
      pipeline.setWeather?.({
        season: snapshot.env.season,
        cloudiness: snapshot.env.cloudiness,
        mist: snapshot.env.mist,
        windStrength: snapshot.env.windStrength,
      });
    }
    syncWorldArchAndLights();
    lastCommittedSnapshot = captureSnapshot();
    updateHistoryButtons();
  };

  const cameraController = new CameraController({
    camera: pipeline.camera,
    domElement: canvas,
    world,
    arch,
    waterLevel: WATER_LEVEL,
    onWalkModeChange: (active) => {
      interaction?.setWalkMode?.(active);
      hud?.setWalkMode?.(active);
    },
  });

  const loadPreset = (presetId, immediateCamera = false) => {
    interaction?.clearSelection?.();
    buildPresetScene(presetId, { world, arch, pipeline });
    syncWorldArchAndLights();
    if (pipeline.envState?.season) {
      world.setSeason?.(pipeline.envState.season);
    }
    hud?.setPresetValue?.(presetId);
    if (typeof pipeline.envState?.timeOfDay === 'number') {
      hud?.updateTimeOfDay?.(pipeline.envState.timeOfDay);
    }
    cameraController.framePreset(presetId, immediateCamera);
    resetHistoryWithCurrentState();
  };

  const handleUndo = () => {
    const current = captureSnapshot();
    const prev = history.undo(current);
    if (prev) {
      applySnapshot(prev);
      hud?.showToast?.('Undid last action');
    }
  };

  const handleRedo = () => {
    const current = captureSnapshot();
    const next = history.redo(current);
    if (next) {
      applySnapshot(next);
      hud?.showToast?.('Redid action');
    }
  };

  const handleCaptureScreenshot = () => {
    const dataUrl = pipeline.captureScreenshotDataURL?.();
    if (dataUrl) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      downloadDataURL(dataUrl, `tiny-glade-${stamp}.png`);
      hud?.showToast?.('Captured diorama screenshot');
    }
  };

  const hudCallbacks = {
    presets: PRESET_SCENES,

    onUiSound: () => {
      audio.unlock?.();
      audio.playUiTick?.();
    },

    onToolChange: (toolId) => {
      audio.unlock?.();
      if (cameraController.isWalkMode()) {
        cameraController.setWalkMode(false);
        hud?.setWalkMode?.(false);
        interaction?.setWalkMode?.(false);
      }
      interaction?.setActiveTool?.(toolId);
    },
    onSelectTool: (toolId) => hudCallbacks.onToolChange(toolId),

    onOptionsChange: (opts) => {
      audio.unlock?.();
      interaction?.onToolOptionsChanged?.(opts);
    },
    onToolOptionsChange: (opts) => hudCallbacks.onOptionsChange(opts),

    onDeleteSelected: (entity) => {
      audio.unlock?.();
      interaction?.deleteSelectedEntity?.(entity);
    },

    onPresetChange: (presetId) => {
      audio.unlock?.();
      loadPreset(presetId, false);
    },
    onSelectPreset: (presetId) => hudCallbacks.onPresetChange(presetId),

    onUndo: handleUndo,
    onRedo: handleRedo,

    onExport: () => {
      audio.unlock?.();
      history.exportJSON(captureSnapshot(), 'tiny-glade-scene.json');
      hud?.showToast?.('Exported scene JSON');
    },
    onExportJSON: () => hudCallbacks.onExport(),

    onImport: async (file) => {
      if (!file) return;
      audio.unlock?.();
      try {
        const snap = await history.importJSON(file);
        if (snap) {
          commitHistoryStep();
          applySnapshot(snap);
          hud?.showToast?.('Imported glade scene');
        }
      } catch (err) {
        console.error('[tiny-glade] Failed to import JSON:', err);
        hud?.showToast?.('Could not read scene JSON file');
      }
    },
    onImportJSON: (file) => hudCallbacks.onImport(file),

    onTimeOfDayChange: (hours) => {
      pipeline.setTimeOfDay?.(Number(hours));
      syncLanternLights();
    },
    onTimeChange: (hours) => hudCallbacks.onTimeOfDayChange(hours),

    onSeasonChange: (season) => {
      audio.playUiTick?.();
      world.setSeason?.(season);
      pipeline.setWeather?.({ season });
    },

    onWeatherChange: (weatherPatch) => {
      if (weatherPatch?.season) {
        world.setSeason?.(weatherPatch.season);
      }
      pipeline.setWeather?.(weatherPatch);
    },

    onDoFChange: (dofPatch) => {
      pipeline.setDoF?.(dofPatch);
    },

    onQualityChange: (tier) => {
      audio.playUiTick?.();
      pipeline.setQuality?.(tier);
      world.setQuality?.(tier);
      hud?.showToast?.(`Graphics quality: ${tier}`);
    },

    onWalkModeChange: (active) => {
      audio.unlock?.();
      audio.playUiTick?.();
      const next = typeof active === 'boolean' ? active : !cameraController.isWalkMode();
      cameraController.setWalkMode(next);
      interaction?.setWalkMode?.(next);
      hud?.setWalkMode?.(next);
      if (next) {
        hud?.showToast?.('Stroll Mode — WASD to walk, drag to look, Esc to exit');
      }
    },
    onToggleWalkMode: (active) => hudCallbacks.onWalkModeChange(active),

    onPhotoModeChange: (active) => {
      audio.playUiTick?.();
      interaction?.setPhotoMode?.(Boolean(active));
    },

    onCapturePhoto: handleCaptureScreenshot,
    onScreenshot: handleCaptureScreenshot,

    onMuteChange: (muted) => {
      audio.unlock?.();
      const next = typeof muted === 'boolean' ? muted : !audio.isMuted();
      audio.setMuted(next);
      return next;
    },
    onToggleMute: (muted) => hudCallbacks.onMuteChange(muted),
  };

  hud = new HUDController(hudRoot, hudCallbacks);

  interaction = new InteractionController({
    scene: pipeline.scene,
    camera: pipeline.camera,
    domElement: canvas,
    pipeline,
    world,
    arch,
    audio,
    hud,
    cameraController,
    waterLevel: WATER_LEVEL,
    onCommitHistory: commitHistoryStep,
    onLanternsChanged: syncLanternLights,
  });

  // Unlock WebAudio cleanly on first user gesture
  const unlockOnce = () => {
    audio.unlock?.();
  };
  window.addEventListener('pointerdown', unlockOnce, { passive: true });
  window.addEventListener('keydown', unlockOnce, { passive: true });

  // Resize listener
  const onResize = () => {
    pipeline.resize?.(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);
  onResize();

  // Build breathtaking default starter diorama: Lakeside Keep
  loadPreset('lakeside-keep', true);
  hud.setActiveTool?.('select');

  // Expose clean automation & inspection handle
  window.__glade = {
    pipeline,
    world,
    arch,
    camera: cameraController,
    interaction,
    hud,
    audio,
    history,
    loadPreset,
    captureSnapshot,
    applySnapshot,
  };

  // Main animation loop
  let prevTime = performance.now();
  let elapsed = 0;
  let firstFrameRendered = false;
  let statsAccumTime = 0;
  let statsFrames = 0;

  function frame(now) {
    requestAnimationFrame(frame);

    const rawDt = (now - prevTime) / 1000;
    prevTime = now;
    const dt = Math.min(0.05, Math.max(0.0005, rawDt));
    elapsed += dt;

    cameraController.update(dt, elapsed);
    interaction.update(dt, elapsed);
    arch.update(dt, elapsed, pipeline.envState);
    world.update(dt, elapsed, pipeline.envState, arch.getChimneyPositions());
    pipeline.update(dt, elapsed, cameraController.getFocusWorldPos());
    audio.updateAmbience?.(dt, pipeline.envState);
    pipeline.render();

    if (!firstFrameRendered) {
      firstFrameRendered = true;
      hideLoadingOverlay();
    }

    statsAccumTime += rawDt;
    statsFrames += 1;
    if (statsAccumTime >= 0.4) {
      const fps = Math.round(statsFrames / statsAccumTime);
      const frameMs = Number(((statsAccumTime / statsFrames) * 1000).toFixed(1));
      const rendererStats = pipeline.getStats?.() || {};
      hud.updateStats?.({
        fps,
        frameMs,
        drawCalls: rendererStats.drawCalls ?? 0,
        triangles: rendererStats.triangles ?? 0,
        quality: rendererStats.quality ?? pipeline.envState?.quality ?? 'high',
      });
      statsAccumTime = 0;
      statsFrames = 0;
    }
  }

  requestAnimationFrame(frame);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
