// Run before committing a change to how cars drive: tm_runtime.js physics, collision meshes, or a part's physics data.
// It raises physics.json's version and records HEAD (which still has the old physics) as that version's copy.
// Not So Weekly Shorts then moves the old version's leaderboard times to an Old physics board and replays them on that commit.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const file = path.join(__dirname, '..', 'physics.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const head = execSync('git rev-parse HEAD', { cwd: path.dirname(file) }).toString().trim();
if (!/^[0-9a-f]{40}$/.test(head)) throw new Error('No HEAD commit');
data.old = { ...data.old, [data.version]: head };
data.version += 1;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log('physics.json: version ' + data.version + ', version ' + (data.version - 1) + ' kept at ' + head);
