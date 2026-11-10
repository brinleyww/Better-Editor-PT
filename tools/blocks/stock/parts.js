// Every stock block as triangles, built the way the game builds them: the part list is read out of main.bundle.js
// (which glb nodes a part is made of, mirrored or moved how, and the tiles it claims) and the nodes out of the game's
// own models. stockblocks.js turns them into the surface kits' copies of the stock shapes.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadGlb } = require('./decode');

const site = path.join(__dirname, '..', '..', '..');
const FILES = { Road: 'road.glb', RoadWide: 'road_wide.glb', Planes: 'planes.glb', Blocks: 'blocks.glb', WallTrack: 'wall_track.glb', Pillar: 'pillar.glb', Signs: 'signs.glb' };

// The game's part list: [{ name, category, models: [[scene, node, opts]], tiles, gate }].
function readDefs() {
  const src = fs.readFileSync(path.join(site, 'main.bundle.js'), 'utf8');
  const cls = src.search(/class d \{\r?\n\s*constructor\(e, t, n, i, r, a, s = null, o = null/);
  const a = cls < 0 ? -1 : src.indexOf('const u = [', cls);
  // The list ends where the new blocks are added to it; the untouched deobfuscated bundle ends it with "]," instead.
  const tail = a < 0 ? null : /\]\.concat\(\s*self\.TM\.parts\.map\(|\],\s*f = new Map\(\);/.exec(src.slice(a));
  const end = tail ? a + tail.index : -1;
  if (a < 0 || end < 0) throw new Error('stock part list not found in main.bundle.js');
  const list = src.slice(a + 'const u = '.length, end + 1);
  // Everything the list names is a stand-in: enums give their key back, vectors keep their numbers.
  const name = new Proxy({}, { get: (_, k) => k });
  // new Quaternion().setFromEuler(new Euler(x, y, z)) becomes the quaternion's numbers (three.js XYZ order).
  const made = (args) => ({
    args,
    setFromEuler: (e) => {
      const [x, y, z] = e.args.map((v) => v / 2),
        [c1, c2, c3, s1, s2, s3] = [Math.cos(x), Math.cos(y), Math.cos(z), Math.sin(x), Math.sin(y), Math.sin(z)];
      return made([s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3]);
    },
  });
  const any = () => new Proxy(function () {}, { get: (_, k) => (k == 'A' ? name : any()), construct: (_, args) => made(args), apply: () => null });
  const defs = [];
  const sandbox = new Proxy(
    {
      d: function (checksum, category, id, models, colors, tiles, detector = null, startOffset = null) {
        defs.push({ name: id, category, models, tiles, gate: detector != null || startOffset != null });
      },
    },
    { has: () => true, get: (t, k) => (k in t ? t[k] : k == Symbol.unscopables ? undefined : any()) },
  );
  vm.runInNewContext('with (S) { (' + list + ') }', { S: sandbox });
  return defs;
}

const quatRotate = ([x, y, z, w], [a, b, c]) => {
  // v + 2 q x (q x v + w v)
  const tx = 2 * (y * c - z * b),
    ty = 2 * (z * a - x * c),
    tz = 2 * (x * b - y * a);
  return [a + w * tx + (y * tz - z * ty), b + w * ty + (z * tx - x * tz), c + w * tz + (x * ty - y * tx)];
};

// Returns [{ name, category, gate, tiles, tris: [[material, a, b, c]] }] in the game's part frame.
async function loadStockParts() {
  const glb = {};
  for (const [scene, file] of Object.entries(FILES)) glb[scene] = await loadGlb(file);
  const out = [];
  for (const def of readDefs()) {
    const tris = [];
    for (const [scene, node, opt] of def.models) {
      const n = glb[scene]?.[node];
      if (!n) throw new Error('stock node missing: ' + scene + '/' + node);
      // The node's own matrix (scale, rotate, move), as three.js applies it.
      const own = (p) => {
        const s = [p[0] * n.scale[0], p[1] * n.scale[1], p[2] * n.scale[2]],
          r = quatRotate(n.rotation, s);
        return [r[0] + n.translation[0], r[1] + n.translation[1], r[2] + n.translation[2]];
      };
      const local = [];
      for (const p of n.prims)
        for (let i = 0; i < p.indices.length; i += 3)
          local.push([p.material, ...[0, 1, 2].map((k) => own([0, 1, 2].map((c) => p.positions[p.indices[i + k] * 3 + c])))]);
      const o = opt && opt.args === undefined ? opt : {},
        vec = (v) => (v && v.args ? v.args : null),
        flip = [o.flipX ? -1 : 1, o.flipY ? -1 : 1, o.flipZ ? -1 : 1],
        flipped = flip.some((f) => f < 0),
        scale = vec(o.scale),
        quat = vec(o.quaternion),
        offset = vec(o.offset) ?? [0, 0, 0];
      // A part flipped upside down is lifted back by its own height.
      const top = o.flipY ? Math.max(...local.flatMap((t) => t.slice(1).map((p) => p[1]))) : 0;
      for (const [mat, ...v] of local) {
        const q = v.map((p) => {
          let r = scale ? [p[0] * scale[0], p[1] * scale[1], p[2] * scale[2]] : p;
          if (quat) r = quatRotate(quat, r);
          return [r[0] * flip[0] + offset[0], r[1] * flip[1] + offset[1] + top, r[2] * flip[2] + offset[2]];
        });
        tris.push(flipped ? [mat, q[0], q[2], q[1]] : [mat, ...q]);
      }
    }
    out.push({ name: def.name, category: def.category, gate: def.gate, tiles: def.tiles, tris });
  }
  return out;
}

module.exports = { loadStockParts };
