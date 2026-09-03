import * as THREE from 'three';
import { CHUNK_SX, CHUNK_SZ, WORLD_H, B } from '../constants.js';
import { BLOCKS, faceTile } from '../registry/blocks.js';
import { biomeTint } from '../world/terrain.js';

// ---- id -> property lookup tables (built once) --------------------------
const OPAQUE = new Uint8Array(256);
const RENDERS = new Uint8Array(256);
const TRANSPARENT = new Uint8Array(256);
const CUTOUT = new Uint8Array(256);
const LIQUID = new Uint8Array(256);
const TINT = new Uint8Array(256);          // 0 none, 1 grass, 2 foliage
const TINT_FACEMASK = new Uint8Array(256); // bit per face index
for (const key in BLOCKS) {
  const id = +key;
  const b = BLOCKS[id];
  OPAQUE[id] = b.opaque ? 1 : 0;
  RENDERS[id] = b.render ? 1 : 0;
  TRANSPARENT[id] = b.transparent && !b.cutout ? 1 : 0;
  CUTOUT[id] = b.cutout ? 1 : 0;
  LIQUID[id] = b.liquid ? 1 : 0;
  TINT[id] = b.tint === 'grass' ? 1 : b.tint === 'foliage' ? 2 : 0;
  if (b.tint) {
    const order = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
    if (!b.tintFaces) TINT_FACEMASK[id] = 0x3f;
    else { let m = 0; for (const f of b.tintFaces) m |= 1 << order.indexOf(f); TINT_FACEMASK[id] = m; }
  }
}

// ---- face defs -------------------------------------------------------
const FACES = [
  { n: [1, 0, 0], shade: 0.72, corners: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [-1, 0, 0], shade: 0.72, corners: [[0, 0, 1], [0, 0, 0], [0, 1, 0], [0, 1, 1]], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], shade: 1.0, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, -1, 0], shade: 0.5, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], shade: 0.86, corners: [[1, 0, 1], [0, 0, 1], [0, 1, 1], [1, 1, 1]], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], shade: 0.86, corners: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], u: [1, 0, 0], v: [0, 1, 0] },
];
const AO_LEVEL = [0.42, 0.62, 0.8, 1.0];
const FACE_TILE_NAMES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

// precompute per (face, corner): corner offset + 3 AO sample offsets (s1, s2, corner)
const CORNER_OFF = []; // [fi*4+ci] -> [cx,cy,cz]
const AO_OFF = [];     // [fi*4+ci] -> [s1x,s1y,s1z, s2x,s2y,s2z, ccx,ccy,ccz]
for (let fi = 0; fi < 6; fi++) {
  const F = FACES[fi];
  for (let ci = 0; ci < 4; ci++) {
    const c = F.corners[ci];
    CORNER_OFF[fi * 4 + ci] = c;
    const du = (c[0] * F.u[0] + c[1] * F.u[1] + c[2] * F.u[2]) * 2 - 1;
    const dv = (c[0] * F.v[0] + c[1] * F.v[1] + c[2] * F.v[2]) * 2 - 1;
    AO_OFF[fi * 4 + ci] = [
      F.n[0] + F.u[0] * du, F.n[1] + F.u[1] * du, F.n[2] + F.u[2] * du,
      F.n[0] + F.v[0] * dv, F.n[1] + F.v[1] * dv, F.n[2] + F.v[2] * dv,
      F.n[0] + F.u[0] * du + F.v[0] * dv,
      F.n[1] + F.u[1] * du + F.v[1] * dv,
      F.n[2] + F.u[2] * du + F.v[2] * dv,
    ];
  }
}

// ---- padded block volume scratch -----------------------------------
const PW = CHUNK_SX + 2;
const PD = CHUNK_SZ + 2;
const PWD = PW * PD;
const PAD = new Uint8Array(PW * PD * WORLD_H);
const pidx = (x, y, z) => (x + 1) + (z + 1) * PW + y * PWD;

const uvCache = new Map();

// growable scratch buffers, one set reused every call.
// capacities are kept as multiples of 3 so uv (= cap/3*2) stays integer.
function mkBuf() {
  const cap = 6144;
  return {
    pos: new Float32Array(cap), col: new Float32Array(cap), norm: new Float32Array(cap),
    uv: new Float32Array((cap / 3) * 2), idx: [], n: 0,
  };
}
const BUFS = { opaque: mkBuf(), cutout: mkBuf(), transparent: mkBuf(), water: mkBuf() };

function ensure(buf, addVerts) {
  const need = (buf.n + addVerts) * 3;
  if (need <= buf.pos.length) return;
  let cap = buf.pos.length;
  while (cap < need) cap *= 2;
  buf.pos = grow(buf.pos, cap);
  buf.col = grow(buf.col, cap);
  buf.norm = grow(buf.norm, cap);
  buf.uv = grow(buf.uv, (cap / 3) * 2);
}
function grow(arr, cap) { const a = new Float32Array(cap); a.set(arr); return a; }

export function buildChunkGeometry(world, chunk, atlas) {
  const ox = chunk.cx * CHUNK_SX;
  const oz = chunk.cz * CHUNK_SZ;
  const SX = CHUNK_SX, SZ = CHUNK_SZ;
  const maxY = Math.min(WORLD_H - 1, (chunk.maxY | 0) + 1);

  const pad = PAD;
  const cb = chunk.blocks;

  // interior (branchless)
  for (let y = 0; y <= maxY; y++) {
    const yb = y * SX * SZ;
    for (let z = 0; z < SZ; z++) {
      let src = z * SX + yb;
      let dst = 1 + (z + 1) * PW + y * PWD;
      for (let x = 0; x < SX; x++) pad[dst++] = cb[src++];
    }
  }
  // borders via world.getBlock
  for (let y = 0; y <= maxY; y++) {
    for (let x = -1; x <= SX; x++) {
      pad[pidx(x, y, -1)] = world.getBlock(ox + x, y, oz - 1);
      pad[pidx(x, y, SZ)] = world.getBlock(ox + x, y, oz + SZ);
    }
    for (let z = 0; z < SZ; z++) {
      pad[pidx(-1, y, z)] = world.getBlock(ox - 1, y, oz + z);
      pad[pidx(SX, y, z)] = world.getBlock(ox + SX, y, oz + z);
    }
  }

  // per-column sky exposure
  const skyTop = new Int16Array(SX * SZ);
  for (let z = 0; z < SZ; z++) {
    for (let x = 0; x < SX; x++) {
      let top = 0;
      for (let y = maxY; y >= 0; y--) {
        if (OPAQUE[pad[pidx(x, y, z)]]) { top = y; break; }
      }
      skyTop[x + z * SX] = top;
    }
  }

  for (const k in BUFS) { BUFS[k].n = 0; BUFS[k].idx.length = 0; }

  const tintCache = new Map();
  const getTint = (kind, wx, wz) => {
    const key = kind + ':' + wx + ':' + wz;
    let t = tintCache.get(key);
    if (!t) { t = biomeTint(kind === 1 ? 'grass' : 'foliage', wx, wz); tintCache.set(key, t); }
    return t;
  };
  const uvOf = (name) => {
    let r = uvCache.get(name);
    if (!r) { r = atlas.uv(name); uvCache.set(name, r); }
    return r;
  };

  for (let y = 0; y <= maxY; y++) {
    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        const self = pad[pidx(x, y, z)];
        if (self === B.AIR || !RENDERS[self]) continue;

        const wx = ox + x, wz = oz + z;
        const buf = LIQUID[self] ? BUFS.water
          : TRANSPARENT[self] ? BUFS.transparent
          : CUTOUT[self] ? BUFS.cutout
          : BUFS.opaque;

        const skl = skylight(skyTop[x + z * SX], y);
        const tintKind = TINT[self];
        const tintMask = TINT_FACEMASK[self];

        for (let fi = 0; fi < 6; fi++) {
          const F = FACES[fi];
          const nId = pad[pidx(x + F.n[0], y + F.n[1], z + F.n[2])];
          if (!faceVisible(self, nId)) continue;

          const uv = uvOf(faceTile(self, FACE_TILE_NAMES[fi]));
          const u0 = uv[0], v0 = uv[1], u1 = uv[2], v1 = uv[3];

          let tr = 1, tg = 1, tb = 1;
          if (tintKind && (tintMask & (1 << fi))) {
            const t = getTint(tintKind, wx, wz);
            tr = t[0]; tg = t[1]; tb = t[2];
          }

          ensure(buf, 4);
          const start = buf.n;
          const pShade = F.shade;
          let a0 = 0, a2 = 0, a1 = 0, a3 = 0;

          for (let ci = 0; ci < 4; ci++) {
            const co = CORNER_OFF[fi * 4 + ci];
            let vy = y + co[1];
            if (self === B.WATER && fi === 2 && co[1] === 1) vy -= 0.12;

            const o = AO_OFF[fi * 4 + ci];
            const s1 = OPAQUE[pad[pidx(x + o[0], y + o[1], z + o[2])]];
            const s2 = OPAQUE[pad[pidx(x + o[3], y + o[4], z + o[5])]];
            let lvl;
            if (s1 && s2) lvl = 0;
            else {
              const cc = OPAQUE[pad[pidx(x + o[6], y + o[7], z + o[8])]];
              lvl = 3 - (s1 + s2 + cc);
            }
            if (ci === 0) a0 = lvl; else if (ci === 1) a1 = lvl; else if (ci === 2) a2 = lvl; else a3 = lvl;

            const l = pShade * AO_LEVEL[lvl] * skl;
            const vi = (buf.n) * 3;
            buf.pos[vi] = wx + co[0]; buf.pos[vi + 1] = vy; buf.pos[vi + 2] = wz + co[2];
            buf.norm[vi] = F.n[0]; buf.norm[vi + 1] = F.n[1]; buf.norm[vi + 2] = F.n[2];
            buf.col[vi] = tr * l; buf.col[vi + 1] = tg * l; buf.col[vi + 2] = tb * l;
            const ti = buf.n * 2;
            buf.uv[ti] = ci === 0 ? u0 : ci === 1 ? u1 : ci === 2 ? u1 : u0;
            buf.uv[ti + 1] = ci === 0 ? v0 : ci === 1 ? v0 : ci === 2 ? v1 : v1;
            buf.n++;
          }

          if (a0 + a2 > a1 + a3) {
            buf.idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
          } else {
            buf.idx.push(start + 1, start + 2, start + 3, start + 1, start + 3, start);
          }
        }
      }
    }
  }

  return {
    opaque: geom(BUFS.opaque, ox, oz),
    cutout: geom(BUFS.cutout, ox, oz),
    transparent: geom(BUFS.transparent, ox, oz),
    water: geom(BUFS.water, ox, oz),
  };
}

function skylight(top, y) {
  if (y >= top) return 1;
  return Math.max(0.16, 1 - (top - y) * 0.13);
}

function faceVisible(self, nId) {
  if (nId === B.AIR) return true;
  if (OPAQUE[nId]) return false;
  if (nId === self) return false;
  return true;
}

function geom(buf, ox, oz) {
  if (buf.n === 0) return null;
  const vcount = buf.n;
  const pos = new Float32Array(vcount * 3);
  for (let i = 0; i < vcount * 3; i += 3) {
    pos[i] = buf.pos[i] - ox;
    pos[i + 1] = buf.pos[i + 1];
    pos[i + 2] = buf.pos[i + 2] - oz;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(buf.norm.slice(0, vcount * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(buf.uv.slice(0, vcount * 2), 2));
  g.setAttribute('color', new THREE.BufferAttribute(buf.col.slice(0, vcount * 3), 3));
  g.setIndex(vcount > 65535
    ? new THREE.BufferAttribute(new Uint32Array(buf.idx), 1)
    : new THREE.BufferAttribute(new Uint16Array(buf.idx), 1));
  g.computeBoundingSphere();
  return g;
}
