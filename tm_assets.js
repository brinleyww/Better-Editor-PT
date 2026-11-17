// Public assets: groups of blocks (a tree, a house, a rock arch) that players publish and anyone can place. Page only,
// loaded after tm_tools.js. The Assets tab in the editor's top bar opens the library: search, sort, like, place.
// Upload works like the copy tool: pick two corners, then give the asset a name and a picture. One asset every
// 30 minutes; the player who published an asset and the site owner can delete it.
// The library lives on the Not So Weekly Shorts server. Inside NSWS every request goes through nsws_bridge.js
// (__beBridgeAssets), so likes and uploads use the player's NSWS account; on its own this site can only browse and place.
// Hooks (tools/patch.js): __beAssetEditor (select, selecting, cancel, part, paste, clipboard), __beAssetPicking /
// __beAssetPicked (the copy tool's selection), __beAssetPlaced (a paste was put down).
self.TM.assets = (() => {
  const API = 'https://pt-leaderboard-proxy.bringleyw.workers.dev/';
  const SORT_KEY = 'be-assets-sort';
  const LIST_FRESH_MS = 60_000;
  const MAX_PARTS = 5000;
  const PAGE = 60;
  const THUMB = 256;
  const THUMB_CHARS = 60_000;
  const NAME_MAX = 40;
  const DESC_MAX = 300;
  const TAGS_MAX = 8;
  const ID = /^[0-9A-Za-z]{9}$/;

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

  let ed = null; // { ctx }: the open editor (ctx.canvas, ctx.camera)
  let css = null;
  let ui = null;
  let list = null; // every asset's details, newest first
  let listAt = 0;
  let listLoading = null;
  let me = null; // { owner, mine, liked, used: Sets, wait, waitAt }
  let base = API; // where pictures load from
  let bridged = false; // NSWS answers asset requests
  let view = { kind: 'list' }; // list | detail {id} | form {...}
  let sort = 'popular';
  let filter = 'all';
  let query = '';
  let shown = PAGE;
  let picking = null; // the selection banner while picking an asset's blocks
  let framing = null; // the picture frame while taking a picture
  const counted = new Set(); // assets whose use was already reported this session
  const TRAY_KEY = 'be-assets-tray';
  const RECENT_KEY = 'be-assets-recent';
  const RECENT_MAX = 24;
  const TRAY_TABS = { recent: 'Recent', liked: 'Liked', popular: 'Popular', mine: 'Mine' };
  let tray = { open: store.get(TRAY_KEY) === '1', tab: null, query: '', active: null, timer: 0, peek: null };
  let recent = [];
  try {
    const r = JSON.parse(store.get(RECENT_KEY) ?? '[]');
    if (Array.isArray(r)) recent = r.filter((id) => ID.test(id)).slice(0, RECENT_MAX);
  } catch {}
  const gone = new Map(); // id -> when this player deleted it (the server's list can be a minute old)
  const cache = new Map(); // id -> parts, for placing again

  try {
    const s = JSON.parse(store.get(SORT_KEY) ?? 'null');
    if (s && typeof s.sort == 'string') sort = s.sort;
    if (s && typeof s.filter == 'string') filter = s.filter;
  } catch {}

  // ---- server --------------------------------------------------------------------------------------------------
  async function getJson(path) {
    let r;
    try {
      r = await fetch(API + path, { cache: 'no-cache' });
    } catch {
      throw new Error('Couldn’t reach the asset library. Check your connection and try again.');
    }
    let data = null;
    try {
      data = await r.json();
    } catch {}
    if (!r.ok) throw Object.assign(new Error(data?.error || 'The asset library answered ' + r.status + '.'), { status: r.status, data });
    return data;
  }

  function call(op, args) {
    const viaNsws = self.__beBridgeAssets?.(op, args);
    if (viaNsws) return viaNsws;
    if (op === 'list') return getJson('nsws/tracks/assets');
    if (op === 'get') return getJson('nsws/tracks/asset/' + args.id);
    return Promise.reject(new Error('Liking and publishing assets work in the editor inside Not So Weekly Shorts.'));
  }

  async function connect() {
    try {
      const r = await self.__beBridgeAssets?.('base');
      bridged = !!r;
      if (r?.base) base = String(r.base).replace(/\/*$/, '/');
    } catch {
      bridged = false;
    }
    if (bridged) loadMe();
  }

  function loadList(force) {
    if (!force && list && Date.now() - listAt < LIST_FRESH_MS) return Promise.resolve(list);
    return (listLoading ??= call('list')
      .then((r) => {
        const recent = (t) => t && Date.now() - t < 5 * LIST_FRESH_MS;
        const fresh = Array.isArray(r?.assets) ? r.assets.filter((a) => a && ID.test(a.id) && !recent(gone.get(a.id))) : [];
        // The server's list is cached for a minute: keep what this player just published or changed.
        const local = new Map((list ?? []).filter((a) => recent(a.local)).map((a) => [a.id, a]));
        list = fresh.map((a) => (local.has(a.id) && local.get(a.id).updated >= a.updated ? local.get(a.id) : a));
        for (const [id, a] of local) if (!list.some((b) => b.id === id)) list.unshift(a);
        for (const a of list) a.$name ?? prepare(a);
        listAt = Date.now();
        return list;
      })
      .finally(() => (listLoading = null)));
  }

  function loadMe() {
    if (!bridged) return Promise.resolve(null);
    return call('me', {})
      .then((r) => {
        me = { owner: !!r.owner, mine: new Set(r.mine || []), liked: new Set(r.liked || []), used: new Set(r.used || []), wait: Number(r.wait) || 0, waitAt: Date.now() };
        render();
        renderTray();
        return me;
      })
      .catch(() => null);
  }

  const waitLeft = () => (me && !me.owner ? Math.max(0, me.wait - (Date.now() - me.waitAt)) : 0);
  const mins = (ms) => Math.max(1, Math.ceil(ms / 60000)) + ' min';
  const thumbUrl = (a) => base + 'nsws/tracks/asset/' + a.id + '/thumb?v=' + (a.thumb || 1);
  const byId = (id) => list?.find((a) => a.id === id) ?? null;

  // ---- smart search ----------------------------------------------------------------------------------------------
  // Each word of the search has to turn up somewhere: in the name, tags, author, description or the blocks the asset
  // is made of, as the word itself, the start of a word, a word that means the same, or with a typo.
  const SAME = [
    'tree trees forest pine oak palm birch spruce fir bush shrub plant foliage jungle',
    'rock rocks stone stones boulder cliff crag pebble',
    'house home building hut cabin shack shop barn cottage villa',
    'mountain mountains hill hills peak terrain ground mound',
    'water lake river sea ocean pond waterfall pool stream',
    'light lights lamp lantern streetlight torch',
    'sign signs banner board billboard text letters logo',
    'bridge bridges overpass viaduct',
    'tunnel tunnels cave',
    'ramp ramps jump kicker launch',
    'loop loops looping',
    'wall walls barrier fence railing rail',
    'castle tower fort fortress keep',
    'stand stands grandstand tribune crowd bleachers',
    'flower flowers garden grass meadow',
    'snow ice winter frozen',
    'sand desert dune dunes',
    'gate gates arch arches portal',
    'deco decoration scenery prop props detail',
    'road roads track street',
    'turn turns curve corner bend',
    'pipe pipes tube',
    'big large huge giant massive',
    'small tiny mini little',
    'car cars vehicle',
    'boat ship',
    'plane airplane jet',
    'pillar pillars column columns support',
  ].map((g) => g.split(' '));
  const sameOf = new Map();
  for (const g of SAME) for (const w of g) sameOf.set(w, g);

  const norm = (s) =>
    String(s ?? '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '');
  const stem = (w) => (w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
  const words = (s) =>
    norm(s)
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(/[^a-z0-9]+/)
      .filter(Boolean);

  function prepare(a) {
    const f = (s) => [...new Set(words(s).map(stem))];
    a.$name = f(a.name);
    a.$tags = f((a.tags || []).join(' '));
    a.$kw = f(a.kw);
    a.$desc = f(a.description);
    a.$author = norm(a.author);
    a.$authorW = f(a.author);
    a.$full = norm(a.name);
  }

  function close1(a, b) {
    // Damerau-Levenshtein distance <= max, for short words.
    const max = b.length >= 7 ? 2 : 1;
    if (Math.abs(a.length - b.length) > max) return false;
    const d = [];
    for (let i = 0; i <= a.length; i++) d.push([i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      let row = Infinity;
      for (let j = 1; j <= b.length; j++) {
        const c = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        row = Math.min(row, d[i][j]);
      }
      if (row > max) return false;
    }
    return d[a.length][b.length] <= max;
  }

  // How well one search word matches a list of words: 1 exact, 0.85 start of a word, 0.7 same meaning, 0.55 typo, 0.4 inside
  // a longer word (5 letters or more, so "tree" doesn't find "street").
  function wordScore(q, list) {
    let best = 0;
    const same = sameOf.get(q) ?? sameOf.get(q + 's');
    for (const w of list) {
      if (w === q) return 1;
      if (q.length >= 2 && w.startsWith(q)) best = Math.max(best, 0.85);
      else if (same && (same.includes(w) || same.includes(w + 's'))) best = Math.max(best, 0.7);
      else if (q.length >= 4 && w.length >= 3 && close1(q, w)) best = Math.max(best, 0.55);
      else if (q.length >= 5 && w.includes(q)) best = Math.max(best, 0.4);
    }
    return best;
  }

  // by:name (or by:"two words"), #tag, and plain words.
  function parseQuery(text) {
    const out = { words: [], tags: [], by: null, phrase: norm(text).trim() };
    const re = /(by:|@)("([^"]*)"|(\S+))|#(\S+)|("([^"]*)")|(\S+)/gi;
    let m;
    while ((m = re.exec(text))) {
      if (m[1]) out.by = norm(m[3] ?? m[4]);
      else if (m[5]) out.tags.push(...words(m[5]).map(stem));
      else for (const w of words(m[7] ?? m[8])) out.words.push(stem(w));
    }
    return out;
  }

  function searchScore(a, q) {
    if (q.by && !a.$author.includes(q.by)) return 0;
    for (const t of q.tags) if (wordScore(t, a.$tags) < 0.85) return 0;
    if (!q.words.length) return 1;
    let total = 0;
    let missed = 0;
    for (const w of q.words) {
      const s = Math.max(wordScore(w, a.$name) * 10, wordScore(w, a.$tags) * 8, wordScore(w, a.$authorW) * 4, wordScore(w, a.$kw) * 3, wordScore(w, a.$desc) * 2);
      if (s <= 0) missed++;
      total += s;
    }
    // Long searches may miss a word; short ones may not.
    if (missed > (q.words.length >= 4 ? 1 : 0)) return 0;
    if (q.phrase.length > 2 && a.$full.includes(q.phrase.replace(/^(by:|@)\S+\s*/, ''))) total += 12;
    return total + Math.log2(1 + a.likes) * 0.6 + Math.log2(1 + a.uses) * 0.4;
  }

  const popularity = (a) => (a.likes * 3 + a.uses + 2) / Math.pow((Date.now() - a.created) / 86400000 + 2, 0.35);
  const SORTS = {
    popular: { label: 'Popular', by: (a, b) => popularity(b) - popularity(a) },
    used: { label: 'Most used', by: (a, b) => b.uses - a.uses || b.likes - a.likes || b.created - a.created },
    liked: { label: 'Most liked', by: (a, b) => b.likes - a.likes || b.uses - a.uses || b.created - a.created },
    newest: { label: 'Newest', by: (a, b) => b.created - a.created },
  };
  const FILTERS = { all: 'All', liked: 'Liked', used: 'Placed', mine: 'Mine' };

  function results() {
    if (!list) return [];
    let out = list;
    if (filter !== 'all' && me) out = out.filter((a) => me[filter]?.has(a.id));
    else if (filter !== 'all') out = [];
    const q = parseQuery(query);
    if (q.words.length || q.tags.length || q.by) {
      const scored = [];
      for (const a of out) {
        const s = searchScore(a, q);
        if (s > 0) scored.push([s, a]);
      }
      // With words to match, best match first and the picked sort breaks ties.
      return scored.sort((x, y) => (q.words.length ? y[0] - x[0] : 0) || SORTS[sort].by(x[1], y[1])).map((x) => x[1]);
    }
    return [...out].sort(SORTS[sort].by);
  }

  // ---- blocks ----------------------------------------------------------------------------------------------------
  const families = () => self.TM.data?.families ?? ['Plastic', 'Wood', 'Stadium'];
  let stockNames = null;
  function partWords(id) {
    const p = self.TM.byId?.get(id);
    if (p) return [p.n, p.l, p.t, p.s, families()[p.f]].filter(Boolean).join(' ');
    if (!stockNames) {
      stockNames = new Map();
      for (const [n, i] of self.TM.stockIds ?? []) stockNames.set(i, n);
    }
    return stockNames.get(id) ?? '';
  }

  function keywords(parts) {
    const ids = new Set(parts.map((p) => p.id));
    const out = new Set();
    for (const id of ids) for (const w of words(partWords(id))) if (w.length > 1) out.add(w);
    return [...out].join(' ').slice(0, 400);
  }

  const toWire = (parts) => parts.map((p) => {
    const r = [p.id, p.offset.x, p.offset.y, p.offset.z, p.rotation, p.rotationAxis, p.color ?? 0];
    if (p.checkpointOrder != null) r.push(p.checkpointOrder);
    return r;
  });
  const fromWire = (rows) => rows.map((r) => ({ id: r[0], offset: { x: r[1], y: r[2], z: r[3] }, rotation: r[4], rotationAxis: r[5], color: r[6], checkpointOrder: r[7] ?? null }));

  // The tiles the blocks cover, [x, y, z] (the copy tool's tile set).
  function footprint(tiles) {
    const lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    try {
      tiles.forEach((...p) =>
        p.slice(0, 3).forEach((v, i) => {
          lo[i] = Math.min(lo[i], v);
          hi[i] = Math.max(hi[i], v);
        }),
      );
    } catch {
      return null;
    }
    return lo[0] === Infinity ? null : hi.map((h, i) => h - lo[i] + 1);
  }

  function dims(parts) {
    const lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    for (const p of parts)
      ['x', 'y', 'z'].forEach((k, i) => {
        lo[i] = Math.min(lo[i], p.offset[k]);
        hi[i] = Math.max(hi[i], p.offset[k]);
      });
    return hi.map((h, i) => h - lo[i] + 1);
  }

  // ---- pictures --------------------------------------------------------------------------------------------------
  function encode(c) {
    for (const [type, qs] of [
      ['image/webp', [0.85, 0.75, 0.6, 0.45]],
      ['image/jpeg', [0.88, 0.78, 0.65, 0.5, 0.35]],
    ]) {
      for (const q of qs) {
        const url = c.toDataURL(type, q);
        if (!url.startsWith('data:' + type)) break; // this browser can't write that type
        if (url.length <= THUMB_CHARS) return url;
      }
    }
    return null;
  }

  function square(src, sx, sy, size) {
    const c = document.createElement('canvas');
    c.width = c.height = THUMB;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, sx, sy, size, size, 0, 0, THUMB, THUMB);
    return c;
  }

  // The square of the 3D view inside rect (screen pixels). Called from a click, so the next frame's callback runs
  // right after the editor drew it, while the drawing buffer still holds the picture.
  function shoot(rect) {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        try {
          const cv = ed?.ctx.canvas;
          if (!cv) return resolve(null);
          const b = cv.getBoundingClientRect(),
            k = cv.width / b.width;
          const c = square(cv, (rect.x - b.left) * k, (rect.y - b.top) * k, rect.size * k);
          const px = c.getContext('2d').getImageData(0, 0, THUMB, THUMB).data;
          let lit = 0;
          for (let i = 0; i < px.length; i += 4 * 97) if (px[i + 3] > 0 && px[i] + px[i + 1] + px[i + 2] > 0) lit++;
          resolve(lit > 3 ? encode(c) : null);
        } catch {
          resolve(null);
        }
      });
    });
  }

  function centreRect() {
    const cv = ed?.ctx.canvas,
      b = cv?.getBoundingClientRect() ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const size = Math.round(Math.min(b.width, b.height) * 0.62);
    return { x: b.left + (b.width - size) / 2, y: b.top + (b.height - size) / 2, size };
  }

  async function fromFile(file) {
    if (!file || !/^image\//.test(file.type)) throw new Error('Pick a picture file (PNG, JPEG or WebP).');
    const bmp = await createImageBitmap(file).catch(() => null);
    if (!bmp) throw new Error('That picture couldn’t be opened.');
    const s = Math.min(bmp.width, bmp.height);
    const url = encode(square(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s));
    bmp.close?.();
    if (!url) throw new Error('That picture couldn’t be made small enough.');
    return url;
  }

  // ---- UI --------------------------------------------------------------------------------------------------------
  function addCSS() {
    css = document.createElement('style');
    css.textContent = `
.be-as-tab { display: inline-block; vertical-align: top; margin: -1px 0 0 -6px; padding: 6px 7px 6px 16px; clip-path: polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%);
  background: var(--surface-secondary-color); pointer-events: auto; }
.be-as-tab > .button { white-space: nowrap; }
.be-as-tab > .button.on { background-color: var(--button-hover-color); }
.be-as-tray[hidden], .be-as-peek[hidden] { display: none !important; }
.be-as-tray { position: absolute; bottom: 0; z-index: 4; display: flex; flex-direction: column; min-width: 420px; color: var(--text-color); pointer-events: auto; isolation: isolate; }
/* The slanted background is its own layer, so the hover preview can stand above the tray. */
.be-as-tray::before { content: ""; position: absolute; inset: 0; z-index: -1; background-color: var(--surface-transparent-color); clip-path: polygon(12px 0, calc(100% - 12px) 0, 100% 100%, 0 100%); }
.be-as-tray-head { display: flex; align-items: center; gap: 6px; padding: 6px 18px 4px 18px; white-space: nowrap; }
.be-as-tray-head > .button { padding: 3px 14px; font-size: 19px; }
.be-as-tray-head > .button.on { background-color: var(--button-hover-color); box-shadow: inset 0 0 4px #fff; }
.be-as-tray-head > input { width: 210px; min-width: 90px; flex-shrink: 1; height: 34px; padding: 0 14px; font-size: 19px; color: var(--text-color);
  clip-path: polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%); }
.be-as-tray-status { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 17px; opacity: 0.85; text-align: right; padding-right: 6px; }
.be-as-tray-head > .be-as-x { padding: 3px 12px; }
.be-as-strip { display: flex; gap: 8px; padding: 2px 18px 8px 18px; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; min-height: 128px; }
.be-as-chip { position: relative; flex: 0 0 108px; display: flex; flex-direction: column; margin: 0; padding: 0; color: var(--text-color); outline: 2px solid transparent; outline-offset: -2px; }
.be-as-chip > img { display: block; width: 108px; height: 96px; object-fit: cover; background: var(--surface-tertiary-color); pointer-events: none; transition: opacity 0.2s; }
.be-as-chip > img.loading { opacity: 0; }
.be-as-chip > .be-as-chip-t { padding: 2px 6px 3px 6px; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background-color: var(--surface-color); }
.be-as-chip > .be-as-key { position: absolute; top: 3px; left: 3px; min-width: 18px; padding: 0 4px; font-size: 14px; line-height: 20px; text-align: center; background-color: var(--surface-color); opacity: 0.9; }
.be-as-chip.on { outline-color: #fff; box-shadow: 0 0 10px rgba(255, 255, 255, 0.6); }
.be-as-chip.on > .be-as-chip-t { background-color: var(--button-hover-color); }
.be-as-tray-empty { margin: auto 0; padding: 0 6px; font-size: 19px; opacity: 0.8; white-space: normal; }
.be-as-peek { position: absolute; bottom: calc(100% + 6px); display: flex; gap: 12px; width: 440px; max-width: 100%; box-sizing: border-box; padding: 10px 22px 10px 10px;
  clip-path: polygon(0 0, 100% 0, calc(100% - 12px) 100%, 0 100%); background-color: var(--surface-color); pointer-events: none; }
.be-as-peek > img { flex: 0 0 150px; width: 150px; height: 150px; object-fit: cover; background: var(--surface-tertiary-color); }
.be-as-peek-i { display: flex; flex-direction: column; gap: 4px; min-width: 0; font-size: 17px; }
.be-as-peek-i > b { font-weight: normal; font-size: 24px; overflow-wrap: anywhere; }
.be-as-peek-i > span { opacity: 0.85; }
.be-as-peek-i > .be-as-peek-d { opacity: 0.75; font-size: 16px; line-height: 1.3; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
.be-as-peek-i > .be-as-peek-h { margin-top: auto; opacity: 0.6; font-size: 15px; }
.be-recover { bottom: calc(14px + var(--be-as-tray, 0px)) !important; }
.be-as [hidden], .be-as-banner[hidden], .be-as-frame[hidden], .be-as-toast[hidden] { display: none !important; }
.be-as { position: absolute; inset: 0; z-index: 10; pointer-events: auto; color: var(--text-color); }
.be-as > .be-as-bg { position: absolute; inset: 0; background-color: rgba(20, 20, 30, 0.35); }
.be-as > .be-as-box { position: absolute; left: 50%; top: 0; transform: translateX(-50%); display: flex; flex-direction: column; box-sizing: border-box;
  width: min(1040px, 100%); height: 100%; background-color: var(--surface-color); }
.be-as-box > h2 { margin: 10px; padding: 0; font-weight: normal; font-size: 38px; text-align: center; }
.be-as-bar { display: flex; gap: 0; padding: 0 12px 8px 12px; }
.be-as-bar > input { flex: 1; min-width: 0; margin: 0 -2px 0 0; padding: 0 20px; height: 52px; font-size: 26px; clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%);
  color: var(--text-color); text-indent: 2px; }
.be-as-bar > .button { margin: 0 0 0 6px; padding: 0 18px; font-size: 22px; white-space: nowrap; }
.be-as-bar > .button.on, .be-as-chips > .button.on { background-color: var(--button-hover-color); box-shadow: inset 0 0 4px #fff; }
.be-as-chips { display: flex; align-items: center; gap: 6px; padding: 0 12px 8px 12px; font-size: 20px; }
.be-as-chips > .button { padding: 3px 16px; font-size: 20px; }
.be-as-chips > .be-as-count { flex: 1; text-align: right; opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.be-as-body { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; background-color: var(--surface-secondary-color); }
.be-as-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(186px, 1fr)); gap: 14px; padding: 16px; }
.be-as-card { position: relative; display: flex; flex-direction: column; margin: 0; padding: 0; text-align: left; color: var(--text-color); }
.be-as-card > img, .be-as-pic { display: block; width: 100%; aspect-ratio: 1 / 1; object-fit: cover; background: var(--surface-tertiary-color); }
.be-as-card > img.loading { opacity: 0; }
.be-as-card > .be-as-t { padding: 4px 10px 0 10px; font-size: 22px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background-color: var(--surface-color); }
.be-as-card > .be-as-s { padding: 0 10px 5px 10px; font-size: 16px; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background-color: var(--surface-color); }
.be-as-card > .be-as-new { position: absolute; top: 6px; left: 6px; padding: 1px 8px; font-size: 15px; background: var(--surface-color); }
.be-as-card.liked > .be-as-s > .be-as-h { color: #ff8a9a; }
.be-as-empty { margin: 70px 40px; text-align: center; }
.be-as-empty > p:first-child { margin: 0; font-size: 36px; }
.be-as-empty > p + p { margin: 14px 0 0 0; font-size: 22px; opacity: 0.75; line-height: 1.4; }
.be-as-more { display: block; margin: 0 auto 18px auto; padding: 6px 30px; font-size: 22px; }
.be-as-detail { display: flex; gap: 22px; padding: 18px; align-items: flex-start; }
.be-as-detail > .be-as-left { flex: 0 0 min(340px, 42%); }
.be-as-detail > .be-as-left > .be-as-picbar { display: flex; gap: 6px; margin-top: 6px; }
.be-as-detail > .be-as-left > .be-as-picbar > .button { flex: 1; padding: 4px 8px; font-size: 19px; }
.be-as-detail > .be-as-right { flex: 1; min-width: 0; }
.be-as-right > h3 { margin: 0; font-weight: normal; font-size: 34px; overflow-wrap: anywhere; }
.be-as-right > .be-as-by { margin: 4px 0 0 0; font-size: 20px; opacity: 0.8; }
.be-as-right > .be-as-by > a { color: inherit; cursor: pointer; text-decoration: underline; }
.be-as-stats { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
.be-as-stats > span { padding: 4px 12px; font-size: 19px; background-color: var(--surface-color); }
.be-as-desc { margin: 0 0 12px 0; font-size: 21px; line-height: 1.35; white-space: pre-wrap; overflow-wrap: anywhere; }
.be-as-tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 14px 0; }
.be-as-tags > .button { padding: 2px 12px; font-size: 18px; }
.be-as-acts { display: flex; flex-wrap: wrap; gap: 8px; }
.be-as-acts > .button { padding: 6px 22px; font-size: 23px; }
.be-as-acts > .button.on { background-color: var(--button-hover-color); }
.be-as-note { margin: 10px 0 0 0; font-size: 19px; min-height: 1.3em; line-height: 1.35; }
.be-as-note.bad { color: #ff9696; }
.be-as-note.good { color: #96ff96; }
.be-as-field { display: block; margin: 0 0 12px 0; }
.be-as-field > span { display: block; margin: 0 0 4px 0; font-size: 21px; }
.be-as-field > span > i { font-style: normal; opacity: 0.6; font-size: 17px; }
.be-as-field > input, .be-as-field > textarea { box-sizing: border-box; width: 100%; padding: 6px 12px; font-size: 22px; font-family: inherit; color: var(--text-color);
  background-color: var(--surface-tertiary-color); border: none; outline: 2px solid transparent; }
.be-as-field > input:focus, .be-as-field > textarea:focus { outline-color: var(--text-color); }
.be-as-field > textarea { height: 96px; resize: none; }
.be-as-foot { display: flex; align-items: center; gap: 10px; padding: 10px; }
.be-as-foot > .be-as-fnote { flex: 1; font-size: 19px; opacity: 0.8; text-align: right; }
.be-as-foot > .button { padding: 6px 26px; }
.be-as-banner { position: absolute; left: 50%; bottom: calc(14px + var(--be-as-tray, 0px)); z-index: 6; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; max-width: calc(100% - 40px);
  padding: 10px 26px 10px 18px; clip-path: polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%); color: var(--text-color); background-color: var(--surface-color);
  pointer-events: auto; font-size: 22px; }
.be-as-banner > span { white-space: normal; }
.be-as-banner > .button { padding: 4px 16px; font-size: 20px; white-space: nowrap; }
.be-as-frame { position: absolute; inset: 0; z-index: 5; pointer-events: none; }
.be-as-frame > div { position: absolute; outline: 3px solid #fff; box-shadow: 0 0 0 9999px rgba(10, 12, 30, 0.45); }
.be-as-toast { position: absolute; left: 50%; bottom: calc(90px + var(--be-as-tray, 0px)); z-index: 12; transform: translateX(-50%); max-width: calc(100% - 40px); padding: 8px 24px;
  clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%); font-size: 21px; color: var(--text-color); background-color: var(--surface-color); pointer-events: none; }
`;
    document.head.appendChild(css);
  }

  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const btn = (text, fn, cls) => {
    const b = h('button', 'button' + (cls ? ' ' + cls : ''), text);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      fn(e, b);
    });
    return b;
  };
  // Keys, clicks and the wheel on the library stay there instead of building, moving the camera or zooming underneath.
  const keep = (el) => {
    for (const ev of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'wheel', 'keydown', 'keyup', 'contextmenu']) el.addEventListener(ev, (e) => e.stopPropagation());
  };

  function makeUI() {
    css ?? addCSS();
    const root = document.querySelector('#ui > .editor-ui') ?? document.querySelector('.editor-ui');
    const anchor = root?.querySelector('.top > .be-runs') ?? root?.querySelector('.top > .track-settings-container');
    if (!root || !anchor) return null;
    const tab = h('div', 'be-as-tab');
    const open = btn('Assets', () => toggleTray());
    open.title = 'Assets (B): trees, rocks, buildings and more that players made, ready to place. Upload your own.';
    tab.appendChild(open);
    anchor.after(tab);
    for (const ev of ['mousedown', 'touchstart', 'wheel']) tab.addEventListener(ev, (e) => e.stopPropagation());

    const box = h('div', 'be-as');
    box.hidden = true;
    const bg = h('div', 'be-as-bg');
    bg.addEventListener('click', () => closeLibrary());
    const panel = h('div', 'be-as-box');
    const title = h('h2', null, 'Asset library');
    const bar = h('div', 'be-as-bar');
    const search = h('input');
    search.type = 'text';
    search.placeholder = 'Search: trees, rocks, a castle, #tag, by:name';
    search.spellcheck = false;
    search.maxLength = 80;
    search.addEventListener('input', () => {
      query = search.value;
      shown = PAGE;
      if (view.kind !== 'list') view = { kind: 'list' };
      render();
    });
    bar.appendChild(search);
    const sorts = {};
    for (const [k, s] of Object.entries(SORTS)) {
      sorts[k] = btn(s.label, () => {
        sort = k;
        saveSort();
        shown = PAGE;
        view = { kind: 'list' };
        render();
      });
      bar.appendChild(sorts[k]);
    }
    const chips = h('div', 'be-as-chips');
    const filters = {};
    for (const [k, label] of Object.entries(FILTERS)) {
      filters[k] = btn(label, () => {
        filter = k;
        saveSort();
        shown = PAGE;
        view = { kind: 'list' };
        render();
      });
      chips.appendChild(filters[k]);
    }
    const count = h('span', 'be-as-count');
    chips.appendChild(count);
    const body = h('div', 'be-as-body');
    const foot = h('div', 'be-as-foot');
    const back = btn('Back', () => (view.kind === 'list' ? closeLibrary() : goBack()));
    const fnote = h('span', 'be-as-fnote');
    const upload = btn('Upload', () => startUpload());
    upload.title = 'Pick blocks in your track and publish them as an asset';
    foot.append(back, fnote, upload);
    panel.append(title, bar, chips, body, foot);
    box.append(bg, panel);
    keep(box);
    root.appendChild(box);

    const banner = h('div', 'be-as-banner');
    banner.hidden = true;
    keep(banner);
    root.appendChild(banner);
    const frame = h('div', 'be-as-frame');
    frame.hidden = true;
    frame.appendChild(h('div'));
    root.appendChild(frame);
    const toast = h('div', 'be-as-toast');
    toast.hidden = true;
    root.appendChild(toast);
    return { root, tab, open, box, search, sorts, filters, count, body, back, fnote, upload, banner, frame, toast, bar, chips, tray: makeTray(root) };
  }

  const saveSort = () => store.set(SORT_KEY, JSON.stringify({ sort, filter }));

  let toastTimer = 0;
  function toast(text, ms = 3500) {
    if (!ui) return;
    ui.toast.textContent = text;
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui && (ui.toast.hidden = true), ms);
  }

  function openLibrary(next) {
    if (!ui || picking || framing) return;
    view = next ?? (view.kind === 'form' ? view : { kind: 'list' });
    ui.box.hidden = false;
    render();
    if (view.kind === 'list') setTimeout(() => ui?.search.focus(), 0);
    loadList()
      .then(() => (render(), renderTray()))
      .catch((e) => {
        if (view.kind === 'list') {
          ui.body.textContent = '';
          ui.body.appendChild(empty('The asset library couldn’t be loaded.', e.message));
        }
      });
    if (bridged) loadMe();
  }

  function closeLibrary() {
    if (!ui) return;
    ui.box.hidden = true;
    document.activeElement?.blur?.();
    renderTray();
  }

  function goBack() {
    if (view.kind === 'form' && view.from) view = view.from;
    else view = { kind: 'list' };
    render();
  }

  function empty(title, text) {
    const e = h('div', 'be-as-empty');
    e.append(h('p', null, title));
    if (text) e.append(h('p', null, text));
    return e;
  }

  function render() {
    if (!ui || ui.box.hidden) return;
    let n;
    const listing = view.kind === 'list';
    ui.bar.hidden = ui.chips.hidden = view.kind === 'form';
    for (const [k, b] of Object.entries(ui.sorts)) b.classList.toggle('on', k === sort);
    for (const [k, b] of Object.entries(ui.filters)) {
      b.classList.toggle('on', k === filter);
      b.hidden = k !== 'all' && !bridged;
    }
    const wait = waitLeft();
    ui.upload.hidden = view.kind === 'form';
    ui.upload.disabled = wait > 0;
    ui.upload.textContent = wait > 0 ? 'Upload in ' + mins(wait) : 'Upload';
    ui.fnote.textContent = !bridged ? 'Open the editor in Not So Weekly Shorts to like or publish assets.' : view.kind === 'form' ? '' : wait > 0 ? 'One asset every 30 minutes.' : '';
    ui.back.textContent = listing ? 'Back' : view.kind === 'form' ? 'Cancel' : 'Back to the list';
    ui.count.textContent = listing && list ? (n = results().length) === 1 ? '1 asset' : n + ' assets' : '';
    if (listing) renderList();
    else if (view.kind === 'detail') renderDetail();
    else renderForm();
  }

  function renderList() {
    const body = ui.body;
    const top = body.scrollTop;
    body.textContent = '';
    if (!list) {
      ui.count.textContent = '';
      body.appendChild(empty('Loading assets...'));
      return;
    }
    const found = results();
    if (!found.length) {
      if (!list.length) body.appendChild(empty('No assets yet', 'Be the first: press Upload, pick some blocks in your track and give them a name and a picture.'));
      else if (filter === 'mine') body.appendChild(empty('You haven’t published any assets', 'Press Upload to pick blocks from your track.'));
      else if (filter === 'liked') body.appendChild(empty('No liked assets', 'Open an asset and press Like to keep it here.'));
      else if (filter === 'used') body.appendChild(empty('Nothing placed yet', 'Assets you place in a track show up here.'));
      else body.appendChild(empty('Nothing matches “' + query.trim() + '”', 'Try another word, or fewer words.'));
      return;
    }
    const grid = h('div', 'be-as-grid');
    for (const a of found.slice(0, shown)) grid.appendChild(card(a));
    body.appendChild(grid);
    if (found.length > shown) {
      body.appendChild(
        btn('Show more (' + (found.length - shown) + ')', () => {
          shown += PAGE;
          render();
        }, 'be-as-more'),
      );
    }
    body.scrollTop = top;
  }

  function card(a) {
    const b = h('button', 'button be-as-card' + (me?.liked.has(a.id) ? ' liked' : ''));
    const img = h('img', 'loading');
    img.loading = 'lazy';
    img.alt = '';
    img.addEventListener('load', () => img.classList.remove('loading'));
    img.src = thumbUrl(a);
    b.append(img, h('div', 'be-as-t', a.name));
    const s = h('div', 'be-as-s');
    const heart = h('span', 'be-as-h', '♥ ' + a.likes);
    s.append(heart, document.createTextNode(' · ↓ ' + a.uses + ' · by ' + a.author));
    b.appendChild(s);
    if (Date.now() - a.created < 3 * 86400000) b.appendChild(h('span', 'be-as-new', 'New'));
    b.title = a.name + ' by ' + a.author + (a.description ? '\n' + a.description : '');
    b.addEventListener('click', () => {
      view = { kind: 'detail', id: a.id };
      render();
      ui.body.scrollTop = 0;
    });
    return b;
  }

  function renderDetail() {
    const a = byId(view.id);
    const body = ui.body;
    body.textContent = '';
    if (!a) {
      body.appendChild(empty('That asset was deleted.'));
      return;
    }
    const d = h('div', 'be-as-detail');
    const left = h('div', 'be-as-left');
    const pic = h('img', 'be-as-pic');
    pic.alt = '';
    pic.src = thumbUrl(a);
    left.appendChild(pic);
    const right = h('div', 'be-as-right');
    right.appendChild(h('h3', null, a.name));
    const by = h('p', 'be-as-by', 'by ');
    const who = h('a', null, a.author);
    who.title = 'More assets by ' + a.author;
    who.addEventListener('click', () => searchFor('by:' + (/\s/.test(a.author) ? '"' + a.author + '"' : a.author)));
    by.append(who, document.createTextNode(' · ' + new Date(a.created).toLocaleDateString()));
    right.appendChild(by);
    const st = h('div', 'be-as-stats');
    const [dx, dy, dz] = a.dims || [];
    st.append(h('span', null, '♥ ' + a.likes + (a.likes === 1 ? ' like' : ' likes')), h('span', null, '↓ Used by ' + a.uses + (a.uses === 1 ? ' player' : ' players')), h('span', null, a.parts + (a.parts === 1 ? ' block' : ' blocks')));
    if (dx) st.append(h('span', null, dx + ' × ' + dz + ' tiles, ' + dy + (dy === 1 ? ' layer' : ' layers')));
    right.appendChild(st);
    if (a.description) right.appendChild(h('p', 'be-as-desc', a.description));
    if (a.tags?.length) {
      const tags = h('div', 'be-as-tags');
      for (const t of a.tags) tags.appendChild(btn('#' + t, () => searchFor('#' + t.replace(/\s+/g, ''))));
      right.appendChild(tags);
    }
    const acts = h('div', 'be-as-acts');
    const note = h('p', 'be-as-note');
    const say = (text, cls) => {
      note.className = 'be-as-note' + (cls ? ' ' + cls : '');
      note.textContent = text;
    };
    const place = btn('Place', (e, b) => placeAsset(a, b, say));
    place.title = 'Puts the asset on your cursor like a paste: click to place it, rotate it like a part, Escape to stop';
    acts.appendChild(place);
    const liked = !!me?.liked.has(a.id);
    const like = btn(liked ? '♥ Liked' : '♡ Like', (e, b) => likeAsset(a, b, say), liked ? 'on' : '');
    like.disabled = !bridged;
    acts.appendChild(like);
    const mine = !!me?.mine.has(a.id);
    if (mine || me?.owner) {
      acts.appendChild(btn('Edit', () => editAsset(a)));
      const del = btn(mine ? 'Delete' : 'Delete (owner)', () => {
        if (del.dataset.sure !== '1') {
          del.dataset.sure = '1';
          del.textContent = 'Delete for everyone?';
          say('Press again to delete “' + a.name + '”. Tracks that already use it keep their blocks.', 'bad');
          return;
        }
        deleteAsset(a, del, say);
      });
      acts.appendChild(del);
    }
    right.append(acts, note);
    d.append(left, right);
    body.appendChild(d);
  }

  function searchFor(text) {
    query = text;
    ui.search.value = text;
    filter = 'all';
    shown = PAGE;
    view = { kind: 'list' };
    render();
  }

  // ---- actions ---------------------------------------------------------------------------------------------------
  async function busy(b, fn) {
    if (b.disabled) return;
    b.disabled = true;
    try {
      await fn();
    } finally {
      if (b.isConnected) b.disabled = false;
    }
  }

  // Puts an asset on the cursor like a paste. Resolves to { missing } (blocks this editor doesn't have), throws a sentence.
  async function pickUp(a, loading) {
    const E = self.__beAssetEditor;
    if (!E) throw new Error('The editor isn’t ready yet.');
    let rows = cache.get(a.id);
    if (!rows) {
      loading?.();
      try {
        const r = await call('get', { id: a.id });
        rows = JSON.parse(r.parts);
        if (r.asset) Object.assign(a, r.asset), prepare(a);
        cache.set(a.id, rows);
      } catch (e) {
        if (e.status === 404) markDeleted(a.id), renderTray();
        throw new Error(e.message || 'The asset couldn’t be loaded.');
      }
    }
    if (!ed) throw new Error('The editor was closed.');
    const parts = fromWire(rows);
    const ok = parts.filter((p) => E.part(p.id));
    if (!ok.length) throw new Error('This editor has none of the blocks in that asset. Reload the page to get the newest blocks.');
    E.paste(ok, { asset: a.id });
    remember(a.id);
    tray.active = a.id;
    renderTray();
    return { missing: parts.length - ok.length };
  }

  const leftOut = (n) => (n ? n + (n === 1 ? ' block this editor doesn’t have was' : ' blocks this editor doesn’t have were') + ' left out. ' : '');

  function placeAsset(a, b, say) {
    return busy(b, async () => {
      try {
        const { missing } = await pickUp(a, () => say('Loading the blocks...'));
        closeLibrary();
        toast(leftOut(missing) + '“' + a.name + '”: click to place it, rotate it like a part, Escape to stop.', missing ? 6000 : 4000);
      } catch (e) {
        say(e.message, 'bad');
      }
    });
  }

  function remember(id) {
    recent = [id, ...recent.filter((x) => x !== id)].slice(0, RECENT_MAX);
    store.set(RECENT_KEY, JSON.stringify(recent));
  }

  // ---- tray -------------------------------------------------------------------------------------------------------
  // A strip along the bottom of the editor that stays open while building: recent, liked and popular assets one click
  // (or a number key) from the cursor, a search box, and the way into the full library and Upload. B opens and closes it.
  function makeTray(root) {
    const el = h('div', 'be-as-tray');
    el.hidden = true;
    const head = h('div', 'be-as-tray-head');
    const tabs = {};
    for (const [k, label] of Object.entries(TRAY_TABS)) {
      tabs[k] = btn(label, (e, b) => {
        tray.tab = k;
        tray.query = '';
        search.value = '';
        b.blur();
        renderTray(true);
      });
      head.appendChild(tabs[k]);
    }
    const search = h('input');
    search.type = 'text';
    search.placeholder = 'Find an asset...';
    search.spellcheck = false;
    search.maxLength = 80;
    search.addEventListener('input', () => {
      tray.query = search.value;
      renderTray(true);
    });
    // Typing stays in the box; Escape clears it and hands the keys back to the editor, Enter picks up the first result.
    for (const ev of ['keydown', 'keyup', 'keypress']) search.addEventListener(ev, (e) => e.stopPropagation());
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        search.value = tray.query = '';
        search.blur();
        renderTray(true);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const first = trayItems()[0];
        if (first) search.blur(), trayPick(first);
      }
    });
    head.appendChild(search);
    const status = h('span', 'be-as-tray-status');
    head.appendChild(status);
    const lib = btn('Library', (e, b) => {
      b.blur();
      openLibrary();
    });
    lib.title = 'The whole library: details, likes, sorting';
    const up = btn('Upload', (e, b) => {
      b.blur();
      startUpload();
    });
    up.title = 'Pick blocks in your track and publish them as an asset';
    const hide = btn('×', (e, b) => {
      b.blur();
      toggleTray(false);
    }, 'be-as-x');
    hide.title = 'Close (B)';
    head.append(lib, up, hide);
    const strip = h('div', 'be-as-strip');
    // The wheel scrolls the strip sideways instead of zooming the camera.
    strip.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) strip.scrollLeft += e.deltaY;
    }, { passive: true });
    strip.addEventListener('scroll', () => hidePeek());
    const peek = h('div', 'be-as-peek');
    peek.hidden = true;
    el.append(head, strip, peek);
    for (const ev of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'wheel', 'contextmenu', 'click', 'dblclick']) el.addEventListener(ev, (e) => e.stopPropagation());
    root.appendChild(el);
    return { el, head, tabs, search, status, strip, peek, lib, up };
  }

  function trayItems() {
    if (!list) return [];
    const q = parseQuery(tray.query);
    if (q.words.length || q.tags.length || q.by) {
      const scored = [];
      for (const a of list) {
        const sc = searchScore(a, q);
        if (sc > 0) scored.push([sc, a]);
      }
      return scored.sort((x, y) => y[0] - x[0]).map((x) => x[1]);
    }
    const tab = trayTab();
    if (tab === 'recent') return recent.map(byId).filter(Boolean);
    if (tab === 'liked') return list.filter((a) => me?.liked.has(a.id)).sort(SORTS.newest.by);
    if (tab === 'mine') return list.filter((a) => me?.mine.has(a.id)).sort(SORTS.newest.by);
    return [...list].sort(SORTS.popular.by);
  }

  // Recent until there is nothing recent; Liked and Mine need NSWS.
  function trayTab() {
    let t = tray.tab;
    if ((t === 'liked' || t === 'mine') && !bridged) t = null;
    if (!t) t = recent.some((id) => byId(id)) ? 'recent' : 'popular';
    return t;
  }

  function toggleTray(on = !tray.open) {
    if (!ui) return;
    tray.open = on;
    store.set(TRAY_KEY, on ? '1' : '0');
    ui.tray.el.hidden = !on;
    ui.open.classList.toggle('on', on);
    clearInterval(tray.timer);
    hidePeek();
    if (on) {
      layoutTray();
      renderTray(true);
      loadList().then(() => renderTray(true)).catch((e) => setTrayStatus(e.message));
      if (bridged && !me) loadMe();
      // Which asset is on the cursor: Escape or another tool puts it down without telling anyone.
      tray.timer = setInterval(() => {
        const clip = self.__beAssetEditor?.clipboard();
        const id = clip?.tag?.asset ?? null;
        if (id !== tray.active) {
          tray.active = id;
          renderTray();
        }
        layoutTray();
      }, 300);
    } else {
      ui.root.style.removeProperty('--be-as-tray');
      ui.tray.search.blur();
    }
  }

  function setTrayStatus(text) {
    if (ui) ui.tray.status.textContent = text || '';
  }

  // Between the tools on the left (and the height box under them) and the block menu on the right.
  let lastLayout = '';
  function layoutTray() {
    if (!ui || !tray.open) return;
    const root = ui.root,
      rb = root.getBoundingClientRect(),
      k = root.offsetWidth / (rb.width || 1);
    let left = 0;
    for (const sel of ['.editor-side-toolbar-ui', '.editor-height-selector-ui']) {
      const b = root.querySelector(sel)?.getBoundingClientRect();
      if (b && b.width) left = Math.max(left, (b.right - rb.left) * k);
    }
    const panel = root.querySelector('.side > .side-panel')?.getBoundingClientRect();
    const right = panel && panel.width ? (rb.right - panel.left) * k : 0;
    const key = Math.round(left) + ',' + Math.round(right);
    if (key !== lastLayout) {
      lastLayout = key;
      Object.assign(ui.tray.el.style, { left: Math.round(left + 8) + 'px', right: Math.round(right + 8) + 'px' });
    }
    root.style.setProperty('--be-as-tray', ui.tray.el.offsetHeight + 'px');
  }

  function renderTray(reset) {
    if (!ui || !tray.open) return;
    // Settle on a tab once, so picking up from Popular doesn't flip the strip over to Recent under the cursor.
    if (!tray.tab && list) tray.tab = trayTab();
    const t = ui.tray;
    const tab = trayTab();
    const searching = !!tray.query.trim();
    for (const [k, b] of Object.entries(t.tabs)) {
      b.classList.toggle('on', !searching && k === tab);
      b.hidden = (k === 'liked' || k === 'mine') && !bridged;
    }
    const wait = waitLeft();
    t.up.disabled = wait > 0;
    t.up.textContent = wait > 0 ? 'Upload in ' + mins(wait) : 'Upload';
    t.up.hidden = !bridged;
    const items = trayItems();
    const active = tray.active ? byId(tray.active) : null;
    setTrayStatus(active ? 'On your cursor: ' + active.name + ' · click to place, Escape to stop' : list ? '' : 'Loading...');
    const strip = t.strip;
    const at = reset ? 0 : strip.scrollLeft;
    strip.textContent = '';
    if (!list) return;
    if (!items.length) {
      const msg = searching ? 'Nothing matches “' + tray.query.trim() + '”.' : tab === 'liked' ? 'Like assets in the library and they wait here.' : tab === 'mine' ? 'Assets you publish show up here. Press Upload to pick blocks from your track.' : 'No assets yet. Press Upload to publish the first one.';
      strip.appendChild(h('p', 'be-as-tray-empty', msg));
      return;
    }
    items.slice(0, 80).forEach((a, i) => {
      const b = h('button', 'button be-as-chip' + (a.id === tray.active ? ' on' : ''));
      const img = h('img', 'loading');
      img.alt = '';
      img.loading = 'lazy';
      img.draggable = false;
      img.addEventListener('load', () => img.classList.remove('loading'));
      img.src = thumbUrl(a);
      b.append(img, h('span', 'be-as-chip-t', a.name));
      if (i < 9) b.appendChild(h('span', 'be-as-key', String(i + 1)));
      b.addEventListener('click', () => {
        b.blur(); // Space rotates the part on the cursor; it mustn't press this button again
        trayPick(a);
      });
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        hidePeek();
        openLibrary({ kind: 'detail', id: a.id });
      });
      b.addEventListener('mouseenter', () => showPeek(a, b));
      b.addEventListener('mouseleave', hidePeek);
      strip.appendChild(b);
    });
    strip.scrollLeft = at;
  }

  async function trayPick(a) {
    hidePeek();
    if (tray.active === a.id && self.__beAssetEditor?.clipboard()?.tag?.asset === a.id) return;
    try {
      const { missing } = await pickUp(a, () => setTrayStatus('Loading ' + a.name + '...'));
      if (missing) toast(leftOut(missing), 6000);
    } catch (e) {
      setTrayStatus('');
      toast(e.message, 5000);
    }
  }

  function showPeek(a, b) {
    if (!ui) return;
    const p = ui.tray.peek;
    p.textContent = '';
    const img = h('img');
    img.alt = '';
    img.src = thumbUrl(a);
    const info = h('div', 'be-as-peek-i');
    const [dx, dy, dz] = a.dims || [];
    info.append(
      h('b', null, a.name),
      h('span', null, 'by ' + a.author),
      h('span', null, '♥ ' + a.likes + ' · ↓ ' + a.uses + ' used · ' + a.parts + (a.parts === 1 ? ' block' : ' blocks') + (dx ? ' · ' + dx + ' × ' + dz + ' tiles' : '')),
    );
    if (a.description) info.appendChild(h('span', 'be-as-peek-d', a.description));
    info.appendChild(h('span', 'be-as-peek-h', 'Click to place · right-click for details'));
    p.append(img, info);
    p.hidden = false;
    const strip = ui.tray.strip;
    const x = b.offsetLeft - strip.scrollLeft + strip.offsetLeft + b.offsetWidth / 2;
    const w = p.offsetWidth;
    p.style.left = Math.max(0, Math.min(ui.tray.el.clientWidth - w, x - w / 2)) + 'px';
    void dy;
  }
  function hidePeek() {
    if (ui) ui.tray.peek.hidden = true;
  }

  // While the library is open, keys belong to it: Escape steps back, and nothing reaches the editor's shortcuts (Delete,
  // X and the rest would act on the track underneath). Key-ups still go through, so a held camera key doesn't stick.
  function onModalKey(e) {
    if (!ui || ui.box.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      view.kind === 'list' ? closeLibrary() : goBack();
    } else if (!ui.box.contains(e.target)) e.stopPropagation();
  }

  // B opens and closes the tray, 1 to 9 pick up the first nine assets in it (while not typing).
  function onKey(e) {
    if (!ui || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!ui.box.hidden || picking || framing || ui.root.className !== 'editor-ui') return;
    if (e.code === 'KeyB') {
      e.preventDefault();
      toggleTray();
    } else if (tray.open && /^Digit[1-9]$/.test(e.code)) {
      const a = trayItems()[Number(e.code.slice(5)) - 1];
      if (a) {
        e.preventDefault();
        trayPick(a);
      }
    }
  }

  function likeAsset(a, b, say) {
    if (!bridged) return;
    const on = !me?.liked.has(a.id);
    return busy(b, async () => {
      try {
        const r = await call('like', { id: a.id, on });
        if (me) on ? me.liked.add(a.id) : me.liked.delete(a.id);
        a.likes = r.likes;
        a.uses = r.uses;
        a.local = Date.now();
        render();
      } catch (e) {
        if (e.status === 404) markDeleted(a.id);
        say(e.message, 'bad');
      }
    });
  }

  function deleteAsset(a, b, say) {
    return busy(b, async () => {
      try {
        await call('delete', { id: a.id });
        markDeleted(a.id);
        me?.mine.delete(a.id);
        toast('“' + a.name + '” was deleted.');
        view = { kind: 'list' };
        render();
      } catch (e) {
        say(e.message, 'bad');
      }
    });
  }

  function markDeleted(id) {
    gone.set(id, Date.now());
    if (list) list = list.filter((x) => x.id !== id);
    cache.delete(id);
  }

  // A paste of an asset went down: the server counts each player once.
  self.__beAssetPlaced = (clip) => {
    const id = clip?.tag?.asset;
    if (!id || counted.has(id)) return;
    counted.add(id);
    me?.used.add(id);
    if (!bridged) return;
    call('use', { id })
      .then((r) => {
        const a = byId(id);
        if (a && r && Number.isFinite(r.uses)) Object.assign(a, { uses: r.uses, likes: r.likes, local: Date.now() });
      })
      .catch(() => counted.delete(id));
  };

  // ---- upload ----------------------------------------------------------------------------------------------------
  function startUpload() {
    if (!bridged) return toast('Publishing assets works in the editor inside Not So Weekly Shorts.');
    const wait = waitLeft();
    if (wait > 0) return toast('You can publish one asset every 30 minutes. Try again in ' + mins(wait) + '.');
    const E = self.__beAssetEditor;
    if (!E) return;
    closeLibrary();
    self.__beAssetPicking = true;
    E.select();
    showBanner('Pick your asset’s blocks: click one corner, then the opposite corner. Change the height to reach other layers.', [['Cancel', () => stopPicking(true)]]);
    // Escape (or another tool) ends the copy tool's selection without a pick.
    picking = setInterval(() => {
      if (self.__beAssetPicking && !E.selecting()) stopPicking(true);
    }, 150);
  }

  function stopPicking(cancelled) {
    clearInterval(picking);
    picking = null;
    if (self.__beAssetPicking && cancelled) self.__beAssetEditor?.cancel();
    self.__beAssetPicking = false;
    hideBanner();
    if (cancelled) toast('Upload cancelled.');
  }

  self.__beAssetPicked = (sel) => {
    stopPicking(false);
    if (!sel || !sel.parts.length) {
      toast('There were no blocks in that box. Press Upload to try again.');
      return;
    }
    if (sel.parts.length > MAX_PARTS) {
      toast('That’s ' + sel.parts.length + ' blocks; an asset can hold ' + MAX_PARTS + ' at most.', 5000);
      return;
    }
    const parts = sel.parts.map((p) => ({ id: p.id, offset: { ...p.offset }, rotation: p.rotation, rotationAxis: p.rotationAxis, color: p.color, checkpointOrder: p.checkpointOrder ?? null }));
    view = { kind: 'form', mode: 'new', parts, size: footprint(sel.tiles) ?? dims(parts), name: '', description: '', tags: '', thumb: null, from: { kind: 'list' } };
    // A first picture of the view as it is, two frames on so the selection box is gone.
    requestAnimationFrame(() =>
      shoot(centreRect()).then((url) => {
        if (view.kind === 'form' && view.parts === parts && !view.thumb) {
          view.thumb = url;
          view.autoThumb = !!url;
          render();
        }
      }),
    );
    openLibrary(view);
  };

  function editAsset(a) {
    view = { kind: 'form', mode: 'edit', id: a.id, name: a.name, description: a.description || '', tags: (a.tags || []).join(', '), thumb: null, oldThumb: thumbUrl(a), from: { kind: 'detail', id: a.id } };
    render();
  }

  function takePicture() {
    const v = view;
    closeLibrary();
    // The editor's UI is scaled to the window, so screen pixels are turned into its own.
    const r = centreRect(),
      rb = ui.root.getBoundingClientRect(),
      k = ui.root.offsetWidth / (rb.width || 1);
    Object.assign(ui.frame.firstChild.style, { left: (r.x - rb.left) * k + 'px', top: (r.y - rb.top) * k + 'px', width: r.size * k + 'px', height: r.size * k + 'px' });
    ui.frame.hidden = false;
    ui.tray.el.hidden = true; // out of the way of the view being framed
    const done = async (take) => {
      window.removeEventListener('keydown', onKey, true);
      framing = null;
      hideBanner();
      if (ui) ui.tray.el.hidden = !tray.open;
      if (take) {
        const url = await shoot(centreRect());
        if (url) {
          v.thumb = url;
          v.autoThumb = false;
        } else toast('The picture came out empty. Try again.');
      }
      ui.frame.hidden = true;
      openLibrary(v);
    };
    const onKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        done(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        done(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    framing = { done };
    showBanner('Move the camera so your asset fills the square, then take the picture.', [
      ['Take picture', () => done(true)],
      ['Cancel', () => done(false)],
    ]);
  }

  function renderForm() {
    const v = view;
    const body = ui.body;
    body.textContent = '';
    const d = h('div', 'be-as-detail');
    const left = h('div', 'be-as-left');
    const pic = h('img', 'be-as-pic');
    pic.alt = '';
    if (v.thumb) pic.src = v.thumb;
    else if (v.oldThumb) pic.src = v.oldThumb;
    left.appendChild(pic);
    const picbar = h('div', 'be-as-picbar');
    const file = h('input');
    file.type = 'file';
    file.accept = 'image/png,image/jpeg,image/webp';
    file.hidden = true;
    file.addEventListener('change', async () => {
      try {
        v.thumb = await fromFile(file.files[0]);
        v.autoThumb = false;
        render();
      } catch (e) {
        say(e.message, 'bad');
      }
      file.value = '';
    });
    picbar.append(btn('Take picture', () => takePicture()), btn('Choose file', () => file.click()), file);
    left.appendChild(picbar);
    const right = h('div', 'be-as-right');
    const field = (label, hint, el) => {
      const f = h('label', 'be-as-field');
      const s = h('span', null, label + ' ');
      if (hint) s.appendChild(h('i', null, hint));
      f.append(s, el);
      return f;
    };
    const name = h('input');
    name.maxLength = NAME_MAX;
    name.value = v.name;
    name.placeholder = 'Birch tree';
    name.addEventListener('input', () => (v.name = name.value));
    const desc = h('textarea');
    desc.maxLength = DESC_MAX;
    desc.value = v.description;
    desc.placeholder = 'What it is, and anything worth knowing (place it on grass, it needs 2 tiles of room...)';
    desc.addEventListener('input', () => (v.description = desc.value));
    const tags = h('input');
    tags.maxLength = 160;
    tags.value = v.tags;
    tags.placeholder = 'tree, nature, autumn';
    tags.addEventListener('input', () => (v.tags = tags.value));
    right.append(field('Name', null, name), field('Description', '(optional)', desc), field('Tags', '(up to ' + TAGS_MAX + ', separated by commas; they help people find it)', tags));
    const st = h('div', 'be-as-stats');
    if (v.parts) {
      const [dx, dy, dz] = v.size;
      st.append(h('span', null, v.parts.length + (v.parts.length === 1 ? ' block' : ' blocks')), h('span', null, dx + ' × ' + dz + ' tiles, ' + dy + (dy === 1 ? ' layer' : ' layers')));
      right.appendChild(st);
    }
    const acts = h('div', 'be-as-acts');
    const note = h('p', 'be-as-note');
    const say = (text, cls) => {
      note.className = 'be-as-note' + (cls ? ' ' + cls : '');
      note.textContent = text;
    };
    if (v.mode === 'new' && v.autoThumb) say('The picture is your current view. Press Take picture to frame the asset better.');
    acts.appendChild(btn(v.mode === 'new' ? 'Publish' : 'Save', (e, b) => submitForm(v, b, say)));
    right.append(acts, note);
    d.append(left, right);
    body.appendChild(d);
    if (!v.name) setTimeout(() => name.isConnected && name.focus(), 0);
  }

  const tagList = (text) =>
    String(text || '')
      .split(/[,;\n]+/)
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean)
      .slice(0, TAGS_MAX);

  function submitForm(v, b, say) {
    if (!v.name.trim()) return say('Give your asset a name.', 'bad');
    if (v.mode === 'new' && !v.thumb) return say('Add a picture: Take picture frames your view, or choose a file.', 'bad');
    return busy(b, async () => {
      say(v.mode === 'new' ? 'Publishing...' : 'Saving...');
      try {
        const args = { name: v.name.trim(), description: v.description.trim(), tags: tagList(v.tags) };
        if (v.thumb) args.thumb = v.thumb;
        let r;
        if (v.mode === 'new') {
          args.parts = toWire(v.parts);
          args.kw = keywords(v.parts);
          args.dims = v.size;
          r = await call('publish', args);
        } else r = await call('update', Object.assign({ id: v.id }, args));
        const a = Object.assign(r.asset, { local: Date.now() });
        prepare(a);
        if (v.parts) cache.set(a.id, toWire(v.parts));
        list = [a, ...(list ?? []).filter((x) => x.id !== a.id)];
        if (me) {
          me.mine.add(a.id);
          if (v.mode === 'new') Object.assign(me, { wait: r.wait ?? 0, waitAt: Date.now() });
        }
        toast(v.mode === 'new' ? '“' + a.name + '” is in the library.' : 'Saved.');
        view = { kind: 'detail', id: a.id };
        render();
      } catch (e) {
        if (e.data?.id && ID.test(e.data.id)) {
          say(e.message, 'bad');
          return;
        }
        if (Number.isFinite(e.data?.wait) && me) Object.assign(me, { wait: e.data.wait, waitAt: Date.now() });
        say(e.message || 'That didn’t work. Try again.', 'bad');
      }
    });
  }

  function showBanner(text, buttons) {
    if (!ui) return;
    ui.banner.textContent = '';
    ui.banner.appendChild(h('span', null, text));
    for (const [label, fn] of buttons) ui.banner.appendChild(btn(label, fn));
    ui.banner.hidden = false;
  }
  const hideBanner = () => ui && (ui.banner.hidden = true);

  // ---- editor lifetime -------------------------------------------------------------------------------------------
  function open(ctx) {
    ed = { ctx };
    ui = makeUI();
    if (!ui) return;
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onModalKey, true);
    window.addEventListener('resize', layoutTray);
    connect().then(() => renderTray());
    if (tray.open) toggleTray(true);
  }

  function close() {
    if (picking) stopPicking(false);
    framing = null;
    self.__beAssetPicking = false;
    clearInterval(tray.timer);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keydown', onModalKey, true);
    window.removeEventListener('resize', layoutTray);
    ui?.tray.el.remove();
    ui?.tab.remove();
    ui?.box.remove();
    ui?.banner.remove();
    ui?.frame.remove();
    ui?.toast.remove();
    ui = null;
    ed = null;
  }

  // Opens and closes with the editor's own tools (tm_tools.js), which tools/patch.js hooks into the editor.
  const tools = self.TM.tools;
  if (tools && !tools.__assets) {
    tools.__assets = true;
    const { open: o, close: c } = tools;
    tools.open = function (ctx) {
      const out = o.apply(this, arguments);
      try {
        open(ctx);
      } catch (e) {
        console.warn('asset library:', e);
      }
      return out;
    };
    tools.close = function () {
      try {
        close();
      } catch {}
      return c.apply(this, arguments);
    };
  }

  return {
    // For tools/test/assets.mjs.
    state: () => ({ open: !!ui && !ui.box.hidden, view: view.kind, bridged, count: list?.length ?? null, me: me && { owner: me.owner, mine: [...me.mine], liked: [...me.liked], used: [...me.used], wait: waitLeft() } }),
    search: (text) => {
      query = text;
      if (list) return results().map((a) => a.name);
      return null;
    },
    parseQuery,
    openLibrary,
    closeLibrary,
    toggleTray: (on) => toggleTray(on),
    tray: () => ({ open: tray.open, tab: ui && tray.open ? trayTab() : null, active: tray.active, items: trayItems().map((a) => a.name), recent: [...recent] }),
  };
})();
