// Speed of the 3.7.2 guides' chooseThreads + improveThreads (test/reference/fixed-palette-recipe.js, run through dist/;
// the guides now use clustering.chooseFrom), scoring in OKLab (the default) and in RGB, on the Kodak photos with the
// spike's thread chart (584) and dense chart (1000). Times are for improveThreads after chooseThreads, in ms.
//   node bench/spikes/fixed-subset-oklab/speed.mjs [kodak limit] > bench/spikes/fixed-subset-oklab/results-speed.txt
import { recipe } from '../../../test/reference/fixed-palette-recipe.js';
import * as ac from '../../../dist/index.mjs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';
import { PALETTES } from '../fixed-subset.js';

const { chooseThreads, improveThreads } = recipe(ac);

const limit = Number(process.argv[2] ?? 24);
const charts = PALETTES.filter((p) => p.name === 'threads' || p.name === 'dense');
const times = new Map();
for (const entry of KODAK_IMAGES.slice(0, limit)) {
    const { rgba, width, height } = await getImageRgba(await ensureImage(entry));
    const clustering = await ac.buildClustering({ data: rgba, format: 'rgba', width, height });
    for (const { name, colours } of charts) {
        for (const n of [6, 12, 24, 40]) {
            const start = await chooseThreads(clustering, colours, n);
            for (const space of ['oklab', 'rgb']) {
                const t0 = performance.now();
                await improveThreads(clustering, colours, start, space);
                const key = `${name} (${colours.length / 3}), N = ${n}, ${space}`;
                (times.get(key) ?? times.set(key, []).get(key)).push(performance.now() - t0);
            }
        }
    }
}
console.log(`${limit} Kodak photos; improveThreads as in docs/guides.md, ms: median, max`);
for (const [key, v] of times) {v.sort((a, b) => a - b); console.log(`${key.padEnd(34)} ${v[v.length >> 1].toFixed(1).padStart(6)} ${v.at(-1).toFixed(1).padStart(7)}`);}
