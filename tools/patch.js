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

apply('index.html', [
  ['load the block table first', '<script defer="defer" src="error_screen.bundle.js"></script>', '<script defer="defer" src="tm_parts.js"></script><script defer="defer" src="tm_runtime.js"></script><script defer="defer" src="tm_menu.js"></script><script defer="defer" src="tm_water.js"></script><script defer="defer" src="error_screen.bundle.js"></script>'],
  ['NSWS bridge', '<script defer="defer" src="main.bundle.js"></script>', '<script defer="defer" src="main.bundle.js"></script><script defer="defer" src="nsws_bridge.js"></script>'],
]);

apply('main.bundle.js', [
  // nsws_bridge.js starts the editor without the menu.
  ['no first-launch race when embedded', '              : this.isFirstSession()\n                ? { type: "tutorial" }', '              : this.isFirstSession() && window.parent === window\n                ? { type: "tutorial" }'],
  ['editor starter', '            J = (t, i, a, c, h) => {', '            beStart = (self.__beStartEditor = Q),\n            J = (t, i, a, c, h) => {'],
  // tm_water.js: splashes and spray where a car meets water.
  ['water splashes know the track', '((0, l.GG)(this, ee, e.id, "f"), (0, l.GG)(this, te, e.carState, "f"));', '((0, l.GG)(this, ee, e.id, "f"), (0, l.GG)(this, te, e.carState, "f"), self.TM.water.track(this, h));'],
  ['water splashes each frame', '(0, l.gn)(this, Ne, "f")?.update(e),', '(0, l.gn)(this, Ne, "f")?.update(e),\n              self.TM.water.update(this, (0, l.gn)(this, ge, "f"), e, (0, l.gn)(this, te, "f"), c),'],
  ['water splashes end with the car', '(0, l.gn)(this, Ne, "f")?.dispose());', '(0, l.gn)(this, Ne, "f")?.dispose(),\n              self.TM.water.dispose(this));'],
  ['part ids', '(e[(e.PlaneCorner = 189)] = "PlaneCorner"));', '(e[(e.PlaneCorner = 189)] = "PlaneCorner"),\n              self.TM.addEnum(e));'],
  ['single instance check off when embedded', 'if (void 0 !== window.BroadcastChannel) {', 'if (void 0 !== window.BroadcastChannel && window.parent === window) {'],
  // nsws_bridge.js imports tracks through the saved-track store and the track codec.
  ['track store hook', '(Bd.add(this),', '(Bd.add(this),\n            (self.__beTrackStore = this),\n            (self.__beTrackData = Ml.A),'],
  ['categories', '(e[(e.Sign = 8)] = "Sign"));', '(e[(e.Sign = 8)] = "Sign"),\n              (e[(e.Plastic = 9)] = "Plastic"),\n              (e[(e.Wood = 10)] = "Wood"),\n              (e[(e.Stadium = 11)] = "Stadium"),\n              (e[(e.Ice = 12)] = "Ice"));'],
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
                  [r.A.Plastic, r.A.Wood, r.A.Stadium, r.A.Ice][q.f],
                  q.i,
                  [],
                  self.TM.palette(q),
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
        constructor(cfg, material) {
          super();
          this.cfg = cfg;
          this.material = material;
          for (const { id: e } of cfg.colors) super.set(e, null);
        }
        get(id) {
          const have = super.get(id);
          if (null != have || !super.has(id)) return have;
          const slot = this.cfg.colors.find((e) => e.id == id),
            { pos: e, col: t, groups: g } = self.TM.renderArrays(this.cfg.id, slot.colors, (e) => {
              const t = new M.Q1f(e);
              return [t.r, t.g, t.b];
            }),
            n = new M.LoY();
          (n.setAttribute("position", new M.THS(e, 3)), n.setAttribute("color", new M.THS(t, 3)), n.computeVertexNormals());
          // Water gets its own see-through material (tm_water.js); merging keeps the vertex order, so the ranges still hold.
          const q = nu.ec(n);
          if (g) for (const [s, c, k] of g) q.addGroup(s, c, k);
          const i = new M.eaF(q, g ? [this.material, self.TM.water.material(M)] : this.material);
          return (super.set(id, i), i);
        }
      }
      class ou {
        constructor() {
          (Yd.add(this), Zd.set(this, new Map()), $d.set(this, new Map()));`,
  ],
  ['use lazy meshes', 'colors: new Map(e.colors.map(({ id: e }) => [e, null])),', 'colors: e.tm ? new TMColors(e, a) : new Map(e.colors.map(({ id: e }) => [e, null])),'],
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
              n = this.getPart(iu.A.IceBobCurve2);`,
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
          setPart(e, t, n, i, r, a, o, d, f) {
            const p = (0, v.gn)(this, s, "f").getPart(i);`,
  ],
]);

apply('112.bundle.js', [
  // nsws_bridge.js opens saved tracks straight into the editor.
  ['exit goes back to NSWS when embedded', '        (Un = function (t) {\n          const e = () => {', '        (Un = function (t) {\n          if (self.__beExitHook?.()) return;\n          const e = () => {'],
  ['editor test hook and current track', '            x.addEventListener("click", () => {\n              ((0, i.gn)(this, Ft, "f").playUIClick(), (0, i.gn)(this, Kt, "m", Hn).call(this));\n            }),\n            k.appendChild(x));', '            x.addEventListener("click", () => {\n              ((0, i.gn)(this, Ft, "f").playUIClick(), self.__beTestHook?.() || (0, i.gn)(this, Kt, "m", Hn).call(this));\n            }),\n            k.appendChild(x),\n            (self.__beEditorCurrent = () => {\n              const t = (0, i.gn)(this, un, "f"),\n                e = { name: t ?? "Unnamed Track", author: (0, i.gn)(this, mn, "f"), lastModified: (0, i.gn)(this, vn, "f") };\n              return { name: t, author: e.author, code: (0, i.gn)(this, jt, "f").getTrackData().toExportString(e) };\n            }));'],
  ['editor track loader', '                "cancel",\n                !0,\n                () => {\n                  (((0, i.gn)(this, re, "f").className = "editor-ui"), (0, i.gn)(this, we, "f").hide());\n                },\n                (t, e, n) => {', '                "cancel",\n                !0,\n                () => {\n                  (((0, i.gn)(this, re, "f").className = "editor-ui"), (0, i.gn)(this, we, "f").hide());\n                },\n                (self.__beEditorOpen = (t, e, n) => {'],
  ['editor track loader end', '                      .finally(() => {\n                        ((0, i.gn)(this, be, "f")?.dispose(), (0, i.GG)(this, be, null, "f"));\n                      }));\n                },\n              ),\n              "f",', '                      .finally(() => {\n                        ((0, i.gn)(this, be, "f")?.dispose(), (0, i.GG)(this, be, null, "f"));\n                      }));\n                }),\n              ),\n              "f",'],
  // nsws_bridge.js autosave: saves the open track under its name when it has unsaved changes.
  ['autosave hook', '            (0, i.GG)(this, vn, new Date(), "f"),\n            (0, i.GG)(this, Ye, !1, "f"));', '            (0, i.GG)(this, vn, new Date(), "f"),\n            (0, i.GG)(this, Ye, !1, "f"),\n            (self.__beEditorDirty = () => !(0, i.gn)(this, Ye, "f")),\n            (self.__beAutosave = () => {\n              if ((0, i.gn)(this, Ye, "f")) return { saved: !1, reason: "clean" };\n              const n = (0, i.gn)(this, un, "f");\n              if (null == n) return { saved: !1, reason: "unnamed" };\n              const ok = (0, i.gn)(this, $t, "f").saveCustomTrack(\n                { name: n, author: (0, i.gn)(this, mn, "f"), lastModified: (0, i.gn)(this, vn, "f") },\n                (0, i.gn)(this, jt, "f").getTrackData(),\n              );\n              return (ok && (0, i.GG)(this, Ye, !0, "f"), { saved: !!ok, name: n, reason: ok ? null : "failed" });\n            }));'],
  ['autosave hook cleared', '        dispose() {\n          ((0, i.GG)(this, ae, !1, "f"),', '        dispose() {\n          ((self.__beAutosave = self.__beEditorOpen = self.__beEditorDirty = self.__beEditorCurrent = null),\n            (0, i.GG)(this, ae, !1, "f"),'],
  // Every stock block goes under one Road category (1) and its browser, like the four surfaces.
  [
    'stock blocks share the Road category',
    `const n = t[e];
            let s = (0, i.gn)(this, zn, "f").find((t) => t.category == n.configuration.category)?.partPanel;`,
    `const n = t[e],
              tm = n.configuration.tm ?? self.TM.ui.stockPart(n.configuration),
              cat = n.configuration.tm ? n.configuration.category : 1;
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
    'Road sits at the top of the category list, right under erase, then the four surfaces',
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
]);

// The worker keeps its own copy of the part table and track reader, under different minified names.
{
  const file = 'simulation_worker.bundle.js';
  apply(file, [
    ['part ids', '(t[(t.PlaneCorner = 189)] = "PlaneCorner"));', '(t[(t.PlaneCorner = 189)] = "PlaneCorner"),\n          self.TM.addEnum(t));'],
    ['categories', '(t[(t.Sign = 8)] = "Sign"));', '(t[(t.Sign = 8)] = "Sign"),\n          (t[(t.Plastic = 9)] = "Plastic"),\n          (t[(t.Wood = 10)] = "Wood"),\n          (t[(t.Stadium = 11)] = "Stadium"),\n          (t[(t.Ice = 12)] = "Ice"));'],
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
                [Xa.Plastic, Xa.Wood, Xa.Stadium, Xa.Ice][q.f],
                q.i,
                [],
                self.TM.palette(q),
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
            if (null != tmHeld) return tmHeld;
            t.ccall(
              "updateCarModel",
              "void",
              ["number", "boolean", "boolean", "boolean", "boolean", "boolean", "number"],
              [e.id, r.up, r.right, r.down, r.left, r.reset, i],
            );
            const tmState = new Uint8Array(t.HEAPU8.buffer, i, 227).slice().buffer;
            self.TM.fxStep(e.id, t.HEAPU8, tmState);
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
