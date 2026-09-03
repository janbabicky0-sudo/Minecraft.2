# VoxelCraft

Hra ve stylu Minecraftu, běžící čistě v prohlížeči. Voxelový svět, kostičkovaná
pixel-art grafika, těžba a stavění, crafting, den/noc cyklus, biomy, jeskyně,
jednoduchý survival. **Žádné assety Mojangu** – všechny textury jsou generované
proceduálně (`scripts/gen-textures.mjs`), kód je vlastní implementace.

## Spuštění

```bash
npm install
npm run dev
```

Otevře se `http://localhost:5173`. Pro produkční build:

```bash
npm run build
npm run preview
```

> `npm run dev` i `build` si nejdřív samy vygenerují texturový atlas
> (`public/textures/atlas.png` + `atlas.json`) skriptem `scripts/gen-textures.mjs`.

## Ovládání

| Klávesa | Akce |
|---|---|
| **W A S D** | pohyb |
| **myš** | rozhlížení (pointer lock – klikni do plochy) |
| **mezerník** | skok · **2× rychle** = zapnout/vypnout létání |
| **Ctrl** (drž) | sprint · v letu = rychleji |
| **Shift** | v letu = dolů |
| **levé tlačítko** | těžba bloku (drž – postup podle tvrdosti) |
| **pravé tlačítko** | položit blok / otevřít pracovní stůl |
| **kolečko** nebo **1–9** | výběr slotu v hotbaru |
| **prostřední tlačítko** | „pick block" – vzít blok, na který se díváš |
| **E** | inventář + crafting (2×2) |
| **Q** | sníst vybrané jídlo (jablko) |
| **F** | čelovka (světlo do jeskyní) |
| **F3** | debug (FPS, souřadnice, biom, čas) |
| **Esc** | pauza / menu |

## Crafting

Základní recepty (2×2 v inventáři, 3×3 u pracovního stolu):

- dřevo → 4× prkna
- 2× prkna nad sebe → 4× hůl
- 4× prkna → pracovní stůl
- prkna/dlažební kámen + hole → krumpáč / sekera / lopata
- 4× písek → pískovec, 2× písek → sklo *(u stolu)*

Nástroje zrychlují těžbu a některé bloky (kámen, rudy) bez správného nástroje
nevypadnou.

## Struktura projektu

```
scripts/gen-textures.mjs   generátor 16×16 pixel-art atlasu (čistý Node, bez závislostí)
src/
  constants.js             ID bloků/itemů, rozměry světa, konfigurace
  main.js                  bootstrap, herní smyčka, stavy (menu/hra/pauza/inventář)
  save.js                  ukládání do localStorage
  world/
    noise.js               seedovaný simplex noise (2D/3D) + fBm
    terrain.js             biomy, výšková mapa, jeskyně, rudy, stromy/kaktusy
    chunk.js               úložiště bloků chunku (Uint8Array) + editace
    world.js               správa chunků kolem hráče, budgetované generování/meshing
  rendering/
    atlas.js               načtení texturového atlasu (NearestFilter)
    mesher.js              face-culling + ambient occlusion + biome tint, 1 mesh/chunk
    sky.js                 gradientová obloha, slunce/měsíc, hvězdy, mlha, den/noc
    hand.js                pohled z první osoby (ruka / držený item)
  player/
    player.js              fyzika, kolize (AABB vs voxely), gravitace, létání, zdraví/hlad
    controls.js            pointer lock, klávesnice, myš
    interaction.js         voxel raycast (DDA), zvýraznění bloku, těžba, pokládání
  registry/
    blocks.js              vlastnosti bloků (tvrdost, nástroj, průhlednost, textury)
    items.js               itemy (nástroje, jídlo)
    recipes.js             crafting recepty + matcher
  ui/
    hud.js, hotbar (v HUD), inventory.js, pause.js, styles.css
```

## Jak to funguje – pár poznámek

- **Svět** je nekonečný, dělený na chunky 16×16×128. Terén je čistá funkce
  souřadnic (`generateChunkBlocks`) – stromy i jeskyně jsou deterministické, takže
  hranice chunků sedí bez dodatečné komunikace mezi nimi.
- **Meshing**: pro každý chunk se staví jeden merged mesh na vrstvu
  (opaque / cutout listí+kaktus / průhledné sklo / voda). Renderují se jen
  viditelné stěny, do vrcholových barev se peče ambient occlusion, směrové
  stínování stěn a „skylight" (ztmavení v jeskyních).
- **Den/noc** (výchozí ~15 min/cyklus) mění barvu oblohy, mlhy a intenzitu
  světla; v noci naskakují hvězdy.
- **Ukládání**: upravené bloky (jen rozdíl oproti generovanému terénu), pozice
  hráče, inventář a čas se průběžně ukládají do `localStorage`. „Nový svět…"
  v pauze smaže uložení a vygeneruje nový seed.
