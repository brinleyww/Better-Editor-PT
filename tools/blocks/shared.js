// The Stadium category: blocks that belong to no single surface. Penalty grass, expandable box gates, special gates,
// track walls, structures, stages, screens, water and deco. Same rules as catalog.js: every shape is generated here.
const G = require('./geom');
const { Mesh, hPath, roadRings, sweep, patch, prism, add, mul, norm, TAU } = G;
const C = require('./catalog');
const { DECK, DECAL, DEG, HALF_ROAD, smooth, every, deckPoly, grassStrips, grassPatch, DIRT_VERGE, roadPart, gateArch, cyl, arcStepFor, FX, VEHICLES, vehicleArch, hoopRing, hoopGate, putFinishBoxes } = C;

// Concrete stands in for the stock grey; penalty grass mows in 5-unit stripes.
const ST = {
  surface: 'Stadium',
  plastic: true,
  deck: () => 'Concrete',
  line: () => 'ConcreteDark',
  rail: () => 'ConcreteDark',
  railTop: () => 'Metal',
  under: 'ConcreteUnder',
  solid: 'Concrete',
  solidB: 'ConcreteDark',
  trim: 'Metal',
};
const GRASS = {
  ...ST,
  pattern: process.env.BE_PLAIN ? null : C.PATTERNS.grass,
  side: 'GrassUnder',
  deck: (ring) => (Math.floor((ring.s + 1e-6) / 5) % 2 ? 'GrassB' : 'Grass'),
  line: (ring) => (Math.floor((ring.s + 1e-6) / 5) % 2 ? 'GrassB' : 'Grass'),
  under: 'GrassUnder',
};
// TM2020's bump road ("sausage"): stock road grey, the stock road's red and white kerbs down both edges, and a crown
// right across instead of a flat deck. Its grip is stock road's (surface 8, tech).
const TECH = {
  ...ST,
  pattern: null,
  deck: () => 'TechDeck',
  line: (ring) => (every(5)(ring) ? 'TechEdgeRed' : 'TechEdgeWhite'),
  side: 'ConcreteDark',
  under: 'ConcreteUnder',
  solid: 'TechDeck',
  solidB: 'ConcreteDark',
  trim: 'TechEdgeWhite',
};
// The crown: half an ellipse over the stock road's width, h above the deck at the middle, cut into n edges.
const BUMP = { w: HALF_ROAD, h: 1.4, n: 16 };
const crownY = (x) => DECK + BUMP.h * Math.sqrt(Math.max(0, 1 - (x / BUMP.w) ** 2));
// One convex polygon: the slab's bottom and sides, then the crown from the right edge over to the left. The two
// crown edges at each side are the kerbs. paint colours the crown (gate bands, effect plates); h, a lower crown.
function bumpPoly(paint, h = BUMP.h) {
  const { w, n } = BUMP,
    crown = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI;
    crown.push([w * Math.cos(a), DECK + h * Math.sin(a)]);
  }
  const pts = [[-w, 0], [w, 0], ...crown];
  return {
    pts,
    cap: TECH.under,
    mats: (e, ring) => {
      if (e == 0) return TECH.under;
      if (e == 1 || e == pts.length - 1) return TECH.side;
      const k = e - 2,
        kerb = k < 2 || k >= n - 2;
      return paint?.(ring, kerb) ?? (kerb ? TECH.line(ring) : TECH.deck(ring));
    },
  };
}
// Effect glyphs are flat; on the crown they are cut small and laid onto it. They float 0.02 higher than on a flat
// deck: the crown is curved, so the plate under a glyph is never quite parallel to it.
function onCrown(m) {
  const out = new Mesh(),
    lift = (p) => [p[0], p[1] + crownY(p[0]) - DECK + 0.02, p[2]];
  for (const [mat, l] of m.byMat)
    for (let i = 0; i < l.length; i += 3) {
      const [a, b, c] = [l[i], l[i + 1], l[i + 2]],
        k = Math.max(1, Math.ceil(Math.max(G.len(G.sub(b, a)), G.len(G.sub(c, b)), G.len(G.sub(a, c))) / 0.5)),
        at = (u, v) => add(add(a, mul(G.sub(b, a), u / k)), mul(G.sub(c, a), v / k));
      for (let u = 0; u < k; u++)
        for (let v = 0; u + v < k; v++) {
          out.tri(mat, lift(at(u, v)), lift(at(u + 1, v)), lift(at(u, v + 1)));
          if (u + v + 1 < k) out.tri(mat, lift(at(u + 1, v)), lift(at(u + 1, v + 1)), lift(at(u, v + 1)));
        }
    }
  return out;
}

function buildShared() {
  const parts = [];
  // u: the surface the physics uses for the whole part (2 = penalty grass), null keeps stock physics.
  const put = (name, label, tab, sub, mesh, extra = {}) => {
    // Rounded deco (beams, tubes) can poke a little below the floor: lift it so it rests on its layer.
    const low = mesh.bounds().min[1];
    if (low < 0) {
      const lifted = new Mesh();
      lifted.merge(mesh, [0, -low, 0]);
      mesh = lifted;
    }
    parts.push({ name: 'Stadium' + name, label, tab, sub, surface: 'Stadium', mesh, u: null, ...extra });
  };

  // ---- penalty grass ----------------------------------------------------------------------------------------------
  {
    const T = 'Penalty grass',
      g = { u: 2 };
    const P = () => [deckPoly(GRASS, 10, DECK, 0.5)];
    put('Grass', 'Penalty grass', T, 'Flat', roadPart(GRASS, P, [{ line: 20 }]), g);
    put('GrassX2', 'Penalty grass, 2 long', T, 'Flat', roadPart(GRASS, P, [{ line: 40 }]), g);
    put('GrassHalf', 'Penalty grass, half', T, 'Flat', roadPart(GRASS, P, [{ line: 10 }]), g);
    [10, 30, 50].forEach((r, i) => put('GrassCurve' + (i + 1), 'Penalty grass curve ' + (i + 1), T, 'Flat', roadPart(GRASS, P, [{ r, ang: 90 * DEG, dir: 1 }], { arcStep: arcStepFor(r) }), g));
    for (const { gr, n, L } of [{ gr: 0.25, n: 'Gentle', L: 40 }, { gr: 0.5, n: 'Medium', L: 20 }, { gr: 1, n: 'Steep', L: 40 }]) {
      const sub = 'Hills, ' + n.toLowerCase();
      put('Grass' + n + 'Start', 'Grass hill, ' + n.toLowerCase() + ', start', T, sub, roadPart(GRASS, P, [{ line: L }], { step: 2.5, y: (s) => (gr * s * s) / (2 * L) }), g);
      put('Grass' + n, 'Grass hill, ' + n.toLowerCase() + ' slope', T, sub, roadPart(GRASS, P, [{ line: 20 }], { y: (s) => gr * s }), g);
      put('Grass' + n + 'End', 'Grass hill, ' + n.toLowerCase() + ', top', T, sub, roadPart(GRASS, P, [{ line: L }], { step: 2.5, y: (s) => gr * s - (gr * s * s) / (2 * L) }), g);
      const rise = gr * 20,
        grid = (fn, name, label) => {
          const m = new Mesh();
          patch(m, (u, v) => [-10 + 20 * u, DECK + fn(-10 + 20 * u, -10 + 20 * v), -10 + 20 * v], 10, 10, { mat: (i, j) => ((i + j) % 2 ? 'GrassB' : 'Grass'), under: 'GrassUnder', want: () => [0, 1, 0] });
          put('Grass' + n + name, 'Grass hill, ' + n.toLowerCase() + ', ' + label, T, sub, m, g);
        };
      const a = (x) => ((x + 10) / 20) * rise,
        b = (z) => ((z + 10) / 20) * rise;
      grid((x, z) => Math.min(a(x), b(z)), 'Outer', 'outer corner');
      grid((x, z) => Math.max(a(x), b(z)), 'Inner', 'inner corner');
      grid((x, z) => Math.max(0, 1 - Math.hypot(10 - x, 10 - z) / 20) * rise, 'CurveOut', 'round outer corner');
      grid((x, z) => Math.min(1, Math.hypot(x + 10, z + 10) / 20) * rise, 'CurveIn', 'round inner corner');
    }
    {
      // A whole mound: 2 x 2 blocks, 2 layers tall.
      const m = new Mesh();
      patch(m, (u, v) => {
        const x = -10 + 40 * u,
          z = -30 + 40 * v,
          d = Math.min(1, Math.hypot(x - 10, z + 10) / 20);
        return [x, DECK + 10 * (0.5 + 0.5 * Math.cos(d * Math.PI)), z];
      }, 16, 16, { mat: (i, j) => ((i + j) % 2 ? 'GrassB' : 'Grass'), under: 'GrassUnder', want: () => [0, 1, 0] });
      put('GrassMound', 'Grass mound', T, 'Hills, mounds', m, g);
      const r = new Mesh();
      patch(r, (u, v) => {
        const x = -10 + 20 * u,
          z = -10 + 20 * v;
        return [x, DECK + 2.5 * (0.5 + 0.5 * Math.cos(Math.min(1, Math.abs(x) / 10) * Math.PI)), z];
      }, 12, 4, { mat: (i, j) => ((i + j) % 2 ? 'GrassB' : 'Grass'), under: 'GrassUnder', want: () => [0, 1, 0] });
      put('GrassRidge', 'Grass ridge', T, 'Hills, mounds', r, g);
    }
    // Concrete with a grass verge: the verge is penalty grass, the concrete drives like stock road.
    put('ConcreteGrassVerge', 'Concrete with a grass verge', T, 'Flat', roadPart(ST, () => [{ pts: [[-10, 0], [3, 0], [3, DECK], [-10, DECK]], cap: 'ConcreteUnder', mats: (e) => (e == 2 ? 'Concrete' : 'ConcreteUnder') }, ...grassStrips(null, null, 3, 10)], [{ line: 20 }]));
    // The same with a dirt verge, TM's other offroad border: the verge drives like dirt (surface 5).
    put('ConcreteDirtVerge', 'Concrete with a dirt verge', T, 'Flat', roadPart(ST, () => [{ pts: [[-10, 0], [3, 0], [3, DECK], [-10, DECK]], cap: 'ConcreteUnder', mats: (e) => (e == 2 ? 'Concrete' : 'ConcreteUnder') }, ...grassStrips(null, null, 3, 10, DIRT_VERGE)], [{ line: 20 }]));
  }

  // ---- expandable box gates ------------------------------------------------------------------------------------------
  // One piece per block. Each piece draws only the frame edges it is told to, so a 3 x 2 box is six pieces placed together.
  {
    const T = 'Box gates';
    const kinds = [
      { kind: 'Start', label: 'Start', bar: 'StartLine', det: null },
      { kind: 'Checkpoint', label: 'Checkpoint', bar: 'Checkpoint', det: 0 },
      { kind: 'Finish', label: 'Finish', bar: 'Finish', det: 1 },
    ];
    const edgeNames = { L: 'left', R: 'right', T: 'top', B: 'bottom' };
    const shapes = [];
    for (let mask = 0; mask < 16; mask++) shapes.push(['L', 'R', 'T', 'B'].filter((_, i) => mask & (1 << i)));
    for (const K of kinds)
      for (const edges of shapes) {
        const m = new Mesh(),
          h = 5,
          t = 0.5,
          d = 0.45;
        const bar = (x0, y0, x1, y1) => {
          if (K.kind == 'Finish') {
            // Chequered bars, alternating squares along the bar.
            const along = x1 - x0 > y1 - y0,
              n = Math.max(1, Math.round((along ? x1 - x0 : y1 - y0) / t));
            for (let i = 0; i < n; i++) {
              const a0 = i / n,
                a1 = (i + 1) / n;
              const mat = i % 2 ? 'FinishWhite' : 'FinishBlack';
              if (along) m.box(mat, [x0 + (x1 - x0) * a0, y0, -d], [x0 + (x1 - x0) * a1, y1, d]);
              else m.box(mat, [x0, y0 + (y1 - y0) * a0, -d], [x1, y0 + (y1 - y0) * a1, d]);
            }
          } else m.box(K.bar, [x0, y0, -d], [x1, y1, d], 'ConcreteDark');
        };
        const y0 = edges.includes('B') ? 0.26 : 0.21,
          y1 = edges.includes('T') ? h - t : h;
        if (edges.includes('L')) bar(-10, y0, -10 + t, y1);
        if (edges.includes('R')) bar(10 - t, y0, 10, y1);
        if (edges.includes('T')) bar(-10, h - t, 10, h);
        if (edges.includes('B')) m.box(K.bar == 'Finish' ? 'FinishWhite' : K.bar, [-10, 0.21, -d], [10, 0.26, d], K.bar == 'Finish' ? 'FinishBlack' : 'ConcreteDark');
        // A piece with no edges is the open middle of a big box. It still needs a mesh, so it gets one hidden sliver.
        if (!edges.length) m.tri('ConcreteDark', [-0.01, 0.001, 0], [0.01, 0.001, 0], [0, 0.001, 0.01]);
        const key = edges.length ? edges.join('') : 'Middle';
        const label = K.label + ' box, ' + (edges.length ? edges.map((e) => edgeNames[e]).join(' + ') + ' edge' + (edges.length > 1 ? 's' : '') : 'open middle');
        const sub = edges.length == 4 ? 'Single piece' : edges.length == 0 ? 'Middle' : edges.includes('B') ? 'Bottom row' : edges.includes('T') ? 'Top row' : 'Middle row';
        const extra = K.det == null ? { startOffset: [0, 0.35, 1.35] } : { detector: { type: K.det, center: [0, 2.5, 0], size: [20, 5, K.det == 1 ? 2 : 1] } };
        put('Box' + K.kind + key, label, T, K.label + ': ' + sub, m, extra);
      }
  }

  // ---- finish hoops: round finish gates, 1 to 4 blocks across. Hidden: finish boxes replace them in the menu --------------
  {
    const T = 'Box gates';
    for (let n = 1; n <= 4; n++) {
      const w = n + ' block' + (n > 1 ? 's' : '') + ' wide';
      put('FinishHoopPlat' + n, 'Finish hoop, ' + w + ', platform', T, 'Finish hoop', hoopGate(ST, 'Plat', n), { detector: { type: 1, center: [0, 2.2, 0], size: [18.25, 3.8, 2] }, hidden: true });
      // A whole ring with nothing under it, for finishing in the air. Its trigger fills the middle of the ring.
      const m = new Mesh(),
        { R, yc } = hoopRing(m, n, false);
      put('FinishHoopAir' + n, 'Finish hoop in the air, ' + w, T, 'Finish hoop in the air', m, { detector: { type: 1, center: [0, yc, 0], size: [R * 1.4, R * 1.4, 2] }, hidden: true });
    }
    putFinishBoxes(put, T);
  }

  // ---- special gates: an arch that applies an effect, on any surface ------------------------------------------------------
  {
    const T = 'Special gates';
    for (const fx of FX) {
      const m = new Mesh();
      m.box('ConcreteDark', [-10, 0.21, -0.6], [-9.2, 4.4, 0.6], 'Metal');
      m.box('ConcreteDark', [9.2, 0.21, -0.6], [10, 4.4, 0.6], 'Metal');
      m.box(fx.mat, [-10, 4.4, -0.7], [10, 5.4, 0.7], 'ConcreteDark');
      for (let i = 0; i < 4; i++) m.box(fx.mat, [-9.2, 0.21 + i * 1.05, -0.3], [-8.9, 0.81 + i * 1.05, 0.3]), m.box(fx.mat, [8.9, 0.21 + i * 1.05, -0.3], [9.2, 0.81 + i * 1.05, 0.3]);
      put('Gate' + fx.key, fx.label + ' gate', T, 'Special gates', m, { fx: { type: fx.key, center: [0, 2.6, 0], size: [18.4, 5, 3] }, hidden: fx.hidden });
    }
  }

  // ---- vehicle gates: TM2020's transform gates on any surface, posts at the block edges like the special gates ----------
  for (const V of VEHICLES) {
    const m = new Mesh();
    vehicleArch(m, 9.6, DECK, V);
    put('GateCar' + V.key, V.label, 'Vehicle gates', V.label, m, { fx: { type: 'Car' + V.key, center: [0, 2.6, 0], size: [18.4, 5, 3] } });
  }

  // ---- bump road: TM2020's sausage road, a crown right across, driven at stock road grip -------------------------------
  {
    const T = 'Bump road',
      u = { u: 8 },
      P = (paint) => () => [bumpPoly(paint)];
    put('BumpStraight', 'Bump road', T, 'Straights', roadPart(TECH, P(), [{ line: 20 }]), u);
    put('BumpStraightX2', 'Bump road, 2 long', T, 'Straights', roadPart(TECH, P(), [{ line: 40 }]), u);
    put('BumpHalf', 'Bump road, half', T, 'Straights', roadPart(TECH, P(), [{ line: 10 }]), u);
    [10, 30, 50, 70, 90].forEach((r, i) => put('BumpCurve' + (i + 1), 'Bump road curve ' + (i + 1) + ' (radius ' + r + ')', T, 'Turns', roadPart(TECH, P(), [{ r, ang: 90 * DEG, dir: 1 }], { arcStep: arcStepFor(r) }), u));
    for (const [L, shift] of [[20, 5], [40, 10], [40, 20]])
      for (const dir of [1, -1]) {
        const r = (L * L + shift * shift) / (4 * shift),
          ang = Math.asin(L / (2 * r));
        put('BumpChicane' + L + 'x' + shift + (dir > 0 ? 'R' : 'L'), 'Bump road chicane ' + (dir > 0 ? 'right' : 'left') + ', ' + L / 20 + ' long, ' + shift + ' over', T, 'Chicanes', roadPart(TECH, P(), [{ r, ang, dir }, { r, ang, dir: -dir }], { arcStep: 3.75 }), u);
      }
    for (const { g, n, L } of [{ g: 0.25, n: 'Gentle', L: 40 }, { g: 0.5, n: 'Medium', L: 20 }]) {
      const sub = n + ' slopes';
      put('Bump' + n + 'Start', 'Bump road, ' + n.toLowerCase() + ' slope start', T, sub, roadPart(TECH, P(), [{ line: L }], { step: 2.5, y: (s) => (g * s * s) / (2 * L) }), u);
      put('Bump' + n, 'Bump road, ' + n.toLowerCase() + ' slope', T, sub, roadPart(TECH, P(), [{ line: 20 }], { y: (s) => g * s }), u);
      put('Bump' + n + 'End', 'Bump road, ' + n.toLowerCase() + ' slope end', T, sub, roadPart(TECH, P(), [{ line: L }], { step: 2.5, y: (s) => g * s - (g * s * s) / (2 * L) }), u);
    }
    // The way on from the stock road: the crown rises out of the flat deck over one block (0.02 at the road end, so
    // the polygon never folds flat), without it a car driving onto bump road hits a 1.4 unit step and stops dead.
    {
      const L = 20,
        h = (s) => { const t = Math.min(1, Math.max(0, s / L)); return 0.02 + (BUMP.h - 0.02) * t * t * (3 - 2 * t); };
      put('BumpFromRoad', 'Bump road from road', T, 'Straights', roadPart(TECH, (ring) => [bumpPoly(null, h(ring.s))], [{ line: L }], { step: 2.5 }), u);
    }
    put('BumpCrest', 'Bump road crest', T, 'Crests and dips', roadPart(TECH, P(), [{ line: 40 }], { step: 2.5, y: (s) => 5 * (0.5 - 0.5 * Math.cos((s / 40) * 2 * Math.PI)) }), u);
    put('BumpDip', 'Bump road dip', T, 'Crests and dips', roadPart(TECH, P(), [{ line: 40 }], { step: 2.5, y: (s) => 5 - 5 * (0.5 - 0.5 * Math.cos((s / 40) * 2 * Math.PI)) }), u);
    // Gates the bobsleigh way: a band painted across the crown and an arch whose posts stand in the kerbs. The posts
    // sit 0.2 up so the banner stays inside one layer; the start puts the car on top of the crown.
    for (const { kind, label, band } of [{ kind: 'Start', label: 'Start', band: 'StartLine' }, { kind: 'Checkpoint', label: 'Checkpoint', band: 'Checkpoint' }, { kind: 'Finish', label: 'Finish', band: 'Finish' }]) {
      const m = roadPart(TECH, P((ring) => (ring.s >= 9 - 1e-6 && ring.s < 11 - 1e-6 ? band : null)), [{ line: 20 }], { marks: [9, 11] });
      gateArch(m, 6.2, TECH, kind, 0.2);
      const det = kind == 'Start' ? { startOffset: [0, 0.35 + BUMP.h, 1.35] } : { detector: { type: kind == 'Checkpoint' ? 0 : 1, center: [0, 2.9, 0], size: [12.5, 3.8, kind == 'Finish' ? 2 : 1] } };
      put(kind + 'Bump', label + ', bump road', T, 'Gates', m, { ...u, ...det });
    }
    for (const fx of FX) {
      const m = roadPart(TECH, P((ring, kerb) => (kerb ? null : fx.mat)), [{ line: 20 }], { step: 5 }),
        glyph = new Mesh();
      fx.glyph(glyph, DECAL);
      m.merge(onCrown(glyph));
      put('Fx' + fx.key + 'Bump', fx.label + ', bump road', T, 'Effects', m, { ...u, fx: { type: fx.key, center: [0, 2.5, 0], size: [13.1, 5, 12] }, hidden: fx.hidden });
    }
  }

  // ---- track walls --------------------------------------------------------------------------------------------------------
  {
    const T = 'Track walls';
    const wallPoly = () => [{
      pts: [[-2.5, 0], [2.5, 0], [2.5, 3.6], [1.6, 4.6], [-1.6, 4.6], [-2.5, 3.6]],
      cap: 'ConcreteDark',
      mats: (e, ring) => (e == 3 ? 'WallTop' : e == 0 ? 'ConcreteUnder' : Math.floor(ring.s / 5) % 2 ? 'Concrete' : 'ConcreteB'),
    }];
    const wall = (segs, start) => roadPart(ST, wallPoly, segs, { start, step: 5, arcStep: 2.5 });
    const make = (name, label, mk, sub) => {
      put('TrackWall' + name, label, T, sub, mk());
      // The same wall three layers up on a square pillar.
      const tall = new Mesh();
      tall.merge(mk(), [0, 15, 0]);
      tall.box('ConcreteDark', [-2, 0, -2], [2, 15, 2], 'ConcreteDark');
      put('TrackWall' + name + 'Pillar', label + ', on a pillar', T, sub + ' on pillars', tall);
    };
    make('Straight', 'Track wall', () => wall([{ line: 20 }]), 'Track walls');
    [10, 30, 50].forEach((r, i) => make('Curve' + (i + 1), 'Track wall curve ' + (i + 1), () => wall([{ r, ang: 90 * DEG, dir: 1 }]), 'Track walls'));
    make('Cross', 'Track wall crossing', () => {
      const m = wall([{ line: 20 }]);
      // The crossing wall comes in from both sides and stops at the first wall's faces.
      m.merge(wall([{ line: 7.5 }], [-10, 0, Math.PI / 2]));
      m.merge(wall([{ line: 7.5 }], [2.5, 0, Math.PI / 2]));
      return m;
    }, 'Track walls');
    make('End', 'Track wall, rounded end', () => {
      const m = wall([{ line: 10 }]);
      const N = 10;
      for (let i = 0; i < N; i++) {
        const a0 = Math.PI + (i / N) * Math.PI,
          a1 = Math.PI + ((i + 1) / N) * Math.PI,
          // the half disc caps the open end beyond z = 0, on the far side from the wall
          p = (a, y) => [Math.cos(a) * 2.5, y, Math.sin(a) * 2.5];
        m.quadFacing('Concrete', p(a0, 0), p(a1, 0), p(a1, 4.6), p(a0, 4.6), [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)]);
        m.triFacing('WallTop', [0, 4.6, 0], p(a0, 4.6), p(a1, 4.6), [0, 1, 0]);
      }
      return m;
    }, 'Track walls');
    make('ToRoad', 'Track wall ramping down to the road', () => roadPart(ST, (ring) => {
      const k = 1 - smooth(ring.u),
        h = 0.3 + 4.3 * k;
      return [{ pts: [[-2.5, 0], [2.5, 0], [2.5, Math.max(0.25, h - 1)], [1.6, h], [-1.6, h], [-2.5, Math.max(0.25, h - 1)]], cap: 'ConcreteDark', mats: (e) => (e == 3 ? 'WallTop' : e == 0 ? 'ConcreteUnder' : 'Concrete') }];
    }, [{ line: 20 }], { step: 2.5 }), 'Track walls');
  }

  // ---- structures: steel trusses and supports -----------------------------------------------------------------------------
  {
    const T = 'Structures';
    const truss = (m, a, b, w = 0.9) => {
      // Four chords and zig-zag bracing between two points.
      const t = norm(G.sub(b, a));
      // Pull the ends in a little so beam thickness never pokes through the part's floor.
      a = add(a, mul(t, 0.15));
      b = add(b, mul(t, -0.15));
      const r = norm(Math.abs(t[1]) > 0.9 ? G.cross(t, [1, 0, 0]) : G.cross(t, [0, 1, 0])),
        u = G.cross(r, t),
        L = G.len(G.sub(b, a)),
        n = Math.max(1, Math.round(L / 2.5)),
        corner = (p, sr, su) => add(add(p, mul(r, sr * w)), mul(u, su * w));
      for (const [sr, su] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) m.beam('Truss', corner(a, sr, su), corner(b, sr, su), 0.12);
      for (let i = 0; i < n; i++) {
        const p0 = add(a, mul(t, (L * i) / n)),
          p1 = add(a, mul(t, (L * (i + 1)) / n));
        m.beam('TrussB', corner(p0, -1, -1), corner(p1, 1, -1), 0.07);
        m.beam('TrussB', corner(p0, 1, 1), corner(p1, -1, 1), 0.07);
        m.beam('TrussB', corner(p0, -1, 1), corner(p1, -1, -1), 0.07);
        m.beam('TrussB', corner(p0, 1, -1), corner(p1, 1, 1), 0.07);
      }
    };
    const one = (name, label, f, sub = 'Structures') => {
      const m = new Mesh();
      f(m);
      put('Structure' + name, label, T, sub, m);
    };
    one('Base', 'Structure base', (m) => {
      m.box('ConcreteDark', [-2.4, 0, -2.4], [2.4, 0.6, 2.4], 'Concrete');
      truss(m, [0, 0.6, 0], [0, 5, 0], 1.1);
    });
    one('Pillar', 'Structure pillar, 1 layer', (m) => truss(m, [0, 0, 0], [0, 5, 0], 1.1));
    one('PillarTall', 'Structure pillar, 4 layers', (m) => truss(m, [0, 0, 0], [0, 20, 0], 1.1));
    one('Straight', 'Structure beam', (m) => truss(m, [0, 3.9, 10], [0, 3.9, -10]));
    one('Cross', 'Structure crossing', (m) => {
      truss(m, [0, 3.9, 10], [0, 3.9, -10]);
      truss(m, [-10, 3.9, 0], [10, 3.9, 0]);
    });
    one('Corner', 'Structure corner', (m) => {
      truss(m, [0, 3.9, 10], [0, 3.9, 0]);
      truss(m, [0, 3.9, 0], [10, 3.9, 0]);
    });
    one('End', 'Structure dead end', (m) => {
      truss(m, [0, 3.9, 10], [0, 3.9, -1]);
      m.box('Metal', [-1.2, 2.7, -1.6], [1.2, 5.1, -0.6], 'ConcreteDark');
    });
    one('SupportStraight', 'Support under a road', (m) => {
      truss(m, [-7, 0, 0], [-7, 4.6, 0], 0.5);
      truss(m, [7, 0, 0], [7, 4.6, 0], 0.5);
      truss(m, [-7.6, 4.4, 0], [7.6, 4.4, 0], 0.4);
    }, 'Supports');
    one('SupportCorner', 'Support, corner', (m) => {
      truss(m, [-7, 0, -7], [-7, 4.6, -7], 0.5);
      truss(m, [-7.6, 4.4, -7], [7.6, 4.4, -7], 0.4);
      truss(m, [-7, 4.4, -7.6], [-7, 4.4, 7.6], 0.4);
    }, 'Supports');
    one('SupportCross', 'Support, crossing', (m) => {
      truss(m, [0, 0, 0], [0, 4.6, 0], 0.6);
      truss(m, [-9.6, 4.4, 0], [9.6, 4.4, 0], 0.4);
      truss(m, [0, 4.4, -9.6], [0, 4.4, 9.6], 0.4);
    }, 'Supports');
    one('SupportCurve', 'Support, curve', (m) => {
      const path = hPath([{ r: 30, ang: 90 * DEG, dir: 1 }], [0, 10, 0]),
        rs = roadRings(path, { arcStep: 6 });
      for (let i = 0; i + 1 < rs.length; i++) truss(m, add(rs[i].p, [0, 4.4, 0]), add(rs[i + 1].p, [0, 4.4, 0]), 0.4);
      truss(m, [0, 0, 10], [0, 4.6, 10], 0.5);
    }, 'Supports');
  }

  // ---- stage, stands, canopies, screens, lights -----------------------------------------------------------------------------
  {
    const T = 'Stage and screens';
    const one = (name, label, f, sub) => {
      const m = new Mesh();
      f(m);
      put(name, label, T, sub, m);
    };
    one('StageStraight', 'Stage', (m) => {
      m.box('Stage', [-10, 0, -10], [10, 2.4, 10], 'ConcreteDark');
      for (let i = 0; i < 8; i++) m.box('Light', [-9.6 + i * 2.5, 2.4, 9.3], [-8.6 + i * 2.5, 2.6, 9.8], 'Metal');
    }, 'Stage');
    one('StageCorner', 'Stage, curved edge', (m) => {
      const pts = [[-10, -10], [10, -10]];
      for (let i = 0; i <= 10; i++) {
        const a = (i / 10) * 90 * DEG;
        pts.push([10 - 20 * (1 - Math.cos(a)), -10 + 20 * Math.sin(a)]);
      }
      prism(m, pts.map(([x, z]) => [x, z]).filter((p, i, A) => i == 0 || Math.hypot(p[0] - A[i - 1][0], p[1] - A[i - 1][1]) > 1e-6), 0, 2.4, { top: 'Stage', side: 'ConcreteDark', under: 'ConcreteUnder', center: [-4, -4] });
    }, 'Stage');
    one('StageLights', 'Light rig', (m) => {
      m.beam('Truss', [-9, 0, 0], [-9, 8.65, 0], 0.35);
      m.beam('Truss', [9, 0, 0], [9, 8.65, 0], 0.35);
      m.beam('Truss', [-9.4, 9, 0], [9.4, 9, 0], 0.35);
      for (let i = 0; i < 6; i++) {
        const x = -7.5 + i * 3;
        m.box('Metal', [x - 0.5, 7.6, -0.5], [x + 0.5, 8.6, 0.5], 'ConcreteDark');
        m.box('Light', [x - 0.4, 7.55, 0.5], [x + 0.4, 8.45, 0.62], 'Light');
      }
    }, 'Stage');
    one('Stand', 'Grandstand', (m) => {
      for (let i = 0; i < 6; i++) {
        m.box('ConcreteDark', [-10, 0, -10 + i * 2.6], [10, 1 + i * 1.6, -7.4 + i * 2.6], 'Concrete');
        for (let k = 0; k < 10; k++) m.box(k % 2 ? 'Seat' : 'SeatB', [-9.6 + k * 1.95, 1 + i * 1.6, -9.6 + i * 2.6], [-8.0 + k * 1.95, 1.5 + i * 1.6, -8.6 + i * 2.6], 'Seat');
      }
      m.box('Concrete', [-10, 0, 5.6], [10, 12, 6.4], 'ConcreteDark');
    }, 'Stands');
    one('StandCanopy', 'Grandstand with roof', (m) => {
      for (let i = 0; i < 6; i++) m.box('ConcreteDark', [-10, 0, -10 + i * 2.6], [10, 1 + i * 1.6, -7.4 + i * 2.6], 'Concrete');
      // The back wall runs up into the roof slab, so no wall face lies on a roof face.
      m.box('Concrete', [-9.9, 0, 5.6], [9.9, 14.25, 6.3], 'ConcreteDark');
      m.box('Canopy', [-10, 14, -10], [10, 14.5, 6.4], 'Metal');
      m.beam('Metal', [-9.5, 0.5, -9.5], [-9.5, 14, -9.5], 0.25);
      m.beam('Metal', [9.5, 0.5, -9.5], [9.5, 14, -9.5], 0.25);
    }, 'Stands');
    one('Canopy', 'Canopy over the road', (m) => {
      for (const x of [-9.4, 9.4]) for (const z of [-9.4, 9.4]) m.beam('Metal', [x, 0, z], [x, 9, z], 0.25);
      m.box('Canopy', [-10, 9, -10], [10, 9.6, 10], 'Metal');
    }, 'Stands');
    for (const [w, n] of [[5, '1x1'], [10, '2x1'], [20, '4x1']])
      one('Screen' + n, 'Screen, ' + n, (m) => {
        const hw = w / 2 - 0.1;
        m.box('ScreenFrame', [-hw - 0.2, 4, -0.4], [hw + 0.2, 4 + w * 0.56 + 0.4, 0.4], 'ScreenFrame');
        m.box('Screen', [-hw, 4.2, 0.4], [hw, 4.2 + w * 0.56, 0.45], 'Screen');
        m.beam('Metal', [-hw * 0.6, 0, 0], [-hw * 0.6, 4, 0], 0.2);
        m.beam('Metal', [hw * 0.6, 0, 0], [hw * 0.6, 4, 0], 0.2);
      }, 'Screens');
    one('LightPole', 'Floodlight pole', (m) => {
      m.beam('Metal', [0, 0, 0], [0, 24, 0], 0.35);
      m.box('ScreenFrame', [-3, 24, -0.6], [3, 27, 0.6], 'Metal');
      for (let i = 0; i < 4; i++) for (let k = 0; k < 2; k++) m.box('Light', [-2.7 + i * 1.4, 24.3 + k * 1.4, 0.6], [-1.6 + i * 1.4, 25.4 + k * 1.4, 0.7], 'Light');
    }, 'Lights');
  }

  // ---- water: the surface does not hold the car up, it sinks and slows down -------------------------------------------------
  // Water is drawn with its own see-through material (tm_water.js): Water for the surface, WaterSide for the faces you see
  // from the side. Neither is ever collided with (NO_PHYSICS in build.js). Sides stop where a wall stands instead.
  {
    // Water is its own category in the editor (surface Water). Part names keep their Stadium prefix so tracks keep their ids.
    const W = { surface: 'Water' };
    const SURF = 3; // pool water level above the block's floor
    // One water box: surface at `top` over a floor at `bot`. floorAt(z) is a ramp floor under part of it, or null.
    const waterBox = (m, x0, x1, z0, z1, bot, top, open, floorAt) => {
      if (!floorAt) {
        m.quadFacing('Water', [x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1], [0, 1, 0]);
        if (open.includes('N')) m.quadFacing('WaterSide', [x0, bot, z0], [x1, bot, z0], [x1, top, z0], [x0, top, z0], [0, 0, -1]);
        if (open.includes('S')) m.quadFacing('WaterSide', [x0, bot, z1], [x1, bot, z1], [x1, top, z1], [x0, top, z1], [0, 0, 1]);
        if (open.includes('W')) m.quadFacing('WaterSide', [x0, bot, z0], [x0, bot, z1], [x0, top, z1], [x0, top, z0], [-1, 0, 0]);
        if (open.includes('E')) m.quadFacing('WaterSide', [x1, bot, z0], [x1, bot, z1], [x1, top, z1], [x1, top, z0], [1, 0, 0]);
        return;
      }
      // Over a ramp the water ends where the ramp comes out of it (zc), and the side faces follow the ramp.
      const zc = floorAt.zAt(top);
      m.quadFacing('Water', [x0, top, zc], [x1, top, zc], [x1, top, z1], [x0, top, z1], [0, 1, 0]);
      if (open.includes('S')) m.quadFacing('WaterSide', [x0, bot, z1], [x1, bot, z1], [x1, top, z1], [x0, top, z1], [0, 0, 1]);
      for (const [x, dir] of [[x0, -1], [x1, 1]]) {
        if (!open.includes(dir < 0 ? 'W' : 'E')) continue;
        m.triFacing('WaterSide', [x, top, zc], [x, top, z1], [x, bot, z1], [dir, 0, 0]);
      }
    };
    const pool = (walls, ramp) => {
      const m = new Mesh();
      m.box('WaterFloor', [-10, 0, -10], [10, 0.21, 10], 'ConcreteUnder');
      for (const w of walls) {
        // Walls stand on the pool floor rather than sharing its edge faces.
        if (w == 'N') m.box('Concrete', [-10, 0.21, -10], [10, 4, -9], 'ConcreteDark');
        if (w == 'S') m.box('Concrete', [-10, 0.21, 9], [10, 4, 10], 'ConcreteDark');
        // Side walls start after a north wall, so the corner is not built twice.
        const z0 = walls.includes('N') ? -9 : -10;
        if (w == 'W') m.box('Concrete', [-10, 0.21, z0], [-9, 4, 10], 'ConcreteDark');
        if (w == 'E') m.box('Concrete', [9, 0.21, z0], [10, 4, 10], 'ConcreteDark');
      }
      // The water fills the pool inside its walls.
      const x0 = walls.includes('W') ? -9 : -10,
        x1 = walls.includes('E') ? 9 : 10,
        z0 = walls.includes('N') ? -9 : -10,
        z1 = walls.includes('S') ? 9 : 10,
        open = ['N', 'S', 'W', 'E'].filter((w) => !walls.includes(w));
      let floorAt = null;
      if (ramp) {
        m.quadFacing('WaterFloor', [-10, 0.21, 10], [10, 0.21, 10], [10, 5.21, -10], [-10, 5.21, -10], [0, 1, 0.25]);
        m.triFacing('ConcreteDark', [-10, 0.21, 10], [-10, 5.21, -10], [-10, 0.21, -10], [-1, 0, 0]);
        m.triFacing('ConcreteDark', [10, 0.21, 10], [10, 5.21, -10], [10, 0.21, -10], [1, 0, 0]);
        floorAt = { zAt: (y) => 10 - ((y - 0.21) / 5) * 20 };
      }
      waterBox(m, x0, x1, z0, z1, 0.21, SURF, open, floorAt);
      return m;
    };
    const fx = { ...W, fx: { type: 'Water', center: [0, 1.5, 0], size: [20, 3, 20], surface: SURF } };
    put('Water', 'Water', 'Pools', 'Open water', pool([]), fx);
    put('WaterWall', 'Water, wall on one side', 'Pools', 'Walled pools', pool(['N']), fx);
    put('WaterCorner', 'Water, corner walls', 'Pools', 'Walled pools', pool(['N', 'W']), fx);
    put('WaterChannel', 'Water channel', 'Pools', 'Walled pools', pool(['W', 'E']), fx);
    put('WaterRamp', 'Ramp out of the water', 'Pools', 'Ramps', pool([], true), fx);

    // Shallow water: a thin layer over a concrete floor the car drives on, like TM's wet platforms. The wheels stay on
    // the floor; the water only drags a little and throws up spray (Shallow in tm_runtime.js).
    const SH = 0.45; // water depth over the floor
    const shallow = (len, rim) => {
      const m = new Mesh(),
        z0 = 10 - len;
      m.box('Concrete', [-10, 0, z0], [10, DECK, 10], 'ConcreteUnder');
      // A low kerb keeps the water in on the sides that have one.
      for (const [w, a, b] of [['W', [-10, DECK, z0], [-9.6, DECK + SH + 0.1, 10]], ['E', [9.6, DECK, z0], [10, DECK + SH + 0.1, 10]]])
        if (rim.includes(w)) m.box('ConcreteDark', a, b, 'Metal');
      const x0 = rim.includes('W') ? -9.6 : -10,
        x1 = rim.includes('E') ? 9.6 : 10;
      waterBox(m, x0, x1, z0, 10, DECK, DECK + SH, ['N', 'S', 'W', 'E'].filter((w) => !rim.includes(w)), null);
      return m;
    };
    const sfx = (len) => ({ ...W, fx: { type: 'Shallow', center: [0, 1.5, 10 - len / 2], size: [20, 3, len], surface: DECK + SH } });
    put('ShallowWater', 'Shallow water', 'Shallow water', 'Open', shallow(20, []), sfx(20));
    put('ShallowWaterHalf', 'Shallow water, half', 'Shallow water', 'Open', shallow(10, []), sfx(10));
    put('ShallowWaterKerb', 'Shallow water, kerb on one side', 'Shallow water', 'With kerbs', shallow(20, ['W']), sfx(20));
    put('ShallowWaterKerbs', 'Shallow water, kerbs on both sides', 'Shallow water', 'With kerbs', shallow(20, ['W', 'E']), sfx(20));
  }

  // ---- deco walls and deco platforms -------------------------------------------------------------------------------------
  {
    const T = 'Deco';
    const one = (name, label, sub, f) => {
      const m = new Mesh();
      f(m);
      put(name, label, T, sub, m);
    };
    one('DecoWall', 'Deco wall', 'Deco walls', (m) => m.box('DecoWall', [-10, 0, -10], [10, 5, -6], 'DecoWallB'));
    one('DecoWallTall', 'Deco wall, 4 layers', 'Deco walls', (m) => m.box('DecoWall', [-10, 0, -10], [10, 20, -6], 'DecoWallB'));
    one('DecoWallPillar', 'Deco wall on a pillar', 'Deco walls', (m) => {
      m.box('DecoWall', [-10, 15, -10], [10, 20, -6], 'DecoWallB');
      m.box('ConcreteDark', [-2, 0, -10], [2, 15, -6], 'ConcreteDark');
    });
    one('DecoWallDiag', 'Deco wall, diagonal', 'Deco walls', (m) => prism(m, [[-10, -10], [-6, -10], [10, 6], [10, 10]], 0, 5, { top: 'DecoWall', side: 'DecoWallB', under: 'ConcreteUnder', center: [0, 0] }));
    one('DecoWallCurve', 'Deco wall, curve', 'Deco walls', (m) => {
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const a = (i / 10) * 90 * DEG;
        pts.push([-10 + 20 * Math.sin(a), -10 + 20 * (1 - Math.cos(a))].map((v) => v));
      }
      const inner = [];
      for (let i = 10; i >= 0; i--) {
        const a = (i / 10) * 90 * DEG;
        inner.push([-10 + 16 * Math.sin(a), -10 + 4 + 16 * (1 - Math.cos(a)) - 0]);
      }
      // Thick curved wall, built as quads so the concave shape stays correct.
      for (let i = 0; i < 10; i++) {
        const a = pts[i],
          b = pts[i + 1],
          c = inner[10 - i - 1],
          d = inner[10 - i];
        m.quadFacing('DecoWall', [a[0], 5, a[1]], [b[0], 5, b[1]], [c[0], 5, c[1]], [d[0], 5, d[1]], [0, 1, 0]);
        m.quadFacing('DecoWallB', [a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], 5, b[1]], [a[0], 5, a[1]], [a[0] + 10, 0, a[1] - 10].map((v) => -v));
        m.quadFacing('DecoWallB', [d[0], 0, d[1]], [c[0], 0, c[1]], [c[0], 5, c[1]], [d[0], 5, d[1]], [d[0] + 10, 0, d[1] - 10]);
      }
    });
    one('DecoWallSlope', 'Deco wall, sloped top', 'Deco walls', (m) => {
      m.quadFacing('DecoWall', [-10, 0, -6], [10, 0, -6], [10, 5, -10], [-10, 5, -10], [0, 1, 1]);
      m.quadFacing('DecoWallB', [-10, 0, -10], [10, 0, -10], [10, 5, -10], [-10, 5, -10], [0, 0, -1]);
      m.triFacing('DecoWallB', [-10, 0, -10], [-10, 5, -10], [-10, 0, -6], [-1, 0, 0]);
      m.triFacing('DecoWallB', [10, 0, -10], [10, 5, -10], [10, 0, -6], [1, 0, 0]);
    });
    for (const r of [20, 40, 60]) {
      // The side panel of a loop: fills the corner between the loop and the ground, like a wall beside a loop.
      const m = new Mesh(),
        N = 12;
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * 90 * DEG,
          a1 = ((i + 1) / N) * 90 * DEG,
          p = (a) => [10 - r * Math.sin(a), r - r * Math.cos(a)];
        const A = p(a0),
          B = p(a1);
        for (const [x, s] of [[-10.6, -1], [-10, 1]]) {
          void s;
          m.quadFacing('DecoWall', [x, A[1], A[0]], [x, B[1], B[0]], [x, 0, B[0]], [x, 0, A[0]], [x < -10.3 ? -1 : 1, 0, 0]);
        }
        m.quadFacing('DecoWallB', [-10.6, A[1], A[0]], [-10, A[1], A[0]], [-10, B[1], B[0]], [-10.6, B[1], B[0]], [0, Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2)]);
      }
      put('DecoWallLoop' + r, 'Loop side panel, radius ' + r, T, 'Deco walls', m);
    }
    one('DecoPlatform', 'Deco platform', 'Deco platforms', (m) => m.box('DecoPlatform', [-10, 0, -10], [10, 2.5, 10], 'DecoWallB'));
    one('DecoPlatformSlope', 'Deco platform, slope', 'Deco platforms', (m) => {
      m.quadFacing('DecoPlatform', [-10, 0, 10], [10, 0, 10], [10, 5, -10], [-10, 5, -10], [0, 1, 0.25]);
      m.quadFacing('DecoWallB', [-10, 0, -10], [10, 0, -10], [10, 5, -10], [-10, 5, -10], [0, 0, -1]);
      m.triFacing('DecoWallB', [-10, 0, 10], [-10, 5, -10], [-10, 0, -10], [-1, 0, 0]);
      m.triFacing('DecoWallB', [10, 0, 10], [10, 5, -10], [10, 0, -10], [1, 0, 0]);
    });
    one('DecoPlatformDiag', 'Deco platform, diagonal', 'Deco platforms', (m) => prism(m, [[-10, 10], [10, 10], [10, -10]], 0, 2.5, { top: 'DecoPlatform', side: 'DecoWallB', under: 'ConcreteUnder', center: [4, 4] }));
    // signs and items
    for (const [n, l, dir] of [['SignLeft', 'Arrow sign, left', 1], ['SignRight', 'Arrow sign, right', -1]]) {
      const m = new Mesh();
      m.box('Metal', [-0.25, 0, -0.25], [0.25, 3, 0.25]);
      m.box('SignBoard', [-4, 3, -0.3], [4, 6, 0.3], 'ScreenFrame');
      for (let i = 0; i < 3; i++) {
        const x = dir * (-2.4 + i * 2);
        m.triFacing('SignArrow', [x - dir * 0.6, 4.5, 0.36], [x + dir * 0.8, 5.6, 0.36], [x + dir * 0.8, 3.4, 0.36], [0, 0, 1]);
      }
      put(n, l, T, 'Signs', m);
    }
    for (const [n, l, mat] of [['SignCheckpoint', 'Checkpoint sign', 'Checkpoint'], ['SignFinish', 'Finish sign', 'Finish'], ['SignWarning', 'Warning sign', 'SignArrow']]) {
      const m = new Mesh();
      m.box('Metal', [-0.25, 0, -0.25], [0.25, 3, 0.25]);
      m.box(mat, [-3, 3, -0.3], [3, 5.5, 0.3], 'ScreenFrame');
      put(n, l, T, 'Signs', m);
    }
    {
      const m = new Mesh();
      cyl(m, 'Metal', 'ConcreteDark', 0.6, 0, 2, 10);
      put('ObstaclePillar', 'Obstacle pillar', T, 'Obstacles', m);
      const t = new Mesh();
      cyl(t, 'Metal', 'ConcreteDark', 0.4, 0, 2.2, 8);
      t.box('Checkpoint', [-4, 1.4, -0.2], [4, 1.9, 0.2], 'ConcreteDark');
      t.box('Checkpoint', [-0.2, 1.4, -4], [0.2, 1.9, 4], 'ConcreteDark');
      put('ObstacleTurnstile', 'Turnstile', T, 'Obstacles', t);
      const f = new Mesh();
      cyl(f, 'Metal', 'Metal', 0.15, 0, 9, 6);
      f.quadFacing('Flag', [0, 8.6, 0], [3.6, 8.3, 0], [3.6, 6.4, 0], [0, 6.7, 0], [0, 0, 1]);
      f.quadFacing('Flag', [0, 8.6, 0], [3.6, 8.3, 0], [3.6, 6.4, 0], [0, 6.7, 0], [0, 0, -1]);
      put('Flag', 'Flag', T, 'Obstacles', f);
      const h = new Mesh();
      h.box('Checkpoint', [-5.6, 0.6, -0.15], [5.6, 1.1, 0.15], 'ConcreteDark');
      h.box('ConcreteDark', [-6, 0, -0.15], [-5.6, 1.1, 0.15]);
      h.box('ConcreteDark', [5.6, 0, -0.15], [6, 1.1, 0.15]);
      put('Hurdle', 'Hurdle', T, 'Obstacles', h);
      const tube = new Mesh();
      cyl(tube, 'Inflatable', 'InflatableB', 1.4, 0, 5, 14);
      put('InflatableTube', 'Inflatable tube', T, 'Inflatables', tube);
      const arch = new Mesh(),
        N = 24,
        rings = [];
      for (let k = 0; k <= N; k++) {
        const a = (k / N) * Math.PI,
          p = [-Math.cos(a) * 9, Math.sin(a) * 7 + 0.9, 0],
          T = norm([Math.sin(a) * 9, Math.cos(a) * 7, 0]);
        rings.push({ p, T, R: [0, 0, 1], U: norm(G.cross([0, 0, 1], T)), s: k, u: k / N, i: k });
      }
      // An octagonal tube, striped every other segment.
      sweep(arch, rings, () => [{
        pts: [0, 1, 2, 3, 4, 5, 6, 7].map((q) => [Math.cos((q / 8) * TAU) * 0.9, Math.sin((q / 8) * TAU) * 0.9]),
        cap: 'InflatableB',
        mats: (e, ring) => (ring.i % 2 ? 'Inflatable' : 'InflatableB'),
      }]);
      put('InflatableArch', 'Inflatable arch', T, 'Inflatables', arch);
      const bump = new Mesh();
      cyl(bump, 'Inflatable', 'InflatableB', 2.2, 0, 1.6, 14);
      put('InflatableCushion', 'Inflatable cushion', T, 'Inflatables', bump);
    }
    // pillars to hold anything up, stock style square columns
    for (const [n, h] of [['Pillar', 5], ['PillarTall', 20]]) {
      const m = new Mesh();
      m.box('Pillar', [-1.6, 0, -1.6], [1.6, h, 1.6], 'PillarEdge');
      put(n, n == 'Pillar' ? 'Pillar, 1 layer' : 'Pillar, 4 layers', T, 'Pillars', m);
    }
  }
  return parts;
}

module.exports = { buildShared };
void sweep;
void TAU;
void grassStrips;
void grassPatch;
