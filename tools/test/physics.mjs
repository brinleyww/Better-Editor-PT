// Drives real cars in the game's physics worker. No rendering, no UI.
// node tools/test/physics.mjs surfaces   handling numbers for stock, plastic and wood
// node tools/test/physics.mjs regress    gates, turbo, climbs, loops, verifier
import { openEditor } from './lib.mjs';
const section = process.argv[2] || 'surfaces';
const hook = `(()=>{const o=Worker.prototype.postMessage;Worker.prototype.postMessage=function(m,...r){if(m&&m.trackParts&&!window.__init)window.__init=m;return o.call(this,m,...r)}})()`;
const c = await openEditor(9337, 800, 600, hook);
await c.waitFor('!!window.__init');
await c.evaluate(`(()=>{
  window.webpackChunk.push([[Symbol()],{},r=>window.__req=r]);
  const req=window.__req, TD=req(9117).A, Sun=req(7929).A, Mount=req(6421).A, VO=req(3899).VO, P=req(494).A;
  window.__mk=(parts)=>{const t=new TD(1,new Sun(0));
    for(const p of parts){const id=typeof p.n=='number'?p.n:P[p.n]; if(id==null)throw new Error('no part '+p.n);
      const def=req(2600).Hw(id);
      t.addPart(p.x,p.y,p.z,id,p.r||0,p.a||0,0,def.detector&&def.detector.type==0?(p.cp??0):null,def.startOffset?(p.so??0):null);}
    return t;};
  // plan = [{frame, ctl}], applied when the simulation reaches that frame, so build time cannot shift a test.
  window.__drive=(parts,frames,ctl,plan)=>new Promise((res,rej)=>{
    const t=__mk(parts); const w=new Worker('simulation_worker.bundle.js'); const log=[]; let done=false,trigger=null,lastKey=null; const todo=(plan||[]).slice();
    const send=(c)=>w.postMessage({messageType:6,carId:1,up:!!c.up,right:!!c.right,down:!!c.down,left:!!c.left,reset:!!c.reset});
    w.addEventListener('error',e=>{if(!done){done=true;rej(new Error('worker: '+e.message));}});
    w.addEventListener('message',e=>{const m=e.data; if(m.messageType!=10||done)return;
      for(const b of m.carStateBuffers){const s=VO(new Uint8Array(b).subarray(4)).carState;
        log.push({f:s.frames,v:s.speedKmh,x:s.position.x,y:s.position.y,z:s.position.z,n:s.nextCheckpointIndex,fin:s.finishFrames,q:[s.quaternion.x,s.quaternion.y,s.quaternion.z,s.quaternion.w],sk:Math.min(...s.wheelSkidInfo)});
        if(window.__ctrl){const k=window.__ctrl(s),key=JSON.stringify(k);if(key!=lastKey){lastKey=key;send(k);}}
        while(todo.length){const q=todo[0];if(q.kmh!=null){if(s.speedKmh<q.kmh)break;trigger=s.frames;window.__trigger=trigger;}else if(q.cp!=null){if(s.nextCheckpointIndex<q.cp)break;trigger=s.frames;window.__trigger=trigger;}else if(trigger==null||s.frames<trigger+q.after)break;send(q.ctl);todo.shift();}
        if(s.frames>=frames){done=true;w.terminate();res(log);return;}
      }});
    setTimeout(()=>w.postMessage({...window.__init,isRealtime:true}),1500);
    setTimeout(()=>{const M=Mount.createMountainVertices(t.getBounds());
      w.postMessage({messageType:3,mountainVertices:M.vertices,mountainOffset:{x:M.offset.x,y:M.offset.y,z:M.offset.z},trackData:t.toSaveString(),carId:1,carRecording:null});
      w.postMessage({messageType:5,carId:1,targetSimulationTimeFrames:null});send(ctl);
    },2200);
    setTimeout(()=>{if(!done){done=true;w.terminate();rej(new Error('drive timed out'));}},frames+60000);
  });
  return true;
})()`);
const drive = async (parts, frames, ctl = { up: true }, plan = []) => JSON.parse(await c.evaluate(`__drive(${JSON.stringify(parts)},${frames},${JSON.stringify(ctl)},${JSON.stringify(plan)}).then(l=>JSON.stringify(l.filter((_,i)=>i%5==0||i==l.length-1)))`));
const last = (l) => l[l.length - 1];
const at = (l, f) => l.reduce((a, b) => (Math.abs(b.f - f) < Math.abs(a.f - f) ? b : a));
const report = (name, v) => console.log(name, JSON.stringify(v));
const lane = (items, x = 0, y = 0, z0 = 0) => { let z = z0; return items.map((n) => { const o = typeof n == 'string' ? { n } : { ...n }; const p = { x, y: o.y ?? y, z, ...o }; z -= o.len ?? 4; return p; }); };

if (section == 'surfaces') {
  const floor = (start, piece, n = 22) => { const p = [{ n: start, x: 0, y: 0, z: 0 }]; for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) if (i || j) p.push({ n: piece, x: i * 4, y: 0, z: j * 4 }); return p; };
  const SURF = [['stock', 'PlaneStart', 'Plane'], ['plastic', 'PlasticStartPlat', 'PlasticPlatBase'], ['wood', 'WoodStartPlat', 'WoodPlatBase'], ['ice', 'IceStartPlat', 'IcePlatBase']];
  const nose = (q) => [2 * (q[0] * q[2] + q[3] * q[1]), 1 - 2 * (q[0] * q[0] + q[1] * q[1])];
  // How fast the rear axle moves sideways, km/h: zero when the tyres hold, large in a slide.
  const slide = (l, from, to) => { let max = 0; for (let i = 1; i < l.length; i++) { const a = l[i - 1], b = l[i]; if (b.f < from || b.f > to) continue; const dt = (b.f - a.f) / 1000; if (dt <= 0) continue; const [ax, az] = nose(a.q), [bx, bz] = nose(b.q); const vx = (b.x - bx * 1.36 - (a.x - ax * 1.36)) / dt, vz = (b.z - bz * 1.36 - (a.z - az * 1.36)) / dt; max = Math.max(max, Math.abs(vx * bz - vz * bx) * 3.6); } return +max.toFixed(1); };
  const heading = (q) => { const [x, z] = nose(q); return Math.atan2(x, z); };
  const rate = (l, from, to) => { const A = at(l, from), B = at(l, to); let d = heading(B.q) - heading(A.q); while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return +Math.abs((d * 57.3) / ((B.f - A.f) / 1000)).toFixed(0); };
  const skidShare = (l, from, to) => { const m = l.filter((s) => s.f >= from && s.f <= to); return +(m.filter((s) => s.sk < 0.99).length / Math.max(1, m.length)).toFixed(2); };
  const only = process.argv[3];
  for (const [name, start, piece] of SURF) {
    if (only && only != name) continue;
    const P = floor(start, piece), row = {};
    let l = await drive(P, 4200);
    // Timed from the first moving frame: a heavy track delays the first key press by its build time.
    const moved = l.find((s) => s.v > 0.5)?.f ?? 0;
    row.ms0to100 = l.find((s) => s.v >= 100)?.f - moved; row.ms0to200 = l.find((s) => s.v >= 200)?.f - moved;
    for (const kmh of [80, 140]) {
      l = await drive(P, 4800, { up: true }, [{ kmh, ctl: { up: true, right: true } }]);
      const t = await c.evaluate('window.__trigger');
      row['lock' + kmh] = { degPerSec: rate(l, t + 300, t + 1000), slideKmh: slide(l, t, t + 1200), skid: skidShare(l, t, t + 1200), endKmh: +at(l, t + 1200).v.toFixed(0) };
    }
    l = await drive(P, 4800, { up: true }, [{ kmh: 120, ctl: { right: true, down: true } }, { after: 350, ctl: { up: true, right: true } }]);
    let t = await c.evaluate('window.__trigger');
    row.brakeDrift120 = { slideKmh: slide(l, t, t + 1500), skid: skidShare(l, t, t + 1500), endKmh: +at(l, t + 1500).v.toFixed(0) };
    l = await drive(P, 7000, { up: true }, [{ kmh: 230, ctl: { right: true, down: true } }, { after: 300, ctl: { up: true, right: true } }]);
    t = await c.evaluate('window.__trigger');
    row.brakeDrift230 = { atFrame: t, slideKmh: slide(l, t, t + 1500), skid: skidShare(l, t, t + 1500), endKmh: +at(l, t + 1500).v.toFixed(0), rate: rate(l, t + 100, t + 800) };
    l = await drive(P, 5500, { up: true }, [{ kmh: 120, ctl: { down: true } }]);
    t = await c.evaluate('window.__trigger');
    const b0 = at(l, t), stop = l.find((s) => s.f > b0.f && s.v < 1);
    row.brake120 = { ms: stop ? stop.f - b0.f : null, dist: stop ? +Math.hypot(stop.x - b0.x, stop.z - b0.z).toFixed(1) : null };
    report(name, row);
  }
  // Drops: the car falls from the air onto a floor, landing on its roof or its side.
  for (const [how, axis] of [['roof', 1], ['side', 2]])
    for (const [name, start, piece] of SURF.slice(1)) {
      if (only && only != name) continue;
      const parts = [{ n: 'PlaneStart', x: 0, y: 5, z: 0, a: axis }]; for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) parts.push({ n: piece, x: i * 4, y: 0, z: j * 4 });
      const l = await drive(parts, 12000, {});
      let hit = -1; for (let i = 2; i < l.length; i++) if (l[i - 1].y < 4 && l[i].y > l[i - 1].y + 1e-3) { hit = i; break; }
      let rebound = 0; if (hit > 0) for (let i = hit; i < l.length; i++) rebound = Math.max(rebound, l[i].y);
      // How far the car turns, in degrees, in the 0.7 s after the hit: a clean bounce keeps it near 0.
      let spinDeg = null;
      if (hit > 0) { const a = l[hit - 1].q, b = at(l, l[hit].f + 700).q; spinDeg = +((2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])))) * 180 / Math.PI).toFixed(1); }
      // Every peak after the first hit, so a bounce that gains height each time shows up.
      const peaks = []; for (let i = Math.max(hit, 1); hit > 0 && i + 1 < l.length; i++) if (l[i].y > l[i - 1].y && l[i].y >= l[i + 1].y && l[i].y > 2) peaks.push(+l[i].y.toFixed(1));
      report(how + ' drop on ' + name, { fromY: +l[0].y.toFixed(1), impactAtY: hit > 0 ? +l[hit].y.toFixed(2) : null, reboundToY: hit > 0 ? +rebound.toFixed(2) : null, spinDeg, peaks });
    }
}

if (section == 'regress') {
  {
    const parts = lane(['WoodStartRoad', ...Array(6).fill('WoodRoadStraight'), 'PlasticCheckpointRoad', ...Array(6).fill('PlasticRoadStraight'), { n: 'WoodCheckpointOpen', cp: 1 }, ...Array(4).fill('PlasticOpenStraight'), 'PlasticFinishRoad', ...Array(4).fill('PlasticRoadStraight')]);
    const l = await drive(parts, 9000);
    report('Gates', { checkpoints: Math.max(...l.map((s) => s.n)), finishFrame: l.find((s) => s.fin != null)?.fin ?? null });
  }
  {
    const run = (p) => drive(lane(['WoodStartRoad', ...Array(5).fill('WoodRoadStraight'), p, ...Array(40).fill('WoodRoadStraight')]), 5000);
    const a = await run('WoodRoadStraight'), b = await run('WoodFxTurboRoad'), e = await run('WoodFxSuperRoad');
    report('Turbo km/h at 4.5 s', { plain: +at(a, 4500).v.toFixed(0), turbo: +at(b, 4500).v.toFixed(0), superTurbo: +at(e, 4500).v.toFixed(0) });
  }
  // Climb pieces, and stock slopes joined directly to new ones. Reads after the crest jump has landed.
  const climbs = [
    ['Gentle, wood platform', [['WoodPlatGentleStart', 8, 1], ['WoodPlatGentleStraight', 4, 1], ['WoodPlatGentleEnd', 8, 1]], 'WoodPlatBase', 'WoodStartPlat', 'WoodPlatBase'],
    ['Medium, plastic road', [['PlasticRoadMediumStart', 4, 1], ['PlasticRoadMediumStraight', 4, 2], ['PlasticRoadMediumEnd', 4, 1]], 'PlasticRoadStraight', 'PlasticStartRoad', 'PlasticRoadStraight'],
    ['Steep, wood open', [['WoodOpenSteepStart', 8, 4], ['WoodOpenSteepStraight', 4, 4], ['WoodOpenSteepEnd', 8, 4]], 'WoodOpenStraight', 'WoodStartOpen', 'WoodOpenStraight'],
    ['Stock and new mixed', [['SlopeUp', 4, 1], ['PlasticRoadMediumStraight', 4, 2], ['Slope', 4, 2], ['WoodRoadMediumStraight', 4, 2], ['Slope', 4, 2], ['PlasticRoadMediumEnd', 4, 1]], 'Straight', 'Start', 'Straight'],
  ];
  for (const [name, seq, after, start, runup] of climbs) {
    let y = 0, z = -32; const parts = lane([start, ...Array(7).fill(runup)]);
    for (const [n, len, rise] of seq) { parts.push({ n, x: 0, y, z }); z -= len; y += rise; }
    for (let k = 0; k < 70; k++) { parts.push({ n: after, x: 0, y, z }); z -= 4; }
    const l = await drive(parts, 11000), e = last(l);
    report('Climb ' + name, { topY: y * 5, endY: +e.y.toFixed(2), kmh: +e.v.toFixed(0), landedLevel: Math.abs(e.y - y * 5 - 0.33) < 0.25 });
  }
  const RUNS = [[20, 8, 8000], [40, 14, 11000], [60, 20, 14000]];
  // Offset loops with a simple steering bot that follows the sideways shift.
  for (const surface of ['Plastic', 'Wood'].filter((s) => !process.argv[3] || s == process.argv[3]))
    for (const [r, run, ms] of RUNS) {
      const block = r / 20, yq = r / 5, z0 = -run * 4, name = (q) => surface + 'RoadLoop' + r + 'OffsetRQ' + q, zc = z0 * 5 + 10;
      const parts = lane([surface + 'StartRoad', ...Array(run - 1).fill(surface + 'RoadStraight')]);
      parts.push({ n: name(1), x: 0, y: 0, z: z0 }, { n: name(2), x: 0, y: yq, z: z0 }, { n: name(3), x: 0, y: yq, z: z0 + block * 4 }, { n: name(4), x: 0, y: 0, z: z0 + block * 4 });
      let z = z0; for (let k = 0; k < 40; k++) { parts.push({ n: surface + 'RoadStraight', x: 4, y: 0, z }); z -= 4; }
      await c.evaluate(`(()=>{let started=false,best=0;window.__ctrl=(s)=>{const zc=${zc},r=${r};if(!started&&s.y>1.5&&s.z<zc)started=true;let tgt=0;if(started){let a=Math.atan2(zc-s.z,r-s.y);if(a<-0.5)a+=2*Math.PI;best=Math.max(best,a);tgt=Math.min(20,20*best/(2*Math.PI));}const e=s.x-tgt;return {up:true,right:e<-0.6,left:e>0.6};};return 0})()`);
      const l = await drive(parts, ms), peak = l.reduce((a, b) => Math.max(a, b.y), 0), e = last(l);
      await c.evaluate('window.__ctrl=null;0');
      report(surface + ' offset loop radius ' + r + ', steered', { peakY: +peak.toFixed(1), top: 2 * r, endX: +e.x.toFixed(1), endY: +e.y.toFixed(2), kmh: +e.v.toFixed(0), finishedOnExitLane: Math.abs(e.x - 20) < 7 && e.y < 3 });
    }
  // Determinism through the game's own verifier: it accepts a run only if the car finishes on exactly that frame.
  {
    // node tools/test/physics.mjs verify [stock|ice]: stock checks the test rig itself on a track with no new blocks.
    const parts =
      process.argv[3] == 'stock'
        ? lane(['Start', ...Array(15).fill('Straight'), 'Checkpoint', ...Array(10).fill('Straight'), 'Finish', ...Array(6).fill('Straight')])
        : process.argv[3] == 'ice'
          ? lane(['IceStartBob', ...Array(6).fill('IceBobStraight'), 'IceCheckpointBob', ...Array(4).fill('IceBobStraight'), 'IceBobToPlatShort', ...Array(4).fill('IcePlatBase'), 'IceFinishPlat', ...Array(4).fill('IcePlatBase')])
          : lane(['WoodStartRoad', ...Array(5).fill('WoodRoadStraight'), 'PlasticFxTurboRoad', ...Array(10).fill('PlasticRoadStraight'), 'WoodCheckpointRoad', ...Array(10).fill('PlasticRoadStraight'), 'PlasticFinishRoad', ...Array(6).fill('PlasticRoadStraight')]);
    // The realtime car starts late by however long the track took to build, so the search window is moved back by
    // the frame the car first moved on.
    const l = await drive(parts, 9000), fin = l.find((s) => s.fin != null)?.fin, moved = l.find((s) => s.v > 0.5)?.f ?? 0, est = fin - moved;
    const found = await c.evaluate(`(async()=>{
      const Rec=__req(1754).A,t=__mk(${JSON.stringify(parts)}),M=__req(6421).A.createMountainVertices(t.getBounds()),rec=new Rec({up:[0],right:[],down:[],left:[],reset:[]}).serialize();
      const scan=()=>new Promise(res=>{const w=new Worker('simulation_worker.bundle.js'),hits=[];let pend=0;const lo=${est}-150,hi=${est}+150;
        w.addEventListener('message',e=>{if(e.data.messageType!=8)return;if(e.data.result)hits.push(e.data.carId+lo);if(--pend==0){w.terminate();res(hits);}});
        setTimeout(()=>{w.postMessage({...window.__init,isRealtime:false});
          for(let f=lo;f<=hi;f++){pend++;w.postMessage({messageType:1,mountainVertices:M.vertices,mountainOffset:{x:M.offset.x,y:M.offset.y,z:M.offset.z},trackData:t.toSaveString(),carId:f-lo,carRecording:rec,targetFrames:f});}
        },1500);});
      return JSON.stringify({a:await scan(),b:await scan()});
    })()`);
    report('Verifier accepts one exact frame, twice (realtime finish ' + fin + ', first moved ' + moved + ')', JSON.parse(found));
  }
}
if (section == 'trace') {
  const surface = process.argv[3] || 'Plastic', r = +(process.argv[4] || 40), run = r == 20 ? 8 : r == 40 ? 14 : 20, ms = 12000;
  const block = r / 20, yq = r / 5, z0 = -run * 4, name = (q) => surface + 'RoadLoop' + r + 'OffsetRQ' + q, zc = z0 * 5 + 10;
  const parts = lane([surface + 'StartRoad', ...Array(run - 1).fill(surface + 'RoadStraight')]);
  parts.push({ n: name(1), x: 0, y: 0, z: z0 }, { n: name(2), x: 0, y: yq, z: z0 }, { n: name(3), x: 0, y: yq, z: z0 + block * 4 }, { n: name(4), x: 0, y: 0, z: z0 + block * 4 });
  if (process.argv[5] == 'bot') await c.evaluate(`(()=>{let started=false,best=0;window.__ctrl=(s)=>{const zc=${zc},r=${r};if(!started&&s.y>1.5&&s.z<zc)started=true;let tgt=0;if(started){let a=Math.atan2(zc-s.z,r-s.y);if(a<-0.5)a+=2*Math.PI;best=Math.max(best,a);tgt=Math.min(20,20*best/(2*Math.PI));}const e=s.x-tgt;s.tgt=tgt;return {up:true,right:e<-2,left:e>2};};return 0})()`);
  const l = await drive(parts, ms);
  const first = l.findIndex((s) => s.y > 1);
  for (let i = first + 150; i < l.length && i < first + 520; i += 8) { const s = l[i], q = s.q, upy = 1 - 2 * (q[0] * q[0] + q[2] * q[2]), fx = 2 * (q[0] * q[2] + q[3] * q[1]); console.log(s.f, 'kmh', s.v.toFixed(0), 'x', s.x.toFixed(2), 'y', s.y.toFixed(2), 'z', s.z.toFixed(1), 'skid', s.sk.toFixed(2), 'noseX', fx.toFixed(3), 'upY', upy.toFixed(2)); }
}
// Offset loops three ways: no steering at all (deterministic, the rail does the work), and a bot that taps the
// steering briefly to follow the sideways shift, run twice to show how much timing noise moves it.
if (section == 'loops') {
  const surfaces = (process.argv[3] || 'Plastic,Wood').split(',');
  for (const surface of surfaces)
    for (const [r, run, ms] of [[20, 8, 8000], [40, 14, 11000], [60, 20, 14000]]) {
      const block = r / 20, yq = r / 5, z0 = -run * 4, name = (q) => surface + 'RoadLoop' + r + 'OffsetRQ' + q, zc = z0 * 5 + 10;
      const parts = lane([surface + 'StartRoad', ...Array(run - 1).fill(surface + 'RoadStraight')]);
      parts.push({ n: name(1), x: 0, y: 0, z: z0 }, { n: name(2), x: 0, y: yq, z: z0 }, { n: name(3), x: 0, y: yq, z: z0 + block * 4 }, { n: name(4), x: 0, y: 0, z: z0 + block * 4 });
      let z = z0; for (let k = 0; k < 40; k++) { parts.push({ n: surface + 'RoadStraight', x: 4, y: 0, z }); z -= 4; }
      const out = {};
      for (const mode of ['none', 'tap', 'tap']) {
        if (mode == 'tap') await c.evaluate(`(()=>{let started=false,best=0;window.__ctrl=(s)=>{const zc=${zc},r=${r};if(!started&&s.y>1.5&&s.z<zc)started=true;let tgt=0;if(started){let a=Math.atan2(zc-s.z,r-s.y);if(a<-0.5)a+=2*Math.PI;best=Math.max(best,a);tgt=Math.min(20,20*best/(2*Math.PI));}const e=s.x-tgt,pulse=(s.frames%150)<30;return {up:true,right:pulse&&e<-1.5,left:pulse&&e>1.5};};return 0})()`);
        const l = await drive(parts, ms), peak = l.reduce((a, b) => Math.max(a, b.y), 0), e = last(l);
        await c.evaluate('window.__ctrl=null;0');
        (out[mode] ??= []).push({ peak: +peak.toFixed(0), madeIt: peak > 2 * r - 3 && Math.abs(e.x - 20) < 7 && e.y < 3, kmh: +e.v.toFixed(0) });
      }
      report(surface + ' offset loop radius ' + r, out);
    }
}

// Plastic walls: steer into one at 150 km/h for a set time, then compare the way the car goes before and after.
// A mirror bounce leaves at the same angle it came in; a glancing one keeps (or gains) speed, a head-on one sends it back.
if (section == 'walls') {
  const floor = [{ n: 'PlaneStart', x: 0, y: 0, z: 0 }];
  for (let i = -22; i <= 22; i++) for (let j = -22; j <= 22; j++) if (i || j) floor.push({ n: 'Plane', x: i * 4, y: 0, z: j * 4 });
  const vel = (l, from, to) => { const a = at(l, from), b = at(l, to), dt = (b.f - a.f) / 1000; return [(b.x - a.x) / dt, (b.y - a.y) / dt, (b.z - a.z) / dt]; };
  const kmh = (u) => +(Math.hypot(...u) * 3.6).toFixed(0);
  const deg = (u) => +((Math.atan2(Math.abs(u[0]), Math.abs(u[2])) * 180) / Math.PI).toFixed(1);
  const sideWalls = [...floor];
  for (let z = -8; z >= -84; z -= 4) for (const x of [-4, 4]) for (const r of [1, 3]) sideWalls.push({ n: 'PlasticWallFour', x, y: 0, z, r });
  for (const ms of [120, 250, 450, 800]) {
    const l = await drive(sideWalls, 7000, { up: true }, [{ kmh: 150, ctl: { up: true, right: true } }, { after: ms, ctl: { up: true } }]);
    // The hit: the first frame where the car stops moving towards the wall it was heading for.
    let hit = -1;
    for (let i = 3; i < l.length; i++) { const a = vel(l, l[i - 2].f, l[i - 1].f), b = vel(l, l[i - 1].f, l[i].f); if (Math.abs(a[0]) > 2 && Math.sign(a[0]) != Math.sign(b[0])) { hit = l[i].f; break; } }
    if (hit < 0) { report('steer ' + ms + ' ms', { hit: false }); continue; }
    // Right after the bounce (the reflection itself) and 0.3 s later (after the tyres have had their say).
    const vi = vel(l, hit - 80, hit - 30), vb = vel(l, hit + 50, hit + 100), vo = vel(l, hit + 250, hit + 350);
    report('steer ' + ms + ' ms', { inDeg: deg(vi), bounceDeg: deg(vb), kmhBounce: kmh(vb), outDeg: deg(vo), kmhIn: kmh(vi), kmhOut: kmh(vo), forwardIn: +(-vi[2] * 3.6).toFixed(0), forwardOut: +(-vo[2] * 3.6).toFixed(0), upOut: +(vo[1] * 3.6).toFixed(0), spinDeg: +((2 * Math.acos(Math.min(1, Math.abs(at(l, hit - 30).q.reduce((s, v, k) => s + v * at(l, hit + 350).q[k], 0))))) * 57.3).toFixed(0) });
  }
  const headOn = [...floor];
  for (let x = -8; x <= 8; x += 4) headOn.push({ n: 'PlasticWallFour', x, y: 0, z: -40 });
  const l = await drive(headOn, 6000);
  let hit = -1;
  for (let i = 3; i < l.length; i++) { const a = vel(l, l[i - 2].f, l[i - 1].f), b = vel(l, l[i - 1].f, l[i].f); if (a[2] < -2 && b[2] > a[2] * 0.5) { hit = l[i].f; break; } }
  if (hit > 0) { const vi = vel(l, hit - 80, hit - 30), vo = vel(l, hit + 250, hit + 350); report('head-on', { kmhIn: kmh(vi), kmhOut: kmh(vo), forwardOut: +(-vo[2] * 3.6).toFixed(0), upOut: +(vo[1] * 3.6).toFixed(0) }); }
  else report('head-on', { hit: false });
}

// Slides on plastic: start a slide with a hard right, then either countersteer (left) or keep holding right.
// slip: angle between the nose and the way the car goes, degrees. A caught slide comes back near 0; a spin passes 90.
if (section == 'slides') {
  const P = [{ n: 'PlasticStartPlat', x: 0, y: 0, z: 0 }];
  for (let i = -22; i <= 22; i++) for (let j = -22; j <= 22; j++) if (i || j) P.push({ n: 'PlasticPlatBase', x: i * 4, y: 0, z: j * 4 });
  const slipOf = (l, i) => { const a = l[i - 1], b = l[i], q = b.q, dt = (b.f - a.f) / 1000, vx = (b.x - a.x) / dt, vz = (b.z - a.z) / dt, nx = 2 * (q[0] * q[2] + q[3] * q[1]), nz = 1 - 2 * (q[0] * q[0] + q[1] * q[1]); return (Math.atan2(nx * vz - nz * vx, nx * vx + nz * vz) * 180) / Math.PI; };
  for (const [name, after, until] of [['countersteer 0.5 s', { up: true, left: true }, 1200], ['countersteer held 1.5 s', { up: true, left: true }, 2200], ['hold the turn', { up: true, right: true }, 2200], ['let go', { up: true }, 2200]]) {
    const l = await drive(P, 7000, { up: true }, [{ kmh: 140, ctl: { up: true, right: true } }, { after: 700, ctl: after }, { after: until, ctl: { up: true } }]);
    const t = await c.evaluate('window.__trigger');
    const s = (from, to) => { let m = 0; for (let i = 1; i < l.length; i++) if (l[i].f >= from && l[i].f <= to) m = Math.max(m, Math.abs(slipOf(l, i))); return +m.toFixed(0); };
    const i1 = l.findIndex((q) => q.f >= t + 1400), i2 = l.findIndex((q) => q.f >= t + 2900);
    report(name, { slipAt700: +Math.abs(slipOf(l, l.findIndex((q) => q.f >= t + 700))).toFixed(0), maxSlipAfter: s(t + 700, t + 2900), slipAt1400: +Math.abs(slipOf(l, i1)).toFixed(0), slipAt2900: +Math.abs(slipOf(l, i2)).toFixed(0), kmhAt2900: +l[i2].v.toFixed(0) });
  }
}

// Slide trace on plastic: hard right at 140 km/h, then countersteer after `after` ms (argument, default none).
// Prints slip (degrees, signed, full circle) and yaw rate (deg/s) so a jump at some angle shows up.
if (section == 'slidetrace') {
  const P = [{ n: 'PlasticStartPlat', x: 0, y: 0, z: 0 }];
  for (let i = -22; i <= 22; i++) for (let j = -22; j <= 22; j++) if (i || j) P.push({ n: 'PlasticPlatBase', x: i * 4, y: 0, z: j * 4 });
  const after = +(process.argv[3] || 0), hold = process.argv[4] || 'left';
  const plan = [{ kmh: 140, ctl: { up: true, right: true } }];
  if (after) plan.push({ after, ctl: { up: true, [hold]: true } });
  const l = await drive(P, 6500, { up: true }, plan);
  const t = await c.evaluate('window.__trigger');
  const head = (q) => Math.atan2(2 * (q[0] * q[2] + q[3] * q[1]), 1 - 2 * (q[0] * q[0] + q[1] * q[1]));
  for (let i = 1; i < l.length; i++) {
    const a = l[i - 1], b = l[i];
    if (b.f < t - 50 || b.f > t + 3500) continue;
    const dt = (b.f - a.f) / 1000, vx = (b.x - a.x) / dt, vz = (b.z - a.z) / dt, h = head(b.q);
    let slip = ((Math.atan2(vx, vz) - h) * 180) / Math.PI, yaw = ((h - head(a.q)) * 180) / Math.PI;
    while (slip > 180) slip -= 360; while (slip < -180) slip += 360; while (yaw > 180) yaw -= 360; while (yaw < -180) yaw += 360;
    console.log(b.f - t, 'slip', slip.toFixed(1), 'yaw', (yaw / dt).toFixed(0), 'kmh', b.v.toFixed(0), 'skid', b.sk.toFixed(2));
  }
}

// Bugslide: slide off a raised plastic floor and land on road below while still sliding. A bugslide keeps the speed
// through the landing slide; without one the slide scrubs it off. The edge goes where a flat-floor run slides most.
if (section == 'bugslide') {
  const slipOf = (l, i) => { const a = l[i - 1], b = l[i], q = b.q, dt = (b.f - a.f) / 1000, vx = (b.x - a.x) / dt, vz = (b.z - a.z) / dt, nx = 2 * (q[0] * q[2] + q[3] * q[1]), nz = 1 - 2 * (q[0] * q[0] + q[1] * q[1]); return (Math.atan2(nx * vz - nz * vx, nx * vx + nz * vz) * 180) / Math.PI; };
  const plan = [{ kmh: 180, ctl: { up: true, right: true } }, { after: 380, ctl: { up: true } }];
  const flat = [{ n: 'PlasticStartPlat', x: 0, y: 1, z: 0 }];
  for (let z = -4; z >= -160; z -= 4) for (const x of [-8, -4, 0, 4, 8]) flat.push({ n: 'PlasticPlatBase', x, y: 1, z });
  let l = await drive(flat, 6000, { up: true }, plan);
  let peak = { s: 0, z: 0 };
  for (let i = 1; i < l.length; i++) { if (l[i].v < 50) continue; const s = Math.abs(slipOf(l, i)); if (s > peak.s) peak = { s, z: l[i].z }; }
  const edge = Math.floor(peak.z / 20) * 4 + 4; // last raised piece, in tiles: the car leaves just before the peak
  report('flat run', { peakSlip: +peak.s.toFixed(0), atZ: +peak.z.toFixed(0), edgeTile: edge });
  const P = flat.filter((p) => p.z >= edge);
  for (let z = edge - 4; z >= edge - 120; z -= 4) for (let x = -24; x <= 24; x += 4) P.push({ n: 'Plane', x, y: 0, z });
  l = await drive(P, 6000, { up: true }, plan);
  let air = 0, land = -1;
  for (let i = 1; i < l.length; i++) { if (l[i].y > 4) air = i; else if (air && l[i].y < 2) { land = i; break; } }
  if (land < 0) { report('bugslide', { landed: false }); } else {
    // True speed from positions (the game's readout only counts speed along the nose, which reads low mid-slide).
    const f = l[land].f, sp = (t) => { const a = at(l, t - 25), b = at(l, t + 25); return +((Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / ((b.f - a.f) / 1000)) * 3.6).toFixed(0); };
    const sl = (t) => +Math.abs(slipOf(l, l.indexOf(at(l, t)))).toFixed(0);
    report('bugslide', { slipAtLanding: sl(f), kmh: [-100, 100, 300, 600, 1000].map((d) => sp(f + d)), slip: [100, 300, 600, 1000].map((d) => sl(f + d)) });
  }
}

// Respawn heading after a checkpoint: drive through one, press respawn, read which way the car faces.
if (section == 'respawn') {
  const heading = (q) => +((Math.atan2(2 * (q[0] * q[2] + q[3] * q[1]), 1 - 2 * (q[0] * q[0] + q[1] * q[1])) * 180) / Math.PI).toFixed(1);
  const cases = [
    ['straight checkpoint', 'PlasticCheckpointPlat', 0],
    // Open-road diagonals: a diagonal road's rails cross a straight test lane and would stop the car first.
    ['diagonal checkpoint', 'PlasticCheckpointOpenDiag', 0],
    ['diagonal checkpoint, rotated 90', 'WoodCheckpointOpenDiag', 1],
    ['diagonal checkpoint, rotated 180', 'WoodCheckpointOpenDiag', 2],
    ['diagonal checkpoint, rotated 270', 'PlasticCheckpointOpenDiag', 3],
  ];
  for (const [label, gate, r] of cases) {
    const parts = [...lane(['PlasticStartPlat', ...Array(40).fill('PlasticPlatBase')]), { n: gate, x: 0, y: 0, z: -20, r }];
    const l = await drive(parts, 7000, { up: true }, [{ cp: 1, ctl: { up: true } }, { after: 400, ctl: { reset: true } }, { after: 440, ctl: {} }]);
    const t = await c.evaluate('window.__trigger');
    const crossed = Math.max(...l.map((s) => s.n));
    const after = at(l, t + 900);
    report(label, { checkpointsPassed: crossed, respawnHeadingDeg: heading(after.q), at: [+after.x.toFixed(1), +after.y.toFixed(2), +after.z.toFixed(1)], kmh: +after.v.toFixed(0) });
  }
}

if (section == 'gameplay') {
  const kmh = (l, f) => +at(l, f).v.toFixed(0);
  const straight = (start, piece, n = 45) => lane([start, ...Array(n).fill(piece)]);
  {
    const a = await drive(straight('PlasticStartPlat', 'PlasticPlatBase'), 4000), b = await drive(straight('PlasticStartPlat', 'StadiumGrass'), 4000);
    report('Penalty grass, km/h at 2 s and 4 s', { plastic: [kmh(a, 2000), kmh(a, 4000)], grass: [kmh(b, 2000), kmh(b, 4000)] });
    const c1 = await drive(straight('WoodStartPlat', 'WoodGrassPlatCenter'), 4000), c2 = await drive(straight('WoodStartPlat', 'WoodGrassPlatEdge'), 4000);
    report('Grass inside a block, km/h at 4 s', { onTheGrassStrip: kmh(c1, 4000), besideTheGrassStrip: kmh(c2, 4000) });
  }
  {
    const run = (p) => drive(lane(['PlasticStartRoad', ...Array(5).fill('PlasticRoadStraight'), p, ...Array(40).fill('PlasticRoadStraight')]), 5000);
    const a = await run('PlasticRoadStraight'), b = await run('PlasticFxTurboRoad'), e = await run('PlasticFxSuperRoad'), r = await run('PlasticFxRouletteRoad'), g = await run('StadiumGateTurbo');
    report('Turbos, km/h at 4.5 s', { plain: kmh(a, 4500), turbo: kmh(b, 4500), superTurbo: kmh(e, 4500), roulette: kmh(r, 4500), turboGate: kmh(g, 4500) });
  }
  {
    // A kicker after the plate: a reactor boost up should stretch the flight, down should cut it short.
    const run = async (p) => {
      const l = await drive(lane(['WoodStartRoad', ...Array(5).fill('WoodRoadStraight'), p, 'WoodRoadStraight', 'WoodRoadKickerBig']), 8000);
      const take = l.findIndex((s) => s.y > 3);
      const land = l.findIndex((s, i) => i > take && take > 0 && s.y < 0.6);
      return { peakY: +Math.max(...l.map((s) => s.y)).toFixed(1), airMs: take > 0 && land > 0 ? l[land].f - l[take].f : null };
    };
    report('Reactor boosts over a kicker', { none: await run('WoodRoadStraight'), up: await run('WoodFxReactorUpRoad'), superUp: await run('WoodFxReactor2UpRoad'), down: await run('WoodFxReactorDownRoad') });
  }
  {
    const a = await drive(straight('PlasticStartRoad', 'PlasticRoadStraight'), 4000), b = await drive([...straight('PlasticStartRoad', 'PlasticRoadStraight'), { n: 'PlasticFxSlowRoad', x: 0, y: 0, z: 0 }], 4000);
    report('Slow motion, distance after 4 s', { plain: +Math.abs(last(a).z).toFixed(0), slowMotion: +Math.abs(last(b).z).toFixed(0) });
  }
  {
    const parts = straight('WoodStartRoad', 'WoodRoadStraight', 8);
    let z = -36; for (let k = 0; k < 6; k++) { parts.push({ n: 'StadiumWater', x: 0, y: 0, z }); z -= 4; }
    const a = await drive(straight('WoodStartRoad', 'WoodRoadStraight', 15), 5000), b = await drive(parts, 5000);
    report('Water, km/h at 5 s', { road: kmh(a, 5000), throughWater: kmh(b, 5000), lowestY: +Math.min(...b.map((s) => s.y)).toFixed(2) });
  }
  {
    // Box gates over a plain road: a 1-piece checkpoint box, then a finish box two pieces wide.
    const parts = straight('PlasticStartRoad', 'PlasticRoadStraight', 16);
    parts.push({ n: 'StadiumBoxCheckpointLRTB', x: 0, y: 0, z: -20 }, { n: 'StadiumBoxFinishLTB', x: 0, y: 0, z: -40 }, { n: 'StadiumBoxFinishRTB', x: 4, y: 0, z: -40 });
    const l = await drive(parts, 6000);
    report('Box gates', { checkpoints: Math.max(...l.map((s) => s.n)), finishFrame: l.find((s) => s.fin != null)?.fin ?? null });
  }
  // Slow motion and reactor boosts through the game's own verifier.
  for (const plate of ['PlasticFxSlowRoad', 'PlasticFxReactor2UpRoad', 'PlasticFxRouletteRoad']) {
    const parts = lane(['WoodStartRoad', ...Array(3).fill('WoodRoadStraight'), plate, ...Array(8).fill('PlasticRoadStraight'), 'PlasticFinishRoad', ...Array(4).fill('PlasticRoadStraight')]);
    // The realtime car starts late by however long the track took to build: search from the frame it first moved on.
    const l = await drive(parts, 9000), fin = l.find((s) => s.fin != null)?.fin, est = fin == null ? null : fin - (l.find((s) => s.v > 0.5)?.f ?? 0);
    if (est == null) { report('Verifier with ' + plate, { finished: false }); continue; }
    const found = await c.evaluate(`(async()=>{
      const Rec=__req(1754).A,t=__mk(${JSON.stringify(parts)}),M=__req(6421).A.createMountainVertices(t.getBounds()),rec=new Rec({up:[0],right:[],down:[],left:[],reset:[]}).serialize();
      const scan=()=>new Promise(res=>{const w=new Worker('simulation_worker.bundle.js'),hits=[];let pend=0;const lo=${est}-150,hi=${est}+150;
        w.addEventListener('message',e=>{if(e.data.messageType!=8)return;if(e.data.result)hits.push(e.data.carId+lo);if(--pend==0){w.terminate();res(hits);}});
        setTimeout(()=>{w.postMessage({...window.__init,isRealtime:false});
          for(let f=lo;f<=hi;f++){pend++;w.postMessage({messageType:1,mountainVertices:M.vertices,mountainOffset:{x:M.offset.x,y:M.offset.y,z:M.offset.z},trackData:t.toSaveString(),carId:f-lo,carRecording:rec,targetFrames:f});}
        },1500);});
      return JSON.stringify({a:await scan(),b:await scan()});
    })()`);
    report('Verifier with ' + plate + ', realtime finish ' + est, JSON.parse(found));
  }
}
if (section == 'banks') {
  // Bank transitions, crests and a hill: how much the car's height jitters frame to frame (lower is smoother).
  const rough = (l) => { let s = 0; for (let i = 2; i < l.length; i++) s += Math.abs(l[i].y - 2 * l[i - 1].y + l[i - 2].y); return +(s * 1000 / l.length).toFixed(2); };
  for (const surface of ['Plastic', 'Wood']) {
    const seq = [surface + 'StartRoad', ...Array(6).fill(surface + 'RoadStraight'), { n: surface + 'RoadToTiltShortL', len: 4 }, { n: surface + 'RoadTilt' }, { n: surface + 'RoadToTiltShortR', r: 2, len: 4 }, ...Array(3).fill(surface + 'RoadStraight'), { n: surface + 'RoadCrest1', len: 8 }, ...Array(30).fill(surface + 'RoadStraight')];
    const l = await drive(lane(seq), 7000), e = last(l);
    report(surface + ' banks + crest', { roughness: rough(l.filter((s) => s.z < -140 && s.z > -200)), kmh: +e.v.toFixed(0), endX: +e.x.toFixed(1), endY: +e.y.toFixed(2) });
  }
}
if (section == 'bob') {
  // Bobsleigh: straights into a curve with nobody steering; the channel walls should carry the car round.
  for (const [curve, len] of [['IceBobCurve2', 8], ['IceBobCurve3', 12], ['IceBobCurveWall3', 12]]) {
    const parts = lane(['IceStartBob', ...Array(10).fill('IceBobStraight')]);
    const z0 = -44;
    parts.push({ n: curve, x: 0, y: 0, z: z0 });
    // How high the car rides while it is in the curve, and how fast it comes out of the far end.
    const l = await drive(parts, 9000), zin = z0 * 5 + 10, inCurve = l.filter((s) => s.z < zin && s.z > zin - len * 5 - 5);
    const peak = inCurve.reduce((a, b) => Math.max(a, b.y), 0), kin = inCurve[0]?.v, kout = inCurve[inCurve.length - 1]?.v;
    report('Bobsleigh into ' + curve, { maxY: +peak.toFixed(1), kmhIn: +(kin ?? 0).toFixed(0), kmhOut: +(kout ?? 0).toFixed(0) });
  }
  {
    const parts = lane(['IceStartBob', ...Array(30).fill('IceBobStraight')]);
    const l = await drive(parts, 8000), moved = l.find((s) => s.v > 0.5)?.f ?? 0;
    report('Bobsleigh straight', { ms0to100: l.find((s) => s.v >= 100)?.f - moved, kmhAt6s: +at(l, moved + 6000).v.toFixed(0), endX: +last(l).x.toFixed(2) });
  }
}

if (section == 'wiggle') {
  // Wood wiggles: flick left/right every `period` ms from 200 km/h for 3 s, against holding straight.
  for (const surface of ['Wood', 'Plastic']) {
    const parts = lane([surface + 'StartPlat', ...Array(160).fill(surface + 'PlatBase')]);
    for (const x of [-8, -4, 4, 8]) parts.push(...lane(Array(161).fill(surface + 'PlatBase'), x));
    for (const period of [0, 130, 100, 170, 50, 300]) {
      const plan = [{ kmh: 200, ctl: { up: true } }];
      // The first flick is half as long, so the car weaves about a straight line.
      if (period) for (let t = 0, k = 0; t < 3000; t += k == 0 ? period / 2 : period, k++) plan.push({ after: t, ctl: { up: true, left: k % 2 == 0, right: k % 2 == 1 } });
      plan.push({ after: 3000, ctl: { up: true } });
      const l = await drive(parts, 12000, { up: true }, plan), t0 = await c.evaluate('window.__trigger');
      report(surface + (period ? ' wiggle every ' + period + ' ms' : ' straight'), { kmhAt3s: +at(l, t0 + 3000).v.toFixed(1), x: +at(l, t0 + 3000).x.toFixed(1) });
    }
  }
}

if (section == 'verify') {
  // Determinism through the game's own verifier: it accepts a run only if the car finishes on exactly that frame.
  {
    // node tools/test/physics.mjs verify [stock|ice]: stock checks the test rig itself on a track with no new blocks.
    const parts =
      process.argv[3] == 'stock'
        ? lane(['Start', ...Array(15).fill('Straight'), 'Checkpoint', ...Array(10).fill('Straight'), 'Finish', ...Array(6).fill('Straight')])
        : process.argv[3] == 'ice'
          ? lane(['IceStartBob', ...Array(6).fill('IceBobStraight'), 'IceCheckpointBob', ...Array(4).fill('IceBobStraight'), 'IceBobToPlatShort', ...Array(4).fill('IcePlatBase'), 'IceFinishPlat', ...Array(4).fill('IcePlatBase')])
          : lane(['WoodStartRoad', ...Array(5).fill('WoodRoadStraight'), 'PlasticFxTurboRoad', ...Array(10).fill('PlasticRoadStraight'), 'WoodCheckpointRoad', ...Array(10).fill('PlasticRoadStraight'), 'PlasticFinishRoad', ...Array(6).fill('PlasticRoadStraight')]);
    // The realtime car starts late by however long the track took to build, so the search window is moved back by
    // the frame the car first moved on.
    const l = await drive(parts, 9000), fin = l.find((s) => s.fin != null)?.fin, moved = l.find((s) => s.v > 0.5)?.f ?? 0, est = fin - moved;
    const found = await c.evaluate(`(async()=>{
      const Rec=__req(1754).A,t=__mk(${JSON.stringify(parts)}),M=__req(6421).A.createMountainVertices(t.getBounds()),rec=new Rec({up:[0],right:[],down:[],left:[],reset:[]}).serialize();
      const scan=()=>new Promise(res=>{const w=new Worker('simulation_worker.bundle.js'),hits=[];let pend=0;const lo=${est}-150,hi=${est}+150;
        w.addEventListener('message',e=>{if(e.data.messageType!=8)return;if(e.data.result)hits.push(e.data.carId+lo);if(--pend==0){w.terminate();res(hits);}});
        setTimeout(()=>{w.postMessage({...window.__init,isRealtime:false});
          for(let f=lo;f<=hi;f++){pend++;w.postMessage({messageType:1,mountainVertices:M.vertices,mountainOffset:{x:M.offset.x,y:M.offset.y,z:M.offset.z},trackData:t.toSaveString(),carId:f-lo,carRecording:rec,targetFrames:f});}
        },1500);});
      return JSON.stringify({a:await scan(),b:await scan()});
    })()`);
    report('Verifier accepts one exact frame, twice (realtime finish ' + fin + ', first moved ' + moved + ')', JSON.parse(found));
  }}

console.log(c.logs.filter((l) => !/Failed to connect|NETFAIL/.test(l)).slice(0, 10));
await c.close();
process.exit(0);
