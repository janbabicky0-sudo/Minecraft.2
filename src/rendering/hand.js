import * as THREE from 'three';
import { isItem } from '../constants.js';
import { itemTile } from '../registry/items.js';
import { faceTile } from '../registry/blocks.js';

// First-person held item / arm, rendered in a small overlay scene so it never
// clips into the world.
export class HandView {
  constructor(renderer, atlas) {
    this.renderer = renderer;
    this.atlas = atlas;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
    this.camera.position.set(0, 0, 1);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const d = new THREE.DirectionalLight(0xffffff, 0.9);
    d.position.set(-1, 2, 2);
    this.scene.add(d);

    this.pivot = new THREE.Group();
    this.pivot.position.set(0.55, -0.5, -0.9);
    this.scene.add(this.pivot);

    // bare arm (blocky)
    this.arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.24, 0.7),
      new THREE.MeshLambertMaterial({ color: 0xe0ac82 })
    );
    this.arm.rotation.x = -0.5;
    this.arm.position.set(0.05, -0.1, 0.15);

    this.blockMesh = null;
    this.itemMesh = null;

    this._t = 0;
    this._swing = 0;
    this._curKey = null;

    this.setHeld(null);
  }

  _makeBlockMesh(id) {
    const mats = ['px', 'nx', 'py', 'ny', 'pz', 'nz'].map((dir) => {
      const [u0, v0, u1, v1] = this.atlas.uv(faceTile(id, dir));
      const tex = this.atlas.texture.clone();
      tex.needsUpdate = true;
      tex.offset.set(u0, v0);
      tex.repeat.set(u1 - u0, v1 - v0);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      return new THREE.MeshLambertMaterial({ map: tex });
    });
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), mats);
    m.position.set(0, 0, 0);
    m.rotation.set(-0.15, -0.5, 0);
    return m;
  }

  _makeItemMesh(id) {
    const name = itemTile(id);
    const [u0, v0, u1, v1] = this.atlas.uv(name);
    const tex = this.atlas.texture.clone();
    tex.needsUpdate = true;
    tex.offset.set(u0, v0);
    tex.repeat.set(u1 - u0, v1 - v0);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.5),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide })
    );
    m.rotation.set(0, 0, Math.PI / 4);
    m.position.set(0, 0, 0.1);
    return m;
  }

  setHeld(stack) {
    const key = stack ? stack.id : 'hand';
    if (key === this._curKey) return;
    this._curKey = key;

    this.pivot.clear();
    this.blockMesh = this.itemMesh = null;

    if (!stack) {
      this.pivot.add(this.arm);
      return;
    }
    if (isItem(stack.id)) {
      this.itemMesh = this._makeItemMesh(stack.id);
      this.pivot.add(this.itemMesh);
    } else {
      this.blockMesh = this._makeBlockMesh(stack.id);
      this.pivot.add(this.blockMesh);
    }
  }

  swing() {
    this._swing = 1;
  }

  update(dt, moving, speed) {
    this._t += dt;
    // idle / walk bob
    const bob = moving ? Math.sin(this._t * 10) * 0.03 * Math.min(1, speed / 5) : 0;
    const sway = moving ? Math.cos(this._t * 5) * 0.02 : 0;
    this.pivot.position.y = -0.5 + bob;
    this.pivot.position.x = 0.55 + sway;

    if (this._swing > 0) {
      this._swing = Math.max(0, this._swing - dt * 5);
      const s = Math.sin((1 - this._swing) * Math.PI);
      this.pivot.rotation.x = -s * 1.2;
      this.pivot.rotation.z = s * 0.35;
    } else {
      this.pivot.rotation.x *= 0.8;
      this.pivot.rotation.z *= 0.8;
    }
  }

  render(renderer, w, h) {
    // draw ON TOP of the already-rendered world: never clear the colour buffer here
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setViewport(0, 0, w, h);
    renderer.clearDepth();
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = prevAutoClear;
  }
}
