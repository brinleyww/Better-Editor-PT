// Vehicle and tyre looks: the Snow, Rally and Desert cars a vehicle gate turns the car into, and tyres that get wet,
// icy or dirty from what they drive on. Page only, loaded after tm_water.js; it rides on tm_water's car hooks
// (TM.water.track / update / dispose), so anything that already calls those gets this too.
// Physics lives in tm_runtime.js. This file recomputes the vehicle from the car's state the same way the runtime decides
// it, the way tm_water.js recomputes water, so nothing has to come back from the worker.
self.TM.vehicles = (() => {
  const TM = self.TM;
  const W = TM.water;
  // The runtime's own tables where it has them (tm_runtime.js), so the page and the physics agree.
  const GATES = TM.vehicleGates ?? { CarSnow: 'Snow', CarRally: 'Rally', CarDesert: 'Desert', CarStadium: 'Stadium' };
  const VEHICLES = TM.VEHICLES ?? {};
  // A respawn moves the car further than it can drive. The runtime looks at one physics frame (5 units, Manhattan); here
  // a drawn frame can be many physics frames on, so the car may also cover what it was doing per frame, with room to
  // speed up (x 1.5), before a move counts as a respawn.
  const JUMP = 5;
  const cars = new WeakMap(); // car -> its gates, vehicle, tyre state and the parts it wears

  // ---- tyres --------------------------------------------------------------------------------------------------------
  // Wet and iced tyres follow the runtime (its WATER and ICING), so the look shows the grip the car really has: a tyre
  // whose bottom is under water soaks up, and dries on the ground but not on ice; a tyre on platform ice, bobsleigh or
  // snow ices up (not the Snow car's) and thaws on other ground; checkpoints and respawns clear both.
  // Dirt is only a look (part.u: dirt, and the two grasses a little), per second on the ground; water washes it off.
  const WET = TM.WATER ?? { soak: 0.6, dry: 0.1 };
  const ICING = TM.ICING ?? { surfaces: [3, 4, 7], on: 0.8, off: 0.4 };
  const ICE_SURFACES = [3, 4]; // where wet tyres do not dry (runtime: surfaces with ice handling)
  const DIRTY = { 5: 0.8, 2: 0.25, 6: 0.25 };
  const DIRT = { off: 0.04, wash: 0.5 };
  const TYRE_RADIUS = 0.33;
  const srgb = (h, k) => {
    const c = ((h >> (16 - 8 * k)) & 255) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lin = (h) => [srgb(h, 0), srgb(h, 1), srgb(h, 2)];
  const MUD = lin(0x6b4a2b),
    FROST = lin(0xdcecf7);

  function tint(w, mat) {
    const b = mat.__beTyre ?? (mat.__beTyre = { r: mat.color.r, g: mat.color.g, b: mat.color.b, rough: mat.roughness });
    const d = Math.min(1, w.dirt) * 0.85,
      i = Math.min(1, w.ice) * 0.75,
      wet = Math.min(1, w.wet),
      dark = 1 - 0.35 * wet;
    let r = b.r + (MUD[0] - b.r) * d,
      g = b.g + (MUD[1] - b.g) * d,
      bl = b.b + (MUD[2] - b.b) * d;
    r += (FROST[0] - r) * i;
    g += (FROST[1] - g) * i;
    bl += (FROST[2] - bl) * i;
    mat.color.setRGB(r * dark, g * dark, bl * dark);
    // Wet rubber shines. Only roughness: clearcoat would recompile the shader the first time it turns on.
    mat.roughness = b.rough + (0.18 - b.rough) * wet * (1 - i);
  }

  // ---- low-poly parts -----------------------------------------------------------------------------------------------
  // Plain triangle lists (no index), so computeVertexNormals gives the flat faces the rest of PolyTrack has. Every shape is
  // convex, so a face is turned to point away from the shape's centre.
  function face(out, cx, cy, cz, a, b, c) {
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2],
      vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2],
      nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx,
      out_ = nx * (a[0] - cx) + ny * (a[1] - cy) + nz * (a[2] - cz) >= 0;
    out.push(...a, ...(out_ ? b : c), ...(out_ ? c : b));
  }
  // A box of half sizes h at (x, y, z), turned by rx about the x axis round (ox, oy, oz) (studs round a tyre, flaps).
  function box(out, x, y, z, hx, hy, hz, rx = 0, oy = 0, oz = 0) {
    const s = Math.sin(rx),
      c = Math.cos(rx),
      P = [];
    for (let k = 0; k < 8; k++) {
      const px = x + (k & 1 ? hx : -hx),
        py = y + (k & 2 ? hy : -hy) - oy,
        pz = z + (k & 4 ? hz : -hz) - oz;
      P.push([px, oy + py * c - pz * s, oz + py * s + pz * c]);
    }
    const cy = oy + (y - oy) * c - (z - oz) * s,
      cz = oz + (y - oy) * s + (z - oz) * c;
    for (const [a, b, d, e] of [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]]) {
      face(out, x, cy, cz, P[a], P[b], P[d]);
      face(out, x, cy, cz, P[a], P[d], P[e]);
    }
  }
  // An n-sided disc of radius r and half thickness h round axis 0 (x) or 1 (y), centred at (x, y, z).
  function disc(out, n, r, h, axis, x, y, z) {
    const at = (k, side) => {
      const a = ((k + 0.5) / n) * Math.PI * 2,
        u = Math.cos(a) * r,
        v = Math.sin(a) * r;
      return axis == 0 ? [x + side * h, y + u, z + v] : [x + u, y + side * h, z + v];
    };
    for (let k = 0; k < n; k++) {
      const a0 = at(k, -1),
        a1 = at(k + 1, -1),
        b0 = at(k, 1),
        b1 = at(k + 1, 1);
      face(out, x, y, z, a0, a1, b1);
      face(out, x, y, z, a0, b1, b0);
      face(out, x, y, z, axis == 0 ? [x - h, y, z] : [x, y - h, z], a0, a1);
      face(out, x, y, z, axis == 0 ? [x + h, y, z] : [x, y + h, z], b0, b1);
    }
  }

  // The highest point of the body over a patch (body frame), so roof and bonnet parts sit on whatever body the car has.
  function topOf(body, x0, x1, z0, z1, fallback) {
    const p = body.geometry?.attributes?.position;
    if (!p) return fallback;
    let top = -Infinity;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        z = p.getZ(i);
      if (x >= x0 && x <= x1 && z >= z0 && z <= z1) top = Math.max(top, p.getY(i));
    }
    return top > -Infinity ? top : fallback;
  }

  // Body frame: the body mesh's own (car.glb "Body"): +z is the nose, +x the left, the origin 0.6 over the car's.
  // Wheels sit at x 0.63 (front) / 0.72 (rear), z 1.35 / -1.53, about y -0.41, radius 0.33, half width 0.17.
  const WHEELS = [[0.628, 1.348], [-0.628, 1.348], [0.721, -1.527], [-0.721, -1.527]];
  const WHEEL_Y = -0.41;
  const COLORS = {
    Snow: { main: 0xeef3f8, accent: 0x3e9ad6, dark: 0x27313d, lamp: 0xf4fbff },
    Rally: { main: 0xe8761e, accent: 0xf2c230, dark: 0x1c1c1e, lamp: 0xfff1b8 },
    Desert: { main: 0xd2b072, accent: 0xa4743c, dark: 0x362d24, lamp: 0xfff6dc },
  };
  // lift: how much higher the body rides over its wheels than the Stadium car's; the runtime already raises the car by its
  // suspension (VEHICLES[name].susp.rest), and only the rest is drawn. tyre: wheel width and size. Each look is a list of
  // [colour, triangles] for the body and one for each wheel (in the wheel's own frame: axle along x).
  const LOOKS = {
    // Snow car: a tall buggy on big studded tyres with white rims, a roll hoop, a blue nudge bar and a roof light bar.
    Snow: {
      lift: 0.1,
      tyre: [1.25, 1.06],
      body(T, car, nose, tail) {
        const main = [],
          accent = [],
          dark = [],
          lamp = [];
        const hoopZ = -0.55,
          hoopY = topOf(car, -0.3, 0.3, hoopZ - 0.2, hoopZ + 0.2, 0.3);
        for (const s of [-1, 1]) box(main, s * 0.47, hoopY + 0.06, hoopZ, 0.035, 0.2, 0.035);
        box(main, 0, hoopY + 0.25, hoopZ, 0.505, 0.035, 0.04);
        for (const s of [-1, 1]) box(main, s * 0.47, hoopY + 0.22, hoopZ - 0.35, 0.03, 0.03, 0.36, -0.45, hoopY + 0.25, hoopZ);
        box(accent, 0, -0.2, nose + 0.06, 0.6, 0.05, 0.05);
        for (const s of [-1, 1]) box(accent, s * 0.5, -0.11, nose + 0.02, 0.04, 0.09, 0.05);
        box(dark, 0, hoopY + 0.3, hoopZ + 0.02, 0.4, 0.03, 0.05);
        for (let k = 0; k < 4; k++) box(lamp, -0.3 + k * 0.2, hoopY + 0.3, hoopZ + 0.08, 0.06, 0.035, 0.02);
        box(accent, 0, -0.04, tail - 0.01, 0.55, 0.03, 0.015);
        return [[T.main, main], [T.accent, accent], [T.dark, dark], [T.lamp, lamp, true]];
      },
      wheel(T) {
        const studs = [],
          rim = [];
        for (let k = 0; k < 12; k++)
          for (const x of [-0.08, 0.08]) {
            const a = ((k + (x > 0 ? 0.5 : 0)) / 12) * Math.PI * 2;
            box(studs, x, 0.335, 0, 0.035, 0.022, 0.035, a, 0, 0);
          }
        disc(rim, 8, 0.2, 0.178, 0, 0, 0, 0);
        return [[T.main, studs], [T.main, rim]];
      },
    },
    // Rally car: raised, with mud flaps behind every wheel, a big orange rear wing and a light pod on the bonnet.
    Rally: {
      lift: 0.06,
      tyre: [1.1, 1],
      body(T, car, nose, tail) {
        const main = [],
          accent = [],
          dark = [],
          lamp = [];
        const wingY = topOf(car, -0.4, 0.4, tail + 0.05, tail + 0.5, 0.15) + 0.2,
          wingZ = tail + 0.28;
        box(main, 0, wingY, wingZ, 0.66, 0.025, 0.17);
        for (const s of [-1, 1]) box(main, s * 0.64, wingY + 0.06, wingZ, 0.02, 0.09, 0.19);
        for (const s of [-1, 1]) box(dark, s * 0.32, wingY - 0.11, wingZ + 0.04, 0.025, 0.1, 0.05);
        for (const [x, z] of WHEELS) {
          box(dark, x, WHEEL_Y - 0.01, z - 0.43, 0.15, 0.13, 0.012);
          box(main, x, WHEEL_Y + 0.13, z - 0.43, 0.15, 0.02, 0.016);
        }
        const podZ = nose - 0.42,
          podY = topOf(car, -0.4, 0.4, podZ - 0.1, podZ + 0.1, 0.05);
        box(dark, 0, podY + 0.04, podZ, 0.42, 0.06, 0.05);
        for (let k = 0; k < 4; k++) box(lamp, -0.315 + k * 0.21, podY + 0.04, podZ + 0.055, 0.075, 0.045, 0.01);
        box(accent, 0, podY + 0.105, podZ, 0.42, 0.012, 0.05);
        return [[T.main, main], [T.accent, accent], [T.dark, dark], [T.lamp, lamp, true]];
      },
      wheel: null,
    },
    // Desert car: wide and tall on long-travel suspension, sand fender flares, rock sliders, a spare wheel and a light bar.
    Desert: {
      lift: 0.14,
      tyre: [1.35, 1.08],
      body(T, car, nose, tail) {
        const main = [],
          accent = [],
          dark = [],
          lamp = [];
        for (const [x, z] of WHEELS) {
          const fx = x + Math.sign(x) * 0.08,
            y = WHEEL_Y + 0.44;
          box(main, fx, y, z, 0.15, 0.03, 0.22);
          box(main, fx, y - 0.04, z + 0.3, 0.15, 0.03, 0.12, 0.7, y, z + 0.2);
          box(main, fx, y - 0.04, z - 0.3, 0.15, 0.03, 0.12, -0.7, y, z - 0.2);
        }
        for (const s of [-1, 1]) box(accent, s * 0.68, -0.3, -0.1, 0.05, 0.04, 0.85);
        const deckY = topOf(car, -0.4, 0.4, tail + 0.1, tail + 0.6, 0.1);
        disc(dark, 8, 0.26, 0.08, 1, 0, deckY + 0.08, tail + 0.42);
        disc(accent, 8, 0.12, 0.085, 1, 0, deckY + 0.08, tail + 0.42);
        const barZ = -0.15,
          barY = topOf(car, -0.3, 0.3, barZ - 0.2, barZ + 0.2, 0.3) + 0.08;
        box(dark, 0, barY, barZ, 0.48, 0.03, 0.05);
        for (const s of [-1, 1]) box(dark, s * 0.4, barY - 0.05, barZ, 0.025, 0.05, 0.025);
        for (let k = 0; k < 5; k++) box(lamp, -0.36 + k * 0.18, barY + 0.005, barZ + 0.055, 0.06, 0.03, 0.01);
        box(main, 0, -0.18, nose + 0.05, 0.55, 0.06, 0.05);
        for (const s of [-1, 1]) box(dark, s * 0.36, -0.05, nose + 0.03, 0.035, 0.12, 0.035);
        return [[T.main, main], [T.accent, accent], [T.dark, dark], [T.lamp, lamp, true]];
      },
      wheel(T) {
        const hub = [];
        disc(hub, 6, 0.12, 0.178, 0, 0, 0, 0);
        return [[T.accent, hub]];
      },
    },
  };

  function mesh(three, sw, list, opacity) {
    const out = [];
    for (const [color, tris, glow] of list) {
      if (!tris.length) continue;
      const g = new three.LoY();
      g.setAttribute('position', new three.THS(new Float32Array(tris), 3));
      g.computeVertexNormals();
      const m = new three._4j({ color, roughness: glow ? 0.3 : 0.62, metalness: 0.05, flatShading: true, side: 2 });
      if (glow) {
        m.emissive.setHex(color);
        m.emissiveIntensity = 0.35;
      }
      if (opacity < 1) {
        m.opacity = opacity;
        m.transparent = true;
      }
      sw.addMaterial?.(m); // the scene's shadow setup patches every car material's shader
      const o = new three.eaF(g, m);
      o.castShadow = true;
      o.frustumCulled = false;
      out.push(o);
    }
    return out;
  }

  // ---- the car's own objects ----------------------------------------------------------------------------------------
  // The car's group sits right in the scene; its body is the mesh whose matrix is getChassisMatrix(), the wheels are the
  // meshes with a "Tire" material, in the order the game added them (front left, front right, rear left, rear right).
  function findRig(car, sw) {
    const m = car.getChassisMatrix?.();
    if (!m) return null;
    for (const g of sw.scene.children)
      for (const k of g.children ?? [])
        if (k.matrix === m) {
          const rig = { root: g, body: k, wheels: [null, null, null, null], tyres: [null, null, null, null] };
          wheelsOf(rig);
          return rig;
        }
    return null;
  }
  // The rims can be swapped (car style), which replaces the wheel meshes: picked up again every frame, no allocations.
  function wheelsOf(rig) {
    let n = 0,
      changed = false;
    for (const k of rig.root.children) {
      if (n == 4 || k === rig.body || !Array.isArray(k.material)) continue;
      let tyre = null;
      for (const mt of k.material) if (mt.name == 'Tire') tyre = mt;
      if (!tyre) continue;
      if (rig.wheels[n] !== k) (rig.wheels[n] = k), (changed = true);
      rig.tyres[n++] = tyre;
    }
    return changed;
  }

  // The body rides `lift` higher: the game writes the body's matrix itself every frame (multiply by the mass offset),
  // so the lift goes in right after that step, along the body's own up axis. The suspension copies the body matrix.
  function setLift(rig, lift) {
    const M = rig.body.matrix;
    if (!lift) return void delete M.multiply;
    const base = Object.getPrototypeOf(M).multiply;
    M.multiply = function (m) {
      base.call(this, m);
      const e = this.elements;
      e[12] += e[4] * lift;
      e[13] += e[5] * lift;
      e[14] += e[6] * lift;
      return this;
    };
  }

  function wear(c, sw, three) {
    const rig = c.rig;
    takeOff(c, sw);
    const look = LOOKS[c.vehicle];
    if (!look) return;
    // The runtime's colour hint for the car, where it has one, leads its parts.
    const T = { ...COLORS[c.vehicle], main: VEHICLES[c.vehicle]?.look?.tint ?? COLORS[c.vehicle].main },
      opacity = rig.tyres[0]?.opacity ?? 1,
      nose = zEdge(rig.body, 1),
      tail = zEdge(rig.body, -1);
    c.parts = mesh(three, sw, look.body(T, rig.body, nose, tail), opacity);
    for (const o of c.parts) rig.body.add(o);
    c.wheelGeo = look.wheel ? look.wheel(T) : null;
    c.wheelParts = [];
    dressWheels(c, sw, three, opacity);
    setLift(rig, Math.max(0, look.lift - (VEHICLES[c.vehicle]?.susp?.rest ?? 0)));
    c.look = look;
  }
  function dressWheels(c, sw, three, opacity) {
    const rig = c.rig,
      look = LOOKS[c.vehicle];
    for (const o of c.wheelParts ?? []) unhook(o, sw);
    c.wheelParts = [];
    for (const w of rig.wheels) {
      if (!w) continue;
      const sx = Math.sign(w.scale.x) || 1;
      w.scale.set(sx * (look?.tyre[0] ?? 1), look?.tyre[1] ?? 1, look?.tyre[1] ?? 1);
      if (!c.wheelGeo) continue;
      for (const o of mesh(three, sw, c.wheelGeo, opacity)) {
        w.add(o);
        c.wheelParts.push(o);
      }
    }
  }
  // How far the body reaches towards the nose (+1) or the tail (-1).
  function zEdge(body, dir) {
    const b = body.geometry?.boundingBox ?? (body.geometry?.computeBoundingBox(), body.geometry?.boundingBox);
    return b ? (dir > 0 ? b.max.z : b.min.z) : dir * 1.8;
  }
  function unhook(o, sw) {
    o.parent?.remove(o);
    sw.removeMaterial?.(o.material);
    o.geometry.dispose();
    o.material.dispose();
  }
  function takeOff(c, sw) {
    for (const o of c.parts ?? []) unhook(o, sw);
    for (const o of c.wheelParts ?? []) unhook(o, sw);
    c.parts = c.wheelParts = null;
    c.wheelGeo = null;
    c.look = null;
    if (!c.rig) return;
    setLift(c.rig, 0);
    for (const w of c.rig.wheels) if (w) w.scale.set(Math.sign(w.scale.x) || 1, 1, 1);
  }

  // ---- which vehicle ------------------------------------------------------------------------------------------------
  // Like the runtime: a gate counts when the car's origin enters its box. Between two drawn frames the car can be 20 or
  // more physics frames on, so the step from the last position is checked against the box, not just the end point.
  function entry(q, x0, y0, z0, x1, y1, z1) {
    let t0 = 0,
      t1 = 1;
    for (let a = 0; a < 3; a++) {
      const p = a == 0 ? x0 : a == 1 ? y0 : z0,
        d = (a == 0 ? x1 : a == 1 ? y1 : z1) - p;
      if (Math.abs(d) < 1e-9) {
        if (p < q.min[a] || p > q.max[a]) return -1;
        continue;
      }
      const ta = (q.min[a] - p) / d,
        tb = (q.max[a] - p) / d;
      if (Math.min(ta, tb) > t0) t0 = Math.min(ta, tb);
      if (Math.max(ta, tb) < t1) t1 = Math.max(ta, tb);
      if (t0 > t1) return -1;
    }
    return t0;
  }
  const inBox = (q, x, y, z) => x >= q.min[0] && x <= q.max[0] && y >= q.min[1] && y <= q.max[1] && z >= q.min[2] && z <= q.max[2];

  function restart(c, s) {
    c.vehicle = c.cpVehicle = 'Stadium';
    c.inside.fill(0);
    c.n = s.nextCheckpointIndex;
    c.x = s.position.x;
    c.y = s.position.y;
    c.z = s.position.z;
    c.rate = 0;
    c.tyre.forEach((w) => (w.wet = w.ice = w.dirt = 0));
  }

  function step(c, s) {
    const p = s.position;
    if (c.f < 0 || s.frames < c.f || !s.hasStarted) restart(c, s);
    let x0 = c.x,
      y0 = c.y,
      z0 = c.z;
    const steps = Math.max(1, s.frames - Math.max(c.f, 0)),
      moved = Math.abs(p.x - x0) + Math.abs(p.y - y0) + Math.abs(p.z - z0),
      respawn = moved > JUMP + 1.5 * steps * Math.max(c.rate, 0.03); // 0.03 units a frame = 108 km/h
    c.rate = respawn ? 0 : moved / steps;
    if (respawn) {
      // Back to the vehicle the car had at its last checkpoint. The runtime clears wet and iced tyres there too.
      c.vehicle = c.cpVehicle;
      for (const w of c.tyre) w.wet = w.ice = 0;
      x0 = p.x;
      y0 = p.y;
      z0 = p.z;
    }
    if (s.nextCheckpointIndex > c.n) {
      c.cpVehicle = c.vehicle;
      for (const w of c.tyre) w.wet = w.ice = 0;
    }
    c.n = s.nextCheckpointIndex;
    let best = -1,
      bestT = -1;
    for (let i = 0; i < c.gates.length; i++) {
      const q = c.gates[i],
        now = inBox(q, p.x, p.y, p.z) ? 1 : 0;
      if (!c.inside[i]) {
        const t = entry(q, x0, y0, z0, p.x, p.y, p.z);
        if (t >= 0 && t >= bestT) (best = i), (bestT = t);
      }
      c.inside[i] = now;
    }
    if (best >= 0) c.vehicle = GATES[c.gates[best].type];
    c.x = p.x;
    c.y = p.y;
    c.z = p.z;
  }

  function soak(c, s, dt) {
    const p = s.position;
    let water = null; // the water the car is in or just above, as the runtime finds it
    for (const q of c.water)
      if (p.x >= q.min[0] && p.x <= q.max[0] && p.z >= q.min[2] && p.z <= q.max[2] && p.y >= q.min[1] - 1 && p.y <= (q.surface ?? q.max[1]) + 3) {
        water = q;
        break;
      }
    const ices = VEHICLES[c.vehicle]?.ices ?? c.vehicle != 'Snow';
    for (let i = 0; i < 4; i++) {
      const w = c.tyre[i],
        contact = s.wheelContact[i],
        wheel = c.rig.wheels[i],
        soaking = water != null && wheel != null && wheel.position.y - TYRE_RADIUS < (water.surface ?? water.max[1]);
      if (soaking) {
        w.wet = Math.min(1, w.wet + WET.soak * dt);
        w.dirt = Math.max(0, w.dirt - DIRT.wash * dt);
      }
      if (!contact) continue;
      const u = c.surfaces ? surfaceAt(c, contact) : null,
        icy = ICING.surfaces.includes(u);
      if (!soaking && !ICE_SURFACES.includes(u)) w.wet = Math.max(0, w.wet - WET.dry * dt);
      if (icy && ices) w.ice = Math.min(1, w.ice + ICING.on * dt);
      else if (!icy) w.ice = Math.max(0, w.ice - ICING.off * dt);
      const d = DIRTY[u];
      w.dirt = d ? Math.min(1, w.dirt + d * dt) : Math.max(0, w.dirt - DIRT.off * dt);
    }
  }
  // tm_runtime's surface lookup, where it has one: the surface 0.1 under the contact point, like the wheel sees it.
  function surfaceAt(c, contact) {
    try {
      const { position: p, normal: n } = contact;
      return TM.surfaceAt(c.surfaces, p.x - n.x * 0.1, p.y - n.y * 0.1, p.z - n.z * 0.1);
    } catch (e) {
      c.surfaces = null;
      return null;
    }
  }

  // ---- hooks --------------------------------------------------------------------------------------------------------
  function track(car, trackData) {
    try {
      const zones = TM.zones(trackData),
        gates = zones.filter((z) => z.type in GATES),
        water = zones.filter((z) => z.type == 'Water' || z.type == 'Shallow');
      let surfaces = null;
      if (typeof TM.surfaceAt == 'function' && typeof TM.surfaceIndex == 'function') surfaces = TM.surfaceIndex(trackData);
      const tyre = [0, 1, 2, 3].map(() => ({ wet: 0, ice: 0, dirt: 0 }));
      cars.set(car, { gates, water, surfaces, tyre, inside: new Uint8Array(gates.length), f: -1, n: 0, x: 0, y: 0, z: 0, rate: 0, vehicle: 'Stadium', cpVehicle: 'Stadium', worn: 'Stadium', rig: null, tries: 0, parts: null, wheelParts: null, tinted: false });
    } catch (e) {
      console.warn('Vehicle looks off:', e);
    }
  }

  function update(car, sw, dt, state, three) {
    const c = cars.get(car);
    if (!c || !state || !three) return;
    c.sw = sw;
    if (!c.rig) {
      if (c.tries++ > 600) return;
      c.rig = findRig(car, sw);
      if (!c.rig) return;
    }
    if (state.frames != c.f) {
      const steps = c.f < 0 ? 0 : Math.max(0, state.frames - c.f);
      step(c, state);
      if (steps > 0 && steps < 1000) soak(c, state, steps / 1000);
      c.f = state.frames;
    }
    if (wheelsOf(c.rig) && c.look) dressWheels(c, sw, three, c.rig.tyres[0]?.opacity ?? 1);
    if (c.vehicle != c.worn) {
      c.worn = c.vehicle;
      wear(c, sw, three);
    }
    // Tyres only change colour while there is something on them, so a clean car costs nothing here.
    let any = false;
    for (const w of c.tyre) any = any || w.wet > 0 || w.ice > 0 || w.dirt > 0;
    if (any || c.tinted) for (let i = 0; i < 4; i++) if (c.rig.tyres[i]) tint(c.tyre[i], c.rig.tyres[i]);
    c.tinted = any;
  }

  function dispose(car) {
    const c = cars.get(car);
    // Before the car's own dispose walks its meshes, so these come off the scene's material list here.
    if (c?.rig) takeOff(c, c.sw);
    cars.delete(car);
  }

  if (W) {
    const { track: t0, update: u0, dispose: d0 } = W;
    W.track = function (car, trackData) {
      t0.call(this, car, trackData);
      track(car, trackData);
    };
    W.update = function (car, sw, dt, state, three) {
      u0.call(this, car, sw, dt, state, three);
      try {
        update(car, sw, dt, state, three);
      } catch (e) {
        cars.delete(car);
        console.warn('Vehicle looks off:', e);
      }
    };
    W.dispose = function (car) {
      d0.call(this, car);
      dispose(car);
    };
  }

  return {
    // The vehicle the page shows for a car ('Stadium', 'Snow', 'Rally', 'Desert'), null for a car it does not follow.
    of: (car) => cars.get(car)?.vehicle ?? null,
    tyres: (car) => cars.get(car)?.tyre ?? null,
    looks: LOOKS,
  };
})();
