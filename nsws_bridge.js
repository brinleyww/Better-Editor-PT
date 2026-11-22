// Lets Not So Weekly Shorts embed this editor (index.html?nsws=1 in an iframe) and move tracks in and out.
// Messages are {nsws: "be", type, reqId?, ...}; only the parent pages listed in ORIGIN are answered.
(function () {
    "use strict";
    if (window.parent === window) return;
    const PREFIX = "polytrack_v5_prod_track_";
    const ORIGIN = /^(https:\/\/(brinleyww|notweeklyshorts)\.github\.io|https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;
    let parentOrigin = null;
    let lastSig = null;
    let listening = false;
    let mode = "normal";

    // Reports the block download (about 60 MB the first time) so NSWS can draw a loading bar over this frame.
    let blocks = null;
    let blocksSent = 0;
    const realFetch = window.fetch;
    window.fetch = function (input) {
        const url = typeof input === "string" ? input : input?.url || "";
        const p = realFetch.apply(window, arguments);
        if (!/tm_blocks\.bin(\?|$)/.test(url)) return p;
        return p.then((r) => {
            if (!r.ok || !r.body) return r;
            const total = Number(self.TM_DATA?.binBytes) || Number(r.headers.get("content-length")) || 0;
            const reader = r.body.getReader();
            blocks = { loaded: 0, total };
            sendBlocks(true);
            const stream = new ReadableStream({
                async pull(c) {
                    const { done, value } = await reader.read();
                    if (done) {
                        blocks.loaded = Math.max(blocks.loaded, total);
                        sendBlocks(true);
                        return c.close();
                    }
                    blocks.loaded += value.byteLength;
                    sendBlocks(false);
                    c.enqueue(value);
                },
                cancel: (e) => reader.cancel(e),
            });
            return new Response(stream, { status: r.status, statusText: r.statusText, headers: r.headers });
        });
    };

    function sendBlocks(now) {
        if (!blocks || (!now && Date.now() - blocksSent < 150)) return;
        blocksSent = Date.now();
        post({ type: "progress", loaded: blocks.loaded, total: blocks.total });
    }

    function currentTrack() {
        try {
            // Watching another builder (nsws_watch.js): the player's own track, never the one on screen.
            if (self.__beWatch?.active()) return self.__beWatch.own();
            return self.__beEditorCurrent ? self.__beEditorCurrent() : null;
        } catch {
            return null;
        }
    }

    // Exit and Escape in the editor close it back to the NSWS menu; the track stays open with its changes.
    self.__beExitHook = () => {
        if (!parentOrigin) return false;
        post({ type: "exit" });
        return true;
    };

    // Rocket League and Royale only exist in the NSWS game, so with either picked the editor's Test runs there.
    self.__beTestHook = () => {
        if (mode === "normal" || !parentOrigin) return false;
        const t = currentTrack();
        if (!t) return false;
        // No start block: the editor's own Test says so, where NSWS could only fail to start the race.
        try {
            if (self.__beTrackData.fromExportString(t.code).trackData.getStartTransform() == null) return false;
        } catch {
            return false;
        }
        post({ type: "test", mode, name: t.name, code: t.code });
        return true;
    };

    // A Test that reaches the finish is a run on the open track in NSWS (saved there as the player's).
    let testCode = null;
    let physics = null;
    fetch("physics.json", { cache: "no-cache" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => (physics = Number.isSafeInteger(j?.version) && j.version > 0 ? j.version : 1))
        .catch(() => {});
    function hookTests() {
        const tools = self.TM?.tools;
        const hud = self.TM?.hud;
        if (!tools?.testStart || !hud?.state || hud.nswsRuns) return;
        hud.nswsRuns = true;
        const { testStart, testEnd } = tools;
        const { state, focus } = hud;
        let player = null;
        const finished = new WeakMap();
        tools.testStart = function () {
            testCode = currentTrack()?.code || null;
            return testStart.apply(this, arguments);
        };
        tools.testEnd = function () {
            testCode = null;
            return testEnd.apply(this, arguments);
        };
        hud.focus = function (car) {
            player = car;
            return focus.apply(this, arguments);
        };
        hud.state = function (car, s) {
            const out = state.apply(this, arguments);
            const done = s?.finishFrames != null;
            if (done && !finished.get(car) && car === player && testCode && parentOrigin) {
                const code = testCode;
                // After this frame's finish callbacks, so the recording is the whole run.
                setTimeout(() => sendRun(car, code, s.finishFrames), 0);
            }
            finished.set(car, done);
            return out;
        };
    }
    function sendRun(car, code, frames) {
        try {
            const rec = car.getRecording?.();
            const parsed = self.__beTrackData?.fromExportString(code);
            if (!rec || !parsed) return;
            post({ type: "run", trackId: parsed.trackData.getId(), be: code.startsWith("PolyTrackBE"), frames, recording: rec.serialize(), physics });
        } catch (e) {
            console.warn(e);
        }
    }
    hookTests();

    // NSWS hides the editor between uses (it keeps its unsaved work), and a hidden frame on the same site would keep
    // drawing the whole track every frame behind the game. Paused, frame callbacks wait until NSWS shows it again.
    let paused = false;
    let heldId = 0;
    const held = new Map();
    const realRaf = window.requestAnimationFrame.bind(window);
    const realCancel = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => {
        if (!paused) return realRaf(cb);
        held.set(--heldId, cb);
        return heldId;
    };
    window.cancelAnimationFrame = (id) => (id < 0 ? held.delete(id) : realCancel(id));
    function setPaused(on) {
        paused = on;
        if (on) return;
        const cbs = [...held.values()];
        held.clear();
        for (const cb of cbs) realRaf(cb);
    }

    function post(msg) {
        if (!parentOrigin) return;
        try {
            window.parent.postMessage(Object.assign({ nsws: "be" }, msg), parentOrigin);
        } catch {}
    }

    function trackKeys() {
        try {
            return Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).sort();
        } catch {
            return [];
        }
    }

    // Names this editor's saved tracks for NSWS, which keeps them in step with My Tracks: a new id means another store
    // (cleared storage, or the Worker mirror's origin), where missing tracks were never deleted.
    const STORE_KEY = "nsws_bridge_store";
    function storeId() {
        try {
            let id = localStorage.getItem(STORE_KEY);
            if (!id) localStorage.setItem(STORE_KEY, (id = Math.random().toString(36).slice(2) + Date.now().toString(36)));
            return id;
        } catch {
            return null;
        }
    }

    // The store's own list (this site's storage), also while library mode stands in for it.
    function ownTracks(cb) {
        const store = self.__beTrackStore;
        if (store) Object.getPrototypeOf(store).forEachCustomTrack.call(store, cb);
    }

    function listTracks() {
        const ids = new Map();
        ownTracks((id, meta) => ids.set(meta.name, id));
        const out = [];
        for (const key of trackKeys()) {
            try {
                const saved = JSON.parse(localStorage.getItem(key));
                const name = key.slice(PREFIX.length);
                if (saved && typeof saved.data === "string") out.push({ name, code: saved.data, saveTime: Number(saved.saveTime) || 0, id: ids.get(name) || null });
            } catch {}
        }
        if (!out.length && self.__beTrackStore) {
            // Builds whose storage isn't localStorage still have the editor's in-memory list.
            ownTracks((id, meta, data) => {
                try {
                    out.push({ name: meta.name, code: data.toExportString(meta), saveTime: 0, id });
                } catch {}
            });
        }
        return out.sort((a, b) => b.saveTime - a.saveTime);
    }

    function signature() {
        const keys = trackKeys();
        let sig = keys.join("\n");
        for (const k of keys) {
            try {
                sig += "|" + (localStorage.getItem(k) || "").length;
            } catch {}
        }
        return sig;
    }

    function checkChanged() {
        hookStore();
        hookLibrary();
        if (!parentOrigin) return;
        const sig = signature();
        if (lastSig !== null && sig !== lastSig) post({ type: "changed" });
        lastSig = sig;
    }

    function hookStore() {
        if (listening || !self.__beTrackStore?.addCustomTracksChangedListener) return;
        listening = true;
        self.__beTrackStore.addCustomTracksChangedListener(() => setTimeout(checkChanged, 0));
    }

    function freeName(base) {
        const store = self.__beTrackStore;
        const taken = (n) => store.checkCustomTrackNameExists(n);
        if (!taken(base)) return base;
        for (let i = 2; i < 1000; i++) {
            const name = base.slice(0, 44) + " (" + i + ")";
            if (!taken(name)) return name;
        }
        return base + " " + Date.now();
    }

    function importCode(code) {
        const TD = self.__beTrackData;
        const store = self.__beTrackStore;
        if (!TD || !store) return { ok: false, error: "The editor is still loading. Try again in a moment." };
        const parsed = typeof code === "string" ? TD.fromExportString(code) : null;
        if (!parsed) return { ok: false, error: "The editor can't read that track code." };
        const { trackMetadata: meta, trackData: data } = parsed;
        const id = data.getId();
        let existing = null;
        store.forEachCustomTrack((otherId, otherMeta) => {
            if (otherId === id && !existing) existing = otherMeta.name;
        });
        if (existing) return { ok: true, name: existing, opened: false, existed: true };
        const name = freeName(String(meta.name || "Track"));
        const saved = store.saveCustomTrack({ name, author: meta.author ?? null, lastModified: meta.lastModified ?? null }, data);
        if (!saved) return { ok: false, error: "The editor couldn't save the track. Its storage may be full." };
        checkChanged();
        return { ok: true, name, opened: false };
    }

    // NSWS shares this site's localStorage, so copies stop well before it is full.
    const COPY_ROOM = 3500000;

    // Copies NSWS's My Tracks in for the editor's Load list; a track already saved here (same track or name) is left alone.
    function copyIn(list) {
        const TD = self.__beTrackData;
        const store = self.__beTrackStore;
        if (!TD || !store) return { ok: false, error: "The editor is still loading. Try again in a moment." };
        let used = 0;
        try {
            for (const k of Object.keys(localStorage)) used += k.length + (localStorage.getItem(k) || "").length;
        } catch {}
        // Same blocks under another name ("Unnamed Track (2)") is another track to My Tracks, so it is copied too.
        const ids = new Set();
        store.forEachCustomTrack((id, m) => ids.add(id + "\n" + m.name));
        const results = [];
        let changed = false;
        for (const item of Array.isArray(list) ? list : []) {
            const code = item?.code;
            let parsed = null;
            try {
                parsed = typeof code === "string" ? TD.fromExportString(code) : null;
            } catch {}
            if (!parsed) {
                results.push({ ok: false });
                continue;
            }
            const { trackMetadata: meta, trackData: data } = parsed;
            const id = data.getId() + "\n" + String(meta.name || "Track");
            if (ids.has(id)) {
                results.push({ ok: true, name: String(meta.name || "Track"), existed: true });
                continue;
            }
            // The editor keeps one track per name, and My Tracks can hold several of one name: the others get a number.
            const base = String(meta.name || "Track").slice(0, 58);
            let name = String(meta.name || "Track");
            for (let n = 2; store.checkCustomTrackNameExists(name); n++) name = base + " (" + n + ")";
            if (used + code.length > COPY_ROOM || !store.saveCustomTrack({ name, author: meta.author ?? null, lastModified: meta.lastModified ?? null }, data)) {
                results.push({ ok: false, full: true });
                continue;
            }
            used += code.length;
            ids.add(id);
            changed = true;
            results.push({ ok: true, name });
        }
        if (changed) checkChanged();
        return { ok: true, results };
    }

    // A My Tracks entry changed elsewhere (another device's editor): its copy here, under the name it has here.
    function putTrack(name, code) {
        const TD = self.__beTrackData;
        const store = self.__beTrackStore;
        if (!TD || !store) return { ok: false, error: "The editor is still loading. Try again in a moment." };
        if (typeof name !== "string" || !name || !store.checkCustomTrackNameExists(name)) return { ok: false, gone: true };
        let parsed = null;
        try {
            parsed = typeof code === "string" ? TD.fromExportString(code) : null;
        } catch {}
        if (!parsed) return { ok: false, error: "The editor can't read that track code." };
        let used = 0, old = 0;
        try {
            for (const k of Object.keys(localStorage)) used += k.length + (localStorage.getItem(k) || "").length;
            old = (localStorage.getItem(PREFIX + name) || "").length;
        } catch {}
        const { trackMetadata: meta, trackData: data } = parsed;
        if (used - old + code.length > COPY_ROOM || !store.saveCustomTrack({ name, author: meta.author ?? null, lastModified: meta.lastModified ?? null }, data)) return { ok: false, full: true };
        checkChanged();
        return { ok: true, name };
    }

    function deleteTrack(name) {
        const store = self.__beTrackStore;
        if (!store) return { ok: false, error: "The editor is still loading. Try again in a moment." };
        if (typeof name !== "string" || !store.checkCustomTrackNameExists(name)) return { ok: true, gone: true };
        const ok = !!store.deleteCustomTrack(name);
        if (ok) checkChanged();
        return { ok };
    }

    // Library mode (NSWS sends "library"): the editor's custom tracks are NSWS's My Tracks, in the order My Tracks shows them.
    // Nothing goes in this site's storage. Save and delete go to NSWS by My Tracks id, so two tracks may share a name.
    // self.__beOpenKey is the id of the entry open in the editor: null for a new track, "tmp:n" while NSWS adds a new one.
    let library = null;
    const raw = new Map();
    const parsed = new Map();
    const keyOf = new WeakMap();
    const unsent = new Map();
    // Saves on their way, per id: until NSWS answers, its list can still carry the code from before.
    const busy = new Map();
    const dropAfterSave = new Set();
    let tmpSeq = 0;
    let parseTimer = null;

    const tracksChanged = () => {
        if (self.__beTrackStore?.__nswsLibrary) self.__beTracksChanged?.();
    };

    function current(key) {
        const hit = parsed.get(key);
        return hit && (hit.hash === raw.get(key)?.hash || busy.get(key)) ? hit : null;
    }

    function makeEntry(key, meta, data, saveTime, code) {
        let thumbnail = null;
        try {
            thumbnail = data.createThumbnail();
        } catch {}
        keyOf.set(meta, key);
        return { key, id: data.getId(), trackMetadata: meta, trackData: data, thumbnail: thumbnail || "images/summer.svg", saveTime: saveTime || 0, code: code || null };
    }

    // A code that can't be read is remembered as unreadable (entry null), so it isn't tried on every refresh.
    function entryOf(key) {
        if (unsent.has(key)) return unsent.get(key);
        const hit = current(key);
        if (hit) return hit.entry;
        const r = raw.get(key);
        if (!r) return null;
        let p = null;
        try {
            p = typeof r.code === "string" ? self.__beTrackData?.fromExportString(r.code) : null;
        } catch {}
        if (!p && !self.__beTrackData) return null;
        const entry = p ? makeEntry(key, p.trackMetadata, p.trackData, r.saveTime) : null;
        parsed.set(key, { hash: r.hash, entry });
        return entry;
    }

    // Tracks read so far, in order. The rest are read a few at a time (parseSoon), and the lists refresh when they are.
    function entries() {
        if (!library) return [];
        const out = [...unsent.values()];
        let waiting = false;
        for (const key of library) {
            const hit = current(key);
            if (hit) hit.entry && out.push(hit.entry);
            else waiting = true;
        }
        if (waiting) parseSoon();
        return out;
    }

    function parseSoon() {
        if (parseTimer || !self.__beTrackData) return;
        parseTimer = setTimeout(function step() {
            const end = Date.now() + 40;
            for (const key of library || []) {
                if (current(key)) continue;
                if (Date.now() > end) {
                    parseTimer = setTimeout(step, 0);
                    return;
                }
                entryOf(key);
            }
            parseTimer = null;
            tracksChanged();
        }, 0);
    }

    // items: [{key, hash, saveTime, code?}] in order; code is left out when this frame was sent that version already.
    // Returns the ids whose code is missing here.
    function setLibrary(items) {
        const keys = [];
        const need = [];
        for (const it of Array.isArray(items) ? items : []) {
            if (!it || typeof it.key !== "string" || !it.key || typeof it.hash !== "string") continue;
            const have = raw.get(it.key);
            if (typeof it.code === "string") raw.set(it.key, { hash: it.hash, code: it.code, saveTime: Number(it.saveTime) || 0 });
            else if (have?.hash !== it.hash) {
                need.push(it.key);
                if (!have) continue;
            }
            keys.push(it.key);
        }
        const keep = new Set(keys);
        for (const key of [...raw.keys()]) {
            if (keep.has(key)) continue;
            if (busy.get(key)) keys.push(key);
            else {
                raw.delete(key);
                parsed.delete(key);
            }
        }
        const first = !library;
        library = keys;
        hookLibrary();
        tracksChanged();
        if (first || keys.some((k) => !current(k))) parseSoon();
        return need;
    }

    function hookLibrary() {
        const store = self.__beTrackStore;
        if (!library || !store || store.__nswsLibrary) return;
        store.__nswsLibrary = true;
        const own = Object.getPrototypeOf(store);
        store.forEachCustomTrack = function (cb) {
            if (!library) return own.forEachCustomTrack.call(this, cb);
            for (const e of entries()) cb(e.id, e.trackMetadata, e.trackData, e.thumbnail);
        };
        store.isCustomTracksEmpty = function () {
            return library ? !library.length && !unsent.size : own.isCustomTracksEmpty.call(this);
        };
        store.checkCustomTrackNameExists = function (name) {
            return library ? false : own.checkCustomTrackNameExists.call(this, name);
        };
        store.saveCustomTrack = function (meta, data, how) {
            return library ? librarySave(meta, data, how) : own.saveCustomTrack.call(this, meta, data);
        };
        store.deleteCustomTrack = function (name, meta) {
            return library ? libraryDelete(name, meta) : own.deleteCustomTrack.call(this, name);
        };
        tracksChanged();
    }

    self.__beOpened = (meta) => {
        if (library) self.__beOpenKey = (meta && keyOf.get(meta)) || null;
    };

    // The editor's Save (and autosave) write to the entry that is open; an import is always a new entry.
    function librarySave(meta, data, how) {
        let code;
        try {
            code = data.toExportString(meta);
        } catch {
            return false;
        }
        const imported = how === "import";
        let key = imported ? null : self.__beOpenKey ?? null;
        // Deleted from My Tracks while it was open: the save makes it a new entry again.
        if (key && !key.startsWith("tmp:") && !raw.has(key)) key = null;
        if (key?.startsWith("tmp:") && !unsent.has(key)) key = null;
        const tmp = key?.startsWith("tmp:") ? key : key ? null : "tmp:" + ++tmpSeq;
        const local = key || tmp;
        const entry = makeEntry(local, meta, data, Date.now(), code);
        if (tmp) unsent.set(tmp, entry);
        else {
            parsed.set(local, { hash: null, entry });
            busy.set(local, (busy.get(local) || 0) + 1);
        }
        if (!imported) self.__beOpenKey = local;
        post({ type: "save", key: tmp ? null : local, tmp, code, name: String(meta.name ?? ""), imported });
        tracksChanged();
        return true;
    }

    // NSWS's answer to a save: {tmp, key, id, hash, ok}.
    function onSaved(m) {
        if (m.key) {
            const n = (busy.get(m.key) || 1) - 1;
            n > 0 ? busy.set(m.key, n) : busy.delete(m.key);
        }
        const entry = m.tmp ? unsent.get(m.tmp) : parsed.get(m.key)?.entry;
        if (m.tmp) unsent.delete(m.tmp);
        if (!m.ok || typeof m.id !== "string" || !m.id) {
            if (m.tmp && self.__beOpenKey === m.tmp) self.__beOpenKey = null;
            tracksChanged();
            return;
        }
        if (m.tmp && dropAfterSave.delete(m.tmp)) {
            post({ type: "delete", key: m.id });
            return;
        }
        // A key that became another id: the entry was gone from My Tracks, so the save made a new one.
        if (m.key && m.key !== m.id) {
            busy.delete(m.key);
            raw.delete(m.key);
            parsed.delete(m.key);
            if (library) library = library.filter((k) => k !== m.key);
        }
        if (entry && (!m.key || !busy.get(m.key))) {
            entry.key = m.id;
            keyOf.set(entry.trackMetadata, m.id);
            raw.set(m.id, { hash: String(m.hash || ""), code: entry.code, saveTime: entry.saveTime });
            parsed.set(m.id, { hash: String(m.hash || ""), entry });
        }
        if (self.__beOpenKey === (m.tmp || m.key)) self.__beOpenKey = m.id;
        if (library && !library.includes(m.id)) library.unshift(m.id);
        tracksChanged();
    }

    // The track lists' delete button: the very track picked (meta), by name only when no other track has that name.
    function libraryDelete(name, meta) {
        let key = (meta && keyOf.get(meta)) || null;
        if (!key) {
            const hits = entries().filter((e) => e.trackMetadata.name === name);
            if (hits.length === 1) key = hits[0].key;
        }
        if (!key) return false;
        if (key.startsWith("tmp:")) {
            unsent.delete(key);
            dropAfterSave.add(key);
        } else post({ type: "delete", key });
        if (library) library = library.filter((k) => k !== key);
        raw.delete(key);
        parsed.delete(key);
        if (self.__beOpenKey === key) self.__beOpenKey = null;
        tracksChanged();
        return true;
    }

    const wait = (test, ms) => new Promise((resolve) => {
        const end = Date.now() + ms;
        (function check() {
            if (test()) resolve(true);
            else if (Date.now() > end) resolve(false);
            else setTimeout(check, 100);
        })();
    });

    function savedTrack(name) {
        let found = null;
        self.__beTrackStore?.forEachCustomTrack((id, meta, data) => {
            if (!found && meta.name === name) found = { meta, data };
        });
        return found;
    }

    // Opens the editor (without the menu) on a saved track, or on an empty one when name is null. In library mode: on the My
    // Tracks entry `key`, or on `code` as a new track (Save adds it to My Tracks).
    // force: false answers {dirty: true} instead of dropping unsaved changes.
    async function editTrack(name, force, fresh, key, code) {
        if (!self.__beStartEditor || !self.__beTrackStore) return { ok: false, error: "The editor is still loading. Try again in a moment." };
        if (!force && self.__beEditorDirty?.()) return { ok: false, dirty: true };
        let track = null;
        if (key != null) {
            hookLibrary();
            const e = library?.includes(key) || unsent.has(key) ? entryOf(key) : null;
            if (!e) return { ok: false, gone: true, error: "That track isn't in My Tracks any more." };
            track = { meta: e.trackMetadata, data: e.trackData };
        } else if (code != null) {
            let p = null;
            try {
                p = self.__beTrackData?.fromExportString(code);
            } catch {}
            if (!p) return { ok: false, error: "The editor can't read that track code." };
            track = { meta: p.trackMetadata, data: p.trackData };
        } else if (name != null) {
            track = savedTrack(name);
            if (!track) return { ok: false, error: "The editor has no saved track called \"" + name + "\"." };
        }
        if (!self.__beEditorOpen || (fresh && !track)) {
            // Starting the editor while the game is still loading gets undone when loading finishes.
            await wait(() => !document.querySelector(".loading-screen"), 60000);
            await new Promise((r) => setTimeout(r, 500));
            self.__beStartEditor();
            if (!(await wait(() => self.__beEditorOpen, 20000))) return { ok: false, error: "The editor didn't open." };
            await new Promise((r) => setTimeout(r, 300));
        }
        if (track) self.__beEditorOpen(track.meta, null, () => Promise.resolve(track.data));
        return { ok: true, name: track ? track.meta.name : null };
    }

    // NSWS's settings each time it shows the editor again: the frame stays loaded between uses, so a setting changed in
    // NSWS meanwhile (Wheel info, say) would otherwise wait for a page reload. In memory only, as nsws_prefs.js's first
    // copy is what the editor saves.
    function applySettings(list) {
        const s = self.__beSettings;
        if (!s || !Array.isArray(list)) return;
        const low = list.some((p) => Array.isArray(p) && p[0] === "LowPerformanceMode" && p[1] === "true");
        const out = [];
        for (const p of list) {
            if (!Array.isArray(p) || p.length !== 2 || typeof p[1] !== "string" || !Object.hasOwn(s.names, p[0]) || typeof s.names[p[0]] !== "number") continue;
            out.push([s.names[p[0]], p[0] === "ScreenPixelDensity" && low ? "false" : p[1]]);
        }
        if (out.length) s.manager.updateSettings(out);
    }

    // The asset library (tm_assets.js) reads, likes and publishes through NSWS, with the player's NSWS account; the token
    // stays on the NSWS page. Only a page that said it answers these (hello assets: 1) gets them.
    let assetsParent = false;
    let assetSeq = 0;
    const assetWaits = new Map();
    self.__beBridgeAssets = (op, args) => {
        if (!parentOrigin || !assetsParent) return null;
        const reqId = "a" + ++assetSeq;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                assetWaits.delete(reqId);
                reject(new Error("Not So Weekly Shorts didn't answer. Try again."));
            }, op === "publish" || op === "update" ? 100000 : 35000);
            assetWaits.set(reqId, { resolve, reject, timer });
            post({ type: "assets", reqId, op, args: args || {} });
        });
    };

    window.addEventListener("message", (e) => {
        const msg = e.data;
        if (e.source !== window.parent || !msg || msg.nsws !== "be" || !ORIGIN.test(e.origin)) return;
        parentOrigin = e.origin;
        const reply = (body) => post(Object.assign({ type: msg.type, reqId: msg.reqId }, body));
        if (msg.type === "assets-reply") {
            const w = assetWaits.get(msg.reqId);
            if (!w) return;
            assetWaits.delete(msg.reqId);
            clearTimeout(w.timer);
            if (msg.ok) w.resolve(msg.data);
            else w.reject(Object.assign(new Error(msg.error || "Something went wrong."), { status: msg.status || 0, data: msg.data || null }));
            return;
        }
        if (msg.type === "hello") {
            if (msg.assets === 1) assetsParent = true;
            if (lastSig === null) lastSig = signature();
            post({ type: "ready", version: 10, reqId: msg.reqId, loaded: !!self.__beTrackStore && !!self.__beStartEditor, editing: !!self.__beEditorOpen, store: storeId() });
            sendBlocks(true);
        } else if (msg.type === "library") {
            let need = [];
            try {
                need = setLibrary(msg.tracks);
            } catch (err) {
                console.warn("NSWS library:", err);
            }
            reply({ ok: true, need });
        } else if (msg.type === "saved") {
            try {
                onSaved(msg);
            } catch (err) {
                console.warn("NSWS library:", err);
            }
        } else if (library && ["put", "delete", "import", "copy"].includes(msg.type)) {
            reply({ ok: false, error: "The editor's tracks are My Tracks now." });
        } else if (msg.type === "list") {
            reply({ tracks: listTracks(), loaded: !!self.__beTrackStore, store: storeId() });
        } else if (msg.type === "ids") {
            const TD = self.__beTrackData;
            reply({
                ids: (Array.isArray(msg.codes) ? msg.codes : []).map((code) => {
                    try {
                        return (TD && typeof code === "string" && TD.fromExportString(code)?.trackData.getId()) || null;
                    } catch {
                        return null;
                    }
                }),
            });
        } else if (msg.type === "put" || msg.type === "delete") {
            let result;
            try {
                result = msg.type === "put" ? putTrack(msg.name, msg.code) : deleteTrack(msg.name);
            } catch (err) {
                result = { ok: false, error: "The editor couldn't change that track." };
            }
            reply(result);
        } else if (msg.type === "import") {
            let result;
            try {
                result = importCode(msg.code);
            } catch (err) {
                result = { ok: false, error: "The editor couldn't read that track code." };
            }
            reply(result);
        } else if (msg.type === "copy") {
            let result;
            try {
                result = copyIn(msg.tracks);
            } catch (err) {
                result = { ok: false, error: "The editor couldn't take those tracks." };
            }
            reply(result);
        } else if (msg.type === "edit") {
            const str = (v) => (typeof v === "string" ? v : null);
            editTrack(str(msg.name), !!msg.force, !!msg.fresh, str(msg.key), str(msg.code)).then(reply, () => reply({ ok: false, error: "The editor couldn't open that track." }));
        } else if (msg.type === "current") {
            reply({ track: currentTrack(), key: library ? self.__beOpenKey ?? null : undefined });
        } else if (msg.type === "pause") {
            setPaused(!!msg.paused);
            // Put away while watching someone build: the player's own track comes back first.
            if (msg.paused) self.__beWatch?.stop();
            // A Build Off's finish lock (nsws_cup.js) ends when the editor is put away.
            if (msg.paused) self.__beCup?.unlock();
            reply({ ok: true });
        } else if (msg.type === "cup") {
            // Cuppa Build Off: status, lock, unlock and fill (nsws_cup.js).
            let result;
            try {
                const cup = self.__beCup;
                // The finish guard works on the player's own track, so a lock or fill ends watching first.
                if (self.__beWatch?.active() && msg.op !== "status") self.__beWatch.stop();
                result = self.__beWatch?.active() ? { ok: false, error: "watching" } : cup && ["status", "lock", "unlock", "fill"].includes(msg.op) ? cup[msg.op](msg) : { ok: false, error: "closed" };
            } catch (err) {
                console.warn("NSWS cup:", err);
                result = { ok: false, error: "failed" };
            }
            if (msg.reqId) reply(result);
        } else if (msg.type === "watch") {
            // Cuppa Build Off: watching another builder (nsws_watch.js): show, stop, cam, view, status.
            let result;
            try {
                const w = self.__beWatch;
                result = w && ["show", "stop", "cam", "view", "status"].includes(msg.op) ? w[msg.op](msg) : { ok: false, error: "closed" };
            } catch (err) {
                console.warn("NSWS watch:", err);
                result = { ok: false, error: "failed" };
            }
            if (msg.reqId) reply(result);
        } else if (msg.type === "settings") {
            try {
                applySettings(msg.settings);
            } catch (err) {
                console.warn("NSWS settings:", err);
            }
        } else if (msg.type === "mode") {
            mode = ["rocket", "royale"].includes(msg.mode) ? msg.mode : "normal";
            reply({ ok: true });
        } else if (msg.type === "dirty") {
            // Asked before NSWS reloads for an update. Watching someone build holds the player's own track aside.
            let dirty = true;
            try {
                dirty = !!self.__beWatch?.active() || !!self.__beEditorDirty?.();
            } catch (err) {
                console.warn("NSWS dirty:", err);
            }
            reply({ dirty });
        } else if (msg.type === "autosave") {
            let result = { saved: false, reason: "closed" };
            try {
                if (self.__beWatch?.active()) result = { saved: false, reason: "watching" };
                else if (self.__beAutosave) result = self.__beAutosave();
            } catch (err) {
                result = { saved: false, reason: "failed" };
            }
            if (result.saved) checkChanged();
            reply(result);
        }
    });
    window.addEventListener("storage", (e) => {
        if (!e.key || e.key.startsWith(PREFIX)) checkChanged();
    });
    setInterval(checkChanged, 2000);
})();
