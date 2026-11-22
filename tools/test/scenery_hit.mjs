// Scenery collides: a car flat out down a straight hits a scenery block standing on the road ahead, in the game's own
// physics worker without realtime (the same numbers every run). Prints, for each block, the speed as the car reaches
// it and the lowest speed after, against the same run with the road clear. Tall grass is drawn only: the car must
// drive through it with the run exactly as on the clear road.
// node tools/test/scenery_hit.mjs [names,...]   (TMPORT: the site's port, default 8123)
import { launch } from './cdp.mjs';

const names = process.argv[2] ? process.argv[2].split(',') : ['Tuft', 'BushSmall', 'Bush', 'RockSmall', 'Rock', 'Boulder', 'TreeSmall', 'Tree', 'Pine', 'Cactus', 'Log', 'Fence', 'StoneWall', 'Lamp', 'Flag', 'Cabin'];
const hook = `(()=>{const o=Worker.prototype.postMessage;Worker.prototype.postMessage=function(m,...r){if(m&&m.trackParts&&!window.__init)window.__init=m;return o.call(this,m,...r)}})()`;
const c = await launch({ port: +(process.env.TMCDP || 9363), width: 800, height: 600 });
await c.send('Page.addScriptToEvaluateOnNewDocument', { source: hook });
await c.send('Page.navigate', { url: 'http://127.0.0.1:' + (process.env.TMPORT || 8123) + '/Better-Editor-PT/' });
await c.waitFor(`[...document.querySelectorAll('button')].some(b=>['Exit','Editor'].includes(b.innerText.trim())&&b.offsetParent)`, 300000);
await c.waitFor('!!window.__init');
await c.evaluate("window.requestAnimationFrame=()=>0;window.cancelAnimationFrame=()=>{};for(const v of document.querySelectorAll('canvas'))v.style.display='none';true");
await c.evaluate(`(()=>{
  window.webpackChunk.push([[Symbol()],{},r=>window.__req=r]);
  const req=window.__req, TD=req(9117).A, Sun=req(7929).A, Mount=req(6421).A, VO=req(3899).VO, P=req(494).A, Rec=req(1754).A;
  window.__run=(parts,frames)=>new Promise((res,rej)=>{
    const t=new TD(1,new Sun(0));
    for(const p of parts){const id=P[p.n]; if(id==null)throw new Error('no part '+p.n);
      const def=req(2600).Hw(id); t.addPart(p.x,p.y,p.z,id,p.r||0,0,0,def.detector&&def.detector.type==0?0:null,def.startOffset?0:null);}
    const M=Mount.createMountainVertices(t.getBounds()), save=t.toSaveString(), w=new Worker('simulation_worker.bundle.js'), log=[];
    w.addEventListener('error',e=>rej(new Error('worker: '+e.message)));
    w.addEventListener('message',e=>{const m=e.data; if(!m||m.messageType!=10)return;
      for(const b of m.carStateBuffers){const u=new Uint8Array(b), s=VO(u.subarray(4)).carState; if(log.length<frames)log.push([s.frames,s.speedKmh,s.position.x,s.position.y,s.position.z]);
        if(log.length==frames){w.terminate();res(log);}}});
    w.postMessage({...window.__init,isRealtime:false});
    w.postMessage({messageType:3,mountainVertices:M.vertices,mountainOffset:{x:M.offset.x,y:M.offset.y,z:M.offset.z},trackData:save,carId:1,carRecording:new Rec({up:[0],right:[],down:[],left:[],reset:[]}).serialize()});
    w.postMessage({messageType:5,carId:1,targetSimulationTimeFrames:frames});
    setTimeout(()=>rej(new Error('timed out')),120000);
  });
  return true;
})()`);
await c.sleep(1500); // the worker's Init needs a moment in rigs (see the editor-automation notes)

// A start and 16 straights down -z; the block stands on the road 40 tiles (200 units) ahead.
const road = [{ n: 'Start', x: 0, y: 0, z: 0 }, ...Array.from({ length: 16 }, (_, i) => ({ n: 'Straight', x: 0, y: 0, z: -4 * (i + 1) }))];
// Blocks a car drives through (nothing solid).
const THROUGH = new Set(['Tuft']);
const AT = -200,
  FRAMES = 9000;
const drive = async (extra) => (await c.evaluate(`__run(${JSON.stringify([...road, ...extra])},${FRAMES})`)).map(([f, v, x, y, z]) => ({ f, v, x, y, z }));
const clear = await drive([]);
const reach = (l) => l.findIndex((s) => s.z <= AT + 12);
const r0 = reach(clear);
console.log('clear road: reaches the block at', (clear[r0].f / 1000).toFixed(2), 's,', clear[r0].v.toFixed(0), 'km/h; at the end', clear.at(-1).v.toFixed(0), 'km/h, z', clear.at(-1).z.toFixed(0));
let fails = 0;
for (const n of names) {
  const l = await drive([{ n: 'Scenery' + n, x: 0, y: 0, z: AT / 5 }]);
  const i = reach(l);
  const after = l.slice(Math.max(0, i)),
    low = Math.min(...after.map((s) => s.v)),
    end = l.at(-1);
  // Hit = the run leaves the clear road's: speed, height or line apart at some frame after reaching the block.
  let dev = null;
  for (let k = Math.max(0, i - 200); k < l.length && dev == null; k++) {
    const a = l[k],
      b = clear[k];
    if (Math.abs(a.v - b.v) > 3 || Math.abs(a.y - b.y) > 0.3 || Math.abs(a.x - b.x) > 0.3) dev = k;
  }
  const through = THROUGH.has(n);
  if ((dev == null) != through) fails++;
  console.log((n + ':').padEnd(12), dev != null ? 'HIT ' : through ? 'THROUGH' : 'MISS', 'at', i < 0 ? '-' : l[i].v.toFixed(0), 'km/h, lowest after', low.toFixed(0), 'km/h, end', end.v.toFixed(0), 'km/h at x', end.x.toFixed(1), 'y', end.y.toFixed(1), 'z', end.z.toFixed(0), '(clear:', clear.at(-1).v.toFixed(0), 'km/h, z', clear.at(-1).z.toFixed(0) + ')', dev != null ? 'apart from z ' + l[dev].z.toFixed(0) : '');
}
// Control: the same block well off the road must leave the run alone (where a run splits, it is at the block).
{
  const l = await drive([{ n: 'SceneryBoulder', x: 16, y: 0, z: AT / 5 }]);
  // Our blocks share one collision mesh with the mountain, so a block anywhere can nudge the run by float noise.
  const k0 = l.findIndex((s, k) => s.v !== clear[k].v || s.x !== clear[k].x || s.y !== clear[k].y || s.z !== clear[k].z);
  let dv = 0,
    dp = 0;
  for (let k = 0; k < l.length; k++) (dv = Math.max(dv, Math.abs(l[k].v - clear[k].v))), (dp = Math.max(dp, Math.hypot(l[k].x - clear[k].x, l[k].y - clear[k].y, l[k].z - clear[k].z)));
  console.log('boulder off the road, 80 units to the side:', k0 < 0 ? 'run identical to the clear road' : 'run differs from frame ' + clear[k0].f + ' (z ' + clear[k0].z.toFixed(0) + '), at most ' + dv.toFixed(3) + ' km/h and ' + dp.toFixed(3) + ' units apart');
}
console.log(fails ? fails + ' blocks did not do what they should' : 'every solid block changed the run where it stands, and the car drove through the tall grass');
await c.close();
process.exit(fails ? 1 : 0);
