import { CHUNK_SX, CHUNK_SZ, WORLD_H, B } from '../constants.js';
import { generateChunkBlocks } from './terrain.js';

export const chunkKey = (cx, cz) => `${cx},${cz}`;

const idx = (x, y, z) => x + z * CHUNK_SX + y * CHUNK_SX * CHUNK_SZ;

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.key = chunkKey(cx, cz);
    this.blocks = new Uint8Array(CHUNK_SX * CHUNK_SZ * WORLD_H);
    this.edits = new Map(); // localIndex -> blockId (player changes, persisted)
    this.generated = false;
    this.dirty = true; // needs (re)mesh
    this.meshed = false;
    this.maxY = WORLD_H - 1; // highest non-air row (+meshing upper bound)
    this.meshes = []; // THREE.Mesh[]
    this.geoms = []; // THREE.BufferGeometry[]
  }

  generate(savedEdits) {
    const b = this.blocks;
    generateChunkBlocks(this.cx, this.cz, b);
    if (savedEdits) {
      for (let i = 0; i < savedEdits.length; i += 2) {
        const li = savedEdits[i];
        const id = savedEdits[i + 1];
        b[li] = id;
        this.edits.set(li, id);
      }
    }
    this._recomputeMaxY();
    this.generated = true;
    this.dirty = true;
  }

  _recomputeMaxY() {
    const b = this.blocks;
    for (let y = WORLD_H - 1; y >= 0; y--) {
      const base = y * CHUNK_SX * CHUNK_SZ;
      let any = false;
      for (let i = 0; i < CHUNK_SX * CHUNK_SZ; i++) {
        if (b[base + i] !== B.AIR) { any = true; break; }
      }
      if (any) { this.maxY = Math.min(WORLD_H - 1, y + 1); return; }
    }
    this.maxY = 1;
  }

  getLocal(x, y, z) {
    if (y < 0 || y >= WORLD_H) return B.AIR;
    return this.blocks[idx(x, y, z)];
  }

  setLocal(x, y, z, id, record = true) {
    if (y < 0 || y >= WORLD_H) return;
    const li = idx(x, y, z);
    this.blocks[li] = id;
    if (record) this.edits.set(li, id);
    if (id !== B.AIR && y + 1 > this.maxY) this.maxY = Math.min(WORLD_H - 1, y + 1);
    this.dirty = true;
  }

  serializeEdits() {
    if (this.edits.size === 0) return null;
    const arr = new Array(this.edits.size * 2);
    let i = 0;
    for (const [li, id] of this.edits) {
      arr[i++] = li;
      arr[i++] = id;
    }
    return arr;
  }

  clearMeshes(scene) {
    for (const m of this.meshes) scene.remove(m);
    for (const g of this.geoms) g.dispose();
    this.meshes = [];
    this.geoms = [];
  }

  dispose(scene) {
    this.clearMeshes(scene);
    this.meshed = false;
  }
}
