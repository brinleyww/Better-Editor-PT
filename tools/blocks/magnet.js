// Magnet road, after TrackMania Turbo's and TM2 Canyon's magnet surfaces (TM2020 has none): the stock road's shape and
// grip with a violet deck that holds the car to it whatever way up it is, on walls, round loops and upside down on a
// ceiling. In the Road browser, its own Magnet tab. The physics surface is the road's (u 8, exactly stock road grip);
// the magnet is the deck's material: build.js lists a part's magnet faces (MAGNET_MATS) as its magnet list (part.mg),
// and tm_runtime.js pulls a car whose middle is near one of those faces towards it in place of gravity.
const G = require('./geom');
const { hPath, roadRings, loopRings, wallRings, sweep, Mesh } = G;
const C = require('./catalog');
const { HALF_ROAD, smooth, arcStepFor, roadProfile, roadPart, every, styleFor } = C;

const MAGNET_MATS = ['MagnetDeck', 'MagnetDeckB', 'MagnetLine'];

// The road kit's style with the deck, its panel shades and its edge strips in the magnet's colours; rails and the
// underside stay stock road.
function magnetStyle(from = 'MagnetDeck') {
  const st = styleFor('RoadKit'),
    R = { TechDeck: from, RoadDeckB: from == 'MagnetDeck' ? 'MagnetDeckB' : 'RoadDeckB', RoadSeam: from == 'MagnetDeck' ? 'MagnetDeckB' : 'RoadSeam' },
    sw = (m) => R[m] ?? m,
    P = st.pattern;
  return {
    ...st,
    pattern: P && { ...P, mat: (...a) => sw(P.mat(...a)) },
    deck: (ring) => sw(st.deck(ring)),
    patchMat: (...a) => sw(st.patchMat(...a)),
    kerb: from == 'MagnetDeck' ? (ring) => (every(5)(ring) ? 'MagnetLine' : 'TechEdgeWhite') : st.kerb,
  };
}

function swept(rings, profile) {
  const m = new Mesh();
  sweep(m, rings, profile);
  return m;
}

function buildMagnet() {
  const parts = [],
    T = 'Magnet',
    put = (name, label, sub, mesh) => parts.push({ name: 'RoadKitMagnet' + name, label, tab: T, sub, surface: 'RoadKit', mesh, u: 8 }),
    st = magnetStyle(),
    road = magnetStyle('TechDeck'),
    P = roadProfile(st);
  put('Straight', 'Magnet road', 'Straights', roadPart(st, P, [{ line: 20 }]));
  put('StraightX2', 'Magnet road, 2 long', 'Straights', roadPart(st, P, [{ line: 40 }]));
  [10, 30, 50].forEach((r, i) => put('Curve' + (i + 1), 'Magnet curve ' + (i + 1) + ' (radius ' + r + ')', 'Curves', roadPart(st, P, [{ r, ang: Math.PI / 2, dir: 1 }], { arcStep: arcStepFor(r) })));
  // Road to magnet: stock road for its first half, magnet for the rest (turned round, magnet to road).
  {
    const half = (ring) => (ring.s < 10 - 1e-6 ? road : st),
      prof = (ring) => roadProfile(half(ring))();
    prof.rails = true;
    put('FromRoad', 'Road to magnet road', 'Connectors', roadPart(st, prof, [{ line: 20 }], { marks: [10] }));
  }
  // Up the wall: a quarter pipe from the road up to a vertical wall (radius 20), the wall itself, and the loop on over
  // the top and down again; the ceiling is the road upside down at the loop's top.
  const L = (i) => swept(loopRings(20, (i * Math.PI) / 2, ((i + 1) * Math.PI) / 2, { centerY: i == 0 || i == 3 ? 20 : 0, centerZ: i < 2 ? 10 : -10, step: 3.75 }), P);
  put('QuarterUp', 'Magnet quarter pipe up (radius 20)', 'Walls, loops and ceilings', L(0));
  put('WallUp', 'Magnet wall, straight up', 'Walls, loops and ceilings', swept(wallRings(20), P));
  put('LoopTop', 'Magnet loop, over the top (radius 20)', 'Walls, loops and ceilings', L(1));
  put('LoopDive', 'Magnet loop, diving down (radius 20)', 'Walls, loops and ceilings', L(2));
  put('LoopOut', 'Magnet loop, pulling out (radius 20)', 'Walls, loops and ceilings', L(3));
  // The ceiling: rings 5 up, the road's up turned to face down, so its deck faces the floor at the loop top's height.
  {
    const ceil = (len) => {
      const n = len / 5,
        rings = [];
      for (let i = 0; i <= n; i++) rings.push({ p: [0, 5, 10 - (len * i) / n], R: [-1, 0, 0], U: [0, -1, 0], T: [0, 0, -1], s: (len * i) / n, u: i / n, i });
      return swept(rings, P);
    };
    put('Ceiling', 'Magnet ceiling', 'Walls, loops and ceilings', ceil(20));
    put('CeilingX2', 'Magnet ceiling, 2 long', 'Walls, loops and ceilings', ceil(40));
  }
  // Wall ride: the road turned on its side, its deck facing sideways, driven along the wall; and the twist from the
  // flat road onto it (left side up or right side up). The pivot is the slab's bottom centre (roadRings), lifted so
  // its low edge stays on the layer.
  const lift = HALF_ROAD + 0.05;
  for (const dir of [1, -1]) {
    const side = dir > 0 ? 'L' : 'R',
      words = dir > 0 ? 'left side up' : 'right side up';
    put('Wall' + side, 'Magnet wall ride, ' + words, 'Wall ride', roadPart(st, P, [{ line: 20 }], { y: () => lift, roll: () => (dir * Math.PI) / 2 }));
    put('ToWall' + side, 'Magnet road to wall ride, ' + words + ', 4 long', 'Wall ride', roadPart(st, P, [{ line: 80 }], { step: 2.5, y: (s) => lift * Math.sin((Math.PI / 2) * smooth(s / 80)), roll: (s) => ((dir * Math.PI) / 2) * smooth(s / 80) }));
  }
  return parts;
}

module.exports = { buildMagnet, MAGNET_MATS };
