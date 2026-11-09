// TM2020 editor families the kits were missing: platform hills, jumps, obstacles and diagonals for every platform kit,
// the ice kit's bowl corners and curved walls, snow platforms (surface 7), the water road, and small and large stands
// and an arch for Stadium. Same rules as catalog.js: every shape is generated here.
const G = require('./geom');
const { Mesh, hPath, roadRings, sweep, patch, prism, add, mul, norm } = G;
const C = require('./catalog');
const { DECK, HALF_ROAD, RAIL_TOP, TILT, DEG, smooth, arcStepFor, platProfile, roadPart, deckPoly, railPoly, cyl, stockGate, styleFor } = C;
const { ICE } = require('./ice');

// Hills, jumps, obstacles and diagonals on a platform kit's own deck. put(name, label, tab, sub, mesh, extra).
function platformExtras(put, st, T, label = (s) => 'Platform ' + s) {
  const P = platProfile(st),
    H = 'Hills and jumps';
  // Crests and dips the platform's full width, the road's own shapes (catalog.js), so a road crest can run beside one.
  put('PlatCrest1', label('crest, small'), T, H, roadPart(st, P, [{ line: 40 }], { step: 2.5, y: (s) => 5 * (0.5 - 0.5 * Math.cos((s / 40) * 2 * Math.PI)) }));
  put('PlatCrest2', label('crest, big'), T, H, roadPart(st, P, [{ line: 80 }], { step: 2.5, y: (s) => 10 * (0.5 - 0.5 * Math.cos((s / 80) * 2 * Math.PI)) }));
  put('PlatDip1', label('dip, small'), T, H, roadPart(st, P, [{ line: 40 }], { step: 2.5, y: (s) => 5 - 5 * (0.5 - 0.5 * Math.cos((s / 40) * 2 * Math.PI)) }));
  put('PlatDip2', label('dip, big'), T, H, roadPart(st, P, [{ line: 80 }], { step: 2.5, y: (s) => 10 - 10 * (0.5 - 0.5 * Math.cos((s / 80) * 2 * Math.PI)) }));
  put('PlatKicker', label('kicker'), T, H, roadPart(st, P, [{ line: 20 }], { step: 2.5, y: (s) => (s * s) / 40 }));
  put('PlatKickerBig', label('kicker, tall'), T, H, roadPart(st, P, [{ line: 20 }], { step: 2, y: (s) => (s * s) / 26.67 }));
  if (st.patchMat) {
    // A round hump in the middle of the block, level with the deck at every edge, so it sits among flat platforms. A
    // 20 x 20 grid (about 3.5 degrees between cells) with the slab under it; geom.patch would cut it ten times finer.
    const m = new Mesh(),
      n = 20,
      b = (v) => 0.5 + 0.5 * Math.cos(Math.PI * v),
      h = (x, z) => 2.5 * b(x / 10) * b(z / 10),
      at = (i, j, off = 0) => {
        const x = -10 + (20 * i) / n,
          z = -10 + (20 * j) / n,
          e = 1e-3,
          nx = -(h(x + e, z) - h(x - e, z)) / (2 * e),
          nz = -(h(x, z + e) - h(x, z - e)) / (2 * e),
          l = Math.hypot(nx, 1, nz);
        return [x - (nx / l) * off, DECK + h(x, z) - off / l, z - (nz / l) * off];
      };
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        m.quadFacing(st.patchMat(i >> 1, j >> 1), at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1), [0, 1, 0]);
        m.quadFacing(st.under, at(i, j, DECK), at(i + 1, j, DECK), at(i + 1, j + 1, DECK), at(i, j + 1, DECK), [0, -1, 0]);
      }
    // The slab's sides round the block's edges, as a platform has.
    for (const [a, b2, out] of [[[-10, -10], [10, -10], [0, 0, -1]], [[10, -10], [10, 10], [1, 0, 0]], [[10, 10], [-10, 10], [0, 0, 1]], [[-10, 10], [-10, -10], [-1, 0, 0]]])
      m.quadFacing(st.under, [a[0], 0, a[1]], [b2[0], 0, b2[1]], [b2[0], DECK, b2[1]], [a[0], DECK, a[1]], out);
    put('PlatMound', label('mound'), T, H, m);
  }
  // Obstacles: TM's platform obstacles, things standing on the deck to drive round or over.
  const O = 'Obstacles';
  put('PlatBump', label('speed bump'), T, O, roadPart(st, P, [{ line: 20 }], { step: 2, y: (s) => 0.6 * (0.5 - 0.5 * Math.cos((s / 20) * 2 * Math.PI)) }));
  {
    const m = roadPart(st, P, [{ line: 20 }]);
    m.box(st.solidB, [-3, DECK, -3], [3, DECK + 2.5, 3], st.trim);
    put('PlatBlock', label('with a block'), T, O, m);
  }
  {
    const m = roadPart(st, P, [{ line: 20 }]),
      post = new Mesh();
    cyl(post, st.trim, st.solidB, 0.8, DECK, DECK + 3, 12);
    for (const x of [-5, 5]) m.merge(post, [x, 0, 0]);
    put('PlatPosts', label('with posts'), T, O, m);
  }
  // Diagonals: platform edges at 45 degrees, like the diagonal roads.
  const D = 'Diagonals';
  {
    const m = new Mesh();
    prism(m, [[-10, 10], [10, 10], [10, -10]], 0, DECK, { top: st.solid, side: st.under, under: st.under, center: [3.3, 3.3] });
    put('PlatDiagHalf', label('diagonal half'), T, D, m);
    const c = new Mesh();
    prism(c, [[-10, 10], [10, 10], [10, -10], [0, -10], [-10, 0]], 0, DECK, { top: st.solid, side: st.under, under: st.under, center: [2, 2] });
    put('PlatDiagCut', label('with a cut corner'), T, D, c);
  }
}

// The platform kits' bowl corners and curved walls (catalog.js, Walls and loops), for a style that lacks them.
function cornerSet(put, st, T, sub, labelOf = (s) => s) {
  {
    const m = new Mesh(),
      R = 20,
      c = [10, R, 10];
    patch(m, (u, v) => {
      const az = (u * Math.PI) / 2,
        po = (v * Math.PI) / 2,
        Rt = R - DECK,
        r = Rt * Math.sin(po);
      return [c[0] - r * Math.sin(az), c[1] - Rt * Math.cos(po), c[2] - r * Math.cos(az)];
    }, 12, 12, { mat: st.patchMat, under: st.under, want: (p) => [c[0] - p[0], c[1] - p[1], c[2] - p[2]] });
    put('PlatBowlInner', labelOf('Bowl corner, inside'), T, sub, m);
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
    put('PlatBowlOuter', labelOf('Bowl corner, outside'), T, sub, m);
  }
  for (const r of [30, 50])
    for (const dir of [1, -1]) {
      const m = new Mesh(),
        samples = roadRings(hPath([{ r, ang: 90 * DEG, dir }], [0, 10, 0]), { arcStep: arcStepFor(r) });
      for (let i = 0; i + 1 < samples.length; i++) {
        const a = samples[i],
          b = samples[i + 1],
          h = 20,
          out = norm(add(mul(a.R, dir), mul(b.R, dir)));
        m.quadFacing(st.wallMat(i), a.p, b.p, add(b.p, [0, h, 0]), add(a.p, [0, h, 0]), out);
        const o = (q) => add(q, mul(out, -0.21));
        m.quadFacing(st.under, o(a.p), o(b.p), add(o(b.p), [0, h, 0]), add(o(a.p), [0, h, 0]), mul(out, -1));
      }
      put('PlatWallCurve' + r + (dir > 0 ? 'R' : 'L'), labelOf('Curved wall, radius ' + r + ', ' + (dir > 0 ? 'right' : 'left')), T, sub, m);
    }
}

// Snow: packed white snow in two close shades over a blue-grey underside, a pale blue rim. The ice platform's shapes
// with every material swapped one for one, so build.js stores the geometry once.
const SNOW = {
  ...ICE,
  surface: 'Ice',
  deck: (ring) => (Math.floor((ring.s + 1e-6) / 5) % 2 ? 'SnowB' : 'Snow'),
  patchMat: (i, j) => (((i >> 1) + (j >> 1)) % 2 ? 'SnowB' : 'Snow'),
  line: () => 'SnowLine',
  rail: () => 'SnowRim',
  railTop: () => 'SnowRim',
  side: 'SnowSide',
  under: 'SnowUnder',
  solid: 'Snow',
  solidB: 'SnowRim',
  trim: 'SnowLine',
};

function buildExtras() {
  const parts = [];
  const kit = (surface, extra = {}) => (name, label, tab, sub, mesh, x = {}) => parts.push({ name: surface + name, label, tab, sub, surface, mesh, ...extra, ...x });

  // ---- platform kits ----------------------------------------------------------------------------------------------------
  for (const surface of ['Plastic', 'Wood', 'Dirt', 'Grass']) platformExtras(kit(surface), styleFor(surface), 'Platform');

  // ---- ice: the corners the other kits have, and hills and jumps on the ice platform ------------------------------------------
  {
    const put = kit('Ice', { u: 3 }),
      ice = { ...ICE, wallMat: (i) => (i % 2 ? 'IceB' : 'Ice') };
    cornerSet(put, ice, 'Ice walls and loops', 'Ice corners', (s) => 'Ice ' + s[0].toLowerCase() + s.slice(1));
    platformExtras(put, ice, 'Ice platform', (s) => 'Ice platform ' + s);
  }

  // ---- snow platforms (surface 7, tm_runtime.js SURFACES) --------------------------------------------------------------------
  {
    const put = kit('Ice', { u: 7 }),
      st = SNOW,
      T = 'Snow platform',
      P = platProfile(st),
      name = (n) => 'Snow' + n;
    put(name('PlatBase'), 'Snow platform', T, 'Flat', roadPart(st, P, [{ line: 20 }]));
    put(name('PlatBaseX2'), 'Snow platform, 2 long', T, 'Flat', roadPart(st, P, [{ line: 40 }]));
    put(name('PlatHalf'), 'Snow platform, half', T, 'Flat', roadPart(st, P, [{ line: 10 }]));
    {
      const m = roadPart(st, P, [{ line: 20 }]);
      m.box(st.solidB, [-10, DECK, -10], [-9.2, 0.94, 10], st.trim);
      put(name('PlatEdgeOne'), 'Snow platform with kerb', T, 'Flat', m);
    }
    [10, 30, 50, 70, 90].forEach((r, i) => put(name('PlatCurve' + (i + 1)), 'Snow platform curve ' + (i + 1), T, 'Curves', roadPart(st, P, [{ r, ang: 90 * DEG, dir: 1 }], { arcStep: arcStepFor(r) })));
    for (const { g, n, L } of [{ g: 0.25, n: 'Gentle', L: 40 }, { g: 0.5, n: 'Medium', L: 20 }, { g: 1, n: 'Steep', L: 40 }]) {
      const sub = n + ' slopes',
        lo = n.toLowerCase();
      put(name('Plat' + n + 'Start'), 'Snow ' + lo + ' slope, start', T, sub, roadPart(st, P, [{ line: L }], { step: 2.5, y: (s) => (g * s * s) / (2 * L) }));
      put(name('Plat' + n + 'Straight'), 'Snow ' + lo + ' slope', T, sub, roadPart(st, P, [{ line: 20 }], { y: (s) => g * s }));
      put(name('Plat' + n + 'End'), 'Snow ' + lo + ' slope, end', T, sub, roadPart(st, P, [{ line: L }], { step: 2.5, y: (s) => g * s - (g * s * s) / (2 * L) }));
    }
    for (const dir of [1, -1])
      for (const [n, L] of [['', 20], ['Long', 40]])
        put(name('PlatTwist' + n + (dir > 0 ? 'L' : 'R')), 'Snow twist to bank, ' + (dir > 0 ? 'left high' : 'right high') + (n ? ', long' : ''), T, 'Banked', roadPart(st, P, [{ line: L }], { step: 2.5, y: () => 5, roll: (s) => dir * TILT * smooth(s / L) }));
    put(name('PlatTilt'), 'Snow banked platform', T, 'Banked', roadPart(st, P, [{ line: 20 }], { y: () => 5, roll: () => TILT }));
    platformExtras((n, ...rest) => put(name(n), ...rest), st, T, (s) => 'Snow platform ' + s);
    // Gates: the stock plane gates on snow, triggers as the ice platform's (so they share its proxy slots).
    for (const [kind, label] of [['Start', 'Start'], ['Checkpoint', 'Checkpoint'], ['Finish', 'Finish']]) {
      const det = kind == 'Start' ? { startOffset: [0, 0.35, 1.35] } : { detector: { type: kind == 'Checkpoint' ? 0 : 1, center: [0, 2.2, 0], size: [18.25, 3.8, kind == 'Finish' ? 2 : 1] } };
      put(name(kind + 'Plat'), label + ', snow platform', T, 'Gates', stockGate(st, kind, 'Plat'), det);
    }
  }

  // ---- the water road: TM2020's road under shallow water (Water family) -----------------------------------------------------
  // The stock road's shape, greys and kerbs, its rails holding a thin layer of water the car drives through: wet tyres and
  // spray, like shallow water (Shallow in tm_runtime.js). The water is never collided with (build.js NO_PHYSICS).
  {
    const put = kit('Stadium', { surface: 'Water', u: 8 }),
      T = 'Water road',
      SH = 0.45,
      road = { surface: 'Stadium', plastic: true, pattern: null, deck: () => 'TechDeck', line: (ring) => (Math.floor((ring.s + 1e-6) / 5) % 2 == 0 ? 'TechEdgeRed' : 'TechEdgeWhite'), rail: () => 'RoadBarrier', railTop: () => 'RoadBarrier', side: 'ConcreteDark', under: 'ConcreteUnder', solid: 'TechDeck', solidB: 'RoadBarrier', trim: 'TechEdgeWhite' },
      w = HALF_ROAD - 1,
      profile = () => {
        const r = [railPoly(road, -1, RAIL_TOP), railPoly(road, 1, RAIL_TOP)];
        r[0].cap = r[1].cap = 'RoadBarrier';
        // The water: its surface, and the faces seen at an open end (tm_water.js drops them where water goes on).
        const water = { pts: [[-w, DECK], [w, DECK], [w, DECK + SH], [-w, DECK + SH]], cap: 'WaterSide', mats: (e) => (e == 2 ? 'Water' : null) };
        return [deckPoly(road, HALF_ROAD, DECK, 1.3867), ...r, water];
      };
    profile.rails = true;
    const zone = (box) => ({ fx: { type: 'Shallow', center: [(box[0] + box[1]) / 2, 1.5, (box[2] + box[3]) / 2], size: [box[1] - box[0], 3, box[3] - box[2]], surface: DECK + SH } });
    put('WaterRoad', 'Water road', T, 'Water road', roadPart(road, profile, [{ line: 20 }], { step: 5 }), zone([-w, w, -10, 10]));
    put('WaterRoadX2', 'Water road, 2 long', T, 'Water road', roadPart(road, profile, [{ line: 40 }], { step: 5 }), zone([-w, w, -30, 10]));
    put('WaterRoadHalf', 'Water road, half', T, 'Water road', roadPart(road, profile, [{ line: 10 }], { step: 5 }), zone([-w, w, 0, 10]));
    [30, 50].forEach((r, i) => put('WaterRoadCurve' + (i + 2), 'Water road curve ' + (i + 2) + ' (radius ' + r + ')', T, 'Water road', roadPart(road, profile, [{ r, ang: 90 * DEG, dir: 1 }], { arcStep: arcStepFor(r) }), zone([-w, r, 10 - r - w, 10])));
  }

  // ---- Stadium stands and an arch -----------------------------------------------------------------------------------------
  {
    const put = kit('Stadium'),
      T = 'Stage and screens';
    // Grandstands: rows of seats climbing back from the road, n rows of depth d; the large one is two blocks wide.
    const stand = (rows, wide, roof) => {
      const m = new Mesh(),
        d = 20 / Math.max(6, rows),
        x0 = wide ? -10 : -10,
        x1 = wide ? 30 : 10,
        seats = wide ? 20 : 10;
      for (let i = 0; i < rows; i++) {
        m.box('ConcreteDark', [x0, 0, -10 + i * d], [x1, 1 + i * 1.6, -10 + (i + 1) * d], 'Concrete');
        for (let k = 0; k < seats; k++) m.box(k % 2 ? 'Seat' : 'SeatB', [x0 + 0.4 + k * 1.95, 1 + i * 1.6, -9.6 + i * d], [x0 + 2 + k * 1.95, 1.5 + i * 1.6, -9.6 + i * d + 1], 'Seat');
      }
      const top = 1 + rows * 1.6;
      if (roof) {
        m.box('Canopy', [x0, top + 4, -10], [x1, top + 4.5, 10], 'Metal');
        for (const x of [x0 + 0.5, x1 - 0.5]) m.beam('Metal', [x, top - 1.6, 9.5], [x, top + 4, 9.5], 0.25);
      }
      return m;
    };
    put('StandSmall', 'Grandstand, small', T, 'Stands', stand(3, false, false));
    put('StandLarge', 'Grandstand, large', T, 'Stands', stand(9, true, true));
    {
      // A round arch over the road, a square tube bent into half a circle standing on the block's edges.
      const m = new Mesh(),
        N = 16,
        R = 9.2,
        tw = 0.8,
        d = 0.6,
        P = (a, r, z) => [Math.cos(a) * r, Math.sin(a) * r, z];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI,
          b = ((i + 1) / N) * Math.PI,
          mid = (a + b) / 2,
          out = [Math.cos(mid), Math.sin(mid), 0],
          mat = i % 2 ? 'Concrete' : 'WallTop';
        m.quadFacing(mat, P(a, R + tw, -d), P(b, R + tw, -d), P(b, R + tw, d), P(a, R + tw, d), out);
        m.quadFacing(mat, P(a, R, -d), P(b, R, -d), P(b, R, d), P(a, R, d), mul(out, -1));
        m.quadFacing('ConcreteDark', P(a, R, d), P(b, R, d), P(b, R + tw, d), P(a, R + tw, d), [0, 0, 1]);
        m.quadFacing('ConcreteDark', P(a, R, -d), P(b, R, -d), P(b, R + tw, -d), P(a, R + tw, -d), [0, 0, -1]);
      }
      for (const x of [R, -R - tw]) m.quadFacing('ConcreteDark', [x, 0, -d], [x + tw, 0, -d], [x + tw, 0, d], [x, 0, d], [0, -1, 0]);
      put('ArchRoad', 'Arch over the road', T, 'Arches', m);
    }
  }
  return parts;
}

module.exports = { buildExtras, platformExtras, cornerSet, SNOW };
