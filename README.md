# Better Editor PT

An unofficial mod of [PolyTrack](https://www.kodub.com/) 0.6.2 by Kodub that runs as a static web site. It adds 2,369 editor blocks inspired by Trackmania 2020's plastic, wood, ice, water, dirt and grass kits, plus a Stadium category. Each surface drives differently, vehicle gates turn the car into Trackmania's Snow, Rally or Desert car, tyres get wet, icy and muddy, and turbos, bumpers, reactor boosts and the other effect plates work. Tracks share as normal track codes.

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

Seven new categories sit near the top of the editor's block column, under the eraser and Road. Each opens a browser with tabs, a search box, a Recent tab and colour options.

| Category | Tabs |
|---|---|
| Plastic, Wood (541 each) | Road, Open road, Platform, Penalty grass, Walls and loops, Half-pipe, Gates, Effects, Vehicle gates, Connectors, Deco |
| Stadium (212) | Penalty grass, Box gates, Special gates, Vehicle gates, Bump road, Track walls, Structures, Stage and screens, Deco |
| Ice (151) | Bobsleigh, Bobsleigh gates, Bobsleigh effects, Ice platform, Ice walls and loops, Ice gates, Ice effects, Vehicle gates |
| Water (9) | Pools, Shallow water |
| Dirt (581) | Dirt road, Open road, Narrow road, Platform, Penalty grass, Walls and loops, Half-pipe, Gates, Effects, Vehicle gates, Connectors, Deco |
| Grass (334) | Open road, Platform, Walls and loops, Half-pipe, Gates, Effects, Vehicle gates, Connectors, Deco |

The full list is in [docs/BLOCKS.md](docs/BLOCKS.md). The road kits cover straights, junctions, five curve radii, chicanes, three slope grades, crests and dips, banked roads and curves, diagonals, loops, wall rides, half-pipes, connectors, gates and effect plates. Every kit has vehicle gates. The bump road is Trackmania's sausage road: a rounded crown with the stock road's kerbs.

Blocks use the stock road's measurements (13.13 wide, 0.21 deck, 1:2 slopes and banks), so they join stock blocks seamlessly. The dirt road and the narrow road are narrower, as in Trackmania, so they join the stock road and the other kits through their connectors (Dirt, Connectors), and the bump road joins through "Bump road from road".

### How things drive

| | Behaviour |
|---|---|
| Plastic | Very low grip, rear lower than front, so the tail slides. Strong extra push from a standstill that fades out by about 160 km/h. Plastic bounce: a hit on the car's side or roof throws it back off the plastic. The whole collision is measured, so a roof landing from 25 units up bounces back to about 17. |
| Wood | Very high grip: the tyres don't let go, so you can't drift. Brakes shorter than stock road. Extra push that grows exponentially with speed up to about 300 km/h and fades out by 500 km/h, so wood pulls harder the faster you go (0 to 200 km/h in 2.7 s, stock 3.3 s). It corners about 3.25 times as hard as stock road at any speed from 40 km/h up, a little less below that. The extra grip is a fixed amount, so in loops it stays close to stock. |
| Penalty grass | Soft grip and heavy drag; the car crawls at about 60 km/h. Comes as whole blocks, and as grass strips inside plastic and wood blocks, where only the grass slows you. |
| Platform ice, bobsleigh | The tyres barely hold, so the car slides; steering turns the car itself, and a held turn settles into a steady slide. Braking takes about five times the distance. Bobsleigh walls hold the car in the channel near their lip. |
| Dirt | About 0.65 of the road's grip (corners at about 0.8 of the speed). The rear lets go first, so it drifts, and the drift settles when you let go of the steering. 0 to 100 km/h takes x1.17 as long, 0 to 200 x1.31, braking x1.6 the distance, and rolling drag costs about 8% of the speed a second. Comes as whole blocks and as dirt verges inside other blocks. |
| Grass | Trackmania's drivable grass, not the penalty verges. About half the grip, x1.35 as long to 100 km/h, x2 to 200, x2 the braking distance, and heavy drag that holds the car well under the road's top end. |
| Snow | About 0.4 of the grip, x1.3 as long to 100 km/h, x2.5 the braking distance and little drag: between dirt and ice. It is in the physics, but no block uses it yet. |
| Tech (bump road) | Exactly the stock road, which is Trackmania's Tech road. It has its own entry only for its own wet grip and vehicle numbers. |
| Water | Not solid. The car sinks slowly, loses speed hard and can drive out. Shallow water sits over a floor: a little drag and a softer engine. Hitting deep water fast and flat, the car skips off it like a stone. |
| Tyres | Each tyre gets wet, icy and muddy on its own, and one surface undoes another: see Tyres below. |
| Tyre spray | Each surface throws up its own bits, far more while sliding or braking hard: dust and clods on dirt, clippings on grass, powder on snow, glitter on ice, splinters on wood, chips in the deck's colour on plastic, smoke on the bump road. Stock road keeps the game's own smoke; the Particles setting turns it all off. Only a look. |
| Stock blocks, ground | Unchanged. Tracks with no new blocks use stock physics exactly. |

**Tyres.** As in Trackmania 2020, every tyre carries its own wetness and icing (and here mud), the Stadium car's too, and what it drives on next adds to them or takes them away. Checkpoints and Reset plates keep the tyres as they are; a respawn, the respawn key and a vehicle gate (new car, new tyres) give clean ones. The tyres are drawn darker and shinier when wet, frosted when icy and brown when muddy, and the Wheel info panel (Settings) shows each tyre's grip and how wet, icy and muddy it is. Trackmania keeps the numbers in its encrypted packs, so the times and grips below are this project's estimates of how it plays.

| On | What it does to the tyres |
|---|---|
| Water | Soaks them (fully wet in under 2 s), washes mud off in under a second and thaws ice in about a second. |
| Dirt | Soaks the water up (dry in under 2 s) and scrubs ice off fast (half a second). Dry tyres only get dusty; wet tyres pick up mud fast (fully muddy in about a second). |
| Grass, penalty grass | Dries the tyres over 3 to 4 s and scrubs ice off in about a second; wet tyres get a little green slick. |
| Road, tech, plastic, wood | Dries them slowly (about 10 s), thaws ice in about 2.5 s and wears mud off in about 4 s. |
| Platform ice, bobsleigh | Ices them up (fully iced in just over 1 s; the water on a wet tyre freezes, so in about half that). Mud stays on. |
| Snow | Packs ice onto them like ice does, and the water on a wet tyre freezes. Wears a little mud off. |
| Air | Almost nothing: they dry and thaw very slowly. |
| Sliding | A drift, wheelspin or locked brakes heats the tyres, so they dry, thaw and shed mud up to four times as fast. |

The Snow car's studded tyres never ice. The Rally and Desert cars shed mud a little faster.

| Grip with a full | Road, tech | Plastic | Wood | Penalty grass | Ice, bobsleigh | Dirt | Grass | Snow |
|---|---|---|---|---|---|---|---|---|
| Wet tyre | x0.85 | x0.7 | x0.08, and it steers and slides like ice (Trackmania's sliding wood) | x0.7 | x0.75 | x0.6, a mud road with a little more drag | x0.6, slick | x0.9 |
| Icy tyre | x0.5 | x0.5 | x0.5 | x0.5 | unchanged | x0.5 | x0.5 | unchanged |
| Muddy tyre | x0.7 | x0.7 | x0.7 | unchanged | unchanged | unchanged | unchanged | unchanged |

States in between count in proportion, and states together multiply, but never below 0.6 of what the worst one alone leaves. Dry, clean tyres drive every surface exactly as above.

**Vehicles.** The car you start with is PolyTrack's own car, which plays the part of Trackmania's Stadium car, and it never changes. A vehicle gate turns it into the Snow, Rally or Desert car, each with its own parts, wheels and colours, and the Stadium car gate gives back the exact stock car. The car stays through checkpoints and effect resets; a respawn gives back the car you had at that checkpoint, and starting over gives the Stadium car. Against the Stadium car on the same surface:

| Vehicle | Behaviour |
|---|---|
| Snow | Studded tyres: on platform ice it brakes in about a quarter of the distance and doesn't spin, on snow it grips almost like on the road, and its tyres never ice. About 0.86 of the grip on road, 1.1 on dirt and grass. A little slower to 100 km/h (x1.1), and drag holds it near 230 km/h. Softer, taller suspension and a little air control. |
| Rally | Built for loose ground: about 1.45 of the grip on dirt and grass (on dirt it corners about as fast as the Stadium car on road) and 1.2 on snow, slightly less on road. It pulls well on dirt, grass and snow, and drag holds it near 260 km/h. Soft springs that soak up bumps. |
| Desert | The fastest top end (drag holds it near 330 km/h) and quicker to 100 km/h (x0.95), but it understeers on road (about 0.75 of the grip); 1.25 on dirt and grass. Very soft long-travel suspension that lands big drops without losing speed, and strong air control: steering turns it and the brake lifts the nose. |

| Effect | Behaviour |
|---|---|
| Turbo, super turbo, ultra turbo | A push that is strongest as you cross and fades over 1.0 s, 1.4 s or 1.8 s. Crossed at about 190 km/h, the car does about 385, 460 or 515 km/h a second later (280 with none). |
| Turbo roulette | Turbo, super or ultra, picked by the exact frame you cross it. |
| Bumper, super bumper | One sideways kick as you enter, about 50 km/h (super: 85), away from the line through the plate's centre along the way you are going, plus a small hop. |
| Vehicle gates | Snow, Rally, Desert and Stadium car gates (the Stadium car gate gives back the stock car). See Vehicles. |
| Reactor boost, super reactor boost (up or down) | 6 s of thrust along the car's own up axis. Up stretches jumps; down presses the car onto any surface. In the air, the gas pushes along the nose and steering turns the car. |
| Slow motion | The car runs at half speed while the race clock keeps counting, until reset or respawn. |
| No engine, no brakes, no steering, cruise control | Lock out that input until reset. |
| Fragile | A hard hit sends you back to the last checkpoint. |
| Reset | Clears every effect. |

Trackmania 2020 keeps its car and surface tunings in encrypted packs, so every number here is this project's own estimate, set relative to how Trackmania's Stadium car drives on its Tech road (PolyTrack's stock car on the stock road) and measured with `tools/test/tmphys.mjs`. A Trackmania install was read only for its catalogue: the surface materials, the gameplay effect ids, the per-wheel states the car keeps (wetness, icing) and the editor's block styles and categories.

**Box gates** (Stadium, Box gates) come one per block, with any mix of left, right, top and bottom frame edges, so start, checkpoint and finish boxes can be any width and height. Pieces with the same checkpoint number count as one gate.

### Between building and testing

- **Driving line:** every Test run is recorded. Back in the editor, the line you drove is drawn on the track, coloured from blue (slow) to red (your top speed), with a pin where the run ended: green on a finish, red where the car stopped, fell or was reset. Hover the line to see the speed and race time at that point.
- **Runs** (the tab next to the track name): it shows your last time, and opens a list of the runs since the editor opened, with the finish time and gap to the best, or how many checkpoints a run reached. Click a run to show its line; **Go to end** moves the camera to where it ended. **Line: On/Off** hides or shows the line.
- **Recovery:** unsaved changes are copied to the browser every few seconds. If the tab closes or crashes before you save, the editor offers them back the next time it opens. Embedded in NSWS, NSWS saves the track instead.

## Track codes

A track with only stock blocks still exports as a normal `PolyTrack2…` code with the same track id as before. A track with new blocks exports as `PolyTrackBE1…`: the same layering as PolyTrack2, but with two-byte part ids and a catalogue version. The byte layout is in [docs/TRACK_CODE_FORMAT.md](docs/TRACK_CODE_FORMAT.md).

New block ids start at 1000 and never change: [tools/blocks/ids.json](tools/blocks/ids.json) only ever gets new entries. Stock PolyTrack rejects BE1 codes as invalid.

## Adding these blocks to your own PolyTrack build

This section is for anyone running a modified PolyTrack (a fork, a site or a private build) who wants these blocks, codes and physics. It assumes 0.6.2 bundles. Other versions have the same structure but different minified names.

### 1. Copy the files

| File | Purpose |
|---|---|
| `tm_parts.js` | The part table: ids, names, editor tabs, tiles, trigger boxes, colours, surfaces. Generated. |
| `models/tm_blocks.bin` | All block geometry. Generated; must match `tm_parts.js` (its size is checked). |
| `tm_runtime.js` | Loads geometry, reads and writes BE1 codes, feeds physics, runs surfaces and effects. Defines `self.TM`. |
| `tm_menu.js` | The block browser in the editor. Optional if you build your own menu. |
| `tm_water.js` | Page only: water's see-through material, splashes and spray, and the per-car hooks (`TM.water.track` / `update` / `dispose`). |
| `tm_vehicles.js` | Page only, after `tm_water.js`: the Snow, Rally and Desert car looks and the wet, icy and muddy tyres. It rides on `tm_water.js`'s car hooks and works the vehicle and tyres out from the car's state (with the runtime's own `TYRES`), so nothing comes back from the worker. |

The page loads them before the game bundles:

```html
<script defer src="tm_parts.js"></script>
<script defer src="tm_runtime.js"></script>
<script defer src="tm_menu.js"></script>
<script defer src="tm_water.js"></script>
<script defer src="tm_vehicles.js"></script>
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
| Part id enum calls `TM.addEnum(e)`; categories get one entry per name in `TM_DATA.families` (Plastic to Grass) | The game validates ids and names categories from these enums. |
| Part definitions array concatenates `TM.parts` as definition objects | New blocks become real parts: tiles, triggers, start offsets, colours. The constructor's duplicate-tile check uses a Set, because big blocks have many tiles. |
| Part loader: new parts get a lazy colour map and skip the GLB lookup | A block's mesh is built only when a colour is first asked for, from `TM.renderArrays`. |
| `getPhysicsParts` skips new parts and appends `TM.proxyConfigs()` | See section 4. |
| Checksum check skips ids from 1000 | New parts have no stock checksum. |
| `getCategoryMesh` gets cases for the new categories | Category thumbnails. |
| TrackData writer: two-byte ids and the catalogue version when a track has an id above 255; `~BE1` save-string prefix; `PolyTrackBE1` export prefix | The format. Tracks with only stock parts still write the stock format byte for byte. |
| `fromSaveString` and `fromExportString` try `TM.fromSave` / `TM.fromExport` first | Reading the format. See the `tmCtx` block in `patch.js` for the context object. |
| Track ids of tracks with new blocks go into `TM.extTrackIds`; the leaderboard upload returns early for them | Never send unverifiable runs to Kodub. |
| Full scene rebuild only visits parts that are placed | 2,369 more parts would make every rebuild slow. |
| The car's visuals call `TM.water.track`, `TM.water.update` and `TM.water.dispose` | Water splashes, vehicle looks and tyres (`tm_water.js`, `tm_vehicles.js`). |

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
| `zones(track)`, `surfaceIndex(track)`, `surfaceAt(index, x, y, z)` | A track's effect and gate zones, and the surface at a point. The page uses them for water and vehicles. |
| `VEHICLES`, `vehicleGates`, `WATER`, `TYRES` | The cars (with `look` hints for drawing them), which gate gives which car, water, and the tyre model: the table of what each surface does to wet, iced and muddy tyres, `step` (one physics frame of a tyre) and `grip`. `tm_vehicles.js` and `tm_hud.js` step their tyres with this same code. |
| `ui` | The block browser hooks (`tm_menu.js`). |

### 4. How the physics fits in

The physics engine (`polytrack_physics.wasm`) is stripped and reads part ids as one byte, so new blocks can't be registered with it by id. Instead:

- **Collision:** every new block's collision triangles are transformed into world space and appended to the mountain (terrain) mesh the engine already takes for each car. Rotations are exact integer matrices (`rotations` in `tm_parts.js`, derived from the game's own quaternions), so every machine gets the same floats.
- **Gates:** checkpoints, finishes and starts need the engine's trigger boxes. Each distinct trigger box is a proxy part with a spare one-byte id (190 and up), registered through `proxyConfigs()` with a tiny triangle far below the world. A gate block writes its proxy id in the part records.
- **Surfaces:** each physics frame, `fxStep` looks up the block under each wheel's contact point and writes that wheel's friction slip. These are Bullet `btWheelInfo` structs: 284 bytes each, contact normal at +0, contact point at +16, in-contact flag at +84, friction slip at +228, suspension force at +276. The wheel array pointer is at `car + 32` then `+144`; the rigid body is at `car + 36` (linear velocity at +312, angular at +328, inverse mass at +344). The car object comes from the engine's `unordered_map<int, Car*>`, with its bucket array pointer at address 18848 and bucket count at 18852 (`carPointer` in `tm_runtime.js`).
- **Effects** add velocity or mask inputs in the same frame hooks, so ghosts, replays and the game's own run verifier all see identical runs. Slow motion holds every other frame and advances the engine's frame counter at `car + 172`.
- **Surfaces inside a block:** a part can list boxes in its own frame (`r`) with their own surface, such as grass strips or dirt verges. Everything else on the part uses its own surface (`u`). On the new surfaces, launch, engine and brake effects count by the share of wheels on each.
- **Vehicles:** a vehicle gate changes the car's grip, engine, top-end drag, air control and suspension (spring, damper and rest length fields of the wheel structs). The Stadium car gate writes every changed field back to the stock value read on the first frame.

These offsets are for the 0.6.2 engine, whose wasm is the same file as 0.6.0. A different engine build needs them checked again.

**Physics versions:** `physics.json` holds the physics version and, for each earlier version, a commit that still drives that way. Any change to how cars drive (the physics in `tm_runtime.js`, collision meshes, a part's surface or effect data) runs `node tools/physics-bump.js` first and goes in with the bumped file. Not So Weekly Shorts uses it to move older leaderboard times to an Old physics board and to replay them on their own commit.

### 5. Data formats

`tm_parts.js` sets `self.TM_DATA`:

| Field | Meaning |
|---|---|
| `parts[]` | `n` name, `i` id, `l` label, `t` tab, `s` section, `f` category (index into `families`), `b` bounds, `c` tile ranges `[[min],[max]]`, `m` render meshes, `ph` collision mesh, `d` trigger box, `o` start offset, `x` effect zone (`type`: Turbo, Super, Ultra, Roulette, the reactors, Bumper, Bumper2, CarSnow, CarRally, CarDesert, CarStadium, Water and the rest), `p` proxy id, `u` physics surface, `r` surface boxes |
| `families` | Category names in `f` order: 0 Plastic, 1 Wood, 2 Stadium, 3 Ice, 4 Water, 5 Dirt, 6 Grass. The game's category enum value is `f + 9`. |
| `materials`, `materialNames` | Default colour per material index |
| `palettes[f]` | Colour slots per category: environments 1-3 and custom 32-40, as `{ id, colors: { material: hex } }` |
| `noPhysics` | Material indices that are drawn but never collide (water) |
| `rotations[axis][rotation]` | 3x3 integer matrices, row-major |
| `proxies` | Proxy ids with their trigger box and start offset |
| `binBytes`, `hash`, `version`, `tabs` | Integrity, catalogue version, menu tab order |

`u` is the `SURFACES` index in `tm_runtime.js`: 0 plastic, 1 wood, 2 penalty grass, 3 platform ice, 4 bobsleigh, 5 dirt, 6 grass, 7 snow, 8 tech; absent means the stock road. An `r` entry is `[[lo], [hi]]` (penalty grass) or `[[lo], [hi], u]`.

Each mesh entry is `[material, positionsOffset, floatCount, indicesOffset, indexCount]` into `models/tm_blocks.bin`: Float32 positions and Uint16 indices, every chunk 4-byte aligned. Positions are in the part's frame: the origin at the block centre, y up, travel at rotation 0 along -z, one block 20 units wide and 5 units per layer.

## Making your own blocks

Blocks are defined in code in [tools/blocks/catalog.js](tools/blocks/catalog.js) (plastic, wood, dirt and grass), [tools/blocks/ice.js](tools/blocks/ice.js) (ice) and [tools/blocks/shared.js](tools/blocks/shared.js) (Stadium and water), using the helpers in [tools/blocks/geom.js](tools/blocks/geom.js): profile sweeps along paths, surface patches, prisms and boxes. Colours are in [tools/blocks/build.js](tools/blocks/build.js).

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

This formats `_original/app` into `_original/formatted`, copies the assets to the root, generates the blocks, then applies `tools/patch.js`. `tm_runtime.js`, `tm_menu.js`, `tm_water.js`, `tm_vehicles.js` and `tm_tools.js` are edited by hand and are not regenerated.

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

- The catalogue follows Trackmania 2020's block families for plastic, wood, ice, water, dirt and grass, plus the bump road and stadium scenery. It is not a complete copy of every Trackmania block: there are no castle or water roads, and no snow blocks yet.
- On the tightest plastic loop (radius 20), a car can lose the loop if it steers at the wrong moment.
- `models/tm_blocks.bin` is about 63 MB (about 29 MB compressed), so the first load takes longer than the stock game.
- The code under `_original/` and the formatted bundles keep PolyTrack's minified names. [docs/MODULE_MAP.md](docs/MODULE_MAP.md) says where things are.
