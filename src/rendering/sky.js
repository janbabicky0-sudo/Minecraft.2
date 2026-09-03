import * as THREE from 'three';
import { DAY_LENGTH } from '../constants.js';

const COL = {
  dayTop: new THREE.Color(0x4a90d9),
  dayHorizon: new THREE.Color(0xafd3ef),
  duskTop: new THREE.Color(0x2a2a5e),
  duskHorizon: new THREE.Color(0xe8894b),
  nightTop: new THREE.Color(0x05070f),
  nightHorizon: new THREE.Color(0x0b1636),
};

const tmp = new THREE.Color();
function mix3(a, b, c, t) {
  // t in 0..1 across a->b->c
  if (t < 0.5) return tmp.copy(a).lerp(b, t * 2).clone();
  return tmp.copy(b).lerp(c, (t - 0.5) * 2).clone();
}

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene;
    this.time = DAY_LENGTH * 0.36; // start mid-morning, bright

    // gradient dome
    const domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(COL.dayTop) },
        bottomColor: { value: new THREE.Color(COL.dayHorizon) },
        offset: { value: 0 },
        exponent: { value: 0.7 },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPosition = wp.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
          float t = pow(clamp(h, 0.0, 1.0), exponent);
          gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(800, 24, 16), domeMat);
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    // stars
    const starGeo = new THREE.BufferGeometry();
    const N = 900;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(600);
      if (v.y < 30) v.y = Math.abs(v.y) + 30;
      pos.set([v.x, v.y, v.z], i * 3);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false,
    }));
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    // sun & moon sprites
    this.sun = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshBasicMaterial({ color: 0xfff2c0, fog: false, depthWrite: false, transparent: true })
    );
    this.moon = new THREE.Mesh(
      new THREE.PlaneGeometry(42, 42),
      new THREE.MeshBasicMaterial({ color: 0xdfe6f2, fog: false, depthWrite: false, transparent: true })
    );
    this.sun.frustumCulled = false;
    this.moon.frustumCulled = false;
    scene.add(this.sun, this.moon);

    // lights
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.4);
    this.sunLight.position.set(50, 120, 20);
    scene.add(this.sunLight);
    this.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x6b5535, 0.9);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.18);
    scene.add(this.ambient);

    // fog (colour updated per frame)
    scene.fog = new THREE.Fog(COL.dayHorizon.getHex(), 40, 180);

    this._phaseLabel = 'den';
  }

  setFogDistance(near, far) {
    this._fogNear = near;
    this._fogFar = far;
  }

  // 0 night .. 1 full day
  get daylight() {
    const a = (this.time / DAY_LENGTH) * Math.PI * 2;
    return THREE.MathUtils.clamp(Math.sin(a - Math.PI / 2) * 0.5 + 0.5, 0, 1);
  }

  update(dt, camera) {
    this.time = (this.time + dt) % DAY_LENGTH;
    const frac = this.time / DAY_LENGTH; // 0..1, 0 = midnight
    const angle = frac * Math.PI * 2 - Math.PI / 2; // sun angle over the sky

    const sunDir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0.15).normalize();
    const elev = sunDir.y; // -1..1

    // ---- colour phase ----
    // t: 0 deep night -> 0.5 golden -> 1 midday, mirrored for evening
    let dayT = THREE.MathUtils.clamp(elev * 1.6 + 0.15, 0, 1);
    const golden = THREE.MathUtils.clamp(1 - Math.abs(elev) * 4, 0, 1); // near horizon

    const top = mix3(COL.nightTop, COL.duskTop, COL.dayTop, dayT);
    const horizon = mix3(COL.nightHorizon, COL.duskHorizon, COL.dayHorizon, dayT);
    if (golden > 0 && elev > -0.25) horizon.lerp(COL.duskHorizon, golden * 0.6);

    this.dome.material.uniforms.topColor.value.copy(top);
    this.dome.material.uniforms.bottomColor.value.copy(horizon);

    this.scene.fog.color.copy(horizon);
    if (this._fogNear != null) {
      this.scene.fog.near = this._fogNear;
      this.scene.fog.far = this._fogFar;
    }
    this.scene.background = horizon;

    // ---- lights ----
    const d = THREE.MathUtils.clamp(elev * 1.4 + 0.05, 0, 1);
    this.sunLight.position.copy(sunDir).multiplyScalar(200).add(camera.position);
    this.sunLight.target.position.copy(camera.position);
    this.sunLight.target.updateMatrixWorld();
    this.sunLight.intensity = d * 1.5 + (elev < 0 ? 0 : 0);
    this.sunLight.color.setHex(golden > 0.3 && elev > 0 ? 0xffd8a8 : 0xffffff);
    if (elev <= 0) {
      // moonlight
      this.sunLight.position.copy(sunDir).multiplyScalar(-200).add(camera.position);
      this.sunLight.intensity = 0.16;
      this.sunLight.color.setHex(0x8fa6d8);
    }

    this.hemi.intensity = 0.35 + d * 0.75;
    this.hemi.color.copy(horizon).lerp(new THREE.Color(0xffffff), 0.4);
    this.hemi.groundColor.setHex(0x5a4a34);
    this.ambient.intensity = 0.12 + d * 0.18;

    // ---- celestial bodies ----
    this.sun.position.copy(camera.position).add(sunDir.clone().multiplyScalar(500));
    this.sun.lookAt(camera.position);
    this.sun.material.opacity = THREE.MathUtils.clamp(elev * 3, 0, 1);

    const moonDir = sunDir.clone().negate();
    this.moon.position.copy(camera.position).add(moonDir.multiplyScalar(500));
    this.moon.lookAt(camera.position);
    this.moon.material.opacity = THREE.MathUtils.clamp(-elev * 3, 0, 1);

    this.stars.material.opacity = THREE.MathUtils.clamp(-elev * 2.2 + 0.15, 0, 1) * 0.9;
    this.stars.position.copy(camera.position);
    this.stars.rotation.z = frac * Math.PI * 2;
    this.dome.position.copy(camera.position);

    // label
    if (elev > 0.25) this._phaseLabel = 'den';
    else if (elev > -0.05) this._phaseLabel = golden > 0.2 ? 'soumrak' : 'úsvit';
    else this._phaseLabel = 'noc';
  }

  get phaseLabel() { return this._phaseLabel; }

  clockString() {
    // map frac(0..1) to 24h with 0.25 = 06:00 sunrise... keep 0 = 00:00
    const h = (this.time / DAY_LENGTH) * 24;
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
}
