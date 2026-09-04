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

const TILE = 16;        // procedural painter resolution
const ATLAS_TILE = 64;  // atlas cell resolution (real textures baked at this size)
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

// ---- fixed bitmaps loaded from public/textures/blocks/*.png -----------------
// (extracted from supplied .glb block models by scripts/extract-textures.mjs)
const BLOCK_PNG_DIR = path.join(__dirname, '..', 'public', 'textures', 'blocks');

function decodePNG16(file) {
  const png = fs.readFileSync(file);
  let off = 8, w = 0, h = 0, colorType = 6;
  const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = w * ch;
  const rgba = new Uint8Array(w * h * 4);
  let prev = Buffer.alloc(stride), p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride)); p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      line[i] = v;
    }
    prev = line;
    for (let x = 0; x < w; x++) {
      const si = x * ch, di = (y * w + x) * 4;
      rgba[di] = line[si]; rgba[di + 1] = ch > 1 ? line[si + 1] : line[si];
      rgba[di + 2] = ch > 2 ? line[si + 2] : line[si]; rgba[di + 3] = ch === 4 ? line[si + 3] : 255;
    }
  }
  // area-average downsample to ATLAS_TILE
  const N = ATLAS_TILE;
  const out = new Uint8Array(N * N * 4);
  const sxScale = w / N, syScale = h / N;
  for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    const x0 = (tx * sxScale) | 0, x1 = Math.max(x0 + 1, ((tx + 1) * sxScale) | 0);
    const y0 = (ty * syScale) | 0, y1 = Math.max(y0 + 1, ((ty + 1) * syScale) | 0);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; a += rgba[i + 3]; n++;
    }
    const di = (ty * N + tx) * 4;
    out[di] = r / n; out[di + 1] = g / n; out[di + 2] = b / n; out[di + 3] = a / n;
  }
  return out;
}

function pngTile(name) {
  const t = new Tile(0);
  t.buf = decodePNG16(path.join(BLOCK_PNG_DIR, name + '.png')); // now ATLAS_TILE px
  t.size = ATLAS_TILE;
  return t;
}

// ---- painters ---------------------------------------------------------------
// Each returns a Tile. Order here === atlas index order.
const PAINTERS = {
  // grass / dirt / stone / log use supplied block textures verbatim
  grass_top: () => pngTile('grass_top'),
  grass_side: () => pngTile('grass_side'),
  dirt: () => pngTile('dirt'),
  stone: () => pngTile('stone'),
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
  sand: () => pngTile('sand'),
  sandstone: (s) => {
    const t = new Tile(s);
    t.fillNoise([223, 205, 156, 255], 8);
    for (let y = 3; y < 16; y += 5) for (let x = 0; x < 16; x++) t.set(x, y, 198, 178, 132);
    return t;
  },
  log_side: () => pngTile('log_side'),
  log_top: () => pngTile('log_top'),
  planks: () => pngTile('planks'),
  leaves: () => pngTile('leaves'),
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
  water: () => pngTile('water'),
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

  // mining-progress overlay: black, alpha is a noise field so the game can
  // grow the crack with a rising alphaTest (hard cutout, no blending).
  crack: (s) => {
    const t = new Tile(s);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const n = fbm(t.rnd, x / 5, y / 5, 4);
      t.set(x, y, 0, 0, 0, clamp255(n * 255));
    }
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
const W = COLS * ATLAS_TILE, H = rows * ATLAS_TILE;
const rgba = new Uint8Array(W * H * 4);
const map = {};

names.forEach((name, idx) => {
  const col = idx % COLS, row = Math.floor(idx / COLS);
  map[name] = idx;
  const tile = PAINTERS[name](idx * 1000 + 17);
  const src = tile.size || TILE;                 // 16 for procedural, ATLAS_TILE for pngTile
  const scale = ATLAS_TILE / src;                // nearest-upscale procedural tiles
  for (let y = 0; y < ATLAS_TILE; y++) {
    for (let x = 0; x < ATLAS_TILE; x++) {
      const sx = (x / scale) | 0, sy = (y / scale) | 0;
      const si = (sy * src + sx) * 4;
      const dx = col * ATLAS_TILE + x, dy = row * ATLAS_TILE + y;
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
  JSON.stringify({ tile: ATLAS_TILE, cols: COLS, rows, width: W, height: H, map }, null, 2)
);
console.log(`atlas: ${names.length} tiles -> ${W}x${H}  (${OUT_DIR})`);
