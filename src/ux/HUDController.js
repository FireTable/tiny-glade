/**
 * HUDController.js
 * Tactile, accessible Tiny Glade HUD: Bottom Tool Dock, Contextual Sub-Options Popover,
 * Selection Inspector, Top-Left Scene/History Bar, Top-Right Atmosphere/Camera/Quality Bar,
 * Photo Mode overlay, and Real Performance Readout.
 */

import { PRESET_SCENES } from './PresetScenes.js';

const TOOLS = [
  {
    id: 'select',
    shortLabel: 'Select',
    tooltip: 'Select / Edit Handles & Pet Sheep',
    hotkey: '1',
    altKey: 'v',
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 3.8l12.2 6.6-5.3 1.6-2.2 5.4L5.5 3.8z"/><path d="M13.2 12.8l4.6 4.6"/></svg>`,
  },
  {
    id: 'cottage',
    shortLabel: 'Cottage',
    tooltip: 'Build Cottage / Hall',
    hotkey: '2',
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5L12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5a2 2 0 0 1 4 0v5"/><path d="M16.5 4.8v3.2"/></svg>`,
  },
  {
    id: 'tower',
    shortLabel: 'Tower',
    tooltip: 'Build Round Tower',
    hotkey: '3',
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 10.5Q12 2.5 17.5 10.5Z"/><path d="M8 10.5v9.5h8v-9.5"/><path d="M6.5 20h11"/><path d="M12 13.5v2"/></svg>`,
  },
  {
    id: 'wall',
    shortLabel: 'Wall',
    tooltip: 'Draw Stone Wall',
    hotkey: '4',
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="1.5"/><path d="M3 10.5h18M3 15h18M9 6v4.5M15 6v4.5M12 10.5V15M7.5 15v4M16.5 15v4"/></svg>`,
  },
  {
    id: 'fence',
    shortLabel: 'Fence',
    tooltip: 'Draw Wooden Fence',
    hotkey: '5',
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l1.5-2L9 6v14H6V6zM15 6l1.5-2L18 6v14h-3V6z"/><path d="M3.5 10h17M3.5 15.5h17"/></svg>`,
  },
  {
    id: 'path',
    shortLabel: 'Path',
    tooltip: 'Paint Path — Auto-Arches & Bridges',
    hotkey: '6',
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 20c.5-4.5 3.5-6.5 3.5-10S9.5 5.5 10 4"/><path d="M15.5 20c.3-3.8 2.8-5.8 2.8-9.5S16 5.8 16.3 4"/><circle cx="12" cy="15.5" r="0.9"/><circle cx="14" cy="11" r="0.9"/><circle cx="13" cy="6.8" r="0.8"/></svg>`,
  },
  {
    id: 'clutter',
    shortLabel: 'Clutter',
    tooltip: 'Place Lantern / Window / Door / Flag / Chimney',
    hotkey: '7',
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M9 6h6l1.2 3.5-1.2 7.5H9L7.8 9.5 9 6z"/><path d="M9.5 20h5"/><path d="M12 10.5v3"/></svg>`,
  },
  {
    id: 'terrain',
    shortLabel: 'Terrain',
    tooltip: 'Sculpt Hills & Ponds',
    hotkey: '8',
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 16.5c2.8-5.5 6.2-8.5 9-8.5s5.2 3.8 10 8.5"/><path d="M13.5 11.5c1.8-2.4 3.4-3.5 5-3.5 1.4 0 2.6.9 3.5 2.5"/><path d="M3 19.5c2.2 1.2 4.5 1.2 6.7 0 2.2-1.2 4.5-1.2 6.7 0 1.6.9 3.2.9 4.6 0"/></svg>`,
  },
  {
    id: 'nature',
    shortLabel: 'Nature',
    tooltip: 'Plant Trees & Wildflowers',
    hotkey: '9',
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20v-5"/><path d="M12 4.5a4.5 4.5 0 0 0-4.1 6.3A3.8 3.8 0 0 0 9.5 17h5a3.8 3.8 0 0 0 1.6-6.2A4.5 4.5 0 0 0 12 4.5z"/><path d="M18.5 20v-3m-1.5 1.2l1.5-1.2 1.5 1.2"/></svg>`,
  },
  {
    id: 'demolish',
    shortLabel: 'Erase',
    tooltip: 'Erase / Demolish',
    hotkey: '0',
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 4.5l3 3L8.5 18.5H5.5v-3L16.5 4.5z"/><path d="M14 7l3 3"/><path d="M4 20h16"/></svg>`,
  },
];

const ROOF_SWATCHES = [
  { id: 'terracotta', label: 'Terracotta', hex: '#b8573b' },
  { id: 'slate', label: 'Slate', hex: '#47586c' },
  { id: 'moss', label: 'Moss', hex: '#556e48' },
  { id: 'ochre', label: 'Ochre', hex: '#c48d3f' },
  { id: 'plum', label: 'Plum', hex: '#6d4b5b' },
];

const WALL_STYLES = [
  { id: 'limestone', label: 'Limestone', hex: '#d9d2c5' },
  { id: 'cotswold', label: 'Cotswold', hex: '#dfc89f' },
  { id: 'granite', label: 'Granite', hex: '#9aa0a6' },
  { id: 'plaster', label: 'Plaster', hex: '#efe6d5' },
];

const PATH_STYLES = [
  { id: 'cobble', label: 'Cobblestone' },
  { id: 'dirt', label: 'Country Dirt' },
];

const CLUTTER_TYPES = [
  { id: 'lantern', label: 'Lantern' },
  { id: 'window', label: 'Window' },
  { id: 'door', label: 'Door' },
  { id: 'chimney', label: 'Chimney' },
  { id: 'flag', label: 'Flag' },
  { id: 'flowerbox', label: 'Flowerbox' },
  { id: 'bench', label: 'Bench' },
];

const TERRAIN_MODES = [
  { id: 'raise', label: 'Raise' },
  { id: 'lower', label: 'Lower' },
  { id: 'pond', label: 'Pond' },
  { id: 'smooth', label: 'Smooth' },
  { id: 'flatten', label: 'Flatten' },
];

const NATURE_TYPES = [
  { id: 'trees', label: 'Trees' },
  { id: 'flowers', label: 'Flowers' },
  { id: 'clear', label: 'Clear' },
];

const TIME_PRESETS = [
  { id: 'dawn', label: 'Dawn', hours: 6.2 },
  { id: 'noon', label: 'Noon', hours: 12.5 },
  { id: 'golden', label: 'Golden Hour', hours: 16.7 },
  { id: 'night', label: 'Night', hours: 21.6 },
];

const ICONS = {
  undo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H12"/></svg>`,
  redo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H12"/></svg>`,
  export: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>`,
  import: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3m0 0L8 7m4-4l4 4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.2 14.8A8.2 8.2 0 0 1 9.2 3.8a8.2 8.2 0 1 0 11 11z"/></svg>`,
  sliders: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="10" cy="18" r="2" fill="currentColor"/></svg>`,
  walk: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12.5" cy="5" r="2"/><path d="M9.5 20l2-6.5 2.8 2.5V20M11.5 13.5l1-4.5-3.2 1.5-1.3 2.5M12.5 9l3.2 2.5 1.8.5"/></svg>`,
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5A2 2 0 0 1 6 6.5h2.2l1.4-2h4.8l1.4 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9z"/><circle cx="12" cy="13" r="3.2"/></svg>`,
  speakerOn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>`,
  speakerOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M21 9l-6 6M15 9l6 6"/></svg>`,
  perf: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 17.5a8.5 8.5 0 1 1 15 0"/><path d="M12 13l4-4"/><circle cx="12" cy="13" r="1.4"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5h9L17.5 7"/></svg>`,
};

function formatClock(hours) {
  const wrapped = ((Number(hours) || 0) % 24 + 24) % 24;
  const h = Math.floor(wrapped);
  const m = Math.floor((wrapped - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatCompactCount(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(Math.round(v));
}

function stopCanvasPropagation(el) {
  const stop = (e) => e.stopPropagation();
  el.addEventListener('pointerdown', stop);
  el.addEventListener('pointermove', stop);
  el.addEventListener('mousedown', stop);
  el.addEventListener('wheel', stop, { passive: true });
  el.addEventListener('dblclick', stop);
  el.addEventListener('contextmenu', stop);
}

export class HUDController {
  constructor(rootElement, callbacks = {}) {
    this.root = rootElement || document.body;
    this.callbacks = callbacks || {};

    this.activeTool = 'select';
    this._selectedEntity = null;
    this._selectedInfo = null;
    this._walkMode = false;
    this._photoMode = false;
    this._muted = false;
    this._drawerOpen = false;
    this._perfVisible = true;
    this._timeOfDay = 16.7;
    this._toastTimer = null;

    this._toolOptions = {
      roofColor: 'terracotta',
      wallStyle: 'cotswold',
      tudor: false,
      crenellated: false,
      pathStyle: 'cobble',
      pathWidth: 2.2,
      clutterType: 'lantern',
      terrainMode: 'raise',
      terrainBrushSize: 6.0,
      terrainStrength: 1.0,
      natureType: 'trees',
      natureBrushSize: 7.0,
      demolishRadius: 3.0,
    };

    this._envOptions = {
      season: 'summer',
      cloudiness: 0.26,
      mist: 0.34,
      windStrength: 0.45,
      dofEnabled: true,
      aperture: 0.35,
      focusDistance: 26.0,
      quality: 'high',
    };

    this._els = {};
    this._buildDOM();
    this._bindHotkeys();
    this._renderSubOptions();
    this.updateTimeOfDay(this._timeOfDay);
    this.setHistoryState(false, false);
  }

  _tick() {
    this.callbacks.onUiSound?.();
  }

  _cbTool(toolId, opts) {
    (this.callbacks.onToolChange || this.callbacks.onSelectTool)?.(toolId, opts);
  }

  _cbOptions(opts, toolId) {
    (this.callbacks.onToolOptionsChange || this.callbacks.onOptionsChange)?.(opts, toolId);
  }

  _cbPreset(presetId) {
    (this.callbacks.onPresetChange || this.callbacks.onSelectPreset || this.callbacks.onPresetSelect)?.(presetId);
  }

  _cbWalk(active) {
    (this.callbacks.onWalkModeChange || this.callbacks.onToggleWalkMode || this.callbacks.onWalkModeToggle)?.(active);
  }

  _cbMute(muted) {
    (this.callbacks.onMuteChange || this.callbacks.onToggleMute || this.callbacks.onMuteToggle)?.(muted);
  }

  _cbTime(hours) {
    (this.callbacks.onTimeOfDayChange || this.callbacks.onTimeChange)?.(hours);
  }

  _cbExport() {
    (this.callbacks.onExport || this.callbacks.onExportJSON)?.();
  }

  _cbImport(file) {
    (this.callbacks.onImport || this.callbacks.onImportJSON)?.(file);
  }

  _cbCapture() {
    (this.callbacks.onCapturePhoto || this.callbacks.onScreenshot)?.();
  }

  _blurOnPointer(e, el) {
    if (e && e.detail > 0 && el && typeof el.blur === 'function') {
      el.blur();
    }
  }

  _buildDOM() {
    const hud = document.createElement('div');
    hud.className = 'tg-hud';
    hud.setAttribute('role', 'region');
    hud.setAttribute('aria-label', 'Tiny Glade Builder Controls');

    // =========================================================================
    // 1. TOP-LEFT SCENE & HISTORY BAR
    // =========================================================================
    const topLeft = document.createElement('div');
    topLeft.className = 'tg-bar tg-top-left tg-interactive';
    stopCanvasPropagation(topLeft);

    const presetWrap = document.createElement('label');
    presetWrap.className = 'tg-select-wrap';
    presetWrap.title = 'Load Showcase Diorama Preset';

    const presetSelect = document.createElement('select');
    presetSelect.className = 'tg-select';
    presetSelect.setAttribute('aria-label', 'Scene Preset');
    for (const preset of PRESET_SCENES) {
      const opt = document.createElement('option');
      opt.value = preset.id;
      opt.textContent = preset.label;
      presetSelect.appendChild(opt);
    }
    presetSelect.addEventListener('change', (e) => {
      this._tick();
      const id = e.target.value;
      e.target.blur();
      this._syncPresetAtmosphereDefaults(id);
      this._cbPreset(id);
    });
    presetWrap.appendChild(presetSelect);

    const divider1 = document.createElement('span');
    divider1.className = 'tg-divider';

    const undoBtn = this._makeIconBtn(ICONS.undo, 'Undo', 'Undo (Ctrl+Z / Z)', () => {
      if (undoBtn.disabled) return;
      this._tick();
      this.callbacks.onUndo?.();
    });
    undoBtn.dataset.action = 'undo';

    const redoBtn = this._makeIconBtn(ICONS.redo, 'Redo', 'Redo (Ctrl+Shift+Z)', () => {
      if (redoBtn.disabled) return;
      this._tick();
      this.callbacks.onRedo?.();
    });
    redoBtn.dataset.action = 'redo';

    const divider2 = document.createElement('span');
    divider2.className = 'tg-divider';

    const exportBtn = this._makeIconBtn(ICONS.export, 'Save', 'Export Scene JSON', () => {
      this._tick();
      this._cbExport();
    });
    exportBtn.dataset.action = 'export';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.className = 'tg-sr-only';
    fileInput.tabIndex = -1;
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        this._tick();
        this._cbImport(file);
      }
      fileInput.value = '';
    });

    const importBtn = this._makeIconBtn(ICONS.import, 'Load', 'Import Scene JSON', () => {
      this._tick();
      fileInput.click();
    });
    importBtn.dataset.action = 'import';

    topLeft.append(presetWrap, divider1, undoBtn, redoBtn, divider2, exportBtn, importBtn, fileInput);

    // =========================================================================
    // 2. TOP-RIGHT ATMOSPHERE, CAMERA & QUALITY BAR
    // =========================================================================
    const topRightWrap = document.createElement('div');
    topRightWrap.className = 'tg-top-right-wrap';

    const topRight = document.createElement('div');
    topRight.className = 'tg-bar tg-top-right tg-interactive';
    stopCanvasPropagation(topRight);

    // Time-of-Day Scrubber Group
    const timeGroup = document.createElement('div');
    timeGroup.className = 'tg-time-group';

    const skyIcon = document.createElement('span');
    skyIcon.className = 'tg-sky-icon';
    skyIcon.innerHTML = ICONS.sun;

    const timeReadout = document.createElement('span');
    timeReadout.className = 'tg-time-readout';
    timeReadout.textContent = '16:42';

    const timeSlider = document.createElement('input');
    timeSlider.type = 'range';
    timeSlider.min = '0';
    timeSlider.max = '24';
    timeSlider.step = '0.05';
    timeSlider.value = String(this._timeOfDay);
    timeSlider.className = 'tg-slider tg-time-slider';
    timeSlider.title = 'Scrub Sun & Moon Time of Day (0:00 – 24:00)';
    timeSlider.setAttribute('aria-label', 'Time of Day');
    timeSlider.addEventListener('input', () => {
      const hrs = parseFloat(timeSlider.value);
      this.updateTimeOfDay(hrs);
      this._cbTime(hrs);
    });

    const timePresetsWrap = document.createElement('div');
    timePresetsWrap.className = 'tg-time-presets';
    this._timePresetBtns = [];
    for (const tp of TIME_PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tg-chip';
      b.textContent = tp.label;
      b.title = `Set Time to ${tp.label} (${formatClock(tp.hours)})`;
      b.dataset.timePreset = tp.id;
      b.addEventListener('click', (e) => {
        this._blurOnPointer(e, b);
        this._tick();
        this.updateTimeOfDay(tp.hours);
        this._cbTime(tp.hours);
      });
      this._timePresetBtns.push({ btn: b, hours: tp.hours });
      timePresetsWrap.appendChild(b);
    }

    timeGroup.append(skyIcon, timeReadout, timeSlider, timePresetsWrap);

    const divider3 = document.createElement('span');
    divider3.className = 'tg-divider';

    const atmoBtn = this._makeIconBtn(
      ICONS.sliders,
      'Atmosphere',
      'Atmosphere, Lens & Quality Settings',
      () => {
        this._tick();
        this._toggleDrawer();
      }
    );
    atmoBtn.dataset.action = 'atmosphere';
    atmoBtn.setAttribute('aria-expanded', 'false');

    const walkBtn = this._makeIconBtn(
      ICONS.walk,
      'Walk',
      'First-Person Tiny Stroll Mode (F)',
      () => {
        this._tick();
        const next = !this._walkMode;
        this.setWalkMode(next);
        this._cbWalk(next);
      }
    );
    walkBtn.dataset.action = 'walk';
    walkBtn.setAttribute('aria-pressed', 'false');

    const photoBtn = this._makeIconBtn(
      ICONS.camera,
      'Photo',
      'Photo Mode — Hide UI & Capture PNG (P)',
      () => {
        this._tick();
        this.setPhotoMode(true);
      }
    );
    photoBtn.dataset.action = 'photo';

    const muteBtn = this._makeIconBtn(
      ICONS.speakerOn,
      '',
      'Mute / Unmute Soundscape (M)',
      () => {
        const next = !this._muted;
        this.setMuted(next);
        this._cbMute(next);
      }
    );
    muteBtn.dataset.action = 'mute';
    muteBtn.setAttribute('aria-pressed', 'false');

    const perfBtn = this._makeIconBtn(
      ICONS.perf,
      '',
      'Toggle Real Performance Readout',
      () => {
        this._tick();
        this._perfVisible = !this._perfVisible;
        perfBtn.classList.toggle('is-active', this._perfVisible);
        perfBtn.setAttribute('aria-pressed', String(this._perfVisible));
        this._els.perfPanel.hidden = !this._perfVisible;
      }
    );
    perfBtn.dataset.action = 'perf';
    perfBtn.classList.add('is-active');
    perfBtn.setAttribute('aria-pressed', 'true');

    topRight.append(timeGroup, divider3, atmoBtn, walkBtn, photoBtn, muteBtn, perfBtn);

    // Collapsible Atmosphere, Lens & Quality Drawer
    const drawer = this._buildAtmosphereDrawer();

    // Real Performance Readout Strip
    const perfPanel = document.createElement('div');
    perfPanel.className = 'tg-perf-readout tg-interactive';
    perfPanel.setAttribute('aria-live', 'off');
    stopCanvasPropagation(perfPanel);
    perfPanel.textContent = '-- FPS · -- ms · -- draws · -- tris · High';

    topRightWrap.append(topRight, drawer, perfPanel);

    // =========================================================================
    // 3. BOTTOM TOOL DOCK + CONTEXTUAL SUB-OPTIONS POPOVER
    // =========================================================================
    const bottomCenter = document.createElement('div');
    bottomCenter.className = 'tg-bottom-center';

    // Walk Mode Active Banner
    const walkBanner = document.createElement('div');
    walkBanner.className = 'tg-walk-banner tg-interactive';
    walkBanner.hidden = true;
    stopCanvasPropagation(walkBanner);
    const walkText = document.createElement('span');
    walkText.textContent = 'Stroll Mode · WASD to walk · Drag to look · Shift to trot';
    const exitWalkBtn = document.createElement('button');
    exitWalkBtn.type = 'button';
    exitWalkBtn.className = 'tg-chip is-active';
    exitWalkBtn.textContent = 'Exit Stroll (F)';
    exitWalkBtn.addEventListener('click', (e) => {
      this._blurOnPointer(e, exitWalkBtn);
      this._tick();
      this.setWalkMode(false);
      this._cbWalk(false);
    });
    walkBanner.append(walkText, exitWalkBtn);

    // Contextual Sub-Options Popover directly above active tool
    const subPopover = document.createElement('div');
    subPopover.className = 'tg-sub-popover tg-interactive';
    subPopover.hidden = true;
    stopCanvasPropagation(subPopover);

    // Ergonomic Tool Dock
    const dock = document.createElement('nav');
    dock.className = 'tg-dock tg-interactive';
    dock.setAttribute('aria-label', 'Building & Landscape Tools');
    stopCanvasPropagation(dock);

    this._toolBtns = new Map();
    for (const tool of TOOLS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tg-tool-btn';
      if (tool.id === this.activeTool) btn.classList.add('is-active');
      btn.dataset.tool = tool.id;
      const hotkeyHint = tool.altKey ? `${tool.hotkey} / ${tool.altKey.toUpperCase()}` : tool.hotkey;
      btn.title = `${tool.tooltip} (${hotkeyHint})`;
      btn.setAttribute('aria-label', `${tool.tooltip} (${hotkeyHint})`);
      btn.setAttribute('aria-pressed', String(tool.id === this.activeTool));

      const iconEl = document.createElement('span');
      iconEl.className = 'tg-tool-icon';
      iconEl.innerHTML = tool.svg;

      const labelEl = document.createElement('span');
      labelEl.className = 'tg-tool-label';
      labelEl.textContent = tool.shortLabel;

      const keyEl = document.createElement('kbd');
      keyEl.className = 'tg-tool-key';
      keyEl.textContent = tool.hotkey;

      btn.append(iconEl, labelEl, keyEl);
      btn.addEventListener('click', (e) => {
        this._blurOnPointer(e, btn);
        this._tick();
        this._selectToolFromUser(tool.id);
      });

      this._toolBtns.set(tool.id, btn);
      dock.appendChild(btn);
    }

    bottomCenter.append(walkBanner, subPopover, dock);

    // =========================================================================
    // 4. PHOTO MODE FLOATING EXIT / CAPTURE PILL (HIDDEN UNLESS PHOTO MODE)
    // =========================================================================
    const photoPill = document.createElement('div');
    photoPill.className = 'tg-photo-pill tg-interactive';
    photoPill.hidden = true;
    stopCanvasPropagation(photoPill);

    const captureBtn = document.createElement('button');
    captureBtn.type = 'button';
    captureBtn.className = 'tg-btn tg-btn-primary';
    captureBtn.dataset.action = 'capture-png';
    captureBtn.innerHTML = `<span class="tg-btn-icon">${ICONS.camera}</span><span>Capture PNG</span>`;
    captureBtn.addEventListener('click', (e) => {
      this._blurOnPointer(e, captureBtn);
      this._tick();
      this._cbCapture();
    });

    const exitPhotoBtn = document.createElement('button');
    exitPhotoBtn.type = 'button';
    exitPhotoBtn.className = 'tg-btn';
    exitPhotoBtn.dataset.action = 'exit-photo';
    exitPhotoBtn.textContent = 'Exit Photo Mode (P)';
    exitPhotoBtn.addEventListener('click', (e) => {
      this._blurOnPointer(e, exitPhotoBtn);
      this._tick();
      this.setPhotoMode(false);
    });

    photoPill.append(captureBtn, exitPhotoBtn);

    // =========================================================================
    // 5. TOAST NOTIFICATION PILL
    // =========================================================================
    const toast = document.createElement('div');
    toast.className = 'tg-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.hidden = true;

    hud.append(topLeft, topRightWrap, bottomCenter, photoPill, toast);
    this.root.appendChild(hud);

    this._els = {
      hud,
      topLeft,
      presetSelect,
      undoBtn,
      redoBtn,
      topRightWrap,
      topRight,
      skyIcon,
      timeReadout,
      timeSlider,
      atmoBtn,
      walkBtn,
      photoBtn,
      muteBtn,
      perfBtn,
      drawer,
      perfPanel,
      bottomCenter,
      walkBanner,
      subPopover,
      dock,
      photoPill,
      toast,
    };
  }

  _makeIconBtn(svg, labelText, titleText, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = labelText ? 'tg-btn' : 'tg-btn tg-btn-icon-only';
    btn.title = titleText;
    btn.setAttribute('aria-label', titleText);

    const icon = document.createElement('span');
    icon.className = 'tg-btn-icon';
    icon.innerHTML = svg;
    btn.appendChild(icon);

    if (labelText) {
      const lbl = document.createElement('span');
      lbl.className = 'tg-btn-label';
      lbl.textContent = labelText;
      btn.appendChild(lbl);
    }

    btn.addEventListener('click', (e) => {
      this._blurOnPointer(e, btn);
      onClick(e);
    });
    return btn;
  }

  _buildAtmosphereDrawer() {
    const drawer = document.createElement('div');
    drawer.className = 'tg-drawer tg-interactive';
    drawer.hidden = true;
    stopCanvasPropagation(drawer);

    // Season segmented row
    const seasonRow = document.createElement('div');
    seasonRow.className = 'tg-drawer-row';
    const seasonLbl = document.createElement('span');
    seasonLbl.className = 'tg-drawer-label';
    seasonLbl.textContent = 'Season';

    const seasonGroup = document.createElement('div');
    seasonGroup.className = 'tg-seg-group';
    this._seasonBtns = [];
    for (const s of [
      { id: 'spring', label: 'Spring' },
      { id: 'summer', label: 'Summer' },
      { id: 'autumn', label: 'Autumn' },
    ]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tg-seg-btn' + (this._envOptions.season === s.id ? ' is-active' : '');
      b.textContent = s.label;
      b.dataset.season = s.id;
      b.addEventListener('click', (e) => {
        this._blurOnPointer(e, b);
        this._tick();
        this._envOptions.season = s.id;
        for (const item of this._seasonBtns) {
          item.btn.classList.toggle('is-active', item.id === s.id);
        }
        this._emitWeather();
      });
      this._seasonBtns.push({ id: s.id, btn: b });
      seasonGroup.appendChild(b);
    }
    seasonRow.append(seasonLbl, seasonGroup);
    drawer.appendChild(seasonRow);

    // Weather Sliders: Cloudiness, Valley Mist, Wind
    const cloudCtrl = this._makeDrawerSlider(
      'Cloudiness',
      0,
      1,
      0.02,
      this._envOptions.cloudiness,
      (v) => `${Math.round(v * 100)}%`,
      (v) => {
        this._envOptions.cloudiness = v;
        this._emitWeather();
      }
    );
    const mistCtrl = this._makeDrawerSlider(
      'Valley Mist',
      0,
      1,
      0.02,
      this._envOptions.mist,
      (v) => `${Math.round(v * 100)}%`,
      (v) => {
        this._envOptions.mist = v;
        this._emitWeather();
      }
    );
    const windCtrl = this._makeDrawerSlider(
      'Wind Breeze',
      0,
      1.5,
      0.05,
      this._envOptions.windStrength,
      (v) => `${Math.round((v / 1.5) * 100)}%`,
      (v) => {
        this._envOptions.windStrength = v;
        this._emitWeather();
      }
    );
    this._cloudCtrl = cloudCtrl;
    this._mistCtrl = mistCtrl;
    this._windCtrl = windCtrl;
    drawer.append(cloudCtrl.row, mistCtrl.row, windCtrl.row);

    const sep1 = document.createElement('hr');
    sep1.className = 'tg-drawer-sep';
    drawer.appendChild(sep1);

    // Tilt-Shift Depth of Field Toggle + Sliders
    const dofHeader = document.createElement('div');
    dofHeader.className = 'tg-drawer-row';
    const dofLbl = document.createElement('span');
    dofLbl.className = 'tg-drawer-label';
    dofLbl.textContent = 'Tilt-Shift Lens';

    const dofToggle = document.createElement('button');
    dofToggle.type = 'button';
    dofToggle.className = 'tg-toggle-pill' + (this._envOptions.dofEnabled ? ' is-active' : '');
    dofToggle.textContent = this._envOptions.dofEnabled ? 'On' : 'Off';
    dofToggle.setAttribute('aria-pressed', String(this._envOptions.dofEnabled));
    dofToggle.addEventListener('click', (e) => {
      this._blurOnPointer(e, dofToggle);
      this._tick();
      this._envOptions.dofEnabled = !this._envOptions.dofEnabled;
      dofToggle.classList.toggle('is-active', this._envOptions.dofEnabled);
      dofToggle.textContent = this._envOptions.dofEnabled ? 'On' : 'Off';
      dofToggle.setAttribute('aria-pressed', String(this._envOptions.dofEnabled));
      apertureCtrl.input.disabled = !this._envOptions.dofEnabled;
      focusCtrl.input.disabled = !this._envOptions.dofEnabled;
      this._emitDoF();
    });
    dofHeader.append(dofLbl, dofToggle);

    const apertureCtrl = this._makeDrawerSlider(
      'Aperture Blur',
      0.0,
      1.0,
      0.02,
      this._envOptions.aperture,
      (v) => `${Math.round(v * 100)}%`,
      (v) => {
        this._envOptions.aperture = v;
        this._emitDoF();
      }
    );
    const focusCtrl = this._makeDrawerSlider(
      'Focus Distance',
      6,
      65,
      0.5,
      this._envOptions.focusDistance,
      (v) => `${v.toFixed(0)} m`,
      (v) => {
        this._envOptions.focusDistance = v;
        this._emitDoF();
      }
    );
    this._dofToggle = dofToggle;
    this._apertureCtrl = apertureCtrl;
    this._focusCtrl = focusCtrl;
    drawer.append(dofHeader, apertureCtrl.row, focusCtrl.row);

    const sep2 = document.createElement('hr');
    sep2.className = 'tg-drawer-sep';
    drawer.appendChild(sep2);

    // Quality Tier selector
    const qualRow = document.createElement('div');
    qualRow.className = 'tg-drawer-row';
    const qualLbl = document.createElement('span');
    qualLbl.className = 'tg-drawer-label';
    qualLbl.textContent = 'Quality';

    const qualGroup = document.createElement('div');
    qualGroup.className = 'tg-seg-group';
    this._qualBtns = [];
    for (const q of [
      { id: 'ultra', label: 'Ultra' },
      { id: 'high', label: 'High' },
      { id: 'balanced', label: 'Balanced' },
    ]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tg-seg-btn' + (this._envOptions.quality === q.id ? ' is-active' : '');
      b.textContent = q.label;
      b.dataset.quality = q.id;
      b.addEventListener('click', (e) => {
        this._blurOnPointer(e, b);
        this._tick();
        this.setQuality(q.id);
        this.callbacks.onQualityChange?.(q.id);
      });
      this._qualBtns.push({ id: q.id, btn: b });
      qualGroup.appendChild(b);
    }
    qualRow.append(qualLbl, qualGroup);
    drawer.appendChild(qualRow);

    return drawer;
  }

  _makeDrawerSlider(label, min, max, step, initialVal, formatFn, onInput) {
    const row = document.createElement('label');
    row.className = 'tg-drawer-slider-row';

    const header = document.createElement('div');
    header.className = 'tg-drawer-slider-head';
    const lbl = document.createElement('span');
    lbl.className = 'tg-drawer-label';
    lbl.textContent = label;
    const valEl = document.createElement('span');
    valEl.className = 'tg-drawer-val';
    valEl.textContent = formatFn(initialVal);
    header.append(lbl, valEl);

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'tg-slider';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(initialVal);
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      valEl.textContent = formatFn(v);
      onInput(v);
    });

    row.append(header, input);
    return {
      row,
      input,
      setValue(v) {
        input.value = String(v);
        valEl.textContent = formatFn(v);
      },
    };
  }

  _syncPresetAtmosphereDefaults(presetId) {
    const map = {
      'lakeside-keep': { timeOfDay: 16.7, season: 'summer', cloudiness: 0.26, mist: 0.34, windStrength: 0.45 },
      'cotswold-hamlet': { timeOfDay: 8.4, season: 'spring', cloudiness: 0.22, mist: 0.28, windStrength: 0.38 },
      'moonlit-abbey': { timeOfDay: 21.6, season: 'autumn', cloudiness: 0.20, mist: 0.56, windStrength: 0.48 },
      'empty-meadow': { timeOfDay: 15.5, season: 'summer', cloudiness: 0.24, mist: 0.18, windStrength: 0.40 },
    };
    const cfg = map[presetId];
    if (!cfg) return;
    this.updateTimeOfDay(cfg.timeOfDay);
    this._envOptions.season = cfg.season;
    this._envOptions.cloudiness = cfg.cloudiness;
    this._envOptions.mist = cfg.mist;
    this._envOptions.windStrength = cfg.windStrength;

    for (const item of this._seasonBtns || []) {
      item.btn.classList.toggle('is-active', item.id === cfg.season);
    }
    this._cloudCtrl?.setValue(cfg.cloudiness);
    this._mistCtrl?.setValue(cfg.mist);
    this._windCtrl?.setValue(cfg.windStrength);
  }

  _emitWeather() {
    this.callbacks.onWeatherChange?.({
      season: this._envOptions.season,
      cloudiness: this._envOptions.cloudiness,
      mist: this._envOptions.mist,
      windStrength: this._envOptions.windStrength,
    });
  }

  _emitDoF() {
    this.callbacks.onDoFChange?.({
      enabled: this._envOptions.dofEnabled,
      aperture: this._envOptions.aperture,
      focusDistance: this._envOptions.focusDistance,
    });
  }

  _toggleDrawer(forceState) {
    this._drawerOpen = typeof forceState === 'boolean' ? forceState : !this._drawerOpen;
    this._els.drawer.hidden = !this._drawerOpen;
    this._els.atmoBtn.classList.toggle('is-active', this._drawerOpen);
    this._els.atmoBtn.setAttribute('aria-expanded', String(this._drawerOpen));
  }

  _selectToolFromUser(toolId) {
    if (this._walkMode && toolId !== 'select') {
      this.setWalkMode(false);
      this._cbWalk(false);
    }
    if (toolId !== 'select' && toolId !== 'cottage' && toolId !== 'tower' && toolId !== 'wall') {
      this._selectedEntity = null;
      this._selectedInfo = null;
    }
    this.setActiveTool(toolId);
    this._cbTool(this.activeTool, this.getToolOptions());
  }

  /**
   * Sets active tool visually and refreshes contextual sub-options popover.
   */
  setActiveTool(toolId) {
    const valid = this._toolBtns.has(toolId) ? toolId : 'select';
    this.activeTool = valid;

    for (const [id, btn] of this._toolBtns.entries()) {
      const active = id === valid;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    }

    this._renderSubOptions();
  }

  /**
   * Returns current tool options object with canonical keys & convenient aliases.
   */
  getToolOptions() {
    const o = this._toolOptions;
    let brushSize = o.terrainBrushSize;
    if (this.activeTool === 'nature') brushSize = o.natureBrushSize;
    else if (this.activeTool === 'demolish') brushSize = o.demolishRadius;

    const style =
      this.activeTool === 'path'
        ? o.pathStyle
        : this.activeTool === 'fence'
          ? 'timber'
          : o.wallStyle;

    const subtype =
      this.activeTool === 'nature' ? o.natureType : o.clutterType;

    return {
      ...o,
      clutterSubtype: o.clutterType,
      natureSubtype: o.natureType,
      brushSize,
      style,
      width: o.pathWidth,
      subtype,
      mode: o.terrainMode,
    };
  }

  /**
   * Displays or clears contextual inspector for a selected building or wall.
   * Never mutates the live entity reference passed in.
   */
  showSelectionInspector(entityOrNull) {
    this._selectedEntity = entityOrNull || null;
    this._selectedInfo = this._resolveSelectedSpec(this._selectedEntity);
    this._renderSubOptions();
  }

  _resolveSelectedSpec(sel) {
    if (!sel || typeof sel !== 'object') return null;
    const raw = sel.entity || sel.spec || sel.data || sel;
    const rawType = raw.type || sel.entityType || sel.type || '';
    const isTower = rawType === 'tower' || (rawType === 'building' && typeof raw.radius === 'number');
    const isCottage = rawType === 'cottage' || (rawType === 'building' && !isTower);
    const isWall = rawType === 'wall';
    const isFence = rawType === 'fence';

    return {
      id: raw.id ?? sel.id,
      isBuilding: isCottage || isTower,
      isCottage,
      isTower,
      isWall,
      isFence,
      label: isTower
        ? 'Selected Tower'
        : isCottage
          ? 'Selected Cottage'
          : isFence
            ? 'Selected Fence'
            : isWall
              ? 'Selected Wall'
              : 'Selected Object',
      roofColor: raw.roofColor || this._toolOptions.roofColor,
      wallStyle: raw.wallStyle || raw.style || this._toolOptions.wallStyle,
      tudor: Boolean(raw.tudor),
      crenellated: Boolean(raw.crenellated),
    };
  }

  _renderSubOptions() {
    const pop = this._els.subPopover;
    if (!pop) return;
    pop.innerHTML = '';

    if (this._walkMode) {
      pop.hidden = true;
      return;
    }

    const selInfo = this._selectedInfo;
    const tool = this.activeTool;

    // 1. Selected Entity Inspector (when in select mode or whenever an entity is actively inspected)
    if (selInfo && (tool === 'select' || tool === 'cottage' || tool === 'tower' || tool === 'wall')) {
      const titleBadge = document.createElement('span');
      titleBadge.className = 'tg-sub-title';
      titleBadge.textContent = selInfo.label;
      pop.appendChild(titleBadge);

      if (selInfo.isBuilding) {
        pop.appendChild(
          this._buildRoofSwatches(selInfo.roofColor, (colorId) => {
            this._toolOptions.roofColor = colorId;
            selInfo.roofColor = colorId;
            const patch = { roofColor: colorId };
            this.callbacks.onSelectionModify?.(patch, this._selectedEntity);
            this._cbOptions(patch, this.activeTool);
            this._renderSubOptions();
          })
        );
      }

      if (selInfo.isBuilding || selInfo.isWall) {
        pop.appendChild(this._makeSubDivider());
        pop.appendChild(
          this._buildWallStyleSwatches(selInfo.wallStyle, (styleId) => {
            this._toolOptions.wallStyle = styleId;
            selInfo.wallStyle = styleId;
            const patch = { wallStyle: styleId, style: styleId };
            this.callbacks.onSelectionModify?.(patch, this._selectedEntity);
            this._cbOptions(patch, this.activeTool);
            this._renderSubOptions();
          })
        );
      }

      if (selInfo.isCottage) {
        pop.appendChild(this._makeSubDivider());
        pop.appendChild(
          this._buildTogglePill('Tudor', selInfo.tudor, (next) => {
            this._toolOptions.tudor = next;
            selInfo.tudor = next;
            const patch = { tudor: next };
            this.callbacks.onSelectionModify?.(patch, this._selectedEntity);
            this._cbOptions(patch, this.activeTool);
            this._renderSubOptions();
          })
        );
      }

      if (selInfo.isTower || selInfo.isWall || selInfo.isCottage) {
        pop.appendChild(
          this._buildTogglePill('Crenellated', selInfo.crenellated, (next) => {
            this._toolOptions.crenellated = next;
            selInfo.crenellated = next;
            const patch = { crenellated: next };
            this.callbacks.onSelectionModify?.(patch, this._selectedEntity);
            this._cbOptions(patch, this.activeTool);
            this._renderSubOptions();
          })
        );
      }

      if (this.callbacks.onDeleteSelected) {
        pop.appendChild(this._makeSubDivider());
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'tg-sub-delete-btn';
        delBtn.title = 'Demolish Selected (Del / Backspace)';
        delBtn.innerHTML = `${ICONS.trash}<span>Demolish</span>`;
        delBtn.addEventListener('click', (e) => {
          this._blurOnPointer(e, delBtn);
          this._tick();
          const target = this._selectedEntity;
          this._selectedEntity = null;
          this._selectedInfo = null;
          this.callbacks.onDeleteSelected?.(target);
          this._renderSubOptions();
        });
        pop.appendChild(delBtn);
      }

      pop.hidden = false;
      return;
    }

    // 2. Contextual Tool Sub-Options
    if (tool === 'cottage' || tool === 'tower') {
      pop.appendChild(
        this._buildRoofSwatches(this._toolOptions.roofColor, (colorId) => {
          this._toolOptions.roofColor = colorId;
          this._cbOptions(this.getToolOptions(), tool);
          this._renderSubOptions();
        })
      );
      pop.appendChild(this._makeSubDivider());
      pop.appendChild(
        this._buildWallStyleSwatches(this._toolOptions.wallStyle, (styleId) => {
          this._toolOptions.wallStyle = styleId;
          this._cbOptions(this.getToolOptions(), tool);
          this._renderSubOptions();
        })
      );
      pop.appendChild(this._makeSubDivider());

      if (tool === 'cottage') {
        pop.appendChild(
          this._buildTogglePill('Tudor', this._toolOptions.tudor, (next) => {
            this._toolOptions.tudor = next;
            this._cbOptions(this.getToolOptions(), tool);
            this._renderSubOptions();
          })
        );
      }
      pop.appendChild(
        this._buildTogglePill('Crenellated', this._toolOptions.crenellated, (next) => {
          this._toolOptions.crenellated = next;
          this._cbOptions(this.getToolOptions(), tool);
          this._renderSubOptions();
        })
      );
      pop.hidden = false;
      return;
    }

    if (tool === 'wall') {
      pop.appendChild(
        this._buildWallStyleSwatches(this._toolOptions.wallStyle, (styleId) => {
          this._toolOptions.wallStyle = styleId;
          this._cbOptions(this.getToolOptions(), tool);
          this._renderSubOptions();
        })
      );
      pop.appendChild(this._makeSubDivider());
      pop.appendChild(
        this._buildTogglePill('Crenellated', this._toolOptions.crenellated, (next) => {
          this._toolOptions.crenellated = next;
          this._cbOptions(this.getToolOptions(), tool);
          this._renderSubOptions();
        })
      );
      pop.hidden = false;
      return;
    }

    if (tool === 'path') {
      pop.appendChild(
        this._buildOptionPills(PATH_STYLES, this._toolOptions.pathStyle, 'pathStyle', (val) => {
          this._toolOptions.pathStyle = val;
          this._cbOptions(this.getToolOptions(), tool);
          this._renderSubOptions();
        })
      );
      pop.appendChild(this._makeSubDivider());
      pop.appendChild(
        this._buildInlineSlider(
          'Width',
          1.2,
          4.0,
          0.1,
          this._toolOptions.pathWidth,
          (v) => `${v.toFixed(1)} m`,
          (v) => {
            this._toolOptions.pathWidth = v;
            this._cbOptions(this.getToolOptions(), tool);
          }
        )
      );
      pop.hidden = false;
      return;
    }

    if (tool === 'clutter') {
      pop.appendChild(
        this._buildOptionPills(CLUTTER_TYPES, this._toolOptions.clutterType, 'clutterType', (val) => {
          this._toolOptions.clutterType = val;
          this._cbOptions(this.getToolOptions(), tool);
          this._renderSubOptions();
        })
      );
      pop.hidden = false;
      return;
    }

    if (tool === 'terrain') {
      pop.appendChild(
        this._buildOptionPills(TERRAIN_MODES, this._toolOptions.terrainMode, 'terrainMode', (val) => {
          this._toolOptions.terrainMode = val;
          this._cbOptions(this.getToolOptions(), tool);
          this._renderSubOptions();
        })
      );
      pop.appendChild(this._makeSubDivider());
      pop.appendChild(
        this._buildInlineSlider(
          'Brush',
          2.0,
          18.0,
          0.5,
          this._toolOptions.terrainBrushSize,
          (v) => `${v.toFixed(1)} m`,
          (v) => {
            this._toolOptions.terrainBrushSize = v;
            this._cbOptions(this.getToolOptions(), tool);
          }
        )
      );
      pop.hidden = false;
      return;
    }

    if (tool === 'nature') {
      pop.appendChild(
        this._buildOptionPills(NATURE_TYPES, this._toolOptions.natureType, 'natureType', (val) => {
          this._toolOptions.natureType = val;
          this._cbOptions(this.getToolOptions(), tool);
          this._renderSubOptions();
        })
      );
      pop.appendChild(this._makeSubDivider());
      pop.appendChild(
        this._buildInlineSlider(
          'Brush',
          2.5,
          18.0,
          0.5,
          this._toolOptions.natureBrushSize,
          (v) => `${v.toFixed(1)} m`,
          (v) => {
            this._toolOptions.natureBrushSize = v;
            this._cbOptions(this.getToolOptions(), tool);
          }
        )
      );
      pop.hidden = false;
      return;
    }

    if (tool === 'demolish') {
      pop.appendChild(
        this._buildInlineSlider(
          'Erase Radius',
          1.5,
          8.0,
          0.5,
          this._toolOptions.demolishRadius,
          (v) => `${v.toFixed(1)} m`,
          (v) => {
            this._toolOptions.demolishRadius = v;
            this._cbOptions(this.getToolOptions(), tool);
          }
        )
      );
      pop.hidden = false;
      return;
    }

    // For 'select' (no selection) or 'fence', keep popover cleanly hidden
    pop.hidden = true;
  }

  _makeSubDivider() {
    const d = document.createElement('span');
    d.className = 'tg-divider';
    return d;
  }

  _buildRoofSwatches(activeId, onSelect) {
    const group = document.createElement('div');
    group.className = 'tg-swatch-group';
    const lbl = document.createElement('span');
    lbl.className = 'tg-sub-label';
    lbl.textContent = 'Roof';
    group.appendChild(lbl);

    for (const sw of ROOF_SWATCHES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tg-swatch' + (sw.id === activeId ? ' is-active' : '');
      btn.style.setProperty('--swatch-color', sw.hex);
      btn.dataset.roofColor = sw.id;
      btn.title = `Roof: ${sw.label}`;
      btn.setAttribute('aria-label', `Roof color ${sw.label}`);
      btn.setAttribute('aria-pressed', String(sw.id === activeId));
      btn.addEventListener('click', (e) => {
        this._blurOnPointer(e, btn);
        this._tick();
        onSelect(sw.id);
      });
      group.appendChild(btn);
    }
    return group;
  }

  _buildWallStyleSwatches(activeId, onSelect) {
    const group = document.createElement('div');
    group.className = 'tg-swatch-group';
    const lbl = document.createElement('span');
    lbl.className = 'tg-sub-label';
    lbl.textContent = 'Stone';
    group.appendChild(lbl);

    for (const st of WALL_STYLES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tg-wall-pill' + (st.id === activeId ? ' is-active' : '');
      btn.dataset.wallStyle = st.id;
      btn.title = `Wall Material: ${st.label}`;
      btn.setAttribute('aria-pressed', String(st.id === activeId));

      const dot = document.createElement('span');
      dot.className = 'tg-wall-dot';
      dot.style.backgroundColor = st.hex;

      const txt = document.createElement('span');
      txt.textContent = st.label;

      btn.append(dot, txt);
      btn.addEventListener('click', (e) => {
        this._blurOnPointer(e, btn);
        this._tick();
        onSelect(st.id);
      });
      group.appendChild(btn);
    }
    return group;
  }

  _buildOptionPills(items, activeId, dataAttr, onSelect) {
    const group = document.createElement('div');
    group.className = 'tg-seg-group';
    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tg-seg-btn' + (item.id === activeId ? ' is-active' : '');
      btn.dataset[dataAttr] = item.id;
      btn.textContent = item.label;
      btn.setAttribute('aria-pressed', String(item.id === activeId));
      btn.addEventListener('click', (e) => {
        this._blurOnPointer(e, btn);
        this._tick();
        onSelect(item.id);
      });
      group.appendChild(btn);
    }
    return group;
  }

  _buildTogglePill(label, active, onToggle) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tg-toggle-pill' + (active ? ' is-active' : '');
    btn.dataset.toggle = label.toLowerCase();
    btn.textContent = label;
    btn.setAttribute('aria-pressed', String(active));
    btn.addEventListener('click', (e) => {
      this._blurOnPointer(e, btn);
      this._tick();
      onToggle(!active);
    });
    return btn;
  }

  _buildInlineSlider(label, min, max, step, value, formatFn, onInput) {
    const wrap = document.createElement('label');
    wrap.className = 'tg-inline-slider';

    const lbl = document.createElement('span');
    lbl.className = 'tg-sub-label';
    lbl.textContent = label;

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'tg-slider tg-sub-range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);

    const valEl = document.createElement('span');
    valEl.className = 'tg-sub-val';
    valEl.textContent = formatFn(value);

    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      valEl.textContent = formatFn(v);
      onInput(v);
    });

    wrap.append(lbl, input, valEl);
    return wrap;
  }

  /**
   * Updates Time-of-Day slider, HH:MM clock readout, Sun/Moon icon, and preset highlight.
   */
  updateTimeOfDay(hours) {
    const wrapped = ((Number(hours) || 0) % 24 + 24) % 24;
    this._timeOfDay = wrapped;

    if (this._els.timeSlider) {
      this._els.timeSlider.value = String(wrapped);
    }
    if (this._els.timeReadout) {
      this._els.timeReadout.textContent = formatClock(wrapped);
    }
    if (this._els.skyIcon) {
      const isNight = wrapped < 5.8 || wrapped >= 19.6;
      this._els.skyIcon.innerHTML = isNight ? ICONS.moon : ICONS.sun;
    }
    if (this._timePresetBtns) {
      for (const item of this._timePresetBtns) {
        const close = Math.abs(item.hours - wrapped) < 0.35;
        item.btn.classList.toggle('is-active', close);
      }
    }
  }

  /**
   * Updates real live telemetry readout ({ fps, frameMs, drawCalls, triangles, quality }).
   */
  updateStats(stats = {}) {
    const el = this._els.perfPanel;
    if (!el || !this._perfVisible) return;

    const fps = stats.fps !== undefined ? Math.round(Number(stats.fps) || 0) : '--';
    const ms =
      stats.frameMs !== undefined ? Number(stats.frameMs || 0).toFixed(1) : '--';
    const draws =
      stats.drawCalls !== undefined ? Math.round(Number(stats.drawCalls) || 0) : '--';
    const tris =
      stats.triangles !== undefined ? formatCompactCount(stats.triangles) : '--';
    const qualRaw = String(stats.quality || this._envOptions.quality || 'high');
    const qual = qualRaw.charAt(0).toUpperCase() + qualRaw.slice(1);

    el.textContent = `${fps} FPS · ${ms} ms · ${draws} draws · ${tris} tris · ${qual}`;
  }

  /**
   * Enables / disables Undo & Redo buttons cleanly.
   */
  setHistoryState(canUndo, canRedo) {
    if (this._els.undoBtn) {
      this._els.undoBtn.disabled = !canUndo;
      this._els.undoBtn.setAttribute('aria-disabled', String(!canUndo));
    }
    if (this._els.redoBtn) {
      this._els.redoBtn.disabled = !canRedo;
      this._els.redoBtn.setAttribute('aria-disabled', String(!canRedo));
    }
  }

  /**
   * Syncs First-Person Stroll Mode UI state.
   */
  setWalkMode(active) {
    this._walkMode = Boolean(active);
    if (this._els.walkBtn) {
      this._els.walkBtn.classList.toggle('is-active', this._walkMode);
      this._els.walkBtn.setAttribute('aria-pressed', String(this._walkMode));
    }
    if (this._els.walkBanner) {
      this._els.walkBanner.hidden = !this._walkMode;
    }
    if (this._els.dock) {
      this._els.dock.classList.toggle('is-strolling', this._walkMode);
    }
    this._renderSubOptions();
  }

  /**
   * Toggles clean Photo Mode (hides HUD chrome and reveals subtle Capture/Exit pill).
   */
  setPhotoMode(active) {
    this._photoMode = Boolean(active);
    this._els.hud?.classList.toggle('is-photo-mode', this._photoMode);
    if (this._els.photoPill) {
      this._els.photoPill.hidden = !this._photoMode;
    }
    if (this._photoMode && this._drawerOpen) {
      this._toggleDrawer(false);
    }
    this.callbacks.onPhotoModeChange?.(this._photoMode);
  }

  setMuted(muted) {
    this._muted = Boolean(muted);
    if (this._els.muteBtn) {
      const iconEl = this._els.muteBtn.querySelector('.tg-btn-icon');
      if (iconEl) {
        iconEl.innerHTML = this._muted ? ICONS.speakerOff : ICONS.speakerOn;
      }
      this._els.muteBtn.classList.toggle('is-active', this._muted);
      this._els.muteBtn.setAttribute('aria-pressed', String(this._muted));
    }
  }

  setQuality(tier) {
    const normalized = String(tier || 'high').toLowerCase();
    this._envOptions.quality = normalized;
    for (const item of this._qualBtns || []) {
      item.btn.classList.toggle('is-active', item.id === normalized);
    }
  }

  setPresetValue(presetId) {
    if (this._els.presetSelect && presetId) {
      this._els.presetSelect.value = presetId;
      this._syncPresetAtmosphereDefaults(presetId);
    }
  }

  /**
   * Displays a concise, auto-dismissing status toast at top-center.
   */
  showToast(msg, durationMs = 2500) {
    const el = this._els.toast;
    if (!el || !msg) return;

    el.textContent = String(msg);
    el.hidden = false;
    el.classList.add('is-visible');

    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
    }
    this._toastTimer = setTimeout(() => {
      el.classList.remove('is-visible');
      this._toastTimer = setTimeout(() => {
        el.hidden = true;
      }, 220);
    }, durationMs);
  }

  _bindHotkeys() {
    this._onKeyDown = (e) => {
      if (e.defaultPrevented) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target?.isContentEditable) {
        return;
      }

      const key = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;

      // Undo / Redo shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y, or bare Z)
      if (mod && key === 'z') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.shiftKey) {
          if (!this._els.redoBtn?.disabled) {
            this._tick();
            this.callbacks.onRedo?.();
          }
        } else if (!this._els.undoBtn?.disabled) {
          this._tick();
          this.callbacks.onUndo?.();
        }
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!this._els.redoBtn?.disabled) {
          this._tick();
          this.callbacks.onRedo?.();
        }
        return;
      }
      if (mod || e.altKey) return;

      if (key === 'z') {
        if (e.shiftKey) {
          if (!this._els.redoBtn?.disabled) {
            e.preventDefault();
            this._tick();
            this.callbacks.onRedo?.();
          }
        } else if (!this._els.undoBtn?.disabled) {
          e.preventDefault();
          this._tick();
          this.callbacks.onUndo?.();
        }
        return;
      }

      // Escape exits Photo Mode or closes Atmosphere drawer (CameraController handles Walk Mode Esc)
      if (key === 'escape') {
        if (this._photoMode) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.setPhotoMode(false);
          return;
        }
        if (this._drawerOpen) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this._toggleDrawer(false);
          return;
        }
        return;
      }

      // Photo mode toggle (P)
      if (key === 'p') {
        e.preventDefault();
        this._tick();
        this.setPhotoMode(!this._photoMode);
        return;
      }

      // Mute toggle (M)
      if (key === 'm') {
        e.preventDefault();
        const nextMuted = !this._muted;
        this.setMuted(nextMuted);
        this._cbMute(nextMuted);
        return;
      }

      // Stroll Mode toggle (F)
      if (key === 'f') {
        e.preventDefault();
        this._tick();
        const nextWalk = !this._walkMode;
        this.setWalkMode(nextWalk);
        this._cbWalk(nextWalk);
        return;
      }

      if (this._photoMode) return;

      // Delete / Backspace when an entity is selected
      if ((key === 'delete' || key === 'backspace') && this._selectedEntity && this.callbacks.onDeleteSelected) {
        e.preventDefault();
        this._tick();
        const target = this._selectedEntity;
        this._selectedEntity = null;
        this.callbacks.onDeleteSelected?.(target);
        this._renderSubOptions();
        return;
      }

      // Tool dock hotkeys: 1-9, 0, V
      for (const tool of TOOLS) {
        if (key === tool.hotkey || (tool.altKey && key === tool.altKey)) {
          e.preventDefault();
          this._tick();
          this._selectToolFromUser(tool.id);
          return;
        }
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._onKeyDown);
    }
  }

  destroy() {
    if (typeof window !== 'undefined' && this._onKeyDown) {
      window.removeEventListener('keydown', this._onKeyDown);
      this._onKeyDown = null;
    }
    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
    }
    this._els.hud?.remove();
  }
}
