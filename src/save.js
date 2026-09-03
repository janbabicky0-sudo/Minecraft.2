import { SAVE_KEY } from './constants.js';

const SEED_KEY = SAVE_KEY + '.seed';

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('save load failed', e);
    return null;
  }
}

export function writeSave(data) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('save write failed (quota?)', e);
    return false;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {}
}

export function getSeed() {
  let s = localStorage.getItem(SEED_KEY);
  if (!s) {
    s = String(Math.floor(Math.random() * 1e9));
    try { localStorage.setItem(SEED_KEY, s); } catch {}
  }
  return s;
}

export function newSeed() {
  const s = String(Math.floor(Math.random() * 1e9));
  try { localStorage.setItem(SEED_KEY, s); } catch {}
  return s;
}

// debounced saver
export function makeAutoSaver(getData, interval = 4000) {
  let dirty = false;
  let last = 0;
  return {
    markDirty() { dirty = true; },
    tick(now) {
      if (dirty && now - last > interval) {
        writeSave(getData());
        dirty = false;
        last = now;
      }
    },
    flush() {
      writeSave(getData());
      dirty = false;
    },
  };
}
