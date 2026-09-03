import * as THREE from 'three';
import { B, I, WORLD_H } from '../constants.js';
import { getBlock } from '../registry/blocks.js';
import { toolOf, isPlaceable } from '../registry/items.js';
import { PLAYER_WIDTH, PLAYER_HEIGHT } from './player.js';

const REACH = 5.2;

// Amanatides & Woo voxel traversal. Returns { block:{x,y,z}, place:{x,y,z}, normal } or null.
export function raycastVoxel(world, origin, dir, maxDist = REACH) {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = Math.sign(dir.x) || 1;
  const stepY = Math.sign(dir.y) || 1;
  const stepZ = Math.sign(dir.z) || 1;

  const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;

  const fracX = dir.x > 0 ? (x + 1 - origin.x) : (origin.x - x);
  const fracY = dir.y > 0 ? (y + 1 - origin.y) : (origin.y - y);
  const fracZ = dir.z > 0 ? (z + 1 - origin.z) : (origin.z - z);

  let tMaxX = dir.x !== 0 ? tDeltaX * fracX : Infinity;
  let tMaxY = dir.y !== 0 ? tDeltaY * fracY : Infinity;
  let tMaxZ = dir.z !== 0 ? tDeltaZ * fracZ : Infinity;

  let nx = 0, ny = 0, nz = 0;
  let t = 0;

  for (let i = 0; i < 256; i++) {
    if (y >= 0 && y < WORLD_H) {
      const id = world.getBlock(x, y, z);
      if (id !== B.AIR && id !== B.WATER) {
        return {
          block: { x, y, z },
          place: { x: x + nx, y: y + ny, z: z + nz },
          normal: { x: nx, y: ny, z: nz },
          id,
        };
      }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
    }
    if (t > maxDist) return null;
  }
  return null;
}

export function breakSeconds(blockId, heldId) {
  const b = getBlock(blockId);
  if (!isFinite(b.hardness)) return Infinity;
  let t = b.hardness;
  const tool = toolOf(heldId);
  if (tool && tool.type === b.tool) t /= tool.speed;
  return Math.max(0.05, t);
}

export function canHarvest(blockId, heldId) {
  const b = getBlock(blockId);
  if (b.reqTier === 0) return true;
  const tool = toolOf(heldId);
  const tier = tool && tool.type === b.tool ? tool.tier : 0;
  return tier >= b.reqTier;
}

export class Interaction {
  constructor({ scene, world, player, inventory, hud, onOpenTable, itemDrops }) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.inventory = inventory;
    this.hud = hud;
    this.onOpenTable = onOpenTable;
    this.itemDrops = itemDrops;

    this.target = null;
    this.mining = false;
    this.progress = 0;
    this._placeCooldown = 0;

    // selection outline
    const geo = new THREE.BoxGeometry(1.001, 1.001, 1.001);
    this.outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })
    );
    this.outline.visible = false;
    this.outline.renderOrder = 5;
    scene.add(this.outline);

    // crack overlay
    this.crack = new THREE.Mesh(
      new THREE.BoxGeometry(1.02, 1.02, 1.02),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false })
    );
    this.crack.visible = false;
    scene.add(this.crack);
  }

  startMine() {
    this.mining = true;
  }
  stopMine() {
    this.mining = false;
    this.progress = 0;
  }

  _dir() {
    return this.player.camera.getWorldDirection(new THREE.Vector3()).normalize();
  }

  update(dt) {
    const origin = this.player.eyePosition;
    const hit = raycastVoxel(this.world, origin, this._dir());
    const prevKey = this.target ? `${this.target.block.x},${this.target.block.y},${this.target.block.z}` : null;
    this.target = hit;

    if (hit) {
      this.outline.visible = true;
      this.outline.position.set(hit.block.x + 0.5, hit.block.y + 0.5, hit.block.z + 0.5);
      const key = `${hit.block.x},${hit.block.y},${hit.block.z}`;
      if (key !== prevKey) this.progress = 0;
    } else {
      this.outline.visible = false;
      this.progress = 0;
    }

    this._placeCooldown = Math.max(0, this._placeCooldown - dt);

    if (this.mining && hit) {
      const held = this.inventory.activeItem();
      const creative = this.player.mode === 'creative';
      const total = creative ? 0.001 : breakSeconds(hit.id, held?.id);
      if (!isFinite(total)) { this.progress = 0; }
      else {
        this.progress += dt / total;
        if (this.progress >= 1 || creative) {
          this._break(hit);
          this.progress = 0;
        }
      }
    }

    // crack visual
    if (hit && this.progress > 0) {
      this.crack.visible = true;
      this.crack.position.copy(this.outline.position);
      this.crack.material.opacity = this.progress * 0.55;
      const s = 1 - this.progress * 0.06;
      this.crack.scale.setScalar(s);
    } else {
      this.crack.visible = false;
    }
  }

  _break(hit) {
    const id = hit.id;
    const b = getBlock(id);
    const held = this.inventory.activeItem();

    this.world.setBlock(hit.block.x, hit.block.y, hit.block.z, B.AIR);
    this.hud?.flashHand?.();

    if (this.player.mode === 'creative') return; // no drops in creative

    // drops
    if (canHarvest(id, held?.id)) {
      let drops = [];
      if (id === B.LEAVES) {
        if (Math.random() < 0.06) drops.push(I.APPLE);
        if (Math.random() < 0.5) drops.push(I.STICK);
        if (Math.random() < 0.04) drops.push(B.LEAVES); // sapling-ish keepsake
      } else if (Array.isArray(b.drop)) {
        drops = b.drop.flatMap((d) => Array(d.count || 1).fill(d.id));
      } else if (b.drop != null) {
        drops = [b.drop];
      } else {
        drops = [id];
      }
      const cx = hit.block.x + 0.5, cy = hit.block.y + 0.5, cz = hit.block.z + 0.5;
      for (const d of drops) if (d) this.itemDrops.spawn(d, cx, cy, cz);
    }
  }

  place() {
    if (this._placeCooldown > 0) return;
    const hit = this.target;
    if (!hit) return;

    // right-click crafting table -> open 3x3 crafting
    if (hit.id === B.CRAFTING_TABLE) {
      this.onOpenTable?.();
      this._placeCooldown = 0.25;
      return;
    }

    const held = this.inventory.activeItem();
    if (!held) return;
    if (!isPlaceable(held.id)) return;

    const px = hit.place.x, py = hit.place.y, pz = hit.place.z;
    if (py < 1 || py >= WORLD_H) return;
    if (this.world.getBlock(px, py, pz) !== B.AIR) return;
    if (this._intersectsPlayer(px, py, pz)) return;

    this.world.setBlock(px, py, pz, held.id);
    if (this.player.mode !== 'creative') this.inventory.consumeActive(1);
    this._placeCooldown = 0.18;
  }

  pick() {
    const hit = this.target;
    if (!hit) return;
    this.inventory.pickBlock(hit.id);
  }

  _intersectsPlayer(x, y, z) {
    const p = this.player.pos;
    const minX = p.x - PLAYER_WIDTH / 2, maxX = p.x + PLAYER_WIDTH / 2;
    const minY = p.y, maxY = p.y + PLAYER_HEIGHT;
    const minZ = p.z - PLAYER_WIDTH / 2, maxZ = p.z + PLAYER_WIDTH / 2;
    return maxX > x && minX < x + 1 && maxY > y && minY < y + 1 && maxZ > z && minZ < z + 1;
  }
}
