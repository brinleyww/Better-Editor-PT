// Auto deco: decorates the open track around its route, the way a person does in the editor. Page only, loaded after
// tm_assets.js (and runs in Node for tools/autodeco/bench.js and tools/test/autodeco.mjs).
//
// What it does, in order:
// 1. Reads the route: the last Test run's driving line when there is one, else a path over the road from the start
//    through every checkpoint to the finish (jumps are bridged in a straight line). Finds the turns, straights, jumps,
//    gates and how high the road runs.
// 2. Keeps the driving clear: nothing goes on the road, in the space over it, one layer under it, or within reach of
//    the driving line (more room in the air). The track's own parts are never moved, recoloured or removed.
// 3. The underbody, always: under every road piece the stock block whose top follows its deck exactly
//    (tools/autodeco/twins.js), filled down to the floor and widened a cell, then sloped back down to the floor all
//    round. Road high in the air gets a floating island as its underbody instead. A last pass works on tiles and
//    closes whatever those left open under any part, and bare floor walled in by ground. After a Test run no pass adds
//    anything where the car's body went.
// 4. Named landforms: hills behind the outside of the turns and further out, built from the stock sloped blocks.
// 5. Scenery placed for a reason, from our Scenery blocks (tools/blocks/scenery.js, the editor's Scenery category),
//    each copy turned and coloured its own way: a landmark the route bends round, stands at the start and finish, a
//    pair of flags at each checkpoint, groves round the outside of turns, chevrons before the sharp ones, a feature on
//    the inside, lamps and a fence along straights, more along bare stretches and big shapes further out.
// Every Decorate is a new random layout. Scenery collides like any of our blocks, so a car that leaves the road hits
// the trees and rocks. A decorated track is not bit-for-bit the same to drive: a block touching a deck's underside
// moves the car by millionths of a unit and our blocks share one collision mesh, so an input-only replay recorded on
// the bare track can drift until it misses the finish.
// Everything added is one undo step; "Remove" takes the last decoration away again.
(function () {
  'use strict';
  const root = typeof self != 'undefined' ? self : globalThis;
  root.TM = root.TM || {};

  // ==== engine ======================================================================================================
  function makeEngine(A, D) {
    const S = A.stock; // stock name -> id
    const STOCK_NAME = {};
    for (const n in S) STOCK_NAME[S[n]] = n;
    const BE = new Map(D.parts.map((p) => [p.i, p]));
    const FIRST = 1000;
    const isStock = (id) => id < FIRST;

    // ---- colours ----
    const C = { Default: 0, Summer: 1, Winter: 2, Desert: 3, Black: 32, DarkRed: 33, Brown: 34, Olive: 35, Green: 36, Teal: 37, Navy: 38, Purple: 39, DarkBrown: 40 };
    const BLOCK_CAT = new Set(Object.entries(A.cat).filter(([, c]) => c == 'Block').map(([i]) => +i));
    // Only Block-category parts take the custom colours; the game refuses a track with any other part in one.
    const okColour = (id, c) => c <= 3 || BLOCK_CAT.has(id);

    // ---- tiles ----
    // The game's tile rotation (module 5494.sR): a local tile turned by rot about the vertical, then onto up-axis a.
    function sR(e, t, n, i, a) {
      if (a === 1 || a === 3 || a === 5) {
        if (i === 1) [e, n] = [-n - 1, e];
        else if (i === 2) [e, n] = [-e - 1, -n - 1];
        else if (i === 3) [e, n] = [n, -e - 1];
      } else {
        if (i === 1) [e, n] = [n, -e - 1];
        else if (i === 2) [e, n] = [-e - 1, -n - 1];
        else if (i === 3) [e, n] = [-n - 1, e];
      }
      if (a === 1) [e, t] = [-e - 1, -t - 1];
      else if (a === 2) [e, t] = [t, -e - 1];
      else if (a === 3) [e, t] = [-t - 1, e];
      else if (a === 4) [t, n] = [-n - 1, t];
      else if (a === 5) [t, n] = [n, -t - 1];
      return [e, t, n];
    }
    const boxTiles = (boxes) => {
      const out = [];
      for (const [[x0, y0, z0], [x1, y1, z1]] of boxes) for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) out.push([x, y, z]);
      return out;
    };
    const localCache = new Map();
    function localTiles(id) {
      let t = localCache.get(id);
      if (!t) {
        const boxes = isStock(id) ? D.stockTiles?.[STOCK_NAME[id]] : BE.get(id)?.c;
        t = boxes ? boxTiles(boxes) : [[-2, 0, -2]];
        localCache.set(id, t);
      }
      return t;
    }
    const rotCache = new Map();
    function tiles(id, rot = 0, axis = 0) {
      const k = id * 24 + rot * 6 + axis;
      let t = rotCache.get(k);
      if (!t) {
        t = localTiles(id).map(([x, y, z]) => sR(x, y, z, rot, axis));
        rotCache.set(k, t);
      }
      return t;
    }
    const onSteps = (p) => Number.isInteger(p.x) && Number.isInteger(p.y) && Number.isInteger(p.z);
    // Whole tiles. A part on half steps (the fine grid, our blocks only) takes every whole tile its tiles overlap.
    const worldTiles = (p) => {
      const ts = tiles(p.id, p.rot || 0, p.axis || 0);
      if (onSteps(p)) return ts.map(([x, y, z]) => [x + p.x, y + p.y, z + p.z]);
      const cover = (v) => (Number.isInteger(v) ? [v] : [Math.floor(v), Math.floor(v) + 1]),
        seen = new Map();
      for (const [x, y, z] of ts) for (const a of cover(x + p.x)) for (const b of cover(y + p.y)) for (const c of cover(z + p.z)) seen.set(a + ',' + b + ',' + c, [a, b, c]);
      return [...seen.values()];
    };
    const partsTiles = (ps) => ps.flatMap(worldTiles);
    // One number per tile (x, z within +-4096, layers -1024..7167).
    const K = (x, y, z) => ((x + 4096) * 8192 + (z + 4096)) * 8192 + (y + 1024);
    const K2 = (x, z) => (x + 4096) * 8192 + (z + 4096);

    // A part turned k quarter turns (counter-clockwise seen from above) about the grid vertex (px, pz).
    function turnPart(p, k, px = 0, pz = 0) {
      k = ((k % 4) + 4) % 4;
      if (!k) return { ...p };
      let dx = p.x - px,
        dz = p.z - pz;
      for (let i = 0; i < k; i++) [dx, dz] = [dz, -dx];
      const o = A.turn[(p.rot || 0) * 6 + (p.axis || 0)][k];
      return { ...p, x: px + dx, z: pz + dz, rot: (o / 6) | 0, axis: o % 6 };
    }
    const turnAll = (ps, k, px = 0, pz = 0) => ps.map((p) => turnPart(p, k, px, pz));
    const move = (ps, x, y, z) => ps.map((p) => ({ ...p, x: p.x + x, y: p.y + y, z: p.z + z }));

    // Seeded random numbers (mulberry32): the same seed gives the same decoration.
    function rng(seed) {
      let a = seed >>> 0 || 1;
      const r = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      r.int = (a, b) => a + Math.floor(r() * (b - a + 1));
      r.pick = (list) => list[Math.floor(r() * list.length)];
      r.chance = (p) => r() < p;
      return r;
    }

    // ---- what a part is ----
    const ROAD_CATS = new Set(['Road', 'RoadWide', 'RoadTurns', 'Special', 'Plane', 'WallTrack']);
    const SCENERY_TABS = new Set(['Deco', 'Structures', 'Stage and screens', 'Track walls', 'Blocks', 'Ice blocks', 'Snow blocks']);
    const SCENERY_F = (D.families ?? []).indexOf('Scenery');
    const isRoad = (id) => (isStock(id) ? ROAD_CATS.has(A.cat[id]) : !!BE.get(id) && BE.get(id).f !== SCENERY_F && !SCENERY_TABS.has(BE.get(id).t) && !BE.get(id).n.startsWith('Scenery'));
    const START = new Set([5, 91, 92, 93]),
      CHECK = new Set([52, 65, 75, 77]),
      FINISH = new Set([6, 74, 76, 78]);
    const isStart = (id) => START.has(id) || !!BE.get(id)?.o;
    const isCheck = (id) => CHECK.has(id) || BE.get(id)?.d?.type === 0;
    const isFinish = (id) => FINISH.has(id) || BE.get(id)?.d?.type === 1;
    // Our blocks with collision (they reshape the shared mountain mesh, see the header).
    const noPhysics = new Set(D.noPhysics ?? []);
    const hasCollision = (id) => {
      const p = BE.get(id);
      return !!p && (!!p.ph || p.m.some((m) => !noPhysics.has(m[0])));
    };

    const o = (name, x, y, z, rot = 0, axis = 0, color = 0) => {
      const id = S[name];
      if (id == null) throw new Error('no stock part ' + name);
      return { id, x, y, z, rot, axis, color: okColour(id, color) ? color : 0 };
    };

    // ==== objects =====================================================================================================
    // Scenery is our own Scenery blocks (tools/blocks/scenery.js, Scenery category): one part per rock, tree, house or
    // lamp, modelled whole. A copy differs by its turn and its colour slot (the Scenery palette: 1 summer, 2 snow on the
    // tops, 3 desert and dry, 32-40 the game's custom colours on each block's leaves, rock, roof, cloth, pole or planks).
    const SCENERY = {};
    for (const p of D.parts) if (p.n.startsWith('Scenery')) SCENERY[p.n.slice(7)] = p.i;
    const hasScenery = Object.keys(SCENERY).length > 0;
    // One scenery part at the origin: its turn is applied by the planner.
    const one = (name, color = 1) => {
      const id = SCENERY[name];
      return id == null ? [] : [{ id, x: 0, y: 0, z: 0, rot: 0, axis: 0, color }];
    };
    // An object that picks one of several models and colour slots.
    const pickOf = (names, colors) => (r) => one(r.pick(names), r.pick(colors));

    // ==== themes ======================================================================================================
    // A grove is one kind of tree: its biggest models go in the middle, medium ones round them, small ones at the edge.
    // colour: which of the look's colours it takes.
    const KINDS = {
      broad: { big: ['TreeHuge', 'TreeBig'], mid: ['Tree', 'Tree', 'TreeBent', 'TreeTall'], small: ['TreeSmall', 'Tree'], colour: 'leaf' },
      pine: { big: ['PineTall'], mid: ['Pine'], small: ['PineSmall'], colour: 'pine' },
      palm: { big: ['Palm'], mid: ['Palm'], small: ['Palm'], colour: 'leaf' },
      cactus: { big: ['Cactus'], mid: ['Cactus', 'CactusSmall'], small: ['CactusSmall'], colour: 'cactus' },
    };
    // What each theme grows and builds. ground/rock: colours of the stock ground and an island's rock underside.
    // looks: the colour schemes a decoration picks one of, so everything in it belongs together. leaf: [main, accent] for
    // broadleaf and palm groves and bushes (a grove takes one of the two, never a mix); pine, cactus, grass (the verges),
    // rock, roof, cloth (flags and stands), pole (lamp posts), fence and timber (fallen trunks) one colour each.
    // groves: the kinds of grove and how often each comes. verge: what lines the outside edge of turns. inside: the
    // feature on the inside of a turn (home: a house with trees behind it). fallen: how often a grove has a fallen trunk
    // or a dead tree at its edge.
    const THEMES = {
      meadow: {
        label: 'Meadow',
        ground: C.Green,
        rock: C.Summer,
        looks: [
          { leaf: [1, 1], pine: 1, grass: 1, rock: 1, roof: 33, cloth: 33, pole: 32, fence: 1, timber: 1 },
          { leaf: [1, 36], pine: 1, grass: 1, rock: 1, roof: 38, cloth: 38, pole: 32, fence: 40, timber: 1 },
          { leaf: [1, 1], pine: 1, grass: 1, rock: 1, roof: 40, cloth: 34, pole: 36, fence: 1, timber: 1 },
        ],
        groves: [['broad', 3], ['pine', 1]],
        bushes: ['Bush', 'BushSmall', 'BushBig'],
        homeTrees: ['Tree', 'TreeTall'],
        verge: 'Tuft',
        inside: ['home', 'outcrop', 'grove'],
        landmark: ['Windmill'],
        lamp: 'Lamp',
        fence: 'Fence',
        fallen: 0,
      },
      autumn: {
        label: 'Autumn',
        // Olive renders a bright yellow on the real lighting: the leaves carry the season, the ground stays green.
        ground: C.Green,
        rock: C.Summer,
        // Main and accent leaves from the custom slots (red 33, orange 34, yellow 35), dry grass from the desert slot;
        // pines stay green among them.
        looks: [
          { leaf: [34, 33], pine: 1, grass: 3, rock: 1, roof: 33, cloth: 34, pole: 32, fence: 40, timber: 1 },
          { leaf: [34, 35], pine: 1, grass: 3, rock: 1, roof: 40, cloth: 33, pole: 32, fence: 1, timber: 1 },
          { leaf: [33, 34], pine: 1, grass: 3, rock: 1, roof: 32, cloth: 35, pole: 40, fence: 40, timber: 1 },
          { leaf: [35, 34], pine: 1, grass: 3, rock: 1, roof: 33, cloth: 34, pole: 32, fence: 1, timber: 1 },
        ],
        groves: [['broad', 4], ['pine', 1]],
        bushes: ['Bush', 'BushSmall', 'BushBig'],
        homeTrees: ['Tree', 'TreeTall'],
        verge: 'Tuft',
        inside: ['home', 'outcrop', 'grove'],
        landmark: ['Ruin'],
        lamp: 'Lamp',
        fence: 'StoneWall',
        fallen: 0.35,
      },
      winter: {
        label: 'Winter',
        ground: C.Winter,
        rock: C.Summer,
        looks: [
          { leaf: [2, 2], pine: 2, grass: 2, rock: 2, roof: 33, cloth: 38, pole: 32, fence: 2, timber: 2 },
          { leaf: [2, 2], pine: 2, grass: 2, rock: 2, roof: 38, cloth: 33, pole: 32, fence: 2, timber: 2 },
        ],
        groves: [['pine', 5], ['broad', 1]],
        bushes: null,
        homeTrees: ['Pine', 'PineSmall'],
        verge: null,
        inside: ['home', 'outcrop', 'grove', 'crystals'],
        landmark: ['Lighthouse'],
        lamp: 'Lamp',
        fence: 'Fence',
        fallen: 0.2,
      },
      desert: {
        label: 'Desert',
        ground: C.Desert,
        rock: C.Brown,
        looks: [
          { leaf: [1, 1], cactus: 1, pine: 1, grass: 3, rock: 34, roof: 34, cloth: 37, pole: 40, fence: 3, timber: 3 },
          { leaf: [3, 3], cactus: 3, pine: 3, grass: 3, rock: 3, roof: 33, cloth: 34, pole: 32, fence: 3, timber: 3 },
        ],
        groves: [['cactus', 3], ['palm', 1]],
        bushes: ['BushSmall', 'Bush'],
        homeTrees: ['Palm'],
        verge: null,
        inside: ['outcrop', 'home', 'grove'],
        landmark: ['Mesa', 'RockArch'],
        lamp: 'Lamp',
        fence: 'Fence',
        fallen: 0.3,
      },
    };
    // Every model a theme uses, in its first look's colours (tools/autodeco/bench.js draws each).
    const objectsFor = (name) => {
      const th = THEMES[name],
        lk = th.looks[0],
        out = {};
      for (const [k] of th.groves) for (const m of new Set([...KINDS[k].big, ...KINDS[k].mid, ...KINDS[k].small])) out[m] = () => one(m, KINDS[k].colour == 'leaf' ? lk.leaf[0] : lk[KINDS[k].colour]);
      for (const m of th.bushes ?? []) out[m] = () => one(m, lk.leaf[0]);
      for (const m of ['Boulder', 'Rocks', 'Rock', 'RockSmall']) out[m] = () => one(m, lk.rock);
      for (const m of ['Cabin', 'House']) out[m] = () => one(m, lk.roof);
      for (const m of th.landmark) out[m] = () => one(m, lk.roof);
      out[th.lamp] = () => one(th.lamp, lk.pole);
      out[th.fence] = () => one(th.fence, lk.fence);
      out.Flag = () => one('Flag', lk.cloth);
      out.Stand = () => one('Stand', lk.cloth);
      if (th.verge) out[th.verge] = () => one(th.verge, lk.grass);
      return out;
    };

    // ==== reading the track ===========================================================================================
    const N26 = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) if (dx || dy || dz) N26.push([dx, dy, dz]);

    // parts: [{id, x, y, z, rot, axis, color, cp, so}] (cp: checkpoint order, so: start order).
    function readTrack(parts) {
      const occ = new Set(),
        road = new Map(), // tile -> index of the road part
        roadCols = new Map(), // column -> [lowest, highest] road layer
        roadTiles = [];
      const bounds = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
      let ours = false;
      const starts = [],
        checks = new Map(),
        finishes = [];
      parts.forEach((p, i) => {
        bounds.x0 = Math.min(bounds.x0, p.x);
        bounds.x1 = Math.max(bounds.x1, p.x);
        bounds.z0 = Math.min(bounds.z0, p.z);
        bounds.z1 = Math.max(bounds.z1, p.z);
        if (!isStock(p.id) && hasCollision(p.id)) ours = true;
        const t = worldTiles(p);
        const roadPart = isRoad(p.id);
        for (const [x, y, z] of t) {
          const k = K(x, y, z);
          occ.add(k);
          if (roadPart) {
            if (!road.has(k)) roadTiles.push([x, y, z]);
            road.set(k, i);
            const c = K2(x, z),
              r = roadCols.get(c);
            if (!r) roadCols.set(c, [y, y]);
            else (r[0] = Math.min(r[0], y)), (r[1] = Math.max(r[1], y));
          }
        }
        if (isStart(p.id)) starts.push(i);
        if (isCheck(p.id)) {
          const k = p.cp ?? 0;
          if (!checks.has(k)) checks.set(k, []);
          checks.get(k).push(i);
        }
        if (isFinish(p.id)) finishes.push(i);
      });
      starts.sort((a, b) => (parts[b].so ?? 0) - (parts[a].so ?? 0));
      return { parts, occ, road, roadCols, roadTiles, bounds, ours, starts, checks: [...checks.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]), finishes };
    }

    // ---- the route line ----
    // The path a car takes, as points in tiles (x, y, z) with air marked. From a Test run's recorded points (world
    // units) when given, else over the road tiles from the start through the checkpoints to the finish.
    function lineFromRun(T, pts) {
      const out = [];
      for (const p of pts) {
        const x = p.x / 5,
          y = p.y / 5,
          z = p.z / 5;
        const tx = Math.floor(x),
          ty = Math.floor(y - 0.3),
          tz = Math.floor(z);
        let near = false;
        for (let dx = -1; dx <= 1 && !near; dx++) for (let dz = -1; dz <= 1 && !near; dz++) for (let dy = -2; dy <= 1 && !near; dy++) if (T.road.has(K(tx + dx, ty + dy, tz + dz))) near = true;
        out.push({ x, y, z, air: !near, v: p.v });
      }
      return out;
    }

    function lineFromTrack(T) {
      const { road, roadTiles, parts } = T;
      if (!roadTiles.length) return [];
      const tilesOfParts = (idx) => {
        const s = new Set();
        for (const i of idx) for (const [x, y, z] of worldTiles(parts[i])) if (road.has(K(x, y, z))) s.add(K(x, y, z));
        return s;
      };
      const unK = (k) => {
        const y = (k % 8192) - 1024,
          r = Math.floor(k / 8192),
          z = (r % 8192) - 4096,
          x = Math.floor(r / 8192) - 4096;
        return [x, y, z];
      };
      // Road tiles bucketed by 8 x 8 columns, to find where a jump lands.
      const buckets = new Map();
      for (const t of roadTiles) {
        const b = K2(t[0] >> 3, t[2] >> 3);
        if (!buckets.has(b)) buckets.set(b, []);
        buckets.get(b).push(t);
      }
      let from = T.starts.length ? tilesOfParts([T.starts[0]]) : new Set([K(...roadTiles[0])]);
      const targets = T.checks.map(tilesOfParts);
      if (T.finishes.length) targets.push(tilesOfParts(T.finishes));
      const seen = new Set(from);
      const pts = [];
      const push = (k, air) => {
        const [x, y, z] = unK(k);
        pts.push({ x: x + 0.5, y: y + 0.2, z: z + 0.5, air });
      };
      for (const target of targets.length ? targets : [new Set()]) {
        let sources = from;
        // Breadth-first over the road from the sources until the target is reached; fresh: only road not yet driven.
        const bfs = (sources, fresh) => {
          const parent = new Map(),
            dist = new Map(),
            q = [];
          for (const s of sources) parent.set(s, -1), dist.set(s, 0), q.push(s);
          let hit = -1,
            far = sources.values().next().value;
          for (let h = 0; h < q.length; h++) {
            const k = q[h];
            if (target.has(k) && !sources.has(k)) {
              hit = k;
              break;
            }
            if (dist.get(k) > dist.get(far)) far = k;
            const [x, y, z] = unK(k);
            for (const [dx, dy, dz] of N26) {
              const n = K(x + dx, y + dy, z + dz);
              if (!road.has(n) || parent.has(n) || (fresh && seen.has(n) && !target.has(n))) continue;
              parent.set(n, k);
              dist.set(n, dist.get(k) + 1);
              q.push(n);
            }
          }
          return { parent, hit, far };
        };
        for (let jumps = 0; jumps < 12; jumps++) {
          // Road not driven yet first; a route that crosses or shares road it already drove comes next; only road that
          // really stops is a jump.
          let found = bfs(sources, true);
          if (found.hit < 0) {
            const again = bfs(sources, false);
            if (again.hit >= 0) found = again;
          }
          const { parent, hit, far } = found;
          const end = hit >= 0 ? hit : far;
          const path = [];
          for (let k = end; k != -1; k = parent.get(k)) path.push(k);
          path.reverse();
          for (const k of path) push(k, false), seen.add(k);
          if (hit >= 0 || !targets.length) {
            from = new Set([end]);
            break;
          }
          // Not reachable on the road: the road ends here, so the car jumps. Land on the nearest road ahead.
          const [ex, ey, ez] = unK(end);
          const back = path[Math.max(0, path.length - 7)];
          const [bx, , bz] = unK(back);
          let hx = ex - bx,
            hz = ez - bz;
          const hl = Math.hypot(hx, hz) || 1;
          (hx /= hl), (hz /= hl);
          let best = null,
            bestScore = Infinity;
          for (let bxk = (ex >> 3) - 6; bxk <= (ex >> 3) + 6; bxk++)
            for (let bzk = (ez >> 3) - 6; bzk <= (ez >> 3) + 6; bzk++)
              for (const t of buckets.get(K2(bxk, bzk)) ?? []) {
                const k = K(t[0], t[1], t[2]);
                if (seen.has(k)) continue;
                const dx = t[0] - ex,
                  dz = t[2] - ez,
                  d = Math.hypot(dx, dz, t[1] - ey);
                if (d > 48 || d < 1) continue;
                const ahead = (dx * hx + dz * hz) / (Math.hypot(dx, dz) || 1);
                const score = d * (ahead > 0.6 ? 1 : ahead > 0 ? 2.5 : 6);
                if (score < bestScore) (bestScore = score), (best = k);
              }
          if (best == null) break;
          const [lx, ly, lz] = unK(best);
          const steps = Math.ceil(Math.hypot(lx - ex, ly - ey, lz - ez));
          for (let s = 1; s < steps; s++) {
            const f = s / steps;
            pts.push({ x: ex + (lx - ex) * f + 0.5, y: ey + (ly - ey) * f + 0.2 + Math.sin(f * Math.PI) * steps * 0.12, z: ez + (lz - ez) * f + 0.5, air: true });
          }
          sources = new Set([best]);
          seen.add(best);
        }
      }
      // A guessed jump that passes right over road (within a tile, up to three layers above it) is on the road.
      for (const p of pts) {
        if (!p.air) continue;
        const fx = Math.floor(p.x),
          fy = Math.floor(p.y),
          fz = Math.floor(p.z);
        search: for (let dx = -1; dx <= 1; dx++)
          for (let dz = -1; dz <= 1; dz++)
            for (let dy = -3; dy <= 0; dy++)
              if (road.has(K(fx + dx, fy + dy, fz + dz))) {
                p.air = false;
                break search;
              }
      }
      // Smooth the stair-stepped tile path into a line.
      const sm = pts.map((p, i) => {
        if (p.air) return p;
        let x = 0,
          y = 0,
          z = 0,
          n = 0;
        for (let j = Math.max(0, i - 3); j <= Math.min(pts.length - 1, i + 3); j++) if (!pts[j].air) (x += pts[j].x), (y += pts[j].y), (z += pts[j].z), n++;
        return { x: x / n, y: y / n, z: z / n, air: false };
      });
      return sm;
    }

    // Resampled every tile along the line, with headings, curvature, turns and straights.
    function analyseLine(line) {
      const S = [];
      let s = 0;
      for (let i = 0; i < line.length; i++) {
        const p = line[i];
        if (S.length) {
          const q = S[S.length - 1];
          const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
          if (d < 1) continue;
          // Long gaps (a respawn, a teleport) are filled in so the tube has no holes; air keeps its mark.
          const n = Math.min(80, Math.floor(d));
          for (let k = 1; k < n; k++) {
            const f = k / n;
            S.push({ x: q.x + (p.x - q.x) * f, y: q.y + (p.y - q.y) * f, z: q.z + (p.z - q.z) * f, air: p.air || q.air, s: (s += d / n) });
          }
          s += d / n;
        }
        S.push({ x: p.x, y: p.y, z: p.z, air: p.air, s, v: p.v });
      }
      const n = S.length;
      for (let i = 0; i < n; i++) {
        let a = Math.max(0, i - 2),
          b = Math.min(n - 1, i + 2);
        let hx = S[b].x - S[a].x,
          hz = S[b].z - S[a].z;
        const l = Math.hypot(hx, hz);
        if (l < 0.3 && i) (hx = S[i - 1].hx), (hz = S[i - 1].hz);
        else (hx /= l || 1), (hz /= l || 1);
        S[i].hx = hx;
        S[i].hz = hz;
      }
      // Unwrapped heading and curvature (radians per tile; negative turns left).
      let prev = null;
      for (const p of S) {
        let th = Math.atan2(p.hz, p.hx);
        if (prev != null) while (th - prev > Math.PI) th -= 2 * Math.PI;
        if (prev != null) while (th - prev < -Math.PI) th += 2 * Math.PI;
        p.th = prev = th;
      }
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - 3),
          b = Math.min(n - 1, i + 3);
        S[i].k = b > a ? (S[b].th - S[a].th) / Math.max(1, S[b].s - S[a].s) : 0;
      }
      const turns = [];
      for (let i = 0; i < n; ) {
        if (Math.abs(S[i].k) < 0.03 || S[i].air) {
          i++;
          continue;
        }
        const sign = Math.sign(S[i].k);
        let j = i;
        while (j + 1 < n && (Math.sign(S[j + 1].k) == sign && Math.abs(S[j + 1].k) >= 0.012) && !S[j + 1].air) j++;
        const a = Math.max(0, i - 2),
          b = Math.min(n - 1, j + 2);
        const angle = S[b].th - S[a].th;
        if (Math.abs(angle) >= (30 * Math.PI) / 180) {
          let apex = i;
          for (let m = i; m <= j; m++) if (Math.abs(S[m].k) > Math.abs(S[apex].k)) apex = m;
          turns.push({ i0: a, i1: b, apex, angle, left: angle < 0, radius: (S[b].s - S[a].s) / Math.abs(angle) });
        }
        i = j + 1;
      }
      const straights = [];
      for (let i = 0; i < n; ) {
        if (Math.abs(S[i].k) >= 0.012 || S[i].air) {
          i++;
          continue;
        }
        let j = i;
        while (j + 1 < n && Math.abs(S[j + 1].k) < 0.012 && !S[j + 1].air) j++;
        if (j - i >= 16) straights.push({ i0: i, i1: j });
        i = j + 1;
      }
      return { S, turns, straights };
    }

    // ==== decorating ==================================================================================================
    // opts: {theme, amount: 0.5..1.6, seed, run: [{x,y,z,v}] world units, partial: the run did not finish,
    //        island: 16 (higher road gets an island)}
    function decorate(parts, opts = {}) {
      const theme = THEMES[opts.theme] ?? THEMES.meadow;
      const amount = opts.amount ?? 1;
      const r = rng(opts.seed ?? 1);
      const T = readTrack(parts);
      const out = [];
      if (!T.roadTiles.length) return { add: [], message: 'No road to decorate around.', stats: {} };
      const drove = !!opts.run && opts.run.length > 10;
      // A run that did not finish still keeps the space it went through clear, but the route is the road's.
      const runLine = drove && !opts.partial ? lineFromRun(T, opts.run) : null;
      const L = analyseLine(runLine ?? lineFromTrack(T));
      const { S } = L;

      // ---- keeping the driving clear ----
      // corridor: over and beside the road; under: the layer under it; tube: round the driving line.
      const corridor = new Set(),
        under = new Set(),
        tube = new Set(),
        tubeAir = new Set();
      for (const [x, y, z] of T.roadTiles) {
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy <= 3; dy++) corridor.add(K(x + dx, y + dy, z + dz));
        under.add(K(x, y - 1, z));
      }
      for (const p of S) {
        const rad = p.air ? 3 : 2,
          y0 = Math.floor(p.y) - (p.air ? 3 : 1),
          y1 = Math.floor(p.y) + 3;
        const cx = Math.floor(p.x),
          cz = Math.floor(p.z);
        for (let dx = -rad; dx <= rad; dx++)
          for (let dz = -rad; dz <= rad; dz++) {
            if (dx * dx + dz * dz > rad * rad + 1) continue;
            for (let y = y0; y <= y1; y++) {
              tube.add(K(cx + dx, y, cz + dz));
              // Ground may follow the deck right under a car on the road, never into the space it drives or flies in.
              if (p.air || y > Math.floor(p.y)) tubeAir.add(K(cx + dx, y, cz + dz));
            }
          }
      }
      // driven: the tiles the car's body went through on the Test run. Nothing is ever added in them, under a deck or not.
      // On a deck it reaches just under its middle (the wheels stand on it), off one all round it. A tile of the track is
      // not always deck (a straight's is narrower than its tiles), so on a flat piece it must also be at ride height and
      // going level (a car falling past the edge comes through that height too).
      const driven = new Set();
      if (drove) {
        const BODY = 1.6, // units from the car's middle
          RIDE = 0.45; // the most the middle sits over its layer on a flat deck (0.21 of deck, about 0.1 over that)
        const slanted = new Set();
        for (const p of parts) {
          if (!isRoad(p.id)) continue;
          const ts = worldTiles(p),
            y0 = ts[0][1];
          if (!onSteps(p) || ts.some((t) => t[1] != y0) || A.twins[p.id]?.some((t) => /Slope/.test(STOCK_NAME[t[0]]))) for (const [x, y, z] of ts) slanted.add(K(x, y, z));
        }
        for (let i = 0; i < opts.run.length; i++) {
          const a = opts.run[i],
            b = opts.run[i + 1] ?? a,
            len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z),
            steps = len > 100 ? 1 : Math.max(1, Math.ceil(len / 0.8)); // over 100: a respawn, not a drive
          for (let j = 0; j < steps; j++) {
            const px = a.x + ((b.x - a.x) * j) / steps,
              py = a.y + ((b.y - a.y) * j) / steps,
              pz = a.z + ((b.z - a.z) * j) / steps,
              cx = Math.floor(px / 5),
              cz = Math.floor(pz / 5),
              here = K(cx, Math.floor(py / 5), cz),
              onDeck = (T.occ.has(here) && py - Math.floor(py / 5) * 5 <= RIDE && Math.abs(b.y - a.y) <= 0.02 + 0.02 * len) || slanted.has(here) || slanted.has(K(cx, Math.floor((py - 0.4) / 5), cz)),
              low = py - (onDeck ? 0.15 : BODY);
            for (let x = Math.floor((px - BODY) / 5); x <= Math.floor((px + BODY) / 5); x++)
              for (let z = Math.floor((pz - BODY) / 5); z <= Math.floor((pz + BODY) / 5); z++)
                for (let y = Math.floor(low / 5); y <= Math.floor((py + BODY) / 5); y++) driven.add(K(x, y, z));
          }
        }
      }
      // Scenery may not touch these; ground pieces (under the road by design) only the track's parts and the air.
      const blockedObj = (k) => T.occ.has(k) || driven.has(k) || corridor.has(k) || under.has(k) || tube.has(k);
      const blockedGround = (k) => T.occ.has(k) || driven.has(k) || corridor.has(k) || tubeAir.has(k);
      // Under a road deck the underbody goes everywhere the car did not drive (driven). There it ignores the line's
      // air (a guessed route can call a real turn a jump) and, in the layer just under the deck, a lower road's
      // corridor beside it (fine-grid road side by side). Lower down, the corridor still keeps a road beside clear.
      const unK = (k) => [Math.floor(k / 67108864) - 4096, (k % 8192) - 1024, (Math.floor(k / 8192) % 8192) - 4096];
      const blockedUnder = (k) => {
        if (T.occ.has(k) || driven.has(k)) return true;
        const [x, y, z] = unK(k),
          col = T.roadCols.get(K2(x, z));
        if (col && y < col[0]) return y < col[0] - 1 && corridor.has(k);
        return corridor.has(k) || tubeAir.has(k);
      };
      const anyGround = () => true; // the underbody may overlap ground already laid (only ground exists by then)

      const taken = new Set(); // tiles of everything added
      const gap = new Set(); // a tile round each object, kept free of other objects
      const add = (ps) => {
        for (const p of ps) {
          out.push(p);
          for (const [x, y, z] of worldTiles(p)) taken.add(K(x, y, z));
        }
      };
      // skip(k): tiles of what was added that this may overlap anyway (scenery sinking into our own ground on a slope).
      const fits = (ps, blocked, allow = null, skip = null) => {
        for (const p of ps) {
          for (const [x, y, z] of worldTiles(p)) {
            if (y < 0) return false;
            const k = K(x, y, z);
            if ((taken.has(k) && !(skip && skip(k))) || (blocked(k) && !(allow && allow.has(k)))) return false;
          }
        }
        return true;
      };

      // ---- distance to the road, in tiles, over the columns round the track ----
      let gx0 = Infinity,
        gx1 = -Infinity,
        gz0 = Infinity,
        gz1 = -Infinity;
      for (const [x, , z] of T.roadTiles) (gx0 = Math.min(gx0, x)), (gx1 = Math.max(gx1, x)), (gz0 = Math.min(gz0, z)), (gz1 = Math.max(gz1, z));
      const M = 48;
      (gx0 -= M), (gx1 += M), (gz0 -= M), (gz1 += M);
      const GW = gx1 - gx0 + 1,
        GH = gz1 - gz0 + 1;
      const dist = new Float32Array(GW * GH).fill(1e9);
      const near = new Int16Array(GW * GH); // the lowest road layer of the nearest road column
      for (const [c, [lo]] of T.roadCols) {
        const x = Math.floor(c / 8192) - 4096,
          z = (c % 8192) - 4096;
        dist[(z - gz0) * GW + (x - gx0)] = 0;
        near[(z - gz0) * GW + (x - gx0)] = lo;
      }
      for (let pass = 0; pass < 2; pass++) {
        const fw = pass == 0;
        for (let zi = fw ? 0 : GH - 1; fw ? zi < GH : zi >= 0; zi += fw ? 1 : -1)
          for (let xi = fw ? 0 : GW - 1; fw ? xi < GW : xi >= 0; xi += fw ? 1 : -1) {
            const i = zi * GW + xi;
            let d = dist[i];
            const s = fw ? -1 : 1;
            const nb = [
              [xi + s, zi, 1],
              [xi, zi + s, 1],
              [xi + s, zi + s, 1.414],
              [xi - s, zi + s, 1.414],
            ];
            for (const [a, b, w] of nb)
              if (a >= 0 && a < GW && b >= 0 && b < GH && dist[b * GW + a] + w < d) {
                d = dist[b * GW + a] + w;
                near[i] = near[b * GW + a];
              }
            dist[i] = d;
          }
      }
      const gi = (x, z) => {
        const xi = Math.floor(x) - gx0,
          zi = Math.floor(z) - gz0;
        return xi < 0 || zi < 0 || xi >= GW || zi >= GH ? -1 : zi * GW + xi;
      };
      const roadDist = (x, z) => (gi(x, z) < 0 ? 99 : dist[gi(x, z)]);
      const roadLayerNear = (x, z) => (gi(x, z) < 0 ? 999 : near[gi(x, z)]);
      const groundFrom = out.length;
      const slopeTop = new Map(); // column -> the low edge of the slope piece there (natural things may stand on it)
      // ==== ground ====================================================================================================
      // The underbody, always: every road piece gets the stock block whose top follows its deck right under it, filled
      // down to the floor and widened a cell beside the road, and the ground then slopes back down to the floor all
      // round, two layers a cell, like an embankment. Road high in the air (over ISLAND layers) gets a floating island
      // as its underbody instead of a mountain to the floor. Pieces with no matching block (banked turns) get a level
      // plinth under their low edge; loops and wall rides are left as they are.
      const ISLAND = opts.island ?? 16;
      const groundTop = new Map(); // column -> layer objects can stand on (flat ground only)
      // Terrain lives on 4-tile lattices, one per grid phase the road uses (pieces placed on the fine grid get their own),
      // each with vertex heights in layers; a cell's four corner heights choose its piece.
      const lats = new Map();
      const mod4 = (v) => ((v % 4) + 4) % 4;
      const latOf = (cx, cz) => {
        const k = mod4(cx) * 4 + mod4(cz);
        if (!lats.has(k)) lats.set(k, { px: mod4(cx), pz: mod4(cz), V: new Map(), VF: new Map(), fixedV: new Set(), fixedCells: new Set() });
        return lats.get(k);
      };
      const phase = new Map();
      for (const p of parts) {
        if (!isRoad(p.id)) continue;
        const k = mod4(Math.floor(p.x)) * 4 + mod4(Math.floor(p.z));
        phase.set(k, (phase.get(k) ?? 0) + 1);
      }
      const mainPhase = [...phase.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
      const PX = Math.floor(mainPhase / 4),
        PZ = mainPhase % 4;
      const vkey = (x, z) => K2(x, z);
      // Corner heights of the ground pieces, at rot 0, relative to the piece's layer: [dx, dz, NW, NE, SE, SW] per cell.
      const PROFILE = {
        Block: [[0, 0, 1, 1, 1, 1]],
        BlockSlopeUp: [[0, 0, 1, 1, 0, 0]],
        BlockSlopeDown: [[0, 0, 0, 0, 1, 1]],
        BlockSlopedUp: [[0, 0, 2, 2, 0, 0]],
        BlockSlopeUpLong: [[0, 0, 0, 0, 0, 0], [0, -4, 2, 2, 0, 0]],
        BlockSlopeDownLong: [[0, 0, 2, 2, 2, 2], [0, -4, 0, 0, 2, 2]],
        BlockSlopeVerticalBottom: [[0, 0, 4, 4, 0, 0]],
        BlockSlopeToVertical: [[0, 0, 4, 4, 0, 0]],
      };
      const CORNERS = [[-2, -2], [2, -2], [2, 2], [-2, 2]];
      // A ground piece fixes the heights at its cell's corners (in its own lattice) for the slopes round it.
      function noteGround(p, floor) {
        const prof = PROFILE[STOCK_NAME[p.id]];
        if (!prof || (p.axis || 0) != 0) return;
        for (const [dx, dz, ...h] of prof) {
          let ox = dx,
            oz = dz;
          for (let i = 0; i < (p.rot || 0); i++) [ox, oz] = [oz, -ox];
          const cx = p.x + ox,
            cz = p.z + oz;
          const Lt = latOf(cx, cz);
          Lt.fixedCells.add(K2(cx, cz));
          CORNERS.forEach(([ax, az], c) => {
            let wx = ax,
              wz = az;
            for (let i = 0; i < (p.rot || 0); i++) [wx, wz] = [wz, -wx];
            const k = vkey(cx + wx, cz + wz);
            Lt.V.set(k, Math.max(Lt.V.get(k) ?? -1, p.y + h[c]));
            Lt.VF.set(k, Math.min(Lt.VF.get(k) ?? Infinity, floor));
            Lt.fixedV.add(k);
          });
          if (STOCK_NAME[p.id] == 'Block') for (let x = cx - 2; x < cx + 2; x++) for (let z = cz - 2; z < cz + 2; z++) if (!T.roadCols.has(K2(x, z))) groundTop.set(K2(x, z), Math.max(groundTop.get(K2(x, z)) ?? 0, p.y + 1));
        }
      }
      // Solid ground under a piece down to the floor; a floating island also gets a ragged rock underside.
      const fillUnder = (p, colour, floor) => {
        const lowest = Math.min(...worldTiles(p).map((t) => t[1]));
        const cells = new Set();
        for (const [x, , z] of worldTiles(p)) cells.add(K2(p.x + 4 * Math.floor((x - p.x + 2) / 4), p.z + 4 * Math.floor((z - p.z + 2) / 4)));
        for (const c of cells) {
          const cx = Math.floor(c / 8192) - 4096,
            cz = (c % 8192) - 4096;
          let y = lowest - 1;
          for (; y >= floor; y--) {
            const b = o('Block', cx, y, cz, 0, 0, colour);
            if (!fits([b], blockedUnder)) break;
            add([b]);
          }
          if (floor > 0 && y < floor)
            for (let d = 1; d <= 3 && r() < 0.62 - d * 0.14; d++) {
              const b = o(d == 3 ? 'BlockSlopedUpOuterCorner' : 'Block', cx, floor - d - (d == 3 ? 1 : 0), cz, r.int(0, 3), d == 3 ? 1 : 0, theme.rock);
              if (!fits([b], blockedGround)) break;
              add([b]);
            }
        }
      };

      const blockColour = new Map(); // tiles of the track's own stock blocks -> their colour
      for (const p of parts) if (BLOCK_CAT.has(p.id)) for (const [x, y, z] of worldTiles(p)) blockColour.set(K(x, y, z), p.color || 0);
      const islandRoad = []; // cells of road high in the air, with the layer its ground's top is at
      for (const p of parts) {
        // Stock ground only goes on whole steps: the passes below put it under road on half steps.
        if (!isRoad(p.id) || (p.axis || 0) != 0 || !onSteps(p)) continue;
        const ts = worldTiles(p);
        const lowest = Math.min(...ts.map((t) => t[1])),
          highest = Math.max(...ts.map((t) => t[1]));
        const island = lowest > ISLAND;
        const floor = island ? lowest - 3 : 0;
        const tw = A.twins[p.id];
        if (!tw) {
          // No block follows this deck: a level plinth under its low edge, for pieces no more than two layers high.
          if (lowest < 1 || highest - lowest > 1 || island) continue;
          const cells = new Set();
          for (const [x, y, z] of ts) if (y == lowest) cells.add(K2(p.x + 4 * Math.floor((x - p.x + 2) / 4), p.z + 4 * Math.floor((z - p.z + 2) / 4)));
          for (const c of cells) {
            const b = o('Block', Math.floor(c / 8192) - 4096, lowest - 1, (c % 8192) - 4096, 0, 0, theme.ground);
            if (!fits([b], blockedUnder, null, anyGround)) continue;
            add([b]);
            noteGround(b, floor);
            fillUnder(b, theme.ground, floor);
          }
          continue;
        }
        // The twin may share the road's own tiles. Where one of the track's blocks is in them too it takes that block's
        // colour, so it never shows through as a recolour (an identical one is dropped at the end).
        const own = new Set(ts.map(([x, y, z]) => K(x, y, z)));
        for (const [b, ox, dy, oz, rr] of tw) {
          const piece = turnPart({ id: b, x: p.x + ox, y: p.y + dy, z: p.z + oz, rot: rr, axis: 0, color: theme.ground }, p.rot || 0, p.x, p.z);
          if (!fits([piece], blockedUnder, own, anyGround)) {
            continue;
          }
          for (const [x, y, z] of worldTiles(piece)) {
            const c = blockColour.get(K(x, y, z));
            if (c === undefined) continue;
            piece.color = c;
            break;
          }
          add([piece]);
          fillUnder(piece, theme.ground, floor);
          if (island) {
            const snap = (v, ph) => Math.round((v - ph) / 4) * 4 + ph;
            islandRoad.push({ cx: snap(piece.x, PX), cz: snap(piece.z, PZ), top: b == S.Block ? piece.y + 1 : piece.y });
            continue; // the island round it is built as one piece below
          }
          noteGround(piece, floor);
          // Widen: the same profile a cell beside the road (across a slope; all round on the flat).
          const sloped = b != S.Block;
          const dirs = sloped ? ((piece.rot || 0) % 2 == 0 ? [[4, 0], [-4, 0]] : [[0, 4], [0, -4]]) : [[4, 0], [-4, 0], [0, 4], [0, -4]];
          for (const [dx, dz] of dirs) {
            const q = { ...piece, x: piece.x + dx, z: piece.z + dz };
            if (latOf(q.x, q.z).fixedCells.has(K2(q.x, q.z)) || !fits([q], blockedGround)) continue;
            add([q]);
            noteGround(q, floor);
            fillUnder(q, theme.ground, floor);
          }
        }
      }
      // Anything still open under a road deck (a twin that did not fit, pieces side by side on the fine grid, a turn's
      // corner cells): a block under each open column, its top at the deck's lowest layer there, tried on the piece's own
      // grid first and then shifted until it fits, filled to the floor and sloped round like the rest.
      for (const p of parts) {
        if (!isRoad(p.id) || (p.axis || 0) != 0) continue;
        const low = new Map();
        for (const [x, y, z] of worldTiles(p)) low.set(K2(x, z), Math.min(low.get(K2(x, z)) ?? 1e9, y));
        for (const [c, y] of low) {
          if (y < 1 || y > ISLAND) continue;
          const x = Math.floor(c / 8192) - 4096,
            z = (c % 8192) - 4096;
          if (taken.has(K(x, y - 1, z)) || T.occ.has(K(x, y - 1, z))) continue;
          if (T.roadCols.get(c)[0] < y) continue; // another road lower in this column: the space between stays open
          const px = Math.floor(p.x),
            pz = Math.floor(p.z),
            gx = px + 4 * Math.floor((x - px + 2) / 4),
            gz = pz + 4 * Math.floor((z - pz + 2) / 4);
          const tries = [[gx, gz]];
          for (let ox = x - 1; ox <= x + 2; ox++) for (let oz = z - 1; oz <= z + 2; oz++) if (ox != gx || oz != gz) tries.push([ox, oz]);
          for (const [ox, oz] of tries) {
            const b = o('Block', ox, y - 1, oz, 0, 0, theme.ground);
            if (!fits([b], blockedUnder, null, anyGround)) {
              continue;
            }
            add([b]);
            noteGround(b, 0);
            fillUnder(b, theme.ground, 0);
            break;
          }
        }
      }
      // Road high in the air: one floating island round it, every coarse cell within two cells of the road, its top
      // level with the road's underside (taken from the nearest road cell), three layers thick, the convex corners
      // rounded with quarter-round blocks, and a ragged rock underside.
      if (islandRoad.length) {
        const nearC = new Map(); // cell -> {d, top}
        const W = 2;
        for (const c of islandRoad)
          for (let i = -W; i <= W; i++)
            for (let j = -W; j <= W; j++) {
              const k = K2(c.cx + 4 * i, c.cz + 4 * j);
              const d = Math.max(Math.abs(i), Math.abs(j));
              const e = nearC.get(k);
              if (!e || d < e.d || (d == e.d && c.top < e.top)) nearC.set(k, { d, top: c.top, cx: c.cx + 4 * i, cz: c.cz + 4 * j });
            }
        const isIn = (cx, cz) => nearC.has(K2(cx, cz));
        for (const { cx, cz, top } of nearC.values()) {
          if (top < 4 || taken.has(K(cx, top - 1, cz))) continue;
          const outN = !isIn(cx, cz - 4),
            outS = !isIn(cx, cz + 4),
            outW = !isIn(cx - 4, cz),
            outE = !isIn(cx + 4, cz);
          const corner = outN && outW ? 0 : outS && outW ? 1 : outS && outE ? 2 : outN && outE ? 3 : -1;
          const head = corner >= 0 ? o('BlockOuterCorner', cx, top - 1, cz, corner, 0, theme.ground) : o('Block', cx, top - 1, cz, 0, 0, theme.ground);
          if (!fits([head], blockedGround)) continue;
          add([head]);
          fillUnder(head, theme.ground, top - 3);
          if (corner < 0) for (let x = cx - 2; x < cx + 2; x++) for (let z = cz - 2; z < cz + 2; z++) if (!T.roadCols.has(K2(x, z))) groundTop.set(K2(x, z), top);
          latOf(cx, cz).fixedCells.add(K2(cx, cz));
        }
      }

      // ---- landforms: hills behind the outside of the bigger turns, a few far out ----
      const hills = [];
      const turnsBySize = [...L.turns].sort((a, b) => Math.abs(b.angle) - Math.abs(a.angle));
      const side = (p, left) => (left ? [p.hz, -p.hx] : [-p.hz, p.hx]); // the normal on that side
      const hillCount = Math.round(amount * Math.min(4, 1 + turnsBySize.length / 3));
      for (const t of turnsBySize.slice(0, hillCount)) {
        if (Math.abs(t.angle) < Math.PI / 3) continue;
        const p = S[t.apex];
        const [nx, nz] = side(p, !t.left); // outside of the turn
        const d = 14 + r.int(0, 6);
        hills.push({ x: p.x + nx * d, z: p.z + nz * d, top: r.int(0, 1), h: 2 * r.int(1, 2), why: `hill behind the outside of the ${t.left ? 'left' : 'right'} turn` });
      }
      if (amount >= 1 && S.length) {
        for (let k = 0; k < Math.round(2 * amount); k++) {
          const p = S[Math.floor(((k + 0.5) / Math.round(2 * amount)) * S.length)];
          const [nx, nz] = side(p, k % 2 == 0);
          hills.push({ x: p.x + nx * 26, z: p.z + nz * 26, top: r.int(1, 2), h: 2 * r.int(2, 4), why: 'a far hill to close the view' });
        }
      }
      if (hills.length && opts.hills !== false) {
        const main = latOf(PX, PZ);
        const cellOf = (x, p) => Math.round((x - p) / 4) * 4 + p; // the nearest cell origin
        for (const h of hills) {
          // Only over the floor near road low enough to see it.
          if (roadLayerNear(h.x, h.z) > ISLAND) continue;
          const cx = cellOf(h.x, PX),
            cz = cellOf(h.z, PZ);
          const R = h.top + h.h / 2 + 1;
          for (let i = -R; i <= R + 1; i++)
            for (let j = -R; j <= R + 1; j++) {
              // Vertex (i, j): i = 0, 1 are the middle cell's corners. A flat top of h.top cells round the middle,
              // then two layers down per cell, the corners rounded off.
              const dI = i < 0 ? -i : i > 1 ? i - 1 : 0,
                dJ = j < 0 ? -j : j > 1 ? j - 1 : 0;
              const d = Math.max(dI, dJ) + (dI > 0 && dJ > 0 && dI + dJ > h.top + 1 ? 1 : 0);
              const v = h.h - 2 * Math.max(0, d - h.top);
              if (v <= 0) continue;
              const k = vkey(cx - 2 + 4 * i, cz - 2 + 4 * j);
              if (!main.fixedV.has(k)) main.V.set(k, Math.max(main.V.get(k) ?? 0, v));
            }
        }
      }

      // ---- the slopes: on each lattice, fall off from the road's ground two layers a cell, keep every cell under
      // anything it may not touch, then a piece per cell from its corner heights ----
      const D8 = [[4, 0], [-4, 0], [0, 4], [0, -4], [4, 4], [4, -4], [-4, 4], [-4, -4]];
      const pieces = [];
      for (const Lt of lats.values()) {
        const { V, VF, fixedV, fixedCells } = Lt;
        const q = [...fixedV];
        for (let h = 0; h < q.length; h++) {
          const k = q[h];
          const x = Math.floor(k / 8192) - 4096,
            z = (k % 8192) - 4096,
            v = V.get(k),
            f = VF.get(k) ?? 0;
          if (v - 2 <= f) continue;
          for (const [dx, dz] of D8) {
            const n = vkey(x + dx, z + dz);
            if (fixedV.has(n)) continue;
            if ((V.get(n) ?? 0) < v - 2) {
              V.set(n, v - 2);
              VF.set(n, Math.min(VF.get(n) ?? Infinity, f));
              q.push(n);
            }
          }
        }
        const cellCeil = new Map();
        // The lowest layer from floor f up in a cell that ground may not fill (the most a corner of it may rise to).
        const ceilOf = (cx, cz, f = 0) => {
          const k = K2(cx, cz) * 8 + Math.min(7, f & 7);
          if (cellCeil.has(k)) return cellCeil.get(k);
          let c = f + 64;
          for (let x = cx - 2; x < cx + 2; x++)
            for (let z = cz - 2; z < cz + 2; z++)
              for (let y = f; y < c; y++) {
                const t = K(x, y, z);
                if (T.occ.has(t) || driven.has(t) || corridor.has(t) || tube.has(t) || (taken.has(t) && !fixedCells.has(K2(cx, cz)))) {
                  c = y;
                  break;
                }
              }
          cellCeil.set(k, c);
          return c;
        };
        for (let round = 0; round < 8; round++) {
          let changed = false;
          for (const [k, v] of V) {
            const f = VF.get(k) ?? 0;
            if (fixedV.has(k) || v <= f) continue;
            const x = Math.floor(k / 8192) - 4096,
              z = (k % 8192) - 4096;
            let lim = v;
            for (const [cx, cz] of [[x - 2, z - 2], [x + 2, z - 2], [x - 2, z + 2], [x + 2, z + 2]]) if (!fixedCells.has(K2(cx, cz))) lim = Math.min(lim, ceilOf(cx, cz, f));
            for (const [dx, dz] of D8) lim = Math.min(lim, (V.get(vkey(x + dx, z + dz)) ?? f) + 2);
            if (lim < v) V.set(k, Math.max(f, lim)), (changed = true);
          }
          if (!changed) break;
        }
        const cells = new Set();
        for (const k of V.keys()) {
          const x = Math.floor(k / 8192) - 4096,
            z = (k % 8192) - 4096;
          for (const [cx, cz] of [[x - 2, z - 2], [x + 2, z - 2], [x - 2, z + 2], [x + 2, z + 2]]) cells.add(K2(cx, cz));
        }
        const col = theme.ground;
        for (const ck of cells) {
          if (fixedCells.has(ck)) continue;
          const cx = Math.floor(ck / 8192) - 4096,
            cz = (ck % 8192) - 4096;
          // The cell's floor: the lowest floor among its corners that have ground (0 unless an island).
          let F = Infinity;
          for (const [ax, az] of CORNERS) if (VF.has(vkey(cx + ax, cz + az))) F = Math.min(F, VF.get(vkey(cx + ax, cz + az)));
          if (F == Infinity) F = 0;
          const h = CORNERS.map(([ax, az]) => Math.max(F, V.get(vkey(cx + ax, cz + az)) ?? F));
          if (Math.max(...h) <= F) continue;
          let base = Math.min(...h);
          let rel = h.map((v) => v - base);
          const ps = [];
          // Steps more than two layers: lift the base with whole blocks until the rest fits a piece.
          while (Math.max(...rel) > 2) {
            ps.push(o('Block', cx, base, cz, 0, 0, col));
            base++;
            rel = h.map((v) => Math.max(0, v - base));
          }
          const key = rel.map((v) => (v > 0 ? 1 : 0)).join('');
          const two = Math.max(...rel) == 2;
          const top = piece(key, two, cx, base, cz, col);
          if (top === undefined) continue;
          for (let y = base - ps.length - 1; y >= F; y--) ps.unshift(o('Block', cx, y, cz, 0, 0, col));
          if (top) ps.push(top);
          else base--; // a flat cell: the last fill block is its top
          if (!fits(ps, blockedGround)) continue;
          add(ps);
          pieces.push(...ps);
          if (rel.every((v) => v == 0)) for (let x = cx - 2; x < cx + 2; x++) for (let z = cz - 2; z < cz + 2; z++) if (!T.roadCols.has(K2(x, z))) groundTop.set(K2(x, z), base + 1);
          if (top && top.id != S.Block) for (let x = cx - 2; x < cx + 2; x++) for (let z = cz - 2; z < cz + 2; z++) if (!T.roadCols.has(K2(x, z))) slopeTop.set(K2(x, z), base);
        }
      }
      // ---- no holes: whatever the piece passes above left open ----
      // Works on tiles, whatever the part is (road on its side, the track's own blocks, pillars, our own ground):
      // a. air under any of it is filled to the floor (four layers of it under road higher than an island starts), except
      //    space a car drives in: over any part of the track (blocks get driven on as much as road), beside a road, in
      //    front of a driving face, in a jump's air, where the Test run went;
      // b. bare floor walled in by ground (a pocket, or a notch too narrow to read as open floor) becomes ground.
      {
        const BLOCK = A.stock.Block;
        const unK2 = (c) => [Math.floor(c / 8192) - 4096, (c % 8192) - 4096];
        // Where a car drives: round upright road as the corridor has it, for turned road only out from its driving face.
        const drive = new Set(),
          ceiling = new Set(); // columns whose lowest road hangs upside down: the car is under it
        for (const p of parts) {
          if (!isRoad(p.id)) continue;
          const a = p.axis || 0,
            o0 = sR(0, 0, 0, p.rot || 0, a),
            o1 = sR(0, 1, 0, p.rot || 0, a),
            n = o1.map((v, i) => v - o0[i]);
          for (const [x, y, z] of worldTiles(p)) {
            if (n[1] < 0 && T.roadCols.get(K2(x, z))[0] == y) ceiling.add(K2(x, z));
            for (let d = 0; d <= 3; d++)
              for (let i = -1; i <= 1; i++)
                for (let j = -1; j <= 1; j++) {
                  const u = n[0] ? 0 : i,
                    v = n[0] ? i : n[1] ? 0 : j,
                    w = n[2] ? 0 : j;
                  drive.add(K(x + n[0] * d + u, y + n[1] * d + v, z + n[2] * d + w));
                }
          }
        }
        const lowest = new Map(); // column -> the lowest track tile in it, signs aside: above it can be driven
        for (const p of parts) {
          if (isStock(p.id) && A.cat[p.id] == 'Sign') continue;
          for (const [x, y, z] of worldTiles(p)) lowest.set(K2(x, z), Math.min(lowest.get(K2(x, z)) ?? Infinity, y));
        }
        const canFill = (x, y, z) => {
          const k = K(x, y, z),
            c = K2(x, z),
            road = T.roadCols.get(c);
          if (T.occ.has(k) || driven.has(k) || y > (lowest.get(c) ?? Infinity)) return false;
          if (road && y < road[0] && !ceiling.has(c)) return y == road[0] - 1 || !drive.has(k);
          return !road && !drive.has(k) && !tubeAir.has(k);
        };

        // Columns: the highest thing in each that wants ground under it, and the ground's own tiles.
        const top = new Map(),
          solid = new Set(),
          have = new Set(),
          atFloor = new Set();
        const note = (ps, ours) => {
          for (const p of ps) {
            const sign = !ours && isStock(p.id) && A.cat[p.id] == 'Sign';
            for (const [x, y, z] of worldTiles(p)) {
              const k = K(x, y, z),
                c = K2(x, z);
              if (ours) have.add(k);
              if (ours && p.id == BLOCK) solid.add(k);
              if (y == 0) atFloor.add(c);
              if (!sign && y <= ISLAND) top.set(c, Math.max(top.get(c) ?? 0, y));
            }
          }
        };
        note(parts, false);
        note(out, true);

        // Pieces that can fill: the block flat, and on each side (one tile thick). No triangles: their claimed tiles say
        // less than their faces, and cars hit them.
        const shape = (name, rot, axis) => ({ id: A.stock[name], rot, axis, ts: tiles(A.stock[name], rot, axis) });
        const boxes = [shape('Block', 0, 0), ...[2, 3, 4, 5].map((a) => shape('Block', 0, a))];
        const cover = (want, why) => {
          const todo = new Set(want.map(([x, y, z]) => K(x, y, z))),
            wanted = new Set(todo);
          // A piece may lie only in what is to be filled, in our own blocks, or in our ground that has more above it.
          // A pocket too narrow for that may also take in the foot of our slope round it (ledge), never driving space.
          const okTile = (x, y, z, ledge) => {
            if (y < 0) return false;
            const k = K(x, y, z);
            if (wanted.has(k) || solid.has(k)) return true;
            if (!have.has(k) || drive.has(k) || driven.has(k)) return false;
            return y < (top.get(K2(x, z)) ?? 0) || (ledge && y == 0 && !tubeAir.has(k));
          };
          want.sort((a, b) => b[1] - a[1]);
          for (const [x, y, z] of want) {
            if (!todo.has(K(x, y, z))) continue;
            for (const ledge of why == 'pocket' ? [false, true] : [false]) {
              let best = null,
                bestN = 0;
              search: for (const s of boxes)
                for (const [a, b, c] of s.ts) {
                  const px = x - a,
                    py = y - b,
                    pz = z - c;
                  if (py < 0) continue;
                  let n = 0,
                    ok = true;
                  for (const [i, j, k] of s.ts) {
                    if (!okTile(px + i, py + j, pz + k, ledge)) {
                      ok = false;
                      break;
                    }
                    if (todo.has(K(px + i, py + j, pz + k))) n++;
                  }
                  if (!ok || n <= bestN) continue;
                  bestN = n;
                  best = { s, px, py, pz };
                  if (n == s.ts.length) break search;
                }
              if (!best) continue;
              const p = { id: best.s.id, x: best.px, y: best.py, z: best.pz, rot: best.s.rot, axis: best.s.axis, color: theme.ground };
              add([p]);
              for (const [tx, ty, tz] of worldTiles(p)) {
                const k = K(tx, ty, tz);
                todo.delete(k);
                have.add(k);
                if (p.id == BLOCK) solid.add(k);
                if (ty == 0) atFloor.add(K2(tx, tz));
              }
              break;
            }
          }
        };

        // a. Under everything.
        const below = [];
        for (const c of new Set([...top.keys(), ...T.roadCols.keys()])) {
          const [x, z] = unK2(c),
            road = T.roadCols.get(c);
          const to = road ? road[0] : top.get(c),
            from = road && to > ISLAND ? to - 4 : 0;
          for (let y = from; y < to; y++) if (!have.has(K(x, y, z)) && canFill(x, y, z)) below.push([x, y, z]);
        }
        cover(below, 'under');

        // b. Bare floor walled in by ground.
        if (atFloor.size) {
          let x0 = Infinity,
            x1 = -Infinity,
            z0 = Infinity,
            z1 = -Infinity;
          for (const c of atFloor) {
            const [x, z] = unK2(c);
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x);
            z0 = Math.min(z0, z);
            z1 = Math.max(z1, z);
          }
          x0 -= 8;
          x1 += 8;
          z0 -= 8;
          z1 += 8;
          const W = x1 - x0 + 1,
            H = z1 - z0 + 1,
            N = W * H;
          const bare = new Uint8Array(N).fill(1),
            outside = new Uint8Array(N),
            wide = new Uint8Array(N),
            sum = new Int32Array((W + 1) * (H + 1));
          for (const c of atFloor) {
            const [x, z] = unK2(c);
            bare[(z - z0) * W + x - x0] = 0;
          }
          for (let j = 0; j < H; j++)
            for (let i = 0; i < W; i++) sum[(j + 1) * (W + 1) + i + 1] = bare[j * W + i] + sum[j * (W + 1) + i + 1] + sum[(j + 1) * (W + 1) + i] - sum[j * (W + 1) + i];
          const free = (i, j, n) => sum[(j + n) * (W + 1) + i + n] - sum[j * (W + 1) + i + n] - sum[(j + n) * (W + 1) + i] + sum[j * (W + 1) + i] == n * n;
          const around = (i) => [i % W ? i - 1 : -1, i % W < W - 1 ? i + 1 : -1, i - W, i + W].filter((q) => q >= 0 && q < N);
          // Open floor: where a square NOTCH wide fits, reached from outside.
          const NOTCH = 6,
            FIELD = 24; // walled-in floor with this much open room is a field, not a hole
          for (let j = 0; j + NOTCH <= H; j++)
            for (let i = 0; i + NOTCH <= W; i++) if (free(i, j, NOTCH)) for (let b = 0; b < NOTCH; b++) wide.fill(1, (j + b) * W + i, (j + b) * W + i + NOTCH);
          const reach = [0];
          outside[0] = 1;
          for (let h = 0; h < reach.length; h++)
            for (const n of around(reach[h]))
              if (!outside[n] && wide[n]) {
                outside[n] = 1;
                reach.push(n);
              }
          const seen = new Uint8Array(N),
            pocket = [];
          for (let s = 0; s < N; s++) {
            if (!bare[s] || outside[s] || seen[s]) continue;
            const cells = [s];
            seen[s] = 1;
            let field = false,
              rim = Infinity,
              road = Infinity; // the lowest road that is nearest to any of the pocket
            for (let h = 0; h < cells.length; h++) {
              const i = cells[h] % W,
                j = Math.floor(cells[h] / W);
              road = Math.min(road, roadLayerNear(x0 + i, z0 + j));
              if (!field && i + FIELD <= W && j + FIELD <= H && free(i, j, FIELD)) field = true;
              for (const n of around(cells[h])) {
                if (bare[n]) {
                  if (!outside[n] && !seen[n]) {
                    seen[n] = 1;
                    cells.push(n);
                  }
                } else {
                  const x = x0 + (n % W),
                    z = z0 + Math.floor(n / W);
                  let t = 0;
                  while (t < ISLAND && have.has(K(x, t, z))) t++;
                  rim = Math.min(rim, Math.max(1, t));
                }
              }
            }
            // A pocket that reaches road a layer or less off the floor is floor a car can drive off onto: it stays.
            if (field || rim == Infinity || road <= 1) continue;
            // Level with the lowest ground round it and a layer clear under the nearest road.
            for (const n of cells) {
              const x = x0 + (n % W),
                z = z0 + Math.floor(n / W),
                h = Math.min(rim, roadLayerNear(x, z) - 1);
              for (let y = 0; y < h; y++) {
                if (have.has(K(x, y, z)) || !canFill(x, y, z)) break;
                pocket.push([x, y, z]);
                top.set(K2(x, z), Math.max(top.get(K2(x, z)) ?? 0, y));
                if (y == h - 1 && !T.roadCols.has(K2(x, z))) groundTop.set(K2(x, z), h);
              }
            }
          }
          cover(pocket, 'pocket');
        }
      }
      // Leave out ground blocks buried on every side: nobody can see them.
      {
        const solid = new Set();
        for (const p of out) if (p.id == S.Block && !p.axis) solid.add(K(p.x, p.y, p.z));
        const covered = (x, y, z) => solid.has(K(x, y, z));
        const buried = (p) => p.id == S.Block && (p.y == 0 || covered(p.x, p.y - 1, p.z)) && covered(p.x, p.y + 1, p.z) && covered(p.x + 4, p.y, p.z) && covered(p.x - 4, p.y, p.z) && covered(p.x, p.y, p.z + 4) && covered(p.x, p.y, p.z - 4);
        const keep = out.filter((p) => !buried(p));
        out.length = 0;
        out.push(...keep);
      }
      // The piece for a cell whose corners (NW NE SE SW) are raised as in key, by one layer or two.
      function piece(key, two, x, y, z, col) {
        if (key == '0000') return null;
        if (two) {
          const slope = { 1100: 0, 1001: 1, '0011': 2, '0110': 3 }[key];
          if (slope != null) return o('BlockSlopedUp', x, y, z, slope, 0, col);
          const outer = { 1000: 0, '0001': 1, '0010': 2, '0100': 3 }[key];
          if (outer != null) return o('BlockSlopedUpOuterCorner', x, y, z, outer, 0, col);
          const inner = { 1101: 0, 1110: 1, '0111': 2, 1011: 3 }[key];
          if (inner != null) return o('BlockSlopedUpInnerCorner', x, y, z, inner, 0, col);
          if (key == '1010' || key == '0101') return o('BlockSlopedUpInnerCorner', x, y, z, key == '1010' ? 0 : 1, 0, col);
          return undefined;
        }
        const slope = { 1100: 0, 1001: 1, '0011': 2, '0110': 3 }[key];
        if (slope != null) return o('BlockSlopeUp', x, y, z, slope, 0, col);
        if (key == '1111') return o('Block', x, y, z, 0, 0, col);
        // One raised corner: leave it flat; three: a whole block.
        if (key.split('1').length - 1 >= 3) return o('Block', x, y, z, 0, 0, col);
        return null;
      }

      // ==== objects ===================================================================================================
      // Composed, not scattered: one colour scheme for the whole decoration (the theme's looks), groves of one kind of
      // tree in one colour laid out like real clumps, rocks only as outcrops, and every other piece set where a person
      // would put it, each with its reason.
      const look = r.pick(theme.looks);
      const TAU = Math.PI * 2;
      // Where an object can stand: on flat ground we built, or on the floor near road low enough to see it from.
      const groundTiles = new Set();
      for (const p of out.slice(groundFrom)) for (const [x, y, z] of worldTiles(p)) groundTiles.add(K(x, y, z));
      const ground = (x, z, slopes) => groundTop.get(K2(x, z)) ?? (slopes ? slopeTop.get(K2(x, z)) : undefined) ?? (T.roadCols.has(K2(x, z)) || slopeTop.has(K2(x, z)) || roadLayerNear(x, z) > ISLAND ? undefined : 0);
      const placed = [];
      // Puts a copy of base with its middle at (x, z) on the ground there. Natural things (trees, rocks, plants) may
      // stand on a slope, sitting on its low side and sinking into the high side; built things need level ground.
      function put(natural, name, x, z, why, base) {
        const ps = move(base, Math.round(x), 0, Math.round(z));
        const ts = partsTiles(ps);
        const low = Math.min(...ts.map((t) => t[1]));
        const foot = new Set();
        for (const [tx, ty, tz] of ts) if (ty == low) foot.add(K2(tx, tz));
        let gMin = Infinity,
          gMax = -Infinity;
        for (const c of foot) {
          const g = ground(Math.floor(c / 8192) - 4096, (c % 8192) - 4096, natural);
          if (g === undefined) return false;
          (gMin = Math.min(gMin, g)), (gMax = Math.max(gMax, g));
        }
        if (gMax - gMin > (natural ? 2 : 1)) return false;
        const lifted = move(ps, 0, (natural && gMax - gMin > 1 ? gMin : gMax) - low, 0);
        if (!fits(lifted, (q) => blockedObj(q) || gap.has(q), null, natural ? (q) => groundTiles.has(q) : null)) return false;
        add(lifted);
        for (const [tx, ty, tz] of partsTiles(lifted)) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) gap.add(K(tx + dx, ty, tz + dz));
        placed.push({ name, x: Math.round(x), z: Math.round(z), why });
        return true;
      }
      // Tries spots round (x, z), nearest first, keeping between dMin and dMax tiles from the road.
      function putAt(base, natural, name, x, z, why, dMin = 2, dMax = 40, reach = 3) {
        if (!base.length) return false;
        for (let rad = 0; rad <= reach; rad++)
          for (let i = -rad; i <= rad; i++)
            for (let j = -rad; j <= rad; j++) {
              if (Math.max(Math.abs(i), Math.abs(j)) != rad) continue;
              const d = roadDist(x + i, z + j);
              if (d < dMin || d > dMax) continue;
              if (put(natural, name, x + i, z + j, why, base)) return true;
            }
        return false;
      }
      const putModel = (model, colour, natural, x, z, k, why, dMin, dMax, reach) => putAt(turnAll(one(model, colour), k), natural, model, x, z, why, dMin, dMax, reach);
      const last = () => placed[placed.length - 1];
      // Which way to turn an object so its front (-z at k = 0) looks along (fx, fz); and that front for a turn k.
      const facing = (fx, fz) => (Math.abs(fx) > Math.abs(fz) ? (fx < 0 ? 1 : 3) : fz < 0 ? 0 : 2);
      const frontOf = (k) => [[0, -1], [-1, 0], [0, 1], [1, 0]][((k % 4) + 4) % 4];
      // A point d tiles out from the road edge on one side of line sample p, and the way out.
      const outFrom = (p, left, d) => {
        const [nx, nz] = side(p, left);
        let t = 1;
        while (t < 30 && roadDist(p.x + nx * t, p.z + nz * t) < 1.5) t++;
        return [p.x + nx * (t + d), p.z + nz * (t + d), nx, nz];
      };
      const nearestSample = (x, z) => {
        let best = 0,
          bd = Infinity;
        for (let i = 0; i < S.length; i++) {
          const d = (S[i].x - x) ** 2 + (S[i].z - z) ** 2;
          if (d < bd) (bd = d), (best = i);
        }
        return best;
      };
      const partCentre = (i) => {
        const ts = worldTiles(parts[i]);
        return [ts.reduce((a, t) => a + t[0] + 0.5, 0) / ts.length, ts.reduce((a, t) => a + t[2] + 0.5, 0) / ts.length];
      };
      const spaceOn = (p, left) => {
        const [nx, nz] = side(p, left);
        let t = 2;
        while (t < 30 && roadDist(p.x + nx * t, p.z + nz * t) >= Math.min(t - 1, 3) - 0.01) t++;
        return t;
      };
      const crowded = (x, z, rad, n) => placed.filter((q) => Math.hypot(q.x - x, q.z - z) < rad).length >= n;
      const pickKind = () => {
        const total = theme.groves.reduce((a, g) => a + g[1], 0);
        let v = r() * total;
        for (const [k, w] of theme.groves) if ((v -= w) < 0) return k;
        return theme.groves[0][0];
      };
      const kindColour = (kind, accent) => (KINDS[kind].colour == 'leaf' ? look.leaf[accent ? 1 : 0] : look[KINDS[kind].colour] ?? 1);

      // A grove round (cx, cz): one kind of tree in one colour (the main one, now and then the accent), the biggest in
      // the middle, medium ones in a ring round it, small ones in an outer ring, bushes of the same colour on the side
      // towards the road (tx, tz) and, now and then, a fallen trunk or a dead tree at its edge.
      function grove(cx, cz, size, why, tx = 0, tz = 0, kind = pickKind()) {
        const Kd = KINDS[kind],
          col = kindColour(kind, look.leaf[1] != look.leaf[0] && r() < 0.3);
        let n = 0;
        const one2 = (list, x, z, reach) => putModel(r.pick(list), col, true, x, z, r.int(0, 3), why, 3, 60, reach) && ++n;
        one2(Kd.big, cx, cz, 3);
        const ring = (count, R, list) => {
          const a0 = r() * TAU;
          for (let i = 0; i < count; i++) {
            const a = a0 + (i / count) * TAU + (r() - 0.5) * 0.5,
              d = R * (0.85 + r() * 0.3);
            one2(list, cx + Math.cos(a) * d, cz + Math.sin(a) * d, 2);
          }
        };
        const mid = Math.max(2, Math.round((size - 1) * 0.5));
        ring(mid, kind == 'pine' || kind == 'cactus' ? 4 : 5, Kd.mid);
        ring(Math.max(0, size - 1 - mid), kind == 'pine' || kind == 'cactus' ? 7 : 8.5, Kd.small);
        if (Kd.colour == 'leaf' && theme.bushes && (tx || tz)) {
          const a0 = Math.atan2(tz, tx);
          for (let i = 0; i < 3; i++) {
            const a = a0 + (i - 1) * 0.5;
            if (putModel(r.pick(theme.bushes), col, true, cx + Math.cos(a) * 10.5, cz + Math.sin(a) * 10.5, r.int(0, 3), why, 2, 60, 2)) n++;
          }
        }
        if (theme.fallen && r() < theme.fallen) {
          const a = r() * TAU;
          if (putModel(r.pick(['Log', 'TreeDead']), look.timber, true, cx + Math.cos(a) * 11, cz + Math.sin(a) * 11, r.int(0, 3), why, 3, 60, 2)) n++;
        }
        return n;
      }
      // An outcrop: a boulder (big: a big boulder, a cliff or a spire) with three smaller rocks round it, one colour.
      function outcrop(cx, cz, why, big = false) {
        if (!putModel(r.pick(big ? ['BoulderBig', 'Cliff', 'RockSpire'] : ['Boulder', 'Rocks']), look.rock, true, cx, cz, r.int(0, 3), why, 3, 60, 3)) return 0;
        const { x, z } = last();
        const a0 = r() * TAU;
        let n = 1;
        for (let i = 0; i < 3; i++) {
          const a = a0 + i * 2.1 + (r() - 0.5) * 0.6,
            d = (big ? 10 : 6.5) + r() * 2;
          if (putModel(r.pick(['Rock', 'RockSmall', 'RockFlat']), look.rock, true, x + Math.cos(a) * d, z + Math.sin(a) * d, r.int(0, 3), why, 2, 60, 2)) n++;
        }
        return n;
      }
      // A home: a house facing the road with two trees behind it.
      function home(x, z, k, why) {
        if (!putModel(r.pick(['Cabin', 'House']), look.roof, false, x, z, k, why, 3, 20, 3)) return 0;
        const h = last(),
          [fx, fz] = frontOf(k),
          tree = r.pick(theme.homeTrees),
          col = KINDS[theme.groves[0][0]].colour == 'pine' || tree.startsWith('Pine') ? look.pine : look.leaf[0];
        for (const s of [-1, 1]) putModel(tree, col, true, h.x - fx * 9 + fz * s * 6, h.z - fz * 9 - fx * s * 6, r.int(0, 3), why, 3, 40, 2);
        return 1;
      }
      const feature = (what, x, z, k, why, tx, tz) =>
        what == 'home' ? home(x, z, k, why) : what == 'outcrop' ? outcrop(x, z, why) : what == 'crystals' ? putModel('Crystals', look.rock == 2 ? 2 : 1, true, x, z, r.int(0, 3), why, 3, 30, 3) : grove(x, z, 3, why, tx, tz);

      // 1. The landmark: outside the biggest turn, seen all the way round it (or beside the longest straight).
      if (S.length) {
        const t = turnsBySize[0];
        let i, left;
        if (t) (i = t.apex), (left = !t.left);
        else {
          const st = [...L.straights].sort((a, b) => b.i1 - b.i0 - (a.i1 - a.i0))[0];
          i = st ? Math.floor((st.i0 + st.i1) / 2) : Math.floor(S.length / 2);
          left = spaceOn(S[i], true) > spaceOn(S[i], false);
        }
        const [x, z] = outFrom(S[i], left, 10);
        const k = facing(S[i].x - x, S[i].z - z);
        const m = r.pick(theme.landmark),
          rocky = m == 'Mesa' || m == 'RockArch';
        putModel(m, rocky ? look.rock : m == 'Lighthouse' ? look.cloth : look.roof, rocky, x, z, k, t ? `landmark outside the ${t.left ? 'left' : 'right'} turn, seen all the way round it` : 'landmark beside the longest straight', 6, 30, 8);
      }
      // 2. Stands at the start and the finish, facing the road, with a flag either side in the same colour.
      const stands = (idx, what) => {
        if (!idx.length) return;
        const [cx, cz] = partCentre(idx[0]);
        const i = nearestSample(cx, cz);
        const p = S[i];
        const sides = spaceOn(p, true) >= spaceOn(p, false) ? [true, false] : [false, true];
        for (const left of sides.slice(0, what == 'finish' ? 2 : 1)) {
          const [x, z, nx, nz] = outFrom(p, left, 5);
          putModel('Stand', look.cloth, false, x, z, facing(-nx, -nz), `stand beside the ${what}`, 2, 12, 4);
        }
        for (const off of [-6, 6]) {
          const q = S[Math.max(0, Math.min(S.length - 1, i + off))];
          const [x, z] = outFrom(q, !sides[0], 1);
          putModel('Flag', look.cloth, false, x, z, facing(q.hx, q.hz), `flag at the ${what}`, 1, 4, 1);
        }
      };
      stands(T.starts.slice(0, 1), 'start');
      stands(T.finishes.slice(0, 1), 'finish');
      // 3. A flag either side of every checkpoint, right by the gate, all in the stands' colour.
      for (const gate of T.checks) {
        const [cx, cz] = partCentre(gate[0]);
        const p = S[nearestSample(cx, cz)];
        for (const left of [true, false]) {
          const [x, z] = outFrom(p, left, 1);
          putModel('Flag', look.cloth, false, x, z, facing(p.hx, p.hz), 'flag at a checkpoint', 1, 3, 1);
        }
      }
      // 4. The turns: a grove round the outside (two along a long one), a verge of tall grass along the outside edge,
      // chevrons before the sharp ones, and one feature on the inside where there is room.
      for (const t of turnsBySize) {
        const outside = !t.left;
        const len = t.i1 - t.i0;
        const size = Math.round(Math.max(3, Math.min(9, 3 + len * 0.12)) * amount);
        for (const f of len > 36 ? [0.25, 0.75] : [0.5]) {
          const p = S[Math.round(t.i0 + f * len)];
          const [x, z, nx, nz] = outFrom(p, outside, 8 + r.int(0, 2));
          if (!crowded(x, z, 10, 4)) grove(x, z, size, `a grove round the outside of the ${t.left ? 'left' : 'right'} turn`, -nx, -nz);
        }
        if (theme.verge)
          for (let i = t.i0; i <= t.i1; i += 3) {
            const [x, z] = outFrom(S[i], outside, 0.5);
            putModel(theme.verge, look.grass, true, x, z, r.int(0, 3), 'tall grass along the outside of a turn', 1, 2.5, 1);
          }
        if (Math.abs(t.angle) >= (70 * Math.PI) / 180 && t.radius < 16) {
          for (const f of [0.15, 0.45]) {
            const p = S[Math.round(t.i0 + f * len)];
            const [x, z] = outFrom(p, outside, 1);
            const sign = t.left ? 'SignArrowLeft' : 'SignArrowRight';
            putAt([turnPart(o(sign, 0, 0, 2, 0, 0, 0), facing(p.hx, p.hz))], false, sign, x, z, 'chevron on the outside of a sharp turn', 1, 4, 2);
          }
        }
        const p = S[t.apex];
        if (spaceOn(p, t.left) >= 9 && r() < 0.8 * amount) {
          const [x, z, nx, nz] = outFrom(p, t.left, 5 + r.int(0, 2));
          if (!crowded(x, z, 8, 3)) feature(r.pick(theme.inside), x, z, facing(-nx, -nz), `on the inside of the ${t.left ? 'left' : 'right'} turn`, -nx, -nz);
        }
      }
      // 5. Straights: lamps at an even spacing along one side, facing the road; a fence along the other, and on long
      // ones a line of the same tree behind it.
      for (const st of L.straights) {
        const len = st.i1 - st.i0;
        if (len < 20) continue;
        const mid = S[Math.floor((st.i0 + st.i1) / 2)];
        const left = spaceOn(mid, true) >= spaceOn(mid, false);
        const step = Math.round(10 / Math.min(1.3, amount));
        for (let i = st.i0 + 4; i <= st.i1 - 4; i += step) {
          const p = S[i];
          const [x, z, nx, nz] = outFrom(p, left, 1);
          putModel(theme.lamp, look.pole, false, x, z, facing(-nx, -nz), 'lamps along a straight', 1, 4, 1);
        }
        if (amount >= 1 && len >= 28) {
          const along = Math.abs(mid.hx) > Math.abs(mid.hz) ? 0 : 1;
          for (let i = st.i0 + 6; i <= st.i1 - 6; i += 4) {
            const [x, z] = outFrom(S[i], !left, 2);
            putModel(theme.fence, look.fence, false, x, z, along, 'a fence along a straight', 2, 6, 1);
          }
          const kind = pickKind(),
            model = r.pick(KINDS[kind].mid),
            col = kindColour(kind, false);
          for (let i = st.i0 + 8; i <= st.i1 - 8; i += 7) {
            const [x, z] = outFrom(S[i], !left, 7);
            putModel(model, col, true, x, z, r.int(0, 3), 'a line of trees behind the fence', 4, 12, 1);
          }
        }
      }
      // 6. Hills: a grove or an outcrop on top.
      for (const h of hills) (r() < 0.5 ? outcrop(h.x, h.z, 'an outcrop on top of a hill', true) : grove(h.x, h.z, 4, 'a grove on top of a hill'));
      // 7. Bare stretches get a grove on the roomier side; further out, a few bigger woods close the view.
      for (let i = Math.round(10 / amount); i < S.length - 5; i += Math.round(22 / amount)) {
        const p = S[i];
        if (p.air || crowded(p.x, p.z, 16, 3)) continue;
        const left = spaceOn(p, true) >= spaceOn(p, false);
        const [x, z, nx, nz] = outFrom(p, left, 8 + r.int(0, 3));
        grove(x, z, Math.round(4 * amount), 'a grove along a bare stretch', -nx, -nz);
      }
      if (amount >= 1)
        for (let i = 15, s = 0; i < S.length; i += Math.round(45 / amount), s++) {
          const p = S[i];
          if (p.air) continue;
          const [x, z, nx, nz] = outFrom(p, s % 2 == 0, 18 + r.int(0, 6));
          if (!crowded(x, z, 14, 4)) grove(x, z, Math.round(7 * amount), 'a wood further out', -nx, -nz);
        }

      // Exact duplicates add nothing; drop them, and whatever the track has itself: what is returned here is what
      // Remove deletes later, so it must never name one of the track's own parts.
      const seenP = new Set(parts.map((p) => [p.id, p.x, p.y, p.z, p.rot || 0, p.axis || 0].join()));
      const add2 = [];
      for (const p of out) {
        const k = [p.id, p.x, p.y, p.z, p.rot || 0, p.axis || 0].join();
        if (seenP.has(k)) continue;
        seenP.add(k);
        add2.push(p);
      }
      return { add: add2, placed, stats: { parts: add2.length, line: runLine ? 'run' : 'road', turns: L.turns.length, straights: L.straights.length, ours: T.ours } };
    }

    return { C, THEMES, objectsFor, rng, tiles, worldTiles, partsTiles, turnPart, turnAll, move, K, K2, isRoad, isStart, isCheck, isFinish, hasCollision, o, okColour, sR, readTrack, analyseLine, lineFromTrack, decorate };
  }

  const engine = makeEngine(root.TM_AUTODECO, root.TM_DATA);
  root.TM.autodeco = { engine };
  if (typeof document == 'undefined') return;

  // ==== the editor's Auto deco tab ==================================================================================
  // A tab beside Assets in the editor's top bar opens a small panel: theme and how much, then Decorate (the underbody
  // is always built). With no finished Test run of this route Decorate asks first: Test run, or Decorate anyway.
  // The decoration is one undo step; decorating again replaces the last one, and Remove takes it away.
  // Hooks (tools/patch.js): __beCupEditor (scene, refresh, commit), and TM.tools.bestLine for the driven line.
  const KEY = 'be-autodeco';
  const LAST_KEY = 'be-autodeco-last';
  const store = {
    get: (k) => {
      try {
        return JSON.parse(localStorage.getItem(k));
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v));
      } catch {}
    },
  };
  const AMOUNTS = { light: ['Light', 0.55], normal: ['Normal', 1], lots: ['Lots', 1.5] };
  let prefs = Object.assign({ theme: 'meadow', amount: 'normal', seed: 1 }, store.get(KEY) ?? {});
  let ui = null,
    css = null;
  const editor = () => self.__beCupEditor ?? null;
  const pkey = (p) => [p.id, p.x, p.y, p.z, p.rot | 0, p.axis | 0].join(',');

  function trackParts() {
    const out = [];
    editor()
      ?.scene()
      ?.getTrackData()
      ?.forEachPart((x, y, z, id, rot, axis, color, cp, so) => out.push({ id, x, y, z, rot, axis, color, cp, so }));
    return out;
  }
  // Decorations are remembered by part, place, turn and colour, so a piece painted or replaced by hand is the
  // track's own from then on. The last two are kept: undo after decorating again brings the one before back.
  const dkey = (p) => pkey(p) + ',' + (p.color | 0);
  let decos = null; // also in memory, for when the browser has no room to store them
  function lastDecos() {
    if (!decos) {
      const v = store.get(LAST_KEY);
      decos = Array.isArray(v?.decos) ? v.decos : [];
    }
    return decos;
  }
  function keepDecos(list) {
    decos = list;
    store.set(LAST_KEY, null); // free its room first
    store.set(LAST_KEY, list.length ? { decos: list } : null);
    if (list.length > 1 && !store.get(LAST_KEY)) store.set(LAST_KEY, { decos: list.slice(0, 1) });
  }
  // The decoration that is in the track now, if one is: [{id, x, y, z, rot, axis, color}].
  function lastDeco(parts) {
    const have = new Set(parts.map(dkey));
    let best = null,
      bestShare = 0;
    for (const list of lastDecos()) {
      if (!list.length) continue;
      const still = list.map(([id, x, y, z, rot, axis, color]) => ({ id, x, y, z, rot, axis, color })).filter((p) => have.has(dkey(p)));
      const share = still.length / list.length;
      if (share >= 0.5 && share > bestShare) (best = still), (bestShare = share);
    }
    return best;
  }

  // ---- test runs of this route ----
  // A run only counts on the route it was driven on: the road, gates and their orders as they were when it started.
  const runRoute = new WeakMap();
  let testRoute = null,
    wantedRun = false, // Test was started from the question, so the panel comes back with the result
    working = false;
  function routeSig() {
    const road = [];
    for (const p of trackParts()) if (engine.isRoad(p.id)) road.push([pkey(p), p.cp ?? '', p.so ?? ''].join(','));
    return road.sort().join(';');
  }
  function runHere() {
    const sig = routeSig();
    return self.TM.tools?.bestLine?.((r) => runRoute.get(r) === sig) ?? null;
  }
  // Decorate's button: straight on with a finished run of this route, else the question.
  function askOrDecorate() {
    const run = runHere();
    if (run?.finished) return decorate();
    ask(run ? 'unfinished' : 'none');
  }
  function ask(why) {
    if (!ui) return;
    ui.asking = why;
    if (why) {
      ui.askText.textContent =
        (why == 'unfinished' ? "Your test run didn't reach the finish. " : 'You have no test run of this route. ') +
        'Without one Auto deco guesses where you drive and can put ground or a tree in your way. Drive to the finish first?';
      status('');
    }
    ui.askBox.hidden = !why;
    ui.foot.hidden = !!why;
  }
  function testRun() {
    const b = [...document.querySelectorAll('.editor-ui button')].find((b) => !b.closest('.be-ad, .be-runs') && b.querySelector('img[src$="images/test.svg"]'));
    if (!b) return status('Press Test at the top, drive to the finish, then press Decorate.');
    ask(null);
    wantedRun = true;
    ui.panel.hidden = true;
    refresh();
    document.activeElement?.blur?.(); // the driving keys must not press a button here
    b.click();
  }

  // A fresh random layout every time: the seed only exists so one run is consistent with itself.
  const freshSeed = () => {
    try {
      return crypto.getRandomValues(new Uint32Array(1))[0] || 1;
    } catch {
      return 1 + Math.floor(Math.random() * 4294967295);
    }
  };

  function decorate() {
    const ed = editor(),
      scene = ed?.scene();
    if (!scene) return status('Open a track in the editor first.');
    if (working) return;
    working = true;
    ask(null);
    prefs.seed = freshSeed();
    save();
    status('Decorating…');
    setTimeout(() => {
      working = false;
      // The editor was left, or another opened, meanwhile.
      if (!ui || editor()?.scene() !== scene) return;
      let res;
      const all = trackParts();
      const old = lastDeco(all) ?? [];
      const oldKeys = new Set(old.map(dkey));
      const own = all.filter((p) => !oldKeys.has(dkey(p)));
      const run = runHere();
      try {
        res = engine.decorate(own, { theme: prefs.theme, amount: AMOUNTS[prefs.amount][1], seed: prefs.seed, run: run?.pts, partial: !!run && !run.finished });
      } catch (e) {
        console.error('Auto deco:', e);
        return status('Auto deco failed: ' + e.message);
      }
      const removed = [],
        added = [];
      for (const p of old)
        try {
          const t = scene.deleteSpecificPart(p.id, p.x, p.y, p.z, p.rot, p.axis);
          if (t) removed.push({ id: t.id, x: t.x, y: t.y, z: t.z, rotation: t.rotation, rotationAxis: t.rotationAxis, color: t.color, checkpointOrder: t.checkpointOrder, startOrder: t.startOrder });
        } catch {}
      for (const p of res.add)
        try {
          scene.setPart(p.x, p.y, p.z, p.id, p.rot, p.axis, p.color, null, null);
          added.push({ id: p.id, x: p.x, y: p.y, z: p.z, rotation: p.rot, rotationAxis: p.axis, color: p.color, checkpointOrder: null, startOrder: null });
        } catch (e) {
          console.warn('Auto deco part', p, e);
        }
      try {
        ed.refresh();
      } catch {}
      ed.commit(removed, added);
      keepDecos([added.map((p) => [p.id, p.x, p.y, p.z, p.rotation, p.rotationAxis, p.color]), ...lastDecos().slice(0, 1)]);
      const line = !run ? 'Guessed the route, so check the jumps and corners.' : run.finished ? 'Fitted to your best test run.' : "Kept clear of the run that didn't finish and guessed the rest.";
      status(res.message ?? `Added ${added.length} parts${removed.length ? `, replacing the last decoration` : ''}. ${line} Undo takes it all back.`);
      refresh();
    }, 30);
  }

  function remove() {
    const ed = editor(),
      scene = ed?.scene();
    if (!scene) return;
    const old = lastDeco(trackParts());
    if (!old) return status('Nothing from Auto deco to remove in this track.');
    const removed = [];
    for (const p of old)
      try {
        const t = scene.deleteSpecificPart(p.id, p.x, p.y, p.z, p.rot, p.axis);
        if (t) removed.push({ id: t.id, x: t.x, y: t.y, z: t.z, rotation: t.rotation, rotationAxis: t.rotationAxis, color: t.color, checkpointOrder: t.checkpointOrder, startOrder: t.startOrder });
      } catch {}
    try {
      ed.refresh();
    } catch {}
    ed.commit(removed, []);
    status(`Removed ${removed.length} parts. Undo puts them back.`);
    refresh();
  }

  const save = () => store.set(KEY, prefs);

  function addCSS() {
    css = document.createElement('style');
    css.textContent = `
.be-ad { display: inline-block; position: relative; vertical-align: top; margin: -1px 0 0 -6px; }
.be-ad [hidden] { display: none !important; }
.be-ad > .be-ad-tab { padding: 6px 7px 6px 16px; clip-path: polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%); background: var(--surface-secondary-color); pointer-events: auto; }
.be-ad > .be-ad-tab > .button { white-space: nowrap; }
.be-ad > .be-ad-tab > .button.open { background-color: var(--button-hover-color); }
.be-ad > .be-ad-panel { position: absolute; left: 0; top: calc(100% + 6px); box-sizing: border-box; width: 520px; max-width: calc(100vw - 20px); max-height: calc(100vh - 120px); overflow-y: auto;
  scrollbar-width: thin; padding: 12px 26px 14px 14px; clip-path: polygon(0 0, 100% 0, calc(100% - 14px) 100%, 0 100%); color: var(--text-color); background-color: var(--surface-color);
  pointer-events: auto; font-size: 21px; }
.be-ad-panel > .be-ad-title { font-size: 26px; margin: 0 0 4px 0; }
.be-ad-panel > .be-ad-h { margin: 10px 0 4px 0; padding-bottom: 2px; border-bottom: 1px solid rgba(255, 255, 255, 0.9); font-size: 16px; font-style: italic; opacity: 0.75; }
.be-ad-panel > .be-ad-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 5px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
.be-ad-panel .be-ad-seg { display: flex; gap: 0; }
.be-ad-panel .be-ad-seg > .button { margin: 0 0 0 -2px; padding: 4px 14px; font-size: 19px; }
.be-ad-panel .be-ad-seg > .button.on { background-color: var(--button-hover-color); box-shadow: inset 0 0 4px #fff; }
.be-ad-panel .be-ad-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.be-ad-panel .be-ad-foot > .button { padding: 5px 18px; font-size: 20px; white-space: nowrap; }
.be-ad-panel .be-ad-foot > .button.primary { box-shadow: inset 0 -3px 0 #7272c2; }
.be-ad-panel > .be-ad-ask > p { margin: 12px 0 0 0; font-size: 19px; line-height: 1.35; white-space: normal; }
.be-ad-panel > .be-ad-route, .be-ad-panel > .be-ad-status { margin: 8px 0 0 0; font-size: 17px; line-height: 1.35; opacity: 0.85; white-space: normal; }
`;
    document.head.appendChild(css);
  }

  const btn = (label, cls, fn, title) => {
    const b = document.createElement('button');
    b.className = 'button' + (cls ? ' ' + cls : '');
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
    return b;
  };
  const seg = (options, get, set) => {
    const box = document.createElement('div');
    box.className = 'be-ad-seg';
    const bs = Object.entries(options).map(([k, label]) => {
      const b = btn(label, '', () => {
        set(k);
        save();
        refresh();
      });
      b.dataset.k = k;
      box.appendChild(b);
      return b;
    });
    box.sync = () => bs.forEach((b) => b.classList.toggle('on', b.dataset.k == get()));
    return box;
  };
  const row = (label, control) => {
    const r = document.createElement('div');
    r.className = 'be-ad-row';
    const l = document.createElement('span');
    l.textContent = label;
    r.append(l, control);
    return r;
  };

  function makeUI() {
    css ?? addCSS();
    const rootEl = document.querySelector('#ui > .editor-ui') ?? document.querySelector('.editor-ui');
    const top = rootEl?.querySelector('.top');
    const anchor = top?.querySelector('.be-as-tab') ?? top?.querySelector('.be-runs') ?? top?.querySelector('.track-settings-container');
    if (!anchor) return null;
    const box = document.createElement('div');
    box.className = 'be-ad';
    const tabWrap = document.createElement('div');
    tabWrap.className = 'be-ad-tab';
    const panel = document.createElement('div');
    panel.className = 'be-ad-panel';
    panel.hidden = true;
    const tab = btn('Auto deco', '', () => {
      panel.hidden = !panel.hidden;
      ask(null);
      refresh();
    }, 'Decorate the track around its route: ground under the road, hills, trees, rocks, a landmark, stands and more');
    tabWrap.appendChild(tab);
    const title = document.createElement('div');
    title.className = 'be-ad-title';
    title.textContent = 'Auto deco';
    const h1 = document.createElement('div');
    h1.className = 'be-ad-h';
    h1.textContent = 'Look';
    const themes = seg(Object.fromEntries(Object.entries(engine.THEMES).map(([k, t]) => [k, t.label])), () => prefs.theme, (k) => (prefs.theme = k));
    const amounts = seg(Object.fromEntries(Object.entries(AMOUNTS).map(([k, [l]]) => [k, l])), () => prefs.amount, (k) => (prefs.amount = k));
    const h2 = document.createElement('div');
    h2.className = 'be-ad-h';
    h2.textContent = 'Route';
    const route = document.createElement('p');
    route.className = 'be-ad-route';
    const statusEl = document.createElement('p');
    statusEl.className = 'be-ad-status';
    const foot = document.createElement('div');
    foot.className = 'be-ad-foot';
    const removeBtn = btn('Remove', '', remove, 'Take the last decoration away (one undo step)');
    const go = btn('Decorate', 'primary', askOrDecorate, 'Decorate the track. Every press makes a new random layout and replaces the last decoration');
    foot.append(removeBtn, go);
    // The question, in the buttons' place.
    const askBox = document.createElement('div');
    askBox.className = 'be-ad-ask';
    askBox.hidden = true;
    const askText = document.createElement('p');
    const askFoot = document.createElement('div');
    askFoot.className = 'be-ad-foot';
    askFoot.append(
      btn('Cancel', '', () => ask(null)),
      btn('Decorate anyway', '', () => decorate(), 'Decorate along a guessed route'),
      btn('Test run', 'primary', testRun, 'Start a Test run: drive to the finish, then press Decorate'),
    );
    askBox.append(askText, askFoot);
    panel.append(title, h1, row('Theme', themes), row('Amount', amounts), h2, route, foot, askBox, statusEl);
    box.append(tabWrap, panel);
    anchor.after(box);
    for (const ev of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'wheel', 'keydown', 'keyup', 'contextmenu']) box.addEventListener(ev, (e) => e.stopPropagation());
    return { box, tab, panel, themes, amounts, route, statusEl, removeBtn, foot, askBox, askText, asking: null };
  }

  function status(text) {
    if (ui) ui.statusEl.textContent = text;
  }

  function refresh() {
    if (!ui) return;
    ui.tab.classList.toggle('open', !ui.panel.hidden);
    ui.themes.sync();
    ui.amounts.sync();
    if (ui.panel.hidden) return;
    const run = runHere();
    ui.route.textContent = !run
      ? 'No test run of this route yet.'
      : run.finished
        ? 'Uses your best test run: nothing goes where you drove or flew.'
        : "Your test run didn't reach the finish.";
    ui.removeBtn.disabled = !lastDeco(trackParts());
  }

  function open() {
    wantedRun = working = false;
    testRoute = null;
    ui = makeUI();
    refresh();
  }
  function close() {
    ui?.box.remove();
    ui = null;
  }

  // Opens and closes with the editor's own tools (tm_tools.js), which tools/patch.js hooks into the editor, after the
  // Assets tab (tm_assets.js) so it sits beside it.
  const tools = self.TM.tools;
  if (tools && !tools.__autodeco) {
    tools.__autodeco = true;
    const { open: o, close: c, testStart: s, testEnd: e } = tools;
    tools.testStart = function () {
      try {
        testRoute = routeSig();
      } catch (err) {
        testRoute = null;
        console.warn('Auto deco:', err);
      }
      return s.apply(this, arguments);
    };
    tools.testEnd = function () {
      const out = e.apply(this, arguments);
      try {
        if (testRoute != null) for (const r of tools.runs()) if (!runRoute.has(r)) runRoute.set(r, testRoute);
        testRoute = null;
        if (ui) {
          if (ui.asking) ask(null);
          if (wantedRun) {
            ui.panel.hidden = false;
            status(runHere()?.finished ? 'Got your test run. Press Decorate.' : "That run didn't reach the finish.");
          }
          refresh();
        }
        wantedRun = false;
      } catch (err) {
        console.warn('Auto deco:', err);
      }
      return out;
    };
    tools.open = function () {
      const out = o.apply(this, arguments);
      try {
        open();
      } catch (e) {
        console.warn('Auto deco:', e);
      }
      return out;
    };
    tools.close = function () {
      try {
        close();
      } catch {}
      return c.apply(this, arguments);
    };
  }
})();
