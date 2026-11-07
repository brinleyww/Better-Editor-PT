// Better Editor runtime: loaded by the page and by the physics worker, right after tm_parts.js.
// Holds the extended part table, the geometry file, the PolyTrackBE1 track code and the effect plates.
self.TM = (() => {
  const D = self.TM_DATA;
  const FIRST_ID = 1000;
  const byId = new Map(D.parts.map((p) => [p.i, p]));
  const proxyParts = D.proxies;

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
      walls = { tris: [], cells: new Map() };
    track.forEachPart((x, y, z, id) => {
      if (!isTM(id)) {
        records++;
        return;
      }
      const p = byId.get(id);
      if (p.p != null) records++;
      for (const m of physicsMeshes(p)) extra += m[4] * 3;
    });
    fxBegin(carId, zones, cells, extra > 0, spawns, walls);
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
          I = indices(m),
          o0 = o;
        for (let i = 0; i < I.length; i++, o += 3) {
          const v = I[i] * 3,
            a = P[v],
            b = P[v + 1],
            c = P[v + 2];
          out[o] = M[0] * a + M[1] * b + M[2] * c + wx - off.x;
          out[o + 1] = M[3] * a + M[4] * b + M[5] * c + wy - off.y;
          out[o + 2] = M[6] * a + M[7] * b + M[8] * c + wz - off.z;
        }
        if (bouncy)
          for (let t = o0; t < o; t += 9) {
            const k = walls.tris.length / 9,
              T = [];
            for (let j = 0; j < 9; j++) T.push(out[t + j] + (j % 3 == 0 ? off.x : j % 3 == 1 ? off.y : off.z));
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
      if (p.u != null || p.r) {
        const entry = { u: p.u ?? null, r: p.r ? { x: wx, y: wy, z: wz, M, boxes: p.r } : null };
        rotatedTiles(id, rot, axis).forEach((tx, ty, tz) => {
          const k = cellKey(x + tx, y + ty, z + tz),
            l = cells.get(k);
          l ? l.push(entry) : cells.set(k, [entry]);
        });
      }
      if (p.sd && p.d) {
        // A gate whose road is not square to the grid: remember where it is and which way its road runs.
        const c = rotate(M, p.d.center[0], p.d.center[1], p.d.center[2]);
        spawns.push({ x: wx + c[0], y: wy + c[1], z: wz + c[2], dir: rotate(M, p.sd[0], p.sd[1], p.sd[2]) });
      }
      if (p.x) zones.push(zoneOf(p, wx, wy, wz, M));
    });
    return { vertices: out, records };
  }
  // A placed part's effect box in world space.
  function zoneOf(p, wx, wy, wz, M) {
    const c = rotate(M, p.x.center[0], p.x.center[1], p.x.center[2]),
      s = rotate(M, p.x.size[0] / 2, p.x.size[1] / 2, p.x.size[2] / 2);
    return {
      type: p.x.type,
      min: [wx + c[0] - Math.abs(s[0]), wy + c[1] - Math.abs(s[1]), wz + c[2] - Math.abs(s[2])],
      max: [wx + c[0] + Math.abs(s[0]), wy + c[1] + Math.abs(s[1]), wz + c[2] + Math.abs(s[2])],
      surface: p.x.surface != null ? wy + rotate(M, 0, p.x.surface, 0)[1] : null, // water level
    };
  }
  // Every effect box on a track, for the page (water splashes).
  function zones(track) {
    const out = [];
    track.forEachPart((x, y, z, id, rot, axis) => {
      const p = isTM(id) ? byId.get(id) : null;
      if (p?.x) out.push(zoneOf(p, x * 5, y * 5, z * 5, D.rotations[axis][rot]));
    });
    return out;
  }
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
  // Reactor boosts: thrust along the car's own up axis (down boosts press it onto any surface), and air control.
  const REACTOR = {
    ReactorUp: { dir: 1, push: 6, air: 7, frames: 6000 },
    ReactorDown: { dir: -1, push: 12, air: 7, frames: 6000 },
    Reactor2Up: { dir: 1, push: 11, air: 10, frames: 6000 },
    Reactor2Down: { dir: -1, push: 22, air: 10, frames: 6000 },
  };
  // Water, after Trackmania 2020. How deep the car is decides how much it counts (k, 0 to 1: deep water counts fully once
  // the car's underside is `depth` units under). Drag grows with speed, lin x v + quad x v^2 (units/s^2), so it bleeds
  // speed away without setting a top speed; the engine only pulls (1 - engine x k) as hard; lift holds the car up against
  // gravity and sink damps its vertical speed (per second), so it sinks slowly; right (rad/s^2) turns it back upright.
  // Shallow water sits over a floor the car drives on: only a little drag and a softer engine.
  // Bounce: the car skips off deep water like a stone when it hits the surface from above at minSpeed or more along the
  // water (units/s), falling no steeper than maxSlope (fall speed / speed along), upright at least `upright`. It comes back
  // up at rebound x its fall speed (at least minUp), keeps `keep` of its speed and has its pitch and roll spin x calm.
  // Steering never adds speed to a bounce. guard: frames before another bounce can start.
  // Wet tyres: water soaks them at soak per second; on the ground they dry at dry per second (not on ice, not in the air).
  // A wet tyre's grip is x (1 - wetGrip x wetness), by the surface under it: stock road, then plastic, wood, grass.
  const WATER = {
    deep: { lin: 0.02, quad: 0.0008, engine: 0.6, lift: 6.4, sink: 1.5, right: 4, depth: 1 },
    shallow: { lin: 0.01, quad: 0.0003, engine: 0.4, lift: 0, sink: 0, right: 0, depth: 0.5 },
    bounce: { minSpeed: 41.7, maxSlope: 0.35, upright: 0.7, rebound: 0.5, minUp: 5, keep: 0.985, calm: 0.5, guard: 80 },
    under: 0.45, // car origin to its underside
    soak: 0.6,
    dry: 0.1,
    wetGrip: { road: 0.15, 0: 0.3, 1: 0.75, 2: 0.3 },
  };

  // What each new surface does to a wheel touching it. Index = part.f, 0 plastic, 1 wood.
  const SURFACES = [
    // Plastic: almost no grip, very strong acceleration at low speed, and it throws the car back when hit side-on or roof-first.
    { gripFront: 0.45, gripRear: 0.36, launch: 34, launchUntil: 45, bounce: true },
    // Wood: a little more grip than road. The tyres' grip also limits braking, so much more than this makes it stop dead.
    // Its extra push grows exponentially with speed (expo) up to `peak`, then fades to nothing by `end` (units per second),
    // so it pulls harder the faster you go without running away.
    { gripFront: 1.2, gripRear: 1.2, launch: 0, launchUntil: 0, bounce: false, expo: { push: 4, scale: 50, max: 24, peak: 83, end: 139 } },
    // Penalty grass: soft grip and heavy drag that bleeds speed away while the wheels are on it.
    { gripFront: 0.55, gripRear: 0.5, launch: 0, launchUntil: 0, bounce: false, drag: 1.1 },
    // Platform ice: the tyres barely hold, so the car slides; steering turns the car itself (ice.yaw, rad/s) and the
    // way it is going swings round to its nose at ice.align x sin(slip) rad/s, so a held turn settles into a steady
    // slide instead of spinning. Sliding costs ice.loss x sin^2(slip) of the speed per second. The tyres cannot put
    // the engine down either, so the launch push stands in for it up to launchUntil. stick (units/s^2) presses the
    // car onto bobsleigh ice, and on a bobsleigh wall `follow` (per second) turns the car's climb up the wall into
    // speed along the channel, so the walls carry the car round a curve instead of throwing it over the top.
    { gripFront: 0.16, gripRear: 0.11, launch: 16, launchUntil: 75, bounce: false, ice: { yaw: 1.3, pull: 0.005, spin: 0.0015, align: 2.2, loss: 0.25, stick: 0, follow: 0 } },
    // Bobsleigh ice: as slippery to brake and accelerate on, but the car turns less and follows the channel more.
    { gripFront: 0.22, gripRear: 0.17, launch: 16, launchUntil: 75, bounce: false, ice: { yaw: 1.0, pull: 0.004, spin: 0.002, align: 3, loss: 0.2, stick: 14, follow: 25 } },
  ];
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
  // Bugslides: start above minSpeed (units per second) and minSlip (radians) on a landing after `air` frames off the
  // ground or when two wheels' contact normals differ by more than acos(kink); last up to `frames`; tyres at grip;
  // speed kept at keep per frame (about 2% a second lost); over below endSlip.
  const BUG = { minSpeed: 100 / 3.6, minSlip: 0.17, endSlip: 0.05, frames: 1200, air: 120, window: 150, kink: 0.99, grip: 0.55, keep: 0.99998 };
  // Wood wiggles: flicking the steering from one side to the other above minSpeed (units per second), with at least
  // three wheels on wood and the car not sliding (maxSlip, radians), adds speed along the way the car is going.
  // A flick `best` frames after the last one adds `gain` units per second, falling off over `width`; nothing outside
  // min..max frames. Until the next flick is due the tyres' scrub costs no speed, so a good rhythm beats driving
  // straight while mashing the keys or slow weaving only loses speed to the scrub.
  const WIGGLE = { minSpeed: 120 / 3.6, maxSlip: 0.25, gain: 0.5, best: 130, width: 55, min: 60, max: 260 };

  // Tile coordinates fit well inside these ranges, and the key stays an exact double.
  const cellKey = (x, y, z) => (x + 50000) * 1e10 + (y + 5000) * 1e5 + (z + 50000);
  // Surface under a point: grass regions inside a part win, then the part's own surface.
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
      for (const [a, b] of e.r.boxes) if (lx >= a[0] && lx <= b[0] && ly >= a[1] && ly <= b[1] && lz >= a[2] && lz <= b[2]) return 2;
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

  const cars = new Map();
  function fxBegin(carId, zones, cells, active, spawns = [], walls = { tris: [], cells: new Map() }) {
    cars.set(carId, { zones, cells, active, spawns, walls, lastCp: 0, hit: null, reactor: null, reactorLeft: 0, slow: false, slowTick: 0, lastState: null, ctl: null, wet: 0, waterGuard: 0, overWater: false, boost: null, boostLeft: 0, noEngine: false, noBrake: false, noSteer: false, cruise: false, fragile: false, inside: new Set(), speed: 0, pulseReset: false, stockGrip: null, gas: false, justReset: false, last: null, bounceWait: 0, steady: 0, chainLeft: 0, chainLevel: 1, air: 0, landing: 0, bug: 0, bugV: 0, catchRamp: 0, wigT: 0, wigAt: -1e9, wigDir: 0, wigLeft: 0, wigV: 0 });
  }
  const clear = (c) => {
    c.boostLeft = 0;
    c.reactorLeft = 0;
    c.slow = false;
    c.noEngine = c.noBrake = c.noSteer = c.cruise = c.fragile = false;
  };
  // Filters the controls going into the car. Always returns a fresh object; stock tracks pass straight through.
  function fxControls(carId, r) {
    const c = cars.get(carId);
    if (!c || !c.active) return r;
    const out = { up: r.up, right: r.right, down: r.down, left: r.left, reset: r.reset };
    if (c.pulseReset) {
      out.reset = true;
      c.pulseReset = false;
    }
    if (out.reset) {
      clear(c);
      c.bug = c.wigLeft = c.catchRamp = 0;
      c.justReset = true;
    }
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
  // Slow motion: the car only gets every other physics frame while the race clock keeps counting, so it moves at half speed.
  // Returns the held state for a skipped frame, or null to run the frame normally.
  function fxSkip(carId, heap) {
    const c = cars.get(carId);
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

  function fxStep(carId, heap, stateBuffer) {
    const c = cars.get(carId);
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

    // Passing a diagonal checkpoint: the physics just saved a respawn point facing along the grid. Turn it to face
    // along the diagonal road, the way the car was going, and move it to just behind the gate on that line.
    const cp = s.getUint16(pos - 2, true);
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

    // Tyres: each wheel gets the grip of the surface under it for the next frame.
    // Wheels are btWheelInfo structs: normal at +0, contact point at +16, in contact at +84, friction slip at +228.
    const wheels = U[(U[(car + 32) >> 2] + 144) >> 2],
      normals = [];
    let plasticWheels = 0;
    if (c.stockGrip == null) c.stockGrip = F[(wheels + 228) >> 2];
    let launchWheels = 0,
      launch = 0,
      launchUntil = 0,
      dragWheels = 0,
      drag = 0,
      expoWheels = 0,
      expo = null,
      iceWheels = 0,
      ice = null,
      contacts = 0;
    for (let w = 0; w < 4; w++) {
      const a = wheels + w * 284,
        g = a >> 2;
      if (!heap[a + 84]) continue;
      contacts++;
      // A little way under the contact point is inside the deck, whichever way the deck faces.
      const f = cellAt(c.cells, F[g + 4] - F[g] * 0.1, F[g + 5] - F[g + 1] * 0.1, F[g + 6] - F[g + 2] * 0.1),
        surface = f == null ? null : SURFACES[f];
      let grip = surface ? (w < 2 ? surface.gripFront : surface.gripRear) : 1; // wheels 0 and 1 steer
      if (grip > 1) {
        // Extra grip is a fixed amount, sized at the wheel's resting load: it does not grow with load.
        // In a loop the tyres carry many times their resting load, and grip that scaled with it would spin
        // the car round at the first steering input. Suspension force is at +276.
        const load = F[g + 69],
          rest = (9.81 / F[(body + 344) >> 2]) / 4;
        if (load > rest) grip = 1 + ((grip - 1) * rest) / load;
      }
      if (surface && surface.bounce) {
        plasticWheels++;
        if (w < 2) grip *= 1 + (SLIDE.frontGrip - 1) * ease;
      }
      if (c.bug > 0) grip *= BUG.grip;
      if (c.wet > 0) grip *= 1 - (WATER.wetGrip[f == null ? 'road' : f] ?? 0) * c.wet;
      normals.push(F[g], F[g + 1], F[g + 2]);
      F[g + 57] = c.stockGrip * grip;
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
      if (surface && surface.launch > 0) {
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
    if (iceWheels >= 2) {
      const yaw = F[av] * upx + F[av + 1] * upy + F[av + 2] * upz,
        d = steer != 0 ? (steer * ice.yaw * Math.min(1, spd / 15) - yaw) * ice.pull : -yaw * ice.spin;
      F[av] += upx * d;
      F[av + 1] += upy * d;
      F[av + 2] += upz * d;
      const sn = Math.sin(Math.abs(slip)),
        turn = Math.sign(slip) * Math.min(Math.abs(slip), ice.align * sn * 0.001 * (iceWheels / 4));
      if (spd > 1 && turn != 0 && Math.abs(slip) < 1.4) {
        // Rotate the velocity about the car's up axis, towards the nose (slip > 0: moving to the left of the nose).
        const c0 = Math.cos(-turn),
          s0 = Math.sin(-turn),
          ux = upx,
          uy = upy,
          uz = upz,
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
        // Uphill along the wall: world up with the wall's normal taken out. Only on walls steeper than 45 degrees.
        const ax = nx / (nl || 1),
          ay = ny / (nl || 1),
          az = nz / (nl || 1);
        if (ice.follow && nl > 0 && ay < 0.7) {
          let wx = -ax * ay,
            wy = 1 - ay * ay,
            wz = -az * ay;
          const wl = Math.hypot(wx, wy, wz);
          wx /= wl;
          wy /= wl;
          wz /= wl;
          const up = F[v] * wx + F[v + 1] * wy + F[v + 2] * wz;
          if (up > 0) {
            const before = Math.hypot(F[v], F[v + 1], F[v + 2]),
              d = up * Math.min(1, ice.follow * 0.001);
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

    // Wood wiggles: a well-timed flick of the steering from one side to the other gives a little speed.
    c.wigT++;
    if (steer != 0 && steer != c.wigDir) {
      const dt = c.wigT - c.wigAt;
      if (c.wigDir != 0 && c.gas && expoWheels >= 3 && spd > WIGGLE.minSpeed && Math.abs(slip) < WIGGLE.maxSlip && dt >= WIGGLE.min && dt <= WIGGLE.max) {
        c.wigV = Math.max(spd, c.wigLeft > 0 ? c.wigV : 0) + WIGGLE.gain * Math.exp(-(((dt - WIGGLE.best) / WIGGLE.width) ** 2));
        c.wigLeft = WIGGLE.max;
      }
      c.wigDir = steer;
      c.wigAt = c.wigT;
    }
    if (c.wigLeft > 0) {
      c.wigLeft--;
      if (!c.gas || expoWheels < 3 || Math.abs(slip) > 2 * WIGGLE.maxSlip) c.wigLeft = 0;
      else {
        // Gravity still counts on a slope.
        c.wigV = Math.max(spd, c.wigV - 0.00981 * (F[v + 1] / spd));
        if (spd < c.wigV) {
          const k = c.wigV / spd;
          F[v] *= k;
          F[v + 1] *= k;
          F[v + 2] *= k;
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

    // Penalty grass: the share of wheels on it, squared, so one or two wheels only drag a little and all four drag fully
    // (per second: 1 wheel about 7%, 2 about 24%, 3 about 46%, 4 about 67% of the speed).
    if (dragWheels > 0) {
      const k = 1 - drag * 0.001 * (dragWheels / 4) ** 2;
      F[v] *= k;
      F[v + 1] *= k;
      F[v + 2] *= k;
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
      c.wet = Math.min(1, c.wet + WATER.soak * 0.001);
    } else if (c.wet > 0 && contacts > 0 && iceWheels == 0) c.wet = Math.max(0, c.wet - WATER.dry * 0.001);

    // Reactor boost: thrust along the car's own up axis for the whole effect; in the air the gas pushes along the nose
    // and steering turns the car about its up axis.
    if (c.reactorLeft > 0) {
      c.reactorLeft--;
      const R = c.reactor,
        ux = 2 * (qx * qy - qw * qz),
        uy = 1 - 2 * (qx * qx + qz * qz),
        uz = 2 * (qy * qz + qw * qx),
        k = R.dir * R.push * 0.001;
      F[v] += ux * k;
      F[v + 1] += uy * k;
      F[v + 2] += uz * k;
      if (contacts == 0 && c.ctl) {
        if (c.gas) {
          const t = R.air * 0.001;
          F[v] += fx * t;
          F[v + 1] += fy * t;
          F[v + 2] += fz * t;
        }
        const w = (body + 328) >> 2,
          want = ((c.ctl.left ? 1 : 0) - (c.ctl.right ? 1 : 0)) * 2.4,
          now = F[w] * ux + F[w + 1] * uy + F[w + 2] * uz,
          d = (want - now) * 0.02;
        F[w] += ux * d;
        F[w + 1] += uy * d;
        F[w + 2] += uz * d;
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
    fxControls,
    fxStep,
    fxSkip,
    surfaces: SURFACES,
    fromSave,
    fromExport,
    SAVE_PREFIX,
    EXPORT_PREFIX,
    extTrackIds,
    palette: (p) => D.palettes[p.f],
    ranges: (p) => p.c,
  };
})();
