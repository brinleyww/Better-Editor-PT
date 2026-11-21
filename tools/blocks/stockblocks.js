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
// stripes: grass is mown in stripes instead (5 wide along the piece, light and dark across it, no seams), as its kit is.
// road: the kit takes the stock road and turn pieces too (all: every one, its own road is not the railed road).
// tabs: where each of the stock browser's tabs goes in this kit's browser. say: the label of a piece.
const KITS = [
  { key: 'Plastic', surface: 'Plastic', look: PLASTIC, road: true, tabs: { Road: 'Road', Turns: 'Road', 'Wide road': 'Wide road', Planes: 'Platform', Blocks: 'Blocks', 'Wall track': 'Wall track' } },
  { key: 'Wood', surface: 'Wood', planks: true, look: { seam: 'WoodSeam', line: 'WoodBeam', rail: 'WoodBeam', side: 'WoodBeam', under: 'WoodUnder', solid: 'WoodDeckA', wall: 'WoodBeam', trim: 'WoodBeamB' }, road: true, tabs: { Road: 'Road', Turns: 'Road', 'Wide road': 'Wide road', Planes: 'Platform', Blocks: 'Blocks', 'Wall track': 'Wall track' } },
  { key: 'Dirt', surface: 'Dirt', look: swap({ PlasticDeck: 'DirtDeck', PlasticDeckB: 'DirtDeckB', PlasticSeam: 'DirtSeam', PlasticLine: 'DirtLine', PlasticRail: 'DirtRail', PlasticKerb: 'DirtKerb', PlasticUnder: 'DirtUnder' }), road: 'all', tabs: { Road: 'Railed road', Turns: 'Railed road', 'Wide road': 'Wide road', Planes: 'Platform', Blocks: 'Blocks', 'Wall track': 'Wall track' } },
  { key: 'Grass', surface: 'Grass', stripes: true, look: swap({ PlasticDeck: 'GrassDeck', PlasticDeckB: 'GrassDeckB', PlasticSeam: 'GrassSeam', PlasticLine: 'GrassLine', PlasticRail: 'GrassKerb', PlasticKerb: 'GrassKerbB', PlasticUnder: 'GrassSoil' }), road: 'all', tabs: { Road: 'Railed road', Turns: 'Railed road', 'Wide road': 'Wide road', Planes: 'Platform', Blocks: 'Blocks', 'Wall track': 'Wall track' } },
  { key: 'Ice', surface: 'Ice', u: 3, look: swap({ PlasticDeck: 'Ice', PlasticDeckB: 'IceB', PlasticSeam: 'IceLine', PlasticLine: 'IceLine', PlasticRail: 'IceRim', PlasticKerb: 'IceWall', PlasticUnder: 'IceUnder' }), road: false, say: (l) => 'Ice ' + l[0].toLowerCase() + l.slice(1), tabs: { Planes: 'Ice platform', Blocks: 'Ice blocks', 'Wall track': 'Ice wall track' } },
  { key: 'IceSnow', surface: 'Ice', u: 7, look: swap({ PlasticDeck: 'Snow', PlasticDeckB: 'SnowB', PlasticSeam: 'SnowLine', PlasticLine: 'SnowLine', PlasticRail: 'SnowRim', PlasticKerb: 'SnowSide', PlasticUnder: 'SnowUnder' }), road: false, say: (l) => 'Snow ' + l[0].toLowerCase() + l.slice(1), tabs: { Planes: 'Snow platform', Blocks: 'Snow blocks', 'Wall track': 'Snow wall track' } },
  // Penalty grass blocks: the stock block shapes in the stadium grass (2-unit checker, soil sides), driving as
  // penalty grass. They go in the Stadium kit's Penalty grass tab, under headings of their own.
  { key: 'StadiumGrass', surface: 'Stadium', u: 2, checker: 2, look: { deck: 'Grass', deckB: 'GrassB', seam: 'Grass', line: 'Grass', rail: 'GrassUnder', side: 'GrassUnder', under: 'GrassUnder', solid: 'GrassUnder', wall: 'GrassUnder', trim: 'GrassUnder' }, road: false, skip: ['Bridges'], say: (l) => 'Grass ' + l[0].toLowerCase() + l.slice(1), head: (h) => (h == 'Blocks' ? 'Grass blocks' : 'Grass blocks, ' + h.toLowerCase()), tabs: { Blocks: 'Penalty grass' } },
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
  if (kit.checker) {
    // A plain checker, kit.checker wide, the way the stadium grass is drawn.
    const k = kit.checker;
    let polys = [tri];
    for (const a of ax) polys = slice(polys, a, every(k, [0]));
    for (const p of polys) {
      const c = centre(p);
      emit((Math.floor(c[ax[0]] / k) + Math.floor(c[ax[1]] / k)) % 2 ? kit.look.deckB : kit.look.deck, p);
    }
    return;
  }
  // Panels 5 x 5 in two shades, a seam 0.1 wide along every joint.
  if (kit.stripes) {
    // Mown stripes: cut only where the stripes change.
    for (const p of slice([tri], ax[0], every(5, [0]))) emit(Math.floor(centre(p)[ax[0]] / 5) % 2 ? kit.look.deckB : kit.look.deck, p);
    return;
  }
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

// ---- solid blocks of our own ------------------------------------------------------------------------------------
// Drawn like the stock blocks (one tile = 20 x 20, one layer = 5, solid down to the layer's floor, pieces longer than a
// tile reaching towards -z and climbing towards -z like the stock long slopes) in the stock block material, so restyle
// gives each kit its look and driving face.
// h(x, z): the top's height over the floor. xs, zs: the grid lines the top is drawn on (the sides follow the same).
function solidTris(h, xs, zs) {
  const tris = [],
    tri = (a, b, c, want) => {
      const n = cross(sub(b, a), sub(c, a));
      if (len(n) < 1e-9) return;
      tris.push(dot(n, want) < 0 ? ['BlockSurface', a, c, b] : ['BlockSurface', a, b, c]);
    },
    quad = (a, b, c, d, want) => {
      tri(a, b, c, want);
      tri(a, c, d, want);
    },
    P = (x, z) => [x, h(x, z), z];
  const UP = [0, 1, 0];
  for (let i = 0; i + 1 < xs.length; i++)
    for (let j = 0; j + 1 < zs.length; j++) {
      const [x0, x1, z0, z1] = [xs[i], xs[i + 1], zs[j], zs[j + 1]],
        a = P(x0, z0),
        b = P(x1, z0),
        c = P(x1, z1),
        d = P(x0, z1),
        mid = h((x0 + x1) / 2, (z0 + z1) / 2);
      // Split along the diagonal that follows the surface (the crease of a corner piece runs along one).
      if (Math.abs((a[1] + c[1]) / 2 - mid) <= Math.abs((b[1] + d[1]) / 2 - mid)) quad(a, b, c, d, UP);
      else quad(b, c, d, a, UP);
    }
  const X0 = xs[0],
    X1 = xs[xs.length - 1],
    Z0 = zs[0],
    Z1 = zs[zs.length - 1];
  const wall = (pts, want) => {
    for (let k = 0; k + 1 < pts.length; k++) {
      const [p, q] = [pts[k], pts[k + 1]];
      quad([p[0], 0, p[1]], [q[0], 0, q[1]], P(q[0], q[1]), P(p[0], p[1]), want);
    }
  };
  wall(zs.map((z) => [X0, z]), [-1, 0, 0]);
  wall(zs.map((z) => [X1, z]), [1, 0, 0]);
  wall(xs.map((x) => [x, Z0]), [0, 0, -1]);
  wall(xs.map((x) => [x, Z1]), [0, 0, 1]);
  quad([X0, 0, Z0], [X1, 0, Z0], [X1, 0, Z1], [X0, 0, Z1], [0, -1, 0]);
  return tris;
}
const steps = (a, b, n) => Array.from({ length: n + 1 }, (_, k) => a + ((b - a) * k) / n);

// Gentle slopes: a quarter grade, one layer per tile, the grade of the platform kits' gentle slopes. The start and
// end ease the grade in over two tiles; the corners join two slopes at right angles.
const SOLIDS = (() => {
  const out = [],
    g = 0.25,
    L = 40,
    rise = g * 20,
    S = 'Gentle slopes',
    put = (name, label, heading, h, xs, zs) => out.push({ name, label, heading, tris: solidTris(h, xs, zs) });
  const one = steps(-10, 10, 8),
    fine = steps(-10, 10, 16);
  put('BlockGentleStart', 'Gentle slope, start', S, (x, z) => (g * (10 - z) ** 2) / (2 * L), [-10, 10], steps(-30, 10, 16));
  put('BlockGentle', 'Gentle slope', S, (x, z) => g * (10 - z), [-10, 10], [-10, 10]);
  put('BlockGentleEnd', 'Gentle slope, end', S, (x, z) => g * (10 - z) - (g * (10 - z) ** 2) / (2 * L), [-10, 10], steps(-30, 10, 16));
  const a = (x) => ((10 - x) / 20) * rise,
    b = (z) => ((10 - z) / 20) * rise;
  put('BlockGentleOuter', 'Gentle slope, outer corner', S, (x, z) => Math.min(a(x), b(z)), one, one);
  put('BlockGentleInner', 'Gentle slope, inner corner', S, (x, z) => Math.max(a(x), b(z)), one, one);
  put('BlockGentleCone', 'Gentle slope, rounded outer', S, (x, z) => Math.max(0, 1 - Math.hypot(x + 10, z + 10) / 20) * rise, fine, fine);
  put('BlockGentleBowl', 'Gentle slope, rounded inner', S, (x, z) => Math.min(1, Math.hypot(x - 10, z - 10) / 20) * rise, fine, fine);
  // One big block: 3 tiles across, 4 long, one layer tall.
  put('Block3x4', 'Block, 3 x 4', 'Big blocks', () => 5, [-30, 30], [-70, 10]);
  return out;
})();

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
      if (kit.skip?.includes(heading)) continue;
      const say = (l) => (kit.say ? kit.say(l) : l),
        head = (h) => (kit.head ? kit.head(h) : h),
        u = kit.u != null ? { u: kit.u } : {};
      for (const [name, label] of list) {
        const p = byName.get(name);
        // Pieces "on a pillar" are the pillars themselves; planes are every kit's own platform.
        if (!p || p.gate || name.includes('Pillar') || name == 'Plane') continue;
        if (kit.road === true && SAME_AS_KIT.includes(name)) continue;
        parts.push({ name: kit.key + 'Stock' + name, label: say(label), tab: T, sub: head(heading), surface: kit.surface, mesh: restyle(p, kit), tiles: p.tiles, ...u });
      }
      // The kit's own solid blocks the stock game has no shape for, right after the stock blocks they join.
      if (tab == 'Blocks' && heading == 'Steep slopes')
        for (const s of SOLIDS) parts.push({ name: kit.key + s.name, label: say(s.label), tab: T, sub: head(s.heading), surface: kit.surface, mesh: restyle({ name: s.name, tris: s.tris }, kit), ...u });
    }
  return parts;
}

module.exports = { buildStockBlocks };
