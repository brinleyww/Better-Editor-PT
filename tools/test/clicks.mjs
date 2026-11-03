// Real mouse and keyboard in the editor.
import { openEditor, T } from './lib.mjs';
const W=1000,H=670;
const c = await openEditor(9340, W, H);
await c.evaluate(`(()=>{window.webpackChunk.push([[Symbol()],{},r=>window.__req=r]);return 1})()`);
const out=(k,v)=>console.log(k,JSON.stringify(v));
const panel=`[...document.querySelectorAll('.part-panel.tm')].find(p=>!p.classList.contains('hidden'))`;
const rect=(sel)=>c.evaluate(`(()=>{const r=(${sel}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const realClick=async(x,y,button='left')=>{await c.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});await c.sleep(120);await c.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button,buttons:button=='left'?1:2,clickCount:1});await c.sleep(60);await c.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button,buttons:0,clickCount:1});await c.sleep(200);};
const key=async(k,code,vk)=>{await c.send('Input.dispatchKeyEvent',{type:'keyDown',key:k,code,windowsVirtualKeyCode:vk,text:k.length==1?k:undefined});await c.send('Input.dispatchKeyEvent',{type:'keyUp',key:k,code,windowsVirtualKeyCode:vk});};
const cats=await c.evaluate(`[...document.querySelectorAll('.category-panel button')].slice(0,4).map(b=>b.getBoundingClientRect().y|0)`);
out('category tops (Plastic and Wood right under erase)',cats);
const p=await rect(`document.querySelectorAll('.category-panel button')[1]`);
const t0=Date.now();await realClick(p.x,p.y);await c.waitFor(`(()=>{const p=${panel};return p&&[...p.querySelectorAll('.tm-grid button img')].filter(i=>i.getAttribute('src')).length>=6})()`,40000);
out('first thumbnails ms',Date.now()-t0);
out('thumbnails drawn vs total',await c.evaluate(`(()=>{const p=${panel},a=[...p.querySelectorAll('.tm-grid button img')];return [a.filter(i=>i.getAttribute('src')).length,a.length]})()`));
await c.shot(T+'bept_small.png');
// Place a block by clicking on the world
const count=()=>c.evaluate(`document.querySelector('.track-settings-container')?1:0`);
await realClick(330,380);await c.sleep(500);
await key('r','KeyR',82);await realClick(250,300);await c.sleep(500);
// Search typing must not move the camera or rotate
const s=await rect(`${panel}.querySelector('.tm-search')`);await realClick(s.x,s.y);
for(const ch of 'loop') await c.send('Input.dispatchKeyEvent',{type:'keyDown',key:ch,text:ch,code:'Key'+ch.toUpperCase()}),await c.send('Input.dispatchKeyEvent',{type:'keyUp',key:ch,code:'Key'+ch.toUpperCase()});
await c.sleep(600);
out('search value + matches',await c.evaluate(`(()=>{const p=${panel};return [p.querySelector('.tm-search').value,[...p.querySelectorAll('.tm-grid button')].filter(b=>!b.classList.contains('off')).length]})()`));
await c.sleep(2500);await c.shot(T+'bept_search.png');
await key('Escape','Escape',27);
out('search cleared',await c.evaluate(`${panel}.querySelector('.tm-search').value`));
// Scroll wheel over the list: list moves, height stays
const hgt=()=>c.evaluate(`document.body.innerText.match(/Height:\s*(\d+)/)?.[1]??null`);
const before=await hgt();
const li=await rect(`${panel}.querySelector('.tm-list')`);
await c.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:li.x,y:li.y});await c.sleep(200);
for(let i=0;i<4;i++){await c.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:li.x,y:li.y,deltaX:0,deltaY:300});await c.sleep(250);}
await c.sleep(600);
out('list scrollTop/scrollHeight/client, height before/after',[await c.evaluate(`(()=>{const l=${panel}.querySelector('.tm-list');return [l.scrollTop,l.scrollHeight,l.clientHeight]})()`),before,await hgt()]);
// Recent tab
await c.evaluate(`[...${panel}.querySelectorAll('.tm-tabs button')].find(b=>b.textContent=='Recent').click()`);await c.sleep(1200);await c.shot(T+'bept_recent.png');
out('recent shows',await c.evaluate(`[...${panel}.querySelectorAll('.tm-group:not(.off) .tm-grid button')].length`));
await c.evaluate(`[...${panel}.querySelectorAll('.tm-tabs button')].find(b=>b.textContent=='Road').click()`);
// Export dialog
await c.clickText('Export');await c.sleep(1500);
if(await c.evaluate(`[...document.querySelectorAll('button')].some(b=>b.offsetParent&&b.innerText.trim()=='Save')&&[...document.querySelectorAll('input[type=text]')].some(i=>i.offsetParent&&!i.classList.contains('tm-search')&&i.value=='')`)){
  await c.evaluate(`(()=>{const a=[...document.querySelectorAll('input[type=text]')].find(i=>i.offsetParent&&!i.classList.contains('tm-search')&&i.value=='');const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(a,'Click Test');a.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await c.sleep(300);await c.clickText('Save');await c.sleep(1500);
  await c.clickText('Export');await c.sleep(1500);
}
out('export dialog',await c.evaluate(`JSON.stringify({ta:[...document.querySelectorAll('textarea')].filter(x=>x.offsetParent).length,inputs:[...document.querySelectorAll('input')].filter(x=>x.offsetParent).map(i=>[i.type,(i.value||'').slice(0,20)]),btn:[...document.querySelectorAll('button')].filter(b=>b.offsetParent).map(b=>b.innerText.trim()).filter(Boolean).slice(0,14),text:[...document.querySelectorAll('*')].filter(e=>e.children.length==0&&e.offsetParent&&(e.textContent||'').startsWith('PolyTrack')).map(e=>[e.tagName,e.textContent.slice(0,20),e.textContent.length])})`));
await c.shot(T+'bept_export.png');
const code=await c.evaluate(`(()=>{const e=[...document.querySelectorAll('*')].find(e=>e.children.length==0&&e.offsetParent&&(e.textContent||'').startsWith('PolyTrack'));if(e)return e.textContent;const a=[...document.querySelectorAll('textarea,input')].find(x=>x.offsetParent&&(x.value||'').startsWith('PolyTrack'));return a?a.value:null})()`);
out('export code head',code&&code.slice(0,16));
if(code){const dec=await c.evaluate(`(()=>{const q=__req(9117).A.fromExportString(${JSON.stringify(code)});const o=[];q.trackData.forEachPart((x,y,z,id,r,a)=>o.push({name:__req(494).A[id],x,y,z,r,a}));return JSON.stringify(o)})()`);out('parts in the export',JSON.parse(dec));}
// Rotation check: game quaternion vs the physics integer matrices, for all 24 orientations
out('rotations match the renderer',await c.evaluate(`(()=>{const R=__req(5494),Three=__req(4922);let bad=0;for(let a=0;a<6;a++)for(let r=0;r<4;r++){const q=R.hT(r,a),M=TM.data.rotations[a][r];for(const v of [[1,2,3],[-4,5,-6]]){const w=new Three.Pq0(v[0],v[1],v[2]).applyQuaternion(q);const m=[M[0]*v[0]+M[1]*v[1]+M[2]*v[2],M[3]*v[0]+M[4]*v[1]+M[5]*v[2],M[6]*v[0]+M[7]*v[1]+M[8]*v[2]];if(Math.abs(w.x-m[0])+Math.abs(w.y-m[1])+Math.abs(w.z-m[2])>1e-5)bad++;}}return {bad,of:48}})()`));
console.log(c.logs.filter(l=>!/Failed to connect|NETFAIL/.test(l)).slice(0,10));
await c.close();process.exit(0);
