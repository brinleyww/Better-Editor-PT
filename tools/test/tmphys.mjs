// Exact handling numbers per surface and per vehicle, measured in the game's own physics worker without realtime:
// every key press lands on the frame it was planned for, so two runs of the same plan give the same numbers.
// node tools/test/tmphys.mjs surfaces [label] [names,...]   0-100, 0-200, coast, brake, full lock, circle per surface
// node tools/test/tmphys.mjs vehicles [label]               the same table for each vehicle on five floors
// node tools/test/tmphys.mjs susp                          ride height at rest per vehicle
// node tools/test/tmphys.mjs effects [label]               bumpers, vehicle gates, wet and iced tyres
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
await c.waitFor(`[...document.querySelectorAll('button')].some(b=>b.innerText.trim()=='Exit'&&b.offsetParent)`, 90000);
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
const testOf = (u, extra = {}) => { const t = { ...(u && Object.keys(u).length ? { u } : {}), ...(SURFTRY ? { surf: SURFTRY } : {}), ...extra }; return Object.keys(t).length ? t : null; };
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
  results.ride = {};
  for (const veh of ['Stadium', 'Snow', 'Rally', 'Desert']) {
    const r = (await run(P, { vehicle: veh }, [{ id: 1, rec: {}, frames: 2500 }]))[1];
    results.ride[veh] = { y: +r[2400].y.toFixed(4), yMin: +Math.min(...r.slice(5).map((q) => q.y)).toFixed(4), yMax: +Math.max(...r.slice(5).map((q) => q.y)).toFixed(4) };
  }
  console.log('ride height at rest (2.4 s), lowest and highest while settling:', JSON.stringify(results.ride));
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
    // respawn key: back at the checkpoint as the gate's car. Car 3: respawn key before the checkpoint: back at the start
    // as the Stadium car.
    const l = await run(parts, { trace: 250 }, [{ id: 1, rec: { up: [0] }, frames: 5000 }]),
      cpAt = first(l[1], (q) => q.n >= 1), gateAt = first(l[1], (q) => q.z < -68 * 5 + 10 + 3);
    const l2 = await run(parts, { trace: 250 }, [{ id: 2, rec: { up: [0, cpAt + 300], reset: [cpAt + 600, cpAt + 601] }, frames: cpAt + 1200 }, { id: 3, rec: { up: [0], reset: [cpAt - 300, cpAt - 299] }, frames: cpAt }]);
    const vAt = (p, id, fr) => p.probes.filter((q) => q.carId == id && q.fr <= fr).pop()?.vehicle;
    const tr = { checkpointFrame: cpAt, stadiumGateFrame: gateAt, beforeCp: vAt(l, 1, cpAt - 10), afterStadiumGate: vAt(l, 1, gateAt + 300), car2AfterRespawn: vAt(l2, 2, cpAt + 1200), car2RespawnedY: +l2[2][cpAt + 1100].y.toFixed(3), car2JumpZ: [+l2[2][cpAt + 595].z.toFixed(1), +l2[2][cpAt + 615].z.toFixed(1)], car3AfterRespawnBeforeCp: vAt(l2, 3, cpAt), car3Z: [+l2[3][cpAt - 305].z.toFixed(1), +l2[3][cpAt - 290].z.toFixed(1)] };
    results.gates[car] = { trace: tr };
    console.log(car, 'gate:', JSON.stringify(tr));
  }
  // Wet tyres through shallow water and drying after; iced tyres from ice to wood, Stadium and Snow car.
  {
    const parts = L(['WoodStartRoad', ...wood(3), ...Array(3).fill('StadiumShallowWater'), ...wood(20)]);
    const l = await run(parts, { trace: 250 }, [{ id: 1, rec: { up: [0] }, frames: 9000 }]);
    results.wet = l.probes.map((q) => q.fr + ':' + q.wet.join('/'));
    console.log('wet tyres every 250 frames:', results.wet.join(' '));
  }
  for (const veh of ['Stadium', 'Snow']) {
    const parts = L(['IceStartPlat', ...Array(5).fill('IcePlatBase'), ...Array(14).fill('WoodPlatBase')]);
    const l = await run(parts, { trace: 250, vehicle: veh }, [{ id: 1, rec: { up: [0] }, frames: 8000 }]);
    results['ice_' + veh] = l.probes.map((q) => q.fr + ':' + q.ice.join('/'));
    console.log(veh, 'iced tyres every 250 frames:', results['ice_' + veh].join(' '));
  }
}

if (section == 'verify') {
  // The game's own verifier on a track with the new things: it accepts a run only if the car finishes on exactly that
  // frame. Found by an exact run first, then 21 frames round it are checked, twice.
  const L = (items) => { let z = 0; return items.map((n) => { const o = typeof n == 'string' ? { n } : { ...n }; const p = { x: 0, y: 0, z, ...o }; z -= 4; return p; }); };
  const tracks = {};
  tracks.roads = L(['WoodStartRoad', 'WoodRoadStraight', 'DirtRoadStraight', 'DirtRoadStraight', 'WoodRoadStraight', 'WoodCarRallyRoad', 'DirtRoadStraight', 'DirtRoadStraight', { n: 'WoodCheckpointRoad', cp: 0 }, 'WoodFxUltraRoad', 'WoodRoadStraight', 'WoodCarSnowRoad', 'StadiumShallowWater', 'StadiumShallowWater', 'WoodRoadStraight', 'WoodFinishRoad', 'WoodRoadStraight', 'WoodRoadStraight']);
  // Five platforms wide (checkpoint and finish across all five), so a bumper's kick lands on the floor: grass, a super bumper, dirt, the Desert gate, ice
  // (iced tyres), a checkpoint, grass again and the finish.
  const rows = ['GrassStartPlat', 'GrassPlatBase', 'WoodFxBumper2Plat', 'DirtPlatBase', 'WoodCarDesertPlat', 'IcePlatBase', 'IcePlatBase', { n: 'WoodCheckpointPlat', cp: 0 }, 'GrassPlatBase', 'GrassPlatBase', 'DirtFinishPlat', 'GrassPlatBase', 'GrassPlatBase'];
  tracks.platforms = [];
  rows.forEach((n, i) => { const o = typeof n == 'string' ? { n } : n; tracks.platforms.push({ x: 0, y: 0, z: -4 * i, ...o }); for (const x of [-8, -4, 4, 8]) tracks.platforms.push(/Checkpoint|Finish/.test(o.n) ? { ...o, x, y: 0, z: -4 * i } : { n: /Grass/.test(o.n) ? 'GrassPlatBase' : /Dirt/.test(o.n) ? 'DirtPlatBase' : /Ice/.test(o.n) ? 'IcePlatBase' : 'WoodPlatBase', x, y: 0, z: -4 * i }); });
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

fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, 'tmphys_' + label + '.json');
fs.writeFileSync(file, JSON.stringify(results, null, 1));
console.log('wrote', file);
console.log(c.logs.filter((l) => !/Failed to connect|NETFAIL/.test(l)).slice(0, 10));
await c.close();
process.exit(0);
