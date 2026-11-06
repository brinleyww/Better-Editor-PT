// Better Editor runtime: loaded by the page and by the physics worker, right after tm_parts.js.
// Holds the extended part table, the geometry file, the PolyTrackBE1 track code and the effect plates.
self.TM = (() => {
  const D = self.TM_DATA;
  const FIRST_ID = 1000;
  const byId = new Map(D.parts.map((p) => [p.i, p]));
  const proxyParts = D.proxies;

  // ---- part table --------------------------------------------------------------------------------------------
  const isTM = (id) => id >= FIRST_ID;
  const addEnum = (e) => {
    for (const p of D.parts) {
      e[p.n] = p.i;
      e[p.i] = p.n;
    }
  };

  // ---- geometry --------------------------------------------------------------------------------------------------
  let bin = null;
  const binUrl = 'models/tm_blocks.bin';
  const accept = (buffer) => {
    if (buffer.byteLength != D.binBytes) throw new Error('models/tm_blocks.bin does not match tm_parts.js');
    bin = buffer;
  };
  let loading = null;
  const load = () => {
    if (bin) return Promise.resolve();
    return (loading ??= fetch(binUrl)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load ' + binUrl + ': ' + r.status);
        return r.arrayBuffer();
      })
      .then(accept));
  };
  // Workers have no await point before their first message, so they read the file synchronously when needed.
  const loadSync = () => {
    if (bin) return;
    const x = new XMLHttpRequest();
    x.open('GET', binUrl, false);
    x.responseType = 'arraybuffer';
    x.send(null);
    accept(x.response);
  };
  const positions = (m) => new Float32Array(bin, m[1], m[2]);
  const indices = (m) => new Uint16Array(bin, m[3], m[4]);

  // Render geometry for one colour slot: non-indexed positions and a matching colour array.
  // `toRgb(hex)` must return linear [r,g,b] (the page passes THREE.Color so it matches stock vertex colours).
  function renderArrays(id, slotColors, toRgb) {
    const p = byId.get(id);
    let tris = 0;
    for (const m of p.m) tris += m[4];
    const pos = new Float32Array(tris * 3),
      col = new Float32Array(tris * 3);
    let o = 0;
    for (const m of p.m) {
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
    return { pos, col };
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
      spawns = [];
    track.forEachPart((x, y, z, id) => {
      if (!isTM(id)) {
        records++;
        return;
      }
      const p = byId.get(id);
      if (p.p != null) records++;
      for (const m of physicsMeshes(p)) extra += m[4] * 3;
    });
    fxBegin(carId, zones, cells, extra > 0, spawns);
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
      if (p.x) {
        const c = rotate(M, p.x.center[0], p.x.center[1], p.x.center[2]),
          s = rotate(M, p.x.size[0] / 2, p.x.size[1] / 2, p.x.size[2] / 2);
        zones.push({
          type: p.x.type,
          min: [wx + c[0] - Math.abs(s[0]), wy + c[1] - Math.abs(s[1]), wz + c[2] - Math.abs(s[2])],
          max: [wx + c[0] + Math.abs(s[0]), wy + c[1] + Math.abs(s[1]), wz + c[2] + Math.abs(s[2])],
        });
      }
    });
    return { vertices: out, records };
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
  const WATER = { drag: 3, lift: 7 };

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
  ];
  // A collision is added up over the frames it lasts (hit: per-frame velocity change that counts as contact,
  // window: longest collision in frames), then judged as a whole. pop is always added on top of the rebound.
  // The car leaves at restitution x the speed it hit with, plus pop, plus lift upward. Each bounce that follows another
  // before the car is back on its wheels (or within `chain` frames) is scaled by fade again, so a crash gives one big
  // bounce and then settles instead of hopping forever.
  // While the hit lasts the car's spin is held down (grip), and after the bounce it is zeroed and kept damped for
  // `steady` frames (calm per frame), so the car flies off flat the same way every time instead of tumbling.
  const BOUNCE = { hit: 0.5, window: 30, minInto: 6, share: 0.45, restitution: 0.9, pop: 4, lift: 2, cooldown: 150, grip: 0.6, steady: 250, calm: 0.97, chain: 8000, fade: 0.55 };

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

  const cars = new Map();
  function fxBegin(carId, zones, cells, active, spawns = []) {
    cars.set(carId, { zones, cells, active, spawns, lastCp: 0, hit: null, reactor: null, reactorLeft: 0, slow: false, slowTick: 0, lastState: null, ctl: null, boost: null, boostLeft: 0, noEngine: false, noBrake: false, noSteer: false, cruise: false, fragile: false, inside: new Set(), speed: 0, pulseReset: false, stockGrip: null, gas: false, justReset: false, last: null, bounceWait: 0, steady: 0, chainLeft: 0, chainLevel: 1 });
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
    let inWater = false;

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
      if (hit && q.type == 'Water') inWater = true;
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

    // Tyres: each wheel gets the grip of the surface under it for the next frame.
    // Wheels are btWheelInfo structs: normal at +0, contact point at +16, in contact at +84, friction slip at +228.
    const wheels = U[(U[(car + 32) >> 2] + 144) >> 2];
    if (c.stockGrip == null) c.stockGrip = F[(wheels + 228) >> 2];
    let launchWheels = 0,
      launch = 0,
      launchUntil = 0,
      dragWheels = 0,
      drag = 0,
      expoWheels = 0,
      expo = null,
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
      F[g + 57] = c.stockGrip * grip;
      if (surface && surface.drag) {
        dragWheels++;
        drag = surface.drag;
      }
      if (surface && surface.expo) {
        expoWheels++;
        expo = surface.expo;
      }
      if (surface && surface.launch > 0) {
        launchWheels++;
        launch = surface.launch;
        launchUntil = surface.launchUntil;
      }
    }

    // Plastic launch: strongest from a standstill, gone by launchUntil (units per second).
    if (c.gas && launchWheels > 0) {
      const now = speed / 3.6,
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

    // Water: slows the car hard and holds it up a little, so it sinks slowly and can drive out.
    if (inWater) {
      const k = 1 - WATER.drag * 0.001;
      F[v] *= k;
      F[v + 1] = F[v + 1] * k + WATER.lift * 0.001;
      F[v + 2] *= k;
    }

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
    // It counts when it removed a good share of the speed the car hit with, which leaves out brushing a rail at speed.
    const vx = F[v],
      vy = F[v + 1],
      vz = F[v + 2],
      last = c.last,
      w = (body + 328) >> 2,
      // Is a hit along n on the car's side or roof, against plastic?
      plasticHit = (nx, ny, nz) => {
        const up = (1 - 2 * (qx * qx + qz * qz)) * ny + 2 * (qx * qy - qw * qz) * nx + 2 * (qy * qz + qw * qx) * nz,
          side = (1 - 2 * (qy * qy + qz * qz)) * nx + 2 * (qx * qy + qw * qz) * ny + 2 * (qx * qz - qw * qy) * nz;
        if (!(Math.abs(side) > 0.55 || up < -0.55)) return false;
        for (const r of [0.3, 0.8, 1.3, 1.8]) {
          const f = cellAt(c.cells, x - nx * r, y - ny * r, z - nz * r);
          if (f != null && SURFACES[f].bounce) return true;
        }
        return false;
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
        const h = c.hit,
          m = Math.sqrt(h.sx * h.sx + h.sy * h.sy + h.sz * h.sz);
        if (c.bounceWait == 0 && m > 1e-6 && plasticHit(h.sx / m, h.sy / m, h.sz / m)) {
          F[w] *= BOUNCE.grip;
          F[w + 1] *= BOUNCE.grip;
          F[w + 2] *= BOUNCE.grip;
        }
      } else if (H) {
        c.hit = null;
        const sum = Math.sqrt(H.sx * H.sx + H.sy * H.sy + H.sz * H.sz);
        if (sum > 1e-6 && c.bounceWait == 0) {
          const nx = H.sx / sum,
            ny = H.sy / sum,
            nz = H.sz / sum,
            into = -(H.vx * nx + H.vy * ny + H.vz * nz);
          if (into > BOUNCE.minInto && sum > BOUNCE.share * into && plasticHit(nx, ny, nz)) {
            c.chainLevel = c.chainLeft > 0 ? c.chainLevel * BOUNCE.fade : 1;
            c.chainLeft = BOUNCE.chain;
            const k = c.chainLevel,
              out = (into * BOUNCE.restitution + BOUNCE.pop) * k - (vx * nx + vy * ny + vz * nz);
            F[v] += nx * out;
            F[v + 1] += ny * out + BOUNCE.lift * k;
            F[v + 2] += nz * out;
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
    parts: D.parts,
    byId,
    load,
    renderArrays,
    prepareCar,
    physicsId,
    proxyConfigs,
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
