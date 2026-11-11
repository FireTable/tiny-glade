/**
 * HistoryManager.js
 * Deep-cloned state stack (max 40 steps) for world + arch + env snapshots,
 * plus lossless JSON scene export & import (supporting TypedArrays & plain objects).
 */

const TYPED_ARRAY_CTORS = {
  Float32Array,
  Float64Array,
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
};

function deepCloneSnapshot(value) {
  if (value === null || typeof value !== 'object') return value;

  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Fallback to manual recursive clone if non-cloneable field exists
    }
  }

  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return new value.constructor(value);
  }
  if (Array.isArray(value)) {
    const out = new Array(value.length);
    for (let i = 0; i < value.length; i++) {
      out[i] = deepCloneSnapshot(value[i]);
    }
    return out;
  }

  const out = {};
  for (const key of Object.keys(value)) {
    const v = value[key];
    if (typeof v !== 'function') {
      out[key] = deepCloneSnapshot(v);
    }
  }
  return out;
}

function snapshotsEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }

  const aView = ArrayBuffer.isView(a) && !(a instanceof DataView);
  const bView = ArrayBuffer.isView(b) && !(b instanceof DataView);
  if (aView || bView) {
    if (!aView || !bView || a.constructor !== b.constructor || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr || bArr) {
    if (!aArr || !bArr || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!snapshotsEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    const k = keysA[i];
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!snapshotsEqual(a[k], b[k])) return false;
  }
  return true;
}

function jsonReplacer(_key, value) {
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const ctorName = value.constructor?.name;
    if (ctorName && TYPED_ARRAY_CTORS[ctorName]) {
      // Round Float32 slightly for compact human-friendly JSON files while staying sub-millimeter accurate
      const arr = new Array(value.length);
      if (ctorName === 'Float32Array' || ctorName === 'Float64Array') {
        for (let i = 0; i < value.length; i++) {
          arr[i] = Math.round(value[i] * 10000) / 10000;
        }
      } else {
        for (let i = 0; i < value.length; i++) {
          arr[i] = value[i];
        }
      }
      return { __typedArray: ctorName, data: arr };
    }
  }
  return value;
}

function jsonReviver(_key, value) {
  if (
    value &&
    typeof value === 'object' &&
    typeof value.__typedArray === 'string' &&
    Array.isArray(value.data) &&
    TYPED_ARRAY_CTORS[value.__typedArray]
  ) {
    const Ctor = TYPED_ARRAY_CTORS[value.__typedArray];
    return new Ctor(value.data);
  }
  return value;
}

export class HistoryManager {
  constructor(maxSteps = 40) {
    this.maxSteps = Math.max(1, Number(maxSteps) || 40);
    this._undoStack = [];
    this._redoStack = [];
    // Automatically adapts to both pre-mutation pushState and baseline+post-mutation pushState
    this._postStateMode = false;
  }

  /**
   * Optional explicit baseline initializer for post-mutation history tracking.
   */
  setBaseline(snapshot) {
    if (!snapshot) return;
    this._undoStack = [deepCloneSnapshot(snapshot)];
    this._redoStack = [];
    this._postStateMode = true;
  }

  /**
   * Pushes a deep-cloned snapshot onto the undo stack and clears redo history.
   */
  pushState(snapshot) {
    if (!snapshot) return;
    const cloned = deepCloneSnapshot(snapshot);

    if (this._undoStack.length > 0) {
      const top = this._undoStack[this._undoStack.length - 1];
      if (snapshotsEqual(top, cloned)) {
        return;
      }
    }

    this._undoStack.push(cloned);
    this._redoStack.length = 0;

    const cap = this._postStateMode ? this.maxSteps + 1 : this.maxSteps;
    while (this._undoStack.length > cap) {
      this._undoStack.shift();
    }
  }

  /**
   * Reverts to the previous snapshot, storing currentSnapshot on the redo stack.
   * Works seamlessly whether callers push state before edits OR push state after edits.
   */
  undo(currentSnapshot) {
    if (this._undoStack.length === 0) return null;

    if (currentSnapshot !== undefined && currentSnapshot !== null) {
      const top = this._undoStack[this._undoStack.length - 1];
      if (snapshotsEqual(top, currentSnapshot)) {
        // Post-mutation stack mode: top of undoStack IS the current live state
        this._postStateMode = true;
        if (this._undoStack.length < 2) {
          return null;
        }
        const poppedCurrent = this._undoStack.pop();
        this._redoStack.push(poppedCurrent);
        while (this._redoStack.length > this.maxSteps) {
          this._redoStack.shift();
        }
        const prev = this._undoStack[this._undoStack.length - 1];
        return deepCloneSnapshot(prev);
      }

      // Pre-mutation stack mode: top of undoStack is the state prior to currentSnapshot
      const prev = this._undoStack.pop();
      this._redoStack.push(deepCloneSnapshot(currentSnapshot));
      while (this._redoStack.length > this.maxSteps) {
        this._redoStack.shift();
      }
      return deepCloneSnapshot(prev);
    }

    // Fallback when called without currentSnapshot
    this._postStateMode = true;
    if (this._undoStack.length < 2) {
      return null;
    }
    const current = this._undoStack.pop();
    this._redoStack.push(current);
    return deepCloneSnapshot(this._undoStack[this._undoStack.length - 1]);
  }

  /**
   * Re-applies the next undone snapshot from the redo stack.
   */
  redo(currentSnapshot) {
    if (this._redoStack.length === 0) return null;

    const next = this._redoStack.pop();

    if (this._postStateMode || currentSnapshot === undefined || currentSnapshot === null) {
      this._undoStack.push(deepCloneSnapshot(next));
      const cap = this.maxSteps + 1;
      while (this._undoStack.length > cap) {
        this._undoStack.shift();
      }
      return deepCloneSnapshot(next);
    }

    // Pre-mutation stack mode: push currentSnapshot back onto undoStack
    this._undoStack.push(deepCloneSnapshot(currentSnapshot));
    while (this._undoStack.length > this.maxSteps) {
      this._undoStack.shift();
    }
    return deepCloneSnapshot(next);
  }

  canUndo() {
    return this._postStateMode ? this._undoStack.length > 1 : this._undoStack.length > 0;
  }

  canRedo() {
    return this._redoStack.length > 0;
  }

  clear() {
    this._undoStack.length = 0;
    this._redoStack.length = 0;
    this._postStateMode = false;
  }

  /**
   * Downloads snapshot as a formatted JSON file in the browser.
   */
  exportJSON(snapshot, filename = 'tiny-glade-scene.json') {
    if (!snapshot) return '';
    const payload = {
      format: 'tiny-glade-scene',
      version: 1,
      exportedAt: new Date().toISOString(),
      scene: deepCloneSnapshot(snapshot),
    };
    const json = JSON.stringify(payload, jsonReplacer, 2);

    if (typeof document !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename || 'tiny-glade-scene.json';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    return json;
  }

  /**
   * Reads and parses an exported JSON File/Blob (or JSON string) back into a scene snapshot.
   */
  async importJSON(file) {
    if (!file) {
      throw new Error('No scene file provided.');
    }

    let rawText = '';
    if (typeof file === 'string') {
      rawText = file;
    } else if (typeof file.text === 'function') {
      rawText = await file.text();
    } else if (typeof FileReader !== 'undefined') {
      rawText = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read scene JSON file.'));
        reader.readAsText(file);
      });
    } else {
      throw new Error('Unsupported file input for importJSON.');
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText, jsonReviver);
    } catch {
      throw new Error('Invalid JSON in scene file.');
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Scene JSON root must be an object.');
    }

    // Unwrap { format: 'tiny-glade-scene', scene: {...} } or accept direct snapshot objects
    const snapshot =
      parsed.format === 'tiny-glade-scene' && parsed.scene && typeof parsed.scene === 'object'
        ? parsed.scene
        : parsed;

    return deepCloneSnapshot(snapshot);
  }
}
