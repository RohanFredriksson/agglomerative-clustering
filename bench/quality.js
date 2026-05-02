/**
 * Quality comparison: agglomerative-clustering vs NeuQuant (image-q)
 *
 * Uses the Kodak Lossless True Color Image Suite — 24 natural photos at 768×512,
 * the standard dataset for image quality benchmarking. Images are downloaded on
 * first run and cached in fixtures/images/ (gitignored).
 *
 * Measures mean squared error (MSE) per pixel per channel between the original
 * and each algorithm's quantized output. Lower MSE = better colour fidelity.
 *
 * Run with: npm run quality
 */

import { createRequire } from 'module';
import { init, quantize as acQuantize } from '../dist/index.mjs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../fixtures/kodak.js';

const require = createRequire(import.meta.url);
const iq = require('image-q');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** MSE over RGB channels (alpha ignored). Both buffers must be RGBA. */
function mse(original, quantized, pixels) {
    let sum = 0;
    for (let i = 0; i < pixels; i++) {
        const o = i * 4;
        const dr = original[o]     - quantized[o];
        const dg = original[o + 1] - quantized[o + 1];
        const db = original[o + 2] - quantized[o + 2];
        sum += dr * dr + dg * dg + db * db;
    }
    return sum / (pixels * 3);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const kValues = [16, 64, 128, 256];

await init();

console.log('Kodak image suite (downloading any missing images):');
const imagePaths = [];
for (const img of KODAK_IMAGES) {
    imagePaths.push(await ensureImage(img));
}

console.log('\nRunning quality comparison...\n');

const acTotals  = Object.fromEntries(kValues.map(k => [k, 0]));
const nqTotals  = Object.fromEntries(kValues.map(k => [k, 0]));
const rows = [];

for (let i = 0; i < KODAK_IMAGES.length; i++) {
    const { name } = KODAK_IMAGES[i];
    const { rgba, pixels, width, height } = await getImageRgba(imagePaths[i]);
    const pointContainer = iq.utils.PointContainer.fromUint8Array(rgba, width, height);

    for (const k of kValues) {
        const acQuantized = await acQuantize(rgba, k);
        const acMse = mse(rgba, acQuantized, pixels);

        const nqPalette   = iq.buildPaletteSync([pointContainer], { paletteQuantization: 'neuquant', colors: k });
        const nqContainer = iq.applyPaletteSync(pointContainer, nqPalette);
        const nqMse = mse(rgba, nqContainer.toUint8Array(), pixels);

        acTotals[k] += acMse;
        nqTotals[k] += nqMse;

        rows.push({
            image:           name,
            k,
            'AC MSE':        acMse.toFixed(2),
            'NeuQuant MSE':  nqMse.toFixed(2),
            'NeuQuant / AC': (nqMse / acMse).toFixed(2) + 'x worse',
        });
    }

    process.stdout.write(`  ${name} done\n`);
}

console.log('\n--- Per-image results ---');
console.table(rows);

console.log('\n--- Averages across all 24 images ---');
console.table(kValues.map(k => ({
    k,
    'Avg AC MSE':       (acTotals[k]  / KODAK_IMAGES.length).toFixed(2),
    'Avg NeuQuant MSE': (nqTotals[k]  / KODAK_IMAGES.length).toFixed(2),
    'NeuQuant / AC':    (nqTotals[k]  / acTotals[k]).toFixed(2) + 'x worse',
})));
