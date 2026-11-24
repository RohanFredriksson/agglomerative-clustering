// Speed of the guides' chooseThreads + improveThreads as they stand in docs/guides.md (the functions are read from the
// guides' text and run through dist/), scoring in OKLab (the default) and in RGB, on the Kodak photos with the
// spike's thread chart (584) and dense chart (1000). Times are for improveThreads after chooseThreads, in ms.
//   node bench/spikes/fixed-subset-oklab/speed.mjs [kodak limit] > bench/spikes/fixed-subset-oklab/results-speed.txt
import { readFileSync } from 'node:fs';
import * as ac from '../../../dist/index.mjs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';
import { PALETTES } from '../fixed-subset.js';

const guides = readFileSync(new URL('../../../docs/guides.md', import.meta.url), 'utf8').split('\n');
const source = (name) => {
    const start = guides.findIndex((l) => new RegExp(`^\\s*(async )?function ${name}\\(`).test(l));
    const indent = guides[start].match(/^ */)[0];
    return guides.slice(start, guides.findIndex((l, i) => i > start && l === `${indent}}`) + 1).join('\n');
};
const { chooseThreads, improveThreads } = new Function('getPaletteFromClustering', 'getSwatchesFromClustering', 'quantizeToIndicesWithPalette',
    `${source('chooseThreads')}\n${source('improveThreads')}\n${source('coordinates')}\nreturn { chooseThreads, improveThreads };`)(ac.getPaletteFromClustering, ac.getSwatchesFromClustering, ac.quantizeToIndicesWithPalette);

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
