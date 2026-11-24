// Does OKLab scoring in the guides' improveThreads lose small vivid areas? (The 3.7.1 exploratory round saw a parrot's
// pink cheek and teal feather turn grey at 16 threads, kodim23.) For each Kodak photo, the guides' chooseThreads and
// improveThreads (read from docs/guides.md), scored in 'rgb' and in 'oklab', mapped in RGB without dithering. Reported:
// mean CIEDE2000 over all pixels; over the vivid pixels only (CIELAB chroma above 40, the most saturated few per cent);
// the chroma those vivid pixels lose; and how many chosen threads no pixel is mapped to.
//   node bench/spikes/fixed-subset-oklab/accents.mjs [kodak limit] > bench/spikes/fixed-subset-oklab/results-accents.txt
import { readFile } from 'fs/promises';
import * as entry from '../../../dist/index.mjs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';
import { ciede2000 } from '../../lib/metrics.js';
import { PALETTES } from '../fixed-subset.js';

const limit = Number(process.argv[2] ?? 24);
const guides = (await readFile(new URL('../../../docs/guides.md', import.meta.url), 'utf8')).split('\n');
const source = (name) => {
    const start = guides.findIndex((l) => new RegExp(`^ *(async )?function ${name}\\(`).test(l));
    const indent = /^ */.exec(guides[start])[0];
    const end = guides.findIndex((l, i) => i > start && l === `${indent}}`);
    return guides.slice(start, end + 1).join('\n');
};
const { chooseThreads, improveThreads } = new Function('getPaletteFromClustering', 'getSwatchesFromClustering', 'quantizeToIndicesWithPalette',
    `${source('chooseThreads')}\n${source('improveThreads')}\n${source('coordinates')}\nreturn { chooseThreads, improveThreads };`)(entry.getPaletteFromClustering, entry.getSwatchesFromClustering, entry.quantizeToIndicesWithPalette);

const linear = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lab = (r, g, b) => {
    [r, g, b] = [linear(r), linear(g), linear(b)];
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const fx = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047), fy = f(0.2126729 * r + 0.7151522 * g + 0.0721750 * b);
    const fz = f((0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
const chroma = ([, a, b]) => Math.hypot(a, b);

const cases = [['threads', 12], ['threads', 16], ['threads', 24], ['pigments', 4], ['pigments', 6]];
const rows = new Map();
let vividShare = 0;
for (const photo of KODAK_IMAGES.slice(0, limit)) {
    const { rgba, width, height } = await getImageRgba(await ensureImage(photo));
    const image = { data: rgba, format: 'rgba', width, height };
    const clustering = await entry.buildClustering(image);
    const labs = new Map(), labOf = (k) => {let v = labs.get(k); if (!v) {v = lab(k >> 16, (k >> 8) & 255, k & 255); labs.set(k, v);} return v;};
    const keys = new Int32Array(width * height);
    for (let p = 0; p < keys.length; p++) {keys[p] = (rgba[4 * p] << 16) | (rgba[4 * p + 1] << 8) | rgba[4 * p + 2];}
    const vivid = keys.map((k) => (chroma(labOf(k)) > 40 ? 1 : 0));
    const vividCount = vivid.reduce((x, y) => x + y, 0);
    vividShare += vividCount / keys.length;
    for (const [name, n] of cases) {
        const threads = PALETTES.find((p) => p.name === name).colours;
        const start = await chooseThreads(clustering, threads, n);
        for (const space of ['rgb', 'oklab']) {
            const chosen = await improveThreads(clustering, threads, start, space);
            const subset = new Uint8Array(3 * chosen.length);
            chosen.forEach((j, s) => subset.set(threads.subarray(3 * j, 3 * j + 3), 3 * s));
            const { indices } = await entry.quantizeToIndicesWithPalette(image, subset);
            const counts = new Array(chosen.length).fill(0);
            let all = 0, onVivid = 0, lost = 0;
            for (let p = 0; p < keys.length; p++) {
                const s = indices[p];
                counts[s]++;
                const o = labOf(keys[p]), q = labOf((subset[3 * s] << 16) | (subset[3 * s + 1] << 8) | subset[3 * s + 2]);
                const d = ciede2000(o, q);
                all += d;
                if (vivid[p]) {onVivid += d; lost += chroma(o) - chroma(q);}
            }
            const key = `${name} (${threads.length / 3}), N = ${n}, ${space}`;
            if (!rows.has(key)) {rows.set(key, { all: [], vivid: [], lost: [], unused: 0, photosUnused: 0 });}
            const r = rows.get(key);
            r.all.push(all / keys.length);
            if (vividCount) {r.vivid.push(onVivid / vividCount); r.lost.push(lost / vividCount);}
            const unused = counts.filter((c) => c === 0).length;
            r.unused += unused; r.photosUnused += unused ? 1 : 0;
        }
    }
}
const mean = (v) => v.reduce((x, y) => x + y, 0) / v.length;
console.log(`${limit} Kodak photos, mapped in RGB without dithering. Vivid pixels (CIELAB chroma > 40): ${(100 * vividShare / limit).toFixed(1)}% of pixels on average.`);
console.log('Mean CIEDE2000 over all pixels, over the vivid pixels, the chroma the vivid pixels lose, and chosen threads with no pixels (total, photos).\n');
console.log('case'.padEnd(34) + 'ΔE all'.padEnd(10) + 'ΔE vivid'.padEnd(10) + 'chroma lost'.padEnd(13) + 'unused threads');
for (const [key, r] of rows) {
    console.log(key.padEnd(34) + mean(r.all).toFixed(2).padEnd(10) + mean(r.vivid).toFixed(2).padEnd(10) + mean(r.lost).toFixed(2).padEnd(13) + `${r.unused} on ${r.photosUnused}`);
}
