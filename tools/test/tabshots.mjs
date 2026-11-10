// Screenshots of block browser tabs: node tools/test/tabshots.mjs <out folder> "Road/Open road" "Plastic/Blocks" ...
import { openEditor } from './lib.mjs';
const [out, ...pairs] = process.argv.slice(2);
const c = await openEditor(9345, 1280, 900);
for (const pair of pairs) {
  const [cat, tab] = pair.split('/');
  await c.evaluate(`[...document.querySelectorAll('.category-panel > button')].find(b=>b.title==${JSON.stringify(cat)}).click()`);
  await c.sleep(800);
  const ok = await c.evaluate(`(()=>{const p=[...document.querySelectorAll('.part-panel.tm')].find(p=>!p.classList.contains('hidden'));const b=[...p.querySelectorAll('.tm-tabs button')].find(b=>b.textContent==${JSON.stringify(tab)});if(!b)return false;b.click();return true})()`);
  if (!ok) {
    console.log(pair, 'no such tab');
    continue;
  }
  // Thumbnails draw as they scroll into view: walk down the list, then shoot each screenful.
  const pages = await c.evaluate(`(()=>{const l=[...document.querySelectorAll('.part-panel.tm')].find(p=>!p.classList.contains('hidden')).querySelector('.tm-list');return Math.ceil(l.scrollHeight/l.clientHeight)})()`);
  for (let i = 0; i < Math.min(pages, 4); i++) {
    await c.evaluate(`(()=>{const l=[...document.querySelectorAll('.part-panel.tm')].find(p=>!p.classList.contains('hidden')).querySelector('.tm-list');l.scrollTop=${i}*l.clientHeight;})()`);
    for (let k = 0; k < 40; k++) {
      await c.sleep(500);
      if (await c.evaluate(`(()=>{const p=[...document.querySelectorAll('.part-panel.tm')].find(p=>!p.classList.contains('hidden'));const r=p.getBoundingClientRect();return [...p.querySelectorAll('.tm-grid button:not(.off) img')].filter(i=>{const b=i.getBoundingClientRect();return b.bottom>r.top&&b.top<r.bottom}).every(i=>i.getAttribute('src')&&i.className!='loading')})()`)) break;
    }
    const r = JSON.parse(await c.evaluate(`(()=>{const b=[...document.querySelectorAll('.part-panel.tm')].find(p=>!p.classList.contains('hidden')).getBoundingClientRect();return JSON.stringify({x:b.x,y:b.y,width:b.width,height:b.height})})()`));
    await c.shot(out + '/' + pair.replace(/[^a-z0-9]+/gi, '_') + '_' + i + '.png', r);
  }
  console.log(pair, pages, 'pages');
}
console.log(c.logs.filter((l) => /error/i.test(l) && !/Failed to connect|NETFAIL/.test(l)).slice(0, 10));
await c.close();
process.exit(0);
