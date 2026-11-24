// How quantize's time divides between clustering and mapping, which sets how its progress is split between them
// (clusteringShare in src/index.js). Times buildClustering and then quantizeFromClustering (one call each, best of
// two) through dist/ on the 24 Kodak photos (768x512) and 1 MP of noise, for each dither method, at 16 and 256
// colours and precision 8 and 6, and prints the clustering's share of the total: median, min and max.
//   node bench/spikes/slicing-mapping/split.mjs > bench/spikes/slicing-mapping/results-split.txt
import { buildClustering, quantizeFromClustering } from '../../../dist/index.mjs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';

const best = async (run) => {let t = Infinity; for (let i = 0; i < 2; i++) {const t0 = performance.now(); await run(); t = Math.min(t, performance.now() - t0);} return t;};
const methods = [['none', false], ['floyd-steinberg', true], ['atkinson', 'atkinson'], ['ordered', 'ordered'], ['ordered 64', { method: 'ordered', steps: 64 }]];
const photos = [];
for (const entry of KODAK_IMAGES) {const { rgba, width, height } = await getImageRgba(await ensureImage(entry)); photos.push({ data: rgba, format: 'rgba', width, height });}
let s = 1;
const noise = { data: new Uint8Array(1000 * 1000 * 4).map((_, i) => (i & 3) === 3 ? 255 : (s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 24), format: 'rgba', width: 1000, height: 1000 };
const q = (a, p) => {const v = [...a].sort((x, y) => x - y); return v[Math.min(v.length - 1, Math.floor(p * v.length))];};
console.log('set     precision  colours  method            share of clustering: median  min   max');
for (const [set, images] of [['photos', photos], ['noise', [noise]]]) {
    for (const precision of [8, 6]) {
        const clusterings = [], times = [];
        for (const image of images) {times.push(await best(async () => clusterings[images.indexOf(image)] = await buildClustering(image, { precision })));}
        for (const k of [16, 256]) {
            for (const [name, dither] of methods) {
                const shares = [];
                for (let i = 0; i < images.length; i++) {
                    const map = await best(() => quantizeFromClustering(images[i], clusterings[i], k, { dither }));
                    shares.push(times[i] / (times[i] + map));
                }
                console.log(`${set.padEnd(7)} ${String(precision).padStart(9)}  ${String(k).padStart(7)}  ${name.padEnd(16)}  ${q(shares, 0.5).toFixed(2).padStart(28)}  ${Math.min(...shares).toFixed(2)}  ${Math.max(...shares).toFixed(2)}`);
            }
        }
    }
}
