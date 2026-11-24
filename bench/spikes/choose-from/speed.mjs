// Speed of clustering.chooseFrom itself (3.8), on the Kodak photos with the fixed-subset spike's thread chart (584
// entries) and dense chart (1000), and a seeded random chart of 4096 entries to show how time grows with the chart.
// Times are for one call, in ms, scoring in RGB (the default) and in OKLab.
//   node bench/spikes/choose-from/speed.mjs [kodak limit] > bench/spikes/choose-from/results-speed.txt
import * as ac from '../../../dist/index.mjs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';
import { PALETTES } from '../fixed-subset.js';

const limit = Number(process.argv[2] ?? 24);
let seed = 12345;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const big = new Uint8Array(4096 * 3).map(() => Math.floor(random() * 256));
const charts = [
    ...PALETTES.filter((p) => p.name === 'threads' || p.name === 'dense'),
    { name: 'random', colours: big },
];
const times = new Map();
for (const entry of KODAK_IMAGES.slice(0, limit)) {
    const { rgba, width, height } = await getImageRgba(await ensureImage(entry));
    const clustering = await ac.buildClustering({ data: rgba, format: 'rgba', width, height });
    for (const { name, colours } of charts) {
        for (const k of name === 'random' ? [12, 40] : [12, 24, 40]) {
            for (const colorSpace of ['rgb', 'oklab']) {
                const t0 = performance.now();
                await clustering.chooseFrom(colours, k, { colorSpace });
                const key = `${name} (${colours.length / 3}), k = ${k}, ${colorSpace}`;
                (times.get(key) ?? times.set(key, []).get(key)).push(performance.now() - t0);
            }
        }
    }
}
console.log(`${limit} Kodak photos; clustering.chooseFrom, ms: median, max`);
for (const [key, v] of times) {v.sort((a, b) => a - b); console.log(`${key.padEnd(34)} ${v[v.length >> 1].toFixed(1).padStart(6)} ${v.at(-1).toFixed(1).padStart(7)}`);}
