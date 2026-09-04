import * as THREE from 'three';

// Blocky MC-style mob models built from boxes + per-mob stats.
// Every model is a THREE.Group; legs are tagged for the walk animation.

const MAT_CACHE = new Map();
function mat(hex) {
  let m = MAT_CACHE.get(hex);
  if (!m) { m = new THREE.MeshLambertMaterial({ color: hex }); MAT_CACHE.set(hex, m); }
  return m;
}
function box(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  return m;
}

// ---- models -------------------------------------------------------------
function cowModel() {
  const g = new THREE.Group();
  const brown = 0x4a3826, dark = 0x2b2016, white = 0xd8cdbd, pink = 0xd98c8c;
  g.add(box(0.9, 0.8, 1.5, brown, 0, 0.9, 0));                // body
  const head = box(0.65, 0.6, 0.6, dark, 0, 1.15, 1.0);
  head.add(box(0.14, 0.14, 0.14, white, 0.28, 0.14, 0.1));    // horn
  head.add(box(0.14, 0.14, 0.14, white, -0.28, 0.14, 0.1));
  head.add(box(0.4, 0.28, 0.14, pink, 0, -0.16, 0.32));       // snout
  g.add(head);
  g.add(box(0.5, 0.22, 0.5, pink, 0, 0.45, -0.2));            // udder
  const legs = [];
  for (const [sx, sz] of [[0.3, 0.5], [-0.3, 0.5], [0.3, -0.5], [-0.3, -0.5]]) {
    const l = box(0.26, 0.7, 0.26, dark, sx, 0.35, sz);
    l.userData.leg = true; l.userData.baseY = 0.35;
    g.add(l); legs.push(l);
  }
  g.userData.legs = legs;
  return g;
}

function sheepModel() {
  const g = new THREE.Group();
  const wool = 0xe8e6e0, skin = 0xd7b9a3;
  g.add(box(0.95, 0.95, 1.2, wool, 0, 0.95, 0));              // fluffy body
  g.add(box(0.5, 0.55, 0.5, skin, 0, 1.05, 0.8));             // head
  const legs = [];
  for (const [sx, sz] of [[0.3, 0.4], [-0.3, 0.4], [0.3, -0.4], [-0.3, -0.4]]) {
    const l = box(0.2, 0.6, 0.2, skin, sx, 0.3, sz);
    l.userData.leg = true; l.userData.baseY = 0.3;
    g.add(l); legs.push(l);
  }
  g.userData.legs = legs;
  return g;
}

function chickenModel() {
  const g = new THREE.Group();
  const white = 0xf2f2f2, beak = 0xe0a020, red = 0xd83a2a, feet = 0xe0a020;
  g.add(box(0.42, 0.5, 0.5, white, 0, 0.5, 0));               // body
  const head = box(0.3, 0.3, 0.3, white, 0, 0.85, 0.22);
  head.add(box(0.12, 0.1, 0.16, beak, 0, -0.02, 0.2));        // beak
  head.add(box(0.16, 0.14, 0.06, red, 0, 0.18, 0.02));        // comb
  head.add(box(0.1, 0.14, 0.06, red, 0, -0.16, 0.08));        // wattle
  g.add(head);
  g.add(box(0.08, 0.35, 0.5, white, 0.25, 0.5, 0));           // wing
  g.add(box(0.08, 0.35, 0.5, white, -0.25, 0.5, 0));
  const legs = [];
  for (const sx of [0.12, -0.12]) {
    const l = box(0.1, 0.35, 0.1, feet, sx, 0.18, 0);
    l.userData.leg = true; l.userData.baseY = 0.18;
    g.add(l); legs.push(l);
  }
  g.userData.legs = legs;
  return g;
}

function fishModel() {
  const g = new THREE.Group();
  const body = 0x4f8fb0, belly = 0xd8b45a;
  g.add(box(0.3, 0.32, 0.7, body, 0, 0, 0));
  g.add(box(0.1, 0.28, 0.3, body, 0, 0, -0.45));              // tail
  g.add(box(0.32, 0.06, 0.24, body, 0, 0.2, 0.05));           // top fin
  g.add(box(0.3, 0.12, 0.5, belly, 0, -0.12, 0));             // belly stripe
  g.userData.legs = [];
  return g;
}

function horseModel() {
  const g = new THREE.Group();
  const brown = 0x6a4a2c, dark = 0x3a2818, mane = 0x2b1d10;
  g.add(box(0.7, 0.9, 1.7, brown, 0, 1.25, 0));               // body
  const neck = box(0.4, 0.9, 0.4, brown, 0, 1.8, 0.8);
  neck.rotation.x = -0.5;
  neck.add(box(0.42, 0.9, 0.12, mane, 0, 0, -0.22));          // mane
  const head = box(0.36, 0.45, 0.8, dark, 0, 0.55, 0.35);
  head.rotation.x = 0.5;
  neck.add(head);
  g.add(neck);
  g.add(box(0.16, 0.7, 0.14, mane, 0, 1.25, -0.95));          // tail
  const legs = [];
  for (const [sx, sz] of [[0.24, 0.55], [-0.24, 0.55], [0.24, -0.55], [-0.24, -0.55]]) {
    const l = box(0.22, 1.0, 0.22, dark, sx, 0.5, sz);
    l.userData.leg = true; l.userData.baseY = 0.5;
    g.add(l); legs.push(l);
  }
  g.userData.legs = legs;
  return g;
}

// ---- registry ---------------------------------------------------------
export const MOBS = {
  cow: {
    name: 'Kráva', model: cowModel, w: 0.9, h: 1.7, health: 10,
    speed: 1.7, medium: 'land', wanderChance: 0.006, dropHint: 'hovězí',
  },
  sheep: {
    name: 'Ovce', model: sheepModel, w: 0.9, h: 1.5, health: 8,
    speed: 1.5, medium: 'land', wanderChance: 0.006, dropHint: 'vlna',
  },
  chicken: {
    name: 'Slepice', model: chickenModel, w: 0.5, h: 0.9, health: 4,
    speed: 1.3, medium: 'land', wanderChance: 0.01, gravityScale: 0.35, dropHint: 'pírko',
  },
  fish: {
    name: 'Ryba', model: fishModel, w: 0.5, h: 0.5, health: 3,
    speed: 2.2, medium: 'water', wanderChance: 0.02, dropHint: 'ryba',
  },
  horse: {
    name: 'Kůň', model: horseModel, w: 0.9, h: 2.0, health: 15,
    speed: 2.6, medium: 'land', wanderChance: 0.004, dropHint: 'kůže',
  },
};

export const LAND_MOBS = ['cow', 'sheep', 'chicken', 'horse'];
export const WATER_MOBS = ['fish'];
