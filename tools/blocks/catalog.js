// The block catalogue: every generated part for one surface, grouped the way the editor menu shows them.
// A part is { name, label, tab, sub, mesh, detector?, startOffset?, fx? }.
const G = require('./geom');
const { Mesh, hPath, roadRings, loopRings, wallRings, sweep, patch, prism, add, mul, norm, TAU } = G;

const HALF_ROAD = 6.5667; // stock road half width, measured from the shipped road model
const DECK = 0.21; // stock slab thickness
const RAIL_IN = 5.5667;
const LINE_IN = 5.18;
const RAIL_TOP = 0.942;
const PLANK = 2.5;
const DEG = Math.PI / 180;
const TILT = Math.atan(0.5); // stock banked road is 1:2
const hermite = (a, b, ga, gb, L) => (s) => {
  const t = Math.min(1, Math.max(0, s / L)),
    t2 = t * t,
    t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * ga * L + (-2 * t3 + 3 * t2) * b + (t3 - t2) * gb * L;
};
const smooth = (t) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

// Surface patterns, drawn with coplanar strips of colour so they never change how the deck drives.
// lateral(inner): x positions where the deck top is cut; mat(ring, xMid, width): colour of one strip of deck.
const inBand = (ring, P) => ring.next - ring.s <= P.band + 1e-3 && ((ring.s + 1e-6) % P.period) < P.band + 1e-3;
const plankTone = (n) => ['WoodDeckA', 'WoodDeckB', 'WoodDeckC', 'WoodDeckD'][((n * 2654435761) >>> 0) % 7 % 4];
const PATTERNS = {
  // Plastic: big moulded panels, 5 x 5, in two close shades with light seams between them.
  plastic: {
    period: 5,
    band: 0.1,
    lateral: (inner) => {
      const out = [];
      for (let x = -15; x <= 15; x += 5) if (Math.abs(x) < inner - 0.6) out.push(x + 0.05, x - 0.05);
      return out;
    },
    mat: (ring, x, width) => {
      if (width < 0.2 || inBand(ring, PATTERNS.plastic)) return 'PlasticSeam';
      return (Math.floor((x + 50) / 5) + Math.floor((ring.s + 1e-6) / 5)) % 2 ? 'PlasticDeckB' : 'PlasticDeck';
    },
  },
  // Wood: planks across the road, four tones, dark seams, butt joints staggered from plank to plank.
  wood: {
    period: PLANK,
    band: 0.08,
    lateral: (inner) => [inner * 0.42, -inner * 0.3],
    mat: (ring, x, width, inner) => {
      if (inBand(ring, PATTERNS.wood)) return 'WoodSeam';
      const n = Math.floor((ring.s + 1e-6) / PLANK),
        joint = n % 2 ? inner * 0.42 : -inner * 0.3;
      void width;
      return plankTone(n * 2 + (x < joint ? 0 : 1));
    },
  },
  // Penalty grass: mowed checker, 5 x 5.
  grass: {
    period: 5,
    band: 0,
    lateral: (inner) => {
      const out = [];
      for (let x = -15; x <= 15; x += 5) if (Math.abs(x) < inner - 0.6) out.push(x);
      return out;
    },
    mat: (ring, x) => ((Math.floor((x + 50) / 5) + Math.floor((ring.s + 1e-6) / 5)) % 2 ? 'GrassB' : 'Grass'),
  },
};

// Kerbs and rails alternate colour every k units along the road.
const every = (k) => (ring) => Math.floor((ring.s + 1e-6) / k) % 2 == 0;
// One entry per kit. plastic: drawn on the plastic panel lattice (rings every 5, plastic rail tops).
// Dirt and Grass are the plastic lattice with every plastic material swapped for one of their own, one for one,
// so a shape they share with plastic is the same geometry and build.js stores it once; only their own pieces
// (dirt berms, the narrow road, deco) cost bin space.
const STYLES = {
  Plastic: () => ({
    plastic: true,
    pattern: PATTERNS.plastic,
    deck: (ring) => (Math.floor((ring.s + 1e-6) / 5) % 2 ? 'PlasticDeckB' : 'PlasticDeck'),
    patchMat: (i, j) => (((i >> 1) + (j >> 1)) % 2 ? 'PlasticDeckB' : 'PlasticDeck'),
    line: () => 'PlasticLine',
    rail: (ring) => (every(2.5)(ring) ? 'PlasticRail' : 'PlasticKerb'),
    railTop: (ring) => (every(2.5)(ring) ? 'PlasticRail' : 'PlasticKerb'),
    side: 'PlasticRail',
    posts: false,
    under: 'PlasticUnder',
    solid: 'PlasticDeck',
    solidB: 'PlasticRail',
    trim: 'PlasticLine',
    wallMat: () => 'PlasticDeck',
    deco: 'plastic',
    tower: 'Truss tower, 4 layers',
    fence: 'Fence, plastic rails',
  }),
  Wood: () => ({
    plastic: false,
    pattern: PATTERNS.wood,
    deck: (ring) => plankTone(Math.floor((ring.s + 1e-6) / PLANK)),
    patchMat: (i) => plankTone(i),
    line: () => 'WoodBeam',
    rail: (ring) => (every(5)(ring) ? 'WoodBeam' : 'WoodBeamB'),
    railTop: () => 'WoodBeamB',
    side: 'WoodBeam',
    posts: true,
    under: 'WoodUnder',
    solid: 'WoodDeckA',
    solidB: 'WoodBeam',
    trim: 'WoodBeamB',
    wallMat: (i) => (i % 2 ? 'WoodDeckB' : 'WoodDeckA'),
    deco: 'wood',
    tower: 'Trestle tower, 4 layers',
    fence: 'Fence, wooden rails',
  }),
  // TM2020 dirt: packed brown earth in two close tones, dark ruts where plastic has light seams, wooden kerbs.
  Dirt: () => ({
    ...relabel(STYLES.Plastic(), { PlasticDeck: 'DirtDeck', PlasticDeckB: 'DirtDeckB', PlasticSeam: 'DirtSeam', PlasticLine: 'DirtLine', PlasticRail: 'DirtRail', PlasticKerb: 'DirtKerb', PlasticUnder: 'DirtUnder' }),
    berm: (ring) => (every(5)(ring) ? 'DirtBerm' : 'DirtBermB'),
    deco: 'dirt',
    tower: 'Trestle tower, 4 layers',
    fence: 'Fence, wooden rails',
  }),
  // TM2020 grass platform: mown grass in stripes, darker mowing lines, dark hedge kerbs over brown soil.
  Grass: () => ({
    ...relabel(STYLES.Plastic(), { PlasticDeck: 'GrassDeck', PlasticDeckB: 'GrassDeckB', PlasticSeam: 'GrassSeam', PlasticLine: 'GrassLine', PlasticRail: 'GrassKerb', PlasticKerb: 'GrassKerbB', PlasticUnder: 'GrassSoil' }),
    deco: 'grass',
    tower: 'Truss tower, 4 layers',
    fence: 'Fence',
  }),
};
// A style with every material swapped through R, the geometry left exactly as it was.
function relabel(base, R) {
  const swap = (f) => (...a) => R[f(...a)];
  const P = base.pattern;
  return {
    ...base,
    pattern: P && { ...P, mat: swap(P.mat) },
    ...Object.fromEntries(['deck', 'patchMat', 'line', 'rail', 'railTop', 'wallMat'].map((k) => [k, swap(base[k])])),
    ...Object.fromEntries(['side', 'under', 'solid', 'solidB', 'trim'].map((k) => [k, R[base[k]]])),
  };
}

function styleFor(surface) {
  const st = { surface, ...STYLES[surface]() };
  // BE_PLAIN builds the plain collision meshes: same shapes, no pattern cuts (see build.js).
  if (process.env.BE_PLAIN) st.pattern = null;
  return st;
}

// ---- cross sections (all counter-clockwise, x to the right of travel, y up from the slab bottom) -------------

// decal (see stockDecal): floor markings painted onto the deck, which is cut along their edges.
function deckPoly(st, w, y, line, paint, decal) {
  const inner = w - line,
    P = st.pattern;
  // The deck top is cut where the surface pattern needs it, right to left.
  const cut = [...(P ? P.lateral(inner) : []), ...(decal ? decal.xs : [])].filter((x) => x > -inner + 0.05 && x < inner - 0.05).sort((a, b) => b - a);
  const cuts = cut.filter((x, i) => i == 0 || cut[i - 1] - x > 1e-3);
  const pts = [[-w, 0], [w, 0], [w, y], [inner, y], ...cuts.map((x) => [x, y]), [-inner, y], [-w, y]],
    n = pts.length;
  const mark = (e, ring) => decal?.at((pts[e][0] + pts[e + 1][0]) / 2, (ring.s + ring.next) / 2) ?? null;
  return {
    pts,
    cap: st.under,
    mats: (e, ring) => {
      if (e == 0) return st.under;
      if (e == 1 || e == n - 1) return st.side ?? st.under;
      if (e == 2 || e == n - 2) return mark(e, ring) ?? paint?.(ring, true) ?? st.line(ring);
      const x0 = pts[e][0],
        x1 = pts[e + 1][0];
      return mark(e, ring) ?? paint?.(ring) ?? (P ? P.mat(ring, (x0 + x1) / 2, x0 - x1, inner) : st.deck(ring));
    },
  };
}

// ---- stock gates ---------------------------------------------------------------------------------------------
// Start, checkpoint and finish copy the stock gates (stock/gates.json, from the game's own models): the posts,
// banners and floor markings are stock, only the deck under them is this surface. Road gates get stock barriers.
const STOCK = require('./stock/gates.json');
const inTri = (x, s, t) => {
  const d = (ax, as, bx, bs) => (x - bx) * (as - bs) - (ax - bx) * (s - bs),
    a = d(t[1], t[2], t[3], t[4]),
    b = d(t[3], t[4], t[5], t[6]),
    c = d(t[5], t[6], t[1], t[2]);
  return !((a < -1e-9 || b < -1e-9 || c < -1e-9) && (a > 1e-9 || b > 1e-9 || c > 1e-9));
};
// The floor markings of a stock gate: their edges (xs across, ss along) and the material at (x, s), or null.
// dx and ds move them, for gates swept somewhere other than the stock gate's own frame.
function stockDecal(fam, kind, dx = 0, ds = 0) {
  const tris = STOCK[fam][kind].decals,
    xs = new Set(),
    ss = new Set();
  for (const t of tris)
    for (let k = 0; k < 3; k++) {
      xs.add(+(t[1 + 2 * k] + dx).toFixed(4));
      ss.add(+(t[2 + 2 * k] + ds).toFixed(4));
    }
  return {
    xs: [...xs],
    ss: [...ss],
    at: (x, s) => {
      for (const t of tris) if (inTri(x - dx, s - ds, t)) return t[0];
      return null;
    },
  };
}
// kind: Start, Checkpoint or Finish. key: Road, Open, Plat, PlatWide or Wall; Dirt and Narrow are the stock road
// gate on the banked dirt road and the narrow dirt road.
// opt: y, roll, segs, start, step and ds for the road it stands on, and place(p) to move the stock posts onto it.
function stockGate(st, kind, key, opt = {}) {
  const banked = key == 'Dirt' || key == 'Narrow',
    fam = key == 'Road' || key == 'Open' || banked ? 'Road' : key == 'PlatWide' ? 'PlaneWide' : 'Plane',
    wide = key == 'PlatWide',
    decal = stockDecal(fam, kind, wide ? -10 : 0, opt.ds ?? 0),
    barrier = { ...st, rail: () => 'RoadBarrier', railTop: () => 'RoadBarrier' };
  const profile =
    key == 'Road'
      ? () => {
          const r = [railPoly(barrier, -1, RAIL_TOP), railPoly(barrier, 1, RAIL_TOP)];
          r[0].cap = r[1].cap = 'RoadBarrier';
          return [deckPoly(st, HALF_ROAD, DECK, 1.3867, null, decal), ...r];
        }
      : key == 'Open'
        ? () => [deckPoly(st, HALF_ROAD, DECK, 0.5, null, decal)]
        : banked
          ? () => {
              const B = key == 'Dirt' ? BERM : NARROW;
              return [deckPoly(st, B.x0, DECK, B.line, null, decal), ...bermSides(st, B, null, decal)];
            }
          : () => [deckPoly(st, wide ? 20 : 10, DECK, 0.5, null, decal)];
  // The stock road posts stand 5.55-6.17 out. On the narrow road they move in onto its banks, keeping their own
  // thickness, and the banner between them shrinks to fit.
  const D = 6.171 - (NARROW.x1 - 0.05),
    fit = key == 'Narrow' ? ([x, y, z]) => [Math.abs(x) >= 5.5 ? x - Math.sign(x) * D : (x * (5.5 - D)) / 5.5, y, z] : (p) => p;
  let m;
  if (key == 'Wall') {
    // Rings straight up the wall, cut where the markings start and stop.
    const hs = [...new Set([0, 5, 10, 15, 20, ...decal.ss])].sort((a, b) => a - b);
    m = swept(hs.map((h, i) => ({ p: [0, h, -10], R: [1, 0, 0], U: [0, 0, 1], T: [0, 1, 0], s: h, u: h / 20, i })), profile);
  } else m = roadPart(st, profile, opt.segs ?? [{ line: 20 }], { step: opt.step ?? 2.5, start: wide ? [10, 10, 0] : opt.start, y: opt.y, roll: opt.roll, marks: decal.ss });
  if (wide) m.byMat = shiftMesh(m, 10).byMat;
  // Stock: travel is -z with the gate at z = 0. On a wall the road climbs +y and the deck faces +z.
  const place = key == 'Wall' ? ([x, y, z]) => [x, 10 - z, -10 + y] : (opt.place ?? ((p) => p));
  // The arch is poles, not walls: a box round each post and round the banner keeps it from bouncing the car.
  const archPts = [[], [], []];
  for (const t of opt.arch === false ? [] : STOCK[fam][kind].arch) {
    const v = [0, 1, 2].map((k) => {
      const p = t.slice(1 + 3 * k, 4 + 3 * k);
      // Road posts start inside the barrier; with no barrier they stand on the deck (inside the bank on dirt).
      if ((key == 'Open' || banked) && p[1] < 1) p[1] = DECK;
      return place(fit(p));
    });
    m.tri(t[0], v[0], v[1], v[2]);
    const cx = (t[1] + t[4] + t[7]) / 3;
    archPts[cx < -2 ? 0 : cx > 2 ? 2 : 1].push(...v);
  }
  for (const pts of archPts) if (pts.length) softAround(m, pts, 0.05);
  return m;
}

// A round finish hoop, chequered like the stock finish banner: a square tube bent into a circle n blocks across.
// standing: the ring is cut where it meets the ground, its feet at the edges of the n blocks, centred on x = 0.
// floating: the whole ring, its bottom on the part's floor, for hoops in the air.
function hoopRing(m, n, standing) {
  const R = 10 * n - 0.5,
    tw = 0.7 + 0.2 * n, // tube width, across the ring
    d = 0.45, // tube depth, along the road
    feet = 10 * n - 1.5,
    yc = standing ? DECK + Math.sqrt(R * R - feet * feet) : DECK + R + tw / 2,
    a0 = standing ? -Math.asin(yc / (R + tw / 2)) : 0, // the outer edge meets the ground, nothing pokes below it
    a1 = standing ? Math.PI - a0 : 2 * Math.PI,
    segs = Math.max(24, Math.round(((a1 - a0) * R) / 1.1)),
    P = (a, r, z) => [Math.cos(a) * r, yc + Math.sin(a) * r, z];
  for (let i = 0; i < segs; i++) {
    const a = a0 + ((a1 - a0) * i) / segs,
      b = a0 + ((a1 - a0) * (i + 1)) / segs,
      ro = R + tw / 2,
      ri = R - tw / 2,
      mat = (k) => ((i + k) % 2 ? 'FinishWhite' : 'FinishBlack'),
      mid = (a + b) / 2,
      out = [Math.cos(mid), Math.sin(mid), 0];
    m.quadFacing(mat(0), P(a, ro, -d), P(b, ro, -d), P(b, ro, d), P(a, ro, d), out);
    m.quadFacing(mat(1), P(a, ri, -d), P(b, ri, -d), P(b, ri, d), P(a, ri, d), mul(out, -1));
    // The faces seen through the hoop: two chequer rows, inner and outer half of the tube.
    for (const [r0, r1, k] of [[ri, R, 0], [R, ro, 1]]) {
      m.quadFacing(mat(k), P(a, r0, d), P(b, r0, d), P(b, r1, d), P(a, r1, d), [0, 0, 1]);
      m.quadFacing(mat(k + 1), P(a, r0, -d), P(b, r0, -d), P(b, r1, -d), P(a, r1, -d), [0, 0, -1]);
    }
  }
  if (standing)
    for (const a of [a0, a1]) {
      // Flat feet where the ring meets the ground.
      const q = [P(a, R - tw / 2, -d), P(a, R + tw / 2, -d), P(a, R + tw / 2, d), P(a, R - tw / 2, d)];
      m.quadFacing('FinishBlack', ...q, [0, -1, 0]);
    }
  return { R, yc, feet };
}

// Finish hoops standing on a road, open road or platform, n blocks across (an expandable finish: pick the size).
function hoopGate(st, key, n) {
  const m = stockGate(st, 'Finish', key, { arch: false });
  hoopRing(m, n, true);
  return m;
}

function railPoly(st, side, top) {
  // side -1 left, +1 right. Stock outline, but with its own top so it can fade to nothing in a connector.
  const a = HALF_ROAD,
    b = RAIL_IN,
    h = DECK + (top - DECK);
  // Both surfaces use the stock rail outline: its sloped inner face deflects the car. A square wooden beam
  // scraped cars to a stop in offset loops, where the rail has to push the car sideways.
  const pts = [[a, DECK], [a - 0.12, h - 0.09], [a - 0.5, h], [b + 0.12, h - 0.09], [b, DECK]];
  const P = side > 0 ? pts : pts.map(([x, y]) => [-x, y]).reverse();
  return {
    pts: P,
    cap: 'tmp',
    mats: (e, ring) => (e == 4 ? null : st.plastic && (e == 1 || e == 2) ? st.railTop(ring) : st.rail(ring)), // edge 4 is the hidden underside
  };
}

const roadProfile = (st, paint) => {
  const f = () => {
    const r = [railPoly(st, -1, RAIL_TOP), railPoly(st, 1, RAIL_TOP)];
    r[0].cap = r[1].cap = st.solidB;
    return [deckPoly(st, HALF_ROAD, DECK, 1.3867, paint), ...r];
  };
  f.rails = true;
  return f;
};
const openProfile = (st, paint) => () => [deckPoly(st, HALF_ROAD, DECK, 0.5, paint)];
const platProfile = (st, paint) => () => [deckPoly(st, 10, DECK, 0.5, paint)];

// TM2020 dirt road: no rails, soft earth banks that rise from the deck edge out to the stock road's width. The bank
// leaves the deck flat (tangent to it) and rounds over at the top, so a car running wide rides up it and comes back
// instead of hitting a wall. x0: deck half width, x1: outer edge, h: bank height over the deck, line: deck edge strip.
// NARROW is TM's narrow dirt road: about half the width, with low banks.
const BERM = { x0: 4.5, x1: HALF_ROAD, h: 1.2, n: 6, line: 0.35 };
const NARROW = { x0: 2.6, x1: 3.6, h: 0.45, n: 4, line: 0.25 };
// A bank squeezed to nothing (a connector's far end) has no width: it is flat at the deck.
const bermY = (B, x) => (B.x1 - B.x0 < 1e-9 ? DECK : DECK + (B.h * (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, (Math.abs(x) - B.x0) / (B.x1 - B.x0)))))) / 2);
// The banks as n strips a side (the bank as a whole is concave, so it cannot be one convex polygon).
// sides: which banks, +1 right, -1 left. paint and decal colour them like the deck (effect plates, gate markings).
function bermSides(st, B, paint, decal, sides = [1, -1]) {
  const { x0, x1, n } = B,
    polys = [];
  for (const side of sides)
    for (let i = 0; i < n; i++) {
      const xa = x0 + ((x1 - x0) * i) / n,
        xb = x0 + ((x1 - x0) * (i + 1)) / n,
        q = [[xa, 0], [xb, 0], [xb, bermY(B, xb)], [xa, bermY(B, xa)]];
      polys.push({
        pts: side > 0 ? q : q.map(([x, y]) => [-x, y]).reverse(),
        cap: st.under,
        mats: (e0, ring) => {
          // Mirrored strips run the other way round: edge k on the left is edge MIRROR[k] on the right.
          const e = side > 0 ? e0 : [2, 1, 0, 3][e0];
          if (e == 0) return st.under;
          // Only the outermost strip shows its outside; the faces between strips are inside the bank.
          if (e == 1) return i == n - 1 ? st.under : null;
          if (e == 2) return decal?.at((side * (xa + xb)) / 2, (ring.s + ring.next) / 2) ?? paint?.(ring) ?? (st.berm ?? st.deck)(ring);
          return null;
        },
      });
    }
  return polys;
}
const bermProfile = (st, B, paint) => () => [deckPoly(st, B.x0, DECK, B.line, paint), ...bermSides(st, B, paint)];
// Connector between two banked sections, or to a section with no banks (h 0, x0 = x1 = its half width): the deck
// widens and the banks shrink and flatten along the part. The pattern is left off, its cuts would move with the width.
function bermMorph(st, A, B) {
  return (ring) => {
    const t = smooth(ring.u),
      L = (k) => A[k] + (B[k] - A[k]) * t,
      S = { x0: L('x0'), x1: L('x1'), h: L('h'), line: L('line'), n: Math.max(A.n ?? 0, B.n ?? 0) };
    return [deckPoly({ ...st, pattern: null }, S.x0, DECK, S.line), ...bermSides(st, S)];
  };
}
const OPEN_END = { x0: HALF_ROAD, x1: HALF_ROAD, h: 0, line: 0.5 };
// The stock road's end: its deck out to the rails, a bank as high as the rails where they stand. A car running along the
// stock road near its rail meets the bank rising slowly ahead instead of its square end.
const STOCK_END = { x0: RAIL_IN, x1: HALF_ROAD, h: RAIL_TOP - DECK, line: 0.35 };
const PLAT_END = { x0: 10, x1: 10, h: 0, line: 0.5 };

// Connector profile: lerps width and rail height between two kinds of section along the part.
function morphProfile(st, fromW, toW, fromRail, toRail) {
  return (ring) => {
    const t = smooth(ring.u),
      w = fromW + (toW - fromW) * t,
      rail = fromRail + (toRail - fromRail) * t,
      top = DECK + Math.max(0, rail - DECK),
      out = w - HALF_ROAD,
      // A fading rail sinks into the slab: a rail lying flat on the deck would flicker against it.
      sink = 0.2 * (1 - Math.min(1, Math.max(0, (rail - DECK) / (RAIL_TOP - DECK))));
    const R = (side) => {
      const p = railPoly(st, side, top);
      p.pts = p.pts.map(([x, y]) => [x + side * out, Math.max(0.005, y - sink)]);
      p.cap = sink > 0 ? null : st.solidB;
      return p;
    };
    // The width changes along the part, so the lateral pattern cuts would too: keep only the along-the-road tones.
    return [deckPoly({ ...st, pattern: null }, w, DECK, 1.3867 - 0.8867 * t, null), R(-1), R(1)];
  };
}

function halfpipeProfile(st) {
  // floor 10 wide, quarter circles of radius 5 up both sides, total width 20, same footprint as a platform
  return () => {
    const polys = [];
    const N = 18,
      r = 5,
      t = DECK;
    const lo = (a) => [5 + Math.sin(a) * (r + t), r - Math.cos(a) * (r + t) + t],
      hi = (a) => [5 + Math.sin(a) * r, r - Math.cos(a) * r + t];
    polys.push({
      pts: [[-5, 0], [5, 0], [5, t], [-5, t]],
      cap: st.under,
      mats: (e, ring) => (e == 2 ? st.deck(ring) : st.under),
    });
    for (const side of [1, -1])
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * (Math.PI / 2),
          a1 = ((i + 1) / N) * (Math.PI / 2);
        const q = [lo(a0), lo(a1), hi(a1), hi(a0)];
        polys.push({
          pts: side > 0 ? q : q.map(([x, y]) => [-x, y]).reverse(),
          cap: st.under,
          mats: (e, ring) => {
            // The faces between two neighbouring segments are hidden inside the wall.
            if ((e == 1 && i < N - 1) || (e == 3 && i > 0)) return null;
            const top = side > 0 ? e == 2 : e == 0;
            return top ? (i >= N - N / 6 ? st.line(ring) : st.deck(ring)) : st.under;
          },
        });
      }
    return polys;
  };
}

// ---- part helpers ------------------------------------------------------------------------------------------

function swept(rings, profile) {
  const m = new Mesh();
  sweep(m, rings, profile);
  return m;
}
const ringStep = (st) => (st.plastic ? 5 : PLANK);
const arcStepFor = (r) => Math.min(5, Math.max(2.5, r / 6));

function roadPart(st, profile, segs, opt = {}) {
  const path = hPath(segs, opt.start),
    P = st.pattern,
    marks = [];
  if (P) for (let s = 0; s <= path.length; s += P.period) marks.push(s, s + P.band);
  if (st.posts && profile.rails) for (let s = 2.5; s < path.length; s += 5) marks.push(s);
  const rings = roadRings(path, { step: opt.step ?? ringStep(st), arcStep: opt.arcStep ?? (st.plastic ? 5 : 3.75), y: opt.y, roll: opt.roll, marks: [...(P ? marks : []), ...(opt.marks ?? [])] });
  const m = swept(rings, profile);
  // Wooden rails get a post every 5 units, halfway between joints so no post sits on a block edge (it would
  // claim the next tile). Drawn only: the plain collision build has no pattern, so posts never catch the car.
  if (st.posts && profile.rails && P)
    for (const r of rings) {
      if (Math.abs(((r.s + 2.5 + 1e-6) % 5) - 1e-6) > 1e-3) continue;
      for (const side of [-1, 1]) {
        const c = add(r.p, mul(r.R, side * 6.07)),
          k = 0.17,
          at = (sr, st2, h) => add(add(add(c, mul(r.R, sr * k)), mul(r.T, st2 * k)), mul(r.U, h));
        const lo = 0.7,
          hi = 1.45;
        for (const [a, b2, n] of [[[-1, -1], [1, -1], mul(r.T, -1)], [[1, -1], [1, 1], r.R], [[1, 1], [-1, 1], r.T], [[-1, 1], [-1, -1], mul(r.R, -1)]])
          m.quadFacing('WoodPost', at(a[0], a[1], lo), at(b2[0], b2[1], lo), at(b2[0], b2[1], hi), at(a[0], a[1], hi), n);
        m.quadFacing('WoodBeamB', at(-1, -1, hi), at(1, -1, hi), at(1, 1, hi), at(-1, 1, hi), r.U);
      }
    }
  return m;
}

function gateArch(m, w, st, kind, y0 = 0, roll = 0) {
  // Two posts and a top banner. Posts stand on the rail line, so the driving width stays clear.
  const top = 4.6,
    pw = 0.3,
    c = Math.cos(roll),
    s = Math.sin(roll);
  const col = { Checkpoint: 'Checkpoint', Start: 'StartLine', Finish: 'Finish' }[kind];
  const P = (x, y, z = 0) => [x * c + y * s, y0 + y * c - x * s, z];
  m.beam(st.solidB, P(-w, 0.1), P(-w, top), pw);
  m.beam(st.solidB, P(w, 0.1), P(w, top), pw);
  // The posts and banner are poles, not walls: hitting them does not bounce the car.
  for (const x of [-w, w]) softAround(m, [P(x, 0.1), P(x, top)], pw + 0.1);
  softAround(m, [P(-w, top - 1), P(w, top + 0.3)], 0.5);
  const a = P(-w, top),
    b = P(w, top),
    h = 0.75;
  if (kind == 'Finish') {
    const N = 12;
    for (let i = 0; i < N; i++) {
      const x0 = -w + (2 * w * i) / N,
        x1 = -w + (2 * w * (i + 1)) / N;
      const bar = new Mesh();
      for (const row of [0, 1]) {
        const mat = (i + row) % 2 ? 'FinishWhite' : 'FinishBlack',
          y1 = top - h / 2 + (row * h) / 2,
          y2 = y1 + h / 2;
        const q = [P(x0, y1, 0.22), P(x1, y1, 0.22), P(x1, y2, 0.22), P(x0, y2, 0.22)];
        const back = [P(x0, y1, -0.22), P(x1, y1, -0.22), P(x1, y2, -0.22), P(x0, y2, -0.22)];
        bar.quadFacing(mat, q[0], q[1], q[2], q[3], [0, 0, 1]);
        bar.quadFacing(mat, back[0], back[1], back[2], back[3], [0, 0, -1]);
      }
      m.merge(bar);
    }
    m.beam('Finish', P(-w, top + 0.05), P(w, top + 0.05), 0.12);
    m.beam('Finish', P(-w, top - h - 0.02), P(w, top - h - 0.02), 0.12);
  } else {
    m.beam(col, add(a, [0, -0.2, 0]), add(b, [0, -0.2, 0]), 0.36);
    void b;
  }
}

// A no-bounce box round some points, grown by pad on every side.
function softAround(m, pts, pad) {
  const lo = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k])) - pad),
    hi = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])) + pad);
  m.softBox(lo, hi);
}

function paintBand(st, a, b, mat) {
  return (ring, isLine) => (ring.s >= a - 1e-6 && ring.s < b - 1e-6 ? mat : isLine ? st.line(ring) : st.deck(ring));
}

// Flat raised glyph used on effect plates, drawn just above the deck.
// Decals sit 0.04 above the deck: closer than that they flicker from editor distances. They never collide.
const DECAL = DECK + 0.04;
function chevrons(m, mat, n = 3, y = DECAL, w = 3.6) {
  for (let i = 0; i < n; i++) {
    const z0 = 6 - i * 5.2,
      t = 1.3,
      l = 2.6;
    m.quadFacing(mat, [-w, y, z0], [0, y, z0 - l], [0, y, z0 - l - t], [-w, y, z0 - t], [0, 1, 0]);
    m.quadFacing(mat, [w, y, z0], [0, y, z0 - l], [0, y, z0 - l - t], [w, y, z0 - t], [0, 1, 0]);
  }
}
function crossGlyph(m, mat, y = DECAL) {
  const a = 3.6,
    t = 0.9;
  m.quadFacing(mat, [-a, y, -a + t], [-a + t, y, -a], [a, y, a - t], [a - t, y, a], [0, 1, 0]);
  m.quadFacing(mat, [a - t, y, -a], [a, y, -a + t], [-a + t, y, a], [-a, y, a - t], [0, 1, 0]);
}
function barGlyph(m, mat, y = DECAL) {
  m.quadFacing(mat, [-4, y, -1.1], [4, y, -1.1], [4, y, 1.1], [-4, y, 1.1], [0, 1, 0]);
}
function ringGlyph(m, mat, y = DECAL) {
  const N = 16,
    r0 = 2.6,
    r1 = 3.8;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU,
      b = ((i + 1) / N) * TAU,
      p = (r, an) => [Math.cos(an) * r, y, Math.sin(an) * r];
    m.quadFacing(mat, p(r0, a), p(r1, a), p(r1, b), p(r0, b), [0, 1, 0]);
  }
}

// The road widths a kit's gates, effect plates and vehicle gates come in. gate: the stockGate key; det and sx: the
// gate trigger and effect zone widths; post, postY: where a vehicle gate's posts stand (on the rail, the bank or
// the deck); glyph: how much an effect glyph is narrowed to fit between the banks.
function kitWidths(st) {
  const W = {
    Road: { key: 'Road', fam: 'road', gate: 'Road', det: 10.5, sx: 11.13, make: (p) => roadProfile(st, p), post: 6.0667, postY: RAIL_TOP - 0.1 },
    Open: { key: 'Open', fam: 'open road', gate: 'Open', det: 12.5, sx: 13.1, make: (p) => openProfile(st, p), post: 6.2, postY: DECK - 0.05 },
    Plat: { key: 'Plat', fam: 'platform', gate: 'Plat', det: 18.25, sx: 19.5, make: (p) => platProfile(st, p), post: 9.6, postY: DECK - 0.05 },
    Dirt: { key: 'Road', fam: 'dirt road', gate: 'Dirt', det: 12.5, sx: 13.1, make: (p) => bermProfile(st, BERM, p), post: 6.0, postY: DECK - 0.05, glyph: 0.9 },
    Narrow: { key: 'Narrow', fam: 'narrow road', gate: 'Narrow', det: 7.5, sx: 7.5, make: (p) => bermProfile(st, NARROW, p), post: 3.25, postY: DECK - 0.05, glyph: 0.55 },
  };
  return { Dirt: [W.Dirt, W.Open, W.Plat, W.Narrow], Grass: [W.Open, W.Plat] }[st.surface] ?? [W.Road, W.Open, W.Plat];
}
// Draws an effect glyph onto m, narrowed across the road by k (1 or absent: as drawn).
function glyphOn(m, glyph, k) {
  if (!k || k == 1) return glyph(m, DECAL);
  const g = new Mesh();
  glyph(g, DECAL);
  for (const [mat, l] of g.byMat) for (let i = 0; i < l.length; i += 3) m.tri(mat, ...[0, 1, 2].map((j) => [l[i + j][0] * k, l[i + j][1], l[i + j][2]]));
}

// A vehicle gate: two posts in the gate's colour, a beam across, and a sign hanging from it with the car it turns
// you into on both faces. Posts stand at +-w from y0; everything stays under `top` (4.9: inside one layer).
function vehicleArch(m, w, y0, V, top = 4.9) {
  const pw = 0.3,
    sign = top - 0.5;
  for (const x of [-w, w]) {
    m.box(V.mat, [x - pw, y0, -pw], [x + pw, top, pw]);
    softAround(m, [[x, y0, 0], [x, top, 0]], 0.35);
  }
  // The beam ends just inside the posts and stops short of their tops, so no face lies on a post face.
  m.box('VehFrame', [-w + pw - 0.02, sign, -0.22], [w - pw + 0.02, top - 0.05, 0.22]);
  m.box('VehPanel', [-2.4, sign - 1.6, -0.1], [2.4, sign + 0.05, 0.1], 'VehFrame');
  // The picture on both faces of the sign, each the right way round from its own side. A band in the car's colour runs
  // along each face of the beam, 0.035 in front of it, so the gate reads from far off.
  for (const side of [1, -1]) {
    vehicleSign(m, V, side, sign - 1.6);
    const x = w - pw - 0.12,
      z = side * 0.255;
    m.quadFacing(V.mat + 'B', [-x, sign + 0.13, z], [x, sign + 0.13, z], [x, top - 0.18, z], [-x, top - 0.18, z], [0, 0, side]);
  }
  softAround(m, [[-w, sign - 1.6, 0], [w, top, 0]], 0.3);
}

// A vehicle sign's picture, flat shapes in front of one face of the panel (x -2.4..2.4, 1.6 high from y0 up to the beam):
// a frame in the car's colour and the car side on, nose to +u, in white with its details in the car's colour. Shapes
// that cover each other sit on separate layers (ICON_Z, 0.035 apart: clear of zfight.js's 0.03), shapes on one layer
// never overlap. None of it collides (NO_PHYSICS in build.js), so the sign's collision mesh is the plain panel.
// Layers: 0 frame and body, 1 windows, wheel gaps, arches and flaps, 2 tyres, 3 hubs and decals, 4 hub caps.
const ICON_Z = [0.135, 0.17, 0.205, 0.24, 0.275];
const ICON_BASE = 0.2, // the car's wheels stand this high over the bottom of the panel
  ICON_K = 0.9; // a car is drawn about 4.2 long and 1.38 high, scaled by this
function vehicleSign(m, V, side, y0) {
  const accent = V.mat + 'B';
  const out = (L, mat, pts) => {
    for (const [a, b, c] of earClip(pts)) m.triFacing(mat, ...[a, b, c].map(([u, v]) => [side * u, y0 + v, side * ICON_Z[L]]), [0, 0, side]);
  };
  // The frame: four strips 0.11 wide just inside the panel's edges; the top one stops under the beam.
  const F = 0.11,
    X = 2.36,
    B = 0.04,
    T = 1.6;
  out(0, accent, [[-X, B], [X, B], [X, B + F], [-X, B + F]]);
  out(0, accent, [[-X, T - F], [X, T - F], [X, T], [-X, T]]);
  for (const s of [-1, 1]) out(0, accent, [[s * X, B + F], [s * (X - F), B + F], [s * (X - F), T - F], [s * X, T - F]]);
  // The car's own shapes, in car units: u along the car, v up from the ground under its wheels.
  const P = (pts) => pts.map(([u, v]) => [u * ICON_K, ICON_BASE + v * ICON_K]);
  const S = {
    white: 'VehGlyph',
    dark: 'VehIconDark',
    accent,
    poly: (L, mat, pts) => out(L, mat, P(pts)),
    // An n-gon round (u, v); bumps > 0 gives every other corner radius r - bumps (tyre knobs).
    disc: (L, mat, u, v, r, n = 20, bumps = 0) => out(L, mat, P(Array.from({ length: n }, (_, i) => [u + Math.cos((i / n) * TAU) * (r - (i % 2) * bumps), v + Math.sin((i / n) * TAU) * (r - (i % 2) * bumps)]))),
    // A ring segment from angle a0 to a1 (radians), r0..r1.
    arc: (L, mat, u, v, r0, r1, a0, a1, n = 10) => {
      for (let i = 0; i < n; i++) {
        const a = a0 + ((a1 - a0) * i) / n,
          b = a0 + ((a1 - a0) * (i + 1)) / n,
          p = (r, t) => [u + Math.cos(t) * r, v + Math.sin(t) * r];
        out(L, mat, P([p(r0, a), p(r1, a), p(r1, b), p(r0, b)]));
      }
    },
    // A tube from a to b, w wide.
    bar: (L, mat, a, b, w) => {
      const d = [b[0] - a[0], b[1] - a[1]],
        l = Math.hypot(...d),
        n = [(-d[1] / l) * w * 0.5, (d[0] / l) * w * 0.5];
      out(L, mat, P([[a[0] + n[0], a[1] + n[1]], [a[0] - n[0], a[1] - n[1]], [b[0] - n[0], b[1] - n[1]], [b[0] + n[0], b[1] + n[1]]]));
    },
    // A wheel: a dark gap round the tyre cuts it out of the body behind, a white tyre, a hub in the car's colour and a
    // dark cap. knobs: tread knob depth (0: smooth).
    wheel: (u, r, { knobs = 0, n = 24, hub = 0.45, gap = 0.07 } = {}) => {
      S.disc(1, S.dark, u, r, r + gap, n);
      S.disc(2, S.white, u, r, r, knobs ? n : 20, knobs);
      S.disc(3, accent, u, r, r * hub, 14);
      S.disc(4, S.dark, u, r, r * hub * 0.4, 10);
    },
    // A suspension tube from the hub of the wheel at (u, r) to (tu, tv), on the hub layer: it starts on the hub's rim
    // (its end square to the rim there), so the two never overlap.
    strut: (u, r, tu, tv, w) => {
      const l = Math.hypot(tu - u, tv - r),
        h = r * 0.45;
      S.bar(3, accent, [u + ((tu - u) * h) / l, r + ((tv - r) * h) / l], [tu, tv], w);
    },
  };
  V.draw(S);
}
// Triangulates a simple polygon (either winding) by clipping ears.
function earClip(pts) {
  const area = pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0);
  const idx = pts.map((_, i) => i);
  if (area < 0) idx.reverse();
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const tris = [];
  while (idx.length > 3) {
    let cut = false;
    for (let i = 0; i < idx.length && !cut; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length],
        ib = idx[i],
        ic = idx[(i + 1) % idx.length],
        [a, b, c] = [pts[ia], pts[ib], pts[ic]];
      if (cr(a, b, c) <= 1e-9) continue;
      if (idx.some((j) => j != ia && j != ib && j != ic && cr(a, b, pts[j]) > 1e-9 && cr(b, c, pts[j]) > 1e-9 && cr(c, a, pts[j]) > 1e-9)) continue;
      tris.push([a, b, c]);
      idx.splice(i, 1);
      cut = true;
    }
    if (!cut) throw new Error('earClip: not a simple polygon');
  }
  tris.push(idx.map((j) => pts[j]));
  return tris;
}

// ---- catalogue ---------------------------------------------------------------------------------------------

function buildSurface(surface) {
  const st = styleFor(surface);
  const parts = [];
  const putAll = (name, label, tab, sub, mesh, extra = {}) => parts.push({ name: surface + name, label, tab, sub, surface, mesh, ...extra });
  const put = putAll;
  const railed = { key: 'Road', tab: 'Road', profile: roadProfile(st), width: HALF_ROAD, rail: true },
    open = { key: 'Open', tab: 'Open road', profile: openProfile(st), width: HALF_ROAD, rail: false };
  // Dirt: TM's dirt road with banks instead of rails, the open road, and the narrow dirt road (straights, turns,
  // slopes, hills and junctions only: no banking, diagonals or loops). Grass is platform land: no railed road.
  // skip: part names (after the family key) the family leaves out.
  const families = {
    Dirt: [{ key: 'Road', tab: 'Dirt road', profile: bermProfile(st, BERM), width: HALF_ROAD, berm: BERM, loops: false }, open, { key: 'Narrow', tab: 'Narrow road', profile: bermProfile(st, NARROW), width: NARROW.x1, berm: NARROW, loops: false, skip: /^(Tilt|ToTilt|Diag)/ }],
    Grass: [open],
  }[surface] ?? [railed, open];

  for (const F of families) {
    const P = F.profile,
      K = F.key,
      T = F.tab,
      RS = 5;
    const put = (name, ...rest) => (F.skip?.test(name.slice(K.length)) ? null : putAll(name, ...rest));

    // straights and junctions
    put(K + 'Straight', 'Straight', T, 'Straights', roadPart(st, P, [{ line: 20 }]));
    put(K + 'StraightX2', 'Straight, 2 long', T, 'Straights', roadPart(st, P, [{ line: 40 }]));
    put(K + 'StraightX4', 'Straight, 4 long', T, 'Straights', roadPart(st, P, [{ line: 80 }]));
    put(K + 'Half', 'Straight, half', T, 'Straights', roadPart(st, P, [{ line: 10 }]));
    put(K + 'T', 'T junction', T, 'Junctions', junction(st, F, 'T'));
    put(K + 'Cross', 'Crossroads', T, 'Junctions', junction(st, F, 'X'));
    put(K + 'End', 'Dead end', T, 'Junctions', deadEnd(st, F));
    put(K + 'Bump', 'Speed bump', T, 'Straights', roadPart(st, P, [{ line: 20 }], { step: 2, y: (s) => 0.6 * (0.5 - 0.5 * Math.cos((s / 20) * TAU)) }));
    put(K + 'Ripple', 'Rumble strip', T, 'Straights', roadPart(st, P, [{ line: 20 }], { step: 1.25, y: (s) => 0.14 * (0.5 - 0.5 * Math.cos((s / 5) * TAU)) }));

    // flat turns: radii match the stock turn pieces, so a stock road carries straight on
    const TURN = [10, 30, 50, 70, 90];
    TURN.forEach((r, i) => {
      put(K + 'Curve' + (i + 1), 'Curve ' + (i + 1) + ' (radius ' + r + ')', T, 'Turns', roadPart(st, P, [{ r, ang: 90 * DEG, dir: 1 }], { arcStep: arcStepFor(r) }));
    });

    // chicanes: two opposite arcs that shift the lane sideways by `shift` over `L`
    for (const [L, shift] of [[20, 5], [20, 10], [40, 10], [40, 20], [60, 20], [80, 20]])
      for (const dir of [1, -1]) {
        const r = (L * L + shift * shift) / (4 * shift),
          ang = Math.asin(L / (2 * r));
        put(K + 'Chicane' + L + 'x' + shift + (dir > 0 ? 'R' : 'L'), 'Chicane ' + (dir > 0 ? 'right' : 'left') + ', ' + L / 20 + ' long, ' + shift + ' over', T, 'Chicanes',
          roadPart(st, P, [{ r, ang, dir }, { r, ang, dir: -dir }], { arcStep: 3.75 }));
      }

    // slopes: start, constant grade, end
    const GRADES = [
      { g: 0.25, n: 'Gentle', L: 40, rise: 5, straight: 5 },
      { g: 0.5, n: 'Medium', L: 20, rise: 5, straight: 10 },
      { g: 1, n: 'Steep', L: 40, rise: 20, straight: 20 },
    ];
    for (const { g, n, L } of GRADES) {
      const sub = n + ' slopes';
      put(K + n + 'Start', n + ' slope, start', T, sub, roadPart(st, P, [{ line: L }], { step: 2.5, y: (s) => (g * s * s) / (2 * L) }));
      put(K + n + 'Straight', n + ' slope', T, sub, roadPart(st, P, [{ line: 20 }], { y: (s) => g * s }));
      put(K + n + 'End', n + ' slope, end', T, sub, roadPart(st, P, [{ line: L }], { step: 2.5, y: (s) => g * s - (g * s * s) / (2 * L) }));
    }
    put(K + 'Crest1', 'Crest, small', T, 'Crests and dips', roadPart(st, P, [{ line: 40 }], { step: 2.5, y: (s) => 5 * (0.5 - 0.5 * Math.cos((s / 40) * TAU)) }));
    put(K + 'Crest2', 'Crest, big', T, 'Crests and dips', roadPart(st, P, [{ line: 80 }], { step: 2.5, y: (s) => 10 * (0.5 - 0.5 * Math.cos((s / 80) * TAU)) }));
    put(K + 'Dip1', 'Dip, small', T, 'Crests and dips', roadPart(st, P, [{ line: 40 }], { step: 2.5, y: (s) => 5 - 5 * (0.5 - 0.5 * Math.cos((s / 40) * TAU)) }));
    put(K + 'Dip2', 'Dip, big', T, 'Crests and dips', roadPart(st, P, [{ line: 80 }], { step: 2.5, y: (s) => 10 - 10 * (0.5 - 0.5 * Math.cos((s / 80) * TAU)) }));
    put(K + 'Kicker', 'Kicker', T, 'Crests and dips', roadPart(st, P, [{ line: 20 }], { step: 2.5, y: (s) => (s * s) / 40 }));
    put(K + 'KickerBig', 'Kicker, tall', T, 'Crests and dips', roadPart(st, P, [{ line: 20 }], { step: 2, y: (s) => (s * s) / 26.67 }));

    // climbing turns: the grade at both ends equals the straight slope, so they chain with the slope pieces
    for (const { g, n, radii } of [{ g: 0.25, n: 'Gentle', radii: [10, 30, 50, 70, 90] }, { g: 0.5, n: 'Medium', radii: [30, 50, 70, 90] }])
      for (const r of radii)
        for (const dir of [1, -1]) {
          const L = r * 90 * DEG,
            rise = Math.max(5, Math.round((L * g) / 5) * 5);
          put(K + n + 'Curve' + r + (dir > 0 ? 'R' : 'L'), n + ' climbing curve ' + (dir > 0 ? 'right' : 'left') + ', radius ' + r, T, 'Climbing curves',
            roadPart(st, P, [{ r, ang: 90 * DEG, dir }], { arcStep: arcStepFor(r), y: hermite(0, rise, g, g, L) }));
        }

    // banks: stock tilted road sits one layer up with its slab pivot on the centreline, these do the same
    const base = () => 5;
    const sub = 'Banked';
    put(K + 'Tilt', 'Banked straight', T, sub, roadPart(st, P, [{ line: 20 }], { y: base, roll: () => TILT }));
    for (const [n, L] of [['Short', 20], ['', 40], ['Long', 60]])
      for (const dir of [1, -1]) {
        put(K + 'ToTilt' + n + (dir > 0 ? 'L' : 'R'), 'To bank ' + (dir > 0 ? 'left high' : 'right high') + (n ? ', ' + n.toLowerCase() : ''), T, sub,
          roadPart(st, P, [{ line: L }], { step: 2.5, y: base, roll: (s) => dir * TILT * smooth(s / L) }));
      }
    // bank + climb
    for (const dir of [1, -1])
      put(K + 'TiltUp' + (dir > 0 ? 'L' : 'R'), 'Banked climb, ' + (dir > 0 ? 'left high' : 'right high'), T, sub, roadPart(st, P, [{ line: 20 }], { y: (s) => 5 + s * 0.25, roll: () => dir * TILT }));

    for (const [i, r] of TURN.entries()) {
      const sub2 = 'Banked curves',
        as = arcStepFor(r);
      put(K + 'TiltCurve' + (i + 1) + 'In', 'Banked curve ' + (i + 1) + ', into the turn', T, sub2, roadPart(st, P, [{ r, ang: 90 * DEG, dir: 1 }], { arcStep: as, y: base, roll: () => TILT }));
      put(K + 'TiltCurve' + (i + 1) + 'Out', 'Banked curve ' + (i + 1) + ', off camber', T, sub2, roadPart(st, P, [{ r, ang: 90 * DEG, dir: 1 }], { arcStep: as, y: base, roll: () => -TILT }));
    }
    for (const r of [30, 50])
      for (const dir of [1, -1])
        for (const inward of [true, false]) {
          const L = r * 90 * DEG,
            high = dir * (inward ? 1 : -1);
          put(K + 'TiltEnter' + r + (dir > 0 ? 'R' : 'L') + (inward ? 'In' : 'Out'), 'Curve into bank, radius ' + r + ', ' + (dir > 0 ? 'right' : 'left') + (inward ? '' : ', off camber'), T, 'Banked curves',
            roadPart(st, P, [{ r, ang: 90 * DEG, dir }], { arcStep: arcStepFor(r), y: base, roll: (s) => high * TILT * smooth(s / L) }));
        }

    // diagonals: 45 degree road whose ends land exactly on the block lattice
    const S2 = Math.SQRT2;
    const diagIn = (R, lat, dir) => {
      // straight, then a 45 degree arc, then a diagonal run, ending on a block corner
      const k = 1 - Math.SQRT1_2;
      const e = (lat - R * k) / Math.SQRT1_2;
      return { segs: [{ r: R, ang: 45 * DEG, dir }, ...(e > 1e-6 ? [{ line: e }] : [])], e };
    };
    for (const dir of [1, -1]) {
      const dn = dir > 0 ? 'R' : 'L';
      const dl = dir > 0 ? 'right' : 'left';
      {
        const R = 10 / (1 - Math.SQRT1_2),
          along = R * Math.SQRT1_2;
        put(K + 'DiagStart' + dn, 'Into diagonal ' + dl, T, 'Diagonals', roadPart(st, P, [{ line: 40 - along }, { r: R, ang: 45 * DEG, dir }], { arcStep: 3.75 }));
        const R2 = 14.1421,
          s = diagIn(R2, 10, dir),
          along2 = R2 * Math.SQRT1_2 + s.e * Math.SQRT1_2;
        put(K + 'DiagTight' + dn, 'Into diagonal ' + dl + ', tight', T, 'Diagonals', roadPart(st, P, [{ line: 20 - along2 }, ...s.segs], { arcStep: 2.5 }));
      }
      const r = 28.2843;
      put(K + 'DiagCurve' + dn, 'Diagonal 90 degree curve ' + dl, T, 'Diagonals', roadPart(st, P, [{ r, ang: 90 * DEG, dir }], { start: [-dir * 10, 10, dir * 45 * DEG], arcStep: 3.75 }));
    }
    put(K + 'Diag', 'Diagonal straight', T, 'Diagonals', roadPart(st, P, [{ line: 20 * S2 }], { start: [-10, 10, 45 * DEG], step: 3.5355 }));
    put(K + 'DiagX2', 'Diagonal straight, 2 long', T, 'Diagonals', roadPart(st, P, [{ line: 40 * S2 }], { start: [-10, 10, 45 * DEG], step: 3.5355 }));
    put(K + 'DiagUp', 'Diagonal climb', T, 'Diagonals', roadPart(st, P, [{ line: 20 * S2 }], { start: [-10, 10, 45 * DEG], step: 3.5355, y: (s) => s * (5 / (20 * S2)) }));

    // walls and loops: the road leaves the ground. Quarters are ordered 1-4 around one loop.
    if (F.loops !== false) loopSet(put, st, P, K, T, 'Walls and loops');
    void RS;
  }

  // ---- platforms: full-width driving surface ---------------------------------------------------------------
  {
    const P = platProfile(st);
    const T = 'Platform',
      K = 'Plat';
    put(K + 'Base', 'Platform', T, 'Flat', roadPart(st, P, [{ line: 20 }]));
    put(K + 'BaseX2', 'Platform, 2 long', T, 'Flat', roadPart(st, P, [{ line: 40 }]));
    put(K + 'Half', 'Platform, half', T, 'Flat', roadPart(st, P, [{ line: 10 }]));
    {
      const m = new Mesh();
      const N = 8,
        pts = [[-10, 10]];
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * 90 * DEG;
        pts.push([-10 + 20 * Math.sin(a), 10 - 20 * Math.cos(a) + 0]);
      }
      pts.reverse();
      prism(m, pts, 0, DECK, { top: st.solid, side: st.under, under: st.under, center: [-6, 6] });
      put(K + 'Round', 'Platform, rounded corner', T, 'Flat', m);
    }
    {
      // A platform with a 15 x 15 hole in the middle, the frame left around it.
      const m = new Mesh();
      for (const [a, b] of [[[-10, -10], [10, -7.5]], [[-10, 7.5], [10, 10]], [[-10, -7.5], [-7.5, 7.5]], [[7.5, -7.5], [10, 7.5]]])
        m.box(st.solid, [a[0], 0, a[1]], [b[0], DECK, b[1]], st.under);
      put(K + 'Hole', 'Platform with a hole', T, 'Flat', m);
      // The inside of a curve: a square with a quarter circle cut out of one corner.
      const c = new Mesh(),
        N = 10,
        pts = [[10, -10], [10, 10], [-10, 10]];
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * 90 * DEG;
        pts.push([-10 + 20 * Math.sin(a), -10 + 20 * Math.cos(a)].map((v, k) => (k == 0 ? v : v)));
      }
      prism(c, pts.map(([x, z]) => [x, z]), 0, DECK, { top: st.solid, side: st.under, under: st.under, center: [9.9, 9.9] });
      put(K + 'CurveIn', 'Platform, inside of a curve', T, 'Curves', c);
    }
    {
      const m = swept(roadRings(hPath([{ line: 20 }]), { step: ringStep(st) }), P);
      m.box(st.solidB, [-10, DECK, -10], [-9.2, RAIL_TOP, 10], st.trim);
      put(K + 'EdgeOne', 'Platform with kerb', T, 'Flat', m);
      const c = swept(roadRings(hPath([{ line: 20 }]), { step: ringStep(st) }), P);
      c.box(st.solidB, [-10, DECK, -10], [-9.2, RAIL_TOP, 10], st.trim);
      c.box(st.solidB, [-9.2, DECK, -10], [10, RAIL_TOP, -9.2], st.trim);
      put(K + 'EdgeCorner', 'Platform with corner kerb', T, 'Flat', c);
      const b = swept(roadRings(hPath([{ line: 20 }]), { step: ringStep(st) }), P);
      b.box(st.solidB, [-10, DECK, -10], [-9.2, RAIL_TOP, 10], st.trim);
      b.box(st.solidB, [9.2, DECK, -10], [10, RAIL_TOP, 10], st.trim);
      put(K + 'EdgeBoth', 'Platform with kerbs both sides', T, 'Flat', b);
    }
    for (const [i, r] of [10, 30, 50, 70, 90].entries())
      put(K + 'Curve' + (i + 1), 'Platform curve ' + (i + 1), T, 'Curves', roadPart(st, P, [{ r, ang: 90 * DEG, dir: 1 }], { arcStep: arcStepFor(r) }));

    for (const { g, n, L } of [{ g: 0.25, n: 'Gentle', L: 40 }, { g: 0.5, n: 'Medium', L: 20 }, { g: 1, n: 'Steep', L: 40 }]) {
      const sub = n + ' slopes';
      put(K + n + 'Start', n + ' slope, start', T, sub, roadPart(st, P, [{ line: L }], { step: 2.5, y: (s) => (g * s * s) / (2 * L) }));
      put(K + n + 'Straight', n + ' slope', T, sub, roadPart(st, P, [{ line: 20 }], { y: (s) => g * s }));
      put(K + n + 'End', n + ' slope, end', T, sub, roadPart(st, P, [{ line: L }], { step: 2.5, y: (s) => g * s - (g * s * s) / (2 * L) }));
      const rise = g * 20;
      // Corners: y = max or min of two perpendicular slopes, or round cones
      const grid = (fn, name, label) => {
        const m = new Mesh();
        patch(m, (u, v) => {
          const x = -10 + 20 * u,
            z = -10 + 20 * v;
          return [x, DECK + fn(x, z), z];
        }, 10, 10, { mat: st.patchMat, under: st.under, want: () => [0, 1, 0] });
        put(K + n + name, n + ' ' + label, T, sub, m);
      };
      const a = (x) => ((x + 10) / 20) * rise,
        b = (z) => ((z + 10) / 20) * rise;
      grid((x, z) => Math.min(a(x), b(z)), 'Outer', 'slope, outer corner');
      grid((x, z) => Math.max(a(x), b(z)), 'Inner', 'slope, inner corner');
      grid((x, z) => {
        const d = Math.hypot(10 - x, 10 - z) / 20;
        return Math.max(0, 1 - d) * rise;
      }, 'Cone', 'slope, rounded outer');
      grid((x, z) => {
        const d = Math.hypot(x + 10, z + 10) / 20;
        return Math.min(1, d) * rise;
      }, 'Bowl', 'slope, rounded inner');
    }
    // Twist: a flat platform rolling onto a cross slope, one layer up like the road banks.
    for (const dir of [1, -1])
      for (const [n, L] of [['', 20], ['Long', 40]])
        put(K + 'Twist' + n + (dir > 0 ? 'L' : 'R'), 'Twist to bank, ' + (dir > 0 ? 'left high' : 'right high') + (n ? ', long' : ''), T, 'Banked', roadPart(st, P, [{ line: L }], { step: 2.5, y: () => 5, roll: (s) => dir * TILT * smooth(s / L) }));
    put(K + 'Tilt', 'Banked platform', T, 'Banked', roadPart(st, P, [{ line: 20 }], { y: () => 5, roll: () => TILT }));
  }

  // ---- walls, loops, pipes for platforms -----------------------------------------------------------------------
  {
    const P = platProfile(st);
    const K = 'Plat',
      T = 'Walls and loops';
    loopSet(put, st, P, K, T, 'Platform walls and loops', true);
    // Bowls are the quarter-pipe profile swept around a corner, so they meet quarter pipes edge to edge.
    {
      const m = new Mesh(),
        R = 20,
        c = [10, R, 10];
      patch(m, (u, v) => {
        const az = (u * Math.PI) / 2,
          po = (v * Math.PI) / 2,
          Rt = R - DECK, // the driving surface, like the deck of a quarter pipe
          r = Rt * Math.sin(po);
        return [c[0] - r * Math.sin(az), c[1] - Rt * Math.cos(po), c[2] - r * Math.cos(az)];
      }, 12, 12, { mat: st.patchMat, under: st.under, want: (p) => [c[0] - p[0], c[1] - p[1], c[2] - p[2]] });
      put(K + 'BowlInner', 'Bowl corner, inside', T, 'Platform corners', m);
    }
    {
      const m = new Mesh(),
        R = 20;
      patch(m, (u, v) => {
        const az = (u * Math.PI) / 2,
          po = (v * Math.PI) / 2,
          Rt = R - DECK,
          r = R - Rt * Math.sin(po);
        return [-10 + r * Math.sin(az), R - Rt * Math.cos(po), -10 + r * Math.cos(az)];
      }, 12, 12, { mat: st.patchMat, under: st.under, want: (p) => {
        const r = Math.hypot(p[0] + 10, p[2] + 10);
        return r < 1e-4 ? [0, 0, 1] : [(p[0] + 10) / r, R - p[1], (p[2] + 10) / r];
      } });
      put(K + 'BowlOuter', 'Bowl corner, outside', T, 'Platform corners', m);
    }
    for (const r of [30, 50])
      for (const dir of [1, -1]) {
        // Vertical wall that follows a curve in plan.
        const path = hPath([{ r, ang: 90 * DEG, dir }], [0, 10, 0]);
        const m = new Mesh();
        const samples = roadRings(path, { arcStep: arcStepFor(r) });
        for (let i = 0; i + 1 < samples.length; i++) {
          const a = samples[i],
            b = samples[i + 1],
            h = 20,
            f = st.wallMat(i);
          const out = norm(add(mul(a.R, dir), mul(b.R, dir)));
          m.quadFacing(f, a.p, b.p, add(b.p, [0, h, 0]), add(a.p, [0, h, 0]), mul(out, 1));
          const o = (q) => add(q, mul(out, -0.21));
          m.quadFacing(st.under, o(a.p), o(b.p), add(o(b.p), [0, h, 0]), add(o(a.p), [0, h, 0]), mul(out, -1));
        }
        put(K + 'WallCurve' + r + (dir > 0 ? 'R' : 'L'), 'Curved wall, radius ' + r + ', ' + (dir > 0 ? 'right' : 'left'), T, 'Platform corners', m);
      }

    const HP = halfpipeProfile(st),
      TH = 'Half-pipe';
    put('PipeStraight', 'Half-pipe', TH, 'Half-pipe', roadPart(st, HP, [{ line: 20 }]));
    put('PipeStraightX2', 'Half-pipe, 2 long', TH, 'Half-pipe', roadPart(st, HP, [{ line: 40 }]));
    for (const [i, r] of [30, 50, 70, 90].entries())
      put('PipeCurve' + (i + 2), 'Half-pipe curve ' + (i + 2), TH, 'Half-pipe', roadPart(st, HP, [{ r, ang: 90 * DEG, dir: 1 }], { arcStep: arcStepFor(r) }));
    for (const { g, n, L } of [{ g: 0.25, n: 'Gentle', L: 40 }, { g: 0.5, n: 'Medium', L: 20 }]) {
      put('Pipe' + n + 'Start', 'Half-pipe, ' + n.toLowerCase() + ' climb start', TH, 'Half-pipe slopes', roadPart(st, HP, [{ line: L }], { step: 2.5, y: (s) => (g * s * s) / (2 * L) }));
      put('Pipe' + n, 'Half-pipe, ' + n.toLowerCase() + ' climb', TH, 'Half-pipe slopes', roadPart(st, HP, [{ line: 20 }], { y: (s) => g * s }));
      put('Pipe' + n + 'End', 'Half-pipe, ' + n.toLowerCase() + ' climb end', TH, 'Half-pipe slopes', roadPart(st, HP, [{ line: L }], { step: 2.5, y: (s) => g * s - (g * s * s) / (2 * L) }));
    }
    // Entry: a platform folding up into a half-pipe, built from the same number of polygons as the pipe profile.
    {
      const hp = HP();
      const flatten = (ring) => {
        const t = smooth(ring.u),
          src = hp.map((q) => q);
        return src.map((poly, pi) => {
          if (pi == 0) return poly;
          // Wall pieces flatten into side-by-side strips that use the inner (driving) edge's x, so none overlap.
          const P = poly.pts,
            right = P[0][0] > 0,
            flat = right
              ? [[P[3][0], 0], [P[2][0], 0], [P[2][0], DECK], [P[3][0], DECK]]
              : [[P[0][0], DECK], [P[1][0], DECK], [P[1][0], 0], [P[0][0], 0]];
          const pts = P.map(([x, y], k) => [x * t + flat[k][0] * (1 - t), y * t + flat[k][1] * (1 - t)]);
          return { ...poly, pts };
        });
      };
      put('PipeEntry', 'Platform to half-pipe', TH, 'Half-pipe', roadPart(st, flatten, [{ line: 40 }], { step: 0.5 }));
    }
  }

  // ---- connectors ------------------------------------------------------------------------------------------------
  {
    const T = 'Connectors',
      W = 10,
      R = HALF_ROAD;
    const banked = {
      Dirt: [
        ['RoadFromRoad', 'Dirt road from road', STOCK_END, BERM],
        ['RoadToOpen', 'Dirt road to open road', BERM, OPEN_END],
        ['RoadToPlat', 'Dirt road to platform', BERM, PLAT_END],
        ['NarrowToRoad', 'Narrow road to dirt road', NARROW, BERM],
        // The narrow road from the stock road: the banks close in from the rails to the narrow road's.
        ['NarrowFromRoad', 'Narrow road from road', STOCK_END, NARROW],
        ['NarrowToOpen', 'Narrow road to open road', NARROW, OPEN_END],
      ],
      Grass: [],
    };
    const cases = [
      ['RoadToOpen', 'Road to open road', R, R, RAIL_TOP, DECK],
      ['RoadToPlat', 'Road to platform', R, W, RAIL_TOP, DECK],
      ['OpenToPlat', 'Open road to platform', R, W, DECK, DECK],
    ].filter(([n]) => !banked[surface] || n == 'OpenToPlat');
    // The banked kits have their own road ends: the banks sink into the open road or the platform.
    for (const [n, label, A, B] of banked[surface] ?? []) {
      put(n, label, T, 'Road types', roadPart(st, bermMorph(st, A, B), [{ line: 20 }], { step: 2.5 }));
      put(n + 'Long', label + ', long', T, 'Road types', roadPart(st, bermMorph(st, A, B), [{ line: 40 }], { step: 2.5 }));
    }
    if (surface == 'Dirt') put('RoadToPlatUp', 'Dirt road to platform, climbing', T, 'Road types', roadPart(st, bermMorph(st, BERM, PLAT_END), [{ line: 40 }], { step: 2.5, y: (s) => (0.25 * s * s) / 80 }));
    for (const [n, label, a, b, ra, rb] of cases) {
      put(n, label, T, 'Road types', roadPart(st, morphProfile(st, a, b, ra, rb), [{ line: 20 }], { step: 2.5 }));
      put(n + 'Long', label + ', long', T, 'Road types', roadPart(st, morphProfile(st, a, b, ra, rb), [{ line: 40 }], { step: 2.5 }));
    }
    // Road opening out into a platform while climbing.
    if (!banked[surface]) put('RoadToPlatUp', 'Road to platform, climbing', T, 'Road types', roadPart(st, morphProfile(st, R, W, RAIL_TOP, DECK), [{ line: 40 }], { step: 2.5, y: (s) => (0.25 * s * s) / 80 }));
    for (const dir of banked[surface] ? [] : [1, -1]) {
      const off = dir * (10 - HALF_ROAD);
      const m = new Mesh();
      const profile = (ring) => {
        const t = smooth(ring.u);
        const polys = morphProfile(st, R, W, RAIL_TOP, DECK)(ring);
        return polys.map((p) => ({ ...p, pts: p.pts.map(([x, y]) => [x + off * (1 - t), y]) }));
      };
      sweep(m, roadRings(hPath([{ line: 20 }]), { step: 2.5 }), profile);
      put('RoadToPlatSide' + (dir > 0 ? 'R' : 'L'), 'Road along the ' + (dir > 0 ? 'right' : 'left') + ' edge of a platform', T, 'Road types', m);
    }
  }

  // ---- gates -----------------------------------------------------------------------------------------------------
  {
    const T = 'Gates';
    const kinds = [
      { kind: 'Start', label: 'Start', band: 'StartLine' },
      { kind: 'Checkpoint', label: 'Checkpoint', band: 'Checkpoint' },
      { kind: 'Finish', label: 'Finish', band: 'Finish' },
    ];
    const widths = kitWidths(st);
    const detector = (kind, size, cy = 2.2, cz = 0, cx = 0, h = 3.8) =>
      kind == 'Start' ? {} : { detector: { type: kind == 'Checkpoint' ? 0 : 1, center: [cx, cy, cz], size: [size, h, kind == 'Finish' ? 2 : 1] } };
    for (const { kind, label } of kinds)
      for (const W of widths) put(kind + W.key, label + ', ' + W.fam, T, label, stockGate(st, kind, W.gate), { ...detector(kind, W.det), ...(kind == 'Start' ? { startOffset: [0, 0.35, 1.35] } : {}) });
    // Checkpoints in the middle of slopes, banks and diagonals: the stock gate leans with the road the way stock
    // slopes do, cross-sections kept vertical. The trigger box is taller so it still catches the car.
    for (const W of widths)
      for (const { g, n } of [{ g: 0.25, n: 'gentle' }, { g: 0.5, n: 'medium' }, { g: 1, n: 'steep' }]) {
        const m = stockGate(st, 'Checkpoint', W.gate, { y: (s) => g * s, place: ([x, y, z]) => [x, y + g * (10 - z), z] });
        put('Checkpoint' + W.key + n, 'Checkpoint, ' + n + ' slope, ' + W.fam, T, 'Checkpoint on slope', m, { detector: { type: 0, center: [0, g * 10 + 2.2, 0], size: [W.det, 3.8 + g * 2, 1] } });
      }
    // Banks and diagonals only come in the full road widths.
    const roads = widths.filter((W) => W.key == 'Road' || W.key == 'Open');
    for (const W of roads)
      for (const dir of [1, -1]) {
        const roll = dir * TILT,
          c = Math.cos(roll),
          sn = Math.sin(roll);
        const m = stockGate(st, 'Checkpoint', W.gate, { y: () => 5, roll: () => roll, place: ([x, y, z]) => [x * c + y * sn, 5 + y * c - x * sn, z] });
        put('Checkpoint' + W.key + 'Tilt' + (dir > 0 ? 'L' : 'R'), 'Checkpoint, banked ' + (dir > 0 ? 'left high' : 'right high') + ', ' + W.fam, T, 'Checkpoint on bank', m, { detector: { type: 0, center: [0, 6.2, 0], size: [W.det, 9, 1] } });
      }
    for (const W of roads) {
      // The diagonal runs from (-10, 10) at 45 degrees; its middle is 10 x sqrt 2 along it.
      const mid = 10 * Math.SQRT2,
        k = Math.SQRT1_2;
      const m = stockGate(st, 'Checkpoint', W.gate, { segs: [{ line: 20 * Math.SQRT2 }], start: [-10, 10, 45 * DEG], step: 2.02, ds: mid - 10, place: ([x, y, z]) => [(mid - z) * k + x * k - 10, y, 10 - (mid - z) * k + x * k] });
      // spawnDir: the road's direction through the gate, so respawning there faces along the diagonal.
      put('Checkpoint' + W.key + 'Diag', 'Checkpoint, diagonal, ' + W.fam, T, 'Checkpoint on diagonal', m, { detector: { type: 0, center: [0, 2.2, 0], size: [7.5, 3.8, 7.5] }, spawnDir: [Math.SQRT1_2, 0, -Math.SQRT1_2] });
    }
    // Wide gates span two blocks of platform, like the stock wide plane gates.
    for (const { kind, label } of kinds) {
      const m = stockGate(st, kind, 'PlatWide');
      put(kind + 'PlatWide', label + ', wide platform', T, label, m, { ...(kind == 'Start' ? { startOffset: [-10, 0.35, 1.35] } : { detector: { type: kind == 'Checkpoint' ? 0 : 1, center: [10, 2.2, 0], size: [38.25, 3.8, kind == 'Finish' ? 2 : 1] } }) });
    }
    // A checkpoint on a wall, climbing straight up: the stock platform gate stood on its end.
    put('CheckpointWall', 'Checkpoint on a wall', T, 'Checkpoint on wall', stockGate(st, 'Checkpoint', 'Wall'), { detector: { type: 0, center: [0, 10, -7.6], size: [18.25, 1, 3.8] } });
    // Finish hoops, 1 to 4 blocks across, on each road width. The trigger is the stock finish line's.
    for (const W of widths.filter((W) => W.key != 'Narrow'))
      for (let n = 1; n <= 4; n++) put('FinishHoop' + W.key + n, 'Finish hoop, ' + n + ' block' + (n > 1 ? 's' : '') + ' wide, ' + W.fam, T, 'Finish hoop', hoopGate(st, W.gate, n), detector('Finish', W.det));
  }

  // ---- gameplay plates: effects run in the physics worker (see tm_runtime.js) -------------------------------------
  {
    const T = 'Effects';
    for (const fx of FX)
      for (const W of kitWidths(st)) {
        const paint = (ring, isLine) => (isLine ? st.line(ring) : fx.mat);
        const m = roadPart(st, W.make(paint), [{ line: 20 }], { step: 5 });
        glyphOn(m, fx.glyph, W.glyph);
        put('Fx' + fx.key + W.key, fx.label + ', ' + W.fam, T, fx.label, m, { fx: { type: fx.key, center: [0, 2.5, 0], size: [W.sx, 5, 12] }, hidden: fx.hidden });
      }
  }

  // ---- vehicle gates: TM2020's transform gates, an arch across the road with the car it turns you into ------------------
  {
    const T = 'Vehicle gates';
    for (const V of VEHICLES)
      for (const W of kitWidths(st)) {
        // The deck under the arch takes the gate's colour, the rest of the piece keeps the surface pattern.
        const paint = (ring) => (ring.s >= 9 - 1e-6 && ring.s < 11 - 1e-6 ? V.mat : null);
        const m = roadPart(st, W.make(paint), [{ line: 20 }], { marks: [9, 11] });
        vehicleArch(m, W.post, W.postY, V);
        put('Car' + V.key + W.key, V.label + ', ' + W.fam, T, V.label, m, { fx: { type: 'Car' + V.key, center: [0, 2.6, 0], size: [W.sx, 5, 3] } });
      }
  }

  // ---- penalty grass built into this surface's blocks ------------------------------------------------------------------
  if (surface != 'Grass') {
    const T = 'Penalty grass';
    // Open road with grass verges out to the block edge.
    const verge = (paint) => () => [deckPoly(st, HALF_ROAD, DECK, 0.5, paint), ...grassStrips(HALF_ROAD, 10)];
    const P = verge();
    put('GrassRoadStraight', 'Open road with grass verges', T, 'Road with grass', roadPart(st, P, [{ line: 20 }]));
    put('GrassRoadStraightX2', 'Open road with grass verges, 2 long', T, 'Road with grass', roadPart(st, P, [{ line: 40 }]));
    [10, 30, 50, 70, 90].forEach((r, i) => put('GrassRoadCurve' + (i + 1), 'Open road with grass, curve ' + (i + 1), T, 'Road with grass', roadPart(st, P, [{ r, ang: 90 * DEG, dir: 1 }], { arcStep: arcStepFor(r) })));
    for (const { g, n, L } of [{ g: 0.25, n: 'Gentle', L: 40 }, { g: 0.5, n: 'Medium', L: 20 }]) {
      put('GrassRoad' + n + 'Start', 'Open road with grass, ' + n.toLowerCase() + ' slope start', T, 'Road with grass', roadPart(st, P, [{ line: L }], { step: 2.5, y: (s) => (g * s * s) / (2 * L) }));
      put('GrassRoad' + n, 'Open road with grass, ' + n.toLowerCase() + ' slope', T, 'Road with grass', roadPart(st, P, [{ line: 20 }], { y: (s) => g * s }));
      put('GrassRoad' + n + 'End', 'Open road with grass, ' + n.toLowerCase() + ' slope end', T, 'Road with grass', roadPart(st, P, [{ line: L }], { step: 2.5, y: (s) => g * s - (g * s * s) / (2 * L) }));
    }
    put('GrassRoadToOpen', 'Grass verges to plain open road', T, 'Road with grass', roadPart(st, (ring) => [deckPoly(st, HALF_ROAD, DECK, 0.5), ...grassStrips(HALF_ROAD, HALF_ROAD + (10 - HALF_ROAD) * (1 - smooth(ring.u)) + 0.01)], [{ line: 20 }], { step: 2.5 }));
    // Platforms with grass patches: the grass part of the deck is penalty grass, the rest keeps this surface.
    const plat = (cuts) => (ring) => {
      const out = [];
      let x = -10;
      for (const [a, b] of cuts) {
        if (a > x) out.push(sidePoly(st, x, a));
        out.push(...grassStrips(null, null, a, b));
        x = b;
      }
      if (x < 10) out.push(sidePoly(st, x, 10));
      void ring;
      return out;
    };
    put('GrassPlatEdge', 'Platform with a grass edge', T, 'Platform with grass', roadPart(st, plat([[-10, -5]]), [{ line: 20 }]));
    put('GrassPlatBoth', 'Platform with grass on both edges', T, 'Platform with grass', roadPart(st, plat([[-10, -5], [5, 10]]), [{ line: 20 }]));
    put('GrassPlatCenter', 'Platform with a grass centre strip', T, 'Platform with grass', roadPart(st, plat([[-3.5, 3.5]]), [{ line: 20 }]));
    put('GrassPlatHalf', 'Platform, half grass', T, 'Platform with grass', roadPart(st, plat([[0, 10]]), [{ line: 20 }]));
    {
      const m = roadPart(st, platProfile(st), [{ line: 20 }]);
      // A raised grass island in the middle: a low hump the car can drive over.
      grassPatch(m, (u, v) => {
        const x = -6 + 12 * u,
          z = -6 + 12 * v,
          d = Math.max(Math.abs(x), Math.abs(z)) / 6;
        return [x, DECK + 0.06 + 0.4 * (1 - d * d), z];
      });
      put('GrassPlatIsland', 'Platform with a grass island', T, 'Platform with grass', m);
    }
    [30, 50].forEach((r) => put('GrassPlatCurve' + r, 'Platform curve with grass outside, radius ' + r, T, 'Platform with grass', roadPart(st, plat([[5, 10]]), [{ r, ang: 90 * DEG, dir: 1 }], { arcStep: arcStepFor(r) })));

    // TM's penalty pieces also come with dirt borders: the verge drives like dirt (surface 5, build.js regions),
    // the road keeps this surface. The dirt kit's own road is dirt already, so it has none.
    if (surface != 'Dirt') {
      const sub = 'Road with dirt verges',
        D = () => [deckPoly(st, HALF_ROAD, DECK, 0.5), ...grassStrips(HALF_ROAD, 10, null, null, DIRT_VERGE)];
      put('DirtVergeStraight', 'Open road with dirt verges', T, sub, roadPart(st, D, [{ line: 20 }]));
      put('DirtVergeStraightX2', 'Open road with dirt verges, 2 long', T, sub, roadPart(st, D, [{ line: 40 }]));
      [10, 30, 50, 70, 90].forEach((r, i) => put('DirtVergeCurve' + (i + 1), 'Open road with dirt, curve ' + (i + 1), T, sub, roadPart(st, D, [{ r, ang: 90 * DEG, dir: 1 }], { arcStep: arcStepFor(r) })));
      for (const { g, n, L } of [{ g: 0.25, n: 'Gentle', L: 40 }, { g: 0.5, n: 'Medium', L: 20 }]) {
        put('DirtVerge' + n + 'Start', 'Open road with dirt, ' + n.toLowerCase() + ' slope start', T, sub, roadPart(st, D, [{ line: L }], { step: 2.5, y: (s) => (g * s * s) / (2 * L) }));
        put('DirtVerge' + n, 'Open road with dirt, ' + n.toLowerCase() + ' slope', T, sub, roadPart(st, D, [{ line: 20 }], { y: (s) => g * s }));
        put('DirtVerge' + n + 'End', 'Open road with dirt, ' + n.toLowerCase() + ' slope end', T, sub, roadPart(st, D, [{ line: L }], { step: 2.5, y: (s) => g * s - (g * s * s) / (2 * L) }));
      }
      put('DirtVergeToOpen', 'Dirt verges to plain open road', T, sub, roadPart(st, (ring) => [deckPoly(st, HALF_ROAD, DECK, 0.5), ...grassStrips(HALF_ROAD, HALF_ROAD + (10 - HALF_ROAD) * (1 - smooth(ring.u)) + 0.01, null, null, DIRT_VERGE)], [{ line: 20 }], { step: 2.5 }));
      const dplat = (cuts) => () => {
        const out = [];
        let x = -10;
        for (const [a, b] of cuts) {
          if (a > x) out.push(sidePoly(st, x, a));
          out.push(...grassStrips(null, null, a, b, DIRT_VERGE));
          x = b;
        }
        if (x < 10) out.push(sidePoly(st, x, 10));
        return out;
      };
      put('DirtVergePlatEdge', 'Platform with a dirt edge', T, 'Platform with dirt', roadPart(st, dplat([[-10, -5]]), [{ line: 20 }]));
      put('DirtVergePlatBoth', 'Platform with dirt on both edges', T, 'Platform with dirt', roadPart(st, dplat([[-10, -5], [5, 10]]), [{ line: 20 }]));
    }
  }

  // ---- deco and scenery ----------------------------------------------------------------------------------------------
  decoSet(put, st);
  return parts;
}

// Gameplay plates. Effects run in the physics worker, see tm_runtime.js. hidden: no longer in the editor's menu, but
// still built (same ids, same models) so tracks that have them keep loading and driving: the turbo roulette, and the old
// reactor down and oriented plates (the two reactor plates now boost up or down by the way you cross their arrow).
const FX = [
  { key: 'Turbo', label: 'Turbo', mat: 'FxTurbo', glyph: (m, y) => chevrons(m, 'FxTurboB', 3, y) },
  { key: 'Super', label: 'Super turbo', mat: 'FxSuper', glyph: (m, y) => chevrons(m, 'FxSuperB', 3, y) },
  { key: 'Roulette', label: 'Turbo roulette', mat: 'FxRoulette', glyph: (m, y) => rouletteGlyph(m, y), hidden: true },
  // The arrow points the way the boost goes up: crossing along it gives the up boost, against it the down boost.
  { key: 'ReactorUp', label: 'Reactor boost', mat: 'FxReactor', glyph: (m, y) => arrowGlyph(m, 'FxReactorB', y, 1) },
  { key: 'ReactorDown', label: 'Reactor boost, down', mat: 'FxReactor', glyph: (m, y) => arrowGlyph(m, 'FxReactorB', y, -1), hidden: true },
  { key: 'Reactor2Up', label: 'Super reactor boost', mat: 'FxReactor2', glyph: (m, y) => arrowGlyph(m, 'FxReactor2B', y, 1) },
  { key: 'Reactor2Down', label: 'Super reactor boost, down', mat: 'FxReactor2', glyph: (m, y) => arrowGlyph(m, 'FxReactor2B', y, -1), hidden: true },
  // The old oriented plates: an arrow standing on a bar. They boost like the two reactor plates now.
  { key: 'ReactorOriented', label: 'Reactor boost, oriented', mat: 'FxReactor', glyph: (m, y) => orientedGlyph(m, 'FxReactorB', y), hidden: true },
  { key: 'Reactor2Oriented', label: 'Super reactor boost, oriented', mat: 'FxReactor2', glyph: (m, y) => orientedGlyph(m, 'FxReactor2B', y), hidden: true },
  { key: 'Reset', label: 'Reset effects', mat: 'FxReset', glyph: (m, y) => ringGlyph(m, 'FxResetB', y) },
  { key: 'NoEngine', label: 'No engine', mat: 'FxNoEngine', glyph: (m, y) => crossGlyph(m, 'FxNoEngineB', y) },
  { key: 'NoBrake', label: 'No brakes', mat: 'FxNoBrake', glyph: (m, y) => barGlyph(m, 'FxNoBrakeB', y) },
  { key: 'NoSteer', label: 'No steering', mat: 'FxNoSteer', glyph: (m, y) => crossGlyph(m, 'FxNoSteerB', y) },
  { key: 'Slow', label: 'Slow motion', mat: 'FxSlow', glyph: (m, y) => ringGlyph(m, 'FxSlowB', y) },
  { key: 'Cruise', label: 'Cruise control', mat: 'FxCruise', glyph: (m, y) => chevrons(m, 'FxCruiseB', 2, y, 2.4) },
  { key: 'Fragile', label: 'Fragile', mat: 'FxFragile', glyph: (m, y) => ringGlyph(m, 'FxFragileB', y) },
  // TM2020 additions: the purple ultra turbo, and the bumpers (rubber pads that kick the car sideways).
  { key: 'Ultra', label: 'Ultra turbo', mat: 'FxUltra', glyph: (m, y) => chevrons(m, 'FxUltraB', 3, y, 4.4) },
  { key: 'Bumper', label: 'Bumper', mat: 'FxBumper', glyph: (m, y) => bumperGlyph(m, 'FxBumperB', y, 1) },
  { key: 'Bumper2', label: 'Super bumper', mat: 'FxBumper', glyph: (m, y) => bumperGlyph(m, 'FxBumper2B', y, 2) },
];

// TM2020 vehicle transform gates; zone type 'Car' + key (tm_runtime.js), Stadium turns you back into the normal car.
// draw(S): the car on the gate's sign, side on (vehicleSign: u along the car, nose at +u, about -2.1..2.1; v up from
// the ground, 0..1.38). Each outline is its own design, so the four read apart at a glance.
const VEHICLES = [
  // A chunky winter buggy: big knobbly tyres, a high body, an open roll cage with a light bar, a nudge bar.
  {
    key: 'Snow',
    label: 'Snow car gate',
    mat: 'VehSnow',
    draw: (S) => {
      S.poly(0, S.white, [[-1.75, 0.55], [1.8, 0.58], [2.0, 0.7], [1.95, 0.84], [1.55, 0.95], [0.75, 1.02], [-1.66, 1.02], [-1.98, 0.98], [-2.02, 0.72], [-1.92, 0.6]]);
      // The cage stands on the body: rear hoop, centre post and windscreen post, one outline so nothing overlaps.
      S.poly(0, S.white, [[-1.2, 1.02], [-1.07, 1.02], [-0.9, 1.21], [-0.4, 1.21], [-0.4, 1.02], [-0.29, 1.02], [-0.29, 1.21], [0.18, 1.21], [0.6, 1.02], [0.75, 1.02], [0.24, 1.31], [-0.98, 1.31]]);
      S.poly(0, S.accent, [[-0.62, 1.31], [0.2, 1.31], [0.2, 1.39], [-0.62, 1.39]]);
      for (const u of [-0.45, -0.21, 0.03]) S.poly(1, S.white, [[u - 0.06, 1.33], [u + 0.06, 1.33], [u + 0.06, 1.37], [u - 0.06, 1.37]]);
      S.poly(3, S.accent, [[1.9, 0.52], [2.18, 0.52], [2.18, 0.92], [1.9, 0.92], [1.9, 0.84], [2.08, 0.84], [2.08, 0.6], [1.9, 0.6]]);
      S.poly(3, S.accent, [[-0.72, 0.66], [0.74, 0.7], [0.74, 0.8], [-0.72, 0.76]]);
      for (const u of [-1.3, 1.32]) S.wheel(u, 0.52, { knobs: 0.075, n: 28 });
    },
  },
  // A rally hatchback: flared arches, a roof spoiler and scoop, mud flaps, a light pod on the bonnet, a livery stripe.
  {
    key: 'Rally',
    label: 'Rally car gate',
    mat: 'VehRally',
    draw: (S) => {
      S.poly(0, S.white, [[-1.92, 0.3], [1.96, 0.28], [2.06, 0.4], [2.0, 0.66], [1.72, 0.76], [0.88, 0.84], [0.22, 1.15], [0.1, 1.16], [0.02, 1.22], [-0.25, 1.22], [-0.35, 1.16], [-1.74, 1.14], [-1.94, 1.0], [-2.04, 0.62], [-2.04, 0.36]]);
      S.poly(1, S.dark, [[-1.68, 1.06], [-1.6, 0.88], [-0.42, 0.88], [-0.42, 1.08]]);
      S.poly(1, S.dark, [[-0.32, 1.08], [-0.32, 0.88], [0.66, 0.88], [0.2, 1.08]]);
      S.poly(1, S.white, [[-1.5, 1.17], [-1.95, 1.06], [-2.18, 1.17], [-2.16, 1.26]]);
      for (const u of [-1.3, 1.32]) S.arc(1, S.white, u, 0.34, 0.425, 0.51, 0.1, Math.PI - 0.1);
      for (const u of [-1.84, 0.76]) S.poly(1, S.accent, [[u, 0.08], [u + 0.09, 0.08], [u + 0.09, 0.3], [u, 0.3]]);
      S.poly(3, S.accent, [[-0.76, 0.5], [0.8, 0.5], [0.8, 0.64], [-0.76, 0.64]]);
      S.poly(3, S.accent, [[1.2, 0.79], [1.6, 0.75], [1.6, 0.84], [1.2, 0.88]]);
      for (const u of [1.3, 1.5]) S.disc(4, S.white, u, 0.82, 0.035, 8);
      for (const u of [-1.3, 1.32]) S.wheel(u, 0.34);
    },
  },
  // A desert trophy truck: big sand tyres hanging under high open fenders on long-travel suspension, a cab, a
  // tube-framed bed with the spare wheel in it, a light bar on the roof.
  {
    key: 'Desert',
    label: 'Desert car gate',
    mat: 'VehDesert',
    draw: (S) => {
      S.poly(0, S.white, [[-2.12, 0.8], [-1.98, 0.8], [-1.86, 0.94], [-0.94, 0.94], [-0.82, 0.8], [0.8, 0.8], [0.92, 0.94], [1.84, 0.94], [1.96, 0.8], [2.12, 0.84], [2.12, 0.98], [1.74, 1.1], [0.62, 1.14], [0.22, 1.34], [-0.38, 1.34], [-0.5, 1.1], [-2.06, 1.1], [-2.12, 1.02]]);
      S.poly(1, S.dark, [[-0.36, 1.14], [-0.28, 1.28], [0.2, 1.28], [0.48, 1.14]]);
      S.poly(0, S.accent, [[-0.34, 1.34], [0.16, 1.34], [0.16, 1.41], [-0.34, 1.41]]);
      for (const u of [-0.22, 0.0]) S.poly(1, S.white, [[u - 0.06, 1.355], [u + 0.06, 1.355], [u + 0.06, 1.395], [u - 0.06, 1.395]]);
      // The spare wheel stands in the bed, half hidden by its side, behind the tube rack running back from the roof.
      S.poly(0, S.white, Array.from({ length: 13 }, (_, i) => [-1.22 + Math.cos((i / 12) * Math.PI) * 0.3, 1.1 + Math.sin((i / 12) * Math.PI) * 0.3]));
      S.arc(1, S.dark, -1.22, 1.1, 0.19, 0.24, 0, Math.PI, 10);
      S.poly(3, S.accent, [[-0.42, 1.31], [-0.44, 1.23], [-1.92, 1.19], [-1.92, 1.1], [-2.02, 1.1], [-2.02, 1.27]]);
      // The long-travel shocks, from each hub up into the open fender.
      for (const [u, top] of [[-1.4, -1.62], [1.38, 1.6]]) S.strut(u, 0.42, top, 0.94, 0.12);
      for (const u of [-1.4, 1.38]) S.wheel(u, 0.42, { knobs: 0.03 });
    },
  },
  // The stadium car, the stock car itself: a long low wedge rising from the nose to a ridge near the tail.
  {
    key: 'Stadium',
    label: 'Stadium car gate',
    mat: 'VehStadium',
    draw: (S) => {
      S.poly(0, S.white, [[-2.0, 0.3], [2.0, 0.3], [2.1, 0.42], [-0.8, 0.98], [-1.15, 0.98], [-2.02, 0.66], [-2.06, 0.4]]);
      S.poly(1, S.dark, [[-0.78, 0.89], [0.4, 0.66], [0.22, 0.6], [-0.82, 0.8]]);
      S.poly(3, S.accent, [[-0.86, 0.46], [0.86, 0.46], [0.86, 0.54], [-0.86, 0.54]]);
      for (const u of [-1.3, 1.3]) S.wheel(u, 0.33);
    },
  },
];

// A bumper pad's glyph: a bright ring with n arrows a side pointing out, the way the kick goes.
function bumperGlyph(m, mat, y, n) {
  const N = 16,
    r0 = 2.1,
    r1 = 2.9;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU,
      b = ((i + 1) / N) * TAU,
      p = (r, an) => [Math.cos(an) * r, y, Math.sin(an) * r];
    m.quadFacing(mat, p(r0, a), p(r1, a), p(r1, b), p(r0, b), [0, 1, 0]);
  }
  for (const side of [1, -1])
    for (let k = 0; k < n; k++) {
      const z = n == 1 ? 0 : (k - 0.5) * 2.6;
      m.triFacing(mat, [side * 4.9, y, z], [side * 3.5, y, z - 1.1], [side * 3.5, y, z + 1.1], [0, 1, 0]);
    }
}

function arrowGlyph(m, mat, y, dir) {
  // An up or down arrow seen from the driver: a triangle and a stem along the road.
  const tip = -5 * dir,
    base = -1 * dir;
  m.triFacing(mat, [0, y, tip], [-3.2, y, base], [3.2, y, base], [0, 1, 0]);
  m.quadFacing(mat, [-1.2, y, base], [1.2, y, base], [1.2, y, base + 5.5 * dir], [-1.2, y, base + 5.5 * dir], [0, 1, 0]);
}
// The normal of a surface seen from the driver: an arrow pointing ahead from the middle of a bar across the plate.
function orientedGlyph(m, mat, y) {
  m.triFacing(mat, [0, y, -5], [-3.2, y, -1.6], [3.2, y, -1.6], [0, 1, 0]);
  m.quadFacing(mat, [-1.1, y, -1.6], [1.1, y, -1.6], [1.1, y, 2.6], [-1.1, y, 2.6], [0, 1, 0]);
  m.quadFacing(mat, [-4.4, y, 2.6], [4.4, y, 2.6], [4.4, y, 4.4], [-4.4, y, 4.4], [0, 1, 0]);
}
function rouletteGlyph(m, y) {
  const mats = ['FxTurboB', 'FxSuperB', 'FxReactor2B'];
  for (let i = 0; i < 3; i++) {
    const z0 = 5 - i * 4;
    m.quadFacing(mats[i], [-4, y, z0], [4, y, z0], [4, y, z0 - 2.4], [-4, y, z0 - 2.4], [0, 1, 0]);
  }
}

// Penalty grass strips as extra profile polygons, flush with the deck top. kind: the verge's top tones and
// underside, grass unless told otherwise (DIRT_VERGE for dirt borders).
const GRASS_VERGE = { top: ['Grass', 'GrassB'], under: 'GrassUnder' };
const DIRT_VERGE = { top: ['DirtVerge', 'DirtVergeB'], under: 'DirtUnder' };
function grassStrips(inner, outer, a, b, kind = GRASS_VERGE) {
  const strip = (x0, x1) => ({
    pts: [[x0, 0], [x1, 0], [x1, DECK], [x0, DECK]],
    cap: kind.under,
    mats: (e, ring) => (e == 2 ? kind.top[Math.floor((ring.s + 1e-6) / 5) % 2] : e == 0 || e == 1 || e == 3 ? kind.under : null),
  });
  if (a != null) return [strip(a, b)];
  return [strip(inner, outer), strip(-outer, -inner)];
}
// A plain slice of this surface's deck between x0 and x1.
function sidePoly(st, x0, x1) {
  return { pts: [[x0, 0], [x1, 0], [x1, DECK], [x0, DECK]], cap: st.under, mats: (e, ring) => (e == 2 ? st.deck(ring) : st.under) };
}
function grassPatch(m, f) {
  patch(m, f, 8, 8, { mat: (i, j) => ((i + j) % 2 ? 'GrassB' : 'Grass'), under: null, want: () => [0, 1, 0], thick: 0 });
}

function shiftMesh(m, dx) {
  // Parts that span two blocks keep their origin on the entry block, like stock wide gates.
  const out = new Mesh();
  out.merge(m, [dx - 10 + 0, 0, 0]);
  return out;
}

function junction(st, F, kind) {
  // A banked road's deck stops where its banks start; the banks are swept round the corners below.
  const B = F.berm,
    bc = B && (B.x0 + B.x1) / 2,
    bermCorner = (s) => roadRings(hPath([{ r: 10 - bc, ang: Math.PI / 2, dir: 1 }], s), { arcStep: 1 });
  const w = B ? B.x0 : F.width,
    m = new Mesh(),
    r = 10 - w,
    A = (cx, cz, a0, a1) => {
      const q = [];
      for (let i = 0; i <= 5; i++) {
        const a = a0 + ((a1 - a0) * i) / 5;
        q.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
      }
      return q;
    };
  // Outline traced around the origin. Corners are arcs centred on the block corners.
  const SE = A(10, 10, Math.PI, Math.PI * 1.5);
  const NE = A(10, -10, Math.PI * 0.5, Math.PI);
  const NW = A(-10, -10, 0, Math.PI * 0.5);
  const SW = A(-10, 10, -Math.PI * 0.5, 0);
  if (B) {
    // The deck's corners follow the banks' inner edge cut for cut, so the deck never shows through a bank's foot.
    // The south-east corner from the bank's own rings, the others turned from it a quarter at a time.
    const rot = ([x, z]) => [z, -x],
      se = bermCorner([bc, 10, 0]).map((r) => [r.p[0] + r.R[0] * (B.x0 - bc), r.p[2] + r.R[2] * (B.x0 - bc)]);
    SE.splice(0, SE.length, ...se);
    NE.splice(0, NE.length, ...SE.map(rot));
    NW.splice(0, NW.length, ...NE.map(rot));
    SW.splice(0, SW.length, ...NW.map(rot));
  }
  let outline;
  if (kind == 'X') outline = [...SE, [10, w], [10, -w], ...NE.slice().reverse().reverse(), [w, -10], [-w, -10], ...NW, [-10, -w], [-10, w], ...SW, [-w, 10], [w, 10]];
  else outline = [...SE, [10, w], [10, -w], [-10, -w], [-10, w], ...SW, [-w, 10], [w, 10]];
  outline = outline.filter((p, i, a) => i == 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 1e-6);
  prism(m, outline, 0, DECK, { top: st.solid, side: st.under, under: st.under });
  if (F.rail) {
    const rail = (rings) => sweep(m, rings, () => {
      const p = railPoly(st, 1, RAIL_TOP);
      p.cap = st.solidB;
      p.pts = p.pts.map(([x, y]) => [x - 6.0667, y]);
      return [p];
    });
    const R = 10 - 6.0667;
    const corner = (s) => rail(roadRings(hPath([{ r: R, ang: Math.PI / 2, dir: 1 }], s), { arcStep: 1 }));
    corner([6.0667, 10, 0]); // from the south arm to the east arm
    corner([-10, 6.0667, -Math.PI / 2 + Math.PI]); // west arm to south arm
    if (kind == 'X') {
      corner([10, -6.0667, -Math.PI / 2]); // east arm to north arm
      corner([-6.0667, -10, Math.PI]); // north arm to west arm
    } else rail(roadRings(hPath([{ line: 20 }], [10, -6.0667, -Math.PI / 2]), { step: 5 }));
  }
  if (B) {
    // The right-hand bank alone, centred on the path, swept round each corner like the rails above.
    const bank = (rings) => sweep(m, rings, () => bermSides(st, B, null, null, [1]).map((p) => ({ ...p, pts: p.pts.map(([x, y]) => [x - bc, y]) })));
    bank(bermCorner([bc, 10, 0]));
    bank(bermCorner([-10, bc, Math.PI / 2]));
    if (kind == 'X') {
      bank(bermCorner([10, -bc, -Math.PI / 2]));
      bank(bermCorner([-bc, -10, Math.PI]));
    } else bank(roadRings(hPath([{ line: 20 }], [10, -bc, -Math.PI / 2]), { step: 5 }));
  }
  return m;
}

function deadEnd(st, F) {
  const m = new Mesh();
  sweep(m, roadRings(hPath([{ line: 10 }]), { step: ringStep(st) }), F.berm ? F.profile : F.rail ? roadProfile(st) : openProfile(st));
  const w = F.width;
  m.box(st.solidB, [-w, 0, -1.2], [w, 2.2, 0], st.trim);
  return m;
}

function loopSet(put, st, P, K, T, sub, platform = false) {
  // Quarter pipes and full loops at three sizes. Offset versions shift sideways so the exit clears the entry.
  const sets = [20, 40, 60];
  put(K + 'WallStraight', platform ? 'Wall' : 'Wall road', T, sub, swept(wallRings(20), P));
  put(K + 'WallStraightShort', platform ? 'Wall, 1 layer' : 'Wall road, 1 layer', T, sub, swept(wallRings(5), P));
  for (const r of sets) {
    const name = K + 'Loop' + r,
      n = 'radius ' + r,
      a = Math.PI / 2;
    const zOff = r; // quarters 3 and 4 sit one loop radius forward so they stay on the block lattice
    const rings = (i, shift) => {
      const a0 = i * a,
        a1 = (i + 1) * a,
        cy = i == 0 || i == 3 ? r : i == 1 ? 0 : 0;
      const centerY = i == 0 || i == 3 ? r : 0;
      void cy;
      const centerZ = i < 2 ? 10 : 10 - zOff;
      // The sideways offset eases in and out over the whole loop, so the rail never has to shove the car at the entry.
      return loopRings(r, a0, a1, { centerY, centerZ, shiftAt: (u) => shift * smooth((i + u) / 4), step: r <= 20 ? 3.75 : 5 });
    };
    const q = ['climb', 'over the top', 'dive', 'pull out'];
    for (let i = 0; i < 4; i++) put(name + 'Q' + (i + 1), 'Loop quarter ' + (i + 1) + ' (' + q[i] + '), ' + n, T, sub, swept(rings(i, 0), P));
    for (const dir of [1, -1])
      for (let i = 0; i < 4; i++) {
        put(name + 'Offset' + (dir > 0 ? 'R' : 'L') + 'Q' + (i + 1), 'Offset loop ' + (dir > 0 ? 'right' : 'left') + ', quarter ' + (i + 1) + ', ' + n, T, sub, swept(rings(i, dir * 20), P));
      }
  }
}

function decoSet(put, st) {
  const T = 'Deco';
  const a = st.solid,
    b = st.solidB,
    c = st.trim,
    u = st.under;
  const box = (name, label, sub, min, max, mat = a, side = b) => {
    const m = new Mesh();
    m.box(mat, min, max, side);
    put(name, label, T, sub, m);
  };
  // supports
  const post = (h, w = 1) => {
    const m = new Mesh();
    m.box(b, [-w, 0, -w], [w, h, w], c);
    return m;
  };
  put('PostShort', 'Post, 1 layer', T, 'Supports', post(5));
  put('PostTall', 'Post, 4 layers', T, 'Supports', post(20));
  put('PostThin', 'Thin post, 4 layers', T, 'Supports', post(20, 0.5));
  {
    const m = new Mesh();
    m.box(b, [-7, 0, -0.5], [-6, 4.6, 0.5], c);
    m.box(b, [6, 0, -0.5], [7, 4.6, 0.5], c);
    m.box(c, [-7.5, 4.6, -0.7], [7.5, 5, 0.7], b);
    put('SupportFrame', 'Road support frame', T, 'Supports', m);
    const t = new Mesh();
    t.box(b, [-7, 0, -0.5], [-6, 19.6, 0.5], c);
    t.box(b, [6, 0, -0.5], [7, 19.6, 0.5], c);
    for (const y of [5, 10, 15, 19.6]) t.box(c, [-7.5, y, -0.7], [7.5, y + 0.4, 0.7], b);
    t.beam(c, [-6.5, 0.5, 0], [6.5, 9.5, 0], 0.25);
    t.beam(c, [6.5, 0.5, 0], [-6.5, 9.5, 0], 0.25);
    t.beam(c, [-6.5, 10.5, 0], [6.5, 19.5, 0], 0.25);
    t.beam(c, [6.5, 10.5, 0], [-6.5, 19.5, 0], 0.25);
    put('SupportTrestle', st.tower, T, 'Supports', t);
    const l = new Mesh();
    for (const [x, z] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) l.box(b, [x - 0.6, 0, z - 0.6], [x + 0.6, 4.6, z + 0.6], c);
    l.box(c, [-10, 4.6, -10], [10, 5, 10], b);
    put('SupportTable', 'Platform table', T, 'Supports', l);
  }
  // walls
  box('WallLow', 'Low wall', 'Walls', [-10, 0, -10], [10, 2.5, -9], a, b);
  box('WallOne', 'Wall, 1 layer', 'Walls', [-10, 0, -10], [10, 5, -9], a, b);
  box('WallFour', 'Wall, 4 layers', 'Walls', [-10, 0, -10], [10, 20, -9], a, b);
  {
    const m = new Mesh();
    m.box(a, [-10, 0, -10], [10, 5, -9], b);
    m.box(a, [-10, 0, -9], [-9, 5, 10], b);
    put('WallCorner', 'Wall corner, 1 layer', T, 'Walls', m);
    const n = new Mesh();
    n.box(a, [-10, 0, -10], [10, 20, -9], b);
    n.box(a, [-10, 0, -9], [-9, 20, 10], b);
    put('WallCornerFour', 'Wall corner, 4 layers', T, 'Walls', n);
    const s = new Mesh();
    s.quadFacing(a, [-10, 0, -10], [10, 0, -10], [10, 5, -10], [-10, 5, -10], [0, 0, -1]);
    s.quadFacing(a, [-10, 0, 10], [10, 0, 10], [10, 0, -10], [-10, 0, -10], [0, -1, 0]);
    s.quadFacing(a, [-10, 5, -10], [10, 5, -10], [10, 0, 10], [-10, 0, 10], [0, 1, 0.25]);
    s.triFacing(b, [-10, 0, -10], [-10, 5, -10], [-10, 0, 10], [-1, 0, 0]);
    s.triFacing(b, [10, 0, -10], [10, 5, -10], [10, 0, 10], [1, 0, 0]);
    put('Wedge', 'Wedge', T, 'Shapes', s);
    const t = new Mesh();
    t.quadFacing(a, [-10, 0, 10], [10, 0, 10], [10, 0, -10], [-10, 0, -10], [0, -1, 0]);
    t.triFacing(b, [-10, 0, 10], [10, 0, 10], [0, 5, 0], [0, 1, 1]);
    t.triFacing(a, [10, 0, 10], [10, 0, -10], [0, 5, 0], [1, 1, 0]);
    t.triFacing(b, [10, 0, -10], [-10, 0, -10], [0, 5, 0], [0, 1, -1]);
    t.triFacing(a, [-10, 0, -10], [-10, 0, 10], [0, 5, 0], [-1, 1, 0]);
    put('Pyramid', 'Pyramid', T, 'Shapes', t);
    const stairs = new Mesh();
    for (let i = 0; i < 4; i++) stairs.box(i % 2 ? a : b, [-10, 0, -10 + i * 5], [10, 5 - i * 1.25, -5 + i * 5], c);
    put('Stairs', 'Stairs', T, 'Shapes', stairs);
  }
  box('Cube', 'Cube', 'Shapes', [-10, 0, -10], [10, 5, 10]);
  box('CubeHalf', 'Half cube', 'Shapes', [-10, 0, -10], [0, 5, 10]);
  box('CubeQuarter', 'Quarter cube', 'Shapes', [-10, 0, -10], [0, 5, 0]);
  box('Slab', 'Slab', 'Shapes', [-10, 0, -10], [10, 2.5, 10]);
  // barriers and signs
  box('BarrierBlock', 'Barrier', 'Barriers and signs', [-10, 0, -0.5], [10, 1.4, 0.5], b, c);
  {
    const m = new Mesh();
    m.box(b, [-10, 0, -0.5], [10, 1.4, 0.5], c);
    for (let i = 0; i < 8; i += 2) m.box(i % 4 ? a : c, [-10 + i * 2.5, 1.4, -0.5], [-10 + (i + 1) * 2.5, 2.2, 0.5], b);
    put('BarrierBlocks', 'Barrier with blocks', T, 'Barriers and signs', m);
    const r = new Mesh();
    for (let i = 0; i < 5; i++) r.box(c, [-9.6 + i * 4.6, 0, -0.25], [-9.1 + i * 4.6, 2, 0.25], b);
    r.box(b, [-10, 1.8, -0.2], [10, 2.2, 0.2], c);
    r.box(b, [-10, 0.8, -0.2], [10, 1.2, 0.2], c);
    put('Fence', st.fence, T, 'Barriers and signs', r);
    for (const [n, l, dir] of [['SignLeft', 'Sign, turn left', 1], ['SignRight', 'Sign, turn right', -1]]) {
      const s = new Mesh();
      s.box(b, [-0.3, 0, -9.8], [0.3, 3, -9.2], c);
      s.box(c, [-5, 3, -9.8], [5, 7, -9.5], b);
      const y = 5,
        z = -9.44,
        w = (d) => [d, y, z];
      s.triFacing('FxReset', [dir * -3, y, z], [dir * 0, y + 1.6, z], [dir * 0, y - 1.6, z], [0, 0, 1]);
      s.quadFacing('FxReset', [0, y + 0.6, z], [dir * 3.2, y + 0.6, z], [dir * 3.2, y - 0.6, z], [0, y - 0.6, z], [0, 0, 1]);
      put(n, l, T, 'Barriers and signs', s);
    }
    const arch = new Mesh();
    arch.box(b, [-10, 0, -1], [-8, 7, 1], c);
    arch.box(b, [8, 0, -1], [10, 7, 1], c);
    arch.box(a, [-10, 7, -1], [10, 9, 1], c);
    put('Arch', 'Arch', T, 'Shapes', arch);
    const cr = new Mesh();
    if (st.deco == 'dirt') dirtDeco(put, T);
    else if (st.deco == 'grass') grassDeco(put, T);
    else if (st.deco == 'plastic') {
      cr.box('FxReset', [-1, 0, -1], [1, 0.2, 1], 'FxNoEngine');
      const N = 8;
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * TAU,
          a1 = ((i + 1) / N) * TAU,
          p = (r, an, h) => [Math.cos(an) * r, h, Math.sin(an) * r];
        cr.quadFacing(i % 2 ? 'FinishWhite' : 'FxReset', p(0.7, a0, 0.2), p(0.7, a1, 0.2), p(0.12, a1, 2), p(0.12, a0, 2), [Math.cos(a0), 0.3, Math.sin(a0)]);
      }
      put('Cone', 'Traffic cone', T, 'Obstacles', cr);
      const tube = new Mesh();
      cyl(tube, a, b, 1.6, 0, 3, 12);
      put('Bollard', 'Tube bollard', T, 'Obstacles', tube);
      const ball = new Mesh();
      cyl(ball, c, b, 3, 0, 6, 16);
      put('InflatablePost', 'Inflatable post', T, 'Obstacles', ball);
    } else {
      cr.box('WoodDeckA', [-1.2, 0, -1.2], [1.2, 2.4, 1.2], 'WoodBeam');
      put('Crate', 'Crate', T, 'Obstacles', cr);
      const bar = new Mesh();
      cyl(bar, 'WoodDeckB', 'WoodBeam', 1.1, 0, 2.6, 10);
      put('Barrel', 'Barrel', T, 'Obstacles', bar);
      const log = new Mesh();
      log.beam('WoodBeam', [-8, 0.5, 0], [8, 0.5, 0], 0.5);
      put('Log', 'Log', T, 'Obstacles', log);
    }
    const br = new Mesh();
    br.box(b, [-7.2, 0, -10], [-6.6, 3.2, 10], c);
    br.box(b, [6.6, 0, -10], [7.2, 3.2, 10], c);
    put('BridgeSides', 'Bridge sides', T, 'Barriers and signs', br);
    const bu = new Mesh();
    bu.beam(b, [-6.9, 0.45, -9.6], [-6.9, 4.55, 9.6], 0.35);
    bu.beam(b, [6.9, 0.45, -9.6], [6.9, 4.55, 9.6], 0.35);
    put('Struts', 'Under-bridge struts', T, 'Supports', bu);
    void u;
  }
}

// A dome, half an ellipsoid standing on c: r across, h tall. bottom closes it underneath (a tree crown, seen from
// below); bump(i, j) scales the radius vertex by vertex, for rocks.
function dome(m, mat, c, r, h, { n = 14, rows = 5, bottom = false, bump = () => 1 } = {}) {
  const P = (j, i) => {
    const lat = (j / rows) * (Math.PI / 2),
      lon = (i / n) * TAU,
      k = j == rows ? 1 : bump(i % n, j);
    return [c[0] + Math.cos(lat) * Math.cos(lon) * r * k, c[1] + Math.sin(lat) * h * k, c[2] + Math.cos(lat) * Math.sin(lon) * r * k];
  };
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < n; i++) {
      const q = [P(j, i), P(j, i + 1), P(j + 1, i + 1), P(j + 1, i)];
      m.quadFacing(mat, ...q, G.sub(mul(add(q[0], q[2]), 0.5), c));
    }
  if (bottom) for (let i = 0; i < n; i++) m.triFacing(mat, c, P(0, i), P(0, i + 1), [0, -1, 0]);
}
// The same mesh with every point moved by f (f must keep the winding: a rotation, not a mirror).
function mapMesh(src, f) {
  const out = new Mesh();
  for (const [mat, l] of src.byMat) for (let i = 0; i < l.length; i += 3) out.tri(mat, f(l[i]), f(l[i + 1]), f(l[i + 2]));
  return out;
}
// Rocks: a lumpy dome, the lumps from a fixed hash so every build is the same.
const lumps = (k) => (i, j) => 1 + k * ((((i * 7 + j * 13 + 3) * 2654435761) >>> 0) % 101 / 100 - 0.5);

// Dirt deco, TM2020's rally country: hay bales, a hay roll and rocks in place of the plastic cones.
function dirtDeco(put, T) {
  const one = (name, label, f) => {
    const m = new Mesh();
    f(m);
    put(name, label, T, 'Obstacles', m);
  };
  one('HayBale', 'Hay bale', (m) => m.box('Hay', [-1.5, 0, -0.8], [1.5, 1.1, 0.8], 'HayB'));
  one('HayStack', 'Stack of hay bales', (m) => {
    // A small gap between the two bottom bales, so their ends never share a face.
    m.box('Hay', [-3.1, 0, -0.8], [-0.05, 1.1, 0.8], 'HayB');
    m.box('Hay', [0.05, 0, -0.8], [3.1, 1.1, 0.8], 'HayB');
    m.box('Hay', [-1.5, 1.1, -0.8], [1.5, 2.2, 0.8], 'HayB');
  });
  one('HayRoll', 'Hay roll', (m) => {
    const c = new Mesh();
    cyl(c, 'HayB', 'Hay', 1.1, 0, 1.6, 14);
    // Laid on its side: the axis along x, resting on the ground.
    m.merge(mapMesh(c, ([x, y, z]) => [y - 0.8, x + 1.1, -z]));
  });
  one('Rock', 'Rock', (m) => dome(m, 'Rock', [0, 0, 0], 1.6, 1.3, { n: 9, rows: 3, bump: lumps(0.35) }));
  one('RockBig', 'Big rock', (m) => dome(m, 'Rock', [0, 0, 0], 4, 3.2, { n: 11, rows: 4, bump: lumps(0.3) }));
}

// A tree the way the user's own tracks draw them: a low grass mound, a trunk that bends as it rises, and one dome of
// leaves sitting on top (never a pole sticking out of it). h: trunk height, lean: how far its top leans over.
function tree(m, { h, lean, r, crown, mound }) {
  dome(m, 'GrassDeck', [0, 0, 0], mound, 0.45, { n: 12, rows: 3 });
  const N = 8,
    rings = [];
  for (let k = 0; k <= N; k++) {
    const t = k / N,
      T = norm([2 * lean * t, h - 0.2, 0]);
    rings.push({ p: [lean * t * t, 0.2 + (h - 0.2) * t, 0], T, R: [0, 0, 1], U: norm(G.cross([0, 0, 1], T)), s: t * h, u: t, i: k });
  }
  // An octagon thinning as it climbs; its foot is inside the mound and its top inside the crown.
  sweep(m, rings, (ring) => [{ pts: [0, 1, 2, 3, 4, 5, 6, 7].map((q) => [Math.cos((q / 8) * TAU) * (0.42 - 0.16 * ring.u), Math.sin((q / 8) * TAU) * (0.42 - 0.16 * ring.u)]), cap: 'Trunk', mats: () => 'Trunk' }]);
  dome(m, 'Leaf', [lean, h - crown * 0.35, 0], r, crown, { n: 16, rows: 6, bottom: true });
}

// Grass deco: bushes, a hedge, trees and a rock, for TM2020 grass country.
function grassDeco(put, T) {
  const one = (name, label, sub, f) => {
    const m = new Mesh();
    f(m);
    put(name, label, T, sub, m);
  };
  one('Bush', 'Bush', 'Plants', (m) => {
    dome(m, 'Bush', [0, 0, 0], 1.8, 1.5, { n: 12, rows: 4 });
    dome(m, 'Bush', [1.4, 0, 0.8], 1.2, 1.0, { n: 10, rows: 3 });
  });
  one('BushBig', 'Big bush', 'Plants', (m) => {
    dome(m, 'Bush', [0, 0, 0], 3, 2.4, { n: 14, rows: 5 });
    dome(m, 'Bush', [-2.4, 0, 1.4], 1.8, 1.5, { n: 12, rows: 4 });
    dome(m, 'Bush', [2.2, 0, -1.2], 1.6, 1.3, { n: 12, rows: 4 });
  });
  one('Hedge', 'Hedge', 'Plants', (m) => m.box('Bush', [-10, 0, -0.9], [10, 2.2, 0.9]));
  one('Tree', 'Tree', 'Trees', (m) => tree(m, { h: 5, lean: 0.8, r: 2.6, crown: 2.6, mound: 2.4 }));
  one('TreeBent', 'Tree, bent', 'Trees', (m) => tree(m, { h: 6.5, lean: 2.4, r: 3.2, crown: 3, mound: 2.8 }));
  one('TreeTall', 'Tree, tall', 'Trees', (m) => tree(m, { h: 9, lean: 1.4, r: 3.6, crown: 3.8, mound: 3 }));
  one('Rock', 'Rock', 'Obstacles', (m) => dome(m, 'Rock', [0, 0, 0], 1.6, 1.3, { n: 9, rows: 3, bump: lumps(0.35) }));
}

function cyl(m, top, side, r, y0, y1, n) {
  const p = (a, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU,
      b = ((i + 1) / n) * TAU;
    m.quadFacing(side, p(a, y0), p(b, y0), p(b, y1), p(a, y1), [Math.cos(a), 0, Math.sin(a)]);
    m.triFacing(top, [0, y1, 0], p(a, y1), p(b, y1), [0, 1, 0]);
    m.triFacing(top, [0, y0, 0], p(a, y0), p(b, y0), [0, -1, 0]);
  }
}

module.exports = { hoopRing, hoopGate, PATTERNS, roadProfile, openProfile, platProfile, buildSurface, HALF_ROAD, DECK, DECAL, RAIL_TOP, TILT, DEG, smooth, hermite, every, deckPoly, railPoly, sidePoly, grassStrips, grassPatch, DIRT_VERGE, swept, roadPart, gateArch, paintBand, cyl, arcStepFor, FX, VEHICLES, vehicleArch, chevrons, loopSet, stockGate };
