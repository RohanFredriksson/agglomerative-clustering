// Where each allocator runs out of memory: one clustering per process, at sizes up to the documented limit
// (docs/performance.md: "about 480 megapixels of RGBA: 22000 × 22000 works").
//   distinct: pixel i gets colour bijection(i mod 2^24), so up to 16.7 million distinct colours, repeating above that
//   photo:    kodim23 tiled, each tile shifted in colour (7 × tile index per channel, mod 256)
//   few:      256 colours (a grey ramp across x)
// A fifth argument p6 clusters at precision: 6.
//   node bench/spikes/wasm-size/limits.mjs <dist dir> <distinct|photo> <width> <height> [rgb|oklab]
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';

const [dir, kind, w, h, space = 'rgb', p] = process.argv.slice(2);
const width = Number(w), height = Number(h), n = width * height;
const l = await import(new URL(`${dir.replace(/\/$/, '')}/index.mjs`, `file://${process.cwd()}/`).href);
const data = new Uint8Array(n * 4);
if (kind === 'distinct') {
    for (let i = 0; i < n; i++) {const c = Math.imul(i & 0xFFFFFF, 2654435761) >>> 8; data[4 * i] = c >>> 16; data[4 * i + 1] = (c >>> 8) & 255; data[4 * i + 2] = c & 255; data[4 * i + 3] = 255;}
} else if (kind === 'few') {
    for (let i = 0; i < n; i++) {const g = (i % width) & 255; data[4 * i] = g; data[4 * i + 1] = g; data[4 * i + 2] = g; data[4 * i + 3] = 255;}
} else {
    const k = await getImageRgba(await ensureImage(KODAK_IMAGES[22]));
    for (let y = 0; y < height; y++) {
        const ty = Math.floor(y / k.height), sy = y % k.height;
        for (let x = 0; x < width; x++) {
            const shift = 7 * (ty * 64 + Math.floor(x / k.width)), s = 4 * (sy * k.width + (x % k.width)), d = 4 * (y * width + x);
            data[d] = (k.rgba[s] + shift) & 255; data[d + 1] = (k.rgba[s + 1] + shift) & 255; data[d + 2] = (k.rgba[s + 2] + shift) & 255; data[d + 3] = 255;
        }
    }
}
const t = performance.now();
try {
    await l.buildClustering({ data, format: 'rgba', width }, { colorSpace: space, ...(p === 'p6' ? { precision: 6 } : {}) });
    console.log(`${dir} ${kind} ${width}x${height} ${space}${p ? ' ' + p : ''}: ok, ${((performance.now() - t) / 1000).toFixed(0)} s`);
} catch (e) {console.log(`${dir} ${kind} ${width}x${height} ${space}${p ? ' ' + p : ''}: ${e.code ?? e.name} ${String(e.message).slice(0, 90)}`);}
