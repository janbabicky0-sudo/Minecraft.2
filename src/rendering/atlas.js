import * as THREE from 'three';

// Loads the generated atlas.png + atlas.json and exposes UV helpers.
export async function loadAtlas() {
  const meta = await fetch('textures/atlas.json').then((r) => r.json());

  const texture = await new Promise((resolve, reject) => {
    new THREE.TextureLoader().load('textures/atlas.png', resolve, undefined, reject);
  });
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 1;
  texture.needsUpdate = true;

  const { tile, cols, width, height, map } = meta;
  const inset = 0.25 / width; // sub-texel inset to kill seams

  // returns [u0, v0, u1, v1] for a tile name
  function uv(name) {
    const i = map[name];
    if (i == null) return [0, 0, 1, 1];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const u0 = (col * tile) / width + inset;
    const u1 = ((col + 1) * tile) / width - inset;
    // atlas.png rows go top->down; three UV origin is bottom-left
    const v1 = 1 - (row * tile) / height - inset;
    const v0 = 1 - ((row + 1) * tile) / height + inset;
    return [u0, v0, u1, v1];
  }

  return { texture, meta, uv };
}
