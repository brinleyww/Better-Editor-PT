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

  // A stopwatch, drawn like the game's own white button icons.
  const ICON =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2"><circle cx="12" cy="13.5" r="8.5"/><path d="M12 13.5V8.6M9 2h6M12 2v3M19.2 5.8l1.6-1.6" stroke-linecap="round"/></svg>',
    );

  let css = null;
  function addCSS() {
    css = document.createElement('style');
    css.textContent = `
.be-runs { display: inline-block; position: relative; vertical-align: top; margin: -1px 0 0 -6px; }
.be-runs [hidden], .be-tip[hidden], .be-recover[hidden] { display: none !important; }
.be-runs > .be-runs-tab { padding: 6px 7px 6px 16px; clip-path: polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%); background: var(--surface-secondary-color); pointer-events: auto; }
.be-runs > .be-runs-tab > .button { white-space: nowrap; }
.be-runs > .be-runs-tab > .button > .be-last { margin-left: 10px; font-size: 24px; opacity: 0.75; }
.be-runs > .be-runs-tab > .button.open { background-color: var(--button-hover-color); }
.be-runs > .be-runs-panel { position: absolute; left: 0; top: calc(100% + 6px); box-sizing: border-box; width: 540px; padding: 12px 26px 14px 12px;
  clip-path: polygon(0 0, 100% 0, calc(100% - 14px) 100%, 0 100%); color: var(--text-color); background-color: var(--surface-color); pointer-events: auto; font-size: 22px; }
.be-runs-panel > .be-runs-head { display: flex; align-items: center; gap: 12px; margin: 0 0 8px 0; }
.be-runs-panel > .be-runs-head > span { flex: 1; font-size: 26px; }
.be-runs-panel .button.be-small { padding: 4px 16px; font-size: 20px; }
.be-runs-panel > .be-legend { display: flex; align-items: center; gap: 8px; margin: 0 0 8px 0; font-size: 17px; }
.be-runs-panel > .be-legend > i { flex: 1; height: 8px; background: linear-gradient(90deg, hsl(240 100% 55%), hsl(180 100% 50%), hsl(120 100% 45%), hsl(60 100% 50%), hsl(0 100% 55%)); }
.be-runs-panel > .be-list { max-height: 214px; overflow-y: auto; scrollbar-width: thin; }
.be-runs-panel > .be-list > .button { display: flex; gap: 12px; box-sizing: border-box; width: calc(100% - 4px); margin: 0 0 4px 0; padding: 5px 20px; font-size: 20px; text-align: left; white-space: nowrap; }
.be-runs-panel > .be-list > .button.sel { background-color: var(--button-hover-color); }
.be-runs-panel > .be-list > .button > .be-n { width: 34px; opacity: 0.6; }
.be-runs-panel > .be-list > .button > .be-res { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.be-runs-panel > .be-list > .button > .be-gap.best { color: #ffd84a; }
.be-runs-panel > .be-empty { margin: 4px 0 2px 0; font-size: 19px; line-height: 1.35; color: var(--text-color); opacity: 0.8; white-space: normal; }
.be-runs-panel > .be-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.be-tip { position: fixed; z-index: 20; padding: 4px 14px; clip-path: polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%); font-size: 18px; color: var(--text-color);
  background-color: var(--surface-color); pointer-events: none; white-space: nowrap; }
.be-recover { position: absolute; left: 50%; bottom: 14px; z-index: 4; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; padding: 10px 26px 10px 18px;
  clip-path: polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%); color: var(--text-color); background-color: var(--surface-color); pointer-events: auto; font-size: 22px; white-space: nowrap; }
.be-recover > .button { padding: 4px 16px; font-size: 20px; }
`;
    document.head.appendChild(css);
    window.addEventListener('mousemove', hover, { passive: true });
  }

  // Builds the Runs tab next to the track name in this editor's top bar, and its drop-down panel. The tab lives in the
  // editor's own UI, so it hides with it while testing. Returns null if the editor has no top bar to put it in.
  function makeUI() {
    css ?? addCSS();
    const root = document.querySelector('#ui > .editor-ui') ?? document.querySelector('.editor-ui'),
      settings = root?.querySelector('.top > .track-settings-container');
    if (!settings) return null;
    const box = document.createElement('div');
    box.className = 'be-runs';
    box.innerHTML =
      '<div class="be-runs-tab"><button class="button" title="Your test runs, and the line you drove"><img class="button-icon" src="' + ICON + '"> Runs<span class="be-last"></span></button></div>' +
      '<div class="be-runs-panel" hidden>' +
      '<div class="be-runs-head"><span>Test runs</span><button class="button be-small be-line" title="Draw the line you drove on the track"></button></div>' +
      '<div class="be-legend"><span>0</span><i></i><span class="be-top"></span></div>' +
      '<div class="be-list"></div>' +
      '<p class="be-empty">Press Test and drive. The line you take is drawn on the track, coloured by speed, and you can hover it for the speed at any point.</p>' +
      '<div class="be-foot"><button class="button be-small be-end" title="Move the camera to where the selected run ended">Go to end</button><button class="button be-small be-clear">Clear</button></div>' +
      '</div>';
    settings.after(box);
    const tip = document.createElement('div');
    tip.className = 'be-tip';
    tip.hidden = true;
    document.body.appendChild(tip);
    const recover = document.createElement('div');
    recover.className = 'be-recover';
    recover.hidden = true;
    recover.innerHTML = '<span></span><button class="button be-restore">Restore</button><button class="button be-discard">Discard</button>';
    root.appendChild(recover);

    const q = (s) => box.querySelector(s);
    const u = { box, tip, recover, tab: q('.be-runs-tab > .button'), last: q('.be-last'), panel: q('.be-runs-panel'), list: q('.be-list'), empty: q('.be-empty'), top: q('.be-top'), line: q('.be-line'), legend: q('.be-legend'), foot: q('.be-foot'), clear: q('.be-clear'), end: q('.be-end') };
    u.panel.hidden = store.get(PANEL_KEY) != '1';
    u.tab.addEventListener('click', () => {
      u.panel.hidden = !u.panel.hidden;
      store.set(PANEL_KEY, u.panel.hidden ? '0' : '1');
      refresh();
    });
    u.line.addEventListener('click', () => {
      showLine = !showLine;
      store.set(LINE_KEY, showLine ? '1' : '0');
      drawLine();
      refresh();
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
    // Clicks and the wheel on the panel stay on the panel instead of building or zooming underneath.
    for (const ev of ['mousedown', 'touchstart', 'wheel']) box.addEventListener(ev, (e) => e.stopPropagation());
    return u;
  }

  function refresh() {
    if (!ui) return;
    const done = runs.filter((r) => r.pts.length > 1),
      best = Math.min(...done.filter((r) => r.finish != null).map((r) => r.finish)),
      sel = shown(),
      last = done[done.length - 1];
    ui.tab.classList.toggle('open', !ui.panel.hidden);
    ui.last.textContent = last ? (last.finish != null ? clock(last.finish) + (last.finish == best && done.length > 1 ? ' ★' : '') : 'No finish') : '';
    ui.line.textContent = 'Line: ' + (showLine ? 'On' : 'Off');
    ui.list.textContent = '';
    for (const r of [...done].reverse()) {
      const row = document.createElement('button'),
        n = document.createElement('span'),
        res = document.createElement('span'),
        gap = document.createElement('span');
      row.className = 'button' + (r === sel ? ' sel' : '');
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
      } else res.textContent = 'No finish  ·  ' + (r.total ? 'CP ' + r.cp + '/' + r.total + '  ·  ' : '') + clock(r.last);
      row.append(n, res, gap);
      row.title = 'Show this run’s line';
      row.addEventListener('click', () => {
        picked = r.id;
        showLine = true;
        store.set(LINE_KEY, '1');
        drawLine();
        refresh();
      });
      ui.list.appendChild(row);
    }
    ui.empty.hidden = done.length > 0;
    ui.legend.hidden = !sel || !showLine;
    ui.foot.hidden = done.length == 0;
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
      ui = makeUI();
      runs = [];
      picked = null;
      current = null;
      refresh();
      if (standalone && ui) {
        wasDirty = false;
        offerRecovery();
        saver = setInterval(autosave, 4000);
      }
    },
    close() {
      removeLine();
      clearInterval(saver);
      hideTip();
      ui?.tip.remove();
      ui = null; // the tab and the recovery bar go with the editor's own UI
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
      if (ui) ui.recover.hidden = true;
    },
    testEnd() {
      testing = false;
      carRef = current = null;
      runs = runs.filter((r) => r.pts.length > 1);
      // Runs from another track (one loaded or generated since) start somewhere else: drop them.
      const last = runs[runs.length - 1];
      if (last) runs = runs.filter((r) => Math.hypot(r.pts[0].x - last.pts[0].x, r.pts[0].y - last.pts[0].y, r.pts[0].z - last.pts[0].z) < 30);
      picked = null;
      drawLine();
      refresh();
    },
  };
})();
