/**
 * Procedurally generates a 16x16 pixel-art texture atlas for the game.
 * Pure Node (no deps) — writes a hand-rolled PNG plus a JSON index.
 * Style goal: flat colours, coarse pixel grain, Minecraft-ish look. All original.
 *
 *   Output: public/textures/atlas.png  +  public/textures/atlas.json
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'public', 'textures');

const TILE = 16;
const COLS = 8;

// ---- deterministic value noise -------------------------------------------------
function ihash(n) {
  n = (n << 13) ^ n;
  return 1.0 - ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824.0;
}
function makeRnd(seed) {
  return (x, y) => (ihash(seed * 374761 + x * 668265263 + y * 2147483647) + 1) * 0.5;
}
function fbm(rnd, x, y, oct = 3) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    const xi = Math.floor(x * f), yi = Math.floor(y * f);
    v += rnd(xi, yi) * amp;
    amp *= 0.5; f *= 2;
  }
  return v;
}

// ---- tiny image helper -------------------------------------------------------
class Tile {
  constructor(seed) {
    this.buf = new Uint8Array(TILE * TILE * 4);
    this.rnd = makeRnd(seed);
  }
  set(x, y, r, g, b, a = 255) {
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
    const i = (y * TILE + x) * 4;
    this.buf[i] = r; this.buf[i + 1] = g; this.buf[i + 2] = b; this.buf[i + 3] = a;
  }
  fillNoise(base, amp, opts = {}) {
    const { specks = 0, speck = [0, 0, 0], octaves = 2 } = opts;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const n = (fbm(this.rnd, x / 4, y / 4, octaves) - 0.5) * 2 * amp;
        let r = base[0] + n, g = base[1] + n, b = base[2] + n;
        if (specks && this.rnd(x * 7 + 1, y * 3 + 5) < specks) {
          r = speck[0]; g = speck[1]; b = speck[2];
        }
        this.set(x, y, clamp255(r), clamp255(g), clamp255(b), base[3] ?? 255);
      }
    }
  }
  blobs(count, color, radius, seed = 9) {
    const r2 = makeRnd(seed);
    for (let k = 0; k < count; k++) {
      const cx = 2 + Math.floor(r2(k, 1) * (TILE - 4));
      const cy = 2 + Math.floor(r2(k, 2) * (TILE - 4));
      const rad = radius[0] + r2(k, 3) * (radius[1] - radius[0]);
      for (let y = -3; y <= 3; y++) {
        for (let x = -3; x <= 3; x++) {
          const d = Math.hypot(x, y);
          if (d <= rad + (r2(cx + x, cy + y) - 0.5)) {
            const j = (fbm(this.rnd, (cx + x) / 3, (cy + y) / 3, 2) - 0.5) * 26;
            this.set(cx + x, cy + y, clamp255(color[0] + j), clamp255(color[1] + j), clamp255(color[2] + j));
          }
        }
      }
    }
  }
}
const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
const lerp = (a, b, t) => a + (b - a) * t;

// ---- fixed bitmaps (extracted from a supplied 16x16 texture) ----------------
// RGBA, 16x16, base64-encoded raw bytes (row-major, top->down).
function tileFromB64(b64) {
  const t = new Tile(0);
  t.buf = new Uint8Array(Buffer.from(b64, 'base64'));
  return t;
}
const GRASS_TOP_B64 =
  'b6o8/2+qPP9vqjz/b6o8/2+qPP9vqjz/X5Yz/2+qPP9fljP/b6o8/2+qPP9vqjz/b6o8/2+qPP9vqjz/b6o8/2+qPP9Pgir/b6o8/2+qPP9vqjz/b6o8/2+qPP9vqjz/X5Yz/2+qPP9vqjz/b6o8/2+qPP9vqjz/T4Iq/1+WM/9vqjz/b6o8/2+qPP9vqjz/b6o8/2+qPP9vqjz/b6o8/2+qPP95uEr/b6o8/2+qPP9vqjz/b6o8/2+qPP9vqjz/ebhK/1+WM/9vqjz/b6o8/2+qPP9vqjz/ebhK/2+qPP9vqjz/b6o8/2+qPP95uEr/b6o8/2+qPP95uEr/b6o8/2+qPP9Pgir/b6o8/0+CKv9vqjz/b6o8/2+qPP9vqjz/b6o8/0+CKv9vqjz/X5Yz/2+qPP9vqjz/b6o8/0+CKv9vqjz/ebhK/2+qPP9vqjz/ebhK/1+WM/9vqjz/b6o8/2+qPP9vqjz/b6o8/2+qPP9Pgir/b6o8/2+qPP9fljP/b6o8/2+qPP9Pgir/b6o8/2+qPP9Pgir/b6o8/0+CKv9vqjz/ebhK/2+qPP9fljP/X5Yz/3m4Sv9vqjz/b6o8/1+WM/9vqjz/b6o8/2+qPP9vqjz/b6o8/2+qPP9vqjz/b6o8/2+qPP9vqjz/T4Iq/2+qPP9fljP/ebhK/2+qPP9vqjz/T4Iq/1+WM/9vqjz/b6o8/2+qPP9vqjz/X5Yz/2+qPP9vqjz/b6o8/3m4Sv9vqjz/b6o8/2+qPP9fljP/X5Yz/2+qPP9vqjz/b6o8/0+CKv9Pgir/b6o8/2+qPP9vqjz/b6o8/2+qPP9vqjz/b6o8/2+qPP9vqjz/X5Yz/2+qPP9vqjz/b6o8/2+qPP9vqjz/b6o8/2+qPP9vqjz/b6o8/0+CKv9vqjz/b6o8/2+qPP9vqjz/b6o8/1+WM/9vqjz/b6o8/0+CKv9fljP/ebhK/2+qPP95uEr/ebhK/2+qPP9vqjz/b6o8/2+qPP9vqjz/X5Yz/2+qPP9vqjz/b6o8/2+qPP9vqjz/T4Iq/1+WM/95uEr/X5Yz/1+WM/95uEr/b6o8/3m4Sv9fljP/X5Yz/2+qPP9vqjz/b6o8/1+WM/9vqjz/T4Iq/2+qPP9vqjz/b6o8/3m4Sv9Pgir/X5Yz/3m4Sv9vqjz/b6o8/3m4Sv9vqjz/b6o8/2+qPP9vqjz/b6o8/2+qPP9Pgir/X5Yz/1+WM/9vqjz/ebhK/2+qPP9vqjz/b6o8/1+WM/9fljP/b6o8/1+WM/9vqjz/X5Yz/1+WM/9vqjz/b6o8/2+qPP9vqjz/b6o8/2+qPP9vqjz/b6o8/2+qPP9fljP/b6o8/2+qPP9fljP/b6o8/w==';
const GRASS_SIDE_B64 =
  'a0Ql/4paNP+KWjT/ilo0/3pNK/96TSv/ilo0/4paNP+KWjT/ek0r/4paNP+KWjT/ilo0/4paNP+aa0D/ilo0/4paNP+KWjT/ilo0/4paNP+KWjT/ilo0/4paNP+KWjT/ilo0/4paNP+KWjT/ilo0/5prQP+KWjT/ilo0/4paNP+KWjT/ilo0/3pNK/+KWjT/ek0r/4paNP+KWjT/ilo0/3pNK/+KWjT/ilo0/4paNP+KWjT/ilo0/4paNP+KWjT/ek0r/4paNP+aa0D/ilo0/4paNP+KWjT/a0Ql/4paNP9rRCX/mmtA/5prQP+KWjT/ilo0/4paNP96TSv/ilo0/4paNP+KWjT/ilo0/4paNP9rRCX/ilo0/4paNP+KWjT/ilo0/4paNP+KWjT/ilo0/4paNP9rRCX/ilo0/4paNP+KWjT/ek0r/3pNK/+KWjT/mmtA/5prQP+KWjT/a0Ql/4paNP96TSv/ilo0/4paNP+KWjT/mmtA/3pNK/+KWjT/a0Ql/4paNP96TSv/ilo0/3pNK/9rRCX/mmtA/4paNP+KWjT/ilo0/4paNP+KWjT/a0Ql/4paNP96TSv/ek0r/4paNP9rRCX/ilo0/4paNP+KWjT/mmtA/2tEJf+KWjT/ek0r/5prQP+KWjT/ilo0/5prQP+KWjT/ilo0/4paNP+KWjT/a0Ql/4paNP+KWjT/ilo0/4paNP+KWjT/ek0r/5prQP+KWjT/ilo0/4paNP+KWjT/ilo0/4paNP9rRCX/ilo0/5prQP+KWjT/ilo0/4paNP+KWjT/ilo0/4paNP96TSv/a0Ql/4paNP+KWjT/a0Ql/4paNP+KWjT/mmtA/3pNK/+KWjT/ilo0/4paNP+KWjT/ilo0/5prQP9rRCX/ilo0/4paNP+KWjT/ilo0/2tEJf+KWjT/ilo0/2tEJf+KWjT/ilo0/4paNP+KWjT/ilo0/2tEJf+KWjT/a0Ql/4paNP+KWjT/ilo0/4paNP+KWjT/ilo0/3pNK/+KWjT/ilo0/3pNK/96TSv/ek0r/4paNP+KWjT/ilo0/4paNP+KWjT/mmtA/3pNK/96TSv/ilo0/4paNP+KWjT/ilo0/3pNK/9vqjz/b6o8/3pNK/96TSv/ebhK/3pNK/9vqjz/ebhK/3pNK/9vqjz/ilo0/3pNK/95uEr/ilo0/2+qPP9vqjz/b6o8/2+qPP95uEr/b6o8/2+qPP9vqjz/b6o8/2+qPP9vqjz/ebhK/2+qPP9fljP/b6o8/2+qPP9vqjz/ebhK/2+qPP9vqjz/b6o8/0+CKv9vqjz/T4Iq/1+WM/9vqjz/b6o8/2+qPP9Pgir/b6o8/2+qPP95uEr/X5Yz/w==';
const DIRT_B64 =
  'ek0r/4paNP+KWjT/ilo0/5prQP+KWjT/ilo0/5prQP+KWjT/ilo0/4paNP96TSv/ilo0/4paNP+KWjT/ilo0/2tEJf+aa0D/ilo0/4paNP+KWjT/ek0r/3pNK/+KWjT/ilo0/4paNP+KWjT/ilo0/2tEJf+KWjT/ilo0/5prQP+KWjT/ek0r/3pNK/+KWjT/ilo0/4paNP+KWjT/ilo0/4paNP96TSv/ilo0/4paNP+aa0D/ek0r/4paNP9rRCX/ilo0/5prQP+KWjT/mmtA/4paNP+KWjT/ilo0/4paNP+KWjT/mmtA/4paNP+KWjT/ilo0/2tEJf+KWjT/ilo0/4paNP9rRCX/ilo0/3pNK/9rRCX/ilo0/4paNP+KWjT/a0Ql/4paNP9rRCX/ek0r/4paNP+KWjT/ilo0/4paNP+KWjT/mmtA/4paNP9rRCX/ilo0/4paNP9rRCX/ilo0/4paNP96TSv/ilo0/5prQP96TSv/ilo0/3pNK/+KWjT/ilo0/3pNK/96TSv/ek0r/4paNP+KWjT/ek0r/3pNK/9rRCX/ilo0/4paNP+KWjT/ilo0/4paNP+KWjT/a0Ql/4paNP9rRCX/ek0r/3pNK/+KWjT/ek0r/3pNK/9rRCX/ilo0/2tEJf9rRCX/ilo0/2tEJf+KWjT/ilo0/3pNK/+KWjT/ek0r/2tEJf+KWjT/ilo0/4paNP+KWjT/ilo0/4paNP96TSv/ilo0/4paNP9rRCX/ilo0/4paNP+KWjT/a0Ql/4paNP+aa0D/ilo0/2tEJf+KWjT/ilo0/4paNP+KWjT/ilo0/2tEJf+KWjT/ilo0/4paNP+KWjT/ilo0/4paNP+KWjT/ek0r/4paNP+KWjT/ilo0/3pNK/+KWjT/ilo0/2tEJf+KWjT/ilo0/5prQP+KWjT/ilo0/4paNP9rRCX/ilo0/4paNP+KWjT/ilo0/4paNP96TSv/ilo0/4paNP+KWjT/ilo0/4paNP+KWjT/ilo0/2tEJf+aa0D/ilo0/3pNK/+KWjT/ilo0/2tEJf+KWjT/ilo0/3pNK/+KWjT/ilo0/4paNP96TSv/ilo0/4paNP+KWjT/ilo0/3pNK/+KWjT/a0Ql/4paNP+KWjT/mmtA/4paNP9rRCX/ilo0/2tEJf+KWjT/ilo0/4paNP+KWjT/ilo0/4paNP+KWjT/ek0r/4paNP9rRCX/ek0r/3pNK/96TSv/ek0r/3pNK/96TSv/ilo0/4paNP+KWjT/ilo0/4paNP+KWjT/ilo0/5prQP+KWjT/ilo0/4paNP+aa0D/ek0r/4paNP+KWjT/ilo0/4paNP+KWjT/ilo0/4paNP+aa0D/ilo0/w==';

// ---- painters ---------------------------------------------------------------
// Each returns a Tile. Order here === atlas index order.
const PAINTERS = {
  // grass_top / grass_side / dirt use a supplied 16x16 texture (grass_block.glb) verbatim.
  grass_top: () => tileFromB64(GRASS_TOP_B64),
  grass_side: () => tileFromB64(GRASS_SIDE_B64),
  dirt: () => tileFromB64(DIRT_B64),
  stone: (s) => {
    const t = new Tile(s);
    t.fillNoise([128, 128, 130, 255], 16, { specks: 0.04, speck: [96, 96, 100], octaves: 3 });
    // a couple of cracks
    for (let k = 0; k < 3; k++) {
      let x = Math.floor(t.rnd(k, 20) * 16), y = Math.floor(t.rnd(k, 21) * 16);
      for (let i = 0; i < 6; i++) {
        t.set(x, y, 92, 92, 96);
        x += t.rnd(x, y) < 0.5 ? 1 : 0;
        y += t.rnd(y, x) < 0.5 ? 1 : -1;
      }
    }
    return t;
  },
  cobblestone: (s) => {
    const t = new Tile(s);
    t.fillNoise([88, 88, 92, 255], 8);
    const r = makeRnd(s + 7);
    for (let cy = 0; cy < 16; cy += 5) {
      for (let cx = 0; cx < 16; cx += 5) {
        const ox = Math.round(r(cx, cy) * 2), oy = Math.round(r(cy, cx) * 2);
        for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) {
          const j = (fbm(t.rnd, (cx + x) / 3, (cy + y) / 3, 2) - 0.5) * 30;
          t.set(cx + x + ox, cy + y + oy, clamp255(132 + j), clamp255(132 + j), clamp255(136 + j));
        }
      }
    }
    return t;
  },
  sand: (s) => {
    const t = new Tile(s);
    t.fillNoise([221, 205, 158, 255], 11, { specks: 0.05, speck: [206, 188, 140] });
    return t;
  },
  sandstone: (s) => {
    const t = new Tile(s);
    t.fillNoise([223, 205, 156, 255], 8);
    for (let y = 3; y < 16; y += 5) for (let x = 0; x < 16; x++) t.set(x, y, 198, 178, 132);
    return t;
  },
  log_side: (s) => {
    const t = new Tile(s);
    t.fillNoise([104, 82, 50, 255], 12, { octaves: 3 });
    for (let x = 0; x < 16; x++) {
      if (t.rnd(x, 30) < 0.35) for (let y = 0; y < 16; y++) t.set(x, y, 86, 66, 40);
    }
    // knots
    t.blobs(2, [72, 54, 34], [1.2, 2.0], s + 3);
    for (let y = 0; y < 16; y++) { t.set(0, y, 74, 56, 34); t.set(15, y, 74, 56, 34); }
    return t;
  },
  log_top: (s) => {
    const t = new Tile(s);
    t.fillNoise([150, 118, 78, 255], 8);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      const ring = Math.floor(d) % 2 === 0;
      const j = (fbm(t.rnd, x / 3, y / 3, 2) - 0.5) * 16;
      const c = ring ? 150 : 120;
      t.set(x, y, clamp255(c + j), clamp255(c * 0.8 + j), clamp255(c * 0.55 + j));
    }
    t.set(7, 7, 90, 66, 40); t.set(8, 7, 90, 66, 40); t.set(7, 8, 90, 66, 40); t.set(8, 8, 90, 66, 40);
    return t;
  },
  planks: (s) => {
    const t = new Tile(s);
    t.fillNoise([164, 130, 80, 255], 12, { octaves: 3 });
    for (let y = 0; y < 16; y++) {
      if (y % 4 === 0) for (let x = 0; x < 16; x++) t.set(x, y, 120, 92, 54);
    }
    // staggered vertical seams
    for (let band = 0; band < 4; band++) {
      const sx = (band % 2 === 0) ? 8 : 0;
      for (let y = band * 4 + 1; y < band * 4 + 4; y++) t.set(sx, y, 120, 92, 54);
    }
    return t;
  },
  leaves: (s) => {
    const t = new Tile(s);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (t.rnd(x + 3, y + 1) < 0.14) { t.set(x, y, 0, 0, 0, 0); continue; }
      const n = (fbm(t.rnd, x / 3, y / 3, 3) - 0.5) * 60;
      t.set(x, y, clamp255(58 + n), clamp255(112 + n), clamp255(44 + n), 255);
    }
    return t;
  },
  glass: (s) => {
    const t = new Tile(s);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      if (edge) t.set(x, y, 210, 232, 238, 255);
      else t.set(x, y, 200, 226, 235, 40);
    }
    for (let i = 0; i < 10; i++) t.set(3 + i, 12 - i, 245, 252, 255, 150); // shine
    return t;
  },
  water: (s) => {
    const t = new Tile(s);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const n = (fbm(t.rnd, x / 6, y / 6, 2) - 0.5) * 16;
      // deep, saturated blue
      let r = 31 + n, g = 84 + n, b = 178 + n * 1.4;
      // faint horizontal ripple bands
      if ((y + Math.floor(fbm(t.rnd, x / 5, 0, 2) * 3)) % 5 === 0) { r += 10; g += 16; b += 14; }
      t.set(x, y, clamp255(r), clamp255(g), clamp255(b), 255);
    }
    return t;
  },
  snow: (s) => {
    const t = new Tile(s);
    t.fillNoise([243, 247, 252, 255], 6, { specks: 0.03, speck: [225, 232, 242] });
    return t;
  },
  snow_side: (s) => {
    const t = new Tile(s);
    t.fillNoise([132, 132, 136, 255], 14, { specks: 0.05, speck: [104, 104, 110] });
    for (let x = 0; x < 16; x++) {
      const h = 4 + Math.round(t.rnd(x, 2) * 2);
      for (let y = 0; y < h; y++) t.set(x, y, clamp255(240 + (t.rnd(x, y) - 0.5) * 12), 245, 252);
    }
    return t;
  },
  coal_ore: (s) => { const t = PAINTERS.stone(s); t.blobs(4, [34, 34, 38], [1.3, 2.2], s + 11); return t; },
  iron_ore: (s) => { const t = PAINTERS.stone(s); t.blobs(4, [201, 160, 120], [1.2, 2.0], s + 12); return t; },
  gold_ore: (s) => { const t = PAINTERS.stone(s); t.blobs(4, [231, 197, 78], [1.1, 1.9], s + 13); return t; },
  diamond_ore: (s) => { const t = PAINTERS.stone(s); t.blobs(4, [102, 224, 224], [1.1, 1.8], s + 14); return t; },
  bedrock: (s) => {
    const t = new Tile(s);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const v = fbm(t.rnd, x / 2, y / 2, 3);
      const c = v < 0.35 ? 38 : v < 0.6 ? 66 : 96;
      t.set(x, y, c, c, c + 4);
    }
    return t;
  },
  gravel: (s) => {
    const t = new Tile(s);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const v = fbm(t.rnd, x / 2.5, y / 2.5, 3);
      const warm = t.rnd(x + 2, y + 6) < 0.4;
      const c = 90 + v * 90;
      t.set(x, y, clamp255(c + (warm ? 18 : 0)), clamp255(c + (warm ? 6 : 0)), clamp255(c));
    }
    return t;
  },
  cactus_side: (s) => {
    const t = new Tile(s);
    t.fillNoise([86, 138, 60, 255], 10);
    for (let y = 0; y < 16; y++) { t.set(0, y, 60, 104, 44); t.set(15, y, 60, 104, 44); t.set(2, y, 70, 120, 50); t.set(13, y, 70, 120, 50); }
    for (let y = 1; y < 16; y += 4) { t.set(4, y, 220, 220, 180); t.set(11, y, 220, 220, 180); }
    return t;
  },
  cactus_top: (s) => {
    const t = new Tile(s);
    t.fillNoise([92, 146, 64, 255], 8);
    for (let i = 4; i < 12; i++) { t.set(i, 7, 70, 118, 48); t.set(i, 8, 70, 118, 48); t.set(7, i, 70, 118, 48); t.set(8, i, 70, 118, 48); }
    return t;
  },
  crafting_table_top: (s) => {
    const t = PAINTERS.planks(s);
    for (let i = 0; i < 16; i++) { t.set(i, 5, 96, 72, 42); t.set(i, 10, 96, 72, 42); t.set(5, i, 96, 72, 42); t.set(10, i, 96, 72, 42); }
    for (let i = 0; i < 16; i++) { t.set(i, 0, 90, 66, 38); t.set(0, i, 90, 66, 38); t.set(i, 15, 90, 66, 38); t.set(15, i, 90, 66, 38); }
    return t;
  },
  crafting_table_side: (s) => {
    const t = PAINTERS.planks(s);
    for (let i = 3; i < 13; i++) { t.set(i, 3, 92, 68, 40); t.set(i, 12, 92, 68, 40); }
    for (let i = 3; i < 13; i++) { t.set(3, i, 92, 68, 40); t.set(12, i, 92, 68, 40); }
    t.set(7, 7, 70, 52, 30); t.set(8, 8, 70, 52, 30);
    return t;
  },
  crafting_table_front: (s) => {
    const t = PAINTERS.planks(s);
    for (let i = 2; i < 14; i++) { t.set(i, i, 92, 68, 40); t.set(15 - i, i, 92, 68, 40); }
    return t;
  },

  // ---- item icons (transparent background) ----
  stick: (s) => {
    const t = new Tile(s);
    for (let i = 3; i < 13; i++) { t.set(i, 12 - i, 140, 100, 56); t.set(i + 1, 12 - i, 116, 82, 46); }
    return t;
  },
  apple: (s) => {
    const t = new Tile(s);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 8, y - 9);
      if (d < 5.5) { const hl = (x - 6) * (x - 6) + (y - 7) * (y - 7) < 4; t.set(x, y, hl ? 236 : 200, hl ? 96 : 46, hl ? 80 : 46); }
    }
    t.set(8, 3, 110, 76, 44); t.set(8, 4, 110, 76, 44);
    t.set(10, 3, 90, 160, 70); t.set(11, 3, 90, 160, 70); t.set(11, 2, 90, 160, 70);
    return t;
  },
  wood_pickaxe: (s) => iconTool(s, 'pickaxe', [150, 116, 70], [120, 88, 52]),
  wood_axe: (s) => iconTool(s, 'axe', [150, 116, 70], [120, 88, 52]),
  wood_shovel: (s) => iconTool(s, 'shovel', [150, 116, 70], [120, 88, 52]),
  stone_pickaxe: (s) => iconTool(s, 'pickaxe', [140, 140, 144], [96, 96, 100]),
  stone_axe: (s) => iconTool(s, 'axe', [140, 140, 144], [96, 96, 100]),
  stone_shovel: (s) => iconTool(s, 'shovel', [140, 140, 144], [96, 96, 100]),
};

function iconTool(seed, kind, head, headDark) {
  const t = new Tile(seed);
  const handle = [140, 100, 56], handleDark = [110, 78, 44];
  // diagonal handle bottom-left -> top-right
  for (let i = 0; i < 11; i++) {
    const x = 3 + i, y = 13 - i;
    t.set(x, y, ...handle); t.set(x, y + 1, ...handleDark);
  }
  const hx = 11, hy = 3;
  if (kind === 'pickaxe') {
    for (let i = -4; i <= 4; i++) {
      const yy = hy + 1 + Math.round(Math.abs(i) * 0.5);
      t.set(hx + i, yy, ...(Math.abs(i) > 2 ? headDark : head));
      t.set(hx + i, yy + 1, ...headDark);
    }
  } else if (kind === 'axe') {
    for (let y = 0; y < 6; y++) for (let x = 0; x < 5; x++) {
      if (x + Math.abs(y - 2.5) < 4.5) t.set(hx - 1 + x, hy + y, ...(x === 0 ? headDark : head));
    }
  } else { // shovel
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      const d = Math.hypot(x - 2, y - 1);
      if (d < 3) t.set(hx - 2 + x, hy + y, ...(y > 2 ? headDark : head));
    }
  }
  return t;
}

// ---- assemble atlas ---------------------------------------------------------
const names = Object.keys(PAINTERS);
const rows = Math.ceil(names.length / COLS);
const W = COLS * TILE, H = rows * TILE;
const rgba = new Uint8Array(W * H * 4);
const map = {};

names.forEach((name, idx) => {
  const col = idx % COLS, row = Math.floor(idx / COLS);
  map[name] = idx;
  const tile = PAINTERS[name](idx * 1000 + 17);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const si = (y * TILE + x) * 4;
      const dx = col * TILE + x, dy = row * TILE + y;
      const di = (dy * W + dx) * 4;
      rgba[di] = tile.buf[si];
      rgba[di + 1] = tile.buf[si + 1];
      rgba[di + 2] = tile.buf[si + 2];
      rgba[di + 3] = tile.buf[si + 3];
    }
  }
});

// ---- PNG encoder (RGBA, 8-bit, no filter) ----------------------------------
function crc32(buf) {
  let c = ~0 >>> 0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([t, Buffer.from(data)]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, data) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'atlas.png'), encodePNG(W, H, rgba));
fs.writeFileSync(
  path.join(OUT_DIR, 'atlas.json'),
  JSON.stringify({ tile: TILE, cols: COLS, rows, width: W, height: H, map }, null, 2)
);
console.log(`atlas: ${names.length} tiles -> ${W}x${H}  (${OUT_DIR})`);
