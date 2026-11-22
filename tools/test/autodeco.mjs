// Auto deco in the editor: imports a track code, decorates it from the Auto deco panel with each theme given, checks
// that one undo takes the whole decoration away again, and takes screenshots from above and from beside the route.
// node tools/test/autodeco.mjs <code file> [theme ...]   (GPU=1 for the graphics card, as the game really looks)
// Screenshots: bept-autodeco_<theme>_<n>.png in the temp folder.
import { openEditor, T } from './lib.mjs';
import fs from 'node:fs';

const [file, ...asked] = process.argv.slice(2);
const themes = asked.length ? asked : ['meadow'];
const code = fs.readFileSync(file, 'utf8').trim();
const c = await openEditor(9361, 1400, 860);
await c.clickText('Load');
await c.sleep(1200);
await c.clickText('Import');
await c.sleep(1000);
await c.evaluate(`(()=>{const a=[...document.querySelectorAll('textarea')].find(x=>x.offsetParent);const s=Object.getOwnPropertyDescriptor(a.constructor.prototype,'value').set;s.call(a,${JSON.stringify(code)});a.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await c.sleep(400);
await c.clickText('Import');
await c.sleep(6000);

const count = () => c.evaluate(`(()=>{let n=0;self.__beCupEditor.scene().getTrackData().forEachPart(()=>n++);return n})()`);
const bounds = () =>
  c.evaluate(`(()=>{const b=[1e9,1e9,1e9,-1e9,-1e9,-1e9];self.__beCupEditor.scene().getTrackData().forEachPart((x,y,z)=>{b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.min(b[2],z);b[3]=Math.max(b[3],x);b[4]=Math.max(b[4],y);b[5]=Math.max(b[5],z)});return b.map(v=>v*5)})()`);
const before = await count();
console.log('track parts', before, 'errors so far', await c.evaluate('JSON.stringify(window.__errs||[])'));
await c.evaluate(`(()=>{window.__errs=[];window.addEventListener('error',e=>window.__errs.push(String(e.message)));return 1})()`);

let prev = before;
for (const theme of themes) {
  prev = await count();
  await c.evaluate(`(()=>{const p=document.querySelector('.be-ad-panel');if(!p)return 'no panel';if(p.hidden)document.querySelector('.be-ad-tab > .button').click();return 1})()`);
  await c.sleep(300);
  const label = theme[0].toUpperCase() + theme.slice(1);
  await c.evaluate(`(()=>{const b=[...document.querySelectorAll('.be-ad-seg > .button')].find(b=>b.textContent==${JSON.stringify(label)});b&&b.click();return !!b})()`);
  const t0 = Date.now();
  await c.evaluate(`(()=>{[...document.querySelectorAll('.be-ad-foot > .button')].find(b=>b.textContent=='Decorate').click();return 1})()`);
  await c.sleep(300);
  await c.evaluate(`(()=>{const b=[...document.querySelectorAll('.be-ad-ask .button')].find(b=>b.offsetParent&&b.textContent=='Decorate anyway');if(b)b.click();return !!b})()`);
  await c.waitFor(`/^(Added|Auto deco failed)/.test(document.querySelector('.be-ad-status')?.textContent||'')`, 60000);
  const status = await c.evaluate(`document.querySelector('.be-ad-status').textContent+' | '+[...document.querySelectorAll('.be-ad-notes li')].map(l=>l.textContent).join(' | ')`);
  const after = await count();
  console.log(theme, 'in', Date.now() - t0, 'ms:', after - before, 'parts added.', status);
  await c.sleep(2500);
  await c.shot(T + 'autodeco_' + theme + '_panel.png');
  // Hide the panel for the views.
  await c.evaluate(`(()=>{const p=document.querySelector('.be-ad-panel');if(!p.hidden)document.querySelector('.be-ad-tab > .button').click();return 1})()`);
  const b = await bounds();
  const cx = (b[0] + b[3]) / 2,
    cy = (b[1] + b[4]) / 2,
    cz = (b[2] + b[5]) / 2,
    ext = Math.max(b[3] - b[0], b[5] - b[2], 100);
  const views = [
    [cx + ext * 0.55, cy + ext * 0.55, cz + ext * 0.55, cx, cy, cz],
    [cx - ext * 0.35, cy + ext * 0.25, cz - ext * 0.1, cx + ext * 0.1, cy, cz],
    [cx + ext * 0.05, cy + ext * 0.12, cz + ext * 0.4, cx - ext * 0.1, cy, cz - ext * 0.1],
  ];
  for (const [i, v] of views.entries()) {
    await c.evaluate(`self.__beCupView(${JSON.stringify(v)})`);
    await c.sleep(1800);
    await c.shot(T + 'autodeco_' + theme + '_' + i + '.png');
  }
}
// One undo takes the last decoration away.
await c.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.offsetParent&&/undo/i.test(b.title||b.getAttribute('aria-label')||b.innerText));if(b){b.click();return 'button'}document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',ctrlKey:true,bubbles:true}));return 'key'})()`);
await c.sleep(1500);
console.log('after undo', await count(), '(before the last decoration:', prev + ')', 'page errors', await c.evaluate('JSON.stringify(window.__errs)'));
console.log('screenshots in', T + 'autodeco_*');
await c.close();
process.exit(0);
