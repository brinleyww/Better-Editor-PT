// Screenshots the labelled category column and the placement ghost of a wood and a plastic block.
import { openEditor, T } from './lib.mjs';
const c = await openEditor(9346, 1280, 800);
const rect = (sel) => c.evaluate(`(()=>{const r=(${sel}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const move = async (x, y) => { for (let i = 0; i < 6; i++) { await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + i, y }); await c.sleep(120); } };
console.log('labels', await c.evaluate(`[...document.querySelectorAll('.category-panel .tm-cat-label')].map(l=>l.textContent)`));
for (const [n, name] of [[2, 'wood'], [1, 'plastic']]) {
  const b = await rect(`document.querySelectorAll('.category-panel button')[${n}]`);
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y });
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', buttons: 1, clickCount: 1 });
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1 });
  await c.sleep(2500);
  await move(320, 360);
  await c.sleep(1200);
  console.log(name, 'title', await c.evaluate(`[...document.querySelectorAll('.part-panel.tm')].find(p=>!p.classList.contains('hidden')).querySelector('.tm-title').textContent`));
  await c.shot(T + 'ghost_' + name + '.png');
}
console.log(c.logs.filter((l) => !/Failed to connect|NETFAIL/.test(l)).slice(0, 10));
await c.close();
process.exit(0);
