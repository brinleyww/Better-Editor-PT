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

    function listTracks() {
        const ids = new Map();
        self.__beTrackStore?.forEachCustomTrack((id, meta) => ids.set(meta.name, id));
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
            self.__beTrackStore.forEachCustomTrack((id, meta, data) => {
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

    // Opens the editor (without the menu) on a saved track, or on an empty one when name is null.
    // force: false answers {dirty: true} instead of dropping unsaved changes.
    async function editTrack(name, force, fresh) {
        if (!self.__beStartEditor || !self.__beTrackStore) return { ok: false, error: "The editor is still loading. Try again in a moment." };
        if (!force && self.__beEditorDirty?.()) return { ok: false, dirty: true };
        const track = name != null ? savedTrack(name) : null;
        if (name != null && !track) return { ok: false, error: "The editor has no saved track called \"" + name + "\"." };
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

    window.addEventListener("message", (e) => {
        const msg = e.data;
        if (e.source !== window.parent || !msg || msg.nsws !== "be" || !ORIGIN.test(e.origin)) return;
        parentOrigin = e.origin;
        const reply = (body) => post(Object.assign({ type: msg.type, reqId: msg.reqId }, body));
        if (msg.type === "hello") {
            if (lastSig === null) lastSig = signature();
            post({ type: "ready", version: 5, reqId: msg.reqId, loaded: !!self.__beTrackStore && !!self.__beStartEditor, editing: !!self.__beEditorOpen, store: storeId() });
            sendBlocks(true);
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
            editTrack(typeof msg.name === "string" ? msg.name : null, !!msg.force, !!msg.fresh).then(reply, () => reply({ ok: false, error: "The editor couldn't open that track." }));
        } else if (msg.type === "current") {
            reply({ track: currentTrack() });
        } else if (msg.type === "pause") {
            setPaused(!!msg.paused);
            reply({ ok: true });
        } else if (msg.type === "settings") {
            try {
                applySettings(msg.settings);
            } catch (err) {
                console.warn("NSWS settings:", err);
            }
        } else if (msg.type === "mode") {
            mode = ["rocket", "royale"].includes(msg.mode) ? msg.mode : "normal";
            reply({ ok: true });
        } else if (msg.type === "autosave") {
            let result = { saved: false, reason: "closed" };
            try {
                if (self.__beAutosave) result = self.__beAutosave();
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
