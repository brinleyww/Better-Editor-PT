// Not So Weekly Shorts' Cuppa Build Off, asked through nsws_bridge.js (message "cup"). In the last seconds of building a
// track with no finish can only get a finish (the lock), and when time is up a track without a start or a finish gets
// them where its road ends (fill). The editor's side is self.__beCupEditor and the picker reads self.__beCupLock
// (tools/patch.js, "cup guard"). Nothing here runs unless NSWS asks.
(function () {
    "use strict";
    if (window.parent === window) return;
    // Stock part ids, and the trigger type of a finish (0 is a checkpoint).
    const START = 5;
    const FINISH = 6;
    const STRAIGHT = 0;
    const FINISH_TRIGGER = 1;
    // World units per tile; a stock road block is 4 tiles (20 units) square, centred on its origin.
    const UNIT = 5;
    const BLOCK = 4;

    const editor = () => self.__beCupEditor || null;
    const isStart = (c) => c != null && c.startOffset != null;
    const isFinish = (c) => c != null && c.detector != null && c.detector.type === FINISH_TRIGGER;

    function placedParts() {
        const list = editor()?.scene()?.__bePlaced?.();
        return Array.isArray(list) ? list : [];
    }

    function status() {
        let start = false;
        let finish = false;
        for (const p of placedParts()) {
            const c = p.trackPartData.configuration;
            if (isStart(c)) start = true;
            if (isFinish(c)) finish = true;
        }
        return { ok: !!editor(), start, finish };
    }

    // ---- the lock ----------------------------------------------------------------------------------------------------
    let lockUntil = 0;
    let lockTimer = 0;
    const locked = () => lockUntil > Date.now() && !!editor();

    function unlock() {
        lockUntil = 0;
        clearInterval(lockTimer);
        lockTimer = 0;
        return status();
    }

    // NSWS sends how long building has left (ms), so a page that never says unlock still lets go.
    function lock(msg) {
        const s = status();
        if (!s.ok || s.finish) return unlock();
        lockUntil = Date.now() + Math.min(30000, Math.max(1000, Number(msg?.ms) || 5000));
        try {
            editor().choose(FINISH);
        } catch (err) {
            console.warn("NSWS cup lock:", err);
        }
        clearInterval(lockTimer);
        lockTimer = setInterval(() => {
            if (!locked() || status().finish) unlock();
        }, 250);
        return Object.assign(status(), { locked: true });
    }

    const entryIsFinish = (e) => isFinish(e?.trackPartData?.configuration);
    // A finish in the category asked for (so a kit's own finish can be picked), else the stock one.
    function finishEntry(entries, category) {
        let n = category == null ? -1 : entries.findIndex((e) => e.category === category && entryIsFinish(e));
        if (n < 0) n = entries.findIndex((e) => e.id === FINISH);
        return n;
    }

    self.__beCupLock = {
        active: locked,
        refuse(id) {
            if (!locked()) return false;
            let c = null;
            try {
                c = editor().types().getPart(id).configuration;
            } catch {}
            if (!isFinish(c)) return true;
            setTimeout(() => status().finish && unlock(), 0);
            return false;
        },
        pick(t, entries) {
            if (!locked() || !Array.isArray(entries)) return t;
            if (t != null && entryIsFinish(entries[t])) return t;
            const n = finishEntry(entries, t != null ? entries[t]?.category : null);
            return n >= 0 ? n : t;
        },
        category(t, entries) {
            if (!locked() || !Array.isArray(entries)) return t;
            if (t != null && entries.some((e) => e.category === t && entryIsFinish(e))) return t;
            const n = finishEntry(entries, null);
            return n >= 0 ? entries[n].category : t;
        },
    };

    // ---- road ends ---------------------------------------------------------------------------------------------------
    // A port is where a piece's drivable deck crosses the edge of its tiles: a run of near-level surface, 0.3 units inside
    // the edge, that is road wide and bounded (barriers or nothing on both sides). A full-width run is a platform edge
    // (wide). Positions are relative to the part's origin, after its rotation; dx/dz is the outward direction.
    const SIDES = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ];
    const STEP = 0.5;
    const portCache = new Map();

    function trisOf(type) {
        const c = type.configuration;
        if (c.tm) return self.TM?.physicsTris?.(c.id) ?? null;
        return type.physicsShapeVertices ?? null;
    }

    function tileBox(type, rot, axis) {
        const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        type.configuration.tiles.rotated(rot, axis).forEach((x, y, z) => {
            b[0] = Math.min(b[0], x);
            b[1] = Math.min(b[1], y);
            b[2] = Math.min(b[2], z);
            b[3] = Math.max(b[3], x);
            b[4] = Math.max(b[4], y);
            b[5] = Math.max(b[5], z);
        });
        return b;
    }

    // Heights of the triangles above (px, pz), lowest first, near-equal ones merged.
    function heightsAt(tris, px, pz) {
        const out = [];
        for (const t of tris) {
            const d = (t[5] - t[8]) * (t[0] - t[6]) + (t[6] - t[3]) * (t[2] - t[8]);
            if (Math.abs(d) < 1e-9) continue;
            const a = ((t[5] - t[8]) * (px - t[6]) + (t[6] - t[3]) * (pz - t[8])) / d;
            const b = ((t[8] - t[2]) * (px - t[6]) + (t[0] - t[6]) * (pz - t[8])) / d;
            const c = 1 - a - b;
            if (a < -1e-6 || b < -1e-6 || c < -1e-6) continue;
            out.push(a * t[1] + b * t[4] + c * t[7]);
        }
        out.sort((a, b) => a - b);
        const merged = [];
        for (const h of out) if (!merged.length || h - merged[merged.length - 1] > 0.05) merged.push(h);
        return merged;
    }

    function findPorts(type, rot, axis) {
        const src = trisOf(type);
        const M = self.TM?.data?.rotations?.[axis]?.[rot];
        if (!src || !M) return [];
        const box = tileBox(type, rot, axis);
        if (!(box[0] <= box[3])) return [];
        const x0 = box[0] * UNIT,
            x1 = (box[3] + 1) * UNIT,
            z0 = box[2] * UNIT,
            z1 = (box[5] + 1) * UNIT;
        // Faces within 60 degrees of level, either winding (collision meshes need not face out).
        const level = [];
        for (let i = 0; i + 8 < src.length; i += 9) {
            const t = new Array(9);
            for (let j = 0; j < 3; j++) {
                const a = src[i + 3 * j],
                    b = src[i + 3 * j + 1],
                    c = src[i + 3 * j + 2];
                t[3 * j] = M[0] * a + M[1] * b + M[2] * c;
                t[3 * j + 1] = M[3] * a + M[4] * b + M[5] * c;
                t[3 * j + 2] = M[6] * a + M[7] * b + M[8] * c;
            }
            const ux = t[3] - t[0],
                uy = t[4] - t[1],
                uz = t[5] - t[2],
                vx = t[6] - t[0],
                vy = t[7] - t[1],
                vz = t[8] - t[2];
            const nx = uy * vz - uz * vy,
                ny = uz * vx - ux * vz,
                nz = ux * vy - uy * vx;
            const len = Math.hypot(nx, ny, nz);
            if (len > 1e-9 && Math.abs(ny) >= 0.5 * len) level.push(t);
        }
        const ports = [];
        for (const [dx, dz] of SIDES) {
            const alongX = dx === 0;
            const edge = dx > 0 ? x1 : dx < 0 ? x0 : dz > 0 ? z1 : z0;
            const probe = edge - (dx || dz) * 0.3;
            const lo = alongX ? x0 : z0,
                hi = alongX ? x1 : z1;
            const k = alongX ? 2 : 0;
            const near = level.filter((t) => Math.min(t[k], t[k + 3], t[k + 6]) <= probe && Math.max(t[k], t[k + 3], t[k + 6]) >= probe);
            if (!near.length) continue;
            const n = Math.round((hi - lo) / STEP);
            // Runs of samples whose heights follow on from each other (a bank may tilt, a barrier top jumps).
            let open = [];
            const runs = [];
            for (let i = 0; i <= n; i++) {
                const s = Math.min(hi - 0.05, Math.max(lo + 0.05, lo + i * STEP));
                const hs = heightsAt(near, alongX ? s : probe, alongX ? probe : s);
                const next = [];
                for (const h of hs) {
                    let best = null;
                    for (const r of open) if (!r.taken && Math.abs(r.h - h) <= 0.6 && (!best || Math.abs(r.h - h) < Math.abs(best.h - h))) best = r;
                    if (best) {
                        best.taken = true;
                        best.i1 = i;
                        best.h = h;
                        best.hs.push(h);
                        next.push(best);
                    } else next.push({ i0: i, i1: i, h, hs: [h], taken: true });
                }
                for (const r of open) if (!r.taken) runs.push(r);
                for (const r of next) r.taken = false;
                open = next;
            }
            runs.push(...open);
            for (const r of runs) {
                const width = (r.i1 - r.i0) * STEP;
                const wide = r.i0 === 0 && r.i1 === n;
                if (width < 4 || (!wide && width > 45)) continue;
                const mid = (r.i0 + r.i1) / 2;
                const s = lo + mid * STEP;
                const y = r.hs[Math.min(r.hs.length - 1, Math.round(mid - r.i0))];
                ports.push({ x: alongX ? s : edge, y, z: alongX ? edge : s, dx, dz, w: width, wide });
            }
        }
        // A deck's top and underside give two runs: keep the top one.
        const kept = [];
        ports.sort((a, b) => b.y - a.y);
        for (const p of ports)
            if (!kept.some((q) => q.dx === p.dx && q.dz === p.dz && Math.abs(q.x - p.x) + Math.abs(q.z - p.z) < 1.5 && q.y - p.y < 1)) kept.push(p);
        return kept;
    }

    function portsOf(type, rot, axis) {
        const key = type.configuration.id + "|" + rot + "|" + axis;
        let ports = portCache.get(key);
        if (!ports) {
            try {
                ports = findPorts(type, rot, axis);
            } catch (err) {
                console.warn("NSWS cup ports:", err);
                ports = [];
            }
            portCache.set(key, ports);
        }
        return ports;
    }

    function travelOf(rot, axis) {
        const M = self.TM.data.rotations[axis][rot];
        return [-M[2], -M[5], -M[8]];
    }
    // The rotation (about +Y) whose travel is (tx, tz).
    function rotationFor(tx, tz) {
        for (let r = 0; r < 4; r++) {
            const t = travelOf(r, 0);
            if (t[0] === tx && t[2] === tz) return r;
        }
        return 0;
    }

    const keyOf = (x, y, z) => x + "|" + y + "|" + z;
    const portKey = (p) => Math.round(p.x * 10) + "|" + Math.round(p.y * 10) + "|" + Math.round(p.z * 10) + "|" + p.dx + "|" + p.dz;

    // The track as road pieces joined at their ports.
    function buildWorld(scene) {
        const nodes = [];
        for (const part of placedParts()) {
            const c = part.trackPartData.configuration;
            const node = { part, cfg: c, start: isStart(c), finish: isFinish(c), ports: [] };
            for (const p of portsOf(part.trackPartData, part.rotation, part.rotationAxis))
                node.ports.push({ x: p.x + part.x * UNIT, y: p.y + part.y * UNIT, z: p.z + part.z * UNIT, dx: p.dx, dz: p.dz, w: p.w, wide: p.wide, node, link: null, blocked: false });
            nodes.push(node);
        }
        const grid = new Map();
        const cell = (x, z) => Math.round(x / 2) + "|" + Math.round(z / 2);
        for (const n of nodes)
            for (const p of n.ports) {
                const k = cell(p.x, p.z);
                const l = grid.get(k);
                l ? l.push(p) : grid.set(k, [p]);
            }
        for (const n of nodes)
            for (const p of n.ports) {
                if (p.link) continue;
                const cx = Math.round(p.x / 2),
                    cz = Math.round(p.z / 2);
                let best = null,
                    bestD = Infinity;
                for (let i = -1; i <= 1; i++)
                    for (let j = -1; j <= 1; j++)
                        for (const q of grid.get(cx + i + "|" + (cz + j)) ?? []) {
                            if (q.node === n || q.link || q.dx !== -p.dx || q.dz !== -p.dz) continue;
                            const d = Math.hypot(q.x - p.x, q.z - p.z);
                            if (d > 1.6 || Math.abs(q.y - p.y) > 1.1 || d >= bestD) continue;
                            best = q;
                            bestD = d;
                        }
                if (best) {
                    p.link = best;
                    best.link = p;
                }
            }
        // An end with no piece joined to it is still not open when something stands right in front of it.
        for (const n of nodes)
            for (const p of n.ports) {
                if (p.link) continue;
                const tx = Math.floor((p.x + p.dx * 2.5) / UNIT),
                    ty = Math.floor((p.y + 1) / UNIT),
                    tz = Math.floor((p.z + p.dz * 2.5) / UNIT);
                try {
                    p.blocked = ty < 0 || scene.getPartsAt(tx, ty, tz).length > 0;
                } catch {
                    p.blocked = true;
                }
            }
        return nodes;
    }

    // An open end to put a start or finish on: a road end, or a platform strip's far edge (the side facing away from the
    // piece it continues), never a platform's side.
    function isOpenEnd(p) {
        if (p.link || p.blocked) return false;
        if (!p.wide) return true;
        return p.node.ports.some((q) => q.link && q.dx === -p.dx && q.dz === -p.dz);
    }

    // Shortest distances along the road from one port; skip: a piece the path may not cross (the start it leaves from).
    function distances(src, skip) {
        const dist = new Map([[src, 0]]);
        const done = new Set();
        // A binary heap of [distance, port].
        const heap = [[0, src]];
        const push = (item) => {
            heap.push(item);
            for (let i = heap.length - 1; i > 0; ) {
                const j = (i - 1) >> 1;
                if (heap[j][0] <= heap[i][0]) break;
                [heap[i], heap[j]] = [heap[j], heap[i]];
                i = j;
            }
        };
        const pop = () => {
            const top = heap[0];
            const last = heap.pop();
            if (heap.length) {
                heap[0] = last;
                for (let i = 0; ; ) {
                    const l = 2 * i + 1,
                        r = l + 1;
                    let m = i;
                    if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                    if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                    if (m === i) break;
                    [heap[i], heap[m]] = [heap[m], heap[i]];
                    i = m;
                }
            }
            return top;
        };
        while (heap.length) {
            const [du, u] = pop();
            if (done.has(u)) continue;
            done.add(u);
            const step = (v, w) => {
                if (done.has(v)) return;
                const dv = du + w;
                if (!(dist.get(v) <= dv)) {
                    dist.set(v, dv);
                    push([dv, v]);
                }
            };
            if (u.link) step(u.link, 0);
            if (u.node !== skip) for (const v of u.node.ports) if (v !== u) step(v, Math.max(1, Math.hypot(v.x - u.x, v.y - u.y, v.z - u.z)));
        }
        return dist;
    }

    // ---- placing -----------------------------------------------------------------------------------------------------
    function context(scene, types) {
        const all = types.getAllParts();
        const anyNew = placedParts().some((p) => p.trackPartData.configuration.tm);
        // Stock gates first; a kit's own plain start and finish gates only when the track already has new blocks, so a
        // stock track stays a stock track.
        const pick = (test) =>
            all.filter((t) => {
                const c = t.configuration;
                if (!test(c)) return false;
                if (!c.tm) return true;
                return anyNew && c.tm.t === "Gates" && (c.tm.s === "Start" || c.tm.s === "Finish") && !c.tm.h;
            });
        return { scene, types, claimed: new Set(), finishes: pick(isFinish), starts: pick(isStart) };
    }

    function tilesFree(ctx, type, rot, x, y, z) {
        const keys = [];
        let ok = true;
        type.configuration.tiles.rotated(rot, 0).forEach((tx, ty, tz) => {
            if (!ok) return;
            const k = keyOf(x + tx, y + ty, z + tz);
            if (y + ty < 0 || ctx.claimed.has(k) || ctx.scene.getPartsAt(x + tx, y + ty, z + tz).length > 0) ok = false;
            keys.push(k);
        });
        return ok ? keys : null;
    }

    const familyOf = (c) => (c?.tm ? c.tm.f : -1);

    // A start (kind "start") or finish joined to the open end P. A finish's entry faces P and the car drives on along P's
    // outward direction; a start's exit faces P and its car drives into the road. The best fit wins: on the tile grid, the
    // same width, the same kit, stock before new.
    function attach(ctx, kind, P) {
        const tx = kind === "finish" ? P.dx : -P.dx,
            tz = kind === "finish" ? P.dz : -P.dz;
        const rot = rotationFor(tx, tz);
        const wantDx = kind === "finish" ? -tx : tx,
            wantDz = kind === "finish" ? -tz : tz;
        let best = null;
        for (const type of kind === "finish" ? ctx.finishes : ctx.starts)
            for (const q of portsOf(type, rot, 0)) {
                if (q.dx !== wantDx || q.dz !== wantDz) continue;
                const ox = P.x - q.x,
                    oy = P.y - q.y,
                    oz = P.z - q.z;
                const gx = Math.round(ox / UNIT),
                    gy = Math.round(oy / UNIT),
                    gz = Math.round(oz / UNIT);
                const err = Math.hypot(ox - gx * UNIT, oz - gz * UNIT),
                    ey = Math.abs(oy - gy * UNIT);
                if (err > 1.6 || ey > 1.1) continue;
                const score = err + ey + Math.abs(P.w - q.w) * 0.1 + (P.wide !== q.wide ? 3 : 0) + (familyOf(type.configuration) === familyOf(P.node.cfg) ? 0 : 1) + (type.configuration.tm ? 0.2 : 0);
                if (best && score >= best.score) continue;
                const keys = tilesFree(ctx, type, rot, gx, gy, gz);
                if (keys) best = { score, keys, add: { id: type.configuration.id, x: gx, y: gy, z: gz, rotation: rot } };
            }
        if (!best) return null;
        for (const k of best.keys) ctx.claimed.add(k);
        return best;
    }

    function release(ctx, got) {
        if (got) for (const k of got.keys) ctx.claimed.delete(k);
    }

    // A stock part at a block position, if its tiles are free.
    function putStock(ctx, id, x, y, z, rot) {
        const type = ctx.types.getPart(id);
        const keys = type && tilesFree(ctx, type, rot, x, y, z);
        if (!keys) return null;
        for (const k of keys) ctx.claimed.add(k);
        return { keys, add: { id, x, y, z, rotation: rot } };
    }

    // No road to use: a start, a straight and a finish in a line (or just the missing gate), on free ground near the middle
    // of what was built.
    function freeTrack(ctx, nodes, want) {
        const line = [
            [want.start ? START : null, 0],
            [want.start && want.finish ? STRAIGHT : null, 1],
            [want.finish ? FINISH : null, want.start ? 2 : 0],
        ];
        let cx = 0,
            cz = 0,
            top = 0;
        if (nodes.length) {
            let ax = Infinity,
                az = Infinity,
                bx = -Infinity,
                bz = -Infinity;
            for (const n of nodes) {
                ax = Math.min(ax, n.part.x);
                az = Math.min(az, n.part.z);
                bx = Math.max(bx, n.part.x);
                bz = Math.max(bz, n.part.z);
                top = Math.max(top, n.part.y);
            }
            cx = BLOCK * Math.round((ax + bx) / 2 / BLOCK);
            cz = BLOCK * Math.round((az + bz) / 2 / BLOCK);
        }
        for (let y = 0; y <= top + 1; y++)
            for (let ring = 0; ring <= 16; ring++)
                for (let i = -ring; i <= ring; i++)
                    for (let j = -ring; j <= ring; j++) {
                        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
                        for (let rot = 0; rot < 4; rot++) {
                            const t = travelOf(rot, 0);
                            const x = cx + i * BLOCK,
                                z = cz + j * BLOCK;
                            const got = [];
                            const ok = line.every(([id, k]) => {
                                if (id == null) return true;
                                const g = putStock(ctx, id, x + t[0] * BLOCK * k, y, z + t[2] * BLOCK * k, rot);
                                if (g) got.push(g);
                                return !!g;
                            });
                            if (ok) return got;
                            for (const g of got) release(ctx, g);
                        }
                    }
        return null;
    }

    // Pieces straight on from a gate (ahead of a start, k blocks; behind a finish with k < 0), when the road gives nothing.
    function inLine(ctx, node, id) {
        const p = node.part;
        const t = travelOf(p.rotation, p.rotationAxis);
        if (Math.abs(t[1]) > 0.5) return null;
        const dir = id === FINISH ? 1 : -1;
        for (let k = 1; k <= 8; k++) {
            const g = putStock(ctx, id, p.x + Math.round(t[0]) * BLOCK * k * dir, p.y, p.z + Math.round(t[2]) * BLOCK * k * dir, rotationFor(Math.round(t[0]), Math.round(t[2])));
            if (g) return [g];
        }
        return null;
    }

    const byKey = (a, b) => (portKey(a) < portKey(b) ? -1 : portKey(a) > portKey(b) ? 1 : 0);

    // Start at one open end and finish at another, the pair furthest apart along the road first.
    function onEnds(ctx, nodes, skip) {
        const ends = [];
        for (const n of nodes) if (n !== skip) for (const p of n.ports) if (isOpenEnd(p)) ends.push(p);
        ends.sort(byKey);
        ends.length = Math.min(ends.length, 48);
        const pairs = [];
        for (let i = 0; i < ends.length; i++) {
            const d = distances(ends[i], null);
            for (let j = i + 1; j < ends.length; j++) if (d.has(ends[j])) pairs.push([ends[i], ends[j], d.get(ends[j])]);
        }
        pairs.sort((a, b) => b[2] - a[2]);
        // The start goes at the end nearer the middle of the map (where the editor puts its start), then the higher one.
        const first = (a, b) => {
            const da = Math.hypot(a.x, a.z),
                db = Math.hypot(b.x, b.z);
            if (Math.abs(da - db) > 1) return da < db;
            if (Math.abs(a.y - b.y) > 1) return a.y > b.y;
            return byKey(a, b) <= 0;
        };
        for (const [a, b] of pairs.slice(0, 30)) {
            const order = first(a, b) ? [a, b] : [b, a];
            for (const [s, f] of [order, [order[1], order[0]]]) {
                const gs = attach(ctx, "start", s);
                if (!gs) continue;
                const gf = attach(ctx, "finish", f);
                if (gf) return [gs, gf];
                release(ctx, gs);
            }
        }
        return null;
    }

    // From a gate along the road to the open end furthest from it. gate: the start (leaving by its exit) or a finish
    // (going back from its entry); kind: what to put at that end.
    function fromGate(ctx, nodes, gate, kind) {
        const t = travelOf(gate.part.rotation, gate.part.rotationAxis);
        const sx = kind === "finish" ? Math.round(t[0]) : -Math.round(t[0]),
            sz = kind === "finish" ? Math.round(t[2]) : -Math.round(t[2]);
        const src = gate.ports.find((p) => p.dx === sx && p.dz === sz);
        const tried = new Set();
        const tryEnds = (list) => {
            for (const p of list) {
                if (tried.has(p)) continue;
                tried.add(p);
                const g = attach(ctx, kind, p);
                if (g) return [g];
            }
            return null;
        };
        if (src) {
            const d = distances(src, gate);
            const reach = [...d.keys()].filter((p) => isOpenEnd(p) && (p.node !== gate || p === src));
            reach.sort((a, b) => d.get(b) - d.get(a) || byKey(a, b));
            const got = tryEnds(reach);
            if (got) return got;
        }
        // Not joined to any road: the open end furthest away in a straight line, then straight on from the gate.
        const gx = gate.part.x * UNIT,
            gz = gate.part.z * UNIT;
        const far = [];
        for (const n of nodes) if (n !== gate) for (const p of n.ports) if (isOpenEnd(p)) far.push(p);
        far.sort((a, b) => Math.hypot(b.x - gx, b.z - gz) - Math.hypot(a.x - gx, a.z - gz) || byKey(a, b));
        if (!src || src.blocked) {
            const got = tryEnds(far.slice(0, 24));
            if (got) return got;
        }
        return inLine(ctx, gate, kind === "finish" ? FINISH : START);
    }

    const isDefaultStart = (p) => p.trackPartData.configuration.id === START && p.x === 0 && p.y === 0 && p.z === 0 && p.rotation === 0 && p.rotationAxis === 0;

    function plan(ctx, have) {
        const nodes = buildWorld(ctx.scene);
        if (!have.start && !have.finish) return { add: onEnds(ctx, nodes, null) ?? freeTrack(ctx, nodes, { start: true, finish: true }), remove: [], road: true };
        if (have.start) {
            // The start the game uses: the highest start order.
            let gate = null;
            for (const n of nodes) if (n.start && (!gate || n.part.startOrder > gate.part.startOrder)) gate = n;
            if (!gate) return { add: null, remove: [] };
            // The editor's own start, left alone while the road was built elsewhere, moves to that road.
            const alone = gate.ports.length > 0 && gate.ports.every((p) => !p.link && !p.blocked);
            if (alone && isDefaultStart(gate.part) && nodes.filter((n) => n.start).length === 1) {
                const got = onEnds(ctx, nodes, gate);
                if (got) return { add: got, remove: [gate.part], road: true };
            }
            return { add: fromGate(ctx, nodes, gate, "finish") ?? freeTrack(ctx, nodes, { finish: true }), remove: [], road: true };
        }
        const gate = nodes.filter((n) => n.finish).sort((a, b) => a.part.x - b.part.x || a.part.y - b.part.y || a.part.z - b.part.z)[0];
        if (!gate) return { add: null, remove: [] };
        return { add: fromGate(ctx, nodes, gate, "start") ?? freeTrack(ctx, nodes, { start: true }), remove: [], road: true };
    }

    const record = (p) => ({ id: p.trackPartData.configuration.id, x: p.x, y: p.y, z: p.z, rotation: p.rotation, rotationAxis: p.rotationAxis, color: p.color, checkpointOrder: p.checkpointOrder, startOrder: p.startOrder });

    function fill() {
        unlock();
        const ed = editor();
        if (!ed) return { ok: false, error: "closed" };
        const have = status();
        if (have.start && have.finish) return Object.assign(have, { placed: { start: false, finish: false } });
        const scene = ed.scene();
        const ctx = context(scene, ed.types());
        const p = plan(ctx, have);
        if (!p.add) return Object.assign(have, { ok: false, error: "no room" });
        const removed = [],
            added = [];
        try {
            for (const part of p.remove) {
                const r = record(part);
                if (scene.deleteSpecificPart(r.id, r.x, r.y, r.z, r.rotation, r.rotationAxis)) removed.push(r);
            }
            for (const { add: a } of p.add) {
                const type = ctx.types.getPart(a.id);
                const startOrder = isStart(type.configuration) ? scene.getNextStartOrder() : null;
                scene.setPart(a.x, a.y, a.z, a.id, a.rotation, 0, 0, null, startOrder);
                added.push({ id: a.id, x: a.x, y: a.y, z: a.z, rotation: a.rotation, rotationAxis: 0, color: 0, checkpointOrder: null, startOrder });
            }
            if (!scene.getTrackData().hasStartingPoint()) throw new Error("no start after filling in");
        } catch (err) {
            console.warn("NSWS cup fill:", err);
            for (const a of added)
                try {
                    scene.deleteSpecificPart(a.id, a.x, a.y, a.z, a.rotation, a.rotationAxis);
                } catch {}
            for (const r of removed)
                try {
                    scene.setPart(r.x, r.y, r.z, r.id, r.rotation, r.rotationAxis, r.color, r.checkpointOrder, r.startOrder);
                } catch {}
            try {
                ed.commit([], []);
            } catch {}
            return Object.assign(status(), { ok: false, error: "failed" });
        }
        ed.commit(removed, added);
        const now = status();
        return Object.assign(now, { ok: now.start && now.finish, placed: { start: !have.start, finish: !have.finish }, moved: removed.length > 0, parts: added });
    }

    self.__beCup = { status, lock, unlock, fill, ports: (type, rot, axis) => portsOf(type, rot ?? 0, axis ?? 0) };
})();
