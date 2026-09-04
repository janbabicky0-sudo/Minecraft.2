import * as THREE from 'three';
import {
  DEFAULT_RENDER_DISTANCE, MIN_RENDER_DISTANCE, MAX_RENDER_DISTANCE,
  CHUNK_SX, CHUNK_SZ, DAY_LENGTH, isItem, B, I,
} from './constants.js';
import { initTerrain, biomeAt, BIOME_INFO, heightAt } from './world/terrain.js';
import { loadAtlas } from './rendering/atlas.js';
import { World } from './world/world.js';
import { ItemDrops } from './world/drops.js';
import { MobManager } from './entities/mobManager.js';
import { Sky } from './rendering/sky.js';
import { HandView } from './rendering/hand.js';
import { Player } from './player/player.js';
import { Controls } from './player/controls.js';
import { Interaction } from './player/interaction.js';
import { Inventory } from './ui/inventory.js';
import { HUD } from './ui/hud.js';
import { PauseMenu } from './ui/pause.js';
import { itemName } from './registry/items.js';
import { getBlock } from './registry/blocks.js';
import { loadSave, writeSave, clearSave, getSeed, newSeed, makeAutoSaver } from './save.js';

const canvas = document.getElementById('game');
const overlays = {
  start: document.getElementById('start'),
  loading: document.getElementById('loading'),
  loadFill: document.getElementById('load-fill'),
  startNote: document.getElementById('start-note'),
};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.autoClear = false; // we clear explicitly so the hand overlay never wipes the world
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.06, 1000);

// Minecraft-style "Hor+" FOV: horizontal field of view stays constant, the
// vertical FOV is derived from the aspect ratio (wide screens see more sideways,
// not a stretched / fish-eyed view).
const BASE_VFOV = 70;              // vertical FOV at 4:3
const REF_ASPECT = 4 / 3;
const H_FOV = 2 * Math.atan(Math.tan((BASE_VFOV * Math.PI) / 360) * REF_ASPECT);
function fovForAspect(aspect) {
  if (!Number.isFinite(aspect) || aspect <= 0) aspect = 16 / 9;
  if (aspect <= REF_ASPECT) return BASE_VFOV;
  const v = 2 * Math.atan(Math.tan(H_FOV / 2) / aspect);
  return THREE.MathUtils.clamp((v * 180) / Math.PI, 45, 80);
}

let world, sky, player, controls, interaction, inventory, hud, pause, hand, itemDrops, mobs;
let headlamp;
let headlampOn = false;
let atlas;
let renderDistance = DEFAULT_RENDER_DISTANCE;
let state = 'start'; // start | loading | playing | paused | inventory
let running = false;
let autosaver;
let seed = getSeed();

const clock = new THREE.Clock();

// ------------------------------------------------------------------ boot
async function boot() {
  atlas = await loadAtlas();

  const save = loadSave();
  if (save?.renderDistance) renderDistance = clampR(save.renderDistance);

  hud = new HUD();
  inventory = new Inventory(atlas, {
    onChange: () => { hand?.setHeld(inventory.activeItem()); autosaver?.markDirty(); },
    getHasTable: () => nearCraftingTable(),
  });
  hand = new HandView(renderer, atlas);

  const btnContinue = document.getElementById('btn-continue');
  if (save) {
    btnContinue.classList.remove('hidden');
    const modeLabel = save.mode === 'creative' ? 'Kreativní' : 'Přežití';
    btnContinue.textContent = `Pokračovat (${modeLabel})`;
    btnContinue.onclick = () => startGame(save, save.mode || 'survival');
    overlays.startNote.textContent = 'Nová hra přepíše uložený svět.';
  } else {
    overlays.startNote.textContent = 'Přežití: hlad, poškození, žádné létání · Kreativní: létání, nezničitelnost, bloky zdarma.';
  }
  document.getElementById('btn-survival').onclick = () => startGame(null, 'survival');
  document.getElementById('btn-creative').onclick = () => startGame(null, 'creative');

  window.addEventListener('resize', onResize);
  onResize();

  rollSplash();
  setInterval(() => { if (state === 'start') rollSplash(); }, 4200);
  document.getElementById('splash')?.addEventListener('click', rollSplash);

  renderLoop();
  buildMenuScene(); // non-blocking: panorama pops in when ready
}

function clampR(d) {
  return Math.max(MIN_RENDER_DISTANCE, Math.min(MAX_RENDER_DISTANCE, d));
}

// ---------------------------------------------------------------- menu panorama
let menuActive = false;
let menuFocus = new THREE.Vector3(8, 60, 8);

async function buildMenuScene() {
  initTerrain('voxelcraft-title-panorama');
  sky = new Sky(scene, renderer);
  sky.time = DAY_LENGTH * 0.37;
  world = new World(scene, atlas, { renderDistance: 3, savedEdits: {}, onEdit: () => {} });
  const c = new THREE.Vector3(8, 64, 8);
  for (let i = 0; i < 90 && state === 'start'; i++) {
    world.update(c, 24);
    if (i % 8 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  if (state !== 'start') return;
  const gy = world.columnTop(8, 8);
  menuFocus.set(8, gy + 3, 8);
  menuActive = true;
  if (import.meta.env.DEV) {
    window.__menu = { get menuActive() { return menuActive; }, menuFocus, get world() { return world; }, get sky() { return sky; }, scene, camera, renderer, gy };
  }
}

const SPLASHES = [
  'Ahoj světe!', '100% vlastní voxely!', 'Bez Mojangu, s láskou!', 'Kostičky, kam se podíváš!',
  'Vyrobeno z Three.js a odhodlání', 'Také vyzkoušej… tohle!', 'Svět nemá konec',
  'localStorage tvůj svět ochrání', 'Ambient occlusion zdarma!', 'Perlin? Ne, Simplex!',
  'Těž zodpovědně', 'Dřevo → prkna → celý dům', 'Voda je mokrá', 'Diamanty jsou dole. Fakt dole.',
  'Bedrock je věčný', 'Noc přijde. Vždycky.', 'Skákej opatrně', 'Kreativní = žádný strach',
  'Běží v prohlížeči', 'Kdo potřebuje backend', 'Stromy rostou přes hranice chunků',
  'Nezapomeň dýchat… počkat', 'Kaktusy pícháj', 'Jeden merged mesh na chunk',
];
function rollSplash() {
  const el = document.getElementById('splash');
  if (el) el.textContent = SPLASHES[(Math.random() * SPLASHES.length) | 0];
}

const TIPS = [
  'Tip: dvojité ťuknutí mezerníku zapne létání (kreativní režim).',
  'Tip: prostřední tlačítko myši zkopíruje blok, na který se díváš.',
  'Tip: kámen bez krumpáče nic nepustí.',
  'Tip: F zapne čelovku do jeskyní a na noc.',
  'Tip: F3 ukáže souřadnice, biom a čas.',
  'Tip: dřevo rozbiješ i rukou, se sekerou rychleji.',
  'Tip: pravým klikem na pracovní stůl otevřeš mřížku 3×3.',
  'Tip: v pauze přepneš dohlednost i herní režim.',
  'Tip: z listí občas vypadne jablko nebo klacík.',
];

// ------------------------------------------------------------------ start
async function startGame(save, mode = 'survival') {
  if (!save) { clearSave(); seed = newSeed(); }
  overlays.start.classList.add('hidden');
  overlays.loading.classList.remove('hidden');
  state = 'loading';

  seed = save?.seed || getSeed();
  initTerrain(seed);

  // tear down the menu panorama
  menuActive = false;
  if (world) { for (const [, c] of world.chunks) c.dispose(scene); }
  scene.clear();
  const tip = document.getElementById('loading-tip');
  if (tip) tip.textContent = TIPS[(Math.random() * TIPS.length) | 0];

  sky = new Sky(scene, renderer);
  sky.time = save?.time ?? DAY_LENGTH * 0.34;

  world = new World(scene, atlas, {
    renderDistance,
    savedEdits: save?.edits || {},
    onEdit: () => autosaver?.markDirty(),
  });
  itemDrops = new ItemDrops(scene, atlas);
  mobs = new MobManager(scene, world);

  player = new Player(camera, world);
  player.setMode(save?.mode || mode);
  if (player.mode === 'creative') player.flying = true;
  headlamp = new THREE.PointLight(0xfff0d8, 0.0, 18, 1.6);
  camera.add(headlamp);
  scene.add(camera);
  headlamp.position.set(0, 0, 0);
  headlampOn = false;

  interaction = new Interaction({
    scene, world, player, inventory, hud, itemDrops, atlas, mobs,
    onOpenTable: () => { if (state === 'playing') openInventory(true); },
  });

  controls = new Controls(player, canvas, {
    onLock: () => { if (state === 'playing') {} },
    onUnlock: () => { if (state === 'playing') openPause(); },
    onHotbar: (i) => inventory.setActive(i),
    onScroll: (d) => inventory.scrollActive(d),
    onToggleInventory: () => toggleInventory(),
    onTogglePause: () => togglePause(),
    onToggleDebug: () => hud.toggleDebug(),
    onToggleHeadlamp: () => toggleHeadlamp(),
    onStartMine: () => { interaction.startMine(); hand.swing(); },
    onStopMine: () => interaction.stopMine(),
    onPlace: () => { interaction.place(); hand.swing(); },
    onPick: () => interaction.pick(),
  });

  pause = new PauseMenu({
    onResume: () => resumeFromPause(),
    onToggleFly: () => player.toggleFly(),
    onToggleMode: () => {
      player.setMode(player.mode === 'creative' ? 'survival' : 'creative');
      hud.setMode(player.mode);
      autosaver?.markDirty();
      pause.refresh();
    },
    onCycleRender: () => cycleRender(),
    onSave: () => doSave(),
    onReset: () => resetWorld(),
    getState: () => ({ flying: player.flying, renderDistance, mode: player.mode }),
  });
  hud.setMode(player.mode);

  autosaver = makeAutoSaver(collectSave, 4000);

  // restore player + inventory
  if (save?.player) {
    player.pos.set(save.player.x, save.player.y, save.player.z);
    player.yaw = save.player.yaw || 0;
    player.pitch = save.player.pitch || 0;
    player.health = save.player.health ?? 20;
    player.hunger = save.player.hunger ?? 20;
    player.flying = !!save.player.flying;
  }
  if (save?.inventory) inventory.load(save.inventory);
  else inventory.giveStarterKit(player.mode);

  // eat with a key
  window.addEventListener('keydown', (e) => {
    if (state === 'playing' && e.code === 'KeyQ') {
      const restored = inventory.eatActive();
      if (restored) player.feed(restored);
    }
  });

  // warm up chunks around spawn before dropping the player in.
  // driven by setInterval (keeps running even when the tab is backgrounded and
  // requestAnimationFrame is throttled).
  const sx = Math.floor(player.pos.x);
  const sz = Math.floor(player.pos.z);
  await new Promise((resolve) => {
    const started = performance.now();
    const iv = setInterval(() => {
      world.update(player.pos, 22);
      const elapsed = performance.now() - started;
      const ready = world.spawnReady(sx, sz);
      const pct = Math.min(99, Math.max(elapsed / 60, ready ? 100 : 0));
      overlays.loadFill.style.width = (ready ? 100 : pct) + '%';
      if ((ready && elapsed > 400) || elapsed > 20000) {
        clearInterval(iv);
        resolve();
      }
    }, 8);
  });

  if (!save?.player) {
    player.spawnAt(sx, sz);
  } else {
    // loaded a saved position — make sure we didn't end up buried
    player._unstick();
    if (player.pos.y < 1 || player._overlapsSolid()) {
      player.spawnAt(Math.floor(player.pos.x), Math.floor(player.pos.z));
    }
  }

  hand.setHeld(inventory.activeItem());
  mobs.seed(player.pos);

  overlays.loading.classList.add('hidden');
  hud.setVisible(true);
  state = 'playing';
  running = true;
  controls.requestLock();
  clock.getDelta();

  if (import.meta.env.DEV) {
    window.__game = { scene, camera, renderer, inventory, mobs, get world() { return world; }, get player() { return player; }, get sky() { return sky; } };
  }
}

function toggleHeadlamp() {
  headlampOn = !headlampOn;
  headlamp.intensity = headlampOn ? 1.1 : 0.0;
}

function nearCraftingTable() {
  if (!player) return false;
  const p = player.pos;
  const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
  for (let dy = -1; dy <= 2; dy++)
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++)
        if (world.getBlock(px + dx, py + dy, pz + dz) === B.CRAFTING_TABLE) return true;
  return false;
}

// ------------------------------------------------------------------ state transitions
function toggleInventory() {
  if (state === 'playing') openInventory();
  else if (state === 'inventory') closeInventory();
}
function openInventory(forceTable) {
  state = 'inventory';
  inventory.openInv(forceTable || nearCraftingTable());
  controls.exitLock();
  hud.setVisible(false);
}
function closeInventory() {
  inventory.close();
  state = 'playing';
  hud.setVisible(true);
  controls.requestLock();
}

function togglePause() {
  if (state === 'playing') openPause();
  else if (state === 'paused') resumeFromPause();
  else if (state === 'inventory') closeInventory();
}
function openPause() {
  if (state === 'paused') return;
  state = 'paused';
  pause.show();
  controls.exitLock();
  hud.setVisible(false);
  autosaver.flush();
}
function resumeFromPause() {
  pause.hide();
  state = 'playing';
  hud.setVisible(true);
  controls.requestLock();
  clock.getDelta();
}

function cycleRender() {
  renderDistance = renderDistance >= MAX_RENDER_DISTANCE ? MIN_RENDER_DISTANCE : renderDistance + 1;
  world.renderDistance = renderDistance;
  updateFog();
  autosaver.markDirty();
}

function updateFog() {
  const far = renderDistance * CHUNK_SX;
  sky.setFogDistance(Math.max(16, far - CHUNK_SX * 2.5), far);
}

// ------------------------------------------------------------------ save
function collectSave() {
  return {
    seed,
    time: sky?.time ?? 0,
    renderDistance,
    mode: player.mode,
    player: {
      x: player.pos.x, y: player.pos.y, z: player.pos.z,
      yaw: player.yaw, pitch: player.pitch,
      health: player.health, hunger: player.hunger, flying: player.flying,
    },
    inventory: inventory.serialize(),
    edits: world.serializeAllEdits(),
  };
}
function doSave() {
  writeSave(collectSave());
}
let _resetting = false;
function resetWorld() {
  _resetting = true;
  autosaver = null;
  clearSave();
  newSeed();
  location.reload();
}

window.addEventListener('beforeunload', () => {
  if (_resetting) return;
  if (state === 'playing' || state === 'paused' || state === 'inventory') {
    writeSave(collectSave());
  }
});

// ------------------------------------------------------------------ loop
let _lastW = 0, _lastH = 0;
function onResize() {
  // the canvas's own box is the ground truth for display size
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width) || window.innerWidth || 1);
  const h = Math.max(1, Math.round(rect.height) || window.innerHeight || 1);
  if (w === _lastW && h === _lastH) return;
  _lastW = w; _lastH = h;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = fovForAspect(camera.aspect);
  camera.updateProjectionMatrix();
  if (hand) { hand.camera.aspect = w / h; hand.camera.updateProjectionMatrix(); }
}
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => onResize()).observe(canvas);
}

let _lastStep = 0;

function renderLoop() {
  requestAnimationFrame(renderLoop);
  step();
}

// Safety net: some embedded/backgrounded contexts freeze requestAnimationFrame
// even while document.visibilityState === 'visible'. Keep the sim alive.
setInterval(() => {
  if (performance.now() - _lastStep > 200) step();
}, 100);

function step() {
  const now = performance.now();
  if (now - _lastStep < 6) return; // debounce double-drive
  _lastStep = now;
  onResize(); // cheap; only acts when the viewport actually changed
  const dt = Math.min(clock.getDelta(), 0.1);

  if (state === 'start') {
    renderer.clear();
    if (sky) {
      const t = now / 1000;
      if (menuActive) {
        const r = 19;
        camera.position.set(
          menuFocus.x + Math.cos(t * 0.05) * r,
          menuFocus.y + 7 + Math.sin(t * 0.021) * 1.8,
          menuFocus.z + Math.sin(t * 0.05) * r
        );
        camera.up.set(0, 1, 0);
        camera.lookAt(menuFocus.x, menuFocus.y + 1.5, menuFocus.z);
        camera.updateMatrixWorld();
        world.update(camera.position, 3);
      }
      if (menuActive) sky.setFogDistance(26, 46);
      sky.update(dt * 0.25, camera);
      renderer.render(scene, camera);
    }
    return;
  }

  const active = state === 'playing';

  if (world && sky) {
    if (active) {
      controls.tick();
      player.update(dt);
      world.update(player.pos, 6);
      interaction.update(dt);
      itemDrops.update(dt, world, player, (id) => inventory.add(id, 1));
      mobs.update(dt, player.pos);

      const moving = Math.hypot(player.vel.x, player.vel.z) > 0.4;
      hand.update(dt, moving, Math.hypot(player.vel.x, player.vel.z));

      if (player.dead) handleDeath();
    } else if (state === 'inventory' || state === 'paused' || state === 'loading') {
      // keep gen/meshing running so the world finishes loading
      world.update(player.pos, state === 'loading' ? 12 : 4);
    }

    sky.setUnderground(player.pos.y < heightAt(Math.floor(player.pos.x), Math.floor(player.pos.z)) - 1);
    sky.update(active ? dt : dt * 0.15, camera);
    updateFog();

    // underwater tint
    const submerged = player && player.headInWater();
    document.body.classList.toggle('underwater', !!submerged);

    autosaver?.tick(performance.now());
  }

  // HUD
  if (hud && player && interaction && sky) {
    hud.update(dt, {
      player,
      chunks: world.loadedCount(),
      biomeName: BIOME_INFO[biomeAt(Math.floor(player.pos.x), Math.floor(player.pos.z))]?.name,
      phase: sky.phaseLabel,
      clock: sky.clockString(),
      lookingAt: interaction.target ? itemName(interaction.target.id) : null,
    });
  }

  const w = _lastW, h = _lastH;
  if (w < 2 || h < 2) return; // viewport not ready
  renderer.setViewport(0, 0, w, h);
  renderer.setScissorTest(false);
  renderer.clear();
  renderer.render(scene, camera);

  // first-person hand overlay
  if (hand && (state === 'playing')) {
    hand.render(renderer, w, h);
  }
}

function handleDeath() {
  running = false;
  state = 'paused';
  controls.exitLock();
  hud.setVisible(false);
  if (confirm('Zemřel jsi. Objevit se znovu?')) {
    const sx = Math.floor(player.pos.x), sz = Math.floor(player.pos.z);
    player.spawnAt(sx, sz);
    state = 'playing';
    hud.setVisible(true);
    controls.requestLock();
    clock.getDelta();
  } else {
    pause.show();
  }
}

boot();
