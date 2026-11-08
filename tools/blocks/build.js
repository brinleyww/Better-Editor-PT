// Generates the new blocks: models/tm_blocks.bin (geometry) and tm_parts.js (the part table), at the repo root.
// Part ids live in ids.json and are append-only: an id that has shipped must never change, or old track codes break.
// Run: node tools/blocks/build.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildSurface } = require('./catalog');
const { buildShared } = require('./shared');
const { buildIce } = require('./ice');
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
const STOCK_MATS = ['StartLine', 'Checkpoint', 'Finish', 'FinishWhite', 'FinishBlack', 'RoadBarrier', 'TechDeck', 'TechEdgeRed', 'TechEdgeWhite'];
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
  GrassDeckB: '#70a83d',
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
}, STOCK_MATS);

// Drawn but never collided with: the car sinks through water instead of driving on it.
const NO_PHYSICS = ['Water', 'WaterSide', 'FxTurboB', 'FxSuperB', 'FxResetB', 'FxNoEngineB', 'FxNoBrakeB', 'FxNoSteerB', 'FxCruiseB', 'FxFragileB', 'FxReactorB', 'FxReactor2B', 'FxSlowB', 'FxUltraB', 'FxBumperB', 'FxBumper2B', 'VehGlyph', 'VehIconDark', 'VehSnowB', 'VehRallyB', 'VehDesertB', 'VehStadiumB'];
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
const grassSet = (a) => ({ GrassDeck: a, GrassDeckB: shade(a, 0.93), GrassSeam: shade(a, 0.76), GrassLine: lighten(a, 0.2) });
const litSlots = (slots) => slots.map((q) => ({ id: q.id, colors: litAll(q.colors, STOCK_MATS) }));
// Stock barriers recolour with the season the way stock roads do (main.bundle.js environment colours).
const BARRIER = { 2: { RoadBarrier: '#898989' }, 3: { RoadBarrier: '#211001' } };
// So does the bump road, which joins the stock road: its Road, RoadEdgeRed and RoadEdgeWhite per season.
const TECH = { 2: { TechDeck: '#5077b2', TechEdgeRed: '#1f3d6b', TechEdgeWhite: '#ffffff' }, 3: { TechDeck: '#997240', TechEdgeRed: '#5b2424', TechEdgeWhite: '#510808' } };
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
};
// part.f: the editor category, in TM_DATA.families order.
const FAMILIES = ['Plastic', 'Wood', 'Stadium', 'Ice', 'Water', 'Dirt', 'Grass'];
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

function main() {
  const reg = fs.existsSync(idsFile) ? JSON.parse(fs.readFileSync(idsFile, 'utf8')) : {};
  let nextId = Math.max(FIRST_ID - 1, ...Object.values(reg)) + 1;
  const parts = [...buildSurface('Plastic'), ...buildSurface('Wood'), ...buildShared(), ...buildIce(), ...buildSurface('Dirt'), ...buildSurface('Grass')];
  // Collision meshes: the same blocks built again without the surface patterns. The pattern strips are coplanar,
  // so they only cost the physics time; the plain mesh has the same shape with far fewer triangles.
  process.env.BE_PLAIN = '1';
  for (const k of Object.keys(require.cache)) if (k.includes(path.sep + 'blocks' + path.sep)) delete require.cache[k];
  const C = require('./catalog');
  const plain = new Map([...C.buildSurface('Plastic'), ...C.buildSurface('Wood'), ...require('./shared').buildShared(), ...require('./ice').buildIce(), ...C.buildSurface('Dirt'), ...C.buildSurface('Grass')].map((q) => [q.name, q.mesh]));
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
          if (p.tab == 'Deco' || NO_BOUNCE.includes(m) || isSoft(list[t], list[t + 1], list[t + 2])) skipped++;
          else bounce.push(...tri);
        }
      }
      if (pos.length / 3 > 65535) throw new Error('too many collision vertices in ' + p.name);
      const po = push(new Float32Array(pos)),
        io = push(new Uint16Array(ind));
      p.ph = [-1, po, pos.length, io, ind.length];
      if (skipped) p.bw = [-1, po, pos.length, push(new Uint16Array(bounce)), bounce.length];
      physTris += ind.length / 3;
    }
    totalTris += p.mesh.tris;
    if (p.mesh.tris > worst.tris) worst = { tris: p.mesh.tris, name: p.name };

    const f = SURFACE_INDEX[p.surface];
    const e = { n: p.name, i: reg[p.name], l: p.label, t: p.tab, s: p.sub, f, m: mats, b: [b.min.map((v) => +v.toFixed(2)), b.max.map((v) => +v.toFixed(2))], c: rasterTiles(p.mesh) };
    if (p.detector) e.d = p.detector;
    if (p.startOffset) e.o = p.startOffset;
    if (p.fx) e.x = p.fx;
    if (p.spawnDir) e.sd = p.spawnDir;
    // Hidden: kept for tracks that have it (it loads and works) but no longer offered in the editor's menu (tm_menu.js).
    if (p.hidden) e.h = 1;
    if (p.ph[4]) e.ph = p.ph;
    // Physics surface for the whole part (tm_runtime.js SURFACES): 0 plastic, 1 wood, 2 penalty grass, 3 ice,
    // 4 bobsleigh, 5 dirt, 6 grass, 8 tech; absent = stock physics.
    const u = p.u !== undefined ? p.u : (KIT_U[p.surface] ?? null);
    if (u != null) e.u = u;
    if (p.bw && u === 0) e.bw = p.bw;
    // Another surface inside this part (grass or dirt verges): boxes around its faces, in the part's own frame.
    // [lo, hi] is penalty grass, as it always was; any other surface is [lo, hi, u].
    const boxes = new Map();
    for (const [m, ru] of Object.entries(REGION_U)) {
      const l = p.mesh.byMat.get(m);
      if (!l || ru == u) continue;
      for (let i = 0; i < l.length; i += 3) {
        const lo = [0, 1, 2].map((k) => +(Math.min(l[i][k], l[i + 1][k], l[i + 2][k]) - 0.35).toFixed(2)),
          hi = [0, 1, 2].map((k) => +(Math.max(l[i][k], l[i + 1][k], l[i + 2][k]) + 0.35).toFixed(2));
        boxes.set(lo.join() + '|' + hi.join() + '|' + ru, ru == 2 ? [lo, hi] : [lo, hi, ru]);
      }
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
    // Tabs in menu order; any tab a block uses that is not listed goes at the end, in the order blocks use it.
    // Ice's own tabs come before the vehicle gates, so its browser still opens on the bobsleigh.
    tabs: [...new Set(['Road', 'Dirt road', 'Open road', 'Narrow road', 'Platform', 'Penalty grass', 'Walls and loops', 'Half-pipe', 'Gates', 'Box gates', 'Effects', 'Special gates', 'Bobsleigh', 'Bobsleigh gates', 'Bobsleigh effects', 'Ice platform', 'Ice walls and loops', 'Ice gates', 'Ice effects', 'Vehicle gates', 'Bump road', 'Connectors', 'Track walls', 'Structures', 'Stage and screens', 'Deco', 'Pools', 'Shallow water', ...table.map((p) => p.t)])],
    parts: table,
  };
  fs.writeFileSync(path.join(site, 'tm_parts.js'), '// Generated by tools/blocks/build.js. Do not edit by hand.\nself.TM_DATA = ' + JSON.stringify(data) + ';\n');

  // A readable list of everything in the catalogue, by surface, tab and section.
  const hidden = table.filter((p) => p.h).length;
  const lines = ['# Block list', '', 'Generated by tools/blocks/build.js. ' + (table.length - hidden) + ' blocks in the menu' + (hidden ? ', and ' + hidden + ' older ones that tracks can still have but the menu no longer offers (not listed here: the turbo roulette and the old reactor down and oriented plates)' : '') + '.', ''];
  for (const [f, surface] of FAMILIES.entries()) {
    const own = table.filter((p) => p.f == f && !p.h);
    lines.push('## ' + surface + ' (' + own.length + ')', '');
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
main();
