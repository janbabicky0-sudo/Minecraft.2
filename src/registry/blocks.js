import { B } from '../constants.js';

// Tool tiers: 0 = hand, 1 = wood, 2 = stone.
// tool: which tool type mines it fast ('pickaxe' | 'axe' | 'shovel' | null)
// reqTier: minimum tool tier for the block to actually drop something
// hardness: base seconds to break by hand (tools divide this)
// solid: has collision
// opaque: fully hides touching neighbour faces / casts AO
// transparent: rendered in the transparent pass (after opaque)
// faces: { top, bottom, side }  OR  { all }   -> atlas tile names
// tint: 'grass' | 'foliage' | null  -> biome colour multiplied onto listed faces
// tintFaces: which faces receive the tint (default all)

function def(o) {
  return {
    name: o.name,
    solid: o.solid ?? true,
    opaque: o.opaque ?? true,
    transparent: o.transparent ?? false,
    cutout: o.cutout ?? false,
    hardness: o.hardness ?? 1,
    tool: o.tool ?? null,
    reqTier: o.reqTier ?? 0,
    drop: o.drop, // id, array of {id,count}, or undefined => drops itself
    faces: o.faces,
    tint: o.tint ?? null,
    tintFaces: o.tintFaces ?? null,
    liquid: o.liquid ?? false,
    render: o.render ?? true,
  };
}

export const BLOCKS = {
  [B.AIR]: def({ name: 'Vzduch', solid: false, opaque: false, render: false, faces: null }),

  [B.GRASS]: def({
    name: 'Tráva', hardness: 0.6, tool: 'shovel', drop: B.DIRT,
    faces: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' },
    tint: 'grass', tintFaces: ['py'],
  }),
  [B.DIRT]: def({ name: 'Hlína', hardness: 0.75, tool: 'shovel', faces: { all: 'dirt' } }),
  [B.STONE]: def({
    name: 'Kámen', hardness: 7.5, tool: 'pickaxe', reqTier: 1, drop: B.COBBLESTONE,
    faces: { all: 'stone' },
  }),
  [B.COBBLESTONE]: def({ name: 'Dlažební kámen', hardness: 10, tool: 'pickaxe', reqTier: 1, faces: { all: 'cobblestone' } }),
  [B.SAND]: def({ name: 'Písek', hardness: 0.6, tool: 'shovel', faces: { all: 'sand' } }),
  [B.SANDSTONE]: def({ name: 'Pískovec', hardness: 4, tool: 'pickaxe', reqTier: 1, faces: { all: 'sandstone' } }),

  [B.LOG]: def({
    name: 'Kmen', hardness: 3, tool: 'axe',
    faces: { top: 'log_top', bottom: 'log_top', side: 'log_side' },
  }),
  [B.PLANKS]: def({ name: 'Prkna', hardness: 3, tool: 'axe', faces: { all: 'planks' } }),
  [B.LEAVES]: def({
    name: 'Listí', hardness: 0.25, tool: null, opaque: false, transparent: true, cutout: true,
    drop: [], // sticks / apples handled specially in interaction
    faces: { all: 'leaves' }, tint: 'foliage',
  }),
  [B.GLASS]: def({
    name: 'Sklo', hardness: 0.5, tool: null, opaque: false, transparent: true, drop: [],
    faces: { all: 'glass' },
  }),
  [B.WATER]: def({
    name: 'Voda', solid: false, opaque: false, transparent: true, render: true, liquid: true,
    hardness: Infinity, drop: [], faces: { all: 'water' },
  }),

  [B.SNOW]: def({ name: 'Sníh', hardness: 0.6, tool: 'shovel', faces: { all: 'snow' } }),
  [B.SNOW_DIRT]: def({
    name: 'Zasněžená hlína', hardness: 0.7, tool: 'shovel', drop: B.DIRT,
    faces: { top: 'snow', bottom: 'dirt', side: 'snow_side' },
  }),

  [B.COAL_ORE]: def({ name: 'Uhelná ruda', hardness: 9, tool: 'pickaxe', reqTier: 1, faces: { all: 'coal_ore' } }),
  [B.IRON_ORE]: def({ name: 'Železná ruda', hardness: 12, tool: 'pickaxe', reqTier: 2, faces: { all: 'iron_ore' } }),
  [B.GOLD_ORE]: def({ name: 'Zlatá ruda', hardness: 12, tool: 'pickaxe', reqTier: 2, faces: { all: 'gold_ore' } }),
  [B.DIAMOND_ORE]: def({ name: 'Diamantová ruda', hardness: 18, tool: 'pickaxe', reqTier: 2, faces: { all: 'diamond_ore' } }),

  [B.BEDROCK]: def({ name: 'Podloží', hardness: Infinity, tool: null, drop: [], faces: { all: 'bedrock' } }),
  [B.GRAVEL]: def({ name: 'Štěrk', hardness: 0.9, tool: 'shovel', faces: { all: 'gravel' } }),
  [B.CACTUS]: def({
    name: 'Kaktus', hardness: 0.6, tool: null, opaque: false, transparent: true, cutout: true,
    faces: { top: 'cactus_top', bottom: 'cactus_top', side: 'cactus_side' },
  }),
  [B.CRAFTING_TABLE]: def({
    name: 'Pracovní stůl', hardness: 3, tool: 'axe',
    faces: { top: 'crafting_table_top', bottom: 'planks', side: 'crafting_table_side' },
  }),
};

export function getBlock(id) {
  return BLOCKS[id] || BLOCKS[B.AIR];
}

// tile name for a given face direction ('px'|'nx'|'py'|'ny'|'pz'|'nz')
export function faceTile(id, dir) {
  const f = getBlock(id).faces;
  if (!f) return null;
  if (f.all) return f.all;
  if (dir === 'py') return f.top;
  if (dir === 'ny') return f.bottom;
  return f.side;
}

export function occludes(id) {
  return getBlock(id).opaque;
}
