// Better Editor runtime: loaded by the page and by the physics worker, right after tm_parts.js.
// Holds the extended part table, the geometry file, the PolyTrackBE1 track code and the effect plates.
self.TM = (() => {
  const D = self.TM_DATA;
  const FIRST_ID = 1000;
  const byId = new Map(D.parts.map((p) => [p.i, p]));
  const proxyParts = D.proxies;
  // Test rigs only (tools/test/tmphys.mjs): a worker started as simulation_worker.bundle.js?tmtest=<json> can give parts
  // another surface ({u: {PartName: u}}), start its cars as another vehicle ({vehicle}) or drive them with a circling
  // bot ({bot}), try other surface settings ({surf}, below SURFACES) or post each car's tyres every {trace} frames. The game always starts its worker without a query, so none of this runs in play.
  const TEST = (() => {
    try {
      const m = /[?&]tmtest=([^&]*)/.exec(self.location.search);
      return m ? JSON.parse(decodeURIComponent(m[1])) : null;
    } catch (e) {
      return null;
    }
  })();
  if (TEST && TEST.u) for (const p of D.parts) if (p.n in TEST.u) p.u = TEST.u[p.n];

  // ---- part table --------------------------------------------------------------------------------------------
  const isTM = (id) => id >= FIRST_ID;
  const stockIds = new Map(); // stock part name -> id, read from the game's own enum before ours are added
  const addEnum = (e) => {
    for (const k in e) if (typeof e[k] == 'number') stockIds.set(k, e[k]);
    for (const p of D.parts) {
      e[p.n] = p.i;
      e[p.i] = p.n;
    }
  };

  // ---- geometry --------------------------------------------------------------------------------------------------
  let bin = null;
  // TM_BASE: where another site (Not So Weekly Shorts) loads this from; unset here.
  const binUrl = () => (self.TM_BASE || '') + 'models/tm_blocks.bin';
  const accept = (buffer) => {
    if (buffer.byteLength != D.binBytes) throw new Error('models/tm_blocks.bin does not match tm_parts.js');
    bin = buffer;
  };
  let loading = null;
  const load = () => {
    if (bin) return Promise.resolve();
    return (loading ??= fetch(binUrl())
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load ' + binUrl() + ': ' + r.status);
        return r.arrayBuffer();
      })
      .then(accept)
      .catch((e) => {
        loading = null;
        throw e;
      }));
  };
  // Workers have no await point before their first message, so they read the file synchronously when needed.
  const loadSync = () => {
    if (bin) return;
    const x = new XMLHttpRequest();
    x.open('GET', binUrl(), false);
    x.responseType = 'arraybuffer';
    x.send(null);
    accept(x.response);
  };
  const positions = (m) => new Float32Array(bin, m[1], m[2]);
  const indices = (m) => new Uint16Array(bin, m[3], m[4]);

  // Render geometry for one colour slot: non-indexed positions and a matching colour array.
  // `toRgb(hex)` must return linear [r,g,b] (the page passes THREE.Color so it matches stock vertex colours).
  // Water is drawn last, surface before sides, and `groups` ([first vertex, count, material 1]) marks it for the
  // see-through water material; it is null for parts without water.
  const WATER_ORDER = { Water: 1, WaterSide: 2 };
  function renderArrays(id, slotColors, toRgb) {
    const p = byId.get(id);
    let tris = 0;
    for (const m of p.m) tris += m[4];
    const pos = new Float32Array(tris * 3),
      col = new Float32Array(tris * 3),
      order = (m) => WATER_ORDER[D.materialNames[m[0]]] ?? 0,
      meshes = [...p.m].sort((a, b) => order(a) - order(b)),
      groups = [];
    let o = 0;
    for (const m of meshes) {
      if (order(m)) {
        const last = groups[groups.length - 1];
        if (last && last[3] == order(m)) last[1] += m[4];
        else groups.push([o / 3, m[4], 1, order(m)]);
      }
      const name = D.materialNames[m[0]],
        rgb = toRgb(slotColors[name] ?? D.materials[m[0]]),
        P = positions(m),
        I = indices(m);
      for (let i = 0; i < I.length; i++, o += 3) {
        const v = I[i] * 3;
        pos[o] = P[v];
        pos[o + 1] = P[v + 1];
        pos[o + 2] = P[v + 2];
        col[o] = rgb[0];
        col[o + 1] = rgb[1];
        col[o + 2] = rgb[2];
      }
    }
    if (!groups.length) return { pos, col, groups: null };
    groups.unshift([0, groups[0][0], 0]);
    return { pos, col, groups: groups.map((g) => g.slice(0, 3)) };
  }

  // ---- physics ---------------------------------------------------------------------------------------------------
  // The wasm reads part ids as one byte, so new blocks never reach it by id. Their triangles are transformed into
  // world space and appended to the terrain mesh it already takes; gates also send a proxy part for the trigger box.
  // Rotations are exact integer matrices, so the same track gives the same floats on every machine.
  const noPhysics = new Set(D.noPhysics ?? []);
  // Blocks carry a plain collision mesh (ph) next to their patterned render meshes.
  const physicsMeshes = (p) => (p.ph ? [p.ph] : p.m.filter((m) => !noPhysics.has(m[0])));
  function rotate(M, x, y, z) {
    return [M[0] * x + M[1] * y + M[2] * z, M[3] * x + M[4] * y + M[5] * z, M[6] * x + M[7] * y + M[8] * z];
  }

  function prepareCar(carId, mountain, off, track, rotatedTiles) {
    let extra = 0,
      records = 0;
    const zones = [],
      cells = new Map(),
      spawns = [],
      // Plastic collision triangles by 5-unit cell, world coordinates: the bounce reads its surface normal from these.
      walls = { tris: [], cells: new Map() },
      // Level faces of bobsleigh ice by 5-unit column, world coordinates: the tops of its walls (see iceTop).
      tops = { tris: [], cells: new Map() };
    track.forEachPart((x, y, z, id) => {
      if (!isTM(id)) {
        records++;
        return;
      }
      const p = byId.get(id);
      if (p.p != null) records++;
      for (const m of physicsMeshes(p)) extra += m[4] * 3;
    });
    fxBegin(carId, zones, cells, extra > 0, spawns, walls, tops);
    if (extra == 0) return { vertices: mountain, records };

    loadSync();
    const out = new Float32Array(mountain.length + extra);
    out.set(mountain, 0);
    let o = mountain.length;
    track.forEachPart((x, y, z, id, rot, axis) => {
      if (!isTM(id)) return;
      const p = byId.get(id),
        M = D.rotations[axis][rot],
        wx = x * 5,
        wy = y * 5,
        wz = z * 5;
      const bouncy = p.u != null && SURFACES[p.u].bounce;
      for (const m of physicsMeshes(p)) {
        const P = positions(m),
          I = indices(m);
        for (let i = 0; i < I.length; i++, o += 3) {
          const v = I[i] * 3,
            a = P[v],
            b = P[v + 1],
            c = P[v + 2];
          out[o] = M[0] * a + M[1] * b + M[2] * c + wx - off.x;
          out[o + 1] = M[3] * a + M[4] * b + M[5] * c + wy - off.y;
          out[o + 2] = M[6] * a + M[7] * b + M[8] * c + wz - off.z;
        }
      }
      // The bounce's walls: the part's own bounce list (no deco, poles or gate banners) when it has one.
      if (bouncy)
        for (const m of p.bw ? [p.bw] : physicsMeshes(p)) {
          const P = positions(m),
            I = indices(m);
          for (let t = 0; t < I.length; t += 3) {
            const k = walls.tris.length / 9,
              T = [];
            for (let j = 0; j < 3; j++) {
              const q = I[t + j] * 3;
              T.push(...rotate(M, P[q], P[q + 1], P[q + 2]));
              T[3 * j] += wx;
              T[3 * j + 1] += wy;
              T[3 * j + 2] += wz;
            }
            walls.tris.push(...T);
            const lo = [0, 1, 2].map((a) => Math.floor(Math.min(T[a], T[a + 3], T[a + 6]) / 5)),
              hi = [0, 1, 2].map((a) => Math.floor(Math.max(T[a], T[a + 3], T[a + 6]) / 5));
            for (let cx = lo[0]; cx <= hi[0]; cx++)
              for (let cy = lo[1]; cy <= hi[1]; cy++)
                for (let cz = lo[2]; cz <= hi[2]; cz++) {
                  const key = cellKey(cx, cy, cz),
                    l = walls.cells.get(key);
                  l ? l.push(k) : walls.cells.set(key, [k]);
                }
          }
        }
      if (p.u != null && SURFACES[p.u].ice && SURFACES[p.u].ice.follow)
        for (const m of physicsMeshes(p)) {
          const P = positions(m),
            I = indices(m);
          for (let t = 0; t < I.length; t += 3) {
            const T = [];
            for (let j = 0; j < 3; j++) {
              const q = I[t + j] * 3;
              T.push(...rotate(M, P[q], P[q + 1], P[q + 2]));
              T[3 * j] += wx;
              T[3 * j + 1] += wy;
              T[3 * j + 2] += wz;
            }
            // Faces within 46 degrees of level, either winding (a steep slope's wall tops too).
            const ex = T[3] - T[0],
              ey = T[4] - T[1],
              ez = T[5] - T[2],
              fx = T[6] - T[0],
              fy = T[7] - T[1],
              fz = T[8] - T[2],
              ny = ez * fx - ex * fz;
            if (Math.abs(ny) < 0.69 * Math.hypot(ey * fz - ez * fy, ny, ex * fy - ey * fx)) continue;
            const k = tops.tris.length / 9;
            tops.tris.push(...T);
            for (let cx = Math.floor(Math.min(T[0], T[3], T[6]) / 5); cx <= Math.floor(Math.max(T[0], T[3], T[6]) / 5); cx++)
              for (let cz = Math.floor(Math.min(T[2], T[5], T[8]) / 5); cz <= Math.floor(Math.max(T[2], T[5], T[8]) / 5); cz++) {
                const key = cellKey(cx, 0, cz),
                  l = tops.cells.get(key);
                l ? l.push(k) : tops.cells.set(key, [k]);
              }
          }
        }
      addCells(cells, p, x, y, z, M, rotatedTiles(id, rot, axis));
      if (p.sd && p.d) {
        // A gate whose road is not square to the grid: remember where it is and which way its road runs.
        const c = rotate(M, p.d.center[0], p.d.center[1], p.d.center[2]);
        spawns.push({ x: wx + c[0], y: wy + c[1], z: wz + c[2], dir: rotate(M, p.sd[0], p.sd[1], p.sd[2]) });
      }
      if (p.x) zones.push(zoneOf(p, wx, wy, wz, M));
    });
    return { vertices: out, records };
  }
  // The surface cells of one placed part (tile coordinates x, y, z; tiles: its rotated footprint).
  function addCells(cells, p, x, y, z, M, tiles) {
    if (p.u == null && !p.r) return;
    const entry = { u: p.u ?? null, r: p.r ? { x: x * 5, y: y * 5, z: z * 5, M, boxes: p.r } : null };
    tiles.forEach((tx, ty, tz) => {
      const k = cellKey(x + tx, y + ty, z + tz),
        l = cells.get(k);
      l ? l.push(entry) : cells.set(k, [entry]);
    });
  }
  // A placed part's effect box in world space. fwd, right and up are the part's own +z, +x and +y turned the way it
  // is placed (bumpers kick along right), centre the middle of the box.
  function zoneOf(p, wx, wy, wz, M) {
    const c = rotate(M, p.x.center[0], p.x.center[1], p.x.center[2]),
      s = rotate(M, p.x.size[0] / 2, p.x.size[1] / 2, p.x.size[2] / 2);
    return {
      type: p.x.type,
      min: [wx + c[0] - Math.abs(s[0]), wy + c[1] - Math.abs(s[1]), wz + c[2] - Math.abs(s[2])],
      max: [wx + c[0] + Math.abs(s[0]), wy + c[1] + Math.abs(s[1]), wz + c[2] + Math.abs(s[2])],
      surface: p.x.surface != null ? wy + rotate(M, 0, p.x.surface, 0)[1] : null, // water level
      centre: [wx + c[0], wy + c[1], wz + c[2]],
      fwd: rotate(M, 0, 0, 1),
      right: rotate(M, 1, 0, 0),
      up: rotate(M, 0, 1, 0),
    };
  }
  // Every effect box on a track, for the page (water splashes, vehicle gates, bumpers).
  function zones(track) {
    const out = [];
    track.forEachPart((x, y, z, id, rot, axis) => {
      const p = isTM(id) ? byId.get(id) : null;
      if (p?.x) out.push(zoneOf(p, x * 5, y * 5, z * 5, D.rotations[axis][rot]));
    });
    return out;
  }
  // A part's footprint turned the way it is placed, in tiles: the game's own TrackPart tiles.rotated, for the page,
  // which has no worker to ask (axis: 0 +y, 1 -y, 2 +x, 3 -x, 4 +z, 5 -z).
  function tilesOf(p, rot, axis) {
    const out = [];
    for (const [a, b] of p.c)
      for (let i = a[0]; i <= b[0]; i++)
        for (let j = a[1]; j <= b[1]; j++)
          for (let k = a[2]; k <= b[2]; k++) {
            let t = i,
              e = j,
              n = k;
            if (axis == 1 || axis == 3 || axis == 5) [t, n] = rot == 1 ? [-n - 1, t] : rot == 2 ? [-t - 1, -n - 1] : rot == 3 ? [n, -t - 1] : [t, n];
            else [t, n] = rot == 1 ? [n, -t - 1] : rot == 2 ? [-t - 1, -n - 1] : rot == 3 ? [-n - 1, t] : [t, n];
            if (axis == 1) [t, e] = [-t - 1, -e - 1];
            else if (axis == 2) [t, e] = [e, -t - 1];
            else if (axis == 3) [t, e] = [-e - 1, t];
            else if (axis == 4) [e, n] = [-n - 1, e];
            else if (axis == 5) [e, n] = [n, -e - 1];
            out.push([t, e, n]);
          }
    return { forEach: (f) => out.forEach((q) => f(q[0], q[1], q[2])) };
  }
  // For the page (tyre looks): the same surface cells the physics builds for a car, without loading any geometry.
  // surfaceAt(index, x, y, z) is the surface index (part.u) at that world point, or null for stock road; ask a little
  // way under a wheel's contact point (contact - 0.1 x normal), as the physics does.
  function surfaceIndex(track) {
    const cells = new Map();
    track.forEachPart((x, y, z, id, rot, axis) => {
      const p = isTM(id) ? byId.get(id) : null;
      if (p) addCells(cells, p, x, y, z, D.rotations[axis][rot], tilesOf(p, rot, axis));
    });
    return cells;
  }
  const surfaceAt = (index, x, y, z) => cellAt(index, x, y, z);
  // id written into the wasm's one-byte part record, or null when the part has no record there.
  const physicsId = (id) => (isTM(id) ? (byId.get(id).p ?? null) : id);

  function proxyConfigs() {
    // A tiny triangle far below the world: the wasm needs a shape, and only the trigger box matters.
    const shape = new Float32Array([0, -4000, 0, 0.01, -4000, 0, 0, -4000, 0.01]);
    return proxyParts.map((q) => ({ id: q.id, vertices: shape, detector: q.detector, startOffset: q.startOffset }));
  }

  // ---- surfaces and effect plates -----------------------------------------------------------------------------------
  // All of this runs per physics frame (1 ms) around updateCarModel, so ghosts and verification see the same thing.
  // Turbos push hardest the moment you cross them and fade to nothing. accel is the average over `frames`.
  const TURBO = { Turbo: { accel: 28, frames: 1000 }, Super: { accel: 42, frames: 1400 }, Ultra: { accel: 52, frames: 1800 } };
  // Reactor boosts, after TM2020's ReactorBoost(2)_Legacy and _Oriented: every wheel turns into a jet that thrusts only
  // while the gas is held (let go and it stops, so drivers feather the gas to hold a height), with the same push the whole
  // time, for `frames` from the plate whether it is used or not. A later reactor plate replaces it with a fresh timer.
  // frame 'world' (legacy up and down): along world up (dir 1) or world down (dir -1) whatever the car's angle; 'car'
  // (oriented): along the car's own up, so it follows walls and loops. thrust: units/s^2, as a multiple of the game's
  // gravity G (tools/test/tmphys.mjs reactor: in free fall the car gains 15.5 units/s^2 at 2 units/s, less the faster it
  // falls, as the game damps all velocity by about 0.17 per second: 16 at rest, not 9.81). level: 1 reactor, 2 super.
  // TM2020's numbers sit in encrypted packs; 1.3 g and 2.2 g are this project's estimates: a reactor climbs gently, a
  // super one clearly faster (the damping caps the climb near 28 and 110 units/s), and down boosts press the car
  // down, or drop it, as hard.
  const G = 16;
  const REACTOR = {
    ReactorUp: { level: 1, frame: 'world', dir: 1, thrust: 1.3 * G, frames: 6000 },
    ReactorDown: { level: 1, frame: 'world', dir: -1, thrust: 1.3 * G, frames: 6000 },
    Reactor2Up: { level: 2, frame: 'world', dir: 1, thrust: 2.2 * G, frames: 6000 },
    Reactor2Down: { level: 2, frame: 'world', dir: -1, thrust: 2.2 * G, frames: 6000 },
    ReactorOriented: { level: 1, frame: 'car', dir: 1, thrust: 1.3 * G, frames: 6000 },
    Reactor2Oriented: { level: 2, frame: 'car', dir: 1, thrust: 2.2 * G, frames: 6000 },
  };
  // ReactorAirControl: with all four wheels off the ground while a reactor is on, steering yaws the car about its own up
  // (towards yaw rad/s, pull: share of the gap per frame) and the car is held steady instead of tumbling: its pitch and
  // roll spin is pulled (calm per frame) towards level x its tilt (rad/s per rad, towards world-flat) on a legacy boost,
  // or towards none on an oriented one, which keeps its attitude. On the ground (TM2020's IsReactorGroundMode) the car
  // drives as always and only the thrust is added.
  const REACTOR_AIR = { yaw: 2, pull: 0.02, calm: 0.01, level: 3 };
  // Water, after Trackmania 2020. How deep the car is decides how much it counts (k, 0 to 1: deep water counts fully once
  // the car's underside is `depth` units under). Drag grows with speed, lin x v + quad x v^2 (units/s^2), so it bleeds
  // speed away without setting a top speed; the engine only pulls (1 - engine x k) as hard; lift holds the car up against
  // gravity and sink damps its vertical speed (per second), so it sinks slowly; right (rad/s^2) turns it back upright.
  // Shallow water sits over a floor the car drives on: only a little drag and a softer engine.
  // Bounce: the car skips off deep water like a stone when it hits the surface from above at minSpeed or more along the
  // water (units/s), falling no steeper than maxSlope (fall speed / speed along), upright at least `upright`. It comes back
  // up at rebound x its fall speed (at least minUp), keeps `keep` of its speed and has its pitch and roll spin x calm.
  // Steering never adds speed to a bounce. guard: frames before another bounce can start.
  // Wet tyres are in TYRES.
  const WATER = {
    deep: { lin: 0.02, quad: 0.0008, engine: 0.6, lift: 6.4, sink: 1.5, right: 4, depth: 1 },
    shallow: { lin: 0.01, quad: 0.0003, engine: 0.4, lift: 0, sink: 0, right: 0, depth: 0.5 },
    bounce: { minSpeed: 41.7, maxSlope: 0.35, upright: 0.7, rebound: 0.5, minUp: 5, keep: 0.985, calm: 0.5, guard: 80 },
    under: 0.45, // car origin to its underside
  };
  // The surfaces a tyre ices up on (and an iced tyre keeps its grip on), for pages made before TYRES.
  const ICING = { surfaces: [3, 4, 7] };

  // Tyres, after TM2020: every wheel carries how wet (its WetnessValue01, here per tyre), iced (Icing01) and muddy its
  // tyre is, 0 to 1, and the ground under it adds or takes each away, so one surface undoes another: dirt scrubs ice off
  // and soaks water up, water washes mud off and thaws ice, ice and snow freeze a wet tyre. TM2020's tunings sit in
  // encrypted packs: every rate and grip loss here is this project's estimate of how TM2020 plays (a water section soaks
  // the tyres, wet wood is its SlidingWood, nearly ice; ice and snow ice the tyres up), not a measurement.
  // table: a row per surface (part.u 0-8; road: the stock road and tech 8; water: a wheel under a water surface, whatever
  // floor it is on; air: off the ground). Rates per second:
  //   soak: wetness on; dry: wetness off; ice: icing on (only for a car whose tyres ice up there, VEHICLES ices);
  //   freeze: share of the wetness that freezes per second (it leaves the tyre, and iceGain x as much icing comes on for a
  //   car that ices up there); thaw: icing off; mud: mud on while under mudCap (dry dirt dusts the tyre, no more);
  //   wetMud: mud on per unit of wetness (a wet tyre on dirt picks up mud fast); wear: mud off.
  // A sliding tyre is hot (heat 0 to 1, see heatOf: wheelspin, a drift, locked brakes), so its drying, thawing and mud
  // wear go 1 + HEAT x heat times as fast: a burnout clears the tyres. Off the ground only a little dries and falls off.
  // shed: the cars built for loose ground (Rally, Desert) throw mud off a little faster.
  // Grip: a full state takes wetLoss, iceLoss, mudLoss of the grip on that row's surface, x (1 - loss x state). The three
  // multiply, but together never take more than the worst one alone leaves x KEEP, so stacking them cannot zero the
  // grip; only the states' own worst cases come near that (wet wood x0.08 of wood's grip, about platform ice's 0.14 of
  // stock). After TM2020's wet materials: wet tech (WetAsphalt) loses little, wet dirt is a mud road (WetDirtRoad,
  // slippery, wetRoll: a little more rolling drag, share of the speed per second), wet grass is slick (WetGrass), wet
  // wood is SlidingWood: besides its grip, `slides` makes it handle like that surface's ice (platform ice) while wet, each
  // wheel counting by its tyre's wetness (fxStep), so a wet car slides on wood as on ice. Iced tyres lose half their grip off ice and snow; muddy ones lose up to 30% on hard surfaces
  // (tech, plastic, wood) and nothing on dirt and grass, where the mud is the ground. Dry tyres change nothing.
  // The road, plastic, wood and penalty grass wet losses and the icing rates (0.8 on, 0.4 off on hard ground) are the
  // ones tracks were driven with when wetness was one value for the car.
  const TYRES = {
    table: {
      air: { dry: 0.03, thaw: 0.05, wear: 0.02 },
      water: { soak: 0.6, thaw: 1, wear: 1.5 },
      road: { dry: 0.1, thaw: 0.4, wear: 0.25, wetLoss: 0.15, iceLoss: 0.5, mudLoss: 0.3 },
      0: { dry: 0.1, thaw: 0.4, wear: 0.3, wetLoss: 0.3, iceLoss: 0.5, mudLoss: 0.3 }, // plastic
      1: { dry: 0.1, thaw: 0.4, wear: 0.25, wetLoss: 0.92, iceLoss: 0.5, mudLoss: 0.3, slides: 3 }, // wood
      2: { dry: 0.25, thaw: 0.8, wetMud: 0.1, wear: 0.1, wetLoss: 0.3, iceLoss: 0.5 }, // penalty grass
      3: { ice: 0.8, freeze: 1, wetLoss: 0.25 }, // platform ice: mud stays on
      4: { ice: 0.8, freeze: 1, wetLoss: 0.25 }, // bobsleigh
      5: { dry: 0.6, thaw: 2, mud: 0.08, mudCap: 0.25, wetMud: 1.5, wetLoss: 0.4, wetRoll: 0.05, iceLoss: 0.5 }, // dirt
      6: { dry: 0.3, thaw: 1, wetMud: 0.15, wear: 0.1, wetLoss: 0.4, iceLoss: 0.5 }, // grass
      7: { ice: 0.8, freeze: 0.6, wear: 0.15, wetLoss: 0.1 }, // snow
    },
    iceGain: 1.5,
    HEAT: 3,
    KEEP: 0.6,
    shed: { Rally: 1.5, Desert: 1.3 },
    // Wheel surface codes besides part.u: the stock road, and no ground.
    ROAD: -1,
    AIR: -2,
    fresh: () => ({ wet: 0, ice: 0, mud: 0 }),
    // How hot a tyre runs from the physics' skidInfo (1 while it grips, lower once its grip runs out: a drift, wheelspin,
    // locked brakes): none above 0.9, fully hot from 0.4.
    heatOf: (skid) => Math.max(0, Math.min(1, (0.9 - skid) / 0.5)),
    row(u) {
      return u == null || u == -1 || u == 8 ? this.table.road : u == -2 ? this.table.air : this.table[u] || this.table.road;
    },
    // One physics frame (dt seconds) of a tyre t ({wet, ice, mud}) on surface u (part.u, null or ROAD: stock road, AIR),
    // in water or not, at heat 0 to 1, on the named vehicle.
    step(t, u, inWater, heat, vehicle, dt) {
      const R = inWater ? this.table.water : this.row(u),
        V = VEHICLES[vehicle],
        ices = !!V && V.ices.includes(u),
        hot = 1 + this.HEAT * heat;
      let wet = t.wet,
        ice = t.ice,
        mud = t.mud;
      if (R.soak) wet = Math.min(1, wet + R.soak * dt);
      if (R.freeze && wet > 0) {
        const f = wet * R.freeze * dt;
        wet -= f;
        if (ices) ice = Math.min(1, ice + f * this.iceGain);
      }
      if (R.ice && ices) ice = Math.min(1, ice + R.ice * dt);
      if (R.dry && wet > 0) wet = Math.max(0, wet - R.dry * hot * dt);
      if (R.thaw && ice > 0) ice = Math.max(0, ice - R.thaw * hot * dt);
      if (R.mud && mud < R.mudCap) mud = Math.min(R.mudCap, mud + R.mud * dt);
      if (R.wetMud && wet > 0) mud = Math.min(1, mud + R.wetMud * wet * dt);
      if (R.wear && mud > 0) mud = Math.max(0, mud - R.wear * hot * (this.shed[vehicle] || 1) * dt);
      t.wet = wet;
      t.ice = ice;
      t.mud = mud;
    },
    // What the tyre's state does to its grip on surface u: 1 for a clean, dry tyre (and off the ground).
    factor(u, t) {
      if (t.wet == 0 && t.ice == 0 && t.mud == 0) return 1;
      const R = this.row(u),
        a = 1 - (R.wetLoss || 0) * t.wet,
        b = 1 - (R.iceLoss || 0) * t.ice,
        m = 1 - (R.mudLoss || 0) * t.mud;
      return Math.max(a * b * m, this.KEEP * Math.min(a, b, m));
    },
    // A wheel's grip as fxStep sets it, as a share of the Stadium car's on dry stock road: the surface (front or rear
    // tyres), wood's braking grip, the vehicle's multiplier, the tyre's state. Left out: the cap on extra grip under heavy
    // load, plastic countersteer and bugslides (they need the physics' own forces).
    grip(u, t, vehicle, braking, rear) {
      if (u == -2) return 0;
      const S = u == null || u < 0 ? null : SURFACES[u],
        V = VEHICLES[vehicle];
      let g = S ? (rear ? S.gripRear : S.gripFront) : 1;
      if (S && S.brakeGrip && braking) g = Math.min(g, S.brakeGrip);
      if (V) g *= (rear && V.rearGrip ? V.rearGrip : V.grip)[u == null || u < 0 || u == 8 ? 0 : u + 1];
      return g * this.factor(u, t);
    },
  };

  // What each new surface does to a wheel touching it. Index = part.u (null: stock road, TM2020's Tech).
  // The newer surfaces also use: engine, the share of what the engine gains along the nose each frame that the surface
  // takes back (the tyres cannot put it down); brake, the share of the braking it takes back; roll, rolling drag (share of
  // the speed lost per second); slide, the share of the speed lost per second per sin^2(slip) while sliding; settle, see
  // the slide settling in fxStep; align (rad/s), how fast a let-go drift's path swings back to the nose (fxStep); loose,
  // ground where steering into a slide catches it (see fxStep); studBrake, the share of the braking taken back from a car
  // whose tyres hold on ice (iceAssist < 1), where the others brake badly anyway.
  // All by the share of wheels on the surface.
  const SURFACES = [
    // Plastic: almost no grip, very strong acceleration at low speed, and it throws the car back when hit side-on or roof-first.
    { gripFront: 0.45, gripRear: 0.36, launch: 34, launchUntil: 45, bounce: true },
    // Wood: grips hard, like TM2020 dry wood: half as much again as before. The tyres' grip also limits braking, so while
    // the brake is down wood holds the car with brakeGrip instead, or it would stop dead.
    // Its extra push grows exponentially with speed (expo) up to `peak`, then fades to nothing by `end` (units per second),
    // so it pulls harder the faster you go without running away.
    // Like TM2020 wood it grips more the faster the car goes (turn). More tyre friction alone changes nothing here: the
    // game narrows the steering with speed (0.41 rad at full lock from rest, 0.04 at 200 km/h, 0.02 at 300), so the car
    // turns only as tightly as its front wheels point and its tyres never reach their limit on flat ground (tmphys.mjs:
    // wood at grip 1, 1.8 and 5 turns the same). So on wood the turn the steering asks for is made stronger: `turn` lists
    // [speed (units/s), extra share of that turn], in between straight lines, past the last one its value. Measured as
    // sideways pull at full lock against the stock car at the same speed (tmphys.mjs steer): x2.45 to x2.5 from 30 km/h
    // to 120, gliding to x2.4 at 160 and x2.35 from 200 to 480. The bump round 8 to 11 units/s is there because the same
    // share turns less at low speed (the tyres slide more). At speed the extra turn builds up while the steering is held
    // (TURN_BUILD), so a 250 ms tap at 300 km/h turns the car about 16 degrees (stock 9) and full lock still gets x2.35.
    // loadCap 2: the extra tyre grip holds up to twice the resting load (a hard corner, a compression), not a loop.
    { gripFront: 1.8, gripRear: 1.8, brakeGrip: 1.2, launch: 0, launchUntil: 0, bounce: false, expo: { push: 4, scale: 50, max: 24, peak: 83, end: 139 }, turn: [[3, 0], [6, 2.5], [8.2, 3.47], [10.7, 3.42], [14.1, 2.88], [18.4, 2.13], [24.3, 1.85], [32.9, 1.7], [44.3, 1.585], [57.3, 1.51], [73.6, 1.465], [91.8, 1.44], [114, 1.405], [127, 1.38]], turnLevel: [3, 8], loadCap: 2 },
    // Penalty grass: soft grip and heavy drag that bleeds speed away while the wheels are on it.
    { gripFront: 0.55, gripRear: 0.5, launch: 0, launchUntil: 0, bounce: false, drag: 1.1 },
    // Platform ice: the tyres barely hold, so the car slides; steering turns the car itself (ice.yaw, rad/s) and the
    // way it is going swings round to its nose at ice.align x sin(slip) rad/s, so a held turn settles into a steady
    // slide instead of spinning. Sliding costs ice.loss x sin^2(slip) of the speed per second. The tyres cannot put
    // the engine down either, so the launch push stands in for it up to launchUntil. stick (units/s^2) presses the
    // car onto bobsleigh ice, and near the top of a bobsleigh wall `follow` (per second) turns the car's climb up the wall
    // into speed along the channel, so the walls carry the car round a curve instead of throwing it over the top. It
    // starts where the wall's normal has `from` upward (0.5: a 60 degree wall) and grows with the square of the way
    // from there to straight up, so the car rides freely up the lower and middle wall and is held at the lip. Measured
    // from the top of the wall (ICE_TOP) it never starts more than about 2 units under it, so the upright upper wall of
    // the high-wall pieces can be ridden too.
    { gripFront: 0.16, gripRear: 0.11, launch: 16, launchUntil: 75, bounce: false, studBrake: 0.25, ice: { yaw: 1.3, pull: 0.005, spin: 0.0015, align: 2.2, loss: 0.25, stick: 0, follow: 0 } },
    // Bobsleigh ice: as slippery to brake and accelerate on, but the car turns less and follows the channel more.
    { gripFront: 0.22, gripRear: 0.17, launch: 16, launchUntil: 75, bounce: false, studBrake: 0.25, ice: { yaw: 1.0, pull: 0.004, spin: 0.002, align: 3, loss: 0.2, stick: 14, follow: 300, from: 0.5 } },
    // The four below are this project's estimates of TM2020's surfaces relative to its Tech road (= PolyTrack's stock road);
    // TM2020's own tunings sit in encrypted packs and were not read. Targets: grip as the share of stock cornering
    // grip, times as multiples of the stock car's 0-100 / 0-200 / 120-0 braking distance (tools/test/tmphys.mjs).
    // Dirt (TM DirtRoad): about 0.65 of the grip (cornering speed on a circle x0.8), the rear lets go first so it drifts,
    // but the drift settles when you let go of the steering; slower to accelerate (measured x1.17 to 100, x1.31 to 200)
    // and to brake (x1.6 the distance); rolling drag costs about 8% of the speed a second and slides scrub speed.
    { gripFront: 0.7, gripRear: 0.6, launch: 0, launchUntil: 0, bounce: false, engine: 0.08, brake: 0.22, roll: 0.08, slide: 0.5, settle: 0.004, align: 3, loose: true },
    // Grass (TM's drivable grass, not the penalty verges): about half the grip (x0.7 cornering speed), x1.4 to 100, about
    // x2 to 200 and x2 the braking distance; heavy drag (20% a second) that holds it well under the road's top end.
    { gripFront: 0.55, gripRear: 0.48, launch: 0, launchUntil: 0, bounce: false, engine: 0, brake: 0.28, roll: 0.2, slide: 0.6, settle: 0.004, align: 3, loose: true },
    // Snow: about 0.4 of the grip (x0.6 cornering speed), x1.3 to 100 (a small launch push makes up for tyres that
    // spin from rest), x2.5 the braking distance, little drag: between dirt and platform ice.
    { gripFront: 0.43, gripRear: 0.38, launch: 3, launchUntil: 50, bounce: false, engine: 0, brake: 0.18, roll: 0.005, slide: 0.2, settle: 0.003, align: 2, loose: true },
    // Tech: the stock road itself, for blocks that need their own entry (its wet grip, the vehicles' tables).
    { gripFront: 1, gripRear: 1, launch: 0, launchUntil: 0, bounce: false },
  ];
  // Test rigs only: {surf: {u: {setting: value}}} tries other settings for a surface.
  if (TEST && TEST.surf) for (const k in TEST.surf) Object.assign(SURFACES[k], TEST.surf[k]);
  // TM2020's cars. The Stadium car is PolyTrack's own; the others change how it drives, after TM2020's Snow, Rally and
  // Desert cars. Every number here is this project's estimate of how TM2020's cars relate to the Stadium car (their
  // tunings are in encrypted packs that were not read).
  // grip: multiplies the tyres' grip by surface, in the order stock road, plastic, wood, penalty grass, platform ice,
  //   bobsleigh, dirt, grass, snow (tech road counts as stock road).
  // iceAssist: how much of the ice's steering and slide help the car still gets (the Snow car's tyres hold on ice).
  // accel: multiplies what the engine gains per frame, [up to units/s, factor] in order; topSpeed (units/s) and topDrag:
  //   above it a drag of topDrag x (speed over)^2 units/s^2 holds the car near its top end.
  // susp: stiff multiplies the springs, damp both dampers, roll the body roll, rest is added to the spring's rest length
  //   (units; the car rides that much higher). See suspension() for how the springs are softened. dampIn, where given,
  //   multiplies the compression damper instead of damp: the stock one (200) is many times critical, so x0.6 changed
  //   nothing measurable (tmphys.mjs susp: no sink on landing, the same ride over ripples). Rally x0.3: soaks up a
  //   little. Desert, TM2020's bouncy car: the rebound damper does the bouncing (x0.02: the spring throws the body back
  //   up past its ride height; at x0.6 no car ever bounced), the compression one (x0.1) and a stiffer, longer spring than
  //   before (x0.6, +0.1) keep it off the bump stops: it bounces once on a 30 unit drop and keeps its speed (226 km/h
  //   1 s after, Stadium 227; softer compression dampers bottomed out and lost up to 30%), and soaks up dirt ripples
  //   (106 km/h out where the Stadium car leaves at 85).
  // air: in the air, steering yaws the car and the brake lifts its nose, this much harder than nothing (1: no help).
  // ices: the surfaces its tyres ice up on (see ICING); in TM2020 the Stadium car's tyres ice up too (the Snow car's
  //   studs never do). loose: on dirt, grass and snow the engine pulls with this factor instead of accel, and the top end
  //   drag does not count there (the Rally car is geared for loose ground).
  // look: hints for the page's car (tint: colour of the parts it adds).
  const VEHICLES = {
    Stadium: { grip: [1, 1, 1, 1, 1, 1, 1, 1, 1], iceAssist: 1, accel: null, topSpeed: 0, topDrag: 0, susp: null, air: 1, ices: [3, 4, 7], look: { tint: null } },
    // Snow: x3.5 on ice still slid like plastic and spun when let go (tmphys.mjs), so its studded tyres hold more,
    // the rear most (rearGrip: the rear tyres' own multipliers where given).
    Snow: { grip: [0.85, 0.85, 0.95, 1, 4.5, 3.5, 1.1, 1.1, 2.4], rearGrip: [0.85, 0.85, 0.95, 1, 5.5, 4.2, 1.1, 1.1, 2.4], iceAssist: 0.3, accel: [[1e9, 0.9]], topSpeed: 230 / 3.6, topDrag: 0.012, susp: { stiff: 0.7, damp: 1, roll: 1, rest: 0.08 }, air: 1.2, ices: [], look: { tint: '#e9eef4' } },
    Rally: { grip: [0.9, 0.9, 1, 1, 1.3, 1.2, 1.45, 1.45, 1.2], iceAssist: 1, accel: [[150 / 3.6, 0.95], [1e9, 0.85]], loose: 1.05, topSpeed: 260 / 3.6, topDrag: 0.012, susp: { stiff: 0.6, damp: 0.8, dampIn: 0.3, roll: 1.5, rest: 0.03 }, air: 1, ices: [3, 4, 7], look: { tint: '#c94a2a' } },
    Desert: { grip: [0.72, 0.75, 0.85, 1, 1, 1, 1.25, 1.25, 1], iceAssist: 1, accel: [[1e9, 1.05]], topSpeed: 330 / 3.6, topDrag: 0.012, susp: { stiff: 0.6, damp: 0.02, dampIn: 0.1, roll: 1.2, rest: 0.1 }, air: 1.8, ices: [3, 4, 7], look: { tint: '#d6a24a' } },
  };
  // Test rigs only: {veh: {name: {setting: value}}} tries other settings for a vehicle.
  if (TEST && TEST.veh) for (const k in TEST.veh) Object.assign(VEHICLES[k], TEST.veh[k]);
  const GATES = { CarSnow: 'Snow', CarRally: 'Rally', CarDesert: 'Desert', CarStadium: 'Stadium' };
  // Air control for the cars that have it (air > 1): after `after` frames off the ground, steering pulls the yaw rate
  // towards yaw x steer and the brake the pitch rate towards -pitch (nose up, rad/s), by pull x (air - 1) per frame.
  const AIR = { after: 20, yaw: 1.2, pitch: 1.5, pull: 0.01 };
  // Bumpers (TM2020's Bumper and Super bumper): one sideways kick per entry, square to the way the car is going in the
  // plate's plane, away from the line through the plate's centre along that way (inside `centre` units of it: to the
  // right), plus a hop (units/s). Platforms are driven every way, so the plate's own axes would brake a car crossing a
  // turned one.
  const BUMPER = { Bumper: { side: 14, up: 2.5 }, Bumper2: { side: 24, up: 4 }, centre: 0.25 };
  // A collision is added up over the frames it lasts (hit: per-frame velocity change that counts as contact,
  // window: longest collision in frames), then judged as a whole.
  // The bounce mirrors the car's velocity off the surface: the part along it is kept, the part into it comes back at
  // restitution x the speed it hit with, plus pop. Each bounce that follows another before the car is back on its wheels
  // (or within `chain` frames) has that rebound scaled by fade again, so a crash settles instead of hopping forever.
  // While the hit lasts the car's spin is held down (grip), and after the bounce it is zeroed and kept damped for
  // `steady` frames (calm per frame), so the car flies off flat the same way every time instead of tumbling.
  const BOUNCE = { hit: 0.5, window: 30, minInto: 4, share: 0.45, restitution: 1, pop: 3, cooldown: 150, grip: 0.6, steady: 250, calm: 0.97, chain: 8000, fade: 0.55 };

  // Countersteering on plastic, once the car slides more than `from` (radians) above minSpeed (units per second):
  // frontGrip multiplies the front tyres' grip, and the yaw rate is pulled by `pull` per frame towards catchRate x slip,
  // eased off to at most maxRate (rad/s). Both build up over rampIn frames of countersteer and fade over `hold` frames
  // after it, so catching a big slide swings the car round over about half a second instead of snapping it.
  const SLIDE = { minSpeed: 8, from: 0.1, frontGrip: 2.4, catchRate: 3, maxRate: 2.2, pull: 0.012, rampIn: 180, hold: 300 };
  // The extra turn of a surface's `turn` builds up while the steering is held one way: in full after `frames` frames
  // (eased in), and it drops `fade` times as fast when the steering is let go or turned the other way. Only above `from`
  // (units per second), in full from `full` up, so a tap or a flick at speed does not snap the car round while slow tight
  // turns bite at once. Off the steering (once it has faded) the wheels' own turn, as in a loop, gets all of it.
  const TURN_BUILD = { frames: 250, fade: 3, from: 25, full: 55 };
  if (TEST && TEST.turnBuild) Object.assign(TURN_BUILD, TEST.turnBuild);
  // Bugslides: start above minSpeed (units per second) and minSlip (radians) on a landing after `air` frames off the
  // ground or when two wheels' contact normals differ by more than acos(kink); last up to `frames`; tyres at grip;
  // speed kept at keep per frame (about 2% a second lost); over below endSlip.
  const BUG = { minSpeed: 100 / 3.6, minSlip: 0.17, endSlip: 0.05, frames: 1200, air: 120, window: 150, kink: 0.99, grip: 0.55, keep: 0.99998 };
  // Where the top of a bobsleigh wall is looked for: reach units straight out behind the wheel's contact (inside the
  // wall, under its top face; the wall tops are 2.2 wide), from below units under the contact up, on faces leaning
  // less than lean (sine) towards or away from the channel. The wall holds the car (follow) fully from hold under that
  // top and not at all from hold + band under it: on the plain channel always at least as much as its steepness asks
  // (from 2 units under the lip, where the wall passes 60 degrees), so there it changes nothing.
  const ICE_TOP = { reach: 1, below: 0.3, lean: 0.3, hold: 0.25, band: 2 };

  // Tile coordinates fit well inside these ranges, and the key stays an exact double.
  const cellKey = (x, y, z) => (x + 50000) * 1e10 + (y + 5000) * 1e5 + (z + 50000);
  // Surface under a point: regions inside a part win (each box [lo, hi, u]; a box without u is penalty grass), then the
  // part's own surface.
  const cellAt = (cells, x, y, z) => {
    const l = cells.get(cellKey(Math.floor(x / 5), Math.floor(y / 5), Math.floor(z / 5)));
    if (!l) return null;
    for (const e of l) {
      if (!e.r) continue;
      const { M } = e.r,
        dx = x - e.r.x,
        dy = y - e.r.y,
        dz = z - e.r.z,
        // the inverse of an orthonormal integer rotation is its transpose
        lx = M[0] * dx + M[3] * dy + M[6] * dz,
        ly = M[1] * dx + M[4] * dy + M[7] * dz,
        lz = M[2] * dx + M[5] * dy + M[8] * dz;
      for (const [a, b, u] of e.r.boxes) if (lx >= a[0] && lx <= b[0] && ly >= a[1] && ly <= b[1] && lz >= a[2] && lz <= b[2]) return u ?? 2;
    }
    for (const e of l) if (e.u != null) return e.u;
    return null;
  };

  // Closest point to p on triangle abc, written into out.
  function closestOnTri(px, py, pz, T, i, out) {
    const ax = T[i], ay = T[i + 1], az = T[i + 2],
      abx = T[i + 3] - ax, aby = T[i + 4] - ay, abz = T[i + 5] - az,
      acx = T[i + 6] - ax, acy = T[i + 7] - ay, acz = T[i + 8] - az,
      apx = px - ax, apy = py - ay, apz = pz - az,
      d1 = abx * apx + aby * apy + abz * apz,
      d2 = acx * apx + acy * apy + acz * apz;
    const set = (u, v) => {
      out[0] = ax + abx * u + acx * v;
      out[1] = ay + aby * u + acy * v;
      out[2] = az + abz * u + acz * v;
    };
    if (d1 <= 0 && d2 <= 0) return set(0, 0);
    const bpx = px - T[i + 3], bpy = py - T[i + 4], bpz = pz - T[i + 5],
      d3 = abx * bpx + aby * bpy + abz * bpz,
      d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) return set(1, 0);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) return set(d1 / (d1 - d3), 0);
    const cpx = px - T[i + 6], cpy = py - T[i + 7], cpz = pz - T[i + 8],
      d5 = abx * cpx + aby * cpy + abz * cpz,
      d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) return set(0, 1);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) return set(0, d2 / (d2 - d6));
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      return set(1 - w, w);
    }
    const den = 1 / (va + vb + vc);
    return set(vb * den, vc * den);
  }
  // The plastic surface a hit came from: the nearest plastic triangle within reach of the car's centre whose face
  // points the way the car was pushed (dx,dy,dz, unit). Returns its normal, facing the car, or null.
  const nearPt = [0, 0, 0];
  function plasticNormal(walls, x, y, z, dx, dy, dz) {
    const T = walls.tris,
      cx = Math.floor(x / 5),
      cy = Math.floor(y / 5),
      cz = Math.floor(z / 5);
    let best = null,
      bestD = 3.5 * 3.5;
    const seen = new Set();
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++) {
          const l = walls.cells.get(cellKey(cx + i, cy + j, cz + k));
          if (!l) continue;
          for (const t of l) {
            if (seen.has(t)) continue;
            seen.add(t);
            const b = t * 9;
            closestOnTri(x, y, z, T, b, nearPt);
            const ex = x - nearPt[0],
              ey = y - nearPt[1],
              ez = z - nearPt[2],
              d = ex * ex + ey * ey + ez * ez;
            if (d >= bestD) continue;
            let nx = (T[b + 4] - T[b + 1]) * (T[b + 8] - T[b + 2]) - (T[b + 5] - T[b + 2]) * (T[b + 7] - T[b + 1]),
              ny = (T[b + 5] - T[b + 2]) * (T[b + 6] - T[b]) - (T[b + 3] - T[b]) * (T[b + 8] - T[b + 2]),
              nz = (T[b + 3] - T[b]) * (T[b + 7] - T[b + 1]) - (T[b + 4] - T[b + 1]) * (T[b + 6] - T[b]);
            const nl = Math.hypot(nx, ny, nz);
            if (nl < 1e-9) continue;
            ((nx /= nl), (ny /= nl), (nz /= nl));
            if (nx * ex + ny * ey + nz * ez < 0) ((nx = -nx), (ny = -ny), (nz = -nz));
            // A surface that pushed the car must face roughly the way it was pushed; the scrape's friction skews that.
            if (nx * dx + ny * dy + nz * dz < 0.3) continue;
            best = [nx, ny, nz];
            bestD = d;
          }
        }
    return best;
  }
  // The top of the bobsleigh ice above a point inside its wall: the lowest face over (x, z) at or above y that does not
  // lean towards or away from the channel (ox, oz: unit, out of the channel; the wall's own faces do), or null.
  function iceTop(tops, x, y, z, ox, oz) {
    const T = tops.tris,
      l = tops.cells.get(cellKey(Math.floor(x / 5), 0, Math.floor(z / 5)));
    let best = null;
    if (l)
      for (const t of l) {
        const b = t * 9,
          ax = T[b + 3] - T[b],
          az = T[b + 5] - T[b + 2],
          bx = T[b + 6] - T[b],
          bz = T[b + 8] - T[b + 2],
          px = x - T[b],
          pz = z - T[b + 2],
          det = ax * bz - az * bx;
        if (Math.abs(det) < 1e-9) continue;
        const u = (px * bz - pz * bx) / det,
          w = (ax * pz - az * px) / det;
        if (u < 0 || w < 0 || u + w > 1) continue;
        const h = T[b + 1] + u * (T[b + 4] - T[b + 1]) + w * (T[b + 7] - T[b + 1]);
        if (h < y || (best != null && h >= best)) continue;
        const ay = T[b + 4] - T[b + 1],
          by = T[b + 7] - T[b + 1],
          nx = ay * bz - az * by,
          nz = ax * by - ay * bx;
        if (Math.abs(nx * ox + nz * oz) > ICE_TOP.lean * Math.hypot(nx, det, nz)) continue;
        best = h;
      }
    return best;
  }

  const cars = new Map();
  function fxBegin(carId, zones, cells, active, spawns = [], walls = { tris: [], cells: new Map() }, tops = { tris: [], cells: new Map() }) {
    // vehicle: the car it is now; cpVehicle: the car it was when it crossed its last checkpoint (a respawn goes back
    // to that); tyres: each wheel's tyre state (TYRES); susp0: the stock suspension, read on the first frame.
    const start = (TEST && TEST.vehicle) || 'Stadium';
    cars.set(carId, { zones, cells, active, spawns, walls, tops, lastCp: 0, hit: null, reactor: null, reactorLeft: 0, slow: false, slowTick: 0, lastState: null, ctl: null, tyres: [0, 1, 2, 3].map(TYRES.fresh), waterGuard: 0, overWater: false, boost: null, boostLeft: 0, noEngine: false, noBrake: false, noSteer: false, cruise: false, fragile: false, inside: new Set(), speed: 0, pulseReset: false, stockGrip: null, gas: false, justReset: false, last: null, bounceWait: 0, steady: 0, chainLeft: 0, chainLevel: 1, air: 0, landing: 0, bug: 0, bugV: 0, catchRamp: 0, turnRamp: 0, turnSide: 0, vehicle: start, cpVehicle: start, susp0: null, suspSet: false });
  }
  // Every effect on the car ends (effect blocks). On a Reset block, a checkpoint and a respawn.
  // The vehicle stays (TM2020 keeps the car through effect resets), and so do wet and iced tyres: they are the tyres' own
  // state, not effects, and dry or thaw on the road. Only a respawn (or the respawn key) gives clean tyres, see fxStep.
  const clear = (c) => {
    c.boostLeft = 0;
    c.boost = null;
    c.reactorLeft = 0;
    c.reactor = null;
    c.slow = false;
    c.noEngine = c.noBrake = c.noSteer = c.cruise = c.fragile = false;
  };
  // Filters the controls going into the car. Always returns a fresh object; stock tracks pass straight through.
  function fxControls(carId, r) {
    const c = cars.get(carId);
    if (TEST && TEST.bot && c) r = testBot(c, r);
    if (!c || !c.active) return r;
    const out = { up: r.up, right: r.right, down: r.down, left: r.left, reset: r.reset };
    if (c.pulseReset) {
      out.reset = true;
      c.pulseReset = false;
    }
    if (out.reset) {
      // The car it was at the checkpoint comes back in fxStep (justReset), however near the checkpoint it already was.
      clear(c);
      c.bug = c.catchRamp = c.turnRamp = 0;
      c.justReset = true;
    }
    // Test rigs only: holds the gas while a reactor is on and the car is under hover.y (by its height lead seconds on).
    if (TEST && TEST.hover && c.reactorLeft > 0 && c.last) out.up = c.last.y + c.last.vy * TEST.hover.lead < TEST.hover.y;
    if (c.noEngine) out.up = false;
    if (c.noBrake) out.down = false;
    if (c.noSteer) out.left = out.right = false;
    if (c.cruise) {
      out.up = true;
      out.down = false;
    }
    c.gas = out.up && !out.down;
    c.ctl = out;
    return out;
  }
  // Test rigs only: holds a car on a circle of radius r round (x, z). It steers the car's path towards the circle's
  // tangent bent in or out by how far off the line it is (full bend at `band` units), catches slides of more than
  // `catch` radians by steering out, and lifts off the gas while more than `slack` units outside the line (or above vmax).
  function testBot(c, r) {
    const B = TEST.bot,
      out = { up: true, right: false, down: false, left: false, reset: false };
    if (!c.botAt || !c.botPrev) return out;
    const [x, z, nx, nz] = c.botAt,
      vx = (x - c.botPrev[0]) * 1000,
      vz = (z - c.botPrev[1]) * 1000,
      ex = x - B.x,
      ez = z - B.z,
      d = Math.hypot(ex, ez) || 1,
      ix = -ex / d,
      iz = -ez / d;
    // tangent along the way the car goes; a > 0 bends the wanted path inwards
    let tx = -iz,
      tz = ix;
    if (tx * vx + tz * vz < 0) ((tx = -tx), (tz = -tz));
    const a = Math.max(-1, Math.min(1, (d - B.r) / B.band)) * 0.6,
      wx = tx * Math.cos(a) + ix * Math.sin(a),
      wz = tz * Math.cos(a) + iz * Math.sin(a),
      sp = Math.hypot(vx, vz) || 1,
      // + when the wanted path / the nose is to the left of the way the car is going (yaw + turns left)
      want = (vz * wx - vx * wz) / sp,
      nose = (vz * nx - vx * nz) / sp / (Math.hypot(nx, nz) || 1);
    let steer = Math.abs(want) > 0.01 ? Math.sign(want) : 0;
    if (Math.abs(nose) > Math.sin(B.catch) && Math.sign(nose) == steer) steer = -steer;
    if (steer > 0) out.left = true;
    if (steer < 0) out.right = true;
    // vmax (units/s): a speed cap, so a skid-pad run can hold a set speed to find where the tyres let go
    out.up = d < B.r + B.slack && !(B.vmax && sp > B.vmax);
    return out;
  }
  // Finds the C++ Car object in the wasm's unordered_map<int, Car*> (bucket array at 18848, bucket count at 18852).
  function carPointer(U, id) {
    const count = U[18852 >> 2];
    if (count == 0) return 0;
    const pow2 = (count & (count - 1)) == 0,
      bucketOf = (h) => (pow2 ? h & (count - 1) : h % count),
      bucket = bucketOf(id >>> 0),
      before = U[(U[18848 >> 2] >> 2) + bucket];
    for (let node = before ? U[before >> 2] : 0; node; node = U[node >> 2]) {
      if (U[(node >> 2) + 2] == id >>> 0) return U[(node >> 2) + 3];
      if (bucketOf(U[(node >> 2) + 1]) != bucket) return 0;
    }
    return 0;
  }
  // The vehicle's suspension, written just before the physics step (fxSkip runs right before updateCarModel).
  // Checked headless (tools/test/tmphys.mjs probe): the wheels' rest length (+204), damping (+220, +224) and roll
  // influence (+244) are read by the step and keep what is written; the spring stiffness (+216) is set again by the
  // game before every step, so a softer spring is made from the rest length instead: with the wheel compressed to
  // length L, a rest length of R - (1 - stiff) x (R - L) gives exactly stiff x the spring force. Travel is left alone:
  // the stock car's is 10 units, which never limits it. Stock values are read on the car's first frame and written
  // back when it turns into the Stadium car again.
  function suspension(c, heap, carId) {
    const V = VEHICLES[c.vehicle];
    if (!V.susp && !c.suspSet) return;
    const U = new Uint32Array(heap.buffer),
      F = new Float32Array(heap.buffer),
      car = carPointer(U, carId);
    if (!car) return;
    const wheels = U[(U[(car + 32) >> 2] + 144) >> 2];
    if (!c.susp0) {
      c.susp0 = [];
      for (let w = 0; w < 4; w++) {
        const g = (wheels + w * 284) >> 2;
        c.susp0.push([F[g + 51], F[g + 55], F[g + 56], F[g + 61]]);
      }
    }
    for (let w = 0; w < 4; w++) {
      const a = wheels + w * 284,
        g = a >> 2,
        s0 = c.susp0[w];
      if (!V.susp) {
        F[g + 51] = s0[0];
        F[g + 55] = s0[1];
        F[g + 56] = s0[2];
        F[g + 61] = s0[3];
        continue;
      }
      const S = V.susp,
        rest = s0[0] + S.rest;
      F[g + 51] = heap[a + 84] && F[g + 8] < rest ? rest - (1 - S.stiff) * (rest - F[g + 8]) : rest;
      F[g + 55] = s0[1] * (S.dampIn ?? S.damp);
      F[g + 56] = s0[2] * S.damp;
      F[g + 61] = s0[3] * S.roll;
    }
    c.suspSet = !!V.susp;
  }
  // A car's effect, tyre and vehicle state, for code that rewinds the wasm heap (Not So Weekly Shorts' Cuppa bots save
  // and restore the heap only): fxSave copies it, fxLoad puts a copy back. The track's tables are shared, not copied.
  function fxSave(carId) {
    const c = cars.get(carId);
    if (!c) return null;
    const { zones, cells, spawns, walls, tops, ...own } = c;
    return structuredClone(own);
  }
  function fxLoad(carId, saved) {
    const c = cars.get(carId);
    if (c && saved) Object.assign(c, structuredClone(saved));
  }
  // Slow motion: the car only gets every other physics frame while the race clock keeps counting, so it moves at half speed.
  // Returns the held state for a skipped frame, or null to run the frame normally.
  function fxSkip(carId, heap) {
    const c = cars.get(carId);
    if (c && c.active) suspension(c, heap, carId);
    if (!c || !c.slow || !c.lastState) return null;
    c.slowTick ^= 1;
    if (!c.slowTick) return null;
    const I = new Int32Array(heap.buffer),
      car = carPointer(new Uint32Array(heap.buffer), carId);
    if (!car) return null;
    const frames = ++I[(car + 172) >> 2],
      out = c.lastState.slice(0),
      b = new Uint8Array(out);
    b[4] = frames & 255;
    b[5] = (frames >> 8) & 255;
    b[6] = (frames >> 16) & 255;
    // The returned buffer is transferred to the page and detaches, so keep a copy for the next held frame.
    c.lastState = out.slice(0);
    return out;
  }

  // Rotates the velocity at F[v] by -turn about the axis u (the car's up), towards the nose when turn has the slip's sign
  // (slip > 0: moving to the left of the nose).
  function turnVelocity(F, v, ux, uy, uz, turn) {
    const c0 = Math.cos(-turn),
      s0 = Math.sin(-turn),
      x = F[v],
      y = F[v + 1],
      z = F[v + 2],
      k = ux * x + uy * y + uz * z,
      cx = uy * z - uz * y,
      cy = uz * x - ux * z,
      cz = ux * y - uy * x;
    F[v] = x * c0 + cx * s0 + ux * k * (1 - c0);
    F[v + 1] = y * c0 + cy * s0 + uy * k * (1 - c0);
    F[v + 2] = z * c0 + cz * s0 + uz * k * (1 - c0);
  }

  // Turns the whole car by a (radians, + = left) about its up axis u through its centre of mass: heading, velocity and
  // spin together, so the tyres see no new slip and push back nothing (no roll, no wobble). Bullet keeps the body's
  // orientation twice, as the basis of its world transform (+4) and of its interpolated one (+68), rows 16 bytes apart.
  function turnCar(F, body, v, av, ux, uy, uz, a) {
    turnVelocity(F, v, ux, uy, uz, -a);
    turnVelocity(F, av, ux, uy, uz, -a);
    const c0 = Math.cos(a),
      s0 = Math.sin(a);
    for (const b of [(body + 4) >> 2, (body + 68) >> 2])
      for (let j = 0; j < 3; j++) {
        // column j of the basis: the car's own axis j in the world
        const x = F[b + j],
          y = F[b + 4 + j],
          z = F[b + 8 + j],
          k = ux * x + uy * y + uz * z;
        F[b + j] = x * c0 + (uy * z - uz * y) * s0 + ux * k * (1 - c0);
        F[b + 4 + j] = y * c0 + (uz * x - ux * z) * s0 + uy * k * (1 - c0);
        F[b + 8 + j] = z * c0 + (ux * y - uy * x) * s0 + uz * k * (1 - c0);
      }
  }

  function fxStep(carId, heap, stateBuffer) {
    const c = cars.get(carId);
    if (TEST && TEST.bot && c) {
      const S = new DataView(stateBuffer),
        p = 12 + (S.getUint8(11) & 2 ? 3 : 0) + 2;
      c.botPrev = c.botAt;
      const qx = S.getFloat32(p + 12, true),
        qy = S.getFloat32(p + 16, true),
        qz = S.getFloat32(p + 20, true),
        qw = S.getFloat32(p + 24, true);
      c.botAt = [S.getFloat32(p, true), S.getFloat32(p + 8, true), 2 * (qx * qz + qw * qy), 1 - 2 * (qx * qx + qy * qy)];
    }
    if (!c || !c.active) return;
    // Car state layout: id u32, frames u24, speed f32, flags u8, [finish u24], next checkpoint u16, position, quaternion.
    const s = new DataView(stateBuffer),
      speed = s.getFloat32(7, true),
      flags = s.getUint8(11),
      pos = 12 + (flags & 2 ? 3 : 0) + 2,
      x = s.getFloat32(pos, true),
      y = s.getFloat32(pos + 4, true),
      z = s.getFloat32(pos + 8, true);
    if (flags & 2) return; // finished
    c.lastState = c.slow ? stateBuffer.slice(0) : null;
    let water = null; // the water the car is in or just above

    // A respawn moves the car further in one frame than it can drive. It comes back as the car it was at the checkpoint,
    // with clean tyres. The respawn key counts too, even when the car was already near the checkpoint (with no
    // checkpoint passed yet it does nothing).
    if ((c.last && Math.abs(x - c.last.x) + Math.abs(y - c.last.y) + Math.abs(z - c.last.z) > 5) || (c.justReset && c.lastCp > 0)) {
      clear(c);
      c.vehicle = c.cpVehicle;
      for (const t of c.tyres) t.wet = t.ice = t.mud = 0;
    }
    const cp = s.getUint16(pos - 2, true);
    if (cp > c.lastCp) {
      clear(c);
      c.cpVehicle = c.vehicle;
    }

    // Passing a diagonal checkpoint: the physics just saved a respawn point facing along the grid. Turn it to face
    // along the diagonal road, the way the car was going, and move it to just behind the gate on that line.
    if (cp > c.lastCp && c.spawns.length) {
      let best = null,
        bestD = 625;
      for (const g of c.spawns) {
        const d = (g.x - x) ** 2 + (g.z - z) ** 2;
        if (d < bestD && Math.abs(g.y - y) < 8) {
          best = g;
          bestD = d;
        }
      }
      const U = new Uint32Array(heap.buffer),
        car = best ? carPointer(U, carId) : 0,
        rec = car ? U[(car + 180) >> 2] : 0;
      if (rec) {
        const F = new Float32Array(heap.buffer),
          body = U[(car + 36) >> 2],
          v = (body + 312) >> 2,
          ahead = F[v] * best.dir[0] + F[v + 2] * best.dir[2] >= 0 ? 1 : -1,
          dx = best.dir[0] * ahead,
          dz = best.dir[2] * ahead,
          yaw = Math.atan2(dx, dz),
          r = rec >> 2;
        // Record layout: position xyz, padding, quaternion xyzw, checkpoint count.
        F[r] = best.x - dx * 1.35;
        F[r + 2] = best.z - dz * 1.35;
        F[r + 4] = 0;
        F[r + 5] = Math.sin(yaw / 2);
        F[r + 6] = 0;
        F[r + 7] = Math.cos(yaw / 2);
      }
    }
    c.lastCp = cp;

    const inside = c.inside;
    let kick = null; // a bumper's kick, applied below once the car's velocity is at hand
    for (let i = 0; i < c.zones.length; i++) {
      const q = c.zones[i],
        hit = x >= q.min[0] && x <= q.max[0] && y >= q.min[1] && y <= q.max[1] && z >= q.min[2] && z <= q.max[2];
      if ((q.type == 'Water' || q.type == 'Shallow') && x >= q.min[0] && x <= q.max[0] && z >= q.min[2] && z <= q.max[2] && y >= q.min[1] - 1 && y <= q.surface + 3) water = q;
      if (!hit) {
        inside.delete(i);
        continue;
      }
      if (inside.has(i)) continue;
      inside.add(i);
      switch (q.type) {
        case 'Turbo':
        case 'Super':
        case 'Ultra':
          c.boost = TURBO[q.type];
          c.boostLeft = c.boost.frames;
          break;
        case 'Roulette': {
          // The roulette lands on one of three turbos depending on the exact frame you cross it.
          const f = s.getUint8(4) | (s.getUint8(5) << 8) | (s.getUint8(6) << 16);
          c.boost = TURBO[['Turbo', 'Super', 'Ultra'][f % 3]];
          c.boostLeft = c.boost.frames;
          break;
        }
        case 'ReactorUp':
        case 'ReactorDown':
        case 'Reactor2Up':
        case 'Reactor2Down':
        case 'ReactorOriented':
        case 'Reactor2Oriented':
          c.reactor = REACTOR[q.type];
          c.reactorLeft = c.reactor.frames;
          break;
        case 'Slow':
          c.slow = true;
          break;
        case 'Reset':
          clear(c);
          break;
        case 'NoEngine':
          c.noEngine = true;
          break;
        case 'NoBrake':
          c.noBrake = true;
          break;
        case 'NoSteer':
          c.noSteer = true;
          break;
        case 'Cruise':
          c.cruise = true;
          break;
        case 'Fragile':
          c.fragile = true;
          break;
        case 'Bumper':
        case 'Bumper2':
          kick = q;
          break;
        case 'CarSnow':
        case 'CarRally':
        case 'CarDesert':
        case 'CarStadium':
          // A new car has new tyres: nothing on them carries over (CarStadium gives back exactly the stock car).
          if (c.vehicle != GATES[q.type]) for (const t of c.tyres) t.wet = t.ice = t.mud = 0;
          c.vehicle = GATES[q.type];
          break;
      }
    }
    if (c.fragile && c.speed - speed > 12) c.pulseReset = true; // a hard hit sends you back to the last checkpoint
    c.speed = speed;

    const U = new Uint32Array(heap.buffer),
      F = new Float32Array(heap.buffer),
      car = carPointer(U, carId);
    if (!car) return;
    const body = U[(car + 36) >> 2],
      v = (body + 312) >> 2,
      // Car axes from the quaternion. +z of the car frame is its nose.
      qx = s.getFloat32(pos + 12, true),
      qy = s.getFloat32(pos + 16, true),
      qz = s.getFloat32(pos + 20, true),
      qw = s.getFloat32(pos + 24, true),
      fx = 2 * (qx * qz + qw * qy),
      fy = 2 * (qy * qz - qw * qx),
      fz = 1 - 2 * (qx * qx + qy * qy);

    // Slides. The car's +x axis is its left and +y its up; lat is the sideways speed, + when the car moves to the left of
    // where its nose points, and slip the angle between the nose and the way the car is going. Yaw + turns left.
    const av = (body + 328) >> 2,
      lx = 1 - 2 * (qy * qy + qz * qz),
      ly = 2 * (qx * qy + qw * qz),
      lz = 2 * (qx * qz - qw * qy),
      upx = 2 * (qx * qy - qw * qz),
      upy = 1 - 2 * (qx * qx + qz * qz),
      upz = 2 * (qy * qz + qw * qx),
      lat = F[v] * lx + F[v + 1] * ly + F[v + 2] * lz,
      fwd = F[v] * fx + F[v + 1] * fy + F[v + 2] * fz,
      slip = Math.atan2(lat, Math.abs(fwd)),
      steer = c.ctl ? (c.ctl.left ? 1 : 0) - (c.ctl.right ? 1 : 0) : 0,
      // Countersteering: steering towards the side the car is sliding to.
      counter = Math.hypot(lat, fwd) > SLIDE.minSpeed && steer != 0 && Math.sign(steer) == Math.sign(lat) && Math.abs(slip) > SLIDE.from;
    // How far into the catch the car is, 0 to 1 (see SLIDE).
    c.catchRamp = counter ? Math.min(1, c.catchRamp + 1 / SLIDE.rampIn) : Math.max(0, c.catchRamp - 1 / SLIDE.hold);
    const ease = c.catchRamp * c.catchRamp * (3 - 2 * c.catchRamp);
    // How far the extra turn has built up (TURN_BUILD), 0 to 1, and the way the steering is held.
    if (steer != 0 && steer == c.turnSide) c.turnRamp = Math.min(1, c.turnRamp + 1 / TURN_BUILD.frames);
    else if (c.turnRamp > 0) c.turnRamp = Math.max(0, c.turnRamp - TURN_BUILD.fade / TURN_BUILD.frames);
    else c.turnSide = steer;

    // A bumper kicks the car sideways, once, as it enters (see BUMPER). R: the car's right in the plate's plane
    // (velocity x plate up).
    if (kick) {
      const K = BUMPER[kick.type],
        P = kick.up;
      let R = [F[v + 1] * P[2] - F[v + 2] * P[1], F[v + 2] * P[0] - F[v] * P[2], F[v] * P[1] - F[v + 1] * P[0]];
      const n = Math.hypot(R[0], R[1], R[2]);
      R = n > 1e-6 ? R.map((q) => q / n) : kick.right;
      const off = (x - kick.centre[0]) * R[0] + (y - kick.centre[1]) * R[1] + (z - kick.centre[2]) * R[2],
        side = Math.abs(off) > BUMPER.centre ? Math.sign(off) : 1;
      for (let i = 0; i < 3; i++) F[v + i] += R[i] * side * K.side + P[i] * K.up;
    }

    // Tyres: each wheel gets the grip of the surface under it for the next frame.
    // Wheels are btWheelInfo structs: normal at +0, contact point at +16, in contact at +84, wheel centre at +140,
    // radius at +212, friction slip at +228.
    const wheels = U[(U[(car + 32) >> 2] + 144) >> 2],
      V = VEHICLES[c.vehicle],
      normals = [],
      // the contact points of the same wheels
      points = [],
      // Wheels on each surface (by part.u), so pushes and drag count each surface by its own share of the wheels.
      on = [0, 0, 0, 0, 0, 0, 0, 0, 0],
      // and what their tyres' states leave of their grip, added up (TYRES.factor), for the grip that grows with speed
      tyreOn = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    let plasticWheels = 0,
      wetRoll = 0, // the wet tyres' extra rolling drag (TYRES wetRoll), share of the speed per second, all wheels added up
      slideWheels = 0, // wheels on wet wood, each by its wetness (TYRES slides), and the ice they handle like
      slideIce = null;
    if (c.stockGrip == null) c.stockGrip = F[(wheels + 228) >> 2];
    // The old surfaces' pushes and drag (launch, expo, penalty grass, ice) keep their own rule, exactly as before the newer
    // surfaces: the wheels on such surfaces count, the last of them sets the numbers.
    let launchWheels = 0,
      launch = 0,
      launchUntil = 0,
      dragWheels = 0,
      drag = 0,
      expoWheels = 0,
      expo = null,
      iceWheels = 0,
      ice = null,
      looseWheels = 0,
      contacts = 0;
    for (let w = 0; w < 4; w++) {
      const a = wheels + w * 284,
        g = a >> 2,
        // the tyre's state, and how hot it runs from its skidInfo (+280)
        t = c.tyres[w],
        heat = TYRES.heatOf(F[g + 70]);
      if (TEST && TEST.trace) (c.probe ??= { u: [], grip: [] }), (c.probe.u[w] = TYRES.AIR), (c.probe.grip[w] = 0);
      if (!heap[a + 84]) {
        // Off the ground the tyre is in the water while the car's underside is.
        TYRES.step(t, TYRES.AIR, water != null && y - WATER.under < water.surface, heat, c.vehicle, 0.001);
        continue;
      }
      contacts++;
      // A little way under the contact point is inside the deck, whichever way the deck faces.
      const f = cellAt(c.cells, F[g + 4] - F[g] * 0.1, F[g + 5] - F[g + 1] * 0.1, F[g + 6] - F[g + 2] * 0.1),
        surface = f == null ? null : SURFACES[f];
      if (f != null) on[f]++;
      let grip = surface ? (w < 2 ? surface.gripFront : surface.gripRear) : 1; // wheels 0 and 1 steer
      if (surface && surface.brakeGrip && c.ctl && c.ctl.down) grip = Math.min(grip, surface.brakeGrip);
      const vg = (w >= 2 && V.rearGrip ? V.rearGrip : V.grip)[f == null || f == 8 ? 0 : f + 1];
      if (vg != 1) grip *= vg;
      if (grip > 1) {
        // Extra grip is a fixed amount, sized at the wheel's resting load: it does not grow with load.
        // In a loop the tyres carry many times their resting load, and grip that scaled with it would spin
        // the car round at the first steering input. Suspension force is at +276. A surface's loadCap sizes it at that
        // many resting loads instead, so the outer tyres of a hard corner keep it all while a loop still caps it.
        const load = F[g + 69],
          rest = ((9.81 / F[(body + 344) >> 2]) / 4) * ((surface && surface.loadCap) || 1);
        if (load > rest) grip = 1 + ((grip - 1) * rest) / load;
      }
      if (surface && surface.bounce) {
        plasticWheels++;
        if (w < 2) grip *= 1 + (SLIDE.frontGrip - 1) * ease;
      }
      if (surface && surface.loose) looseWheels++;
      if (c.bug > 0) grip *= BUG.grip;
      // Wet, iced and muddy tyres (TYRES): from the state they came in with, so it counts from the next frame.
      const tk = TYRES.factor(f, t);
      if (tk != 1) grip *= tk;
      if (f != null) tyreOn[f] += tk;
      if (t.wet > 0 && TYRES.row(f).wetRoll) wetRoll += TYRES.row(f).wetRoll * t.wet;
      if (t.wet > 0 && TYRES.row(f).slides != null) (slideWheels += t.wet), (slideIce = SURFACES[TYRES.row(f).slides].ice);
      normals.push(F[g], F[g + 1], F[g + 2]);
      points.push(F[g + 4], F[g + 5], F[g + 6]);
      F[g + 57] = c.stockGrip * grip;
      if (TEST && TEST.trace) (c.probe.u[w] = f ?? TYRES.ROAD), (c.probe.grip[w] = +grip.toFixed(3));
      // On the ground the tyre is in the water when its contact is under the surface (shallow water's floor).
      TYRES.step(t, f, water != null && F[g + 5] < water.surface, heat, c.vehicle, 0.001);
      if (surface && surface.drag) {
        dragWheels++;
        drag = surface.drag;
      }
      if (surface && surface.expo) {
        expoWheels++;
        expo = surface.expo;
      }
      if (surface && surface.ice) {
        iceWheels++;
        ice = surface.ice;
      }
      // On ice and snow the launch push stands in for tyres that cannot grip, so a car whose tyres do (iceAssist < 1:
      // the Snow car's studs) does without it; with it the Snow car pulled away faster on snow than on the road.
      if (surface && surface.launch > 0 && !(V.iceAssist != 1 && (surface.ice || f == 7))) {
        launchWheels++;
        launch = surface.launch;
        launchUntil = surface.launchUntil;
      }
    }

    // Countersteering on plastic: the front tyres bite harder and the car's spin is pulled towards the way it is going,
    // so a slide can be caught instead of spinning out.
    // The pull fades over `hold` frames past the countersteer, so catching a slide does not whip the car round the other way.
    if (ease > 0 && plasticWheels >= 2) {
      const yaw = F[av] * upx + F[av + 1] * upy + F[av + 2] * upz,
        d = (SLIDE.maxRate * Math.tanh((SLIDE.catchRate * slip) / SLIDE.maxRate) - yaw) * SLIDE.pull * ease;
      F[av] += upx * d;
      F[av + 1] += upy * d;
      F[av + 2] += upz * d;
    }

    // Bugslides: landing, or crossing a sharp change of slope, while already sliding fast locks the car into a slide
    // that keeps its speed (gravity still counts) and turns less, until the slide straightens, the car leaves the
    // ground, or the gas is let go or the brake pressed.
    let kink = false;
    for (let i = 0; i < normals.length; i += 3)
      for (let j = i + 3; j < normals.length; j += 3)
        if (normals[i] * normals[j] + normals[i + 1] * normals[j + 1] + normals[i + 2] * normals[j + 2] < BUG.kink) kink = true;
    // A sliding car lands one or two wheels first, so the first touch after real airtime opens a short landing window.
    if (contacts >= 1 && c.air >= BUG.air) c.landing = BUG.window;
    else if (c.landing > 0) c.landing--;
    const spd = Math.hypot(F[v], F[v + 1], F[v + 2]);
    c.air = contacts == 0 ? c.air + 1 : 0;
    if (c.bug == 0 && c.gas && (contacts >= 2 && c.landing > 0 || contacts >= 3 && kink) && Math.abs(slip) >= BUG.minSlip && spd >= BUG.minSpeed) {
      c.bug = BUG.frames;
      c.bugV = spd;
      c.landing = 0;
    }
    if (c.bug > 0) {
      c.bug--;
      if (!c.gas || Math.abs(slip) < BUG.endSlip || c.air > BUG.air) c.bug = 0;
      else {
        c.bugV = Math.max(spd, c.bugV * BUG.keep - 0.00981 * (F[v + 1] / spd));
        if (spd < c.bugV) {
          const k = c.bugV / spd;
          F[v] *= k;
          F[v + 1] *= k;
          F[v + 2] *= k;
        }
      }
    }

    // Ice: the tyres alone can hardly turn the car, so steering turns it directly, and the slide straightens out slowly
    // by swinging the velocity round to the nose without losing its length.
    // Wet wood joins in (TYRES slides) when the car is not on ice already: its wheels count by their wetness, and the
    // steering help comes in with them (iceWeight: full from two soaked wheels on), so drying tyres ease out of it.
    let iceWeight = 1;
    if (iceWheels < 2 && slideWheels > 0) {
      iceWeight = Math.min(1, slideWheels / 2);
      iceWheels += slideWheels;
      if (!ice) ice = slideIce;
    }
    if (iceWheels >= 2 || iceWeight < 1) {
      // A car whose tyres hold on ice (the Snow car) gets only iceAssist of the steering and slide help; the spin still
      // dies away off the steering.
      const yaw = F[av] * upx + F[av + 1] * upy + F[av + 2] * upz,
        help = V.iceAssist,
        d0 = steer != 0 ? (steer * ice.yaw * Math.min(1, spd / 15) - yaw) * ice.pull : -yaw * ice.spin,
        d = (help != 1 && steer != 0 ? d0 * help : d0) * iceWeight;
      F[av] += upx * d;
      F[av + 1] += upy * d;
      F[av + 2] += upz * d;
      const sn = Math.sin(Math.abs(slip)),
        turn = Math.sign(slip) * Math.min(Math.abs(slip), (help != 1 ? help : 1) * ice.align * sn * 0.001 * (iceWheels / 4));
      if (spd > 1 && turn != 0 && Math.abs(slip) < 1.4) {
        turnVelocity(F, v, upx, upy, upz, turn);
        const keep = 1 - ice.loss * sn * sn * 0.001 * (iceWheels / 4);
        F[v] *= keep;
        F[v + 1] *= keep;
        F[v + 2] *= keep;
      }
      if (ice.stick) {
        // Into the ice along the wheels' contact normals.
        let nx = 0,
          ny = 0,
          nz = 0;
        for (let i = 0; i < normals.length; i += 3) {
          nx += normals[i];
          ny += normals[i + 1];
          nz += normals[i + 2];
        }
        const nl = Math.hypot(nx, ny, nz),
          k = (ice.stick * 0.001) / (nl || 1);
        F[v] -= nx * k;
        F[v + 1] -= ny * k;
        F[v + 2] -= nz * k;
        // Uphill along the wall: world up with the wall's normal taken out. Only on walls steeper than `from`.
        const ax = nx / (nl || 1),
          ay = ny / (nl || 1),
          az = nz / (nl || 1);
        if (ice.follow && nl > 0 && ay < ice.from) {
          let wx = -ax * ay,
            wy = 1 - ay * ay,
            wz = -az * ay;
          const wl = Math.hypot(wx, wy, wz);
          wx /= wl;
          wy /= wl;
          wz /= wl;
          const up = F[v] * wx + F[v + 1] * wy + F[v + 2] * wz;
          if (up > 0) {
            // How near the top: by how steep the wall is, but no nearer than the highest wheel's height under the top
            // of the ice above it says (ICE_TOP). On the plain channel that never holds the car sooner than the
            // steepness does; a high wall stands straight up for 5 units over the lip, and by steepness alone it
            // would hold the car from its foot, so its upper part could never be reached.
            let near = 1 - ay / ice.from;
            let h = 0;
            for (let i = 3; i < points.length; i += 3) if (points[i + 1] > points[h + 1]) h = i;
            const ox = -normals[h],
              oz = -normals[h + 2],
              ol = Math.hypot(ox, oz);
            // A little way into the wall, behind the contact, the top is the first level face above.
            const top = ol > 0.05 ? iceTop(c.tops, points[h] + (ox / ol) * ICE_TOP.reach, points[h + 1] - ICE_TOP.below, points[h + 2] + (oz / ol) * ICE_TOP.reach, ox / ol, oz / ol) : null;
            if (top != null) near = Math.min(near, 1 - (top - points[h + 1] - ICE_TOP.hold) / ICE_TOP.band);
            const before = Math.hypot(F[v], F[v + 1], F[v + 2]),
              d = near > 0 ? up * Math.min(1, ice.follow * 0.001 * near * near) : 0;
            F[v] -= wx * d;
            F[v + 1] -= wy * d;
            F[v + 2] -= wz * d;
            const after = Math.hypot(F[v], F[v + 1], F[v + 2]);
            if (after > 1e-6) {
              const k2 = before / after;
              F[v] *= k2;
              F[v + 1] *= k2;
              F[v + 2] *= k2;
            }
          }
        }
      }
    }

    // Plastic launch: strongest from a standstill, gone by launchUntil (units per second). Measured on the real speed:
    // the game's own speed turns negative once a slide passes 90 degrees, which would switch the push on full.
    if (c.gas && launchWheels > 0) {
      const now = spd,
        fade = 1 - now / launchUntil;
      if (fade > 0) {
        const dv = launch * fade * (launchWheels / 4) * 0.001;
        F[v] += fx * dv;
        F[v + 1] += fy * dv;
        F[v + 2] += fz * dv;
      }
    }

    // Wood: extra push that grows exponentially with speed while the gas is down.
    if (c.gas && expoWheels > 0) {
      const now = Math.abs(speed) / 3.6,
        fade = Math.min(1, Math.max(0, (expo.end - now) / (expo.end - expo.peak))),
        a = Math.min(expo.max, expo.push * (Math.exp(now / expo.scale) - 1)) * fade * (expoWheels / 4) * 0.001;
      F[v] += fx * a;
      F[v + 1] += fy * a;
      F[v + 2] += fz * a;
    }

    // Grip that grows with speed (SURFACES turn): the turn the front wheels ask for, forward speed x tan(steering) /
    // wheelbase, is made stronger by turning the whole car further. Only while the tyres hold (nothing left in a slide of
    // 20 degrees), less on wet, iced or muddy tyres (what their states leave of the grip there, over the wheels on the
    // surface), times the vehicle's own grip there, by the share of wheels on the surface.
    // The car turns about the ground under it (the wheels' mean contact normal), and only while it sits square on that
    // ground (turnLevel: in full within the first angle, in degrees, none past the second): with a wheel up on a kerb the
    // body is tipped against the deck, and turning about its own up would tip its speed up into the air.
    let gx = 0,
      gy = 0,
      gz = 0;
    for (let i = 0; i < normals.length; i += 3) {
      gx += normals[i];
      gy += normals[i + 1];
      gz += normals[i + 2];
    }
    const gl = Math.hypot(gx, gy, gz),
      square = gl > 0 ? (upx * gx + upy * gy + upz * gz) / gl : 0;
    for (let u = 0; u < on.length; u++) {
      const T = SURFACES[u].turn,
        Lv = SURFACES[u].turnLevel || [3, 8];
      if (!on[u] || !T || c.bug > 0) continue;
      const lo = Math.cos((Lv[1] * Math.PI) / 180),
        hi = Math.cos((Lv[0] * Math.PI) / 180),
        level = Math.max(0, Math.min(1, (square - lo) / (hi - lo)));
      if (level == 0) continue;
      const r = c.turnRamp,
        atSpeed = steer != 0 || r > 0 ? Math.max(0, Math.min(1, (spd - TURN_BUILD.from) / (TURN_BUILD.full - TURN_BUILD.from))) : 0,
        build = 1 - atSpeed * (1 - r * r * (3 - 2 * r));
      let k = T[T.length - 1][1];
      for (let i = 1; i < T.length; i++)
        if (spd < T[i][0]) {
          k = T[i - 1][1] + ((T[i][1] - T[i - 1][1]) * Math.max(0, spd - T[i - 1][0])) / (T[i][0] - T[i - 1][0]);
          break;
        }
      // steering at +232 (wheels 0 and 1, 284 bytes apart); the wheels' places in the car at +156, z (+164) along the nose
      const angle = (F[(wheels + 232) >> 2] + F[(wheels + 284 + 232) >> 2]) / 2,
        base = F[(wheels + 164) >> 2] - F[(wheels + 2 * 284 + 164) >> 2],
        hold = Math.max(0, 1 - Math.abs(slip) / 0.35),
        tyres = tyreOn[u] / on[u],
        a = ((fwd * Math.tan(angle)) / base) * k * build * hold * level * tyres * V.grip[u + 1] * (on[u] / 4) * 0.001;
      if (a != 0 && base > 0.5) turnCar(F, body, v, av, gx / gl, gy / gl, gz / gl, a);
    }

    // Penalty grass: the share of wheels on it, squared, so one or two wheels only drag a little and all four drag fully
    // (per second: 1 wheel about 7%, 2 about 24%, 3 about 46%, 4 about 67% of the speed).
    if (dragWheels > 0) {
      const k = 1 - drag * 0.001 * (dragWheels / 4) ** 2;
      F[v] *= k;
      F[v + 1] *= k;
      F[v + 2] *= k;
    }

    // The newer surfaces' rolling drag, and the speed a slide scrubs off (sin^2 of the slip: nothing driving straight),
    // each by its own share of the wheels.
    for (let u = 0; u < on.length; u++) {
      const n = on[u],
        S = SURFACES[u];
      if (!n || !(S.roll || S.slide)) continue;
      const sn = Math.sin(Math.min(Math.abs(slip), Math.PI / 2)),
        k = 1 - ((S.roll || 0) + (S.slide || 0) * sn * sn) * (n / 4) * 0.001;
      F[v] *= k;
      F[v + 1] *= k;
      F[v + 2] *= k;
    }
    // Wet tyres on dirt drive a mud road: a little more rolling drag (TYRES wetRoll), by the share of wheels.
    if (wetRoll > 0) {
      const k = 1 - (wetRoll / 4) * 0.001;
      F[v] *= k;
      F[v + 1] *= k;
      F[v + 2] *= k;
    }

    // Loose ground (dirt, grass, snow) lets the rear go. Steering into the slide catches it as on plastic: the yaw rate is
    // pulled towards catchRate x slip (SLIDE; without plastic's extra front grip). Off the steering, and while catching,
    // the spin also dies away (settle: share of the yaw rate lost per frame, by the share of wheels), so a drift
    // straightens out when you let go or countersteer instead of spinning the car round.
    if (ease > 0 && looseWheels >= 2) {
      const yaw = F[av] * upx + F[av + 1] * upy + F[av + 2] * upz,
        d = (SLIDE.maxRate * Math.tanh((SLIDE.catchRate * slip) / SLIDE.maxRate) - yaw) * SLIDE.pull * ease * (looseWheels / 4);
      F[av] += upx * d;
      F[av + 1] += upy * d;
      F[av + 2] += upz * d;
    }
    let settle = 0,
      align = 0;
    for (let u = 0; u < on.length; u++)
      if (on[u]) {
        settle += ((SURFACES[u].settle || 0) * on[u]) / 4;
        align += ((SURFACES[u].align || 0) * on[u]) / 4;
      }
    if (settle && (steer == 0 || counter)) {
      const yaw = F[av] * upx + F[av + 1] * upy + F[av + 2] * upz;
      F[av] -= upx * yaw * settle;
      F[av + 1] -= upy * yaw * settle;
      F[av + 2] -= upz * yaw * settle;
    }
    // The same times: the way the car goes swings round to its nose at align x sin(slip) rad/s (by the share of wheels),
    // keeping its length, as on ice. Without it the tyres scrubbed the slide off as speed: let go of a 54 degree drift on
    // dirt at 91 km/h and the car came out of it at 19 (tmphys.mjs feel); with align 3 at 65 (countersteering: 72).
    if (align && (steer == 0 || counter) && spd > 1 && Math.abs(slip) < 1.4) {
      const turn = Math.sign(slip) * Math.min(Math.abs(slip), align * Math.sin(Math.abs(slip)) * 0.001);
      if (turn != 0) turnVelocity(F, v, upx, upy, upz, turn);
    }

    // What the engine and the brakes do this frame, as the change of speed along the nose since the last frame: the
    // surfaces' engine and brake shares and the vehicle's accel take part of it back (or add to it). A car whose tyres
    // grip a surface better (its grip multiplier there) loses that much less of it, and on loose ground a vehicle with
    // `loose` pulls with that factor instead of its accel (the Rally car is built for dirt and grass).
    if (c.last && contacts > 0) {
      const gain = fwd - (c.last.vx * fx + c.last.vy * fy + c.last.vz * fz);
      let cut = 0;
      if (c.gas && gain > 0 && gain < 0.05) {
        let keep = 1;
        for (let u = 0; u < on.length; u++) if (on[u] && SURFACES[u].engine) keep -= (SURFACES[u].engine * on[u]) / 4 / V.grip[u + 1];
        if (V.accel)
          for (const [until, k] of V.accel)
            if (spd < until) {
              keep *= V.loose && looseWheels ? k + ((V.loose - k) * looseWheels) / contacts : k;
              break;
            }
        if (keep != 1) cut = gain * (1 - keep);
      } else if (c.ctl && c.ctl.down && fwd > 0 && gain < 0 && gain > -0.2) {
        let back = 0;
        for (let u = 0; u < on.length; u++) {
          if (!on[u]) continue;
          const S = SURFACES[u];
          if (S.brake) back += (S.brake * on[u]) / 4 / V.grip[u + 1];
          if (S.studBrake && V.iceAssist != 1) back += (S.studBrake * on[u]) / 4;
        }
        if (back) cut = gain * back;
      }
      if (cut) {
        F[v] -= fx * cut;
        F[v + 1] -= fy * cut;
        F[v + 2] -= fz * cut;
      }
    }

    // The vehicle's top end: a drag that grows with the square of the speed over topSpeed (for a car with `loose`, only by
    // the share of its wheels on firm ground).
    const firm = V.loose && contacts ? 1 - looseWheels / contacts : 1;
    if (V.topSpeed && spd > V.topSpeed && firm > 0) {
      const k = 1 - Math.min(spd, V.topDrag * firm * (spd - V.topSpeed) ** 2 * 0.001) / spd;
      F[v] *= k;
      F[v + 1] *= k;
      F[v + 2] *= k;
    }
    // The vehicle's air control (see AIR): not while a reactor boost steers the car in the air itself.
    if (V.air > 1 && contacts == 0 && c.air > AIR.after && c.reactorLeft == 0 && c.ctl) {
      const pull = AIR.pull * (V.air - 1),
        yaw = F[av] * upx + F[av + 1] * upy + F[av + 2] * upz,
        dy = (steer * AIR.yaw - yaw) * pull;
      F[av] += upx * dy;
      F[av + 1] += upy * dy;
      F[av + 2] += upz * dy;
      // Spin about the car's left axis: + dips the nose. The brake lifts it; the gas does nothing here, since drivers
      // hold it through every jump (measured: a gas-dips-the-nose rule tipped the Desert car 57 degrees in 0.8 s).
      const pitchWant = c.ctl.down ? -1 : 0;
      if (pitchWant != 0) {
        const pitch = F[av] * lx + F[av + 1] * ly + F[av + 2] * lz,
          dp = (pitchWant * AIR.pitch - pitch) * pull;
        F[av] += lx * dp;
        F[av + 1] += ly * dp;
        F[av + 2] += lz * dp;
      }
    }

    // Water (see WATER).
    const W = water ? (water.type == 'Water' ? WATER.deep : WATER.shallow) : null,
      under = y - WATER.under,
      k = W ? Math.min(1, Math.max(0, (water.surface - under) / W.depth)) : 0;
    if (c.waterGuard > 0) c.waterGuard--;
    if (water && water.type == 'Water') {
      const B = WATER.bounce,
        along = Math.hypot(F[v], F[v + 2]),
        fall = -F[v + 1];
      // Skipping off the surface: only on the way down, from above it, fast, flat and upright.
      if (c.overWater && under <= water.surface && fall > 0 && c.waterGuard == 0 && along >= B.minSpeed && fall <= B.maxSlope * along && upy >= B.upright) {
        F[v + 1] = Math.max(B.rebound * fall, B.minUp);
        F[v] *= B.keep;
        F[v + 2] *= B.keep;
        // Keep the spin about the car's up axis (its heading), calm pitch and roll.
        const yaw = F[av] * upx + F[av + 1] * upy + F[av + 2] * upz;
        for (let a = 0; a < 3; a++) F[av + a] = (F[av + a] - [upx, upy, upz][a] * yaw) * B.calm + [upx, upy, upz][a] * yaw;
        c.waterGuard = B.guard;
      }
      c.overWater = under > water.surface;
    } else c.overWater = true;
    if (k > 0) {
      // Drag along the way the car is going, growing with speed.
      const sp = Math.hypot(F[v], F[v + 1], F[v + 2]);
      if (sp > 0.01) {
        const d = Math.min(sp, k * (W.lin * sp + W.quad * sp * sp) * 0.001) / sp;
        F[v] -= F[v] * d;
        F[v + 1] -= F[v + 1] * d;
        F[v + 2] -= F[v + 2] * d;
      }
      // A softer engine: take back part of what the car gained along its nose this frame while on the gas.
      if (c.gas && c.last && contacts > 0) {
        const gain = fwd - (c.last.vx * fx + c.last.vy * fy + c.last.vz * fz);
        if (gain > 0 && gain < 0.05) {
          const cut = gain * W.engine * k;
          F[v] -= fx * cut;
          F[v + 1] -= fy * cut;
          F[v + 2] -= fz * cut;
        }
      }
      if (W.lift) F[v + 1] = F[v + 1] * (1 - W.sink * k * 0.001) + W.lift * k * 0.001;
      if (W.right && upy < 0.95) {
        // Turn back towards upright about the axis between the car's up and the world's.
        const ax = -upz,
          az = upx,
          n = Math.hypot(ax, az) || 1,
          t = W.right * k * 0.001;
        F[av] += (ax / n) * t;
        F[av + 2] += (az / n) * t;
      }
    }

    // Reactor boost (REACTOR): thrust only while the gas is held, and air control (REACTOR_AIR) off the ground.
    if (c.reactorLeft > 0) {
      c.reactorLeft--;
      const R = c.reactor;
      if (c.gas) {
        const k = R.dir * R.thrust * 0.001;
        if (R.frame == 'car') {
          F[v] += upx * k;
          F[v + 1] += upy * k;
          F[v + 2] += upz * k;
        } else F[v + 1] += k;
      }
      if (contacts == 0) {
        const A = REACTOR_AIR,
          w = av,
          yaw = F[w] * upx + F[w + 1] * upy + F[w + 2] * upz,
          dy = (steer * A.yaw - yaw) * A.pull;
        // Pitch and roll spin: what is left of the spin once its part about the car's up is taken out.
        let px = F[w] - upx * yaw,
          py = F[w + 1] - upy * yaw,
          pz = F[w + 2] - upz * yaw,
          tx = 0,
          ty = 0,
          tz = 0;
        if (R.frame != 'car') {
          // Towards level: about car up x world up, as fast as level x the tilt.
          const ax = -upz,
            az = upx,
            n = Math.hypot(ax, az);
          if (n > 1e-6) {
            const a = (Math.atan2(n, upy) * A.level) / n;
            tx = ax * a;
            tz = az * a;
          }
          // only the part square to the car's up (turning about up is the steering's)
          const k2 = tx * upx + ty * upy + tz * upz;
          tx -= upx * k2;
          ty -= upy * k2;
          tz -= upz * k2;
        }
        F[w] += upx * dy + (tx - px) * A.calm;
        F[w + 1] += upy * dy + (ty - py) * A.calm;
        F[w + 2] += upz * dy + (tz - pz) * A.calm;
      }
    }

    // Plastic bounce: a hit on the side or roof of the car throws it back off the plastic, the way it came.
    // A real collision takes several frames, so the velocity change is added up over the whole hit and judged at its end.
    // It counts when it stopped a good share of the speed the car hit the surface with.
    const vx = F[v],
      vy = F[v + 1],
      vz = F[v + 2],
      last = c.last,
      w = (body + 328) >> 2,
      // The plastic surface normal behind a hit (h: summed velocity change), if the hit was on the car's body (nose, tail,
      // sides or roof: anything but the wheels).
      normalOf = (h) => {
        const m = Math.sqrt(h.sx * h.sx + h.sy * h.sy + h.sz * h.sz);
        if (m < 1e-6 || !c.walls.tris.length) return null;
        const n = plasticNormal(c.walls, x, y, z, h.sx / m, h.sy / m, h.sz / m);
        if (!n) return null;
        const up = (1 - 2 * (qx * qx + qz * qz)) * n[1] + 2 * (qx * qy - qw * qz) * n[0] + 2 * (qy * qz + qw * qx) * n[2];
        return up > 0.5 ? null : n;
      };
    if (c.bounceWait > 0) c.bounceWait--;
    // Back on three or four wheels: the next bounce is a fresh one.
    if (c.chainLeft > 0) c.chainLeft = contacts >= 3 ? 0 : c.chainLeft - 1;
    if (c.steady > 0) {
      c.steady--;
      F[w] *= BOUNCE.calm;
      F[w + 1] *= BOUNCE.calm;
      F[w + 2] *= BOUNCE.calm;
    }
    if (last && !c.justReset && Math.abs(x - last.x) + Math.abs(y - last.y) + Math.abs(z - last.z) < 5) {
      const dx = vx - last.vx,
        dy = vy - last.vy,
        dz = vz - last.vz,
        d = Math.sqrt(dx * dx + dy * dy + dz * dz),
        H = c.hit;
      if (d > BOUNCE.hit && (!H || H.frames < BOUNCE.window)) {
        if (!H) c.hit = { sx: dx, sy: dy, sz: dz, vx: last.vx, vy: last.vy, vz: last.vz, frames: 1 };
        else {
          H.sx += dx;
          H.sy += dy;
          H.sz += dz;
          H.frames++;
        }
        // Mid-hit on plastic: hold the spin down now, before the contact has had time to tumble the car.
        const n = c.bounceWait == 0 ? normalOf(c.hit) : null;
        if (n) {
          F[w] *= BOUNCE.grip;
          F[w + 1] *= BOUNCE.grip;
          F[w + 2] *= BOUNCE.grip;
        }
      } else if (H) {
        c.hit = null;
        const n = c.bounceWait == 0 ? normalOf(H) : null;
        if (n) {
          const [ax, ay, az] = n,
            hitIn = -(H.vx * ax + H.vy * ay + H.vz * az),
            stopped = H.sx * ax + H.sy * ay + H.sz * az;
          if (hitIn > BOUNCE.minInto && stopped > BOUNCE.share * hitIn) {
            // Mirror the velocity the car hit with, like light off a mirror: the part along the surface is kept whole,
            // the part into it comes back out at restitution plus pop. A glancing hit leaves a little faster, nearly
            // the way it was going; a head-on hit sends the car straight back; a roof hit sends it up.
            c.chainLevel = c.chainLeft > 0 ? c.chainLevel * BOUNCE.fade : 1;
            c.chainLeft = BOUNCE.chain;
            const out = (hitIn * BOUNCE.restitution + BOUNCE.pop) * c.chainLevel;
            F[v] = H.vx + ax * (hitIn + out);
            F[v + 1] = H.vy + ay * (hitIn + out);
            F[v + 2] = H.vz + az * (hitIn + out);
            F[w] = F[w + 1] = F[w + 2] = 0;
            c.steady = BOUNCE.steady;
            c.bounceWait = BOUNCE.cooldown;
          }
        }
      }
    }
    c.justReset = false;

    if (c.boostLeft > 0) {
      c.boostLeft--;
      const dv = c.boost.accel * 2 * (c.boostLeft / c.boost.frames) * 0.001;
      F[v] += fx * dv;
      F[v + 1] += fy * dv;
      F[v + 2] += fz * dv;
    }
    c.last = { x, y, z, vx: F[v], vy: F[v + 1], vz: F[v + 2] };
    if (TEST && TEST.trace) {
      const fr = s.getUint8(4) | (s.getUint8(5) << 8) | (s.getUint8(6) << 16);
      // per wheel; full: the exact values too (to compare against the page's own)
      const r3 = (q) => +q.toFixed(3);
      if (fr % TEST.trace == 0) postMessage({ tmProbe: { fr, carId, vehicle: c.vehicle, reactor: c.reactorLeft > 0 ? Object.keys(REACTOR).find((k) => REACTOR[k] === c.reactor) : null, reactorLeft: c.reactorLeft, gas: c.gas, wet: c.tyres.map((t) => r3(t.wet)), ice: c.tyres.map((t) => r3(t.ice)), mud: c.tyres.map((t) => r3(t.mud)), u: c.probe ? [...c.probe.u] : null, grip: c.probe ? [...c.probe.grip] : null, ...(TEST.full ? { tyres: c.tyres.map((t) => [t.wet, t.ice, t.mud]) } : {}) } });
    }
  }

  // ---- PolyTrackBE1 track code ------------------------------------------------------------------------------------
  // Same layering as PolyTrack2: zlib + base62 twice. See docs/TRACK_CODE_FORMAT.md.
  const SAVE_PREFIX = '~BE1',
    EXPORT_PREFIX = 'PolyTrackBE1';

  function decodeBody(t, start, ctx) {
    let n = start;
    if (t.length - n < 2) return null;
    const env = t[n++];
    if (!(env in ctx.environments)) return null;
    const sun = t[n++];
    if (!Number.isSafeInteger(sun) || sun < 0 || sun >= 180) return null;
    if (t.length - n < 15) return null;
    const i32 = () => {
      const v = t[n] | (t[n + 1] << 8) | (t[n + 2] << 16) | (t[n + 3] << 24);
      n += 4;
      return v;
    };
    const minX = i32(),
      minY = i32(),
      minZ = i32(),
      sizes = t[n++],
      sx = sizes & 3,
      sy = (sizes >> 2) & 3,
      sz = (sizes >> 4) & 3;
    if (sx < 1 || sy < 1 || sz < 1) return null;
    n += 2; // catalogue version: informational, unknown part ids are what actually reject a code
    const track = ctx.create(env, sun);
    const uint = (w) => {
      let v = 0;
      for (let k = 0; k < w; k++) v |= t[n + k] << (8 * k);
      n += w;
      return v;
    };
    while (n < t.length) {
      if (t.length - n < 6) return null;
      const id = t[n] | (t[n + 1] << 8);
      n += 2;
      if (!(id in ctx.partIds)) return null;
      const count = i32();
      for (let k = 0; k < count; k++) {
        if (t.length - n < sx + sy + sz + 2) return null;
        const x = uint(sx) + minX,
          y = uint(sy) + minY,
          z = uint(sz) + minZ,
          b = t[n++],
          rot = b & 3,
          axis = (b >> 2) & 7;
        if (!(axis in ctx.axes)) return null;
        const color = t[n++];
        if (!(color in ctx.colors)) return null;
        let cp = null;
        if (ctx.checkpointIds.includes(id)) {
          if (t.length - n < 2) return null;
          cp = uint(2);
        }
        let so = null;
        if (ctx.startIds.includes(id)) {
          if (t.length - n < 4) return null;
          so = i32();
        }
        track.addPart(x, y, z, id, rot, axis, color, cp, so);
      }
    }
    return track;
  }

  function unpack(str, ctx) {
    const a = ctx.fromBase62(str);
    if (a == null) return null;
    const i1 = new ctx.pako.Inflate({ to: 'string' });
    if ((i1.push(a, true), i1.err)) return null;
    if (typeof i1.result != 'string') return null;
    const b = ctx.fromBase62(i1.result);
    if (b == null) return null;
    const i2 = new ctx.pako.Inflate();
    if ((i2.push(b, true), i2.err)) return null;
    return i2.result instanceof Uint8Array ? i2.result : null;
  }

  function fromSave(str, ctx) {
    if (!str.startsWith(SAVE_PREFIX)) return null;
    const bytes = unpack(str.slice(SAVE_PREFIX.length), ctx);
    return bytes && decodeBody(bytes, 0, ctx);
  }

  function fromExport(str, ctx) {
    if (!str.startsWith(EXPORT_PREFIX)) return null;
    const c = unpack(str.slice(EXPORT_PREFIX.length), ctx);
    if (!c) return null;
    let h = 0;
    if (c.length < 2) return null;
    const nameLen = c[h++],
      name = new TextDecoder('utf-8').decode(c.subarray(h, h + nameLen));
    h += nameLen;
    const authorLen = c[h++];
    const author = authorLen > 0 ? new TextDecoder('utf-8').decode(c.subarray(h, h + authorLen)) : null;
    h += authorLen;
    let lastModified = null;
    const hasDate = c[h++];
    if (hasDate == 1) {
      lastModified = new Date(1000 * (c[h] | (c[h + 1] << 8) | (c[h + 2] << 16) | (c[h + 3] << 24)));
      h += 4;
    } else if (hasDate != 0) return null;
    const track = decodeBody(c, h, ctx);
    return track ? { trackMetadata: { name, author, lastModified }, trackData: track } : null;
  }

  // Tracks with new blocks have ids Kodub's servers can never verify, so they never get uploaded there.
  const extTrackIds = new Set();

  return {
    data: D,
    version: D.version,
    isTM,
    addEnum,
    stockIds,
    parts: D.parts,
    byId,
    load,
    renderArrays,
    prepareCar,
    physicsId,
    proxyConfigs,
    zones,
    fxZones: zones,
    surfaceIndex,
    surfaceAt,
    fxControls,
    fxStep,
    fxSkip,
    fxSave,
    fxLoad,
    surfaces: SURFACES,
    // For the page: the cars (VEHICLES[name].look has the hints for drawing them), which gate gives which car, and the
    // tyre model itself (TYRES: the page steps its tyres with the same code). The page works out the car the same way: a
    // Car* zone entered switches it, a checkpoint keeps it for respawns, a respawn or the respawn key goes back to it, a
    // new car (start over) is the Stadium car.
    VEHICLES,
    vehicleGates: GATES,
    // The reactor boosts (the page's HUD and wheel jets work out the same effect from the car's states).
    REACTOR,
    WATER,
    ICING,
    TYRES,
    fromSave,
    fromExport,
    SAVE_PREFIX,
    EXPORT_PREFIX,
    extTrackIds,
    palette: (p) => D.palettes[p.f],
    ranges: (p) => p.c,
  };
})();
