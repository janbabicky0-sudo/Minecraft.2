import { MIN_RENDER_DISTANCE, MAX_RENDER_DISTANCE } from '../constants.js';

export class PauseMenu {
  constructor(opts) {
    this.el = document.getElementById('pause');
    this.open = false;
    this.opts = opts;

    this._btn = {
      resume: document.getElementById('btn-resume'),
      mode: document.getElementById('btn-mode'),
      fly: document.getElementById('btn-fly'),
      render: document.getElementById('btn-render'),
      save: document.getElementById('btn-save'),
      reset: document.getElementById('btn-reset'),
    };

    this._btn.resume.onclick = () => opts.onResume();
    this._btn.mode.onclick = () => { opts.onToggleMode(); this.refresh(); };
    this._btn.fly.onclick = () => { opts.onToggleFly(); this.refresh(); };
    this._btn.render.onclick = () => { opts.onCycleRender(); this.refresh(); };
    this._btn.save.onclick = () => {
      opts.onSave();
      this._btn.save.textContent = 'Uloženo ✓';
      setTimeout(() => (this._btn.save.textContent = 'Uložit hru'), 1200);
    };
    this._btn.reset.onclick = () => {
      if (confirm('Opravdu vytvořit nový svět? Aktuální svět se smaže.')) opts.onReset();
    };
  }

  show() {
    this.open = true;
    this.el.classList.remove('hidden');
    this.refresh();
  }
  hide() {
    this.open = false;
    this.el.classList.add('hidden');
  }

  refresh() {
    const s = this.opts.getState();
    const creative = s.mode === 'creative';
    this._btn.mode.textContent = `Režim: ${creative ? 'Kreativní' : 'Přežití'} (přepnout)`;
    this._btn.fly.textContent = `Létání: ${s.flying ? 'zap' : 'vyp'}`;
    this._btn.fly.classList.toggle('hidden', !creative);
    this._btn.render.textContent = `Dohlednost: ${s.renderDistance}`;
    this._btn.render.disabled = false;
  }
}

export function clampRender(d) {
  if (d > MAX_RENDER_DISTANCE) return MIN_RENDER_DISTANCE;
  if (d < MIN_RENDER_DISTANCE) return MIN_RENDER_DISTANCE;
  return d;
}
