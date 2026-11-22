// Scenery: rocks, trees, bushes, cacti, palms, cabins, fences, lamps, flags, stands and a few landmarks, for the editor's
// Scenery category and for Auto deco (tm_autodeco.js), which places them round a track instead of building them out of
// stock blocks. Every shape is generated here, faceted like the game's own models.
//
// They collide like any other block: the car hits the trunk, the rock, the wall. The collision mesh is the drawn one.
// Tall grass is the exception: its blades (SceneGrass, used nowhere else) are in build.js NO_PHYSICS, so a car drives
// through it, and a block with nothing solid adds nothing to the physics at all.
//
// Colours: faces that look up take the plain material (Leaf, Needle, RockTop, Grass...), the rest its B shade. The
// Scenery palette (build.js) recolours them by slot, like the game's own blocks: summer as written, winter snows on the
// faces that look up, desert dries them, and each custom slot paints every block's main part (its leaves, rock, roof,
// cloth, seats, pole or planks) that colour. The trunk, plaster, windows and the ground under a tree keep theirs.
const G = require('./geom');
const { Mesh, add, sub, mul, dot, cross, norm, TAU } = G;

// The same numbers on every build.
function rng(seed) {
  let a = seed >>> 0 || 1;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + (b - a) * r();
  return r;
}

// ---- convex hulls -------------------------------------------------------------------------------------------------
// Faces of the convex hull of pts (outward), as index triples. Incremental; fine for the few dozen points used here.
function hull(pts) {
  const n = pts.length;
  const normal = (a, b, c) => cross(sub(pts[b], pts[a]), sub(pts[c], pts[a]));
  // A starting tetrahedron from points far apart.
  let i0 = 0,
    i1 = 0;
  for (let i = 1; i < n; i++) if (pts[i][0] < pts[i0][0]) i0 = i;
  for (let i = 1; i < n; i++) if (G.len(sub(pts[i], pts[i0])) > G.len(sub(pts[i1], pts[i0]))) i1 = i;
  let i2 = -1,
    best = 0;
  for (let i = 0; i < n; i++) {
    const a = G.len(cross(sub(pts[i1], pts[i0]), sub(pts[i], pts[i0])));
    if (a > best) (best = a), (i2 = i);
  }
  let i3 = -1;
  best = 0;
  const n0 = normal(i0, i1, i2);
  for (let i = 0; i < n; i++) {
    const d = Math.abs(dot(n0, sub(pts[i], pts[i0])));
    if (d > best) (best = d), (i3 = i);
  }
  if (i2 < 0 || i3 < 0) throw new Error('flat hull');
  const centre = mul(add(add(pts[i0], pts[i1]), add(pts[i2], pts[i3])), 0.25);
  let faces = [];
  const addFace = (a, b, c) => {
    if (dot(normal(a, b, c), sub(pts[a], centre)) < 0) [b, c] = [c, b];
    faces.push([a, b, c]);
  };
  addFace(i0, i1, i2);
  addFace(i0, i1, i3);
  addFace(i0, i2, i3);
  addFace(i1, i2, i3);
  const used = new Set([i0, i1, i2, i3]);
  for (let p = 0; p < n; p++) {
    if (used.has(p)) continue;
    const vis = faces.map((f) => dot(normal(...f), sub(pts[p], pts[f[0]])) > 1e-7 * (1 + G.len(normal(...f))));
    if (!vis.some(Boolean)) continue;
    const edges = new Map();
    faces.forEach((f, k) => {
      if (!vis[k]) return;
      for (let e = 0; e < 3; e++) {
        const a = f[e],
          b = f[(e + 1) % 3];
        const back = b + ',' + a;
        if (edges.has(back)) edges.delete(back);
        else edges.set(a + ',' + b, [a, b]);
      }
    });
    faces = faces.filter((_, k) => !vis[k]);
    for (const [a, b] of edges.values()) faces.push([a, b, p]);
  }
  return faces;
}

// Puts a hull of pts into m; mat(normal, centre) picks each face's material.
function hullInto(m, pts, mat) {
  const c = mul(pts.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / pts.length);
  for (const [a, b, d] of hull(pts)) {
    const A = pts[a],
      B = pts[b],
      D = pts[d];
    const nr = norm(cross(sub(B, A), sub(D, A)));
    const fc = mul(add(add(A, B), D), 1 / 3);
    const want = dot(nr, sub(fc, c)) >= 0 ? nr : mul(nr, -1);
    m.triFacing(mat(want, fc), A, B, D, want);
  }
}
// Points on a lumpy ellipsoid round c (radii r), the lumps from r(). y below floor is pressed flat onto it.
function blobPts(r, c, rad, { n = 24, lump = 0.18, floor = null } = {}) {
  const out = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n,
      s = Math.sqrt(1 - y * y),
      a = i * g + r() * 0.6;
    const k = 1 + lump * (r() * 2 - 1);
    const p = [c[0] + Math.cos(a) * s * rad[0] * k, c[1] + y * rad[1] * k, c[2] + Math.sin(a) * s * rad[2] * k];
    if (floor != null && p[1] < floor) p[1] = floor;
    out.push(p);
  }
  return out;
}
// Up-facing faces one material, the rest another.
const byUp = (top, side, k = 0.55) => (nr) => (nr[1] > k ? top : side);

// ---- tubes --------------------------------------------------------------------------------------------------------
// A tube through points P with radii R, n sides, closed at both ends (the foot cap is left off when it sits on the
// ground or inside something).
function tube(m, mat, P, R, n = 7, { capTop = true, capFoot = false, topMat = mat } = {}) {
  let up = [0, 0, 1];
  const rings = [];
  for (let k = 0; k < P.length; k++) {
    const t = norm(sub(P[Math.min(P.length - 1, k + 1)], P[Math.max(0, k - 1)]));
    let u = sub(up, mul(t, dot(up, t)));
    if (G.len(u) < 1e-4) u = Math.abs(t[0]) < 0.9 ? cross(t, [1, 0, 0]) : cross(t, [0, 1, 0]);
    u = norm(u);
    up = u;
    const v = cross(t, u);
    // Never below the part's own layer (a leaning trunk's foot ring tilts).
    rings.push([...Array(n)].map((_, i) => {
      const q = add(P[k], add(mul(u, Math.cos((i / n) * TAU) * R[k]), mul(v, Math.sin((i / n) * TAU) * R[k])));
      return [q[0], Math.max(0, q[1]), q[2]];
    }));
  }
  for (let k = 0; k + 1 < rings.length; k++)
    for (let i = 0; i < n; i++) {
      const a = rings[k][i],
        b = rings[k][(i + 1) % n],
        c = rings[k + 1][(i + 1) % n],
        d = rings[k + 1][i];
      const mid = mul(add(add(a, b), add(c, d)), 0.25);
      const cen = mul(add(P[k], P[k + 1]), 0.5);
      m.quadFacing(mat, a, b, c, d, sub(mid, cen));
    }
  const cap = (k, dir, mt) => {
    for (let i = 0; i < n; i++) m.triFacing(mt, P[k], rings[k][i], rings[k][(i + 1) % n], dir);
  };
  if (capTop) cap(P.length - 1, sub(P[P.length - 1], P[P.length - 2]), topMat);
  if (capFoot) cap(0, sub(P[0], P[1]), topMat);
}
// A bent trunk from the ground: the foot flared, thinning as it rises, its top leaning by lean (x, z).
function trunk(m, mat, h, r0, r1, lean = [0, 0], steps = 6) {
  const P = [],
    R = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    P.push([lean[0] * t * t, h * t, lean[1] * t * t]);
    R.push((k == 0 ? r0 * 1.35 : r0) + (r1 - r0) * t);
  }
  tube(m, mat, P, R, 7);
  return P[P.length - 1];
}

// ---- rocks --------------------------------------------------------------------------------------------------------
const rockMat = (nr, fc, r) => (nr[1] > 0.62 ? 'SceneRockTop' : (Math.floor(fc[0] * 0.7 + fc[1] * 1.3 + fc[2] * 0.9) & 1) ? 'SceneRockB' : 'SceneRock');
function rock(seed, rad, { n = 24, lump = 0.22, sink = 0.28, at = [0, 0, 0] } = {}) {
  const m = new Mesh();
  rockInto(m, seed, rad, { n, lump, sink, at });
  return m;
}
function rockInto(m, seed, rad, { n = 24, lump = 0.22, sink = 0.28, at = [0, 0, 0] } = {}) {
  const r = rng(seed);
  const pts = blobPts(r, [at[0], at[1] + rad[1] * (1 - sink), at[2]], rad, { n, lump, floor: at[1] });
  hullInto(m, pts, (nr, fc) => rockMat(nr, fc, r));
}

// ---- trees --------------------------------------------------------------------------------------------------------
// A grass mound at the foot.
function mound(m, seed, R, h) {
  const r = rng(seed);
  const pts = blobPts(r, [0, -h * 0.6, 0], [R, h * 1.6, R], { n: 18, lump: 0.12, floor: 0 });
  hullInto(m, pts, () => 'SceneMound');
}
// A crown of overlapping faceted blobs round c, up-facing faces light, the rest the darker shade.
function crown(m, seed, c, R, H, lobes = 4, mats = ['SceneLeaf', 'SceneLeafB']) {
  const r = rng(seed);
  hullInto(m, blobPts(r, c, [R, H, R], { n: 30, lump: 0.16 }), byUp(...mats, 0.35));
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * TAU + r() * 0.8,
      d = R * r.range(0.45, 0.7);
    const lr = R * r.range(0.5, 0.7);
    hullInto(m, blobPts(r, [c[0] + Math.cos(a) * d, c[1] - H * r.range(0.05, 0.35), c[2] + Math.sin(a) * d], [lr, lr * (H / R) * r.range(0.8, 1), lr], { n: 22, lump: 0.18 }), byUp(...mats, 0.35));
  }
}
// A broadleaf tree: a mound, a bent trunk with a few branches, a big rounded crown. No pole through the top.
function tree(seed, { h, R, H = R * 0.8, lean = [0, 0], lobes = 4, moundR = R * 0.45, tall = false }) {
  const m = new Mesh();
  const r = rng(seed);
  if (moundR) mound(m, seed + 1, moundR, Math.min(1.6, moundR * 0.3));
  const top = trunk(m, 'SceneBark', h, Math.max(0.6, R * 0.09), Math.max(0.35, R * 0.05), lean);
  // Branches out of the upper trunk into the crown.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + r() * 1.2,
      y = h * r.range(0.6, 0.85);
    const from = [lean[0] * (y / h) ** 2, y, lean[1] * (y / h) ** 2];
    const to = [from[0] + Math.cos(a) * R * 0.45, y + R * 0.35, from[2] + Math.sin(a) * R * 0.45];
    tube(m, 'SceneBark', [from, mul(add(from, to), 0.5), to], [R * 0.045 + 0.2, R * 0.035 + 0.15, R * 0.025 + 0.1], 5);
  }
  crown(m, seed + 2, [top[0], h + H * (tall ? 0.6 : 0.45), top[2]], R, H, lobes);
  return m;
}
// A conifer: a short trunk under stacked faceted cones, each a little smaller and turned.
function pine(seed, { h, R, tiers = 4 }) {
  const m = new Mesh();
  const r = rng(seed);
  const foot = h * 0.12;
  trunk(m, 'SceneBark', foot + h * 0.3, Math.max(0.5, R * 0.12), Math.max(0.3, R * 0.07));
  let y = foot;
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers;
    const rr = R * (1 - f * 0.72),
      th = (h - foot) * (1.6 / (tiers + 0.6)),
      n = 7 + (t % 2);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + t * 0.4 + r() * 0.2;
      const k = rr * r.range(0.85, 1.08);
      pts.push([Math.cos(a) * k, y + r.range(-0.3, 0.3) - th * 0.08, Math.sin(a) * k]);
      pts.push([Math.cos(a + 0.3) * k * 0.55, y - th * 0.18, Math.sin(a + 0.3) * k * 0.55]);
    }
    pts.push([r.range(-0.2, 0.2), y + th, r.range(-0.2, 0.2)]);
    hullInto(m, pts, byUp('SceneNeedle', 'SceneNeedleB', 0.3));
    y += th * 0.58;
  }
  return m;
}
function bush(seed, R) {
  const m = new Mesh();
  const r = rng(seed);
  const n = 2 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const a = r() * TAU,
      d = i ? R * r.range(0.4, 0.7) : 0,
      rr = R * (i ? r.range(0.55, 0.75) : 1);
    hullInto(m, blobPts(r, [Math.cos(a) * d, rr * 0.55, Math.sin(a) * d], [rr, rr * 0.8, rr], { n: 20, lump: 0.2, floor: 0 }), byUp('SceneLeaf', 'SceneLeafB', 0.35));
  }
  return m;
}
// Tall grass: a clump of thin blades leaning out. Drawn only: cars drive through it (see the header).
function tuft(seed, R, h) {
  const m = new Mesh();
  const r = rng(seed);
  for (let i = 0; i < 9; i++) {
    const a = r() * TAU,
      d = R * Math.sqrt(r());
    const x = Math.cos(a) * d,
      z = Math.sin(a) * d,
      hh = h * r.range(0.6, 1.1);
    const tip = [x * 1.5 + r.range(-0.3, 0.3), hh, z * 1.5 + r.range(-0.3, 0.3)];
    const w = 0.22;
    const b = [[x - w, 0, z - w], [x + w, 0, z - w], [x + w, 0, z + w], [x - w, 0, z + w]];
    for (let e = 0; e < 4; e++) {
      const c = mul(add(add(b[e], b[(e + 1) % 4]), tip), 1 / 3);
      m.triFacing('SceneGrass', b[e], b[(e + 1) % 4], tip, sub(c, [x, hh * 0.3, z]));
    }
  }
  return m;
}
// A saguaro: a ribbed column with arms that turn up.
function cactus(seed, h, arms) {
  const m = new Mesh();
  const r = rng(seed);
  const R = h * 0.09 + 0.5;
  // Ribs the B shade, the tops the plain one (snow in winter).
  const col = (P, rad) => tube(m, 'SceneCactusB', P, P.map((_, k) => (k == P.length - 1 ? rad * 0.75 : rad)), 8, { topMat: 'SceneCactus' });
  col([[0, 0, 0], [0, h * 0.5, 0], [0, h * 0.95, 0], [0, h, 0]], R);
  for (let i = 0; i < arms; i++) {
    const a = i * Math.PI + r.range(-0.4, 0.4),
      y = h * r.range(0.3, 0.55),
      out = R * 2.4;
    const dx = Math.cos(a),
      dz = Math.sin(a);
    col([[dx * R * 0.5, y, dz * R * 0.5], [dx * out, y + R * 0.3, dz * out], [dx * out * 1.05, y + R * 1.6, dz * out * 1.05], [dx * out * 1.05, y + h * r.range(0.25, 0.4), dz * out * 1.05]], R * 0.68);
  }
  return m;
}
// A palm: a curved, ringed trunk and drooping fronds (thin, closed, seen from both sides).
function palm(seed, h) {
  const m = new Mesh();
  const r = rng(seed);
  const lean = [r.range(2, 4), 0, r.range(-1, 1)];
  const P = [],
    R = [];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    P.push([lean[0] * t * t, h * t, lean[2] * t * t]);
    R.push((k % 2 ? 0.62 : 0.72) - t * 0.2);
  }
  tube(m, 'SceneBark', P, R, 7);
  const top = P[P.length - 1];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + r() * 0.4,
      L = r.range(8.5, 11);
    const dx = Math.cos(a),
      dz = Math.sin(a);
    const pts = [];
    for (let s = 0; s <= 5; s++) {
      const t = s / 5;
      pts.push([top[0] + dx * L * t, top[1] + 1.2 * Math.sin(t * Math.PI * 0.6) * 2 - t * t * 3.5, top[2] + dz * L * t]);
    }
    const side = [-dz, 0, dx];
    for (let s = 0; s < 5; s++) {
      const w0 = 1.4 * Math.sin(((s + 0.3) / 5.3) * Math.PI) + 0.1,
        w1 = 1.4 * Math.sin(((s + 1.3) / 5.3) * Math.PI) + 0.1;
      const a0 = add(pts[s], mul(side, w0)),
        b0 = add(pts[s], mul(side, -w0)),
        a1 = add(pts[s + 1], mul(side, w1)),
        b1 = add(pts[s + 1], mul(side, -w1));
      const ridge0 = add(pts[s], [0, 0.18, 0]),
        ridge1 = add(pts[s + 1], [0, 0.18, 0]);
      const under0 = add(pts[s], [0, -0.12, 0]),
        under1 = add(pts[s + 1], [0, -0.12, 0]);
      m.quadFacing('SceneLeaf', a0, ridge0, ridge1, a1, [0, 1, 0]);
      m.quadFacing('SceneLeaf', ridge0, b0, b1, ridge1, [0, 1, 0]);
      m.quadFacing('SceneLeafB', a0, under0, under1, a1, [0, -1, 0]);
      m.quadFacing('SceneLeafB', under0, b0, b1, under1, [0, -1, 0]);
    }
  }
  hullInto(m, blobPts(r, [top[0], top[1] - 0.6, top[2]], [1.1, 0.9, 1.1], { n: 14 }), () => 'SceneWoodB');
  return m;
}
// A dead tree: a bare trunk forking into crooked branches.
function deadTree(seed, h) {
  const m = new Mesh();
  const r = rng(seed);
  const top = trunk(m, 'SceneTimber', h * 0.6, 0.8, 0.45, [r.range(-1, 1), r.range(-1, 1)]);
  const branch = (from, a, len, rad, depth) => {
    const to = [from[0] + Math.cos(a) * len * 0.7, from[1] + len * 0.75, from[2] + Math.sin(a) * len * 0.7];
    tube(m, 'SceneTimber', [from, to], [rad, rad * 0.55], 5);
    if (depth > 0) for (const d of [-0.7, 0.8]) branch(to, a + d + r.range(-0.3, 0.3), len * 0.62, rad * 0.55, depth - 1);
  };
  for (let i = 0; i < 3; i++) branch(top, (i / 3) * TAU + r() * 0.6, h * 0.35, 0.42, 2);
  return m;
}
function log(seed, L, R) {
  const m = new Mesh();
  // Bark round it, both cut ends the paler wood inside.
  tube(m, 'SceneTimber', [[-L / 2, R, 0], [0, R * 1.02, 0], [L / 2, R, 0]], [R, R * 1.05, R * 0.95], 8, { capFoot: true, topMat: 'SceneWood' });
  return m;
}

// ---- built things -------------------------------------------------------------------------------------------------
// A gable roof along z over a w x d box whose walls stand h tall, with overhang o and thickness t.
function gable(m, w, d, h, rise, o = 1.2, t = 0.5) {
  const x = w / 2 + o,
    z = d / 2 + o;
  for (const s of [-1, 1]) {
    const e0 = [s * x, h - o * (rise / (w / 2)), -z],
      e1 = [s * x, h - o * (rise / (w / 2)), z],
      r0 = [0, h + rise, -z],
      r1 = [0, h + rise, z];
    const up = norm([s * rise, w / 2, 0]);
    m.quadFacing(s < 0 ? 'SceneRoof' : 'SceneRoofB', e0, r0, r1, e1, up);
    const dn = mul(up, -t);
    m.quadFacing('SceneWoodB', add(e0, dn), add(r0, dn), add(r1, dn), add(e1, dn), mul(up, -1));
    m.quadFacing('SceneWoodB', e0, add(e0, dn), add(e1, dn), e1, [s, 0, 0]);
    for (const zz of [-z, z]) m.quadFacing('SceneWoodB', [s * x, e0[1], zz], [0, h + rise, zz], add([0, h + rise, zz], dn), add([s * x, e0[1], zz], dn), [0, 0, Math.sign(zz)]);
  }
  // Gable ends of wall under the roof.
  for (const zz of [-d / 2, d / 2]) m.triFacing('SceneWall', [-w / 2, h, zz], [w / 2, h, zz], [0, h + rise - 0.1, zz], [0, 0, Math.sign(zz)]);
}
// A window or door: a panel standing a little proud of the wall face at x = wx (facing along +-x) or z = wz.
function panelX(m, mat, x, nx, z0, z1, y0, y1) {
  const xx = x + nx * 0.12;
  m.quadFacing(mat, [xx, y0, z0], [xx, y0, z1], [xx, y1, z1], [xx, y1, z0], [nx, 0, 0]);
}
function panelZ(m, mat, z, nz, x0, x1, y0, y1) {
  const zz = z + nz * 0.12;
  m.quadFacing(mat, [x0, y0, zz], [x1, y0, zz], [x1, y1, zz], [x0, y1, zz], [0, 0, nz]);
}
function cabin(w, d, h, rise, { wall = 'SceneWood', storeys = 1 } = {}) {
  const m = new Mesh();
  m.box('SceneStone', [-w / 2 - 0.4, 0, -d / 2 - 0.4], [w / 2 + 0.4, 0.8, d / 2 + 0.4], 'SceneStoneB');
  m.box(wall, [-w / 2, 0.8, -d / 2], [w / 2, h, d / 2]);
  if (storeys > 1) m.box('SceneWoodB', [-w / 2 - 0.15, h * 0.48, -d / 2 - 0.15], [w / 2 + 0.15, h * 0.48 + 0.4, d / 2 + 0.15]);
  gable(m, w, d, h, rise);
  // Door on the front (-z), windows down both long sides and on the front.
  panelZ(m, 'SceneDark', -d / 2, -1, -1.1, 1.1, 0.8, 3.6);
  for (let s = 0; s < storeys; s++) {
    const y0 = 1.9 + s * (h * 0.48),
      y1 = y0 + 1.6;
    for (const z of [-d / 4, d / 4]) {
      panelX(m, 'SceneWindow', -w / 2, -1, z - 0.9, z + 0.9, y0, y1);
      panelX(m, 'SceneWindow', w / 2, 1, z - 0.9, z + 0.9, y0, y1);
    }
    if (s) for (const x of [-w / 4, w / 4]) panelZ(m, 'SceneWindow', -d / 2, -1, x - 0.9, x + 0.9, y0, y1);
  }
  // A stone chimney through the roof.
  m.box('SceneStone', [w / 4 - 0.8, h - 1, d / 4 - 0.8], [w / 4 + 0.8, h + rise + 1.5, d / 4 + 0.8], 'SceneStoneB');
  return m;
}
function fence(L = 20) {
  const m = new Mesh();
  for (let x = -L / 2 + 0.5; x <= L / 2; x += 5) m.box('SceneFence', [x - 0.25, 0, -0.25], [x + 0.25, 2.2, 0.25], 'SceneFenceB');
  for (const y of [0.9, 1.7]) m.box('SceneFenceB', [-L / 2 + 0.2, y, -0.12], [L / 2 - 0.2, y + 0.3, 0.12]);
  return m;
}
function stoneWall(seed, L = 20) {
  const m = new Mesh();
  const r = rng(seed);
  for (let x = -L / 2 + 1.2; x < L / 2 - 0.6; ) {
    const w = r.range(1.4, 2.4);
    rockInto(m, Math.floor(r() * 1e9), [w * 0.55, 0.9, 0.85], { n: 14, lump: 0.15, sink: 0.05, at: [x + w / 2, 0, r.range(-0.15, 0.15)] });
    x += w * 0.92;
  }
  for (let x = -L / 2 + 2.2; x < L / 2 - 1.5; ) {
    const w = r.range(1.4, 2.2);
    rockInto(m, Math.floor(r() * 1e9), [w * 0.5, 0.75, 0.7], { n: 12, lump: 0.15, sink: 0.05, at: [x + w / 2, 1.3, r.range(-0.1, 0.1)] });
    x += w * 1.05;
  }
  return m;
}
function lamp() {
  const m = new Mesh();
  m.box('SceneStone', [-0.6, 0, -0.6], [0.6, 0.6, 0.6], 'SceneStoneB');
  tube(m, 'ScenePole', [[0, 0.6, 0], [0, 8.6, 0]], [0.22, 0.16], 6);
  tube(m, 'ScenePole', [[0, 8.2, 0], [0, 8.9, -0.8], [0, 8.9, -1.8]], [0.12, 0.12, 0.12], 5);
  m.box('ScenePole', [-0.55, 8.1, -2.35], [0.55, 8.3, -1.25]);
  m.box('SceneWindow', [-0.45, 7.2, -2.25], [0.45, 8.1, -1.35]);
  m.box('ScenePole', [-0.6, 8.3, -2.4], [0.6, 8.6, -1.2]);
  return m;
}
// A flag on a pole, the cloth waving a little; thin but closed, so it reads from both sides.
function flag(h = 15) {
  const m = new Mesh();
  m.box('SceneStone', [-0.7, 0, -0.7], [0.7, 0.5, 0.7], 'SceneStoneB');
  tube(m, 'SceneMetal', [[0, 0.5, 0], [0, h, 0]], [0.18, 0.13], 6);
  hullInto(m, blobPts(rng(9), [0, h + 0.25, 0], [0.35, 0.35, 0.35], { n: 10 }), () => 'SceneMetal');
  const W = 6,
    H = 3.8,
    N = 6,
    t = 0.08;
  for (let i = 0; i < N; i++) {
    const x0 = 0.2 + (W * i) / N,
      x1 = 0.2 + (W * (i + 1)) / N;
    const z0 = Math.sin((i / N) * Math.PI * 1.5) * 0.45,
      z1 = Math.sin(((i + 1) / N) * Math.PI * 1.5) * 0.45;
    const y0 = h - 0.3 - H - (i / N) * 0.6,
      y1 = h - 0.3 - H - ((i + 1) / N) * 0.6;
    const mat = i % 2 ? 'SceneClothB' : 'SceneCloth';
    m.quadFacing(mat, [x0, y0, z0 + t], [x1, y1, z1 + t], [x1, h - 0.3, z1 + t], [x0, h - 0.3, z0 + t], [0, 0, 1]);
    m.quadFacing(mat, [x0, y0, z0 - t], [x1, y1, z1 - t], [x1, h - 0.3, z1 - t], [x0, h - 0.3, z0 - t], [0, 0, -1]);
  }
  return m;
}
// A small grandstand facing -z: three rows of seats on a frame under a canopy, 20 wide.
function stand() {
  const m = new Mesh();
  const W = 19.6;
  for (let row = 0; row < 4; row++) {
    const z = row * 2.6,
      y = 0.8 + row * 1.6;
    m.box('SceneMetal', [-W / 2, 0, z - 1.3], [W / 2, y - 0.5, z + 1.3]);
    m.box(row % 2 ? 'SceneSeat' : 'SceneSeatB', [-W / 2 + 0.3, y - 0.5, z - 0.9], [W / 2 - 0.3, y + 0.1, z + 0.4]);
    m.box(row % 2 ? 'SceneSeat' : 'SceneSeatB', [-W / 2 + 0.3, y + 0.1, z + 0.4], [W / 2 - 0.3, y + 1.1, z + 0.9]);
  }
  m.box('SceneMetal', [-W / 2, 0, 9], [W / 2, 9, 9.6]);
  for (const x of [-W / 2 + 0.4, 0, W / 2 - 0.4]) m.box('SceneMetal', [x - 0.25, 0, -1.6], [x + 0.25, 10.4, -1.1]);
  m.box('SceneCloth', [-W / 2 - 0.6, 10.4, -2.6], [W / 2 + 0.6, 10.9, 9.8], 'SceneClothB');
  return m;
}
// A windmill: a tapering stone tower, a conical cap and four lattice sails on the -z side.
function windmill(seed) {
  const m = new Mesh();
  const r = rng(seed);
  const H = 22;
  tube(m, 'SceneWall', [[0, 0, 0], [0, H, 0]], [6.5, 4.6], 10, { capTop: false });
  const cone = [];
  for (let i = 0; i < 10; i++) cone.push([Math.cos((i / 10) * TAU) * 5.6, H - 0.3, Math.sin((i / 10) * TAU) * 5.6]);
  cone.push([0, H + 7, 0]);
  hullInto(m, cone, (nr) => (nr[1] > 0 ? 'SceneRoof' : 'SceneWoodB'));
  panelZ(m, 'SceneDark', -6.35, -1, -1.3, 1.3, 0, 3.8);
  for (const y of [8, 14]) panelZ(m, 'SceneWindow', -5.9 + (y - 8) * 0.12, -1, -0.8, 0.8, y, y + 1.6);
  const hub = [0, H - 2, -5.6];
  tube(m, 'SceneWoodB', [[0, H - 2, -3.5], hub], [0.6, 0.6], 6);
  const L = 14;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const dx = Math.cos(a),
      dy = Math.sin(a);
    const tip = add(hub, [dx * L, dy * L, -0.3]);
    tube(m, 'SceneWoodB', [hub, tip], [0.35, 0.25], 5);
    const side = [-dy, dx, 0];
    const p0 = add(hub, [dx * 2.5, dy * 2.5, -0.35]),
      p1 = add(tip, [0, 0, -0.05]);
    const q0 = add(p0, mul(side, 2.6)),
      q1 = add(p1, mul(side, 2.6));
    m.quadFacing('SceneSail', p0, p1, q1, q0, [0, 0, -1]);
    m.quadFacing('SceneSail', add(p0, [0, 0, 0.15]), add(p1, [0, 0, 0.15]), add(q1, [0, 0, 0.15]), add(q0, [0, 0, 0.15]), [0, 0, 1]);
    tube(m, 'SceneWoodB', [q0, q1], [0.15, 0.15], 4);
  }
  void r;
  return m;
}
// A ruined tower: square stone walls with a broken top, dark window slits, rubble at the foot.
function ruin(seed) {
  const m = new Mesh();
  const r = rng(seed);
  const W = 11,
    T = 1.4,
    H = 24;
  const wall = (x0, z0, x1, z1) => {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = i / n,
        b = (i + 1) / n;
      const top = H - (i == 2 || i == 3 ? r.range(6, 11) : r.range(0, 3));
      m.box(i % 2 ? 'SceneStoneB' : 'SceneStone', [x0 + (x1 - x0) * a, 0, z0 + (z1 - z0) * a], [x0 + (x1 - x0) * b + (x1 == x0 ? T : 0), top, z0 + (z1 - z0) * b + (z1 == z0 ? T : 0)]);
    }
  };
  wall(-W / 2, -W / 2, W / 2, -W / 2);
  wall(-W / 2, W / 2 - T, W / 2, W / 2 - T);
  wall(-W / 2, -W / 2, -W / 2, W / 2);
  wall(W / 2 - T, -W / 2, W / 2 - T, W / 2);
  for (const y of [5, 12]) {
    panelZ(m, 'SceneDark', -W / 2, -1, -0.5, 0.5, y, y + 2.6);
    panelX(m, 'SceneDark', -W / 2, -1, -0.5, 0.5, y + 2, y + 4.6);
    panelX(m, 'SceneDark', W / 2, 1, -0.5, 0.5, y + 1, y + 3.6);
  }
  for (let i = 0; i < 7; i++) {
    const a = r() * TAU,
      d = W * 0.62 + r() * 3;
    rockInto(m, Math.floor(r() * 1e9), [r.range(0.8, 1.6), r.range(0.6, 1.1), r.range(0.8, 1.6)], { n: 12, at: [Math.cos(a) * d, 0, Math.sin(a) * d] });
  }
  return m;
}
// A lighthouse: banded tapering tower, a gallery and a lit lamp room under a cap.
function lighthouse() {
  const m = new Mesh();
  const H = 26;
  for (let b = 0; b < 4; b++) {
    const y0 = (H / 4) * b,
      y1 = (H / 4) * (b + 1);
    tube(m, b % 2 ? 'SceneCloth' : 'SceneWall', [[0, y0, 0], [0, y1, 0]], [5 - y0 * 0.06, 5 - y1 * 0.06], 12, { capTop: false });
  }
  tube(m, 'SceneMetal', [[0, H, 0], [0, H + 0.6, 0]], [4.2, 4.2], 12);
  tube(m, 'SceneWindow', [[0, H + 0.6, 0], [0, H + 3.4, 0]], [2.4, 2.4], 10, { capTop: false });
  const cap = [];
  for (let i = 0; i < 10; i++) cap.push([Math.cos((i / 10) * TAU) * 2.9, H + 3.4, Math.sin((i / 10) * TAU) * 2.9]);
  cap.push([0, H + 5.6, 0]);
  hullInto(m, cap, () => 'SceneRoof');
  panelZ(m, 'SceneDark', -5, -1, -1.1, 1.1, 0, 3.6);
  return m;
}
// A rock arch: two leaning faceted legs joined by a span of overlapping boulders along an arc.
function rockArch(seed) {
  const m = new Mesh();
  const r = rng(seed);
  const span = 13,
    H = 17;
  for (let i = 0; i <= 9; i++) {
    const t = i / 9,
      a = Math.PI * (1 - t);
    const x = Math.cos(a) * span,
      y = Math.sin(a) * (H - 5) + 1;
    const foot = i == 0 || i == 9;
    const s = foot ? 6.5 : 5;
    rockInto(m, Math.floor(r() * 1e9), [s * r.range(0.9, 1.1), s * 0.9, s * r.range(1.1, 1.35)], { n: 20, lump: 0.2, sink: foot ? 0.5 : 0, at: [x, Math.max(0, y - s * 0.9), r.range(-0.6, 0.6)] });
  }
  return m;
}
// A mesa: a flat-topped butte in two bands of rock, with fallen boulders round its foot.
function mesa(seed) {
  const m = new Mesh();
  const r = rng(seed);
  const band = (y0, y1, R, mat) => {
    const pts = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + r() * 0.2,
        k = R * r.range(0.82, 1.08);
      pts.push([Math.cos(a) * k * 1.25, y0, Math.sin(a) * k]);
      pts.push([Math.cos(a + 0.1) * k * 1.18, y1, Math.sin(a + 0.1) * k * 0.94]);
    }
    hullInto(m, pts, (nr) => (nr[1] > 0.6 ? 'SceneRockTop' : mat));
  };
  band(0, 7, 13, 'SceneRock');
  band(7, 13, 11.5, 'SceneRockB');
  band(13, 18, 10.5, 'SceneRock');
  for (let i = 0; i < 6; i++) {
    const a = r() * TAU;
    rockInto(m, Math.floor(r() * 1e9), [r.range(1.5, 3), r.range(1.2, 2.2), r.range(1.5, 3)], { n: 14, at: [Math.cos(a) * 17, 0, Math.sin(a) * 13.5] });
  }
  return m;
}
// Ice crystals: long faceted shards leaning out of a frozen base.
function crystals(seed) {
  const m = new Mesh();
  const r = rng(seed);
  rockInto(m, seed + 3, [6, 2, 5], { n: 18 });
  for (let i = 0; i < 8; i++) {
    const a = r() * TAU,
      d = r.range(0, 3.5),
      L = r.range(7, 17),
      lean = r.range(0.1, 0.5);
    const base = [Math.cos(a) * d, 0.5, Math.sin(a) * d];
    const dir = norm([Math.cos(a) * lean, 1, Math.sin(a) * lean]);
    const w = r.range(0.9, 1.6);
    const side = norm(cross(dir, [0, 0, 1])),
      side2 = cross(dir, side);
    const pts = [];
    for (let k = 0; k < 6; k++) {
      const q = (k / 6) * TAU;
      pts.push(add(base, add(mul(side, Math.cos(q) * w), mul(side2, Math.sin(q) * w))));
      pts.push(add(add(base, mul(dir, L * 0.8)), add(mul(side, Math.cos(q) * w * 0.85), mul(side2, Math.sin(q) * w * 0.85))));
    }
    pts.push(add(base, mul(dir, L)));
    hullInto(m, pts, (nr) => (nr[1] > 0.5 ? 'SceneIce' : 'SceneIceB'));
  }
  return m;
}

// ---- the set ------------------------------------------------------------------------------------------------------
// The editor's Scenery category (build.js family Scenery), one tab per kind with headings inside.
function buildScenery() {
  const out = [];
  // put(name, label, tab, heading, mesh): no surface of its own, so a wheel on one grips like stock road.
  const put = (name, label, tab, sub, mesh) => out.push({ name: 'Scenery' + name, label, tab, sub, surface: 'Scenery', mesh, u: null });
  put('RockSmall', 'Rock, small', 'Rocks', 'Rocks', rock(11, [2.2, 1.6, 1.9], { n: 18 }));
  put('Rock', 'Rock', 'Rocks', 'Rocks', rock(12, [4, 3, 3.4]));
  put('RockFlat', 'Rock, flat', 'Rocks', 'Rocks', rock(13, [8, 2.2, 6.5], { n: 22, sink: 0.4 }));
  put('Boulder', 'Boulder', 'Rocks', 'Boulders', rock(14, [7, 5.6, 6.2], { n: 28 }));
  put('BoulderBig', 'Boulder, big', 'Rocks', 'Boulders', rock(15, [12, 9, 10.5], { n: 32 }));
  {
    // A spire: a tall narrow rock leaning on a wider foot.
    const m = new Mesh();
    rockInto(m, 16, [5.5, 6, 5], { n: 20, sink: 0.3 });
    rockInto(m, 116, [3.6, 12, 3.2], { n: 16, lump: 0.25, sink: 0.05, at: [0.6, 0, -0.4] });
    put('RockSpire', 'Rock spire', 'Rocks', 'Boulders', m);
  }
  {
    const m = new Mesh();
    const r = rng(17);
    for (const [x, z, s] of [[0, 0, 4.5], [5.5, 2, 3], [-4.5, 3, 2.6], [2, -4.2, 2.2], [-2.5, -3, 1.6], [7, -2.5, 1.5]]) rockInto(m, Math.floor(r() * 1e9), [s * r.range(1, 1.2), s * 0.8, s], { n: 18, at: [x, 0, z] });
    put('Rocks', 'Rocks, group', 'Rocks', 'Rocks', m);
  }
  {
    const m = new Mesh();
    const r = rng(18);
    for (const [x, z, sx, sy, sz] of [[0, 0, 9, 13, 7], [-9, 2, 7, 9, 6], [9, 1.5, 8, 10, 6.5], [-15, 3, 5, 6, 5], [15, 3, 5, 5, 4.5]]) rockInto(m, Math.floor(r() * 1e9), [sx, sy, sz], { n: 26, lump: 0.2, sink: 0.15, at: [x, 0, z] });
    put('Cliff', 'Cliff', 'Rocks', 'Formations', m);
  }
  put('Mesa', 'Mesa', 'Rocks', 'Formations', mesa(19));
  put('RockArch', 'Rock arch', 'Rocks', 'Formations', rockArch(20));
  put('Crystals', 'Ice crystals', 'Rocks', 'Crystals', crystals(21));
  put('TreeSmall', 'Tree, small', 'Trees', 'Broadleaf trees', tree(31, { h: 5.5, R: 5 }));
  put('Tree', 'Tree', 'Trees', 'Broadleaf trees', tree(32, { h: 8, R: 8, lean: [1.2, 0.4] }));
  put('TreeBig', 'Tree, big', 'Trees', 'Broadleaf trees', tree(33, { h: 11, R: 12, lean: [-1.5, 1] }));
  put('TreeHuge', 'Tree, huge', 'Trees', 'Broadleaf trees', tree(34, { h: 14, R: 16, H: 12, lean: [2, -1], lobes: 5 }));
  put('TreeBent', 'Tree, bent', 'Trees', 'Broadleaf trees', tree(35, { h: 10, R: 9, lean: [4.5, 0.5], lobes: 3 }));
  put('TreeTall', 'Tree, tall', 'Trees', 'Broadleaf trees', tree(36, { h: 7, R: 5, H: 12, lobes: 3, tall: true, moundR: 3 }));
  put('PineSmall', 'Pine, small', 'Trees', 'Pines', pine(41, { h: 11, R: 3.6, tiers: 3 }));
  put('Pine', 'Pine', 'Trees', 'Pines', pine(42, { h: 19, R: 5.5, tiers: 4 }));
  put('PineTall', 'Pine, tall', 'Trees', 'Pines', pine(43, { h: 29, R: 7, tiers: 5 }));
  put('Palm', 'Palm', 'Trees', 'Other trees', palm(44, 15));
  put('TreeDead', 'Dead tree', 'Trees', 'Other trees', deadTree(45, 13));
  put('BushSmall', 'Bush, small', 'Plants', 'Bushes', bush(51, 1.8));
  put('Bush', 'Bush', 'Plants', 'Bushes', bush(52, 3.4));
  put('BushBig', 'Bush, big', 'Plants', 'Bushes', bush(53, 5.5));
  put('Tuft', 'Tall grass', 'Plants', 'Grass', tuft(54, 1.2, 2.4));
  put('Cactus', 'Cactus', 'Plants', 'Cacti', cactus(55, 10, 2));
  put('CactusSmall', 'Cactus, small', 'Plants', 'Cacti', cactus(56, 5.5, 1));
  put('Log', 'Log', 'Plants', 'Fallen wood', log(57, 9, 1.1));
  put('Cabin', 'Cabin', 'Buildings', 'Houses', cabin(10, 13, 6, 4.5));
  put('House', 'House', 'Buildings', 'Houses', cabin(12, 16, 9.5, 5.5, { wall: 'SceneWall', storeys: 2 }));
  put('Windmill', 'Windmill', 'Buildings', 'Landmarks', windmill(61));
  put('Ruin', 'Ruined tower', 'Buildings', 'Landmarks', ruin(62));
  put('Lighthouse', 'Lighthouse', 'Buildings', 'Landmarks', lighthouse());
  put('Stand', 'Grandstand', 'Buildings', 'Stands', stand());
  put('Fence', 'Fence', 'Roadside', 'Fences and walls', fence());
  put('StoneWall', 'Stone wall', 'Roadside', 'Fences and walls', stoneWall(71));
  put('Lamp', 'Lamp post', 'Roadside', 'Lamps and flags', lamp());
  put('Flag', 'Flag', 'Roadside', 'Lamps and flags', flag());
  return out;
}

module.exports = { buildScenery, hull };
