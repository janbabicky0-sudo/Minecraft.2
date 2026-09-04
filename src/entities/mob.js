import * as THREE from 'three';
import { B, WORLD_H } from '../constants.js';
import { getBlock } from '../registry/blocks.js';
import { MOBS } from './mobs.js';

const GRAVITY = 24;

let _id = 0;

export class Mob {
  constructor(type, world, x, y, z) {
    this.type = type;
    this.def = MOBS[type];
    this.world = world;
    this.id = ++_id;

    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.onGround = false;
    this.health = this.def.health;
    this.dead = false;

    this._wanderT = 0;
    this._moveDir = 0;      // -1 / 0 / 1 forward intent
    this._turn = 0;
    this._hurtT = 0;
    this._deathT = 0;
    this._anim = Math.random() * 10;

    this.group = this.def.model();
    this.group.userData.mob = this;
    this._baseMats = [];
    this.group.traverse((o) => { if (o.isMesh) this._baseMats.push([o, o.material]); });
    this.syncMesh();
  }

  get medium() { return this.def.medium; }
  inWater() {
    return this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + this.def.h * 0.5), Math.floor(this.pos.z)) === B.WATER;
  }
  feetInWater() {
    return this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.1), Math.floor(this.pos.z)) === B.WATER;
  }

  // AABB half-extents
  get hw() { return this.def.w / 2; }

  hurt(amount, knockDir) {
    if (this.dead) return;
    this.health -= amount;
    this._hurtT = 0.3;
    if (knockDir) {
      this.vel.x += knockDir.x * 6;
      this.vel.z += knockDir.z * 6;
      this.vel.y = Math.max(this.vel.y, 5);
    }
    // panic: run away for a bit
    this._wanderT = 2.5;
    this._moveDir = 1;
    if (knockDir) this.yaw = Math.atan2(knockDir.x, knockDir.z);
    if (this.health <= 0) { this.dead = true; this._deathT = 0.45; }
  }

  update(dt, playerPos) {
    dt = Math.min(dt, 0.05);
    this._anim += dt;
    if (this._hurtT > 0) this._hurtT -= dt;

    if (this.dead) {
      this._deathT -= dt;
      const k = Math.max(0, this._deathT / 0.45);
      this.group.scale.setScalar(k);
      this.group.rotation.z = (1 - k) * 1.4;
      return;
    }

    const water = this.medium === 'water';
    if (water) this._updateFish(dt);
    else this._updateLand(dt, playerPos);

    this.syncMesh();
  }

  _updateLand(dt, playerPos) {
    // wander AI
    this._wanderT -= dt;
    if (this._wanderT <= 0) {
      if (Math.random() < 0.45) { this._moveDir = 0; this._wanderT = 1 + Math.random() * 2.5; }
      else {
        this._moveDir = 1;
        this._turn = (Math.random() - 0.5) * 2.5;
        this._wanderT = 1.5 + Math.random() * 3;
      }
    }
    // occasionally react to the player being very close
    if (playerPos) {
      const d = Math.hypot(playerPos.x - this.pos.x, playerPos.z - this.pos.z);
      if (d < 3 && Math.random() < 0.02) {
        this.yaw = Math.atan2(this.pos.x - playerPos.x, this.pos.z - playerPos.z);
        this._moveDir = 1; this._wanderT = Math.max(this._wanderT, 1.5);
      }
    }

    this.yaw += this._turn * dt;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const inWater = this.feetInWater();
    const spd = this.def.speed * (inWater ? 0.5 : 1);

    // don't walk off a big drop or into a wall — steer instead
    if (this._moveDir > 0 && this.onGround) {
      const ahead = { x: this.pos.x + fx * (this.hw + 0.4), z: this.pos.z + fz * (this.hw + 0.4) };
      if (this._blockedAhead(ahead) || this._cliffAhead(ahead)) {
        this._turn = (Math.random() < 0.5 ? 1 : -1) * 2;
        this._moveDir = Math.random() < 0.3 ? 0 : 1;
        this._wanderT = 0.8 + Math.random();
      }
    }

    const targetX = this._moveDir > 0 ? fx * spd : 0;
    const targetZ = this._moveDir > 0 ? fz * spd : 0;
    const accel = this.onGround ? 10 : 3;
    this.vel.x += (targetX - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (targetZ - this.vel.z) * Math.min(1, accel * dt);

    const gs = this.def.gravityScale ?? 1;
    if (inWater) {
      this.vel.y += (2 - this.vel.y) * Math.min(1, 4 * dt); // float up
    } else {
      this.vel.y -= GRAVITY * gs * dt;
    }
    // hop over a 1-block step / small obstacle
    if (this._moveDir > 0 && this.onGround && this._stepAhead(fx, fz)) this.vel.y = 7;

    this._move(dt);

    // chicken flutter
    if (this.type === 'chicken' && !this.onGround && this.vel.y < 0) this.vel.y = Math.max(this.vel.y, -3);
  }

  _updateFish(dt) {
    this._wanderT -= dt;
    if (this._wanderT <= 0) {
      this._turn = (Math.random() - 0.5) * 3;
      this._pitch = (Math.random() - 0.5) * 0.8;
      this._wanderT = 0.8 + Math.random() * 2;
    }
    this.yaw += this._turn * dt;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const spd = this.def.speed;
    this.vel.x = fx * spd;
    this.vel.z = fz * spd;
    this.vel.y = (this._pitch || 0) * spd;

    // keep inside water: bounce off air / solid
    const nx = this.pos.x + fx * 0.6, ny = this.pos.y + (this.vel.y > 0 ? 0.5 : -0.3), nz = this.pos.z + fz * 0.6;
    if (this.world.getBlock(Math.floor(nx), Math.floor(this.pos.y), Math.floor(nz)) !== B.WATER) this._turn += (Math.random() < 0.5 ? 3 : -3);
    if (this.world.getBlock(Math.floor(this.pos.x), Math.floor(ny), Math.floor(this.pos.z)) !== B.WATER) this._pitch = -(this._pitch || 0.1);

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;
    // hard clamp back into water
    if (!this.inWater()) {
      this.pos.y -= 0.1;
      if (!this.inWater()) this.dead = this.dead || false; // let manager despawn stranded fish
      this._strandT = (this._strandT || 0) + dt;
      if (this._strandT > 2) { this.dead = true; this._deathT = 0.45; }
    } else this._strandT = 0;
  }

  _blockedAhead(a) {
    const y = Math.floor(this.pos.y + this.def.h * 0.5);
    return this._solid(Math.floor(a.x), y, Math.floor(a.z));
  }
  _cliffAhead(a) {
    const fx = Math.floor(a.x), fz = Math.floor(a.z);
    let air = 0;
    for (let dy = -1; dy >= -4; dy--) {
      if (this._solid(fx, Math.floor(this.pos.y) + dy, fz)) break;
      air++;
    }
    return air >= 4;
  }
  _stepAhead(fx, fz) {
    const ax = Math.floor(this.pos.x + fx * (this.hw + 0.3));
    const az = Math.floor(this.pos.z + fz * (this.hw + 0.3));
    const fy = Math.floor(this.pos.y);
    return this._solid(ax, fy, az) && !this._solid(ax, fy + 1, az) && !this._solid(ax, fy + 2, az);
  }

  _move(dt) {
    this._moveAxis('x', this.vel.x * dt);
    this._moveAxis('z', this.vel.z * dt);
    this.onGround = false;
    this._moveAxis('y', this.vel.y * dt);
    if (this.pos.y < -30) { this.dead = true; this._deathT = 0.01; }
  }

  _moveAxis(axis, amt) {
    if (amt === 0) return;
    const p = this.pos, hw = this.hw, h = this.def.h;
    p[axis] += amt;
    const x0 = Math.floor(p.x - hw + 1e-3), x1 = Math.floor(p.x + hw - 1e-3);
    const y0 = Math.floor(p.y + 1e-3), y1 = Math.floor(p.y + h - 1e-3);
    const z0 = Math.floor(p.z - hw + 1e-3), z1 = Math.floor(p.z + hw - 1e-3);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          if (!this._solid(x, y, z)) continue;
          if (axis === 'x') { p.x = amt > 0 ? x - hw - 1e-3 : x + 1 + hw + 1e-3; this.vel.x = 0; }
          else if (axis === 'z') { p.z = amt > 0 ? z - hw - 1e-3 : z + 1 + hw + 1e-3; this.vel.z = 0; }
          else if (amt > 0) { p.y = y - h - 1e-3; this.vel.y = 0; }
          else { p.y = y + 1 + 1e-3; this.vel.y = 0; this.onGround = true; }
          return;
        }
  }

  _solid(x, y, z) {
    if (y < 0 || y >= WORLD_H) return y < 0;
    const id = this.world.getBlock(x, y, z);
    if (id === B.AIR) return false;
    const b = getBlock(id);
    return b.solid && !b.liquid;
  }

  syncMesh() {
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.group.rotation.y = this.yaw; // models are built facing +z = travel direction
    if (this.medium === 'water') {
      this.group.rotation.x = -(this._pitch || 0) * 0.6;
    }

    // walk animation
    const moving = Math.hypot(this.vel.x, this.vel.z) > 0.4;
    const swing = moving ? Math.sin(this._anim * 9) * 0.5 : 0;
    const legs = this.group.userData.legs || [];
    legs.forEach((l, i) => { l.rotation.x = swing * (i % 2 === 0 ? 1 : -1); });

    // hurt flash
    const flash = this._hurtT > 0;
    for (const [mesh, base] of this._baseMats) {
      mesh.material = flash ? HURT_MAT : base;
    }
  }

  addTo(scene) { scene.add(this.group); }
  removeFrom(scene) { scene.remove(this.group); }
}

const HURT_MAT = new THREE.MeshLambertMaterial({ color: 0xff6666 });
