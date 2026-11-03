// Static server for the game at the repo root, mounted under a sub-path the way GitHub Pages does.
// node tools/test/server.js [port]  ->  http://localhost:<port>/Better-Editor-PT/
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const prefix = '/Better-Editor-PT/';
const types = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.wasm':'application/wasm', '.svg':'image/svg+xml', '.glb':'model/gltf-binary', '.jpg':'image/jpeg', '.png':'image/png', '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf', '.bin':'application/octet-stream', '.mp3':'audio/mpeg', '.ogg':'audio/ogg' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (!p.startsWith(prefix)) { res.writeHead(404); return res.end('outside site'); }
  p = p.slice(prefix.length) || 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}).listen(+process.argv[2] || 8123, '127.0.0.1');
