import * as THREE from 'three';
import { B, WORLD_H } from '../constants.js';
import { getBlock } from '../registry/blocks.js';

const WIDTH = 0.6;
const HEIGHT = 1.8;
const EYE = 1.62;
const EYE_CROUCH = 1.27;
const GRAVITY = 28;
const JUMP_SPEED = 8.6;
const WALK = 4.7;
const SPRINT = 7.1;
const SNEAK = 1.45;
const FLY = 11;
const FLY_SPRINT = 22;
const MAX_FALL = 60;

export class Player {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.pos = new THREE.Vector3(0.5, 80, 0.5); // feet position
    this.vel = new THREE.Vector3();
    this.onGround = false;
    this.flying = false;
    this.mode = 'survival'; // 'survival' | 'creative'
    this.yaw = 0;
    this.pitch = 0;

    this.health = 20;
    this.maxHealth = 20;
    this.hunger = 20;
    this.maxHunger = 20;
    this._foodTimer = 0;
    this._regenTimer = 0;
    this._starveTimer = 0;
    this._fallStart = null;
    this._inWaterPrev = false;
    this.dead = false;

    this.input = {
      forward: 0, right: 0, jump: false, sprint: false, up: 0, down: 0, sneak: false,
    };
    this._eye = EYE;
    this.sneaking = false;
  }

  spawnAt(x, z) {
    const s = this.world.findSpawn(Math.floor(x), Math.floor(z));
    this.pos.set(s.x + 0.5, s.y + 0.02, s.z + 0.5);
    this.vel.set(0, 0, 0);
    this.yaw = s.yaw ?? 0;
    this.pitch = -0.15;
    this.health = this.maxHealth;
    this.hunger = this.maxHunger;
    this.dead = false;
    this._fallStart = null;
    this._unstick();
  }

  get eyePosition() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this._eye, this.pos.z);
  }

  headInWater() {
    const p = this.eyePosition;
    return this.world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) === B.WATER;
  }

  feetInWater() {
    return this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.1), Math.floor(this.pos.z)) === B.WATER;
  }

  setMode(mode) {
    this.mode = mode === 'creative' ? 'creative' : 'survival';
    if (this.mode === 'survival') this.flying = false;
    else { this.health = this.maxHealth; this.hunger = this.maxHunger; }
  }

  toggleFly() {
    if (this.mode !== 'creative') return; // no flying in survival
    this.flying = !this.flying;
    this.vel.y = 0;
  }

  damage(amount) {
    if (this.mode === 'creative' || this.dead) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this.dead = true;
  }

  heal(a) { this.health = Math.min(this.maxHealth, this.health + a); }
  feed(a) { this.hunger = Math.min(this.maxHunger, this.hunger + a); }

  update(dt) {
    if (this.dead) return;
    dt = Math.min(dt, 0.05); // clamp big frame gaps

    const inWater = this.feetInWater();
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    // forward is -Z at yaw 0
    const fx = -sin, fz = -cos;
    const rx = cos, rz = -sin;

    // crouch: only on solid ground, not while flying / swimming
    this.sneaking = this.input.sneak && this.onGround && !this.flying && !inWater;
    const targetEye = this.sneaking ? EYE_CROUCH : EYE;
    this._eye += (targetEye - this._eye) * Math.min(1, dt * 14);

    let speed;
    if (this.flying) speed = this.input.sprint ? FLY_SPRINT : FLY;
    else if (this.sneaking) speed = SNEAK;
    else if (this.input.sprint && this.input.forward > 0) speed = SPRINT;
    else speed = WALK;
    if (inWater && !this.flying) speed *= 0.5;

    let wishX = fx * this.input.forward + rx * this.input.right;
    let wishZ = fz * this.input.forward + rz * this.input.right;
    const wl = Math.hypot(wishX, wishZ);
    if (wl > 0) { wishX /= wl; wishZ /= wl; }

    if (this.flying) {
      this.vel.x = wishX * speed;
      this.vel.z = wishZ * speed;
      const vy = (this.input.up - this.input.down) * speed;
      this.vel.y = vy;
      this._fallStart = null;
    } else {
      // horizontal accel toward wish velocity
      const accel = this.onGround ? 12 : 5;
      this.vel.x += (wishX * speed - this.vel.x) * Math.min(1, accel * dt);
      this.vel.z += (wishZ * speed - this.vel.z) * Math.min(1, accel * dt);

      if (inWater) {
        this.vel.y -= GRAVITY * 0.35 * dt;
        this.vel.y = Math.max(this.vel.y, -4);
        if (this.input.jump) this.vel.y = 4.2; // swim up
        this._fallStart = null;
      } else {
        this.vel.y -= GRAVITY * dt;
        this.vel.y = Math.max(this.vel.y, -MAX_FALL);
        if (this.input.jump && this.onGround) {
          this.vel.y = JUMP_SPEED;
          this.onGround = false;
          this._justJumped = true;
        }
      }
    }

    // fall-damage tracking
    if (!this.flying && !inWater) {
      if (this.vel.y < 0 && this._fallStart == null && !this.onGround) {
        this._fallStart = this.pos.y;
      }
    }

    const wasGround = this.onGround;
    this._moveSwept(dt);
    this._unstick();

    if (this.onGround && !wasGround && this._fallStart != null) {
      const fell = this._fallStart - this.pos.y;
      if (fell > 3.5) this.damage(Math.floor(fell - 3));
      this._fallStart = null;
    }
    if (this.onGround) this._fallStart = null;

    // fell out of the world
    if (this.pos.y < -20) {
      if (this.mode === 'creative') {
        const top = this.world.columnTop(Math.floor(this.pos.x), Math.floor(this.pos.z));
        this.pos.y = top + 2;
        this.vel.set(0, 0, 0);
      } else {
        this.damage(1000);
      }
    }

    this._survival(dt, inWater);

    // camera follows eye
    this.camera.position.copy(this.eyePosition);
    this.camera.rotation.set(0, 0, 0, 'YXZ');
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
  }

  _survival(dt, inWater) {
    if (this.mode === 'creative' || this.flying) return;

    // hunger drain — sprinting burns through it much faster
    const spd = Math.hypot(this.vel.x, this.vel.z);
    const sprinting = this.input.sprint && this.input.forward > 0 && spd > 2 && !this.sneaking;
    let rate;
    if (sprinting) rate = 4.4;
    else if (spd > 0.5) rate = this.sneaking ? 0.8 : 1.3;
    else rate = 0.35;
    if (this._justJumped && sprinting) this._foodTimer += 0.6; // sprint-jump costs extra
    this._justJumped = false;
    this._foodTimer += dt * rate;
    if (this._foodTimer > 8) {
      this._foodTimer = 0;
      this.hunger = Math.max(0, this.hunger - 1);
    }

    // regen when well fed
    if (this.health < this.maxHealth && this.hunger >= 16) {
      this._regenTimer += dt;
      if (this._regenTimer > 3.5) { this._regenTimer = 0; this.heal(1); this.hunger = Math.max(0, this.hunger - 1); }
    } else this._regenTimer = 0;

    // starve
    if (this.hunger <= 0) {
      this._starveTimer += dt;
      if (this._starveTimer > 4) { this._starveTimer = 0; this.damage(1); }
    } else this._starveTimer = 0;

    // drowning
    if (this.headInWater()) {
      this._breath = (this._breath ?? 12) - dt;
      if (this._breath < 0) { this._breath = -2; this.damage(1); }
    } else this._breath = 12;
  }

  // move the whole velocity for this frame, sub-stepped so we never tunnel,
  // resolving one axis at a time.
  _moveSwept(dt) {
    const dx = this.vel.x * dt, dy = this.vel.y * dt, dz = this.vel.z * dt;
    const maxStep = 0.2;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / maxStep));
    const edgeGuard = this.sneaking && this.onGround;
    this.onGround = false;
    for (let i = 0; i < steps; i++) {
      const bx = this.pos.x, bz = this.pos.z;
      this._moveAxis('x', dx / steps);
      if (edgeGuard && !this._groundUnder()) { this.pos.x = bx; this.vel.x = 0; }
      this._moveAxis('z', dz / steps);
      if (edgeGuard && !this._groundUnder()) { this.pos.z = bz; this.vel.z = 0; }
      this._moveAxis('y', dy / steps);
    }
  }

  // is there a solid block just below any part of the player's footprint?
  _groundUnder() {
    const p = this.pos, hw = WIDTH / 2, y = Math.floor(p.y - 0.05);
    for (let z = Math.floor(p.z - hw + 1e-3); z <= Math.floor(p.z + hw - 1e-3); z++)
      for (let x = Math.floor(p.x - hw + 1e-3); x <= Math.floor(p.x + hw - 1e-3); x++)
        if (this._solid(x, y, z)) return true;
    return false;
  }

  // move one axis by `amount`, then clamp out of any solid it now overlaps
  _moveAxis(axis, amount) {
    if (amount === 0) return;
    const p = this.pos;
    const hw = WIDTH / 2;
    p[axis] += amount;

    const x0 = Math.floor(p.x - hw + 1e-4), x1 = Math.floor(p.x + hw - 1e-4);
    const y0 = Math.floor(p.y + 1e-4), y1 = Math.floor(p.y + HEIGHT - 1e-4);
    const z0 = Math.floor(p.z - hw + 1e-4), z1 = Math.floor(p.z + hw - 1e-4);

    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (!this._solid(x, y, z)) continue;
          if (axis === 'x') {
            p.x = amount > 0 ? x - hw - 1e-3 : x + 1 + hw + 1e-3;
            this.vel.x = 0;
          } else if (axis === 'z') {
            p.z = amount > 0 ? z - hw - 1e-3 : z + 1 + hw + 1e-3;
            this.vel.z = 0;
          } else if (amount > 0) {
            p.y = y - HEIGHT - 1e-3;
            this.vel.y = 0;
          } else {
            p.y = y + 1 + 1e-3;
            this.vel.y = 0;
            this.onGround = true;
          }
          return;
        }
      }
    }
  }

  // if we somehow ended up embedded in a block (block placed on us, spawn in
  // terrain, edge case), lift straight up until free.
  _unstick() {
    for (let n = 0; n < 6 && this._overlapsSolid(); n++) {
      this.pos.y += 1;
      this.vel.y = 0;
    }
  }

  _overlapsSolid() {
    const p = this.pos, hw = WIDTH / 2;
    const x0 = Math.floor(p.x - hw + 1e-4), x1 = Math.floor(p.x + hw - 1e-4);
    const y0 = Math.floor(p.y + 1e-4), y1 = Math.floor(p.y + HEIGHT - 1e-4);
    const z0 = Math.floor(p.z - hw + 1e-4), z1 = Math.floor(p.z + hw - 1e-4);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++)
          if (this._solid(x, y, z)) return true;
    return false;
  }

  _solid(x, y, z) {
    if (y < 0 || y >= WORLD_H) return y < 0;
    const id = this.world.getBlock(x, y, z);
    if (id === B.AIR) return false;
    const b = getBlock(id);
    return b.solid && !b.liquid;
  }
}

export { WIDTH as PLAYER_WIDTH, HEIGHT as PLAYER_HEIGHT, EYE as PLAYER_EYE };
