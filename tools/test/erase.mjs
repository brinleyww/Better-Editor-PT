// The eraser has no block data: picking it and moving over the world must not crash.
import { openEditor } from './lib.mjs';
const c = await openEditor(9341, 1000, 670);
const move = async (x, y) => {
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await c.sleep(150);
};
await c.evaluate(`document.querySelectorAll('.category-panel button')[0].click()`);
await c.sleep(800);
for (const [x, y] of [[330, 380], [400, 350], [500, 420]]) await move(x, y);
await c.sleep(800);
const crashed = await c.evaluate(`/unexpected error/i.test(document.body.innerText)`);
console.log('crash screen', crashed);
console.log(c.logs.filter((l) => /error/i.test(l) && !/Failed to connect|NETFAIL/.test(l)).slice(0, 5));
await c.close();
process.exit(crashed ? 1 : 0);
