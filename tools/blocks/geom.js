// Geometry primitives for the generated blocks. Nothing here is imported from another game:
// every shape is swept or extruded from the cross-sections below.
//
// Local part frame (same as stock parts): origin at the block centre, y up, travel at rotation 0 is -z,
// a one-block part spans x,z in [-10,10], one height layer is 5 units.

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a) => {
  const l = len(a);
  return l < 1e-9 ? [0, 0, 0] : mul(a, 1 / l);
};
const TAU = Math.PI * 2;

class Mesh {
  constructor() {
    this.byMat = new Map();
    this.tris = 0;
  }
  tri(mat, a, b, c) {
    if (len(cross(sub(b, a), sub(c, a))) < 1e-6) return;
    let l = this.byMat.get(mat);
    if (!l) this.byMat.set(mat, (l = []));
    l.push(a, b, c);
    this.tris++;
  }
  quad(mat, a, b, c, d) {
    this.tri(mat, a, b, c);
    this.tri(mat, a, c, d);
  }
  // Same as tri, but flips the winding so the face normal points along `want`.
  triFacing(mat, a, b, c, want) {
    if (dot(cross(sub(b, a), sub(c, a)), want) < 0) this.tri(mat, a, c, b);
    else this.tri(mat, a, b, c);
  }
  quadFacing(mat, a, b, c, d, want) {
    this.triFacing(mat, a, b, c, want);
    this.triFacing(mat, a, c, d, want);
  }
  box(mat, min, max, sideMat) {
    const [x0, y0, z0] = min,
      [x1, y1, z1] = max,
      s = sideMat ?? mat;
    this.quadFacing(mat, [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0]);
    this.quadFacing(s, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
    this.quadFacing(s, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
    this.quadFacing(s, [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1]);
    this.quadFacing(s, [x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0]);
    this.quadFacing(s, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
  }
  // A beam between two points with a square section.
  beam(mat, a, b, w) {
    const t = norm(sub(b, a)),
      r = norm(Math.abs(t[1]) > 0.9 ? cross(t, [1, 0, 0]) : cross(t, [0, 1, 0])),
      u = cross(r, t),
      c = (p, sr, su) => add(add(p, mul(r, sr * w)), mul(u, su * w)),
      sq = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      const [s0, u0] = sq[i],
        [s1, u1] = sq[(i + 1) % 4],
        mid = mul(add(r.map((x) => x * (s0 + s1)), u.map((x) => x * (u0 + u1))), 1);
      this.quadFacing(mat, c(a, s0, u0), c(a, s1, u1), c(b, s1, u1), c(b, s0, u0), mid);
    }
    this.quadFacing(mat, c(b, -1, -1), c(b, 1, -1), c(b, 1, 1), c(b, -1, 1), t);
    this.quadFacing(mat, c(a, -1, -1), c(a, 1, -1), c(a, 1, 1), c(a, -1, 1), mul(t, -1));
  }
  bounds() {
    const a = [Infinity, Infinity, Infinity],
      b = [-Infinity, -Infinity, -Infinity];
    for (const l of this.byMat.values())
      for (const p of l)
        for (let k = 0; k < 3; k++) {
          a[k] = Math.min(a[k], p[k]);
          b[k] = Math.max(b[k], p[k]);
        }
    return { min: a, max: b };
  }
  merge(other, offset = [0, 0, 0]) {
    for (const [m, l] of other.byMat) for (let i = 0; i < l.length; i += 3) this.tri(m, add(l[i], offset), add(l[i + 1], offset), add(l[i + 2], offset));
  }
}

// ---- paths ----------------------------------------------------------------------------------------------

// A horizontal path: straight and arc segments from a start point. dir +1 turns right, -1 left.
// heading 0 travels -z and grows towards +x, so a right-hand 90 degree turn of radius R from (0,10) ends at (R,10-R).
function hPath(segs, start = [0, 10, 0]) {
  let [x, z, h] = start;
  const out = [];
  let s0 = 0;
  for (const seg of segs) {
    if (seg.line != null) {
      const L = seg.line;
      out.push({ s0, L, at: ((x0, z0, h0) => (d) => [x0 + Math.sin(h0) * d, z0 - Math.cos(h0) * d, h0])(x, z, h) });
      x += Math.sin(h) * L;
      z -= Math.cos(h) * L;
      s0 += L;
    } else {
      const { r, ang, dir } = seg,
        L = r * ang;
      const cx = x + Math.cos(h) * r * dir,
        cz = z + Math.sin(h) * r * dir;
      out.push({
        s0,
        L,
        arc: true,
        at: ((h0) => (d) => {
          const a = h0 + (dir * d) / r;
          return [cx - Math.cos(a) * r * dir, cz - Math.sin(a) * r * dir, a];
        })(h),
      });
      h += dir * ang;
      x = cx - Math.cos(h) * r * dir;
      z = cz - Math.sin(h) * r * dir;
      s0 += L;
    }
  }
  return { segs: out, length: s0, end: [x, z, h] };
}

// Most a road may bend, climb or bank between two cross-sections, in radians (2.5 degrees).
const SMOOTH = 2.5 * (Math.PI / 180);

// Turns a horizontal path, a height function y(s) and a roll function roll(s) into sampled frames.
// roll > 0 lifts the left side. The pivot is the slab's bottom centre, the same pivot stock tilted parts use.
function roadRings(path, { y = () => 0, roll = () => 0, step = 5, arcStep = 5, offset = () => 0, marks = [] } = {}) {
  const all = [];
  for (const seg of path.segs) {
    const st = seg.arc ? arcStep : step,
      n = Math.max(1, Math.round(seg.L / st));
    for (let i = 0; i < n; i++) all.push(seg.s0 + (seg.L * i) / n);
  }
  all.push(path.length);
  // Extra cuts where a surface pattern changes colour (plank seams, panel joints).
  for (const m of marks) if (m > 0 && m < path.length) all.push(m);
  all.sort((a, b) => a - b);
  const segAt = (v) => path.segs.find((g) => v <= g.s0 + g.L + 1e-9) ?? path.segs[path.segs.length - 1];
  // Extra cuts wherever the road bends, climbs or banks by more than SMOOTH between two cuts, so turns,
  // hills and dips are smooth to drive while straight, flat pieces keep the cuts they had.
  const dir = (v) => {
      const g = segAt(v),
        h = g.at(v - g.s0)[2],
        e = 1e-3;
      return norm([Math.sin(h), (y(v + e) - y(v - e)) / (2 * e), -Math.cos(h)]);
    },
    bend = (a, b) => {
      const da = dir(a),
        db = dir(b);
      return Math.acos(Math.min(1, da[0] * db[0] + da[1] * db[1] + da[2] * db[2])) + Math.abs(roll(b) - roll(a));
    },
    fine = [];
  for (let k = 0; k < all.length; k++) {
    fine.push(all[k]);
    if (k + 1 == all.length) break;
    const a = all[k],
      b = all[k + 1];
    if (b - a < 0.5) continue;
    // Sampled at quarters too, so an S-bend that ends where it started still counts as bent.
    let t = 0;
    for (let q = 0; q < 4; q++) t += bend(a + ((b - a) * q) / 4, a + ((b - a) * (q + 1)) / 4);
    const n = Math.min(Math.ceil(t / SMOOTH), Math.floor((b - a) / 0.25));
    for (let i = 1; i < n; i++) fine.push(a + ((b - a) * i) / n);
  }
  const ss = [];
  for (const v of fine) {
    if (ss.length && v - ss[ss.length - 1].s < 1e-4) continue;
    ss.push({ s: v, seg: segAt(v) });
  }
  const rings = [];
  for (let i = 0; i < ss.length; i++) {
    const { s, seg } = ss[i],
      [x, z, h] = seg.at(s - seg.s0),
      e = 1e-3,
      dy = (y(s + e) - y(s - e)) / (2 * e),
      T = norm([Math.sin(h), dy, -Math.cos(h)]),
      R0 = [Math.cos(h), 0, Math.sin(h)],
      // Cross-sections stay vertical on slopes, like stock slopes, so deck heights match stock at every joint.
      U0 = [0, 1, 0],
      ph = roll(s),
      c = Math.cos(ph),
      sn = Math.sin(ph),
      R = add(mul(R0, c), mul(U0, -sn)),
      U = add(mul(R0, sn), mul(U0, c));
    rings.push({ p: add([x, y(s), z], mul(R0, offset(s))), R, U, T, s, u: s / path.length, i });
  }
  return rings;
}

// A path in the local y-z plane: a circle of radius r from angle a0 to a1 (0 = entry on the floor heading -z,
// 90 deg = climbing a wall, 180 deg = upside down). `shift` moves x linearly across the arc for offset loops.
// shiftAt(u) gives the sideways offset at fraction u of this arc, for loops that come out beside where they went in.
function loopRings(r, a0, a1, { centerY = r, centerZ = 10, shiftAt = () => 0, step = 5 } = {}) {
  const L = Math.abs(a1 - a0) * r,
    n = Math.max(2, Math.round(L / step), Math.ceil(Math.abs(a1 - a0) / SMOOTH)),
    rings = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n,
      a = a0 + (a1 - a0) * u,
      x = shiftAt(u),
      dx = (shiftAt(Math.min(1, u + 1e-4)) - shiftAt(Math.max(0, u - 1e-4))) / ((Math.min(1, u + 1e-4) - Math.max(0, u - 1e-4)) * L),
      p = [x, centerY - Math.cos(a) * r, centerZ - Math.sin(a) * r],
      T = norm([dx, Math.sin(a), -Math.cos(a)]),
      U = norm(cross([1, 0, 0], T)),
      // x stays exactly sideways, so offset quarters meet edge to edge and never dip below their layer
      R = [1, 0, 0];
    rings.push({ p, R, U, T, s: (L * i) / n, u: i / n, i });
  }
  return rings;
}

// Straight vertical climb up a wall at z = zw.
function wallRings(h, zw = -10, step = 5, y0 = 0) {
  const n = Math.max(1, Math.round(h / step)),
    rings = [];
  for (let i = 0; i <= n; i++) rings.push({ p: [0, y0 + (h * i) / n, zw], R: [1, 0, 0], U: [0, 0, 1], T: [0, 1, 0], s: (h * i) / n, u: i / n, i });
  return rings;
}

// ---- sweeping -------------------------------------------------------------------------------------------

// Sweeps closed convex polygons along rings. `polys(ring)` returns [{pts:[[x,y],...], mats:(edge, ring)=>material, cap}],
// with pts counter-clockwise in (R,U) as seen from behind the travel direction. Vertex counts must not change along the path.
function sweep(mesh, rings, polys) {
  // Each ring knows where the next one is, so a pattern can tell a thin seam band from a full panel.
  for (let k = 0; k < rings.length; k++) rings[k].next = k + 1 < rings.length ? rings[k + 1].s : rings[k].s;
  const place = (r, pt) => add(add(r.p, mul(r.R, pt[0])), mul(r.U, pt[1]));
  const first = polys(rings[0]);
  for (let pi = 0; pi < first.length; pi++) {
    const n = first[pi].pts.length;
    for (let k = 0; k + 1 < rings.length; k++) {
      const P0 = polys(rings[k])[pi],
        P1 = polys(rings[k + 1])[pi];
      if (P0.pts.length != n || P1.pts.length != n) throw new Error('profile vertex count changed along path');
      for (let e = 0; e < n; e++) {
        const m = P0.mats(e, rings[k]);
        if (!m) continue;
        const a = place(rings[k], P0.pts[e]),
          b = place(rings[k], P0.pts[(e + 1) % n]),
          c = place(rings[k + 1], P1.pts[(e + 1) % n]),
          d = place(rings[k + 1], P1.pts[e]);
        mesh.tri(m, a, d, b);
        mesh.tri(m, b, d, c);
      }
    }
    // End caps, so a piece with nothing joined to it does not look hollow.
    // Each end decides its own cap, so a polygon that has sunk out of sight at one end leaves no face there.
    const fan = (r, flip) => {
      const poly = polys(r)[pi];
      if (!poly.cap) return;
      const P = poly.pts.map((q) => place(r, q));
      for (let i = 1; i + 1 < P.length; i++) flip ? mesh.tri(poly.cap, P[0], P[i + 1], P[i]) : mesh.tri(poly.cap, P[0], P[i], P[i + 1]);
    };
    fan(rings[0], false);
    fan(rings[rings.length - 1], true);
  }
}

// A surface patch over a (u,v) grid with a slab under it. f(u,v) -> point, the top faces `want(p)`.
function patch(mesh, f, nu, nv, { mat, under, want, thick = 0.21 }) {
  const P = [];
  for (let i = 0; i <= nu; i++) {
    P.push([]);
    for (let j = 0; j <= nv; j++) P[i].push(f(i / nu, j / nv));
  }
  const nrm = (i, j) => {
    const a = P[Math.min(i + 1, nu)][j],
      b = P[Math.max(i - 1, 0)][j],
      c = P[i][Math.min(j + 1, nv)],
      d = P[i][Math.max(j - 1, 0)];
    let n = norm(cross(sub(a, b), sub(c, d)));
    if (dot(n, want(P[i][j])) < 0) n = mul(n, -1);
    return n;
  };
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const w = want(P[i][j]),
        m = typeof mat == 'function' ? mat(i, j) : mat;
      mesh.quadFacing(m, P[i][j], P[i + 1][j], P[i + 1][j + 1], P[i][j + 1], w);
      if (thick > 0 && under) {
        const o = (a, b) => sub(P[a][b], mul(nrm(a, b), thick));
        mesh.quadFacing(under, o(i, j), o(i + 1, j), o(i + 1, j + 1), o(i, j + 1), mul(w, -1));
      }
    }
}

// Flat star-shaped prism: outline in (x,z) around the origin, y0..y1.
function prism(mesh, outline, y0, y1, { top, side, under, center = [0, 0] }) {
  const n = outline.length,
    c = [center[0], y1, center[1]],
    cb = [center[0], y0, center[1]];
  for (let i = 0; i < n; i++) {
    const a = outline[i],
      b = outline[(i + 1) % n];
    mesh.triFacing(top, c, [a[0], y1, a[1]], [b[0], y1, b[1]], [0, 1, 0]);
    if (under) mesh.triFacing(under, cb, [a[0], y0, a[1]], [b[0], y0, b[1]], [0, -1, 0]);
    if (side) {
      const out = [(a[1] - b[1]) * 1, 0, (b[0] - a[0]) * 1];
      const mid = [(a[0] + b[0]) / 2 - center[0], 0, (a[1] + b[1]) / 2 - center[1]];
      mesh.quadFacing(side, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], dot(out, mid) >= 0 ? out : mul(out, -1));
    }
  }
}

// Which 5x5x5 tiles the mesh touches, as [[min],[max]] ranges (stock part tile format, merged along z).
function rasterTiles(mesh) {
  const cells = new Set();
  const { min, max } = mesh.bounds();
  // A surface exactly on a tile boundary belongs to the tile on the part's own side, or a road end
  // at z = 10 would claim one tile too many and erase the next road placed against it.
  const coord = (v, k) => {
    const c = (min[k] + max[k]) / 2,
      snapped = Math.round(v / 5) * 5;
    const u = Math.abs(v - snapped) < 1e-3 ? snapped + (c >= snapped ? 1e-3 : -1e-3) : v;
    return Math.floor(u / 5);
  };
  const mark = (p) => cells.add(coord(p[0], 0) + ',' + coord(p[1], 1) + ',' + coord(p[2], 2));
  for (const l of mesh.byMat.values())
    for (let i = 0; i < l.length; i += 3) {
      const a = l[i],
        b = l[i + 1],
        c = l[i + 2],
        g = mul(add(add(a, b), c), 1 / 3),
        // shrink slightly so a triangle lying exactly on a tile boundary does not claim the next tile
        ins = (p) => add(p, mul(sub(g, p), 1e-3)),
        A = ins(a),
        B = ins(b),
        C = ins(c),
        n = Math.ceil(Math.max(len(sub(B, A)), len(sub(C, A)), len(sub(C, B))) / 1.5) + 1;
      for (let u = 0; u <= n; u++)
        for (let v = 0; v <= n - u; v++) mark(add(add(mul(A, u / n), mul(B, v / n)), mul(C, (n - u - v) / n)));
    }
  const byCol = new Map();
  for (const c of cells) {
    const [x, y, z] = c.split(',').map(Number),
      k = x + ',' + y;
    if (!byCol.has(k)) byCol.set(k, []);
    byCol.get(k).push(z);
  }
  const out = [];
  for (const [k, zs] of [...byCol.entries()].sort()) {
    const [x, y] = k.split(',').map(Number);
    zs.sort((a, b) => a - b);
    let s = zs[0],
      p = zs[0];
    for (let i = 1; i <= zs.length; i++) {
      if (zs[i] == p + 1) {
        p = zs[i];
        continue;
      }
      out.push([[x, y, s], [x, y, p]]);
      s = p = zs[i];
    }
  }
  return out;
}

module.exports = { add, sub, mul, dot, cross, len, norm, TAU, Mesh, hPath, roadRings, loopRings, wallRings, sweep, patch, prism, rasterTiles };
