// Exact handling numbers per surface and per vehicle, measured in the game's own physics worker without realtime:
// every key press lands on the frame it was planned for, so two runs of the same plan give the same numbers.
// node tools/test/tmphys.mjs surfaces [label] [names,...]   0-100, 0-200, coast, brake, full lock, circle per surface
// node tools/test/tmphys.mjs vehicles [label]               the same table for each vehicle on five floors
// node tools/test/tmphys.mjs susp                          ride height at rest per vehicle
// node tools/test/tmphys.mjs effects [label]               bumpers, vehicle gates, wet and iced tyres
// node tools/test/tmphys.mjs feel [label]                  catching drifts, turned bumpers, icing through checkpoints, respawns
// node tools/test/tmphys.mjs tyres [label] [a,b,c1,c2,d,cp]   wet, iced and muddy tyres: which surface undoes which (TYRES)
// node tools/test/tmphys.mjs quick [label] [names,...]     0-100, 0-200, braking, R60 per vehicle (TMVEH) and surface
// node tools/test/tmphys.mjs reactor [label]               reactor boosts: climb, hover, air steering, down plates, ends, loop
// Prints a table and writes the JSON to $TMRE/tmphys_<label>.json (TMRE: the scratch folder, see OUT below).
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './cdp.mjs';

const OUT = process.env.TMRE || path.join(process.env.TEMP || '.', 'claude', 'C--Users-boran-Downloads-polytrack-0-6-0-debuff-commun-ver-2', '8ecdaeeb-f8ac-421a-bce4-9b161708b0dd', 'scratchpad', 'tmre');
const section = process.argv[2] || 'surfaces',
  label = process.argv[3] || section,
  only = process.argv[4] ? process.argv[4].split(',') : null;
const hook = `(()=>{const o=Worker.prototype.postMessage;Worker.prototype.postMessage=function(m,...r){if(m&&m.trackParts&&!window.__init)window.__init=m;return o.call(this,m,...r)}})()`;
// TMPORT: another copy of the site on another port (e.g. the last commit's runtime, to compare against).
const c = await launch({ port: +(process.env.TMCDP || 9361), width: 800, height: 600 });
await c.send('Page.addScriptToEvaluateOnNewDocument', { source: hook });
await c.send('Page.navigate', { url: 'http://127.0.0.1:' + (process.env.TMPORT || 8123) + '/Better-Editor-PT/' });
await c.waitFor(`[...document.querySelectorAll('button')].some(b=>['Exit','Editor'].includes(b.innerText.trim())&&b.offsetParent)`, 300000);
await c.waitFor('!!window.__init');
// Per frame, per car: frames, km/h, x, y, z, quaternion xyzw, wheel contacts (bit mask), next checkpoint, min skid.
const K = 12;
await c.evaluate(`(()=>{
  window.webpackChunk.push([[Symbol()],{},r=>window.__req=r]);
  const req=window.__req, TD=req(9117).A, Sun=req(7929).A, Mount=req(6421).A, VO=req(3899).VO, P=req(494).A, Rec=req(1754).A;
  window.__mk=(parts)=>{const t=new TD(1,new Sun(0));
    for(const p of parts){const id=typeof p.n=='number'?p.n:P[p.n]; if(id==null)throw new Error('no part '+p.n);
      const def=req(2600).Hw(id);
      t.addPart(p.x,p.y,p.z,id,p.r||0,p.a||0,0,def.detector&&def.detector.type==0?(p.cp??0):null,def.startOffset?(p.so??0):null);}
    return t;};
  const b64=(f)=>{const u=new Uint8Array(f.buffer);let s='';for(let i=0;i<u.length;i+=32768)s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));return btoa(s);};
  // spec: {parts, test (tmtest object or null), cars: [{id, rec: {up, right, down, left, reset} toggle frames, frames}]}
  window.__run=(spec)=>new Promise((res,rej)=>{
    const t=__mk(spec.parts), M=Mount.createMountainVertices(t.getBounds()), save=t.toSaveString();
    const w=new Worker('simulation_worker.bundle.js'+(spec.test?'?tmtest='+encodeURIComponent(JSON.stringify(spec.test)):''));
    const logs=new Map(), probes=[]; let left=spec.cars.length, done=false;
    for(const car of spec.cars) logs.set(car.id,{n:0,frames:car.frames,buf:new Float32Array(car.frames*${K})});
    const finish=()=>{done=true;w.terminate();const out={probes,cars:{}};for(const [id,L] of logs)out.cars[id]=b64(L.buf.subarray(0,L.n*${K}));res(out);};
    w.addEventListener('error',e=>{if(!done){done=true;rej(new Error('worker: '+e.message));}});
    w.addEventListener('message',e=>{const m=e.data; if(m&&m.tmProbe){probes.push(m.tmProbe);return;} if(m.messageType!=10||done)return;
      for(const b of m.carStateBuffers){const u=new Uint8Array(b), id=u[0]|u[1]<<8|u[2]<<16|u[3]<<24, L=logs.get(id); if(!L||L.n>=L.frames)continue;
        const s=VO(u.subarray(4)).carState, o=L.n*${K}, B=L.buf;
        B[o]=s.frames;B[o+1]=s.speedKmh;B[o+2]=s.position.x;B[o+3]=s.position.y;B[o+4]=s.position.z;
        B[o+5]=s.quaternion.x;B[o+6]=s.quaternion.y;B[o+7]=s.quaternion.z;B[o+8]=s.quaternion.w;
        B[o+9]=(u[4+7]>>3)&15;B[o+10]=s.nextCheckpointIndex;B[o+11]=Math.min(...s.wheelSkidInfo);
        if(++L.n==L.frames&&--left==0)finish();}});
    w.postMessage({...window.__init,isRealtime:false});
    for(const car of spec.cars){
      w.postMessage({messageType:3,mountainVertices:M.vertices,mountainOffset:{x:M.offset.x,y:M.offset.y,z:M.offset.z},trackData:save,carId:car.id,carRecording:new Rec(car.rec).serialize()});
      w.postMessage({messageType:5,carId:car.id,targetSimulationTimeFrames:car.frames});}
    setTimeout(()=>{if(!done){done=true;w.terminate();rej(new Error('run timed out'));}},spec.timeout||240000);
  });
  return true;
})()`);

// ---- running and reading runs ---------------------------------------------------------------------------------------
const rec = (r = {}) => ({ up: r.up ?? [], right: r.right ?? [], down: r.down ?? [], left: r.left ?? [], reset: r.reset ?? [] });
async function run(parts, test, cars) {
  const r = await c.evaluate(`__run(${JSON.stringify({ parts, test, cars: cars.map((x) => ({ ...x, rec: rec(x.rec) })) })}).then(r=>JSON.stringify(r))`);
  const o = JSON.parse(r),
    out = { probes: o.probes };
  for (const id in o.cars) {
    const b = Buffer.from(o.cars[id], 'base64'),
      f = new Float32Array(b.buffer, b.byteOffset, b.length / 4),
      l = [];
    for (let i = 0; i < f.length; i += K) l.push({ f: f[i], v: f[i + 1], x: f[i + 2], y: f[i + 3], z: f[i + 4], q: [f[i + 5], f[i + 6], f[i + 7], f[i + 8]], w: f[i + 9], n: f[i + 10], sk: f[i + 11] });
    out[id] = l;
  }
  return out;
}
const nose = (q) => [2 * (q[0] * q[2] + q[3] * q[1]), 1 - 2 * (q[0] * q[0] + q[1] * q[1])];
const heading = (q) => { const [x, z] = nose(q); return Math.atan2(x, z); };
const wrap = (d) => { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
// Yaw rate, deg/s, between two log indices.
const rate = (l, a, b) => +Math.abs((wrap(heading(l[b].q) - heading(l[a].q)) * 57.2958) / ((b - a) / 1000)).toFixed(0);
// True ground speed, units/s, from positions 10 frames apart.
const vel = (l, i) => { const a = l[Math.max(0, i - 5)], b = l[Math.min(l.length - 1, i + 5)], dt = (b.f - a.f) / 1000; return [(b.x - a.x) / dt, (b.z - a.z) / dt]; };
// How fast the rear axle moves sideways (km/h): zero when the tyres hold, large in a slide.
const slide = (l, a, b) => { let m = 0; for (let i = a + 1; i <= b; i++) { const p = l[i - 1], s = l[i], [px, pz] = nose(p.q), [sx, sz] = nose(s.q), vx = (s.x - sx * 1.36 - (p.x - px * 1.36)) * 1000, vz = (s.z - sz * 1.36 - (p.z - pz * 1.36)) * 1000; m = Math.max(m, Math.abs(vx * sz - vz * sx) * 3.6); } return +m.toFixed(1); };
// Slip angle (deg) between the nose and the way the car goes.
const slipAt = (l, i) => { const [vx, vz] = vel(l, i), [nx, nz] = nose(l[i].q); if (Math.hypot(vx, vz) < 1) return 0; return wrap(Math.atan2(vx, vz) - Math.atan2(nx, nz)) * 57.2958; };
// Lateral acceleration (units/s^2) averaged over a..b: speed x turn rate of the velocity.
const latAcc = (l, a, b) => { const [ax, az] = vel(l, a), [bx, bz] = vel(l, b), sp = (Math.hypot(ax, az) + Math.hypot(bx, bz)) / 2; return +Math.abs((sp * wrap(Math.atan2(bx, bz) - Math.atan2(ax, az))) / ((b - a) / 1000)).toFixed(1); };
const first = (l, fn, from = 0) => { for (let i = from; i < l.length; i++) if (fn(l[i])) return i; return null; };
const T = (x) => (x == null ? '-' : String(x));

// ---- tracks --------------------------------------------------------------------------------------------------------
// A floor of `piece` 20-unit platforms around the start, longer ahead (-z) than behind.
const floor = (start, piece, wide = 10, ahead = 40, behind = 4) => {
  const p = [{ n: start, x: 0, y: 0, z: 0 }];
  for (let i = -wide; i <= wide; i++) for (let j = -ahead; j <= behind; j++) if (i || j) p.push({ n: piece, x: i * 4, y: 0, z: j * 4 });
  return p;
};
// A floor big enough for a circle of radius r whose centre is r to the left of the start (-x when facing -z).
const circleFloor = (start, piece, r) => {
  const p = [{ n: start, x: 0, y: 0, z: 0 }], n = Math.ceil((r + 30) / 20);
  for (let i = -Math.ceil((2 * r + 30) / 20); i <= 2; i++) for (let j = -n; j <= n; j++) if (i || j) p.push({ n: piece, x: i * 4, y: 0, z: j * 4 });
  return p;
};

// One surface (or vehicle on a surface): pass 1 finds the frames 80/120/140/200 km/h are reached, pass 2 presses keys
// on exactly those frames.
async function measure(parts, test, circleParts) {
  const A = 14000,
    p1 = await run(parts, test, [{ id: 1, rec: { up: [0] }, frames: A }]),
    l = p1[1],
    moved = first(l, (s) => s.v > 0.5) ?? 0,
    at = (k) => first(l, (s) => s.v >= k),
    row = { ms0to100: at(100) != null ? at(100) - moved : null, ms0to200: at(200) != null ? at(200) - moved : null, kmh5s: +l[moved + 5000]?.v.toFixed(0), kmh10s: +l[Math.min(l.length - 1, moved + 10000)].v.toFixed(0) };
  // Every frame's position and speed of the full-throttle run, hashed: equal hashes mean bit-identical driving.
  let h = 0;
  { const fb = new Float32Array(4), ub = new Uint32Array(fb.buffer); for (const s of l) { fb[0] = s.x; fb[1] = s.y; fb[2] = s.z; fb[3] = s.v; for (const u of ub) h = (Math.imul(h, 31) + u) >>> 0; } }
  row.hash = h.toString(16);
  const F = { 80: at(80), 120: at(120), 140: at(140), 200: at(200) },
    cars = [];
  // ids: 2 coast from 200, 3 brake from 120, 4/5 full lock at 80/140, 6 full lock at 140 released after 1.2 s
  if (F[200] != null) cars.push({ id: 2, rec: { up: [0, F[200] + 1] }, frames: F[200] + 2200 });
  if (F[120] != null) cars.push({ id: 3, rec: { up: [0, F[120] + 1], down: [F[120] + 1] }, frames: F[120] + 6000 });
  if (F[80] != null) cars.push({ id: 4, rec: { up: [0], right: [F[80] + 1] }, frames: F[80] + 1400 });
  if (F[140] != null) cars.push({ id: 5, rec: { up: [0], right: [F[140] + 1] }, frames: F[140] + 1400 });
  if (F[200] != null) cars.push({ id: 7, rec: { up: [0], right: [F[200] + 1] }, frames: F[200] + 1400 });
  if (F[140] != null) cars.push({ id: 6, rec: { up: [0], right: [F[140] + 1, F[140] + 1201] }, frames: F[140] + 3500 });
  const p2 = cars.length ? await run(parts, test, cars) : {};
  // The same over every frame of every car of pass 2 (coast, brake, the lock turns): with the full-throttle hash, the whole
  // drive is compared bit for bit against another runtime.
  { let h2 = 0; const fb = new Float32Array(8), ub = new Uint32Array(fb.buffer); for (const car of cars) for (const s of p2[car.id] || []) { fb[0] = s.x; fb[1] = s.y; fb[2] = s.z; fb[3] = s.v; fb[4] = s.q[0]; fb[5] = s.q[1]; fb[6] = s.q[2]; fb[7] = s.q[3]; for (const u of ub) h2 = (Math.imul(h2, 31) + u) >>> 0; } row.hashPass2 = h2.toString(16); }
  if (p2[2]) { const s = p2[2], i = F[200] + 1, j = Math.min(s.length - 1, i + 2000); row.coast200 = { kmhAfter2s: +s[j].v.toFixed(0) }; }
  if (p2[3]) {
    const s = p2[3], i = F[120] + 1, k = first(s, (q) => q.v < 1, i);
    row.brake120 = { ms: k != null ? k - i : null, dist: k != null ? +Math.hypot(s[k].x - s[i].x, s[k].z - s[i].z).toFixed(1) : null };
  }
  for (const [id, kmh] of [[4, 80], [5, 140], [7, 200]]) {
    if (!p2[id]) continue;
    const s = p2[id], i = F[kmh] + 1;
    row['lock' + kmh] = { degPerSec: rate(s, i + 300, i + 1000), slideKmh: slide(s, i, i + 1200), latAcc: latAcc(s, i + 300, i + 1000), endKmh: +s[i + 1200].v.toFixed(0) };
  }
  if (p2[6]) {
    // Let go of the steering after 1.2 s at full lock: a catchable slide straightens; a spin passes 90 degrees.
    const s = p2[6], i = F[140] + 1201;
    let maxSlip = 0;
    for (let k = i; k < s.length; k++) maxSlip = Math.max(maxSlip, Math.abs(slipAt(s, k)));
    row.release140 = { slipAtRelease: +Math.abs(slipAt(s, i)).toFixed(0), maxSlipAfter: +maxSlip.toFixed(0), slipAfter2s: +Math.abs(slipAt(s, Math.min(s.length - 6, i + 2000))).toFixed(0), spun: maxSlip > 90 };
  }
  if (circleParts) {
    // Steady cornering on circles of radius 30 and 60: the bot keeps the car on the line and lifts when it runs wide.
    row.circle = {};
    for (const r of [30, 60, 120]) {
      const cp = circleParts(r),
        q = (await run(cp, { ...(test || {}), bot: { x: -r, z: 0, r, band: 6, catch: 0.35, slack: 1.5 } }, [{ id: 1, rec: {}, frames: r > 60 ? 26000 : 16000 }]))[1];
      let sv = 0, sd = 0, n = 0;
      for (let k = q.length - 8000; k < q.length; k += 10) { const [vx, vz] = vel(q, k); sv += Math.hypot(vx, vz) * 3.6; sd += Math.abs(Math.hypot(q[k].x + r, q[k].z) - r); n++; }
      row.circle['r' + r] = { kmh: +(sv / n).toFixed(0), offLine: +(sd / n).toFixed(1) };
    }
  }
  return row;
}

const SURF = {
  // name: [start, floor piece, tmtest u overrides]
  stock: ['PlaneStart', 'Plane', null],
  plastic: ['PlasticStartPlat', 'PlasticPlatBase', null],
  wood: ['WoodStartPlat', 'WoodPlatBase', null],
  ice: ['IceStartPlat', 'IcePlatBase', null],
  pgrass: ['PlasticStartPlat', 'PlasticPlatBase', { PlasticPlatBase: 2, PlasticStartPlat: 2 }],
  // Real penalty grass (also in the last commit's block table, so the two runtimes can be compared): a whole-grass floor,
  // and platforms with a grass strip down one edge, which the lock turns drive across.
  stadgrass: ['PlasticStartPlat', 'StadiumGrass', null],
  grassedge: ['PlasticStartPlat', 'PlasticGrassPlatEdge', null],
};
// New surfaces: the Blocks agent's own kits once they exist, else a plastic platform given that surface (test only).
const parts = JSON.parse(await c.evaluate('JSON.stringify(TM.parts.map((p) => ({ n: p.n, u: p.u })))'));
const has = (n) => parts.some((p) => p.n == n);
for (const [name, u, kit] of [['dirt', 5, 'Dirt'], ['grass', 6, 'Grass'], ['snow', 7, 'Snow'], ['tech', 8, 'Tech']]) {
  const base = kit + 'PlatBase', start = kit + 'StartPlat';
  SURF[name] = has(base) && has(start) && parts.find((p) => p.n == base).u == u ? [start, base, null] : ['PlasticStartPlat', 'PlasticPlatBase', { PlasticPlatBase: u, PlasticStartPlat: u }];
}

// TMSURF='{"5":{"engine":0}}' tries other surface settings without editing the runtime (test-only hook).
const SURFTRY = process.env.TMSURF ? JSON.parse(process.env.TMSURF) : null;
if (SURFTRY) for (const k in SURF) SURF[k][2] = { ...(SURF[k][2] || {}) };
// TMVEHTRY='{"Desert":{"susp":{...}}}' does the same for the vehicles.
const VEHTRY = process.env.TMVEHTRY ? JSON.parse(process.env.TMVEHTRY) : null;
const testOf = (u, extra = {}) => { const t = { ...(u && Object.keys(u).length ? { u } : {}), ...(SURFTRY ? { surf: SURFTRY } : {}), ...(VEHTRY ? { veh: VEHTRY } : {}), ...extra }; return Object.keys(t).length ? t : null; };
const results = { label, when: new Date().toISOString(), section, surfTry: SURFTRY };
const table = (rows, cols) => {
  const w = cols.map(([h, f]) => Math.max(h.length, ...Object.values(rows).map((r) => T(f(r)).length)));
  console.log(['name'.padEnd(16), ...cols.map(([h], i) => h.padStart(w[i]))].join(' '));
  for (const [n, r] of Object.entries(rows)) console.log([n.padEnd(16), ...cols.map(([, f], i) => T(f(r)).padStart(w[i]))].join(' '));
};
const COLS = [
  ['0-100', (r) => r.ms0to100], ['0-200', (r) => r.ms0to200], ['@5s', (r) => r.kmh5s], ['@10s', (r) => r.kmh10s],
  ['coast2s', (r) => r.coast200?.kmhAfter2s], ['brake ms', (r) => r.brake120?.ms], ['brake u', (r) => r.brake120?.dist],
  ['l80 deg/s', (r) => r.lock80?.degPerSec], ['l80 slide', (r) => r.lock80?.slideKmh], ['l80 lat', (r) => r.lock80?.latAcc],
  ['l140 deg/s', (r) => r.lock140?.degPerSec], ['l140 slide', (r) => r.lock140?.slideKmh], ['l140 lat', (r) => r.lock140?.latAcc], ['l140 end', (r) => r.lock140?.endKmh], ['l200 slide', (r) => r.lock200?.slideKmh], ['l200 lat', (r) => r.lock200?.latAcc],
  ['rel maxslip', (r) => r.release140?.maxSlipAfter], ['spun', (r) => r.release140?.spun],
  ['R30 kmh', (r) => r.circle?.r30?.kmh], ['R30 off', (r) => r.circle?.r30?.offLine], ['R60 kmh', (r) => r.circle?.r60?.kmh], ['R60 off', (r) => r.circle?.r60?.offLine], ['R120 kmh', (r) => r.circle?.r120?.kmh], ['R120 off', (r) => r.circle?.r120?.offLine],
];

if (section == 'susp') {
  // Ride height at rest per vehicle on a stock floor (one far-off block makes the track use the runtime at all).
  const [s0, p0] = SURF.stock, P = [...floor(s0, p0, 2, 4, 2), { n: 'PlasticPlatBase', x: 0, y: 0, z: 400 }];
  // TMVEH=Desert,... picks the cars.
  const VEHS = (process.env.TMVEH || 'Stadium,Snow,Rally,Desert').split(',');
  results.ride = {};
  for (const veh of VEHS) {
    const r = (await run(P, testOf(null, { vehicle: veh }), [{ id: 1, rec: {}, frames: 2500 }]))[1];
    results.ride[veh] = { y: +r[2400].y.toFixed(4), yMin: +Math.min(...r.slice(5).map((q) => q.y)).toFixed(4), yMax: +Math.max(...r.slice(5).map((q) => q.y)).toFixed(4) };
  }
  console.log('ride height at rest (2.4 s), lowest and highest while settling:', JSON.stringify(results.ride));
  // Landing: off the end of a wood platform lane 1 or 6 tiles up onto a stock floor at full throttle. After touchdown: how far
  // the body sinks below its ride height, how high it comes back up, how many times it bounces (vertical speed turning
  // from up to down) in 1.5 s and the body roll / pitch it is left with (deg).
  results.landing = {};
  for (const tiles of [1, 6]) {
    const lane = [{ n: 'WoodStartPlat', x: 0, y: tiles, z: 0 }, ...Array.from({ length: 5 }, (_, i) => ({ n: 'WoodPlatBase', x: 0, y: tiles, z: -4 * (i + 1) }))];
    const F = []; for (let j = 6; j < (tiles > 1 ? 60 : 40); j++) for (const x of [-8, -4, 0, 4, 8]) F.push({ n: 'Plane', x, y: 0, z: -4 * j });
    for (const veh of VEHS) {
      const l = (await run([...lane, ...F], testOf(null, { vehicle: veh }), [{ id: 1, rec: { up: [0] }, frames: 9000 }]))[1], ride = results.ride[veh].y;
      const off = first(l, (q) => q.z < -6 * 20 + 10), land = first(l, (q) => q.w != 0 && q.y < 3, off), bodyLow = Math.min(...l.slice(land, land + 1500).map((q) => q.y));
      if (land == null) { results.landing[veh + '/' + tiles] = 'never landed'; continue; }
      let lo = 1e9, hi = -1e9, bounces = 0, up = false, maxTilt = 0;
      for (let k = land; k < land + 1500; k++) {
        const s = l[k], vy = l[k + 1].y - s.y;
        lo = Math.min(lo, s.y); if (k > land + 30) hi = Math.max(hi, s.y);
        if (vy > 1e-4) up = true; else if (up && vy < -1e-4) { bounces++; up = false; }
        const [x, y, z, w] = s.q, roll = Math.asin(Math.max(-1, Math.min(1, 2 * (w * z + x * y)))) * 57.2958, pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (y * z - w * x)))) * 57.2958;
        if (k > land + 200) maxTilt = Math.max(maxTilt, Math.abs(roll), Math.abs(pitch));
      }
      if (process.env.TMTRACE) console.log(veh, 'y every 20 ms from the edge:', l.slice(off, off + 1400).filter((_, i) => i % 20 == 0).map((q) => q.y.toFixed(2) + (q.w ? '' : '*')).join(' '));
      results.landing[veh + '/' + tiles] = { kmh: +l[land].v.toFixed(0), sinkBelowRide: +(ride - lo).toFixed(3), reboundAboveRide: +(hi - ride).toFixed(3), bounces, tiltAfter200ms: +maxTilt.toFixed(2), lowestY: +bodyLow.toFixed(3), kmhAfter1s: +l[land + 1000].v.toFixed(0) };
    }
    console.log('landing from', tiles, 'tiles up:', JSON.stringify(Object.fromEntries(Object.entries(results.landing).filter(([k]) => k.endsWith('/' + tiles)))));
  }
  // Ripples: full throttle down a dirt road of ripples (from the second piece on). Body height range and the most
  // pitch / roll (deg) over the ripples: how much the car is thrown about.
  results.ripples = {};
  {
    const P = [{ n: 'DirtStartRoad', x: 0, y: 0, z: 0 }, ...Array.from({ length: 14 }, (_, i) => ({ n: i < 2 ? 'DirtRoadStraight' : 'DirtRoadRipple', x: 0, y: 0, z: -4 * (i + 1) }))];
    for (const veh of VEHS) {
      const l = (await run(P, testOf(null, { vehicle: veh }), [{ id: 1, rec: { up: [0] }, frames: 6000 }]))[1], a = first(l, (q) => q.z < -3 * 20 + 10), b = first(l, (q) => q.z < -14 * 20 + 10) ?? l.length - 1;
      let lo = 1e9, hi = -1e9, tilt = 0, air = 0;
      for (let k = a; k < b; k++) { const s = l[k], [x, y, z, w] = s.q; lo = Math.min(lo, s.y); hi = Math.max(hi, s.y); if (!s.w) air++; tilt = Math.max(tilt, Math.abs(Math.asin(Math.max(-1, Math.min(1, 2 * (w * z + x * y))))), Math.abs(Math.asin(Math.max(-1, Math.min(1, 2 * (y * z - w * x)))))); }
      results.ripples[veh] = { kmhIn: +l[a].v.toFixed(0), kmhOut: +l[b].v.toFixed(0), yRange: +(hi - lo).toFixed(3), maxTiltDeg: +(tilt * 57.2958).toFixed(1), framesAirborne: air, ms: b - a };
    }
    console.log('ripples:', JSON.stringify(results.ripples));
  }
}

if (section == 'curve') {
  // km/h every 100 ms from rest at full throttle, per surface (shows where two floors' acceleration differs).
  results.curve = {};
  for (const name of only || ['stock', 'tech']) {
    const [s0, p0, u] = SURF[name], l = (await run(floor(s0, p0, 2, 40, 2), u ? { u } : null, [{ id: 1, rec: { up: [0] }, frames: 4001 }]))[1];
    results.curve[name] = l.filter((_, i) => i % 100 == 0).map((q) => +q.v.toFixed(1));
    console.log(name.padEnd(8), results.curve[name].join(' '));
  }
}

if (section == 'effects') {
  const L = (items, x = 0) => { let z = 0; return items.map((n) => { const o = typeof n == 'string' ? { n } : { ...n }; const p = { x, y: 0, z, ...o }; z -= o.len ?? 4; return p; }); };
  const wood = (n) => Array(n).fill('WoodRoadStraight');
  // Bumpers: straight down a wood platform lane through a plate, the plate centred, or shifted 1 tile (5 units) to either side.
  // Reports the sideways speed (units/s, + = world +x) right after the plate and the highest the car gets.
  results.bumpers = {};
  for (const type of ['Bumper', 'Bumper2'])
    for (const shift of [0, -1, 1]) {
      const parts = L(['WoodStartPlat', ...Array(3).fill('WoodPlatBase'), { n: 'WoodFx' + type + 'Plat', x: shift }, ...Array(8).fill('WoodPlatBase')]);
      const l = (await run(parts, null, [{ id: 1, rec: { up: [0] }, frames: 4000 }]))[1];
      const i = first(l, (q) => q.z < -4 * 4 * 5 + 10 - 6) ?? 0;
      let peakVx = 0;
      for (let k = i; k < Math.min(l.length - 6, i + 400); k++) { const [vx] = vel(l, k); if (Math.abs(vx) > Math.abs(peakVx)) peakVx = vx; }
      results.bumpers[type + ' shift ' + shift] = { enterKmh: +l[i].v.toFixed(0), peakSideways: +peakVx.toFixed(1), xAfter1s: +l[Math.min(l.length - 1, i + 1000)].x.toFixed(1), maxY: +Math.max(...l.slice(i, i + 1500).map((q) => q.y)).toFixed(2) };
      console.log(type, 'shift', shift, JSON.stringify(results.bumpers[type + ' shift ' + shift]));
    }
  // Vehicle gates: ride height and km/h on wood road after a gate; then a checkpoint, the respawn key, and a Stadium gate.
  const rideAt = (l, a, b) => +(l.slice(a, b).reduce((s, q) => s + q.y, 0) / (b - a)).toFixed(3);
  results.gates = {};
  for (const car of ['Snow', 'Rally', 'Desert']) {
    const parts = L(['WoodStartRoad', ...wood(2), 'WoodCar' + car + 'Road', ...wood(6), { n: 'WoodCheckpointRoad', cp: 0 }, ...wood(6), 'WoodCarStadiumRoad', ...wood(12)]);
    // Car 1: full throttle through it all. Car 2: let go after the checkpoint, before the Stadium gate, and press the
    // respawn key: back at the checkpoint as the gate's car. Car 3: respawn key before the checkpoint: the game does
    // nothing then (the car does not move), so it stays the gate's car. Starting over is a fresh car: Stadium.
    // the Stadium gate is the 18th piece: its middle at z = -17 x 20 units
    const l = await run(parts, { trace: 250 }, [{ id: 1, rec: { up: [0] }, frames: 8000 }]),
      cpAt = first(l[1], (q) => q.n >= 1), gateAt = first(l[1], (q) => q.z < -17 * 20);
    const l2 = await run(parts, { trace: 250 }, [{ id: 2, rec: { up: [0, cpAt + 300], reset: [cpAt + 600, cpAt + 601] }, frames: cpAt + 1200 }, { id: 3, rec: { up: [0], reset: [cpAt - 300, cpAt - 299] }, frames: cpAt }]);
    const vAt = (p, id, fr) => p.probes.filter((q) => q.carId == id && q.fr <= fr).pop()?.vehicle;
    const tr = { checkpointFrame: cpAt, stadiumGateFrame: gateAt, beforeCp: vAt(l, 1, cpAt - 10), afterStadiumGate: vAt(l, 1, gateAt + 300), car2AfterRespawn: vAt(l2, 2, cpAt + 1200), car2RespawnedY: +l2[2][cpAt + 1100].y.toFixed(3), car2JumpZ: [+l2[2][cpAt + 595].z.toFixed(1), +l2[2][cpAt + 615].z.toFixed(1)], car3AfterRespawnBeforeCp: vAt(l2, 3, cpAt), car3Z: [+l2[3][cpAt - 305].z.toFixed(1), +l2[3][cpAt - 290].z.toFixed(1)] };
    results.gates[car] = { trace: tr };
    console.log(car, 'gate:', JSON.stringify(tr));
  }
  // Air control: off the end of a platform lane 30 units up, gas held (or steering left / braking once airborne); how far the
  // nose dips (deg) and the car turns (deg) in the first 0.8 s off the edge.
  results.air = {};
  {
    const parts = L(['WoodStartPlat', ...Array(7).fill('WoodPlatBase')]).map((p) => ({ ...p, y: 6 })), edge = -7 * 20 - 10;
    for (const [veh, steer] of [['Stadium', 0], ['Desert', 0], ['Snow', 0], ['Stadium', 1], ['Desert', 1], ['Stadium', 2], ['Desert', 2]]) {
      const l = (await run(parts, { vehicle: veh }, [{ id: 1, rec: { up: [0], left: steer ? [0] : [] }, frames: 6000 }]))[1];
      // steering from the start would turn the car off the lane, so the steering run holds left only in the air: the
      // recording is rebuilt with left pressed on the frame the car leaves the edge
      let i = first(l, (q) => q.z < edge);
      let s2 = l;
      if (steer) { const l0 = (await run(parts, { vehicle: veh }, [{ id: 1, rec: { up: [0] }, frames: 6000 }]))[1]; i = first(l0, (q) => q.z < edge); s2 = (await run(parts, { vehicle: veh }, [{ id: 1, rec: steer == 1 ? { up: [0], left: [i] } : { up: [0, i], down: [i] }, frames: 6000 }]))[1]; }
      if (i == null) { results.air[veh + ['', '+left', '+brake'][steer]] = 'never left the edge'; continue; }
      const j = i + 800, pitch = (q) => Math.asin(Math.max(-1, Math.min(1, 2 * (q[1] * q[2] - q[3] * q[0])))) * 57.2958;
      results.air[veh + ['', '+left', '+brake'][steer]] = { kmhAtEdge: +s2[i].v.toFixed(0), noseDownDeg: +(pitch(s2[i].q) - pitch(s2[j].q)).toFixed(1), turnDeg: +(wrap(heading(s2[j].q) - heading(s2[i].q)) * 57.2958).toFixed(1), airborne: s2[j].w == 0 };
    }
    console.log('air control:', JSON.stringify(results.air));
  }
  // Wet tyres through shallow water and drying after; iced tyres from ice to wood, Stadium and Snow car.
  {
    const parts = L(['WoodStartRoad', ...wood(3), ...Array(3).fill('StadiumShallowWater'), ...wood(20)]);
    const l = await run(parts, { trace: 250 }, [{ id: 1, rec: { up: [0] }, frames: 9000 }]);
    results.wet = l.probes.map((q) => q.fr + ':' + q.wet);
    console.log('wet tyres every 250 frames:', results.wet.join(' '));
  }
  for (const veh of ['Stadium', 'Snow']) {
    const parts = L(['IceStartPlat', ...Array(5).fill('IcePlatBase'), ...Array(14).fill('WoodPlatBase')]);
    const l = await run(parts, { trace: 250, vehicle: veh }, [{ id: 1, rec: { up: [0] }, frames: 8000 }]);
    results['ice_' + veh] = l.probes.map((q) => q.fr + ':' + q.ice.join('/'));
    console.log(veh, 'iced tyres every 250 frames:', results['ice_' + veh].join(' '));
  }
}

if (section == 'effects2') {
  // What wet and iced tyres, turbos and bumpers do to the driving, not only their values.
  const lane = (items, x = 0) => { let z = 0; return items.map((n) => { const o = typeof n == 'string' ? { n } : { ...n }; const p = { x, y: 0, z, ...o }; z -= o.len ?? 4; return p; }); };
  // A field of `piece` from row `from` on, nine platforms wide, for a full-lock test after the lane.
  const field = (piece, from, rows) => { const p = []; for (let j = from; j < from + rows; j++) for (const x of [-16, -12, -8, -4, 0, 4, 8, 12, 16]) p.push({ n: piece, x, y: 0, z: -4 * j }); return p; };
  const lockAt = (s, i) => ({ kmh: +s[i].v.toFixed(0), slideKmh: slide(s, i, i + 1000), latAcc: latAcc(s, i + 300, i + 1000), degPerSec: rate(s, i + 300, i + 1000), endKmh: +s[i + 1000].v.toFixed(0) });
  const probeAt = (pr, fr) => pr.filter((q) => q.fr <= fr).pop();
  // Wet tyres: three shallow water pieces, then wood. Full lock 150 ms after the water, against the same lock on a dry
  // run (water swapped for wood) at the same speed.
  {
    const head = ['WoodStartPlat', 'WoodPlatBase', 'WoodPlatBase'], n = head.length + 3;
    const wet = [...lane([...head, 'StadiumShallowWater', 'StadiumShallowWater', 'StadiumShallowWater']), ...field('WoodPlatBase', n, 30)];
    const dry = [...lane([...head, 'WoodPlatBase', 'WoodPlatBase', 'WoodPlatBase']), ...field('WoodPlatBase', n, 30)];
    const exitZ = -4 * n * 5 + 10, w1 = await run(wet, { trace: 50 }, [{ id: 1, rec: { up: [0] }, frames: 6000 }]), out = first(w1[1], (q) => q.z < exitZ);
    const at = out + 150, kmh = w1[1][at].v, d1 = (await run(dry, null, [{ id: 1, rec: { up: [0] }, frames: 6000 }]))[1], atDry = first(d1, (q) => q.v >= kmh);
    const w2 = await run(wet, { trace: 50 }, [{ id: 1, rec: { up: [0], right: [at] }, frames: at + 1100 }]), d2 = (await run(dry, null, [{ id: 1, rec: { up: [0], right: [atDry] }, frames: atDry + 1100 }]))[1];
    results.wetWood = { leftWaterFrame: out, wetAtLock: probeAt(w2.probes, at)?.wet, wetAfterLock: probeAt(w2.probes, at + 1000)?.wet, wet: lockAt(w2[1], at), dry: lockAt(d2, atDry) };
    console.log('wet tyres then full lock on wood:', JSON.stringify(results.wetWood));
  }
  // Iced tyres: six ice platforms, then the stock floor (Plane). Full lock 100 ms after the ice and again 3.5 s after it
  // (thawed). The Snow car's tyres never ice.
  for (const veh of ['Stadium', 'Rally', 'Snow']) {
    const n = 7, P = [...lane(['IceStartPlat', ...Array(6).fill('IcePlatBase')]), ...field('Plane', n, 40)], exitZ = -4 * n * 5 + 10;
    const l1 = (await run(P, { vehicle: veh }, [{ id: 1, rec: { up: [0] }, frames: 9000 }]))[1], out = first(l1, (q) => q.z < exitZ);
    const r = await run(P, { trace: 50, vehicle: veh }, [{ id: 1, rec: { up: [0], right: [out + 100] }, frames: out + 1200 }, { id: 2, rec: { up: [0], right: [out + 3500] }, frames: out + 4600 }]);
    // the same lock at the same speeds on a stock floor that never saw ice
    const C = [{ n: 'PlaneStart', x: 0, y: 0, z: 0 }, ...field('Plane', 1, 46), { n: 'PlasticPlatBase', x: 0, y: 0, z: 400 }], c1 = (await run(C, { vehicle: veh }, [{ id: 1, rec: { up: [0] }, frames: 9000 }]))[1];
    const k1 = first(c1, (q) => q.v >= r[1][out + 100].v), k2 = first(c1, (q) => q.v >= r[2][out + 3500].v);
    const ctl = await run(C, { vehicle: veh }, [{ id: 1, rec: { up: [0], right: [k1] }, frames: k1 + 1100 }, ...(k2 != null ? [{ id: 2, rec: { up: [0], right: [k2] }, frames: k2 + 1100 }] : [])]);
    results['ice_' + veh] = { leftIceFrame: out, icedAtLock: probeAt(r.probes.filter((q) => q.carId == 1), out + 100)?.ice, icedAfter3500: probeAt(r.probes.filter((q) => q.carId == 2), out + 3500)?.ice, at100: lockAt(r[1], out + 100), neverIced100: lockAt(ctl[1], k1), at3500: lockAt(r[2], out + 3500), neverIced3500: k2 != null ? lockAt(ctl[2], k2) : null };
    console.log(veh, 'iced tyres then full lock on stock road:', JSON.stringify(results['ice_' + veh]));
  }
  // Turbo, super and ultra turbo plates: km/h 1 and 2 s after the plate, against no plate.
  results.turbos = {};
  for (const fx of ['none', 'Turbo', 'Super', 'Ultra']) {
    const P = lane(['WoodStartPlat', 'WoodPlatBase', 'WoodPlatBase', 'WoodPlatBase', fx == 'none' ? 'WoodPlatBase' : 'WoodFx' + fx + 'Plat', ...Array(40).fill('WoodPlatBase')]);
    const l = (await run(P, null, [{ id: 1, rec: { up: [0] }, frames: 8000 }]))[1], i = first(l, (q) => q.z < -4 * 4 * 5 + 10);
    results.turbos[fx] = { enterKmh: +l[i].v.toFixed(0), after1s: +l[i + 1000].v.toFixed(0), after2s: +l[i + 2000].v.toFixed(0) };
  }
  console.log('turbo plates:', JSON.stringify(results.turbos));
  // Bumpers are deterministic: the same run twice gives the same frames, bit for bit.
  {
    const P = lane(['WoodStartPlat', 'WoodPlatBase', 'WoodPlatBase', 'WoodPlatBase', { n: 'WoodFxBumper2Plat', x: 1 }, ...Array(8).fill('WoodPlatBase')]);
    const hash = (l) => { let h = 0; const fb = new Float32Array(4), ub = new Uint32Array(fb.buffer); for (const s of l) { fb[0] = s.x; fb[1] = s.y; fb[2] = s.z; fb[3] = s.v; for (const u of ub) h = (Math.imul(h, 31) + u) >>> 0; } return h.toString(16); };
    const a = (await run(P, null, [{ id: 1, rec: { up: [0] }, frames: 4000 }]))[1], b = (await run(P, null, [{ id: 1, rec: { up: [0] }, frames: 4000 }]))[1];
    results.bumperRepeat = { a: hash(a), b: hash(b), same: hash(a) == hash(b), xAfter: +a[3999].x.toFixed(2) };
    console.log('super bumper run twice:', JSON.stringify(results.bumperRepeat));
  }
}

if (section == 'feel') {
  const lane = (items, x = 0) => { let z = 0; return items.map((n) => { const o = typeof n == 'string' ? { n } : { ...n }; const p = { x, y: 0, z, ...o }; z -= o.len ?? 4; return p; }); };
  // Catching a drift: full right lock from 140 km/h for `lock` ms, then left (countersteer) for cs ms, then nothing.
  // After the lock: the most slip, the lowest km/h, and whether the car spun (slip past 90 degrees); slip 1 s after.
  results.drift = {};
  const F = { dirt: ['DirtStartPlat', 'DirtPlatBase'], grass: ['GrassStartPlat', 'GrassPlatBase'], plastic: ['PlasticStartPlat', 'PlasticPlatBase'] };
  for (const name of only || ['dirt', 'grass', 'plastic'])
    for (const veh of name == 'plastic' ? ['Stadium'] : ['Stadium', 'Rally']) {
      const P = floor(...F[name]), test = testOf(null, { vehicle: veh }), l0 = (await run(P, test, [{ id: 1, rec: { up: [0] }, frames: 8000 }]))[1], f140 = first(l0, (q) => q.v >= 140);
      for (const lock of [800, 1000, 1200])
        for (const cs of [0, 150, 300]) {
          const t0 = f140 + lock, l = (await run(P, test, [{ id: 1, rec: { up: [0], right: [f140, t0], left: cs ? [t0, t0 + cs] : [] }, frames: t0 + 3000 }]))[1];
          let maxSlip = 0, minKmh = 1e9;
          for (let k = t0; k < t0 + 2500; k++) { maxSlip = Math.max(maxSlip, Math.abs(slipAt(l, k))); minKmh = Math.min(minKmh, l[k].v); }
          results.drift[name + '/' + veh + '/lock' + lock + '/cs' + cs] = { kmhAtLetGo: +l[t0].v.toFixed(0), slipAtLetGo: +Math.abs(slipAt(l, t0)).toFixed(0), maxSlip: +maxSlip.toFixed(0), minKmh: +minKmh.toFixed(0), slip1s: +Math.abs(slipAt(l, t0 + 1000)).toFixed(0), spun: maxSlip > 90 };
        }
      console.log(name, veh, JSON.stringify(Object.fromEntries(Object.entries(results.drift).filter(([k]) => k.startsWith(name + '/' + veh + '/')))));
    }
  // Bumpers turned every way on a wood platform lane: km/h just before and just after the kick and the sideways speed.
  results.bumperTurned = {};
  for (const n of ['WoodFxBumperPlat', 'WoodFxBumper2Plat'])
    for (const r of [0, 1, 2, 3])
      for (const x of [0, 1]) {
        const P = lane(['WoodStartPlat', 'WoodPlatBase', 'WoodPlatBase', 'WoodPlatBase', { n, r, x }, ...Array(10).fill('WoodPlatBase')]);
        const l = (await run(P, null, [{ id: 1, rec: { up: [0] }, frames: 5000 }]))[1], i = first(l, (q) => q.z < -60 - 5);
        let k = i, peak = 0;
        for (let j = i; j < i + 400; j++) { const [vx] = vel(l, j); if (Math.abs(vx) > Math.abs(peak)) (peak = vx), (k = j); }
        results.bumperTurned[n + ' r' + r + ' x' + x] = { kmhBefore: +l[i].v.toFixed(1), kmhAfter: +l[Math.min(l.length - 1, k + 20)].v.toFixed(1), sideways: +peak.toFixed(1) };
      }
  console.log('bumpers turned:', JSON.stringify(results.bumperTurned));
  // Icing and wet tyres through a checkpoint: the Stadium car over six ice platforms (or three shallow water pieces),
  // then a checkpoint platform: the tyres stay iced (wet) through it and thaw (dry) on the wood after.
  for (const [what, pieces] of [['ice', Array(6).fill('IcePlatBase')], ['wet', Array(3).fill('StadiumShallowWater')]]) {
    const P = lane([what == 'ice' ? 'IceStartPlat' : 'WoodStartPlat', ...pieces, { n: 'WoodCheckpointPlat', cp: 0 }, ...Array(12).fill('WoodPlatBase')]);
    const r = await run(P, { trace: 50 }, [{ id: 1, rec: { up: [0] }, frames: 6000 }]), cpAt = first(r[1], (q) => q.n >= 1);
    const at = (fr) => r.probes.filter((q) => q.fr <= fr).pop()?.[what];
    results[what + 'ThroughCheckpoint'] = { checkpointFrame: cpAt, before: at(cpAt - 50), after100: at(cpAt + 100), after600: at(cpAt + 600), after2000: at(cpAt + 2000) };
    console.log(what, 'tyres through a checkpoint (Stadium):', JSON.stringify(results[what + 'ThroughCheckpoint']));
  }
  // Respawn key while the car is under 5 units from where it respawns, after a vehicle gate past the checkpoint: it comes
  // back as the car it was at the checkpoint. The car drives through the gate, then backs up (the brake held reverses)
  // to the respawn point, found from a respawn far away, and the key is pressed there.
  {
    const P = lane(['WoodStartRoad', 'WoodRoadStraight', { n: 'WoodCheckpointRoad', cp: 0 }, 'WoodCarSnowRoad', ...Array(8).fill('WoodRoadStraight')]);
    const l0 = await run(P, { trace: 10 }, [{ id: 1, rec: { up: [0] }, frames: 3000 }]), gate = l0.probes.find((q) => q.vehicle == 'Snow')?.fr;
    const far = (await run(P, null, [{ id: 1, rec: { up: [0], reset: [gate + 300, gate + 301] }, frames: gate + 320 }]))[1], home = far[gate + 310];
    const back = (await run(P, null, [{ id: 1, rec: { up: [0, gate + 1], down: [gate + 1] }, frames: gate + 9000 }]))[1];
    const near = first(back, (q) => Math.hypot(q.x - home.x, q.z - home.z) < 3, gate + 1);
    const r = near == null ? null : await run(P, { trace: 10 }, [{ id: 1, rec: { up: [0, gate + 1], down: [gate + 1, near], reset: [near, near + 1] }, frames: near + 300 }]);
    const v = (fr) => r?.probes.filter((q) => q.fr <= fr).pop()?.vehicle;
    results.respawnNear = { gateFrame: gate, keyFrame: near, unitsFromRespawn: near == null ? null : +Math.hypot(back[near].x - home.x, back[near].z - home.z).toFixed(2), beforeKey: v(near - 5), afterKey: v(near + 100) };
    console.log('respawn key near the checkpoint:', JSON.stringify(results.respawnNear));
  }
}

if (section == 'reactor') {
  // Reactor boosts (tm_runtime.js REACTOR): gravity, then per plate type on a wide stock floor (Plane): gas held all the
  // way, gas let go 0.3 s after the plate, hovering by feathering the gas (test bot: TEST.hover), steering in the air,
  // down plates pressing the car and off a jump, the ends (reset plate, respawn key) and an R20 loop.
  // Heights are of the car's origin over its ride height before the plate. TMTYPES=ReactorUp,... picks the plates.
  const lane = (items, y = 0) => { let z = 0; return items.map((n) => { const o = typeof n == 'string' ? { n } : { ...n }; const p = { x: 0, y, z, ...o }; z -= 4; return p; }); };
  const field = (piece, from, rows, y = 0) => { const p = []; for (let j = from; j < from + rows; j++) for (const x of [-16, -12, -8, -4, 0, 4, 8, 12, 16]) p.push({ n: piece, x, y, z: -4 * j }); return p; };
  const tilt = (q) => Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (q[0] * q[0] + q[2] * q[2])))) * 57.2958; // car up against world up, deg
  const vy = (l, i) => { const a = l[Math.max(0, i - 5)], b = l[Math.min(l.length - 1, i + 5)]; return (b.y - a.y) / ((b.f - a.f) / 1000); };
  results.reactor = {};
  // Gravity: off the end of a lane 30 units up, the vertical acceleration over 0.4 s of free fall.
  {
    // gas let go at the edge, so nothing but gravity (and the game's drag) acts; per 200 ms window, and the fall speed
    const l0 = (await run(lane(['PlaneStart', 'Plane', 'Plane', 'WoodPlatBase'], 6), null, [{ id: 1, rec: { up: [0] }, frames: 5000 }]))[1], edge = first(l0, (q) => q.z < -3 * 20 - 10);
    const l = (await run(lane(['PlaneStart', 'Plane', 'Plane', 'WoodPlatBase'], 6), null, [{ id: 1, rec: { up: [0, edge] }, frames: 5000 }]))[1];
    const off = first(l, (q) => q.w == 0, edge), win = [];
    for (let a = off + 100; a + 200 < l.length && l[a + 200].w == 0; a += 200) win.push([+vy(l, a).toFixed(1), +(-(vy(l, a + 200) - vy(l, a)) / 0.2).toFixed(3)]);
    results.reactor.gravity = win.length ? win[0][1] : null;
    console.log('gravity (units/s^2) per 200 ms of free fall [fall speed, acceleration]:', JSON.stringify(win));
  }
  const types = (process.env.TMTYPES || 'ReactorUp,ReactorDown,Reactor2Up,Reactor2Down,ReactorOriented,Reactor2Oriented').split(',').filter((t) => has('WoodFx' + t + 'Plat'));
  // Stock floor (Plane) round the plate, so only the plate is new.
  const P = [...lane(['PlaneStart', 'Plane', 'Plane']), ...field('Plane', 3, 1).filter((p) => p.x != 0), { n: 'PLATE', x: 0, y: 0, z: -12 }, ...field('Plane', 4, 70)];
  const plateAt = (l) => first(l, (q) => q.z < -12 * 5 + 6); // the car's origin enters the plate's box (12 long)
  for (const type of types) {
    const parts = P.map((p) => (p.n == 'PLATE' ? { ...p, n: 'WoodFx' + type + 'Plat' } : p));
    const R = (results.reactor[type] = {});
    const A = await run(parts, { trace: 100 }, [{ id: 1, rec: { up: [0] }, frames: 11000 }]), l = A[1], i0 = plateAt(l), ride = l[i0 - 50].y;
    const on = A.probes.filter((q) => q.reactor), later = A.probes.filter((q) => q.fr > i0 + 6500);
    const h = (i) => +(l[Math.min(l.length - 1, i)].y - ride).toFixed(2);
    const up = (k) => first(l, (q) => q.y - ride >= k, i0);
    R.gasHeld = { plateFrame: i0, kmhAtPlate: +l[i0].v.toFixed(0), zoneType: on[0]?.reactor ?? null, activeMs: on.length ? on[on.length - 1].fr - on[0].fr + 100 : 0, after1s: h(i0 + 1000), after2s: h(i0 + 2000), after3s: h(i0 + 3000), after6s: h(i0 + 6000), peak: +(Math.max(...l.slice(i0).map((q) => q.y)) - ride).toFixed(2), msTo10: up(10) != null ? up(10) - i0 : null, vyAt5s: +vy(l, i0 + 5000).toFixed(2), maxTilt: +Math.max(...l.slice(i0, i0 + 6000).map((q) => tilt(q.q))).toFixed(1), airMs: l.slice(i0, i0 + 6000).filter((q) => q.w == 0).length, kmhAt6s: +l[i0 + 6000].v.toFixed(0), after6_5s: later.length ? later[0].reactor : 'n/a' };
    // The lowest the car sits on its springs in the first 3 s (a down boost presses it), against its ride height.
    R.gasHeld.lowest = +(Math.min(...l.slice(i0, i0 + 3000).map((q) => q.y)) - ride).toFixed(3);
    const B = (await run(parts, null, [{ id: 1, rec: { up: [0, i0 + 300] }, frames: i0 + 6000 }]))[1];
    R.gasOff300 = { after1s: +(B[i0 + 1000].y - ride).toFixed(2), after3s: +(B[i0 + 3000].y - ride).toFixed(2), peak: +(Math.max(...B.slice(i0).map((q) => q.y)) - ride).toFixed(2) };
    if (/Down/.test(type)) continue;
    // Hovering: the bot holds the gas while the car is under 8 units over its ride height (by height + 0.25 s of climb).
    const H = (await run(parts, { hover: { y: ride + 8, lead: 0.25 } }, [{ id: 1, rec: { up: [0] }, frames: i0 + 6500 }]))[1];
    const hs = H.slice(i0 + 2500, i0 + 5500).map((q) => q.y - ride);
    R.hover8 = { mean: +(hs.reduce((a, b) => a + b, 0) / hs.length).toFixed(2), min: +Math.min(...hs).toFixed(2), max: +Math.max(...hs).toFixed(2), maxTilt: +Math.max(...H.slice(i0, i0 + 6000).map((q) => tilt(q.q))).toFixed(1) };
    // Steering left in the air: from 1.5 s after the plate, held 2 s. Yaw rate and the most the car tips.
    const s0 = i0 + 1500, S = (await run(parts, null, [{ id: 1, rec: { up: [0], left: [s0, s0 + 2000] }, frames: i0 + 6000 }]))[1];
    R.airSteer = { airborne: S[s0].w == 0, yawDegPerSec: rate(S, s0 + 500, s0 + 1500), maxTilt: +Math.max(...S.slice(s0, s0 + 2500).map((q) => tilt(q.q))).toFixed(1), tiltAt2s: +tilt(S[s0 + 2000].q).toFixed(1) };
    console.log(type, JSON.stringify(R));
  }
  for (const type of types.filter((t) => /Down/.test(t))) console.log(type, JSON.stringify(results.reactor[type]));
  // Down boosts off a jump: a lane 30 units up with the plate on its last platform, gas held; the fall acceleration.
  for (const type of types.filter((t) => /Down/.test(t))) {
    const l = (await run(lane(['PlaneStart', 'Plane', 'Plane', 'WoodFx' + type + 'Plat'], 6), null, [{ id: 1, rec: { up: [0] }, frames: 6000 }]))[1];
    const off = first(l, (q) => q.w == 0, 500), a = off + 100, b = off + 400;
    results.reactor[type].fallAccel = +(-(vy(l, b) - vy(l, a)) / ((b - a) / 1000)).toFixed(2);
    console.log(type, 'fall acceleration off a jump, gas held:', results.reactor[type].fallAccel);
  }
  // Ends: a reset plate after the reactor plate, and the respawn key after a checkpoint.
  if (types.includes('Reactor2Up')) {
    const T0 = lane(['WoodStartPlat', 'WoodPlatBase', 'WoodPlatBase', 'WoodFxReactor2UpPlat', 'WoodPlatBase', 'WoodFxResetPlat', ...Array(20).fill('WoodPlatBase')]);
    // gas let go after the reactor plate so the car stays on the deck and reaches the reset plate
    const l0 = (await run(T0, null, [{ id: 1, rec: { up: [0] }, frames: 3000 }]))[1], p0 = first(l0, (q) => q.z < -3 * 20 + 6) - 20;
    const r1 = await run(T0, { trace: 20 }, [{ id: 1, rec: { up: [0, p0] }, frames: p0 + 4000 }]), rz = first(r1[1], (q) => q.z < -5 * 20 + 6);
    results.reactor.resetPlate = { reactorProbes: r1.probes.filter((q) => q.reactor).length, resetPlateFrame: rz, activeAfterReset: r1.probes.filter((q) => rz != null && q.fr > rz + 20 && q.reactor).length };
    const T1 = lane(['WoodStartPlat', 'WoodPlatBase', { n: 'WoodCheckpointPlat', cp: 0 }, 'WoodPlatBase', 'WoodFxReactor2UpPlat', ...Array(20).fill('WoodPlatBase')]);
    const l1 = (await run(T1, null, [{ id: 1, rec: { up: [0] }, frames: 4000 }]))[1], p = first(l1, (q) => q.z < -4 * 20 + 6);
    const r2 = await run(T1, { trace: 50 }, [{ id: 1, rec: { up: [0], reset: [p + 800, p + 801] }, frames: p + 1500 }]);
    results.reactor.respawnKey = { plateFrame: p, keyFrame: p + 800, activeBeforeKey: r2.probes.filter((q) => q.fr > p + 50 && q.fr < p + 800 && q.reactor).length, activeAfterKey: r2.probes.filter((q) => q.fr > p + 850 && q.reactor).length };
    console.log('reset plate:', JSON.stringify(results.reactor.resetPlate), 'respawn key:', JSON.stringify(results.reactor.respawnKey));
  }
  // Oriented against legacy through an R20 offset loop, gas held: the plate just before the loop.
  {
    const r = 20, run0 = 8, z0 = -run0 * 4, name = (q) => 'WoodRoadLoop' + r + 'OffsetRQ' + q;
    for (const type of ['none', ...types.filter((t) => !/Down/.test(t))]) {
      const parts = lane(['WoodStartRoad', ...Array(run0 - 2).fill('WoodRoadStraight'), type == 'none' ? 'WoodRoadStraight' : 'WoodFx' + type + 'Road']);
      parts.push({ n: name(1), x: 0, y: 0, z: z0 }, { n: name(2), x: 0, y: r / 5, z: z0 }, { n: name(3), x: 0, y: r / 5, z: z0 + 4 }, { n: name(4), x: 0, y: 0, z: z0 + 4 });
      let z = z0; for (let k = 0; k < 40; k++) { parts.push({ n: 'WoodRoadStraight', x: 4, y: 0, z }); z -= 4; }
      const l = (await run(parts, null, [{ id: 1, rec: { up: [0] }, frames: 9000 }]))[1], peak = Math.max(...l.map((q) => q.y)), e = l[l.length - 1];
      const inLoop = l.filter((q) => q.y > 3 && q.y < 2 * r + 2), air = inLoop.filter((q) => q.w == 0).length;
      (results.reactor.loop ??= {})[type] = { peak: +peak.toFixed(1), madeIt: peak > 2 * r - 3 && Math.abs(e.x - 20) < 7 && e.y < 3, airMsInLoop: air, msInLoop: inLoop.length, endX: +e.x.toFixed(1), kmh: +e.v.toFixed(0) };
    }
    console.log('R20 loop, gas held:', JSON.stringify(results.reactor.loop));
  }
}

if (section == 'verify') {
  // The game's own verifier on a track with the new things: it accepts a run only if the car finishes on exactly that
  // frame. Found by an exact run first, then 21 frames round it are checked, twice.
  const L = (items) => { let z = 0; return items.map((n) => { const o = typeof n == 'string' ? { n } : { ...n }; const p = { x: 0, y: 0, z, ...o }; z -= 4; return p; }); };
  const tracks = {};
  tracks.roads = L(['WoodStartRoad', 'WoodRoadStraight', 'DirtRoadStraight', 'DirtRoadStraight', 'WoodRoadStraight', 'WoodCarRallyRoad', 'DirtRoadStraight', 'DirtRoadStraight', { n: 'WoodCheckpointRoad', cp: 0 }, 'WoodFxUltraRoad', 'WoodRoadStraight', 'WoodCarSnowRoad', 'StadiumShallowWater', 'StadiumShallowWater', 'WoodRoadStraight', 'WoodFinishRoad', 'WoodRoadStraight', 'WoodRoadStraight']);
  // Nine platforms wide (checkpoint and finish across all nine; the kick turns the car off the line), so a bumper's kick lands on the floor: grass, a super bumper, dirt, the Desert gate, ice
  // (iced tyres), a checkpoint, grass again and the finish.
  const rows = ['GrassStartPlat', 'GrassPlatBase', 'WoodFxBumper2Plat', 'DirtPlatBase', 'WoodCarDesertPlat', 'IcePlatBase', 'IcePlatBase', { n: 'WoodCheckpointPlat', cp: 0 }, 'GrassPlatBase', 'GrassPlatBase', 'DirtFinishPlat', 'GrassPlatBase', 'GrassPlatBase'];
  tracks.platforms = [];
  rows.forEach((n, i) => { const o = typeof n == 'string' ? { n } : n; tracks.platforms.push({ x: 0, y: 0, z: -4 * i, ...o }); for (const x of [-16, -12, -8, -4, 4, 8, 12, 16]) tracks.platforms.push(/Checkpoint|Finish/.test(o.n) ? { ...o, x, y: 0, z: -4 * i } : { n: /Grass/.test(o.n) ? 'GrassPlatBase' : /Dirt/.test(o.n) ? 'DirtPlatBase' : /Ice/.test(o.n) ? 'IcePlatBase' : 'WoodPlatBase', x, y: 0, z: -4 * i }); });
  // All of the new kinds at once, nine platforms wide: grass, dirt, the Rally gate, shallow water (dirt either side), a
  // bumper on dirt, a checkpoint, grass and the finish.
  const mixed = ['GrassStartPlat', 'GrassPlatBase', 'DirtPlatBase', 'DirtCarRallyPlat', 'StadiumShallowWater', 'StadiumShallowWater', 'DirtPlatBase', 'DirtFxBumperPlat', 'DirtPlatBase', { n: 'DirtCheckpointPlat', cp: 0 }, 'GrassPlatBase', 'GrassPlatBase', 'GrassFinishPlat', 'GrassPlatBase', 'GrassPlatBase'];
  tracks.mixed = [];
  mixed.forEach((n, i) => { const o = typeof n == 'string' ? { n } : n; tracks.mixed.push({ x: 0, y: 0, z: -4 * i, ...o }); for (const x of [-16, -12, -8, -4, 4, 8, 12, 16]) tracks.mixed.push(/Checkpoint|Finish/.test(o.n) ? { ...o, x, y: 0, z: -4 * i } : { n: /Grass/.test(o.n) ? 'GrassPlatBase' : 'DirtPlatBase', x, y: 0, z: -4 * i }); });
  // Tyre states on the way: water, dirt (mud), a checkpoint, tech, ice (icing), wood, the finish on wood.
  tracks.tyres = L(['DirtStartPlat', 'DirtPlatBase', 'StadiumShallowWater', 'StadiumShallowWater', 'DirtPlatBase', 'DirtPlatBase', { n: 'DirtCheckpointPlat', cp: 0 }, 'Plane', 'Plane', 'IcePlatBase', 'IcePlatBase', 'WoodPlatBase', 'WoodPlatBase', 'WoodFinishPlat', 'WoodPlatBase', 'WoodPlatBase']);
  // Reactor boosts: a super down plate pressing the car, a checkpoint, an oriented plate lifting it, the finish 2 on.
  tracks.reactor = L(['WoodStartPlat', 'WoodPlatBase', 'WoodFxReactor2DownPlat', 'WoodPlatBase', { n: 'WoodCheckpointPlat', cp: 0 }, 'WoodFxReactorOrientedPlat', 'WoodPlatBase', 'WoodFinishPlat', 'WoodPlatBase', 'WoodPlatBase']);
  // Stock road onto bump road through its connector, then a checkpoint, the bumper and the finish on the crown.
  for (const r of [0, 2]) tracks['bump' + r] = L(['Start', 'Straight', 'Straight', { n: 'StadiumBumpFromRoad', r }, 'StadiumBumpStraight', 'StadiumBumpStraight', { n: 'StadiumCheckpointBump', cp: 0 }, 'StadiumBumpStraight', 'StadiumFxUltraBump', 'StadiumBumpStraight', 'StadiumBumpStraight', 'StadiumFinishBump', 'StadiumBumpStraight', 'StadiumBumpStraight']);
  if (only) for (const k in tracks) if (!only.includes(k)) delete tracks[k];
  results.verify = {};
  for (const [name, parts] of Object.entries(tracks)) {
    { const l = (await run(parts, null, [{ id: 1, rec: { up: [0] }, frames: 12000 }]))[1]; console.log(name, 'path every 0.5 s (x z y km/h next-cp finish):', l.filter((_, i) => i % 500 == 0).map((q) => [q.x, q.z, q.y, q.v].map((v) => v.toFixed(0)).join(',') + ',' + q.n).join(' | ')); }
  const fins = await c.evaluate(`(async()=>{
    const Rec=__req(1754).A,t=__mk(${JSON.stringify(parts)}),M=__req(6421).A.createMountainVertices(t.getBounds()),rec=new Rec({up:[0],right:[],down:[],left:[],reset:[]}).serialize();
    const probe=()=>new Promise(res=>{const w=new Worker('simulation_worker.bundle.js');let last=null;
      w.addEventListener('message',e=>{if(e.data.messageType!=10)return;for(const b of e.data.carStateBuffers){const s=__req(3899).VO(new Uint8Array(b).subarray(4)).carState;if(s.finishFrames!=null&&last==null){last=s.finishFrames;w.terminate();res(last);}}});
      w.postMessage({...window.__init,isRealtime:false});
      w.postMessage({messageType:3,mountainVertices:M.vertices,mountainOffset:{x:M.offset.x,y:M.offset.y,z:M.offset.z},trackData:t.toSaveString(),carId:1,carRecording:rec});
      w.postMessage({messageType:5,carId:1,targetSimulationTimeFrames:60000});setTimeout(()=>res(null),90000);});
    const fin=await probe();
    const scan=()=>new Promise(res=>{const w=new Worker('simulation_worker.bundle.js'),hits=[];let pend=0;const lo=fin-10,hi=fin+10;
      w.addEventListener('message',e=>{if(e.data.messageType!=8)return;if(e.data.result)hits.push(e.data.carId+lo);if(--pend==0){w.terminate();res(hits);}});
      w.postMessage({...window.__init,isRealtime:false});
      for(let f=lo;f<=hi;f++){pend++;w.postMessage({messageType:1,mountainVertices:M.vertices,mountainOffset:{x:M.offset.x,y:M.offset.y,z:M.offset.z},trackData:t.toSaveString(),carId:f-lo,carRecording:rec,targetFrames:f});}});
    return JSON.stringify({fin,a:await scan(),b:await scan()});
  })()`);
  results.verify[name] = JSON.parse(fins);
  console.log('verifier on the ' + name + ' track (finish frame, passing frames twice):', fins);
  }
}

if (section == 'page') {
  // The page's surface lookup: TM.surfaceIndex's footprint against the game's own tiles.rotated for every part with a
  // surface in all 24 placements, and TM.surfaceAt on a dirt / grass / plastic floor.
  results.page = JSON.parse(await c.evaluate(`(()=>{
    const Hw=__req(2600).Hw, key=(x,y,z)=>(x+50000)*1e10+(y+5000)*1e5+(z+50000); let parts=0, placements=0, bad=[];
    for(const p of TM.parts){ if(p.u==null&&!p.r)continue; parts++;
      for(let axis=0;axis<6;axis++)for(let rot=0;rot<4;rot++){ placements++;
        const t=__mk([{n:p.i,x:3,y:2,z:-7,r:rot,a:axis}]), idx=TM.surfaceIndex(t), want=new Set();
        Hw(p.i).tiles.rotated(rot,axis).forEach((a,b,c)=>want.add(key(3+a,2+b,-7+c)));
        const got=new Set(idx.keys()); if(got.size!=want.size||[...want].some(k=>!got.has(k))) bad.push(p.n+' r'+rot+' a'+axis); }}
    const f=__mk([{n:'DirtStartPlat',x:0,y:0,z:0},{n:'GrassPlatBase',x:4,y:0,z:0},{n:'PlasticPlatBase',x:-4,y:0,z:0},{n:'Plane',x:0,y:0,z:4}]), I=TM.surfaceIndex(f);
    return JSON.stringify({parts, placements, mismatches: bad.length, firstBad: bad.slice(0,5), at: {dirt: TM.surfaceAt(I,0,0.1,0), grass: TM.surfaceAt(I,20,0.1,0), plastic: TM.surfaceAt(I,-20,0.1,0), stockPlane: TM.surfaceAt(I,0,0,20), nothing: TM.surfaceAt(I,500,0,500)},
      zones: TM.zones(__mk([{n:'WoodFxBumperPlat',x:0,y:0,z:0,r:1},{n:'WoodCarSnowRoad',x:0,y:0,z:-8}])).map(z=>({type:z.type,fwd:z.fwd,right:z.right,centre:z.centre})),
      vehicles: Object.fromEntries(Object.entries(TM.VEHICLES).map(([k,v])=>[k,v.look])), gates: TM.vehicleGates});
  })()`));
  console.log(JSON.stringify(results.page, null, 1));
}

if (section == 'surfaces') {
  const rows = {};
  for (const name of only || Object.keys(SURF)) {
    const [s, p, u] = SURF[name], t0 = Date.now();
    rows[name] = await measure(floor(s, p), testOf(u), (r) => circleFloor(s, p, r));
    rows[name].src = u && Object.keys(u).length ? 'PlasticPlatBase as u' + Object.values(u)[0] : p;
    console.log(name, JSON.stringify(rows[name]), ((Date.now() - t0) / 1000).toFixed(0) + ' s');
  }
  results.rows = rows;
  table(rows, COLS);
}

if (section == 'grip') {
  // Skid pad: the circling bot holds a capped speed on a circle; the highest cap at which the car still keeps to the line
  // is where the tyres let go, so (that speed)^2 / R is the surface's lateral grip (units/s^2). The uncapped run says
  // whether the engine, not the tyres, sets the limit (the cap is never reached). TMVEH=Snow,Rally picks vehicles.
  const holds = (q, cap) => {
    let sv = 0, sd = 0, n = 0;
    for (let k = q.length - 6000; k < q.length; k += 10) { const [vx, vz] = vel(q, k); sv += Math.hypot(vx, vz) * 3.6; sd += Math.abs(Math.hypot(q[k].x + q.r, q[k].z) - q.r); n++; }
    return { kmh: sv / n, off: sd / n, ok: sd / n < 1 && (cap == null || sv / n > 0.96 * cap) };
  };
  const rows = {};
  for (const veh of (process.env.TMVEH || 'Stadium').split(','))
    for (const name of only || ['stock', 'tech', 'dirt', 'grass', 'snow']) {
      const [s, p, u] = SURF[name], far = name == 'stock' && veh != 'Stadium' ? [{ n: 'PlasticPlatBase', x: 0, y: 0, z: 400 }] : [], row = {};
      for (const r of [60, 120, 200]) {
        const cp = [...circleFloor(s, p, r), ...far],
          go = async (cap) => { const q = (await run(cp, testOf(u, { vehicle: veh, bot: { x: -r, z: 0, r, band: 6, catch: 0.35, slack: 1.5, ...(cap ? { vmax: cap / 3.6 } : {}) } }), [{ id: 1, rec: {}, frames: 22000 }]))[1]; q.r = r; return holds(q, cap); };
        const free = await go(null);
        let lo = 30, hi = Math.max(60, free.kmh + 15);
        for (let k = 0; k < 7; k++) { const mid = (lo + hi) / 2; if ((await go(mid)).ok) lo = mid; else hi = mid; }
        const v = lo / 3.6;
        row['r' + r] = { free: +free.kmh.toFixed(0), freeOff: +free.off.toFixed(1), held: +lo.toFixed(0), lat: +((v * v) / r).toFixed(1), engineLimited: lo > free.kmh - 8 };
      }
      rows[veh + '/' + name] = row;
      console.log(veh + '/' + name, JSON.stringify(row));
    }
  results.grip = rows;
}

if (section == 'quick') {
  // A short vehicles table: 0-100, 0-200, km/h after 10 s, braking from 120 and the R60 circle. TMVEH=Rally,... picks cars.
  const rows = {};
  for (const veh of (process.env.TMVEH || 'Stadium,Snow,Rally,Desert').split(','))
    for (const name of only || ['stock', 'dirt', 'grass', 'snow', 'ice']) {
      const [s, p, u] = SURF[name], test = testOf(u, { vehicle: veh }), far = name == 'stock' ? [{ n: 'PlasticPlatBase', x: 0, y: 0, z: 400 }] : [];
      const P = [...floor(s, p), ...far], l = (await run(P, test, [{ id: 1, rec: { up: [0] }, frames: 11000 }]))[1];
      const moved = first(l, (q) => q.v > 0.5) ?? 0, at = (k) => first(l, (q) => q.v >= k), f120 = at(120);
      const b = (await run(P, test, [{ id: 1, rec: { up: [0, f120 + 1], down: [f120 + 1] }, frames: f120 + 6000 }]))[1], k = first(b, (q) => q.v < 1, f120 + 1);
      const r = 60, q = (await run([...circleFloor(s, p, r), ...far], { ...(test || {}), bot: { x: -r, z: 0, r, band: 6, catch: 0.35, slack: 1.5 } }, [{ id: 1, rec: {}, frames: 16000 }]))[1];
      let sv = 0, n = 0;
      for (let j = q.length - 8000; j < q.length; j += 10) { const [vx, vz] = vel(q, j); sv += Math.hypot(vx, vz) * 3.6; n++; }
      rows[veh + '/' + name] = { ms0to100: at(100) - moved, ms0to200: at(200) != null ? at(200) - moved : null, kmh10s: +l[Math.min(l.length - 1, moved + 10000)].v.toFixed(0), brakeDist: k != null ? +Math.hypot(b[k].x - b[f120 + 1].x, b[k].z - b[f120 + 1].z).toFixed(1) : null, r60kmh: +(sv / n).toFixed(0) };
      console.log(veh + '/' + name, JSON.stringify(rows[veh + '/' + name]));
    }
  results.rows = rows;
}

if (section == 'vehicles') {
  const rows = {};
  for (const veh of ['Stadium', 'Snow', 'Rally', 'Desert'])
    for (const name of only || ['stock', 'dirt', 'grass', 'snow', 'ice']) {
      // A stock floor only runs the runtime when the track has a block of ours: one far behind the start.
      const [s, p, u] = SURF[name], t0 = Date.now(), test = testOf(u, { vehicle: veh }),
        far = name == 'stock' ? [{ n: 'PlasticPlatBase', x: 0, y: 0, z: 400 }] : [];
      rows[veh + '/' + name] = await measure([...floor(s, p), ...far], test, (r) => [...circleFloor(s, p, r), ...far]);
      console.log(veh + '/' + name, JSON.stringify(rows[veh + '/' + name]), ((Date.now() - t0) / 1000).toFixed(0) + ' s');
    }
  results.rows = rows;
  table(rows, COLS);
}

if (section == 'tyres') {
  // Tyre states (TYRES): which surface undoes which, per wheel, from the runtime's own probe every 10 frames.
  const lane = (items, x = 0) => { let z = 0; return items.map((n) => { const o = typeof n == 'string' ? { n } : { ...n }; const p = { x, y: 0, z, ...o }; z -= o.len ?? 4; return p; }); };
  // the same lane, with the pieces from index `from` on 9 wide (room to turn)
  const widen = (P, from) => { const out = [...P]; P.forEach((p, i) => { if (i >= from) for (const dx of [-16, -12, -8, -4, 4, 8, 12, 16]) out.push({ ...p, x: p.x + dx }); }); return out; };
  const W3 = Array(3).fill('StadiumShallowWater');
  const mx = (a) => Math.max(...a), mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const fmt = (a) => a.map((v) => v.toFixed(2)).join('/');
  const tl = (pr, from, to, keys) => pr.filter((q) => q.fr >= from && q.fr <= to && q.fr % 250 == 0).map((q) => q.fr + ' u' + q.u.join(',') + ' ' + keys.map((k) => k + ' ' + fmt(q[k])).join(' ')).join(' | ');
  const onAll = (q, set) => q.u.every((u) => set.includes(u));
  results.tyres = {};
  const R = results.tyres;

  // (a) Iced tyres off platform ice onto dirt, tech (stock Plane), grass, wood: how long until every tyre is under 0.1.
  R.a = {};
  if (!only || only.includes('a')) for (const next of ['DirtPlatBase', 'Plane', 'GrassPlatBase', 'WoodPlatBase']) {
    const P = lane(['IceStartPlat', ...Array(7).fill('IcePlatBase'), ...Array(14).fill(next)]);
    const r = await run(P, { trace: 10 }, [{ id: 1, rec: { up: [0] }, frames: 12000 }]), pr = r.probes;
    const off = pr.find((q) => q.fr > 300 && onAll(q, [5, 6, -1, 1]));
    const clr = off && pr.find((q) => q.fr >= off.fr && mx(q.ice) < 0.1);
    R.a[next] = { offIceFrame: off?.fr, kmh: off ? +r[1][off.fr].v.toFixed(0) : null, iceAtOff: off && fmt(off.ice), gripAtOff: off && fmt(off.grip), msToIceUnder0_1: clr ? clr.fr - off.fr : null, timeline: off && tl(pr, off.fr - 250, off.fr + 3000, ['ice', 'grip']) };
    console.log('(a) ice ->', next, JSON.stringify(R.a[next]));
  }

  // (b) Water, then dirt (dries fast, mud builds), then tech (muddy tyres lose grip until it wears off); against dry dirt.
  R.b = {};
  if (!only || only.includes('b')) for (const [name, mid] of [['water', W3], ['dry', Array(3).fill('DirtPlatBase')]]) {
    const items = ['DirtStartPlat', 'DirtPlatBase', ...mid, ...Array(4).fill('DirtPlatBase'), ...Array(14).fill('Plane')];
    const P = widen(lane(items), 9), lock = {};
    const r = await run(P, { trace: 10 }, [{ id: 1, rec: { up: [0] }, frames: 10000 }]), pr = r.probes;
    const out = pr.find((q) => q.fr > 300 && onAll(q, [5]) && q.fr > (pr.find((p) => mx(p.wet) > 0.5)?.fr ?? 0));
    const dirtIn = name == 'water' ? out : pr.find((q) => q.fr > 300 && r[1][q.fr].z < -50);
    const dried = dirtIn && pr.find((q) => q.fr >= dirtIn.fr && mx(q.wet) < 0.05);
    const tech = pr.find((q) => q.fr > (dirtIn?.fr ?? 300) && onAll(q, [-1]));
    const worn = tech && pr.find((q) => q.fr >= tech.fr && mx(q.mud) < 0.05);
    // full right lock 150 ms onto the tech for 700 ms: turn rate and slide against the same on the dry run
    const t0 = tech.fr + 150, l = (await run(P, null, [{ id: 2, rec: { up: [0], right: [t0, t0 + 700] }, frames: t0 + 1200 }]))[2];
    Object.assign(lock, { kmh: +l[t0].v.toFixed(0), degPerSec: rate(l, t0 + 100, t0 + 700), slideKmh: slide(l, t0, t0 + 700), latAcc: latAcc(l, t0 + 100, t0 + 700) });
    R.b[name] = { dirtFrame: dirtIn?.fr, wetOnDirt: dirtIn && fmt(dirtIn.wet), msToDryOnDirt: dried ? dried.fr - dirtIn.fr : null, techFrame: tech?.fr, mudOnTech: tech && fmt(tech.mud), gripOnTech: tech && fmt(tech.grip), gripTech1s: fmt(pr.find((q) => q.fr >= tech.fr + 1000).grip), msToMudUnder0_05: worn ? worn.fr - tech.fr : null, lockOnTech: lock, timeline: tl(pr, (dirtIn?.fr ?? 0) - 250, tech.fr + 3000, ['wet', 'mud', 'grip']) };
    console.log('(b) ' + name + ' -> dirt -> tech', JSON.stringify(R.b[name]));
  }

  // (c1) Water, then wood: full right lock 150 ms after the water, against dry wood and platform ice at about the same speed.
  R.c1 = {};
  if (!only || only.includes('c1')) for (const slow of [false, true]) for (const [name0, start, mid, rest] of [['wetWood', 'WoodStartPlat', W3, 'WoodPlatBase'], ['dryWood', 'WoodStartPlat', Array(3).fill('WoodPlatBase'), 'WoodPlatBase'], ['ice', 'WoodStartPlat', Array(3).fill('WoodPlatBase'), 'IcePlatBase']]) {
    const name = name0 + (slow ? '@slow' : ''), pre = slow ? [] : ['WoodPlatBase'], k0 = pre.length + 4;
    const P = widen(lane([start, ...pre, ...mid, ...Array(12).fill(rest)]), k0);
    const r0 = await run(P, { trace: 10 }, [{ id: 1, rec: { up: [0] }, frames: 6000 }]), at = first(r0[1], (q) => q.z < -k0 * 20 + 10);
    const t0 = at + 150, r = await run(P, { trace: 10 }, [{ id: 2, rec: { up: [0], right: [t0, t0 + 800] }, frames: t0 + 1200 }]), l = r[2];
    const pq = r.probes.find((q) => q.fr >= t0);
    R.c1[name] = { kmh: +l[t0].v.toFixed(0), wet: fmt(pq.wet), grip: fmt(pq.grip), degPerSec: rate(l, t0 + 100, t0 + 800), slideKmh: slide(l, t0, t0 + 800), latAcc: latAcc(l, t0 + 100, t0 + 800), kmhEnd: +l[t0 + 800].v.toFixed(0) };
    console.log('(c1)', name, JSON.stringify(R.c1[name]));
  }

  // (c2) Water, then tech: rolling straight, a full-lock drift, hard braking. Wetness over time, and how hot the tyres ran.
  R.c2 = {};
  if (!only || only.includes('c2')) {
    const P = widen(lane(['WoodStartPlat', 'WoodPlatBase', ...W3, ...Array(16).fill('Plane')]), 5);
    const r0 = await run(P, null, [{ id: 1, rec: { up: [0] }, frames: 6000 }]), at = first(r0[1], (q) => q.z < -5 * 20 + 10) + 100;
    for (const [name, rec] of [['rolling', { up: [0] }], ['drift', { up: [0], right: [at] }], ['brake', { up: [0, at], down: [at] }], ['burnout', { up: [0, at], down: [at, at + 1500], left: [at + 1500] }]]) {
      const r = await run(P, { trace: 10 }, [{ id: 1, rec, frames: at + 3000 }]), pr = r.probes, l = r[1];
      const w0 = pr.find((q) => q.fr >= at), dry = pr.find((q) => q.fr >= at && mx(q.wet) < 0.05);
      let minSkid = 1, n = 0, hot = 0;
      for (let k = at; k < at + 2000; k++) { minSkid = Math.min(minSkid, l[k].sk); if (l[k].sk < 0.9) hot++; n++; }
      R.c2[name] = { kmhAt: +l[at].v.toFixed(0), wetAt: fmt(w0.wet), wet1s: fmt(pr.find((q) => q.fr >= at + 1000).wet), wet2s: fmt(pr.find((q) => q.fr >= at + 2000).wet), msToDry: dry ? dry.fr - at : '>' + (pr[pr.length - 1].fr - at), minSkid: +minSkid.toFixed(2), framesSkidUnder0_9: hot + '/' + n, kmhEnd: +l[at + 2000].v.toFixed(0) };
      console.log('(c2)', name, JSON.stringify(R.c2[name]));
    }
  }

  // (d) Wet tyres onto platform ice: icing builds faster than with dry tyres.
  R.d = {};
  if (!only || only.includes('d')) for (const [name, mid] of [['wet', W3], ['dry', Array(3).fill('WoodPlatBase')]]) {
    const P = lane(['WoodStartPlat', 'WoodPlatBase', ...mid, ...Array(10).fill('IcePlatBase')]);
    const r = await run(P, { trace: 10 }, [{ id: 1, rec: { up: [0] }, frames: 7000 }]), pr = r.probes;
    const on = pr.find((q) => q.fr > 300 && onAll(q, [3]));
    const half = on && pr.find((q) => q.fr >= on.fr && mean(q.ice) >= 0.5), full = on && pr.find((q) => q.fr >= on.fr && mean(q.ice) >= 0.9);
    R.d[name] = { iceFrame: on?.fr, wetOnIce: on && fmt(on.wet), msToMeanIce0_5: half ? half.fr - on.fr : null, msToMeanIce0_9: full ? full.fr - on.fr : null, timeline: on && tl(pr, on.fr, on.fr + 1500, ['wet', 'ice']) };
    console.log('(d) ' + name + ' tyres onto ice', JSON.stringify(R.d[name]));
  }

  // Respawn clears, a checkpoint keeps: muddy tyres (water then dirt) through a checkpoint, then the respawn key.
  if (!only || only.includes('cp')) {
    const P = lane(['DirtStartPlat', 'DirtPlatBase', ...W3, 'DirtPlatBase', 'DirtPlatBase', { n: 'DirtCheckpointPlat', cp: 0 }, ...Array(8).fill('Plane')]);
    const r0 = await run(P, { trace: 10 }, [{ id: 1, rec: { up: [0] }, frames: 6000 }]), cpAt = first(r0[1], (q) => q.n >= 1);
    const r = await run(P, { trace: 10 }, [{ id: 1, rec: { up: [0], reset: [cpAt + 300, cpAt + 301] }, frames: cpAt + 600 }]);
    const at = (fr) => r.probes.filter((q) => q.fr <= fr).pop();
    R.checkpoint = { cpAt, before: fmt(at(cpAt - 10).mud), after: fmt(at(cpAt + 20).mud), beforeKey: fmt(at(cpAt + 290).mud), afterKey: fmt(at(cpAt + 350).mud) };
    console.log('mud through a checkpoint, then the respawn key:', JSON.stringify(R.checkpoint));
  }
}

fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, 'tmphys_' + label + '.json');
fs.writeFileSync(file, JSON.stringify(results, null, 1));
console.log('wrote', file);
console.log(c.logs.filter((l) => !/Failed to connect|NETFAIL/.test(l)).slice(0, 10));
await c.close();
process.exit(0);
