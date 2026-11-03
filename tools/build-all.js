// Full rebuild of the game at the repo root from the untouched game files. Run: node tools/build-all.js
const { execFileSync } = require('child_process');
const path = require('path');
const run = (f) => execFileSync(process.execPath, ['--max-old-space-size=8192', path.join(__dirname, f)], { stdio: 'inherit' });
run('deobfuscate.js');
run('blocks/build.js');
run('patch.js');
