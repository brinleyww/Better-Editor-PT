# Better Editor PT

PolyTrack 0.6.2 as a static web site, with 1,142 extra editor blocks (492 plastic, 492 wood, 158 Stadium) and a new export code format for them.

## Publish on GitHub Pages

Everything the site needs is in `site/`. Publish that folder as the Pages root, either by pushing its contents to a repository or with a GitHub Actions Pages deploy of `site/`. It uses relative paths, so a sub-path such as `username.github.io/repo/` works. `site/.nojekyll` is already there.

To try it locally, run this and open http://127.0.0.1:8123/Better-Editor-PT/ :

```bash
node tools/test/server.js 8123
```

## Folders

| Folder | Contents |
|---|---|
| `site/` | The finished game |
| `_original/` | Untouched 0.6.2 files, and the formatted bundles the patches apply to |
| `tools/blocks/` | Block generator. Add blocks in `catalog.js` |
| `tools/patch.js` | Every change to the original bundles. Each edit stops the build if it no longer matches |
| `tools/test/` | Automated tests that drive the game in headless Chrome |
| `docs/` | `BLOCKS.md`, `TRACK_CODE_FORMAT.md`, `MODULE_MAP.md` |

## Rebuilding

`tools/` needs `npm install` once. Then:

```bash
node tools/build-all.js
```

After changing only blocks, run `node tools/blocks/build.js`. After changing only patches, run `node tools/patch.js`. `site/tm_runtime.js` and `site/tm_menu.js` are edited directly.

Never renumber `tools/blocks/ids.json`, or existing track codes will break.

## How the new blocks work

- **Models:** every block is generated from the measured stock road, plane and slope dimensions, so new blocks line up with stock ones. Geometry is in `models/tm_blocks.bin`.
- **Loading:** a block's mesh is built the first time it is needed, and thumbnails are drawn only when on screen.
- **Physics:** the physics wasm reads part ids as one byte, so new blocks are added to the terrain collision mesh instead. Gates use 23 spare one-byte ids for their trigger boxes.
- **Effects:** turbo, no engine and the other plates run in the physics worker every frame, so replays and verification match.
- **Surfaces:** each wheel checks which block it is touching every physics frame and gets that surface's grip (the wheel's friction slip in the physics engine). The values are in `SURFACES` in `site/tm_runtime.js`.
  - **Wood:** very high grip, so the tyres never let go and the car cannot drift. Braking is a little shorter than on stock road.
  - **Plastic:** very low grip, rear lower than front, so the car slides and the tail steps out. Extra push off the line that fades out by about 160 km/h. A hard hit on the car's side or roof throws it back off the plastic.
  - **Penalty grass:** soft grip and heavy drag, so the car crawls at about 60 km/h. It comes as whole blocks (Stadium, Penalty grass) and as grass strips inside plastic and wood blocks (each surface's Penalty grass tab), where only the grass part slows you.
  - Stock blocks, the ground and tracks without new blocks keep stock physics exactly.
  - Wood's extra grip is a fixed amount sized at the tyre's resting load, so under the heavy load in a loop it is close to stock grip and steering does not spin the car.
  - Offset loops ease the sideways shift in and out, and both surfaces use the stock rail outline, whose sloped face guides the car across the offset.
- **Looks:** wood is planks in four tones with dark seams, staggered joints and posts along the rails. Plastic is 5 x 5 moulded panels in two shades with light seams and blue and white kerbs. Penalty grass is a mowed checker. These patterns are flat strips of colour on the deck.
- **Collision meshes:** each block also stores a plain version of itself without the pattern strips, and that is what the physics uses. The detail costs drawing time only: 833k drawn triangles, 303k collision triangles. Rail posts are drawn but never collide.
- **Boosters and effects** (plates on road, open road and platform, plus Stadium special gates):
  - Turbo, super turbo: a push that is strongest as you cross and fades out (1.0 s and 1.4 s).
  - Turbo roulette: lands on turbo, super or an even stronger turbo, depending on the exact frame you cross it.
  - Reactor boost (up/down) and super reactor boost (up/down): 6 s of thrust along the car's own up axis. Up stretches jumps, down presses the car onto any surface. In the air the gas pushes along the nose and steering turns the car.
  - Slow motion: the car runs at half speed while the race clock keeps counting, until a reset or respawn.
  - No engine, no brakes, no steering, cruise control, fragile, reset: as before.
- **Box gates** (Stadium, Box gates): one piece per block with any mix of left, right, top and bottom frame edges, so start, checkpoint and finish boxes can be any width and height. Pieces with the same checkpoint number count as one gate.
- **Water** (Stadium, Water): drawn but not solid. The car sinks slowly, loses speed hard, and can drive out.
- Effect durations and strengths, grass drag and water drag are my own values: no source gives Trackmania's numbers.
- **Online:** tracks with new blocks are never submitted to Kodub's leaderboards.
