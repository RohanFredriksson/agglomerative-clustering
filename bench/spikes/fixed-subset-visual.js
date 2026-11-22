/**
 * Pictures for the fixed-subset spike: for a few photos, the image mapped to all of a fixed
 * set and to N entries chosen by top-n, the recipe and the search, plus the chosen colours.
 *
 * Usage: node bench/spikes/fixed-subset-visual.js <out dir>
 */
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { createCanvas } from 'canvas';
import { buildClustering, getSwatchesFromClustering, quantizeWithPalette } from '../../dist/index.mjs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../fixtures/kodak.js';
import { measure } from '../lib/metrics.js';
import { PALETTES, pick, topN, recipe, search } from './fixed-subset.js';

const OUT = process.argv[2];
const CASES = [
    { image: 'kodim23', palette: 'threads', n: 12 },
    { image: 'kodim04', palette: 'threads', n: 6 },
];

const png = (rgba, width, height, type = 'image/png') => {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const data = ctx.createImageData(width, height);
    data.data.set(rgba);
    ctx.putImageData(data, 0, 0);
    return type === 'image/png' ? canvas.toBuffer('image/png') : canvas.toBuffer('image/jpeg', { quality: 0.9 });
};
const hex = (F, i) => '#' + [0, 1, 2].map((t) => F[3 * i + t].toString(16).padStart(2, '0')).join('');

await mkdir(OUT, { recursive: true });
const data = { cases: [] };
for (const c of CASES) {
    const { rgba, width, height } = await getImageRgba(await ensureImage(KODAK_IMAGES.find((k) => k.name === c.image)));
    const image = { data: rgba, format: 'rgba', width };
    const F = PALETTES.find((p) => p.name === c.palette).colours;
    const clustering = await buildClustering(image);
    const sw = await getSwatchesFromClustering(clustering, 1024);
    const all = [...Array(F.length / 3).keys()];
    const chosen = {
        all,
        'top-n': await topN(image, F, c.n),
        recipe: await recipe(clustering, F, c.n),
        search: search(sw, F, c.n),
    };
    const entry = { ...c, width, height, chartSize: F.length / 3, chart: all.map((i) => hex(F, i)), original: `${c.image}.jpg`, methods: {} };
    await writeFile(join(OUT, entry.original), png(rgba, width, height, 'image/jpeg'));
    for (const [method, ids] of Object.entries(chosen)) {
        const out = await quantizeWithPalette(image, pick(F, ids));
        const file = `${c.image}-${c.n}-${method}.png`;
        await writeFile(join(OUT, file), png(out.data, width, height));
        const { psnr, deltaE } = measure(rgba, out.data);
        entry.methods[method] = { file, psnr, deltaE, ids, colours: ids.map((i) => hex(F, i)) };
        console.log(c.image, c.n, method, psnr.toFixed(2), deltaE.toFixed(2));
    }
    data.cases.push(entry);
}
await writeFile(join(OUT, 'data.json'), JSON.stringify(data));
