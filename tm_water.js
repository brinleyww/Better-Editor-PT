// Water look: the see-through, rippling water material, and the splashes and spray a car throws up from water.
// Page only, loaded after tm_runtime.js. Physics (drag, bounces) lives in tm_runtime.js; this file only draws.
self.TM.water = (() => {
  const time = { value: 0 };
  let material = null;
  let ticking = false;
  const tick = (t) => {
    time.value = t / 1000;
    requestAnimationFrame(tick);
  };

  // A few travelling waves bend the normals of flat water, so the sun glints off moving ripples; the water is more
  // see-through looking straight down and close to opaque at a grazing angle, the way real water reflects the sky.
  const WAVES = `
    vec2 beWaveSlope(vec2 p, float t) {
      vec2 g = vec2(0.0);
      vec2 d; float k, a, w, ph;
      d = normalize(vec2(1.0, 0.35)); k = 0.31; a = 0.16; w = 1.3; ph = dot(d, p) * k + w * t; g += a * k * cos(ph) * d;
      d = normalize(vec2(-0.6, 1.0)); k = 0.53; a = 0.09; w = 1.9; ph = dot(d, p) * k + w * t; g += a * k * cos(ph) * d;
      d = normalize(vec2(0.2, -1.0)); k = 1.17; a = 0.035; w = 2.7; ph = dot(d, p) * k + w * t; g += a * k * cos(ph) * d;
      d = normalize(vec2(-1.0, -0.4)); k = 2.3; a = 0.016; w = 3.6; ph = dot(d, p) * k + w * t; g += a * k * cos(ph) * d;
      d = normalize(vec2(0.8, 0.9)); k = 4.1; a = 0.007; w = 5.1; ph = dot(d, p) * k + w * t; g += a * k * cos(ph) * d;
      return g;
    }
  `;

  // ---- seams between water blocks ----------------------------------------------------------------------------------
  // Every water block draws its own sides, so two blocks side by side showed a see-through wall where they touch. The
  // shader drops a side wherever there is water at the same level on both sides of it; outer sides stay. Where the water
  // is comes from the meshes a scene draws with this material (the editor, Test and NSWS build them the same way), so
  // no page hook is needed: each block's water is read off its geometry once and placed by its instance matrices, and a
  // changed set of water meshes is picked up on the next frame.
  // A fragment only looks at the boxes of the ground square (cell) it is in, so a river of 1,400 blocks costs a pixel
  // what a puddle does. A box is listed in every cell within SEAM_REACH of it (the tests below look 0.3 out at most),
  // in the order the blocks are drawn, which the overlap rule needs. SEAM_MAX is only a bound on memory.
  // Most faces have one answer all over, and those are settled when the boxes are built (sideStates): the vertex shader
  // throws a hidden side away before it costs a pixel, and a clear one draws with no look-ups. A river seen along its
  // length was dozens of see-through layers a pixel, each reading every box near it, only to be discarded.
  const SEAM_MAX = 16384,
    SEAM_REACH = 0.35,
    SEAM_CELL = 10, // the cells' width, doubled until a track has at most SEAM_CELLS and the texture fits
    SEAM_CELLS = 65536,
    SEAM_WIDTH = 2048; // the widest (and tallest) texture every WebGL2 device takes
  const seamTex = { value: null },
    seamCount = { value: 0 },
    seamGrid = { value: { x: 0, y: 0, z: 1, w: 0 } }, // first cell's corner, cell width
    seamSize = { value: { x: 0, y: 0, z: 0, w: 0 } }; // cells across and along, the first cell's texel
  const seamScenes = new WeakMap(); // scene -> what it drew last frame and the boxes built from that
  const localBoxes = new WeakMap(); // geometry -> its water as [minX, minZ, maxX, maxZ, bottom, surface] in the part frame
  let three3 = null;

  // One box per water level of a block: the surface's extent, from the block's lowest point up to the surface.
  function boxesOf(geo, mats) {
    let out = localBoxes.get(geo);
    if (out) return out;
    const P = geo.attributes.position.array,
      I = geo.index ? geo.index.array : null,
      levels = new Map();
    for (const g of geo.groups) {
      if (mats[g.materialIndex] !== material) continue;
      for (let k = g.start; k < g.start + g.count; k += 3) {
        const v = [0, 1, 2].map((j) => (I ? I[k + j] : k + j) * 3),
          y = P[v[0] + 1];
        // Sides are skipped; only flat surface triangles give the water's extent.
        if (Math.abs(P[v[1] + 1] - y) > 1e-3 || Math.abs(P[v[2] + 1] - y) > 1e-3) continue;
        const key = Math.round(y * 1000);
        let r = levels.get(key);
        if (!r) levels.set(key, (r = [Infinity, Infinity, -Infinity, -Infinity, y]));
        for (const i of v) {
          r[0] = Math.min(r[0], P[i]);
          r[1] = Math.min(r[1], P[i + 2]);
          r[2] = Math.max(r[2], P[i]);
          r[3] = Math.max(r[3], P[i + 2]);
        }
      }
    }
    if (!geo.boundingBox) geo.computeBoundingBox();
    out = [...levels.values()].map((r) => [r[0], r[1], r[2], r[3], geo.boundingBox.min.y, r[4]]);
    // simple: one box with all the block's water in it, so each corner of a triangle finds the same side (sideStates).
    out.simple = out.length == 1;
    if (out.simple) {
      const [x0, z0, x1, z1, bot, top] = out[0],
        e = 0.005;
      for (const g of geo.groups) {
        if (mats[g.materialIndex] !== material) continue;
        for (let k = g.start; k < g.start + g.count; k++) {
          const v = (I ? I[k] : k) * 3;
          if (P[v] < x0 - e || P[v] > x1 + e || P[v + 1] < bot - e || P[v + 1] > top + e || P[v + 2] < z0 - e || P[v + 2] > z1 + e) out.simple = false;
        }
      }
    }
    localBoxes.set(geo, out);
    return out;
  }

  // A mesh drawn last frame may have lost its geometry's data since: Not So Weekly Shorts empties a shared geometry's
  // attributes when it rebuilds the track (a new race, Watch, the menu's track, a graphics change: one scene for all).
  // When the meshes drawn changed in the frame before (the camera turned a box out of view), the next render read the
  // emptied position and threw "Cannot read properties of undefined (reading 'array')". Such meshes are no longer
  // drawn, so they are dropped from the list.
  const intact = (o) => o.geometry?.attributes?.position != null && (!o.isInstancedMesh || o.instanceMatrix != null);
  const seamKey = (o) => o.id + ':' + o.geometry.id + ':' + (o.isInstancedMesh ? o.count + ':' + o.instanceMatrix.version : 1) + ':' + o.matrixWorld.elements.join(',');

  // World boxes of everything drawn, three texels each: (minX, minZ, maxX, maxZ), (bottom, surface, 0, 0) and the
  // block's origin, so a fragment can tell which block it is from. The two spare numbers after the surface are the
  // box's sideStates and whether it is simple (boxesOf). seamTexture adds the cells and their lists.
  function buildSeams(s) {
    const data = [],
      W = new Float32Array(16);
    for (const o of s.drawn) {
      const local = boxesOf(o.geometry, o.material);
      if (!local.length) continue;
      const w = o.matrixWorld.elements,
        n = o.isInstancedMesh ? o.count : 1;
      for (let i = 0; i < n && data.length < SEAM_MAX * 12; i++) {
        // W = matrixWorld x instance matrix (column-major, as three stores them).
        const m = o.isInstancedMesh ? o.instanceMatrix.array.subarray(i * 16, i * 16 + 16) : null;
        for (let c = 0; c < 4; c++)
          for (let r = 0; r < 4; r++)
            W[c * 4 + r] = m ? w[r] * m[c * 4] + w[4 + r] * m[c * 4 + 1] + w[8 + r] * m[c * 4 + 2] + w[12 + r] * m[c * 4 + 3] : w[c * 4 + r];
        // Only blocks standing upright have level water; one on its side or upside down keeps its sides.
        if (Math.abs(W[5] - 1) > 1e-3 || Math.abs(W[1]) > 1e-3 || Math.abs(W[9]) > 1e-3) continue;
        for (const [x0, z0, x1, z1, bot, top] of local) {
          const ax = W[0] * x0 + W[8] * z0 + W[12],
            az = W[2] * x0 + W[10] * z0 + W[14],
            bx = W[0] * x1 + W[8] * z1 + W[12],
            bz = W[2] * x1 + W[10] * z1 + W[14];
          data.push(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), bot + W[13], top + W[13], 0, local.simple ? 1 : 0, W[12], W[13], W[14], 0);
        }
      }
    }
    if (s.tex) s.tex.dispose();
    s.n = Math.min(data.length / 12, SEAM_MAX);
    s.tex = null;
    if (s.n) seamTexture(s, data);
  }

  // One texture, read row by row: the boxes, then each cell as (first list texel, how many), then the lists, a box's
  // first texel in each.
  function seamTexture(s, data) {
    let x0 = Infinity,
      z0 = Infinity,
      x1 = -Infinity,
      z1 = -Infinity;
    for (let i = 0; i < s.n * 12; i += 12) {
      x0 = Math.min(x0, data[i]);
      z0 = Math.min(z0, data[i + 1]);
      x1 = Math.max(x1, data[i + 2]);
      z1 = Math.max(z1, data[i + 3]);
    }
    x0 = Math.floor(x0 - SEAM_REACH);
    z0 = Math.floor(z0 - SEAM_REACH);
    const at = new Int32Array(s.n * 4), // each box's first and last cell, x then z
      head = s.n * 3;
    let cell = SEAM_CELL,
      cols,
      rows,
      listed;
    for (; ; cell *= 2) {
      cols = Math.floor((x1 + SEAM_REACH - x0) / cell) + 1;
      rows = Math.floor((z1 + SEAM_REACH - z0) / cell) + 1;
      if (cols * rows > SEAM_CELLS) continue;
      listed = 0;
      for (let b = 0; b < s.n; b++) {
        const i = b * 12,
          j = b * 4;
        at[j] = Math.floor((data[i] - SEAM_REACH - x0) / cell);
        at[j + 1] = Math.floor((data[i + 2] + SEAM_REACH - x0) / cell);
        at[j + 2] = Math.floor((data[i + 1] - SEAM_REACH - z0) / cell);
        at[j + 3] = Math.floor((data[i + 3] + SEAM_REACH - z0) / cell);
        listed += (at[j + 1] - at[j] + 1) * (at[j + 3] - at[j + 2] + 1);
      }
      if (head + cols * rows + listed <= SEAM_WIDTH * SEAM_WIDTH) break;
    }
    const height = Math.ceil((head + cols * rows + listed) / SEAM_WIDTH),
      out = new Float32Array(SEAM_WIDTH * height * 4),
      count = new Uint32Array(cols * rows),
      next = new Uint32Array(cols * rows),
      each = (f) => {
        for (let b = 0; b < s.n; b++)
          for (let z = at[b * 4 + 2]; z <= at[b * 4 + 3]; z++)
            for (let x = at[b * 4]; x <= at[b * 4 + 1]; x++) f(b, z * cols + x);
      };
    for (let i = 0; i < head * 4; i++) out[i] = data[i];
    each((b, c) => count[c]++);
    for (let c = 0, t = head + cols * rows; c < count.length; c++) {
      out[(head + c) * 4] = next[c] = t;
      out[(head + c) * 4 + 1] = count[c];
      t += count[c];
    }
    each((b, c) => (out[next[c]++ * 4] = b * 3));
    sideStates(s.n, out, at, cols, head);
    s.tex = floatTexture(out, SEAM_WIDTH, height);
    s.grid = { x: x0, y: z0, z: cell, w: 0 };
    s.size = { x: cols, y: rows, z: head, w: 0 };
  }

  // What the fragment tests below would say for the whole of each side of each box, two bits a side (-x, +x, bottom,
  // surface, -z, +z) written into the box's spare number: 1 every point is discarded, 2 none is, 0 it varies (or the
  // block is not simple), so each pixel still tests. The margins are the tests' own, taken EPS to the safe side.
  function sideStates(n, out, at, cols, head) {
    const EPS = 0.001,
      ACROSS = 0.02, // the overlap test's t, and its margin along a face
      ALONG = 0.002,
      LO = [0, 4, 1], // where a box keeps its x, y and z
      HI = [2, 5, 3],
      seen = new Int32Array(n),
      near = [];
    const sameBlock = (i, j) => Math.hypot(out[i + 8] - out[j + 8], out[i + 9] - out[j + 9], out[i + 10] - out[j + 10]) < 0.01;
    for (let b = 0; b < n; b++) {
      const B = b * 12;
      if (!out[B + 7]) continue;
      near.length = 0;
      for (let z = at[b * 4 + 2]; z <= at[b * 4 + 3]; z++)
        for (let x = at[b * 4]; x <= at[b * 4 + 1]; x++) {
          const cell = (head + z * cols + x) * 4;
          for (let k = out[cell], end = out[cell] + out[cell + 1]; k < end; k++) {
            const q = out[k * 4] / 3;
            if (seen[q] == b + 1) continue;
            seen[q] = b + 1;
            near.push(q * 12);
          }
        }
      // The shader takes a block's first box as its own, so two of one block (the same block placed twice) must be the
      // same box, and share the first one's answers.
      let first = B,
        alike = true;
      for (const Q of near) {
        if (!sameBlock(B, Q)) continue;
        for (let k = 0; k < 6; k++) if (Math.abs(out[Q + k] - out[B + k]) > EPS) alike = false;
        first = Math.min(first, Q);
      }
      if (!alike) continue;
      let states = 0;
      for (let side = 0; side < 6; side++) {
        const a = side >> 1,
          u = (a + 1) % 3,
          v = (a + 2) % 3,
          c = out[B + (side & 1 ? HI : LO)[a]],
          u0 = out[B + LO[u]],
          u1 = out[B + HI[u]],
          v0 = out[B + LO[v]],
          v1 = out[B + HI[v]];
        let hidden = false,
          clear = true;
        // overlap: an earlier block's face in the same plane
        for (const Q of near) {
          if (Q >= first || sameBlock(B, Q)) continue;
          const d = Math.min(Math.abs(c - out[Q + LO[a]]), Math.abs(c - out[Q + HI[a]]));
          if (d >= ACROSS + EPS) continue;
          const q0 = out[Q + LO[u]],
            q1 = out[Q + HI[u]],
            r0 = out[Q + LO[v]],
            r1 = out[Q + HI[v]];
          if (q0 + ALONG < u1 + EPS && q1 - ALONG > u0 - EPS && r0 + ALONG < v1 + EPS && r1 - ALONG > v0 - EPS) clear = false;
          // all of it but the hair inside the edge that the test leaves
          if (d < ACROSS - EPS && q0 < u0 + EPS && q1 > u1 - EPS && r0 < v0 + EPS && r1 > v1 - EPS) hidden = true;
        }
        // seam: water of one level on both sides of an upright side
        if (a != 1 && !hidden) {
          const w = 2 - a,
            w0 = out[B + LO[w]],
            w1 = out[B + HI[w]],
            y0 = out[B + 4],
            y1 = out[B + 5],
            M = 0.01 + EPS,
            m = 0.01 - EPS;
          let lowA = Infinity,
            highA = -Infinity,
            lowB = Infinity,
            highB = -Infinity,
            allA = false,
            allB = false;
          for (const Q of near) {
            const qa = out[Q + LO[a]],
              qb = out[Q + HI[a]],
              qw0 = out[Q + LO[w]],
              qw1 = out[Q + HI[w]],
              top = out[Q + 5];
            if (qw0 > w1 + M || qw1 < w0 - M || out[Q + 4] > y1 + M || top < y0 - M) continue;
            const all = qw0 < w0 + m && qw1 > w1 - m && out[Q + 4] < y0 + m && top > y1 - m;
            if (c + 0.3 > qa - M && c + 0.3 < qb + M) {
              lowA = Math.min(lowA, top);
              highA = Math.max(highA, top);
              if (all && c + 0.3 > qa - m && c + 0.3 < qb + m) allA = true;
            }
            if (c - 0.3 > qa - M && c - 0.3 < qb + M) {
              lowB = Math.min(lowB, top);
              highB = Math.max(highB, top);
              if (all && c - 0.3 > qa - m && c - 0.3 < qb + m) allB = true;
            }
          }
          if (lowA <= highA && lowB <= highB && lowA <= highB + M && lowB <= highA + M) {
            clear = false;
            if (allA && allB && Math.max(highA, highB) - Math.min(lowA, lowB) < m) hidden = true;
          }
        }
        states |= (hidden ? 1 : clear ? 2 : 0) << (side * 2);
      }
      out[B + 6] = states;
    }
  }

  // A small RGBA float data texture made from the plain Texture class (NSWS hands this file only a few three.js classes).
  function floatTexture(data, width, height = 1) {
    const t = new three3.gPd();
    t.image = { data: new Float32Array(data), width, height };
    t.isDataTexture = true;
    t.format = 1023; // RGBAFormat
    t.type = 1015; // FloatType
    t.magFilter = t.minFilter = 1003; // NearestFilter: texelFetch reads exact values
    t.generateMipmaps = false;
    t.flipY = false;
    t.unpackAlignment = 1;
    t.needsUpdate = true;
    return t;
  }

  // Runs before each water draw. renderer.info.render.frame counts render() calls, so a new value means the scene's last
  // render is complete: its drawn list is rebuilt into boxes if it changed. Uniforms upload with the scene's first water
  // draw, so each scene (the track, a part thumbnail) gets its own boxes.
  function seams(renderer, scene, camera, geometry, object) {
    let s = seamScenes.get(scene);
    if (!s) seamScenes.set(scene, (s = { frame: -1, drawn: [], key: '', tex: null, n: 0 }));
    const f = renderer.info.render.frame;
    if (s.frame != f) {
      s.frame = f;
      const key = (s.drawn = s.drawn.filter(intact)).map(seamKey).join('|');
      if (key != s.key) {
        s.key = key;
        buildSeams(s);
      }
      s.drawn = [];
    }
    if (!s.drawn.includes(object)) s.drawn.push(object);
    seamTex.value = s.tex;
    seamCount.value = s.n;
    if (s.n) {
      seamGrid.value = s.grid;
      seamSize.value = s.size;
    }
  }

  // A side (a face that stands upright) is a seam when points 0.3 either side of it are both in water of the same level.
  const SEAM_FETCH = `
    vec4 beTexel(int i) {
      return texelFetch(beSeams, ivec2(i % ${SEAM_WIDTH}, i / ${SEAM_WIDTH}), 0);
    }
  `;
  const SEAM = `
    vec3 beFace = normalize(cross(dFdx(vBeWorld), dFdy(vBeWorld)));
    int beFirst = 0, beNear = 0; // this cell's list; none on a side settled as clear
    if (beSeamCount > 0 && vBeSide < 1.5) {
      ivec2 c = ivec2(floor((vBeWorld.xz - beGrid.xy) / beGrid.z)), n = ivec2(beSize.xy);
      if (c.x >= 0 && c.y >= 0 && c.x < n.x && c.y < n.y) {
        vec4 l = beTexel(int(beSize.z) + c.y * n.x + c.x);
        beFirst = int(l.x);
        beNear = int(l.y);
      }
    }
    {
      if (beSeamCount > 0 && abs(beFace.y) < 0.3) {
        vec2 beOut = normalize(beFace.xz) * 0.3;
        vec2 beA = vBeWorld.xz + beOut, beB = vBeWorld.xz - beOut;
        float beLa = -1e9, beLb = 1e9; // water level found on each side
        for (int i = 0; i < beNear; i++) {
          int b = int(beTexel(beFirst + i).x);
          vec4 r = beTexel(b), h = beTexel(b + 1);
          if (vBeWorld.y < h.x - 0.01 || vBeWorld.y > h.y + 0.01) continue;
          if (all(greaterThan(beA, r.xy - 0.01)) && all(lessThan(beA, r.zw + 0.01))) beLa = h.y;
          if (all(greaterThan(beB, r.xy - 0.01)) && all(lessThan(beB, r.zw + 0.01))) beLb = h.y;
        }
        if (abs(beLa - beLb) < 0.01) discard;
      }
    }
    // Overlapping blocks: where two blocks' water has a face in the same plane (a surface at the same level, a side or a
    // bottom flush with another's), only the block listed first draws it, so overlapping water is no darker than one.
    // The fragment's own box is the first one of its block (same origin) that holds it.
    {
      const float t = 0.02;
      int beOwn = -1;
      for (int i = 0; i < beNear; i++) {
        int b = int(beTexel(beFirst + i).x);
        vec4 r = beTexel(b), h = beTexel(b + 1);
        vec3 o = beTexel(b + 2).xyz;
        if (distance(o, vBeOrigin) < 0.01 && vBeWorld.y > h.x - t && vBeWorld.y < h.y + t &&
            all(greaterThan(vBeWorld.xz, r.xy - t)) && all(lessThan(vBeWorld.xz, r.zw + t))) {
          beOwn = i;
          break;
        }
      }
      vec3 beAx = abs(beFace);
      for (int i = 0; i < beOwn; i++) {
        int b = int(beTexel(beFirst + i).x);
        vec4 r = beTexel(b), h = beTexel(b + 1);
        vec3 o = beTexel(b + 2).xyz;
        if (distance(o, vBeOrigin) < 0.01) continue;
        // The margin is only across the face: along it the other block must cover the point (a hair inside its edge), or a
        // sliver the other block never draws would be dropped there.
        vec3 m = beAx.y >= beAx.x && beAx.y >= beAx.z ? vec3(-0.002, t, -0.002) : beAx.x >= beAx.z ? vec3(t, -0.002, -0.002) : vec3(-0.002, -0.002, t);
        if (vBeWorld.y < h.x - m.y || vBeWorld.y > h.y + m.y || any(lessThan(vBeWorld.xz, r.xy - m.xz)) || any(greaterThan(vBeWorld.xz, r.zw + m.xz))) continue;
        bool on = m.y > 0.01 ? min(abs(vBeWorld.y - h.x), abs(vBeWorld.y - h.y)) < t
          : m.x > 0.01 ? min(abs(vBeWorld.x - r.x), abs(vBeWorld.x - r.z)) < t
          : min(abs(vBeWorld.z - r.y), abs(vBeWorld.z - r.w)) < t;
        if (on) discard;
      }
    }
  `;

  // A vertex's side of its own block's box, and that side's state.
  const SIDE = `
    vBeSide = 0.0;
    if (beSeamCount > 0) {
      vec4 beSn = vec4(normal, 0.0);
      #ifdef USE_INSTANCING
        beSn = instanceMatrix * beSn;
      #endif
      vec3 beSa = abs(normalize((modelMatrix * beSn).xyz));
      int beAxis = beSa.x > 0.999 ? 0 : beSa.y > 0.999 ? 1 : beSa.z > 0.999 ? 2 : -1;
      ivec2 beC = ivec2(floor((vBeWorld.xz - beGrid.xy) / beGrid.z)), beCs = ivec2(beSize.xy);
      if (beAxis >= 0 && beC.x >= 0 && beC.y >= 0 && beC.x < beCs.x && beC.y < beCs.y) {
        vec4 beList = beTexel(int(beSize.z) + beC.y * beCs.x + beC.x);
        int beFrom = int(beList.x), beMany = int(beList.y);
        const float beT = 0.02;
        for (int i = 0; i < beMany; i++) {
          int b = int(beTexel(beFrom + i).x);
          if (distance(beTexel(b + 2).xyz, vBeOrigin) >= 0.01) continue;
          vec4 r = beTexel(b), h = beTexel(b + 1);
          if (vBeWorld.y <= h.x - beT || vBeWorld.y >= h.y + beT || any(lessThanEqual(vBeWorld.xz, r.xy - beT)) || any(greaterThanEqual(vBeWorld.xz, r.zw + beT))) continue;
          float at = beAxis == 0 ? vBeWorld.x : beAxis == 1 ? vBeWorld.y : vBeWorld.z;
          float lo = beAxis == 0 ? r.x : beAxis == 1 ? h.x : r.y;
          float hi = beAxis == 0 ? r.z : beAxis == 1 ? h.y : r.w;
          int side = abs(at - lo) < 0.005 ? 2 * beAxis : abs(at - hi) < 0.005 ? 2 * beAxis + 1 : -1;
          if (side >= 0) vBeSide = float((int(h.z) >> (2 * side)) & 3);
          break;
        }
      }
      if (vBeSide == 1.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    }
  `;

  function makeMaterial(three) {
    // Pushed back a little, like the finish boxes: a water side flush with a solid block beside it (or a pool's own
    // walls) loses to the block instead of fighting it.
    const m = new three._4j({ vertexColors: true, transparent: true, opacity: 0.58, roughness: 0.06, metalness: 0.1, side: 2, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    three3 = three;
    m.onBeforeRender = seams;
    // vBeOrigin and vBeSide are the same at a triangle's three corners, so they aren't flat varyings: on Apple GPUs
    // (ANGLE's Metal) a flat varying has the index buffer rewritten and the render pass split at each such draw.
    m.onBeforeCompile = (sh) => {
      sh.uniforms.beTime = time;
      sh.uniforms.beSeams = seamTex;
      sh.uniforms.beSeamCount = seamCount;
      sh.uniforms.beGrid = seamGrid;
      sh.uniforms.beSize = seamSize;
      sh.vertexShader = 'uniform highp sampler2D beSeams;\nuniform highp int beSeamCount;\nuniform highp vec4 beGrid, beSize;\nvarying vec3 vBeWorld;\nvarying vec3 vBeOrigin;\nvarying float vBeSide;\n' + SEAM_FETCH + sh.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 beW = vec4(transformed, 1.0), beO = vec4(0.0, 0.0, 0.0, 1.0);
        #ifdef USE_INSTANCING
          beW = instanceMatrix * beW;
          beO = instanceMatrix * beO;
        #endif
        vBeWorld = (modelMatrix * beW).xyz;
        vBeOrigin = (modelMatrix * beO).xyz;
        ${SIDE}`,
      );
      sh.fragmentShader = 'uniform float beTime;\nuniform highp sampler2D beSeams;\nuniform highp int beSeamCount;\nuniform highp vec4 beGrid, beSize;\nvarying vec3 vBeWorld;\nvarying vec3 vBeOrigin;\nvarying float vBeSide;\n' + SEAM_FETCH + WAVES + sh.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        `${SEAM}
        #include <normal_fragment_begin>
        {
          vec3 beN = (vec4(normal, 0.0) * viewMatrix).xyz;
          float beUp = smoothstep(0.6, 0.95, abs(beN.y));
          vec2 beG = beWaveSlope(vBeWorld.xz, beTime);
          vec3 beWave = normalize(vec3(-beG.x, 1.0, -beG.y)) * sign(beN.y);
          normal = normalize(mix(normal, (viewMatrix * vec4(beWave, 0.0)).xyz, beUp));
          float beF = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 3.0);
          diffuseColor.a = mix(diffuseColor.a, 0.94, beF);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.9, 1.0), beF * 0.45);
        }`,
      );
    };
    // Its own program, so it never shares a compiled shader with the plain block material.
    m.customProgramCacheKey = () => 'be-water';
    return m;
  }

  // ---- low quality (TM.waterLow, Not So Weekly Shorts' Water quality) -------------------------------------------------
  // No ripples and no per-pixel seam tests. Blocks whose water is one box (TM.renderArrays.waterBox) give their water
  // material to `gone`, which draws nothing and tells the scene which meshes are there; each scene then draws all of
  // that water as one mesh: the surfaces of a level and colour joined into rectangles, and only the sides that face
  // out, with their neighbours' joined along one line. Other water (curves) keeps its own surface, drawn with `plain`.
  let lowPlain = null,
    lowGone = null;
  const lowScenes = new WeakMap(),
    lowLocal = new WeakMap(); // geometry -> its box, colours, sides and triangles in the part frame
  const LOW_SIDES = [[-1, 0], [1, 0], [0, -1], [0, 1]]; // -x, +x, -z, +z

  function makeLowPlain(three) {
    return new three._4j({ vertexColors: true, transparent: true, opacity: 0.58, roughness: 0.06, metalness: 0.1, side: 2, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  }

  function makeLowGone(three) {
    const m = new three.V9B({ colorWrite: false, depthWrite: false, depthTest: false });
    m.onBeforeRender = (renderer, scene, camera, geometry, object) => {
      const s = lowScene(scene);
      if (!s.meshes.has(object)) s.meshes.add(object);
    };
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\ngl_Position = vec4(2.0, 2.0, 2.0, 1.0);');
    };
    m.customProgramCacheKey = () => 'be-water-gone';
    return m;
  }

  // Meshes seen once stay in the joined water while they are in the scene and shown, so turning the camera (culling)
  // never rebuilds it.
  function lowScene(scene) {
    let s = lowScenes.get(scene);
    if (s) return s;
    lowScenes.set(scene, (s = { meshes: new Set(), key: '', mesh: null, frame: -1 }));
    const before = scene.onBeforeRender;
    scene.onBeforeRender = function (renderer) {
      const f = renderer.info.render.frame;
      if (s.frame != f) {
        s.frame = f;
        lowCheck(scene, s);
      }
      return before.apply(this, arguments);
    };
    return s;
  }

  const shownIn = (o, scene) => {
    for (let p = o; p; p = p.parent) {
      if (p === scene) return true;
      if (!p.visible) return false;
    }
    return false;
  };

  function lowCheck(scene, s) {
    let key = '';
    for (const o of s.meshes) {
      if (!intact(o) || !o.parent) {
        s.meshes.delete(o);
        continue;
      }
      if (!shownIn(o, scene)) continue;
      const w = o.matrixWorld.elements;
      key += o.id + ':' + o.geometry.id + ':' + (o.isInstancedMesh ? o.count + ':' + o.instanceMatrix.version : 1) + ':' + w[0] + ',' + w[2] + ',' + w[12] + ',' + w[13] + ',' + w[14] + '|';
    }
    if (key == s.key) return;
    s.key = key;
    if (s.mesh) {
      s.mesh.parent?.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mesh = null;
    }
    if (key) lowBuild(scene, s);
  }

  function lowBoxOf(geo, mats) {
    if (lowLocal.has(geo)) return lowLocal.get(geo);
    const P = geo.attributes.position.array,
      C = geo.attributes.color?.array,
      N = geo.attributes.normal?.array,
      I = geo.index ? geo.index.array : null,
      vs = [];
    for (const g of geo.groups) if (mats[g.materialIndex] === lowGone) for (let k = g.start; k < g.start + g.count; k++) vs.push(I ? I[k] : k);
    const out = { box: null, top: null, side: null, sides: [null, null, null, null], tris: vs, P, C, N };
    let x0 = Infinity,
      z0 = Infinity,
      x1 = -Infinity,
      z1 = -Infinity,
      y = null;
    const rgb = (v) => (C ? [C[v * 3], C[v * 3 + 1], C[v * 3 + 2]] : [1, 1, 1]);
    for (let k = 0; k + 2 < vs.length; k += 3) {
      const t = [vs[k] * 3, vs[k + 1] * 3, vs[k + 2] * 3];
      if (Math.abs(P[t[0] + 1] - P[t[1] + 1]) > 1e-3 || Math.abs(P[t[0] + 1] - P[t[2] + 1]) > 1e-3) continue;
      y = P[t[0] + 1];
      out.top ??= rgb(vs[k]);
      for (const v of t) (x0 = Math.min(x0, P[v])), (z0 = Math.min(z0, P[v + 2])), (x1 = Math.max(x1, P[v])), (z1 = Math.max(z1, P[v + 2]));
    }
    lowLocal.set(geo, out);
    if (y == null) return out;
    out.box = [x0, z0, x1, z1, y];
    // A side is kept where the block had one, from the lowest of its triangles.
    const at = [x0, x1, z0, z1],
      e = 0.005;
    for (let k = 0; k + 2 < vs.length; k += 3) {
      const t = [vs[k] * 3, vs[k + 1] * 3, vs[k + 2] * 3];
      if (t.every((v) => Math.abs(P[v + 1] - y) < 1e-3)) continue;
      for (let side = 0; side < 4; side++) {
        const o = side < 2 ? 0 : 2;
        if (!t.every((v) => Math.abs(P[v + o] - at[side]) < e)) continue;
        out.sides[side] = Math.min(out.sides[side] ?? Infinity, ...t.map((v) => P[v + 1]));
        out.side ??= rgb(vs[k]);
      }
    }
    out.side ??= out.top;
    return out;
  }

  function lowBuild(scene, s) {
    const boxes = [],
      pos = [],
      nor = [],
      col = [],
      W = new Float32Array(16);
    const quad = (a, b, c, d, n, rgb) => {
      for (const p of [a, b, c, a, c, d]) pos.push(p[0], p[1], p[2]), nor.push(n[0], n[1], n[2]), col.push(rgb[0], rgb[1], rgb[2]);
    };
    for (const o of s.meshes) {
      if (!shownIn(o, scene)) continue;
      const L = lowBoxOf(o.geometry, o.material);
      if (!L.tris.length) continue;
      const w = o.matrixWorld.elements,
        n = o.isInstancedMesh ? o.count : 1;
      for (let i = 0; i < n; i++) {
        const m = o.isInstancedMesh ? o.instanceMatrix.array.subarray(i * 16, i * 16 + 16) : null;
        for (let c = 0; c < 4; c++)
          for (let r = 0; r < 4; r++)
            W[c * 4 + r] = m ? w[r] * m[c * 4] + w[4 + r] * m[c * 4 + 1] + w[8 + r] * m[c * 4 + 2] + w[12 + r] * m[c * 4 + 3] : w[c * 4 + r];
        if (L.box && Math.abs(W[5] - 1) < 1e-3 && Math.abs(W[1]) < 1e-3 && Math.abs(W[9]) < 1e-3) {
          const [x0, z0, x1, z1, y] = L.box,
            ax = W[0] * x0 + W[8] * z0 + W[12],
            az = W[2] * x0 + W[10] * z0 + W[14],
            bx = W[0] * x1 + W[8] * z1 + W[12],
            bz = W[2] * x1 + W[10] * z1 + W[14],
            b = { x0: Math.min(ax, bx), z0: Math.min(az, bz), x1: Math.max(ax, bx), z1: Math.max(az, bz), y: y + W[13], top: L.top, side: L.side, sides: [null, null, null, null] };
          for (let k = 0; k < 4; k++) {
            if (L.sides[k] == null) continue;
            const [nx, nz] = LOW_SIDES[k],
              wx = Math.round(W[0] * nx + W[8] * nz),
              wz = Math.round(W[2] * nx + W[10] * nz);
            b.sides[LOW_SIDES.findIndex(([x, z]) => x == wx && z == wz)] = L.sides[k] + W[13];
          }
          boxes.push(b);
          continue;
        }
        // On its side or upside down: the block's own triangles, placed.
        const { P, C, N } = L;
        for (const v of L.tris) {
          const j = v * 3,
            x = P[j],
            y = P[j + 1],
            z = P[j + 2];
          pos.push(W[0] * x + W[4] * y + W[8] * z + W[12], W[1] * x + W[5] * y + W[9] * z + W[13], W[2] * x + W[6] * y + W[10] * z + W[14]);
          const a = N ? N[j] : 0,
            b = N ? N[j + 1] : 1,
            c = N ? N[j + 2] : 0;
          nor.push(W[0] * a + W[4] * b + W[8] * c, W[1] * a + W[5] * b + W[9] * c, W[2] * a + W[6] * b + W[10] * c);
          col.push(C ? C[j] : 1, C ? C[j + 1] : 1, C ? C[j + 2] : 1);
        }
      }
    }
    lowSurfaces(boxes, quad);
    lowSideFaces(boxes, quad);
    if (!pos.length) return;
    const T = three3,
      g = new T.LoY();
    g.setAttribute('position', new T.THS(new Float32Array(pos), 3));
    g.setAttribute('normal', new T.THS(new Float32Array(nor), 3));
    g.setAttribute('color', new T.THS(new Float32Array(col), 3));
    g.computeBoundingSphere();
    const mesh = new T.eaF(g, (lowPlain ??= makeLowPlain(T)));
    mesh.raycast = () => {};
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    s.mesh = mesh;
  }

  const q3 = (v) => Math.round(v * 1000);

  // Each level and colour's surfaces as few rectangles as cover them: the boxes' edges cut the ground into cells, and
  // runs of covered cells grow into rectangles, first along x, then along z.
  function lowSurfaces(boxes, quad) {
    const groups = new Map();
    for (const b of boxes) {
      const k = q3(b.y) + ':' + b.top.map(q3).join(',');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(b);
    }
    for (const list of groups.values()) {
      const { y, top } = list[0],
        up = (x0, z0, x1, z1) => quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], [0, 1, 0], top),
        xs = [...new Set(list.flatMap((b) => [q3(b.x0), q3(b.x1)]))].sort((a, b) => a - b),
        zs = [...new Set(list.flatMap((b) => [q3(b.z0), q3(b.z1)]))].sort((a, b) => a - b),
        nx = xs.length - 1,
        nz = zs.length - 1;
      if (nx * nz > 4e6) {
        for (const b of list) up(b.x0, b.z0, b.x1, b.z1);
        continue;
      }
      const xi = new Map(xs.map((v, i) => [v, i])),
        zi = new Map(zs.map((v, i) => [v, i])),
        cov = new Uint8Array(nx * nz);
      for (const b of list)
        for (let j = zi.get(q3(b.z0)); j < zi.get(q3(b.z1)); j++) cov.fill(1, j * nx + xi.get(q3(b.x0)), j * nx + xi.get(q3(b.x1)));
      for (let j = 0; j < nz; j++)
        for (let i = 0; i < nx; i++) {
          if (cov[j * nx + i] != 1) continue;
          let w = 1,
            h = 1;
          while (i + w < nx && cov[j * nx + i + w] == 1) w++;
          for (; j + h < nz; h++) {
            let row = true;
            for (let k = i; k < i + w && row; k++) row = cov[(j + h) * nx + k] == 1;
            if (!row) break;
          }
          for (let r = j; r < j + h; r++) cov.fill(2, r * nx + i, r * nx + i + w);
          up(xs[i] / 1000, zs[j] / 1000, xs[i + w] / 1000, zs[j + h] / 1000);
        }
    }
  }

  // A side shows where, 0.3 out from it, there is no water of the same level (the seam rule above). What is left of
  // each side is put on its line, and touching pieces of one line, height and colour become one face.
  function lowSideFaces(boxes, quad) {
    const CELL = 20,
      cells = new Map(),
      cellOf = (x, z) => Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
    boxes.forEach((b, n) => {
      for (let x = Math.floor((b.x0 - 0.35) / CELL); x <= Math.floor((b.x1 + 0.35) / CELL); x++)
        for (let z = Math.floor((b.z0 - 0.35) / CELL); z <= Math.floor((b.z1 + 0.35) / CELL); z++) {
          const k = x + ',' + z;
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(n);
        }
    });
    const lines = new Map();
    for (const b of boxes)
      for (let k = 0; k < 4; k++) {
        const bot = b.sides[k];
        if (bot == null) continue;
        const alongX = k >= 2, // a -z or +z side runs along x
          c = [b.x0, b.x1, b.z0, b.z1][k],
          out = c + (k % 2 ? 0.3 : -0.3),
          lo = alongX ? b.x0 : b.z0,
          hi = alongX ? b.x1 : b.z1;
        let parts = [[lo, hi]];
        const near = new Set();
        for (let t = lo; t < hi + CELL; t += CELL) for (const n of cells.get(alongX ? cellOf(Math.min(t, hi), out) : cellOf(out, Math.min(t, hi))) ?? []) near.add(n);
        for (const n of near) {
          const q = boxes[n];
          if (q === b || Math.abs(q.y - b.y) > 0.01) continue;
          if (!(alongX ? out > q.z0 - 0.01 && out < q.z1 + 0.01 : out > q.x0 - 0.01 && out < q.x1 + 0.01)) continue;
          const q0 = alongX ? q.x0 : q.z0,
            q1 = alongX ? q.x1 : q.z1;
          parts = parts.flatMap(([a, z]) => (q1 <= a || q0 >= z ? [[a, z]] : [q0 > a ? [a, q0] : null, q1 < z ? [q1, z] : null].filter(Boolean)));
        }
        const key = k + ':' + q3(c) + ':' + q3(bot) + ':' + q3(b.y) + ':' + b.side.map(q3).join(',');
        if (!lines.has(key)) lines.set(key, { k, c, bot, y: b.y, rgb: b.side, parts: [] });
        for (const p of parts) if (p[1] - p[0] > 1e-3) lines.get(key).parts.push(p);
      }
    for (const { k, c, bot, y, rgb, parts } of lines.values()) {
      parts.sort((a, b) => a[0] - b[0]);
      const joined = [];
      for (const p of parts) {
        const last = joined[joined.length - 1];
        if (last && p[0] <= last[1] + 1e-3) last[1] = Math.max(last[1], p[1]);
        else joined.push([...p]);
      }
      const [nx, nz] = LOW_SIDES[k];
      for (const [a, z] of joined) {
        if (k >= 2) quad([a, bot, c], [z, bot, c], [z, y, c], [a, y, c], [0, 0, nz], rgb);
        else quad([c, bot, a], [c, bot, z], [c, y, z], [c, y, a], [nx, 0, 0], rgb);
      }
    }
  }

  // ---- finish boxes ------------------------------------------------------------------------------------------------
  // A finish box (catalog.js finishBox) is a see-through red block of finish trigger. Boxes that touch are drawn as one:
  // the water seams' idea with whole boxes in 3D. A face is dropped where a point just outside it is inside another
  // box, so a wall of boxes reads as one red sheet. Round the outside of the joined shape runs a chequered frame, like
  // Trackmania's finish gates (see FRAME). A block's box stays axis-aligned however it is turned (rotations are exact),
  // so each is kept as its world min and max.
  const FIN_MAX = 1024; // finish boxes in a scene: two texels each in a texture up to 2048 wide
  let finishMat = null,
    frameMat = null;
  const finTex = { value: null },
    finCount = { value: 0 };
  const finScenes = new WeakMap(); // scene -> what it drew last frame and the boxes built from that
  const finLocal = new WeakMap(); // geometry -> [min, max] of its finish box in the part frame, or null

  function finBoxOf(geo, mats) {
    if (finLocal.has(geo)) return finLocal.get(geo);
    const P = geo.attributes.position.array,
      I = geo.index ? geo.index.array : null,
      lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    for (const g of geo.groups) {
      if (mats[g.materialIndex] !== finishMat) continue;
      for (let k = g.start; k < g.start + g.count; k++) {
        const v = (I ? I[k] : k) * 3;
        for (let a = 0; a < 3; a++) {
          lo[a] = Math.min(lo[a], P[v + a]);
          hi[a] = Math.max(hi[a], P[v + a]);
        }
      }
    }
    const out = lo[0] <= hi[0] ? [lo, hi] : null;
    finLocal.set(geo, out);
    return out;
  }

  // World boxes of everything drawn, two texels each: (minX, minY, minZ, 0), (maxX, maxY, maxZ, 0); a second row holds
  // each box's block origin (x, y, z, 0) at the box's first texel.
  function buildFinish(s) {
    const data = [],
      org = [],
      W = new Float32Array(16);
    for (const o of s.drawn) {
      const local = Array.isArray(o.material) ? finBoxOf(o.geometry, o.material) : null;
      if (!local) continue;
      const w = o.matrixWorld.elements,
        n = o.isInstancedMesh ? o.count : 1,
        c = [0, 1, 2].map((a) => (local[0][a] + local[1][a]) / 2),
        e = [0, 1, 2].map((a) => (local[1][a] - local[0][a]) / 2);
      for (let i = 0; i < n && data.length < FIN_MAX * 8; i++) {
        const m = o.isInstancedMesh ? o.instanceMatrix.array.subarray(i * 16, i * 16 + 16) : null;
        for (let q = 0; q < 4; q++)
          for (let r = 0; r < 4; r++)
            W[q * 4 + r] = m ? w[r] * m[q * 4] + w[4 + r] * m[q * 4 + 1] + w[8 + r] * m[q * 4 + 2] + w[12 + r] * m[q * 4 + 3] : w[q * 4 + r];
        const lo = [],
          hi = [];
        for (let r = 0; r < 3; r++) {
          const mid = W[r] * c[0] + W[4 + r] * c[1] + W[8 + r] * c[2] + W[12 + r],
            half = Math.abs(W[r]) * e[0] + Math.abs(W[4 + r]) * e[1] + Math.abs(W[8 + r]) * e[2];
          lo.push(mid - half);
          hi.push(mid + half);
        }
        data.push(lo[0], lo[1], lo[2], 0, hi[0], hi[1], hi[2], 0);
        org.push(W[12], W[13], W[14], 0, 0, 0, 0, 0);
      }
    }
    if (s.tex) s.tex.dispose();
    s.n = data.length / 8;
    s.tex = s.n ? floatTexture(data.concat(org), s.n * 2, 2) : null;
    buildFrame(s, data);
  }

  // The frame is drawn on its own: a shell a little outside every box, opaque and writing depth, so it hides what is
  // behind it the way a solid gate does and the see-through faces behind or flush with it lose to it. Its shader keeps
  // only the frame. One mesh per scene, in world coordinates, added to the scene the boxes are drawn in; it is rebuilt
  // only when the boxes change, and hides itself once the boxes have not been drawn for a while (all deleted, or out of
  // view).
  const FRAME_OUT = 0.03;
  function buildFrame(s, data) {
    if (!s.mesh) {
      if (!s.n) return;
      frameMat ??= makeFrame(three3);
      s.mesh = new three3.eaF(new three3.LoY(), frameMat);
      s.mesh.name = 'be-finish-frame';
      s.mesh.frustumCulled = false;
      s.mesh.matrixAutoUpdate = false;
      s.mesh.raycast = () => {};
      s.mesh.onBeforeRender = (renderer) => {
        if (renderer.info.render.frame - s.frame > 30) s.mesh.visible = false;
        finTex.value = s.tex;
        finCount.value = s.n;
      };
    }
    const P = new Float32Array(s.n * 108),
      lo = [0, 0, 0],
      hi = [0, 0, 0];
    let o = 0;
    for (let i = 0; i < s.n; i++) {
      for (let a = 0; a < 3; a++) {
        lo[a] = data[i * 8 + a] - FRAME_OUT;
        hi[a] = data[i * 8 + 4 + a] + FRAME_OUT;
      }
      for (let a = 0; a < 3; a++)
        for (const w of [lo[a], hi[a]]) {
          const b = (a + 1) % 3,
            c = (a + 2) % 3;
          for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) {
            P[o + a] = w;
            P[o + b] = u ? hi[b] : lo[b];
            P[o + c] = v ? hi[c] : lo[c];
            o += 3;
          }
        }
    }
    s.mesh.geometry.dispose();
    const g = new three3.LoY();
    g.setAttribute('position', new three3.THS(P, 3));
    s.mesh.geometry = g;
    s.mesh.visible = s.n > 0;
  }

  // Runs before each finish box draw, the way seams() does for water.
  function finishSeams(renderer, scene, camera, geometry, object) {
    let s = finScenes.get(scene);
    if (!s) finScenes.set(scene, (s = { frame: -1, drawn: [], key: '', tex: null, n: 0 }));
    const f = renderer.info.render.frame;
    if (s.frame != f) {
      s.frame = f;
      const key = (s.drawn = s.drawn.filter(intact)).map(seamKey).join('|');
      if (key != s.key) {
        s.key = key;
        buildFinish(s);
      }
      s.drawn = [];
    }
    if (!s.drawn.includes(object)) s.drawn.push(object);
    finTex.value = s.tex;
    finCount.value = s.n;
    if (s.mesh && s.n) {
      if (s.mesh.parent !== scene) scene.add(s.mesh);
      s.mesh.visible = true;
    }
  }

  // The fragment's own box is the one whose surface it is nearest (it may sit a little off it at a polygon's edge, where
  // the position is extrapolated, or on the frame's shell); the face's outward normal is the axis it is nearest a side
  // on. Until the boxes are known (a box's first frame) the face draws plain.
  const OWN_FACE = `
      vec3 beLo = vec3(0.0), beHi = vec3(0.0);
      float beBest = 1e9;
      for (int i = 0; i < beFinCount; i++) {
        vec3 lo = texelFetch(beFin, ivec2(2 * i, 0), 0).xyz, hi = texelFetch(beFin, ivec2(2 * i + 1, 0), 0).xyz;
        vec3 o = max(max(lo - vBeWorld, vBeWorld - hi), 0.0), d = min(vBeWorld - lo, hi - vBeWorld);
        float s = max(o.x, max(o.y, o.z)) > 0.0 ? length(o) : min(d.x, min(d.y, d.z));
        if (s < beBest) {
          beBest = s;
          beLo = lo;
          beHi = hi;
        }
      }
      vec3 beP = clamp(vBeWorld, beLo, beHi);
      vec3 beD0 = beP - beLo, beD1 = beHi - beP, beD = min(beD0, beD1);
      // beA: the axis of the face's outward normal beN.
      int beA = beD.x <= beD.y && beD.x <= beD.z ? 0 : beD.y <= beD.z ? 1 : 2;
      vec3 beN = beA == 0 ? vec3(1.0, 0.0, 0.0) : beA == 1 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
      if (dot(beD0, beN) < dot(beD1, beN)) beN = -beN;
  `;
  const FINISH = `
    {
      ${OWN_FACE}
      // Another box right outside this face: the face is inside the joined shape.
      if (beBest < 0.75 && beFinInside(beP + beN * 0.3)) discard;
      // Overlapping boxes: a face in the same plane as another box's face (two boxes overlapping, their fronts flush) is
      // drawn once, by the box listed first, so the overlap is no darker than one box. The fragment's own box is its
      // block's (same origin), the one whose surface it is nearest.
      {
        const float t = 0.02;
        int beOwn = -1;
        float beOwnD = 1e9;
        for (int i = 0; i < beFinCount; i++) {
          vec3 o = texelFetch(beFin, ivec2(2 * i, 1), 0).xyz;
          if (distance(o, vBeOrigin) >= 0.01) continue;
          vec3 lo = texelFetch(beFin, ivec2(2 * i, 0), 0).xyz, hi = texelFetch(beFin, ivec2(2 * i + 1, 0), 0).xyz;
          vec3 q = max(max(lo - vBeWorld, vBeWorld - hi), 0.0), d = min(vBeWorld - lo, hi - vBeWorld);
          float s = max(q.x, max(q.y, q.z)) > 0.0 ? length(q) : min(d.x, min(d.y, d.z));
          if (s < beOwnD) {
            beOwnD = s;
            beOwn = i;
          }
        }
        for (int i = 0; i < beFinCount; i++) {
          if (i >= beOwn) break;
          vec3 o = texelFetch(beFin, ivec2(2 * i, 1), 0).xyz;
          if (distance(o, vBeOrigin) < 0.01) continue;
          vec3 lo = texelFetch(beFin, ivec2(2 * i, 0), 0).xyz, hi = texelFetch(beFin, ivec2(2 * i + 1, 0), 0).xyz;
          // The margin is only across the face; along it the other box must cover the point, a hair inside its edge.
          vec3 m = abs(beN) * (t + 0.002) - 0.002;
          if (any(lessThan(vBeWorld, lo - m)) || any(greaterThan(vBeWorld, hi + m))) continue;
          float pa = dot(beP, abs(beN)), la = dot(lo, abs(beN)), ha = dot(hi, abs(beN));
          if (min(abs(pa - la), abs(pa - ha)) < t) discard;
        }
      }
      diffuseColor.a = 0.2;
    }
  `;

  // The frame: the part of each outer face within BAND of the joined shape's outline, measured in the face's plane, in
  // chequer squares of SQ, with a thin red trim inside it. Distance to the outline is how far one can go from the point,
  // along the face's two axes and the four diagonals, before leaving every box: the axes find straight edges, the
  // diagonals the inside corners of an L or beside a half box, so the frame follows any shape and stops at joins. The
  // squares are counted from the first box's corner in world units, so they run on unbroken from box to box and round
  // the edges onto the box's sides (every box edge sits on that grid). Faces a whole box deep (a sheet's top and sides)
  // are all frame.
  const SQ = 0.5,
    BAND = 1.0,
    TRIM = 0.18;
  const FRAME = `
    {
      vec3 beFw = max(fwidth(vBeWorld) / ${SQ.toFixed(3)}, vec3(1e-4));
      if (beFinCount == 0) discard;
      ${OWN_FACE}
      const float beCap = ${(BAND + TRIM).toFixed(3)};
      vec3 beU = beA == 0 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), beV = beA == 2 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
      if (min(dot(beD, beU), dot(beD, beV)) >= beCap) discard;
      if (beFinInside(beP + beN * 0.3)) discard;
      vec3 beQ = beP - beN * 0.3; // under the face, inside its box
      float beDist = beCap;
      for (int i = -1; i <= 1; i++)
        for (int j = -1; j <= 1; j++) {
          if (i == 0 && j == 0) continue;
          vec3 d = float(i) * beU + float(j) * beV;
          vec3 e = mix(beLo, beHi, step(0.0, d)) - beQ;
          float t = 1e9;
          for (int a = 0; a < 3; a++) if (d[a] != 0.0) t = min(t, e[a] * d[a]);
          if (t < beDist) beDist = beFinRun(beQ, d, t, beDist);
        }
      if (beDist >= beCap) discard;
      if (beDist < ${(BAND + 0.001).toFixed(3)}) {
        vec3 beO = texelFetch(beFin, ivec2(0, 0), 0).xyz;
        vec3 c = (clamp(beP - beN * ${(SQ / 2).toFixed(3)}, beLo + 0.01, beHi - 0.01) - beO) / ${SQ.toFixed(3)};
        vec3 cLo = (beLo - beO) / ${SQ.toFixed(3)}, cHi = (beHi - beO) / ${SQ.toFixed(3)};
        vec2 uv = vec2(dot(c, beU), dot(c, beV)), fw = vec2(dot(beFw, beU), dot(beFw, beV));
        vec2 lo2 = vec2(dot(cLo, beU), dot(cLo, beV)), hi2 = vec2(dot(cHi, beU), dot(cHi, beV)), h = min(0.5 * fw, 0.5 * (hi2 - lo2));
        uv = clamp(uv, lo2 + h, hi2 - h); // the filter never reaches past the box, where there are no squares
        // A box-filtered chequer, so far off it fades to grey instead of shimmering. The square is read from just inside
        // the box, never on a square's border (the shell's rim past a box edge would show a grey seam there).
        vec2 k = 2.0 * (abs(fract((uv - 0.5 * fw) * 0.5) - 0.5) - abs(fract((uv + 0.5 * fw) * 0.5) - 0.5)) / fw;
        float w = 0.5 - 0.5 * k.x * k.y;
        if (mod(floor(dot(c, abs(beN))), 2.0) > 0.5) w = 1.0 - w;
        diffuseColor.rgb = mix(vec3(0.012), vec3(0.86), w);
      } else diffuseColor.rgb = vec3(0.9, 0.02, 0.02);
      diffuseColor.a = 1.0;
    }
  `;

  const FIN_HEAD = `uniform highp sampler2D beFin;
        uniform int beFinCount;
        centroid varying vec3 vBeWorld;
        flat varying vec3 vBeOrigin;
        bool beFinInside(vec3 q) {
          for (int i = 0; i < beFinCount; i++) {
            vec3 lo = texelFetch(beFin, ivec2(2 * i, 0), 0).xyz, hi = texelFetch(beFin, ivec2(2 * i + 1, 0), 0).xyz;
            if (all(greaterThan(q, lo - 0.001)) && all(lessThan(q, hi + 0.001))) return true;
          }
          return false;
        }
        // How far the joined boxes go from q along d (each part -1, 0 or 1, so the distance is the larger of the
        // in-plane offsets), starting at t, where q's own box ends; at most cap.
        // Written with plain fixed loops, no early return and no per-component indexing: Direct3D's shader compiler
        // (ANGLE on Windows) got the old form wrong and stopped after the first box, so every inside corner of a wall
        // of boxes drew a frame square.
        float beFinRun(vec3 q, vec3 d, float t, float cap) {
          bool going = true;
          for (int k = 0; k < 6; k++) {
            if (!going || t >= cap) break;
            vec3 x = q + d * (t + 0.01);
            float tn = -1.0;
            for (int i = 0; i < ${FIN_MAX}; i++) {
              if (i >= beFinCount) break;
              vec3 lo = texelFetch(beFin, ivec2(2 * i, 0), 0).xyz, hi = texelFetch(beFin, ivec2(2 * i + 1, 0), 0).xyz;
              if (any(lessThan(x, lo - 0.001)) || any(greaterThan(x, hi + 0.001))) continue;
              vec3 e = (mix(lo, hi, step(0.0, d)) - q) * d;
              float te = min(d.x != 0.0 ? e.x : 1e9, min(d.y != 0.0 ? e.y : 1e9, d.z != 0.0 ? e.z : 1e9));
              tn = max(tn, te);
            }
            if (tn < 0.0) going = false;
            else t = tn;
          }
          return min(t, cap);
        }
        `;
  const WORLD_VERTEX = (sh) =>
    'centroid varying vec3 vBeWorld;\nflat varying vec3 vBeOrigin;\n' +
    sh.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
        vec4 beW = vec4(transformed, 1.0), beO = vec4(0.0, 0.0, 0.0, 1.0);
        #ifdef USE_INSTANCING
          beW = instanceMatrix * beW;
          beO = instanceMatrix * beO;
        #endif
        vBeWorld = (modelMatrix * beW).xyz;
        vBeOrigin = (modelMatrix * beO).xyz;`,
    );

  // Unlit, so it reads the same from every side; no depth writes, so faces behind it and other boxes show through and
  // the order they draw in does not matter; pushed back a little, so a face flush with a solid block loses to it.
  function makeFinish(three) {
    const m = new three.V9B({ vertexColors: true, transparent: true, depthWrite: false, side: 2, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    three3 = three;
    m.onBeforeRender = finishSeams;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.beFin = finTex;
      sh.uniforms.beFinCount = finCount;
      sh.vertexShader = WORLD_VERTEX(sh);
      sh.fragmentShader = FIN_HEAD + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + FINISH);
    };
    m.customProgramCacheKey = () => 'be-finish';
    return m;
  }

  // Opaque and unlit, both sides; pushed back like the boxes, so a solid block flush with it (the road under a box)
  // wins, while the shell, a little outside the boxes, still wins over their see-through faces.
  function makeFrame(three) {
    const m = new three.V9B({ side: 2, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.beFin = finTex;
      sh.uniforms.beFinCount = finCount;
      sh.vertexShader = WORLD_VERTEX(sh);
      sh.fragmentShader = FIN_HEAD + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAME);
    };
    m.customProgramCacheKey = () => 'be-finish-frame';
    return m;
  }

  // ---- splashes ---------------------------------------------------------------------------------------------------
  const MAX = 900; // droplets alive at once, per scene
  const GRAVITY = 22;
  const systems = new WeakMap(); // scene wrapper -> droplets and foam rings
  const cars = new WeakMap(); // car -> its water boxes and what it was doing last frame

  const canvasTexture = (three, draw) => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    draw(c.getContext('2d'));
    const t = new three.gPd(c);
    t.needsUpdate = true;
    return t;
  };

  function system(three, sw) {
    let s = systems.get(sw);
    if (s) return s;
    const pos = new Float32Array(MAX * 3).fill(-1e5);
    const geo = new three.LoY();
    geo.setAttribute('position', new three.THS(pos, 3));
    const drop = canvasTexture(three, (g) => {
      const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(0.45, 'rgba(225,242,255,0.85)');
      r.addColorStop(1, 'rgba(200,230,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
    });
    const pts = new three.ONl(geo, new three.BH$({ size: 0.55, map: drop, transparent: true, depthWrite: false, color: 0xeaf6ff, opacity: 0.9 }));
    pts.frustumCulled = false;
    sw.scene.add(pts);
    const ringTex = canvasTexture(three, (g) => {
      const r = g.createRadialGradient(32, 32, 14, 32, 32, 32);
      r.addColorStop(0, 'rgba(255,255,255,0)');
      r.addColorStop(0.55, 'rgba(255,255,255,0.9)');
      r.addColorStop(0.8, 'rgba(235,247,255,0.5)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
    });
    const plane = new three.bdM(1, 1);
    plane.rotateX(-Math.PI / 2);
    s = { pts, pos, geo, vel: new Float32Array(MAX * 3), floor: new Float32Array(MAX), live: 0, rings: [], ringTex, plane, three, sw };
    systems.set(sw, s);
    return s;
  }

  function emit(s, x, y, z, vx, vy, vz, floor) {
    if (s.live >= MAX) return;
    const i = s.live++,
      k = i * 3;
    s.pos[k] = x;
    s.pos[k + 1] = y;
    s.pos[k + 2] = z;
    s.vel[k] = vx;
    s.vel[k + 1] = vy;
    s.vel[k + 2] = vz;
    s.floor[i] = floor;
  }

  function ring(s, x, y, z, size) {
    const m = new s.three.eaF(s.plane, new s.three.V9B({ map: s.ringTex, transparent: true, depthWrite: false, opacity: 0.85 }));
    m.position.set(x, y + 0.05, z);
    m.scale.setScalar(size);
    s.sw.scene.add(m);
    s.rings.push({ m, age: 0, size });
  }

  // strength 0..1. vx/vz: the car's velocity along the water, so the spray is thrown forward with it.
  function splash(s, x, y, z, vx, vz, strength) {
    const n = Math.round(60 + 260 * strength),
      speed = Math.hypot(vx, vz),
      fx = speed > 0.1 ? vx / speed : 0,
      fz = speed > 0.1 ? vz / speed : 0;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2,
        out = (2 + Math.random() * 7) * (0.5 + strength),
        side = i % 3 == 0;
      // A third go out to the sides as two sheets, the rest up and around the car.
      let dx = Math.cos(a) * out,
        dz = Math.sin(a) * out;
      if (side) {
        const sgn = Math.random() < 0.5 ? -1 : 1;
        dx = -fz * sgn * (5 + Math.random() * 9) * (0.5 + strength);
        dz = fx * sgn * (5 + Math.random() * 9) * (0.5 + strength);
      }
      emit(s, x + (Math.random() - 0.5) * 2.4, y + 0.1, z + (Math.random() - 0.5) * 2.4, vx * 0.45 + dx, (3 + Math.random() * 9) * (0.4 + strength), vz * 0.45 + dz, y);
    }
    ring(s, x, y, z, 3 + 6 * strength);
  }

  function update(car, sw, dt, state, three) {
    const c = cars.get(car);
    if (!c || !c.zones.length || !state) return;
    const s = system(three, sw);
    const p = state.position,
      f = state.frames;
    // Velocity from the physics frames, not render frames, so a stall or catch-up never fakes a splash.
    if (f != c.f) {
      const steps = Math.max(1, f - c.f);
      if (c.f >= 0 && steps < 200) {
        c.pvy = c.vy;
        c.vx = ((p.x - c.x) / steps) * 1000;
        c.vy = ((p.y - c.y) / steps) * 1000;
        c.vz = ((p.z - c.z) / steps) * 1000;
      }
      c.f = f;
      c.x = p.x;
      c.y = p.y;
      c.z = p.z;
      let zone = null;
      for (const q of c.zones)
        if (p.x >= q.min[0] && p.x <= q.max[0] && p.z >= q.min[2] && p.z <= q.max[2] && p.y >= q.min[1] - 1 && p.y <= q.max[1] + 4) {
          zone = q;
          break;
        }
      if (zone && steps < 200) {
        const top = zone.surface ?? zone.max[1],
          low = p.y - 0.45 - top, // car underside relative to the surface
          speed = Math.hypot(c.vx, c.vz);
        const strength = Math.min(1, Math.max(0, (-c.pvy - 2) / 18 + speed / 260));
        // Hitting the surface on the way down, or coming back up off it after a bounce.
        if (c.cool <= 0 && low < 0.3 && c.pvy < -3 && (c.wasAbove || c.vy > 1)) {
          splash(s, p.x, top, p.z, c.vx, c.vz, strength);
          c.cool = 120;
        }
        // Spray along the surface while the car skims or drives through shallow water.
        if (low > -1.4 && low < 0.6 && speed > 8) {
          const n = Math.min(10, speed / 14);
          for (let i = 0; i < n; i++) {
            const sgn = i % 2 ? 1 : -1,
              fx = c.vx / speed,
              fz = c.vz / speed,
              out = 1.5 + Math.random() * 3 + speed * 0.04;
            emit(s, p.x - fx * 1.6 + -fz * sgn * 1.1, top + 0.05, p.z - fz * 1.6 + fx * sgn * 1.1, c.vx * 0.3 - fz * sgn * out, 1.5 + Math.random() * (2 + speed * 0.05), c.vz * 0.3 + fx * sgn * out, top);
          }
        }
        c.wasAbove = low > 0.2;
      } else c.wasAbove = true;
      c.cool -= steps;
    }
    step(s, dt);
  }

  function step(s, dt) {
    // Several cars (ghosts) share one scene: move the droplets once per drawn frame.
    if (s.stepped == time.value) return;
    s.stepped = time.value;
    for (let i = 0; i < s.live; i++) {
      const k = i * 3;
      s.vel[k + 1] -= GRAVITY * dt;
      s.pos[k] += s.vel[k] * dt;
      s.pos[k + 1] += s.vel[k + 1] * dt;
      s.pos[k + 2] += s.vel[k + 2] * dt;
      // A droplet is gone once it falls back below the water it came from.
      if (s.pos[k + 1] < s.floor[i] - 0.2 && s.vel[k + 1] < 0) {
        const j = --s.live,
          l = j * 3;
        for (let a = 0; a < 3; a++) {
          s.pos[k + a] = s.pos[l + a];
          s.vel[k + a] = s.vel[l + a];
          s.pos[l + a] = -1e5;
        }
        s.floor[i] = s.floor[j];
        i--;
      }
    }
    s.geo.attributes.position.needsUpdate = true;
    s.geo.setDrawRange(0, s.live);
    for (let i = s.rings.length - 1; i >= 0; i--) {
      const r = s.rings[i];
      r.age += dt;
      r.m.scale.setScalar(r.size * (1 + r.age * 2.2));
      r.m.material.opacity = Math.max(0, 0.85 * (1 - r.age / 1.4));
      if (r.age > 1.4) {
        s.sw.scene.remove(r.m);
        r.m.material.dispose();
        s.rings.splice(i, 1);
      }
    }
  }

  return {
    // The see-through material for group 1 of the part TM.renderArrays just built: water, or a finish box's.
    material(three) {
      if (self.TM.renderArrays?.seeThrough == 'finish') return (finishMat ??= makeFinish(three));
      if (self.TM.waterLow?.()) {
        three3 = three;
        return self.TM.renderArrays.waterBox ? (lowGone ??= makeLowGone(three)) : (lowPlain ??= makeLowPlain(three));
      }
      if (!material) material = makeMaterial(three);
      if (!ticking && typeof requestAnimationFrame == 'function') {
        ticking = true;
        requestAnimationFrame(tick);
      }
      return material;
    },
    // A new car on a track: remember where its water is.
    track(car, trackData) {
      try {
        const zones = self.TM.zones(trackData).filter((z) => z.type == 'Water' || z.type == 'Shallow');
        cars.set(car, { zones, f: -1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, pvy: 0, wasAbove: true, cool: 0 });
      } catch (e) {
        console.warn('Water splashes off:', e);
      }
    },
    update,
    dispose(car) {
      cars.delete(car);
    },
  };
})();
