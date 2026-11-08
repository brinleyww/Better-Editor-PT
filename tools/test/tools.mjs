// Editor tools: two Test runs on a short wood track, then back in the editor the driving line, the runs panel and
// the hover readout. Then a recovery copy: an edit, a reload, and the offer to restore. node tools/test/tools.mjs
// Screenshots: bept-tools_line.png (line and panel), bept-tools_recover.png (the restore offer).
import { openEditor, T } from './lib.mjs';
const c = await openEditor(9352, 1280, 800);
await c.evaluate(`(()=>{window.webpackChunk.push([[Symbol()],{},r=>window.__req=r]);return 1})()`);
const code = await c.evaluate(`(()=>{const req=__req,TD=req(9117).A,Sun=req(7929).A,P=req(494).A,H=req(2600).Hw;
  const t=new TD(0,new Sun(0));
  const add=(n,x,y,z,r=0)=>{const id=P[n];if(id==null)throw new Error(n);const d=H(id);t.addPart(x,y,z,id,r,0,0,d.detector&&d.detector.type==0?0:null,d.startOffset?0:null);};
  add('WoodStartRoad',0,0,0);
  for(let i=1;i<8;i++)add('WoodRoadStraight',0,0,-4*i);
  add('WoodCheckpointRoad',0,0,-32);
  for(let i=9;i<14;i++)add('WoodRoadStraight',0,0,-4*i);
  add('WoodFinishRoad',0,0,-56);
  return t.toExportString({name:'Tools'+Date.now(),author:'tester',lastModified:null});})()`);
await c.clickText('Load'); await c.sleep(1200); await c.clickText('Import'); await c.sleep(1000);
await c.evaluate(`(()=>{const a=[...document.querySelectorAll('textarea')].find(x=>x.offsetParent);const s=Object.getOwnPropertyDescriptor(a.constructor.prototype,'value').set;s.call(a,${JSON.stringify(code)});a.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await c.sleep(400); await c.clickText('Import'); await c.sleep(5000);
const key = (type, k, code, vk) => c.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk });
const visibleButtons = () => c.evaluate(`JSON.stringify([...document.querySelectorAll('button')].filter(b=>b.offsetParent).map(b=>b.innerText.trim()).filter(Boolean))`);
for (const steer of [null, 'ArrowLeft']) {
  await c.clickText('Test'); await c.sleep(5000);
  await key('keyDown', 'ArrowUp', 'ArrowUp', 38);
  await c.sleep(2500);
  if (steer) { await key('keyDown', steer, steer, 37); await c.sleep(500); await key('keyUp', steer, steer, 37); }
  await c.sleep(5000);
  await key('keyUp', 'ArrowUp', 'ArrowUp', 38);
  // A finish goes back to the editor by itself; otherwise Escape opens the menu that leaves Test.
  const inEditor = () => c.evaluate('!!document.querySelector(".be-runs:not([hidden])")');
  if (!(await inEditor())) {
    await key('keyDown', 'Escape', 'Escape', 27); await key('keyUp', 'Escape', 'Escape', 27); await c.sleep(1200);
    console.log('buttons in test', await visibleButtons());
    for (const b of ['Back to editor', 'Edit', 'Back']) if (await c.clickText(b)) { console.log('left test with', b); break; }
    await c.sleep(3000);
  }
}
console.log('panel', await c.evaluate(`(()=>{const p=document.querySelector('.be-runs');return p&&JSON.stringify({hidden:p.hidden,title:p.querySelector('.be-title').textContent,runs:[...p.querySelectorAll('li')].map(l=>l.textContent)})})()`));
console.log('runs', await c.evaluate(`JSON.stringify(self.TM.tools.runs().map(r=>({id:r.id,n:r.pts.length,finish:r.finish,first:r.pts[0],last:r.pts[r.pts.length-1],gaps:r.pts.filter(p=>p.gap).length})))`));
console.log('drawn', await c.evaluate('JSON.stringify(self.TM.tools.drawn())'));
await c.shot(T + 'tools_line.png');
// Hover the line for its readout, then move the camera to where the selected run ended.
for (let x = 700; x <= 820; x += 4) { await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: 355 + (x - 640) * 0.58 }); await c.sleep(25); if (await c.evaluate('!document.querySelector(".be-tip").hidden')) break; }
console.log('tip', await c.evaluate('document.querySelector(".be-tip").hidden ? "none" : document.querySelector(".be-tip").textContent'));
await c.shot(T + 'tools_hover.png');
await c.clickText('Go to end'); await c.sleep(800);
await c.shot(T + 'tools_end.png');
// Recovery: a stored copy of unsaved changes is offered when the editor opens again.
await c.evaluate(`localStorage.setItem("be-recovery", JSON.stringify({ name: "Recovered", code: ${JSON.stringify(code)}, time: Date.now() - 180000 }))`);
await c.evaluate('window.addEventListener("beforeunload", (e) => e.stopImmediatePropagation(), true), 1'); // no leave-page prompt
await c.send('Page.reload'); await c.sleep(4000);
// A second visit skips the first-launch screens and lands on the main menu.
await c.waitFor(`[...document.querySelectorAll('button')].some(b=>/^(Exit|Editor)$/.test(b.innerText.trim())&&b.offsetParent)`, 90000);
await c.sleep(1500);
if (!(await c.clickText('Editor'))) { await c.clickText('Exit'); await c.sleep(2500); await c.clickText('Back'); await c.sleep(2000); await c.clickText('Editor'); }
await c.sleep(5000);
console.log('offer', await c.evaluate('(()=>{const r=document.querySelector(".be-recover");return r&&!r.hidden?r.querySelector("span").textContent:"none"})()'));
await c.shot(T + 'tools_recover.png');
await c.clickText('Restore'); await c.sleep(3000);
console.log('restored track', await c.evaluate('[...document.querySelectorAll("button")].filter(b=>b.offsetParent).map(b=>b.innerText.trim()).find(t=>/^Tools/.test(t)) ?? "not found"'));
console.log(c.logs.filter((l) => /error/i.test(l) && !/Failed to connect|NETFAIL/.test(l)).slice(0, 10));
await c.close();
process.exit(0);
