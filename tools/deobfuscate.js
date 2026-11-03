// Formats every minified bundle from _original/app into _original/formatted and copies the assets to site/.
// tools/patch.js then applies the Better Editor changes on top. Run: node tools/deobfuscate.js
const fs = require('fs');
const path = require('path');
const prettier = require('prettier');

const root = path.join(__dirname, '..');
const from = path.join(root, '_original', 'app');
const to = path.join(root, 'site');
const formatted = path.join(root, '_original', 'formatted');
const skip = new Set(['electron', 'package.json']);

async function main() {
  fs.mkdirSync(to, { recursive: true });
  fs.mkdirSync(formatted, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (skip.has(name)) continue;
    const src = path.join(from, name);
    const dst = path.join(to, name);
    if (name.endsWith('.bundle.js')) {
      const code = fs.readFileSync(src, 'utf8');
      const out = await prettier.format(code, { parser: 'acorn', printWidth: 110 });
      fs.writeFileSync(path.join(formatted, name), out);
      fs.writeFileSync(dst, out);
      console.log(name, code.length, '->', out.length);
    } else if (name == 'index.html') {
      fs.copyFileSync(src, path.join(formatted, name));
    } else {
      fs.cpSync(src, dst, { recursive: true });
    }
  }
}
main();
