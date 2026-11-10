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
  // Water boxes per scene, two texels each: 2048 wide is the smallest texture every WebGL2 device takes. Blocks past
  // that keep their sides.
  const SEAM_MAX = 1024;
  const seamTex = { value: null },
    seamCount = { value: 0 };
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

  // World boxes of everything drawn, two texels each: (minX, minZ, maxX, maxZ), (bottom, surface, 0, 0).
  function buildSeams(s) {
    const data = [],
      W = new Float32Array(16);
    for (const o of s.drawn) {
      const local = boxesOf(o.geometry, o.material);
      if (!local.length) continue;
      const w = o.matrixWorld.elements,
        n = o.isInstancedMesh ? o.count : 1;
      for (let i = 0; i < n && data.length < SEAM_MAX * 8; i++) {
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
          data.push(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), bot + W[13], top + W[13], 0, 0);
        }
      }
    }
    if (s.tex) s.tex.dispose();
    s.n = Math.min(data.length / 8, SEAM_MAX);
    s.tex = null;
    if (!s.n) return;
    s.tex = floatTexture(data.slice(0, s.n * 8), s.n * 2);
  }

  // A one-row RGBA float data texture made from the plain Texture class (NSWS hands this file only a few three.js classes).
  function floatTexture(data, width) {
    const t = new three3.gPd();
    t.image = { data: new Float32Array(data), width, height: 1 };
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
  }

  // A side (a face that stands upright) is a seam when points 0.3 either side of it are both in water of the same level.
  const SEAM = `
    {
      vec3 beFace = normalize(cross(dFdx(vBeWorld), dFdy(vBeWorld)));
      if (beSeamCount > 0 && abs(beFace.y) < 0.3) {
        vec2 beOut = normalize(beFace.xz) * 0.3;
        vec2 beA = vBeWorld.xz + beOut, beB = vBeWorld.xz - beOut;
        float beLa = -1e9, beLb = 1e9; // water level found on each side
        for (int i = 0; i < beSeamCount; i++) {
          vec4 r = texelFetch(beSeams, ivec2(2 * i, 0), 0), h = texelFetch(beSeams, ivec2(2 * i + 1, 0), 0);
          if (vBeWorld.y < h.x - 0.01 || vBeWorld.y > h.y + 0.01) continue;
          if (all(greaterThan(beA, r.xy - 0.01)) && all(lessThan(beA, r.zw + 0.01))) beLa = h.y;
          if (all(greaterThan(beB, r.xy - 0.01)) && all(lessThan(beB, r.zw + 0.01))) beLb = h.y;
        }
        if (abs(beLa - beLb) < 0.01) discard;
      }
    }
  `;

  function makeMaterial(three) {
    const m = new three._4j({ vertexColors: true, transparent: true, opacity: 0.58, roughness: 0.06, metalness: 0.1, side: 2 });
    three3 = three;
    m.onBeforeRender = seams;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.beTime = time;
      sh.uniforms.beSeams = seamTex;
      sh.uniforms.beSeamCount = seamCount;
      sh.vertexShader = 'varying vec3 vBeWorld;\n' + sh.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 beW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          beW = instanceMatrix * beW;
        #endif
        vBeWorld = (modelMatrix * beW).xyz;`,
      );
      sh.fragmentShader = 'uniform float beTime;\nuniform highp sampler2D beSeams;\nuniform int beSeamCount;\nvarying vec3 vBeWorld;\n' + WAVES + sh.fragmentShader.replace(
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

  // ---- finish boxes ------------------------------------------------------------------------------------------------
  // A finish box (catalog.js finishBox) is a see-through red block of finish trigger. Boxes that touch are drawn as one:
  // the water seams' idea with whole boxes in 3D. A face is dropped where a point just outside it is inside another
  // box, so a wall of boxes reads as one red sheet. Round the outside of the joined shape runs a chequered frame, like
  // Trackmania's finish gates (see FRAME). A block's box stays axis-aligned however it is turned (rotations are exact),
  // so each is kept as its world min and max.
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

  // World boxes of everything drawn, two texels each: (minX, minY, minZ, 0), (maxX, maxY, maxZ, 0).
  function buildFinish(s) {
    const data = [],
      W = new Float32Array(16);
    for (const o of s.drawn) {
      const local = Array.isArray(o.material) ? finBoxOf(o.geometry, o.material) : null;
      if (!local) continue;
      const w = o.matrixWorld.elements,
        n = o.isInstancedMesh ? o.count : 1,
        c = [0, 1, 2].map((a) => (local[0][a] + local[1][a]) / 2),
        e = [0, 1, 2].map((a) => (local[1][a] - local[0][a]) / 2);
      for (let i = 0; i < n && data.length < SEAM_MAX * 8; i++) {
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
      }
    }
    if (s.tex) s.tex.dispose();
    s.n = data.length / 8;
    s.tex = s.n ? floatTexture(data, s.n * 2) : null;
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
        bool beFinInside(vec3 q) {
          for (int i = 0; i < beFinCount; i++) {
            vec3 lo = texelFetch(beFin, ivec2(2 * i, 0), 0).xyz, hi = texelFetch(beFin, ivec2(2 * i + 1, 0), 0).xyz;
            if (all(greaterThan(q, lo - 0.001)) && all(lessThan(q, hi + 0.001))) return true;
          }
          return false;
        }
        // How far the joined boxes go from q along d (each part -1, 0 or 1, so the distance is the larger of the
        // in-plane offsets), starting at t, where q's own box ends; at most cap.
        float beFinRun(vec3 q, vec3 d, float t, float cap) {
          for (int k = 0; k < 6 && t < cap; k++) {
            vec3 x = q + d * (t + 0.01);
            float tn = -1.0;
            for (int i = 0; i < beFinCount; i++) {
              vec3 lo = texelFetch(beFin, ivec2(2 * i, 0), 0).xyz, hi = texelFetch(beFin, ivec2(2 * i + 1, 0), 0).xyz;
              if (any(lessThan(x, lo - 0.001)) || any(greaterThan(x, hi + 0.001))) continue;
              vec3 e = mix(lo, hi, step(0.0, d)) - q;
              float te = 1e9;
              for (int a = 0; a < 3; a++) if (d[a] != 0.0) te = min(te, e[a] * d[a]);
              tn = max(tn, te);
            }
            if (tn < 0.0) return t;
            t = tn;
          }
          return min(t, cap);
        }
        `;
  const WORLD_VERTEX = (sh) =>
    'centroid varying vec3 vBeWorld;\n' +
    sh.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
        vec4 beW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          beW = instanceMatrix * beW;
        #endif
        vBeWorld = (modelMatrix * beW).xyz;`,
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
