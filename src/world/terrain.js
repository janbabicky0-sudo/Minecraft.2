import { B, SEA_LEVEL, WORLD_H, CHUNK_SX, CHUNK_SZ } from '../constants.js';
import { makeNoise } from './noise.js';

export const BIOME = { PLAINS: 0, DESERT: 1, FOREST: 2, MOUNTAINS: 3 };

export const BIOME_INFO = {
  [BIOME.PLAINS]: { name: 'Pláně', grass: [0x91, 0xbd, 0x59], foliage: [0x77, 0xab, 0x2f] },
  [BIOME.DESERT]: { name: 'Poušť', grass: [0xbf, 0xb7, 0x55], foliage: [0xae, 0xa4, 0x2a] },
  [BIOME.FOREST]: { name: 'Les', grass: [0x59, 0x8c, 0x36], foliage: [0x41, 0x74, 0x28] },
  [BIOME.MOUNTAINS]: { name: 'Hory', grass: [0x8a, 0xb6, 0x8a], foliage: [0x6c, 0x9c, 0x6c] },
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function hash2i(x, z, salt = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(salt | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---- per-column data (height + biome), cached ---------------------------
const _colCache = new Map();
function colKey(wx, wz) { return wx * 92821 + wz; }

let N;
let SEED = 'voxelcraft';

export function initTerrain(seed) {
  SEED = seed || 'voxelcraft';
  N = makeNoise(SEED);
  _colCache.clear();
}
initTerrain(SEED);

export function columnData(wx, wz) {
  const k = colKey(wx, wz);
  let c = _colCache.get(k);
  if (c) return c;

  const temp = N.fbm2(wx * 0.0016 + 100, wz * 0.0016 - 40, 2);
  const hum = N.fbm2(wx * 0.0016 - 220, wz * 0.0016 + 310, 2);
  const cont = N.fbm2(wx * 0.0022, wz * 0.0022, 3);
  const cont01 = (cont + 1) * 0.5;

  const rolling = N.fbm2(wx * 0.0075, wz * 0.0075, 4) * 9;
  const detail = N.fbm2(wx * 0.03, wz * 0.03, 3) * 2.2;
  const mtnMask = smoothstep(0.58, 0.82, cont01);
  const ridge = 1 - Math.abs(N.fbm2(wx * 0.014, wz * 0.014, 4));
  const mountains = mtnMask * (ridge * 46 + 14);

  const height = Math.round(clamp(SEA_LEVEL + 2 + rolling + detail + mountains + cont * 4, 2, WORLD_H - 10));

  let biome;
  if (cont01 > 0.7 || height > SEA_LEVEL + 26) biome = BIOME.MOUNTAINS;
  else if (temp > 0.28 && hum < -0.05) biome = BIOME.DESERT;
  else if (hum > 0.12) biome = BIOME.FOREST;
  else biome = BIOME.PLAINS;

  c = { height, biome };
  if (_colCache.size > 200000) _colCache.clear();
  _colCache.set(k, c);
  return c;
}

export const heightAt = (wx, wz) => columnData(wx, wz).height;
export const biomeAt = (wx, wz) => columnData(wx, wz).biome;

// ---- structures --------------------------------------------------------
function treeAt(wx, wz) {
  const { height, biome } = columnData(wx, wz);
  let density = 0;
  if (biome === BIOME.FOREST) density = 0.09;
  else if (biome === BIOME.PLAINS) density = 0.012;
  else if (biome === BIOME.MOUNTAINS) density = 0.02;
  if (density === 0) return null;
  if (hash2i(wx, wz, 12345) >= density) return null;
  if (height <= SEA_LEVEL) return null;
  if (biome === BIOME.MOUNTAINS && height > SEA_LEVEL + 34) return null;
  const th = 4 + Math.floor(hash2i(wx, wz, 777) * 3);
  return { baseY: height, top: height + th };
}

function cactusAt(wx, wz) {
  const { height, biome } = columnData(wx, wz);
  if (biome !== BIOME.DESERT) return null;
  if (hash2i(wx, wz, 5150) >= 0.02) return null;
  if (height <= SEA_LEVEL) return null;
  return { baseY: height, top: height + 1 + Math.floor(hash2i(wx, wz, 99) * 3) };
}

// build the list of structures whose blocks can fall inside a chunk (+2 pad)
function chunkStructures(cx, cz) {
  const list = [];
  const ox = cx * CHUNK_SX, oz = cz * CHUNK_SZ;
  for (let z = -2; z < CHUNK_SZ + 2; z++) {
    for (let x = -2; x < CHUNK_SX + 2; x++) {
      const wx = ox + x, wz = oz + z;
      const t = treeAt(wx, wz);
      if (t) list.push({ kind: 'tree', wx, wz, ...t });
      const c = cactusAt(wx, wz);
      if (c) list.push({ kind: 'cactus', wx, wz, ...c });
    }
  }
  return list;
}

function structureBlockFromList(list, wx, wy, wz) {
  for (const s of list) {
    const dx = wx - s.wx, dz = wz - s.wz;
    if (s.kind === 'cactus') {
      if (dx === 0 && dz === 0 && wy > s.baseY && wy <= s.top) return B.CACTUS;
      continue;
    }
    // tree
    if (dx === 0 && dz === 0 && wy > s.baseY && wy <= s.top) return B.LOG;
    const dy = wy - s.top;
    if (dy >= -2 && dy <= 1) {
      const rad = dy >= 0 ? 1 : 2;
      if (Math.abs(dx) <= rad && Math.abs(dz) <= rad) {
        if (rad === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        if (dx === 0 && dz === 0 && wy <= s.top) continue;
        return B.LEAVES;
      }
    }
  }
  return 0;
}

// ---- caves / ores -----------------------------------------------------
function isCave(wx, wy, wz, surfaceH) {
  if (wy <= 4 || wy >= surfaceH - 1) return false;
  // Thresholds tuned so the underground stays mostly solid rock (~5-6% carved)
  // instead of a hollow, swiss-cheese interior you can see clean through.
  if (N.noise3D(wx * 0.045, wy * 0.05, wz * 0.045) > 0.85) return true;
  const b = 1 - Math.abs(N.noise3D(wx * 0.02 + 40, wy * 0.03, wz * 0.02));
  if (b <= 0.88) return false;
  const c = 1 - Math.abs(N.noise3D(wx * 0.02, wy * 0.03, wz * 0.02 + 80));
  return c > 0.88;
}

function oreAt(wx, wy, wz, surfaceH) {
  if (surfaceH - wy < 2) return 0;
  const n = (s) => N.noise3D((wx + s) * 0.11, (wy - s) * 0.11, (wz + s) * 0.11);
  if (wy < 16 && n(900) > 0.86) return B.DIAMOND_ORE;
  if (wy < 30 && n(700) > 0.85) return B.GOLD_ORE;
  if (wy < SEA_LEVEL + 6 && n(500) > 0.8) return B.IRON_ORE;
  if (n(300) > 0.74) return B.COAL_ORE;
  return 0;
}

function surfaceBlock(biome, height, wy) {
  if (biome === BIOME.DESERT) return B.SAND;
  if (biome === BIOME.MOUNTAINS) {
    if (wy > SEA_LEVEL + 30) return B.SNOW;
    if (wy > SEA_LEVEL + 18) return B.STONE;
    return B.GRASS;
  }
  if (height <= SEA_LEVEL + 1) return B.SAND;
  return B.GRASS;
}

// ---- single-block sampler (fallback, not used in hot loops) -----------
export function blockAt(wx, wy, wz) {
  if (wy < 0 || wy >= WORLD_H) return B.AIR;
  if (wy === 0) return B.BEDROCK;
  const { height, biome } = columnData(wx, wz);

  if (wy <= 3 && hash2i(wx * 7 + wy, wz * 7, 42) < (4 - wy) / 4) return B.BEDROCK;

  if (wy > height) {
    const near = [];
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const t = treeAt(wx + dx, wz + dz);
        if (t) near.push({ kind: 'tree', wx: wx + dx, wz: wz + dz, ...t });
        const c = cactusAt(wx + dx, wz + dz);
        if (c) near.push({ kind: 'cactus', wx: wx + dx, wz: wz + dz, ...c });
      }
    }
    const st = structureBlockFromList(near, wx, wy, wz);
    if (st) return st;
    if (wy <= SEA_LEVEL) return B.WATER;
    return B.AIR;
  }

  const caveHere = wy > 4 && wy < height - 1 &&
    (height > SEA_LEVEL || wy <= SEA_LEVEL) && isCave(wx, wy, wz, height);
  if (caveHere) return B.AIR;

  const d = height - wy;
  if (d === 0) return surfaceBlock(biome, height, wy);
  if (d <= 3) {
    if (biome === BIOME.DESERT) return B.SANDSTONE;
    if (biome === BIOME.MOUNTAINS && wy > SEA_LEVEL + 18) return B.STONE;
    if (height <= SEA_LEVEL + 1) return B.SAND;
    return B.DIRT;
  }
  const ore = oreAt(wx, wy, wz, height);
  if (ore) return ore;
  if (N.noise3D(wx * 0.08, wy * 0.08, wz * 0.08) > 0.8) return B.GRAVEL;
  return B.STONE;
}

// ---- fast whole-chunk generator -------------------------------------
export function generateChunkBlocks(cx, cz, blocks) {
  const ox = cx * CHUNK_SX, oz = cz * CHUNK_SZ;
  const structs = chunkStructures(cx, cz);

  // per-column caches for this chunk
  const H = new Int16Array(CHUNK_SX * CHUNK_SZ);
  const BI = new Uint8Array(CHUNK_SX * CHUNK_SZ);
  for (let z = 0; z < CHUNK_SZ; z++) {
    for (let x = 0; x < CHUNK_SX; x++) {
      const cd = columnData(ox + x, oz + z);
      H[x + z * CHUNK_SX] = cd.height;
      BI[x + z * CHUNK_SX] = cd.biome;
    }
  }

  const SX = CHUNK_SX, SXZ = CHUNK_SX * CHUNK_SZ;

  for (let z = 0; z < CHUNK_SZ; z++) {
    for (let x = 0; x < CHUNK_SX; x++) {
      const wx = ox + x, wz = oz + z;
      const ci = x + z * SX;
      const height = H[ci];
      const biome = BI[ci];
      const colStructs = structs.length
        ? structs.filter((s) => Math.abs(wx - s.wx) <= 2 && Math.abs(wz - s.wz) <= 2)
        : null;

      for (let y = 0; y < WORLD_H; y++) {
        let id = B.AIR;

        if (y === 0) {
          id = B.BEDROCK;
        } else if (y <= 3 && hash2i(wx * 7 + y, wz * 7, 42) < (4 - y) / 4) {
          id = B.BEDROCK;
        } else if (y > height) {
          if (colStructs && colStructs.length) {
            id = structureBlockFromList(colStructs, wx, y, wz);
          }
          if (id === B.AIR && y <= SEA_LEVEL) id = B.WATER;
        } else {
          // solid column
          const caveHere =
            y > 4 && y < height - 1 &&
            (height > SEA_LEVEL || y <= SEA_LEVEL) &&
            isCave(wx, y, wz, height);

          if (caveHere) {
            id = B.AIR;
          } else {
            const d = height - y;
            if (d === 0) id = surfaceBlock(biome, height, y);
            else if (d <= 3) {
              if (biome === BIOME.DESERT) id = B.SANDSTONE;
              else if (biome === BIOME.MOUNTAINS && y > SEA_LEVEL + 18) id = B.STONE;
              else if (height <= SEA_LEVEL + 1) id = B.SAND;
              else id = B.DIRT;
            } else {
              const ore = oreAt(wx, y, wz, height);
              if (ore) id = ore;
              else if (N.noise3D(wx * 0.08, y * 0.08, wz * 0.08) > 0.8) id = B.GRAVEL;
              else id = B.STONE;
            }
          }
        }

        blocks[ci + y * SXZ] = id;
      }
    }
  }
}

export function biomeTint(kind, wx, wz) {
  const info = BIOME_INFO[biomeAt(wx, wz)];
  const c = kind === 'foliage' ? info.foliage : info.grass;
  return [c[0] / 255, c[1] / 255, c[2] / 255];
}
