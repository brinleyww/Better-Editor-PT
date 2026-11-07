// Ice: bobsleigh channels and flat ice platforms. Platform ice is physics surface 3, bobsleigh ice is 4 (tm_runtime.js).
const { Mesh } = require('./geom');
const { DECK, TILT, DEG, smooth, platProfile, roadPart, gateArch, paintBand, arcStepFor, FX, loopSet, stockGate } = require('./catalog');

const ICE = {
  surface: 'Ice',
  plastic: false,
  pattern: null,
  deck: (ring) => (Math.floor((ring.s + 1e-6) / 5) % 2 ? 'IceB' : 'Ice'),
  patchMat: (i, j) => (((i >> 1) + (j >> 1)) % 2 ? 'IceB' : 'Ice'),
  line: () => 'IceLine',
  rail: () => 'IceRim',
  railTop: () => 'IceRim',
  side: 'IceWall',
  posts: false,
  under: 'IceUnder',
  solid: 'Ice',
  solidB: 'IceRim',
  trim: 'IceLine',
};

// The bobsleigh channel: one curve from the middle of the floor to the lip, with no flat floor and no kink. Its
// slope angle grows as (distance from the middle / L)^SHAPE up to vertical at the lip, so the floor is nearly flat in
// the middle and the walls steepen evenly all the way up. The curve is cut wherever it turns BEND, so it is smooth
// and evenly shaded from floor to lip. Inside solid walls that fill the block to its edges; the lip is 4.6 up,
// inside one layer, and the walls' outsides and ends stand straight up.
const BOB = { out: 10, height: 4.4, curl: Math.PI / 2, shape: 2, bend: 2 * (Math.PI / 180), maxLen: 0.6 };
const BOB_CURVE = (() => {
  const { height, curl, shape, bend, maxLen } = BOB,
    n = 4000,
    raw = [[0, 0, 0]];
  let x = 0,
    y = 0;
  for (let i = 0; i < n; i++) {
    const a = curl * Math.pow((i + 0.5) / n, shape);
    x += Math.cos(a) / n;
    y += Math.sin(a) / n;
    raw.push([x, y, (i + 1) / n]);
  }
  const L = height / y,
    pts = [[0, DECK, 0]];
  let last = raw[0];
  for (let i = 1; i < raw.length; i++) {
    const q = raw[i],
      turned = curl * (Math.pow(q[2], shape) - Math.pow(last[2], shape));
    if (i == raw.length - 1 || turned >= bend || (q[2] - last[2]) * L >= maxLen) {
      pts.push([q[0] * L, DECK + q[1] * L, q[2]]);
      last = q;
    }
  }
  return pts; // [x, y, share of the curve's length]
})();
const TOP = BOB_CURVE[BOB_CURVE.length - 1][1];
const LIP = BOB_CURVE[BOB_CURVE.length - 1][0];
// The height of the ice at x across the channel, for decals drawn onto it.
const bobFloor = (x) => {
  const ax = Math.abs(x);
  for (let i = 1; i < BOB_CURVE.length; i++) {
    const [x0, y0] = BOB_CURVE[i - 1],
      [x1, y1] = BOB_CURVE[i];
    if (ax <= x1) return y0 + ((y1 - y0) * (ax - x0)) / (x1 - x0 || 1);
  }
  return TOP;
};
// Each wall quad's edges, mirrored for the left wall: edge k of the mirrored polygon is edge MIRROR[k] of the right one.
const MIRROR = [2, 1, 0, 3];

// flat: 1 = channel, 0 = walls folded flat into a platform. wallL / wallR: extra height of a straight wall on that side.
// paint colours the floor (the middle 9 units). The wall strips leave out their end faces: two pieces end to end would
// put those faces in the same plane and draw a thin line round the channel at every joint.
function bobPolys(st, paint, { flat = 1, wallL = 0, wallR = 0 } = {}) {
  const O = BOB.out,
    C = BOB_CURVE,
    N = C.length - 1,
    polys = [];
  polys.push({
    pts: [[-O, 0], [O, 0], [O, DECK], [-O, DECK]],
    cap: st.under,
    mats: (e) => (e == 0 ? st.under : e == 1 || e == 3 ? st.side : null),
  });
  for (const side of [1, -1]) {
    const extra = side > 0 ? wallR : wallL;
    for (let i = 0; i < N; i++) {
      // Folded flat, strip i lies on the deck at its share of the curve's length across the half width.
      const inner = (k) => [C[k][0] * flat + O * C[k][2] * (1 - flat), C[k][1] * flat + DECK * (1 - flat)],
        outer = (k) => [O * flat + O * C[k][2] * (1 - flat), C[k][1] * flat + DECK * (1 - flat)],
        q = [inner(i), outer(i), outer(i + 1), inner(i + 1)],
        last = i == N - 1,
        floor = C[i + 1][0] < 4.5;
      polys.push({
        pts: side > 0 ? q : q.map(([x, y]) => [-x, y]).reverse(),
        cap: null,
        mats: (e0, ring) => {
          const e = side > 0 ? e0 : MIRROR[e0];
          if (e == 1) return st.side;
          if (e == 2) return last && !extra ? 'IceRim' : null;
          if (e == 3) return (floor && paint?.(ring)) || st.deck(ring);
          return null;
        },
      });
    }
    if (extra) {
      const q = [[LIP, TOP], [O, TOP], [O, TOP + extra], [LIP, TOP + extra]];
      polys.push({
        pts: side > 0 ? q : q.map(([x, y]) => [-x, y]).reverse(),
        cap: st.under,
        mats: (e0) => {
          const e = side > 0 ? e0 : MIRROR[e0];
          return e == 1 ? st.side : e == 2 ? 'IceRim' : e == 3 ? 'IceB' : null;
        },
      });
    }
  }
  return polys;
}
// Decals (effect glyphs) lifted onto the curved floor.
function onFloor(m) {
  for (const list of m.byMat.values()) for (let i = 0; i < list.length; i++) list[i] = [list[i][0], list[i][1] + bobFloor(list[i][0]) - DECK, list[i][2]];
  return m;
}
const bobProfile = (st, paint, opt) => () => bobPolys(st, paint, opt);

function buildIce() {
  const st = ICE,
    parts = [];
  const put = (u) => (name, label, tab, sub, mesh, extra = {}) => parts.push({ name: 'Ice' + name, label, tab, sub, surface: 'Ice', mesh, u, ...extra });
  const bob = put(4),
    plat = put(3);
  const slopes = [{ g: 0.25, n: 'Gentle', L: 40 }, { g: 0.5, n: 'Medium', L: 20 }, { g: 1, n: 'Steep', L: 40 }];

  // ---- bobsleigh --------------------------------------------------------------------------------------------------
  {
    const T = 'Bobsleigh',
      P = bobProfile(st);
    bob('BobStraight', 'Bobsleigh', T, 'Straights', roadPart(st, P, [{ line: 20 }]));
    bob('BobStraightX2', 'Bobsleigh, 2 long', T, 'Straights', roadPart(st, P, [{ line: 40 }]));
    bob('BobHalf', 'Bobsleigh, half', T, 'Straights', roadPart(st, P, [{ line: 10 }]));
    [10, 30, 50, 70, 90].forEach((r, i) => bob('BobCurve' + (i + 1), 'Bobsleigh curve ' + (i + 1), T, 'Curves', roadPart(st, P, [{ r, ang: 90 * DEG, dir: 1 }], { arcStep: arcStepFor(r) })));
    // A right turn's outer wall is on the left. The wall is one more layer of ice to ride up on.
    [30, 50, 70, 90].forEach((r, i) => bob('BobCurveWall' + (i + 2), 'Bobsleigh curve ' + (i + 2) + ', high outer wall', T, 'Curves with wall', roadPart(st, bobProfile(st, null, { wallL: 5 }), [{ r, ang: 90 * DEG, dir: 1 }], { arcStep: arcStepFor(r) })));
    [30, 50, 70, 90].forEach((r, i) => bob('BobCurveWallIn' + (i + 2), 'Bobsleigh curve ' + (i + 2) + ', high inner wall', T, 'Curves with wall', roadPart(st, bobProfile(st, null, { wallR: 5 }), [{ r, ang: 90 * DEG, dir: 1 }], { arcStep: arcStepFor(r) })));
    bob('BobStraightWall', 'Bobsleigh, high wall on the left', T, 'Curves with wall', roadPart(st, bobProfile(st, null, { wallL: 5 }), [{ line: 20 }]));
    bob('BobStraightWalls', 'Bobsleigh, high walls both sides', T, 'Curves with wall', roadPart(st, bobProfile(st, null, { wallL: 5, wallR: 5 }), [{ line: 20 }]));
    // Chicanes: two arcs of radius 25 and 53.13 degrees shift the channel one block sideways over two blocks.
    const S = Math.atan2(4, 3);
    for (const dir of [1, -1])
      bob('BobChicane' + (dir > 0 ? 'R' : 'L'), 'Bobsleigh chicane, ' + (dir > 0 ? 'right' : 'left'), T, 'Chicanes', roadPart(st, P, [{ r: 25, ang: S, dir }, { r: 25, ang: S, dir: -dir }], { arcStep: 2.5 }));
    // Long chicanes: two 45 degree arcs shift one block sideways, with straights so the piece is four blocks long.
    for (const dir of [1, -1]) {
      const r = 20 / (2 * (1 - Math.SQRT1_2)),
        fwd = 2 * r * Math.SQRT1_2;
      bob('BobChicaneLong' + (dir > 0 ? 'R' : 'L'), 'Bobsleigh long chicane, ' + (dir > 0 ? 'right' : 'left'), T, 'Chicanes', roadPart(st, P, [{ line: (80 - fwd) / 2 }, { r, ang: 45 * DEG, dir }, { r, ang: 45 * DEG, dir: -dir }, { line: (80 - fwd) / 2 }], { arcStep: 2.5 }));
    }
    for (const { g, n, L } of slopes) {
      const sub = n + ' slopes';
      bob('Bob' + n + 'Start', 'Bobsleigh, ' + n.toLowerCase() + ' slope start', T, sub, roadPart(st, P, [{ line: L }], { step: 2.5, y: (s) => (g * s * s) / (2 * L) }));
      bob('Bob' + n, 'Bobsleigh, ' + n.toLowerCase() + ' slope', T, sub, roadPart(st, P, [{ line: 20 }], { y: (s) => g * s }));
      bob('Bob' + n + 'End', 'Bobsleigh, ' + n.toLowerCase() + ' slope end', T, sub, roadPart(st, P, [{ line: L }], { step: 2.5, y: (s) => g * s - (g * s * s) / (2 * L) }));
    }
    // Climbing and diving turns, the way bobsleigh tracks wind down a hill.
    for (const [i, r] of [30, 50].entries())
      bob('BobCurveClimb' + (i + 2), 'Bobsleigh curve ' + (i + 2) + ', climbing one layer', T, 'Slope curves', roadPart(st, P, [{ r, ang: 90 * DEG, dir: 1 }], { arcStep: arcStepFor(r), y: (s) => 5 * smooth(s / (r * 90 * DEG)) }));
    const TC = 'Crests and dips';
    bob('BobCrest', 'Bobsleigh crest', T, TC, roadPart(st, P, [{ line: 40 }], { step: 2.5, y: (s) => 5 * (0.5 - 0.5 * Math.cos((s / 40) * 2 * Math.PI)) }));
    bob('BobDip', 'Bobsleigh dip', T, TC, roadPart(st, P, [{ line: 40 }], { step: 2.5, y: (s) => 5 - 5 * (0.5 - 0.5 * Math.cos((s / 40) * 2 * Math.PI)) }));
    bob('BobBump', 'Bobsleigh bump', T, TC, roadPart(st, P, [{ line: 20 }], { step: 2, y: (s) => 0.8 * (0.5 - 0.5 * Math.cos((s / 20) * 2 * Math.PI)) }));
    // The channel walls folding down into an ice platform.
    bob('BobToPlat', 'Bobsleigh to ice platform', T, 'Connectors', roadPart(st, (ring) => bobPolys(st, null, { flat: 1 - smooth(ring.u) }), [{ line: 40 }], { step: 0.5 }));
    bob('BobToPlatShort', 'Bobsleigh to ice platform, short', T, 'Connectors', roadPart(st, (ring) => bobPolys(st, null, { flat: 1 - smooth(ring.u) }), [{ line: 20 }], { step: 0.5 }));

    const TG = 'Bobsleigh gates';
    for (const { kind, label, band } of [{ kind: 'Start', label: 'Start', band: 'StartLine' }, { kind: 'Checkpoint', label: 'Checkpoint', band: 'Checkpoint' }, { kind: 'Finish', label: 'Finish', band: 'Finish' }]) {
      const m = roadPart(st, bobProfile(st, paintBand(st, 9, 11, band)), [{ line: 20 }], { step: 2.5 });
      // Posts stand on the wall tops.
      gateArch(m, 9.2, st, kind, TOP - 0.1);
      const det = kind == 'Start' ? { startOffset: [0, 0.35, 1.35] } : { detector: { type: kind == 'Checkpoint' ? 0 : 1, center: [0, 2.5, 0], size: [18, 5, kind == 'Finish' ? 2 : 1] } };
      bob(kind + 'Bob', label + ', bobsleigh', TG, label, m, det);
    }
    for (const fx of FX) {
      const m = roadPart(st, bobProfile(st, () => fx.mat), [{ line: 20 }], { step: 5 }),
        glyph = new Mesh();
      fx.glyph(glyph, DECK + 0.04);
      m.merge(onFloor(glyph));
      bob('Fx' + fx.key + 'Bob', fx.label + ', bobsleigh', 'Bobsleigh effects', fx.label, m, { fx: { type: fx.key, center: [0, 2.5, 0], size: [17, 5, 12] } });
    }
  }

  // ---- ice platforms ------------------------------------------------------------------------------------------------
  {
    const T = 'Ice platform',
      P = platProfile(st);
    plat('PlatBase', 'Ice platform', T, 'Flat', roadPart(st, P, [{ line: 20 }]));
    plat('PlatBaseX2', 'Ice platform, 2 long', T, 'Flat', roadPart(st, P, [{ line: 40 }]));
    plat('PlatHalf', 'Ice platform, half', T, 'Flat', roadPart(st, P, [{ line: 10 }]));
    {
      const m = roadPart(st, P, [{ line: 20 }]);
      m.box(st.solidB, [-10, DECK, -10], [-9.2, 0.94, 10], st.trim);
      plat('PlatEdgeOne', 'Ice platform with kerb', T, 'Flat', m);
    }
    [10, 30, 50, 70, 90].forEach((r, i) => plat('PlatCurve' + (i + 1), 'Ice platform curve ' + (i + 1), T, 'Curves', roadPart(st, P, [{ r, ang: 90 * DEG, dir: 1 }], { arcStep: arcStepFor(r) })));
    for (const { g, n, L } of slopes) {
      const sub = n + ' slopes';
      plat('Plat' + n + 'Start', 'Ice ' + n.toLowerCase() + ' slope, start', T, sub, roadPart(st, P, [{ line: L }], { step: 2.5, y: (s) => (g * s * s) / (2 * L) }));
      plat('Plat' + n + 'Straight', 'Ice ' + n.toLowerCase() + ' slope', T, sub, roadPart(st, P, [{ line: 20 }], { y: (s) => g * s }));
      plat('Plat' + n + 'End', 'Ice ' + n.toLowerCase() + ' slope, end', T, sub, roadPart(st, P, [{ line: L }], { step: 2.5, y: (s) => g * s - (g * s * s) / (2 * L) }));
    }
    for (const dir of [1, -1])
      for (const [n, L] of [['', 20], ['Long', 40]])
        plat('PlatTwist' + n + (dir > 0 ? 'L' : 'R'), 'Ice twist to bank, ' + (dir > 0 ? 'left high' : 'right high') + (n ? ', long' : ''), T, 'Banked', roadPart(st, P, [{ line: L }], { step: 2.5, y: () => 5, roll: (s) => dir * TILT * smooth(s / L) }));
    plat('PlatTilt', 'Ice banked platform', T, 'Banked', roadPart(st, P, [{ line: 20 }], { y: () => 5, roll: () => TILT }));
    loopSet(plat, st, P, 'Plat', 'Ice walls and loops', 'Ice walls and loops', true);

    const TG = 'Ice gates';
    // Ice platform gates are the stock plane gates on ice.
    for (const [kind, label] of [['Start', 'Start'], ['Checkpoint', 'Checkpoint'], ['Finish', 'Finish']]) {
      const m = stockGate(st, kind, 'Plat');
      const det = kind == 'Start' ? { startOffset: [0, 0.35, 1.35] } : { detector: { type: kind == 'Checkpoint' ? 0 : 1, center: [0, 2.2, 0], size: [18.25, 3.8, kind == 'Finish' ? 2 : 1] } };
      plat(kind + 'Plat', label + ', ice platform', TG, label, m, det);
    }
    for (const fx of FX) {
      const m = roadPart(st, platProfile(st, (ring, isLine) => (isLine ? st.line(ring) : fx.mat)), [{ line: 20 }], { step: 5 });
      fx.glyph(m, DECK + 0.04);
      plat('Fx' + fx.key + 'Plat', fx.label + ', ice platform', 'Ice effects', fx.label, m, { fx: { type: fx.key, center: [0, 2.5, 0], size: [19.5, 5, 12] } });
    }
  }
  return parts;
}

module.exports = { buildIce, ICE };
