// Loads the blocks whose names match a pattern in one track and starts a car in the physics worker.
// node tools/test/partsphys.mjs "^PlasticStock" [more patterns...]: one result per pattern.
import { openEditor } from './lib.mjs';
const hook = `(()=>{const o=Worker.prototype.postMessage;Worker.prototype.postMessage=function(m,...r){if(m&&m.trackParts&&!window.__init)window.__init=m;return o.call(this,m,...r)}})()`;
const c = await openEditor(9344, 1000, 700, hook);
await c.waitFor('!!window.__init');
await c.evaluate(`(()=>{window.webpackChunk.push([[Symbol()],{},r=>window.__req=r]);return 1})()`);
for (const pat of process.argv.slice(2)) {
  const r = await c.evaluate(`(async()=>{
    const req=__req,H=req(2600).Hw,TD=req(9117).A,Sun=req(7929).A;
    const re=new RegExp(${JSON.stringify(pat)});
    const list=TM.parts.filter(q=>re.test(q.n));
    const t=new TD(0,new Sun(0));let k=0,tris=0;
    for(const q of list){const d=H(q.i);tris+=(q.ph?q.ph[4]/3:0);t.addPart((k%30)*32,0,Math.floor(k/30)*32,q.i,k%4,0,0,d.detector&&d.detector.type==0?0:null,d.startOffset?k:null);k++;}
    const physics=await new Promise((res)=>{const w=new Worker('simulation_worker.bundle.js');let done=false,t0;
      w.addEventListener('error',e=>{if(!done){done=true;w.terminate();res('worker error: '+e.message);}});
      w.addEventListener('message',e=>{if(e.data.messageType==10&&!done){done=true;const ms=performance.now()-t0;w.terminate();res('started in '+Math.round(ms)+' ms');}});
      setTimeout(()=>w.postMessage({...window.__init,isRealtime:true}),1500);
      setTimeout(()=>{const M=req(6421).A.createMountainVertices(t.getBounds());t0=performance.now();
        w.postMessage({messageType:3,mountainVertices:M.vertices,mountainOffset:{x:M.offset.x,y:M.offset.y,z:M.offset.z},trackData:t.toSaveString(),carId:1,carRecording:null});
        w.postMessage({messageType:5,carId:1,targetSimulationTimeFrames:null});},2500);
      setTimeout(()=>{if(!done){done=true;w.terminate();res('timeout');}},40000);
    });
    return list.length+' blocks, '+tris+' collision tris: '+physics;
  })()`);
  console.log(pat, '->', r);
}
await c.close();
process.exit(0);
