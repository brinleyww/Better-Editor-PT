import { launch } from './cdp.mjs';
import os from 'node:os';
import path from 'node:path';
// Screenshots and logs go to the system temp folder.
export const T = path.join(os.tmpdir(), 'bept-') ;
export async function openEditor(port, width=1280, height=800, hook) {
  const c = await launch({ port, width, height });
  if (hook) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: hook });
  await c.send('Page.navigate', { url: 'http://127.0.0.1:8123/Better-Editor-PT/' });
  c.clickText = (t) => c.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==${JSON.stringify(t)}&&b.offsetParent);if(b){b.click();return true}return false})()`);
  await c.waitFor(`[...document.querySelectorAll('button')].some(b=>b.innerText.trim()=='Exit'&&b.offsetParent)`, 90000);
  await c.sleep(1500); await c.clickText('Exit'); await c.sleep(2500);
  await c.clickText('Back'); await c.sleep(2000);
  await c.clickText('Editor'); await c.sleep(5000);
  return c;
}
