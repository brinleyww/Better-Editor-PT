// Every block: checks its data in every colour slot, then loads them all in one track and starts a car.
import { openEditor } from './lib.mjs';
const hook = `(()=>{const o=Worker.prototype.postMessage;Worker.prototype.postMessage=function(m,...r){if(m&&m.trackParts&&!window.__init)window.__init=m;return o.call(this,m,...r)}})()`;
const c = await openEditor(9343, 1000, 700, hook);
await c.waitFor('!!window.__init');
const r = await c.evaluate(`(async()=>{
  window.webpackChunk.push([[Symbol()],{},r=>window.__req=r]);
  const req=__req,P=req(494).A,H=req(2600).Hw,TD=req(9117).A,Sun=req(7929).A;
  const fail=[];let checked=0,slots=0;
  for(const q of TM.parts){
    const def=H(q.i);
    if(P[q.n]!==q.i||P[q.i]!==q.n)fail.push('enum '+q.n);
    for(const slot of TM.palette(q)){
      const {pos}=TM.renderArrays(q.i,slot.colors,()=>[0,0,0]);slots++;
      if(pos.length==0||pos.length%9)fail.push('tris '+q.n);
      for(let i=0;i<pos.length;i++)if(!Number.isFinite(pos[i])){fail.push('nan '+q.n);break;}
    }
    if(def.tiles.length==0)fail.push('tiles '+q.n);
    let low=false;def.tiles.forEach((x,y)=>{if(y<0)low=true;});if(low)fail.push('below '+q.n);
    checked++;
  }
  // Tiles must match each part's real size, so neighbours placed edge to edge never replace each other.
  const span=(n)=>{let a=[1e9,1e9,1e9],b=[-1e9,-1e9,-1e9];H(P[n]).tiles.forEach((x,y,z)=>{[x,y,z].forEach((v,i)=>{a[i]=Math.min(a[i],v);b[i]=Math.max(b[i],v);});});return [a,b];};
  const expect={PlasticRoadStraight:[[-2,0,-2],[1,0,1]],WoodPlatBase:[[-2,0,-2],[1,0,1]],WoodRoadStraightX2:[[-2,0,-6],[1,0,1]],PlasticRoadMediumStraight:[[-2,0,-2],[1,2,1]],PlasticRoadLoop20Q1:[[-2,0,-2],[1,3,1]],PlasticRoadLoop20Q2:[[-2,0,-2],[1,3,1]],PlasticRoadLoop20Q3:[[-2,0,-2],[1,3,1]],PlasticRoadLoop20Q4:[[-2,0,-2],[1,3,1]],WoodPlatWallStraight:[[-2,0,-2],[1,3,-2]]};
  const spans={};for(const n in expect){const g=span(n);spans[n]=JSON.stringify(g);if(JSON.stringify(g)!=JSON.stringify(expect[n]))fail.push('span '+n+' '+JSON.stringify(g));}
  const t=new TD(0,new Sun(0));let k=0;
  for(const q of TM.parts){const d=H(q.i);t.addPart((k%30)*32,0,Math.floor(k/30)*32,q.i,k%4,0,0,d.detector&&d.detector.type==0?0:null,d.startOffset?k:null);k++;}
  const code=t.toExportString({name:'All blocks',author:null,lastModified:null});
  const back=TD.fromExportString(code);
  const save=TD.fromSaveString(t.toSaveString());
  const physics=await new Promise((res)=>{const w=new Worker('simulation_worker.bundle.js');let done=false,t0;
    w.addEventListener('error',e=>{if(!done){done=true;res('worker error: '+e.message);}});
    w.addEventListener('message',e=>{if(e.data.messageType==10&&!done){done=true;const ms=performance.now()-t0;w.terminate();res({started:true,ms:Math.round(ms)});}});
    setTimeout(()=>w.postMessage({...window.__init,isRealtime:true}),1500);
    setTimeout(()=>{const M=req(6421).A.createMountainVertices(t.getBounds());t0=performance.now();
      w.postMessage({messageType:3,mountainVertices:M.vertices,mountainOffset:{x:M.offset.x,y:M.offset.y,z:M.offset.z},trackData:t.toSaveString(),carId:1,carRecording:null});
      w.postMessage({messageType:5,carId:1,targetSimulationTimeFrames:null});},2500);
    setTimeout(()=>{if(!done){done=true;w.terminate();res('timeout');}},30000);
  });
  return JSON.stringify({checked,slots,failCount:fail.length,fail:fail.slice(0,20),codeLength:code.length,roundTripSameId:!!back&&back.trackData.getId()==t.getId(),saveRoundTrip:!!save&&save.numberOfParts==t.numberOfParts,physics});
})()`);
console.log(r);
console.log(c.logs.filter((l) => !/Failed to connect|NETFAIL/.test(l)).slice(0, 10));
await c.close();
process.exit(0);
