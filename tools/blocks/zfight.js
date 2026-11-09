// Finds z-fighting inside each generated block: two triangles facing the same way, on (almost) the same plane,
// that overlap. Also flags faces stacked too close together (decals) to hold up at a distance.
// Run: node tools/blocks/zfight.js
const { buildSurface } = require('./catalog');
const { buildShared } = require('./shared');
const { buildIce } = require('./ice');
const { buildPipes } = require('./pipes');
const { buildExtras } = require('./extras');

const NEAR = 0.03; // planes closer than this flicker at editor distances

function triInfo(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
    n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]],
    l = Math.hypot(...n);
  if (l < 1e-9) return null;
  const nn = n.map((x) => x / l);
  return { n: nn, d: nn[0] * a[0] + nn[1] * a[1] + nn[2] * a[2], pts: [a, b, c], area: l / 2 };
}
// 2D overlap test in the plane: project onto the two axes the normal is smallest along.
function overlap(A, B) {
  const k = A.n.map(Math.abs),
    drop = k.indexOf(Math.max(...k)),
    ax = [0, 1, 2].filter((i) => i != drop),
    P = (p) => [p[ax[0]], p[ax[1]]];
  const a = A.pts.map(P),
    b = B.pts.map(P);
  const inside = (p, t) => {
    const s = (q, r, w) => (r[0] - q[0]) * (w[1] - q[1]) - (r[1] - q[1]) * (w[0] - q[0]);
    const d1 = s(t[0], t[1], p),
      d2 = s(t[1], t[2], p),
      d3 = s(t[2], t[0], p),
      neg = d1 < -1e-6 || d2 < -1e-6 || d3 < -1e-6,
      pos = d1 > 1e-6 || d2 > 1e-6 || d3 > 1e-6;
    return !(neg && pos);
  };
  // shrink a little so triangles that only share an edge do not count
  const shrink = (t) => {
    const g = [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3];
    return t.map((p) => [p[0] + (g[0] - p[0]) * 0.05, p[1] + (g[1] - p[1]) * 0.05]);
  };
  const sa = shrink(a),
    sb = shrink(b);
  const ca = [(sa[0][0] + sa[1][0] + sa[2][0]) / 3, (sa[0][1] + sa[1][1] + sa[2][1]) / 3],
    cb = [(sb[0][0] + sb[1][0] + sb[2][0]) / 3, (sb[0][1] + sb[1][1] + sb[2][1]) / 3];
  return sa.some((p) => inside(p, sb)) || sb.some((p) => inside(p, sa)) || inside(ca, sb) || inside(cb, sa);
}

// node tools/blocks/zfight.js [regex]: only the blocks whose names match.
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const parts = [...buildSurface('Plastic'), ...buildSurface('Wood'), ...buildShared(), ...buildIce(), ...buildSurface('Dirt'), ...buildSurface('Grass'), ...buildPipes(), ...buildExtras()].filter((p) => !only || only.test(p.name));
const bad = [];
for (const p of parts) {
  const tris = [];
  for (const [m, l] of p.mesh.byMat) for (let i = 0; i < l.length; i += 3) {
    const t = triInfo(l[i], l[i + 1], l[i + 2]);
    if (t) tris.push({ ...t, m });
  }
  // bucket by rounded normal so only similar planes are compared
  const buckets = new Map();
  for (const t of tris) {
    const key = t.n.map((x) => Math.round(x * 50)).join(',');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }
  let hits = 0;
  const sample = [];
  for (const list of buckets.values()) {
    list.sort((a, b) => a.d - b.d);
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length && list[j].d - list[i].d < NEAR; j++) {
        const A = list[i],
          B = list[j];
        const lo = (t, k) => Math.min(...t.pts.map((p) => p[k])),
          hi = (t, k) => Math.max(...t.pts.map((p) => p[k]));
        if ([0, 1, 2].some((k) => lo(A, k) > hi(B, k) + 1e-6 || lo(B, k) > hi(A, k) + 1e-6)) continue;
        if (!overlap(A, B)) continue;
        hits++;
        if (sample.length < 3) sample.push(A.m + '/' + B.m + ' gap ' + (B.d - A.d).toFixed(3));
      }
  }
  if (hits) bad.push({ name: p.name, hits, sample });
}
bad.sort((a, b) => b.hits - a.hits);
console.log('blocks with z-fighting:', bad.length, 'of', parts.length);
const byKind = new Map();
for (const b of bad) {
  const kind = b.name.replace(/^(Plastic|Wood|Stadium|Ice|Dirt|Grass)/, '').replace(/\d+/g, '#');
  byKind.set(kind, (byKind.get(kind) || 0) + 1);
}
console.log([...byKind.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => k + ' x' + n).join('\n'));
console.log('examples:');
for (const b of bad.slice(0, 40)) console.log(' ', b.name, b.hits, b.sample.join(' | '));
