/**
 * Quick speed benchmark (vitest bench): agglomerative-clustering against other palette
 * quantizers, using the same adapters as the full harness (bench/run.js).
 *
 * Every library does the same job: produce a palette (no pixel mapping). Two cases:
 * - one palette at k = 64
 * - palettes at k = 16, 64, 128 and 256. agglomerative-clustering clusters once and cuts
 *   the hierarchy at each k; the other libraries have to start over for each k.
 *
 * Images: two Kodak photos (busy and smooth) and uniform noise, the worst case for
 * clustering. For quality, and for every image and k, use `npm run bench:full`.
 */

import { bench, describe } from 'vitest';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../fixtures/kodak.js';
import { syntheticImages } from './lib/images.js';
import { agglomerative, LIBRARIES } from './lib/quantizers.js';

const options = { iterations: 3, warmupIterations: 1, time: 0, warmupTime: 0 };
const sweepKs = [16, 64, 128, 256];

const images = [];
for (const name of ['kodim05', 'kodim23']) {
    const { rgba, width, height } = await getImageRgba(await ensureImage(KODAK_IMAGES.find(img => img.name === name)));
    images.push({ name, rgba, width, height });
}
images.push(syntheticImages().find(image => image.name === 'noise-512'));

const libraries = [await agglomerative('agglomerative-clustering')];
for (const make of Object.values(LIBRARIES)) {libraries.push(make());}
for (const lib of libraries) {await lib.init?.();}

for (const image of images) {
    describe(`palette, k = 64: ${image.name}`, () => {
        for (const lib of libraries) {bench(lib.name, () => lib.palette(image, 64), options);}
    });

    describe(`palettes at k = ${sweepKs.join(', ')}: ${image.name}`, () => {
        for (const lib of libraries) {
            bench(lib.name, async () => {
                if (lib.paletteSweep) {return lib.paletteSweep(image, sweepKs);}
                for (const k of sweepKs) {await lib.palette(image, k);}
            }, options);
        }
    });
}
