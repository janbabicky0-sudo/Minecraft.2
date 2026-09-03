import { B, I, isItem } from '../constants.js';
import { itemName, itemTile, maxStack, foodOf } from '../registry/items.js';
import { matchRecipe } from '../registry/recipes.js';

const HOTBAR = 9;
const MAIN = 27;

export function iconBackground(atlas, id) {
  const name = itemTile(id);
  if (!name) return null;
  const { map, cols, tile, width, height } = atlas.meta;
  const i = map[name];
  if (i == null) return null;
  const col = i % cols;
  const row = Math.floor(i / cols);
  return { col, row, tile, atlasW: width, atlasH: height };
}

export class Inventory {
  constructor(atlas, opts = {}) {
    this.atlas = atlas;
    this.onChange = opts.onChange || (() => {});
    this.getHasTable = opts.getHasTable || (() => false);

    // hotbar 0..8, main 9..35
    this.slots = new Array(HOTBAR + MAIN).fill(null);
    this.active = 0;

    this.craft = new Array(9).fill(null); // used as 2x2 (indices via map) or 3x3
    this.cursor = null; // { id, count } held by mouse
    this.tableMode = false;
    this.open = false;

    this._els = {};
    this._buildDOM();
  }

  // ---------- state ----------
  activeItem() {
    return this.slots[this.active];
  }

  setActive(i) {
    this.active = ((i % HOTBAR) + HOTBAR) % HOTBAR;
    this._renderHotbar();
    this.onChange();
  }

  scrollActive(dir) {
    this.setActive(this.active + (dir > 0 ? 1 : -1));
  }

  add(id, count = 1) {
    const ms = maxStack(id);
    // fill matching stacks (hotbar first, then main)
    for (let pass = 0; pass < 2 && count > 0; pass++) {
      for (let i = 0; i < this.slots.length && count > 0; i++) {
        const s = this.slots[i];
        if (s && s.id === id && s.count < ms) {
          const add = Math.min(ms - s.count, count);
          s.count += add; count -= add;
        }
      }
      if (count <= 0) break;
      // empty slots
      for (let i = 0; i < this.slots.length && count > 0; i++) {
        if (!this.slots[i]) {
          const add = Math.min(ms, count);
          this.slots[i] = { id, count: add };
          count -= add;
        }
      }
    }
    this._renderAll();
    this.onChange();
    return count; // leftover (dropped on the floor conceptually)
  }

  has(id, count = 1) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n >= count;
  }

  remove(id, count = 1) {
    for (let i = 0; i < this.slots.length && count > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const take = Math.min(s.count, count);
        s.count -= take; count -= take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    this._renderAll();
    this.onChange();
  }

  consumeActive(n = 1) {
    const s = this.slots[this.active];
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.active] = null;
    this._renderHotbar();
    this.onChange();
  }

  pickBlock(id) {
    // if it's already in a slot, select that slot; else drop it in first free hotbar slot
    for (let i = 0; i < HOTBAR; i++) if (this.slots[i]?.id === id) { this.setActive(i); return; }
    for (let i = HOTBAR; i < this.slots.length; i++) {
      if (this.slots[i]?.id === id) {
        const dst = this._firstFreeHotbar();
        [this.slots[dst], this.slots[i]] = [this.slots[i], this.slots[dst]];
        this.setActive(dst);
        this._renderAll();
        return;
      }
    }
    // creative pick: give one
    const dst = this._firstFreeHotbar();
    this.slots[dst] = { id, count: 1 };
    this.setActive(dst);
    this._renderAll();
  }

  _firstFreeHotbar() {
    for (let i = 0; i < HOTBAR; i++) if (!this.slots[i]) return i;
    return this.active;
  }

  // eat active food item; returns hunger restored or 0
  eatActive() {
    const s = this.slots[this.active];
    if (!s) return 0;
    const f = foodOf(s.id);
    if (!f) return 0;
    this.consumeActive(1);
    return f;
  }

  serialize() {
    return {
      active: this.active,
      slots: this.slots.map((s) => (s ? [s.id, s.count] : 0)),
    };
  }
  load(data) {
    if (!data) return;
    this.active = data.active || 0;
    this.slots = (data.slots || []).map((s) => (s ? { id: s[0], count: s[1] } : null));
    while (this.slots.length < HOTBAR + MAIN) this.slots.push(null);
    this._renderAll();
  }

  giveStarterKit(mode = 'survival') {
    if (mode === 'creative') {
      // effectively infinite (creative doesn't consume) — one of each useful block
      const kit = [
        B.GRASS, B.DIRT, B.STONE, B.COBBLESTONE, B.SAND, B.LOG, B.PLANKS, B.GLASS, B.CRAFTING_TABLE,
      ];
      kit.forEach((id, i) => { this.slots[i] = { id, count: 64 }; });
      this.slots[9] = { id: I.STONE_PICKAXE, count: 1 };
      this.slots[10] = { id: I.STONE_AXE, count: 1 };
      this.slots[11] = { id: I.STONE_SHOVEL, count: 1 };
    } else {
      this.slots[0] = { id: I.WOOD_PICKAXE, count: 1 };
      this.slots[1] = { id: I.WOOD_AXE, count: 1 };
      this.slots[2] = { id: I.WOOD_SHOVEL, count: 1 };
      this.slots[3] = { id: B.PLANKS, count: 16 };
      this.slots[4] = { id: B.CRAFTING_TABLE, count: 1 };
    }
    this._renderAll();
  }

  // ---------- crafting ----------
  craftSize() { return this.tableMode ? 3 : 2; }

  _craftCells() {
    // map the visible grid (size*size) onto this.craft
    const n = this.craftSize();
    const out = [];
    for (let i = 0; i < n * n; i++) out.push(this.craft[i]);
    return out;
  }

  _currentOutput() {
    const size = this.craftSize();
    const cells = this._craftCells();
    return matchRecipe(cells, size, this.tableMode || this.getHasTable());
  }

  // Click the output slot: craft one batch straight into the inventory.
  // Shift-click: craft as many batches as the ingredients allow.
  _takeOutput(all) {
    const first = this._currentOutput();
    if (!first) return;

    let batches = 0;
    const maxBatches = all ? 999 : 1;
    while (batches < maxBatches) {
      const out = this._currentOutput();
      if (!out || out.id !== first.id) break;

      // if the cursor is holding a stack, add onto it; otherwise into the grid
      if (this.cursor && this.cursor.id === out.id
          && this.cursor.count + out.count <= maxStack(out.id)) {
        this.cursor.count += out.count;
      } else {
        const leftover = this.add(out.id, out.count);
        if (leftover > 0) break; // inventory full — stop crafting
      }

      // consume one of each ingredient
      const n = this.craftSize();
      for (let i = 0; i < n * n; i++) {
        const c = this.craft[i];
        if (c) { c.count -= 1; if (c.count <= 0) this.craft[i] = null; }
      }
      batches++;
    }

    this._renderCraft();
    this._renderAll();
    this._renderCursor();
    this.onChange();
  }

  _returnCraftItems() {
    for (let i = 0; i < this.craft.length; i++) {
      if (this.craft[i]) { this.add(this.craft[i].id, this.craft[i].count); this.craft[i] = null; }
    }
    if (this.cursor) { this.add(this.cursor.id, this.cursor.count); this.cursor = null; }
    this._renderCursor();
  }

  // ---------- open / close ----------
  toggle() {
    if (this.open) this.close();
    else this.openInv(false);
  }
  openInv(table) {
    this.tableMode = !!table;
    this.open = true;
    this._els.root.classList.remove('hidden');
    this._els.root.classList.toggle('table', this.tableMode);
    this._renderAll();
  }
  openTable() { this.openInv(true); }
  close() {
    this.open = false;
    this._returnCraftItems();
    this._els.root.classList.add('hidden');
    this.onChange();
  }

  // ---------- DOM ----------
  _buildDOM() {
    this._els.root = document.getElementById('inventory');
    this._els.craftGrid = document.getElementById('craft-grid');
    this._els.craftOut = document.getElementById('craft-output');
    this._els.main = document.getElementById('inv-main');
    this._els.invHotbar = document.getElementById('inv-hotbar');
    this._els.hotbar = document.getElementById('hotbar');

    this._els.cursorEl = this._slotEl(); // needs .icon / .count children
    this._els.cursorEl.id = 'cursor-stack';
    this._els.cursorEl.classList.add('floating', 'hidden');
    document.body.appendChild(this._els.cursorEl);

    this._mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    document.addEventListener('mousemove', (e) => {
      this._mouse.x = e.clientX;
      this._mouse.y = e.clientY;
      this._els.cursorEl.style.left = e.clientX + 'px';
      this._els.cursorEl.style.top = e.clientY + 'px';
    });

    // hotbar slots (HUD)
    for (let i = 0; i < HOTBAR; i++) {
      const el = this._slotEl();
      el.dataset.kind = 'hotbar';
      el.dataset.i = i;
      this._els.hotbar.appendChild(el);
    }

    // inventory main + hotbar row inside overlay
    for (let i = 0; i < MAIN; i++) {
      const el = this._slotEl();
      el.dataset.kind = 'slot';
      el.dataset.i = HOTBAR + i;
      this._wireSlot(el);
      this._els.main.appendChild(el);
    }
    for (let i = 0; i < HOTBAR; i++) {
      const el = this._slotEl();
      el.dataset.kind = 'slot';
      el.dataset.i = i;
      this._wireSlot(el);
      this._els.invHotbar.appendChild(el);
    }

    // craft grid (max 3x3, we show 2x2 or 3x3 via CSS class)
    for (let i = 0; i < 9; i++) {
      const el = this._slotEl();
      el.dataset.kind = 'craft';
      el.dataset.i = i;
      this._wireSlot(el);
      this._els.craftGrid.appendChild(el);
    }
    // output
    const out = this._slotEl();
    out.dataset.kind = 'output';
    out.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this._takeOutput(e.shiftKey);
    });
    this._els.craftOut.appendChild(out);
    this._els.outEl = out;
  }

  _slotEl() {
    const el = document.createElement('div');
    el.className = 'slot';
    const icon = document.createElement('div');
    icon.className = 'icon';
    const count = document.createElement('span');
    count.className = 'count';
    el.append(icon, count);
    return el;
  }

  _wireSlot(el) {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const kind = el.dataset.kind;
      const i = parseInt(el.dataset.i, 10);
      const left = e.button === 0;
      const right = e.button === 2;
      if (!left && !right) return;

      const getArr = () => (kind === 'craft' ? this.craft : this.slots);
      const arr = getArr();
      const cur = this.cursor;
      const slot = arr[i];

      if (left) {
        if (!cur && slot) { this.cursor = slot; arr[i] = null; }
        else if (cur && !slot) { arr[i] = cur; this.cursor = null; }
        else if (cur && slot) {
          if (slot.id === cur.id) {
            const ms = maxStack(slot.id);
            const mv = Math.min(ms - slot.count, cur.count);
            slot.count += mv; cur.count -= mv;
            if (cur.count <= 0) this.cursor = null;
          } else {
            arr[i] = cur; this.cursor = slot;
          }
        }
      } else if (right) {
        if (cur && !slot) { arr[i] = { id: cur.id, count: 1 }; cur.count--; if (cur.count <= 0) this.cursor = null; }
        else if (cur && slot && slot.id === cur.id) {
          if (slot.count < maxStack(slot.id)) { slot.count++; cur.count--; if (cur.count <= 0) this.cursor = null; }
        } else if (!cur && slot) {
          const half = Math.ceil(slot.count / 2);
          this.cursor = { id: slot.id, count: half };
          slot.count -= half;
          if (slot.count <= 0) arr[i] = null;
        }
      }

      this._renderAll();
      this._renderCraft();
      this._renderCursor();
      this.onChange();
    });
  }

  // ---------- rendering ----------
  _paint(el, stack) {
    const icon = el.querySelector('.icon');
    const count = el.querySelector('.count');
    if (!stack) {
      icon.style.backgroundImage = 'none';
      count.textContent = '';
      el.title = '';
      return;
    }
    const bg = iconBackground(this.atlas, stack.id);
    if (bg) {
      const scale = 2; // slot icon size / 16
      icon.style.backgroundImage = `url(textures/atlas.png)`;
      icon.style.backgroundSize = `${bg.atlasW * scale}px ${bg.atlasH * scale}px`;
      icon.style.backgroundPosition = `-${bg.col * bg.tile * scale}px -${bg.row * bg.tile * scale}px`;
      icon.style.imageRendering = 'pixelated';
    }
    count.textContent = stack.count > 1 ? stack.count : '';
    el.title = itemName(stack.id);
  }

  _renderHotbar() {
    const els = this._els.hotbar.children;
    for (let i = 0; i < HOTBAR; i++) {
      els[i].classList.toggle('active', i === this.active);
      this._paint(els[i], this.slots[i]);
    }
  }

  _renderAll() {
    this._renderHotbar();
    const m = this._els.main.children;
    for (let i = 0; i < MAIN; i++) this._paint(m[i], this.slots[HOTBAR + i]);
    const h = this._els.invHotbar.children;
    for (let i = 0; i < HOTBAR; i++) this._paint(h[i], this.slots[i]);
    this._renderCraft();
  }

  _renderCraft() {
    const n = this.craftSize();
    this._els.craftGrid.style.setProperty('--n', n);
    const cells = this._els.craftGrid.children;
    for (let i = 0; i < 9; i++) {
      cells[i].style.display = i < n * n ? '' : 'none';
      this._paint(cells[i], this.craft[i]);
    }
    this._paint(this._els.outEl, this._currentOutput());
  }

  _renderCursor() {
    const el = this._els.cursorEl;
    if (!this.cursor) { el.classList.add('hidden'); return; }
    el.style.left = this._mouse.x + 'px';
    el.style.top = this._mouse.y + 'px';
    el.classList.remove('hidden');
    this._paint(el, this.cursor);
  }
}
