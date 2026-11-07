// A start, checkpoint or finish one block ahead of the car (or under it, for a start), stock or generated.
// node tools/test/gates.mjs Plastic|Wood|stock Start|Checkpoint|Finish [Road|Open|Plat]
import { openEditor, T } from './lib.mjs';
const surf = process.argv[2] || 'Plastic';
const c = await openEditor(9346, 1280, 800);
await c.evaluate(`(()=>{window.webpackChunk.push([[Symbol()],{},r=>window.__req=r]);return 1})()`);
const kind = process.argv[3] || 'Checkpoint';
const gate = surf == 'stock' ? kind : surf + kind + (process.argv[4] || 'Road');
const code = await c.evaluate(`(()=>{const req=__req,TD=req(9117).A,Sun=req(7929).A,P=req(494).A,H=req(2600).Hw;
  const t=new TD(0,new Sun(0));
  const add=(n,x,y,z,r=0)=>{const id=P[n];if(id==null)throw new Error(n);const d=H(id);t.addPart(x,y,z,id,r,0,0,d.detector&&d.detector.type==0?0:null,d.startOffset?0:null);};
  const seq=${JSON.stringify(kind == 'Start' ? [gate, 'Straight', 'Finish'] : ['Start', gate, 'Straight', kind == 'Finish' ? 'Checkpoint' : 'Finish'])};
  seq.forEach((n,i)=>add(n,0,0,-4*i));
  return t.toExportString({name:'Gates',author:'tester',lastModified:null});})()`);
await c.clickText('Load'); await c.sleep(1200); await c.clickText('Import'); await c.sleep(1000);
await c.evaluate(`(()=>{const a=[...document.querySelectorAll('textarea')].find(x=>x.offsetParent);const s=Object.getOwnPropertyDescriptor(a.constructor.prototype,'value').set;s.call(a,${JSON.stringify(code)});a.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await c.sleep(400); await c.clickText('Import'); await c.sleep(5000);
await c.clickText('Test'); await c.sleep(5000);
await c.shot(T + 'bept_gate_' + surf + '_' + kind + '.png');
console.log(c.logs.filter((l) => !/Failed to connect|NETFAIL/.test(l)).slice(0, 10));
await c.close();
process.exit(0);
