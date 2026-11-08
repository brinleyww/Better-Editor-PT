// The block browser in the editor's side panel: one for each surface, and one for the stock road blocks.
// Page only, loaded after tm_runtime.js.
// Keeps the game's own look: its navy surfaces, button colours, font and section headings.
(() => {
  const TABS = self.TM.data.tabs;
  // The new block kits in part.f order; their categories are 9 + f in the game's enum. Older tables had these five.
  const FAMILIES = self.TM.data.families ?? ['Plastic', 'Wood', 'Stadium', 'Ice', 'Water'];
  const ROAD = 'road'; // the stock blocks' browser; not a number, so it never meets a kit's f
  // The stock blocks, by their enum names: [tab, heading, [[name, label], ...]]. Tabs are the game's old categories.
  const ROAD_LAYOUT = [
    ['Gates', 'Start', [['Start', 'Start'], ['StartWide', 'Start, wide'], ['PlaneStart', 'Start on plane'], ['PlaneStartWide', 'Start on plane, wide']]],
    ['Gates', 'Checkpoint', [['Checkpoint', 'Checkpoint'], ['CheckpointWide', 'Checkpoint, wide'], ['PlaneCheckpoint', 'Checkpoint on plane'], ['PlaneCheckpointWide', 'Checkpoint on plane, wide']]],
    ['Gates', 'Finish', [['Finish', 'Finish'], ['FinishWide', 'Finish, wide'], ['PlaneFinish', 'Finish on plane'], ['PlaneFinishWide', 'Finish on plane, wide']]],
    ['Road', 'Straights', [['Straight', 'Straight'], ['StraightPillarBottom', 'Straight on pillar'], ['StraightPillarShort', 'Straight on short pillar']]],
    ['Road', 'Sharp turns', [['TurnSharp', 'Sharp turn'], ['TurnSharpPillarBottom', 'Sharp turn on pillar'], ['TurnSharpPillarShort', 'Sharp turn on short pillar']]],
    ['Road', 'Junctions', [
      ['IntersectionT', 'T junction'], ['IntersectionTPillarBottom', 'T junction on pillar'], ['IntersectionTPillarShort', 'T junction on short pillar'],
      ['IntersectionCross', 'Crossroads'], ['IntersectionCrossPillarBottom', 'Crossroads on pillar'], ['IntersectionCrossPillarShort', 'Crossroads on short pillar'],
      ['IntersectionY', 'Y junction'], ['IntersectionYLong', 'Y junction, long'],
    ]],
    ['Road', 'Slopes', [['SlopeUp', 'Slope up'], ['SlopeUpLong', 'Slope up, long'], ['SlopeDown', 'Slope down'], ['SlopeDownLong', 'Slope down, long'], ['Slope', 'Slope']]],
    ['Road', 'Steep slopes', [['SlopeUpVertical', 'Slope up to vertical'], ['SlopeToVertical', 'Slope to vertical']]],
    ['Road', 'Banked', [['StraightTilted', 'Banked straight'], ['ToTiltedLeft', 'To banked, left'], ['ToTiltedRight', 'To banked, right']]],
    ['Turns', 'Turns', [['TurnShort', 'Short turn'], ['TurnLong', 'Long turn'], ['TurnLong2', 'Long turn 2'], ['TurnLong3', 'Long turn 3']]],
    ['Turns', 'S-turns', [['TurnSLeft', 'S-turn, left'], ['TurnSRight', 'S-turn, right'], ['TurnSLongLeft', 'Long S-turn, left'], ['TurnSLongRight', 'Long S-turn, right']]],
    ['Turns', 'Turns onto wide road', [['TurnShortLeftWide', 'Short turn, left'], ['TurnShortRightWide', 'Short turn, right'], ['TurnLongLeftWide', 'Long turn, left'], ['TurnLongRightWide', 'Long turn, right']]],
    ['Turns', 'Banked turns', [['TurnShortTilted', 'Banked short turn'], ['TurnLongTilted', 'Banked long turn'], ['TurnLong2Tilted', 'Banked long turn 2'], ['TurnLong3Tilted', 'Banked long turn 3']]],
    ['Wide road', 'To wide road', [['ToWideMiddle', 'To wide, middle'], ['ToWideLeft', 'To wide, left'], ['ToWideRight', 'To wide, right'], ['ToWideDouble', 'To wide, double'], ['ToWideDiagonal', 'To wide, diagonal']]],
    ['Wide road', 'Straights and corners', [['StraightWide', 'Wide straight'], ['InnerCornerWide', 'Inner corner'], ['OuterCornerWide', 'Outer corner']]],
    ['Wide road', 'Slopes', [
      ['SlopeUpLeftWide', 'Slope up, left'], ['SlopeUpRightWide', 'Slope up, right'], ['SlopeUpLongLeftWide', 'Slope up long, left'], ['SlopeUpLongRightWide', 'Slope up long, right'],
      ['SlopeDownLeftWide', 'Slope down, left'], ['SlopeDownRightWide', 'Slope down, right'], ['SlopeDownLongLeftWide', 'Slope down long, left'], ['SlopeDownLongRightWide', 'Slope down long, right'],
      ['SlopeLeftWide', 'Slope, left'], ['SlopeRightWide', 'Slope, right'],
    ]],
    ['Wide road', 'Steep slopes', [['SlopeUpVerticalLeftWide', 'Slope up to vertical, left'], ['SlopeUpVerticalRightWide', 'Slope up to vertical, right'], ['SlopeToVerticalLeftWide', 'Slope to vertical, left'], ['SlopeToVerticalRightWide', 'Slope to vertical, right']]],
    ['Planes', 'Flat', [['Plane', 'Plane'], ['PlanePillarBottom', 'Plane on pillar'], ['PlanePillarShort', 'Plane on short pillar'], ['HalfPlane', 'Half plane'], ['QuarterPlane', 'Quarter plane'], ['PlaneCorner', 'Plane corner']]],
    ['Planes', 'Slopes', [
      ['PlaneSlopeUp', 'Slope up'], ['PlaneSlopeUpLong', 'Slope up, long'], ['PlaneSlopeDown', 'Slope down'], ['PlaneSlopeDownLong', 'Slope down, long'], ['PlaneSlope', 'Slope'],
      ['HalfPlaneSlopeBottomLeft', 'Half slope, bottom left'], ['HalfPlaneSlopeBottomRight', 'Half slope, bottom right'], ['HalfPlaneSlopeTopLeft', 'Half slope, top left'], ['HalfPlaneSlopeTopRight', 'Half slope, top right'],
    ]],
    ['Planes', 'Steep slopes', [['PlaneSlopeVerticalBottom', 'Vertical slope, bottom'], ['PlaneSlopeToVertical', 'Slope to vertical']]],
    ['Planes', 'Bridges', [['PlaneBridge', 'Bridge'], ['PlaneBridgeCorner', 'Bridge corner'], ['PlaneBridgeIntersectionT', 'Bridge T junction'], ['PlaneBridgeIntersectionCross', 'Bridge crossroads']]],
    ['Planes', 'Walls', [['PlaneWall', 'Wall'], ['PlaneWallCorner', 'Wall corner'], ['PlaneWallInnerCorner', 'Wall inner corner']]],
    ['Planes', 'Wall slopes', [
      ['PlaneWallSlopeLeft', 'Wall slope, left'], ['PlaneWallSlopeRight', 'Wall slope, right'],
      ['PlaneWallSlopeUpLeft', 'Wall slope up, left'], ['PlaneWallSlopeUpRight', 'Wall slope up, right'], ['PlaneWallSlopeDownLeft', 'Wall slope down, left'], ['PlaneWallSlopeDownRight', 'Wall slope down, right'],
      ['PlaneWallSlopeUpLongLeft', 'Wall slope up long, left'], ['PlaneWallSlopeUpLongRight', 'Wall slope up long, right'], ['PlaneWallSlopeDownLongLeft', 'Wall slope down long, left'], ['PlaneWallSlopeDownLongRight', 'Wall slope down long, right'],
    ]],
    ['Blocks', 'Blocks', [['Block', 'Block'], ['HalfBlock', 'Half block'], ['QuarterBlock', 'Quarter block'], ['BlockInnerCorner', 'Inner corner'], ['BlockOuterCorner', 'Outer corner']]],
    ['Blocks', 'Sloped edges', [
      ['BlockSlopedDown', 'Sloped down'], ['BlockSlopedDownInnerCorner', 'Sloped down, inner corner'], ['BlockSlopedDownOuterCorner', 'Sloped down, outer corner'],
      ['BlockSlopedUp', 'Sloped up'], ['BlockSlopedUpInnerCorner', 'Sloped up, inner corner'], ['BlockSlopedUpOuterCorner', 'Sloped up, outer corner'],
    ]],
    ['Blocks', 'Slopes', [
      ['BlockSlopeUp', 'Slope up'], ['BlockSlopeUpLong', 'Slope up, long'], ['BlockSlopeDown', 'Slope down'], ['BlockSlopeDownLong', 'Slope down, long'],
      ['HalfBlockSlopeBottomLeft', 'Half slope, bottom left'], ['HalfBlockSlopeBottomRight', 'Half slope, bottom right'], ['HalfBlockSlopeTopLeft', 'Half slope, top left'], ['HalfBlockSlopeTopRight', 'Half slope, top right'],
    ]],
    ['Blocks', 'Steep slopes', [
      ['BlockSlopeVerticalTop', 'Vertical slope, top'], ['BlockSlopeVerticalBottom', 'Vertical slope, bottom'], ['BlockSlopeToVertical', 'Slope to vertical'],
      ['BlockSlopeVerticalCornerTop', 'Vertical corner, top'], ['BlockSlopeVerticalCornerBottom', 'Vertical corner, bottom'],
      ['BlockSlopeVerticalInnerCornerTop', 'Vertical inner corner, top'], ['BlockSlopeVerticalInnerCornerBottom', 'Vertical inner corner, bottom'],
    ]],
    ['Blocks', 'Bridges', [['BlockBridge', 'Bridge'], ['BlockBridgeCorner', 'Bridge corner'], ['BlockBridgeIntersectionT', 'Bridge T junction'], ['BlockBridgeIntersectionCross', 'Bridge crossroads']]],
    ['Wall track', 'Walls', [['WallTrackBottom', 'Bottom'], ['WallTrackMiddle', 'Middle'], ['WallTrackTop', 'Top'], ['WallTrackSlopeToVertical', 'Slope to vertical']]],
    ['Wall track', 'Corners', [
      ['WallTrackBottomCorner', 'Bottom corner'], ['WallTrackMiddleCorner', 'Middle corner'], ['WallTrackTopCorner', 'Top corner'],
      ['WallTrackBottomInnerCorner', 'Bottom inner corner'], ['WallTrackInnerCorner', 'Inner corner'], ['WallTrackTopInnerCorner', 'Top inner corner'],
    ]],
    ['Wall track', 'Floor and ceiling', [
      ['WallTrackFloor', 'Floor'], ['WallTrackFloorCorner', 'Floor corner'], ['WallTrackFloorPlaneCorner', 'Floor to plane corner'],
      ['WallTrackCeiling', 'Ceiling'], ['WallTrackCeilingCorner', 'Ceiling corner'], ['WallTrackCeilingPlaneCorner', 'Ceiling to plane corner'],
    ]],
    ['Pillars', 'Pillars', [['PillarShort', 'Short'], ['PillarBottom', 'Bottom'], ['PillarMiddle', 'Middle'], ['PillarTop', 'Top'], ['PillarShortSlope', 'Short, on slope'], ['PillarTopSlope', 'Top, on slope']]],
    ['Pillars', 'Branches', [1, 2, 3, 4, 5].flatMap((k) => [['PillarBranch' + k, 'Branch ' + k], ['PillarBranch' + k + 'Bottom', 'Branch ' + k + ', bottom'], ['PillarBranch' + k + 'Middle', 'Branch ' + k + ', middle'], ['PillarBranch' + k + 'Top', 'Branch ' + k + ', top']])],
    ['Signs', 'Signs', [['SignArrowLeft', 'Arrow left'], ['SignArrowRight', 'Arrow right'], ['SignArrowUp', 'Arrow up'], ['SignArrowDown', 'Arrow down'], ['SignWarning', 'Warning'], ['SignWrongWay', 'Wrong way']]],
  ];
  const ROAD_TABS = [...new Set(ROAD_LAYOUT.map((r) => r[0])), 'Other'];
  let stockParts = null; // stock id -> menu entry { i, f, t, s, l, o }, built on first use from the game's enum
  const stockPart = (cfg) => {
    if (!stockParts) {
      stockParts = new Map();
      let o = 0;
      for (const [t, s, list] of ROAD_LAYOUT)
        for (const [name, l] of list) {
          const i = self.TM.stockIds.get(name);
          if (i != null) stockParts.set(i, { i, f: ROAD, t, s, l, o: ++o });
        }
    }
    // A stock block missing from the layout still shows up, under Other.
    return stockParts.get(cfg.id) ?? { i: cfg.id, f: ROAD, t: 'Other', s: 'Other', l: 'Block ' + cfg.id, o: 1e9 };
  };
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
.part-panel.tm .tm-title { font-size: 20px; line-height: 24px; margin: 0 2px 5px 2px; color: var(--text-color); }
.editor-ui > .side > .side-panel > .category-panel > button { position: relative; }
.editor-ui > .side > .side-panel > .category-panel > button > .tm-cat-label { position: absolute; left: 0; right: 0; bottom: 3px; font-size: 14px; line-height: 15px;
  text-align: center; color: #fff; text-shadow: 0 0 3px #000, 0 0 3px #000; pointer-events: none; white-space: nowrap; overflow: hidden; }
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
      return Array.isArray(v) ? v.filter((id) => Number.isInteger(id)) : [];
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

  function build(panel, f) {
    const tabList = f == ROAD ? ROAD_TABS : TABS;
    panel.classList.add('tm');
    const head = document.createElement('div');
    head.className = 'tm-head';
    const title = document.createElement('div');
    title.className = 'tm-title';
    head.appendChild(title);
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

    const state = { panel, title, search, name, tabs, list, none, tab: tabList[0], groups: new Map(), tabButtons: new Map(), entries: [], selected: null, recentGroup: null };

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
      return b;
    };
    state.tabButton = tabButton;
    tabButton('Recent');
    for (const t of tabList) tabButton(t);
    list.appendChild(none);
    // Stock headings in layout order, whatever order the game lists its blocks in.
    if (f == ROAD) for (const [t, s] of ROAD_LAYOUT) group(state, t, s);

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

  const SURFACE_NAMES = { ...FAMILIES, [ROAD]: 'Road' };
  // Category names under the editor's icons. Stock categories by their enum number, -1 is the eraser, kits from 9.
  const CATEGORY_NAMES = { '-1': 'Erase', 0: 'Start & gates', 1: 'Road', 2: 'Turns', 3: 'Wide road', 4: 'Planes', 5: 'Blocks', 6: 'Wall track', 7: 'Pillars', 8: 'Signs' };
  FAMILIES.forEach((n, f) => (CATEGORY_NAMES[9 + f] = n));
  const describe = (p) => {
    if (!p.b) return SURFACE_NAMES[p.f] + ': ' + p.l;
    const size = (a) => Math.round((p.b[1][a] - p.b[0][a]) / 5) || 1;
    return SURFACE_NAMES[p.f] + ': ' + p.l + ' (' + Math.max(1, Math.round(size(0) / 4)) + 'x' + Math.max(1, Math.round(size(2) / 4)) + ', ' + size(1) + ' high)';
  };

  self.TM.ui = {
    setThumbnailRenderer(fn) {
      thumb = fn;
    },
    stockPart,
    add(panel, button, image, part) {
      // A hidden block (part.h) still loads on tracks and the pipette can pick it, but the menu does not offer it.
      if (part.h) return;
      const state = panels.get(panel) ?? build(panel, part.f);
      if (!state.title.textContent) state.title.textContent = SURFACE_NAMES[part.f] + ' blocks';
      const s = group(state, part.t, part.s);
      // A tab the table's list does not name still gets a button, at the end, so its blocks can be reached.
      (state.tabButtons.get(part.t) ?? state.tabButton(part.t)).classList.remove('empty');
      const label = describe(part);
      const entry = { part, button, image, label, hay: (part.l + ' ' + part.s + ' ' + part.t).toLowerCase() };
      button.__tm = entry;
      button.dataset.tm = part.i;
      button.title = label;
      button.addEventListener('mouseenter', () => (state.name.textContent = label));
      button.addEventListener('mouseleave', () => (state.name.textContent = state.selected?.label ?? ''));
      // Stock blocks keep their layout order inside a heading; surface blocks arrive in order already.
      const next = part.o == null ? null : [...s.grid.children].find((b) => b.__tm.part.o > part.o);
      s.grid.insertBefore(button, next ?? null);
      s.heading.classList.remove('off'); // a heading made ahead of its blocks was hidden as empty
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
      if (!owner.has(id)) return;
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
    labelCategory(button, category) {
      const name = CATEGORY_NAMES[category];
      if (!name || button.querySelector('.tm-cat-label')) return;
      const l = document.createElement('span');
      l.className = 'tm-cat-label';
      l.textContent = name;
      button.appendChild(l);
      button.title = name;
    },
    // The placement ghost for a new block: its own colours, slightly see-through, with the editor's
    // valid / blocked colour mixed in as a glow (it shares that colour object, so it follows it live).
    ghostMaterial(three, stockGhost) {
      const m = new three.G_z({ vertexColors: true, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -0.3, depthWrite: false });
      m.emissive = stockGhost.color;
      m.emissiveIntensity = 0.15;
      return m;
    },
    skipEager(entry) {
      if (!entry.button.__tm) return false;
      entry.image.removeAttribute('src');
      entry.image.className = 'loading';
      return true;
    },
  };
})();
