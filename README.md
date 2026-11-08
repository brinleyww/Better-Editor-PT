# Better Editor PT

An unofficial mod of [PolyTrack](https://www.kodub.com/) 0.6.2 by Kodub that runs as a static web site. It adds 1,142 editor blocks inspired by Trackmania's plastic and wood kits, plus a Stadium category. Plastic, wood and penalty grass each drive differently. Turbos, reactor boosts and other effect plates work, and tracks share as normal track codes.

All block models are generated from code in `tools/blocks/`. No Trackmania assets are used. PolyTrack itself belongs to Kodub; its original files are kept untouched in `_original/`.

## Play it

The game runs from the repository root, so GitHub Pages can serve it directly:

1. In the repository's **Settings > Pages**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`.
2. Open `https://<user>.github.io/<repository>/`. Every path is relative, so any sub-path works.

To run it locally:

```bash
node tools/test/server.js 8123
```

Then open http://127.0.0.1:8123/Better-Editor-PT/ .

Online features (leaderboards, multiplayer, profile sync) talk to Kodub's servers, which only accept the official game, so expect "Failed to connect" for those. Tracks that use new blocks are never sent to Kodub's leaderboards.

## What is in the editor

Three new categories sit at the top of the editor's block column, right under the eraser. Each opens a browser with tabs, a search box, a Recent tab and colour options.

| Category | Tabs |
|---|---|
| Plastic, Wood (492 each) | Road, Open road, Platform, Penalty grass, Walls and loops, Half-pipe, Gates, Effects, Connectors, Deco |
| Stadium (158) | Penalty grass, Box gates, Special gates, Track walls, Structures, Stage and screens, Water, Deco |

The full list is in [docs/BLOCKS.md](docs/BLOCKS.md). The road kits cover straights, junctions, five curve radii, chicanes, three slope grades, crests and dips, banked roads and curves, diagonals, loops, wall rides, half-pipes, connectors, gates and effect plates.

Blocks use the stock road's measurements (13.13 wide, 0.21 deck, 1:2 slopes and banks), so they join stock blocks seamlessly.

### How things drive

| | Behaviour |
|---|---|
| Plastic | Very low grip, rear lower than front, so the tail slides. Strong extra push from a standstill that fades out by about 160 km/h. Plastic bounce: a hit on the car's side or roof throws it back off the plastic. The whole collision is measured, so a roof landing from 25 units up bounces back to about 17. |
| Wood | Very high grip: the tyres don't let go, so you can't drift. Brakes shorter than stock road. Extra push that grows exponentially with speed up to about 300 km/h and fades out by 500 km/h, so wood pulls harder the faster you go (0 to 200 km/h in 2.7 s, stock 3.3 s). The extra grip is a fixed amount, so in loops it stays close to stock. |
| Penalty grass | Soft grip and heavy drag; the car crawls at about 60 km/h. Comes as whole blocks, and as grass strips inside plastic and wood blocks, where only the grass slows you. |
| Water | Not solid. The car sinks slowly, loses speed hard and can drive out. |
| Stock blocks, ground | Unchanged. Tracks with no new blocks use stock physics exactly. |

| Effect | Behaviour |
|---|---|
| Turbo, super turbo | A push that is strongest as you cross and fades over 1.0 s or 1.4 s. |
| Turbo roulette | Turbo, super or a stronger third level, picked by the exact frame you cross it. |
| Reactor boost, super reactor boost (up or down) | 6 s of thrust along the car's own up axis. Up stretches jumps; down presses the car onto any surface. In the air, the gas pushes along the nose and steering turns the car. |
| Slow motion | The car runs at half speed while the race clock keeps counting, until reset or respawn. |
| No engine, no brakes, no steering, cruise control | Lock out that input until reset. |
| Fragile | A hard hit sends you back to the last checkpoint. |
| Reset | Clears every effect. |

The durations, strengths and drag values are this project's own choices. Trackmania doesn't publish its numbers, so the behaviour follows its descriptions, not measurements.

**Box gates** (Stadium, Box gates) come one per block, with any mix of left, right, top and bottom frame edges, so start, checkpoint and finish boxes can be any width and height. Pieces with the same checkpoint number count as one gate.

### Between building and testing

- **Driving line:** every Test run is recorded. Back in the editor, the line you drove is drawn on the track, coloured from blue (slow) to red (your top speed), with a pin where the run ended: green on a finish, red where the car stopped, fell or was reset. Hover the line to see the speed and race time at that point.
- **Test runs** (bottom left): the runs since the editor opened, with the finish time and gap to the best, or how many checkpoints a run reached. Click a run to show its line; **Go to end** moves the camera to where it ended. Tick **Line** off to hide the line.
- **Recovery:** unsaved changes are copied to the browser every few seconds. If the tab closes or crashes before you save, the editor offers them back the next time it opens. Embedded in NSWS, NSWS saves the track instead.

## Track codes

A track with only stock blocks still exports as a normal `PolyTrack2…` code with the same track id as before. A track with new blocks exports as `PolyTrackBE1…`: the same layering as PolyTrack2, but with two-byte part ids and a catalogue version. The byte layout is in [docs/TRACK_CODE_FORMAT.md](docs/TRACK_CODE_FORMAT.md).

New block ids start at 1000 and never change: [tools/blocks/ids.json](tools/blocks/ids.json) only ever gets new entries. Stock PolyTrack rejects BE1 codes as invalid.

## Adding these blocks to your own PolyTrack build

This section is for anyone running a modified PolyTrack (a fork, a site or a private build) who wants these blocks, codes and physics. It assumes 0.6.2 bundles. Other versions have the same structure but different minified names.

### 1. Copy four files

| File | Purpose |
|---|---|
| `tm_parts.js` | The part table: ids, names, editor tabs, tiles, trigger boxes, colours, surfaces. Generated. |
| `models/tm_blocks.bin` | All block geometry. Generated; must match `tm_parts.js` (its size is checked). |
| `tm_runtime.js` | Loads geometry, reads and writes BE1 codes, feeds physics, runs surfaces and effects. Defines `self.TM`. |
| `tm_menu.js` | The block browser in the editor. Optional if you build your own menu. |

The page loads them before the game bundles:

```html
<script defer src="tm_parts.js"></script>
<script defer src="tm_runtime.js"></script>
<script defer src="tm_menu.js"></script>
```

The physics worker needs the first two as its very first line, because the part enum is built when the bundle starts:

```js
importScripts("tm_parts.js", "tm_runtime.js");
```

### 2. Apply the bundle changes

[tools/patch.js](tools/patch.js) holds every change as a find-and-replace on the formatted 0.6.2 bundles in `_original/formatted/`. Each one has a short name, and the build stops if any of them no longer matches exactly once. On another version, find the same spot by what it does. In order:

**Main bundle (`main.bundle.js`)**

| Change | Why |
|---|---|
| Part id enum calls `TM.addEnum(e)`; categories get `Plastic`, `Wood`, `Stadium` | The game validates ids and names categories from these enums. |
| Part definitions array concatenates `TM.parts` as definition objects | New blocks become real parts: tiles, triggers, start offsets, colours. The constructor's duplicate-tile check uses a Set, because big blocks have many tiles. |
| Part loader: new parts get a lazy colour map and skip the GLB lookup | A block's mesh is built only when a colour is first asked for, from `TM.renderArrays`. |
| `getPhysicsParts` skips new parts and appends `TM.proxyConfigs()` | See section 4. |
| Checksum check skips ids from 1000 | New parts have no stock checksum. |
| `getCategoryMesh` gets cases for the new categories | Category thumbnails. |
| TrackData writer: two-byte ids and the catalogue version when a track has an id above 255; `~BE1` save-string prefix; `PolyTrackBE1` export prefix | The format. Tracks with only stock parts still write the stock format byte for byte. |
| `fromSaveString` and `fromExportString` try `TM.fromSave` / `TM.fromExport` first | Reading the format. See the `tmCtx` block in `patch.js` for the context object. |
| Track ids of tracks with new blocks go into `TM.extTrackIds`; the leaderboard upload returns early for them | Never send unverifiable runs to Kodub. |
| Full scene rebuild only visits parts that are placed | 1,142 more parts would make every rebuild slow. |

**Editor bundle (`112.bundle.js`)**

| Change | Why |
|---|---|
| Thumbnail renderer handed to `TM.ui.setThumbnailRenderer` | Thumbnails draw only when on screen. |
| New parts go into `TM.ui.add(panel, button, image, part)` instead of the stock column | The tabbed browser. New categories are inserted under the eraser. |
| Category and environment changes skip eager thumbnails for new parts (`TM.ui.skipEager`, `TM.ui.refresh`) | Rendering hundreds at once stalls the editor. |
| Part selection calls `TM.ui.onSelect`; placing calls `TM.ui.onPlaced` | The browser follows the pipette, and the Recent tab fills up. |

**Physics worker (`simulation_worker.bundle.js`)**

| Change | Why |
|---|---|
| The same enum, category and part definition changes as the main bundle | The worker has its own copy of the part table. |
| `fromSaveString` tries `TM.fromSave` first | The worker reads tracks as save strings. |
| The car setup calls `TM.prepareCar(...)`, uses its vertices and record count, and maps ids through `TM.physicsId` | See section 4. |
| The per-frame wrapper around `updateCarModel` calls `TM.fxControls` before, `TM.fxSkip` to hold frames, and `TM.fxStep` after | Surfaces and effects. |

### 3. Runtime API (`self.TM`)

| Member | Use |
|---|---|
| `parts`, `byId`, `data`, `version` | The part table, parts by id, the raw table, catalogue version. |
| `isTM(id)`, `addEnum(enum)` | New-part test (`id >= 1000`); adds names and ids to an enum object. |
| `palette(part)`, `ranges(part)` | Colour slots and tile ranges for a part definition. |
| `load()` | Page side: fetches `models/tm_blocks.bin` once, returns a promise. |
| `renderArrays(id, slotColors, toRgb)` | Non-indexed positions and colours for one colour slot. `toRgb(hex)` returns linear `[r,g,b]`. Pass THREE.Color values so they match stock vertex colours. |
| `prepareCar(carId, mountainVertices, mountainOffset, track, rotatedTiles)` | Worker side. Returns `{ vertices, records }`: the mountain mesh with new-block collision appended, and how many part records the physics will get. |
| `physicsId(id)` | The one-byte id to write into the physics record, or `null` to leave the part out. |
| `proxyConfigs()` | Extra part configurations for the physics Init message. |
| `fxControls(carId, controls)`, `fxSkip(carId, heap)`, `fxStep(carId, heap, stateBuffer)` | The per-frame hooks. |
| `fromSave(str, ctx)`, `fromExport(str, ctx)` | Read BE1 codes. Return `null` for anything else, so the stock readers can run next. |
| `SAVE_PREFIX`, `EXPORT_PREFIX`, `extTrackIds` | Format prefixes; ids of tracks that must not be uploaded. |
| `surfaces` | Grip, launch, bounce and drag per surface. Tune here. |
| `ui` | The block browser hooks (`tm_menu.js`). |

### 4. How the physics fits in

The physics engine (`polytrack_physics.wasm`) is stripped and reads part ids as one byte, so new blocks can't be registered with it by id. Instead:

- **Collision:** every new block's collision triangles are transformed into world space and appended to the mountain (terrain) mesh the engine already takes for each car. Rotations are exact integer matrices (`rotations` in `tm_parts.js`, derived from the game's own quaternions), so every machine gets the same floats.
- **Gates:** checkpoints, finishes and starts need the engine's trigger boxes. Each distinct trigger box is a proxy part with a spare one-byte id (190 and up), registered through `proxyConfigs()` with a tiny triangle far below the world. A gate block writes its proxy id in the part records.
- **Surfaces:** each physics frame, `fxStep` looks up the block under each wheel's contact point and writes that wheel's friction slip. These are Bullet `btWheelInfo` structs: 284 bytes each, contact normal at +0, contact point at +16, in-contact flag at +84, friction slip at +228, suspension force at +276. The wheel array pointer is at `car + 32` then `+144`; the rigid body is at `car + 36` (linear velocity at +312, angular at +328, inverse mass at +344). The car object comes from the engine's `unordered_map<int, Car*>`, with its bucket array pointer at address 18848 and bucket count at 18852 (`carPointer` in `tm_runtime.js`).
- **Effects** add velocity or mask inputs in the same frame hooks, so ghosts, replays and the game's own run verifier all see identical runs. Slow motion holds every other frame and advances the engine's frame counter at `car + 172`.
- **Grass inside a block:** a part can list boxes in its own frame (`r`) where the surface is penalty grass. Everything else on the part uses its own surface (`u`).

These offsets are for the 0.6.2 engine, whose wasm is the same file as 0.6.0. A different engine build needs them checked again.

**Physics versions:** `physics.json` holds the physics version and, for each earlier version, a commit that still drives that way. Any change to how cars drive (the physics in `tm_runtime.js`, collision meshes, a part's surface or effect data) runs `node tools/physics-bump.js` first and goes in with the bumped file. Not So Weekly Shorts uses it to move older leaderboard times to an Old physics board and to replay them on their own commit.

### 5. Data formats

`tm_parts.js` sets `self.TM_DATA`:

| Field | Meaning |
|---|---|
| `parts[]` | `n` name, `i` id, `l` label, `t` tab, `s` section, `f` category (0 plastic, 1 wood, 2 stadium), `b` bounds, `c` tile ranges `[[min],[max]]`, `m` render meshes, `ph` collision mesh, `d` trigger box, `o` start offset, `x` effect zone, `p` proxy id, `u` physics surface (0 plastic, 1 wood, 2 grass, absent = stock), `r` grass boxes |
| `materials`, `materialNames` | Default colour per material index |
| `palettes[f]` | Colour slots per category: environments 1-3 and custom 32-40, as `{ id, colors: { material: hex } }` |
| `noPhysics` | Material indices that are drawn but never collide (water) |
| `rotations[axis][rotation]` | 3x3 integer matrices, row-major |
| `proxies` | Proxy ids with their trigger box and start offset |
| `binBytes`, `hash`, `version`, `tabs` | Integrity, catalogue version, menu tab order |

Each mesh entry is `[material, positionsOffset, floatCount, indicesOffset, indexCount]` into `models/tm_blocks.bin`: Float32 positions and Uint16 indices, every chunk 4-byte aligned. Positions are in the part's frame: the origin at the block centre, y up, travel at rotation 0 along -z, one block 20 units wide and 5 units per layer.

## Making your own blocks

Blocks are defined in code in [tools/blocks/catalog.js](tools/blocks/catalog.js) (plastic and wood) and [tools/blocks/shared.js](tools/blocks/shared.js) (Stadium), using the helpers in [tools/blocks/geom.js](tools/blocks/geom.js): profile sweeps along paths, surface patches, prisms and boxes. Colours are in [tools/blocks/build.js](tools/blocks/build.js).

```bash
cd tools && npm install
node blocks/build.js
```

This writes `tm_parts.js`, `models/tm_blocks.bin` and `docs/BLOCKS.md`. New names get the next free id. Never renumber or remove entries in `ids.json`, or existing codes will point at the wrong blocks.

Rules the build enforces: no geometry below the part's own layer, known materials only, and no more than 66 distinct trigger boxes (the spare one-byte ids).

## Rebuilding everything

```bash
cd tools && npm install
node build-all.js
```

This formats `_original/app` into `_original/formatted`, copies the assets to the root, generates the blocks, then applies `tools/patch.js`. `tm_runtime.js`, `tm_menu.js`, `tm_water.js` and `tm_tools.js` are edited by hand and are not regenerated.

## Repository layout

| Path | Contents |
|---|---|
| repository root | The playable game |
| `_original/app` | Untouched PolyTrack 0.6.2 files |
| `_original/formatted` | The same bundles, formatted; the input to `patch.js` |
| `tools/blocks` | Block generator |
| `tools/patch.js`, `tools/deobfuscate.js`, `tools/build-all.js` | Build steps |
| `tools/physics-bump.js`, `physics.json` | Physics version for leaderboards that keep runs (see How the physics fits in) |
| `tools/test` | Headless Chrome tests that drive real cars (they expect Chrome at the standard Windows install path) |
| `docs` | Block list, track code format, a map of the formatted code |

## Known limits

- The catalogue follows Trackmania's block families for plastic and wood, plus stadium scenery. It is not a complete copy of every Trackmania block, and dirt, ice and bump surfaces are not included.
- On the tightest plastic loop (radius 20), a car can lose the loop if it steers at the wrong moment.
- `models/tm_blocks.bin` is about 17 MB (about 5 MB compressed), so the first load takes longer than the stock game.
- The code under `_original/` and the formatted bundles keep PolyTrack's minified names. [docs/MODULE_MAP.md](docs/MODULE_MAP.md) says where things are.
