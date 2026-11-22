// Ground that hugs the road, for Auto deco (tm_autodeco.js): for every driving part (stock and ours), the stock
// Block-category pieces whose top surface runs right under its deck, measured from the meshes. Every road, platform
// and plane is a thin deck (0.21 thick) over shapes the stock blocks share (flat, 1:2 and 1:4 slopes, quarter-pipe
// feet...), so ground built from these follows the road exactly, with no staircase under a ramp.
//
// For each part at rotation 0: sample the highest surface over a 1-unit grid; try every candidate block, in every
// rotation, on every 4 x 4 cell of the part's footprint and every layer it spans; keep a candidate only if its top
// never rises above the deck's underside where the deck is; then pick candidates greedily by how many deck points
// they meet within GAP of the underside, without two candidates sharing a tile. Parts the blocks can't follow (loops,
// wall rides, pipes, banked turns) get nothing, and the editor leaves the ground under them alone.
//
// node tools/autodeco/twins.js  ->  tools/autodeco/twins.json  (read by tools/autodeco/data.js)
const fs = require('fs');
const path = require('path');
const { loadStockParts } = require('../blocks/stock/parts.js');

const ROOT = path.join(__dirname, '..', '..');
global.self = {};
require(path.join(ROOT, 'tm_parts.js'));
const D = self.TM_DATA;
const STOCK_IDS = require('./stock_ids.json');

const DECK = 0.21; // deck thickness: a twin's top is this far under the road surface
const GAP = 0.75; // a deck point counts as met when the twin's top is within this of the surface
const MIN_COVER = 0.5; // parts whose deck is less than this much met get no twin

// The stock blocks tried, simplest first (ties go to the earlier one).
const BLOCKS = [
  'Block', 'BlockSlopeUp', 'BlockSlopeDown', 'BlockSlopeUpLong', 'BlockSlopeDownLong', 'BlockSlopedUp', 'BlockSlopedDown',
  'BlockSlopeVerticalBottom', 'BlockSlopeToVertical', 'HalfBlock', 'QuarterBlock', 'BlockInnerCorner', 'BlockOuterCorner',
  'BlockSlopedUpInnerCorner', 'BlockSlopedUpOuterCorner', 'BlockSlopedDownInnerCorner', 'BlockSlopedDownOuterCorner',
  'HalfBlockSlopeBottomLeft', 'HalfBlockSlopeBottomRight', 'HalfBlockSlopeTopLeft', 'HalfBlockSlopeTopRight',
];
const STOCK_DRIVING = new Set(['Road', 'RoadWide', 'RoadTurns', 'Special', 'Plane']);
const STOCK_SKIP = /Pillar|Wall|Bridge|Sign/;
// Tabs whose pieces may fold over themselves (loops, wall rides): checked with folds() first.
const FOLD_TABS = new Set(['Walls and loops', 'Ice walls and loops', 'Bobsleigh', 'Magnet']);
// Quarter-pipe feet, by name (the sampled fit trips on their vertical edge).
const SAME = {
  SlopeUpVertical: 'BlockSlopeVerticalBottom', SlopeUpVerticalLeftWide: 'BlockSlopeVerticalBottom', SlopeUpVerticalRightWide: 'BlockSlopeVerticalBottom',
  PlaneSlopeVerticalBottom: 'BlockSlopeVerticalBottom', SlopeToVertical: 'BlockSlopeToVertical', SlopeToVerticalLeftWide: 'BlockSlopeToVertical',
  SlopeToVerticalRightWide: 'BlockSlopeToVertical', PlaneSlopeToVertical: 'BlockSlopeToVertical',
};
// Our tabs that hold no road (solid blocks are ground already; deco and structures are scenery).
const BE_SKIP_TABS = new Set(['Deco', 'Blocks', 'Ice blocks', 'Snow blocks', 'Structures', 'Stage and screens', 'Track walls', 'Wall track', 'Ice wall track', 'Snow wall track', 'Pipes', 'Pools']);

// The game's tile rotation (module 5494.sR) for axis 0.
function rotTile(x, y, z, r) {
  switch (r) {
    case 1: return [z, y, -x - 1];
    case 2: return [-x - 1, y, -z - 1];
    case 3: return [-z - 1, y, x];
  }
  return [x, y, z];
}
// A vertex (world units, part frame) turned like the part: local (x, z) -> r1 (z, -x).
function rotVec(x, z, r) {
  for (let k = 0; k < r; k++) [x, z] = [z, -x];
  return [x, z];
}
const boxTiles = (boxes) => {
  const out = [];
  for (const [[x0, y0, z0], [x1, y1, z1]] of boxes) for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) out.push([x, y, z]);
  return out;
};

// Surface over each sample point (x + 0.5, z + 0.5): Map "ix,iz" -> y. tris: [[x,y,z] x 3] per triangle.
// lowest: the top of the lowest sheet there (everything within SHEET of the lowest triangle): a gate's deck, not its
// arch. Otherwise the highest surface (a solid block's top).
const SHEET = 1.2;
function topField(tris, rot = 0, lowest = false) {
  const f = new Map();
  for (const t of tris) {
    const p = t.map(([x, y, z]) => {
      const [a, b] = rotVec(x, z, rot);
      return [a, y, b];
    });
    const [a, b, c] = p;
    const d = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
    if (Math.abs(d) < 1e-9) continue;
    const xs = p.map((q) => q[0]),
      zs = p.map((q) => q[2]);
    for (let ix = Math.ceil(Math.min(...xs) - 0.5); ix + 0.5 <= Math.max(...xs); ix++)
      for (let iz = Math.ceil(Math.min(...zs) - 0.5); iz + 0.5 <= Math.max(...zs); iz++) {
        const x = ix + 0.5,
          z = iz + 0.5;
        const u = ((x - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (z - a[2])) / d,
          w = ((b[0] - a[0]) * (z - a[2]) - (x - a[0]) * (b[2] - a[2])) / d;
        if (u < -1e-6 || w < -1e-6 || u + w > 1 + 1e-6) continue;
        const y = a[1] + u * (b[1] - a[1]) + w * (c[1] - a[1]);
        const k = ix + ',' + iz;
        if (lowest) {
          const s = f.get(k);
          s ? s.push(y) : f.set(k, [y]);
        } else if (!(f.get(k) >= y)) f.set(k, y);
      }
  }
  if (lowest)
    for (const [k, s] of f) {
      const lo = Math.min(...s);
      let hi = lo;
      for (const y of s) if (y <= lo + SHEET && y > hi) hi = y;
      f.set(k, hi);
    }
  return f;
}
// Does the surface fold over itself (a loop, a pipe, a wall ride)? Then the highest surface is not the road's.
function folds(tris) {
  const up = new Map();
  for (const t of tris) {
    const [a, b, c] = t;
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const n = Math.hypot(nx, ny, nz);
    if (n < 1e-9 || ny / n > -0.3) continue; // faces pointing down: a deck's underside
    const k = Math.round((a[0] + b[0] + c[0]) / 3 / 2) + ',' + Math.round((a[2] + b[2] + c[2]) / 3 / 2);
    const y = (a[1] + b[1] + c[1]) / 3;
    const s = up.get(k) ?? [];
    s.push(y);
    up.set(k, s);
  }
  // Two undersides more than 2 units apart over one spot.
  for (const s of up.values()) if (Math.max(...s) - Math.min(...s) > 2) return true;
  return false;
}

async function main() {
  const stock = await loadStockParts();
  const stockByName = new Map(stock.map((p) => [p.name, p]));
  const triList = (p) => p.tris.map((t) => t.slice(1));

  // Candidate blocks: their top field and tiles in each rotation.
  const cands = [];
  for (const name of BLOCKS) {
    const p = stockByName.get(name);
    if (!p) throw new Error('no stock block ' + name);
    const tris = triList(p);
    for (let r = 0; r < 4; r++) {
      const tiles = boxTiles(p.tiles).map(([x, y, z]) => rotTile(x, y, z, r));
      cands.push({ name, id: STOCK_IDS[name], r, field: topField(tris, r), tiles, cost: BLOCKS.indexOf(name) });
    }
  }

  // The parts to fit: stock driving parts, and ours with a road.
  const jobs = [];
  for (const p of stock) {
    if (!STOCK_DRIVING.has(p.category) || STOCK_SKIP.test(p.name)) continue;
    jobs.push({ id: STOCK_IDS[p.name], name: p.name, stock: p.name, tris: triList(p), tiles: boxTiles(p.tiles) });
  }
  const bin = fs.readFileSync(path.join(ROOT, 'models', 'tm_blocks.bin'));
  const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
  const noPhysics = new Set(D.noPhysics ?? []);
  const meshTris = (m) => {
    const P = new Float32Array(buf, m[1], m[2]),
      I = new Uint16Array(buf, m[3], m[4]),
      out = [];
    for (let i = 0; i < I.length; i += 3) out.push([0, 1, 2].map((k) => [P[I[i + k] * 3], P[I[i + k] * 3 + 1], P[I[i + k] * 3 + 2]]));
    return out;
  };
  for (const p of D.parts) {
    if (BE_SKIP_TABS.has(p.t) || !p.c) continue;
    const meshes = p.ph ? [p.ph] : p.m.filter((m) => !noPhysics.has(m[0]));
    if (!meshes.length) continue;
    jobs.push({ id: p.i, name: p.n, stock: /Stock([A-Za-z]+)$/.exec(p.n)?.[1], fold: FOLD_TABS.has(p.t), tris: meshes.flatMap(meshTris), tiles: boxTiles(p.c) });
  }

  const out = {};
  let fitted = 0;
  const t0 = Date.now();
  for (const [n, job] of jobs.entries()) {
    if (n % 200 == 0) console.log(n + '/' + jobs.length, ((Date.now() - t0) / 1000).toFixed(0) + ' s');
    if (SAME[job.stock]) {
      out[job.id] = { n: job.name, c: 1, t: [[STOCK_IDS[SAME[job.stock]], 0, 0, 0, 0]] };
      fitted++;
      continue;
    }
    if (job.tris.length > 40000 || (job.fold && folds(job.tris))) continue;
    const deck = topField(job.tris, 0, true);
    if (deck.size < 8) continue;
    const own = new Set(job.tiles.map((t) => t.join()));
    const xs = job.tiles.map((t) => t[0]),
      ys = job.tiles.map((t) => t[1]),
      zs = job.tiles.map((t) => t[2]);
    const [x0, x1, y0, y1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), Math.min(...zs), Math.max(...zs)];
    // Placements: cell origins on the part's own 4-tile grid, layers from one under the part to its top.
    const options = [];
    for (let ox = x0 + 2; ox <= x1 + 2; ox += 4)
      for (let oz = z0 + 2; oz <= z1 + 2; oz += 4)
        for (let dy = y0 - 1; dy <= y1; dy++)
          for (const c of cands) {
            const tiles = c.tiles.map(([x, y, z]) => [x + ox, y + dy, z + oz]);
            // Inside the part's footprint (any layer from one under it).
            if (!tiles.every(([x, , z]) => x >= x0 && x <= x1 && z >= z0 && z <= z1)) continue;
            let ok = true,
              met = [];
            for (const [k, by] of c.field) {
              const [ix, iz] = k.split(',').map(Number);
              const kk = ix + ox * 5 + ',' + (iz + oz * 5);
              const ry = deck.get(kk);
              if (ry === undefined) continue;
              const y = by + dy * 5;
              if (y > ry - DECK + 0.02) {
                ok = false;
                break;
              }
              if (ry - y <= GAP) met.push(kk);
            }
            if (!ok || met.length < 4) continue;
            options.push({ c, ox, dy, oz, tiles, met });
          }
    const covered = new Set(),
      taken = new Set(),
      chosen = [];
    for (;;) {
      let best = null,
        bestN = 0;
      for (const o of options) {
        if (o.tiles.some((t) => taken.has(t.join()))) continue;
        let n = 0;
        for (const k of o.met) if (!covered.has(k)) n++;
        if (n > bestN || (n == bestN && best && o.c.cost < best.c.cost)) {
          best = o;
          bestN = n;
        }
      }
      if (!best || bestN < Math.max(4, deck.size * 0.03)) break;
      chosen.push(best);
      for (const k of best.met) covered.add(k);
      for (const t of best.tiles) taken.add(t.join());
    }
    const cover = covered.size / deck.size;
    if (cover < MIN_COVER) continue;
    fitted++;
    out[job.id] = { n: job.name, c: +cover.toFixed(2), t: chosen.map((o) => [o.c.id, o.ox, o.dy, o.oz, o.c.r]) };
  }
  fs.writeFileSync(path.join(__dirname, 'twins.json'), JSON.stringify(out));
  console.log('fitted', fitted, 'of', jobs.length, 'in', ((Date.now() - t0) / 1000).toFixed(0), 's');
  for (const n of ['Straight', 'SlopeUp', 'Slope', 'SlopeUpLong', 'TurnShort', 'StraightTilted', 'PlasticRoadStraight', 'PlasticStockSlopeUpLong'])
    console.log(n, JSON.stringify(Object.values(out).find((v) => v.n == n)));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
