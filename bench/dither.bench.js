/**
 * Dithering speed (vitest bench): the time to map a Kodak photo to a palette of 16 and of 64 colours with each dither
 * method, against no dithering. Ordered dithering builds a recipe of `mix` palette colours for every distinct colour,
 * so its cost grows with the mix and with the number of distinct colours (about 70,000 in kodim23).
 *
 *   npx vitest bench bench/dither.bench.js --run
 */

import { bench, describe } from 'vitest';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../fixtures/kodak.js';
import { buildPalette, quantizeWithPalette } from '../dist/index.mjs';

const options = { iterations: 9, warmupIterations: 2, time: 0, warmupTime: 0 };
const { rgba, width } = await getImageRgba(await ensureImage(KODAK_IMAGES.find((img) => img.name === 'kodim23')));
const image = { data: rgba, format: 'rgba', width };

const methods = {
    'none': false,
    'floyd-steinberg': true,
    'atkinson': 'atkinson',
    'ordered, mix 8': { method: 'ordered', mix: 8 },
    'ordered, mix 16': 'ordered',
    'ordered, mix 32': { method: 'ordered', mix: 32 },
};

for (const k of [16, 64]) {
    const palette = await buildPalette(image, k);
    describe(`kodim23, ${k} colours`, () => {
        for (const [name, dither] of Object.entries(methods)) {
            bench(name, () => quantizeWithPalette(image, palette, { dither }), options);
        }
    });
}
