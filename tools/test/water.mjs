// Water and finish hoops in the editor, then a drive into the water in Test. node tools/test/water.mjs
// Screenshots: bept-bept_water_editor.png (pools, shallow water, hoops), bept-bept_water_drive*.png (splashes).
import { openEditor, T } from './lib.mjs';
const c = await openEditor(9349, 1280, 800);
await c.evaluate(`(()=>{window.webpackChunk.push([[Symbol()],{},r=>window.__req=r]);return 1})()`);
const code = await c.evaluate(`(()=>{const req=__req,TD=req(9117).A,Sun=req(7929).A,P=req(494).A,H=req(2600).Hw;
  const t=new TD(0,new Sun(0));
  const add=(n,x,y,z,r=0)=>{const id=P[n];if(id==null)throw new Error(n);const d=H(id);t.addPart(x,y,z,id,r,0,0,d.detector&&d.detector.type==0?0:null,d.startOffset?0:null);};
  // A run-up one layer above a long pool, so the car drops onto the water fast and skips.
  add('WoodStartRoad',0,1,0);
  for(let i=1;i<6;i++)add('WoodRoadStraight',0,1,-4*i);
  add('WoodFxTurboRoad',0,1,-24);
  for(let i=7;i<14;i++)add('WoodRoadStraight',0,1,-4*i);
  for(let i=14;i<34;i++)add('StadiumWater',0,0,-4*i);
  // Beside it: a 2 x 3 pool with a ramp, shallow water, and finish hoops of each size.
  for(let i=0;i<3;i++)for(let j=0;j<2;j++)add(i==2?'StadiumWaterRamp':'StadiumWater',8+4*j,0,-4*i,2);
  for(let i=0;i<3;i++)add('StadiumShallowWater',-8,0,-4*i);
  add('PlasticFinishHoopRoad1',-16,0,0);add('PlasticFinishHoopRoad2',-24,0,0);add('WoodFinishHoopPlat3',-40,0,0);add('StadiumFinishHoopAir2',-16,2,-12);
  return t.toExportString({name:'Water'+Date.now(),author:'tester',lastModified:null});})()`);
await c.clickText('Load'); await c.sleep(1200); await c.clickText('Import'); await c.sleep(1000);
await c.evaluate(`(()=>{const a=[...document.querySelectorAll('textarea')].find(x=>x.offsetParent);const s=Object.getOwnPropertyDescriptor(a.constructor.prototype,'value').set;s.call(a,${JSON.stringify(code)});a.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await c.sleep(400); await c.clickText('Import'); await c.sleep(6000);
await c.shot(T + 'bept_water_editor.png');
await c.clickText('Test'); await c.sleep(5000);
await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 });
for (let i = 0; i < 6; i++) { await c.sleep(900); await c.shot(T + 'bept_water_drive' + i + '.png'); }
console.log(T, c.logs.filter((l) => !/Failed to connect|NETFAIL/.test(l)).slice(0, 10));
await c.close();
process.exit(0);
