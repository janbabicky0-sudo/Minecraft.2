/**
 * One-off helper: pull baked PNGs out of supplied .glb block models, decode,
 * area-downsample to TILE px, fix orientation, and write them as plain PNG
 * source files under public/textures/blocks/. gen-textures.mjs bakes those
 * into the atlas.
 *
 *   node scripts/extract-textures.mjs
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'public', 'textures', 'blocks');
const DL = 'C:/Users/Honza/Downloads';
const TILE = 64; // output resolution per block texture

// glb file -> { material name : output tile name }
const JOBS = [
  { file: 'realgrass.glb', map: { grass_side_real: 'grass_side', grass_top_real: 'grass_top', dirt_real: 'dirt' } },
  { file: 'realdirt.glb', map: { dirt_real: 'dirt' } },
  { file: 'realstone.glb', map: { stone_real: 'stone' } },
  { file: 'realleaves.glb', map: { leaves_real: 'leaves' } },
  { file: 'realplank.glb', map: { planks_real: 'planks' } },
  { file: 'realsand.glb', map: { sand_real: 'sand' } },
  { file: 'realwater.glb', map: { water_real: 'water' } },
  // earlier models (kept as fallback if the "real" ones are absent)
  { file: 'log.glb', map: { log_side: 'log_side', log_top: 'log_top' } },
];

// how to orient each output (green band of grass must sit at the top, etc.)
const NEEDS_VFLIP = new Set(); // filled after probing

function parseGLB(file) {
  const buf = fs.readFileSync(file);
  const total = buf.readUInt32LE(8);
  let off = 12, json = null, bin = null;
  while (off < total) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    off += 8 + len;
  }
  return { json, bin };
}
const bvBytes = (glb, i) => {
  const bv = glb.json.bufferViews[i];
  const s = bv.byteOffset || 0;
  return glb.bin.subarray(s, s + bv.byteLength);
};

function decodePNG(png) {
  let off = 8, width = 0, height = 0, colorType = 6;
  const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * ch;
  const out = new Uint8Array(width * height * 4);
  let prev = Buffer.alloc(stride), p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      line[i] = v;
    }
    prev = line;
    for (let x = 0; x < width; x++) {
      const si = x * ch, di = (y * width + x) * 4;
      if (ch === 4) { out[di] = line[si]; out[di + 1] = line[si + 1]; out[di + 2] = line[si + 2]; out[di + 3] = line[si + 3]; }
      else if (ch === 3) { out[di] = line[si]; out[di + 1] = line[si + 1]; out[di + 2] = line[si + 2]; out[di + 3] = 255; }
      else { out[di] = out[di + 1] = out[di + 2] = line[si]; out[di + 3] = 255; }
    }
  }
  return { width, height, rgba: out };
}

// area-average downsample to TILE x TILE
function resample(img) {
  const { width: w, height: h, rgba } = img;
  const out = new Uint8Array(TILE * TILE * 4);
  const bx = w / TILE, by = h / TILE;
  for (let ty = 0; ty < TILE; ty++) {
    for (let tx = 0; tx < TILE; tx++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const x0 = Math.floor(tx * bx), x1 = Math.max(x0 + 1, Math.floor((tx + 1) * bx));
      const y0 = Math.floor(ty * by), y1 = Math.max(y0 + 1, Math.floor((ty + 1) * by));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; a += rgba[i + 3]; n++;
      }
      const di = (ty * TILE + tx) * 4;
      out[di] = r / n; out[di + 1] = g / n; out[di + 2] = b / n; out[di + 3] = a / n;
    }
  }
  return out;
}
function flipV(rgba) {
  const out = new Uint8Array(TILE * TILE * 4);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const si = (y * TILE + x) * 4, di = ((TILE - 1 - y) * TILE + x) * 4;
    for (let k = 0; k < 4; k++) out[di + k] = rgba[si + k];
  }
  return out;
}
const bandAvg = (rgba, row) => {
  let r = 0, g = 0, b = 0;
  for (let x = 0; x < TILE; x++) { const i = (row * TILE + x) * 4; r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; }
  return [r / TILE | 0, g / TILE | 0, b / TILE | 0];
};

// ---- PNG encode (RGBA, filter 0) ----
function crc32(buf) {
  let c = ~0 >>> 0;
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([t, Buffer.from(data)]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const stride = w * 4;
  const rows = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) for (let i = 0; i < stride; i++) rows[y * (stride + 1) + 1 + i] = rgba[y * stride + i];
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync(OUT, { recursive: true });
const written = {};
for (const job of JOBS) {
  const full = `${DL}/${job.file}`;
  if (!fs.existsSync(full)) { console.error(`  (skip ${job.file} — not found)`); continue; }
  const glb = parseGLB(full);
  const matToImg = {};
  glb.json.materials.forEach((m) => {
    const t = m.pbrMetallicRoughness?.baseColorTexture?.index;
    if (t != null) matToImg[m.name] = glb.json.textures[t].source;
  });
  for (const [matName, tileName] of Object.entries(job.map)) {
    if (written[tileName] && job.file !== 'realgrass.glb') continue; // first match wins
    const imgIdx = matToImg[matName];
    if (imgIdx == null) { console.error(`  (no material ${matName} in ${job.file})`); continue; }
    const png = bvBytes(glb, glb.json.images[imgIdx].bufferView);
    let rgba = resample(decodePNG(png));
    // grass side: green band must be at the top
    if (tileName === 'grass_side') {
      const top = bandAvg(rgba, 1), bot = bandAvg(rgba, TILE - 2);
      const greenness = (c) => c[1] - (c[0] + c[2]) / 2;
      if (greenness(bot) > greenness(top)) rgba = flipV(rgba);
    }
    fs.writeFileSync(path.join(OUT, tileName + '.png'), encodePNG(TILE, TILE, rgba));
    written[tileName] = true;
    console.error(`  ${tileName}.png  <- ${job.file}/${matName}`);
  }
}
console.error(`\n${Object.keys(written).length} textures -> ${path.relative(process.cwd(), OUT)}  (${TILE}px)`);
