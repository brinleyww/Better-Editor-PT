// Colours, undo, environment switch, save, full page reload, load from Custom tracks, replay of a saved run.
import { openEditor, T } from './lib.mjs';
const c = await openEditor(9341, 1280, 800);
await c.evaluate(`(()=>{window.webpackChunk.push([[Symbol()],{},r=>window.__req=r]);return 1})()`);
const out=(k,v)=>console.log(k,JSON.stringify(v));
const panel=`[...document.querySelectorAll('.part-panel.tm')].find(p=>!p.classList.contains('hidden'))`;
const rect=(sel)=>c.evaluate(`(()=>{const r=(${sel}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const realClick=async(x,y)=>{await c.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});await c.sleep(350);await c.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});await c.sleep(80);await c.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});await c.sleep(400);};
const p=await rect(`document.querySelectorAll('.category-panel button')[2]`);await realClick(p.x,p.y);await c.sleep(1500); // Wood
// Pick the first custom colour from the colour column
const cp=await rect(`[...document.querySelectorAll('.color-panel')].find(x=>!x.classList.contains('hidden')).children[5]`);await realClick(cp.x,cp.y);await c.sleep(1000);
await realClick(300,420);await c.sleep(600);await realClick(300,250);await c.sleep(600);
const undo=await rect(`document.querySelector('.undo-container button')`);
await realClick(undo.x,undo.y);await c.sleep(500);
const redoBtn=await rect(`document.querySelectorAll('.undo-container button')[1]`);
await realClick(redoBtn.x,redoBtn.y);await c.sleep(500);
await c.shot(T+'bept_color.png');
// Environment switch through track settings, then give it a name and save
await c.clickText('Save');await c.sleep(1200);
await c.evaluate(`(()=>{const a=[...document.querySelectorAll('input[type=text]')].find(i=>i.offsetParent&&!i.classList.contains('tm-search'));const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(a,'Persist Test');a.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await c.clickText('Winter');await c.sleep(1500);await c.shot(T+'bept_winter_settings.png');
await c.clickText('Save');await c.sleep(1500);await c.clickText('Confirm');await c.sleep(800);
out('thumbs after env switch',await c.evaluate(`(()=>{const p=${panel},a=[...p.querySelectorAll('.tm-grid button img')];return a.filter(i=>i.getAttribute('src')).length})()`));
await c.sleep(3000);await c.shot(T+'bept_winter.png');
out('saved key',await c.evaluate(`(()=>{const k=Object.keys(localStorage).filter(k=>k.includes('track_'));return k.map(n=>{let d='';try{d=(JSON.parse(localStorage[n]).data||'').slice(0,14)}catch{d=String(localStorage[n]).slice(0,14)}return [n,d]})})()`));
// Reload the whole page and load it from Custom tracks
await c.send('Page.navigate',{url:'http://127.0.0.1:8123/Better-Editor-PT/'});
await c.waitFor(`[...document.querySelectorAll('button')].some(b=>b.innerText.trim()=='Editor'&&b.offsetParent)`,60000);await c.sleep(800);
await c.clickText('Editor');await c.sleep(4000);
await c.clickText('Load');await c.sleep(1200);await c.clickText('Custom tracks');await c.sleep(1200);
const listed=await c.evaluate(`[...document.querySelectorAll('button')].filter(b=>b.offsetParent).map(b=>b.innerText.trim().slice(0,24)).filter(Boolean).slice(0,12)`);
out('custom tracks',listed);
const opened=await c.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.offsetParent&&b.innerText.trim().startsWith('Persist Test'));if(b){b.click();return true}return false})()`);
await c.sleep(1500);await c.clickText('Load');await c.sleep(600);await c.clickText('Edit');await c.sleep(3000);
out('opened',opened);out('title',await c.evaluate(`document.querySelector('.track-settings-container')?.innerText`));
await c.shot(T+'bept_reloaded.png');
console.log(c.logs.filter(l=>!/Failed to connect|NETFAIL/.test(l)).slice(0,10));
await c.close();process.exit(0);
