import * as THREE from 'three';
import { isItem } from '../constants.js';
import { itemTile } from '../registry/items.js';
import { faceTile } from '../registry/blocks.js';
import { PLAYER_HEIGHT } from '../player/player.js';

const GRAVITY = 20;
const SIZE = 0.3;
const SPAWN_GROW = 0.15; // seconds to grow from 0 to full size
const MIN_PICKUP_AGE = 0.4; // seconds before it can be collected (matches the shrink-in)
const PICKUP_RADIUS = 1.1;
const MAGNET_RADIUS = 2.2;
const MAGNET_SPEED = 6;
const LIFETIME = 300;

// Small physical entity spawned when a block is mined: pops up, falls onto
// the ground, and gets pulled in / collected when the player walks near it.
export class ItemDrops {
  constructor(scene, atlas) {
    this.scene = scene;
    this.atlas = atlas;
    this.drops = [];
  }

  _makeMesh(id) {
    if (isItem(id)) {
      const tex = this._tileTexture(itemTile(id));
      const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
      const g = new THREE.Group();
      const a = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), mat);
      const b = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), mat);
      b.rotation.y = Math.PI / 2;
      g.add(a, b);
      return g;
    }
    const mats = ['px', 'nx', 'py', 'ny', 'pz', 'nz'].map((dir) =>
      new THREE.MeshLambertMaterial({ map: this._tileTexture(faceTile(id, dir)) })
    );
    return new THREE.Mesh(new THREE.BoxGeometry(SIZE, SIZE, SIZE), mats);
  }

  _tileTexture(name) {
    const [u0, v0, u1, v1] = this.atlas.uv(name);
    const tex = this.atlas.texture.clone();
    tex.needsUpdate = true;
    tex.offset.set(u0, v0);
    tex.repeat.set(u1 - u0, v1 - v0);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    return tex;
  }

  spawn(id, x, y, z) {
    const mesh = this._makeMesh(id);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(0.001);
    this.scene.add(mesh);
    this.drops.push({
      id,
      mesh,
      vel: new THREE.Vector3((Math.random() - 0.5) * 1.6, 3 + Math.random() * 1.2, (Math.random() - 0.5) * 1.6),
      age: 0,
      spin: 0.6 + Math.random() * 0.6,
    });
  }

  update(dt, world, player, onPickup) {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      d.mesh.scale.setScalar(Math.min(1, d.age / SPAWN_GROW));
      d.mesh.rotation.y += dt * d.spin;

      d.vel.y -= GRAVITY * dt;
      const p = d.mesh.position;
      const nx = p.x + d.vel.x * dt;
      const ny = p.y + d.vel.y * dt;
      const nz = p.z + d.vel.z * dt;
      const half = SIZE / 2;
      if (d.vel.y < 0 && world.isSolid(Math.floor(nx), Math.floor(ny - half), Math.floor(nz))) {
        p.y = Math.floor(p.y - half) + 1 + half;
        d.vel.set(0, 0, 0);
      } else {
        p.set(nx, ny, nz);
      }

      if (d.age > MIN_PICKUP_AGE && player) {
        const dx = player.pos.x - p.x;
        const dy = player.pos.y + PLAYER_HEIGHT * 0.5 - p.y;
        const dz = player.pos.z - p.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < PICKUP_RADIUS) {
          onPickup(d.id);
          this._remove(i);
          continue;
        }
        if (dist < MAGNET_RADIUS) {
          const k = (MAGNET_SPEED * dt) / dist;
          p.x += dx * k; p.y += dy * k; p.z += dz * k;
        }
      }

      if (d.age > LIFETIME) this._remove(i);
    }
  }

  _remove(i) {
    const d = this.drops[i];
    this.scene.remove(d.mesh);
    d.mesh.traverse((o) => o.geometry?.dispose());
    this.drops.splice(i, 1);
  }

  clear() {
    while (this.drops.length) this._remove(this.drops.length - 1);
  }
}
