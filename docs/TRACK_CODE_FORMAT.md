# PolyTrackBE1 track codes

A track that uses no new blocks still exports as a normal `PolyTrack2...` code with its normal track id, so it works everywhere stock codes work. A track with at least one new block exports as `PolyTrackBE1...`. Stock PolyTrack rejects those as an invalid code.

## Layout

`PolyTrackBE1` + base62( zlib( base62( zlib( metadata + body ) ) ) )

The base62 packing and both zlib layers are the same as PolyTrack2.

**Metadata** (same as PolyTrack2)

| Bytes | Meaning |
|---|---|
| 1 + n | name length, UTF-8 name |
| 1 + n | author length, UTF-8 author (length 0 = none) |
| 1 [+ 4] | 0 = no date, 1 = u32 LE unix seconds follows |

**Body**

| Bytes | Meaning |
|---|---|
| 1 | environment: 0 Summer, 1 Winter, 2 Desert |
| 1 | sun direction, 0-179 |
| 12 | min x, y, z as i32 LE |
| 1 | byte widths: x in bits 0-1, y in bits 2-3, z in bits 4-5 |
| 2 | catalogue version, u16 LE. **New in BE1** |

Then one group per part type, until the end of the data:

| Bytes | Meaning |
|---|---|
| 2 | part id, u16 LE. **One byte in PolyTrack2** |
| 4 | part count, u32 LE |

And for each part in the group:

| Bytes | Meaning |
|---|---|
| x, y, z widths | position minus the minimum, unsigned LE |
| 1 | rotation in bits 0-1, rotation axis in bits 2-4 |
| 1 | colour |
| 2 | checkpoint order, u16 LE. Only for checkpoint parts |
| 4 | start order, u32 LE. Only for start parts |

Part ids 0-189 are stock. New blocks start at 1000. Part ids are permanent: `tools/blocks/ids.json` only ever gets new entries.

## Supporting these codes on another site

A site needs these files from `site/`, plus the same patches to its own bundles (`tools/patch.js` lists each one):

- `tm_parts.js`: the part table (ids, tiles, trigger boxes, colours)
- `tm_runtime.js`: reads BE1 codes, loads geometry, handles physics and effects
- `models/tm_blocks.bin`: the geometry

To read a code, call `TM.fromExport(code, ctx)`, where `ctx` provides `pako`, `fromBase62`, `create(environment, sun)`, and the valid environment, part id, axis and colour tables plus the checkpoint and start part lists. The `tmCtx` block in `tools/patch.js` is a working example.

To replay runs identically, a site must use the same physics changes: new-block triangles appended to the terrain mesh in part order, and gates sent through the proxy ids listed in `tm_parts.js`.

The save string (the form used for track ids and the physics worker) is the same data with the prefix `~BE1` and no metadata.
