// A block browser: opens the editor, picks a category (default Road: node tools/test/roadmenu.mjs Water), lists its tabs and headings and screenshots it.
import { openEditor, T } from './lib.mjs';
const c = await openEditor(9339, 1280, 800);
const cats = await c.evaluate(`JSON.stringify([...document.querySelectorAll('.category-panel > button')].map(b=>b.title))`);
console.log('categories', cats);
await c.evaluate(`[...document.querySelectorAll('.category-panel > button')].find(b=>b.title==${JSON.stringify(process.argv[2] || 'Road')}).click()`);
await c.sleep(1500);
console.log('panel', await c.evaluate(`(()=>{const p=[...document.querySelectorAll('.part-panel.tm')].find(p=>!p.classList.contains('hidden'));if(!p)return 'none';
  return JSON.stringify({title:p.querySelector('.tm-title').textContent,tabs:[...p.querySelectorAll('.tm-tabs button:not(.empty)')].map(b=>b.textContent),
  headings:[...p.querySelectorAll('.tm-heading:not(.off)')].map(h=>h.textContent),blocks:p.querySelectorAll('.tm-grid button').length})})()`));
await c.shot(T + 'bept_roadmenu.png');
console.log(c.logs.filter((l) => /error/i.test(l) && !/Failed to connect|NETFAIL/.test(l)).slice(0, 10));
await c.close();
process.exit(0);
