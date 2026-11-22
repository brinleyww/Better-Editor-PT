// Renders Auto deco's objects on their own: node tools/autodeco/bench.js <out dir> [theme] [names...]
// Loads tm_autodeco.js the way the page does (with tm_parts.js and tm_autodeco_data.js); one picture per object, three
// copies (seeds) side by side, seen from two corners.
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
global.self = global;
require(path.join(ROOT, 'tm_parts.js'));
require(path.join(ROOT, 'tm_autodeco_data.js'));
require(path.join(ROOT, 'tm_autodeco.js'));
const { render } = require('./render.js');

const out = process.argv[2] || path.join(ROOT, 'tools', 'autodeco', 'out');
const onlyTheme = process.argv[3];
const want = process.argv.slice(4);
const E = self.TM.autodeco.engine;
(async () => {
  for (const theme of Object.keys(E.THEMES)) {
    if (onlyTheme && onlyTheme != theme) continue;
    const objs = E.objectsFor(theme);
    for (const n of Object.keys(objs)) {
      if (want.length && !want.includes(n)) continue;
      const parts = [];
      for (let s = 0; s < 3; s++) parts.push(...E.move(objs[n](E.rng(s * 7 + 1)), s * 20, 0, 0));
      const f = await render(parts, path.join(out, theme + '_' + n + '.png'), { view: [0, 2], size: 520, pitch: 18 });
      console.log(f, parts.length, 'parts');
    }
  }
})();
