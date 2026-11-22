// Applies every Better Editor change to the formatted bundles and writes the result to the repo root.
// Input: _original/formatted (from tools/deobfuscate.js). Each edit must match exactly once, or the build stops.
// Run: node tools/patch.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const from = path.join(root, '_original', 'formatted');
const to = root;

function apply(file, edits) {
  let s = fs.readFileSync(path.join(from, file), 'utf8');
  for (const [name, a, b] of edits) {
    const first = s.indexOf(a);
    if (first < 0) throw new Error(file + ': no match for "' + name + '"');
    if (s.indexOf(a, first + 1) >= 0) throw new Error(file + ': more than one match for "' + name + '"');
    s = s.slice(0, first) + b + s.slice(first + a.length);
  }
  fs.writeFileSync(path.join(to, file), s);
  console.log(file, edits.length, 'edits');
}

const G = '(0, R.gn)'; // the bundle's private-field getter in the app scope
// The new block categories in part.f order, from the block table (tm_parts.js). The game's PartCategory enum gets them as
// 9 + f, after its own 0-8. A table from before Dirt and Grass has no list; these five are what it had.
const FAMILIES = '(self.TM.data.families ?? ["Plastic", "Wood", "Stadium", "Ice", "Water"])';

apply('index.html', [
  ['load the block table first', '<script defer="defer" src="error_screen.bundle.js"></script>', '<script defer="defer" src="nsws_prefs.js"></script><script defer="defer" src="tm_parts.js"></script><script defer="defer" src="tm_runtime.js"></script><script defer="defer" src="tm_cull.js"></script><script defer="defer" src="tm_menu.js"></script><script defer="defer" src="tm_water.js"></script><script defer="defer" src="tm_vehicles.js"></script><script defer="defer" src="tm_hud.js"></script><script defer="defer" src="tm_tools.js"></script><script defer="defer" src="tm_assets.js"></script><script defer="defer" src="error_screen.bundle.js"></script>'],
  ['NSWS bridge', '<script defer="defer" src="main.bundle.js"></script>', '<script defer="defer" src="main.bundle.js"></script><script defer="defer" src="nsws_bridge.js"></script>'],
  // Not So Weekly Shorts' Cuppa Build Off: the finish guard (only does anything when NSWS asks, through nsws_bridge.js).
  ['NSWS cup guard', '<script defer="defer" src="nsws_bridge.js"></script>', '<script defer="defer" src="nsws_bridge.js"></script><script defer="defer" src="nsws_cup.js"></script>'],
  // Cuppa Build Off: watching another builder (nsws_watch.js, only does anything when NSWS asks).
  ['NSWS cup watch', '<script defer="defer" src="nsws_cup.js"></script>', '<script defer="defer" src="nsws_cup.js"></script><script defer="defer" src="nsws_watch.js"></script>'],
]);

apply('main.bundle.js', [
  // tm_cull.js: each part type in spatial chunks the camera can skip, and Low performance mode (from NSWS).
  ["track meshes in chunks", "              const l = new b.ZLX(n.geometry, n.material, o.length);\n              ((l.matrixAutoUpdate = !1),\n                (l.matrixWorldAutoUpdate = !1),\n                (l.frustumCulled = !1),\n                (l.castShadow = i),\n                (l.receiveShadow = !0));\n              for (let e = 0; e < o.length; ++e) l.setMatrixAt(e, o[e].matrix);\n              if (\n                ((0, v.gn)(this, r, \"f\").scene.add(l),\n                (0, v.gn)(this, p, \"f\").push({ trackPartId: e.configuration.id, color: t, mesh: l }),\n                null != a)\n              ) {\n                const n = new M.t(l, a);\n                (n.update(new b.Zcv(new b.Pq0(0, 1, 0), 0), s),\n                  (0, v.gn)(this, r, \"f\").scene.add(n),\n                  (0, v.gn)(this, p, \"f\").push({ trackPartId: e.configuration.id, color: t, mesh: n }));\n              }\n", "              // tm_cull.js: the parts in chunks the camera can skip; Low performance mode drops their flat shadows.\n              const all = o;\n              for (const o of self.TM.cull.split(all, n.geometry)) {\n                const l = new b.ZLX(n.geometry, n.material, o.length);\n                ((l.matrixAutoUpdate = !1),\n                  (l.matrixWorldAutoUpdate = !1),\n                  (l.frustumCulled = !0),\n                  (l.castShadow = i),\n                  (l.receiveShadow = !0));\n                for (let e = 0; e < o.length; ++e) l.setMatrixAt(e, o[e].matrix);\n                // Penalty grass tufts (TM.tufts): their own meshes, children of this one.\n                if (n.userData.tufts)\n                  self.TM.tufts.beside({ InstancedMesh: b.ZLX, Matrix4: b.kn4 }, (0, v.gn)(this, r, \"f\").scene, l, n.userData.tufts.geometry, n.userData.tufts.material);\n                if (\n                  ((0, v.gn)(this, r, \"f\").scene.add(l),\n                  self.TM.cull.add((0, v.gn)(this, r, \"f\").scene, l),\n                  (0, v.gn)(this, p, \"f\").push({ trackPartId: e.configuration.id, color: t, mesh: l }),\n                  null != a && !self.TM.cull.low)\n                ) {\n                  const n = new M.t(l, a);\n                  (n.update(new b.Zcv(new b.Pq0(0, 1, 0), 0), s),\n                    self.TM.cull.flat(n, l),\n                    (0, v.gn)(this, r, \"f\").scene.add(n),\n                    (0, v.gn)(this, p, \"f\").push({ trackPartId: e.configuration.id, color: t, mesh: n }));\n                }\n              }\n"],
  // A No engine plate: the throttle doesn't rev the engine or spin the wheels in the air (tm_hud.js knows the effects).
  ["no engine: no air wheel spin", "const { up: t, down: n } = this.getControls(),\n                    r = 2 == i || 3 == i;", "const noEngine = !!self.TM.hud?.of(this)?.noEngine,\n                    { up: t0, down: n0 } = this.getControls(),\n                    t = t0 && !noEngine,\n                    n = n0 && !(noEngine && !(0, l.gn)(this, te, \"f\").brakeLightEnabled),\n                    r = 2 == i || 3 == i;"],
  ["no engine: no engine sound", "{ up: i, down: r } = this.getControls(),\n                a =\n                  this.hasStarted() &&", "{ up: i, down: r } = this.getControls(),\n                a =\n                  !self.TM.hud?.of(this)?.noEngine &&\n                  this.hasStarted() &&"],
  // nsws_bridge.js starts the editor without the menu.
  ['no first-launch race when embedded', '              : this.isFirstSession()\n                ? { type: "tutorial" }', '              : this.isFirstSession() && window.parent === window\n                ? { type: "tutorial" }'],
  // tm_runtime.js gives each physics worker the page's copy of the block file, so none downloads it again.
  ['workers share the block file', '(0, r.GG)(this, h, new Worker("simulation_worker.bundle.js"), "f"),', '(0, r.GG)(this, h, new Worker("simulation_worker.bundle.js"), "f"),\n              self.TM.shareBlocks((0, r.gn)(this, h, "f")),'],
  ['editor starter', '            J = (t, i, a, c, h) => {', '            beStart = (self.__beStartEditor = Q),\n            J = (t, i, a, c, h) => {'],
  // tm_water.js: splashes and spray where a car meets water.
  ['water splashes know the track', '((0, l.GG)(this, ee, e.id, "f"), (0, l.GG)(this, te, e.carState, "f"));', '((0, l.GG)(this, ee, e.id, "f"), (0, l.GG)(this, te, e.carState, "f"), self.TM.water.track(this, h));'],
  ['water splashes each frame', '(0, l.gn)(this, Ne, "f")?.update(e),', '(0, l.gn)(this, Ne, "f")?.update(e),\n              self.TM.water.update(this, (0, l.gn)(this, ge, "f"), e, (0, l.gn)(this, te, "f"), c),\n              self.TM.tools.car(this, (0, l.gn)(this, te, "f")),'],
  ['water splashes end with the car', '(0, l.gn)(this, Ne, "f")?.dispose());', '(0, l.gn)(this, Ne, "f")?.dispose(),\n              self.TM.water.dispose(this));'],
  // tm_hud.js: the effect banner and wheel info follow every physics frame's state, for the car the speedometer shows.
  ['HUD sees every car state', '(0, l.GG)(this, te, e, "f");\n            const i = 0.001;', '(0, l.GG)(this, te, e, "f");\n            self.TM.hud.state(this, e);\n            const i = 0.001;'],
  ['HUD follows the player', '(0, R.gn)(this, Sa, "f").update((0, R.gn)(this, Fa, "f").getSpeedKmh()),', '(0, R.gn)(this, Sa, "f").update((0, R.gn)(this, Fa, "f").getSpeedKmh()),\n            self.TM.hud.focus((0, R.gn)(this, Fa, "f")),'],
  ['HUD follows the watched replay', '(0, R.gn)(this, ng, "f").update(i.car));', '(0, R.gn)(this, ng, "f").update(i.car),\n                  self.TM.hud.focus(i.car));'],
  ['HUD follows the watched replay while it plays', '(0, R.gn)(this, ng, "f").update(s.car));', '(0, R.gn)(this, ng, "f").update(s.car),\n            self.TM.hud.focus(s.car));'],
  // A real game setting (saved by name with the others), Off by default, shown under Speedometer.
  ['Wheel info setting', '(e[(e.TouchSteeringSide = 23)] = "TouchSteeringSide"));', '(e[(e.TouchSteeringSide = 23)] = "TouchSteeringSide"),\n              (e[(e.WheelInfo = 24)] = "WheelInfo"),\n              (e[(e.WheelInfoScale = 25)] = "WheelInfoScale"));'],
  ['Wheel info default', '[P.A.TouchSteeringSide, "true"],', '[P.A.TouchSteeringSide, "true"],\n            [P.A.WheelInfo, "false"],\n            [P.A.WheelInfoScale, "auto"],'],
  [
    'Wheel info in the settings menu',
    `              P.A.Speedometer,
            ),
            (0, R.gn)(this, zs, "m", ro).call(this, Ns.getFromLanguage((0, R.gn)(this, Js, "f"), "Mobile")),`,
    `              P.A.Speedometer,
            ),
            (0, R.gn)(this, zs, "m", ao).call(
              this,
              "Wheel info",
              [
                { title: Ns.getFromLanguage((0, R.gn)(this, Js, "f"), "Off"), value: "false" },
                { title: Ns.getFromLanguage((0, R.gn)(this, Js, "f"), "On"), value: "true" },
              ],
              P.A.WheelInfo,
            ),
            (0, R.gn)(this, zs, "m", ao).call(
              this,
              "Wheel info size",
              [
                { title: "Speedometer width", value: "auto" },
                { title: "25%", value: "0.25" },
                { title: "50%", value: "0.5" },
                { title: "75%", value: "0.75" },
                { title: "100%", value: "1" },
                { title: "125%", value: "1.25" },
                { title: "150%", value: "1.5" },
              ],
              P.A.WheelInfoScale,
            ),
            (0, R.gn)(this, zs, "m", ro).call(this, Ns.getFromLanguage((0, R.gn)(this, Js, "f"), "Mobile")),`,
  ],
  [
    'Wheel info reaches the HUD',
    `            (0, R.gn)(this, cf, "f").set(t, n);
          }
        }`,
    `            (0, R.gn)(this, cf, "f").set(t, n);
          }
          self.TM.hud.setWheels(this.getSettingBoolean(P.A.WheelInfo));
          self.TM.hud.setWheelsSize?.(this.getSettingFloat(P.A.WheelInfoScale));
        }`,
  ],
  ['part ids', '(e[(e.PlaneCorner = 189)] = "PlaneCorner"));', '(e[(e.PlaneCorner = 189)] = "PlaneCorner"),\n              self.TM.addEnum(e));'],
  ['single instance check off when embedded', 'if (void 0 !== window.BroadcastChannel) {', 'if (void 0 !== window.BroadcastChannel && window.parent === window) {'],
  // nsws_bridge.js imports tracks through the saved-track store and the track codec.
  ['settings hook', "          const t = e.loadSettings();\n          null != t && this.updateSettings(t);\n", "          const t = e.loadSettings();\n          null != t && this.updateSettings(t);\n          self.__beSettings = { manager: this, names: P.A };\n"],
  ['track store hook', '(Bd.add(this),', '(Bd.add(this),\n            (self.__beTrackStore = this),\n            (self.__beTrackData = Ml.A),'],
  // Embedded in Not So Weekly Shorts, the custom track list is NSWS's My Tracks (nsws_bridge.js library mode): it tells
  // the track lists when that list changed, deletes the very track picked (names needn't be unique there) and saves an
  // imported code as a new track, never over the one open in the editor.
  ['track store: changed', '(self.__beTrackData = Ml.A),', '(self.__beTrackData = Ml.A),\n            (self.__beTracksChanged = () => (0, R.gn)(this, Bd, "m", Jd).call(this)),'],
  ['track list: delete this track', '? (0, i.gn)(this, S, "f").deleteCustomTrack(t.name)\n', '? (0, i.gn)(this, S, "f").deleteCustomTrack(t.name, t)\n'],
  ['track list: delete this track after asking', '((0, i.gn)(this, S, "f").deleteCustomTrack(t.name), this.show());', '((0, i.gn)(this, S, "f").deleteCustomTrack(t.name, t), this.show());'],
  ['track info: delete this track', '(p.deleteCustomTrack(l.name), g());', '(p.deleteCustomTrack(l.name, l), g());'],
  ['import saves a new track (overwrite)', '(s.saveCustomTrack(e, a)\n                                      ? i.push({', '(s.saveCustomTrack(e, a, "import")\n                                      ? i.push({'],
  ['import saves a new track', ': (s.saveCustomTrack(e, a)\n                                  ? i.push({ trackMetadata', ': (s.saveCustomTrack(e, a, "import")\n                                  ? i.push({ trackMetadata'],
  ['categories', '(e[(e.Sign = 8)] = "Sign"));', `(e[(e.Sign = 8)] = "Sign"),\n              ${FAMILIES}.forEach((n, f) => (e[(e[n] = 9 + f)] = n)));`],
  [
    'part class',
    `constructor(e, t, n, i, r, a, s = null, o = null) {
            const c = [];
            for (const [e, t] of a)
              for (let n = e[0]; n <= t[0]; n++)
                for (let i = e[1]; i <= t[1]; i++)
                  for (let r = e[2]; r <= t[2]; r++) {
                    if (null != c.find(([e, t, a]) => e == n && t == i && a == r))
                      throw new Error("Duplicate tile in track part");
                    c.push([n, i, r]);
                  }`,
    `constructor(e, t, n, i, r, a, s = null, o = null, tm = null) {
            const c = [],
              seen = new Set();
            for (const [e, t] of a)
              for (let n = e[0]; n <= t[0]; n++)
                for (let i = e[1]; i <= t[1]; i++)
                  for (let r = e[2]; r <= t[2]; r++) {
                    const key = n + "|" + i + "|" + r;
                    if (seen.has(key)) throw new Error("Duplicate tile in track part");
                    (seen.add(key), c.push([n, i, r]));
                  }`,
  ],
  ['part class tm field', '(this.startOffset = o),\n              Object.freeze(this));', '(this.startOffset = o),\n              (this.tm = tm),\n              Object.freeze(this));'],
  [
    'register new parts',
    `],
          f = new Map();
        for (const e of u) {`,
    `].concat(
            self.TM.parts.map(
              (q) =>
                new d(
                  null,
                  r.A[${FAMILIES}[q.f]],
                  q.i,
                  [],
                  self.TM.palette(q) ?? self.TM.data.palettes[0],
                  q.c,
                  q.d ?? null,
                  q.o ? new i.Pq0(q.o[0], q.o[1], q.o[2]) : null,
                  q,
                ),
            ),
          ),
          f = new Map();
        for (const e of u) {`,
  ],
  [
    'lazy meshes for new parts',
    '      class ou {\n        constructor() {\n          (Yd.add(this), Zd.set(this, new Map()), $d.set(this, new Map()));',
    `      // New blocks build their mesh the first time a colour is asked for, so 886 blocks do not cost 886 x 12 meshes at startup.
      class TMColors extends Map {
        constructor(cfg, material, tuftMaterial) {
          super();
          this.cfg = cfg;
          this.material = material;
          this.tuftMaterial = tuftMaterial;
          for (const { id: e } of cfg.colors) super.set(e, null);
        }
        get(id) {
          const have = super.get(id);
          if (null != have || !super.has(id)) return have;
          const slot = this.cfg.colors.find((e) => e.id == id),
            rgb = (e) => {
              const t = new M.Q1f(e);
              return [t.r, t.g, t.b];
            },
            // Penalty grass tufts are drawn apart from the part (tm_runtime.js TM.tufts), beside each of the track's meshes.
            { pos: e, col: t, groups: g } = self.TM.renderArrays(this.cfg.id, slot.colors, rgb, null != this.tuftMaterial),
            n = new M.LoY();
          (n.setAttribute("position", new M.THS(e, 3)), n.setAttribute("color", new M.THS(t, 3)), n.computeVertexNormals());
          // Water gets its own see-through material (tm_water.js); merging keeps the vertex order, so the ranges still hold.
          const q = nu.ec(n);
          if (g) for (const [s, c, k] of g) q.addGroup(s, c, k);
          const i = new M.eaF(q, g ? [this.material, self.TM.water.material(M)] : this.material);
          if (null != this.tuftMaterial)
            i.userData.tufts = {
              geometry: self.TM.tufts.geometry({ BufferGeometry: M.LoY, BufferAttribute: M.THS }, this.cfg.id, slot.colors, rgb),
              material: this.tuftMaterial,
            };
          return (super.set(id, i), i);
        }
      }
      class ou {
        constructor() {
          (Yd.add(this), Zd.set(this, new Map()), $d.set(this, new Map()));`,
  ],
  // The penalty grass tufts' own material (tm_runtime.js TM.tufts), registered like the parts' for the track's shadows.
  [
    'grass tuft material',
    'const a = new M.G_z({ vertexColors: !0 });\n          e.addMaterial(a);',
    'const a = new M.G_z({ vertexColors: !0 });\n          e.addMaterial(a);\n          const tuftMaterial = self.TM.tufts ? self.TM.tufts.material(new M.G_z({ vertexColors: !0 })) : null;\n          null != tuftMaterial && e.addMaterial(tuftMaterial);',
  ],
  ['use lazy meshes', 'colors: new Map(e.colors.map(({ id: e }) => [e, null])),', 'colors: e.tm ? new TMColors(e, a, tuftMaterial) : new Map(e.colors.map(({ id: e }) => [e, null])),'],
  [
    'skip glb lookup for new parts',
    `(0, R.gn)(this, Zd, "f").set(e.id, t);
              const r = await i;`,
    `(0, R.gn)(this, Zd, "f").set(e.id, t);
              if (e.tm) return (await self.TM.load(), void n.loadedResource());
              const r = await i;`,
  ],
  [
    'physics part list',
    `for (const { configuration: t, physicsShapeVertices: n } of (0, R.gn)(this, Zd, "f").values()) {
            if (null == n) throw new Error("Part model has not been loaded yet");`,
    `for (const q of self.TM.proxyConfigs()) e.push(q);
          for (const { configuration: t, physicsShapeVertices: n } of (0, R.gn)(this, Zd, "f").values()) {
            if (t.tm) continue;
            if (null == n) throw new Error("Part model has not been loaded yet");`,
  ],
  [
    'checksum check only covers stock parts',
    `for (const n of e) {
            const e = (0, R.gn)(this, Zd, "f").get(n);
            if (null == e) throw new Error("Part with id " + n.toString() + " does not exist");`,
    `for (const n of e) {
            if (self.TM.isTM(n)) continue;
            const e = (0, R.gn)(this, Zd, "f").get(n);
            if (null == e) throw new Error("Part with id " + n.toString() + " does not exist");`,
  ],
  [
    'category thumbnails',
    `case ru.A.Sign:
              n = this.getPart(iu.A.SignArrowLeft);`,
    `case ru.A.Sign:
              n = this.getPart(iu.A.SignArrowLeft);
              break;
            case ru.A.Plastic:
              n = this.getPart(iu.A.PlasticRoadCurve2);
              break;
            case ru.A.Wood:
              n = this.getPart(iu.A.WoodRoadCurve2);
              break;
            case ru.A.Stadium:
              n = this.getPart(iu.A.StadiumGrassMound);
              break;
            case ru.A.Ice:
              n = this.getPart(iu.A.IceBobCurve2);
              break;
            case ru.A.Water:
              n = this.getPart(iu.A.StadiumWaterCorner);
              break;
            // The first of these the block table has, so the icon still draws while a kit lacks its usual piece.
            case ru.A.Dirt:
              n = this.getPart(iu.A.DirtRoadCurve2 ?? iu.A.DirtOpenCurve2 ?? iu.A.DirtPlatBase ?? iu.A.PlasticRoadCurve2);
              break;
            case ru.A.Grass:
              n = this.getPart(iu.A.GrassPlatBase ?? iu.A.GrassPlatRound ?? iu.A.GrassRoadCurve2 ?? iu.A.StadiumGrassMound);`,
  ],
  [
    'codec context',
    '        const M = class {\n          constructor(e, t) {\n            (i.add(this),\n              r.set(this, null),',
    `        const tmCtx = () => ({
          pako: u.Ay,
          fromBase62: g.D,
          create: (e, t) => new M(e, new (n(7929).A)(t)),
          environments: k.A,
          partIds: n(494).A,
          axes: n(7781).A,
          colors: n(2498).A,
          checkpointIds: T.bK,
          startIds: T.l1,
        });
        const M = class {
          hasExtendedParts() {
            return (0, d.gn)(this, o, "f").some((e) => e > 255);
          }
          constructor(e, t) {
            (i.add(this),
              r.set(this, null),`,
  ],
  [
    'binary: catalogue version',
    '              255 & (g | (m << 2) | (A << 4)),\n            );',
    `              255 & (g | (m << 2) | (A << 4)),
            );
            const tmExt = this.hasExtendedParts();
            tmExt && e.push(255 & self.TM.version, (self.TM.version >>> 8) & 255);`,
  ],
  ['binary: id range', 'if (r < 0 || r > 255) throw new Error("Part id is out of range");', 'if (r < 0 || r > 65535) throw new Error("Part id is out of range");'],
  [
    'binary: two byte ids',
    'e.push(255 & r, 255 & s, (s >>> 8) & 255, (s >>> 16) & 255, (s >>> 24) & 255);',
    `tmExt
                ? e.push(255 & r, (r >>> 8) & 255, 255 & s, (s >>> 8) & 255, (s >>> 16) & 255, (s >>> 24) & 255)
                : e.push(255 & r, 255 & s, (s >>> 8) & 255, (s >>> 16) & 255, (s >>> 24) & 255);`,
  ],
  [
    'track id bookkeeping',
    `(0, d.gn)(this, r, "f") ?? (0, f.sha256)((0, d.gn)(this, i, "m", h).call(this)),
                "f",
              ),
              (0, d.gn)(this, r, "f")`,
    `(0, d.gn)(this, r, "f") ?? (0, f.sha256)((0, d.gn)(this, i, "m", h).call(this)),
                "f",
              ),
              this.hasExtendedParts() && self.TM.extTrackIds.add((0, d.gn)(this, r, "f")),
              (0, d.gn)(this, r, "f")`,
  ],
  ['save string', 'return (r.push(n, !0), g.l(r.result));', 'return (r.push(n, !0), (this.hasExtendedParts() ? self.TM.SAVE_PREFIX : "") + g.l(r.result));'],
  [
    // A preload only warms the cache, and the page loads the image again where it is drawn. One failed request (a
    // flaky connection, GitHub Pages mid-deploy) used to throw and take the whole game down: retry, then carry on.
    'image preload retries',
    `            t.addEventListener("error", () => {
              throw (this.loadedResource(), new Error("Failed to load image: " + e));
            }),`,
    `            t.addEventListener("error", () => {
              const n = (t.tries = (t.tries ?? 0) + 1);
              if (n <= 3) return void setTimeout(() => (t.src = e + (e.includes("?") ? "&" : "?") + "retry=" + n), 500 * n);
              console.warn("Failed to load image: " + e);
              this.loadedResource();
            }),`,
  ],
  ['export string', 'return (f.push(c, !0), "PolyTrack2" + g.l(f.result));', 'return (f.push(c, !0), (this.hasExtendedParts() ? self.TM.EXPORT_PREFIX : "PolyTrack2") + g.l(f.result));'],
  [
    'read save string',
    `static fromSaveString(e) {
            const t = w._(e);`,
    `static fromSaveString(e) {
            const tm = self.TM.fromSave(e, tmCtx());
            if (null != tm) return tm;
            const t = w._(e);`,
  ],
  [
    'read export string',
    `const t = e.replace(/\\s+/g, ""),
              n = w.U(t);`,
    `const t = e.replace(/\\s+/g, ""),
              tm = self.TM.fromExport(t, tmCtx());
            if (null != tm) return tm;
            const n = w.U(t);`,
  ],
  [
    'never upload extended tracks to the official leaderboard',
    `if ((0, R.gn)(this, Rd, "f").determinismState != mo.Ok) return null;
          const a = (0, R.gn)(this, Pd, "f").getUserProfile(e);`,
    `if ((0, R.gn)(this, Rd, "f").determinismState != mo.Ok) return null;
          if (self.TM.extTrackIds.has(t)) return null;
          const a = (0, R.gn)(this, Pd, "f").getUserProfile(e);`,
  ],
  [
    'full rebuild only visits placed parts',
    `for (const e of (0, v.gn)(this, s, "f").getAllParts())
                for (const n of e.colors.keys()) (0, v.gn)(this, i, "m", A).call(this, e, n, t, h, c, l);`,
    `{
                const placed = this.__tmPlacedParts();
                for (const e of (0, v.gn)(this, s, "f").getAllParts())
                  if (placed.has(e))
                    for (const n of e.colors.keys()) (0, v.gn)(this, i, "m", A).call(this, e, n, t, h, c, l);
              }`,
  ],
  [
    'placed parts helper',
    `setPart(e, t, n, i, r, a, o, d, f) {
            const p = (0, v.gn)(this, s, "f").getPart(i);`,
    `__tmPlacedParts() {
            return new Set((0, v.gn)(this, l, "f").map((e) => e.trackPartData));
          }
          // Changes whenever anything a track code holds changes, so an unchanged track is not compressed again
          // (self.__beEditorCurrent). Parts only change through setPart, clear and the removal helper, which count edits.
          __beSig() {
            const sun = (0, v.gn)(this, o, "f");
            return this.environment + "|" + sun.x + "," + sun.y + "," + sun.z + "|" + (this.__beEdits ?? 0) + "|" + (0, v.gn)(this, l, "f").length;
          }
          setPart(e, t, n, i, r, a, o, d, f) {
            this.__beEdits = (this.__beEdits ?? 0) + 1;
            const p = (0, v.gn)(this, s, "f").getPart(i);`,
  ],
  [
    'edit count: clear',
    `clear() {
            (((0, v.gn)(this, l, "f").length = 0),`,
    `clear() {
            ((this.__beEdits = (this.__beEdits ?? 0) + 1),
              ((0, v.gn)(this, l, "f").length = 0),`,
  ],
  [
    'edit count: part removed',
    `(g = function (e) {
            if (e < 0 || e >= (0, v.gn)(this, l, "f").length)
              throw new Error("Track part index out of bounds");`,
    `(g = function (e) {
            if (e < 0 || e >= (0, v.gn)(this, l, "f").length)
              throw new Error("Track part index out of bounds");
            this.__beEdits = (this.__beEdits ?? 0) + 1;`,
  ],
  // nsws_cup.js reads the placed parts (tiles, road ends, starts and finishes) without building a TrackData.
  ['placed parts list', '__tmPlacedParts() {', '__bePlaced() {\n            return (0, v.gn)(this, l, "f");\n          }\n          __tmPlacedParts() {'],
  // The fine grid: a track with parts on half steps (only ours, never stock parts) writes every position in half steps and says so in the byte widths (tm_runtime.js HALF_STEPS).
  ["fine grid: code writer scale", "            for (const [, e] of (0, d.gn)(this, l, \"f\"))\n              for (const a of e)\n                ((t = Math.min(a.x, t)),\n                  (n = Math.min(a.y, n)),\n                  (i = Math.min(a.z, i)),\n                  (r = Math.max(a.x, r)),\n                  (c = Math.max(a.y, c)),\n                  (h = Math.max(a.z, h)));", "            const tmK = this.hasExtendedParts() && self.TM.halfSteps(this) ? 2 : 1;\n            for (const [, e] of (0, d.gn)(this, l, \"f\"))\n              for (const a of e)\n                ((t = Math.min(a.x * tmK, t)),\n                  (n = Math.min(a.y * tmK, n)),\n                  (i = Math.min(a.z * tmK, i)),\n                  (r = Math.max(a.x * tmK, r)),\n                  (c = Math.max(a.y * tmK, c)),\n                  (h = Math.max(a.z * tmK, h)));"],
  ["fine grid: code writer flag", "              255 & (g | (m << 2) | (A << 4)),\n            );\n            const tmExt", "              255 & (g | (m << 2) | (A << 4) | (2 == tmK ? self.TM.HALF_STEPS : 0)),\n            );\n            const tmExt"],
  ["fine grid: code writer positions", "                const a = s.x - t,\n                  o = s.y - n,\n                  l = s.z - i;", "                const a = s.x * tmK - t,\n                  o = s.y * tmK - n,\n                  l = s.z * tmK - i;"],
  // The fine grid: a part on half steps is filed under every whole tile cell it overlaps, so the eraser, picking and overlap checks find it.
  ["fine grid: part grid keys", "            p.configuration.tiles.rotated(r, a).forEach((i, r, a) => {\n              const s = (e + i).toString() + \"|\" + (t + r).toString() + \"|\" + (n + a).toString();\n              if (t + r < 0) throw new Error(\"Track part below ground\");\n              {\n                const e = (0, v.gn)(this, c, \"f\").get(s);\n                null == e ? (0, v.gn)(this, c, \"f\").set(s, [y]) : e.push(y);\n              }\n            });", "            const beKeys = new Set();\n            p.configuration.tiles.rotated(r, a).forEach((i, r, a) => {\n              if (t + r < 0) throw new Error(\"Track part below ground\");\n              for (const s of self.TM.tileKeys(e + i, t + r, n + a)) beKeys.add(s);\n            });\n            for (const s of beKeys) {\n              const e = (0, v.gn)(this, c, \"f\").get(s);\n              null == e ? (0, v.gn)(this, c, \"f\").set(s, [y]) : e.push(y);\n            }"],
  ["fine grid: part grid removal", "            t.trackPartData.configuration.tiles.rotated(t.rotation, t.rotationAxis).forEach((e, n, i) => {\n              const r = (t.x + e).toString() + \"|\" + (t.y + n).toString() + \"|\" + (t.z + i).toString(),\n                a = (0, v.gn)(this, c, \"f\").get(r);\n              if (null == a) throw new Error(\"Track part section missing\");\n              {\n                const e = a.indexOf(t);\n                if (!(e >= 0)) throw new Error(\"Track part missing from parts by position map\");\n                (a.splice(e, 1), 0 == a.length && (0, v.gn)(this, c, \"f\").delete(r));\n              }\n            });", "            const beKeys = new Set();\n            t.trackPartData.configuration.tiles.rotated(t.rotation, t.rotationAxis).forEach((e, n, i) => {\n              for (const r of self.TM.tileKeys(t.x + e, t.y + n, t.z + i)) beKeys.add(r);\n            });\n            for (const r of beKeys) {\n              const a = (0, v.gn)(this, c, \"f\").get(r);\n              if (null == a) throw new Error(\"Track part section missing\");\n              {\n                const e = a.indexOf(t);\n                if (!(e >= 0)) throw new Error(\"Track part missing from parts by position map\");\n                (a.splice(e, 1), 0 == a.length && (0, v.gn)(this, c, \"f\").delete(r));\n              }\n            }"],
  ["fine grid: parts within a box", "                s.trackPartData.configuration.tiles.rotated(s.rotation, s.rotationAxis).some((o, l, c) => {\n                  const h = s.x + o,\n                    d = s.y + l,\n                    u = s.z + c;\n                  return h >= e && h <= i && d >= t && d <= r && u >= n && u <= a;\n                }),", "                s.trackPartData.configuration.tiles.rotated(s.rotation, s.rotationAxis).some((o, l, c) =>\n                  self.TM.tileInBox(s.x + o, s.y + l, s.z + c, e, t, n, i, r, a),\n                ),"],
  ["fine grid: delete parts within a box", "              h.trackPartData.configuration.tiles.rotated(h.rotation, h.rotationAxis).some((i, o, l) => {\n                const c = h.x + i,\n                  d = h.y + o,\n                  u = h.z + l;\n                return c >= e && c <= r && d >= t && d <= a && u >= n && u <= s;\n              }) &&", "              h.trackPartData.configuration.tiles.rotated(h.rotation, h.rotationAxis).some((i, o, l) =>\n                self.TM.tileInBox(h.x + i, h.y + o, h.z + l, e, t, n, r, a, s),\n              ) &&"],
]);

apply('112.bundle.js', [
  // Track settings: Clear all and restart, asking whether to save the current track first.
  ["track settings: clear argument", "        constructor(t, e, n, s, o, a, r, h) {\n          (zt.set(this, void 0), Nt.set(this, void 0), St.set(this, null), Tt.set(this, void 0));", "        constructor(t, e, n, s, o, a, r, h, clear = null) {\n          (zt.set(this, void 0), Nt.set(this, void 0), St.set(this, null), Tt.set(this, void 0));"],
  ["track settings: clear button", "              L.appendChild((0, i.gn)(this, St, \"f\"))),\n            window.addEventListener(", "              L.appendChild((0, i.gn)(this, St, \"f\"))),\n            null != clear &&\n              (() => {\n                // Clear all and restart: a new, unnamed track, after asking whether to save this one first.\n                const row = document.createElement(\"div\");\n                ((row.className = \"button-wrapper\"), d.appendChild(row));\n                const button = (parent, icon, text, onClick, disabled = !1) => {\n                  const b = document.createElement(\"button\");\n                  ((b.className = \"button\"),\n                    (b.disabled = disabled),\n                    (b.innerHTML = '<img class=\"button-icon\" src=\"images/' + icon + '\"> '),\n                    b.append(document.createTextNode(text)),\n                    b.addEventListener(\"click\", () => {\n                      (t.playUIClick(), onClick());\n                    }),\n                    parent.appendChild(b));\n                };\n                button(row, \"delete.svg\", \"Clear all and restart\", () => {\n                  const name = m.value.trim(),\n                    shown = [f, L, row];\n                  for (const el of shown) el.style.display = \"none\";\n                  const ask = document.createElement(\"section\");\n                  ((ask.className = \"content\"), d.appendChild(ask));\n                  const box = document.createElement(\"div\");\n                  ((box.className = \"setting\"), ask.appendChild(box));\n                  const title = document.createElement(\"label\");\n                  ((title.className = \"title\"),\n                    (title.textContent = \"Do you want to save the current track before everything is cleared?\"),\n                    box.appendChild(title));\n                  if (name.length == 0) {\n                    const hint = document.createElement(\"p\");\n                    ((hint.textContent = \"Give it a track name first to save it.\"),\n                      (hint.style.cssText = \"margin: 10px 0 0; font-size: 24px; color: var(--text-color); opacity: 0.6\"),\n                      box.appendChild(hint));\n                  }\n                  const buttons = document.createElement(\"div\");\n                  ((buttons.className = \"button-wrapper\"), d.appendChild(buttons));\n                  // Every button after the first floats right, so Save ends up rightmost.\n                  (button(buttons, \"cancel.svg\", e.get(\"Cancel\"), () => {\n                    (ask.remove(), buttons.remove());\n                    for (const el of shown) el.style.display = \"\";\n                  }),\n                    button(buttons, \"save.svg\", e.get(\"Save\"), () => clear(name, s), name.length == 0),\n                    button(buttons, \"delete.svg\", \"Don't save\", () => clear(null, s)));\n                });\n              })(),\n            window.addEventListener("],
  ["track settings: clear in the editor", "                    (t, e) => {\n                      ((0, i.gn)(this, Kt, \"m\", Bn).call(this, t),\n                        (0, i.gn)(this, Kt, \"m\", _n).call(this, e),\n                        (0, i.gn)(this, ye, \"f\")?.dispose(),\n                        (0, i.GG)(this, ye, null, \"f\"),\n                        ((0, i.gn)(this, re, \"f\").className = \"editor-ui\"));\n                    },\n                    null,\n                  ),", "                    (t, e) => {\n                      ((0, i.gn)(this, Kt, \"m\", Bn).call(this, t),\n                        (0, i.gn)(this, Kt, \"m\", _n).call(this, e),\n                        (0, i.gn)(this, ye, \"f\")?.dispose(),\n                        (0, i.GG)(this, ye, null, \"f\"),\n                        ((0, i.gn)(this, re, \"f\").className = \"editor-ui\"));\n                    },\n                    null,\n                    (name, env) => {\n                      const before = (0, i.gn)(this, un, \"f\");\n                      ((0, i.gn)(this, ye, \"f\")?.dispose(),\n                        (0, i.GG)(this, ye, null, \"f\"),\n                        ((0, i.gn)(this, re, \"f\").className = \"editor-ui\"));\n                      if (null == name) return void self.__beStartEditor();\n                      ((0, i.gn)(this, Kt, \"m\", Bn).call(this, name), (0, i.gn)(this, Kt, \"m\", _n).call(this, env));\n                      const save = () => {\n                        (0, i.gn)(this, $t, \"f\").saveCustomTrack(\n                          { name, author: (0, i.gn)(this, mn, \"f\"), lastModified: (0, i.gn)(this, vn, \"f\") },\n                          (0, i.gn)(this, jt, \"f\").getTrackData(),\n                        )\n                          ? ((0, i.gn)(this, te, \"f\").tryActivatePersistentStorage(), self.__beStartEditor())\n                          : (0, i.gn)(this, Kt, \"m\", Yn).call(this, (0, i.gn)(this, Vt, \"f\").get(\"Failed to save!\"), !1);\n                      };\n                      name !== before && (0, i.gn)(this, $t, \"f\").checkCustomTrackNameExists(name)\n                        ? (((0, i.gn)(this, re, \"f\").inert = !0),\n                          (0, i.gn)(this, ne, \"f\").showConfirm(\n                            (0, i.gn)(this, Vt, \"f\").get('Are you sure you want to overwrite \"{0}\"?', [name]),\n                            (0, i.gn)(this, Vt, \"f\").get(\"Cancel\"),\n                            (0, i.gn)(this, Vt, \"f\").get(\"Confirm\"),\n                            () => {\n                              (0, i.gn)(this, re, \"f\").inert = !1;\n                            },\n                            () => {\n                              (((0, i.gn)(this, re, \"f\").inert = !1), save());\n                            },\n                          ))\n                        : save();\n                    },\n                  ),"],
  // tm_tools.js: the driving line and test runs panel, and unsaved-work recovery.
  [
    'editor tools open with the editor and follow each test',
    `h.setCamera((0, i.gn)(this, bi, "f").camera),
            (0, i.gn)(this, bi, "f").setTestCallback(() => {
              (0, i.gn)(this, bi, "f").disable();
              const t = (0, i.gn)(this, bi, "f").getTrackMetadata();
              v(t, (0, i.gn)(this, pi, "f").getTrackData(), () => {
                ((0, i.gn)(this, bi, "f").enable(), h.setCamera((0, i.gn)(this, bi, "f").camera));
              });
            }));`,
    `h.setCamera((0, i.gn)(this, bi, "f").camera),
            self.TM.tools.open(h, w, () => (0, i.gn)(this, bi, "f")?.camera, (t, e, n) => (0, i.gn)(this, bi, "f")?.beLook(t, e, n)),
            (0, i.gn)(this, bi, "f").setTestCallback(() => {
              (0, i.gn)(this, bi, "f").disable();
              self.TM.tools.testStart((0, i.gn)(this, pi, "f"));
              const t = (0, i.gn)(this, bi, "f").getTrackMetadata();
              v(t, (0, i.gn)(this, pi, "f").getTrackData(), () => {
                ((0, i.gn)(this, bi, "f").enable(), h.setCamera((0, i.gn)(this, bi, "f").camera), self.TM.tools.testEnd());
              });
            }));`,
  ],
  // tm_tools.js moves the camera to a point (the end of a test run) without changing the editing height.
  [
    'editor camera look',
    '        resetView(t, e, n) {',
    `        beLook(t, e, n) {
          const s = new w.Pq0(t, e, n),
            o = (0, i.gn)(this, qe, "f").position.clone().sub((0, i.gn)(this, De, "f").target);
          ((0, i.gn)(this, qe, "f").position.copy(s).add(o), (0, i.gn)(this, De, "f").target.copy(s), (0, i.gn)(this, De, "f").update());
        }
        resetView(t, e, n) {`,
  ],
  ['editor tools close with the editor', 'dispose() {\n          ((0, i.gn)(this, bi, "f").dispose(), (0, i.gn)(this, pi, "f").clear());', 'dispose() {\n          (self.TM.tools.close(), (0, i.gn)(this, bi, "f").dispose(), (0, i.gn)(this, pi, "f").clear());'],
  // nsws_bridge.js opens saved tracks straight into the editor.
  ['exit goes back to NSWS when embedded', '        (Un = function (t) {\n          const e = () => {', '        (Un = function (t) {\n          if (self.__beExitHook?.()) return;\n          const e = () => {'],
  ['editor test hook and current track', '            x.addEventListener("click", () => {\n              ((0, i.gn)(this, Ft, "f").playUIClick(), (0, i.gn)(this, Kt, "m", Hn).call(this));\n            }),\n            k.appendChild(x));', '            x.addEventListener("click", () => {\n              ((0, i.gn)(this, Ft, "f").playUIClick(), self.__beTestHook?.() || (0, i.gn)(this, Kt, "m", Hn).call(this));\n            }),\n            k.appendChild(x),\n            (self.__beEditorCurrent = () => {\n              const t = (0, i.gn)(this, un, "f"),\n                e = { name: t ?? "Unnamed Track", author: (0, i.gn)(this, mn, "f"), lastModified: (0, i.gn)(this, vn, "f") },\n                // NSWS asks for the open track every few seconds and compressing a big one takes tens of ms (a stutter while\n                // editing or driving a Test), so the code is made again only when the track or its details changed.\n                key = (0, i.gn)(this, jt, "f").__beSig() + "|" + e.name + "|" + (e.author ?? "") + "|" + (e.lastModified?.getTime() ?? ""),\n                c = self.__beCurrentCode;\n              return (\n                c?.key !== key && (self.__beCurrentCode = { key, code: (0, i.gn)(this, jt, "f").getTrackData().toExportString(e) }),\n                { name: t, author: e.author, code: self.__beCurrentCode.code }\n              );\n            }));'],
  ['editor track loader', '                "cancel",\n                !0,\n                () => {\n                  (((0, i.gn)(this, re, "f").className = "editor-ui"), (0, i.gn)(this, we, "f").hide());\n                },\n                (t, e, n) => {', '                "cancel",\n                !0,\n                () => {\n                  (((0, i.gn)(this, re, "f").className = "editor-ui"), (0, i.gn)(this, we, "f").hide());\n                },\n                (self.__beEditorOpen = (t, e, n) => {'],
  ['editor track loader end', '                      .finally(() => {\n                        ((0, i.gn)(this, be, "f")?.dispose(), (0, i.GG)(this, be, null, "f"));\n                      }));\n                },\n              ),\n              "f",', '                      .finally(() => {\n                        ((0, i.gn)(this, be, "f")?.dispose(), (0, i.GG)(this, be, null, "f"));\n                      }));\n                }),\n              ),\n              "f",'],
  // nsws_bridge.js autosave: saves the open track under its name when it has unsaved changes.
  ['autosave hook', '            (0, i.GG)(this, vn, new Date(), "f"),\n            (0, i.GG)(this, Ye, !1, "f"));', '            (0, i.GG)(this, vn, new Date(), "f"),\n            (0, i.GG)(this, Ye, !1, "f"),\n            (self.__beEditorDirty = () => !(0, i.gn)(this, Ye, "f")),\n            (self.__beAutosave = () => {\n              if ((0, i.gn)(this, Ye, "f")) return { saved: !1, reason: "clean" };\n              const n = (0, i.gn)(this, un, "f");\n              if (null == n) return { saved: !1, reason: "unnamed" };\n              const ok = (0, i.gn)(this, $t, "f").saveCustomTrack(\n                { name: n, author: (0, i.gn)(this, mn, "f"), lastModified: (0, i.gn)(this, vn, "f") },\n                (0, i.gn)(this, jt, "f").getTrackData(),\n              );\n              return (ok && ((0, i.GG)(this, Ye, !0, "f"), (self.__beOwnName = n)), { saved: !!ok, name: n, reason: ok ? null : "failed" });\n            }));'],
  ['autosave hook cleared', '        dispose() {\n          ((0, i.GG)(this, ae, !1, "f"),', '        dispose() {\n          ((self.__beAutosave = self.__beEditorOpen = self.__beEditorDirty = self.__beEditorCurrent = self.__beOwnName = null),\n            (0, i.GG)(this, ae, !1, "f"),'],
  // Save asks before overwriting another saved track, not the one that is open (__beOwnName: the name it was loaded from or last saved under).
  ['save knows its own track: loaded', '                          (0, i.gn)(this, Kt, "m", In).call(this, t),\n                          (0, i.GG)(this, Ye, !0, "f"));', '                          (0, i.gn)(this, Kt, "m", In).call(this, t),\n                          (self.__beOwnName = t?.name ?? null),\n                          (0, i.GG)(this, Ye, !0, "f"));'],
  ['save knows its own track: saved', '                  (0, i.gn)(this, $t, "f").saveCustomTrack(e, n)\n                    ? ((0, i.gn)(this, te, "f").tryActivatePersistentStorage(),', '                  (0, i.gn)(this, $t, "f").saveCustomTrack(e, n)\n                    ? ((self.__beOwnName = t),\n                      (0, i.gn)(this, te, "f").tryActivatePersistentStorage(),'],
  ['save asks only for another track', '                (0, i.gn)(this, $t, "f").checkCustomTrackNameExists(e)\n                  ? (((0, i.gn)(this, re, "f").inert = !0),', '                (0, i.gn)(this, $t, "f").checkCustomTrackNameExists(e) && self.__beOwnName !== e\n                  ? (((0, i.gn)(this, re, "f").inert = !0),'],
  // Every stock block goes under one Road category (1) and its browser, like the four surfaces. So does the road kit
  // (the kits' shapes as stock road): the stock list comes first, so the browser is the stock one by then.
  [
    'stock blocks share the Road category',
    `const n = t[e];
            let s = (0, i.gn)(this, zn, "f").find((t) => t.category == n.configuration.category)?.partPanel;`,
    `const n = t[e],
              tm = n.configuration.tm ?? self.TM.ui.stockPart(n.configuration),
              cat = n.configuration.tm && "RoadKit" != ${FAMILIES}[n.configuration.tm.f] ? n.configuration.category : 1;
            let s = (0, i.gn)(this, zn, "f").find((t) => t.category == cat)?.partPanel;`,
  ],
  ['Road category icon', 'getCategoryMesh(\n                  n.configuration.category,', 'getCategoryMesh(\n                  cat,'],
  ['Road category button', 'Qn).call(this, n.configuration.category),', 'Qn).call(this, cat),'],
  ['Road category entry', '(0, i.gn)(this, zn, "f").push({\n                  category: n.configuration.category,', '(0, i.gn)(this, zn, "f").push({\n                  category: cat,'],
  ['Road category part', '              isStart: null != n.configuration.startOffset,\n              category: n.configuration.category,', '              isStart: null != n.configuration.startOffset,\n              category: cat,'],
  [
    'thumbnail renderer',
    `(Vn = function () {
          const t = (0, i.gn)(this, Jt, "f").getAllParts();`,
    `(Vn = function () {
          const t = (0, i.gn)(this, Jt, "f").getAllParts();
          self.TM.ui.setThumbnailRenderer((t, e) => {
            let n;
            switch ((0, i.gn)(this, jt, "f").environment) {
              case Dt.A.Summer:
                n = at.A.Summer;
                break;
              case Dt.A.Winter:
                n = at.A.Winter;
                break;
              case Dt.A.Desert:
                n = at.A.Desert;
            }
            const s = (0, i.gn)(this, Jt, "f").getPart(t).colors.get(n);
            ((e.className = "loading"),
              Rt(s).then((t) => {
                ((e.src = t), (e.className = ""));
              }));
          });`,
  ],
  [
    'new parts go in the browser panel',
    `              s.appendChild(o));
            const a = document.createElement("img");
            ((a.className = "loading"), o.appendChild(a));`,
    `              0);
            const a = document.createElement("img");
            ((a.className = "loading"), o.appendChild(a));
            self.TM.ui.add(s, o, a, tm);`,
  ],
  [
    'Road sits at the top of the category list, right under erase, then the surfaces and water',
    `}),
                (0, i.gn)(this, ue, "f").appendChild(e));
              const o = document.createElement("img");`,
    `}),
                n.configuration.tm
                  ? (0, i.gn)(this, ue, "f").insertBefore(e, (0, i.gn)(this, ue, "f").children[n.configuration.tm.f + 2] ?? null)
                  : (0, i.gn)(this, ue, "f").appendChild(e),
                self.TM.ui.labelCategory(e, cat));
              const o = document.createElement("img");`,
  ],
  [
    'label on the erase button',
    `((O.src = "images/erase.svg"),
            D.appendChild(O),`,
    `((O.src = "images/erase.svg"),
            D.appendChild(O),
            self.TM.ui.labelCategory(D, -1),`,
  ],
  [
    'the ghost of a new block shows its real colours, tinted by the valid / blocked colour',
    `} else if (((e = t.trackPartData.colors.get(at.A.Summer)?.clone()), null == e))
              throw new Error("Track part mesh has not loaded yet");
            ((e.material = (0, i.gn)(this, je, "f")),`,
    `} else if (((e = t.trackPartData.colors.get(at.A.Summer)?.clone()), null == e))
              throw new Error("Track part mesh has not loaded yet");
            if (t.trackPartData?.configuration.tm) {
              // Show the colour that will actually be placed: the picked colour, or this environment's default.
              let n = (0, i.gn)(this, Kt, "m", Zn).call(this);
              if (n == at.A.Default)
                switch ((0, i.gn)(this, jt, "f").environment) {
                  case Dt.A.Summer:
                    n = at.A.Summer;
                    break;
                  case Dt.A.Winter:
                    n = at.A.Winter;
                    break;
                  case Dt.A.Desert:
                    n = at.A.Desert;
                }
              const s = t.trackPartData.colors.get(n);
              null != s && (e = s.clone());
            }
            ((e.material = t.trackPartData?.configuration.tm ? self.TM.ui.ghostMaterial(w, (0, i.gn)(this, je, "f")) : (0, i.gn)(this, je, "f")),`,
  ],
  ['no eager thumbnails', 'if (n.category == t && null != n.id && !n.image.hasAttribute("src")) {', 'if (n.category == t && null != n.id && !n.image.hasAttribute("src") && !n.button.__tm) {'],
  [
    'environment change',
    `for (const e of (0, i.gn)(this, Gn, "f"))
            if (null != e.id)
              if (e.category == (0, i.gn)(this, Nn, "f")) {`,
    `for (const e of (0, i.gn)(this, Gn, "f"))
            if (null != e.id && !self.TM.ui.skipEager(e))
              if (e.category == (0, i.gn)(this, Nn, "f")) {`,
  ],
  [
    'environment change refresh',
    `} else (e.image.removeAttribute("src"), (e.image.className = "loading"));
        }),`,
    `} else (e.image.removeAttribute("src"), (e.image.className = "loading"));
          self.TM.ui.refresh();
        }),`,
  ],
  [
    'selection follows into the browser',
    `const e = (0, i.gn)(this, Gn, "f")[t];
            e.isCheckpoint ? (0, i.gn)(this, ve, "f").show() : (0, i.gn)(this, ve, "f").hide();`,
    `const e = (0, i.gn)(this, Gn, "f")[t];
            self.TM.ui.onSelect(e.button.__tm?.part);
            e.isCheckpoint ? (0, i.gn)(this, ve, "f").show() : (0, i.gn)(this, ve, "f").hide();`,
  ],
  [
    'recent blocks',
    `(e.isStart && (r = (0, i.gn)(this, jt, "f").getNextStartOrder()),
                    (0, i.gn)(this, jt, "f").setPart(
                      t.x,`,
    `(e.isStart && (r = (0, i.gn)(this, jt, "f").getNextStartOrder()),
                    self.TM.ui.onPlaced(e.id),
                    (0, i.gn)(this, jt, "f").setPart(
                      t.x,`,
  ],
  // Thumbnails share one scene: a finish box's frame shell (tm_water.js) stayed in it and was drawn round the next ~30
  // thumbnails (ice blocks, sloped edges, slopes after Ice gates). Take it out after each thumbnail; a finish box puts it back.
  ['thumbnail drops the finish frame', '                Ut.remove(t),\n                e(Bt.domElement.toDataURL()));', '                Ut.remove(t),\n                Ut.getObjectByName("be-finish-frame")?.removeFromParent(),\n                e(Bt.domElement.toDataURL()));'],
  // A track loaded from Official/Community or an import that shares a custom track's name is not that track: Save asks.
  ['own name only for the same track', '                          (self.__beOwnName = t?.name ?? null),', '                          (self.__beOwnName = (() => {\n                            try {\n                              const c = null != t?.name ? (0, i.gn)(this, $t, "f").loadCustomTrack(t.name) : null;\n                              return null != c && c.trackData.getId() === e.getId() ? t.name : null;\n                            } catch {\n                              return null;\n                            }\n                          })()),'],
  // Save without a name goes through Track settings: ask there too before overwriting another saved track.
  ['unnamed save asks before overwriting', '                          (0, i.GG)(this, ye, null, "f"),\n                          t(e),\n                          ((0, i.gn)(this, re, "f").className = "editor-ui"));', '                          (0, i.GG)(this, ye, null, "f"),\n                          ((0, i.gn)(this, re, "f").className = "editor-ui"),\n                          (0, i.gn)(this, $t, "f").checkCustomTrackNameExists(e) && self.__beOwnName !== e\n                            ? (((0, i.gn)(this, re, "f").inert = !0),\n                              (0, i.gn)(this, ne, "f").showConfirm(\n                                (0, i.gn)(this, Vt, "f").get(\'Are you sure you want to overwrite "{0}"?\', [e]),\n                                (0, i.gn)(this, Vt, "f").get("Cancel"),\n                                (0, i.gn)(this, Vt, "f").get("Confirm"),\n                                () => {\n                                  (0, i.gn)(this, re, "f").inert = !1;\n                                },\n                                () => {\n                                  (t(e), ((0, i.gn)(this, re, "f").inert = !1));\n                                },\n                              ))\n                            : t(e));'],
  // NSWS library mode (nsws_bridge.js): which My Tracks entry is open, so Save writes to that entry. Set once the track has
  // loaded (a failed load keeps the track that was open); dispose clears it ("open track forgotten").
  ['open track known', '                          (self.__beOwnName = (() => {\n                            try {', '                          self.__beOpened?.(t),\n                          (self.__beOwnName = (() => {\n                            try {'],
  // Clear all's save-first prompt: compare with the track that is open, not the name field (renamed into another track).
  ['clear all asks for another track', '                      name !== before && (0, i.gn)(this, $t, "f").checkCustomTrackNameExists(name)', '                      name !== self.__beOwnName && (0, i.gn)(this, $t, "f").checkCustomTrackNameExists(name)'],
  // tm_assets.js (public assets): the copy tool's box selection picks an asset's blocks, an asset from the library goes
  // to the paste tool like a copied selection, and a paste of it tells the library the asset was used.
  [
    'asset library: editor hooks',
    '            N.appendChild(T),\n            (0, i.GG)(this, de, document.createElement("button"), "f"),',
    `            N.appendChild(T),
            (self.__beAssetEditor = {
              select: () => {
                ((0, i.GG)(this, An, !0, "f"),
                  (0, i.GG)(this, Mn, !1, "f"),
                  (0, i.GG)(this, En, null, "f"),
                  (0, i.GG)(this, Wn, null, "f"),
                  (0, i.gn)(this, Kt, "m", $n).call(this, null));
              },
              selecting: () => (0, i.gn)(this, An, "f") || (0, i.gn)(this, Mn, "f"),
              cancel: () => {
                ((0, i.GG)(this, An, !1, "f"), (0, i.GG)(this, Mn, !1, "f"), (0, i.GG)(this, En, null, "f"));
              },
              part: (id) => {
                try {
                  return (0, i.gn)(this, Jt, "f").getPart(id) ?? null;
                } catch {
                  return null;
                }
              },
              paste: (parts, tag) => {
                const b = [];
                for (const t of parts)
                  (0, i.gn)(this, Jt, "f")
                    .getPart(t.id)
                    .configuration.tiles.rotated(t.rotation, t.rotationAxis)
                    .forEach((e, n, s) => {
                      b.push([e + t.offset.x, n + t.offset.y, s + t.offset.z]);
                    });
                const c = { parts, tiles: new ct.A(b), tag };
                return (
                  (0, i.GG)(this, Cn, c, "f"),
                  ((0, i.gn)(this, de, "f").disabled = !1),
                  (0, i.gn)(this, Kt, "m", Dn).call(this),
                  c
                );
              },
              clipboard: () => (0, i.gn)(this, Wn, "f"),
            }),
            (0, i.GG)(this, de, document.createElement("button"), "f"),`,
  ],
  ['asset library: empty selection', '          if (0 == h.length) return;', '          if (0 == h.length) return void (self.__beAssetPicking && self.__beAssetPicked(null));'],
  [
    'asset library: selection picked',
    '          const k = new ct.A(b);\n          ((0, i.GG)(this, Cn, { parts: w, tiles: k }, "f"),',
    '          const k = new ct.A(b);\n          if (self.__beAssetPicking) return void self.__beAssetPicked({ parts: w, tiles: k });\n          ((0, i.GG)(this, Cn, { parts: w, tiles: k }, "f"),',
  ],
  [
    'asset library: asset placed',
    '            (e.length > 0 || n.length > 0) &&\n              ((0, i.gn)(this, wn, "f").push({ removed: e, added: n }),',
    '            n.length > 0 && self.__beAssetPlaced?.((0, i.gn)(this, Wn, "f")),\n            (e.length > 0 || n.length > 0) &&\n              ((0, i.gn)(this, wn, "f").push({ removed: e, added: n }),',
  ],
  // nsws_cup.js (Cuppa Build Off): the editor parts the finish guard uses, and its lock. While locked (the last seconds of
  // building with no finish yet) picking any part gives a finish, and nothing else can be placed or pasted.
  [
    'cup guard: editor hooks',
    '            (self.__beAssetEditor = {',
    `            (self.__beCupEditor = {
              scene: () => (0, i.gn)(this, jt, "f"),
              types: () => (0, i.gn)(this, Jt, "f"),
              choose: (id) => {
                const g = (0, i.gn)(this, Gn, "f"),
                  n = g.findIndex((e) => e.id === id);
                return (
                  n >= 0 &&
                  ((0, i.gn)(this, Kt, "m", Qn).call(this, g[n].category), (0, i.gn)(this, Kt, "m", $n).call(this, n), !0)
                );
              },
              commit: (removed, added) => {
                ((removed.length > 0 || added.length > 0) &&
                  ((0, i.gn)(this, wn, "f").push({ removed, added }),
                  ((0, i.gn)(this, bn, "f").length = 0),
                  ((0, i.gn)(this, ge, "f").disabled = 0 == (0, i.gn)(this, wn, "f").length),
                  ((0, i.gn)(this, fe, "f").disabled = 0 == (0, i.gn)(this, bn, "f").length)),
                  (0, i.gn)(this, Kt, "m", ii).call(this));
              },
            }),
            (self.__beAssetEditor = {`,
  ],
  ['cup guard: hooks cleared', '((self.__beAutosave = self.__beEditorOpen = ', '((self.__beCupEditor = self.__beAutosave = self.__beEditorOpen = '],
  ['open track forgotten', '((self.__beCupEditor = self.__beAutosave = ', '((self.__beOpenKey = self.__beCupEditor = self.__beAutosave = '],
  ['cup guard: part pick', '        ($n = function (t) {\n', '        ($n = function (t) {\n          self.__beCupLock && (t = self.__beCupLock.pick(t, (0, i.gn)(this, Gn, "f")));\n'],
  ['cup guard: category pick', '        (Qn = function (t) {\n', '        (Qn = function (t) {\n          self.__beCupLock && (t = self.__beCupLock.category(t, (0, i.gn)(this, Gn, "f")));\n'],
  ['cup guard: no paste', '        (Dn = function () {\n          null != (0, i.gn)(this, Cn, "f") &&', '        (Dn = function () {\n          !self.__beCupLock?.active() &&\n          null != (0, i.gn)(this, Cn, "f") &&'],
  ['cup guard: no paste placed', '          if (null == (0, i.gn)(this, Wn, "f") || null == (0, i.gn)(this, rn, "f")) return;', '          if (null == (0, i.gn)(this, Wn, "f") || null == (0, i.gn)(this, rn, "f") || self.__beCupLock?.active()) return;'],
  [
    'cup guard: only a finish is placed',
    `                else if (
                  null == (0, i.gn)(this, fn, "f") ||
                  (0, i.gn)(this, fn, "f").x != t.x ||
                  (0, i.gn)(this, fn, "f").y != t.y ||
                  (0, i.gn)(this, fn, "f").z != t.z ||
                  (0, i.gn)(this, fn, "f").id != e.id ||
                  (0, i.gn)(this, fn, "f").rotation != (0, i.gn)(this, ln, "f") ||
                  (0, i.gn)(this, fn, "f").rotationAxis != (0, i.gn)(this, cn, "f")
                ) {`,
    `                else if (
                  !self.__beCupLock?.refuse(e.id) &&
                  (null == (0, i.gn)(this, fn, "f") ||
                    (0, i.gn)(this, fn, "f").x != t.x ||
                    (0, i.gn)(this, fn, "f").y != t.y ||
                    (0, i.gn)(this, fn, "f").z != t.z ||
                    (0, i.gn)(this, fn, "f").id != e.id ||
                    (0, i.gn)(this, fn, "f").rotation != (0, i.gn)(this, ln, "f") ||
                    (0, i.gn)(this, fn, "f").rotationAxis != (0, i.gn)(this, cn, "f"))
                ) {`,
  ],
  // nsws_watch.js (Cuppa Build Off, watching another builder): the scene redrawn after its parts change, without the
  // undo history or the unsaved mark (what ii does after an edit, less those), and the undo lists copied and put back.
  [
    'cup watch: editor hooks',
    "            (self.__beCupEditor = {\n              scene: () => (0, i.gn)(this, jt, \"f\"),\n",
    "            (self.__beCupEditor = {\n              scene: () => (0, i.gn)(this, jt, \"f\"),\n              refresh: () => {\n                ((0, i.gn)(this, jt, \"f\").refreshMeshes(),\n                  (0, i.gn)(this, kn, \"f\")?.refresh((0, i.gn)(this, jt, \"f\")),\n                  (0, i.gn)(this, ve, \"f\").setFromExistingCheckpoints((0, i.gn)(this, jt, \"f\")),\n                  (0, i.GG)(this, Ln, null, \"f\"));\n              },\n              history: (h) => {\n                if (!h) return [(0, i.gn)(this, wn, \"f\").slice(), (0, i.gn)(this, bn, \"f\").slice()];\n                const u = (0, i.gn)(this, wn, \"f\"),\n                  r = (0, i.gn)(this, bn, \"f\");\n                ((u.length = 0),\n                  u.push(...h[0]),\n                  (r.length = 0),\n                  r.push(...h[1]),\n                  ((0, i.gn)(this, ge, \"f\").disabled = 0 == u.length),\n                  ((0, i.gn)(this, fe, \"f\").disabled = 0 == r.length));\n              },\n",
  ],
  // nsws_watch.js follows the other builder's camera: [position, look-at] read and set.
  [
    'cup watch: camera',
    "        beLook(t, e, n) {\n",
    "        beView(v) {\n          const c = (0, i.gn)(this, qe, \"f\"),\n            o = (0, i.gn)(this, De, \"f\");\n          return (\n            v && (c.position.set(v[0], v[1], v[2]), o.target.set(v[3], v[4], v[5]), o.update()),\n            [c.position.x, c.position.y, c.position.z, o.target.x, o.target.y, o.target.z]\n          );\n        }\n        beLook(t, e, n) {\n",
  ],
  [
    'cup watch: camera hook',
    "self.TM.tools.open(h, w, () => (0, i.gn)(this, bi, \"f\")?.camera, (t, e, n) => (0, i.gn)(this, bi, \"f\")?.beLook(t, e, n)),",
    "self.TM.tools.open(h, w, () => (0, i.gn)(this, bi, \"f\")?.camera, (t, e, n) => (0, i.gn)(this, bi, \"f\")?.beLook(t, e, n)),\n            (self.__beCupView = (v) => (0, i.gn)(this, bi, \"f\")?.beView(v)),",
  ],
  // nsws_watch.js shows the watched builder's part in hand (the preview before it is placed) at their tile.
  ['cup watch: hand', "        beLook(t, e, n) {\n", "        // The part in this builder's hand: [id, x, y, z, rotation, axis, colour], or null (nothing held, eraser, off the grid).\n        // Given one (or null), the editor shows the watched builder's hand at their tile instead of its own cursor; false\n        // ends that and gives this player's own pick back.\n        beHand(h) {\n          if (void 0 === h) {\n            const t = (0, i.gn)(this, rn, \"f\"),\n              n = (0, i.gn)(this, xn, \"f\"),\n              e = null != n ? (0, i.gn)(this, Gn, \"f\")[n] : null;\n            return null != t && null != e && null != e.id && (0, i.gn)(this, Xe, \"f\").visible\n              ? [e.id, t.x, t.y, t.z, (0, i.gn)(this, ln, \"f\"), (0, i.gn)(this, cn, \"f\"), (0, i.gn)(this, Kt, \"m\", Zn).call(this)]\n              : null;\n          }\n          const pick = (t, cat, r, a, c) => {\n            ((0, i.GG)(this, yn, c, \"f\"), null != cat && (0, i.gn)(this, Kt, \"m\", Qn).call(this, cat), (0, i.gn)(this, Kt, \"m\", $n).call(this, t), (0, i.GG)(this, ln, r, \"f\"), ((0, i.gn)(this, Ge, \"f\").rotation = r), (0, i.GG)(this, cn, a, \"f\"), ((0, i.gn)(this, Ge, \"f\").rotationAxis = a));\n          };\n          if (!1 === h) {\n            if (void 0 === this.__beHand) return null;\n            const o = this.__beHandOwn;\n            return ((this.__beHand = void 0), (this.__beHandOwn = null), o && pick(o.t, o.cat, o.r, o.a, o.c), null);\n          }\n          void 0 === this.__beHand && (this.__beHandOwn = { t: (0, i.gn)(this, xn, \"f\"), cat: (0, i.gn)(this, Nn, \"f\"), r: (0, i.gn)(this, ln, \"f\"), a: (0, i.gn)(this, cn, \"f\"), c: (0, i.gn)(this, yn, \"f\") });\n          if (!Array.isArray(h)) return ((this.__beHand = null), null);\n          const g = (0, i.gn)(this, Gn, \"f\"),\n            n = g.findIndex((e) => e.id === h[0]);\n          if (n < 0) return ((this.__beHand = null), null);\n          (0, i.gn)(this, xn, \"f\") !== n || (0, i.gn)(this, yn, \"f\") !== h[6] ? pick(n, g[n].category, h[4], h[5], h[6]) : ((0, i.GG)(this, ln, h[4], \"f\"), ((0, i.gn)(this, Ge, \"f\").rotation = h[4]), (0, i.GG)(this, cn, h[5], \"f\"), ((0, i.gn)(this, Ge, \"f\").rotationAxis = h[5]));\n          return ((this.__beHand = { x: h[1], y: h[2], z: h[3] }), h);\n        }\n        beLook(t, e, n) {\n"],
  ['cup watch: hand at their tile', "(0, i.GG)(this, rn, (0, i.gn)(this, Kt, \"m\", oi).call(this), \"f\"),", "(0, i.GG)(this, rn, void 0 !== this.__beHand ? this.__beHand : (0, i.gn)(this, Kt, \"m\", oi).call(this), \"f\"),"],
  ['cup watch: hand hook', "            (self.__beCupView = (v) => (0, i.gn)(this, bi, \"f\")?.beView(v)),", "            (self.__beCupView = (v) => (0, i.gn)(this, bi, \"f\")?.beView(v)),\n            (self.__beCupHand = (h) => (0, i.gn)(this, bi, \"f\")?.beHand(h)),"],
  // The fine grid: the grid button goes large, small, fine (half steps for our blocks that are not gates, tm_runtime.js fineOk), then large again.
  ["fine grid: grid button", "          let d = !0;\n          const g = document.createElement(\"button\"),\n            f = document.createElement(\"img\");\n          ((f.src = \"images/grid_large.svg\"),\n            g.appendChild(f),\n            g.addEventListener(\"click\", () => {\n              (e.playUIClick(),\n                (d = !d),\n                (f.src = d ? \"images/grid_large.svg\" : \"images/grid_small.svg\"),\n                o(d));\n            }),", "          let d = !0;\n          const g = document.createElement(\"button\"),\n            f = document.createElement(\"img\");\n          ((f.src = \"images/grid_large.svg\"),\n            (self.__beGridFine = !1),\n            g.appendChild(f),\n            g.addEventListener(\"click\", () => {\n              (e.playUIClick(),\n                d ? ((d = !1), (self.__beGridFine = !1)) : self.__beGridFine ? ((d = !0), (self.__beGridFine = !1)) : (self.__beGridFine = !0),\n                (f.src = d ? \"images/grid_large.svg\" : self.__beGridFine ? \"images/grid_fine.svg\" : \"images/grid_small.svg\"),\n                o(d));\n            }),"],
  ["fine grid: back to whole heights", "                (t) => {\n                  ((0, i.GG)(this, dn, t, \"f\"),\n                    (0, i.GG)(this, An, !1, \"f\"),\n                    (0, i.GG)(this, Mn, !1, \"f\"),\n                    (0, i.GG)(this, En, null, \"f\"));\n                },", "                (t) => {\n                  ((0, i.GG)(this, dn, t, \"f\"),\n                    (0, i.GG)(this, An, !1, \"f\"),\n                    (0, i.GG)(this, Mn, !1, \"f\"),\n                    (0, i.GG)(this, En, null, \"f\"),\n                    self.__beGridFine || (0, i.GG)(this, Kt, Math.floor((0, i.gn)(this, Kt, \"a\", ti)), \"a\", ei));\n                },"],
  ["fine grid: editing height in half steps", "        (ti = function () {\n          return Math.floor((0, i.gn)(this, Ze, \"f\").position.y / 5);\n        }),", "        (ti = function () {\n          return Math.round((0, i.gn)(this, Ze, \"f\").position.y / 2.5) / 2;\n        }),"],
  ["fine grid: height key down", "f.checkKeyBinding(t, st.A.EditorMoveDown) &&\n                          ((0, i.GG)(this, Kt, Math.max(0, (0, i.gn)(this, Kt, \"a\", ti) - 1), \"a\", ei),", "f.checkKeyBinding(t, st.A.EditorMoveDown) &&\n                          ((0, i.GG)(this, Kt, Math.max(0, (0, i.gn)(this, Kt, \"a\", ti) - (self.__beGridFine ? 0.5 : 1)), \"a\", ei),"],
  ["fine grid: height key up", "f.checkKeyBinding(t, st.A.EditorMoveUp) &&\n                          ((0, i.GG)(this, Kt, (0, i.gn)(this, Kt, \"a\", ti) + 1, \"a\", ei),", "f.checkKeyBinding(t, st.A.EditorMoveUp) &&\n                          ((0, i.GG)(this, Kt, (0, i.gn)(this, Kt, \"a\", ti) + (self.__beGridFine ? 0.5 : 1), \"a\", ei),"],
  ["fine grid: height wheel", "(t.deltaY > 0\n                      ? (0, i.GG)(this, Kt, (0, i.gn)(this, Kt, \"a\", ti) + 1, \"a\", ei)\n                      : t.deltaY < 0 &&\n                        (0, i.GG)(this, Kt, Math.max(0, (0, i.gn)(this, Kt, \"a\", ti) - 1), \"a\", ei));", "(t.deltaY > 0\n                      ? (0, i.GG)(this, Kt, (0, i.gn)(this, Kt, \"a\", ti) + (self.__beGridFine ? 0.5 : 1), \"a\", ei)\n                      : t.deltaY < 0 &&\n                        (0, i.GG)(this, Kt, Math.max(0, (0, i.gn)(this, Kt, \"a\", ti) - (self.__beGridFine ? 0.5 : 1)), \"a\", ei));"],
  ["fine grid: height button up", "((0, i.gn)(this, Ft, \"f\").playUIClick(),\n                    (0, i.GG)(this, Kt, (0, i.gn)(this, Kt, \"a\", ti) + 1, \"a\", ei));", "((0, i.gn)(this, Ft, \"f\").playUIClick(),\n                    (0, i.GG)(this, Kt, (0, i.gn)(this, Kt, \"a\", ti) + (self.__beGridFine ? 0.5 : 1), \"a\", ei));"],
  ["fine grid: height button down", "((0, i.gn)(this, Ft, \"f\").playUIClick(),\n                    (0, i.GG)(this, Kt, Math.max(0, (0, i.gn)(this, Kt, \"a\", ti) - 1), \"a\", ei));", "((0, i.gn)(this, Ft, \"f\").playUIClick(),\n                    (0, i.GG)(this, Kt, Math.max(0, (0, i.gn)(this, Kt, \"a\", ti) - (self.__beGridFine ? 0.5 : 1)), \"a\", ei));"],
  // The fine grid: the cursor moves in half steps for a part that may sit on them, in the editing height too.
  ["fine grid: cursor knows the part", "        (oi = function () {\n          let t;", "        (oi = function () {\n          let t;\n          const beF =\n            !!self.__beGridFine &&\n            !(0, i.gn)(this, Mn, \"f\") &&\n            !(0, i.gn)(this, An, \"f\") &&\n            null == (0, i.gn)(this, Wn, \"f\") &&\n            self.TM.fineOk((0, i.gn)(this, Gn, \"f\")[(0, i.gn)(this, xn, \"f\")]?.id);"],
  ["fine grid: cursor in half steps", "                  ? new w.Pq0(\n                      Math.round(n.point.x / W.A.partSize),\n                      Math.floor((0, i.gn)(this, Ze, \"f\").position.y / W.A.partSize),\n                      Math.round(n.point.z / W.A.partSize),\n                    )", "                  ? beF\n                    ? new w.Pq0(\n                        n.point.x / W.A.partSize,\n                        (0, i.gn)(this, Ze, \"f\").position.y / W.A.partSize,\n                        n.point.z / W.A.partSize,\n                      )\n                    : new w.Pq0(\n                        Math.round(n.point.x / W.A.partSize),\n                        Math.floor((0, i.gn)(this, Ze, \"f\").position.y / W.A.partSize),\n                        Math.round(n.point.z / W.A.partSize),\n                      )"],
  ["fine grid: snap x", "            ((e = (0, i.gn)(this, dn, \"f\") ? 4 : 1),\n              (n =\n                (0, i.gn)(this, Mn, \"f\") ||\n                (0, i.gn)(this, An, \"f\") ||\n                ((0, i.gn)(this, cn, \"f\") != ht.A.XPositive && (0, i.gn)(this, cn, \"f\") != ht.A.XNegative)\n                  ? Math.round(t.x / e) * e\n                  : Math.round(t.x)));\n            const s = Math.round(t.y) + (0, i.gn)(this, hn, \"f\");", "            ((e = (0, i.gn)(this, dn, \"f\") ? 4 : beF ? 0.5 : 1),\n              (n =\n                (0, i.gn)(this, Mn, \"f\") ||\n                (0, i.gn)(this, An, \"f\") ||\n                ((0, i.gn)(this, cn, \"f\") != ht.A.XPositive && (0, i.gn)(this, cn, \"f\") != ht.A.XNegative)\n                  ? Math.round(t.x / e) * e\n                  : beF\n                    ? Math.round(2 * t.x) / 2\n                    : Math.round(t.x)));\n            const s = (beF ? Math.round(2 * t.y) / 2 : Math.round(t.y)) + (0, i.gn)(this, hn, \"f\");"],
  ["fine grid: snap z", "                  ? Math.round(t.z / e) * e\n                  : Math.round(t.z)),", "                  ? Math.round(t.z / e) * e\n                  : beF\n                    ? Math.round(2 * t.z) / 2\n                    : Math.round(t.z)),"],
  // The fine grid: a part on half steps is in the way of whatever is in the whole cells its tiles overlap.
  ["fine grid: parts in the way", "            e.rotated((0, i.gn)(this, ln, \"f\"), (0, i.gn)(this, cn, \"f\")).forEach((e, s, o) => {\n              const a = t.x + e,\n                r = t.y + s,\n                h = t.z + o,\n                l = (0, i.gn)(this, jt, \"f\").getPartsAt(a, r, h);\n              l.length > 0 && n.push({ x: a, y: r, z: h, parts: l });\n            }),", "            e.rotated((0, i.gn)(this, ln, \"f\"), (0, i.gn)(this, cn, \"f\")).forEach((e, s, o) => {\n              for (const [a, r, h] of self.TM.tileCells(t.x + e, t.y + s, t.z + o)) {\n                const l = (0, i.gn)(this, jt, \"f\").getPartsAt(a, r, h);\n                l.length > 0 && n.push({ x: a, y: r, z: h, parts: l });\n              }\n            }),"],
  ["fine grid: any part in the way", "          return e.rotated((0, i.gn)(this, ln, \"f\"), (0, i.gn)(this, cn, \"f\")).some((e, n, s) => {\n            const o = t.x + e,\n              a = t.y + n,\n              r = t.z + s;\n            return (0, i.gn)(this, jt, \"f\").getPartsAt(o, a, r).length > 0;\n          });", "          return e.rotated((0, i.gn)(this, ln, \"f\"), (0, i.gn)(this, cn, \"f\")).some((e, n, s) =>\n            self.TM.tileCells(t.x + e, t.y + n, t.z + s).some(([o, a, r]) => (0, i.gn)(this, jt, \"f\").getPartsAt(o, a, r).length > 0),\n          );"],
  // The fine grid: a pasted selection with parts on half steps replaces what is in the whole cells they overlap.
  ["fine grid: paste replaces whole cells", "              .forEach((n, s, o) => {\n                const a = t.x + n,\n                  r = t.y + s,\n                  h = t.z + o,\n                  l = (0, i.gn)(this, jt, \"f\").deletePartsAt(a, r, h);\n                for (const t of l)\n                  e.push({\n                    id: t.id,\n                    x: t.x,\n                    y: t.y,\n                    z: t.z,\n                    rotation: t.rotation,\n                    rotationAxis: t.rotationAxis,\n                    color: t.color,\n                    checkpointOrder: t.checkpointOrder,\n                    startOrder: t.startOrder,\n                  });\n              });", "              .forEach((n, s, o) => {\n                for (const [a, r, h] of self.TM.tileCells(t.x + n, t.y + s, t.z + o)) {\n                  const l = (0, i.gn)(this, jt, \"f\").deletePartsAt(a, r, h);\n                  for (const t of l)\n                    e.push({\n                      id: t.id,\n                      x: t.x,\n                      y: t.y,\n                      z: t.z,\n                      rotation: t.rotation,\n                      rotationAxis: t.rotationAxis,\n                      color: t.color,\n                      checkpointOrder: t.checkpointOrder,\n                      startOrder: t.startOrder,\n                    });\n                }\n              });"],
]);

// The worker keeps its own copy of the part table and track reader, under different minified names.
{
  const file = 'simulation_worker.bundle.js';
  apply(file, [
    ['part ids', '(t[(t.PlaneCorner = 189)] = "PlaneCorner"));', '(t[(t.PlaneCorner = 189)] = "PlaneCorner"),\n          self.TM.addEnum(t));'],
    ['categories', '(t[(t.Sign = 8)] = "Sign"));', `(t[(t.Sign = 8)] = "Sign"),\n          ${FAMILIES}.forEach((n, f) => (t[(t[n] = 9 + f)] = n)));`],
    [
      'part class',
      `constructor(t, e, i, r, s, n, a = null, o = null) {
          const l = [];
          for (const [t, e] of n)
            for (let i = t[0]; i <= e[0]; i++)
              for (let r = t[1]; r <= e[1]; r++)
                for (let s = t[2]; s <= e[2]; s++) {
                  if (null != l.find(([t, e, n]) => t == i && e == r && n == s))
                    throw new Error("Duplicate tile in track part");
                  l.push([i, r, s]);
                }`,
      `constructor(t, e, i, r, s, n, a = null, o = null) {
          const l = [],
            seen = new Set();
          for (const [t, e] of n)
            for (let i = t[0]; i <= e[0]; i++)
              for (let r = t[1]; r <= e[1]; r++)
                for (let s = t[2]; s <= e[2]; s++) {
                  const key = i + "|" + r + "|" + s;
                  if (seen.has(key)) throw new Error("Duplicate tile in track part");
                  (seen.add(key), l.push([i, r, s]));
                }`,
    ],
    [
      'register new parts',
      `],
        co = new Map();`,
      `].concat(
          self.TM.parts.map(
            (q) =>
              new lo(
                null,
                Xa[${FAMILIES}[q.f]],
                q.i,
                [],
                self.TM.palette(q) ?? self.TM.data.palettes[0],
                q.c,
                q.d ?? null,
                q.o ? new R(q.o[0], q.o[1], q.o[2]) : null,
              ),
          ),
        ),
        co = new Map();`,
    ],
    [
      'read save string',
      `static fromSaveString(t) {
          const e = (function (t) {`,
      `static fromSaveString(t) {
          const tm = self.TM.fromSave(t, {
            pako: Ma,
            fromBase62: Wa,
            create: (t, e) => new Ko(t, new Oa(e)),
            environments: Ha,
            partIds: Za,
            axes: Ka,
            colors: Ja,
            checkpointIds: uo,
            startIds: fo,
          });
          if (null != tm) return tm;
          const e = (function (t) {`,
    ],
    [
      'new blocks join the terrain mesh, gates use proxy parts',
      `function s(e, i, r, s, n) {
            const a = t.ccall("malloc", "number", ["number"], [4 * i.length]);`,
      `function s(e, i, r, s, n) {
            const tmCar = self.TM.prepareCar(e, i, r, s, (t, e, i) => Ao(t).tiles.rotated(e, i));
            i = tmCar.vertices;
            const a = t.ccall("malloc", "number", ["number"], [4 * i.length]);`,
    ],
    ['part record count', 'const o = s.numberOfParts,\n              l = t.ccall("malloc", "number", ["number"], [19 * o]);', 'const o = tmCar.records,\n              l = t.ccall("malloc", "number", ["number"], [19 * o]);'],
    [
      'part records',
      `(s.forEachPart((t, e, i, r, s, n, a, o) => {
              (c.setUint8(h, r),`,
      `(s.forEachPart((t, e, i, r, s, n, a, o) => {
              if (((r = self.TM.physicsId(r)), null == r)) return;
              (c.setUint8(h, r),`,
    ],
    [
      'effects around each physics frame',
      `function n(e, r) {
            t.ccall(
              "updateCarModel",
              "void",
              ["number", "boolean", "boolean", "boolean", "boolean", "boolean", "number"],
              [e.id, r.up, r.right, r.down, r.left, r.reset, i],
            );
            return new Uint8Array(t.HEAPU8.buffer, i, 227).slice().buffer;
          }`,
      `function n(e, r) {
            r = self.TM.fxControls(e.id, r);
            const tmHeld = self.TM.fxSkip(e.id, t.HEAPU8);
            // The recording is made from the state's controls: the keys pressed, not the ones fxControls changed.
            if (null != tmHeld) return (self.TM.fxRecord?.(e.id, tmHeld, !0), tmHeld);
            t.ccall(
              "updateCarModel",
              "void",
              ["number", "boolean", "boolean", "boolean", "boolean", "boolean", "number"],
              [e.id, r.up, r.right, r.down, r.left, r.reset, i],
            );
            const tmState = new Uint8Array(t.HEAPU8.buffer, i, 227).slice().buffer;
            self.TM.fxStep(e.id, t.HEAPU8, tmState);
            self.TM.fxRecord?.(e.id, tmState);
            return tmState;
          }`,
    ],
  ]);
  // The enum IIFE runs at the top of the bundle, so the table has to be there before anything else.
  const p = path.join(to, file);
  fs.writeFileSync(p, 'importScripts("tm_parts.js", "tm_runtime.js");\n' + fs.readFileSync(p, 'utf8'));
}
void G;
console.log('done');
