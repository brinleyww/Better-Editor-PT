// Generates the new blocks: models/tm_blocks.bin (geometry) and tm_parts.js (the part table), at the repo root.
// Part ids live in ids.json and are append-only: an id that has shipped must never change, or old track codes break.
// Run: node tools/blocks/build.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildSurface } = require('./catalog');
const { buildShared } = require('./shared');
const { buildIce } = require('./ice');
const { buildPipes } = require('./pipes');
const { buildExtras } = require('./extras');
const { buildStockBlocks } = require('./stockblocks');
const { buildMagnet, MAGNET_MATS } = require('./magnet');
const { buildScenery } = require('./scenery');
const { loadStockParts } = require('./stock/parts');
const { rasterTiles } = require('./geom');

const site = path.join(__dirname, '..', '..');
const idsFile = path.join(__dirname, 'ids.json');
const FIRST_ID = 1000;
const FIRST_PROXY = 190; // stock ids stop at 189; the physics wasm reads part ids as one byte
// The last part id from before the TM2020 kits. Parts up to here keep their data exactly as it was built then:
// their grass boxes one per face and their proxy slots in build order.
const LAST_LEGACY_ID = 2314;

const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16),
    c = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k)));
  return '#' + [c(16), c(8), c(0)].map((v) => v.toString(16).padStart(2, '0')).join('');
};

// The game's lights are strong and stock materials are dark to match (stock road is 0.30 linear),
// so colours here are written as they should look and scaled down in linear space.
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const lit = (hex, k = 0.42) => {
  const n = parseInt(hex.slice(1), 16);
  return '#' + [16, 8, 0].map((sh) => Math.round(toSrgb(toLin(((n >> sh) & 255) / 255) * k) * 255).toString(16).padStart(2, '0')).join('');
};
const litAll = (o, keep = []) => Object.fromEntries(Object.entries(o).map(([m, h]) => [m, keep.includes(m) ? h : lit(h)]));

// Stock gate colours, straight from road.glb. The game hands a glb colour factor and a hex colour's raw bytes to the
// renderer the same way, so the factor x 255 as hex, unlit, looks exactly like the stock gate.
const stockHex = (...f) => '#' + f.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
const STOCK_MATS = ['StartLine', 'Checkpoint', 'Finish', 'FinishWhite', 'FinishBlack', 'RoadBarrier', 'TechDeck', 'TechEdgeRed', 'TechEdgeWhite', 'TechDeckB', 'RoadDeckB', 'RoadSeam', 'RoadUnder', 'RoadKerb'];
const MATERIALS = litAll({
  PlasticDeck: '#f2c230',
  PlasticDeckB: '#e4b222',
  PlasticSeam: '#fff0b0',
  PlasticLine: '#fff7dc',
  PlasticRail: '#2f6fd0',
  PlasticKerb: '#f4f6fb',
  PlasticUnder: '#39425f',
  WoodDeckA: '#ad7a44',
  WoodDeckB: '#9a683a',
  WoodDeckC: '#b9864f',
  WoodDeckD: '#8c5d33',
  WoodSeam: '#3e2614',
  WoodPost: '#4f321b',
  WoodBeam: '#5e3c20',
  WoodBeamB: '#6e4726',
  WoodUnder: '#3f2916',
  // Gate colours are the stock gates' own (road.glb), so generated gates look exactly like stock ones.
  StartLine: stockHex(0.8, 0.3774, 0.0162),
  Checkpoint: stockHex(0.8, 0.5971, 0),
  Finish: stockHex(0.8, 0.0323, 0.0127),
  FinishWhite: '#ffffff',
  FinishBlack: stockHex(0.0147, 0.0147, 0.0147),
  RoadBarrier: stockHex(0.075, 0.075, 0.075),
  FxTurbo: '#ef8a1e',
  FxTurboB: '#ffe28a',
  FxSuper: '#d6262a',
  FxSuperB: '#ffd0a0',
  FxReset: '#e9e9ee',
  FxResetB: '#30343f',
  FxNoEngine: '#3a3a44',
  FxNoEngineB: '#e8513f',
  FxNoBrake: '#6f3aa8',
  FxNoBrakeB: '#e7d6ff',
  FxNoSteer: '#2e9b6a',
  FxNoSteerB: '#d9ffe9',
  FxCruise: '#1f8fd0',
  FxCruiseB: '#d3efff',
  FxFragile: '#c9d8e8',
  FxFragileB: '#d13a2c',
  FxRoulette: '#2b2f3a',
  FxReactor: '#1aa6b8',
  FxReactorB: '#c9fbff',
  FxReactor2: '#7d2fd0',
  FxReactor2B: '#f0d6ff',
  FxSlow: '#2f55b8',
  FxSlowB: '#d6e2ff',
  Grass: '#4f9a3c',
  GrassB: '#5aa845',
  GrassUnder: '#5b4630',
  Concrete: '#a7a9ae',
  ConcreteB: '#9a9ca1',
  ConcreteDark: '#5d6068',
  ConcreteUnder: '#3d3f45',
  WallTop: '#d13a2c',
  Metal: '#8d96a3',
  Truss: '#c9ccd2',
  TrussB: '#a9adb5',
  Stage: '#2a2d36',
  Light: '#fff3c4',
  Seat: '#2f5fc9',
  SeatB: '#d0d3da',
  Canopy: '#e8e8ea',
  Screen: '#152033',
  ScreenFrame: '#262a33',
  Water: '#2a8fde',
  WaterSide: '#1b6cbf',
  WaterFloor: '#1d4f7a',
  DecoWall: '#b9bcc2',
  DecoWallB: '#8c9097',
  DecoPlatform: '#c5c7cc',
  SignBoard: '#f2f2f2',
  SignArrow: '#d13a2c',
  Flag: '#d13a2c',
  Inflatable: '#e8513f',
  InflatableB: '#f2f2f2',
  Ice: '#d4ecfa',
  IceB: '#c6e3f6',
  IceLine: '#ffffff',
  IceRim: '#2f6fd0',
  IceWall: '#eef2f6',
  IceUnder: '#5f7487',
  Pillar: '#7a7d84',
  PillarEdge: '#3f4249',
  // Dirt kit (TM2020 dirt): packed earth, dark ruts, wooden kerbs, soft earth banks.
  DirtDeck: '#a8774a',
  DirtDeckB: '#9b6c42',
  DirtSeam: '#6a4629',
  DirtLine: '#7d5534',
  DirtRail: '#5e3c20',
  DirtKerb: '#b99c6b',
  DirtUnder: '#4a3220',
  DirtBerm: '#b4834f',
  DirtBermB: '#a87a49',
  // Dirt borders on other surfaces' penalty pieces; drive as dirt (REGION_U).
  DirtVerge: '#a27346',
  DirtVergeB: '#97693f',
  // Grass kit (TM2020 grass): mown stripes a little fresher than penalty grass, hedge kerbs, brown soil.
  GrassDeck: '#79b244',
  GrassDeckB: '#699b3b', // the darker mown stripe: 0.87 of GrassDeck, so the stripes read without seams
  GrassSeam: '#5a8f31',
  GrassLine: '#8fc25a',
  GrassKerb: '#3f6f2a',
  GrassKerbB: '#e6e8de',
  GrassSoil: '#5b4630',
  Hay: '#d9b54f',
  HayB: '#c39a3c',
  Rock: '#8e8a84',
  Leaf: '#4f8f35',
  Bush: '#3e7a2d',
  Trunk: '#5b3d24',
  // TM2020 ultra turbo is purple; bumpers are dark rubber pads with a bright glyph.
  FxUltra: '#a52fd8',
  FxUltraB: '#f3d9ff',
  FxBumper: '#2a2c33',
  FxBumperB: '#ffd23a',
  FxBumper2B: '#ff4f6a',
  // No grip: a mustard plate with dark skid marks; Reset wheels: a dark plate with four white tyres round a ring.
  FxNoGrip: '#d9b23a',
  FxNoGripB: '#3a2d06',
  FxResetWheels: '#3d4350',
  FxResetWheelsB: '#f2f4f8',
  // Vehicle gates: each car its own colour, the car drawn white on a dark sign.
  VehSnow: '#9fdcf5',
  VehRally: '#d8572a',
  VehDesert: '#e0b04a',
  VehStadium: '#3c7be0',
  VehFrame: '#30343c',
  VehPanel: '#1c1f26',
  VehGlyph: '#ffffff',
  // Bump road: the stock road's own grey and kerb colours (road.glb Road, RoadEdgeRed, RoadEdgeWhite).
  TechDeck: stockHex(0.2957, 0.2957, 0.2957),
  TechEdgeRed: stockHex(0.8, 0.0323, 0.0127),
  TechEdgeWhite: '#ffffff',
  // Vehicle sign pictures (catalog.js vehicleSign): the cut-outs in the panel's own colour, each car's frame and details
  // in its gate's colour. Added last so no older material moves.
  VehIconDark: '#30343c',
  VehSnowB: '#9fdcf5',
  VehRallyB: '#d8572a',
  VehDesertB: '#e0b04a',
  VehStadiumB: '#3c7be0',
  // Finish box (catalog.js finishBox): drawn see-through by tm_water.js, which also draws its outline. Added last.
  FinishBox: '#ff1e1e',
  // Road pipes (pipes.js): the inside's second panel shade, a touch darker than the stock road grey. Added last.
  TechDeckB: stockHex(0.262, 0.262, 0.262),
  // Snow platforms (extras.js): packed snow in two shades, a pale blue rim, blue-grey sides and underside.
  Snow: '#f4f7fb',
  SnowB: '#e6edf5',
  SnowLine: '#ffffff',
  SnowRim: '#8fb8e0',
  SnowSide: '#c9d4e0',
  SnowUnder: '#6d7f92',
  // The road kit (catalog.js RoadKit): the stock road's grey for its second panel shade, seams and underside, and the
  // stock barrier's colour for the kerb half of the rails, so it looks like plain stock road. Added last.
  RoadDeckB: stockHex(0.2957, 0.2957, 0.2957),
  RoadSeam: stockHex(0.2957, 0.2957, 0.2957),
  RoadUnder: stockHex(0.2957, 0.2957, 0.2957),
  RoadKerb: stockHex(0.075, 0.075, 0.075),
  // Magnet road (magnet.js): a violet deck in two panel shades and pale cyan edge strips. Added last.
  MagnetDeck: '#6a4fd0',
  MagnetDeckB: '#5c43bd',
  MagnetLine: '#9fe8ff',
  // Scenery (scenery.js): faceted rocks, foliage, bark and the built things Auto deco places. The plain names are the
  // faces that look up, the B names the rest, so the winter slot can snow on the tops. Added last. Mound is the grass
  // under a tree, Timber a dead tree's and a log's bark, Fence the fence's planks and Pole the lamp post's paint: each
  // its own material, so a custom colour paints them and leaves the same colour on other blocks alone.
  SceneRock: '#8f8b84',
  SceneRockB: '#7d7972',
  SceneRockTop: '#6f8f4a',
  SceneLeaf: '#5aa03c',
  SceneLeafB: '#3f7f2c',
  SceneNeedle: '#3f7a40',
  SceneNeedleB: '#2c5e33',
  SceneBark: '#5e3f26',
  SceneGrass: '#5f9a3e',
  SceneCactus: '#6fae55',
  SceneCactusB: '#5c9a45',
  SceneWood: '#8a5d36',
  SceneWoodB: '#5f3f24',
  SceneWall: '#e3d6bb',
  SceneRoof: '#a8382c',
  SceneRoofB: '#8e2e25',
  SceneStone: '#a39e94',
  SceneStoneB: '#8d887f',
  SceneWindow: '#ffd98a',
  SceneDark: '#2a2622',
  SceneCloth: '#d2392e',
  SceneClothB: '#b8302a',
  SceneMetal: '#5c6068',
  SceneSail: '#efe9dc',
  SceneIce: '#cfeaf7',
  SceneIceB: '#9fd2ea',
  SceneSeat: '#2f5fc9',
  SceneSeatB: '#2852ad',
  SceneMound: '#5f9a3e',
  SceneTimber: '#6b5640',
  SceneFence: '#8a5d36',
  SceneFenceB: '#5f3f24',
  ScenePole: '#3d4148',
}, [...STOCK_MATS, 'FinishBox', 'SceneWindow']);

// Drawn but never collided with: the car sinks through water instead of driving on it, and drives through scenery's
// tall grass (SceneGrass is only its blades) instead of stopping dead against it.
const NO_PHYSICS = ['Water', 'WaterSide', 'FxTurboB', 'FxSuperB', 'FxResetB', 'FxNoEngineB', 'FxNoBrakeB', 'FxNoSteerB', 'FxCruiseB', 'FxFragileB', 'FxReactorB', 'FxReactor2B', 'FxSlowB', 'FxUltraB', 'FxBumperB', 'FxBumper2B', 'VehGlyph', 'VehIconDark', 'VehSnowB', 'VehRallyB', 'VehDesertB', 'VehStadiumB', 'FinishBox', 'SceneGrass'];
// Materials that drive as their own surface wherever they sit inside a part of another one (part.r regions):
// penalty grass (2) and dirt verges (5).
const REGION_U = { Grass: 2, GrassB: 2, DirtVerge: 5, DirtVergeB: 5 };
// Gate banners and finish hoops are poles, not walls: the plastic bounce leaves them out, like deco and the soft boxes.
const NO_BOUNCE = ['StartLine', 'Checkpoint', 'Finish', 'FinishWhite', 'FinishBlack'];

// Stock colour slots: env variants plus Custom0-8. Same slots as stock Block parts.
const CUSTOM_IDS = [32, 33, 34, 35, 36, 37, 38, 39, 40];
const PLASTIC_CUSTOM = ['#25262c', '#b9302a', '#e0762b', '#f6e04a', '#2f9e4f', '#1f9d9d', '#2f5fc9', '#7d3fb8', '#7a5230'];
const WOOD_CUSTOM = ['#2a2320', '#6e2a22', '#a85c28', '#c9a048', '#4a6a3a', '#3a6a66', '#3a4a70', '#5a3a66', '#4a2f1a'];
const woodSet = (a) => ({ WoodDeckA: a, WoodDeckB: shade(a, 0.89), WoodDeckC: shade(a, 1.07), WoodDeckD: shade(a, 0.81) });
const dirtSet = (a) => ({ DirtDeck: a, DirtDeckB: shade(a, 0.93), DirtSeam: shade(a, 0.64), DirtBerm: shade(a, 1.06), DirtBermB: shade(a, 1.0) });
const lighten = (hex, k) => {
  const n = parseInt(hex.slice(1), 16),
    c = (sh) => Math.round(((n >> sh) & 255) + (255 - ((n >> sh) & 255)) * k);
  return '#' + [16, 8, 0].map((sh) => c(sh).toString(16).padStart(2, '0')).join('');
};
const plasticSet = (a) => ({ PlasticDeck: a, PlasticDeckB: shade(a, 0.93), PlasticSeam: lighten(a, 0.45) });
const grassSet = (a) => ({ GrassDeck: a, GrassDeckB: shade(a, 0.87), GrassSeam: shade(a, 0.76), GrassLine: lighten(a, 0.2) });
const litSlots = (slots) => slots.map((q) => ({ id: q.id, colors: litAll(q.colors, [...STOCK_MATS, 'SceneWindow']) }));
// Scenery (scenery.js) recolours like the game's own blocks. Winter: snow on the faces that look up (both sides of a
// roof, post tops, cactus tops), everything else frosted. Desert: dry olive leaves, straw grass, dusty cacti, sandstone
// rock and stone, sun-bleached wood, clay roofs and sun-faded paint and cloth.
const mixHex = (a, b, k) => {
  const p = parseInt(a.slice(1), 16),
    q = parseInt(b.slice(1), 16);
  return '#' + [16, 8, 0].map((sh) => Math.round(((p >> sh) & 255) * (1 - k) + ((q >> sh) & 255) * k).toString(16).padStart(2, '0')).join('');
};
const frost = (hex, k = 0.3) => mixHex(hex, '#e8f0f6', k);
const fade = (hex, k = 0.3) => mixHex(hex, '#ead9b4', k);
const SCENE_WINTER = {
  SceneRockTop: '#f2f6fa', SceneLeaf: '#eef3f6', SceneLeafB: '#5d7d62', SceneNeedle: '#f0f4f7', SceneNeedleB: '#2f5a3c', SceneGrass: '#eef2f5', SceneMound: '#eef2f5',
  SceneCactus: '#eef3f6', SceneRoof: '#f2f5f8', SceneRoofB: '#dde4ea', SceneFence: '#eef3f6', SceneSail: '#f4f7fa', SceneIce: '#e8f6fd',
  SceneRock: frost('#8f8b84', 0.15), SceneRockB: frost('#7d7972', 0.15), SceneCactusB: frost('#5c9a45'), SceneBark: frost('#5e3f26'), SceneTimber: frost('#6b5640'),
  SceneWood: frost('#8a5d36'), SceneWoodB: frost('#5f3f24'), SceneFenceB: frost('#5f3f24'), SceneStone: frost('#a39e94', 0.35), SceneStoneB: frost('#8d887f', 0.35),
  SceneWall: frost('#e3d6bb'), SceneMetal: frost('#5c6068'), ScenePole: frost('#3d4148'),
  SceneCloth: frost('#d2392e', 0.2), SceneClothB: frost('#b8302a', 0.2), SceneSeat: frost('#2f5fc9', 0.2), SceneSeatB: frost('#2852ad', 0.2),
};
const SCENE_DESERT = {
  SceneRock: '#c4a273', SceneRockB: '#ad8c60', SceneRockTop: '#dcc092', SceneStone: '#cdb58c', SceneStoneB: '#b89f77',
  SceneLeaf: '#9c9c4c', SceneLeafB: '#7d7d3a', SceneNeedle: '#76803a', SceneNeedleB: '#5c652d', SceneGrass: '#cdb86c', SceneMound: '#c9b06a',
  SceneCactus: '#a4b56e', SceneCactusB: '#86a05a', SceneBark: fade('#5e3f26', 0.2),
  SceneWood: '#a8784a', SceneTimber: '#a08a6c', SceneFence: '#b38a5a', SceneFenceB: '#94703f', SceneWall: '#ead6ad', SceneRoof: '#c06a3c', SceneRoofB: '#a65a32',
  SceneMetal: fade('#5c6068', 0.25), ScenePole: fade('#3d4148', 0.25), SceneSail: '#f0e2c4',
  SceneCloth: fade('#d2392e'), SceneClothB: fade('#b8302a'), SceneSeat: fade('#2f5fc9'), SceneSeatB: fade('#2852ad'),
};
// Custom slots, in CUSTOM_IDS order (black, red, orange, yellow, green, teal, blue, purple, brown), the game's own order:
// each block's main part takes the slot's colour in a shade that suits it. Leaves, needles, grass and cacti the leaf
// shade; rock and stone the rock shade; dead wood, logs and fences the wood kit's colours; roofs, cloth, seats, the lamp
// post's paint, windmill sails (pale) and ice crystals (as gems) the plastic colours.
const SCENE_LEAF = ['#2e3a2c', '#b8302a', '#e07a26', '#e9c43a', '#2f8a3a', '#1f9d8f', '#3a6fd0', '#8a46c0', '#7a5230'];
const SCENE_ROCK = ['#3e3f44', '#8e4434', '#b8693c', '#cfb072', '#6f8a6a', '#4f8c88', '#5a6a8e', '#6e5a82', '#7d6248'];
const sceneSlot = (i) => {
  const l = SCENE_LEAF[i],
    k = SCENE_ROCK[i],
    c = PLASTIC_CUSTOM[i],
    w = WOOD_CUSTOM[i];
  return {
    SceneLeaf: l, SceneLeafB: shade(l, 0.78), SceneNeedle: shade(l, 0.92), SceneNeedleB: shade(l, 0.72),
    SceneGrass: lighten(l, 0.08), SceneCactus: lighten(l, 0.08), SceneCactusB: shade(l, 0.95),
    SceneRock: k, SceneRockB: shade(k, 0.88), SceneRockTop: lighten(k, 0.12), SceneStone: lighten(k, 0.1), SceneStoneB: shade(k, 0.93),
    SceneTimber: w, SceneFence: lighten(w, 0.12), SceneFenceB: shade(w, 0.85),
    SceneRoof: c, SceneRoofB: shade(c, 0.85), SceneCloth: c, SceneClothB: shade(c, 0.86), SceneSeat: c, SceneSeatB: shade(c, 0.88),
    ScenePole: c, SceneSail: lighten(c, 0.6), SceneIce: lighten(c, 0.35), SceneIceB: c,
  };
};
// Stock barriers recolour with the season the way stock roads do (main.bundle.js environment colours).
const BARRIER = { 2: { RoadBarrier: '#898989' }, 3: { RoadBarrier: '#211001' } };
// So does the bump road, which joins the stock road: its Road, RoadEdgeRed and RoadEdgeWhite per season.
const TECH = { 2: { TechDeck: '#5077b2', TechDeckB: '#4870a8', TechEdgeRed: '#1f3d6b', TechEdgeWhite: '#ffffff' }, 3: { TechDeck: '#997240', TechDeckB: '#8e6a3b', TechEdgeRed: '#5b2424', TechEdgeWhite: '#510808' } };
// The road kit's own materials follow the stock road and its barrier through the seasons.
const ROAD_KIT = (n) => ({ ...BARRIER[n], ...TECH[n], RoadDeckB: TECH[n].TechDeck, RoadSeam: TECH[n].TechDeck, RoadUnder: TECH[n].TechDeck, RoadKerb: BARRIER[n].RoadBarrier });
const PALETTES = {
  Plastic: litSlots([
    { id: 1, colors: {} },
    { id: 2, colors: { ...BARRIER[2], ...plasticSet('#8fc3ee'), PlasticRail: '#ffffff', PlasticKerb: '#2f6fd0', PlasticLine: '#21508a' } },
    { id: 3, colors: { ...BARRIER[3], ...plasticSet('#e8953a'), PlasticRail: '#8a2f1f', PlasticLine: '#ffe7b0' } },
    ...CUSTOM_IDS.map((id, i) => ({ id, colors: plasticSet(PLASTIC_CUSTOM[i]) })),
  ]),
  Wood: litSlots([
    { id: 1, colors: {} },
    { id: 2, colors: { ...BARRIER[2], ...woodSet('#b7a48e'), WoodBeam: '#6f655c', WoodBeamB: '#7f746a' } },
    { id: 3, colors: { ...BARRIER[3], ...woodSet('#cda76f'), WoodBeam: '#7d5a33', WoodBeamB: '#8d6a3f' } },
    ...CUSTOM_IDS.map((id, i) => ({ id, colors: woodSet(WOOD_CUSTOM[i]) })),
  ]),
  // Stadium: concrete and deco recolour with the custom slots; grass follows the season.
  Stadium: litSlots([
    { id: 1, colors: {} },
    { id: 2, colors: { ...TECH[2], Grass: '#e6eef2', GrassB: '#d8e4ea', Concrete: '#b9c4cf', DecoWall: '#c7d3de' } },
    { id: 3, colors: { ...TECH[3], Grass: '#c9a86a', GrassB: '#bf9c5e', Concrete: '#c9b38f', DecoWall: '#cdb48d' } },
    ...CUSTOM_IDS.map((id, i) => ({ id, colors: { Concrete: PLASTIC_CUSTOM[i], DecoWall: PLASTIC_CUSTOM[i], DecoPlatform: PLASTIC_CUSTOM[i] } })),
  ]),
  // Ice: the rim takes the custom colours, the ice itself stays ice.
  Ice: litSlots([
    { id: 1, colors: {} },
    { id: 2, colors: { ...BARRIER[2], IceRim: '#ffffff', IceWall: '#dfe6ee' } },
    { id: 3, colors: { ...BARRIER[3], IceRim: '#d13a2c' } },
    ...CUSTOM_IDS.map((id, i) => ({ id, colors: { IceRim: PLASTIC_CUSTOM[i] } })),
  ]),
  // Dirt: winter is frozen grey earth, the sand set is desert dust; custom slots tint the earth with wood's colours.
  Dirt: litSlots([
    { id: 1, colors: {} },
    { id: 2, colors: { ...BARRIER[2], ...dirtSet('#b3a597'), DirtRail: '#6f655c', DirtKerb: '#e6eaee' } },
    { id: 3, colors: { ...BARRIER[3], ...dirtSet('#d3a462'), DirtRail: '#8a5a2b', DirtKerb: '#efd9a8' } },
    ...CUSTOM_IDS.map((id, i) => ({ id, colors: dirtSet(WOOD_CUSTOM[i]) })),
  ]),
  // Grass: frosted in winter, dry and gold in the sand set, the leaves turning with it.
  Grass: litSlots([
    { id: 1, colors: {} },
    { id: 2, colors: { ...BARRIER[2], ...grassSet('#cfdcd2'), Leaf: '#e3ecee', Bush: '#c9d8d2' } },
    { id: 3, colors: { ...BARRIER[3], ...grassSet('#b9a650'), Leaf: '#c8782a', Bush: '#9a6a2a' } },
    ...CUSTOM_IDS.map((id, i) => ({ id, colors: grassSet(PLASTIC_CUSTOM[i]) })),
  ]),
  // The road kit: stock road through the seasons, like the stock blocks beside it. Its pipes' concrete and its
  // penalty grass take Stadium's colours, the concrete the custom slots too.
  RoadKit: litSlots([
    { id: 1, colors: {} },
    { id: 2, colors: { ...ROAD_KIT(2), Grass: '#e6eef2', GrassB: '#d8e4ea', Concrete: '#b9c4cf' } },
    { id: 3, colors: { ...ROAD_KIT(3), Grass: '#c9a86a', GrassB: '#bf9c5e', Concrete: '#c9b38f' } },
    ...CUSTOM_IDS.map((id, i) => ({ id, colors: { Concrete: PLASTIC_CUSTOM[i] } })),
  ]),
  // Scenery: its own category, after Grass in the editor.
  Scenery: litSlots([
    { id: 1, colors: {} },
    { id: 2, colors: SCENE_WINTER },
    { id: 3, colors: SCENE_DESERT },
    ...CUSTOM_IDS.map((id, i) => ({ id, colors: sceneSlot(i) })),
  ]),
};
// part.f: the editor category, in TM_DATA.families order.
// RoadKit has no category of its own: its blocks go in the stock Road browser (patch.js, tm_menu.js). New families go
// last, so no block's f changes; the editor puts Scenery's button right after Grass's.
const FAMILIES = ['Plastic', 'Wood', 'Stadium', 'Ice', 'Water', 'Dirt', 'Grass', 'RoadKit', 'Scenery'];
const FAMILY_TITLE = { RoadKit: 'Road (new blocks in the stock Road browser)' };
const SURFACE_INDEX = Object.fromEntries(FAMILIES.map((n, i) => [n, i]));
// part.u when a part does not set its own: the kit's physics surface (tm_runtime.js SURFACES).
const KIT_U = { Plastic: 0, Wood: 1, Dirt: 5, Grass: 6 };

// Every (axis, rotation) as an exact integer matrix, derived from the game's own rotation quaternions.
const S = Math.SQRT1_2;
const Q = [
  [[0, 0, 0, 1], [0, S, 0, S], [0, 1, 0, 0], [0, S, 0, -S]],
  [[0, 0, 1, 0], [S, 0, S, 0], [1, 0, 0, 0], [S, 0, -S, 0]],
  [[0, 0, -S, S], [0.5, 0.5, -0.5, 0.5], [S, S, 0, 0], [0.5, 0.5, 0.5, -0.5]],
  [[0, 0, S, S], [0.5, -0.5, 0.5, 0.5], [S, -S, 0, 0], [0.5, -0.5, -0.5, -0.5]],
  [[S, 0, 0, S], [0.5, 0.5, 0.5, 0.5], [0, S, S, 0], [-0.5, 0.5, 0.5, -0.5]],
  [[-S, 0, 0, S], [-0.5, -0.5, 0.5, 0.5], [0, -S, S, 0], [0.5, -0.5, 0.5, -0.5]],
];
const mat3 = ([x, y, z, w]) =>
  [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)].map((v) => {
    const r = Math.round(v);
    if (Math.abs(r - v) > 1e-6) throw new Error('non-integer rotation');
    return r + 0;
  });
const ROTATIONS = Q.map((row) => row.map(mat3));

// A region's faces, each cut in four (and again) while its box, on the face's own plane, reaches more than REGION_TOL
// past every face of the region: on a curve's verge one slanted face's box covered metres of road beside it, which
// then drove as penalty grass. Faces whose box stays over the region (every face of a straight verge) are kept whole.
const REGION_TOL = 0.3;
function regionPieces(faces) {
  const CELL = 2,
    grid = new Map(),
    key = (x, y, z) => x + ',' + y + ',' + z;
  faces.forEach((t, n) => {
    const lo = [0, 1, 2].map((k) => Math.floor((Math.min(t[0][k], t[1][k], t[2][k]) - REGION_TOL) / CELL)),
      hi = [0, 1, 2].map((k) => Math.floor((Math.max(t[0][k], t[1][k], t[2][k]) + REGION_TOL) / CELL));
    for (let x = lo[0]; x <= hi[0]; x++)
      for (let y = lo[1]; y <= hi[1]; y++)
        for (let z = lo[2]; z <= hi[2]; z++) {
          const g = grid.get(key(x, y, z));
          g ? g.push(n) : grid.set(key(x, y, z), [n]);
        }
  });
  const outside = (p) => {
    for (const n of grid.get(key(Math.floor(p[0] / CELL), Math.floor(p[1] / CELL), Math.floor(p[2] / CELL))) ?? []) {
      const q = closestOnTri(p, ...faces[n]);
      if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= REGION_TOL) return false;
    }
    return true;
  };
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    out = [];
  const cut = (a, b, c, depth) => {
    const lo = [0, 1, 2].map((k) => Math.min(a[k], b[k], c[k])),
      hi = [0, 1, 2].map((k) => Math.max(a[k], b[k], c[k])),
      u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
      v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
      nr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]],
      k = [0, 1, 2].reduce((m, q) => (Math.abs(nr[q]) > Math.abs(nr[m]) ? q : m), 0),
      [i, j] = [0, 1, 2].filter((q) => q != k);
    let spills = false;
    // 5 x 5 points over the box, each lifted onto the face's plane
    for (let s = 0; s <= 4 && !spills; s++)
      for (let t = 0; t <= 4 && !spills; t++) {
        const p = [0, 0, 0];
        p[i] = lo[i] + ((hi[i] - lo[i]) * s) / 4;
        p[j] = lo[j] + ((hi[j] - lo[j]) * t) / 4;
        p[k] = nr[k] ? a[k] - (nr[i] * (p[i] - a[i]) + nr[j] * (p[j] - a[j])) / nr[k] : a[k];
        p[k] = Math.max(lo[k], Math.min(hi[k], p[k]));
        spills = outside(p);
      }
    if (!spills || depth >= 7) return out.push([a, b, c]);
    const ab = mid(a, b),
      bc = mid(b, c),
      ca = mid(c, a);
    cut(a, ab, ca, depth + 1);
    cut(ab, b, bc, depth + 1);
    cut(ca, bc, c, depth + 1);
    cut(ab, bc, ca, depth + 1);
  };
  for (const [a, b, c] of faces) cut(a, b, c, 0);
  return out;
}
// Closest point to p on the triangle abc.
function closestOnTri(p, a, b, c) {
  const sub = (x, y) => [x[0] - y[0], x[1] - y[1], x[2] - y[2]],
    dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2],
    ab = sub(b, a),
    ac = sub(c, a),
    ap = sub(p, a),
    d1 = dot(ab, ap),
    d2 = dot(ac, ap),
    at = (s, t) => [a[0] + ab[0] * s + ac[0] * t, a[1] + ab[1] * s + ac[1] * t, a[2] + ab[2] * s + ac[2] * t];
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b),
    d3 = dot(ab, bp),
    d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(d1 / (d1 - d3), 0);
  const cp = sub(p, c),
    d5 = dot(ab, cp),
    d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(0, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w];
  }
  const den = 1 / (va + vb + vc);
  return at(vb * den, vc * den);
}

// Joins boxes that are the same on two axes and meet or overlap on the third: the union is exactly one box, so the
// covered space does not change. Keeps the region list short for parts with long verges.
function mergeBoxes(list) {
  const B = list.map((b) => [b[0].slice(), b[1].slice(), b[2] ?? 2]);
  for (let joined = true; joined; ) {
    joined = false;
    for (let i = 0; i < B.length && !joined; i++)
      for (let j = i + 1; j < B.length && !joined; j++) {
        const [a, b] = [B[i], B[j]];
        if (a[2] != b[2]) continue;
        const same = [0, 1, 2].filter((k) => a[0][k] == b[0][k] && a[1][k] == b[1][k]),
          k = [0, 1, 2].find((q) => !same.includes(q));
        if (same.length == 3 || (same.length == 2 && b[0][k] <= a[1][k] && a[0][k] <= b[1][k])) {
          if (same.length == 2) {
            a[0][k] = Math.min(a[0][k], b[0][k]);
            a[1][k] = Math.max(a[1][k], b[1][k]);
          }
          B.splice(j, 1);
          joined = true;
        }
      }
  }
  return B.map(([lo, hi, u]) => (u == 2 ? [lo, hi] : [lo, hi, u]));
}

function main(stock) {
  const reg = fs.existsSync(idsFile) ? JSON.parse(fs.readFileSync(idsFile, 'utf8')) : {};
  let nextId = Math.max(FIRST_ID - 1, ...Object.values(reg)) + 1;
  // New kits and sets go at the end: ids are handed out in this order the first time a block is built.
  const parts = [...buildSurface('Plastic'), ...buildSurface('Wood'), ...buildShared(), ...buildIce(), ...buildSurface('Dirt'), ...buildSurface('Grass'), ...buildPipes(), ...buildExtras(), ...buildSurface('RoadKit'), ...buildStockBlocks(stock), ...buildMagnet(), ...buildScenery()];
  // Collision meshes: the same blocks built again without the surface patterns. The pattern strips are coplanar,
  // so they only cost the physics time; the plain mesh has the same shape with far fewer triangles.
  process.env.BE_PLAIN = '1';
  for (const k of Object.keys(require.cache)) if (k.includes(path.sep + 'blocks' + path.sep)) delete require.cache[k];
  const C = require('./catalog');
  const plain = new Map([...C.buildSurface('Plastic'), ...C.buildSurface('Wood'), ...require('./shared').buildShared(), ...require('./ice').buildIce(), ...C.buildSurface('Dirt'), ...C.buildSurface('Grass'), ...require('./pipes').buildPipes(), ...require('./extras').buildExtras(), ...C.buildSurface('RoadKit'), ...require('./stockblocks').buildStockBlocks(stock), ...require('./magnet').buildMagnet(), ...require('./scenery').buildScenery()].map((q) => [q.name, q.mesh]));
  delete process.env.BE_PLAIN;
  const seen = new Set();
  const matNames = Object.keys(MATERIALS),
    matIndex = new Map(matNames.map((m, i) => [m, i]));

  const chunks = [];
  let offset = 0;
  // Identical chunks are stored once: kits drawn on the same lattice (Dirt and Grass on plastic's) and the plain
  // collision meshes repeat a lot of geometry. Returns the chunk's byte offset.
  const stored = new Map();
  const push = (typed) => {
    const b = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength),
      key = crypto.createHash('sha1').update(b).digest('base64') + b.length;
    if (stored.has(key)) return stored.get(key);
    const at = offset;
    stored.set(key, at);
    // keep every chunk 4-byte aligned so the runtime can use typed-array views
    chunks.push(b);
    offset += b.length;
    const pad = (4 - (b.length % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      offset += pad;
    }
    return at;
  };

  const proxies = new Map();
  const table = [],
    gates = [];
  let physTris = 0,
    totalTris = 0,
    worst = { tris: 0 };
  for (const p of parts) {
    if (seen.has(p.name)) throw new Error('duplicate part name ' + p.name);
    seen.add(p.name);
    if (!(p.name in reg)) reg[p.name] = nextId++;
    const b = p.mesh.bounds();
    if (!Number.isFinite(b.min[0])) throw new Error('empty part ' + p.name);
    if (b.min[1] < -0.02) throw new Error('part below its layer: ' + p.name + ' y=' + b.min[1]);
    for (const [m] of p.mesh.byMat) if (!matIndex.has(m)) throw new Error('unknown material ' + m + ' in ' + p.name);

    const mats = [];
    for (const [m, list] of p.mesh.byMat) {
      const idx = new Map(),
        pos = [],
        ind = [];
      for (const v of list) {
        const key = v.map((n) => n.toFixed(4)).join(',');
        let i = idx.get(key);
        if (i == null) {
          i = pos.length / 3;
          idx.set(key, i);
          pos.push(+v[0].toFixed(4), +v[1].toFixed(4), +v[2].toFixed(4));
        }
        ind.push(i);
      }
      if (pos.length / 3 > 65535) throw new Error('too many vertices in ' + p.name);
      const po = push(new Float32Array(pos)),
        io = push(new Uint16Array(ind));
      mats.push([matIndex.get(m), po, pos.length, io, ind.length]);
    }
    {
      // One indexed list for collision, every solid material together. bounce: the triangles of it that throw the
      // car back on plastic, the same vertices without deco, gate banners, hoops and anything in a soft box.
      const idx = new Map(),
        pos = [],
        ind = [],
        bounce = [],
        magnet = [], // the faces that hold the car (magnet.js MAGNET_MATS)
        pm = plain.get(p.name),
        soft = pm.soft ?? [],
        isSoft = (a, b, c) => soft.some(([lo, hi]) => [0, 1, 2].every((k) => {
          const m = (a[k] + b[k] + c[k]) / 3;
          return m >= lo[k] && m <= hi[k];
        }));
      let skipped = 0;
      for (const [m, list] of pm.byMat) {
        if (NO_PHYSICS.includes(m)) continue;
        for (let t = 0; t < list.length; t += 3) {
          const tri = [];
          for (const v of list.slice(t, t + 3)) {
            const key = v.map((n) => n.toFixed(4)).join(',');
            let i = idx.get(key);
            if (i == null) {
              i = pos.length / 3;
              idx.set(key, i);
              pos.push(+v[0].toFixed(4), +v[1].toFixed(4), +v[2].toFixed(4));
            }
            ind.push(i);
            tri.push(i);
          }
          if (MAGNET_MATS.includes(m)) magnet.push(...tri);
          if (p.tab == 'Deco' || NO_BOUNCE.includes(m) || isSoft(list[t], list[t + 1], list[t + 2])) skipped++;
          else bounce.push(...tri);
        }
      }
      if (pos.length / 3 > 65535) throw new Error('too many collision vertices in ' + p.name);
      const po = push(new Float32Array(pos)),
        io = push(new Uint16Array(ind));
      p.ph = [-1, po, pos.length, io, ind.length];
      if (skipped) p.bw = [-1, po, pos.length, push(new Uint16Array(bounce)), bounce.length];
      if (magnet.length) p.mg = [-1, po, pos.length, push(new Uint16Array(magnet)), magnet.length];
      physTris += ind.length / 3;
    }
    totalTris += p.mesh.tris;
    if (p.mesh.tris > worst.tris) worst = { tris: p.mesh.tris, name: p.name };

    const f = SURFACE_INDEX[p.surface];
    const e = { n: p.name, i: reg[p.name], l: p.label, t: p.tab, s: p.sub, f, m: mats, b: [b.min.map((v) => +v.toFixed(2)), b.max.map((v) => +v.toFixed(2))], c: p.tiles ?? rasterTiles(p.tileMesh ?? p.mesh) };
    // Hidden: still loads and drives (old tracks use it), but the block browser leaves it out.
    if (p.hidden) e.h = 1;
    if (p.detector) e.d = p.detector;
    if (p.startOffset) e.o = p.startOffset;
    if (p.fx) e.x = p.fx;
    if (p.spawnDir) e.sd = p.spawnDir;
    if (p.ph[4]) e.ph = p.ph;
    // Physics surface for the whole part (tm_runtime.js SURFACES): 0 plastic, 1 wood, 2 penalty grass, 3 ice,
    // 4 bobsleigh, 5 dirt, 6 grass, 8 tech; absent = stock physics.
    const u = p.u !== undefined ? p.u : (KIT_U[p.surface] ?? null);
    if (u != null) e.u = u;
    if (p.bw && u === 0) e.bw = p.bw;
    // Magnet faces (tm_runtime.js MAGNET): the car is held to them.
    if (p.mg) e.mg = p.mg;
    // Another surface inside this part (grass or dirt verges): boxes around its faces, in the part's own frame.
    // [lo, hi] is penalty grass, as it always was; any other surface is [lo, hi, u].
    // A face whose box would reach past the region (a slanted face on a curve's verge) is cut into pieces first.
    const boxes = new Map(),
      regionFaces = new Map();
    for (const [m, ru] of Object.entries(REGION_U)) {
      const l = p.mesh.byMat.get(m);
      if (!l || ru == u) continue;
      if (!regionFaces.has(ru)) regionFaces.set(ru, []);
      for (let i = 0; i < l.length; i += 3) regionFaces.get(ru).push([l[i], l[i + 1], l[i + 2]]);
    }
    for (const [ru, faces] of regionFaces)
      for (const [a, b, c] of regionPieces(faces)) {
        const lo = [0, 1, 2].map((k) => +(Math.min(a[k], b[k], c[k]) - 0.35).toFixed(2)),
          hi = [0, 1, 2].map((k) => +(Math.max(a[k], b[k], c[k]) + 0.35).toFixed(2));
        boxes.set(lo.join() + '|' + hi.join() + '|' + ru, ru == 2 ? [lo, hi] : [lo, hi, ru]);
      }
    // Newer parts get their boxes merged; legacy parts keep theirs box for box, so their physics cannot move.
    if (boxes.size) e.r = reg[p.name] <= LAST_LEGACY_ID ? [...boxes.values()] : mergeBoxes([...boxes.values()]);
    table.push(e);
    if (p.detector || p.startOffset) gates.push([p, e]);
  }
  // The wasm only takes one-byte part ids, so gates share proxy slots keyed by what the wasm needs from them.
  // Legacy gates take their slots first, in build order as they always did; newer gates follow in id order, which
  // never changes, so no gate's slot moves when gates are added or the build order changes.
  const legacy = (e) => e.i <= LAST_LEGACY_ID;
  gates.sort(([, a], [, b]) => (legacy(a) && legacy(b) ? 0 : legacy(a) ? -1 : legacy(b) ? 1 : a.i - b.i));
  for (const [p, e] of gates) {
    const key = JSON.stringify([p.detector ?? null, p.startOffset ?? null]);
    if (!proxies.has(key)) proxies.set(key, { id: FIRST_PROXY + proxies.size, detector: p.detector ?? null, startOffset: p.startOffset ?? null });
    e.p = proxies.get(key).id;
  }
  if (FIRST_PROXY + proxies.size > 256) throw new Error('out of proxy slots: ' + proxies.size);

  const bin = Buffer.concat(chunks);
  fs.mkdirSync(path.join(site, 'models'), { recursive: true });
  fs.writeFileSync(path.join(site, 'models', 'tm_blocks.bin'), bin);
  fs.writeFileSync(idsFile, JSON.stringify(reg, null, 1));
  const hash = crypto.createHash('sha256').update(bin).digest('hex').slice(0, 16);
  const data = {
    version: 1,
    hash,
    binBytes: bin.length,
    materials: matNames.map((m) => MATERIALS[m]),
    materialNames: matNames,
    families: FAMILIES,
    palettes: FAMILIES.map((n) => PALETTES[n == 'Water' ? 'Stadium' : n]), // water pools recolour like Stadium
    noPhysics: NO_PHYSICS.map((m) => matIndex.get(m)),
    rotations: ROTATIONS,
    proxies: [...proxies.values()],
    // Every stock part's tiles by name, as the game's part list claims them (the same ranges as a part's c): the page
    // has no other way to see where a stock part sits, and its surface lookup needs it where one of ours overlaps it.
    stockTiles: Object.fromEntries(stock.map((s) => [s.name, s.tiles])),
    // Tabs in menu order; any tab a block uses that is not listed goes at the end, in the order blocks use it.
    // Ice's own tabs come before the vehicle gates, so its browser still opens on the bobsleigh.
    tabs: [...new Set(['Road', 'Dirt road', 'Railed road', 'Wide road', 'Open road', 'Narrow road', 'Platform', 'Blocks', 'Wall track', 'Penalty grass', 'Walls and loops', 'Half-pipe', 'Pipes', 'Magnet', 'Gates', 'Box gates', 'Effects', 'Special gates', 'Bobsleigh', 'Bobsleigh gates', 'Bobsleigh effects', 'Ice platform', 'Ice walls and loops', 'Ice blocks', 'Ice wall track', 'Ice gates', 'Ice effects', 'Snow platform', 'Snow blocks', 'Snow wall track', 'Vehicle gates', 'Bump road', 'Connectors', 'Track walls', 'Structures', 'Stage and screens', 'Deco', 'Pools', 'Shallow water', 'Water road', ...table.map((p) => p.t)])],
    parts: table,
  };
  fs.writeFileSync(path.join(site, 'tm_parts.js'), '// Generated by tools/blocks/build.js. Do not edit by hand.\nself.TM_DATA = ' + JSON.stringify(data) + ';\n');

  // A readable list of everything in the catalogue, by surface, tab and section.
  const hidden = table.filter((p) => p.h).length;
  const lines = ['# Block list', '', 'Generated by tools/blocks/build.js. ' + (table.length - hidden) + ' blocks in the menu' + (hidden ? ', and ' + hidden + ' older ones that tracks can still have but the menu no longer offers (not listed here: the turbo roulette, the old reactor down and oriented plates and the round finish hoops)' : '') + '.', ''];
  for (const [f, surface] of FAMILIES.entries()) {
    const own = table.filter((p) => p.f == f && !p.h);
    lines.push('## ' + (FAMILY_TITLE[surface] ?? surface) + ' (' + own.length + ')', '');
    for (const tab of data.tabs) {
      const inTab = own.filter((p) => p.t == tab);
      if (!inTab.length) continue;
      lines.push('### ' + tab + ' (' + inTab.length + ')', '');
      for (const sub of [...new Set(inTab.map((p) => p.s))]) lines.push('**' + sub + ':** ' + inTab.filter((p) => p.s == sub).map((p) => p.l).join(', '), '');
    }
  }
  fs.mkdirSync(path.join(__dirname, '..', '..', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', '..', 'docs', 'BLOCKS.md'), lines.join('\n'));

  const perTab = {};
  for (const p of table) perTab[p.t] = (perTab[p.t] || 0) + 1;
  console.log('parts', table.length, 'tris', totalTris, 'collision tris', physTris, 'bin MB', (bin.length / 1e6).toFixed(2), 'table MB', (fs.statSync(path.join(site, 'tm_parts.js')).size / 1e6).toFixed(2), 'proxies', proxies.size);
  console.log('per surface+tab', perTab, 'heaviest', worst);
}
loadStockParts().then(main);
