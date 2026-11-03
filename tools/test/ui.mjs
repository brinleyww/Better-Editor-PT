// Real UI flow: Load -> Import a PolyTrackBE1 code, press Test, hold the gas, read the HUD.
import { openEditor, T } from './lib.mjs';
import fs from 'node:fs';
const c = await openEditor(9338, 1280, 800);
const vis = () => c.evaluate(`JSON.stringify([...document.querySelectorAll('button')].filter(b=>b.offsetParent).map(b=>b.innerText.trim()).filter(Boolean).slice(0,16))`);
const hook = await c.evaluate(`(()=>{window.webpackChunk.push([[Symbol()],{},r=>window.__req=r]);return 1})()`);
// Build the code from the game's own classes, as the editor's Export would.
const code = await c.evaluate(`(()=>{const req=__req,TD=req(9117).A,Sun=req(7929).A,P=req(494).A,H=req(2600).Hw;
  const t=new TD(1,new Sun(0)); let z=0;
  const add=(n,y=0,len=4,x=0,r=0,cp=0)=>{const id=P[n],d=H(id);t.addPart(x,y,z,id,r,0,0,d.detector&&d.detector.type==0?cp:null,d.startOffset?0:null);z-=len;};
  add('WoodStartRoad');for(let i=0;i<4;i++)add('WoodRoadStraight');add('PlasticFxTurboRoad');for(let i=0;i<4;i++)add('PlasticRoadStraight');add('PlasticCheckpointRoad');for(let i=0;i<4;i++)add('WoodRoadStraight');add('WoodFinishRoad');for(let i=0;i<8;i++)add('PlasticRoadStraight');
  return t.toExportString({name:'BE1 UI Test',author:'tester',lastModified:null});})()`);
fs.writeFileSync(T+'bept_ui_code.txt',code);
console.log('code',code.slice(0,20),code.length);
await c.clickText('Load'); await c.sleep(1500);
console.log('load', await vis());
await c.clickText('Import'); await c.sleep(1200);
console.log('import', await vis(), await c.evaluate(`document.querySelectorAll('textarea,input[type=text]').length`));
await c.evaluate(`(()=>{const a=[...document.querySelectorAll('textarea')].find(x=>x.offsetParent)||[...document.querySelectorAll('input[type=text]')].find(x=>x.offsetParent&&!x.classList.contains('tm-search'));const s=Object.getOwnPropertyDescriptor(a.constructor.prototype,'value').set;s.call(a,${JSON.stringify(code)});a.dispatchEvent(new Event('input',{bubbles:true}));return a.tagName})()`);
await c.sleep(500);
await c.shot(T+'bept_import.png');
console.log('after paste', await vis());
await c.clickText('Import'); await c.sleep(2500);
console.log('after import', await vis());
await c.clickText('Confirm'); await c.sleep(1500);
await c.clickText('Ok'); await c.sleep(1500);
await c.shot(T+'bept_imported.png');
console.log('editor state', await vis());
await c.clickText('Test'); await c.sleep(6000);
console.log('testing', (await c.evaluate('document.body.innerText')).replace(/\n+/g,' | ').slice(0,200));
await c.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});
for (let i=0;i<7;i++){ await c.sleep(2000); console.log(i,(await c.evaluate('document.body.innerText')).replace(/\n+/g,' | ').slice(0,120)); if(i==2) await c.shot(T+'bept_drive.png'); }
await c.shot(T+'bept_finish.png');
console.log(c.logs.filter(l=>!/Failed to connect|NETFAIL/.test(l)).slice(0,10));
await c.close(); process.exit(0);
