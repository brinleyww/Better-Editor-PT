// Track culling for big tracks. Page only, loaded after tm_runtime.js (which makes self.TM); tools/patch.js calls it
// where the track builds its meshes. Stock PolyTrack draws each part type as one mesh over the whole track, so the
// camera never skips any of it; the new blocks are far heavier than stock ones (a road piece about 600 triangles, a
// bobsleigh piece 30 000), so a big track drew all of them every frame. Here each part type is split into spatial
// chunks the camera's view can leave out. With Low performance mode on (Not So Weekly Shorts passes it, nsws_prefs.js)
// parts drop their flat ground shadows (a second draw of every part) and, in a Test, chunks past VIEW are hidden as NSWS
// hides them.
self.TM = self.TM || {};
self.TM.cull = (() => {
  // Units: NSWS's Low performance mode draws the track out to 900.
  const VIEW = 900;
  // Chunk width in tiles, so most of a big track is outside a view.
  const SPAN = 32;
  let low = false;
  try {
    low = window.parent !== window && localStorage.getItem('be_low_performance') == '1';
  } catch {}

  // Parts per chunk: about 24 000 triangles, at least 32 parts (as NSWS).
  function perMesh(geometry) {
    const tris = (geometry.index != null ? geometry.index.count : geometry.attributes.position.count) / 3;
    return Math.max(32, Math.floor(24000 / Math.max(tris, 1)));
  }

  // Splits parts (x, y, z in tiles) into spatially compact groups of at most `max`, each no wider than SPAN tiles unless
  // it is down to a third of `max`: median splits on the longest axis.
  function split(parts, geometry) {
    const max = perMesh(geometry),
      out = [],
      a = parts.slice(),
      stack = [0, a.length];
    while (stack.length) {
      const hi = stack.pop(),
        lo = stack.pop();
      if (hi - lo <= max / 3) {
        out.push(a.slice(lo, hi));
        continue;
      }
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let i = lo; i < hi; i++) {
        const p = a[i];
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); z0 = Math.min(z0, p.z);
        x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); z1 = Math.max(z1, p.z);
      }
      if (hi - lo <= max && Math.max(x1 - x0, y1 - y0, z1 - z0) <= SPAN) {
        out.push(a.slice(lo, hi));
        continue;
      }
      const axis = x1 - x0 >= z1 - z0 && x1 - x0 >= y1 - y0 ? 'x' : z1 - z0 >= y1 - y0 ? 'z' : 'y',
        mid = (lo + hi) >> 1;
      select(a, lo, hi - 1, mid, axis);
      stack.push(lo, mid, mid, hi);
    }
    return out;
  }
  // Quickselect: a[k] ends up where a full sort by `axis` would put it, smaller ones before, larger after.
  function select(a, lo, hi, k, axis) {
    while (hi > lo) {
      const pivot = a[(lo + hi) >> 1][axis];
      let i = lo,
        j = hi;
      while (i <= j) {
        while (a[i][axis] < pivot) i++;
        while (a[j][axis] > pivot) j--;
        if (i <= j) {
          const t = a[i];
          a[i] = a[j];
          a[j] = t;
          i++;
          j--;
        }
      }
      if (k <= j) hi = j;
      else if (k >= i) lo = i;
      else return;
    }
  }

  // Low performance mode: while a Test drives, chunks wholly past VIEW from the camera are hidden before each render
  // (shadows included). The editor's own view keeps the whole track, or a zoomed-out big track would show nothing.
  let driving = false;
  function watchTests() {
    const tools = self.TM.tools;
    if (!tools?.testStart || tools.cullWatched) return;
    tools.cullWatched = true;
    const { testStart, testEnd } = tools;
    tools.testStart = function () {
      driving = true;
      return testStart.apply(this, arguments);
    };
    tools.testEnd = function () {
      driving = false;
      return testEnd.apply(this, arguments);
    };
  }
  const scenes = new WeakMap();
  function add(scene, mesh) {
    if (!low) return;
    watchTests();
    let set = scenes.get(scene);
    if (!set) {
      scenes.set(scene, (set = new Set()));
      let culled = false;
      const before = scene.onBeforeRender;
      scene.onBeforeRender = function (renderer, s, camera) {
        if (driving || culled) {
          const c = camera.matrixWorld.elements,
            cx = c[12],
            cy = c[13],
            cz = c[14];
          for (const m of set) {
            if (m.parent !== scene) {
              set.delete(m);
              continue;
            }
            if (m.boundingSphere == null) m.computeBoundingSphere();
            const b = m.boundingSphere;
            m.visible = !driving || Math.hypot(b.center.x - cx, b.center.y - cy, b.center.z - cz) - b.radius < VIEW;
          }
          culled = driving;
        }
        return before.apply(this, arguments);
      };
    }
    set.add(mesh);
  }

  // A flat ground shadow (the parts squashed onto the ground by the shadow mesh's own matrix, never skipped, so a big
  // track drew every part's shadow every frame) that the camera can skip: the squash goes into each instance, and its
  // bounds are the squashed corners of the parts' box.
  function flat(shadow, source) {
    const P = shadow.matrix.clone(),
      M = new P.constructor();
    for (let i = 0; i < shadow.count; i++) {
      shadow.getMatrixAt(i, M);
      shadow.setMatrixAt(i, M.premultiply(P));
    }
    shadow.instanceMatrix.needsUpdate = true;
    shadow.matrix.identity();
    shadow.matrixWorld.identity();
    shadow.update = () => {};
    source.computeBoundingBox();
    source.computeBoundingSphere();
    const b = source.boundingBox,
      e = P.elements,
      lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 8; k++) {
      const x = k & 1 ? b.max.x : b.min.x,
        y = k & 2 ? b.max.y : b.min.y,
        z = k & 4 ? b.max.z : b.min.z,
        w = e[3] * x + e[7] * y + e[11] * z + e[15];
      // The sun at or below the horizon: no finite shadow, so it stays drawn as before.
      if (!(w > 1e-6)) return;
      const p = [(e[0] * x + e[4] * y + e[8] * z + e[12]) / w, (e[1] * x + e[5] * y + e[9] * z + e[13]) / w, (e[2] * x + e[6] * y + e[10] * z + e[14]) / w];
      for (let j = 0; j < 3; j++) {
        lo[j] = Math.min(lo[j], p[j]);
        hi[j] = Math.max(hi[j], p[j]);
      }
    }
    const S = source.boundingSphere.constructor,
      V = source.boundingSphere.center.constructor;
    shadow.boundingSphere = new S(new V((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2), Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2);
    shadow.frustumCulled = true;
  }

  return { split, add, flat, get low() { return low; } };
})();
