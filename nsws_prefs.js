// Not So Weekly Shorts runs on another site, so this frame would start with default settings and a default
// car. NSWS passes the player's settings, key bindings and car in the address (#nswsPrefs=...), and they are
// written here before main.bundle.js reads them. Settings and keys NSWS doesn't have keep their editor values.
(function () {
    "use strict";
    if (window.parent === window) return;
    const ORIGIN = /^(https:\/\/(brinleyww|notweeklyshorts)\.github\.io|https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;
    const P = "polytrack_v5_prod_";
    const found = /[#&]nswsPrefs=([^&]*)/.exec(location.hash);
    if (!found) return;
    try {
        history.replaceState(history.state, "", location.pathname + location.search);
    } catch {}
    let parent = "";
    try {
        parent = location.ancestorOrigins?.[0] || new URL(document.referrer).origin;
    } catch {}
    if (!ORIGIN.test(parent)) return;
    let prefs;
    try {
        prefs = JSON.parse(decodeURIComponent(found[1]));
    } catch {
        return;
    }
    if (!prefs || typeof prefs !== "object") return;

    const read = (key) => {
        try {
            return JSON.parse(localStorage.getItem(key));
        } catch {
            return null;
        }
    };
    const write = (key, value) => {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch {}
    };
    const pairs = (v) => (Array.isArray(v) ? v.filter((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === "string") : []);
    function merge(key, theirs) {
        theirs = pairs(theirs);
        if (!theirs.length) return;
        const names = new Set(theirs.map((p) => p[0]));
        write(key, pairs(read(key)).filter((p) => !names.has(p[0])).concat(theirs));
    }
    merge(P + "settings", prefs.settings);
    // NSWS's Low performance mode (tm_cull.js reads it): no flat shadows, chunks past the view distance hidden in a
    // Test, and the screen drawn at one pixel per CSS pixel as NSWS does.
    const low = pairs(prefs.settings).some((p) => p[0] === "LowPerformanceMode" && p[1] === "true");
    try {
        localStorage.setItem("be_low_performance", low ? "1" : "0");
    } catch {}
    if (low) merge(P + "settings", [["ScreenPixelDensity", "false"]]);
    merge(P + "key_bindings", prefs.keys);

    if (prefs.unlocked && typeof prefs.unlocked === "object") {
        const own = read(P + "unlocked_car_styles") || {};
        const out = {};
        for (const k of ["patterns", "rims", "exhausts"]) {
            const all = [].concat(Array.isArray(own[k]) ? own[k] : [], Array.isArray(prefs.unlocked[k]) ? prefs.unlocked[k] : []);
            out[k] = [...new Set(all.filter(Number.isSafeInteger))];
        }
        write(P + "unlocked_car_styles", out);
    }

    if (typeof prefs.carStyle === "string") {
        let slot = read(P + "user_slot") ?? 0;
        if (!Number.isSafeInteger(slot) || slot < 0) slot = 0;
        let profile = read(P + "user_" + slot);
        if (!profile || typeof profile.token !== "string") {
            // The editor makes its own profile on first launch; NSWS's token stays on NSWS.
            const bytes = crypto.getRandomValues(new Uint8Array(32));
            profile = { token: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""), countryCode: null, isVerifier: false };
            write(P + "user_slot", slot);
        }
        profile.carStyle = prefs.carStyle;
        if (typeof prefs.nickname === "string" && prefs.nickname) profile.nickname = prefs.nickname;
        if (typeof profile.nickname !== "string") profile.nickname = "Player";
        if (prefs.countryCode === null || typeof prefs.countryCode === "string") profile.countryCode = prefs.countryCode;
        write(P + "user_" + slot, profile);
    }
})();
