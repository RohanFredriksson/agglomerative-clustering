// Question 1, the JS boundary: what a call spends outside the C++, measured on the shipped dist/ build.
//   For each image: copying the pixels into the heap, un-premultiplying them (an alpha ramp, so no pixel is skipped),
//   a no-dither mapping to 16 colours in C++ (_quantize_with_palette), copying the result out, premultiplying it,
//   and the public call quantizeWithPalette on the same image (premultiplied: false and true) for the total.
//   For 0.4 MP also buildClustering against the C++ _get_clustering.
// Usage: node js-boundary.mjs [images...] (default k23 up12 up50); median of 5 (3 for 50 MP).
import createWasmModule from '../../../dist/clustering.js';
import { init, quantizeWithPalette, buildClustering, buildPalette } from '../../../dist/index.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const here = dirname(fileURLToPath(import.meta.url));
const meta = JSON.parse(readFileSync(join(here, 'data/images.json'), 'utf8'));
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const time = (f, n) => { const t = []; for (let i = 0; i < n; i++) { const s = performance.now(); f(); t.push(performance.now() - s); } return median(t); };
const timeAsync = async (f, n) => { const t = []; for (let i = 0; i < n; i++) { const s = performance.now(); await f(); t.push(performance.now() - s); } return median(t); };
const M = await createWasmModule();
await init();
const images = process.argv.slice(2).length ? process.argv.slice(2) : ['k23', 'up12', 'up50'];
const small = readFileSync(join(here, 'data/k23.rgba'));
const palette16 = await buildPalette({ data: new Uint8Array(small.buffer, small.byteOffset, small.length), format: 'rgba', width: 768, height: 512 }, 16);
const pal = M._malloc(palette16.length); M.HEAPU8.set(palette16, pal);
console.log('| image | pixels | copy in | unpremultiply | C++ map (k=16, no dither) | copy out | premultiply | public quantizeWithPalette | same, premultiplied input |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const name of images) {
    const { width, height, pixels } = meta[name];
    const n = pixels > 2e7 ? 3 : 5;
    const raw = readFileSync(join(here, `data/${name}.rgba`));
    const u8 = new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
    const ramp = new Uint8Array(u8); for (let i = 0; i < pixels; i++) ramp[i * 4 + 3] = (i % width) * 255 / (width - 1) | 0;
    let ptr = 0;
    const copyIn = time(() => { if (ptr) M._free(ptr); ptr = M._malloc(u8.length); M.HEAPU8.set(u8, ptr); }, n);
    M.HEAPU8.set(ramp, ptr);
    const un = time(() => { M.HEAPU8.set(ramp, ptr); M._unpremultiply(ptr, 0, pixels); }, n) - time(() => { M.HEAPU8.set(ramp, ptr); }, n);
    M.HEAPU8.set(u8, ptr);
    let out = 0;
    const map = time(() => { if (out) M._free(out); out = M._quantize_with_palette(ptr, u8.length, 0, pal, palette16.length, 0, 0, 0, 0, width, 0); }, n);
    const len = new DataView(M.HEAPU8.buffer).getUint32(out, true);
    const copyOut = time(() => { M.HEAPU8.slice(out + 4, out + 4 + len); }, n);
    const pre = time(() => { M._premultiply(out + 4, 0, pixels); }, n);
    M._free(out); M._free(ptr);
    const api = await timeAsync(() => quantizeWithPalette({ data: u8, format: 'rgba', width, height }, palette16), n);
    const apiPre = await timeAsync(() => quantizeWithPalette({ data: ramp, format: 'rgba', width, height, premultiplied: true }, palette16), n);
    console.log(`| ${name} | ${(pixels / 1e6).toFixed(1)} MP | ${copyIn.toFixed(1)} | ${un.toFixed(1)} | ${map.toFixed(1)} | ${copyOut.toFixed(1)} | ${pre.toFixed(1)} | ${api.toFixed(1)} | ${apiPre.toFixed(1)} |`);
}
// Clustering at 0.4 MP: public call against the C++ alone.
{
    const { width, height, pixels } = meta.k23;
    const u8 = new Uint8Array(small.buffer, small.byteOffset, small.length);
    const ptr = M._malloc(u8.length); M.HEAPU8.set(u8, ptr);
    const cpp = time(() => { const p = M._get_clustering(ptr, u8.length, 0, 0, 8, 1, 0); M._free(p); }, 5);
    const api = await timeAsync(() => buildClustering({ data: u8, format: 'rgba', width, height }), 5);
    console.log(`\nk23 clustering: C++ _get_clustering ${cpp.toFixed(1)} ms; public buildClustering ${api.toFixed(1)} ms (the difference includes the heap copy, the 10 ms slicing is not used without signal or onProgress)`);
}
