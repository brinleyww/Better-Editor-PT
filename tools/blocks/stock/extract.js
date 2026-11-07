// Pulls the stock start, checkpoint and finish gates out of the game's models into gates.json, so the generated
// gates copy them exactly. Run once after a game update: node tools/blocks/stock/extract.js
// arch: the gate's posts and banners, [material, ax, ay, az, bx, by, bz, cx, cy, cz] in part coordinates.
// decals: the markings painted on the floor, triangles in (x, s): s runs along the road from the entry edge (z = +10).
const fs = require('fs');
const path = require('path');
const { loadGlb } = require('./decode');

const FLOOR = ['Road', 'RoadEdgeRed', 'RoadEdgeWhite'];
const SETS = [
  ['road.glb', 'Road', { Start: 'Start', Checkpoint: 'Checkpoint', Finish: 'Finish' }],
  ['planes.glb', 'Plane', { Start: 'PlaneStart', Checkpoint: 'PlaneCheckpoint', Finish: 'PlaneFinish' }],
  ['planes.glb', 'PlaneWide', { Start: 'PlaneStartWide', Checkpoint: 'PlaneCheckpointWide', Finish: 'PlaneFinishWide' }],
];

(async () => {
  const out = {};
  for (const [file, fam, kinds] of SETS) {
    const glb = await loadGlb(file);
    out[fam] = {};
    for (const [kind, node] of Object.entries(kinds)) {
      const n = glb[node],
        [tx, ty, tz] = n.translation,
        arch = [],
        decals = [];
      for (const p of n.prims) {
        if (FLOOR.includes(p.material)) continue;
        const P = p.positions,
          I = p.indices;
        for (let t = 0; t < I.length; t += 3) {
          const v = [0, 1, 2].map((k) => [P[I[t + k] * 3] + tx, P[I[t + k] * 3 + 1] + ty, P[I[t + k] * 3 + 2] + tz].map((q) => +q.toFixed(4)));
          // Road rails are rebuilt from the generator's own rail outline, which is the stock one.
          if (p.material == 'RoadBarrier' && v.every((q) => q[1] < 1)) continue;
          if (v.every((q) => Math.abs(q[1] - 0.21) < 1e-3)) decals.push([p.material, ...v.flatMap((q) => [q[0], 10 - q[2]])]);
          else arch.push([p.material, ...v.flat()]);
        }
      }
      out[fam][kind] = { arch, decals };
    }
  }
  fs.writeFileSync(path.join(__dirname, 'gates.json'), JSON.stringify(out));
  for (const f in out) for (const k in out[f]) console.log(f, k, 'arch', out[f][k].arch.length, 'decals', out[f][k].decals.length);
})();
