// Not So Weekly Shorts' Cuppa Build Off: watching someone else build, asked through nsws_bridge.js (message "watch").
// While watching, the editor shows the other builder's track as it is now (each new copy changes only the parts that
// differ, so the view never reloads), the part in their hand where they are about to place it, and can follow their camera. This page's own track and its undo history are put
// back when watching ends, and nsws_bridge.js answers "current" with that own track all along, so nothing of the
// watched track can be sent or saved as this player's. Edits made while watching are undone on the next sync.
// The editor's side is self.__beCupEditor and self.__beCupView (tools/patch.js, "cup watch").
(function () {
    "use strict";
    if (window.parent === window) return;
    const SYNC_MS = 500;
    // How quickly the camera catches up with the builder's (per second); their camera reaches here about once a second.
    const EASE = 3;

    const editor = () => self.__beCupEditor || null;
    // { track: the bridge's own current track, code, history } while watching.
    let own = null;
    // The watched track's parts, as rows for the scene.
    let shown = null;
    let syncTimer = 0;
    let follow = true;
    let goal = null;
    let lastSet = null;
    let raf = 0;
    let lastFrame = 0;

    const key = (p) => p[3] + "," + p[0] + "," + p[1] + "," + p[2] + "," + p[4] + "," + p[5] + "," + p[6] + "," + (p[7] ?? "") + "," + (p[8] ?? "");

    function rows(trackData) {
        const out = [];
        trackData.forEachPart((x, y, z, id, rotation, axis, color, checkpointOrder, startOrder) => out.push([x, y, z, id, rotation, axis, color, checkpointOrder, startOrder]));
        return out;
    }

    function parse(code) {
        try {
            return self.__beTrackData.fromExportString(code)?.trackData ?? null;
        } catch {
            return null;
        }
    }

    // Makes the scene hold exactly these parts, touching only the ones that differ. The editor's own undo history and
    // "unsaved" mark are left alone (no commit).
    function apply(list) {
        const ed = editor();
        const scene = ed?.scene();
        if (!scene) return null;
        const want = new Map();
        for (const p of list) {
            const k = key(p);
            const e = want.get(k);
            if (e) e.n++;
            else want.set(k, { p, n: 1 });
        }
        const gone = [];
        for (const p of rows(scene.getTrackData())) {
            const e = want.get(key(p));
            if (e && e.n > 0) e.n--;
            else gone.push(p);
        }
        let added = 0;
        for (const p of gone)
            try {
                scene.deleteSpecificPart(p[3], p[0], p[1], p[2], p[4], p[5]);
            } catch {}
        for (const e of want.values())
            for (; e.n > 0; e.n--)
                try {
                    const p = e.p;
                    scene.setPart(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8]);
                    added++;
                } catch {}
        if (gone.length || added)
            try {
                ed.refresh();
            } catch (err) {
                console.warn("NSWS watch refresh:", err);
            }
        return { removed: gone.length, added };
    }

    const active = () => !!own;

    // Shows a builder's track (their export code); the first call starts watching.
    function show(msg) {
        const ed = editor();
        if (!ed?.history || !self.__beEditorCurrent) return { ok: false, error: "closed" };
        const data = typeof msg?.code === "string" ? parse(msg.code) : null;
        if (!data) return { ok: false, error: "bad code" };
        if (!own) {
            let track = null;
            try {
                track = self.__beEditorCurrent();
            } catch {}
            if (!track?.code) return { ok: false, error: "no own track" };
            own = { track, list: rows(ed.scene().getTrackData()), history: ed.history() };
            follow = true;
            goal = null;
            lastSet = null;
            clearInterval(syncTimer);
            syncTimer = setInterval(() => {
                if (!own || !editor()) return stop();
                if (shown) apply(shown);
            }, SYNC_MS);
        }
        shown = rows(data);
        const r = apply(shown);
        return Object.assign({ ok: !!r, watching: true }, r);
    }

    // Puts this page's own track and undo history back.
    function stop() {
        clearInterval(syncTimer);
        syncTimer = 0;
        cancelAnimationFrame(raf);
        raf = 0;
        goal = null;
        try {
            self.__beCupHand?.(false);
        } catch {}
        if (!own) return { ok: true, watching: false };
        const was = own;
        own = null;
        shown = null;
        const ed = editor();
        if (!ed) return { ok: false, watching: false };
        apply(was.list);
        try {
            ed.history(was.history);
        } catch {}
        return { ok: true, watching: false };
    }

    // The editor's camera: [position x, y, z, look-at x, y, z], and the part in hand: [id, x, y, z, rotation, axis, colour] or null.
    function cam() {
        const v = self.__beCupView?.();
        let hand = null;
        try {
            hand = self.__beCupHand?.() ?? null;
        } catch {}
        return Array.isArray(v) ? { ok: true, v, hand } : { ok: false };
    }

    const far = (a, b, d) => !a || !b || a.some((x, i) => Math.abs(x - b[i]) > d);

    function frame(t) {
        raf = 0;
        if (!own || !follow || !goal) return;
        const now = self.__beCupView?.();
        if (!Array.isArray(now)) return;
        // Anything else that moved the camera since the last frame was the player: they look around on their own now.
        if (lastSet && far(now, lastSet, 0.05)) {
            follow = false;
            return;
        }
        const dt = Math.min(0.1, lastFrame ? (t - lastFrame) / 1000 : 1 / 60);
        lastFrame = t;
        const k = far(now, goal, 200) ? 1 : 1 - Math.exp(-EASE * dt);
        const next = now.map((x, i) => x + (goal[i] - x) * k);
        lastSet = self.__beCupView(next) ?? next;
        if (far(lastSet, goal, 0.01)) raf = requestAnimationFrame(frame);
    }

    // The builder's camera to follow (follow: true takes the camera back after the player looked around), and the part
    // in their hand (null: nothing to show).
    function view(msg) {
        if (!own) return { ok: false, error: "not watching" };
        if (msg && "hand" in msg)
            try {
                const h = msg.hand;
                self.__beCupHand?.(Array.isArray(h) && h.length === 7 && h.every(Number.isFinite) ? h : null);
            } catch (err) {
                console.warn("NSWS watch hand:", err);
            }
        if (msg?.follow != null) {
            follow = !!msg.follow;
            lastSet = null;
        }
        const v = msg?.v;
        if (Array.isArray(v) && v.length === 6 && v.every(Number.isFinite)) goal = v.slice();
        if (follow && goal && !raf) {
            lastFrame = 0;
            raf = requestAnimationFrame(frame);
        }
        return { ok: true, follow };
    }

    self.__beWatch = {
        active,
        own: () => (own ? own.track : null),
        show,
        stop,
        cam,
        view,
        status: () => ({ ok: true, watching: active(), follow }),
    };
})();
