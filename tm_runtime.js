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
  // The page hands its copy of the file to its physics workers as a blob: URL ({tmBin} message, or TM_BIN_URL set by the
  // embedding site's own worker code). A worker that downloads the file again stays busy, and its cars frozen, until it has it.
  const isPage = typeof document != 'undefined';
  let blobUrl = null;
  const shared = new Set();
  const blocksUrl = () => (isPage && bin ? (blobUrl ??= URL.createObjectURL(new Blob([bin]))) : null);
  const tell = (worker) => {
    try {
      const tmBin = blocksUrl();
      if (tmBin) worker.postMessage({ tmBin });
    } catch {}
  };
  const shareBlocks = (worker) => {
    shared.add(worker);
    tell(worker);
  };
  if (!isPage && typeof self.addEventListener == 'function')
    self.addEventListener('message', (e) => {
      const u = e.data?.tmBin;
      if (typeof u == 'string' && u.startsWith('blob:')) self.TM_BIN_URL = u;
    });
  const accept = (buffer) => {
    if (buffer?.byteLength != D.binBytes) throw new Error('models/tm_blocks.bin does not match tm_parts.js');
    bin = buffer;
    for (const worker of shared) tell(worker);
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
    const read = (url) => {
      const x = new XMLHttpRequest();
      x.open('GET', url, false);
      x.responseType = 'arraybuffer';
      x.send(null);
      return x.response;
    };
    let buffer = null;
    if (self.TM_BIN_URL)
      try {
        buffer = read(self.TM_BIN_URL);
      } catch {}
    if (buffer?.byteLength != D.binBytes) buffer = read(binUrl());
    accept(buffer);
  };
  const positions = (m) => new Float32Array(bin, m[1], m[2]);
  const indices = (m) => new Uint16Array(bin, m[3], m[4]);

  // ---- penalty grass tufts ----------------------------------------------------------------------------------------
  // Little clumps of three blades stand on penalty grass (the Grass and GrassB materials), as on Trackmania 2020's, so
  // it reads as penalty and not as a lawn to drive on. They are only drawn: made here when a part's mesh is built, never
  // stored in the blocks file, and the physics never sees them. One clump per `per` square units of grass facing up, at
  // most `max` a part (a big part spreads them thinner); a blade is one triangle seen from both sides, `height` tall,
  // leaning out up to `lean`, in one of `tones` (times the colour of the grass under it). They ride in the part's own
  // mesh, so they cost no draw of their own and are culled with it. Not in Low performance mode.
  const TUFT = { per: 4, max: 200, height: [0.2, 0.42], width: 0.14, lean: 0.18, tones: [1.35, 0.65, 1.12] };
  const TUFT_ON = new Set(['Grass', 'GrassB']);
  const tuftCache = new Map();
  const tuftsWanted = () => {
    try {
      if (typeof self.__nswsSettingBoolean == 'function') return self.__nswsSettingBoolean('LowPerformanceMode') !== true;
      return !(self.TM.cull && self.TM.cull.low);
    } catch {
      return true;
    }
  };
  function tuftsOf(p) {
    if (tuftCache.has(p.i)) return tuftCache.get(p.i);
    // Grass triangles facing up: [material, ax, ay, az, bx, by, bz, cx, cy, cz, nx, ny, nz, area].
    const faces = [];
    let area = 0;
    for (const m of p.m) {
      if (!TUFT_ON.has(D.materialNames[m[0]])) continue;
      const P = positions(m),
        I = indices(m);
      for (let i = 0; i < I.length; i += 3) {
        const a = I[i] * 3,
          b = I[i + 1] * 3,
          c = I[i + 2] * 3,
          ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2],
          vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2],
          nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx,
          l = Math.hypot(nx, ny, nz);
        if (l < 1e-6 || ny / l < 0.3) continue;
        faces.push([m[0], P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2], nx / l, ny / l, nz / l, l / 2]);
        area += l / 2;
      }
    }
    if (!faces.length) return (tuftCache.set(p.i, null), null);
    // The same clumps on every machine and every load: a small seeded generator (mulberry32).
    let seed = (Math.imul(p.i + 1, 0x9e3779b1) ^ 0x5bd1e995) >>> 0;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const per = Math.max(TUFT.per, area / TUFT.max),
      pos = [],
      mat = [],
      tone = [];
    for (const f of faces) {
      const [mi, ax, ay, az, bx, by, bz, cx, cy, cz, nx, ny, nz, A] = f;
      // Two directions along the face: its first edge, and the one square to that.
      let tx = bx - ax, ty = by - ay, tz = bz - az;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      const sx = ny * tz - nz * ty, sy = nz * tx - nx * tz, sz = nx * ty - ny * tx;
      for (let n = Math.floor(A / per + rnd()); n > 0; n--) {
        const r = Math.sqrt(rnd()),
          q = rnd(),
          wa = 1 - r,
          wb = r * (1 - q),
          wc = r * q,
          x = ax * wa + bx * wb + cx * wc,
          y = ay * wa + by * wb + cy * wc,
          z = az * wa + bz * wb + cz * wc,
          turn = rnd() * 6.2832;
        for (let k = 0; k < 3; k++) {
          const ang = turn + k * 2.0944 + (rnd() - 0.5) * 0.9,
            ca = Math.cos(ang),
            sa = Math.sin(ang),
            dx = tx * ca + sx * sa, dy = ty * ca + sy * sa, dz = tz * ca + sz * sa,
            h = TUFT.height[0] + (TUFT.height[1] - TUFT.height[0]) * rnd(),
            out = 0.05 + TUFT.lean * (0.4 + 0.6 * rnd()),
            w = TUFT.width * (0.4 + 0.2 * rnd()),
            // Half the blade's foot, square to the way it leans; the foot sits a hair under the grass.
            ex = (sx * ca - tx * sa) * w, ey = (sy * ca - ty * sa) * w, ez = (sz * ca - tz * sa) * w,
            fx = x + dx * 0.05 - nx * 0.03, fy = y + dy * 0.05 - ny * 0.03, fz = z + dz * 0.05 - nz * 0.03,
            px = x + dx * out + nx * h, py = y + dy * out + ny * h, pz = z + dz * out + nz * h,
            shade = Math.floor(rnd() * TUFT.tones.length);
          pos.push(fx - ex, fy - ey, fz - ez, fx + ex, fy + ey, fz + ez, px, py, pz, fx + ex, fy + ey, fz + ez, fx - ex, fy - ey, fz - ez, px, py, pz);
          mat.push(mi, mi);
          tone.push(shade, shade);
        }
      }
    }
    const made = pos.length ? { pos: new Float32Array(pos), mat, tone } : null;
    tuftCache.set(p.i, made);
    return made;
  }

  // Render geometry for one colour slot: non-indexed positions and a matching colour array.
  // `toRgb(hex)` must return linear [r,g,b] (the page passes THREE.Color so it matches stock vertex colours).
  // Water is drawn last, surface before sides, and `groups` ([first vertex, count, material 1]) marks it for the
  // see-through water material; it is null for parts without water. Finish boxes use the same group (material 1) for
  // their own see-through material: renderArrays.seeThrough says which one the last call's group is ('water' or
  // 'finish'), and tm_water.js's material() reads it, since every caller asks for that material straight after.
  const WATER_ORDER = { Water: 1, WaterSide: 2, FinishBox: 3 };
  function renderArrays(id, slotColors, toRgb) {
    const p = byId.get(id),
      tufts = tuftsWanted() ? tuftsOf(p) : null;
    let tris = tufts ? tufts.pos.length / 3 : 0;
    for (const m of p.m) tris += m[4];
    const pos = new Float32Array(tris * 3),
      col = new Float32Array(tris * 3),
      order = (m) => WATER_ORDER[D.materialNames[m[0]]] ?? 0,
      meshes = [...p.m].sort((a, b) => order(a) - order(b)),
      groups = [];
    let o = 0;
    if (tufts) {
      pos.set(tufts.pos);
      const base = new Map();
      for (let t = 0; t < tufts.mat.length; t++) {
        const mi = tufts.mat[t];
        let rgb = base.get(mi);
        if (!rgb) base.set(mi, (rgb = toRgb(slotColors[D.materialNames[mi]] ?? D.materials[mi])));
        const k = TUFT.tones[tufts.tone[t]];
        for (let v = 0; v < 3; v++, o += 3) {
          col[o] = Math.min(1, rgb[0] * k);
          col[o + 1] = Math.min(1, rgb[1] * k);
          col[o + 2] = Math.min(1, rgb[2] * k);
        }
      }
    }
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
    renderArrays.seeThrough = !groups.length ? null : groups[0][3] == 3 ? 'finish' : 'water';
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
  // Effect blocks fire on first contact: the moment any part of the car, its hull or a wheel, reaches the effect's box
  // (the whole plate, edge to edge), not when the car's middle gets there (it used to be the middle 12 units of a
  // 20-unit plate, 5.7 units, 165 ms at 120 km/h, late). FX_BOX: the hull with its wheels round it, in the car's own
  // frame (+z its nose, +y its up; the car state's position and quaternion): hull centre (0, 0.616, -0.153), half
  // extents (0.773, 0.382, 1.843), wheels to 0.85 out and down to their tyres' bottoms. fxTouch tests it against an
  // effect box on the six face axes (the box's and the car's), so a car turned across a plate's corner can count a few
  // hundredths of a unit early, never late. Water keeps its own test (the car's middle, see fxStep). The page uses the
  // same function, so its banner and wheel looks fire on the same frame.
  const FX_BOX = { c: [0, 0.4, -0.153], h: [0.85, 0.6, 1.843] };
  function fxTouch(q, x, y, z, qx, qy, qz, qw) {
    const X0 = 1 - 2 * (qy * qy + qz * qz),
      X1 = 2 * (qx * qy + qw * qz),
      X2 = 2 * (qx * qz - qw * qy),
      Y0 = 2 * (qx * qy - qw * qz),
      Y1 = 1 - 2 * (qx * qx + qz * qz),
      Y2 = 2 * (qy * qz + qw * qx),
      Z0 = 2 * (qx * qz + qw * qy),
      Z1 = 2 * (qy * qz - qw * qx),
      Z2 = 1 - 2 * (qx * qx + qy * qy),
      c = FX_BOX.c,
      h = FX_BOX.h,
      C0 = x + X0 * c[0] + Y0 * c[1] + Z0 * c[2],
      C1 = y + X1 * c[0] + Y1 * c[1] + Z1 * c[2],
      C2 = z + X2 * c[0] + Y2 * c[1] + Z2 * c[2],
      r0 = Math.abs(X0) * h[0] + Math.abs(Y0) * h[1] + Math.abs(Z0) * h[2],
      r1 = Math.abs(X1) * h[0] + Math.abs(Y1) * h[1] + Math.abs(Z1) * h[2],
      r2 = Math.abs(X2) * h[0] + Math.abs(Y2) * h[1] + Math.abs(Z2) * h[2];
    if (C0 + r0 < q.min[0] || C0 - r0 > q.max[0] || C1 + r1 < q.min[1] || C1 - r1 > q.max[1] || C2 + r2 < q.min[2] || C2 - r2 > q.max[2]) return false;
    const b0 = (q.max[0] - q.min[0]) / 2,
      b1 = (q.max[1] - q.min[1]) / 2,
      b2 = (q.max[2] - q.min[2]) / 2,
      d0 = q.min[0] + b0 - C0,
      d1 = q.min[1] + b1 - C1,
      d2 = q.min[2] + b2 - C2;
    if (Math.abs(d0 * X0 + d1 * X1 + d2 * X2) > b0 * Math.abs(X0) + b1 * Math.abs(X1) + b2 * Math.abs(X2) + h[0]) return false;
    if (Math.abs(d0 * Y0 + d1 * Y1 + d2 * Y2) > b0 * Math.abs(Y0) + b1 * Math.abs(Y1) + b2 * Math.abs(Y2) + h[1]) return false;
    if (Math.abs(d0 * Z0 + d1 * Z1 + d2 * Z2) > b0 * Math.abs(Z0) + b1 * Math.abs(Z1) + b2 * Math.abs(Z2) + h[2]) return false;
    return true;
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
  // Reactor boosts, after TM2020's oriented ReactorBoost(2): two plates, the reactor boost and the super one. Which way it
  // boosts depends on the way you cross the plate: along its arrow it is an UP boost, against it a DOWN boost. It lasts
  // `frames` from the plate whether it is used or not; a later reactor plate replaces it with a fresh timer.
  // UP (TM2020's IsReactorGroundMode on the ground): over flat ground the car hovers just above it on its jets
  // (REACTOR_HOVER), gas or not, and drives on; on a ramp or a wall it drives as normal, so ramps still launch it; in the
  // air, only while the gas is held, the jets push it up along world up: G x (base + extra x (1 - vy / vcap)), the extra
  // part no lower than -under, so the car settles into a slow climb of about vcap units/s instead of flying off (a
  // reactor floats, a super one climbs clearly faster). DOWN: only while the gas is held, on the ground it presses the
  // car into the ground (along the wheels' mean contact normal, so it sticks to walls and over crests), in the air it
  // pushes it down along world down; press: units/s^2. level: 1 reactor, 2 super. G: the game's gravity
  // (tools/test/tmphys.mjs reactor: in free fall the car gains 15.5 units/s^2 at 2 units/s, less the faster it falls, as
  // the game damps all velocity by about 0.17 per second: 16 at rest, not 9.81). TM2020's numbers sit in encrypted
  // packs; these are this project's estimates.
  // frames: how long a boost lasts; fade: over its last `fade` frames the push, the press and the hover lift die away
  // to nothing, exactly as the wheel jets do (tm_vehicles.js reads both from here), so the jets and the boost end on the
  // same physics frame. end: frames over which an up boost that has just ended takes out the car's upward speed in the
  // air (see REACTOR_HOVER), so it peaks and falls at once instead of coasting up on the speed it built.
  const G = 16;
  const REACTOR_TIME = { frames: 6000, fade: 500, end: 150 };
  const REACTOR = {
    ReactorUp: { level: 1, dir: 1, ...REACTOR_TIME, push: { base: 1, extra: 0.2, vcap: 2, under: 2.5 } },
    ReactorDown: { level: 1, dir: -1, ...REACTOR_TIME, press: 1.3 * G },
    Reactor2Up: { level: 2, dir: 1, ...REACTOR_TIME, push: { base: 1, extra: 0.4, vcap: 5, under: 1.25 } },
    Reactor2Down: { level: 2, dir: -1, ...REACTOR_TIME, press: 2.2 * G },
  };
  // No grip (TM2020's NoGrip plate): for `frames` the tyres keep only `grip` of their grip, so the car slides as on ice
  // and keeps its drive (SLIDE_DRIVE gives back all the drive the slides cut), the last `fade` frames easing back to
  // full grip. With grip that low Bullet's tyres hardly turn the car, so it steers and its slides straighten as on ice
  // (ice: the same settings as a surface's ice, weaker than platform ice). It ends early on a Reset effects or Reset
  // wheels plate, a checkpoint or a respawn.
  const NOGRIP = { frames: 5000, fade: 400, grip: 0.12, ice: { yaw: 0.9, pull: 0.003, spin: 0.0015, align: 1.2, loss: 0.08, stick: 0, follow: 0 } };
  // The plates (part.x types) and the effect they give. arrow 1: the arrow on the plate points the way the road runs at
  // rotation 0 (the part's -z); -1 the other way: the old down plates, which no longer show in the menu but still load.
  // The old up plates are the two plates the menu offers; the old oriented ones (hidden too) work like them.
  const REACTOR_PLATES = {
    ReactorUp: { level: 1, arrow: 1 },
    ReactorDown: { level: 1, arrow: -1 },
    Reactor2Up: { level: 2, arrow: 1 },
    Reactor2Down: { level: 2, arrow: -1 },
    ReactorOriented: { level: 1, arrow: 1 },
    Reactor2Oriented: { level: 2, arrow: 1 },
  };
  // Which boost a reactor plate q gives a car that has moved (dx, dy, dz) since the last physics frame and whose
  // quaternion is (qx, qy, qz, qw): up along the arrow, down against it. A car crossing nearly sideways (its move less
  // than `band` of its length along the arrow), or standing still, goes by its nose instead. The page (tm_hud.js,
  // tm_vehicles.js) calls this same function with the same car states, so it shows the same boost.
  const REACTOR_PICK = { band: 0.2 };
  function reactorPick(q, dx, dy, dz, qx, qy, qz, qw) {
    const P = REACTOR_PLATES[q.type];
    if (!P) return null;
    const a = -P.arrow,
      ax = q.fwd[0] * a,
      ay = q.fwd[1] * a,
      az = q.fwd[2] * a,
      s = Math.hypot(dx, dy, dz),
      d = dx * ax + dy * ay + dz * az,
      along = s > 1e-6 && Math.abs(d) >= REACTOR_PICK.band * s ? d : 2 * (qx * qz + qw * qy) * ax + 2 * (qy * qz - qw * qx) * ay + (1 - 2 * (qx * qx + qy * qy)) * az;
    return (P.level == 2 ? 'Reactor2' : 'Reactor') + (along >= 0 ? 'Up' : 'Down');
  }
  // Hovering (UP boost over flat ground): every wheel's suspension rest length grows by `lift` units, so the car rides
  // that much higher on the same springs (the jets hold it; the page draws the wheels that far off the ground) and the
  // tyres keep driving it as on the ground: same engine and steering, grip x `grip` (a little floaty, not ice),
  // damping x `damp`. Full hover while the ground under the wheels (the steepest of their contact normals) is within
  // flat[0] degrees of level, none past flat[1], so from the first wheel on the foot of a ramp the car is back on its
  // own legs and the ramp launches it as normal. The lift eases towards its target (ease, easeDown: share of the gap per
  // physics frame) at no more than `rise` units/s up and `drop` down, and dies away with the boost's last stretch
  // (REACTOR fade); off the ground its target is the full lift, so the car lands back into a hover. On the ground the
  // body is moved with the lift (see fxStep), so it changes without a bounce. Longer legs pitch and roll the car much
  // more (the tyres push at the ground further under the body: braking stood it on its nose), so, as TM2020's car does
  // while it hovers, the jets hold it square to the ground: its pitch and roll spin is pulled (hold per frame) towards
  // level x its tilt from the ground (rad/s per rad) and its speed away from the ground is damped by `heave` per
  // second, by how far up it is and only over level ground (holdFlat). Held level it brakes less hard (tools/test/
  // tmphys.mjs reactor hover: 323 to 20 km/h in 1.39 s against the stock car's 1.04 s), so the brake takes off another
  // `brake` units/s^2 while it hovers (1.08 s). The air push comes in between airFrom and airFull physics frames off the
  // ground, so a seam or a kerb never starts a climb.
  // On the jets the car is also quicker, all by how far up it is: it turns sharper (turn: extra share of the turn the
  // front wheels ask for, built up like wood's, see TURN_BUILD), pulls away harder (push units/s^2 along the nose on the
  // gas, fading to none at pushUntil units/s and past it turning into a drag of up to `over` x push, so the speed it
  // gained low down bleeds away and the top end hardly moves) and a skid costs it no drive (drive: share of
  // SLIDE_DRIVE's give-back).
  const REACTOR_HOVER = { lift: 0.45, flat: [1, 3], holdFlat: [1, 3], ease: 0.012, easeDown: 0.06, rise: 1.5, drop: 12, grip: 0.95, damp: 1.6, hold: 0.05, level: 10, heave: 8, brake: 18, airFrom: 60, airFull: 250, turn: 0.35, push: 12, pushUntil: 58, over: 0.1, drive: 1 };
  if (TEST && TEST.hoverSet) Object.assign(REACTOR_HOVER, TEST.hoverSet);
  // ReactorAirControl: with all four wheels off the ground while a reactor is on, steering yaws the car about its own up
  // (towards yaw rad/s, pull: share of the gap per frame) and the car is held steady instead of tumbling: its pitch and
  // roll spin is pulled (calm per frame) towards level x its tilt (rad/s per rad, towards world-flat).
  const REACTOR_AIR = { yaw: 2, pull: 0.02, calm: 0.01, level: 3 };
  // Water, after Trackmania 2020. How deep the car is decides how much it counts (k, 0 to 1: deep water counts fully once
  // the car's underside is `depth` units under). Drag grows with speed, lin x v + quad x v^2 (units/s^2), so it bleeds
  // speed away without setting a top speed; the engine only pulls (1 - engine x k) as hard; lift holds the car up against
  // gravity and sink damps its vertical speed (per second), so it sinks slowly; right (rad/s^2) turns it back upright.
  // Shallow water sits over a floor the car drives on: only a little drag and a softer engine.
  // Bounce: the car skips off deep water like a stone when it hits the surface from above at minSpeed or more along the
  // water (units/s), falling no steeper than maxSlope (fall speed / speed along), upright at least `upright`. It comes back
  // up at rebound x its fall speed (at least minUp), keeps `keep` of its speed and has its pitch and roll spin x calm.
  // Steering never adds speed to a bounce. guard: frames before another bounce can start. The bounce itself turns the
  // car round in one frame, so its touch of the water counts as the `contact` frames from the bounce while the car's
  // underside is still within `touch` units over the surface (it rises 0.2 in that time): steering turns it a little
  // then, the whole car, heading and way together about world up, at steer rad/s (full lock: about 3 degrees a skip),
  // so a skip changes neither its speed nor its slide; in the air between skips nothing.
  // Wet tyres are in TYRES.
  const WATER = {
    deep: { lin: 0.02, quad: 0.0008, engine: 0.6, lift: 6.4, sink: 1.5, right: 4, depth: 1 },
    shallow: { lin: 0.01, quad: 0.0003, engine: 0.4, lift: 0, sink: 0, right: 0, depth: 0.5 },
    bounce: { minSpeed: 41.7, maxSlope: 0.35, upright: 0.7, rebound: 0.5, minUp: 5, keep: 0.985, calm: 0.5, guard: 80, steer: 1.3, contact: 40, touch: 0.5 },
    under: 0.45, // car origin to its underside
  };
  // The surfaces a tyre ices up on (and an iced tyre keeps its grip on), for pages made before TYRES.
  const ICING = { surfaces: [3, 4, 7] };

  // Tyres, after TM2020: every wheel carries how wet (its WetnessValue01, here per tyre), iced (Icing01) and muddy its
  // tyre is, 0 to 1, and the ground under it adds or takes each away, so one surface undoes another: dirt scrubs ice off
  // and soaks water up, water washes mud off and thaws ice, ice and snow freeze a wet tyre. TM2020's tunings sit in
  // encrypted packs: every rate and grip loss here is this project's estimate of how TM2020 plays (a water section soaks
  // the tyres, wet wood is its SlidingWood; ice and snow ice the tyres up), not a measurement.
  // table: a row per surface (part.u 0-8; road: the stock road and tech 8; water: a wheel under a water surface, whatever
  // floor it is on; air: off the ground). Rates per second:
  //   soak: wetness on; dry: wetness off; ice: icing on (only for a car whose tyres ice up there, VEHICLES ices);
  //   freeze: share of the wetness that freezes per second (it leaves the tyre, and iceGain x as much icing comes on for a
  //   car that ices up there); thaw: icing off; mud: mud on while under mudCap (dry dirt dusts the tyre, no more);
  //   wetMud: mud on per unit of wetness (a wet tyre on dirt picks up mud fast); wear: mud off.
  // A sliding tyre is hot (heat 0 to 1, see heatOf: wheelspin, a drift, locked brakes), so its drying, thawing and mud
  // wear go 1 + HEAT x heat times as fast: a burnout clears the tyres, though drying never passes the row's dryMax
  // (wood barely dries a tyre: 0.01 a second, 0.02 at most hot, so a soaked car slides on wood for a long way). Off
  // the ground only a little dries and falls off.
  // shed: the cars built for loose ground (Rally, Desert) throw mud off a little faster.
  // Grip: a full state takes wetLoss, iceLoss, mudLoss of the grip on that row's surface, x (1 - loss x state). The three
  // multiply, but together never take more than the worst one alone leaves x KEEP, so stacking them cannot zero the
  // grip; only the states' own worst cases come near that (soaked wood x0.15 front, x0.08 rear of wood's grip). After
  // TM2020's wet materials: wet tech (WetAsphalt) loses little, wet dirt is a mud road (WetDirtRoad, slippery, wetRoll: a
  // little more rolling drag, share of the speed per second), wet grass is slick (WetGrass), wet wood is SlidingWood.
  // Wet wood is its own slide, not ice: a loose, playful power-slide. The rear tyres lose more (wetLossRear) and sooner
  // (by wetness^wetCurveRear), so the tail steps out on turn-in, and `slick` steers the car like ice (fxStep) but quicker
  // and looser: the spin follows the steering at `pull` per frame towards `yaw` rad/s (x lift off the gas, lift-off
  // oversteer), the way the car goes swings round to the nose at align x sin(slip) per wheel on it, and sliding costs
  // loss x sin^2(slip) of the speed per second. Let go of the steering and the nose swings back onto the way the car is
  // going (towards self x slip rad/s, at most selfMax, by selfPull per frame), so it straightens up in about 0.3 s where
  // ice slides on. How much of that it gets goes with the tyres' wetness (curve, over the four wheels), and the slide is
  // held to angle x that^capCurve radians (capPull), so a lightly wet car is a little loose and a soaked one slides wide.
  // Iced tyres lose half their grip off ice and snow; muddy ones lose up to 30% on hard surfaces
  // (tech, plastic, wood) and nothing on dirt and grass, where the mud is the ground. Dry tyres change nothing.
  // The road, plastic, wood and penalty grass wet losses and the icing rates (0.8 on, 0.4 off on hard ground) are the
  // ones tracks were driven with when wetness was one value for the car.
  const TYRES = {
    table: {
      air: { dry: 0.03, thaw: 0.05, wear: 0.02 },
      water: { soak: 0.6, thaw: 1, wear: 1.5 },
      road: { dry: 0.1, thaw: 0.4, wear: 0.25, wetLoss: 0.15, iceLoss: 0.5, mudLoss: 0.3 },
      0: { dry: 0.1, thaw: 0.4, wear: 0.3, wetLoss: 0.3, iceLoss: 0.5, mudLoss: 0.3 }, // plastic
      1: { dry: 0.01, dryMax: 0.02, thaw: 0.4, wear: 0.25, wetLoss: 0.85, wetLossRear: 0.92, wetCurveRear: 0.5, iceLoss: 0.5, mudLoss: 0.3, slick: { yaw: 1.6, pull: 0.012, spin: 0.004, align: 2.6, loss: 0.06, lift: 1.3, self: 5, selfMax: 2.5, selfPull: 0.015, curve: 1, angle: 0.6, capCurve: 1, capPull: 0.015 } }, // wood
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
      if (R.dry && wet > 0) wet = Math.max(0, wet - (R.dryMax ? Math.min(R.dryMax, R.dry * hot) : R.dry * hot) * dt);
      if (R.thaw && ice > 0) ice = Math.max(0, ice - R.thaw * hot * dt);
      if (R.mud && mud < R.mudCap) mud = Math.min(R.mudCap, mud + R.mud * dt);
      if (R.wetMud && wet > 0) mud = Math.min(1, mud + R.wetMud * wet * dt);
      if (R.wear && mud > 0) mud = Math.max(0, mud - R.wear * hot * (this.shed[vehicle] || 1) * dt);
      t.wet = wet;
      t.ice = ice;
      t.mud = mud;
    },
    // What the tyre's state does to its grip on surface u: 1 for a clean, dry tyre (and off the ground).
    factor(u, t, rear) {
      if (t.wet == 0 && t.ice == 0 && t.mud == 0) return 1;
      const R = this.row(u),
        a = rear && R.wetLossRear != null ? 1 - R.wetLossRear * t.wet ** (R.wetCurveRear || 1) : 1 - (R.wetLoss || 0) * t.wet,
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
      return g * this.factor(u, t, rear);
    },
  };

  // What each new surface does to a wheel touching it. Index = part.u (null: stock road, TM2020's Tech).
  // The newer surfaces also use: engine, the share of what the engine gains along the nose each frame that the surface
  // takes back (the tyres cannot put it down); brake, the share of the braking it takes back; roll, rolling drag (share of
  // the speed lost per second); slide, the share of the speed lost per second per sin^2(slip) while sliding; settle, see
  // the slide settling in fxStep; align (rad/s), how fast a let-go drift's path swings back to the nose (fxStep); yawAcc
  // and steerHelp, how the spin follows the steering (fxStep); loose,
  // ground where steering into a slide catches it (see fxStep); studBrake, the share of the braking taken back from a car
  // whose tyres hold on ice (iceAssist < 1), where the others brake badly anyway.
  // All by the share of wheels on the surface.
  const SURFACES = [
    // Plastic: almost no grip (30% more than the first 0.45 / 0.36), very strong acceleration at low speed, and it throws the
    // car back when hit side-on or roof-first. The rear lets go first, but a held full lock settles into a slide of about 20
    // degrees (cap) instead of spinning round (it spun at 100 to 250 km/h: 48 degrees after 1 s, 170 after 2), and off the
    // steering or countersteering the slide straightens like loose ground's (settle, align: the way the car goes swings
    // round to its nose keeping its speed), so a slide is easy to hold and to catch.
    { gripFront: 0.585, gripRear: 0.468, launch: 34, launchUntil: 45, bounce: true, settle: 0.003, align: 2.5, cap: { from: 0.3, self: 5, max: 2.5, pull: 0.015 } },
    // Wood: grips hard, like TM2020 dry wood: half as much again as before. The tyres' grip also limits braking, so while
    // the brake is down wood holds the car with brakeGrip instead, or it would stop dead.
    // Its extra push grows exponentially with speed (expo) up to `peak`, then fades to nothing by `end` (units per second),
    // so it pulls harder the faster you go without running away.
    // Like TM2020 wood it grips more the faster the car goes (turn). More tyre friction alone changes nothing here: the
    // game narrows the steering with speed (0.41 rad at full lock from rest, 0.04 at 200 km/h, 0.02 at 300), so the car
    // turns only as tightly as its front wheels point and its tyres never reach their limit on flat ground (tmphys.mjs:
    // wood at grip 1, 1.8 and 5 turns the same). So on wood the turn the steering asks for is made stronger: `turn` lists
    // [speed (units/s), extra share of that turn], in between straight lines, past the last one its value. Measured as
    // the full-lock turn rate against the stock car at the same speed after 1 s held (tmphys.mjs steer): low grip at low
    // speed, high at high speed, x1.06 at 20 km/h, x1.12 at 36, x1.4 at 100, x1.9 at 180, x2.3 at 260 and x2.5 from 330
    // up. The extra builds up the longer the steering is held (TURN_BUILD), so a short turn grips less than a long one.
    // turnFree: the same off the steering, where only the wheels' own turn is left (in a loop, or while they straighten
    // after a turn): the earlier table, so the no-steer offset loops, chaotic round a seam near the R20 top, still come
    // out on their line.
    // loadCap 2: the extra tyre grip holds up to twice the resting load (a hard corner, a compression), not a loop.
    { gripFront: 1.8, gripRear: 1.8, brakeGrip: 1.2, launch: 0, launchUntil: 0, bounce: false, expo: { push: 4, scale: 50, max: 24, peak: 83, end: 139 }, turn: [[3, 0], [6, 0.086], [8.2, 0.19], [10.7, 0.27], [14.1, 0.34], [18.4, 0.375], [24.3, 0.43], [27.8, 0.476], [32.9, 0.586], [44.3, 0.86], [50, 1.0], [57.3, 1.115], [66, 1.27], [72.2, 1.38], [82, 1.49], [91.7, 1.577], [110, 1.566], [127, 1.54]], turnFree: [[3, 0], [6, 1.725], [8.2, 2.408], [10.7, 2.281], [14.1, 1.895], [18.4, 1.393], [24.3, 1.225], [32.9, 1.149], [44.3, 1.032], [57.3, 0.935], [73.6, 0.908], [91.8, 0.893], [114, 0.878], [127, 0.875]], turnLevel: [3, 8], loadCap: 2 },
    // Penalty grass: soft grip and heavy drag that bleeds speed away while the wheels are on it.
    { gripFront: 0.55, gripRear: 0.5, launch: 0, launchUntil: 0, bounce: false, drag: 1.1 },
    // Platform ice: the tyres barely hold, so the car slides; steering turns the car itself (ice.yaw, rad/s) and the
    // way it is going swings round to its nose at ice.align x sin(slip) rad/s, so a held turn settles into a steady
    // slide instead of spinning. Sliding costs ice.loss x sin^2(slip) of the speed per second, and nothing else: the
    // engine keeps driving through a slide (SLIDE_DRIVE), so the car slides wider instead of slowing down, and a held
    // slide can gain (SLIDE_TECH). The tyres cannot put the engine down well either, so the launch push stands in for
    // it up to launchUntil. stick (units/s^2) presses the
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
    // and to brake (x1.6 the distance); rolling drag costs about 8% of the speed a second and a slide scrubs some
    // (slide), but keeps its drive (SLIDE_DRIVE), so a drift carries its speed.
    { gripFront: 0.7, gripRear: 0.6, launch: 0, launchUntil: 0, bounce: false, engine: 0.08, brake: 0.22, roll: 0.08, slide: 0.5, settle: 0.004, align: 3, loose: true },
    // Grass (TM's drivable grass, not the penalty verges): about half the grip, light and lively where dirt digs in: the
    // rear steps out easily (front grip a little over the rear's) and the slide is easy to hold and catch, with
    // steering help (steerHelp) and the spin's change held to yawAcc (see fxStep), so a slalom swings through like the
    // stock car's instead of stalling and snapping (tmphys grass: reversal at 180 km/h 50 ms collapse + 125 ms stall
    // before, a smooth 200 ms swing now; full lock gets to 90% of its turn in 195 ms, was 250). Rolling drag 12% a
    // second (was 20%: it felt heavy) still holds it well under the road's top end, and slides scrub little (slide).
    // x2 the braking distance.
    { gripFront: 0.58, gripRear: 0.48, launch: 0, launchUntil: 0, bounce: false, engine: 0, brake: 0.28, roll: 0.12, slide: 0.3, settle: 0.003, align: 2.5, loose: true, yawAcc: 12, steerHelp: [1, 0.01] },
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
  // air: in the air, steering yaws the car this much harder than nothing (1: no help). Every car is at 1 now: the Snow
  //   (1.2) and Desert (1.8) cars turned at 21 and 48 deg/s on the steering in the air, which felt like Rocket League's
  //   air control and tipped them over in a jump (the Desert car 45 degrees over 1 s into a jump with the steering held,
  //   the Stadium car 22), so no car steers in the air, as the Stadium car never did. The brake in the air is the game's
  //   own for every car: it steadies the car, and nothing here adds to it.
  // flight: the alt cars' steadier flights (see FLIGHT).
  // ices: the surfaces its tyres ice up on (see ICING); in TM2020 the Stadium car's tyres ice up too (the Snow car's
  //   studs never do). loose: on dirt, grass and snow the engine pulls with this factor instead of accel, and the top end
  //   drag does not count there (the Rally car is geared for loose ground).
  // look: hints for the page's car (tint: colour of the parts it adds).
  const VEHICLES = {
    Stadium: { grip: [1, 1, 1, 1, 1, 1, 1, 1, 1], iceAssist: 1, accel: null, topSpeed: 0, topDrag: 0, susp: null, air: 1, ices: [3, 4, 7], look: { tint: null } },
    // Snow: x3.5 on ice still slid like plastic and spun when let go (tmphys.mjs), so its studded tyres hold more,
    // the rear most (rearGrip: the rear tyres' own multipliers where given).
    Snow: { grip: [0.85, 0.85, 0.95, 1, 4.5, 3.5, 1.1, 1.1, 2.4], rearGrip: [0.85, 0.85, 0.95, 1, 5.5, 4.2, 1.1, 1.1, 2.4], iceAssist: 0.3, accel: [[1e9, 0.9]], topSpeed: 230 / 3.6, topDrag: 0.012, susp: { stiff: 0.7, damp: 1, roll: 1, rest: 0.08 }, air: 1, flight: true, ices: [], look: { tint: '#e9eef4' } },
    Rally: { grip: [0.9, 0.9, 1, 1, 1.3, 1.2, 1.45, 1.45, 1.2], iceAssist: 1, accel: [[150 / 3.6, 0.95], [1e9, 0.85]], loose: 1.05, topSpeed: 260 / 3.6, topDrag: 0.012, susp: { stiff: 0.6, damp: 0.8, dampIn: 0.3, roll: 1.5, rest: 0.03 }, air: 1, flight: true, ices: [3, 4, 7], look: { tint: '#c94a2a' } },
    Desert: { grip: [0.72, 0.75, 0.85, 1, 1, 1, 1.25, 1.25, 1], iceAssist: 1, accel: [[1e9, 1.05]], topSpeed: 330 / 3.6, topDrag: 0.012, susp: { stiff: 0.6, damp: 0.02, dampIn: 0.1, roll: 1.2, rest: 0.1 }, air: 1, flight: true, ices: [3, 4, 7], look: { tint: '#d6a24a' } },
  };
  // Test rigs only: {veh: {name: {setting: value}}} tries other settings for a vehicle.
  if (TEST && TEST.veh) for (const k in TEST.veh) Object.assign(VEHICLES[k], TEST.veh[k]);
  const GATES = { CarSnow: 'Snow', CarRally: 'Rally', CarDesert: 'Desert', CarStadium: 'Stadium' };
  // Air control for the cars that have it (air > 1): after `after` frames off the ground, steering pulls the yaw rate
  // towards yaw x steer, by pull x (air - 1) per frame.
  const AIR = { after: 20, yaw: 1.2, pull: 0.01 };
  // The alt cars' flights (VEHICLES flight): their softer, taller suspension throws the body off a ramp spinning harder
  // than the Stadium car (tmphys: off a kicker the Desert car pitched at up to 55 deg/s where the Stadium car leaves at
  // 24 to 40, and rolled up to 17 deg/s, so long jumps ended in flips). In the air, from the first frame off the ground,
  // their pitch spin is pulled (pull per frame) back inside +-pitchMax rad/s (the Stadium car's own range) and their roll
  // spin towards none (roll per frame). Nothing about their shape or hitbox changes, and the Stadium car is left exactly
  // as it is.
  const FLIGHT = { pitchMax: 0.62, pull: 0.02, roll: 0.01 };
  // Bumpers (TM2020's Bumper and Super bumper): one sideways kick per entry, square to the way the car is going in the
  // plate's plane, away from the line through the plate's centre along that way (inside `centre` units of it: to the
  // right), plus a hop (units/s). Platforms are driven every way, so the plate's own axes would brake a car crossing a
  // turned one. TM2020's bumpers fling the car hard: x2.5 the first kicks (14 and 24 units/s sideways, 2.5 and 4 up)
  // and a higher hop, so the tyres leave the deck and the kick is not scrubbed straight off by their grip (tmphys: 3 to
  // 4 times as far sideways 1 s on, the nose still pointing down the road).
  const BUMPER = { Bumper: { side: 36, up: 5 }, Bumper2: { side: 60, up: 7 }, centre: 0.25 };
  // A collision is added up over the frames it lasts (hit: per-frame velocity change that counts as contact,
  // window: longest collision in frames), then judged as a whole.
  // The bounce mirrors the car's velocity off the surface: the part along it is kept, the part into it comes back at
  // restitution x the speed it hit with, plus pop. Each bounce that follows another before the car is back on its wheels
  // (or within `chain` frames) has that rebound scaled by fade again, so a crash settles instead of hopping forever.
  // While the hit lasts the car's spin is held down (grip), and after the bounce it is zeroed and kept damped for
  // `steady` frames (calm per frame), so the car flies off flat the same way every time instead of tumbling.
  const BOUNCE = { hit: 0.5, window: 30, minInto: 4, share: 0.45, restitution: 1, pop: 3, cooldown: 150, grip: 0.6, steady: 250, calm: 0.97, chain: 8000, fade: 0.55 };

  // Countersteering on plastic and loose ground, once the car slides more than `from` (radians) above minSpeed (units
  // per second): the yaw rate is pulled by `pull` per frame towards catchRate x slip, eased off to at most maxRate
  // (rad/s). It builds up over rampIn frames of countersteer and fades over `hold` frames after it, so catching a big
  // slide swings the car round instead of snapping it. The way the car goes swings round to its nose meanwhile (the
  // surface's align, keeping its speed). Plastic's front tyres used to grip x2.4 while catching instead: they scrubbed the
  // slide off as speed (a 30 degree slide at 200 km/h caught by 300 ms of countersteer was at 184 km/h 1 s later, now
  // 218; straight again after 0.97 s, now 0.37).
  const SLIDE = { minSpeed: 8, from: 0.1, catchRate: 3, maxRate: 2.2, pull: 0.012, rampIn: 180, hold: 300 };
  if (TEST && TEST.slide) Object.assign(SLIDE, TEST.slide);
  // The extra turn of a surface's `turn` (wood) builds up the longer the steering is held one way, so a long turn grips
  // more than a short one: in full after `frames` frames (eased in), and it drops `fade` times as fast when the steering
  // is let go or turned the other way. A turn starts with `tap` of the extra (a 200 ms tap gets about a quarter, 400 ms
  // about half), and slow turns with more, `slow` up to slowFrom units per second, easing to `tap` by slowTo, so slow
  // hairpins bite at once. Off the steering the wheels' own turn, as in a loop, gets all of the surface's turnFree, eased
  // in over `settle` frames once the steering is let go, so the wheels straightening after a turn do not kick the car on.
  // hover: the same for the reactor hover's turn (REACTOR_HOVER): in full after 250 frames, only above `from` units per
  // second, in full from `full` up.
  const TURN_BUILD = { frames: 800, fade: 3, tap: 0.1, slow: 0.4, slowFrom: 8, slowTo: 14, settle: 300, hover: { frames: 250, fade: 3, from: 25, full: 55 } };
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
  // Slides on slippery ground keep the engine (TM2020: a car drifting on ice keeps rolling and keeps its drive). The
  // game's tyres (Bullet's raycast vehicle) share one friction limit, suspension force x friction slip, between the
  // sideways pull and the drive: once the sideways pull alone passes it, the wheel's drive is cut by the same factor
  // (its skidInfo, +280). On stock road the limit is far above any slide, but on ice it is a tenth of that, so the
  // first degrees of slide took nearly all the drive away (tmphys: full lock at 240 km/h on ice, the rear wheels' skid
  // 0.29 straight, 0.0006 sliding; the car lost 2.6 km/h per 100 ms against 0.5 straight). The drive that cut took, over
  // what the drive alone leaves (straight-line wheelspin stays as it is), is given back along the nose, by how slippery
  // the ground is: ice, bobsleigh and snow (ice), wet wood by its wetness (wet), an iced tyre by its icing (iced), dirt
  // and grass (loose). So a slide never drives harder than going straight. On loose ground only once the car slides
  // (in full past looseSlip[1] degrees, none under looseSlip[0]): a car cornering on the grip limit there (about 1
  // degree) keeps the cut, or the drive it got back pushed it into a slide (tmphys R60 circle on dirt: 145 km/h, 100
  // with the full give-back). Weaving while it still grips costs speed as before (the tyres' own limit).
  const SLIDE_DRIVE = { ice: 1, wet: 1, iced: 1, loose: 1, looseSlip: [0.5, 2] };
  if (TEST && TEST.slideDrive) Object.assign(SLIDE_DRIVE, TEST.slideDrive);
  // Speedslides and neoslides, after TM2020's techniques (trackmania.wiki Speedslide and Neoslide), fitted to PolyTrack's
  // speeds: TM2020's Stadium car tops out about 1000 km/h on the flat and PolyTrack's stock car about 676 (tmphys top),
  // so TM's speeds are taken x0.67 (400 km/h -> 270, 598 -> 400, 200 -> 135, 191 -> 128). Every window and strength is
  // this project's estimate of how they play in TM2020, not a measurement. Never on the stock road, dry wood or penalty
  // grass, so stock tracks stay exactly stock.
  // speed: a speedslide, a small slide held on the gas that beats driving straight: the car gets a push along the way it
  // is going of whatever brings its gain of speed this frame up to (1 + k) x its straight-line acceleration there (the
  // drive its wheels would put down going straight, the launch and wood pushes, less the game's damping and the rolling
  // drag; gravity along a slope counts as it would going straight), at most `cap` units/s^2, all of it once k reaches
  // `full` and that share of it below. So a slide held in the window, whatever it costs, gains k over driving straight,
  // and near the top speed, where that acceleration is nothing, it cannot push past it. k is the ground's value (by the
  // share of wheels) times how well the slide is held, in three kinds:
  //   ice: ice-sliding at the angle that accelerates best (TM's ice speedslide): platform ice, bobsleigh, snow (ice) and
  //     iced tyres (iced, by their icing); slip (degrees) inside slip [in, full from, full to, out], speed inside kmh.
  //   low: dirt and grass (loose), plastic and wet wood (wet, by the tyres' wetness as their grip goes): from about
  //     135 km/h (kmh: none under the first, all from the second), at a small angle that falls with speed (best:
  //     [km/h, degrees], 6 at 135 down to 2.5 near the top).
  //   road: the Trackmania road surface (tech, u 8; the bump road): from about 270 km/h, at a larger angle (10 at 270
  //     down to 5).
  //   low and road take the slide inside `window` x the best angle [in, full from, full to, out], and keep their push for
  //   up to `hold` frames while the slide swings through straight (a wiggle: quick alternating steering speedslides in a
  //   straight line). All three fade while the car spins (yaw rate rad/s), and ice also while its slide grows fast
  //   (slipRate rad/s).
  // neo: what a neoslide drift keeps: a little push (k) while it is held between end[0] and end[1] degrees, so a held
  // neoslide drift does not lose speed. The neoslide itself is a way to start a drift (KICK).
  const SLIDE_TECH = {
    speed: {
      ice: { ice: 0.4, iced: 0.3, slip: [3, 6, 8, 12], kmh: [100, 150] },
      low: { loose: 0.45, plastic: 0.3, wet: 0.25, kmh: [115, 135], best: [[135, 6], [650, 2.5]] },
      road: { tech: 0.25, kmh: [240, 270], best: [[270, 10], [650, 5]] },
      window: [0.5, 0.75, 1.4, 2],
      hold: 130,
      yaw: [1, 2],
    },
    neo: { k: 0.08, end: [5, 45], kmh: [20, 40] },
    slipRate: [0.4, 1.2],
    damp: 0.10536,
    cap: 30,
    full: 0.08,
  };
  // Starting a slide (TM2020's techniques, speeds x0.67 as above): the rear steps out to an angle at once, the yaw pulled
  // turned towards that slip by `gain` of the gap a frame (at most `step` radians) for `frames`, while the rear tyres keep `rear`
  // of their grip (back to all of it over the kick). The brake in the inputs counts as a tap: the speed it took is given
  // back when the kick starts and the brake is held off for `noBrake` frames.
  //   neo: a neoslide (TM's way to start a drift at low speed on full grip): steer one way for at least `held` frames,
  //     let go for gap[0] to gap[1] frames, then steer again with the brake pressed within `brake` frames of it. A drift
  //     of `deg` degrees from minKmh up, on plastic, dry wood, dirt, grass and the road surface (tech).
  //   s4d: a brake tap (at most `tap` frames) while steering, above the speedslide's speed for the ground (low or road
  //     kinds): a speedslide-sized slide (its best angle) without the brake's scrub.
  //   auto: an autoslide: above `kmh` on flat ground (wheels square to it), steering held longer than ms [at kmh[0],
  //     at kmh[1]] (shorter the faster) makes the rear step out to the best angle, once a press; a change of slope under
  //     the car while steering does too. Low and road kinds only, never on ice.
  const KICK = {
    gain: 0.03,
    step: 0.003,
    neo: { held: 100, gap: [30, 250], brake: 80, deg: 15, minKmh: 25, frames: 250, rear: 0.5, noBrake: 200 },
    s4d: { tap: 150, frames: 200, rear: 0.6 },
    auto: { kmh: [400, 650], ms: [100, 30], frames: 200, rear: 0.7 },
  };
  if (TEST && TEST.kick) for (const k in TEST.kick) typeof KICK[k] == 'object' ? Object.assign(KICK[k], TEST.kick[k]) : (KICK[k] = TEST.kick[k]);
  if (TEST && TEST.slideTech) for (const k in TEST.slideTech) typeof SLIDE_TECH[k] == 'object' ? Object.assign(SLIDE_TECH[k], TEST.slideTech[k]) : (SLIDE_TECH[k] = TEST.slideTech[k]);
  // How slippery a wheel's ground is by table T (SLIDE_DRIVE, SLIDE_TECH's): surface f, tyre t, the hover lift, and
  // loose: what loose ground counts for (SLIDE_DRIVE looseSlip).
  const slippery = (T, f, t, hover, loose = 1) => {
    const S = f == null || f < 0 ? null : SURFACES[f];
    let k = S && (S.ice || f == 7) ? T.ice : S && S.loose ? T.loose * loose : 0;
    if (hover > 0 && T == SLIDE_DRIVE) k = Math.max(k, (hover / REACTOR_HOVER.lift) * REACTOR_HOVER.drive);
    if (t.wet > 0 && TYRES.row(f).slick) k = Math.max(k, t.wet ** (TYRES.row(f).wetCurveRear || 1) * T.wet);
    if (t.ice > 0) k = Math.max(k, t.ice * T.iced);
    return k;
  };
  // A [x, y] table (x rising) at x: straight lines in between, its end values past either end.
  const lerpTable = (T, x) => {
    for (let i = 1; i < T.length; i++) if (x < T[i][0]) return T[i - 1][1] + ((T[i][1] - T[i - 1][1]) * Math.max(0, x - T[i - 1][0])) / (T[i][0] - T[i - 1][0]);
    return T[T.length - 1][1];
  };
  const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  // A wheel's speedslide kinds (SLIDE_TECH speed: ice, low, road) by its ground f and tyre t, added into into[0..2].
  const speedKinds = (f, t, into) => {
    const T = SLIDE_TECH.speed,
      S = f == null || f < 0 ? null : SURFACES[f];
    let ice = S && (S.ice || f == 7) ? T.ice.ice : 0,
      low = S && S.loose && f != 7 ? T.low.loose : f === 0 ? T.low.plastic : 0;
    if (t.ice > 0) ice = Math.max(ice, t.ice * T.ice.iced);
    if (t.wet > 0 && TYRES.row(f).slick) low = Math.max(low, t.wet ** (TYRES.row(f).wetCurveRear || 1) * T.low.wet);
    into[0] += ice;
    into[1] += low;
    into[2] += f === 8 ? T.road.tech : 0;
  };
  // Whether a neoslide can start on a wheel's ground: plastic, dry wood, dirt, grass and the road surface (tech).
  const neoGround = (f, t) => f === 0 || f === 5 || f === 6 || f === 8 || (f === 1 && t.wet < 0.05 && t.ice < 0.5);

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
    cars.set(carId, { zones, cells, active, spawns, walls, tops, lastCp: 0, hit: null, reactor: null, reactorLeft: 0, reactorEnd: 0, hover: 0, slow: false, slowTick: 0, lastState: null, ctl: null, tyres: [0, 1, 2, 3].map(TYRES.fresh), waterGuard: 0, overWater: false, skim: 0, yawWas: null, slipWas: null, slipRate: 0, boost: null, boostLeft: 0, noEngine: false, noBrake: false, noSteer: false, cruise: false, fragile: false, noGripLeft: 0, inside: new Set(), speed: 0, pulseReset: false, stockGrip: null, gas: false, justReset: false, last: null, bounceWait: 0, steady: 0, chainLeft: 0, chainLevel: 1, air: 0, landing: 0, bug: 0, bugV: 0, catchRamp: 0, turnRamp: 0, turnSide: 0, gripRamp: 0, gripSide: 0, gripIdle: 1e6, kickLeft: 0, kickFrames: 1, kickRear: 1, kickSide: 0, kickDeg: 0, kickWant: null, ctlFrames: 0, steerWas: 0, steerHeld: 0, steerGap: 1e6, neoArmed: false, neoAt: -1, neoSide: 0, brakeAt: -1e9, downRaw: false, tapSide: 0, noBrakeLeft: 0, canNeo: false, canTap: false, tapV: 0, tapAt: -1e9, downWas: false, autoSide: 0, pathWas: null, ssGap: 1e6, ssKeep: 0, neo: false, vehicle: start, cpVehicle: start, susp0: null, suspSet: false });
  }
  // Every effect on the car ends (effect blocks), no grip too. On a Reset effects block, a checkpoint and a respawn.
  // The vehicle stays (TM2020 keeps the car through effect resets), and so do wet, iced and muddy tyres: they are the
  // tyres' own state, not effects, and dry or thaw on the road. Only a respawn (or the respawn key) and the Reset wheels
  // block give clean tyres, see fxStep.
  const clear = (c) => {
    c.boostLeft = 0;
    c.boost = null;
    if (c.reactorLeft > 0 && c.reactor.dir > 0) c.reactorEnd = c.reactor.end; // an up boost cut short ends as one run out
    c.reactorLeft = 0;
    c.reactor = null;
    c.slow = false;
    c.noEngine = c.noBrake = c.noSteer = c.cruise = c.fragile = false;
    c.noGripLeft = 0;
  };
  // Filters the controls going into the car. Always returns a fresh object; stock tracks pass straight through.
  function fxControls(carId, r) {
    const c = cars.get(carId);
    if (TEST && TEST.bot && c) r = testBot(c, r);
    if (TEST && TEST.slipBot && c) r = slipBot(c, r);
    if (!c || !c.active) return r;
    c.raw = { up: !!r.up, right: !!r.right, down: !!r.down, left: !!r.left };
    const out = { up: r.up, right: r.right, down: r.down, left: r.left, reset: r.reset };
    if (c.pulseReset) {
      out.reset = true;
      c.pulseReset = false;
    }
    if (out.reset) {
      // The car it was at the checkpoint comes back in fxStep (justReset), however near the checkpoint it already was.
      clear(c);
      c.bug = c.catchRamp = c.turnRamp = c.gripRamp = c.kickLeft = c.noBrakeLeft = 0;
      c.kickWant = null;
      c.neo = false;
      c.justReset = true;
    }
    // Test rigs only: holds the gas while a reactor is on and the car is under hover.y (by its height lead seconds on).
    if (TEST && TEST.hover && c.reactorLeft > 0 && c.last) out.up = c.last.y + c.last.vy * TEST.hover.lead < TEST.hover.y;
    if (c.noEngine) out.up = false;
    if (c.noBrake) out.down = false;
    // Starting slides (KICK), from the controls as given: the neoslide's pattern (a held steer, a short gap, then the
    // steering again with the brake within `brake` frames of it) and the brake tap while steering (s4d). fxStep starts
    // the kick next, if the ground allows (canNeo, canTap from its last frame).
    {
      const K = KICK.neo,
        s = (r.left ? 1 : 0) - (r.right ? 1 : 0),
        down = !!r.down;
      c.ctlFrames++;
      if (s != 0 && s == c.steerWas) c.steerHeld++;
      else if (s != 0) {
        if (c.steerWas == 0 && c.neoArmed && c.steerGap >= K.gap[0] && c.steerGap <= K.gap[1]) (c.neoAt = c.ctlFrames), (c.neoSide = s);
        if (c.steerWas != 0) c.neoArmed = false;
        c.steerHeld = 1;
      } else {
        if (c.steerWas != 0) (c.neoArmed = c.steerHeld >= K.held), (c.steerGap = 0);
        c.steerGap = Math.min(1e6, c.steerGap + 1);
        c.steerHeld = 0;
      }
      c.steerWas = s;
      if (down && !c.downRaw) (c.brakeAt = c.ctlFrames), (c.tapSide = s);
      if (c.neoAt >= 0 && c.ctlFrames - c.neoAt > K.brake) c.neoAt = -1;
      if (c.neoAt >= 0 && s == c.neoSide && Math.abs(c.brakeAt - c.neoAt) <= K.brake && (down || c.ctlFrames == c.brakeAt) && c.canNeo) {
        c.kickWant = { neo: true, side: s };
        c.neoAt = -1;
        c.neoArmed = false;
        c.tapSide = 0;
        c.noBrakeLeft = K.noBrake;
      } else if (!down && c.downRaw && c.tapSide != 0 && s == c.tapSide && c.ctlFrames - c.brakeAt <= KICK.s4d.tap && c.canTap) c.kickWant = { neo: false, side: s };
      c.downRaw = down;
      // the brake of a neoslide counts as a tap
      if (c.noBrakeLeft > 0) c.noBrakeLeft--, (out.down = false);
    }
    if (c.noSteer) out.left = out.right = false;
    if (c.cruise) {
      out.up = true;
      out.down = false;
    }
    c.gas = out.up && !out.down;
    c.ctl = out;
    return out;
  }
  // Test rigs only: from frame `from` holds the car in a slide of `deg` degrees (within band) turning to side (1 left,
  // -1 right): steers in while the slide is smaller, countersteers while it is larger; for `lift` frames from `from` the
  // gas is off (and after that until the slide reaches liftTo degrees), for `brake` frames the brake is on, and for
  // `kick` frames it steers in whatever the slide (a neoslide's start).
  function slipBot(c, r) {
    const B = TEST.slipBot,
      f = c.tFrame ?? 0,
      out = { up: true, right: false, down: false, left: false, reset: false };
    if (f < B.from) return out;
    const sl = (-B.side * (c.tSlip ?? 0) * 180) / Math.PI;
    // the gas is off for `lift` frames and after that until the slide reaches liftTo degrees (at most liftMax frames)
    if (B.lift && f < B.from + B.lift) c.tLift = true;
    else if (c.tLift && (!B.liftTo || sl >= B.liftTo || f >= B.from + (B.liftMax || 1500))) c.tLift = false;
    if (c.tLift) out.up = false;
    if (B.brake && f < B.from + B.brake) (out.up = false), (out.down = true);
    // steering in (or out) for a share of every 40 frames that grows with how far off the slide is (gain per degree)
    const e = B.deg - sl,
      // base: the share of steering in while the slide is about right (on loose ground a slide let go of straightens)
      inn = e > -B.band ? Math.min(1, Math.max(0, (B.base || 0) + (e - B.band) * (B.gain ?? 1e9) - (B.kd || 0) * (c.slipRate || 0))) : 0,
      out2 = e < -B.band && B.counter !== false ? Math.min(1, (-e - B.band) * (B.gain ?? 1e9)) : 0,
      st = f < B.from + (B.kick || 0) ? B.side : f % 40 < inn * 40 ? B.side : f % 40 < out2 * 40 ? -B.side : 0;
    if (st > 0) out.left = true;
    else if (st < 0) out.right = true;
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
  // While a reactor boost hovers the car (REACTOR_HOVER) every rest length is c.hover longer and the damping stronger.
  function suspension(c, heap, carId) {
    const V = VEHICLES[c.vehicle];
    if (!V.susp && !c.suspSet && !c.hover) return;
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
      const hd = c.hover ? 1 + ((REACTOR_HOVER.damp - 1) * c.hover) / REACTOR_HOVER.lift : 1;
      if (!V.susp) {
        F[g + 51] = s0[0] + c.hover;
        F[g + 55] = s0[1] * hd;
        F[g + 56] = s0[2] * hd;
        F[g + 61] = s0[3];
        continue;
      }
      const S = V.susp,
        rest = s0[0] + S.rest + c.hover;
      F[g + 51] = heap[a + 84] && F[g + 8] < rest ? rest - (1 - S.stiff) * (rest - F[g + 8]) : rest;
      F[g + 55] = s0[1] * (S.dampIn ?? S.damp) * hd;
      F[g + 56] = s0[2] * S.damp * hd;
      F[g + 61] = s0[3] * S.roll;
    }
    c.suspSet = !!V.susp || c.hover > 0;
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
  // The car state's controls are what the page records a run from, and fxControls changes them (no brake while a
  // neoslide starts, No steer, No engine, No brake, Cruise; a held slow-motion frame repeats the last ones). A replay
  // feeds the recording through fxControls again, so a recording of the changed keys missed a neoslide's brake or the
  // steering under No steer: the replay drove another line and failed its check. fxRecord puts the keys the player
  // pressed (as the last fxControls got them) back into a state buffer (ArrayBuffer or Uint8Array, the layout fxStep
  // reads) before the worker hands it on; held: the state is a held slow-motion frame. The reset bit stays as driven: a
  // reset fxControls adds itself (Fragile) comes again on the replay. Stock tracks: nothing changes.
  function fxRecord(carId, state, held) {
    const c = cars.get(carId),
      r = c && c.active ? c.raw : null;
    if (!r || !c.ctl) return;
    const u = state instanceof Uint8Array ? state : new Uint8Array(state),
      flags = u[11];
    // id, frames, speed, flags, [finish], next checkpoint, position, quaternion, impulses, wheel contacts, 4 x 4 wheel
    // floats, steering, then the controls byte.
    let o = 12 + (flags & 2 ? 3 : 0) + 2 + 12 + 16;
    if (o >= u.length) return;
    o += 1 + 4 * u[o];
    for (let w = 0; w < 4; w++) if (flags & (8 << w)) o += 24;
    o += 64 + 4;
    if (o >= u.length) return;
    const bits = (x) => (x.up ? 1 : 0) | (x.right ? 2 : 0) | (x.down ? 4 : 0) | (x.left ? 8 : 0);
    // A stepped frame's byte holds the keys the car was given (c.ctl); anything else is not the controls byte.
    if (!held && (u[o] & 15) != bits(c.ctl)) return;
    u[o] = (u[o] & ~15) | bits(r);
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
    turnBody(F, body, av, ux, uy, uz, a);
  }
  // Turns the car's body (and its spin) by a radians about the unit axis u, leaving the way it goes as it was.
  function turnBody(F, body, av, ux, uy, uz, a) {
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

  // The share of what the engine gains along the nose that the surfaces under the car (their engine share, by the share
  // of wheels, less where the vehicle grips better) and the vehicle's accel (or, on loose ground, its loose factor) let
  // it keep (fxStep).
  function engineKeep(on, V, spd, looseWheels, contacts) {
    let keep = 1;
    for (let u = 0; u < on.length; u++) if (on[u] && SURFACES[u].engine) keep -= (SURFACES[u].engine * on[u]) / 4 / V.grip[u + 1];
    if (V.accel)
      for (const [until, k] of V.accel)
        if (spd < until) {
          keep *= V.loose && looseWheels ? k + ((V.loose - k) * looseWheels) / contacts : k;
          break;
        }
    return keep;
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
      c.hover = 0; // a hover lift ends at once: the car comes back on its own wheels
      c.reactorEnd = 0;
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
    const sqx = s.getFloat32(pos + 12, true),
      sqy = s.getFloat32(pos + 16, true),
      sqz = s.getFloat32(pos + 20, true),
      sqw = s.getFloat32(pos + 24, true);
    for (let i = 0; i < c.zones.length; i++) {
      const q = c.zones[i],
        wet = q.type == 'Water' || q.type == 'Shallow',
        // water by the car's middle; every effect from the first touch of the car's hull or wheels (fxTouch)
        hit = wet ? x >= q.min[0] && x <= q.max[0] && y >= q.min[1] && y <= q.max[1] && z >= q.min[2] && z <= q.max[2] : fxTouch(q, x, y, z, sqx, sqy, sqz, sqw);
      if (wet && x >= q.min[0] && x <= q.max[0] && z >= q.min[2] && z <= q.max[2] && y >= q.min[1] - 1 && y <= q.surface + 3) water = q;
      if (!hit) {
        inside.delete(i);
        continue;
      }
      if (inside.has(i)) continue;
      inside.add(i);
      if (TEST && TEST.trace) postMessage({ tmProbe: { fr: s.getUint8(4) | (s.getUint8(5) << 8) | (s.getUint8(6) << 16), carId, enter: q.type } });
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
        case 'Reactor2Oriented': {
          // Up or down by the way the car crosses it (reactorPick): its move since the last frame, or its nose.
          const L = c.last,
            moved = L && Math.abs(x - L.x) + Math.abs(y - L.y) + Math.abs(z - L.z) < 5;
          c.reactor = REACTOR[reactorPick(q, moved ? x - L.x : 0, moved ? y - L.y : 0, moved ? z - L.z : 0, s.getFloat32(pos + 12, true), s.getFloat32(pos + 16, true), s.getFloat32(pos + 20, true), s.getFloat32(pos + 24, true))];
          c.reactorLeft = c.reactor.frames;
          c.reactorEnd = 0;
          break;
        }
        case 'Slow':
          c.slow = true;
          break;
        case 'Reset':
          clear(c);
          break;
        case 'ResetWheels':
          // Clean, dry tyres and full grip again: wet, iced and muddy tyres and no grip end; every other effect stays.
          for (const t of c.tyres) t.wet = t.ice = t.mud = 0;
          c.noGripLeft = 0;
          break;
        case 'NoGrip':
          c.noGripLeft = NOGRIP.frames;
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
    if (TEST && (TEST.slipBot || TEST.holdSlip)) (c.tFrame = s.getUint8(4) | (s.getUint8(5) << 8) | (s.getUint8(6) << 16)), (c.tSlip = slip);
    // How far into the catch the car is, 0 to 1 (see SLIDE).
    c.catchRamp = counter ? Math.min(1, c.catchRamp + 1 / SLIDE.rampIn) : Math.max(0, c.catchRamp - 1 / SLIDE.hold);
    const ease = c.catchRamp * c.catchRamp * (3 - 2 * c.catchRamp);
    // How far the extra turns have built up (TURN_BUILD: gripRamp for the surfaces, turnRamp for the hover), 0 to 1, and
    // the way the steering is held.
    const HB = TURN_BUILD.hover;
    if (steer != 0 && steer == c.turnSide) c.turnRamp = Math.min(1, c.turnRamp + 1 / HB.frames);
    else if (c.turnRamp > 0) c.turnRamp = Math.max(0, c.turnRamp - HB.fade / HB.frames);
    else c.turnSide = steer;
    if (steer != 0 && steer == c.gripSide) c.gripRamp = Math.min(1, c.gripRamp + 1 / TURN_BUILD.frames);
    else if (c.gripRamp > 0) c.gripRamp = Math.max(0, c.gripRamp - TURN_BUILD.fade / TURN_BUILD.frames);
    else c.gripSide = steer;
    c.gripIdle = steer != 0 ? 0 : Math.min(1e6, c.gripIdle + 1);

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
      tyreOn = [0, 0, 0, 0, 0, 0, 0, 0, 0],
      // the load on the front (steered) wheels on each surface, added up (suspension force, +276), for the extra turn
      frontLoad = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    let plasticWheels = 0,
      wetRoll = 0, // the wet tyres' extra rolling drag (TYRES wetRoll), share of the speed per second, all wheels added up
      slideWheels = 0, // wheels on wet wood, each by its wetness, and how they handle (TYRES slick)
      slideIce = null,
      slideOn = 0; // and how many wheels that is
    if (c.stockGrip == null) c.stockGrip = F[(wheels + 228) >> 2];
    // No grip (NOGRIP), 0 to 1: in full until its last `fade` frames.
    const ngK = c.noGripLeft > 0 ? Math.min(1, c.noGripLeft / NOGRIP.fade) : 0;
    if (TEST && TEST.wheelGeo && !c.geoSent) (c.geoSent = true), postMessage({ tmProbe: { carId, geo: [0, 1, 2, 3].map((w) => { const g = (wheels + w * 284) >> 2; return { conn: [F[g + 39], F[g + 40], F[g + 41]], rest: F[g + 51], len: F[g + 8], radius: F[g + 53], centre: [F[g + 35], F[g + 36], F[g + 37]] }; }), pos: [x, y, z], q: [s.getFloat32(pos + 12, true), s.getFloat32(pos + 16, true), s.getFloat32(pos + 20, true), s.getFloat32(pos + 24, true)] } });
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
      drive = 0, // the drive to give back (SLIDE_DRIVE), as an impulse
      straight = 0, // the drive the wheels would put down going straight, as an impulse (once capped, below)
      straightCap = 0,
      // how much loose ground counts for SLIDE_DRIVE by how far the car slides (looseSlip)
      looseSlide = smooth(((Math.abs(slip) * 180) / Math.PI - SLIDE_DRIVE.looseSlip[0]) / (SLIDE_DRIVE.looseSlip[1] - SLIDE_DRIVE.looseSlip[0])),
      speedK = [0, 0, 0], // SLIDE_TECH speed's kinds (ice, low, road) by the ground, all wheels added up
      neoWheels = 0, // wheels on ground a neoslide starts on (neoGround)
      contacts = 0;
    for (let w = 0; w < 4; w++) {
      const a = wheels + w * 284,
        g = a >> 2,
        // the tyre's state, and how hot it runs from its skidInfo (+280)
        t = c.tyres[w],
        heat = TYRES.heatOf(F[g + 70]);
      // Test rigs only: {tyres: {wet, ice, mud}} holds every tyre in that state.
      if (TEST && TEST.tyres) Object.assign(t, TEST.tyres);
      if (TEST && TEST.trace) (c.probe ??= { u: [], grip: [] }), (c.probe.u[w] = TYRES.AIR), (c.probe.grip[w] = 0);
      if (TEST && TEST.trace && c.probe.load) c.probe.load[w] = 0;
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
      if (surface && surface.bounce) plasticWheels++;
      if (surface && surface.loose) looseWheels++;
      if (c.bug > 0) grip *= BUG.grip;
      // Wet, iced and muddy tyres (TYRES): from the state they came in with, so it counts from the next frame.
      const tk = TYRES.factor(f, t, w >= 2);
      if (tk != 1) grip *= tk;
      // Hovering on a reactor boost: a little floaty (REACTOR_HOVER grip), by how far up the car is.
      if (c.hover > 0) grip *= 1 - ((1 - REACTOR_HOVER.grip) * c.hover) / REACTOR_HOVER.lift;
      if (ngK > 0) grip *= 1 - (1 - NOGRIP.grip) * ngK;
      // A slide being started (KICK): the rear tyres let go a little, back to full grip over the kick.
      // Only until the slide is there, so a slippery deck does not spin round.
      if (w >= 2 && c.kickLeft > 0 && (Math.abs(slip) * 180) / Math.PI < c.kickDeg) grip *= 1 - (1 - c.kickRear) * (c.kickLeft / c.kickFrames);
      if (f != null) tyreOn[f] += tk;
      if (f != null && w < 2) frontLoad[f] += F[g + 69];
      if (t.wet > 0 && TYRES.row(f).wetRoll) wetRoll += TYRES.row(f).wetRoll * t.wet;
      if (t.wet > 0 && TYRES.row(f).slick) (slideWheels += t.wet), slideOn++, (slideIce = TYRES.row(f).slick);
      normals.push(F[g], F[g + 1], F[g + 2]);
      points.push(F[g + 4], F[g + 5], F[g + 6]);
      // The drive the slide took off this wheel in the last step (SLIDE_DRIVE): engine force at +252, by the friction
      // slip (+228) that step used, before it is set for the next.
      if (c.gas && F[g + 63] > 0 && F[g + 69] > 0) {
        const e = F[g + 63] * 0.001,
          alone = Math.min(1, (F[g + 69] * 0.001 * F[g + 57]) / (0.5 * e)),
          sd = ngK > 0 ? Math.max(ngK * SLIDE_DRIVE.ice, slippery(SLIDE_DRIVE, f, t, c.hover, looseSlide)) : slippery(SLIDE_DRIVE, f, t, c.hover, looseSlide);
        // what the driven wheels would put down driving straight (SLIDE_TECH): their drive and grip limits added up, so
        // a slide's shift of load from one side to the other does not count
        straight += e;
        straightCap += F[g + 69] * 0.001 * F[g + 57];
        // No grip keeps all of the drive: the wheelspin the low grip gives costs nothing either (NOGRIP).
        const al = ngK > 0 ? alone + (1 - alone) * ngK : alone;
        if (sd > 0 && al > F[g + 70]) drive += e * (al - F[g + 70]) * sd;
      }
      speedKinds(f, t, speedK);
      if (neoGround(f, t)) neoWheels++;
      F[g + 57] = c.stockGrip * grip;
      if (TEST && TEST.trace) (c.probe.u[w] = f ?? TYRES.ROAD), (c.probe.grip[w] = +grip.toFixed(3));
      if (TEST && TEST.trace) (c.probe.load ??= [0, 0, 0, 0]), (c.probe.load[w] = Math.round(F[g + 69]));
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

    // Grass (SURFACES yawAcc): the tyres change the car's spin no faster than yawAcc rad/s per second, on two wheels or
    // more on such ground (their mean). Bullet's tyres either hold fully or slide at their limit, and on ground this
    // slippery they flipped between the two through every change of steering: the spin collapsed from 50 deg/s to
    // nothing in 50 ms, stalled, then jumped (tmphys grass slalom), where the stock car swings smoothly through.
    {
      let ya = 0,
        yw = 0;
      for (let u = 0; u < on.length; u++) if (on[u] && SURFACES[u].yawAcc) (ya += SURFACES[u].yawAcc * on[u]), (yw += on[u]);
      if (yw >= 2 && c.yawWas != null) {
        const lim = (ya / yw) * 0.001,
          yaw = F[av] * upx + F[av + 1] * upy + F[av + 2] * upz,
          d = yaw - c.yawWas;
        if (Math.abs(d) > lim) {
          const k = c.yawWas + Math.sign(d) * lim - yaw;
          F[av] += upx * k;
          F[av + 1] += upy * k;
          F[av + 2] += upz * k;
        }
      }
    }

    if (straight > 0) straight *= Math.min(1, straightCap / (0.5 * straight));
    // Countersteering on plastic: the car's spin is pulled towards the way it is going, so a slide can be caught instead
    // of spinning out (and the way it goes swings round to the nose: align, below).
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
    // Wet wood (TYRES slick) does the same its own way when the car is not on ice already: its steering help by the
    // tyres' wetness over the four wheels (iceWeight), so drying tyres ease out of it, and off the steering the nose
    // swings back onto the way the car goes.
    let iceWeight = 1,
      slick = null;
    // Wet wood's pull of the nose towards the way the car goes (rad/s, + left) for the slide past `cap` radians.
    const held = (S, slip, cap) => {
      const x = Math.sign(slip) * Math.max(0, Math.abs(slip) - cap);
      return S.selfMax * Math.tanh((S.self * x) / S.selfMax);
    };
    if (iceWheels < 2 && slideWheels > 0) {
      if (!ice) ice = slick = slideIce;
      iceWeight = slick ? Math.min(1, slideWheels / 4) ** slick.curve : Math.min(1, slideWheels / 2);
      // A sliding tyre puts next to no sideways force down (its skid cuts it), so the way the car goes swings round to
      // the nose only by `align`: on wet wood by every wheel on it however wet, or a lightly wet car slid on straight.
      iceWheels += slick ? slideOn : slideWheels;
    }
    // No grip: steering and slides as on ice (NOGRIP ice), by how much of it is left, wherever the car is not on ice.
    if (ngK > 0 && contacts >= 2 && !(ice && !slick && iceWheels >= 2)) {
      ice = NOGRIP.ice;
      slick = null;
      iceWeight = ngK;
      iceWheels = contacts;
    }
    if (iceWheels >= 2 || iceWeight < 1) {
      // A car whose tyres hold on ice (the Snow car) gets only iceAssist of the steering and slide help; the spin still
      // dies away off the steering.
      const yaw = F[av] * upx + F[av + 1] * upy + F[av + 2] * upz,
        help = V.iceAssist,
        d0 =
          steer != 0
            ? (steer * ice.yaw * Math.min(1, spd / 15) * (slick && !c.gas ? slick.lift : 1) - yaw) * ice.pull
            : slick && Math.abs(slip) < 1.2 && spd > 3
              ? (held(slick, slip, 0) - yaw) * slick.selfPull
              : -yaw * ice.spin,
        // wet wood: a slide past what the tyres' wetness allows (slick angle x iceWeight^capCurve) is pulled back in, in
        // full whatever the wetness, so a less wet car slides less
        d = (help != 1 && steer != 0 ? d0 * help : d0) * iceWeight + (slick && steer != 0 ? held(slick, slip, slick.angle * iceWeight ** slick.capCurve) * slick.capPull : 0);
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
    let launchA = 0; // the launch push, units/s^2 (SLIDE_TECH)
    if (c.gas && launchWheels > 0) {
      const now = spd,
        fade = 1 - now / launchUntil;
      if (fade > 0) {
        const dv = launch * fade * (launchWheels / 4) * 0.001;
        launchA = dv * 1000;
        F[v] += fx * dv;
        F[v + 1] += fy * dv;
        F[v + 2] += fz * dv;
      }
    }

    // The drive a slide took (SLIDE_DRIVE), back along the nose, less what the surfaces and the vehicle take of the
    // engine's gain (engineKeep), as they would have of it. Body inverse mass at +344.
    if (drive > 0) {
      const dv = drive * F[(body + 344) >> 2] * engineKeep(on, V, spd, looseWheels, contacts);
      F[v] += fx * dv;
      F[v + 1] += fy * dv;
      F[v + 2] += fz * dv;
    }
    // Wood: extra push that grows exponentially with speed while the gas is down.
    let expoA = 0; // units/s^2 (SLIDE_TECH)
    if (c.gas && expoWheels > 0) {
      const now = Math.abs(speed) / 3.6,
        fade = Math.min(1, Math.max(0, (expo.end - now) / (expo.end - expo.peak))),
        a = Math.min(expo.max, expo.push * (Math.exp(now / expo.scale) - 1)) * fade * (expoWheels / 4) * 0.001;
      F[v] += fx * a;
      F[v + 1] += fy * a;
      F[v + 2] += fz * a;
      expoA = a * 1000;
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
      const B = TURN_BUILD,
        r = c.gripRamp,
        start = B.slow + (B.tap - B.slow) * Math.max(0, Math.min(1, (spd - B.slowFrom) / (B.slowTo - B.slowFrom))),
        held = 1 - (1 - start) * (1 - r * r * (3 - 2 * r)),
        build = steer != 0 ? held : held + (1 - held) * smooth(c.gripIdle / B.settle);
      const k = lerpTable(steer == 0 && SURFACES[u].turnFree ? SURFACES[u].turnFree : T, spd);
      // steering at +232 (wheels 0 and 1, 284 bytes apart); the wheels' places in the car at +156, z (+164) along the nose
      const angle = (F[(wheels + 232) >> 2] + F[(wheels + 284 + 232) >> 2]) / 2,
        base = F[(wheels + 164) >> 2] - F[(wheels + 2 * 284 + 164) >> 2],
        hold = Math.max(0, 1 - Math.abs(slip) / 0.35),
        tyres = tyreOn[u] / on[u],
        // The extra turn is the front tyres' grip, so it needs them on the surface and carrying weight: all of it while
        // the two front wheels there carry a resting wheel's load between them (a third of what they carry at rest),
        // none with them off the ground. Going light over a crest or off the lip of a jump, with the rear wheels still
        // touching, the car used to keep turning the way it was going (17 deg/s at 150 km/h where the stock road's car
        // turns 2), which felt like steering in the air.
        light = Math.min(1, frontLoad[u] / ((9.81 / F[(body + 344) >> 2]) / 4)),
        a = ((fwd * Math.tan(angle)) / base) * k * build * hold * level * tyres * V.grip[u + 1] * (on[u] / 4) * light * (1 - ngK) * 0.001;
      // Not while the game's own steering countersteers a slide against the way the steering is held (its wheels point
      // the other way): the extra turn then turned the car out of its own slide, and a wet car slid on in a straight line.
      if (a != 0 && base > 0.5 && !(steer != 0 && angle * steer < 0)) turnCar(F, body, v, av, gx / gl, gy / gl, gz / gl, a);
    }
    // Hovering (REACTOR_HOVER turn, push): the sharper turn as wood's, the harder pull on the gas.
    if (c.hover > 0 && contacts > 0 && gl > 0 && c.bug == 0) {
      const H = REACTOR_HOVER,
        up = c.hover / H.lift,
        HB = TURN_BUILD.hover,
        r = c.turnRamp,
        atSpeed = steer != 0 || r > 0 ? Math.max(0, Math.min(1, (spd - HB.from) / (HB.full - HB.from))) : 0,
        build = 1 - atSpeed * (1 - r * r * (3 - 2 * r)),
        angle = (F[(wheels + 232) >> 2] + F[(wheels + 284 + 232) >> 2]) / 2,
        base = F[(wheels + 164) >> 2] - F[(wheels + 2 * 284 + 164) >> 2],
        hold = Math.max(0, 1 - Math.abs(slip) / 0.35),
        a = ((fwd * Math.tan(angle)) / base) * H.turn * build * hold * up * 0.001;
      if (a != 0 && base > 0.5) turnCar(F, body, v, av, gx / gl, gy / gl, gz / gl, a);
      const fade = Math.max(-H.over, 1 - spd / H.pushUntil);
      if (c.gas && fade != 0 && fwd > 1) {
        const dv = H.push * fade * up * 0.001;
        F[v] += fx * dv;
        F[v + 1] += fy * dv;
        F[v + 2] += fz * dv;
      }
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

    // Starting slides (KICK): a neoslide or a brake tap asked for by fxControls, and autoslides; then the kick itself.
    const kmh = spd * 3.6,
      fastKind = speedK[2] > speedK[1] ? SLIDE_TECH.speed.road : SLIDE_TECH.speed.low,
      best = lerpTable(fastKind.best, kmh), // the speedslide's best angle here (degrees), low or road kind
      // a speedslide-sized slide can start here: on low or road ground (more of it than ice) at its speed
      tapGround = contacts >= 2 && speedK[1] + speedK[2] > speedK[0] && kmh >= fastKind.kmh[1];
    {
      const K = KICK,
        start = (side, deg, P) => {
          c.kickLeft = c.kickFrames = P.frames;
          c.kickRear = P.rear;
          c.kickSide = side;
          c.kickDeg = deg;
          // the brake in the inputs was a tap: the speed it took comes back
          if (c.tapV > spd && spd > 1 && c.ctlFrames - c.tapAt < 400) {
            const m = Math.min(c.tapV / spd, 1.25);
            F[v] *= m;
            F[v + 1] *= m;
            F[v + 2] *= m;
          }
        };
      if (c.ctl && c.ctl.down && !c.downWas) (c.tapV = spd), (c.tapAt = c.ctlFrames);
      c.downWas = !!(c.ctl && c.ctl.down);
      c.canNeo = contacts >= 2 && neoWheels * 2 >= contacts && kmh >= K.neo.minKmh && c.bug == 0;
      c.canTap = tapGround && c.bug == 0;
      if (c.kickWant) {
        const w = c.kickWant;
        c.kickWant = null;
        if (w.neo && c.canNeo) start(w.side, K.neo.deg, K.neo), (c.neo = true);
        else if (!w.neo && c.canTap) start(w.side, best, K.s4d);
      }
      // Autoslide: above auto.kmh on flat ground, the steering held long enough (or a change of slope under the car).
      if (steer == 0 || steer != c.autoSide) c.autoSide = 0;
      if (steer != 0 && c.autoSide == 0 && c.kickLeft == 0 && tapGround && kmh >= K.auto.kmh[0] && contacts >= 3) {
        const A = K.auto,
          ms = A.ms[0] + (A.ms[1] - A.ms[0]) * Math.min(1, (kmh - A.kmh[0]) / (A.kmh[1] - A.kmh[0]));
        if (kink || (square > 0.9945 && c.steerHeld >= ms)) start(steer, best, A), (c.autoSide = steer);
      }
      // The nose turned towards the slip asked for (- for a slide to the left: the car goes right of its nose), at most
      // step radians a frame, about the ground under the car.
      const toward = (deg, side, gain, step) => {
        const want = (-side * deg * Math.PI) / 180,
          a = Math.max(-step, Math.min(step, (slip - want) * gain));
        if (gl > 0) turnBody(F, body, av, gx / gl, gy / gl, gz / gl, a);
      };
      // Test rigs only: {holdSlip: {from, to, deg, side}} holds the car in a slide of deg degrees from frame `from` (until `to`).
      if (TEST && TEST.holdSlip && c.tFrame >= TEST.holdSlip.from && !(c.tFrame >= TEST.holdSlip.to) && contacts >= 2) toward(TEST.holdSlip.deg, TEST.holdSlip.side, 0.2, 0.01);
      // the way the car goes (heading about world up) and how fast it turns (rad/s), for the kick's end
      const path = Math.atan2(F[v], F[v + 2]),
        pathRate = c.pathWas == null ? 0 : (((path - c.pathWas + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 1000;
      c.pathWas = path;
      if (c.kickLeft > 0) {
        if (contacts >= 2) toward(c.kickDeg, c.kickSide, K.gain, K.step);
        // at its end the car spins as fast as its way turns, so the drift goes on from there instead of swinging wider
        if (--c.kickLeft == 0 && contacts >= 2 && Math.abs(upy) > 0.9) {
          const d = pathRate - (F[av] * upx + F[av + 1] * upy + F[av + 2] * upz);
          F[av] += upx * d;
          F[av + 1] += upy * d;
          F[av + 2] += upz * d;
        }
      }
    }

    // Speedslides and the neoslide drift's push (SLIDE_TECH), along the way the car is going.
    {
      const T = SLIDE_TECH,
        N = T.neo,
        S = T.speed,
        a = (Math.abs(slip) * 180) / Math.PI,
        was = c.slipWas ?? a;
      if (c.neo && contacts == 0) c.neo = false;
      else if (c.neo && c.kickLeft == 0 && (a < N.end[0] || a > N.end[1])) c.neo = false;
      c.slipWas = a;
      // how fast the slide grows (degrees/s), smoothed over about 50 ms: one frame's slip jitters with the contacts
      c.slipRate = (c.slipRate ?? 0) + ((a - was) * 1000 - (c.slipRate ?? 0)) * 0.02;
      if (c.gas && contacts > 0 && fwd > 0 && spd > 5 && (speedK[0] + speedK[1] + speedK[2] > 0 || c.neo)) {
        const trap = (x, w) => smooth((x - w[0]) / (w[1] - w[0])) * (1 - smooth((x - w[2]) / (w[3] - w[2]))),
          ramp = (x, w) => smooth((x - w[0]) / (w[1] - w[0])),
          yaw = Math.abs(F[av] * upx + F[av + 1] * upy + F[av + 2] * upz),
          calm = 1 - smooth(((Math.abs(c.slipRate) * Math.PI) / 180 - T.slipRate[0]) / (T.slipRate[1] - T.slipRate[0])),
          spin = 1 - smooth((yaw - S.yaw[0]) / (S.yaw[1] - S.yaw[0])),
          win = (B, n) => (n > 0 ? (n / 4) * trap(a / lerpTable(B.best, kmh), S.window) * ramp(kmh, B.kmh) : 0);
        // low and road kinds: in the window round the best angle, kept through a quick swing across straight (wiggle)
        let kw = win(S.low, speedK[1]) + win(S.road, speedK[2]);
        if (kw > 0) (c.ssKeep = kw), (c.ssGap = 0);
        else if (speedK[1] + speedK[2] > 0 && c.ssGap < S.hold && a < best * S.window[0]) (kw = c.ssKeep), c.ssGap++;
        else c.ssGap = S.hold;
        const ks = ((speedK[0] / 4) * trap(a, S.ice.slip) * ramp(kmh, S.ice.kmh) * calm + kw) * spin,
          kn = c.neo ? N.k * ramp(kmh, N.kmh) : 0,
          k = Math.max(ks, kn);
        if (k > 0) {
          // the straight-line acceleration here (units/s^2), and how fast the car is gaining speed this frame so far (the
          // game step and everything above), gravity along the way (G) taken out
          let roll = wetRoll / 4;
          for (let u = 0; u < on.length; u++) if (on[u] && SURFACES[u].roll) roll += (SURFACES[u].roll * on[u]) / 4;
          const sp = Math.hypot(F[v], F[v + 1], F[v + 2]),
            over = V.topSpeed && spd > V.topSpeed ? V.topDrag * (V.loose && contacts ? 1 - looseWheels / contacts : 1) * (spd - V.topSpeed) ** 2 : 0,
            net = straight * F[(body + 344) >> 2] * 1000 * engineKeep(on, V, spd, looseWheels, contacts) + launchA + expoA - (T.damp + roll) * spd - over,
            gain = c.last ? (sp - Math.hypot(c.last.vx, c.last.vy, c.last.vz)) * 1000 + (G * F[v + 1]) / spd : (1 + k) * net,
            push = Math.min(1, k / T.full) * Math.max(0, Math.min(T.cap, (1 + k) * Math.max(0, net) - gain));
          if (push > 0 && sp > 1) {
            const m = 1 + (push * 0.001) / sp;
            F[v] *= m;
            F[v + 1] *= m;
            F[v + 2] *= m;
          }
        }
      }
    }

    // Loose ground (dirt, grass, snow) lets the rear go. Steering into the slide catches it as on plastic: the yaw rate is
    // pulled towards catchRate x slip (SLIDE). Off the steering, and while catching (on plastic too),
    // the spin also dies away (settle: share of the yaw rate lost per frame, by the share of wheels), so a drift
    // straightens out when you let go or countersteer instead of spinning the car round.
    if (ease > 0 && looseWheels >= 2) {
      const yaw = F[av] * upx + F[av + 1] * upy + F[av + 2] * upz,
        d = (SLIDE.maxRate * Math.tanh((SLIDE.catchRate * slip) / SLIDE.maxRate) - yaw) * SLIDE.pull * ease * (looseWheels / 4);
      F[av] += upx * d;
      F[av + 1] += upy * d;
      F[av + 2] += upz * d;
    }
    // Steering help (SURFACES steerHelp: [rate rad/s, pull per frame], by the share of wheels): while steering, the spin is
    // also pulled towards the steering's way at that rate. On grass both axles' tyres reach their limit together and
    // their pulls on the spin nearly cancel (front grip x its arm against the rear's), so on a change of steering the car
    // stalled at about 3 deg/s for 100 to 200 ms before it turned the new way (tmphys grass slalom).
    if (steer != 0 && contacts > 0 && spd > 5) {
      let d = 0;
      const yaw = F[av] * upx + F[av + 1] * upy + F[av + 2] * upz;
      for (let u = 0; u < on.length; u++) if (on[u] && SURFACES[u].steerHelp) d += (steer * SURFACES[u].steerHelp[0] - yaw) * SURFACES[u].steerHelp[1] * (on[u] / 4);
      if (d) {
        F[av] += upx * d;
        F[av + 1] += upy * d;
        F[av + 2] += upz * d;
      }
    }
    // A surface's slide cap (SURFACES cap: {from, self, max, pull}, by the share of wheels): steering into the turn, a
    // slide past `from` radians is pulled back in (the spin eased off by max x tanh(self x the slide past it / max) x pull
    // rad/s a frame), so a held full lock settles into a slide instead of spinning round.
    if (steer != 0 && !counter && contacts > 0 && spd > SLIDE.minSpeed) {
      let d = 0;
      for (let u = 0; u < on.length; u++) {
        const C = on[u] && SURFACES[u].cap;
        if (!C) continue;
        const x = Math.sign(slip) * Math.max(0, Math.abs(slip) - C.from);
        d += C.max * Math.tanh((C.self * x) / C.max) * C.pull * (on[u] / 4);
      }
      if (d) {
        F[av] += upx * d;
        F[av + 1] += upy * d;
        F[av + 2] += upz * d;
      }
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
        const keep = engineKeep(on, V, spd, looseWheels, contacts);
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
      // Nothing about the pitch: the brake in the air steadies these cars exactly as it does the stock car (the game's
      // own air brake). It used to lift the nose here on top of that, which tipped the car instead of steadying it.
    }

    // The alt cars' steadier flights (FLIGHT): pitch spin back inside +-pitchMax, roll spin towards none.
    if (V.flight && contacts == 0) {
      const pitch = F[av] * lx + F[av + 1] * ly + F[av + 2] * lz,
        roll = F[av] * fx + F[av + 1] * fy + F[av + 2] * fz,
        dp = (Math.max(-FLIGHT.pitchMax, Math.min(FLIGHT.pitchMax, pitch)) - pitch) * FLIGHT.pull,
        dr = -roll * FLIGHT.roll;
      F[av] += lx * dp + fx * dr;
      F[av + 1] += ly * dp + fy * dr;
      F[av + 2] += lz * dp + fz * dr;
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
        c.skim = B.contact;
      }
      // Steering while a bounce still has the car on the water.
      if (c.skim > 0) {
        if (under > water.surface + B.touch) c.skim = 0;
        else {
          c.skim--;
          if (steer != 0) turnCar(F, body, v, av, 0, 1, 0, steer * B.steer * 0.001);
        }
      }
      c.overWater = under > water.surface;
    } else (c.overWater = true), (c.skim = 0);
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

    // Reactor boost (REACTOR): an up boost hovers the car over flat ground (REACTOR_HOVER, the lift goes into the
    // suspension before the next step) and pushes it up in the air on the gas; a down boost presses it into the ground,
    // or down through the air, on the gas. Off the ground steering turns the car and it is held level (REACTOR_AIR).
    let hoverWant = 0;
    if (c.reactorLeft > 0) {
      c.reactorLeft--;
      const R = c.reactor,
        H = REACTOR_HOVER,
        // the last stretch dies away with the jets: 0 on the boost's last frame
        fade = Math.min(1, c.reactorLeft / R.fade);
      if (c.reactorLeft == 0 && R.dir > 0) c.reactorEnd = R.end;
      // the ground under the car: the wheels' mean contact normal, and how level its steepest part is (flat: 1 within
      // flat[0] degrees of level, 0 past flat[1]), so the foot of a ramp counts from the first wheel on it
      let nx = 0,
        ny = 0,
        nz = 0,
        steep = 1;
      for (let i = 0; i < normals.length; i += 3) {
        nx += normals[i];
        ny += normals[i + 1];
        nz += normals[i + 2];
        steep = Math.min(steep, normals[i + 1]);
      }
      const level = (deg) => {
          const lo = Math.cos((deg[1] * Math.PI) / 180),
            hi = Math.cos((deg[0] * Math.PI) / 180),
            t = contacts > 0 ? Math.max(0, Math.min(1, (steep - lo) / (hi - lo))) : 0;
          return t * t * (3 - 2 * t);
        },
        nl = Math.hypot(nx, ny, nz),
        flat = level(H.flat);
      if (R.dir > 0) {
        hoverWant = (contacts > 0 ? H.lift * flat : H.lift) * fade;
        if (contacts == 0 && c.gas && c.air > H.airFrom) {
          const P = R.push,
            t = Math.min(1, (c.air - H.airFrom) / (H.airFull - H.airFrom)),
            k = P.base + P.extra * Math.max(-P.under, Math.min(1, 1 - F[v + 1] / P.vcap));
          F[v + 1] += G * k * t * t * (3 - 2 * t) * fade * 0.001;
        }
      } else if (c.gas) {
        const k = R.press * fade * 0.001;
        if (contacts > 0 && nl > 0) {
          F[v] -= (nx / nl) * k;
          F[v + 1] -= (ny / nl) * k;
          F[v + 2] -= (nz / nl) * k;
        } else F[v + 1] -= k;
      }
      // Hovering: held square to the ground, and its bobbing damped (REACTOR_HOVER hold, level, heave), by how far up
      // the car is and how flat the ground is (on the foot of a ramp the car pitches up onto it as on its wheels).
      const square = c.hover > 0 && contacts > 0 && nl > 0 ? level(H.holdFlat) : 0;
      if (square > 0) {
        const k = (c.hover / H.lift) * square,
          gx = nx / nl,
          gy = ny / nl,
          gz = nz / nl,
          // about car up x ground normal, by the angle between them
          ax = upy * gz - upz * gy,
          ay = upz * gx - upx * gz,
          az = upx * gy - upy * gx,
          sn = Math.hypot(ax, ay, az),
          a = sn > 1e-6 ? (Math.atan2(sn, upx * gx + upy * gy + upz * gz) * H.level) / sn : 0,
          yaw = F[av] * upx + F[av + 1] * upy + F[av + 2] * upz,
          m = H.hold * k;
        F[av] += (ax * a - (F[av] - upx * yaw)) * m;
        F[av + 1] += (ay * a - (F[av + 1] - upy * yaw)) * m;
        F[av + 2] += (az * a - (F[av + 2] - upz * yaw)) * m;
        // only off the ground: into it the springs take it, and on the foot of a ramp (where the wheels' mean normal
        // leans back) a damper both ways lifted the car off the ramp before it could launch it
        const vn = (F[v] * gx + F[v + 1] * gy + F[v + 2] * gz) * Math.min(1, H.heave * 0.001 * k);
        if (vn > 0) {
          F[v] -= gx * vn;
          F[v + 1] -= gy * vn;
          F[v + 2] -= gz * vn;
        }
        // the brake bites as hard as on the car's own legs (REACTOR_HOVER brake)
        if (c.ctl && c.ctl.down && fwd > 1) {
          const b = Math.min(fwd - 1, H.brake * k * 0.001);
          F[v] -= fx * b;
          F[v + 1] -= fy * b;
          F[v + 2] -= fz * b;
        }
      }
      if (contacts == 0) {
        const A = REACTOR_AIR,
          w = av,
          yaw = F[w] * upx + F[w + 1] * upy + F[w + 2] * upz,
          dy = (steer * A.yaw - yaw) * A.pull;
        // Pitch and roll spin: what is left of the spin once its part about the car's up is taken out.
        const px = F[w] - upx * yaw,
          py = F[w + 1] - upy * yaw,
          pz = F[w + 2] - upz * yaw;
        let tx = 0,
          ty = 0,
          tz = 0;
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
        F[w] += upx * dy + (tx - px) * A.calm;
        F[w + 1] += upy * dy + (ty - py) * A.calm;
        F[w + 2] += upz * dy + (tz - pz) * A.calm;
      }
    }
    // An up boost just ended (run out, a reset plate, a checkpoint): in the air its upward speed goes over `end` frames
    // (a straight line down to none), so the car peaks and falls at once. Only upward speed: nothing is added downwards
    // and the speed along the ground stays.
    if (c.reactorEnd > 0) {
      c.reactorEnd--;
      if (contacts == 0 && F[v + 1] > 0) F[v + 1] *= c.reactorEnd / (c.reactorEnd + 1);
    }
    if (c.hover != hoverWant) {
      const H = REACTOR_HOVER,
        gap = hoverWant - c.hover,
        was = c.hover;
      c.hover = Math.abs(gap) < 1e-4 ? hoverWant : c.hover + Math.max(-H.drop * 0.001, Math.min(H.rise * 0.001, gap * (gap < 0 ? H.easeDown : H.ease)));
      // On the ground the body goes up or down with the lift, along its own up, so the wheels stay exactly where they
      // were on the ground, as squeezed as before: the lift changes with no bounce, and coming down onto the foot of a
      // ramp the car is back on its own legs before the ramp turns up (rising on springs alone, the long legs bounced
      // the car off a ramp's foot). Bullet keeps the body's position twice: its world transform's origin (+52) and its
      // interpolated one's (+116).
      if (contacts > 0) {
        const d = c.hover - was;
        for (const o of [(body + 52) >> 2, (body + 116) >> 2]) {
          F[o] += upx * d;
          F[o + 1] += upy * d;
          F[o + 2] += upz * d;
        }
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

    if (c.noGripLeft > 0) c.noGripLeft--;
    if (c.boostLeft > 0) {
      c.boostLeft--;
      const dv = c.boost.accel * 2 * (c.boostLeft / c.boost.frames) * 0.001;
      F[v] += fx * dv;
      F[v + 1] += fy * dv;
      F[v + 2] += fz * dv;
    }
    c.last = { x, y, z, vx: F[v], vy: F[v + 1], vz: F[v + 2] };
    c.yawWas = F[av] * upx + F[av + 1] * upy + F[av + 2] * upz; // the spin about the car's up, for yawAcc
    if (TEST && TEST.trace) {
      const fr = s.getUint8(4) | (s.getUint8(5) << 8) | (s.getUint8(6) << 16);
      // per wheel; full: the exact values too (to compare against the page's own)
      const r3 = (q) => +q.toFixed(3);
      if (fr % TEST.trace == 0) postMessage({ tmProbe: { fr, carId, vehicle: c.vehicle, reactor: c.reactorLeft > 0 ? Object.keys(REACTOR).find((k) => REACTOR[k] === c.reactor) : null, reactorLeft: c.reactorLeft, reactorEnd: c.reactorEnd, hover: r3(c.hover), gas: c.gas, neo: c.neo, kick: c.kickLeft, kickDeg: r3(c.kickDeg), ssGap: c.ssGap, canTap: c.canTap, held: c.steerHeld, wet: c.tyres.map((t) => r3(t.wet)), ice: c.tyres.map((t) => r3(t.ice)), mud: c.tyres.map((t) => r3(t.mud)), u: c.probe ? [...c.probe.u] : null, grip: c.probe ? [...c.probe.grip] : null, load: c.probe && c.probe.load ? [...c.probe.load] : null, ...(TEST.full ? { tyres: c.tyres.map((t) => [t.wet, t.ice, t.mud]) } : {}) } });
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
    blocksUrl,
    shareBlocks,
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
    fxRecord,
    surfaces: SURFACES,
    // For the page: the cars (VEHICLES[name].look has the hints for drawing them), which gate gives which car, and the
    // tyre model itself (TYRES: the page steps its tyres with the same code). The page works out the car the same way: a
    // Car* zone entered switches it, a checkpoint keeps it for respawns, a respawn or the respawn key goes back to it, a
    // new car (start over) is the Stadium car.
    VEHICLES,
    vehicleGates: GATES,
    // The reactor boosts (the page's HUD and wheel jets work out the same effect from the car's states with reactorPick).
    REACTOR,
    REACTOR_TIME,
    REACTOR_PLATES,
    REACTOR_HOVER,
    reactorPick,
    NOGRIP,
    FX_BOX,
    fxTouch,
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
