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

function styleFor(surface) {
  const plastic = surface == 'Plastic';
  // Plastic kerbs and wood rails alternate colour every 2.5 units along the road.
  const every = (k) => (ring) => Math.floor((ring.s + 1e-6) / k) % 2 == 0;
  return {
    surface,
    plastic,
    // BE_PLAIN builds the plain collision meshes: same shapes, no pattern cuts (see build.js).
    pattern: process.env.BE_PLAIN ? null : plastic ? PATTERNS.plastic : PATTERNS.wood,
    deck: plastic ? (ring) => (Math.floor((ring.s + 1e-6) / 5) % 2 ? 'PlasticDeckB' : 'PlasticDeck') : (ring) => plankTone(Math.floor((ring.s + 1e-6) / PLANK)),
    patchMat: plastic ? (i, j) => (((i >> 1) + (j >> 1)) % 2 ? 'PlasticDeckB' : 'PlasticDeck') : (i) => plankTone(i),
    line: plastic ? () => 'PlasticLine' : () => 'WoodBeam',
    rail: plastic ? (ring) => (every(2.5)(ring) ? 'PlasticRail' : 'PlasticKerb') : (ring) => (every(5)(ring) ? 'WoodBeam' : 'WoodBeamB'),
    railTop: plastic ? (ring) => (every(2.5)(ring) ? 'PlasticRail' : 'PlasticKerb') : () => 'WoodBeamB',
    side: plastic ? 'PlasticRail' : 'WoodBeam',
    posts: !plastic,
    under: plastic ? 'PlasticUnder' : 'WoodUnder',
    solid: plastic ? 'PlasticDeck' : 'WoodDeckA',
    solidB: plastic ? 'PlasticRail' : 'WoodBeam',
    trim: plastic ? 'PlasticLine' : 'WoodBeamB',
  };
}

// ---- cross sections (all counter-clockwise, x to the right of travel, y up from the slab bottom) -------------

function deckPoly(st, w, y, line, paint) {
  const inner = w - line,
    P = st.pattern;
  // The deck top is cut where the surface pattern needs it, right to left.
  const cuts = P ? P.lateral(inner).filter((x) => x > -inner + 0.05 && x < inner - 0.05).sort((a, b) => b - a) : [];
  const pts = [[-w, 0], [w, 0], [w, y], [inner, y], ...cuts.map((x) => [x, y]), [-inner, y], [-w, y]],
    n = pts.length;
  return {
    pts,
    cap: st.under,
    mats: (e, ring) => {
      if (e == 0) return st.under;
      if (e == 1 || e == n - 1) return st.side ?? st.under;
      if (e == 2 || e == n - 2) return paint?.(ring, true) ?? st.line(ring);
      const x0 = pts[e][0],
        x1 = pts[e + 1][0];
      return paint?.(ring) ?? (P ? P.mat(ring, (x0 + x1) / 2, x0 - x1, inner) : st.deck(ring));
    },
  };
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
    mats: (e, ring) => (st.plastic && (e == 1 || e == 2) ? st.railTop(ring) : st.rail(ring)),
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

// Connector profile: lerps width and rail height between two kinds of section along the part.
function morphProfile(st, fromW, toW, fromRail, toRail) {
  return (ring) => {
    const t = smooth(ring.u),
      w = fromW + (toW - fromW) * t,
      rail = fromRail + (toRail - fromRail) * t,
      top = DECK + Math.max(0, rail - DECK),
      out = w - HALF_ROAD;
    const R = (side) => {
      const p = railPoly(st, side, top);
      p.pts = p.pts.map(([x, y]) => [x + side * out, y]);
      p.cap = st.solidB;
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
    const N = 6,
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
            const top = side > 0 ? e == 2 : e == 0;
            return top ? (i == N - 1 ? st.line(ring) : st.deck(ring)) : st.under;
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
  const rings = roadRings(path, { step: opt.step ?? ringStep(st), arcStep: opt.arcStep ?? (st.plastic ? 5 : 3.75), y: opt.y, roll: opt.roll, marks: P ? marks : [] });
  const m = swept(rings, profile);
  // Wooden rails get a post every 5 units, standing on the deck through the rail. Drawn only: the plain
  // collision build has no pattern, so the posts never catch the car.
  if (st.posts && profile.rails && P)
    for (const r of rings) {
      if (r.s < 1e-3 || Math.abs(((r.s + 1e-6) % 5) - 1e-6) > 1e-3) continue;
      for (const side of [-1, 1]) {
        const base = add(add(r.p, mul(r.R, side * 6.07)), mul(r.U, DECK + 0.05));
        m.beam('WoodPost', base, add(base, mul(r.U, 1.3)), 0.2);
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

function paintBand(st, a, b, mat) {
  return (ring, isLine) => (ring.s >= a - 1e-6 && ring.s < b - 1e-6 ? mat : isLine ? st.line(ring) : st.deck(ring));
}

// Flat raised glyph used on effect plates, drawn just above the deck.
function chevrons(m, mat, n = 3, y = DECK + 0.015, w = 3.6) {
  for (let i = 0; i < n; i++) {
    const z0 = 6 - i * 5.2,
      t = 1.3,
      l = 2.6;
    m.quadFacing(mat, [-w, y, z0], [0, y, z0 - l], [0, y, z0 - l - t], [-w, y, z0 - t], [0, 1, 0]);
    m.quadFacing(mat, [w, y, z0], [0, y, z0 - l], [0, y, z0 - l - t], [w, y, z0 - t], [0, 1, 0]);
  }
}
function crossGlyph(m, mat, y = DECK + 0.015) {
  const a = 3.6,
    t = 0.9;
  m.quadFacing(mat, [-a, y, -a + t], [-a + t, y, -a], [a, y, a - t], [a - t, y, a], [0, 1, 0]);
  m.quadFacing(mat, [a - t, y, -a], [a, y, -a + t], [-a + t, y, a], [-a, y, a - t], [0, 1, 0]);
}
function barGlyph(m, mat, y = DECK + 0.015) {
  m.quadFacing(mat, [-4, y, -1.1], [4, y, -1.1], [4, y, 1.1], [-4, y, 1.1], [0, 1, 0]);
}
function ringGlyph(m, mat, y = DECK + 0.015) {
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

// ---- catalogue ---------------------------------------------------------------------------------------------

function buildSurface(surface) {
  const st = styleFor(surface);
  const parts = [];
  const put = (name, label, tab, sub, mesh, extra = {}) => parts.push({ name: surface + name, label, tab, sub, surface, mesh, ...extra });
  const families = [
    { key: 'Road', tab: 'Road', profile: roadProfile(st), width: HALF_ROAD, rail: true },
    { key: 'Open', tab: 'Open road', profile: openProfile(st), width: HALF_ROAD, rail: false },
  ];

  for (const F of families) {
    const P = F.profile,
      K = F.key,
      T = F.tab,
      RS = 5;

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
    loopSet(put, st, P, K, T, 'Walls and loops');
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
      prism(c, pts.map(([x, z]) => [x, z]), 0, DECK, { top: st.solid, side: st.under, under: st.under, center: [6, 6] });
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
            f = st.plastic ? st.solid : i % 2 ? 'WoodDeckB' : 'WoodDeckA';
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
          void pi;
          const pts = poly.pts.map(([x, y]) => {
            const fx = Math.sign(x) * Math.min(10, Math.abs(x) <= 5 ? Math.abs(x) : 5 + (Math.abs(x) - 5) * 1);
            const fy = y > DECK + 1e-6 ? DECK : y;
            return [x * t + fx * (1 - t), y * t + fy * (1 - t)];
          });
          return { ...poly, pts };
        });
      };
      put('PipeEntry', 'Platform to half-pipe', TH, 'Half-pipe', roadPart(st, flatten, [{ line: 40 }], { step: 2.5 }));
    }
  }

  // ---- connectors ------------------------------------------------------------------------------------------------
  {
    const T = 'Connectors',
      W = 10,
      R = HALF_ROAD;
    const cases = [
      ['RoadToOpen', 'Road to open road', R, R, RAIL_TOP, DECK],
      ['RoadToPlat', 'Road to platform', R, W, RAIL_TOP, DECK],
      ['OpenToPlat', 'Open road to platform', R, W, DECK, DECK],
    ];
    for (const [n, label, a, b, ra, rb] of cases) {
      put(n, label, T, 'Road types', roadPart(st, morphProfile(st, a, b, ra, rb), [{ line: 20 }], { step: 2.5 }));
      put(n + 'Long', label + ', long', T, 'Road types', roadPart(st, morphProfile(st, a, b, ra, rb), [{ line: 40 }], { step: 2.5 }));
    }
    // Road opening out into a platform while climbing.
    put('RoadToPlatUp', 'Road to platform, climbing', T, 'Road types', roadPart(st, morphProfile(st, R, W, RAIL_TOP, DECK), [{ line: 40 }], { step: 2.5, y: (s) => (0.25 * s * s) / 80 }));
    for (const dir of [1, -1]) {
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
    const widths = [
      { key: 'Road', fam: 'road', make: (paint) => roadProfile(st, paint), w: 6.07, det: 10.5 },
      { key: 'Open', fam: 'open road', make: (paint) => openProfile(st, paint), w: 6.2, det: 12.5 },
      { key: 'Plat', fam: 'platform', make: (paint) => platProfile(st, paint), w: 9.7, det: 18.25 },
    ];
    const detector = (kind, size, cy = 2.2, cz = 0, cx = 0, h = 3.8) =>
      kind == 'Start' ? {} : { detector: { type: kind == 'Checkpoint' ? 0 : 1, center: [cx, cy, cz], size: [size, h, kind == 'Finish' ? 2 : 1] } };
    for (const { kind, label, band } of kinds)
      for (const W of widths) {
        const m = roadPart(st, W.make(paintBand(st, 9, 11, band)), [{ line: 20 }], { step: 2.5 });
        gateArch(m, W.w, st, kind);
        put(kind + W.key, label + ', ' + W.fam, T, label, m, { ...detector(kind, W.det), ...(kind == 'Start' ? { startOffset: [0, 0.35, 1.35] } : {}) });
      }
    // Checkpoints in the middle of slopes, banks and diagonals. The trigger box is taller so it still catches the car.
    for (const W of widths)
      for (const { g, n } of [{ g: 0.25, n: 'gentle' }, { g: 0.5, n: 'medium' }, { g: 1, n: 'steep' }]) {
        const m = roadPart(st, W.make(paintBand(st, 9, 11, 'Checkpoint')), [{ line: 20 }], { step: 2.5, y: (s) => g * s });
        gateArch(m, W.w, st, 'Checkpoint', g * 10);
        put('Checkpoint' + W.key + n, 'Checkpoint, ' + n + ' slope, ' + W.fam, T, 'Checkpoint on slope', m, { detector: { type: 0, center: [0, g * 10 + 2.2, 0], size: [W.det, 3.8 + g * 2, 1] } });
      }
    for (const W of widths.slice(0, 2))
      for (const dir of [1, -1]) {
        const roll = dir * TILT;
        const m = roadPart(st, W.make(paintBand(st, 9, 11, 'Checkpoint')), [{ line: 20 }], { step: 2.5, y: () => 5, roll: () => roll });
        gateArch(m, W.w, st, 'Checkpoint', 5, roll);
        put('Checkpoint' + W.key + 'Tilt' + (dir > 0 ? 'L' : 'R'), 'Checkpoint, banked ' + (dir > 0 ? 'left high' : 'right high') + ', ' + W.fam, T, 'Checkpoint on bank', m, { detector: { type: 0, center: [0, 6.2, 0], size: [W.det, 9, 1] } });
      }
    for (const W of widths.slice(0, 2)) {
      const m = roadPart(st, W.make(paintBand(st, 12.14, 16.14, 'Checkpoint')), [{ line: 20 * Math.SQRT2 }], { start: [-10, 10, 45 * DEG], step: 2.02 });
      const c = Math.SQRT1_2,
        w = W.w;
      m.beam(st.solidB, [-w * c, 0.1, -w * c], [-w * c, 4.6, -w * c], 0.3);
      m.beam(st.solidB, [w * c, 0.1, w * c], [w * c, 4.6, w * c], 0.3);
      m.beam('Checkpoint', [-w * c, 4.4, -w * c], [w * c, 4.4, w * c], 0.36);
      put('Checkpoint' + W.key + 'Diag', 'Checkpoint, diagonal, ' + W.fam, T, 'Checkpoint on diagonal', m, { detector: { type: 0, center: [0, 2.2, 0], size: [7.5, 3.8, 7.5] } });
    }
    // Wide gates span two blocks of platform.
    for (const { kind, label, band } of kinds) {
      const m = new Mesh();
      sweep(m, roadRings(hPath([{ line: 20 }], [10, 10, 0]), { step: 2.5 }), () => {
        const p = deckPoly(st, 20, DECK, 0.5, paintBand(st, 9, 11, band));
        return [p];
      });
      gateArch(m, 19.7, st, kind);
      m.byMat = shiftMesh(m, 10).byMat;
      put(kind + 'PlatWide', label + ', wide platform', T, label, m, { ...(kind == 'Start' ? { startOffset: [-10, 0.35, 1.35] } : { detector: { type: kind == 'Checkpoint' ? 0 : 1, center: [10, 2.2, 0], size: [38.25, 3.8, kind == 'Finish' ? 2 : 1] } }) });
    }
    // A checkpoint on a wall, climbing straight up.
    {
      const m = swept(wallRings(20), platProfile(st, paintBand(st, 9, 11, 'Checkpoint')));
      m.beam(st.solidB, [-9.7, 10, -9.8], [-9.7, 10, -5.4], 0.3);
      m.beam(st.solidB, [9.7, 10, -9.8], [9.7, 10, -5.4], 0.3);
      m.beam('Checkpoint', [-9.7, 10, -5.6], [9.7, 10, -5.6], 0.36);
      put('CheckpointWall', 'Checkpoint on a wall', T, 'Checkpoint on wall', m, { detector: { type: 0, center: [0, 10, -7.6], size: [18.25, 1, 3.8] } });
    }
  }

  // ---- gameplay plates: effects run in the physics worker (see site/tm_runtime.js) -------------------------------------
  {
    const T = 'Effects';
    for (const fx of FX)
      for (const W of [
        { key: 'Road', fam: 'road', make: (p) => roadProfile(st, p), sx: 11.13 },
        { key: 'Open', fam: 'open road', make: (p) => openProfile(st, p), sx: 13.1 },
        { key: 'Plat', fam: 'platform', make: (p) => platProfile(st, p), sx: 19.5 },
      ]) {
        const paint = (ring, isLine) => (isLine ? st.line(ring) : fx.mat);
        const m = roadPart(st, W.make(paint), [{ line: 20 }], { step: 5 });
        fx.glyph(m, DECK + 0.015);
        put('Fx' + fx.key + W.key, fx.label + ', ' + W.fam, T, fx.label, m, { fx: { type: fx.key, center: [0, 2.5, 0], size: [W.sx, 5, 12] } });
      }
  }

  // ---- penalty grass built into this surface's blocks ------------------------------------------------------------------
  {
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
        return [x, DECK + 0.4 * (1 - d * d), z];
      });
      put('GrassPlatIsland', 'Platform with a grass island', T, 'Platform with grass', m);
    }
    [30, 50].forEach((r) => put('GrassPlatCurve' + r, 'Platform curve with grass outside, radius ' + r, T, 'Platform with grass', roadPart(st, plat([[5, 10]]), [{ r, ang: 90 * DEG, dir: 1 }], { arcStep: arcStepFor(r) })));
  }

  // ---- deco and scenery ----------------------------------------------------------------------------------------------
  decoSet(put, st);
  return parts;
}

// Gameplay plates. Effects run in the physics worker, see site/tm_runtime.js.
const FX = [
  { key: 'Turbo', label: 'Turbo', mat: 'FxTurbo', glyph: (m, y) => chevrons(m, 'FxTurboB', 3, y) },
  { key: 'Super', label: 'Super turbo', mat: 'FxSuper', glyph: (m, y) => chevrons(m, 'FxSuperB', 3, y) },
  { key: 'Roulette', label: 'Turbo roulette', mat: 'FxRoulette', glyph: (m, y) => rouletteGlyph(m, y) },
  { key: 'ReactorUp', label: 'Reactor boost', mat: 'FxReactor', glyph: (m, y) => arrowGlyph(m, 'FxReactorB', y, 1) },
  { key: 'ReactorDown', label: 'Reactor boost, down', mat: 'FxReactor', glyph: (m, y) => arrowGlyph(m, 'FxReactorB', y, -1) },
  { key: 'Reactor2Up', label: 'Super reactor boost', mat: 'FxReactor2', glyph: (m, y) => arrowGlyph(m, 'FxReactor2B', y, 1) },
  { key: 'Reactor2Down', label: 'Super reactor boost, down', mat: 'FxReactor2', glyph: (m, y) => arrowGlyph(m, 'FxReactor2B', y, -1) },
  { key: 'Reset', label: 'Reset effects', mat: 'FxReset', glyph: (m, y) => ringGlyph(m, 'FxResetB', y) },
  { key: 'NoEngine', label: 'No engine', mat: 'FxNoEngine', glyph: (m, y) => crossGlyph(m, 'FxNoEngineB', y) },
  { key: 'NoBrake', label: 'No brakes', mat: 'FxNoBrake', glyph: (m, y) => barGlyph(m, 'FxNoBrakeB', y) },
  { key: 'NoSteer', label: 'No steering', mat: 'FxNoSteer', glyph: (m, y) => crossGlyph(m, 'FxNoSteerB', y) },
  { key: 'Slow', label: 'Slow motion', mat: 'FxSlow', glyph: (m, y) => ringGlyph(m, 'FxSlowB', y) },
  { key: 'Cruise', label: 'Cruise control', mat: 'FxCruise', glyph: (m, y) => chevrons(m, 'FxCruiseB', 2, y, 2.4) },
  { key: 'Fragile', label: 'Fragile', mat: 'FxFragile', glyph: (m, y) => ringGlyph(m, 'FxFragileB', y) },
];

function arrowGlyph(m, mat, y, dir) {
  // An up or down arrow seen from the driver: a triangle and a stem along the road.
  const tip = -5 * dir,
    base = -1 * dir;
  m.triFacing(mat, [0, y, tip], [-3.2, y, base], [3.2, y, base], [0, 1, 0]);
  m.quadFacing(mat, [-1.2, y, base], [1.2, y, base], [1.2, y, base + 5.5 * dir], [-1.2, y, base + 5.5 * dir], [0, 1, 0]);
}
function rouletteGlyph(m, y) {
  const mats = ['FxTurboB', 'FxSuperB', 'FxReactor2B'];
  for (let i = 0; i < 3; i++) {
    const z0 = 5 - i * 4;
    m.quadFacing(mats[i], [-4, y, z0], [4, y, z0], [4, y, z0 - 2.4], [-4, y, z0 - 2.4], [0, 1, 0]);
  }
}

// Penalty grass strips as extra profile polygons, flush with the deck top.
function grassStrips(inner, outer, a, b) {
  const strip = (x0, x1) => ({
    pts: [[x0, 0], [x1, 0], [x1, DECK], [x0, DECK]],
    cap: 'GrassUnder',
    mats: (e, ring) => (e == 2 ? (Math.floor((ring.s + 1e-6) / 5) % 2 ? 'GrassB' : 'Grass') : e == 0 || e == 1 || e == 3 ? 'GrassUnder' : null),
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
  const w = F.width,
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
  return m;
}

function deadEnd(st, F) {
  const m = new Mesh();
  sweep(m, roadRings(hPath([{ line: 10 }]), { step: ringStep(st) }), F.rail ? roadProfile(st) : openProfile(st));
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
    m.box(b, [-7, 0, -0.5], [-6, 5, 0.5], c);
    m.box(b, [6, 0, -0.5], [7, 5, 0.5], c);
    m.box(c, [-7.5, 4.6, -0.7], [7.5, 5, 0.7], b);
    put('SupportFrame', 'Road support frame', T, 'Supports', m);
    const t = new Mesh();
    t.box(b, [-7, 0, -0.5], [-6, 20, 0.5], c);
    t.box(b, [6, 0, -0.5], [7, 20, 0.5], c);
    for (const y of [5, 10, 15, 19.6]) t.box(c, [-7.5, y, -0.7], [7.5, y + 0.4, 0.7], b);
    t.beam(c, [-6.5, 0.5, 0], [6.5, 9.5, 0], 0.25);
    t.beam(c, [6.5, 0.5, 0], [-6.5, 9.5, 0], 0.25);
    t.beam(c, [-6.5, 10.5, 0], [6.5, 19.5, 0], 0.25);
    t.beam(c, [6.5, 10.5, 0], [-6.5, 19.5, 0], 0.25);
    put('SupportTrestle', st.plastic ? 'Truss tower, 4 layers' : 'Trestle tower, 4 layers', T, 'Supports', t);
    const l = new Mesh();
    for (const [x, z] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) l.box(b, [x - 0.6, 0, z - 0.6], [x + 0.6, 5, z + 0.6], c);
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
    put('Fence', st.plastic ? 'Fence, plastic rails' : 'Fence, wooden rails', T, 'Barriers and signs', r);
    for (const [n, l, dir] of [['SignLeft', 'Sign, turn left', 1], ['SignRight', 'Sign, turn right', -1]]) {
      const s = new Mesh();
      s.box(b, [-0.3, 0, -9.8], [0.3, 3, -9.2], c);
      s.box(c, [-5, 3, -9.8], [5, 7, -9.5], b);
      const y = 5,
        z = -9.48,
        w = (d) => [d, y, z];
      s.triFacing('FxReset', [dir * -3, y, z], [dir * 0, y + 1.6, z], [dir * 0, y - 1.6, z], [0, 0, 1]);
      s.quadFacing('FxReset', w(dir * 0), [dir * 3.2, y + 0.6, z], [dir * 3.2, y - 0.6, z], w(dir * 0), [0, 0, 1]);
      s.quadFacing('FxReset', [0, y + 0.6, z], [dir * 3.2, y + 0.6, z], [dir * 3.2, y - 0.6, z], [0, y - 0.6, z], [0, 0, 1]);
      put(n, l, T, 'Barriers and signs', s);
    }
    const arch = new Mesh();
    arch.box(b, [-10, 0, -1], [-8, 7, 1], c);
    arch.box(b, [8, 0, -1], [10, 7, 1], c);
    arch.box(a, [-10, 7, -1], [10, 9, 1], c);
    put('Arch', 'Arch', T, 'Shapes', arch);
    const cr = new Mesh();
    if (st.plastic) {
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

module.exports = { PATTERNS, roadProfile, openProfile, platProfile, buildSurface, HALF_ROAD, DECK, RAIL_TOP, TILT, DEG, smooth, hermite, deckPoly, railPoly, sidePoly, grassStrips, grassPatch, swept, roadPart, gateArch, paintBand, cyl, arcStepFor, FX, chevrons };
