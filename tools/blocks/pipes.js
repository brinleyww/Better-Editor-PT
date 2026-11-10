// Pipes: a round tube the car drives inside, up the walls and, fast enough, right round over the top. Its inside is as
// wide as the stock road, its floor at the road's deck height, so a road or a platform curls up into it edge to edge.
// Plastic (surface 0) and a Stadium road pipe with stock road grip (surface 8); both are the same geometry with the
// materials swapped one for one, so build.js stores the shapes once.
const G = require('./geom');
const { Mesh, hPath, sweep, add, mul, norm, cross, sub } = G;
const C = require('./catalog');
const { DECK, HALF_ROAD, RAIL_TOP, DEG, smooth, FX } = C;

const R = HALF_ROAD; // inner radius: the inside is exactly one road wide
const TH = DECK; // wall thickness, the stock slab's
const CY = DECK + R; // the tube's axis over the part's floor
const TOP = DECK + 2 * R + TH; // 13.55: the tube fills three layers
const plain = () => !!process.env.BE_PLAIN;
// Segments per half circle. Drawn: 20 (9 degrees, four 5-unit panels a side). Collided with: 36 (5 degrees, the
// half-pipes' resolution), so the car rides round the walls on facets no coarser than a half-pipe's.
const half = () => (plain() ? 36 : 20);
// Most a piece may bend or climb between two rings: the collision mesh as finely as roads (2.5 degrees), the drawn mesh
// half as finely (it only has to look round).
const bendStep = () => (plain() ? 2.5 : 5) * DEG;
const CAP_IN = 0.04; // end faces sit this far inside the wall, so a joint shows no line (as bobsleigh walls do)

// Frames along a horizontal path with a height y(s), the way geom.roadRings makes them (vertical cross-sections, the
// same frame at every joint), cut every `step`, wherever the path turns or climbs more than bendStep, and at `marks`.
function tubeRings(path, { y = () => 0, step = 5, marks = [] } = {}) {
  const all = [];
  for (const seg of path.segs) {
    const n = Math.max(1, seg.arc ? Math.ceil(Math.abs(seg.at(seg.L)[2] - seg.at(0)[2]) / bendStep() - 1e-9) : Math.round(seg.L / step));
    for (let i = 0; i < n; i++) all.push(seg.s0 + (seg.L * i) / n);
  }
  all.push(path.length);
  for (const m of marks) if (m > 1e-6 && m < path.length - 1e-6) all.push(m);
  all.sort((a, b) => a - b);
  const segAt = (v) => path.segs.find((g) => v <= g.s0 + g.L + 1e-9) ?? path.segs[path.segs.length - 1],
    e = 1e-3,
    grade = (v) => Math.atan((y(v + e) - y(v - e)) / (2 * e)),
    head = (v) => {
      const g = segAt(v);
      return g.at(v - g.s0)[2];
    },
    fine = [];
  for (let k = 0; k < all.length; k++) {
    fine.push(all[k]);
    if (k + 1 == all.length) break;
    const a = all[k],
      b = all[k + 1];
    let t = 0;
    for (let q = 0; q < 4; q++) {
      const u = a + ((b - a) * q) / 4,
        w = a + ((b - a) * (q + 1)) / 4;
      t += Math.abs(head(w) - head(u)) + 2 * Math.abs(grade(w) - grade(u));
    }
    const n = Math.min(Math.ceil(t / bendStep() - 1e-9), Math.floor((b - a) / 0.2));
    for (let i = 1; i < n; i++) fine.push(a + ((b - a) * i) / n);
  }
  const rings = [];
  for (const s of fine) {
    if (rings.length && s - rings[rings.length - 1].s < 1e-4) continue;
    const g = segAt(s),
      [x, z, h] = g.at(s - g.s0),
      dy = (y(s + e) - y(s - e)) / (2 * e);
    rings.push({ p: [x, y(s), z], R: [Math.cos(h), 0, Math.sin(h)], U: [0, 1, 0], T: norm([Math.sin(h), dy, -Math.cos(h)]), s, u: s / path.length });
  }
  rings.forEach((r, i) => (r.i = i));
  return rings;
}

// A cross-section: an arc of curvature k leaving the bottom centre level, l long to each side, as 2M+1 points from the
// left tip round to the right tip (counter-clockwise seen from behind), each with its inward normal. k = 1/R and
// l = pi R is the closed tube; l = pi R / 2 the open pipe; k = 0 a flat deck l wide each side.
function arc(k, l, M) {
  const pts = [];
  for (let j = -M; j <= M; j++) {
    const s = (l * j) / M,
      a = k * s;
    pts.push({ x: k ? Math.sin(a) / k : s, y: DECK + (k ? (2 * Math.sin(a / 2) ** 2) / k : 0), nx: -Math.sin(a), ny: Math.cos(a), j });
  }
  return pts;
}
// A road curling up into the tube, t from 0 (a flat deck w wide each side) to 1 (the closed tube, or the open pipe).
// First the deck bends into an arc of the tube's radius, keeping its width (so it never reaches past the block's
// sides), then the arc grows up the walls and over the top. Every section is one arc tangent to the floor at the middle,
// so the floor never kinks, and both steps start and stop gently.
const BEND = 0.4; // the share of the way spent bending the deck
const curl = (t, w, open = false) => {
  const l1 = open ? (Math.PI * R) / 2 : Math.PI * R;
  return { k: smooth(t / BEND) / R, l: w + (l1 - w) * smooth((t - BEND) / (1 - BEND)) };
};

// Sweeps the tube's wall along rings. sec(ring) -> { k, l }; mats: { inner(j, s), outer(s), lip, cap } where j is the
// inner segment (-M..M-1 from the left tip, 0 starting at the bottom centre going right) and s the distance along.
// inner: the driving face; outer: the skin (outerRings, a coarser cut); lips close an open section's edges.
function tube(m, rings, sec, mats, { outerRings = rings, caps = [true, true] } = {}) {
  const M = half(),
    // The outside never reaches past the block's sides: a platform's edge curling up would poke out by a hair.
    at = (r, q, off = 0) => add(add(r.p, mul(r.R, Math.max(-10, Math.min(10, q.x - q.nx * off)))), mul(r.U, q.y - q.ny * off)),
    dir = (r, q) => add(mul(r.R, q.nx), mul(r.U, q.ny)),
    S = new Map(),
    section = (r, n = M) => {
      const key = r.s + '|' + n;
      if (!S.has(key)) {
        const { k, l } = sec(r);
        S.set(key, arc(k, l, n));
      }
      return S.get(key);
    },
    closed = (P) => Math.hypot(P[0].x - P[P.length - 1].x, P[0].y - P[P.length - 1].y) < 1e-3;
  // The collision mesh's outside is cut half as finely round: only a car driving on top of a pipe touches it.
  for (const [list, off, side, n] of [[rings, 0, 1, M], [outerRings, TH, -1, plain() ? M / 2 : M]])
    for (let k = 0; k + 1 < list.length; k++) {
      const A = list[k],
        B = list[k + 1],
        PA = section(A, n),
        PB = section(B, n),
        s = (A.s + B.s) / 2;
      for (let j = 0; j < 2 * n; j++) {
        const mat = side > 0 ? mats.inner(j - n, s) : mats.outer(s);
        if (!mat) continue;
        const want = mul(add(add(dir(A, PA[j]), dir(A, PA[j + 1])), add(dir(B, PB[j]), dir(B, PB[j + 1]))), side);
        m.quadFacing(mat, at(A, PA[j], off), at(A, PA[j + 1], off), at(B, PB[j + 1], off), at(B, PB[j], off), want);
      }
      // The lips: the wall's thickness along an open section's two edges.
      if (side > 0 && !closed(PA))
        for (const [i, i2] of [[0, 1], [2 * M, 2 * M - 1]]) {
          const out = sub(at(A, PA[i]), at(A, PA[i2]));
          m.quadFacing(mats.lip, at(A, PA[i]), at(A, PA[i], TH), at(B, PB[i], TH), at(B, PB[i]), out);
        }
    }
  // End faces, set CAP_IN inside the wall from every face a car or a camera sees.
  for (const [r, end] of [[rings[0], 0], [rings[rings.length - 1], 1]]) {
    if (!caps[end]) continue;
    const P = section(r),
      open = !closed(P),
      want = mul(r.T, end ? 1 : -1);
    for (let j = 0; j < 2 * M; j++) {
      const q = (i) => {
        const p = { ...P[i] };
        // At an open edge the face also stops CAP_IN short of the lip.
        if (open && (i == 0 || i == 2 * M)) {
          const o = P[i == 0 ? 1 : 2 * M - 1],
            d = Math.hypot(o.x - p.x, o.y - p.y);
          p.x += ((o.x - p.x) * CAP_IN) / d;
          p.y += ((o.y - p.y) * CAP_IN) / d;
        }
        return p;
      };
      const a = q(j),
        b = q(j + 1);
      m.quadFacing(mats.cap, at(r, a, CAP_IN), at(r, b, CAP_IN), at(r, b, TH - CAP_IN), at(r, a, TH - CAP_IN), want);
    }
  }
}

// The two looks. Inside: 5 x 5 panels in two shades, chequered (eight round the tube, the bottom centre a joint like the
// road's); outside: the kit's dark underside with a band in its rail colour at every joint, so the sections read from
// outside. Road pipes: the stock road's greys and kerb red, the outside bare concrete.
const STYLES = {
  Plastic: { deck: 'PlasticDeck', deckB: 'PlasticDeckB', line: 'PlasticLine', outer: 'PlasticUnder', band: 'PlasticRail', rail: (s) => (Math.floor((s + 1e-6) / 2.5) % 2 ? 'PlasticKerb' : 'PlasticRail'), railTop: (s) => (Math.floor((s + 1e-6) / 2.5) % 2 ? 'PlasticKerb' : 'PlasticRail') },
  Stadium: { deck: 'TechDeck', deckB: 'TechDeckB', line: 'TechEdgeWhite', outer: 'Concrete', band: 'TechEdgeRed', rail: () => 'RoadBarrier', railTop: () => 'RoadBarrier' },
};
const BAND = 0.6; // the joint band's width on each piece
// The materials for a piece L long. paint(j, s): a gate or effect colour over the inside, or null.
function looks(P, L, { paint = null, lines = 0 } = {}) {
  const M = half();
  return {
    inner: (j, s) => {
      if (plain()) return P.deck;
      const p = paint?.(j, s);
      if (p) return p;
      // Open pipes: the top segments of each side in the line colour, like the half-pipe's.
      if (lines && (j < -M + lines || j >= M - lines)) return P.line;
      const panel = Math.floor(j / 5);
      return (panel + Math.floor((s + 1e-6) / 5)) % 2 ? P.deckB : P.deck;
    },
    outer: (s) => (plain() ? P.deck : s < BAND || s > L - BAND ? P.band : P.outer),
    lip: plain() ? P.deck : P.line,
    cap: plain() ? P.deck : P.outer,
  };
}
// Cuts where the inside changes colour: every panel joint, and the joint bands outside.
const panelMarks = (L, extra = []) => (plain() ? [] : [...Array.from({ length: Math.floor(L / 5) + 1 }, (_, i) => i * 5), BAND, L - BAND, ...extra]);

// One piece: the tube swept along segs (geom.hPath), y(s) its height; sec(ring) its section (closed tube by default).
function pipePart(P, segs, { y, start, sec = () => ({ k: 1 / R, l: Math.PI * R }), paint, lines = 0, step, marks = [], caps } = {}) {
  const path = hPath(segs, start),
    L = path.length,
    curved = path.segs.some((g) => g.arc),
    inner = tubeRings(path, { y, step: step ?? 5, marks: [...(curved ? [BAND, L - BAND] : panelMarks(L)), ...marks] }),
    outer = plain() ? inner : tubeRings(path, { y, step: step ?? 5, marks: [BAND, L - BAND, ...marks] }),
    m = new Mesh();
  tube(m, inner, sec, looks(P, L, { paint, lines }), { outerRings: outer, caps });
  return m;
}

// The stock road's rails on a curling deck: they ride on the arc and sink into the wall over the first `fade` of the
// piece, the way the connectors' rails fade. sweep's polygons in the ring's frame (geom.sweep).
function curlRails(P, rings, sec, fade) {
  const m = new Mesh(),
    use = rings.filter((r) => r.u <= fade + 1e-9);
  sweep(m, use, (ring) => {
    const { k } = sec(ring),
      f = 1 - smooth(ring.u / fade),
      top = DECK + (RAIL_TOP - DECK) * f,
      sink = 0.2 * (1 - f),
      // A point s along the arc from the bottom centre and h off it, along its inward normal.
      on = (s, h) => {
        const a = k * s,
          x = k ? Math.sin(a) / k : s,
          yy = DECK + (k ? (2 * Math.sin(a / 2) ** 2) / k : 0);
        return [x - Math.sin(a) * h, yy + Math.cos(a) * h];
      };
    const a = HALF_ROAD,
      b = HALF_ROAD - 1;
    return [1, -1].map((side) => {
      const pts = [[a, DECK], [a - 0.12, top - 0.09], [a - 0.5, top], [b + 0.12, top - 0.09], [b, DECK]].map(([x, yy]) => {
        const q = on(side * x, yy - DECK - sink);
        return q;
      });
      return {
        pts: side > 0 ? pts : pts.slice().reverse(),
        cap: sink > 0 ? null : P.rail(0),
        mats: (e, r) => (plain() ? P.deck : e == 4 ? null : e == 1 || e == 2 ? P.railTop(r.s) : P.rail(r.s)),
      };
    });
  });
  return m;
}

// A gate ring inside the tube: the gate's colour right round from 9 to 11 along; the finish chequered.
const gatePaint = (kind) => (j, s) => {
  if (s < 9 || s > 11) return null;
  if (kind == 'Finish') return (Math.floor((j + 100) / 2) + (s < 10 ? 0 : 1)) % 2 ? 'FinishWhite' : 'FinishBlack';
  return kind == 'Start' ? 'StartLine' : 'Checkpoint';
};

// put(name, label, tab, sub, mesh, extra) for every pipe piece of one look.
function pipeSet(put, look) {
  const P = STYLES[look],
    T = 'Pipes',
    full = () => ({ k: 1 / R, l: Math.PI * R }),
    openSec = () => ({ k: 1 / R, l: (Math.PI * R) / 2 });
  put('TubeStraight', 'Pipe', T, 'Pipe', pipePart(P, [{ line: 20 }]));
  put('TubeStraightX2', 'Pipe, 2 long', T, 'Pipe', pipePart(P, [{ line: 40 }]));
  put('TubeStraightX4', 'Pipe, 4 long', T, 'Pipe', pipePart(P, [{ line: 80 }]));
  put('TubeHalf', 'Pipe, half', T, 'Pipe', pipePart(P, [{ line: 10 }]));
  // The end: the tube closed by a wall half way along the block, like the road's dead end.
  {
    // The wall's inside face is TH short of the middle; its outside, at the middle, covers the tube's end.
    const m = pipePart(P, [{ line: 10 }], { caps: [true, false], marks: [10 - TH] }),
      N = half() * 2;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * 2 * Math.PI,
        a1 = ((i + 1) / N) * 2 * Math.PI,
        p = (a, r, z) => [Math.sin(a) * r, CY - Math.cos(a) * r, z];
      m.triFacing(P.deck, [0, CY, TH], p(a0, R, TH), p(a1, R, TH), [0, 0, 1]);
      m.triFacing(plain() ? P.deck : P.band, [0, CY, 0], p(a0, R + TH, 0), p(a1, R + TH, 0), [0, 0, -1]);
    }
    put('TubeEnd', 'Pipe end', T, 'Pipe', m);
  }
  [30, 50, 70].forEach((r, i) => put('TubeCurve' + (i + 2), 'Pipe curve ' + (i + 2) + ' (radius ' + r + ')', T, 'Pipe curves', pipePart(P, [{ r, ang: 90 * DEG, dir: 1 }])));
  {
    // An S: two opposite arcs that shift the pipe half a block sideways over two blocks.
    const L = 40,
      shift = 10,
      r = (L * L + shift * shift) / (4 * shift),
      ang = Math.asin(L / (2 * r));
    for (const dir of [1, -1]) put('TubeChicane' + (dir > 0 ? 'R' : 'L'), 'Pipe chicane ' + (dir > 0 ? 'right' : 'left') + ', 2 long, 10 over', T, 'Pipe curves', pipePart(P, [{ r, ang, dir }, { r, ang, dir: -dir }]));
  }
  for (const { g, n, L } of [{ g: 0.25, n: 'Gentle', L: 40 }, { g: 0.5, n: 'Medium', L: 20 }]) {
    const sub = 'Pipe slopes',
      lo = n.toLowerCase();
    put('Tube' + n + 'Start', 'Pipe, ' + lo + ' climb start', T, sub, pipePart(P, [{ line: L }], { step: 2.5, y: (s) => (g * s * s) / (2 * L) }));
    put('Tube' + n, 'Pipe, ' + lo + ' climb', T, sub, pipePart(P, [{ line: 20 }], { y: (s) => g * s }));
    put('Tube' + n + 'End', 'Pipe, ' + lo + ' climb end', T, sub, pipePart(P, [{ line: L }], { step: 2.5, y: (s) => g * s - (g * s * s) / (2 * L) }));
  }
  // Entries: the road, the open road or a platform curling up into the pipe over two blocks. Turned round, they are the exits.
  const entry = (w, rails, open = false, L = 40) => {
    const sec = (ring) => curl(smooth(ring.u), w, open),
      path = hPath([{ line: L }]),
      step = plain() ? 1 : 2,
      rings = tubeRings(path, { step, marks: panelMarks(L) }),
      m = new Mesh();
    tube(m, rings, sec, looks(P, L, { lines: open ? 2 : 0 }));
    if (rails) m.merge(curlRails(P, tubeRings(path, { step: plain() ? 0.5 : 1 }), sec, 0.35));
    return m;
  };
  put('TubeFromRoad', 'Road to pipe', T, 'Pipe entries', entry(HALF_ROAD, true));
  put('TubeFromOpen', 'Open road to pipe', T, 'Pipe entries', entry(HALF_ROAD, false));
  put('TubeFromPlat', 'Platform to pipe', T, 'Pipe entries', entry(10, false));
  // The open pipe: the bottom half of the tube, open to the sky.
  const TO = 'Open pipe';
  put('TubeOpen', 'Open pipe', T, TO, pipePart(P, [{ line: 20 }], { sec: openSec, lines: 2 }));
  put('TubeOpenX2', 'Open pipe, 2 long', T, TO, pipePart(P, [{ line: 40 }], { sec: openSec, lines: 2 }));
  [30, 50].forEach((r, i) => put('TubeOpenCurve' + (i + 2), 'Open pipe curve ' + (i + 2) + ' (radius ' + r + ')', T, TO, pipePart(P, [{ r, ang: 90 * DEG, dir: 1 }], { sec: openSec, lines: 2 })));
  put('TubeOpenToTube', 'Open pipe closing into the pipe', T, TO, pipePart(P, [{ line: 40 }], { sec: (ring) => ({ k: 1 / R, l: ((Math.PI * R) / 2) * (1 + smooth(ring.u)) }), step: plain() ? 1 : 2, lines: 0 }));
  put('TubeOpenFromRoad', 'Road to open pipe', T, TO, (() => {
    const sec = (ring) => curl(smooth(ring.u), HALF_ROAD, true),
      path = hPath([{ line: 20 }]),
      m = new Mesh();
    tube(m, tubeRings(path, { step: plain() ? 1 : 2, marks: panelMarks(20) }), sec, looks(P, 20, { lines: 2 }));
    m.merge(curlRails(P, tubeRings(path, { step: plain() ? 0.5 : 1 }), sec, 0.5));
    return m;
  })());
  void full;

  // Gates: the gate's colour right round the inside; the trigger fills the whole tube, so a car on the wall or over the
  // top crosses it too. The start puts the car on the floor, as on a road.
  const TG = 'Pipe gates',
    det = (type) => ({ detector: { type, center: [0, CY, 0], size: [2 * R, 2 * R, type == 1 ? 2 : 1] } });
  put('TubeStart', 'Start, pipe', T, TG, pipePart(P, [{ line: 20 }], { paint: gatePaint('Start'), marks: [9, 10, 11] }), { startOffset: [0, 0.35, 1.35] });
  put('TubeCheckpoint', 'Checkpoint, pipe', T, TG, pipePart(P, [{ line: 20 }], { paint: gatePaint('Checkpoint'), marks: [9, 10, 11] }), det(0));
  put('TubeFinish', 'Finish, pipe', T, TG, pipePart(P, [{ line: 20 }], { paint: gatePaint('Finish'), marks: [9, 10, 11] }), det(1));
  // Effects: the floor panels in the effect's colour; the zone fills the tube.
  for (const fx of FX.filter((f) => ['Turbo', 'Super', 'Ultra', 'Reset', 'Cruise', 'NoSteer'].includes(f.key))) {
    const paint = (j) => (j >= -5 && j < 5 ? fx.mat : null);
    put('TubeFx' + fx.key, fx.label + ', pipe', T, 'Pipe effects', pipePart(P, [{ line: 20 }], { paint }), { fx: { type: fx.key, center: [0, CY, 0], size: [2 * R, 2 * R, 12] } });
  }
}

// Every pipe piece: the plastic ones in the Plastic kit, the road pipes (stock road grip, surface 8) with the road kit in
// the stock Road browser. The road pipes keep the names they shipped under (Stadium...), so their ids stay.
function buildPipes() {
  const parts = [];
  for (const [key, surface, extra] of [['Plastic', 'Plastic', {}], ['Stadium', 'RoadKit', { u: 8 }]])
    pipeSet((name, label, tab, sub, mesh, x = {}) => parts.push({ name: key + name, label, tab, sub, surface, mesh, ...extra, ...x }), key);
  return parts;
}

module.exports = { buildPipes, pipeSet, PIPE: { R, TH, CY, TOP }, tubeRings, tube, arc };
