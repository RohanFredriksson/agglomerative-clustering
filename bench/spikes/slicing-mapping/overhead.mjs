// What slicing costs a mapping call: quantizeWithPalette and quantizeToIndicesWithPalette with and without a signal
// (which makes them run in slices), through dist/, in the main entry and the worker entry, on small and large
// images. Median of 15 runs (5 on the large image), alternating the two forms.
//   node bench/spikes/slicing-mapping/overhead.mjs > bench/spikes/slicing-mapping/results-overhead.txt
import { buildPalette, quantizeWithPalette, quantizeToIndicesWithPalette } from '../../../dist/index.mjs';
import { createWorker } from '../../../dist/worker.mjs';
import { KODAK_IMAGES, ensureImage } from '../../../fixtures/kodak.js';
import sharp from 'sharp';

const photo = async (width, height) => {
    const data = new Uint8Array(await sharp(await ensureImage(KODAK_IMAGES[22])).resize(width, height, { fit: 'fill' }).ensureAlpha().raw().toBuffer());
    return { data, format: 'rgba', width, height };
};
const sizes = [[64, 64], [768, 512], [960, 540], [3072, 2048]];
const images = [];
for (const [w, h] of sizes) {images.push(await photo(w, h));}
const palette = await buildPalette(images[1], 64);
const median = (v) => [...v].sort((a, b) => a - b)[v.length >> 1];
const worker = createWorker();
const entries = [['main', { quantizeWithPalette, quantizeToIndicesWithPalette }], ['worker', worker]];
console.log('entry   image       function                       dither            one call    sliced   change');
for (const [entry, api] of entries) {
    for (const image of images) {
        const runs = image.width > 1000 ? 5 : 15;
        for (const fn of ['quantizeWithPalette', 'quantizeToIndicesWithPalette']) {
            for (const [name, dither] of [['none', false], ['floyd-steinberg', true], ['ordered', 'ordered']]) {
                const plain = [], sliced = [];
                for (let i = 0; i < runs + 1; i++) {
                    let t0 = performance.now();
                    await api[fn](image, palette, { dither });
                    const a = performance.now() - t0;
                    t0 = performance.now();
                    await api[fn](image, palette, { dither, signal: new AbortController().signal });
                    const b = performance.now() - t0;
                    if (i > 0) {plain.push(a); sliced.push(b);}  // the first round warms up
                }
                const a = median(plain), b = median(sliced);
                console.log(`${entry.padEnd(7)} ${`${image.width}x${image.height}`.padEnd(11)} ${fn.padEnd(30)} ${name.padEnd(16)} ${a.toFixed(2).padStart(8)} ms ${b.toFixed(2).padStart(8)} ms ${(100 * (b / a - 1)).toFixed(1).padStart(6)}%`);
            }
        }
    }
}
await worker.terminate();
