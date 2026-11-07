// Decodes the game's own Draco-compressed glb models, so generated blocks can copy stock geometry exactly.
const fs = require('fs');
const path = require('path');
const site = path.join(__dirname, '..', '..', '..');

let decoderModule = null;
async function decoder() {
  if (decoderModule) return decoderModule;
  const src = fs.readFileSync(path.join(site, 'lib', 'draco', 'draco_wasm_wrapper.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', '__filename', '__dirname', src)(mod, mod.exports, require, '', '');
  const factory = mod.exports.DracoDecoderModule || mod.exports;
  decoderModule = await factory({ wasmBinary: fs.readFileSync(path.join(site, 'lib', 'draco', 'draco_decoder.wasm')) });
  return decoderModule;
}

// Returns { nodeName: { translation, rotation, scale, prims: [{ material, color, positions: Float32Array, indices: Uint32Array }] } }
async function loadGlb(file) {
  const D = await decoder();
  const b = fs.readFileSync(path.join(site, 'models', file));
  const jl = b.readUInt32LE(12),
    j = JSON.parse(b.slice(20, 20 + jl).toString()),
    bin = b.slice(20 + jl + 8);
  const out = {};
  for (const n of j.nodes) {
    if (n.mesh == null) continue;
    const prims = [];
    for (const p of j.meshes[n.mesh].primitives) {
      const ext = p.extensions.KHR_draco_mesh_compression,
        bv = j.bufferViews[ext.bufferView],
        data = new Int8Array(bin.buffer, bin.byteOffset + (bv.byteOffset || 0), bv.byteLength);
      const buf = new D.DecoderBuffer();
      buf.Init(data, data.length);
      const dec = new D.Decoder(),
        mesh = new D.Mesh(),
        st = dec.DecodeBufferToMesh(buf, mesh);
      if (!st.ok()) throw new Error('draco: ' + st.error_msg());
      const attr = dec.GetAttributeByUniqueId(mesh, ext.attributes.POSITION),
        np = mesh.num_points(),
        arr = new D.DracoFloat32Array();
      dec.GetAttributeFloatForAllPoints(mesh, attr, arr);
      const positions = new Float32Array(np * 3);
      for (let i = 0; i < np * 3; i++) positions[i] = arr.GetValue(i);
      const nf = mesh.num_faces(),
        ia = new D.DracoInt32Array(),
        indices = new Uint32Array(nf * 3);
      for (let f = 0; f < nf; f++) {
        dec.GetFaceFromMesh(mesh, f, ia);
        for (let k = 0; k < 3; k++) indices[f * 3 + k] = ia.GetValue(k);
      }
      [arr, ia, mesh, dec, buf].forEach((o) => D.destroy(o));
      const m = j.materials[p.material];
      prims.push({ material: m.name, color: m.pbrMetallicRoughness?.baseColorFactor ?? null, positions, indices });
    }
    out[n.name] = { translation: n.translation ?? [0, 0, 0], rotation: n.rotation ?? [0, 0, 0, 1], scale: n.scale ?? [1, 1, 1], prims };
  }
  return out;
}

module.exports = { loadGlb };
