// A quick look at stock parts without the game: flat-shaded triangles from the game's own models, z-buffered into a
// PNG from any of four corners. For designing Auto deco's objects; the real look is checked in the editor.
// render(parts, file, {view: 0..3, size: 640, pitch: 35, around: [x, y, z] tiles, zoom})
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const { loadStockParts } = require('../blocks/stock/parts.js');
const STOCK_IDS = require('./stock_ids.json');
const ORIENT = require('./orient.json');

const NAME = Object.fromEntries(Object.entries(STOCK_IDS).map(([n, i]) => [i, n]));
// Approximate colours: block customs from the game's palette, the rest by environment-free guesses.
const BLOCK = { 0: [140, 140, 145], 1: [125, 127, 131], 2: [205, 210, 220], 3: [183, 143, 91], 32: [30, 30, 30], 33: [110, 38, 38], 34: [170, 100, 60], 35: [160, 150, 60], 36: [52, 110, 60], 37: [40, 110, 110], 38: [40, 46, 95], 39: [100, 50, 100], 40: [70, 52, 36] };
const OTHER = { 0: [150, 150, 155], 1: [120, 122, 126], 2: [80, 119, 178], 3: [153, 113, 61] };
const SIGNS = /Sign/;

let stock = null;
async function meshes() {
  if (!stock) {
    const list = await loadStockParts();
    stock = new Map(list.map((p) => [STOCK_IDS[p.name], p]));
  }
  return stock;
}
const quat = (rot, axis) => ORIENT.find((o) => o[0] == rot && o[1] == axis).slice(2);
function qrot([x, y, z, w], [a, b, c]) {
  const tx = 2 * (y * c - z * b),
    ty = 2 * (z * a - x * c),
    tz = 2 * (x * b - y * a);
  return [a + w * tx + (y * tz - z * ty), b + w * ty + (z * tx - x * tz), c + w * tz + (x * ty - y * tx)];
}

function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
let CRC = null;
function crc32(b) {
  if (!CRC) {
    CRC = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return c ^ -1;
}

// parts: [{id, x, y, z, rot, axis, color}] in tiles. Several views side by side when view is an array.
// Our own blocks (ids 1000+) are drawn from tm_parts.js and models/tm_blocks.bin, in their palette colour for the part's
// colour slot. extra: more triangles, [[a, b, c], [r, g, b]] in world units.
let BE = null;
function beData() {
  if (!BE) {
    const root = path.join(__dirname, '..', '..');
    const g = {};
    new Function('self', fs.readFileSync(path.join(root, 'tm_parts.js'), 'utf8'))(g);
    const bin = fs.readFileSync(path.join(root, 'models', 'tm_blocks.bin'));
    BE = { D: g.TM_DATA, buf: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength), byId: new Map(g.TM_DATA.parts.map((p) => [p.i, p])) };
  }
  return BE;
}
const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
// The game scales our colours down for its strong lights (build.js lit); brighten them back for a picture.
const unlit = (rgb) => rgb.map((c) => Math.min(255, Math.round(255 * Math.pow(Math.pow(c / 255, 2.2) / 0.42, 1 / 2.2))));
function beTris(p, out) {
  const { D, buf, byId } = beData();
  const q = byId.get(p.id);
  if (!q) return;
  const M = D.rotations[p.axis || 0][p.rot || 0];
  const slot = (D.palettes[q.f] ?? []).find((s) => s.id == (p.color || 1))?.colors ?? {};
  for (const [mi, po, pn, io, inn] of q.m) {
    const P = new Float32Array(buf, po, pn),
      I = new Uint16Array(buf, io, inn);
    const name = D.materialNames[mi];
    const col = unlit(hexRgb(slot[name] ?? D.materials[mi]));
    for (let i = 0; i < I.length; i += 3) {
      const v = [0, 1, 2].map((k) => {
        const x = P[I[i + k] * 3],
          y = P[I[i + k] * 3 + 1],
          z = P[I[i + k] * 3 + 2];
        return [M[0] * x + M[1] * y + M[2] * z + 5 * p.x, M[3] * x + M[4] * y + M[5] * z + 5 * p.y, M[6] * x + M[7] * y + M[8] * z + 5 * p.z];
      });
      out.push([v, col]);
    }
  }
}

async function render(parts, file, { view = [0, 1], size = 520, pitch = 32, around = null, zoom = 1, ground = true, extra = [] } = {}) {
  const M = await meshes();
  const tris = [...extra];
  for (const p of parts) {
    if (p.id >= 1000) {
      beTris(p, tris);
      continue;
    }
    const m = M.get(p.id);
    if (!m) continue;
    const q = quat(p.rot || 0, p.axis || 0);
    const isBlock = m.category == 'Block';
    const col = (isBlock ? BLOCK : OTHER)[p.color || 0] ?? [255, 0, 255];
    for (const t of m.tris) {
      const v = t.slice(1).map((a) => {
        const r = qrot(q, a);
        return [r[0] + 5 * p.x, r[1] + 5 * p.y, r[2] + 5 * p.z];
      });
      // Road and gate materials keep the part colour; dark details (material 0 often barriers) a bit darker.
      tris.push([v, SIGNS.test(m.name) && t[0] == 1 ? [230, 200, 40] : col]);
    }
  }
  if (!tris.length) throw new Error('nothing to draw');
  const mn = [1e9, 1e9, 1e9],
    mx = [-1e9, -1e9, -1e9];
  for (const [v] of tris) for (const a of v) for (let d = 0; d < 3; d++) (mn[d] = Math.min(mn[d], a[d])), (mx[d] = Math.max(mx[d], a[d]));
  const c = around ? around.map((a) => a * 5) : mn.map((a, d) => (a + mx[d]) / 2);
  const R = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) * 0.62 / zoom + 5;
  const views = Array.isArray(view) ? view : [view];
  const W = size * views.length,
    H = size;
  const rgb = Buffer.alloc(W * H * 3);
  const zb = new Float32Array(W * H).fill(1e9);
  for (let i = 0; i < W * H; i++) (rgb[i * 3] = 186), (rgb[i * 3 + 1] = 208), (rgb[i * 3 + 2] = 228);
  const light = norm([0.45, 0.85, 0.3]);
  views.forEach((vw, vi) => {
    const yaw = (45 + 90 * vw) * (Math.PI / 180),
      pt = pitch * (Math.PI / 180);
    const fw = [Math.cos(pt) * Math.sin(yaw), -Math.sin(pt), Math.cos(pt) * Math.cos(yaw)]; // view direction
    // Screen right and up for a camera looking along fw with the world's up on top (not mirrored).
    const rt = norm(cross(fw, [0, 1, 0]));
    const up = cross(rt, fw);
    const proj = (a) => {
      const d = [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
      return [(dot(d, rt) / R) * (size / 2) + size / 2 + vi * size, (-dot(d, up) / R) * (size / 2) + size / 2, dot(d, fw)];
    };
    if (ground) {
      // The environment floor at y = 0, a grid every 4 tiles.
      const g = 5 * 120;
      for (let gx = -g; gx < g; gx += 20)
        for (let gz = -g; gz < g; gz += 20) {
          const x0 = c[0] - (c[0] % 20) + gx,
            z0 = c[2] - (c[2] % 20) + gz;
          const shade = (Math.round(x0 / 20) + Math.round(z0 / 20)) & 1 ? [150, 170, 120] : [142, 162, 114];
          raster([[x0, 0, z0], [x0 + 20, 0, z0], [x0 + 20, 0, z0 + 20]].map(proj), shade);
          raster([[x0, 0, z0], [x0 + 20, 0, z0 + 20], [x0, 0, z0 + 20]].map(proj), shade);
        }
    }
    for (const [v, col] of tris) {
      const n = norm(cross(sub(v[1], v[0]), sub(v[2], v[0])));
      const lit = 0.45 + 0.55 * Math.abs(dot(n, light));
      raster(v.map(proj), col.map((k) => Math.min(255, k * lit)));
    }
  });
  function raster(p, col) {
    const minX = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0]))),
      maxX = Math.min(W - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1]))),
      maxY = Math.min(H - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])));
    const d = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
    if (Math.abs(d) < 1e-9) return;
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const u = ((x + 0.5 - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (y + 0.5 - p[0][1])) / d,
          w = ((p[1][0] - p[0][0]) * (y + 0.5 - p[0][1]) - (x + 0.5 - p[0][0]) * (p[1][1] - p[0][1])) / d;
        if (u < 0 || w < 0 || u + w > 1) continue;
        const z = p[0][2] + u * (p[1][2] - p[0][2]) + w * (p[2][2] - p[0][2]);
        const i = y * W + x;
        if (z >= zb[i]) continue;
        zb[i] = z;
        rgb[i * 3] = col[0];
        rgb[i * 3 + 1] = col[1];
        rgb[i * 3 + 2] = col[2];
      }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png(W, H, rgb));
  return file;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(...a) || 1;
  return a.map((v) => v / l);
};

module.exports = { render, NAME };
