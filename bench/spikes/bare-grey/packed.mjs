// fast-png's 1-, 2- and 4-bit grey PNGs stay bit-packed: what do the checks say about those bytes?
//   node bench/spikes/bare-grey/packed.mjs > bench/spikes/bare-grey/results-packed.txt
import { createRequire } from 'node:module';
import { looksLikeRgb } from '../../../dist/shared.mjs';
import { bareLayout } from '../../../dist/shared.mjs';
const looksLikeGrey = (d) => {const l = bareLayout(d); return l === 'rgb' ? null : l;}; // the shipped check (3.6.0), grey answers only
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';

const require = createRequire(new URL('../decoding/package.json', import.meta.url));
const fastPng = await import(require.resolve('fast-png'));
const counts = {};
for (const img of KODAK_IMAGES) {
    const { rgba, width, height } = await getImageRgba(await ensureImage(img));
    for (const depth of [1, 2, 4]) {
        const levels = (1 << depth) - 1, rowBytes = Math.ceil(width * depth / 8), packed = new Uint8Array(rowBytes * height);
        for (let y = 0; y < height; y++) {for (let x = 0; x < width; x++) {
            const p = 4 * (y * width + x), v = Math.round((0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2]) / 255 * levels);
            const bit = x * depth; packed[y * rowBytes + (bit >> 3)] |= v << (8 - depth - (bit & 7));
        }}
        const { data } = fastPng.decode(fastPng.encode({ width, height, data: packed, channels: 1, depth }));
        const key = `${depth}-bit`, c = (counts[key] ??= { n: 0, multiple: 0, grey: 0, greyAlpha: 0, rgb: 0 });
        c.n++; if (data.length % 4) {continue;} c.multiple++;
        const g = looksLikeGrey(data); if (g === 'grey') {c.grey++;} if (g === 'grey-alpha') {c.greyAlpha++;} if (looksLikeRgb(data)) {c.rgb++;}
    }
}
for (const [k, c] of Object.entries(counts)) {console.log(`${k}: ${c.n} Kodak photos, ${c.multiple} with a length that's a multiple of 4; the grey check says grey ${c.grey}, grey + alpha ${c.greyAlpha}; the RGB check flags ${c.rgb}`);}
