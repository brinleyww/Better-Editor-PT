// The Plastic and Wood block browser in the editor's side panel. Page only, loaded after tm_runtime.js.
// Keeps the game's own look: its navy surfaces, button colours, font and section headings.
(() => {
  const TABS = self.TM.data.tabs;
  const RECENT_KEY = 'better_editor_recent_parts';
  const RECENT_MAX = 12;
  let thumb = null; // set by the editor: (partId, img) => renders the thumbnail for the current environment
  const panels = new Map(); // part-panel element -> its browser state
  const owner = new Map(); // part id -> { state, entry }

  const css = document.createElement('style');
  css.textContent = `
.editor-ui > .side > .side-panel > .part-panel.tm { padding: 0; overflow: hidden; width: 372px; }
.editor-ui > .side > .side-panel > .part-panel.tm:not(.hidden) { display: inline-flex; flex-direction: column; }
.part-panel.tm .tm-head { flex: none; padding: 6px 6px 4px 6px; background-color: var(--surface-color); }
.part-panel.tm .tm-search { display: block; box-sizing: border-box; width: 100%; padding: 4px 8px; font: inherit; font-size: 20px; color: var(--text-color);
  background-color: var(--button-color); border: 2px solid rgb(38, 31, 88); outline: none; pointer-events: auto; }
.part-panel.tm .tm-search:focus { border-color: #fff; }
.part-panel.tm .tm-search::placeholder { color: var(--text-color); opacity: 0.55; }
.part-panel.tm .tm-name { height: 22px; margin-top: 4px; font-size: 16px; line-height: 22px; color: var(--text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.part-panel.tm .tm-body { flex: 1; display: flex; min-height: 0; }
.part-panel.tm .tm-tabs { flex: none; width: 98px; padding: 2px; box-sizing: border-box; overflow-y: auto; scrollbar-width: thin; background-color: var(--surface-color); }
.editor-ui > .side > .side-panel .part-panel.tm .tm-tabs button { display: block; width: 100%; margin: 0 0 2px 0; padding: 7px 3px; font: inherit; font-size: 16px; line-height: 17px; text-align: left; color: var(--text-color); }
.editor-ui > .side > .side-panel .part-panel.tm .tm-tabs button.empty { display: none; }
.part-panel.tm .tm-list { flex: 1; min-width: 0; padding: 0 2px 8px 4px; overflow-x: hidden; overflow-y: scroll; scrollbar-width: thin; }
.part-panel.tm .tm-heading { margin: 8px 2px 4px 2px; padding-bottom: 1px; font-size: 15px; font-style: italic; color: var(--text-color); opacity: 0.8; border-bottom: 1px solid rgba(255, 255, 255, 0.7); }
.part-panel.tm .tm-grid { display: grid; grid-template-columns: repeat(3, 78px); gap: 2px; }
.editor-ui > .side > .side-panel .part-panel.tm .tm-grid button { margin: 0; }
.part-panel.tm .tm-none { padding: 14px 4px; font-size: 18px; color: var(--text-color); opacity: 0.75; }
.part-panel.tm .tm-group.off, .part-panel.tm .tm-grid button.off, .part-panel.tm .tm-heading.off { display: none; }
@media (max-width: 860px) { .editor-ui > .side > .side-panel > .part-panel.tm { width: 292px; } .part-panel.tm .tm-grid { grid-template-columns: repeat(2, 78px); } }
`;
  document.head.appendChild(css);

  const loadRecent = () => {
    try {
      const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
      return Array.isArray(v) ? v.filter((id) => self.TM.byId.has(id)) : [];
    } catch {
      return [];
    }
  };
  const saveRecent = (l) => {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(l));
    } catch {}
  };

  // Only draw thumbnails that are on screen: rendering every block up front would stall the menu.
  const seen = new IntersectionObserver((list) => {
    for (const it of list) {
      if (!it.isIntersecting) continue;
      const img = it.target.querySelector('img');
      if (img && !img.hasAttribute('src') && thumb) thumb(+it.target.dataset.tm, img);
    }
  });

  function build(panel) {
    panel.classList.add('tm');
    const head = document.createElement('div');
    head.className = 'tm-head';
    const search = document.createElement('input');
    search.className = 'tm-search';
    search.type = 'text';
    search.placeholder = 'Search blocks';
    search.spellcheck = false;
    const name = document.createElement('div');
    name.className = 'tm-name';
    head.append(search, name);
    const body = document.createElement('div');
    body.className = 'tm-body';
    const tabs = document.createElement('div');
    tabs.className = 'tm-tabs';
    const list = document.createElement('div');
    list.className = 'tm-list';
    const none = document.createElement('div');
    none.className = 'tm-none';
    none.textContent = 'No blocks found';
    none.style.display = 'none';
    body.append(tabs, list);
    panel.append(head, body);

    const state = { panel, search, name, tabs, list, none, tab: TABS[0], groups: new Map(), tabButtons: new Map(), entries: [], selected: null, recentGroup: null };

    const tabButton = (t) => {
      const b = document.createElement('button');
      b.textContent = t;
      b.addEventListener('click', () => {
        search.value = '';
        setTab(state, t);
      });
      if (t != 'Recent') b.classList.add('empty');
      tabs.appendChild(b);
      state.tabButtons.set(t, b);
    };
    tabButton('Recent');
    for (const t of TABS) tabButton(t);
    list.appendChild(none);

    // Typing must not reach the editor's shortcuts (WASD moves the camera, R rotates, ...).
    for (const type of ['keydown', 'keyup', 'keypress']) search.addEventListener(type, (e) => {
      e.stopPropagation();
      if (type == 'keydown' && e.key == 'Escape') {
        search.value = '';
        search.blur();
        applyFilter(state);
      }
    });
    search.addEventListener('input', () => applyFilter(state));
    panel.addEventListener('wheel', (e) => e.stopPropagation());
    panels.set(panel, state);
    return state;
  }

  function group(state, tab, sub) {
    let g = state.groups.get(tab);
    if (!g) {
      g = { el: document.createElement('div'), subs: new Map() };
      g.el.className = 'tm-group off';
      state.list.appendChild(g.el);
      state.groups.set(tab, g);
    }
    let s = g.subs.get(sub);
    if (!s) {
      const h = document.createElement('div');
      h.className = 'tm-heading';
      h.textContent = sub;
      const grid = document.createElement('div');
      grid.className = 'tm-grid';
      g.el.append(h, grid);
      s = { heading: h, grid };
      g.subs.set(sub, s);
    }
    return s;
  }

  function setTab(state, tab) {
    state.tab = tab;
    for (const [t, b] of state.tabButtons) b.classList.toggle('selected', t == tab);
    if (tab == 'Recent') fillRecent(state);
    applyFilter(state);
    state.list.scrollTop = 0;
  }

  function applyFilter(state) {
    const q = state.search.value.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    let shown = 0;
    if (state.recentGroup) state.recentGroup.classList.toggle('off', state.tab != 'Recent' || words.length > 0);
    if (state.tab == 'Recent' && !words.length) shown += state.recentCount ?? 0;
    for (const [t, g] of state.groups) {
      let any = false;
      for (const s of g.subs.values()) {
        let subAny = false;
        for (const b of s.grid.children) {
          const e = b.__tm;
          const match = words.length ? words.every((w) => e.hay.includes(w)) : t == state.tab;
          b.classList.toggle('off', !match);
          if (match) {
            subAny = true;
            shown++;
          }
        }
        s.heading.classList.toggle('off', !subAny);
        any = any || subAny;
      }
      g.el.classList.toggle('off', !any);
    }
    state.none.textContent = state.tab == 'Recent' && !words.length ? 'Blocks you place show up here' : 'No blocks found';
    state.none.style.display = shown == 0 ? 'block' : 'none';
    for (const [t, b] of state.tabButtons) b.classList.toggle('selected', !words.length && t == state.tab);
  }

  function fillRecent(state) {
    if (!state.recentGroup) {
      state.recentGroup = document.createElement('div');
      state.recentGroup.className = 'tm-group off';
      state.list.insertBefore(state.recentGroup, state.none.nextSibling);
    }
    const g = state.recentGroup;
    g.textContent = '';
    const grid = document.createElement('div');
    grid.className = 'tm-grid';
    grid.style.marginTop = '6px';
    let n = 0;
    for (const id of loadRecent()) {
      const o = owner.get(id);
      if (!o || o.state != state) continue;
      const src = o.entry.button;
      const b = document.createElement('button');
      const img = document.createElement('img');
      const orig = o.entry.image;
      if (orig.getAttribute('src')) img.src = orig.src;
      else {
        img.className = 'loading';
        thumb?.(id, orig);
        const copy = () => {
          img.src = orig.src;
          img.className = '';
        };
        orig.addEventListener('load', copy, { once: true });
      }
      b.appendChild(img);
      b.title = o.entry.label;
      b.addEventListener('click', () => src.click());
      b.addEventListener('mouseenter', () => (state.name.textContent = o.entry.label));
      grid.appendChild(b);
      n++;
    }
    state.recentCount = n;
    g.appendChild(grid);
  }

  const describe = (p) => {
    const size = (a) => Math.round((p.b[1][a] - p.b[0][a]) / 5) || 1;
    return p.l + ' (' + Math.max(1, Math.round(size(0) / 4)) + 'x' + Math.max(1, Math.round(size(2) / 4)) + ', ' + size(1) + ' high)';
  };

  self.TM.ui = {
    setThumbnailRenderer(fn) {
      thumb = fn;
    },
    add(panel, button, image, part) {
      const state = panels.get(panel) ?? build(panel);
      const s = group(state, part.t, part.s);
      state.tabButtons.get(part.t)?.classList.remove('empty');
      const label = describe(part);
      const entry = { part, button, image, label, hay: (part.l + ' ' + part.s + ' ' + part.t).toLowerCase() };
      button.__tm = entry;
      button.dataset.tm = part.i;
      button.title = label;
      button.addEventListener('mouseenter', () => (state.name.textContent = label));
      button.addEventListener('mouseleave', () => (state.name.textContent = state.selected?.label ?? ''));
      s.grid.appendChild(button);
      state.entries.push(entry);
      owner.set(part.i, { state, entry });
      seen.observe(button);
      if (state.entries.length == 1) setTab(state, part.t);
    },
    // Keeps the visible tab on the selected block, including when the pipette picks one from the track.
    onSelect(part) {
      if (!part) return;
      const o = owner.get(part.i);
      if (!o) return;
      const { state, entry } = o;
      state.selected = entry;
      state.name.textContent = entry.label;
      const visible = !entry.button.classList.contains('off');
      if (!visible && state.tab != 'Recent') {
        state.search.value = '';
        setTab(state, part.t);
      }
      if (!entry.button.classList.contains('off')) entry.button.scrollIntoView({ block: 'nearest' });
    },
    // Called when a block is actually placed.
    onPlaced(id) {
      if (!self.TM.isTM(id)) return;
      const l = loadRecent().filter((x) => x != id);
      l.unshift(id);
      l.length = Math.min(l.length, RECENT_MAX);
      saveRecent(l);
      const o = owner.get(id);
      if (o && o.state.tab == 'Recent') {
        fillRecent(o.state);
        applyFilter(o.state);
      }
    },
    // Environment changed: stock code cleared the images, draw whatever is on screen again.
    refresh() {
      for (const st of panels.values())
        for (const e of st.entries) {
          seen.unobserve(e.button);
          seen.observe(e.button);
        }
    },
    skipEager(entry) {
      if (!entry.trackPartData?.configuration.tm) return false;
      entry.image.removeAttribute('src');
      entry.image.className = 'loading';
      return true;
    },
  };
})();
