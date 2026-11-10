// Braking in the air, per vehicle: the car jumps off a ramp on the gas, the brake goes on shortly after take-off and
// stays on. Prints how far the nose pitched (degrees, + up) 0.5, 1 and 1.5 s after the brake, with and without it.
// Every vehicle should read like the Stadium car: the brake steadies the car, it does not lift the nose.
// node tools/test/airbrake.mjs   (TMPORT: another copy of the site, to compare runtimes)
import { launch } from './cdp.mjs';
const hook = `(()=>{const o=Worker.prototype.postMessage;Worker.prototype.postMessage=function(m,...r){if(m&&m.trackParts&&!window.__init)window.__init=m;return o.call(this,m,...r)}})()`;
const c = await launch({ port: +(process.env.TMCDP || 9362), width: 800, height: 600 });
await c.send('Page.addScriptToEvaluateOnNewDocument', { source: hook });
await c.send('Page.navigate', { url: 'http://127.0.0.1:' + (process.env.TMPORT || 8123) + '/Better-Editor-PT/' });
await c.waitFor(`[...document.querySelectorAll('button')].some(b=>['Exit','Editor'].includes(b.innerText.trim())&&b.offsetParent)`, 300000);
await c.waitFor('!!window.__init');
// The page never needs to draw here (with swiftshader its render loop starves the worker).
await c.evaluate("window.requestAnimationFrame=()=>0;window.cancelAnimationFrame=()=>{};for(const v of document.querySelectorAll('canvas'))v.style.display='none';true");
await c.evaluate(`(()=>{
  window.webpackChunk.push([[Symbol()],{},r=>window.__req=r]);
  const req=window.__req, TD=req(9117).A, Sun=req(7929).A, Mount=req(6421).A, VO=req(3899).VO, P=req(494).A, Rec=req(1754).A, H=req(2600).Hw;
  // One car: returns [frames, y, qx, qy, qz, qw, wheels on the ground] per frame.
  window.__air=(vehicle, rec, frames)=>new Promise((res,rej)=>{
    const t=new TD(1,new Sun(0));
    const add=(n,x,y,z)=>{const id=P[n],d=H(id);t.addPart(x,y,z,id,0,0,0,d.detector&&d.detector.type==0?0:null,d.startOffset?0:null);};
    // The new blocks all the way: on a track of stock blocks alone the game runs its stock physics, vehicles and all.
    add('PlasticStartRoad',0,0,0); for(let i=1;i<=8;i++)add('PlasticRoadStraight',0,0,-4*i);
    add('PlasticRoadMediumStart',0,0,-36); add('PlasticRoadMediumStraight',0,1,-40); add('PlasticRoadMediumStraight',0,3,-44);
    const M=Mount.createMountainVertices(t.getBounds()), w=new Worker('simulation_worker.bundle.js?tmtest='+encodeURIComponent(JSON.stringify({vehicle})));
    const out=[]; let done=false;
    w.addEventListener('error',e=>{if(!done){done=true;rej(new Error('worker: '+e.message));}});
    w.addEventListener('message',e=>{const m=e.data; if(m.messageType!=10||done)return;
      for(const b of m.carStateBuffers){const u=new Uint8Array(b), s=VO(u.subarray(4)).carState;
        out.push([s.frames,s.position.y,s.quaternion.x,s.quaternion.y,s.quaternion.z,s.quaternion.w,(u[4+7]>>3)&15]);
        if(out.length>=frames){done=true;w.terminate();res(JSON.stringify(out));}}});
    w.postMessage({...window.__init,isRealtime:false});
    w.postMessage({messageType:3,mountainVertices:M.vertices,mountainOffset:{x:M.offset.x,y:M.offset.y,z:M.offset.z},trackData:t.toSaveString(),carId:1,carRecording:new Rec({up:rec.up??[],right:[],down:rec.down??[],left:[],reset:[]}).serialize()});
    w.postMessage({messageType:5,carId:1,targetSimulationTimeFrames:frames});
    setTimeout(()=>{if(!done){done=true;w.terminate();rej(new Error('timed out'));}},120000);
  });
  return true;
})()`);
const run = async (vehicle, rec, frames) => JSON.parse(await c.evaluate(`__air(${JSON.stringify(vehicle)},${JSON.stringify(rec)},${frames})`));
// The nose's height: the car's forward axis (0, 0, 1) turned by its quaternion, y part.
const pitch = (r) => Math.asin(Math.max(-1, Math.min(1, 2 * (r[3] * r[4] - r[5] * r[2])))) * 57.2958;
for (const vehicle of ['Stadium', 'Snow', 'Rally', 'Desert']) {
  const free = await run(vehicle, { up: [0] }, 9000);
  // Take-off: the first frame with no wheel on the ground that stays that way for 0.3 s, once the car is on the ramp.
  let off = -1;
  for (let i = 1000; i < free.length - 300; i++) if (free[i][1] > 4 && free.slice(i, i + 300).every((r) => r[6] == 0)) { off = i; break; }
  if (off < 0) {
    console.log(vehicle, 'never took off');
    continue;
  }
  const at = off + 100,
    braked = await run(vehicle, { up: [0], down: [at] }, 9000),
    land = (l) => { for (let i = at; i < l.length; i++) if (l[i][6] != 0) return i; return l.length - 1; },
    row = (l) => [500, 1000, 1500].map((d) => (at + d < land(l) ? (pitch(l[at + d]) - pitch(l[at])).toFixed(1) : 'landed')).join(' / ');
  console.log(vehicle.padEnd(8), 'take-off frame', off, '| pitch change after 0.5 / 1 / 1.5 s  no brake:', row(free), ' brake:', row(braked), '| air time', ((land(braked) - off) / 1000).toFixed(2), 's');
}
await c.close();
process.exit(0);
