// The Scenery category in the editor: its button comes right after Grass, its tabs, and every block's colour buttons.
// Collects the colour buttons' own thumbnails (the game draws them, as for its stock blocks) for every scenery block
// and lays them out as contact sheets, one row per block: Summer, Winter, Desert, then the nine custom colours.
// node tools/test/scenery_colours.mjs   (GPU=1 for the graphics card; TMPORT: the site's port)
// Writes bept-scenery_categories.png, bept-scenery_panel.png and bept-scenery_colours_<n>.png to the temp folder.
import { openEditor, T } from './lib.mjs';

const c = await openEditor(9364, 1400, 900);
const cats = await c.evaluate(`[...document.querySelectorAll('.category-panel > button')].map(b=>b.querySelector('.tm-cat-label')?.textContent||'?')`);
console.log('categories:', cats.join(', '));
const gi = cats.indexOf('Grass'),
  si = cats.indexOf('Scenery');
console.log(si == gi + 1 ? 'Scenery comes right after Grass' : 'FAIL: Scenery is at ' + si + ', Grass at ' + gi);
await c.evaluate(`[...document.querySelectorAll('.category-panel > button')].find(b=>b.querySelector('.tm-cat-label')?.textContent=='Scenery').click()`);
await c.sleep(1500);
const tabs = await c.evaluate(`[...document.querySelectorAll('.part-panel.tm:not(.hidden) .tm-tabs button')].filter(b=>!b.classList.contains('empty')).map(b=>b.textContent)`);
console.log('tabs:', tabs.join(', '));
await c.shot(T + 'scenery_categories.png');

const ids = await c.evaluate(`self.TM.data.parts.filter(p=>p.n.startsWith('Scenery')).map(p=>[p.i,p.l,p.t])`);
const rows = [];
for (const [id, label, tab] of ids) {
  // Open the block's tab, then pick it, the way a click in the list does.
  await c.evaluate(`[...document.querySelectorAll('.part-panel.tm:not(.hidden) .tm-tabs button')].find(b=>b.textContent==${JSON.stringify(tab)})?.click()`);
  await c.sleep(150);
  await c.evaluate(`document.querySelector('.part-panel.tm:not(.hidden) button[data-tm="${id}"]').click()`);
  await c.waitFor(`(()=>{const p=[...document.querySelectorAll('.color-panel')].find(p=>!p.classList.contains('hidden'));return !!p&&[...p.querySelectorAll('img')].every(i=>i.getAttribute('src')&&i.className!='loading')})()`, 60000);
  const srcs = await c.evaluate(`[...[...document.querySelectorAll('.color-panel')].find(p=>!p.classList.contains('hidden')).querySelectorAll('img')].map(i=>i.src)`);
  rows.push([label, srcs]);
  if (rows.length == 3) await c.shot(T + 'scenery_panel.png');
}
console.log('colour buttons per block:', [...new Set(rows.map((r) => r[1].length))].join(', '), '(Default plus 12)');
// Identical thumbnails in a row would mean a colour that does nothing on that block.
let same = 0;
for (const [label, srcs] of rows) {
  const s = srcs.slice(1);
  const dup = s.length - new Set(s).size;
  if (dup) (same++, console.log('  ' + label + ': ' + dup + ' colour buttons look the same as another'));
}
console.log(same ? same + ' blocks have colours that look alike' : 'every colour button of every block looks different');

const head = ['Summer', 'Winter', 'Desert', 'Black', 'Red', 'Orange', 'Yellow', 'Green', 'Teal', 'Blue', 'Purple', 'Brown'];
const per = 9;
for (let k = 0; k * per < rows.length; k++) {
  const part = rows.slice(k * per, (k + 1) * per);
  const html = `<body style="margin:0;background:#1c1846;color:#fff;font:14px sans-serif"><table style="border-collapse:collapse">` +
    `<tr><td></td>${head.map((h) => `<td style="text-align:center;padding:2px">${h}</td>`).join('')}</tr>` +
    part.map(([l, s]) => `<tr><td style="padding:0 6px;white-space:nowrap">${l}</td>${s.slice(1).map((u) => `<td style="padding:1px"><img src="${u}" style="width:80px;height:80px;display:block;background:#2c2770"></td>`).join('')}</tr>`).join('') +
    `</table></body>`;
  await c.evaluate(`(()=>{document.open();document.write(${JSON.stringify(html)});document.close();return 1})()`);
  await c.sleep(600);
  await c.shot(T + 'scenery_colours_' + k + '.png', { x: 0, y: 0, width: 1140, height: 24 + part.length * 82 });
}
await c.close();
