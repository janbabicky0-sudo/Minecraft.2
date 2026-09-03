// Health / hunger rows, FPS + debug readout, crosshair visibility.
export class HUD {
  constructor() {
    this.elHealth = document.getElementById('health');
    this.elHunger = document.getElementById('hunger');
    this.elDebug = document.getElementById('debug');
    this.elCrosshair = document.getElementById('crosshair');
    this.elHud = document.getElementById('hud');

    this._frames = 0;
    this._fpsTime = 0;
    this._fps = 0;
    this._debugOn = false;
    this._mode = 'survival';

    this._buildBar(this.elHealth, 10, 'heart');
    this._buildBar(this.elHunger, 10, 'food');
  }

  _buildBar(root, n, cls) {
    root.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const d = document.createElement('span');
      d.className = `pip ${cls}`;
      root.appendChild(d);
    }
  }

  setVisible(v) {
    this.elHud.classList.toggle('hidden', !v);
    this.elCrosshair.classList.toggle('hidden', !v);
  }

  toggleDebug() {
    this._debugOn = !this._debugOn;
    this.elDebug.classList.toggle('hidden', !this._debugOn);
  }

  setMode(mode) {
    this._mode = mode;
    const hide = mode === 'creative';
    this.elHealth.style.display = hide ? 'none' : '';
    this.elHunger.style.display = hide ? 'none' : '';
  }

  _renderBar(root, value, max) {
    // value/max in 0..20 scale, 10 pips, each pip = 2 (full/half/empty)
    const pips = root.children;
    const units = Math.max(0, Math.round((value / max) * 20));
    for (let i = 0; i < pips.length; i++) {
      const filled = units - i * 2;
      pips[i].classList.toggle('full', filled >= 2);
      pips[i].classList.toggle('half', filled === 1);
      pips[i].classList.toggle('empty', filled <= 0);
    }
  }

  update(dt, ctx) {
    this._frames++;
    this._fpsTime += dt;
    if (this._fpsTime >= 0.5) {
      this._fps = Math.round(this._frames / this._fpsTime);
      this._frames = 0;
      this._fpsTime = 0;
    }

    const { player } = ctx;
    if (player.mode !== 'creative') {
      this._renderBar(this.elHealth, player.health, player.maxHealth);
      this._renderBar(this.elHunger, player.hunger, player.maxHunger);
    }

    if (this._debugOn) {
      const p = player.pos;
      const b = ctx.biomeName || '?';
      this.elDebug.textContent =
        `${this._fps} FPS\n` +
        `XYZ ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}\n` +
        `chunk ${Math.floor(p.x / 16)}, ${Math.floor(p.z / 16)}  ·  ${ctx.chunks} loaded\n` +
        `biom ${b}  ·  ${ctx.phase} ${ctx.clock}\n` +
        `${player.mode === 'creative' ? 'kreativní' : 'přežití'} · ${player.flying ? 'let' : 'chůze'}${player.onGround ? ' (na zemi)' : ''}\n` +
        `míří na ${ctx.lookingAt || '—'}`;
    }
  }

  flashHand() {
    document.getElementById('game')?.animate(
      [{ filter: 'brightness(1.15)' }, { filter: 'brightness(1)' }],
      { duration: 90 }
    );
  }

  get fps() { return this._fps; }
}
