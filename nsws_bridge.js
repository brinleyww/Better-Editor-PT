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

    function listTracks() {
        const out = [];
        for (const key of trackKeys()) {
            try {
                const saved = JSON.parse(localStorage.getItem(key));
                if (saved && typeof saved.data === "string")
                    out.push({ name: key.slice(PREFIX.length), code: saved.data, saveTime: Number(saved.saveTime) || 0 });
            } catch {}
        }
        if (!out.length && self.__beTrackStore) {
            // Builds whose storage isn't localStorage still have the editor's in-memory list.
            self.__beTrackStore.forEachCustomTrack((id, meta, data) => {
                try {
                    out.push({ name: meta.name, code: data.toExportString(meta), saveTime: 0 });
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

    window.addEventListener("message", (e) => {
        const msg = e.data;
        if (e.source !== window.parent || !msg || msg.nsws !== "be" || !ORIGIN.test(e.origin)) return;
        parentOrigin = e.origin;
        const reply = (body) => post(Object.assign({ type: msg.type, reqId: msg.reqId }, body));
        if (msg.type === "hello") {
            if (lastSig === null) lastSig = signature();
            post({ type: "ready", version: 1, reqId: msg.reqId, loaded: !!self.__beTrackStore });
        } else if (msg.type === "list") {
            reply({ tracks: listTracks() });
        } else if (msg.type === "import") {
            let result;
            try {
                result = importCode(msg.code);
            } catch (err) {
                result = { ok: false, error: "The editor couldn't read that track code." };
            }
            reply(result);
        }
    });
    window.addEventListener("storage", (e) => {
        if (!e.key || e.key.startsWith(PREFIX)) checkChanged();
    });
    setInterval(checkChanged, 2000);
})();
