// The bobsleigh from the car: a start, straights and a curve. node tools/test/bob.mjs [frames to drive]
import { openEditor, T } from './lib.mjs';
const c = await openEditor(9347, 1280, 800);
await c.evaluate(`(()=>{window.webpackChunk.push([[Symbol()],{},r=>window.__req=r]);return 1})()`);
const code = await c.evaluate(`(()=>{const req=__req,TD=req(9117).A,Sun=req(7929).A,P=req(494).A,H=req(2600).Hw;
  const t=new TD(0,new Sun(0));
  const add=(n,x,y,z,r=0)=>{const id=P[n];if(id==null)throw new Error(n);const d=H(id);t.addPart(x,y,z,id,r,0,0,d.detector&&d.detector.type==0?0:null,d.startOffset?0:null);};
  ['IceStartBob','IceBobStraight','IceBobStraight','IceBobCurve3'].forEach((n,i)=>add(n,0,0,-4*i));
  return t.toExportString({name:'Bob',author:'tester',lastModified:null});})()`);
await c.clickText('Load'); await c.sleep(1200); await c.clickText('Import'); await c.sleep(1000);
await c.evaluate(`(()=>{const a=[...document.querySelectorAll('textarea')].find(x=>x.offsetParent);const s=Object.getOwnPropertyDescriptor(a.constructor.prototype,'value').set;s.call(a,${JSON.stringify(code)});a.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await c.sleep(400); await c.clickText('Import'); await c.sleep(5000);
await c.shot(T + 'bept_bob_editor.png');
await c.clickText('Test'); await c.sleep(5000);
await c.shot(T + 'bept_bob_start.png');
console.log(c.logs.filter((l) => !/Failed to connect|NETFAIL/.test(l)).slice(0, 10));
await c.close();
process.exit(0);
