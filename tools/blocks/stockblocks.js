// The stock game's own blocks on the surface kits: every stock shape a kit has no piece for (the wide road, the Y
// junctions, plane and block corners, slopes into walls, bridges, plane walls, the wall track), with the exact stock
// geometry (stock/parts.js) so it joins stock blocks and each other the way the stock ones do. Only the look and the
// surface they drive as are the kit's.
const fs = require('fs');
const path = require('path');
const { Mesh, sub, cross, dot, len } = require('./geom');

// The stock blocks' menu layout (tab, heading, [[enum name, label]]) is the Road browser's, in tm_menu.js.
function roadLayout() {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'tm_menu.js'), 'utf8'),
    m = /const ROAD_LAYOUT = (\[[\s\S]*?\r?\n  \]);/.exec(src);
  if (!m) throw new Error('ROAD_LAYOUT not found in tm_menu.js');
  return new Function('return ' + m[1])();
}

// Kit pieces that already are these stock blocks, shape for shape: the kits with a railed road leave them out.
const SAME_AS_KIT = ['Straight', 'TurnSharp', 'TurnShort', 'TurnLong', 'TurnLong2', 'TurnLong3', 'IntersectionT', 'IntersectionCross', 'SlopeUp', 'SlopeDown', 'Slope', 'StraightTilted', 'TurnShortTilted', 'TurnLongTilted', 'TurnLong2Tilted', 'TurnLong3Tilted'];

// One look per kit. panels: the plastic lattice (5 x 5 panels in two shades, light seams); planks: wood.
// Dirt, grass, ice and snow are the plastic look with each material swapped for one of their own, so their copy of a
// shape is the same geometry and the block file stores it once.
const PLASTIC = { deck: 'PlasticDeck', deckB: 'PlasticDeckB', seam: 'PlasticSeam', line: 'PlasticLine', rail: 'PlasticRail', side: 'PlasticRail', under: 'PlasticUnder', solid: 'PlasticDeck', wall: 'PlasticRail', trim: 'PlasticKerb' };
const swap = (R) => Object.fromEntries(Object.entries(PLASTIC).map(([k, m]) => [k, R[m]]));
const WOOD_TONES = ['WoodDeckA', 'WoodDeckB', 'WoodDeckC', 'WoodDeckD'];
const plankTone = (n) => WOOD_TONES[(((n * 2654435761) >>> 0) % 7) % 4];
// road: the kit takes the stock road and turn pieces too (all: every one, its own road is not the railed road).
// tabs: where each of the stock browser's tabs goes in this kit's browser. say: the label of a piece.
const KITS = [
  { key: 'Plastic', surface: 'Plastic', look: PLASTIC, road: true, tabs: { Road: 'Road', Turns: 'Road', 'Wide road': 'Wide road', Planes: 'Platform', Blocks: 'Blocks', 'Wall track': 'Wall track' } },
  { key: 'Wood', surface: 'Wood', planks: true, look: { seam: 'WoodSeam', line: 'WoodBeam', rail: 'WoodBeam', side: 'WoodBeam', under: 'WoodUnder', solid: 'WoodDeckA', wall: 'WoodBeam', trim: 'WoodBeamB' }, road: true, tabs: { Road: 'Road', Turns: 'Road', 'Wide road': 'Wide road', Planes: 'Platform', Blocks: 'Blocks', 'Wall track': 'Wall track' } },
  { key: 'Dirt', surface: 'Dirt', look: swap({ PlasticDeck: 'DirtDeck', PlasticDeckB: 'DirtDeckB', PlasticSeam: 'DirtSeam', PlasticLine: 'DirtLine', PlasticRail: 'DirtRail', PlasticKerb: 'DirtKerb', PlasticUnder: 'DirtUnder' }), road: 'all', tabs: { Road: 'Railed road', Turns: 'Railed road', 'Wide road': 'Wide road', Planes: 'Platform', Blocks: 'Blocks', 'Wall track': 'Wall track' } },
  { key: 'Grass', surface: 'Grass', look: swap({ PlasticDeck: 'GrassDeck', PlasticDeckB: 'GrassDeckB', PlasticSeam: 'GrassSeam', PlasticLine: 'GrassLine', PlasticRail: 'GrassKerb', PlasticKerb: 'GrassKerbB', PlasticUnder: 'GrassSoil' }), road: 'all', tabs: { Road: 'Railed road', Turns: 'Railed road', 'Wide road': 'Wide road', Planes: 'Platform', Blocks: 'Blocks', 'Wall track': 'Wall track' } },
  { key: 'Ice', surface: 'Ice', u: 3, look: swap({ PlasticDeck: 'Ice', PlasticDeckB: 'IceB', PlasticSeam: 'IceLine', PlasticLine: 'IceLine', PlasticRail: 'IceRim', PlasticKerb: 'IceWall', PlasticUnder: 'IceUnder' }), road: false, say: (l) => 'Ice ' + l[0].toLowerCase() + l.slice(1), tabs: { Planes: 'Ice platform', Blocks: 'Ice blocks', 'Wall track': 'Ice wall track' } },
  { key: 'IceSnow', surface: 'Ice', u: 7, look: swap({ PlasticDeck: 'Snow', PlasticDeckB: 'SnowB', PlasticSeam: 'SnowLine', PlasticLine: 'SnowLine', PlasticRail: 'SnowRim', PlasticKerb: 'SnowSide', PlasticUnder: 'SnowUnder' }), road: false, say: (l) => 'Snow ' + l[0].toLowerCase() + l.slice(1), tabs: { Planes: 'Snow platform', Blocks: 'Snow blocks', 'Wall track': 'Snow wall track' } },
];

const normal = (a, b, c) => {
  const n = cross(sub(b, a), sub(c, a)),
    l = len(n);
  return l < 1e-9 ? [0, 0, 0] : [n[0] / l, n[1] / l, n[2] / l];
};

// Which triangles of one stock material are the driving face: every triangle reached from one facing up without
// crossing a sharp edge. A slab's top is, its sides and underside are not; a slope that curls up into a wall is, all
// the way up.
function topFaces(tris) {
  const key = (p) => p.map((v) => v.toFixed(3)).join(','),
    edges = new Map(),
    N = tris.map(([a, b, c]) => normal(a, b, c));
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const e = [key(t[k]), key(t[(k + 1) % 3])].sort().join('|');
      if (!edges.has(e)) edges.set(e, []);
      edges.get(e).push(i);
    }
  });
  const top = new Array(tris.length).fill(false),
    todo = [];
  N.forEach((n, i) => {
    if (n[1] > 0.5) {
      top[i] = true;
      todo.push(i);
    }
  });
  while (todo.length) {
    const i = todo.pop(),
      t = tris[i];
    for (let k = 0; k < 3; k++)
      for (const j of edges.get([key(t[k]), key(t[(k + 1) % 3])].sort().join('|')))
        if (!top[j] && dot(N[i], N[j]) > 0.7) {
          top[j] = true;
          todo.push(j);
        }
  }
  return { top, N };
}

// Splits a convex polygon along the plane p[axis] = c: [the part below, the part above] (either may be null).
function split(poly, axis, c) {
  const lo = [],
    hi = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      da = a[axis] - c,
      db = b[axis] - c;
    if (da <= 1e-9) lo.push(a);
    if (da >= -1e-9) hi.push(a);
    if ((da < -1e-9 && db > 1e-9) || (da > 1e-9 && db < -1e-9)) {
      const t = da / (da - db),
        m = [0, 1, 2].map((k) => (k == axis ? c : a[k] + (b[k] - a[k]) * t));
      lo.push(m);
      hi.push(m);
    }
  }
  return [lo.length >= 3 ? lo : null, hi.length >= 3 ? hi : null];
}
// Cuts polygons at every value in cuts(lo, hi) along an axis.
function slice(polys, axis, cuts) {
  let out = polys;
  const lo = Math.min(...polys.flatMap((p) => p.map((v) => v[axis]))),
    hi = Math.max(...polys.flatMap((p) => p.map((v) => v[axis])));
  for (const c of cuts(lo, hi)) {
    if (c <= lo + 1e-6 || c >= hi - 1e-6) continue;
    const next = [];
    for (const p of out) {
      const [a, b] = split(p, axis, c);
      if (a) next.push(a);
      if (b) next.push(b);
    }
    out = next;
  }
  return out;
}
const area = (p) => {
  let s = [0, 0, 0];
  for (let i = 1; i + 1 < p.length; i++) {
    const n = cross(sub(p[i], p[0]), sub(p[i + 1], p[0]));
    s = [s[0] + n[0], s[1] + n[1], s[2] + n[2]];
  }
  return len(s);
};
const centre = (p) => [0, 1, 2].map((k) => p.reduce((s, v) => s + v[k], 0) / p.length);
const every = (step, offs) => (lo, hi) => {
  const out = [];
  for (let k = Math.floor(lo / step) - 1; k <= Math.ceil(hi / step) + 1; k++) for (const o of offs) out.push(k * step + o);
  return out;
};

// Draws the kit's surface pattern onto one driving-face triangle. The pattern lies in the two axes the face spans most
// (a floor: across and along; a wall: along and up), so walls get panels and planks too.
function pattern(m, kit, tri, n) {
  const ax = Math.abs(n[1]) >= Math.abs(n[0]) && Math.abs(n[1]) >= Math.abs(n[2]) ? [0, 2] : Math.abs(n[2]) >= Math.abs(n[0]) ? [0, 1] : [2, 1];
  const emit = (mat, p) => {
    if (area(p) < 1e-5) return;
    for (let i = 1; i + 1 < p.length; i++) m.triFacing(mat, p[0], p[i], p[i + 1], n);
  };
  if (kit.planks) {
    // Planks 2.5 wide across the second axis, a dark seam at each, butt joints staggered from plank to plank.
    const [ja, pa] = ax;
    for (const p of slice([tri], pa, every(2.5, [0, 0.08]))) {
      const c = centre(p),
        k = Math.floor((c[pa] + 1e-6) / 2.5);
      if (c[pa] - k * 2.5 < 0.08) {
        emit(kit.look.seam, p);
        continue;
      }
      const joint = k % 2 ? 4.2 : -3;
      for (const q of slice([p], ja, () => [joint])) emit(plankTone(k * 2 + (centre(q)[ja] < joint ? 0 : 1)), q);
    }
    return;
  }
  // Panels 5 x 5 in two shades, a seam 0.1 wide along every joint.
  let polys = [tri];
  for (const a of ax) polys = slice(polys, a, every(5, [-0.05, 0.05]));
  for (const p of polys) {
    const c = centre(p),
      onSeam = ax.some((a) => Math.abs(c[a] - Math.round(c[a] / 5) * 5) < 0.05);
    emit(onSeam ? kit.look.seam : (Math.floor(c[ax[0]] / 5) + Math.floor(c[ax[1]] / 5)) % 2 ? kit.look.deckB : kit.look.deck, p);
  }
}

// One stock block in a kit's look.
function restyle(part, kit) {
  const m = new Mesh(),
    L = kit.look,
    plain = !!process.env.BE_PLAIN,
    byMat = new Map();
  for (const [mat, a, b, c] of part.tris) {
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat).push([a, b, c]);
  }
  const minY = Math.min(...part.tris.flatMap((t) => t.slice(1).map((p) => p[1])));
  for (const [mat, tris] of byMat) {
    if (mat == 'RoadEdgeRed' || mat == 'RoadEdgeWhite') for (const t of tris) m.tri(L.line, ...t);
    else if (mat == 'RoadBarrier') for (const t of tris) m.tri(L.rail, ...t);
    else if (mat == 'PlaneWall') for (const t of tris) m.tri(L.wall, ...t);
    else if (mat == 'PlaneWallDetail') for (const t of tris) m.tri(L.trim, ...t);
    else if (mat == 'WallTrackBottom') for (const t of tris) m.tri(L.under, ...t);
    else if (mat == 'WallTrackSides') for (const t of tris) m.tri(L.side, ...t);
    else if (mat == 'Road' || mat == 'BlockSurface' || mat == 'WallTrack') {
      const { top, N } = topFaces(tris);
      tris.forEach((t, i) => {
        if (mat == 'WallTrack' || top[i]) {
          if (plain) m.tri(L.solid, ...t);
          else pattern(m, kit, t, N[i]);
        } else if (N[i][1] < -0.99 && Math.max(t[0][1], t[1][1], t[2][1]) < minY + 0.01) m.tri(L.under, ...t); // the part's flat bottom
        else if (mat == 'Road') m.tri(N[i][1] < -0.5 ? L.under : L.side, ...t);
        else m.tri(L.solid, ...t);
      });
    } else throw new Error('stock material with no look: ' + mat + ' in ' + part.name);
  }
  return m;
}

// stock: loadStockParts()'s list. Returns the catalogue entries, kit by kit in the stock browser's order.
function buildStockBlocks(stock) {
  const byName = new Map(stock.map((p) => [p.name, p])),
    layout = roadLayout(),
    parts = [];
  for (const kit of KITS)
    for (const [tab, heading, list] of layout) {
      const T = kit.tabs[tab];
      if (!T) continue;
      if ((tab == 'Road' || tab == 'Turns') && !kit.road) continue;
      for (const [name, label] of list) {
        const p = byName.get(name);
        // Pieces "on a pillar" are the pillars themselves; planes are every kit's own platform.
        if (!p || p.gate || name.includes('Pillar') || name == 'Plane') continue;
        if (kit.road === true && SAME_AS_KIT.includes(name)) continue;
        parts.push({ name: kit.key + 'Stock' + name, label: kit.say ? kit.say(label) : label, tab: T, sub: heading, surface: kit.surface, mesh: restyle(p, kit), tiles: p.tiles, ...(kit.u != null ? { u: kit.u } : {}) });
      }
    }
  return parts;
}

module.exports = { buildStockBlocks };
