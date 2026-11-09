// Pipes (tools/blocks/pipes.js) driven in the game's own physics worker without realtime, like tmphys.mjs.
// node tools/test/pipes.mjs [kit] [tests]   kit Plastic or Stadium (road pipes); tests: straight,curve,wall,roll,seams,entries,verify
// LIGHT=1 runs a lighter curve test. TMPORT: the site's port (tools/test/server.js), TMCDP: Chrome's debugging port.
import { launch } from './cdp.mjs';

const kit = process.argv[2] || 'Plastic',
  want = (process.argv[3] || 'straight,curve,wall,roll,seams,entries,verify').split(',');
const hook = `(()=>{const o=Worker.prototype.postMessage;Worker.prototype.postMessage=function(m,...r){if(m&&m.trackParts&&!window.__init)window.__init=m;return o.call(this,m,...r)}})()`;
const c = await launch({ port: +(process.env.TMCDP || 9461), width: 800, height: 600 });
await c.send('Page.addScriptToEvaluateOnNewDocument', { source: hook });
await c.send('Page.navigate', { url: 'http://127.0.0.1:' + (process.env.TMPORT || 8461) + '/Better-Editor-PT/' });
await c.waitFor(`[...document.querySelectorAll('button')].some(b=>['Exit','Editor'].includes(b.innerText.trim())&&b.offsetParent)`, 300000);
await c.waitFor('!!window.__init');
// The page never needs to draw here (as in tmphys.mjs): its render loop would keep the CPU busy and starve the worker.
await c.evaluate("window.requestAnimationFrame=()=>0;window.cancelAnimationFrame=()=>{};for(const v of document.querySelectorAll('canvas'))v.style.display='none';true");
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
  window.__run=(spec)=>new Promise((res,rej)=>{
    const t=__mk(spec.parts), M=Mount.createMountainVertices(t.getBounds()), save=t.toSaveString();
    const w=new Worker('simulation_worker.bundle.js');
    const logs=new Map(); let left=spec.cars.length, done=false;
    for(const car of spec.cars) logs.set(car.id,{n:0,frames:car.frames,buf:new Float32Array(car.frames*${K})});
    const finish=()=>{done=true;w.terminate();const out={};for(const [id,L] of logs)out[id]=b64(L.buf.subarray(0,L.n*${K}));res(out);};
    w.addEventListener('error',e=>{if(!done){done=true;rej(new Error('worker: '+e.message));}});
    w.addEventListener('message',e=>{const m=e.data; if(m.messageType!=10||done)return;
      for(const b of m.carStateBuffers){const u=new Uint8Array(b), id=u[0]|u[1]<<8|u[2]<<16|u[3]<<24, L=logs.get(id); if(!L||L.n>=L.frames)continue;
        const s=VO(u.subarray(4)).carState, o=L.n*${K}, B=L.buf;
        B[o]=s.frames;B[o+1]=s.speedKmh;B[o+2]=s.position.x;B[o+3]=s.position.y;B[o+4]=s.position.z;
        B[o+5]=s.quaternion.x;B[o+6]=s.quaternion.y;B[o+7]=s.quaternion.z;B[o+8]=s.quaternion.w;
        B[o+9]=(u[4+7]>>3)&15;B[o+10]=s.nextCheckpointIndex;B[o+11]=s.finishFrames??-1;
        if(++L.n==L.frames&&--left==0)finish();}});
    w.postMessage({...window.__init,isRealtime:false});
    for(const car of spec.cars){
      w.postMessage({messageType:3,mountainVertices:M.vertices,mountainOffset:{x:M.offset.x,y:M.offset.y,z:M.offset.z},trackData:save,carId:car.id,carRecording:new Rec(car.rec).serialize()});
      w.postMessage({messageType:5,carId:car.id,targetSimulationTimeFrames:car.frames});}
    setTimeout(()=>{if(!done){done=true;w.terminate();rej(new Error('run timed out'));}},240000);
  });
  return true;
})()`);
const rec = (r = {}) => ({ up: r.up ?? [], right: r.right ?? [], down: r.down ?? [], left: r.left ?? [], reset: r.reset ?? [] });
async function run(parts, cars) {
  for (let tries = 0; ; tries++)
    try {
      const o = JSON.parse(await c.evaluate(`__run(${JSON.stringify({ parts, cars: cars.map((x) => ({ ...x, rec: rec(x.rec) })) })}).then(r=>JSON.stringify(r))`)),
        out = {};
      for (const id in o) {
        const b = Buffer.from(o[id], 'base64'),
          f = new Float32Array(b.buffer, b.byteOffset, b.length / 4),
          l = [];
        for (let i = 0; i < f.length; i += K) l.push({ f: f[i], v: f[i + 1], x: f[i + 2], y: f[i + 3], z: f[i + 4], q: [f[i + 5], f[i + 6], f[i + 7], f[i + 8]], w: f[i + 9], n: f[i + 10], fin: f[i + 11] });
        out[id] = l;
      }
      return out;
    } catch (e) {
      // Under load the worker's start can race ("Cannot access 'o' before initialization"): run it again.
      if (tries < 2 && /before initialization|timed out/.test(e.message)) continue;
      throw e;
    }
}

// ---- tracks -------------------------------------------------------------------------------------------------------------
const PRE = kit;
const T = (n) => PRE + n;
// A lane of pieces along -z from z0: each { n, len (tiles, 4 a block), r, y }.
const lane = (items, z0 = 0, x = 0) => {
  let z = z0;
  return items.map((o0) => {
    const o = typeof o0 == 'string' ? { n: o0 } : { ...o0 },
      len = o.len ?? 4;
    // A piece turned round (r 2) that is more than a block long has its origin on its far block.
    const p = { x, y: o.y ?? 0, z: o.r == 2 ? z - (len - 4) : z, n: o.n, r: o.r ?? 0, cp: o.cp };
    z -= len;
    return p;
  });
};
const rep = (n, k) => Array(k).fill(n);
// Where the car is round a straight pipe along -z (axis x = ax, y = ay): 0 on the floor, +-pi over the top.
const CY = 0.21 + 6.5667;
const around = (s, ax = 0, ay = CY) => Math.atan2(s.x - ax, -(s.y - ay));
const unwrap = (a) => { const o = [a[0]]; for (let i = 1; i < a.length; i++) { let d = a[i] - a[i - 1]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; o.push(o[i - 1] + d); } return o; };
const deg = (r) => +(r * 57.2958).toFixed(0);
// Up vector of the car from its quaternion.
const upOf = (q) => [2 * (q[0] * q[1] - q[3] * q[2]), 1 - 2 * (q[0] * q[0] + q[2] * q[2]), 2 * (q[1] * q[2] + q[3] * q[0])];
// The biggest speed loss over any 100 ms, km/h, and frames with no wheel on the ground, between frames a and b.
const losses = (l, a = 0, b = l.length) => {
  let worst = 0, air = 0;
  for (let i = Math.max(a, 100); i < Math.min(b, l.length); i++) {
    worst = Math.max(worst, l[i - 100].v - l[i].v);
    if (l[i].w == 0) air++;
  }
  return { drop100ms: +worst.toFixed(1), airMs: air };
};
const results = {};
const log = (k, v) => { results[k] = v; console.log(k, JSON.stringify(v)); };

// Run-up on the stock road, the road curling into the pipe, then pipe. turnAt: where the pipe part starts (tiles).
const runup = (n) => ['Start', ...rep('Straight', n), { n: T('TubeFromRoad'), len: 8 }];
// Frames at which a car on full throttle down this lane reaches each speed.
async function speedFrames(parts, speeds, frames = 16000) {
  const l = (await run(parts, [{ id: 1, rec: { up: [0] }, frames }]))[1];
  return Object.fromEntries(speeds.map((v) => [v, l.findIndex((s) => s.v >= v)]));
}

if (want.includes('straight')) {
  // Full throttle down a long pipe from the road: speed, wheels on the floor, how far off the middle.
  const parts = lane([...runup(3), ...rep(T('TubeStraight'), 30), { n: T('TubeStraightX4'), len: 16 }, ...rep(T('TubeStraightX2'), 0)]);
  const l = (await run(parts, [{ id: 1, rec: { up: [0] }, frames: 9000 }]))[1];
  const inPipe = l.filter((s) => s.z < -5 * 20 - 40 && s.z > -5 * (20 + 4 * 30));
  log('straight', { kmhEnd: +l[l.length - 1].v.toFixed(0), maxOffMiddle: +Math.max(...inPipe.map((s) => Math.abs(s.x))).toFixed(2), maxRise: +Math.max(...inPipe.map((s) => s.y)).toFixed(2), ...losses(l, 1000) });
}

// Full throttle down this lane: the first frame each test holds (pred(state) true), or -1.
async function frameWhen(parts, pred, frames = 20000) {
  const l = (await run(parts, [{ id: 1, rec: { up: [0] }, frames }]))[1];
  return l.findIndex(pred);
}
// The pipe after a short road: speeds are reached inside it.
const intoPipe = (n) => [...runup(2), ...rep(T('TubeStraightX4'), n).map((x) => ({ n: x, len: 16 }))];
const PIPE0 = -4 * 3 - 8; // tiles: where the pipe starts after runup(2)

if (want.includes('curve')) {
  // Into a curve at a set speed, hands off: the outer wall carries the car round. The gas comes off when the speed is
  // reached, 20 to 100 units before the curve (whole pieces). up: how far up the outer wall the car rides (deg, 90 = the side wall).
  // LIGHT=1: one curve at two speeds, coasting.
  const light = !!process.env.LIGHT;
  for (const [curve, r] of light ? [['TubeCurve3', 50]] : [['TubeCurve2', 30], ['TubeCurve3', 50], ['TubeCurve4', 70]])
    for (const [kmh, gas] of light ? [[150, false], [250, false]] : [[150, false], [150, true], [250, false], [250, true]]) {
      const long = intoPipe(30),
        F = await frameWhen(lane(long), (q) => q.v >= kmh);
      if (F < 0) { log('curve ' + curve + ' ' + kmh, { reached: false }); continue; }
      const zF = (await run(lane(long), [{ id: 1, rec: { up: [0] }, frames: F + 1 }]))[1][F].z;
      // Whole X4 pieces up to past zF + 60, then the curve, then straights heading +x.
      const n = Math.ceil((-zF + 20 + PIPE0 * 5) / 80),
        parts = lane([...intoPipe(n), { n: T(curve), len: 4 }]),
        zc = parts[parts.length - 1].z * 5 + 10, // the curve's entry edge (units)
        cx = r, cz = zc;
      // After the curve: straights heading +x, their entry edge at the curve's exit (x = r, z = zc - r).
      for (let k = 0; k < 12; k++) parts.push({ n: T('TubeStraight'), x: (r + 10 + 20 * k) / 5, y: 0, z: (zc - r) / 5, r: 3 });
      const l = (await run(parts, [{ id: 1, rec: { up: gas ? [0] : [0, F] }, frames: F + 6000 }]))[1];
      if (process.env.TRACE) console.log(l.filter((_, i) => i > F && i % 200 == 0).map((q) => [q.x, q.y, q.z, q.v].map((v) => v.toFixed(1)).join(',') + ',' + q.w).join(' | '));
      const seg = l.filter((q, i) => i > F && q.z < zc && q.x < cx);
      const ang = seg.map((q) => Math.atan2(r - Math.hypot(q.x - cx, q.z - cz), -(q.y - CY)));
      const e = l[l.length - 1];
      log('curve ' + curve + ' ' + kmh + (gas ? ' gas held' : ' coasting'), { entryKmh: +l[F].v.toFixed(0), kmhIn: +(seg[0]?.v ?? 0).toFixed(0), upOuterWall: deg(Math.max(...ang.map((a) => -a))), exitX: +e.x.toFixed(0), exitZ: +e.z.toFixed(0), exitY: +e.y.toFixed(1), endKmh: +e.v.toFixed(0), out: e.x > cx + 40 && Math.abs(e.z - (cz - r)) < 7 && e.y < CY + 7, ...losses(l, F, F + 6000) });
    }
}

// Steering on a straight pipe at speed: how far round the car rides, and whether it lands back on its wheels.
async function steerTest(name, kmh, holdMs, side = 'right') {
  const parts = lane(intoPipe(30)),
    go = await frameWhen(parts, (q) => q.v >= kmh, 30000);
  if (go < 0) return log(name, { reached: false });
  const l = (await run(parts, [{ id: 1, rec: { up: [0], [side]: [go, go + holdMs] }, frames: go + 5000 }]))[1];
  const a = unwrap(l.slice(go).map((s) => around(s))),
    maxA = Math.max(...a.map(Math.abs)),
    e = l[l.length - 1],
    up = upOf(e.q),
    // facing the tube's axis: the car's up against the way from it to the axis
    ax = [-e.x, CY - e.y], al = Math.hypot(...ax) || 1;
  log(name, { kmh, holdMs, maxRoundDeg: deg(maxA), turns: +(maxA / (2 * Math.PI)).toFixed(2), endRoundDeg: deg(a[a.length - 1]), onWheels: (up[0] * ax[0] + up[1] * ax[1]) / al > 0.9, endKmh: +e.v.toFixed(0), ...losses(l, go, go + 5000) });
}
if (want.includes('wall')) {
  for (const kmh of [150, 250]) for (const hold of [150, 300]) await steerTest('wall ride ' + kmh + ' km/h, steer ' + hold + ' ms', kmh, hold);
}
if (want.includes('roll')) {
  for (const kmh of [200, 250, 300]) for (const hold of [500, 800, 1500]) await steerTest('barrel roll ' + kmh + ' km/h, steer ' + hold + ' ms', kmh, hold);
}

if (want.includes('seams')) {
  // The same drive (full throttle, a steer that sends the car up the wall and round) through one-block pieces and
  // through four-block ones: the inside is the same surface, only the joints differ. A seam the car catches shows as a
  // speed loss or a different path.
  const runs = {};
  let go = null;
  for (const [name, piece, len] of [['x4', 'TubeStraightX4', 16], ['x1', 'TubeStraight', 4], ['x2', 'TubeStraightX2', 8], ['half', 'TubeHalf', 2]]) {
    const parts = lane([...runup(2), ...rep(T(piece), Math.ceil(480 / len)).map((n) => ({ n, len }))]);
    // The steer starts 60 units into the pipe (found on the four-block run, the same frame for every run).
    if (go == null) go = (await run(parts, [{ id: 1, rec: { up: [0] }, frames: 9000 }]))[1].findIndex((q) => q.z < -160);
    const l = (await run(parts, [{ id: 1, rec: { up: [0], right: [go, go + 350] }, frames: go + 5000 }]))[1];
    runs[name] = l;
    if (process.env.TRACE) console.log(name, l.filter((_, i) => i % 250 == 0).map((q) => [q.x, q.y, q.z, q.v].map((v) => v.toFixed(1)).join(',') + ',' + q.w).join(' | '));
  }
  const ref = runs.x4;
  for (const k of Object.keys(runs)) {
    const l = runs[k];
    let dev = 0;
    for (let i = 0; i < Math.min(l.length, ref.length); i++) dev = Math.max(dev, Math.hypot(l[i].x - ref[i].x, l[i].y - ref[i].y, l[i].z - ref[i].z));
    const a = unwrap(l.slice(go).map((s) => around(s)));
    log('seams ' + k, { steerAt: go, maxDevFromX4: +dev.toFixed(2), maxRoundDeg: deg(Math.max(...a.map(Math.abs))), endKmh: +l[l.length - 1].v.toFixed(0), ...losses(l, go - 500) });
  }
}

if (want.includes('entries')) {
  // Road -> pipe -> road, platform -> pipe -> platform, open road -> pipe -> open road, road -> open pipe -> road, and
  // open pipe -> pipe: full throttle, then the same with the car up on the wall when it reaches the exit.
  const R = (n, len = 4, r = 0) => ({ n, len, r });
  const cases = {
    road: [['Start', ...rep('Straight', 4)], R(T('TubeFromRoad'), 8), [R(T('TubeFromRoad'), 8, 2)], rep('Straight', 10)],
    open: [['Start', ...rep('Straight', 3), PRE == 'Stadium' ? 'Straight' : 'PlasticRoadToOpen', ...rep(PRE == 'Stadium' ? 'Straight' : 'PlasticOpenStraight', 0)], R(T('TubeFromOpen'), 8), [R(T('TubeFromOpen'), 8, 2)], rep(PRE == 'Stadium' ? 'Straight' : 'PlasticOpenStraight', 10)],
    plat: [['PlasticStartPlat', ...rep('PlasticPlatBase', 4)], R(T('TubeFromPlat'), 8), [R(T('TubeFromPlat'), 8, 2)], rep('PlasticPlatBase', 10)],
    openPipe: [['Start', ...rep('Straight', 4)], R(T('TubeOpenFromRoad'), 4), [...rep(T('TubeOpen'), 3), R(T('TubeOpenToTube'), 8), ...rep(T('TubeStraight'), 3), R(T('TubeOpenToTube'), 8, 2), ...rep(T('TubeOpen'), 2), R(T('TubeOpenFromRoad'), 4, 2)], rep('Straight', 10)],
  };
  for (const [name, [pre, inn, out, post]] of Object.entries(cases)) {
    const parts = lane([...pre, inn, ...rep(T('TubeStraight'), 6), ...out, ...post]);
    // The steer starts 2 blocks into the pipe (up the wall through the exit) and 4 blocks in (still up there at the exit).
    const zin = (parts.find((p) => p.n == inn.n).z - inn.len) * 5;
    const f2 = await frameWhen(parts, (q) => q.z < zin - 40), f4 = await frameWhen(parts, (q) => q.z < zin - 80);
    for (const [how, r] of [['straight', { up: [0] }], ['wall', { up: [0], right: [f2, f2 + 300] }], ['wall late', { up: [0], left: [f4, f4 + 250] }]]) {
      const l = (await run(parts, [{ id: 1, rec: r, frames: f4 + 4000 }]))[1], e = l[l.length - 1];
      if (process.env.TRACE && how != 'straight') console.log(name, how, r, l.filter((_, i) => i % 200 == 0).map((q) => [q.x, q.y, q.z, q.v].map((v) => v.toFixed(1)).join(',') + ',' + q.w).join(' | '));
      log('entries ' + name + ' ' + how, { endKmh: +e.v.toFixed(0), endX: +e.x.toFixed(1), endY: +e.y.toFixed(2), endZ: +e.z.toFixed(0), upright: upOf(e.q)[1] > 0.9, maxY: +Math.max(...l.map((s) => s.y)).toFixed(1), ...losses(l, 300) });
    }
  }
}

if (want.includes('verify')) {
  // The game's verifier on a pipe track: road in, a checkpoint in the pipe, a curve, the finish in the pipe.
  const parts = lane(['Start', ...rep('Straight', 3), { n: T('TubeFromRoad'), len: 8 }, T('TubeStraight'), { n: T('TubeCheckpoint'), cp: 0 }, T('TubeFxTurbo'), T('TubeStraight'), T('TubeFinish'), T('TubeStraight'), T('TubeEnd')]);
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
  log('verify pipe track', JSON.parse(fins));
}
console.log(c.logs.filter((l) => !/Failed to connect|NETFAIL|favicon/.test(l)).slice(0, 8));
await c.close();
process.exit(0);
