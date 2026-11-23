// Clustering time and peak WebAssembly heap on large inputs, for two builds of dist/ (the allocator choice): a 12 MP
// photo (kodim23 tiled 4×6, each tile shifted in colour so they don't repeat) and 4 MP of noise, RGB and OKLab.
//   node bench/spikes/wasm-size/large.mjs <dist dir>
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';

const l = await import(new URL(`${process.argv[2].replace(/\/$/, '')}/index.mjs`, `file://${process.cwd()}/`).href);
const { rgba, width, height } = await getImageRgba(await ensureImage(KODAK_IMAGES[22]));
const tiles = 24, big = new Uint8Array(rgba.length * tiles);
for (let t = 0; t < tiles; t++) {for (let i = 0; i < rgba.length; i++) {big[t * rgba.length + i] = (i & 3) === 3 ? 255 : (rgba[i] + 7 * t) & 255;}}
let seed = 1; const noise = new Uint8Array(4e6 * 4).map((_, i) => ((i & 3) === 3 ? 255 : (seed = Math.imul(seed, 1103515245) + 12345) >>> 24));
for (const [name, data, opts, w = width] of [['12 MP photo, rgb', big, {}], ['12 MP photo, oklab', big, { colorSpace: 'oklab' }], ['4 MP noise, rgb', noise, {}, 2000]]) {
    const t = performance.now();
    await l.buildClustering({ data, format: 'rgba', width: w }, opts);
    console.log(`${name.padEnd(22)} ${(performance.now() - t).toFixed(0).padStart(6)} ms`);
}
