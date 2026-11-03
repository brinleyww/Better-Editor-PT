// Minimal Chrome DevTools helper: launches its own headless Chrome with a throwaway profile.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export async function launch({ port = 9333, width = 1280, height = 800, url = 'about:blank' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bept-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + dir,
    '--window-size=' + width + ',' + height, '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required', url], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 100; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); target = l.find(t => t.type === 'page'); if (target) break; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  if (!target) throw new Error('no chrome target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const wait = new Map(), logs = [];
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data);
    if (m.id && wait.has(m.id)) { const { res, rej } = wait.get(m.id); wait.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    else if (m.method === 'Network.loadingFailed' && !m.params.canceled) logs.push('NETFAIL: ' + m.params.errorText + ' ' + (m.params.requestId));
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; wait.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const evaluate = async (expression, awaitPromise = true) => { const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const shot = async (file, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const waitFor = async (expr, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await evaluate(expr)) return true; await sleep(250); } throw new Error('timeout: ' + expr); };
  const close = async () => { try { await send('Browser.close'); } catch {} try { proc.kill(); } catch {} };
  return { send, evaluate, shot, sleep, waitFor, close, logs, ws };
}
