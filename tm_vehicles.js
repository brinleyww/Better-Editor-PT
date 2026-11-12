// Vehicle and tyre looks: the Snow, Rally and Desert cars a vehicle gate turns the car into, tyres that get wet, icy or
// dirty from what they drive on, and what the tyres throw up from each surface. Page only, loaded after tm_water.js; it
// rides on tm_water's car hooks
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
  // Wet, iced and muddy tyres follow the runtime, so the look shows the grip the car really has. With its tyre model
  // (TM.TYRES) the tyres are stepped by that very code, per wheel, with what the runtime gives it: the surface under the
  // wheel, whether it is in water, how hard it slides (skidInfo). Checkpoints keep them as they are; respawns and vehicle
  // gates clean them. Every car gets this, the Stadium car too: TM2020's Stadium car gets wet and icy tyres as well.
  // Without it (an older runtime): the tyres soak up while the car's underside is in water and dry on the ground but not
  // on ice (one wetness for the car); a tyre ices up on the surfaces its car ices on (VEHICLES ices) and thaws on other
  // ground; respawns dry and thaw them, vehicle gates thaw them; and mud is only a look (part.u: dirt, and drivable grass
  // a little; not the penalty grass verges, which the stock car always drove on clean), per second on the ground, washed
  // off by water.
  const TYRES = TM.TYRES && typeof TM.TYRES.step == 'function' ? TM.TYRES : null;
  const WET = TM.WATER ?? { soak: 0.6, dry: 0.1, under: 0.45 };
  const ICING = TM.ICING ?? { surfaces: [3, 4, 7], on: 0.8, off: 0.4 };
  const ICE_SURFACES = [3, 4]; // where wet tyres do not dry (runtime: surfaces with ice handling)
  const ICES = { Stadium: [3, 4, 7], Snow: [], Rally: [3, 4, 7], Desert: [3, 4, 7] }; // when the runtime has no VEHICLES
  const DIRTY = { 5: 0.8, 6: 0.25 };
  const DIRT = { off: 0.04, wash: 0.5 };
  const TYRE_RADIUS = 0.33;
  const srgb = (h, k) => {
    const c = ((h >> (16 - 8 * k)) & 255) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lin = (h) => [srgb(h, 0), srgb(h, 1), srgb(h, 2)];
  const MUD = lin(0x6b4a2b),
    FROST = lin(0xdcecf7),
    SLICK = lin(0xc9ccd2);
  // No grip (the runtime's NOGRIP): how long it lasts and its fade, for the tyres' look.
  const NOGRIP = TM.NOGRIP ?? { frames: 5000, fade: 400 };

  // ng: no grip on the car, 0 to 1: the tyres go pale and glassy, like worn-out slicks.
  function tint(w, mat, ng = 0) {
    const b = mat.__beTyre ?? (mat.__beTyre = { r: mat.color.r, g: mat.color.g, b: mat.color.b, rough: mat.roughness });
    const d = Math.min(1, w.mud) * 0.85,
      i = Math.min(1, w.ice) * 0.75,
      wet = Math.min(1, w.wet),
      dark = 1 - 0.35 * wet,
      sl = ng * 0.55;
    let r = b.r + (MUD[0] - b.r) * d,
      g = b.g + (MUD[1] - b.g) * d,
      bl = b.b + (MUD[2] - b.b) * d;
    r += (FROST[0] - r) * i;
    g += (FROST[1] - g) * i;
    bl += (FROST[2] - bl) * i;
    r += (SLICK[0] - r) * sl;
    g += (SLICK[1] - g) * sl;
    bl += (SLICK[2] - bl) * sl;
    mat.color.setRGB(r * dark, g * dark, bl * dark);
    // Wet rubber shines, and so do tyres with no grip. Only roughness: clearcoat would recompile the shader the first
    // time it turns on.
    mat.roughness = b.rough + (0.18 - b.rough) * Math.max(wet * (1 - i), ng);
  }

  // ---- low-poly parts -----------------------------------------------------------------------------------------------
  // Plain triangle lists (no index), so computeVertexNormals gives the flat faces the rest of PolyTrack has. A shape is
  // made of convex pieces and each face is turned to point away from its piece's centre, so the parts work with the
  // game's one-sided materials (on a mirrored wheel too: three.js turns the winding round for a mirrored mesh).
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  function mid(P) {
    let x = 0,
      y = 0,
      z = 0;
    for (const p of P) (x += p[0]), (y += p[1]), (z += p[2]);
    return [x / P.length, y / P.length, z / P.length];
  }
  // Triangle a b c, its face turned to point along h.
  function tri(out, a, b, c, h) {
    const u = sub(b, a),
      v = sub(c, a),
      nx = u[1] * v[2] - u[2] * v[1],
      ny = u[2] * v[0] - u[0] * v[2],
      nz = u[0] * v[1] - u[1] * v[0];
    if (nx * nx + ny * ny + nz * nz < 1e-14) return;
    const flip = nx * h[0] + ny * h[1] + nz * h[2] < 0;
    out.push(...a, ...(flip ? c : b), ...(flip ? b : c));
  }
  // A flat polygon (its points in order round it), facing away from c.
  function poly(out, P, c) {
    const h = sub(mid(P), c);
    for (let k = 1; k + 1 < P.length; k++) tri(out, P[0], P[k], P[k + 1], h);
  }
  // Rings of points (the same count, in the same order round), each joined to the next: every ring-to-ring piece is
  // convex. caps: 1 closes the first ring, 2 the last.
  function loft(out, R, caps = 3) {
    for (let i = 0; i + 1 < R.length; i++) {
      const A = R[i],
        B = R[i + 1],
        m = A.length,
        c = mid([...A, ...B]);
      for (let k = 0; k < m; k++) poly(out, [A[k], A[(k + 1) % m], B[(k + 1) % m], B[k]], c);
      if (i == 0 && caps & 1) poly(out, A, c);
      if (i + 2 == R.length && caps & 2) poly(out, B, c);
    }
  }
  // A ring across the car at z from half its outline, [x, y] up the left side (x > 0); the right side mirrors it.
  const ring = (z, half) => [...half.map(([x, y]) => [x, y, z]), ...half.map(([x, y]) => [-x, y, z]).reverse()];
  // Eight corners, numbered like a box's (bit 0: +x, bit 1: +y, bit 2: +z), so any six-sided convex shape.
  function hexa(out, P) {
    const c = mid(P);
    for (const f of [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]])
      poly(out, f.map((i) => P[i]), c);
  }
  // A box of half sizes h at (x, y, z); f moves its corners (turn it, say).
  function box(out, x, y, z, hx, hy, hz, f) {
    const P = [];
    for (let k = 0; k < 8; k++) {
      const p = [x + (k & 1 ? hx : -hx), y + (k & 2 ? hy : -hy), z + (k & 4 ? hz : -hz)];
      P.push(f ? f(p) : p);
    }
    hexa(out, P);
  }
  // Turns p by angle a about axis 0 (x), 1 (y) or 2 (z), round the point o.
  function turn(p, axis, a, o = [0, 0, 0]) {
    const s = Math.sin(a),
      c = Math.cos(a),
      [x, y, z] = sub(p, o);
    const r = axis == 0 ? [x, y * c - z * s, y * s + z * c] : axis == 1 ? [x * c + z * s, y, z * c - x * s] : [x * c - y * s, x * s + y * c, z];
    return [r[0] + o[0], r[1] + o[1], r[2] + o[2]];
  }
  // A round bar of n sides from a to b.
  function tube(out, a, b, r, n = 6) {
    const d = sub(b, a),
      L = Math.hypot(...d),
      w = d.map((v) => v / L),
      t = Math.abs(w[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let u = [w[1] * t[2] - w[2] * t[1], w[2] * t[0] - w[0] * t[2], w[0] * t[1] - w[1] * t[0]];
    const ul = Math.hypot(...u);
    u = u.map((v) => v / ul);
    const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
    const R = (p) =>
      Array.from({ length: n }, (_, k) => {
        const q = ((k + 0.5) / n) * Math.PI * 2,
          cs = Math.cos(q) * r,
          sn = Math.sin(q) * r;
        return [p[0] + u[0] * cs + v[0] * sn, p[1] + u[1] * cs + v[1] * sn, p[2] + u[2] * cs + v[2] * sn];
      });
    loft(out, [R(a), R(b)]);
  }
  // Turned round the axle (x) in n steps from a convex cross-section of [x, radius] points.
  function lathe(out, S, n, a0 = 0) {
    const cx = S.reduce((s, p) => s + p[0], 0) / S.length,
      cr = S.reduce((s, p) => s + p[1], 0) / S.length,
      at = (p, a) => [p[0], p[1] * Math.cos(a), p[1] * Math.sin(a)];
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * Math.PI * 2,
        b = a0 + ((k + 1) / n) * Math.PI * 2,
        m = (a + b) / 2;
      for (let j = 0; j < S.length; j++) {
        const s = S[j],
          t = S[(j + 1) % S.length],
          ex = (s[0] + t[0]) / 2 - cx,
          er = (s[1] + t[1]) / 2 - cr,
          h = [ex, er * Math.cos(m), er * Math.sin(m)];
        tri(out, at(s, a), at(t, a), at(t, b), h);
        tri(out, at(s, a), at(t, b), at(s, b), h);
      }
    }
  }
  // A strip lying on a surface along a line of [z, y] points, from x0 to x1, t thick.
  function strip(out, line, x0, x1, t) {
    for (let i = 0; i + 1 < line.length; i++) {
      const [za, ya] = line[i],
        [zb, yb] = line[i + 1];
      hexa(out, [[x0, ya, za], [x1, ya, za], [x0, ya + t, za], [x1, ya + t, za], [x0, yb, zb], [x1, yb, zb], [x0, yb + t, zb], [x1, yb + t, zb]]);
    }
  }
  // A panel on the car's side at x (t thick, outwards for t > 0), from four [z, y] corners in order round it.
  function side(out, x, Q, t) {
    const at = (q, d) => [x + d, q[1], q[0]];
    hexa(out, [at(Q[0], 0), at(Q[0], t), at(Q[1], 0), at(Q[1], t), at(Q[3], 0), at(Q[3], t), at(Q[2], 0), at(Q[2], t)]);
  }
  // A window: the face a b c d of a body piece (centre ref inside it), drawn in by `inset` of the way to its middle and
  // lifted off it a little, so the pillars round it stay paint.
  function pane(out, Q, inset, ref) {
    const m = mid(Q),
      u = sub(Q[2], Q[0]),
      v = sub(Q[3], Q[1]);
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n) * (n[0] * (m[0] - ref[0]) + n[1] * (m[1] - ref[1]) + n[2] * (m[2] - ref[2]) < 0 ? -1 : 1);
    n = n.map((k) => (k / l) * 0.008);
    const P = Q.map((p) => [p[0] + (m[0] - p[0]) * inset + n[0], p[1] + (m[1] - p[1]) * inset + n[1], p[2] + (m[2] - p[2]) * inset + n[2]]);
    poly(out, P, ref);
  }
  // A fender round a wheel (centre cz, cy in the body frame): a panel from x0 to x1, hz either side of the axle and top
  // over it, with an eight-sided arch cut in it of radius r. Lined inside (liner) so the wheel well looks deep.
  function arch(out, liner, x0, x1, cz, cy, r, hz, top) {
    const c = Math.atan2(top, hz),
      A = [0, c / 2, c, c + (Math.PI - 2 * c) / 3, c + (2 * (Math.PI - 2 * c)) / 3, Math.PI - c, Math.PI - c / 2, Math.PI];
    for (let k = 0; k + 1 < A.length; k++) {
      const P = [],
        L = [];
      for (let e = 0; e < 8; e++) {
        const a = A[k + (e >> 2)],
          dz = Math.cos(a),
          dy = Math.sin(a),
          far = Math.min(Math.abs(dz) > 1e-6 ? hz / Math.abs(dz) : 1e9, dy > 1e-6 ? top / dy : 1e9),
          d = e & 2 ? far : r;
        P.push([e & 1 ? x1 : x0, cy + dy * d, cz + dz * d]);
        L.push([e & 1 ? x1 - 0.015 : x0 + 0.005, cy + dy * (e & 2 ? r : r - 0.015), cz + dz * (e & 2 ? r : r - 0.015)]);
      }
      hexa(out, P);
      hexa(liner, L);
    }
  }
  // A round lamp facing +z (or -z for d < 0): glass in a bezel.
  function lamp(P, x, y, z, r, d = 1) {
    tube(P.trim, [x, y, z - d * 0.03], [x, y, z], r + 0.018, 8);
    tube(P.lamp, [x, y, z - d * 0.01], [x, y, z + d * 0.008], r, 8);
  }

  // Body frame: the body mesh's own (car.glb "Body"): +z is the nose, +x the left, the origin 0.6 over the car's. The
  // wheels sit at x 0.628 (front) / 0.721 (rear), z 1.348 / -1.527, their centres 0.33 + the suspension length below the
  // body origin (the game's wheel table, 0.27 over the car's origin), radius 0.331.
  const WHEELS = [[0.628, 1.348], [-0.628, 1.348], [0.721, -1.527], [-0.721, -1.527]];
  const AXLE = -0.33;
  // Material slots the parts are built in. The car's own materials come in where the stock car has them, so the parts
  // take the player's colours: paint (primary), second (secondary), frame (the Metal material: frame colour), rim (the
  // Rim material: rims colour), tire (the tyre itself, which tm_vehicles tints wet, icy or dirty), brake (the brake light
  // the game lights up). The rest are the look's own.
  const BODY = ['paint', 'second', 'frame', 'trim', 'glass', 'lamp', 'accent', 'alu', 'brake', 'black', 'rubber', 'rim', 'white', 'red'];
  const WHEEL = ['tire', 'rim', 'frame', 'trim', 'accent', 'alu', 'white', 'black'];
  const SHOCK = ['alu', 'accent', 'trim'];
  // The look's own materials, in linear colour like the game's (it draws in linear and writes that out as it is), kept
  // near the brightness of the blocks so nothing glows: [r, g, b, roughness, glow].
  const OWN = {
    trim: [0.03, 0.032, 0.036, 0.75],
    glass: [0.016, 0.024, 0.036, 0.6],
    red: [0.3, 0.012, 0.008, 0.4],
    lamp: [0.46, 0.45, 0.4, 0.3, 0.4],
    alu: [0.26, 0.27, 0.28, 0.45],
    black: [0.008, 0.008, 0.009, 0.8],
    rubber: [0.028, 0.028, 0.03, 0.9],
    white: [0.4, 0.41, 0.42, 0.55],
  };
  const slots = (names) => Object.fromEntries(names.map((n) => [n, []]));

  // ground: the road under the body frame with the car at rest on this vehicle's suspension (the axle at AXLE minus the
  // runtime's rest length plus sag; checked in a race).
  const LOOKS = {
    // Snow car: a high winter buggy. Narrow tub between big knobbly tyres on white wheels, a roll cage with a light bar
    // on its front hoop, a blue nudge bar with spotlights, cycle wings over every wheel and a snorkel.
    Snow: {
      ground: -0.82,
      accent: [0.035, 0.17, 0.42],
      body(P) {
        const Y = (h) => this.ground + h;
        loft(P.paint, [
          ring(2.06, [[0.24, Y(0.42)], [0.3, Y(0.56)], [0.2, Y(0.68)]]),
          ring(1.55, [[0.28, Y(0.33)], [0.33, Y(0.58)], [0.26, Y(0.84)]]),
          ring(1.02, [[0.3, Y(0.31)], [0.36, Y(0.6)], [0.3, Y(0.94)]]),
          ring(0.82, [[0.46, Y(0.3)], [0.54, Y(0.6)], [0.44, Y(0.98)]]),
          ring(0.5, [[0.5, Y(0.3)], [0.6, Y(0.58)], [0.52, Y(0.8)]]),
          ring(-0.75, [[0.5, Y(0.3)], [0.6, Y(0.58)], [0.52, Y(0.8)]]),
          ring(-0.95, [[0.46, Y(0.3)], [0.52, Y(0.62)], [0.4, Y(1.02)]]),
          ring(-1.85, [[0.36, Y(0.36)], [0.42, Y(0.62)], [0.3, Y(0.86)]]),
          ring(-2.06, [[0.3, Y(0.42)], [0.36, Y(0.6)], [0.24, Y(0.78)]]),
        ]);
        // The open cockpit, the seat and the driver.
        box(P.black, 0, Y(0.802), -0.12, 0.44, 0.004, 0.6);
        box(P.trim, 0, Y(1.0), -0.6, 0.22, 0.2, 0.05);
        box(P.trim, 0, Y(0.86), -0.42, 0.2, 0.06, 0.18);
        box(P.accent, 0, Y(0.92), -0.4, 0.2, 0.1, 0.1);
        loft(P.white, [0, 0.07, 0.15, 0.22, 0.27].map((dy, i) => helmet(0, Y(1.02) + dy, -0.38, [0.07, 0.13, 0.14, 0.11, 0.04][i])));
        box(P.black, 0, Y(1.11), -0.255, 0.09, 0.035, 0.02);
        // Skid plate and nudge bar with two spotlights.
        hexa(P.alu, [[-0.3, Y(0.3), 1.4], [0.3, Y(0.3), 1.4], [-0.3, Y(0.36), 1.4], [0.3, Y(0.36), 1.4], [-0.26, Y(0.36), 2.12], [0.26, Y(0.36), 2.12], [-0.26, Y(0.42), 2.1], [0.26, Y(0.42), 2.1]]);
        for (const s of [1, -1]) tube(P.accent, [s * 0.3, Y(0.34), 2.16], [s * 0.28, Y(0.8), 2.12], 0.035);
        tube(P.accent, [-0.36, Y(0.4), 2.17], [0.36, Y(0.4), 2.17], 0.035);
        tube(P.accent, [-0.34, Y(0.76), 2.13], [0.34, Y(0.76), 2.13], 0.035);
        for (const s of [1, -1]) lamp(P, s * 0.17, Y(0.87), 2.16, 0.065);
        // Cycle wings over the wheels.
        for (const [x, z] of WHEELS) {
          const s = Math.sign(x),
            cy = this.ground + 0.331;
          const A = [0.35, 0.9, 1.57, 2.25, 2.8];
          for (let k = 0; k + 1 < A.length; k++) {
            const Pt = [];
            for (let e = 0; e < 8; e++) {
              const a = A[k + (e >> 2)],
                d = e & 2 ? 0.48 : 0.44;
              Pt.push([s * (e & 1 ? Math.abs(x) + 0.24 : Math.abs(x) - 0.22), cy + Math.sin(a) * d, z + Math.cos(a) * d]);
            }
            hexa(P.paint, Pt);
          }
          // A stay from the wing down to the tub.
          tube(P.frame, [s * (Math.abs(x) - 0.2), cy + 0.42, z - 0.1], [s * (z > 0 ? 0.3 : 0.38), Y(0.5), z - 0.1], 0.025);
        }
        // Roll cage: main hoop, front hoop, roof rails, rear stays and a diagonal.
        const cage = [
          [[0.5, Y(0.8), -0.78], [0.44, Y(1.42), -0.78]],
          [[0.46, Y(0.96), 0.72], [0.42, Y(1.4), 0.12]],
          [[0.42, Y(1.4), 0.12], [0.44, Y(1.42), -0.78]],
          [[0.44, Y(1.42), -0.78], [0.3, Y(0.86), -1.8]],
        ];
        for (const s of [1, -1]) for (const [a, b] of cage) tube(P.frame, [s * a[0], a[1], a[2]], [s * b[0], b[1], b[2]], 0.032);
        tube(P.frame, [-0.44, Y(1.42), -0.78], [0.44, Y(1.42), -0.78], 0.032);
        tube(P.frame, [-0.42, Y(1.4), 0.12], [0.42, Y(1.4), 0.12], 0.032);
        tube(P.frame, [0.48, Y(0.86), -0.78], [-0.44, Y(1.42), -0.78], 0.03);
        // Light bar on the front hoop.
        box(P.trim, 0, Y(1.475), 0.14, 0.42, 0.045, 0.05);
        for (let k = 0; k < 5; k++) box(P.lamp, -0.32 + k * 0.16, Y(1.475), 0.195, 0.065, 0.03, 0.006);
        for (const s of [1, -1]) box(P.trim, s * 0.3, Y(1.43), 0.13, 0.02, 0.03, 0.02);
        // Livery stripe down the nose, vents on the engine deck, a snorkel and the tail lights.
        strip(P.second, [[2.06, Y(0.68)], [1.55, Y(0.84)], [1.02, Y(0.94)], [0.82, Y(0.98)]], -0.12, 0.12, 0.008);
        for (let k = 0; k < 3; k++) strip(P.black, [[-1.12 - k * 0.22, Y(1.0) - k * 0.035], [-1.22 - k * 0.22, Y(0.985) - k * 0.035]], -0.26, 0.26, 0.008);
        tube(P.alu, [-0.3, Y(0.7), -1.55], [-0.3, Y(1.2), -1.55], 0.04, 8);
        box(P.black, -0.3, Y(1.215), -1.55, 0.042, 0.012, 0.042);
        for (const s of [1, -1]) box(P.red, s * 0.2, Y(0.62), -2.065, 0.08, 0.05, 0.008), box(P.brake, s * 0.2, Y(0.62), -2.075, 0.05, 0.03, 0.006);
        // Front lights in the nose.
        for (const s of [1, -1]) box(P.lamp, s * 0.17, Y(0.55), 2.065, 0.06, 0.035, 0.006);
      },
      // Big knobbly tyres on white steel wheels with a blue hub.
      wheel(P) {
        const n = 16;
        lathe(P.tire, [[-0.21, 0.19], [-0.21, 0.27], [-0.185, 0.3], [0.185, 0.3], [0.21, 0.27], [0.21, 0.19]], n);
        for (let k = 0; k < n; k++)
          for (const side of [-1, 1]) {
            const a = ((k + (side > 0 ? 0.5 : 0)) / n) * Math.PI * 2;
            box(P.tire, side * 0.1, 0.32, 0, 0.085, 0.026, 0.05, (p) => turn(p, 0, a));
            box(P.tire, side * 0.2, 0.285, 0, 0.02, 0.02, 0.04, (p) => turn(p, 0, a));
          }
        lathe(P.white, [[0.1, 0.17], [0.1, 0.2], [0.2, 0.2], [0.2, 0.17]], n);
        lathe(P.white, [[0.12, 0], [0.12, 0.17], [0.16, 0.17], [0.16, 0]], 8);
        for (let k = 0; k < 6; k++) box(P.trim, 0.162, 0.11, 0, 0.003, 0.025, 0.03, (p) => turn(p, 0, (k / 6) * Math.PI * 2));
        lathe(P.accent, [[0.15, 0], [0.15, 0.065], [0.19, 0.05], [0.2, 0]], 8);
      },
    },
    // Rally car: a hot hatch on gravel tyres. Box-flared arches, a roof scoop and roof spoiler, mud flaps behind every
    // wheel, a light pod on the bonnet and stripes in the player's second colour.
    Rally: {
      ground: -0.74,
      accent: [0.42, 0.3, 0.02],
      body(P) {
        const g = this.ground,
          Y = (h) => g + h,
          cy = g + 0.331;
        box(P.trim, 0, Y(0.5), 0, 0.42, 0.3, 1.96);
        // Shoulders, bonnet and tail, above the arches.
        loft(P.paint, [
          ring(2.04, [[0.58, Y(0.62)], [0.6, Y(0.76)], [0.5, Y(0.84)], [0.22, Y(0.86)]]),
          ring(1.84, [[0.68, Y(0.6)], [0.7, Y(0.8)], [0.62, Y(0.9)], [0.25, Y(0.93)]]),
          ring(1.76, [[0.69, Y(0.8)], [0.7, Y(0.82)], [0.62, Y(0.91)], [0.25, Y(0.94)]]),
          ring(0.84, [[0.7, Y(0.8)], [0.72, Y(0.96)], [0.64, Y(1.01)], [0.25, Y(1.03)]]),
          ring(-1.2, [[0.72, Y(0.8)], [0.74, Y(0.96)], [0.66, Y(1.01)], [0.25, Y(1.02)]]),
          ring(-1.88, [[0.7, Y(0.8)], [0.72, Y(0.92)], [0.64, Y(0.98)], [0.25, Y(0.99)]]),
          ring(-1.94, [[0.68, Y(0.6)], [0.7, Y(0.92)], [0.62, Y(0.98)], [0.25, Y(0.99)]]),
          ring(-2.04, [[0.6, Y(0.62)], [0.62, Y(0.88)], [0.55, Y(0.94)], [0.22, Y(0.95)]]),
        ]);
        // Bumpers, sills and the box-flared arches.
        loft(P.paint, [ring(1.76, [[0.5, Y(0.18)], [0.66, Y(0.26)], [0.68, Y(0.64)]]), ring(2.08, [[0.44, Y(0.2)], [0.6, Y(0.27)], [0.62, Y(0.62)]])]);
        loft(P.paint, [ring(-1.92, [[0.5, Y(0.18)], [0.66, Y(0.26)], [0.68, Y(0.64)]]), ring(-2.08, [[0.46, Y(0.2)], [0.62, Y(0.27)], [0.64, Y(0.62)]])]);
        loft(P.paint, [ring(0.88, [[0.56, Y(0.2)], [0.68, Y(0.28)], [0.7, Y(0.82)]]), ring(-1.06, [[0.56, Y(0.2)], [0.68, Y(0.28)], [0.7, Y(0.82)]])]);
        box(P.black, 0, Y(0.18), 2.0, 0.6, 0.025, 0.12);
        for (const s of [1, -1]) {
          arch(P.paint, P.trim, s * 0.42, s * 0.85, 1.348, cy, 0.42, 0.5, 0.52);
          arch(P.paint, P.trim, s * 0.44, s * 0.94, -1.527, cy, 0.42, 0.5, 0.52);
        }
        // Cabin: windscreen, side windows and the hatch glass on the paint, pillars left round them.
        const C = [
          ring(0.86, [[0.66, Y(0.98)], [0.62, Y(1.03)]]),
          ring(0.12, [[0.66, Y(0.98)], [0.53, Y(1.36)]]),
          ring(-1.15, [[0.66, Y(0.98)], [0.53, Y(1.37)]]),
          ring(-1.9, [[0.64, Y(0.96)], [0.58, Y(1.02)]]),
        ];
        loft(P.paint, C);
        const ref = [0, Y(1.1), -0.5];
        pane(P.glass, [C[0][1], C[0][2], C[1][2], C[1][1]], 0.1, ref);
        pane(P.glass, [C[2][1], C[2][2], C[3][2], C[3][1]], 0.08, ref);
        for (const k of [0, 2]) {
          pane(P.glass, [C[0][k], C[0][k + 1], C[1][k + 1], C[1][k]], 0.16, ref);
          pane(P.glass, [C[1][k], C[1][k + 1], C[2][k + 1], C[2][k]], 0.1, ref);
          pane(P.glass, [C[2][k], C[2][k + 1], C[3][k + 1], C[3][k]], 0.18, ref);
        }
        for (const s of [1, -1]) {
          hexa(P.paint, [[s * 0.66, Y(0.98), -0.46], [s * 0.682, Y(0.98), -0.46], [s * 0.53, Y(1.355), -0.46], [s * 0.55, Y(1.36), -0.46], [s * 0.66, Y(0.98), -0.56], [s * 0.682, Y(0.98), -0.56], [s * 0.53, Y(1.355), -0.56], [s * 0.55, Y(1.36), -0.56]]);
          box(P.paint, s * 0.74, Y(1.05), 0.72, 0.06, 0.04, 0.05);
        }
        // Roof scoop and roof spoiler.
        hexa(P.paint, [[-0.13, Y(1.35), 0.04], [0.13, Y(1.35), 0.04], [-0.12, Y(1.355), 0.04], [0.12, Y(1.355), 0.04], [-0.13, Y(1.355), -0.36], [0.13, Y(1.355), -0.36], [-0.12, Y(1.44), -0.1], [0.12, Y(1.44), -0.1]]);
        box(P.black, 0, Y(1.395), -0.055, 0.1, 0.03, 0.03);
        // The spoiler runs on from the roof's back edge over the hatch, on two thin end plates.
        hexa(P.paint, [[-0.57, Y(1.37), -1.06], [0.57, Y(1.37), -1.06], [-0.57, Y(1.4), -1.06], [0.57, Y(1.4), -1.06], [-0.6, Y(1.36), -1.58], [0.6, Y(1.36), -1.58], [-0.6, Y(1.39), -1.58], [0.6, Y(1.39), -1.58]]);
        strip(P.second, [[-1.48, Y(1.392)], [-1.58, Y(1.39)]], -0.6, 0.6, 0.008);
        for (const s of [1, -1]) hexa(P.paint, [[s * 0.56, Y(1.3), -1.14], [s * 0.6, Y(1.3), -1.14], [s * 0.56, Y(1.4), -1.08], [s * 0.6, Y(1.4), -1.08], [s * 0.56, Y(1.17), -1.58], [s * 0.6, Y(1.17), -1.58], [s * 0.56, Y(1.4), -1.6], [s * 0.6, Y(1.4), -1.6]]);
        // Light pod on the bonnet, headlights, grille and tail lights.
        // (Low and far forward on the bonnet: the bonnet camera looks out over it.)
        box(P.trim, 0, Y(0.925), 1.93, 0.4, 0.045, 0.04);
        for (const x of [-0.3, -0.1, 0.1, 0.3]) lamp(P, x, Y(0.925), 1.985, 0.045);
        for (const s of [1, -1]) box(P.lamp, s * 0.42, Y(0.74), 2.045, 0.12, 0.035, 0.008);
        box(P.black, 0, Y(0.74), 2.045, 0.22, 0.05, 0.006);
        box(P.black, 0, Y(0.38), 2.085, 0.34, 0.05, 0.006);
        for (const s of [1, -1]) box(P.red, s * 0.48, Y(0.8), -2.045, 0.12, 0.06, 0.008), box(P.brake, s * 0.5, Y(0.8), -2.055, 0.07, 0.035, 0.006);
        box(P.black, 0, Y(0.26), -2.085, 0.44, 0.06, 0.006);
        tube(P.alu, [-0.42, Y(0.26), -1.98], [-0.42, Y(0.26), -2.13], 0.045, 8);
        // Mud flaps behind every wheel, with a stripe.
        for (const [x, z] of WHEELS) {
          const s = Math.sign(x),
            fz = z > 0 ? 0.9 : -1.9,
            x0 = Math.abs(x) - 0.16,
            x1 = Math.abs(x) + 0.17;
          box(P.trim, s * (x0 + x1) * 0.5, Y(0.22), fz, (x1 - x0) / 2, 0.17, 0.008);
          box(P.white, s * (x0 + x1) * 0.5, Y(0.12), fz - 0.01, (x1 - x0) / 2 - 0.02, 0.018, 0.003);
        }
        // Livery: twin stripes over the bonnet and roof, a band across the doors.
        for (const s of [1, -1]) {
          strip(P.second, [[2.04, Y(0.86)], [1.84, Y(0.93)], [0.84, Y(1.03)]], s * 0.06, s * 0.17, 0.006);
          strip(P.second, [[0.12, Y(1.36)], [-1.06, Y(1.37)]], s * 0.06, s * 0.17, 0.006);
          side(P.second, s * 0.7, [[0.8, Y(0.3)], [0.5, Y(0.3)], [-1.0, Y(0.78)], [-0.7, Y(0.78)]], s * 0.008);
        }
      },
      // Gravel tyres (tall sidewalls, a fine block tread) on the player's own rims, six spokes and a brake behind them.
      wheel(P) {
        const n = 16;
        lathe(P.tire, [[-0.17, 0.2], [-0.17, 0.29], [-0.15, 0.31], [0.15, 0.31], [0.17, 0.29], [0.17, 0.2]], n);
        for (let k = 0; k < 20; k++)
          for (const [x, o] of [[-0.105, 0], [0, 0.5], [0.105, 0]]) box(P.tire, x, 0.32, 0, 0.045, 0.013, 0.038, (p) => turn(p, 0, ((k + o) / 20) * Math.PI * 2));
        lathe(P.rim, [[0.07, 0.2], [0.07, 0.225], [0.168, 0.225], [0.168, 0.2]], n);
        lathe(P.trim, [[0.03, 0], [0.03, 0.2], [0.05, 0.2], [0.05, 0]], 12);
        lathe(P.alu, [[0.06, 0], [0.06, 0.16], [0.075, 0.16], [0.075, 0]], 12);
        box(P.accent, 0.09, 0.15, 0, 0.02, 0.035, 0.07, (p) => turn(p, 0, 0.6));
        for (let k = 0; k < 6; k++) box(P.rim, 0.14, 0.13, 0, 0.018, 0.08, 0.022, (p) => turn(p, 0, (k / 6) * Math.PI * 2));
        lathe(P.rim, [[0.12, 0], [0.12, 0.065], [0.165, 0.05], [0.17, 0]], 8);
      },
    },
    // Desert car: a trophy truck. A long bonnet with big fenders, an open bed of tubes with the spare wheel and fuel cell
    // in it, coil-over shocks you can see working, a roof light bar, wide sand tyres on beadlock wheels.
    Desert: {
      ground: -0.8,
      accent: [0.42, 0.13, 0.015],
      // Coil-overs, one a wheel: from the lower arm by the hub (bottom: x, height over the axle) to the frame (top).
      shocks: [
        [0.34, 0.02, 0.33, 0.88],
        [0.34, 0.02, 0.33, 0.88],
        [0.44, 0.02, 0.36, 1.06],
        [0.44, 0.02, 0.36, 1.06],
      ],
      body(P) {
        const g = this.ground,
          Y = (h) => g + h,
          cy = g + 0.331;
        // Frame rails, skid plate, bumpers and sliders.
        for (const s of [1, -1]) {
          tube(P.frame, [s * 0.3, Y(0.42), 2.2], [s * 0.3, Y(0.42), -2.14], 0.035);
          tube(P.frame, [s * 0.68, Y(0.46), 0.72], [s * 0.68, Y(0.46), -0.95], 0.035);
          tube(P.frame, [s * 0.5, Y(0.6), 2.28], [s * 0.36, Y(0.86), 2.18], 0.03);
        }
        tube(P.frame, [-0.6, Y(0.6), 2.3], [0.6, Y(0.6), 2.3], 0.04, 8);
        hexa(P.alu, [[-0.34, Y(0.36), 1.5], [0.34, Y(0.36), 1.5], [-0.34, Y(0.42), 1.5], [0.34, Y(0.42), 1.5], [-0.3, Y(0.46), 2.26], [0.3, Y(0.46), 2.26], [-0.3, Y(0.52), 2.24], [0.3, Y(0.52), 2.24]]);
        // Nose and bonnet, between and above the fenders.
        box(P.black, 0, Y(0.66), 1.98, 0.3, 0.2, 0.24);
        loft(P.paint, [
          ring(2.24, [[0.42, Y(0.8)], [0.4, Y(0.88)], [0.3, Y(0.9)]]),
          ring(1.95, [[0.44, Y(0.82)], [0.43, Y(0.96)], [0.3, Y(0.99)]]),
          ring(0.6, [[0.46, Y(0.84)], [0.45, Y(1.02)], [0.3, Y(1.05)]]),
        ]);
        for (const s of [1, -1]) {
          arch(P.paint, P.trim, s * 0.36, s * 0.99, 1.348, cy, 0.47, 0.6, 0.62);
          // The fender's nose in front of the wheel, headlights in it.
          hexa(P.paint, [[s * 0.36, Y(0.55), 1.948], [s * 0.96, Y(0.55), 1.948], [s * 0.36, Y(0.95), 1.948], [s * 0.99, Y(0.95), 1.948], [s * 0.36, Y(0.62), 2.2], [s * 0.86, Y(0.62), 2.2], [s * 0.36, Y(0.86), 2.24], [s * 0.88, Y(0.86), 2.24]]);
          box(P.lamp, s * 0.62, Y(0.76), 2.225, 0.13, 0.04, 0.008, (p) => turn(p, 0, -0.35, [0, Y(0.76), 2.225]));
        }
        // Cab.
        loft(P.paint, [ring(0.74, [[0.56, Y(0.42)], [0.66, Y(0.52)], [0.68, Y(1.02)]]), ring(-0.98, [[0.56, Y(0.42)], [0.66, Y(0.52)], [0.68, Y(1.02)]])]);
        const C = [
          ring(0.66, [[0.64, Y(1.0)], [0.6, Y(1.05)]]),
          ring(0.1, [[0.66, Y(1.0)], [0.54, Y(1.5)]]),
          ring(-0.9, [[0.66, Y(1.0)], [0.54, Y(1.52)]]),
          ring(-0.98, [[0.66, Y(1.0)], [0.54, Y(1.5)]]),
        ];
        loft(P.paint, C);
        const ref = [0, Y(1.2), -0.4];
        pane(P.glass, [C[0][1], C[0][2], C[1][2], C[1][1]], 0.1, ref);
        for (const k of [0, 2]) {
          pane(P.glass, [C[0][k], C[0][k + 1], C[1][k + 1], C[1][k]], 0.18, ref);
          pane(P.glass, [C[1][k], C[1][k + 1], C[2][k + 1], C[2][k]], 0.12, ref);
        }
        pane(P.glass, [C[3][0], C[3][1], C[3][2], C[3][3]], 0.25, ref);
        // Light bar on the roof and a whip aerial.
        box(P.trim, 0, Y(1.565), 0.1, 0.5, 0.045, 0.05);
        for (let k = 0; k < 6; k++) box(P.lamp, -0.4 + k * 0.16, Y(1.565), 0.152, 0.065, 0.03, 0.006);
        tube(P.trim, [-0.5, Y(1.52), -0.86], [-0.5, Y(2.2), -0.94], 0.008, 4);
        // Bed: floor, fuel cell, the spare lying in it and the cage over it.
        box(P.trim, 0, Y(0.53), -1.56, 0.42, 0.03, 0.58);
        box(P.accent, 0, Y(0.72), -1.11, 0.34, 0.16, 0.1);
        spare(P, [0, Y(0.8), -1.68]);
        const cage = [
          [[0.5, Y(1.48), -0.95], [0.44, Y(1.06), -2.12]],
          [[0.44, Y(1.06), -2.12], [0.44, Y(0.5), -2.12]],
          [[0.5, Y(1.48), -0.95], [0.42, Y(0.56), -1.3]],
          [[0.47, Y(1.27), -1.53], [0.42, Y(0.56), -1.95]],
        ];
        for (const s of [1, -1]) for (const [a, b] of cage) tube(P.frame, [s * a[0], a[1], a[2]], [s * b[0], b[1], b[2]], 0.03);
        tube(P.frame, [-0.44, Y(1.06), -2.12], [0.44, Y(1.06), -2.12], 0.03);
        tube(P.frame, [-0.44, Y(1.06), -2.12], [0.44, Y(0.5), -2.12], 0.026);
        tube(P.frame, [-0.6, Y(0.5), -2.2], [0.6, Y(0.5), -2.2], 0.04, 8);
        for (const s of [1, -1]) box(P.red, s * 0.44, Y(0.9), -2.155, 0.06, 0.07, 0.012), box(P.brake, s * 0.44, Y(0.9), -2.17, 0.04, 0.05, 0.006);
        // Livery: a band along the cab and fenders and a stripe up the bonnet.
        for (const s of [1, -1]) {
          side(P.second, s * 0.68, [[0.7, Y(0.7)], [-0.96, Y(0.66)], [-0.96, Y(0.72)], [0.7, Y(0.8)]], s * 0.008);
          side(P.accent, s * 0.68, [[0.7, Y(0.62)], [-0.96, Y(0.6)], [-0.96, Y(0.63)], [0.7, Y(0.66)]], s * 0.008);
        }
        strip(P.second, [[2.24, Y(0.9)], [1.95, Y(0.99)], [0.6, Y(1.05)]], -0.1, 0.1, 0.008);
        for (const s of [1, -1]) strip(P.black, [[1.25, Y(1.025)], [0.85, Y(1.04)]], s * 0.17, s * 0.34, 0.008);
      },
      // Wide sand tyres, round in the shoulder with a blocky tread, on beadlock wheels.
      wheel(P) {
        const n = 16;
        lathe(P.tire, [[-0.25, 0.19], [-0.25, 0.26], [-0.236, 0.302], [-0.2, 0.328], [0.2, 0.328], [0.236, 0.302], [0.25, 0.26], [0.25, 0.19]], n);
        for (let k = 0; k < 14; k++)
          for (const side of [-1, 1]) {
            const a = ((k + (side > 0 ? 0.5 : 0)) / 14) * Math.PI * 2;
            box(P.tire, side * 0.11, 0.334, 0, 0.09, 0.011, 0.055, (p) => turn(p, 0, a));
            box(P.tire, side * 0.215, 0.3, 0, 0.03, 0.022, 0.045, (p) => turn(p, 0, a));
          }
        lathe(P.trim, [[0.06, 0.19], [0.06, 0.215], [0.235, 0.215], [0.235, 0.19]], n);
        lathe(P.black, [[0.1, 0], [0.1, 0.19], [0.13, 0.19], [0.13, 0]], 12);
        lathe(P.alu, [[0.22, 0.165], [0.22, 0.212], [0.252, 0.212], [0.252, 0.165]], n);
        for (let k = 0; k < 12; k++) box(P.trim, 0.254, 0.19, 0, 0.004, 0.009, 0.009, (p) => turn(p, 0, (k / 12) * Math.PI * 2));
        for (let k = 0; k < 6; k++) box(P.rim, 0.17, 0.11, 0, 0.02, 0.07, 0.025, (p) => turn(p, 0, ((k + 0.5) / 6) * Math.PI * 2));
        lathe(P.accent, [[0.15, 0], [0.15, 0.06], [0.2, 0.045], [0.205, 0]], 8);
      },
      // A coil-over one unit long (up the y axis), stretched to the wheel every frame.
      shock(P) {
        tube(P.alu, [0, 0, 0], [0, 1, 0], 0.024, 6);
        for (let k = 0; k < 7; k++) tube(P.accent, [0, 0.2 + k * 0.1, 0], [0, 0.24 + k * 0.1, 0], 0.045, 8);
        tube(P.trim, [0, 0.62, 0], [0, 1, 0], 0.035, 6);
      },
    },
  };
  // A low-poly ball's rings (for the snow driver's helmet): 8 points round at height y, radius r.
  function helmet(x, y, z, r) {
    return Array.from({ length: 8 }, (_, k) => [x + Math.cos(((k + 0.5) / 8) * Math.PI * 2) * r, y, z + Math.sin(((k + 0.5) / 8) * Math.PI * 2) * r]);
  }
  // The desert spare: a smaller tyre and rim lying in the bed, its nose tipped up.
  function spare(P, at) {
    const f = (p) => {
      const q = turn(turn(p, 2, Math.PI / 2), 0, -0.3);
      return [q[0] + at[0], q[1] + at[1], q[2] + at[2]];
    };
    const S = [],
      R = [],
      H = [];
    lathe(S, [[-0.13, 0.17], [-0.13, 0.24], [-0.1, 0.29], [0.1, 0.29], [0.13, 0.24], [0.13, 0.17]], 14);
    lathe(R, [[-0.1, 0.0], [-0.1, 0.17], [0.11, 0.17], [0.11, 0.0]], 10);
    lathe(H, [[0.11, 0], [0.11, 0.05], [0.135, 0.04], [0.14, 0]], 8);
    for (const [out, t] of [[P.rubber, S], [P.rim, R], [P.alu, H]]) for (let i = 0; i < t.length; i += 3) out.push(...f([t[i], t[i + 1], t[i + 2]]));
    box(P.trim, at[0], at[1] + 0.02, at[2], 0.03, 0.17, 0.33, (p) => turn(p, 0, -0.3, at));
  }

  // Each look's shapes, built once and shared by every car wearing it: one geometry for the body, one for a wheel (and
  // one for a shock), a group per material slot.
  const SHAPES = {};
  function geometry(three, names, build) {
    const P = slots(names);
    build(P);
    let n = 0;
    for (const k of names) n += P[k].length;
    const pos = new Float32Array(n),
      g = new three.LoY();
    let at = 0;
    names.forEach((k, i) => {
      if (!P[k].length) return;
      pos.set(P[k], at);
      g.addGroup(at / 3, P[k].length / 3, i);
      at += P[k].length;
    });
    g.setAttribute('position', new three.THS(pos, 3));
    g.computeVertexNormals();
    return g;
  }
  function shapes(three, name) {
    const L = LOOKS[name];
    return (SHAPES[name] ??= {
      body: geometry(three, BODY, (P) => L.body(P)),
      wheel: geometry(three, WHEEL, (P) => L.wheel(P)),
      shock: L.shock ? geometry(three, SHOCK, (P) => L.shock(P)) : null,
    });
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

  // The body rides `lift` higher (the runtime's VEHICLES look.lift, where it has one): the game writes the body's matrix
  // itself every frame (multiply by the mass offset), so the lift goes in right after that step, along the body's own up
  // axis. The suspension copies the body matrix.
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

  const named = (o, n) => (Array.isArray(o?.material) ? o.material : [o?.material]).find((m) => m?.name == n) ?? null;
  // Slots the stock car's own materials fill (by their names in car.glb).
  const STOCK = { frame: 'Metal', brake: 'BrakeLight', black: 'AirIntake', tire: 'Tire', rim: 'Rim' };
  function part(three, geometry, materials) {
    const o = new three.eaF(geometry, materials);
    o.castShadow = o.receiveShadow = true;
    o.frustumCulled = false;
    o.name = 'be-vehicle';
    return o;
  }
  // The stock body (with its exhaust) and wheels go out of sight while a look is worn: their layers, not `visible`, so
  // the parts hung on them still draw (three.js walks an object's children whatever its own layers are).
  function hide(c, o) {
    for (const [h] of c.hidden) if (h === o) return;
    c.hidden.push([o, o.layers.mask]);
    o.layers.mask = 0;
  }

  function wear(c, sw, three) {
    const rig = c.rig;
    takeOff(c, sw);
    const look = LOOKS[c.vehicle];
    if (!look) return;
    const S = shapes(three, c.vehicle),
      opacity = rig.tyres[0]?.opacity ?? 1,
      main = named(rig.body, 'Main'),
      own = {};
    for (const [k, v] of Object.entries({ ...OWN, paint: [0.3, 0.3, 0.3, main?.roughness ?? 0.5], second: [0.4, 0.4, 0.4, main?.roughness ?? 0.5], accent: [...look.accent, 0.55] })) {
      const m = new three._4j({ roughness: v[3], metalness: k == 'paint' || k == 'second' ? main?.metalness ?? 0 : 0.05 });
      m.color.setRGB(v[0], v[1], v[2]);
      if (v[4]) m.emissive.setRGB(v[0] * v[4], v[1] * v[4], v[2] * v[4]);
      if (opacity < 1) (m.opacity = opacity), (m.transparent = true);
      sw.addMaterial?.(m); // the scene's shadow setup patches every car material's shader
      own[k] = m;
    }
    c.own = own;
    c.ownList = Object.values(own);
    c.main = main;
    c.secondary = null;
    c.opacity = opacity;
    c.hidden = [];
    hide(c, rig.body);
    for (const k of rig.body.children) hide(c, k);
    const stock = (o) => (n) => (STOCK[n] && named(o, STOCK[n])) || own[n] || own.trim;
    const body = part(three, S.body, BODY.map((n) => (n == 'rim' ? named(rig.wheels[0], 'Rim') ?? own.alu : stock(rig.body)(n))));
    rig.body.add(body);
    c.parts = [body];
    c.shocks = null;
    if (S.shock) {
      c.shocks = WHEELS.map(() => part(three, S.shock, SHOCK.map((n) => own[n])));
      for (const o of c.shocks) rig.body.add(o), c.parts.push(o);
    }
    c.wheelParts = [];
    dressWheels(c, sw, three);
    setLift(rig, VEHICLES[c.vehicle]?.look?.lift ?? 0);
    c.look = look;
  }
  // The look's wheel on each of the car's wheels, which carries it round, steers and spins it; its tyre is the car's own
  // tyre material, so wet, icy and dirty tyres show on it.
  function dressWheels(c, sw, three) {
    for (const o of c.wheelParts ?? []) o.parent?.remove(o);
    c.wheelParts = [];
    const S = SHAPES[c.vehicle];
    if (!S || !c.own) return;
    for (const w of c.rig.wheels) {
      if (!w) continue;
      hide(c, w);
      const o = part(three, S.wheel, WHEEL.map((n) => (STOCK[n] && named(w, STOCK[n])) || c.own[n] || c.own.trim));
      w.add(o);
      c.wheelParts.push(o);
    }
  }
  // Every drawn frame while a look is worn: the player's colours (the garage can change them), a ghost's see-through,
  // and the shocks stretched to where the wheels are now (the suspension length is this frame's). No allocations.
  function follow(c, car, state) {
    const own = c.own;
    if (c.main) own.paint.color.copy(c.main.color);
    // The style's hex, not its secondaryColor (a new Color every time it is read).
    const hex = car.getCarStyle?.()?.secondaryHex;
    if (hex != null && hex !== c.secondary) own.second.color.setHex((c.secondary = hex));
    const o = c.rig.tyres[0]?.opacity ?? 1;
    if (o !== c.opacity) {
      c.opacity = o;
      for (const m of c.ownList) {
        m.opacity = o;
        if (m.transparent != o < 1) (m.transparent = o < 1), (m.needsUpdate = true);
      }
    }
    const L = c.look.shocks,
      len = state?.wheelSuspensionLength;
    if (!c.shocks || !L || !len) return;
    for (let i = 0; i < 4; i++) {
      const s = WHEELS[i][0] < 0 ? -1 : 1,
        y0 = AXLE - len[i] + L[i][1],
        dx = s * (L[i][2] - L[i][0]),
        dy = c.look.ground + L[i][3] - y0,
        sh = c.shocks[i];
      sh.position.set(s * L[i][0], y0, WHEELS[i][1]);
      sh.rotation.z = Math.atan2(-dx, dy);
      sh.scale.y = Math.hypot(dx, dy);
    }
  }
  // Back to the stock car exactly: the parts come off, the stock body and wheels show again, nothing of the look is left.
  // The shapes stay built for the next car to wear them.
  function takeOff(c, sw) {
    for (const o of c.parts ?? []) o.parent?.remove(o);
    for (const o of c.wheelParts ?? []) o.parent?.remove(o);
    for (const m of c.ownList ?? []) {
      sw?.removeMaterial?.(m);
      m.dispose();
    }
    for (const [o, mask] of c.hidden ?? []) o.layers.mask = mask;
    c.parts = c.wheelParts = c.shocks = c.own = c.ownList = c.main = null;
    c.hidden = [];
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
  // An effect fires on the car's first touch (the runtime's fxTouch: its hull or a wheel reaching the box); an older
  // runtime fires when the car's origin gets in. touch(q, s): touching in state s; enter: where in the step from the
  // last position it started (0 to 1, -1 none). With fxTouch a touch starting this state counts at its end.
  const touch = typeof TM.fxTouch == 'function' ? (q, s) => TM.fxTouch(q, s.position.x, s.position.y, s.position.z, s.quaternion.x, s.quaternion.y, s.quaternion.z, s.quaternion.w) : (q, s) => inBox(q, s.position.x, s.position.y, s.position.z);
  const enter = (q, s, x0, y0, z0) => (typeof TM.fxTouch == 'function' ? (touch(q, s) ? 1 : -1) : entry(q, x0, y0, z0, s.position.x, s.position.y, s.position.z));

  function restart(c, s) {
    c.vehicle = c.cpVehicle = 'Stadium';
    c.inside.fill(0);
    c.n = s.nextCheckpointIndex;
    c.x = s.position.x;
    c.y = s.position.y;
    c.z = s.position.z;
    c.rate = 0;
    c.tyre.forEach((w) => (w.wet = w.ice = w.mud = 0));
    c.ngLeft = 0;
    c.rInside.fill(0);
    c.reactor = null;
    c.rLeft = 0;
    c.lift = 0;
  }

  // The boost and its frames left exactly as the runtime has them, from the HUD where it follows this car frame by frame
  // (the player's car: it sees every physics frame, slow motion's held ones included); other cars keep the count above.
  function sync(c, s) {
    const h = c.car && !c.ghost ? TM.hud?.of?.(c.car) : null;
    if (!h || h.frames !== s.frames || !('reactorLeft' in h)) return;
    c.reactor = h.reactor ? REACTOR[h.reactor] ?? null : null;
    c.rLeft = c.reactor ? h.reactorLeft : 0;
  }
  function step(c, s) {
    const p = s.position;
    if (c.f < 0 || s.frames < c.f || !s.hasStarted) restart(c, s);
    let x0 = c.x,
      y0 = c.y,
      z0 = c.z;
    const steps = Math.max(1, s.frames - Math.max(c.f, 0)),
      moved = Math.abs(p.x - x0) + Math.abs(p.y - y0) + Math.abs(p.z - z0),
      // The respawn key counts too, however near the checkpoint the car already was (the runtime's justReset; with no
      // checkpoint passed it does nothing).
      key = !!s.controls?.reset && s.nextCheckpointIndex > 0,
      respawn = key || moved > JUMP + 1.5 * steps * Math.max(c.rate, 0.03); // 0.03 units a frame = 108 km/h
    c.rate = respawn ? 0 : moved / steps;
    if (respawn) {
      // Back to the vehicle the car had at its last checkpoint, with dry, thawed tyres (as the runtime; with its tyre
      // model clean ones).
      c.vehicle = c.cpVehicle;
      for (const w of c.tyre) (w.wet = w.ice = 0), TYRES && (w.mud = 0);
      x0 = p.x;
      y0 = p.y;
      z0 = p.z;
    }
    // Reactor boosts end as every effect does in the runtime (clear): on the reset key, a respawn, a checkpoint, and here
    // also at the finish, where the runtime stops; otherwise they run down by the physics frames since the last state.
    if (s.controls?.reset || respawn || s.nextCheckpointIndex > c.n || s.finishFrames != null) (c.reactor = null), (c.rLeft = 0), (c.ngLeft = 0);
    else {
      if (c.rLeft > 0 && (c.rLeft -= steps) <= 0) (c.reactor = null), (c.rLeft = 0);
      if (c.ngLeft > 0) c.ngLeft = Math.max(0, c.ngLeft - steps);
    }
    if (s.nextCheckpointIndex > c.n) c.cpVehicle = c.vehicle;
    c.n = s.nextCheckpointIndex;
    // The last reactor or reset plate the car's origin entered since the last state: a reactor plate starts its boost
    // afresh (it replaces one already on), a reset plate ends it.
    if (s.finishFrames == null) {
      let rb = -1,
        rt = -1;
      for (let i = 0; i < c.react.length; i++) {
        const q = c.react[i],
          now = touch(q, s) ? 1 : 0;
        if (!c.rInside[i]) {
          const t = enter(q, s, x0, y0, z0);
          // Reset wheels and No grip act on the tyres at once; the reactor and Reset effects plates: the last one counts.
          if (t >= 0 && q.type == 'ResetWheels') {
            for (const w of c.tyre) w.wet = w.ice = w.mud = 0;
            c.ngLeft = 0;
          } else if (t >= 0 && q.type == 'NoGrip') c.ngLeft = NOGRIP.frames;
          else if (t >= 0 && t >= rt) (rb = i), (rt = t);
        }
        c.rInside[i] = now;
      }
      if (rb >= 0) {
        // Up or down by the way the car crossed it (the runtime's reactorPick), from its move since the last state.
        const q = c.react[rb],
          Q = s.quaternion,
          R = q.type in PLATES ? REACTOR[pick(q, p.x - x0, p.y - y0, p.z - z0, Q.x, Q.y, Q.z, Q.w)] : null;
        c.reactor = R ?? null;
        c.rLeft = R ? Math.max(1, R.frames - Math.round((1 - rt) * steps)) : 0;
      }
    }
    // The hover lift of an older runtime (its REACTOR_HOVER; the current one has none, so this stays 0): an up boost lifted
    // the car over flat ground (the wheels' mean contact normal near world up), fully while off the ground.
    let ground = false,
      nx = 0,
      ny = 0,
      nz = 0;
    for (let i = 0; i < 4; i++) {
      const k = s.wheelContact?.[i];
      if (!k) continue;
      ground = true;
      nx += k.normal.x;
      ny += k.normal.y;
      nz += k.normal.z;
    }
    c.rGround = ground;
    let want = 0;
    sync(c, s);
    if (c.reactor && c.reactor.dir > 0 && c.rLeft > 0) {
      if (ground) {
        const nl = Math.hypot(nx, ny, nz),
          lo = Math.cos((HOVER.flat[1] * Math.PI) / 180),
          hi = Math.cos((HOVER.flat[0] * Math.PI) / 180),
          t = nl > 0 ? Math.max(0, Math.min(1, (ny / nl - lo) / (hi - lo))) : 0;
        want = HOVER.lift * t * t * (3 - 2 * t);
      } else want = HOVER.lift;
      want *= Math.min(1, c.rLeft / (c.reactor.fade ?? JET.fade));
    }
    if (respawn) c.lift = 0;
    c.lift += Math.max((-HOVER.drop * steps) / 1000, Math.min((HOVER.rise * steps) / 1000, want - c.lift));
    let best = -1,
      bestT = -1;
    for (let i = 0; i < c.gates.length; i++) {
      const q = c.gates[i],
        now = touch(q, s) ? 1 : 0;
      if (!c.inside[i]) {
        const t = enter(q, s, x0, y0, z0);
        if (t >= 0 && t >= bestT) (best = i), (bestT = t);
      }
      c.inside[i] = now;
    }
    if (best >= 0) {
      const v = GATES[c.gates[best].type];
      if (v != c.vehicle) for (const w of c.tyre) (w.ice = 0), TYRES && (w.wet = w.mud = 0); // a new car has new tyres
      c.vehicle = v;
    }
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
    const ices = VEHICLES[c.vehicle]?.ices ?? ICES[c.vehicle] ?? [],
      level = water ? water.surface ?? water.max[1] : 0,
      // The runtime soaks the tyres while the car's underside (WATER.under below its origin) is under the surface.
      soaking = water != null && p.y - (WET.under ?? 0.45) < level;
    let contacts = 0,
      onIce = false;
    c.soaking = soaking;
    if (TYRES) {
      // With no new surfaces and no water nothing ever gets on a tyre.
      if (!c.surfaces?.size && !c.water.length) return;
      // The runtime's own step, once per physics frame since the last drawn one (with this frame's surfaces): a wheel on
      // the ground is in the water when its contact is under the surface, one in the air when the car's underside is.
      const n = Math.max(1, Math.min(250, Math.round(dt * 1000))),
        d = dt / n,
        skid = s.tmSkid ?? s.wheelSkidInfo;
      for (let i = 0; i < 4; i++) {
        const contact = s.wheelContact[i],
          u = !contact ? TYRES.AIR : c.surfaces ? surfaceAt(c, contact) ?? TYRES.ROAD : TYRES.ROAD,
          wet = contact ? water != null && contact.position.y < level : soaking,
          heat = TYRES.heatOf(skid ? skid[i] : 1);
        c.wu[i] = contact ? (u == TYRES.ROAD ? null : u) : null; // what the tyre spray throws up
        for (let k = 0; k < n; k++) TYRES.step(c.tyre[i], u, wet, heat, c.vehicle, d);
      }
      return;
    }
    for (let i = 0; i < 4; i++) {
      const w = c.tyre[i],
        contact = s.wheelContact[i],
        wheel = c.rig.wheels[i];
      if (soaking && wheel != null && wheel.position.y - TYRE_RADIUS < level) w.mud = Math.max(0, w.mud - DIRT.wash * dt);
      c.wu[i] = null;
      if (!contact) continue;
      contacts++;
      const u = c.surfaces ? surfaceAt(c, contact) : null,
        icy = ICING.surfaces.includes(u);
      c.wu[i] = u; // what the tyre spray throws up
      if (ICE_SURFACES.includes(u)) onIce = true;
      if (icy && ices.includes(u)) w.ice = Math.min(1, w.ice + ICING.on * dt);
      else if (!icy) w.ice = Math.max(0, w.ice - ICING.off * dt);
      const d = DIRTY[u];
      w.mud = d ? Math.min(1, w.mud + d * dt) : Math.max(0, w.mud - DIRT.off * dt);
    }
    const t = c.tyre[0];
    let wet = t.wet;
    if (soaking) wet = Math.min(1, wet + WET.soak * dt);
    else if (contacts > 0 && !onIce) wet = Math.max(0, wet - WET.dry * dt);
    for (const w of c.tyre) w.wet = wet;
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

  // ---- tyre spray ---------------------------------------------------------------------------------------------------
  // What a tyre throws up from the surface under it, so the surfaces tell apart at a glance: dust off dirt, clippings off
  // grass, powder off snow, glitter off ice, splinters off wood, chips in the deck's own colour off plastic, smoke off the
  // bump road. A light trail while rolling, far more while the tyre slides (drifting, wheelspin, hard braking). Stock road
  // gets nothing new (the game's own skid smoke is all it ever had), and a track with no new blocks gets no spray at all;
  // water spray is tm_water.js's.
  // Like tm_water's splashes, every car in a scene shares two Points (hard chips and soft puffs) with fixed pools, and
  // the game's Particles setting turns it off along with the game's own smoke.
  const CHIPS = 1400,
    PUFFS = 500; // alive at once per scene; puffs are big and see-through, so they cost the most to draw
  // Points are unlit. The game lights faces in linear colour and writes the result out as it is (no sRGB step), so a
  // sunlit face of a colour shows about 1.2 to 1.5 x its hex value; a point given the hex value itself (not made linear,
  // which would show it four times darker) sits just under a sunlit face of that colour and never glows over it.
  const shade = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
  // One kind of particle. pool: 0 chips (hard flecks), 1 puffs (soft clouds). colors: picked at random, each a little
  // lighter or darker. life: seconds (min, max). size: world units at birth and at the end. gravity: units/s² (below 0
  // it rises). drag: share of its speed lost per second. alpha: at most. land: settles on the ground it came off instead
  // of falling through. glint: flickers like ice catching the sun.
  // roll / slide: how many one wheel throws per second rolling at full speed / sliding flat out. up: thrown off the
  // ground (units/s, min..max). spread: sideways scatter (units/s). carry: share of the car's velocity it keeps (less
  // and it falls behind as a trail). throw: share of the tyre's sideways slide it is thrown along with.
  const DUST = { pool: 1, colors: [0xbfa07a, 0xb0916c, 0xcbb08a], life: [1.3, 2.4], size: [1.2, 3.4], gravity: -0.45, drag: 1.5, alpha: 0.5, roll: 16, slide: 32, up: [0.4, 1.5], spread: 1.3, carry: 0.3, throw: 0.35 };
  const CLODS = { pool: 0, colors: [0x6e4c2c, 0x7f5a36, 0x5e4026], life: [0.7, 1.1], size: [0.13, 0.13], gravity: 20, drag: 0.3, alpha: 1, land: true, roll: 2.5, slide: 22, up: [2, 5], spread: 1.8, carry: 0.5, throw: 0.5 };
  // Clippings flutter: little gravity against a lot of drag.
  const CLIPPINGS = { pool: 0, colors: [0x8fcf5a, 0x7cc04a, 0xa6d870, 0x6aa83a], life: [0.8, 1.3], size: [0.14, 0.14], gravity: 8, drag: 1.4, alpha: 1, land: true, roll: 14, slide: 40, up: [1.5, 4.2], spread: 2, carry: 0.45, throw: 0.45 };
  // The penalty verges are the stadium's darker lawn (its Grass material), cut a little shorter.
  const VERGE = { ...CLIPPINGS, colors: [0x5f9f40, 0x548f38, 0x72b050, 0x4a8030], roll: 10, slide: 36 };
  const SOIL = { ...CLODS, size: [0.1, 0.1], roll: 0, slide: 8, up: [1.5, 3.5] };
  const GRASS_DUST = { ...DUST, colors: [0xb5b088], life: [0.8, 1.4], size: [0.5, 1.6], gravity: -0.3, drag: 1.8, alpha: 0.22, roll: 0, slide: 7 };
  const POWDER = { pool: 1, colors: [0xf6f9fc, 0xe8eff6], life: [1, 1.8], size: [0.7, 2.2], gravity: 2.2, drag: 1.1, alpha: 0.75, roll: 12, slide: 55, up: [2.5, 6.5], spread: 2, carry: 0.3, throw: 0.5 };
  const CLUMPS = { pool: 0, colors: [0xffffff, 0xe9f1f9], life: [0.7, 1.1], size: [0.14, 0.14], gravity: 15, drag: 0.4, alpha: 1, land: true, roll: 4, slide: 20, up: [3, 7], spread: 2, carry: 0.4, throw: 0.5 };
  // Ice: fine crystals that stay low and skate along with the car.
  const GLITTER = { pool: 0, colors: [0xd8efff, 0xbde3ff, 0xffffff], life: [0.35, 0.75], size: [0.09, 0.06], gravity: 5, drag: 2.2, alpha: 1, land: true, glint: true, roll: 18, slide: 90, up: [0.15, 0.9], spread: 1.2, carry: 0.6, throw: 0.4 };
  const SPLINTERS = { pool: 0, colors: [0xd9b98a, 0xe6caa0, 0xc8a372], life: [0.55, 0.95], size: [0.11, 0.11], gravity: 15, drag: 0.5, alpha: 1, land: true, roll: 6, slide: 30, up: [1, 3.2], spread: 1.8, carry: 0.45, throw: 0.45 };
  const SAWDUST = { ...DUST, colors: [0xe0cba6], life: [0.8, 1.4], size: [0.45, 1.4], gravity: -0.2, drag: 1.8, alpha: 0.28, roll: 0, slide: 12, up: [0.3, 1], spread: 1, carry: 0.25, throw: 0.3 };
  // Plastic: a squeak of chips in the deck's own colour (deck), gone quickly. Chips at the deck's hex value read as dark
  // dirt on the sunlit deck and chips at its sunlit shade (x 1.3, see shade above) vanish into it, so they are that shade
  // made 40% whiter: the deck's colour, catching the light.
  const FLECKS = { pool: 0, deck: true, colors: [0xa4831d], life: [0.22, 0.42], size: [0.14, 0.08], gravity: 9, drag: 1, alpha: 1, roll: 6, slide: 60, up: [0.8, 2.6], spread: 2.4, carry: 0.5, throw: 0.45 };
  const SMOKE = { pool: 1, colors: [0xc8cacd, 0xb4b7ba], life: [0.9, 1.6], size: [0.8, 2.8], gravity: -1.1, drag: 1.3, alpha: 0.38, roll: 0, slide: 28, up: [0.3, 1.2], spread: 1.2, carry: 0.2, throw: 0.25 };
  // By part.u: 0 plastic, 1 wood, 2 penalty grass, 3 platform ice, 4 bobsleigh, 5 dirt, 6 grass, 7 snow, 8 tech.
  const SPRAY = [[FLECKS], [SPLINTERS, SAWDUST], [VERGE, GRASS_DUST], [GLITTER], [GLITTER], [DUST, CLODS], [CLIPPINGS, SOIL, GRASS_DUST], [POWDER, CLUMPS], [SMOKE]];
  // Wet wood (a wet tyre on wood, WET_FROM wet or more) throws water instead of splinters: a fan of bright droplets that
  // arc off and a low sheet of mist behind the tyre, both mostly from sliding, so a wet slide hisses with spray. By the
  // tyre's wetness (a lightly wet tyre throws a little).
  const DROPLETS = { pool: 0, colors: [0xe4f1fa, 0xcfe4f2, 0xffffff], life: [0.3, 0.6], size: [0.1, 0.05], gravity: 16, drag: 0.7, alpha: 1, glint: true, roll: 5, slide: 110, up: [1.5, 4], spread: 2.6, carry: 0.55, throw: 0.65 };
  const MIST = { pool: 1, colors: [0xdfeaf2, 0xcbdbe6], life: [0.45, 0.9], size: [0.7, 2.6], gravity: -0.3, drag: 2.2, alpha: 0.3, roll: 3, slide: 30, up: [0.2, 0.9], spread: 1.4, carry: 0.4, throw: 0.45 };
  const WET_WOOD = [DROPLETS, MIST],
    WET_FROM = 0.05;
  const KINDS = [...new Set([...SPRAY.flat(), ...WET_WOOD])];
  KINDS.forEach((k, i) => {
    k.id = i;
    k.rgb = k.colors.map(shade);
  });
  const MOST = Math.max(...SPRAY.map((l) => l.length));
  // How hard a wheel slides, 0..1: from the sideways speed of the ground under it (units/s: none below lat[0], flat out
  // from lat[1]; a car carving a fast corner on grip slips about 1), or from the physics' own skid (skidInfo: 1 while the
  // tyre grips, lower once its grip runs out, as in wheelspin and locked brakes; none above skid[0], all from skid[1]).
  const SLIDE = { lat: [1.5, 8], skid: [0.9, 0.4] };
  // Rolling throws its full trail from this speed (units/s; 40 = 144 km/h).
  const FULL_ROLL = 40;
  // Fewer from cars far from the camera (all of it within near, none past far, units) and from ghosts and replayed cars
  // (see adopt below): a share of it, and only while the pool is less than half full, so the car being driven always
  // gets its spray. The car nearest the camera is never cut back, so a replay being watched throws all of it.
  const LOD = { near: 40, far: 140, ghost: 0.35 };
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // Plastic chips take the deck's colour: one small surface index per painted colour on the track (TM.surfaceIndex over
  // just those parts), only asked while a wheel is on plastic. Unpainted plastic is the default deck colour. Built once
  // per track a car is set up with; ghosts share their scene's.
  function decksOf(trackData) {
    const decks = [],
      D = TM.data;
    const gloss = (h) => shade(h).map((v) => Math.min(1, v * 1.3) * 0.6 + 0.4);
    let deck = gloss(0xa4831d);
    if (D?.materialNames && D.materials) {
      const k = D.materialNames.indexOf('PlasticDeck');
      if (k >= 0) deck = gloss(parseInt(D.materials[k].slice(1), 16));
    }
    if (TM.byId && typeof TM.palette == 'function') {
      const by = new Map();
      trackData.forEachPart((x, y, z, id, rot, axis, color) => {
        const p = TM.isTM?.(id) ? TM.byId.get(id) : null;
        if (p?.u !== 0) return;
        const hex = TM.palette(p)?.find((e) => e.id == color)?.colors?.PlasticDeck;
        if (!hex) return;
        by.has(hex) ? by.get(hex).push([x, y, z, id, rot, axis]) : by.set(hex, [[x, y, z, id, rot, axis]]);
      });
      for (const [hex, list] of by) decks.push({ rgb: gloss(parseInt(hex.slice(1), 16)), index: TM.surfaceIndex({ forEachPart: (f) => list.forEach((a) => f(...a)) }) });
    }
    return { decks, deck };
  }
  // One car's spray: where it was at its last state, and what each wheel's kinds have built up towards the next particle.
  const sprayState = ({ decks, deck }) => ({ f: -1, x: 0, y: 0, z: 0, q: [0, 0, 0, 1], decks, deck, acc: new Float32Array(4 * MOST), slide: [0, 0, 0, 0] });
  function deckAt(S, contact) {
    const { position: p, normal: n } = contact;
    for (const d of S.decks) if (TM.surfaceAt(d.index, p.x - n.x * 0.1, p.y - n.y * 0.1, p.z - n.z * 0.1) === 0) return d.rgb;
    return S.deck;
  }

  const sprays = new WeakMap(); // scene wrapper -> its two pools and how many cars use them
  function texture(three, size, draw) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    draw(cv.getContext('2d'), size);
    const t = new three.gPd(cv);
    // No mipmaps: a canvas's see-through pixels are black, and mipmaps mix that into a small point's colour.
    t.generateMipmaps = false;
    t.minFilter = 1006; // LinearFilter
    t.needsUpdate = true;
    return t;
  }
  function pool(three, max, map) {
    const geo = new three.LoY(),
      pos = new Float32Array(max * 3).fill(-1e5),
      rgba = new Float32Array(max * 4),
      size = new Float32Array(max);
    geo.setAttribute('position', new three.THS(pos, 3));
    geo.setAttribute('color', new three.THS(rgba, 4)); // four values: each particle fades on its own
    geo.setAttribute('beSize', new three.THS(size, 1));
    geo.setDrawRange(0, 0);
    const mat = new three.BH$({ size: 1, map, vertexColors: true, transparent: true, depthWrite: false });
    // Each particle its own size: PointsMaterial has one for all, so its size is scaled by the beSize attribute.
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('uniform float size;', 'uniform float size;\nattribute float beSize;').replace('gl_PointSize = size;', 'gl_PointSize = size * beSize;');
    };
    mat.customProgramCacheKey = () => 'be-tyre-spray';
    const pts = new three.ONl(geo, mat);
    pts.frustumCulled = false;
    pts.visible = false;
    pts.name = 'be-tyre-spray';
    return { pts, geo, mat, map, max, live: 0, pos, rgba, size, vel: new Float32Array(max * 3), rgb: new Float32Array(max * 3), age: new Float32Array(max), life: new Float32Array(max), kind: new Uint8Array(max), seed: new Float32Array(max), ground: new Float32Array(max * 4) };
  }
  function sprayPool(sw, three) {
    let s = sprays.get(sw);
    if (!s) {
      // Chips: a hard-edged six-sided fleck, the low-poly look. Puffs: a soft lumpy cloud.
      const chip = texture(three, 32, (g, n) => {
        g.fillStyle = '#fff';
        g.beginPath();
        for (let k = 0; k < 6; k++) g.lineTo(n / 2 + Math.cos((k / 6) * Math.PI * 2 + 0.3) * n * 0.46, n / 2 + Math.sin((k / 6) * Math.PI * 2 + 0.3) * n * 0.4);
        g.fill();
      });
      const puff = texture(three, 64, (g, n) => {
        for (const [x, y, r] of [[0.5, 0.55, 0.42], [0.36, 0.42, 0.26], [0.64, 0.4, 0.24]]) {
          const q = g.createRadialGradient(x * n, y * n, 0, x * n, y * n, r * n);
          q.addColorStop(0, 'rgba(255,255,255,0.75)');
          q.addColorStop(0.6, 'rgba(255,255,255,0.4)');
          q.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = q;
          g.fillRect(0, 0, n, n);
        }
      });
      s = { sw, pools: [pool(three, CHIPS, chip), pool(three, PUFFS, puff)], cars: 0, frame: null, on: true, checked: -1e9, at: null, near: null, nearD: Infinity, nearest: null };
      for (const P of s.pools) sw.scene.add(P.pts);
      sprays.set(sw, s);
    }
    s.cars++;
    return s;
  }
  // The scene's spray goes with its last car.
  function letGo(c) {
    const s = c.pool;
    c.pool = c.spray = null;
    if (!s || --s.cars > 0) return;
    for (const P of s.pools) {
      s.sw.scene.remove(P.pts);
      P.geo.dispose();
      P.mat.dispose();
      P.map.dispose();
    }
    sprays.delete(s.sw);
  }
  // The game's Particles setting: with it off, no car gets the game's skid-smoke (an instanced mesh with the smoke
  // texture), so there is none in the scene. Looked at once a second.
  function particlesOn(s) {
    const now = performance.now();
    if (now - s.checked < 1000) return s.on;
    s.checked = now;
    s.on = s.sw.scene.children.some((o) => o.isInstancedMesh && /smoke/.test(o.material?.map?.image?.src ?? ''));
    return s.on;
  }
  // Which of a scene's cars is nearest the camera (the one driven or watched), as of the last drawn frame.
  function near(s, car, p) {
    const frame = document.timeline?.currentTime ?? performance.now(),
      cam = s.sw.camera?.position,
      d = cam ? Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z) : 0;
    if (s.at !== frame) {
      s.at = frame;
      s.nearest = s.near;
      s.near = null;
      s.nearD = Infinity;
    }
    if (d < s.nearD) {
      s.nearD = d;
      s.near = car;
    }
  }

  // One car's wheels throw up what they are on, from the physics frames since its last state (steps of 1 ms).
  function throwUp(c, car, state, steps) {
    const S = c.spray,
      p = state.position,
      q = state.quaternion;
    // A restart, a replay seek or a stall: no motion to go by. A slow machine draws 100 or more physics frames at a time
    // (10 fps), so only a gap of half a second counts.
    const fresh = S.f < 0 || steps <= 0 || steps > 500;
    const moved = fresh ? 0 : Math.abs(p.x - S.x) + Math.abs(p.y - S.y) + Math.abs(p.z - S.z);
    const dt = steps / 1000,
      // Velocity (units/s) and spin (rad/s, world axes) from the last state: the spin is twice the vector part of the
      // turn between the two quaternions (close enough for the turn a car makes in one drawn frame).
      vx = (p.x - S.x) / dt,
      vy = (p.y - S.y) / dt,
      vz = (p.z - S.z) / dt,
      px = S.q[0],
      py = S.q[1],
      pz = S.q[2],
      pw = S.q[3],
      sg = pw * q.w + px * q.x + py * q.y + pz * q.z < 0 ? -2 / dt : 2 / dt,
      wx = (q.w * -px + q.x * pw + q.y * -pz - q.z * -py) * sg,
      wy = (q.w * -py - q.x * -pz + q.y * pw + q.z * -px) * sg,
      wz = (q.w * -pz + q.x * -py - q.y * -px + q.z * pw) * sg;
    S.f = state.frames;
    S.x = p.x;
    S.y = p.y;
    S.z = p.z;
    S.q[0] = q.x;
    S.q[1] = q.y;
    S.q[2] = q.z;
    S.q[3] = q.w;
    S.slide.fill(0);
    const s = c.pool;
    // A move further than the car can drive is a respawn (as step() decides it; 200 units/s = 720 km/h of room, past an
    // ultra turbo's 515 or wood's top end).
    // Hovering on a reactor boost the jets carry the car and the wheels throw nothing up.
    if (fresh || moved > JUMP + 0.2 * steps || c.soaking || c.lift > 0.1 || !state.hasStarted || !particlesOn(s)) return;
    const cam = s.sw.camera?.position,
      far = cam ? Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z) : 0,
      ghost = c.ghost && s.nearest !== car,
      lod = (c.rig.root.visible ? 1 : 0) * clamp01((LOD.far - far) / (LOD.far - LOD.near)) * (ghost ? LOD.ghost : 1);
    // The car's axes: nose (+z), left (+x), as the body frame has them.
    const fx = 2 * (q.x * q.z + q.w * q.y),
      fy = 2 * (q.y * q.z - q.w * q.x),
      fz = 1 - 2 * (q.x * q.x + q.y * q.y),
      lx = 1 - 2 * (q.y * q.y + q.z * q.z),
      ly = 2 * (q.x * q.y + q.w * q.z),
      lz = 2 * (q.x * q.z - q.w * q.y);
    const speed = Math.hypot(vx, vy, vz),
      ahead = vx * fx + vy * fy + vz * fz,
      roll = clamp01(speed / FULL_ROLL),
      brake = state.controls?.down && ahead > 3 ? 0.6 * clamp01(ahead / 25) : 0; // braking hard from speed
    for (let i = 0; i < 4; i++) {
      const u = c.wu[i],
        contact = state.wheelContact[i];
      if (u == null || !contact || !SPRAY[u]) continue;
      const cp = contact.position,
        n = contact.normal;
      // The wheel's heading: the front wheels turn by the steering angle, about the car's up.
      const st = i < 2 ? state.steering || 0 : 0,
        hx = fx * Math.cos(st) + lx * Math.sin(st),
        hy = fy * Math.cos(st) + ly * Math.sin(st),
        hz = fz * Math.cos(st) + lz * Math.sin(st);
      // Across the wheel, along the ground: normal x heading.
      let sx = n.y * hz - n.z * hy,
        sy = n.z * hx - n.x * hz,
        sz = n.x * hy - n.y * hx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      sx /= sl;
      sy /= sl;
      sz /= sl;
      // The ground under the tyre moves at the car's velocity plus its spin about the car's centre.
      const rx = cp.x - p.x,
        ry = cp.y - p.y,
        rz = cp.z - p.z,
        cvx = vx + wy * rz - wz * ry,
        cvy = vy + wz * rx - wx * rz,
        cvz = vz + wx * ry - wy * rx,
        lat = cvx * sx + cvy * sy + cvz * sz,
        skid = state.wheelSkidInfo?.[i] ?? 1;
      const slide = Math.max(clamp01((Math.abs(lat) - SLIDE.lat[0]) / (SLIDE.lat[1] - SLIDE.lat[0])), clamp01((SLIDE.skid[0] - skid) / (SLIDE.skid[0] - SLIDE.skid[1])) * clamp01(speed / 6), brake);
      S.slide[i] = slide;
      if (lod <= 0) continue;
      // Wheelspin throws it back behind the tyre.
      const kick = state.controls?.up && skid < SLIDE.skid[0] ? 3 : 0;
      const wet = u === 1 ? c.tyre?.[i]?.wet ?? 0 : 0,
        list = wet >= WET_FROM ? WET_WOOD : SPRAY[u],
        much = wet >= WET_FROM ? 0.25 + 0.75 * wet : 1;
      for (let k = 0; k < list.length; k++) {
        const K = list[k],
          P = s.pools[K.pool],
          a = i * MOST + k;
        S.acc[a] += (K.roll * roll + K.slide * slide * Math.max(0.25, clamp01(speed / 8))) * much * lod * dt;
        let count = Math.min(12, Math.floor(S.acc[a]));
        S.acc[a] -= Math.floor(S.acc[a]);
        if (ghost && P.live > P.max / 2) count = 0;
        const rgb = K.deck && count > 0 ? deckAt(S, contact) : null;
        for (let j = 0; j < count && P.live < P.max; j++) {
          const r = Math.random,
            up = K.up[0] + (K.up[1] - K.up[0]) * r(),
            ss = (r() * 2 - 1) * K.spread,
            sh = (r() * 2 - 1) * K.spread * 0.5 - Math.min(2.5, speed * 0.06) - kick * slide,
            ux = vx * K.carry + sx * lat * K.throw + n.x * up + sx * ss + hx * sh,
            uy = vy * K.carry + sy * lat * K.throw + n.y * up + sy * ss + hy * sh,
            uz = vz * K.carry + sz * lat * K.throw + n.z * up + sz * ss + hz * sh,
            // Thrown some time within these frames, from where the tyre was then, so a long drawn frame is not one clump.
            t = r() * dt,
            jx = (r() - 0.5) * 0.24,
            jh = (r() - 0.5) * 0.2,
            m = P.live++;
          P.pos[m * 3] = cp.x + n.x * 0.04 + sx * jx + hx * jh + (ux - vx) * t;
          P.pos[m * 3 + 1] = cp.y + n.y * 0.04 + sy * jx + hy * jh + (uy - vy) * t;
          P.pos[m * 3 + 2] = cp.z + n.z * 0.04 + sz * jx + hz * jh + (uz - vz) * t;
          P.vel[m * 3] = ux;
          P.vel[m * 3 + 1] = uy;
          P.vel[m * 3 + 2] = uz;
          const tone = 0.88 + 0.24 * r(),
            c3 = rgb ?? K.rgb[(r() * K.rgb.length) | 0];
          P.rgb[m * 3] = c3[0] * tone;
          P.rgb[m * 3 + 1] = c3[1] * tone;
          P.rgb[m * 3 + 2] = c3[2] * tone;
          P.age[m] = t;
          P.life[m] = K.life[0] + (K.life[1] - K.life[0]) * r();
          P.kind[m] = K.id;
          P.seed[m] = r();
          P.ground[m * 4] = n.x;
          P.ground[m * 4 + 1] = n.y;
          P.ground[m * 4 + 2] = n.z;
          P.ground[m * 4 + 3] = n.x * cp.x + n.y * cp.y + n.z * cp.z;
        }
      }
    }
  }

  // Moves, fades and grows every particle in a scene, once per drawn frame however many cars share it.
  function moveSpray(s, dt) {
    const frame = document.timeline?.currentTime ?? performance.now();
    if (s.frame === frame) return;
    s.frame = frame;
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    for (const P of s.pools) {
      if (!P.live && !P.drawn) continue;
      for (let i = 0; i < P.live; ) {
        const K = KINDS[P.kind[i]],
          age = (P.age[i] += dt),
          life = P.life[i];
        if (age >= life) {
          kill(P, i);
          continue;
        }
        const v = i * 3,
          g = i * 4,
          drag = Math.max(0, 1 - K.drag * dt);
        P.vel[v + 1] -= K.gravity * dt;
        P.vel[v] *= drag;
        P.vel[v + 1] *= drag;
        P.vel[v + 2] *= drag;
        P.pos[v] += P.vel[v] * dt;
        P.pos[v + 1] += P.vel[v + 1] * dt;
        P.pos[v + 2] += P.vel[v + 2] * dt;
        if (K.land) {
          // Kept just above the ground it came off; once down it slides to a stop.
          const nx = P.ground[g],
            ny = P.ground[g + 1],
            nz = P.ground[g + 2],
            d = nx * P.pos[v] + ny * P.pos[v + 1] + nz * P.pos[v + 2] - P.ground[g + 3] - 0.03;
          if (d < 0) {
            P.pos[v] -= nx * d;
            P.pos[v + 1] -= ny * d;
            P.pos[v + 2] -= nz * d;
            const vn = nx * P.vel[v] + ny * P.vel[v + 1] + nz * P.vel[v + 2],
              f = Math.max(0, 1 - 8 * dt);
            if (vn < 0) {
              P.vel[v] -= nx * vn;
              P.vel[v + 1] -= ny * vn;
              P.vel[v + 2] -= nz * vn;
            }
            P.vel[v] *= f;
            P.vel[v + 1] *= f;
            P.vel[v + 2] *= f;
          }
        }
        const t = age / life;
        // Chips stay solid, then fade over their last 40%; puffs come in over 0.06 s and thin out all their life.
        let a = K.alpha * (K.pool ? Math.min(1, age / 0.06) * (1 - t) ** 1.5 : Math.min(1, (1 - t) / 0.4)),
          lit = 1;
        if (K.glint) {
          // A sharp flash a few times a second, each crystal on its own beat. Between flashes it only thins out: darker,
          // it reads as grit on the pale ice.
          const w = 0.5 + 0.5 * Math.sin(age * 38 + P.seed[i] * 40);
          lit = 0.95 + 0.45 * w ** 6;
          a *= 0.3 + 0.7 * w ** 2;
        }
        P.rgba[g] = P.rgb[v] * lit;
        P.rgba[g + 1] = P.rgb[v + 1] * lit;
        P.rgba[g + 2] = P.rgb[v + 2] * lit;
        P.rgba[g + 3] = a;
        // Puffs swell as they spread (fast, then slower).
        P.size[i] = K.size[0] + (K.size[1] - K.size[0]) * (K.pool ? 1 - (1 - t) * (1 - t) : t);
        i++;
      }
      const at = P.geo.attributes;
      at.position.needsUpdate = at.color.needsUpdate = at.beSize.needsUpdate = true;
      P.geo.setDrawRange(0, P.live);
      P.drawn = P.pts.visible = P.live > 0; // an empty pool is no draw call at all
    }
  }
  // The last particle takes the place of the one that is gone.
  function kill(P, i) {
    const j = --P.live;
    if (i != j) {
      for (let a = 0; a < 3; a++) {
        P.pos[i * 3 + a] = P.pos[j * 3 + a];
        P.vel[i * 3 + a] = P.vel[j * 3 + a];
        P.rgb[i * 3 + a] = P.rgb[j * 3 + a];
      }
      for (let a = 0; a < 4; a++) P.ground[i * 4 + a] = P.ground[j * 4 + a];
      P.age[i] = P.age[j];
      P.life[i] = P.life[j];
      P.kind[i] = P.kind[j];
      P.seed[i] = P.seed[j];
    }
    P.pos[j * 3 + 1] = -1e5;
  }

  // ---- reactor jets -------------------------------------------------------------------------------------------------
  // While a reactor boost is on, every wheel is a jet, as TM2020's FLReactor .. RRReactor, cyan for a reactor boost and
  // purple for a super one, in the plates' colours (FxReactor, FxReactor2, cores in their glyph colours); every
  // flame comes out of the centre of its wheel's outer face (the hub, away from the car) and points straight out along
  // the axle, tilted from there by at most 45 degrees (tilt) in any direction. A boost up tilts it down, against the
  // push: all the way on the gas in the air (the runtime pushes only then), less while it hovers (short thrusters, a
  // little longer on the gas) and off the gas (a pilot glow). A boost down tilts it up the same way, big on the gas. The
  // gas is state.controls, the controls the car got after the effects filtered them (ghosts and replays carry them
  // too). They swing fore and aft with the steering (ReactorInputsX), turned the way the front wheels turn, and the ones
  // on the outside of the turn flare; the two tilts together are held to 45 degrees off the axle.
  // They die away over the last half second. The boost itself is worked out in step() like the vehicle: the plate the
  // car's origin enters and the way it crosses it, ended by a reset plate, a checkpoint, a respawn, the reset key or the
  // finish.
  // The runtime's tables and pick (tm_runtime.js REACTOR, REACTOR_PLATES, reactorPick); an older runtime had one boost
  // per plate type. Only an older runtime hovered (REACTOR_HOVER): the current one has none, so the lift stays 0.
  const REACTOR = TM.REACTOR ?? {
    ReactorUp: { level: 1, dir: 1, frames: 6000 },
    ReactorDown: { level: 1, dir: -1, frames: 6000 },
    Reactor2Up: { level: 2, dir: 1, frames: 6000 },
    Reactor2Down: { level: 2, dir: -1, frames: 6000 },
  };
  const PLATES = TM.REACTOR_PLATES ?? { ReactorUp: 1, ReactorDown: 1, Reactor2Up: 1, Reactor2Down: 1 };
  const HOVER = TM.REACTOR_HOVER ?? { lift: 0, flat: [4, 10], rise: 1.5, drop: 4 };
  const pick = typeof TM.reactorPick == 'function' ? TM.reactorPick : (q) => q.type;
  // length / radius: a full flame (world units). core: the white-hot core's size against the flame. pilot: its size off
  // the gas; hover: a hover thruster's off and on the gas; ground: a down boost's on the ground. tilt: the most a flame
  // leans off the axle (radians); dip: how much of that a boost's push gives it up or down, [off the gas, hovering on
  // the gas, on the gas] (in the air a boost up only pushes on the gas); swing: how much of it full steering gives it
  // fore and aft. hub: from the wheel's centre out to its outer face. flare: how much longer the outside ones burn at full steering
  // (the inside ones lose a third of that). fade: physics frames the flame dies away over at the end (the runtime's
  // REACTOR fade, its push dying away with it, where it has one). attack / release:
  // how fast a flame grows and shrinks (per second). flicker: how much it wavers. Colours as the points take them:
  // unlit and written out as they are. The flame is see-through plate colour over what is behind it (added on, it went
  // white against the sky); only its core is added on, so it glows.
  const JET = {
    color: { 1: [0x1fb4cc, 0xb8f6ff], 2: [0x8a35e6, 0xeccfff] },
    length: 1.6,
    radius: 0.2,
    core: [0.48, 0.5],
    opacity: [0.8, 0.85],
    pilot: 0.28,
    hover: [0.3, 0.46],
    ground: 0.7,
    tilt: Math.PI / 4,
    dip: [0.35, 0.65, 1],
    swing: 1,
    hub: 0.16,
    flare: 0.45,
    fade: 500,
    attack: 14,
    release: 7,
    flicker: 0.1,
  };
  // A flame along +y from its base (0) to its tip (1), radius 1 at the base, rounded under it; white, see-through towards
  // the tip, so the material's colour tints it. Built once.
  let jetGeo = null;
  function jetGeometry(three) {
    if (jetGeo) return jetGeo;
    const prof = [[-0.14, 0], [-0.1, 0.62], [0, 1], [0.22, 0.88], [0.5, 0.56], [0.78, 0.26], [1, 0]],
      n = 10,
      pos = [],
      col = [];
    const at = (j, k) => {
      const [y, r] = prof[j],
        a = (k / n) * Math.PI * 2;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      col.push(1, 1, 1, y <= 0 ? 1 : (1 - y) ** 1.4);
    };
    for (let j = 0; j + 1 < prof.length; j++)
      for (let k = 0; k < n; k++) {
        at(j, k), at(j + 1, k), at(j + 1, k + 1);
        at(j, k), at(j + 1, k + 1), at(j, k + 1);
      }
    const g = new three.LoY();
    g.setAttribute('position', new three.THS(new Float32Array(pos), 3));
    g.setAttribute('color', new three.THS(new Float32Array(col), 4));
    return (jetGeo = g);
  }
  // The car's eight flames (a flame and its core per wheel) and their two materials, hung on the body, which carries them
  // with the car; made the first time the car gets a boost and kept until it goes.
  function makeJets(c, three) {
    const geo = jetGeometry(three),
      mats = [0, 1].map((k) => new three.V9B({ color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false, blending: k ? 2 : 1, side: 2, fog: false, opacity: JET.opacity[k] })),
      meshes = [];
    for (let k = 0; k < 2; k++)
      for (let i = 0; i < 4; i++) {
        const o = new three.eaF(geo, mats[k]);
        o.name = 'be-reactor-jet';
        o.frustumCulled = false;
        o.castShadow = o.receiveShadow = false;
        o.renderOrder = 10 + k;
        o.visible = false;
        c.rig.body.add(o);
        meshes.push(o);
      }
    c.jet = { mats, meshes, level: 0, power: new Float32Array(4), steer: 0, dip: 0, body: c.rig.body, opacity: -1 };
  }
  function dropJets(c) {
    const J = c.jet;
    if (!J) return;
    for (const o of J.meshes) o.parent?.remove(o);
    for (const m of J.mats) m.dispose();
    c.jet = null;
  }
  // Every drawn frame. No allocations.
  function jets(c, state, dt, three) {
    const R = c.reactor;
    if (!c.jet) {
      if (!R || c.rLeft <= 0) return;
      makeJets(c, three);
    }
    const J = c.jet;
    if (J.body !== c.rig.body) return dropJets(c);
    const d = dt > 0 ? Math.min(dt, 0.1) : 0,
      ctl = state.controls,
      gas = !!ctl?.up && !ctl?.down,
      want = R ? (ctl?.left ? 1 : 0) - (ctl?.right ? 1 : 0) : 0;
    J.steer += (want - J.steer) * (1 - Math.exp(-10 * d));
    if (R && R.level !== J.level) {
      J.level = R.level;
      const C = JET.color[R.level] ?? JET.color[1];
      J.mats[0].color.setHex(C[0]);
      J.mats[1].color.setHex(C[1]);
    }
    // A ghost fades the way the game fades its tyres.
    const op = c.rig.tyres[0]?.opacity ?? 1;
    if (op !== J.opacity) {
      J.opacity = op;
      J.mats[0].opacity = JET.opacity[0] * op;
      J.mats[1].opacity = JET.opacity[1] * op;
    }
    // The flame's size follows the gas smoothly; the boost's last stretch (the runtime's fade, the same frames its push
    // dies away over) scales it straight down, so the jets go out on the frame the push ends.
    const ground = c.rGround || c.lift > 0.05,
      up = !R || R.dir > 0,
      size = !R ? 0 : ground ? (up ? JET.hover[gas ? 1 : 0] : gas ? JET.ground : JET.pilot) : gas ? 1 : JET.pilot,
      fade = R && c.rLeft > 0 ? Math.min(1, c.rLeft / (R.fade ?? JET.fade)) : 0,
      len = state.wheelSuspensionLength,
      t = performance.now() / 1000,
      s = J.steer;
    // How far the push tilts the flames (share of the tilt), eased like the steering: down for a boost up, up for a
    // boost down.
    J.dip += ((!R ? 0 : !gas ? JET.dip[0] : ground && up ? JET.dip[1] : JET.dip[2]) - J.dip) * (1 - Math.exp(-10 * d));
    // The two tilts (radians): tv up (+) or down, th with the steering; together no more than the tilt.
    let tv = J.dip * JET.tilt * (up ? -1 : 1),
      th = s * JET.swing * JET.tilt;
    const tt = Math.hypot(tv, th);
    if (tt > JET.tilt) (tv *= JET.tilt / tt), (th *= JET.tilt / tt);
    const ta = Math.min(JET.tilt, tt),
      cs = Math.cos(ta),
      sn = ta > 1e-6 ? Math.sin(ta) / ta : 0;
    for (let i = 0; i < 4; i++) {
      const outside = (s > 0) == (WHEELS[i][0] < 0), // steering left: the right wheels (x < 0) are outside the turn
        flare = outside ? 1 + JET.flare * Math.abs(s) : 1 - (JET.flare / 3) * Math.abs(s),
        target = size * flare,
        p0 = J.power[i],
        p = (J.power[i] = fade > 0 ? p0 + (target - p0) * (1 - Math.exp(-(target > p0 ? JET.attack : JET.release) * d)) : 0) * fade;
      const a = J.meshes[i],
        b = J.meshes[i + 4];
      if (p < 0.02) {
        a.visible = b.visible = false;
        continue;
      }
      // The flame's way, in the body frame (+x left, +y up, +z nose): out along the axle (sx: this wheel's side), tilted
      // up or down by tv and turned about the car's up by th the way the front wheels steer (steering left swings the
      // outer end of the axle towards the tail on the left, the nose on the right).
      const sx = WHEELS[i][0] > 0 ? 1 : -1,
        fx = sx * cs,
        fy = tv * sn,
        fz = -sx * th * sn;
      // turn +y onto (fx, fy, fz): the half-way quaternion
      let qx = fz,
        qy = 0,
        qz = -fx,
        qw = 1 + fy;
      const ql = Math.hypot(qx, qy, qz, qw);
      if (ql < 1e-6) (qx = 1), (qy = qz = qw = 0);
      else (qx /= ql), (qy /= ql), (qz /= ql), (qw /= ql);
      // from the centre of the wheel's outer face (the body frame's wheel table, the suspension as it is now)
      const wx = WHEELS[i][0] + sx * JET.hub,
        wy = AXLE - (len?.[i] ?? 0),
        wz = WHEELS[i][1],
        wave = 1 + JET.flicker * Math.sin(t * 43 + i * 1.9) * Math.sin(t * 17 + i * 0.7),
        L = JET.length * p * wave,
        r = JET.radius * (0.55 + 0.45 * p);
      a.position.set(wx, wy, wz);
      a.quaternion.set(qx, qy, qz, qw);
      a.scale.set(r, L, r);
      b.position.copy(a.position);
      b.quaternion.copy(a.quaternion);
      b.scale.set(r * JET.core[0], L * JET.core[1], r * JET.core[0]);
      a.visible = b.visible = true;
    }
  }

  // ---- hooks --------------------------------------------------------------------------------------------------------
  function track(car, trackData) {
    try {
      const zones = TM.zones(trackData),
        gates = zones.filter((z) => z.type in GATES),
        water = zones.filter((z) => z.type == 'Water' || z.type == 'Shallow'),
        react = zones.filter((z) => z.type in PLATES || z.type == 'Reset' || z.type == 'ResetWheels' || z.type == 'NoGrip');
      let surfaces = null;
      if (typeof TM.surfaceAt == 'function' && typeof TM.surfaceIndex == 'function') surfaces = TM.surfaceIndex(trackData);
      // A track with no new blocks has no surfaces to throw anything up from.
      setUp(car, { gates, water, react, surfaces, decks: surfaces?.size ? decksOf(trackData) : null }, false);
    } catch (e) {
      console.warn('Vehicle looks off:', e);
    }
  }
  // A car's own state over its track's tables (T).
  function setUp(car, T, ghost) {
    const tyre = [0, 1, 2, 3].map(() => ({ wet: 0, ice: 0, mud: 0 }));
    cars.set(car, { T, gates: T.gates, water: T.water, surfaces: T.surfaces, tyre, inside: new Uint8Array(T.gates.length), f: -1, n: 0, x: 0, y: 0, z: 0, rate: 0, vehicle: 'Stadium', cpVehicle: 'Stadium', worn: 'Stadium', rig: null, tries: 0, parts: null, wheelParts: null, tinted: false, wu: [null, null, null, null], soaking: false, spray: T.decks ? sprayState(T.decks) : null, pool: null, ghost, react: T.react ?? [], rInside: new Uint8Array(T.react?.length ?? 0), reactor: null, rLeft: 0, ngLeft: 0, lift: 0, rGround: false, jet: null });
  }
  // Ghosts and replays: the game sets up (track) only the cars it simulates itself, so a ghost or a replayed car never
  // comes to track and only ever gets its states. It is followed over the tables of a car set up in the same scene, and
  // wears the vehicle its run drove as too: follow() gives the look's own materials the ghost's see-through every frame,
  // and the rest of the look is the car's own materials, which the game fades itself.
  const scenes = new WeakMap(); // scene wrapper -> the tables of the last car set up in it
  const lifted = new WeakSet(); // states whose wheels are already drawn up by a hover lift
  const adopted = new WeakSet(); // cars tried for that, once each
  function adopt(car, sw) {
    const T = scenes.get(sw);
    if (!T || adopted.has(car)) return null;
    adopted.add(car);
    setUp(car, T, true);
    return cars.get(car);
  }

  function update(car, sw, dt, state, three) {
    const c = cars.get(car) ?? (state && three ? adopt(car, sw) : null);
    if (!c || !state || !three) return;
    if (!c.ghost) scenes.set(sw, c.T);
    c.sw = sw;
    if (!c.rig) {
      if (c.tries++ > 600) return;
      c.rig = findRig(car, sw);
      if (!c.rig) return;
    }
    if (c.spray && !c.pool) c.pool = sprayPool(sw, three);
    if (c.pool && c.rig.root.visible) near(c.pool, car, state.position);
    if (state.frames != c.f) {
      const steps = c.f < 0 ? 0 : Math.max(0, state.frames - c.f);
      c.car = car;
      step(c, state);
      if (steps > 0 && steps < 1000) soak(c, state, steps / 1000);
      // The spray has its own guard: if it fails, only it goes off and the car keeps its looks.
      if (c.pool)
        try {
          throwUp(c, car, state, steps);
        } catch (e) {
          letGo(c);
          console.warn('Tyre spray off:', e);
        }
      c.f = state.frames;
    }
    if (c.pool)
      try {
        moveSpray(c.pool, dt);
      } catch (e) {
        letGo(c);
        console.warn('Tyre spray off:', e);
      }
    // Hovering (the runtime's lift): the game draws the wheels right after this from the state's suspension lengths, so
    // they go up by the lift, off the ground, and the tyres stop touching it (no skid marks, they spin free). Once per
    // state: a state drawn again keeps its change.
    if (c.lift > 0.001 && !lifted.has(state)) {
      lifted.add(state);
      const L = state.wheelSuspensionLength;
      if (L) for (let i = 0; i < 4; i++) L[i] -= c.lift;
      if (c.lift > 0.1 && state.wheelContact) for (let i = 0; i < 4; i++) state.wheelContact[i] = null;
    }
    // The jets have their own guard too.
    if (c.react.length)
      try {
        jets(c, state, dt, three);
      } catch (e) {
        dropJets(c);
        c.react = [];
        console.warn('Reactor jets off:', e);
      }
    if (wheelsOf(c.rig) && c.look) dressWheels(c, sw, three, c.rig.tyres[0]?.opacity ?? 1);
    if (c.vehicle != c.worn) {
      c.worn = c.vehicle;
      wear(c, sw, three);
    }
    if (c.look) follow(c, car, state);
    // Tyres only change colour while there is something on them, so a clean car costs nothing here.
    const hud = c.car && !c.ghost ? TM.hud?.of?.(c.car) : null,
      ngLeft = hud && 'noGripLeft' in hud ? hud.noGripLeft : c.ngLeft,
      ng = ngLeft > 0 ? Math.min(1, ngLeft / NOGRIP.fade) : 0;
    let any = ng > 0;
    for (const w of c.tyre) any = any || w.wet > 0 || w.ice > 0 || w.mud > 0;
    if (any || c.tinted) for (let i = 0; i < 4; i++) if (c.rig.tyres[i]) tint(c.tyre[i], c.rig.tyres[i], ng);
    c.tinted = any;
  }

  function dispose(car) {
    const c = cars.get(car);
    // Before the car's own dispose walks its meshes, so these come off the scene's material list here.
    if (c?.rig) takeOff(c, c.sw);
    if (c) letGo(c), dropJets(c);
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
        const c = cars.get(car);
        if (c) letGo(c);
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
    of: (car) => {
      const c = cars.get(car);
      return c ? c.vehicle : null;
    },
    tyres: (car) => cars.get(car)?.tyre ?? null,
    // Hovering on a reactor boost the jets carry the car, so its wheels show no skid smoke and leave no skid marks: the
    // game draws both from the state's skidInfo as the state comes in (VisualCar.setCarState, before the car's update),
    // so tm_hud.js hands every state here once it has read it, and while the car hovers its skidInfo reads 1 (gripping);
    // the real values stay in tmSkid for the tyres here (soak).
    quiet(car, s) {
      const c = cars.get(car),
        k = s?.wheelSkidInfo;
      if (!c || !(c.lift > 0.1) || !k || s.tmSkid) return;
      const keep = (c.skid0 ??= new Float32Array(4));
      for (let i = 0; i < 4; i++) (keep[i] = k[i]), (k[i] = 1);
      s.tmSkid = keep;
    },
    // What a car's tyres are throwing up (tests): the surface under each wheel, how hard each slides (0..1), and how
    // many chips and puffs are alive in its scene.
    spray: (car) => {
      const c = cars.get(car);
      return c?.spray ? { u: [...c.wu], slide: [...c.spray.slide], chips: c.pool?.pools[0].live ?? 0, puffs: c.pool?.pools[1].live ?? 0, on: c.pool?.on ?? false, ghost: c.ghost } : null;
    },
    // A car's reactor jets (tests): the boost the page has for it, frames left, each wheel's flame (0..1, and whether
    // the mesh shows), the hover lift it draws the wheels up by and whether a wheel touched the ground.
    jets: (car) => {
      const c = cars.get(car);
      return c ? { reactor: c.reactor ? Object.keys(REACTOR).find((k) => REACTOR[k] === c.reactor) : null, left: c.rLeft, power: c.jet ? [...c.jet.power] : null, shown: c.jet ? c.jet.meshes.map((m) => m.visible) : null, steer: c.jet?.steer ?? 0, lift: c.lift, ground: c.rGround } : null;
    },
    looks: LOOKS,
  };
})();
