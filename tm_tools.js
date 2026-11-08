// Editor tools for going back and forth between building and testing. Page only, loaded after tm_menu.js.
// - Driving line: every Test run is recorded, and back in the editor the line you drove is drawn on the track,
//   coloured by speed, with a pin where the run ended. Hover the line for the speed and time at that point.
// - Test runs: a list of the runs since the editor opened, with times, checkpoints reached and the gap to the best.
// - Recovery: unsaved changes are copied to this browser every few seconds, and the next time the editor opens it
//   offers them back (the standalone site only; inside NSWS, NSWS saves the track itself).
// Hooks (tools/patch.js): open / close with the editor, testStart / testEnd round a Test, car() every car frame.
self.TM.tools = (() => {
  const MAX_RUNS = 12;
  const STEP = 20; // ms of physics between recorded points
  const JUMP = 8; // a point this far from the last one is a respawn: the line breaks there
  const WIDTH = 0.55; // half width of the drawn line
  const DROP = 0.04; // the line sits this far below the car's centre, along the car's up: just above the deck
  const RECOVERY_KEY = 'be-recovery';
  const PANEL_KEY = 'be-runs-open';
  const LINE_KEY = 'be-runs-line';

  const store = {
    get: (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
      } catch {}
    },
  };

  let ed = null; // { ctx, three, camera, look }: the open editor
  let testing = false;
  let checkpoints = 0;
  let runs = [];
  let current = null;
  let carRef = null;
  let picked = null; // the run whose line is drawn (null: the latest)
  let showLine = store.get(LINE_KEY) != '0';
  let mesh = null;
  let pin = null;
  let ui = null;
  let nextId = 1;

  // ---- recording ----------------------------------------------------------------------------------------------
  function car(obj, s) {
    if (!testing || !s || !s.position) return;
    const f = s.frames;
    if (!current || obj !== carRef || f < current.last) {
      carRef = obj;
      current = { id: nextId++, pts: [], last: -Infinity, cp: 0, total: checkpoints, finish: null, max: 0 };
      runs.push(current);
      if (runs.length > MAX_RUNS) runs.shift();
    }
    const r = current;
    if (r.finish != null || f - r.last < STEP) return;
    const p = s.position,
      q = s.quaternion,
      prev = r.pts[r.pts.length - 1];
    r.pts.push({
      x: p.x,
      y: p.y,
      z: p.z,
      // The car's up and right axes, from its rotation: the line lies flat on whatever the car drives on.
      ux: 2 * (q.x * q.y - q.w * q.z),
      uy: 1 - 2 * (q.x * q.x + q.z * q.z),
      uz: 2 * (q.y * q.z + q.w * q.x),
      rx: 1 - 2 * (q.y * q.y + q.z * q.z),
      ry: 2 * (q.x * q.y + q.w * q.z),
      rz: 2 * (q.x * q.z - q.w * q.y),
      v: Math.abs(s.speedKmh ?? 0),
      f,
      gap: !!prev && Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z) > JUMP,
    });
    r.last = f;
    r.cp = s.nextCheckpointIndex ?? r.cp;
    r.max = Math.max(r.max, Math.abs(s.speedKmh ?? 0));
    if (s.finishFrames != null) r.finish = s.finishFrames;
  }

  // ---- the line -----------------------------------------------------------------------------------------------
  const shown = () => (picked != null ? runs.find((r) => r.id == picked) : null) ?? [...runs].reverse().find((r) => r.pts.length > 1) ?? null;
  // Slow is blue, through green and yellow, to red at the run's top speed.
  function speedColor(v, max) {
    const t = Math.max(0, Math.min(1, v / max)),
      h = (1 - t) * 0.66,
      k = (n) => (n + h * 12) % 12,
      f = (n) => 0.5 - 0.5 * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0), f(8), f(4)];
  }
  const topOf = (r) => Math.max(100, r.max);

  function removeLine() {
    for (const m of [mesh, pin]) {
      if (!m) continue;
      ed?.ctx.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    mesh = pin = null;
  }

  function drawLine() {
    removeLine();
    const r = shown();
    if (!ed || testing || !showLine || !r || r.pts.length < 2) return;
    const T = ed.three,
      P = r.pts,
      top = topOf(r),
      pos = [],
      col = [],
      at = []; // the point each triangle belongs to, for hovering
    const corner = (p, side) => [p.x - p.ux * DROP + p.rx * WIDTH * side, p.y - p.uy * DROP + p.ry * WIDTH * side, p.z - p.uz * DROP + p.rz * WIDTH * side];
    for (let i = 0; i + 1 < P.length; i++) {
      const a = P[i],
        b = P[i + 1];
      if (b.gap) continue;
      const ca = speedColor(a.v, top),
        cb = speedColor(b.v, top),
        al = corner(a, -1),
        ar = corner(a, 1),
        bl = corner(b, -1),
        br = corner(b, 1);
      pos.push(...al, ...ar, ...bl, ...ar, ...br, ...bl);
      col.push(...ca, ...ca, ...cb, ...ca, ...cb, ...cb);
      at.push(i, i);
    }
    const g = new T.LoY();
    g.setAttribute('position', new T.THS(new Float32Array(pos), 3));
    g.setAttribute('color', new T.THS(new Float32Array(col), 3));
    mesh = new T.eaF(g, new T.V9B({ vertexColors: true, side: 2, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    mesh.renderOrder = 10;
    mesh.userData.at = at;
    mesh.userData.run = r;
    ed.ctx.scene.add(mesh);

    // A pin where the run ended: green on a finish, red where the car stopped, fell or was reset.
    const e = P[P.length - 1],
      h = 2.2,
      s = 0.6,
      c = [e.x + e.ux * h, e.y + e.uy * h, e.z + e.uz * h],
      tip = [e.x, e.y, e.z],
      ring = [
        [c[0] + s, c[1], c[2]],
        [c[0], c[1], c[2] + s],
        [c[0] - s, c[1], c[2]],
        [c[0], c[1], c[2] - s],
      ],
      head = [c[0] + e.ux * s * 1.4, c[1] + e.uy * s * 1.4, c[2] + e.uz * s * 1.4],
      pp = [];
    for (let k = 0; k < 4; k++) pp.push(...ring[k], ...ring[(k + 1) % 4], ...tip, ...ring[(k + 1) % 4], ...ring[k], ...head);
    const pg = new T.LoY();
    pg.setAttribute('position', new T.THS(new Float32Array(pp), 3));
    pin = new T.eaF(pg, new T.V9B({ color: r.finish != null ? 0x2fd05a : 0xe8392c, side: 2, depthTest: false, transparent: true }));
    pin.renderOrder = 11;
    ed.ctx.scene.add(pin);
  }

  // ---- hovering the line --------------------------------------------------------------------------------------
  let ray = null;
  function hover(e) {
    if (!ed || !mesh || testing) return hideTip();
    const cv = ed.ctx.canvas,
      b = cv.getBoundingClientRect(),
      cam = ed.camera();
    if (!cam || e.target !== cv) return hideTip(); // over the 3D view, not a panel on top of it
    ray ??= new ed.three.tBo();
    ray.setFromCamera({ x: ((e.clientX - b.left) / b.width) * 2 - 1, y: -((e.clientY - b.top) / b.height) * 2 + 1 }, cam);
    const hit = ray.intersectObject(mesh, false)[0];
    if (!hit) return hideTip();
    const r = mesh.userData.run,
      p = r.pts[mesh.userData.at[hit.faceIndex]];
    ui.tip.textContent = Math.round(p.v) + ' km/h  ·  ' + clock(p.f);
    ui.tip.style.left = e.clientX + 14 + 'px';
    ui.tip.style.top = e.clientY + 14 + 'px';
    ui.tip.hidden = false;
  }
  const hideTip = () => ui && (ui.tip.hidden = true);

  // ---- the runs panel -----------------------------------------------------------------------------------------
  const clock = (ms) => {
    const m = Math.floor(ms / 60000),
      s = ((ms % 60000) / 1000).toFixed(3).padStart(6, '0');
    return m + ':' + s;
  };

  function makeUI() {
    const css = document.createElement('style');
    css.textContent = `
.be-runs { position: absolute; left: 198px; bottom: 0; z-index: 3; width: 430px; max-width: calc(100% - 198px - 420px); min-width: 250px; box-sizing: border-box;
  color: var(--text-color); background-color: var(--surface-transparent-color); pointer-events: auto; font-size: 17px; }
.be-runs[hidden], .be-runs [hidden], .be-tip[hidden], .be-recover[hidden] { display: none !important; }
.be-runs .be-head { display: flex; align-items: center; gap: 10px; padding: 4px 8px; }
.be-runs .be-head > button.be-title { flex: 1; margin: 0; padding: 2px 0; font: inherit; font-size: 19px; text-align: left; color: inherit; background: none; border: none; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.be-runs label { display: flex; align-items: center; gap: 5px; white-space: nowrap; cursor: pointer; }
.be-runs label input { margin: 0; accent-color: #6fb8ff; cursor: pointer; }
.be-runs .be-body { padding: 0 8px 8px 8px; }
.be-runs .be-legend { display: flex; align-items: center; gap: 6px; margin: 0 0 6px 0; font-size: 14px; opacity: 0.85; }
.be-runs .be-legend > i { flex: 1; height: 8px; background: linear-gradient(90deg, hsl(240 100% 50%), hsl(180 100% 50%), hsl(120 100% 50%), hsl(60 100% 50%), hsl(0 100% 50%)); }
.be-runs ol { margin: 0; padding: 0; list-style: none; max-height: 168px; overflow-y: auto; scrollbar-width: thin; }
.be-runs li { display: flex; gap: 8px; padding: 3px 6px; cursor: pointer; white-space: nowrap; }
.be-runs li:hover { background-color: var(--button-hover-color); }
.be-runs li.sel { background-color: var(--button-color); }
.be-runs li > .be-n { width: 30px; opacity: 0.7; }
.be-runs li > .be-res { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.be-runs li > .be-gap { opacity: 0.8; }
.be-runs li > .be-gap.best { color: #ffd84a; opacity: 1; }
.be-runs .be-empty { padding: 4px 0; font-size: 15px; opacity: 0.75; white-space: normal; }
.be-runs .be-foot { display: flex; justify-content: flex-end; gap: 6px; margin-top: 6px; }
.be-runs button.be-small { margin: 0; padding: 3px 10px; font: inherit; font-size: 15px; color: inherit; background-color: var(--button-color); border: none; cursor: pointer; }
.be-runs button.be-small:hover { background-color: var(--button-hover-color); }
.be-tip { position: fixed; z-index: 20; padding: 3px 8px; font-size: 16px; color: #fff; background: rgba(15, 15, 30, 0.85); pointer-events: none; white-space: nowrap; }
.be-recover { position: absolute; left: 50%; top: 118px; z-index: 4; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; padding: 8px 12px;
  color: var(--text-color); background-color: var(--surface-color); pointer-events: auto; font-size: 18px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35); max-width: calc(100% - 520px); }
.be-recover > span { flex: 1; }
.be-recover button { margin: 0; padding: 4px 12px; font: inherit; font-size: 17px; color: var(--text-color); background-color: var(--button-color); border: none; cursor: pointer; white-space: nowrap; }
.be-recover button:hover { background-color: var(--button-hover-color); }
@media (max-width: 1000px) { .be-runs { left: 0; bottom: 36px; max-width: calc(100% - 300px); min-width: 0; } .be-recover { max-width: calc(100% - 320px); } }
`;
    document.head.appendChild(css);
    const host = document.getElementById('ui') ?? document.body;
    const panel = document.createElement('div');
    panel.className = 'be-runs';
    panel.innerHTML =
      '<div class="be-head"><button class="be-title"></button><label title="Draw the line you drove in the selected test run"><input type="checkbox"> Line</label></div>' +
      '<div class="be-body"><div class="be-legend"><span>0</span><i></i><span class="be-top"></span></div><ol></ol><div class="be-empty">Press Test and drive: the line you take is drawn here, coloured by speed. Hover it for the speed at any point.</div>' +
      '<div class="be-foot"><button class="be-small be-end" title="Move the camera to where the selected run ended">Go to end</button><button class="be-small be-clear">Clear runs</button></div></div>';
    host.appendChild(panel);
    const tip = document.createElement('div');
    tip.className = 'be-tip';
    tip.hidden = true;
    document.body.appendChild(tip);
    const recover = document.createElement('div');
    recover.className = 'be-recover';
    recover.hidden = true;
    recover.innerHTML = '<span></span><button class="be-restore">Restore</button><button class="be-discard">Discard</button>';
    host.appendChild(recover);

    const q = (s) => panel.querySelector(s);
    const u = { panel, tip, recover, title: q('.be-title'), body: q('.be-body'), list: q('ol'), empty: q('.be-empty'), top: q('.be-top'), line: q('input'), legend: q('.be-legend'), clear: q('.be-clear'), end: q('.be-end') };
    u.line.checked = showLine;
    u.body.hidden = store.get(PANEL_KEY) == '0';
    u.title.addEventListener('click', () => {
      u.body.hidden = !u.body.hidden;
      store.set(PANEL_KEY, u.body.hidden ? '0' : '1');
      refresh();
    });
    u.line.addEventListener('change', () => {
      showLine = u.line.checked;
      store.set(LINE_KEY, showLine ? '1' : '0');
      drawLine();
    });
    u.end.addEventListener('click', () => {
      const r = shown(),
        e = r?.pts[r.pts.length - 1];
      if (e) ed?.look?.(e.x, e.y, e.z);
      hideTip();
    });
    u.clear.addEventListener('click', () => {
      runs = [];
      picked = null;
      current = null;
      drawLine();
      refresh();
    });
    // Keys typed into the panel (none today) and clicks on it never reach the editor underneath.
    for (const ev of ['mousedown', 'touchstart', 'wheel']) panel.addEventListener(ev, (e) => e.stopPropagation());
    window.addEventListener('mousemove', hover, { passive: true });
    return u;
  }

  function refresh() {
    if (!ui) return;
    const done = runs.filter((r) => r.pts.length > 1),
      best = Math.min(...done.filter((r) => r.finish != null).map((r) => r.finish)),
      sel = shown(),
      last = done[done.length - 1];
    ui.title.textContent =
      (ui.body.hidden ? '▸ ' : '▾ ') + 'Test runs' + (last ? ':  ' + (last.finish != null ? clock(last.finish) : 'no finish') + (last.finish != null && last.finish == best && done.length > 1 ? ' ★' : '') : '');
    ui.list.textContent = '';
    for (const r of [...done].reverse()) {
      const li = document.createElement('li'),
        n = document.createElement('span'),
        res = document.createElement('span'),
        gap = document.createElement('span');
      n.className = 'be-n';
      res.className = 'be-res';
      gap.className = 'be-gap';
      n.textContent = '#' + r.id;
      if (r.finish != null) {
        res.textContent = clock(r.finish) + '  ·  top ' + Math.round(r.max) + ' km/h';
        if (r.finish == best) {
          gap.textContent = '★ best';
          gap.classList.add('best');
        } else gap.textContent = '+' + ((r.finish - best) / 1000).toFixed(3);
      } else res.textContent = 'No finish  ·  ' + (r.total ? 'checkpoint ' + r.cp + '/' + r.total + '  ·  ' : '') + clock(r.last);
      li.append(n, res, gap);
      if (r === sel) li.className = 'sel';
      li.title = 'Show this run’s line';
      li.addEventListener('click', () => {
        picked = r.id;
        if (!showLine) {
          showLine = ui.line.checked = true;
          store.set(LINE_KEY, '1');
        }
        drawLine();
        refresh();
      });
      ui.list.appendChild(li);
    }
    ui.empty.hidden = done.length > 0;
    ui.legend.hidden = !sel;
    ui.clear.hidden = ui.end.hidden = done.length == 0;
    if (sel) ui.top.textContent = Math.round(topOf(sel)) + ' km/h';
  }

  // ---- recovery -----------------------------------------------------------------------------------------------
  const standalone = window.parent === window;
  let saver = null;
  let wasDirty = false;

  function autosave() {
    if (!ed || testing || !self.__beEditorDirty || !self.__beEditorCurrent) return;
    const dirty = self.__beEditorDirty();
    if (dirty) {
      try {
        const t = self.__beEditorCurrent();
        store.set(RECOVERY_KEY, JSON.stringify({ name: t.name, code: t.code, time: Date.now() }));
      } catch {}
    } else if (wasDirty) store.set(RECOVERY_KEY, null); // saved, or the changes were thrown away on purpose
    wasDirty = dirty;
  }

  const ago = (t) => {
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : new Date(t).toLocaleDateString();
  };

  function offerRecovery() {
    let saved = null;
    try {
      saved = JSON.parse(store.get(RECOVERY_KEY) ?? 'null');
    } catch {}
    if (!saved || !saved.code) return;
    ui.recover.querySelector('span').textContent = 'Unsaved changes to ' + (saved.name ? '“' + saved.name + '”' : 'an unnamed track') + ' from ' + ago(saved.time) + '.';
    ui.recover.hidden = false;
    ui.recover.querySelector('.be-restore').onclick = () => {
      ui.recover.hidden = true;
      const parsed = self.__beTrackData?.fromExportString(saved.code);
      if (!parsed || !self.__beEditorOpen) return;
      self.__beEditorOpen(parsed.trackMetadata, null, () => Promise.resolve(parsed.trackData));
    };
    ui.recover.querySelector('.be-discard').onclick = () => {
      ui.recover.hidden = true;
      // Only if it still holds the offered copy: editing since then has saved the new changes over it.
      if (store.get(RECOVERY_KEY)?.includes("\"time\":" + saved.time)) store.set(RECOVERY_KEY, null);
    };
  }

  return {
    car,
    runs: () => runs, // for tools/test/tools.mjs
    // What is drawn, for tools/test/tools.mjs.
    drawn: () => ({ line: !!mesh, pin: pin ? pin.geometry.attributes.position.count : 0, inScene: !!pin && ed?.ctx.scene.children.includes(pin) }),
    // ctx: the renderer context (scene, canvas); three: the bundle's three.js; camera(): the editor camera;
    // look(x, y, z): points the editor camera at a spot.
    open(ctx, three, camera, look) {
      ed = { ctx, three, camera, look };
      ui ??= makeUI();
      ui.panel.hidden = false;
      runs = [];
      picked = null;
      current = null;
      refresh();
      if (standalone) {
        wasDirty = false;
        offerRecovery();
        saver = setInterval(autosave, 4000);
      }
    },
    close() {
      removeLine();
      clearInterval(saver);
      if (ui) ui.panel.hidden = ui.recover.hidden = true;
      hideTip();
      ed = null;
      testing = false;
    },
    // trackMesh: the editor's track, for its checkpoint count.
    testStart(trackMesh) {
      autosave();
      testing = true;
      carRef = current = null;
      try {
        checkpoints = trackMesh.getTotalNumberOfCheckpointIndices() ?? 0;
      } catch {
        checkpoints = 0;
      }
      removeLine();
      hideTip();
      if (ui) ui.panel.hidden = ui.recover.hidden = true;
    },
    testEnd() {
      testing = false;
      carRef = current = null;
      runs = runs.filter((r) => r.pts.length > 1);
      // Runs from another track (one loaded or generated since) start somewhere else: drop them.
      const last = runs[runs.length - 1];
      if (last) runs = runs.filter((r) => Math.hypot(r.pts[0].x - last.pts[0].x, r.pts[0].y - last.pts[0].y, r.pts[0].z - last.pts[0].z) < 30);
      picked = null;
      if (ui) ui.panel.hidden = false;
      drawLine();
      refresh();
    },
  };
})();
