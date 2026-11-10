// Drives over some of the stock-shape copies and road kit pieces on the gas and prints where the car got to.
// node tools/test/newblocks_drive.mjs   (TMPORT: the site's port)
import { launch } from './cdp.mjs';
const hook = `(()=>{const o=Worker.prototype.postMessage;Worker.prototype.postMessage=function(m,...r){if(m&&m.trackParts&&!window.__init)window.__init=m;return o.call(this,m,...r)}})()`;
const c = await launch({ port: +(process.env.TMCDP || 9364), width: 800, height: 600 });
await c.send('Page.addScriptToEvaluateOnNewDocument', { source: hook });
await c.send('Page.navigate', { url: 'http://127.0.0.1:' + (process.env.TMPORT || 8123) + '/Better-Editor-PT/' });
await c.waitFor(`[...document.querySelectorAll('button')].some(b=>['Exit','Editor'].includes(b.innerText.trim())&&b.offsetParent)`, 300000);
await c.waitFor('!!window.__init');
await c.evaluate("window.requestAnimationFrame=()=>0;window.cancelAnimationFrame=()=>{};for(const v of document.querySelectorAll('canvas'))v.style.display='none';true");
await c.evaluate(`(()=>{
  window.webpackChunk.push([[Symbol()],{},r=>window.__req=r]);
  const req=window.__req, TD=req(9117).A, Sun=req(7929).A, Mount=req(6421).A, VO=req(3899).VO, P=req(494).A, Rec=req(1754).A, H=req(2600).Hw;
  // parts: [name, x, y, z] in tiles. Returns the car's [km/h, x, y, z] every 500 frames.
  window.__drive=(parts, frames)=>new Promise((res,rej)=>{
    const t=new TD(1,new Sun(0));
    for(const [n,x,y,z] of parts){const id=P[n];if(id==null)return rej(new Error('no block '+n));const d=H(id);t.addPart(x,y,z,id,0,0,0,d.detector&&d.detector.type==0?0:null,d.startOffset?0:null);}
    const M=Mount.createMountainVertices(t.getBounds()), w=new Worker('simulation_worker.bundle.js');
    const out=[]; let n=0, done=false;
    w.addEventListener('error',e=>{if(!done){done=true;rej(new Error('worker: '+e.message));}});
    w.addEventListener('message',e=>{const m=e.data; if(m.messageType!=10||done)return;
      for(const b of m.carStateBuffers){const u=new Uint8Array(b), s=VO(u.subarray(4)).carState;
        if(n%500==0)out.push([Math.round(s.speedKmh),+s.position.x.toFixed(1),+s.position.y.toFixed(1),+s.position.z.toFixed(1)]);
        if(++n>=frames){done=true;w.terminate();res(JSON.stringify(out));}}});
    w.postMessage({...window.__init,isRealtime:false});
    w.postMessage({messageType:3,mountainVertices:M.vertices,mountainOffset:{x:M.offset.x,y:M.offset.y,z:M.offset.z},trackData:t.toSaveString(),carId:1,carRecording:new Rec({up:[0],right:[],down:[],left:[],reset:[]}).serialize()});
    w.postMessage({messageType:5,carId:1,targetSimulationTimeFrames:frames});
    setTimeout(()=>{if(!done){done=true;w.terminate();rej(new Error('timed out'));}},120000);
  });
  return true;
})()`);
const tracks = {
  // Stock road all the way: what the road kit run should match.
  'stock road': [['Start', 0, 0, 0], ['Straight', 0, 0, -4], ['Straight', 0, 0, -8], ['Straight', 0, 0, -12], ['Straight', 0, 0, -16], ['Straight', 0, 0, -20], ['SlopeUpLong', 0, 0, -24]],
  // The road kit's 2-long straights (stock grip), then the stock long slope.
  'road kit': [['Start', 0, 0, 0], ['RoadKitRoadStraightX2', 0, 0, -4], ['RoadKitRoadStraightX2', 0, 0, -12], ['Straight', 0, 0, -20], ['SlopeUpLong', 0, 0, -24]],
  // Wood: kit straights, then the stock long slope in wood.
  'wood + stock shape': [['WoodStartRoad', 0, 0, 0], ['WoodRoadStraight', 0, 0, -4], ['WoodRoadStraight', 0, 0, -8], ['WoodRoadStraight', 0, 0, -12], ['WoodRoadStraight', 0, 0, -16], ['WoodRoadStraight', 0, 0, -20], ['WoodStockSlopeUpLong', 0, 0, -24]],
  // Plastic blocks as the floor: a start on a row of plastic stock blocks (their tops are one layer up).
  'plastic blocks': [['PlasticStockBlock', 0, 0, 0], ['PlasticStartPlat', 0, 1, 0], ...[1, 2, 3, 4, 5, 6].flatMap((i) => [['PlasticStockBlock', 0, 0, -4 * i]])],
};
for (const [name, parts] of Object.entries(tracks)) console.log(name.padEnd(20), await c.evaluate(`__drive(${JSON.stringify(parts)}, 4001)`).catch((e) => 'FAILED ' + e.message));
await c.close();
process.exit(0);
