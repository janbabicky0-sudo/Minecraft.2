import * as THREE from 'three';
import { B } from '../constants.js';
import { Mob } from './mob.js';
import { MOBS, LAND_MOBS, WATER_MOBS } from './mobs.js';

const MAX_LAND = 10;
const MAX_WATER = 8;
const SPAWN_RADIUS = 44;
const DESPAWN_RADIUS = 80;
const SPAWN_INTERVAL = 4; // seconds between spawn attempts

export class MobManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.mobs = [];
    this._spawnT = 1;
    this._raycaster = new THREE.Raycaster();
  }

  count(medium) {
    return this.mobs.filter((m) => m.def.medium === medium && !m.dead).length;
  }

  spawn(type, x, y, z) {
    const m = new Mob(type, this.world, x + 0.5, y, z + 0.5);
    m.addTo(this.scene);
    this.mobs.push(m);
    return m;
  }

  // scatter a few mobs near the player at world start
  seed(playerPos) {
    for (let i = 0; i < 6; i++) this._trySpawnLand(playerPos, 8, 24);
    for (let i = 0; i < 4; i++) this._trySpawnWater(playerPos, 6, 30);
  }

  _trySpawnLand(playerPos, rMin, rMax) {
    if (this.count('land') >= MAX_LAND) return;
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = rMin + Math.random() * (rMax - rMin);
      const x = Math.floor(playerPos.x + Math.cos(a) * r);
      const z = Math.floor(playerPos.z + Math.sin(a) * r);
      const gy = this.world.groundTop(x, z);
      if (gy < 1) continue;
      const surf = this.world.getBlock(x, gy, z);
      if (surf !== B.GRASS && surf !== B.SNOW && surf !== B.DIRT) continue;
      if (this.world.getBlock(x, gy + 1, z) !== B.AIR || this.world.getBlock(x, gy + 2, z) !== B.AIR) continue;
      const type = LAND_MOBS[(Math.random() * LAND_MOBS.length) | 0];
      this.spawn(type, x, gy + 1.05, z);
      return;
    }
  }

  _trySpawnWater(playerPos, rMin, rMax) {
    if (this.count('water') >= MAX_WATER) return;
    for (let attempt = 0; attempt < 10; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = rMin + Math.random() * (rMax - rMin);
      const x = Math.floor(playerPos.x + Math.cos(a) * r);
      const z = Math.floor(playerPos.z + Math.sin(a) * r);
      // find a water column
      for (let y = 42; y >= 30; y--) {
        if (this.world.getBlock(x, y, z) === B.WATER && this.world.getBlock(x, y + 1, z) === B.WATER) {
          this.spawn(WATER_MOBS[0], x, y + 0.4, z);
          return;
        }
      }
    }
  }

  update(dt, playerPos) {
    // periodic top-ups
    this._spawnT -= dt;
    if (this._spawnT <= 0) {
      this._spawnT = SPAWN_INTERVAL;
      if (this.count('land') < MAX_LAND) this._trySpawnLand(playerPos, 24, SPAWN_RADIUS);
      if (this.count('water') < MAX_WATER) this._trySpawnWater(playerPos, 20, SPAWN_RADIUS);
    }

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      m.update(dt, playerPos);

      const far = Math.hypot(m.pos.x - playerPos.x, m.pos.z - playerPos.z) > DESPAWN_RADIUS;
      const gone = m.dead && m._deathT <= 0;
      if (gone || far) {
        m.removeFrom(this.scene);
        this.mobs.splice(i, 1);
      }
    }
  }

  // ray from `origin` along `dir`; returns the nearest mob hit within maxDist
  // (and its distance) or null. Used for melee.
  raycast(origin, dir, maxDist) {
    let best = null, bestD = maxDist;
    const box = new THREE.Box3();
    for (const m of this.mobs) {
      if (m.dead) continue;
      box.min.set(m.pos.x - m.hw, m.pos.y, m.pos.z - m.hw);
      box.max.set(m.pos.x + m.hw, m.pos.y + m.def.h, m.pos.z + m.hw);
      const t = rayBox(origin, dir, box);
      if (t != null && t < bestD) { bestD = t; best = m; }
    }
    return best ? { mob: best, dist: bestD } : null;
  }

  clear() {
    for (const m of this.mobs) m.removeFrom(this.scene);
    this.mobs.length = 0;
  }
}

// slab-method ray/AABB, returns entry distance or null
function rayBox(o, d, b) {
  let tmin = -Infinity, tmax = Infinity;
  for (const ax of ['x', 'y', 'z']) {
    const inv = 1 / d[ax];
    let t1 = (b.min[ax] - o[ax]) * inv;
    let t2 = (b.max[ax] - o[ax]) * inv;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin > 0 ? tmin : (tmax > 0 ? 0 : null);
}
