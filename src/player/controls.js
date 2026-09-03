import * as THREE from 'three';

// Pointer-lock mouse look + keyboard state. Emits high-level events via callbacks.
export class Controls {
  constructor(player, domElement, opts = {}) {
    this.player = player;
    this.dom = domElement;
    this.enabled = false;
    this.sensitivity = 0.0022;

    this.on = {
      lock: opts.onLock || (() => {}),
      unlock: opts.onUnlock || (() => {}),
      hotbar: opts.onHotbar || (() => {}),
      scroll: opts.onScroll || (() => {}),
      toggleInventory: opts.onToggleInventory || (() => {}),
      togglePause: opts.onTogglePause || (() => {}),
      toggleDebug: opts.onToggleDebug || (() => {}),
      toggleHeadlamp: opts.onToggleHeadlamp || (() => {}),
      startMine: opts.onStartMine || (() => {}),
      stopMine: opts.onStopMine || (() => {}),
      place: opts.onPlace || (() => {}),
      pick: opts.onPick || (() => {}),
    };

    this._keys = new Set();
    this._lastSpace = 0;
    this._bind();
  }

  _bind() {
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.dom;
      this.enabled = locked;
      if (locked) this.on.lock();
      else { this._keys.clear(); this._resetInput(); this.on.unlock(); }
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      this.player.yaw -= e.movementX * this.sensitivity;
      this.player.pitch -= e.movementY * this.sensitivity;
      const lim = Math.PI / 2 - 0.01;
      this.player.pitch = Math.max(-lim, Math.min(lim, this.player.pitch));
    });

    this.dom.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0) this.on.startMine();
      else if (e.button === 2) this.on.place();
      else if (e.button === 1) { e.preventDefault(); this.on.pick(); }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.on.stopMine();
    });
    this.dom.addEventListener('contextmenu', (e) => e.preventDefault());

    this.dom.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.on.scroll(Math.sign(e.deltaY));
    }, { passive: false });

    window.addEventListener('keydown', (e) => this._onKey(e, true));
    window.addEventListener('keyup', (e) => this._onKey(e, false));
    window.addEventListener('blur', () => { this._keys.clear(); this._resetInput(); });
  }

  requestLock() {
    try {
      const r = this.dom.requestPointerLock?.();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch { /* pointer lock unavailable (e.g. sandboxed preview) */ }
  }
  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  _onKey(e, down) {
    const code = e.code;

    // keys that work regardless of lock
    if (down && code === 'KeyE') { this.on.toggleInventory(); return; }
    if (down && code === 'Escape') { this.on.togglePause(); return; }
    if (down && code === 'F3') { e.preventDefault(); this.on.toggleDebug(); return; }

    if (!this.enabled) return;

    if (down && !e.repeat) {
      if (code === 'KeyF') { this.on.toggleHeadlamp(); }
      if (/^Digit[1-9]$/.test(code)) this.on.hotbar(parseInt(code.slice(5), 10) - 1);
      if (code === 'Space') {
        const now = performance.now();
        if (now - this._lastSpace < 280) this.player.toggleFly();
        this._lastSpace = now;
      }
    }

    if (down) this._keys.add(code);
    else this._keys.delete(code);
    this._apply();
  }

  _resetInput() {
    const i = this.player.input;
    i.forward = i.right = i.up = i.down = 0;
    i.jump = i.sprint = false;
  }

  _apply() {
    const k = this._keys;
    const i = this.player.input;
    i.forward = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    i.right = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    i.jump = k.has('Space');
    i.up = k.has('Space') ? 1 : 0;
    i.down = (k.has('ShiftLeft') || k.has('ShiftRight')) ? 1 : 0;
    i.sprint = k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyR');
  }

  // call each frame so held-key state stays fresh even without events
  tick() {
    if (this.enabled) this._apply();
  }
}
