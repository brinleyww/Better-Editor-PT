# Where things are in the deobfuscated code

The bundles in `site/` are formatted, not rewritten. The original local variable names did not survive minification, so names like `Vn` and `e` remain. Numbers below are webpack module ids in `main.bundle.js`. Search for `<id>: (e, t, n) =>` to jump to one.

| Module | Contents |
|---|---|
| 494 | Part id enum |
| 8043 | Part categories (editor menu columns) |
| 2600 | Part definitions: models, colours, tiles, trigger boxes, start offsets |
| 9117 | TrackData: parts, track ids, save strings, export codes |
| 6582, 11, 8063, 1648, 2849, 7775 | Readers for current and older track code formats |
| 7754 | Base62 packing |
| 3075 | pako (zlib) |
| 5494 | Rotation quaternions and tile rotation |
| 8734 | Part tile sets |
| 7852, 2498, 7781, 7929, 3080 | Environment, colour, rotation axis, sun, trigger type enums |
| 5220 | Main-thread wrapper for the physics worker |
| 6421 | Mountain terrain mesh |
| 3899 | Car state decoding |
| 1754 | Car recording (replay) format |
| 641 | Car model and constants |
| 4922 | three.js |

Other files:

| File | Contents |
|---|---|
| `112.bundle.js` | The track editor and its UI (`Vn` builds the menus, `Qn` picks a category, `$n` picks a part) |
| `simulation_worker.bundle.js` | Physics worker with its own copy of the part table and track reader |
| `lib/polytrack_physics.js`, `polytrack_physics.wasm` | Stripped physics engine, not deobfuscated |
| `main.bundle.js`, class `ou` | Loads part models and builds meshes |

Better Editor's own code, written for readability:

| File | Contents |
|---|---|
| `site/tm_runtime.js` | Geometry, physics hookup, effects, BE1 codes |
| `site/tm_menu.js` | The Plastic and Wood block browser |
| `tools/blocks/` | Block generator |
| `tools/patch.js` | Every change made to the original bundles |
