// Central knobs + id tables shared across modules.

export const CHUNK_SX = 16;
export const CHUNK_SZ = 16;
export const WORLD_H = 128;
export const SEA_LEVEL = 40;

export const SAVE_KEY = 'voxelcraft.save.v1';

// Full day/night cycle length in seconds of real time.
export const DAY_LENGTH = 900;

export const DEFAULT_RENDER_DISTANCE = 5; // in chunks (radius)
export const MIN_RENDER_DISTANCE = 2;
export const MAX_RENDER_DISTANCE = 10;

// Block ids (0..255). AIR must be 0.
export const B = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  COBBLESTONE: 4,
  SAND: 5,
  SANDSTONE: 6,
  LOG: 7,
  PLANKS: 8,
  LEAVES: 9,
  GLASS: 10,
  WATER: 11,
  SNOW: 12,
  SNOW_DIRT: 13,
  COAL_ORE: 14,
  IRON_ORE: 15,
  GOLD_ORE: 16,
  DIAMOND_ORE: 17,
  BEDROCK: 18,
  GRAVEL: 19,
  CACTUS: 20,
  CRAFTING_TABLE: 21,
};

// Item ids (>=256, non-placeable tools/materials).
export const I = {
  STICK: 256,
  APPLE: 257,
  WOOD_PICKAXE: 258,
  WOOD_AXE: 259,
  WOOD_SHOVEL: 260,
  STONE_PICKAXE: 261,
  STONE_AXE: 262,
  STONE_SHOVEL: 263,
};

export const isItem = (id) => id >= 256;

// 6 face directions, order used everywhere (matches mesher).
export const DIRS = [
  { name: 'px', n: [1, 0, 0] },
  { name: 'nx', n: [-1, 0, 0] },
  { name: 'py', n: [0, 1, 0] },
  { name: 'ny', n: [0, -1, 0] },
  { name: 'pz', n: [0, 0, 1] },
  { name: 'nz', n: [0, 0, -1] },
];
