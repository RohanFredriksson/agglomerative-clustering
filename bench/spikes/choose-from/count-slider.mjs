// What a live legend costs: the guides' countThreads maps the image to the chosen entries and counts. This times that
// counting pass, quantizeToIndicesWithPalette(image, choice.palette) plus the count, on kodim23 upscaled (nearest) to
// 4240 x 2832 (12 MP) and on a 1 MP version, at 12 and 40 entries of the spike's 584-thread chart, undithered and with
// Floyd-Steinberg. The choice comes from clustering.chooseFrom on the 1 MP image (the palette's origin doesn't change the
// mapping's time). Median of 5 runs, in ms.
//   node bench/spikes/choose-from/count-slider.mjs > bench/spikes/choose-from/results-count.txt
import * as ac from '../../../dist/index.mjs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';
import { PALETTES } from '../fixed-subset.js';

const { rgba, width: w0, height: h0 } = await getImageRgba(await ensureImage(KODAK_IMAGES.find((e) => e.name.includes('23'))));
const resize = (width, height) => {
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        const sy = Math.min(h0 - 1, Math.floor((y * h0) / height));
        for (let x = 0; x < width; x++) {
            const s = (sy * w0 + Math.min(w0 - 1, Math.floor((x * w0) / width))) * 4;
            data.set(rgba.subarray(s, s + 4), (y * width + x) * 4);
        }
    }
    return { data, format: 'rgba', width, height };
};
const sizes = { '12 MP (4240x2832)': resize(4240, 2832), '1 MP (1224x817)': resize(1224, 817) };
const threads = PALETTES.find((p) => p.name === 'threads').colours;
const clustering = await ac.buildClustering(sizes['1 MP (1224x817)']);
const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];

console.log(`kodim23, ${threads.length / 3} threads; countThreads' mapping and count, ms (median of 5)`);
for (const [label, image] of Object.entries(sizes)) {
    for (const n of [12, 40]) {
        const choice = await clustering.chooseFrom(threads, n);
        for (const dither of [false, true]) {
            const times = [];
            for (let run = 0; run < 5; run++) {
                const t0 = performance.now();
                const { indices, transparentIndex } = await ac.quantizeToIndicesWithPalette(image, choice.palette, { dither });
                const counts = new Array(n).fill(0);
                for (const s of indices) {if (s !== transparentIndex) {counts[s]++;}}
                times.push(performance.now() - t0);
            }
            console.log(`${label.padEnd(18)} ${String(n).padStart(2)} entries ${dither ? 'dithered  ' : 'undithered'} ${median(times).toFixed(0).padStart(6)}`);
        }
    }
}
