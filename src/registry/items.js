import { B, I, isItem } from '../constants.js';
import { BLOCKS } from './blocks.js';

// Non-block items (tools, materials). Blocks are also valid inventory ids
// (their icon = the 'side' / 'all' face tile).

export const ITEMS = {
  [I.STICK]: { name: 'Hůl', tile: 'stick', maxStack: 64 },
  [I.APPLE]: { name: 'Jablko', tile: 'apple', maxStack: 64, food: 4 },

  [I.WOOD_PICKAXE]: { name: 'Dřevěný krumpáč', tile: 'wood_pickaxe', maxStack: 1, tool: { type: 'pickaxe', tier: 1, speed: 4 } },
  [I.WOOD_AXE]: { name: 'Dřevěná sekera', tile: 'wood_axe', maxStack: 1, tool: { type: 'axe', tier: 1, speed: 4 } },
  [I.WOOD_SHOVEL]: { name: 'Dřevěná lopata', tile: 'wood_shovel', maxStack: 1, tool: { type: 'shovel', tier: 1, speed: 4 } },

  [I.STONE_PICKAXE]: { name: 'Kamenný krumpáč', tile: 'stone_pickaxe', maxStack: 1, tool: { type: 'pickaxe', tier: 2, speed: 8 } },
  [I.STONE_AXE]: { name: 'Kamenná sekera', tile: 'stone_axe', maxStack: 1, tool: { type: 'axe', tier: 2, speed: 8 } },
  [I.STONE_SHOVEL]: { name: 'Kamenná lopata', tile: 'stone_shovel', maxStack: 1, tool: { type: 'shovel', tier: 2, speed: 8 } },
};

export function itemName(id) {
  if (id == null) return '';
  if (isItem(id)) return ITEMS[id]?.name ?? `#${id}`;
  return BLOCKS[id]?.name ?? `#${id}`;
}

export function maxStack(id) {
  if (isItem(id)) return ITEMS[id]?.maxStack ?? 64;
  return 64;
}

// atlas tile name used to render this id as a 2D icon
export function itemTile(id) {
  if (isItem(id)) return ITEMS[id]?.tile ?? null;
  const f = BLOCKS[id]?.faces;
  if (!f) return null;
  return f.all || f.side || f.top;
}

export function toolOf(id) {
  return isItem(id) ? ITEMS[id]?.tool ?? null : null;
}

export function foodOf(id) {
  return isItem(id) ? ITEMS[id]?.food ?? 0 : 0;
}

export function isPlaceable(id) {
  return !isItem(id) && id !== B.AIR && id !== B.WATER;
}
