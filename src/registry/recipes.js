import { B, I } from '../constants.js';

// Recipes match against a square grid of ids (2x2 or 3x3), null = empty.
// - shapeless: any arrangement, counts must match exactly
// - shaped: 'pattern' rows use single-char keys mapped in 'key'; trimmed to
//   bounding box so it can sit anywhere in the grid.
// 'table: true' => only craftable in the 3x3 crafting table.

export const RECIPES = [
  // wood -> planks
  { shapeless: [B.LOG], out: { id: B.PLANKS, count: 4 } },

  // planks -> sticks
  {
    shaped: true,
    pattern: ['P', 'P'],
    key: { P: B.PLANKS },
    out: { id: I.STICK, count: 4 },
  },

  // planks -> crafting table
  {
    shaped: true,
    pattern: ['PP', 'PP'],
    key: { P: B.PLANKS },
    out: { id: B.CRAFTING_TABLE, count: 1 },
  },

  // glass from sand needs a furnace we don't have -> allow a cheap "polish": 2 sand -> 1 glass (game-y shortcut)
  { shapeless: [B.SAND, B.SAND], out: { id: B.GLASS, count: 1 }, table: true },

  // sandstone
  {
    shaped: true, table: true,
    pattern: ['SS', 'SS'],
    key: { S: B.SAND },
    out: { id: B.SANDSTONE, count: 1 },
  },

  // --- wooden tools (3x3) ---
  {
    shaped: true, table: true,
    pattern: ['PPP', ' S ', ' S '],
    key: { P: B.PLANKS, S: I.STICK },
    out: { id: I.WOOD_PICKAXE, count: 1 },
  },
  {
    shaped: true, table: true,
    pattern: ['PP', 'PS', ' S'],
    key: { P: B.PLANKS, S: I.STICK },
    out: { id: I.WOOD_AXE, count: 1 },
  },
  {
    shaped: true, table: true,
    pattern: ['P', 'S', 'S'],
    key: { P: B.PLANKS, S: I.STICK },
    out: { id: I.WOOD_SHOVEL, count: 1 },
  },

  // --- stone tools (3x3) ---
  {
    shaped: true, table: true,
    pattern: ['CCC', ' S ', ' S '],
    key: { C: B.COBBLESTONE, S: I.STICK },
    out: { id: I.STONE_PICKAXE, count: 1 },
  },
  {
    shaped: true, table: true,
    pattern: ['CC', 'CS', ' S'],
    key: { C: B.COBBLESTONE, S: I.STICK },
    out: { id: I.STONE_AXE, count: 1 },
  },
  {
    shaped: true, table: true,
    pattern: ['C', 'S', 'S'],
    key: { C: B.COBBLESTONE, S: I.STICK },
    out: { id: I.STONE_SHOVEL, count: 1 },
  },
];

// grid: flat array length size*size (row-major), size 2 or 3. Returns {id,count} or null.
export function matchRecipe(grid, size, hasTable) {
  const cells = grid.map((s) => (s ? s.id : null));
  const counts = grid.map((s) => (s ? s.count : 0));

  for (const r of RECIPES) {
    if (r.table && !hasTable) continue;

    if (r.shapeless) {
      const need = [...r.shapeless].sort();
      const have = [];
      let ok = true;
      for (let i = 0; i < cells.length; i++) {
        if (cells[i] == null) continue;
        if (counts[i] !== 1 && need.length === cells.filter((c) => c != null).length) {
          // shapeless recipes here assume 1 of each; allow >1 but consume 1
        }
        have.push(cells[i]);
      }
      have.sort();
      if (have.length !== need.length) ok = false;
      else for (let i = 0; i < have.length; i++) if (have[i] !== need[i]) ok = false;
      if (ok) return { ...r.out };
      continue;
    }

    if (r.shaped) {
      const pat = r.pattern.map((row) => row.split('').map((ch) => (ch === ' ' ? null : r.key[ch])));
      if (matchShaped(cells, size, pat)) return { ...r.out };
    }
  }
  return null;
}

function matchShaped(cells, size, pat) {
  const ph = pat.length;
  const pw = Math.max(...pat.map((r) => r.length));
  if (ph > size || pw > size) return false;

  for (let oy = 0; oy + ph <= size; oy++) {
    for (let ox = 0; ox + pw <= size; ox++) {
      let ok = true;
      for (let y = 0; y < size && ok; y++) {
        for (let x = 0; x < size && ok; x++) {
          const inPat = y >= oy && y < oy + ph && x >= ox && x < ox + pw;
          const want = inPat ? (pat[y - oy][x - ox] ?? null) : null;
          const got = cells[y * size + x];
          if (want !== got) ok = false;
        }
      }
      if (ok) return true;
    }
  }
  return false;
}
