import * as THREE from 'three';
import { CHUNK_SX, CHUNK_SZ, WORLD_H, SEA_LEVEL, B } from '../constants.js';
import { Chunk, chunkKey } from './chunk.js';
import { blockAt } from './terrain.js';
import { buildChunkGeometry } from '../rendering/mesher.js';

const floorDiv = (a, b) => Math.floor(a / b);
const mod = (a, b) => ((a % b) + b) % b;

export class World {
  constructor(scene, atlas, opts = {}) {
    this.scene = scene;
    this.atlas = atlas;
    this.chunks = new Map();
    this.renderDistance = opts.renderDistance ?? 5;
    this.savedEdits = opts.savedEdits || {}; // { "cx,cz": [li,id,...] }
    this.onEdit = opts.onEdit || (() => {});

    this.materials = {
      opaque: new THREE.MeshLambertMaterial({
        map: atlas.texture, vertexColors: true,
      }),
      cutout: new THREE.MeshLambertMaterial({
        map: atlas.texture, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide,
      }),
      transparent: new THREE.MeshLambertMaterial({
        map: atlas.texture, vertexColors: true, transparent: true, opacity: 1,
        alphaTest: 0.02, depthWrite: false, side: THREE.DoubleSide,
      }),
      water: new THREE.MeshLambertMaterial({
        map: atlas.texture, vertexColors: true, transparent: true, opacity: 0.86,
        depthWrite: true, side: THREE.FrontSide,
      }),
    };
    this.renderOrder = { opaque: 0, cutout: 0, transparent: 2, water: 3 };

    this._genQueue = [];
    this._meshQueue = [];
    this._center = { cx: 0, cz: 0 };
  }

  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz));
  }

  ensureChunk(cx, cz) {
    let c = this.getChunk(cx, cz);
    if (!c) {
      c = new Chunk(cx, cz);
      this.chunks.set(c.key, c);
    }
    if (!c.generated) {
      c.generate(this.savedEdits[c.key]);
    }
    return c;
  }

  // world-space block read; falls back to procedural sample if chunk absent
  getBlock(wx, wy, wz) {
    if (wy < 0 || wy >= WORLD_H) return B.AIR;
    const cx = floorDiv(wx, CHUNK_SX);
    const cz = floorDiv(wz, CHUNK_SZ);
    const c = this.getChunk(cx, cz);
    if (c && c.generated) {
      return c.getLocal(mod(wx, CHUNK_SX), wy, mod(wz, CHUNK_SZ));
    }
    return blockAt(wx, wy, wz);
  }

  isSolid(wx, wy, wz) {
    const id = this.getBlock(wx, wy, wz);
    return id !== B.AIR && !isNonCollidable(id);
  }

  setBlock(wx, wy, wz, id, record = true) {
    if (wy < 1 || wy >= WORLD_H) return;
    const cx = floorDiv(wx, CHUNK_SX);
    const cz = floorDiv(wz, CHUNK_SZ);
    const c = this.ensureChunk(cx, cz);
    const lx = mod(wx, CHUNK_SX);
    const lz = mod(wz, CHUNK_SZ);
    c.setLocal(lx, wy, lz, id, record);
    if (record) {
      this.savedEdits[c.key] = c.serializeEdits() || [];
      this.onEdit();
    }
    // re-mesh this chunk + any neighbour sharing the touched border
    this._markDirty(cx, cz);
    if (lx === 0) this._markDirty(cx - 1, cz);
    if (lx === CHUNK_SX - 1) this._markDirty(cx + 1, cz);
    if (lz === 0) this._markDirty(cx, cz - 1);
    if (lz === CHUNK_SZ - 1) this._markDirty(cx, cz + 1);
  }

  _markDirty(cx, cz) {
    const c = this.getChunk(cx, cz);
    if (c && c.generated) {
      c.dirty = true;
      if (!this._meshQueue.includes(c.key)) this._meshQueue.push(c.key);
    }
  }

  // highest non-air, non-water block at column (for spawn / respawn)
  columnTop(wx, wz) {
    for (let y = WORLD_H - 1; y > 0; y--) {
      const id = this.getBlock(wx, y, wz);
      if (id !== B.AIR && id !== B.WATER) return y;
    }
    return 1;
  }

  // highest solid *ground* block (skips leaves/logs/water) in a column
  groundTop(wx, wz) {
    for (let y = WORLD_H - 1; y > 0; y--) {
      const id = this.getBlock(wx, y, wz);
      if (id === B.AIR || id === B.WATER || id === B.LEAVES || id === B.LOG || id === B.CACTUS) continue;
      // needs 2 blocks of air above to stand
      if (this.getBlock(wx, y + 1, wz) === B.AIR && this.getBlock(wx, y + 2, wz) === B.AIR) return y;
      return -1;
    }
    return -1;
  }

  // find a safe standing spot near (wx,wz): dry solid ground, headroom, above sea
  findSpawn(wx, wz) {
    let best = null;
    for (let r = 0; r <= 12 && !best; r++) {
      for (let dz = -r; dz <= r && !best; dz++) {
        for (let dx = -r; dx <= r && !best; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const gx = wx + dx, gz = wz + dz;
          const gy = this.groundTop(gx, gz);
          if (gy < 1) continue;
          if (gy < SEA_LEVEL) continue; // avoid ocean floor / beaches under water
          best = { x: gx, y: gy + 1, z: gz };
        }
      }
    }
    if (!best) {
      const gy = Math.max(SEA_LEVEL + 1, this.columnTop(wx, wz) + 1);
      best = { x: wx, y: gy, z: wz };
    }
    // face toward the most open direction (clear at eye level, ideally a view)
    let bestYaw = 0, bestScore = -Infinity;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      let score = 0;
      for (let d = 1; d <= 5; d++) {
        const lx = Math.round(best.x + Math.sin(-a) * d);
        const lz = Math.round(best.z + Math.cos(-a) * d);
        const eyeClear = this.getBlock(lx, best.y + 1, lz) === B.AIR && this.getBlock(lx, best.y, lz) === B.AIR;
        if (!eyeClear) { score -= d <= 2 ? 20 : 4; }
        else { score += 2; score += (best.y - this.columnTop(lx, lz)); }
      }
      if (score > bestScore) { bestScore = score; bestYaw = a; }
    }
    best.yaw = bestYaw;
    return best;
  }

  update(playerPos, budgetMs = 6) {
    const pcx = floorDiv(playerPos.x, CHUNK_SX);
    const pcz = floorDiv(playerPos.z, CHUNK_SZ);
    this._center = { cx: pcx, cz: pcz };
    const R = this.renderDistance;
    const G = R + 1; // generate one extra ring so borders can be meshed

    // enqueue missing generation (incl. border ring), nearest first
    const gen = [];
    const want = [];
    for (let dz = -G; dz <= G; dz++) {
      for (let dx = -G; dx <= G; dx++) {
        const d = dx * dx + dz * dz;
        if (d > (G + 0.5) * (G + 0.5)) continue;
        const cx = pcx + dx, cz = pcz + dz;
        const c = this.chunks.get(chunkKey(cx, cz));
        if (!c || !c.generated) gen.push({ cx, cz, d });
        if (d <= (R + 0.5) * (R + 0.5)) want.push({ cx, cz, d });
      }
    }
    gen.sort((a, b) => a.d - b.d);

    const t0 = performance.now();
    let gcount = 0;
    for (const g of gen) {
      this.ensureChunk(g.cx, g.cz);
      gcount++;
      if (gcount >= 1 && performance.now() - t0 > budgetMs) break;
    }
    // don't stack a heavy remesh on top of generation in the same frame
    const meshBudget = gcount > 0 ? Math.max(1, budgetMs - (performance.now() - t0)) : budgetMs;

    // enqueue dirty chunks whose 3x3 neighbourhood is generated
    want.sort((a, b) => a.d - b.d);
    for (const w of want) {
      const key = chunkKey(w.cx, w.cz);
      const c = this.chunks.get(key);
      if (!c || !c.generated || !c.dirty) continue;
      if (!this._neighboursReady(w.cx, w.cz)) continue;
      if (!this._meshQueue.includes(key)) this._meshQueue.push(key);
    }
    this._meshQueue.sort((a, b) => this._dist(a) - this._dist(b));

    const t1 = performance.now();
    let meshed = 0;
    while (this._meshQueue.length) {
      // always allow the first remesh; after that respect the remaining budget
      if (meshed > 0 && (gcount > 0 || performance.now() - t1 >= meshBudget)) break;
      const key = this._meshQueue.shift();
      const c = this.chunks.get(key);
      if (!c || !c.generated || !c.dirty) continue;
      if (!this._neighboursReady(c.cx, c.cz)) continue;
      this._remesh(c);
      meshed++;
    }

    // unload far chunks
    for (const [key, c] of this.chunks) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > (G + 2) * (G + 2)) {
        // edits are already mirrored into this.savedEdits by setBlock()
        c.dispose(this.scene);
        this.chunks.delete(key);
      }
    }
  }

  _dist(key) {
    const [cx, cz] = key.split(',').map(Number);
    const dx = cx - this._center.cx, dz = cz - this._center.cz;
    return dx * dx + dz * dz;
  }

  // pure check: is the full 3x3 neighbourhood generated?
  _neighboursReady(cx, cz) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.getChunk(cx + dx, cz + dz);
        if (!c || !c.generated) return false;
      }
    }
    return true;
  }

  _remesh(c) {
    c.dirty = false;
    const geos = buildChunkGeometry(this, c, this.atlas);
    c.clearMeshes(this.scene);

    const ox = c.cx * CHUNK_SX;
    const oz = c.cz * CHUNK_SZ;

    for (const kind of ['opaque', 'cutout', 'transparent', 'water']) {
      const g = geos[kind];
      if (!g) continue;
      const mesh = new THREE.Mesh(g, this.materials[kind]);
      mesh.position.set(ox, 0, oz);
      mesh.renderOrder = this.renderOrder[kind];
      mesh.frustumCulled = true;
      this.scene.add(mesh);
      c.meshes.push(mesh);
      c.geoms.push(g);
    }
    c.meshed = true;
  }

  // true if enough terrain around the spawn column is ready to stand on
  spawnReady(wx, wz) {
    const cx = floorDiv(wx, CHUNK_SX), cz = floorDiv(wz, CHUNK_SZ);
    const c = this.getChunk(cx, cz);
    return !!(c && c.generated && c.meshed);
  }

  loadedCount() {
    return this.chunks.size;
  }

  serializeAllEdits() {
    const out = {};
    for (const [key, c] of this.chunks) {
      const s = c.serializeEdits();
      if (s) out[key] = s;
    }
    // keep edits for unloaded chunks too
    for (const key in this.savedEdits) {
      if (!out[key] && this.savedEdits[key]?.length) out[key] = this.savedEdits[key];
    }
    return out;
  }
}

function isNonCollidable(id) {
  return id === B.WATER;
}
