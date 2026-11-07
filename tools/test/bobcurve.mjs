// Bobsleigh pieces seen in the editor from outside, each in all four turns. node tools/test/bobcurve.mjs [IceBobCurve1,IceBobCurve2]
import { openEditor, T } from './lib.mjs';
const parts = (process.argv[2] || 'IceBobCurve1').split(',');
const c = await openEditor(9348, 1280, 800);
await c.evaluate(`(()=>{window.webpackChunk.push([[Symbol()],{},r=>window.__req=r]);return 1})()`);
for (const part of parts) {
  const code = await c.evaluate(`(()=>{const req=__req,TD=req(9117).A,Sun=req(7929).A,P=req(494).A,H=req(2600).Hw;
    const t=new TD(0,new Sun(0));
    const add=(n,x,y,z,r=0)=>{const id=P[n];if(id==null)throw new Error(n);const d=H(id);t.addPart(x,y,z,id,r,0,0,d.detector&&d.detector.type==0?0:null,d.startOffset?0:null);};
    add('IceStartBob',0,0,-4);
    [0,1,2,3].forEach(r=>add(${JSON.stringify(part)},-12+r*8,0,8,r));
    return t.toExportString({name:'Bob'+${JSON.stringify(part)}+Date.now(),author:'tester',lastModified:null});})()`);
  await c.clickText('Load'); await c.sleep(1200); await c.clickText('Import'); await c.sleep(1000);
  await c.evaluate(`(()=>{const a=[...document.querySelectorAll('textarea')].find(x=>x.offsetParent);const s=Object.getOwnPropertyDescriptor(a.constructor.prototype,'value').set;s.call(a,${JSON.stringify(code)});a.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await c.sleep(400); await c.clickText('Import'); await c.sleep(6000);
  await c.shot(T + 'bept_bob_' + part + '.png');
}
console.log(T, c.logs.filter((l) => !/Failed to connect|NETFAIL/.test(l)).slice(0, 10));
await c.close();
process.exit(0);
