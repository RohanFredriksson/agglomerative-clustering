// Kodak visual tests — outputs are written to test/visual/output/kodak/ for developer inspection.
// Each test writes the original image alongside the AC and NeuQuant quantized versions,
// so quality differences can be assessed by eye.
//
// Uses a representative subset of 6 images across the Kodak suite at k=16, 64, 256.
// Images are downloaded on first run from the Kodak dataset (see fixtures/kodak.js).

import { describe, it, beforeAll } from 'vitest';
import { createRequire } from 'module';
import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { init, quantize as acQuantize } from '../../dist/index.mjs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../fixtures/kodak.js';

const require = createRequire(import.meta.url);
const iq = require('image-q');

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, 'output', 'kodak');

function writeOutput(name, rgba, width, height) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(rgba);
    ctx.putImageData(imageData, 0, 0);
    writeFileSync(resolve(OUTPUT_DIR, `${name}.png`), canvas.toBuffer('image/png'));
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Representative subset: varied scene types across the 24-image suite
const SUBSET = [
    KODAK_IMAGES[0],   // kodim01 — outdoor church scene
    KODAK_IMAGES[4],   // kodim05 — building/urban
    KODAK_IMAGES[9],   // kodim10 — animal (parrot)
    KODAK_IMAGES[14],  // kodim15 — outdoor sunset
    KODAK_IMAGES[18],  // kodim19 — animal (lighthouse/boats)
    KODAK_IMAGES[22],  // kodim23 — portrait/outdoor
];

const kValues = [16, 64, 256];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    await init();
    console.log('\nDownloading any missing Kodak images:');
    for (const image of SUBSET) {
        await ensureImage(image);
    }
}, 120_000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('kodak visual — AC vs NeuQuant', () => {

    for (const image of SUBSET) {
        for (const k of kValues) {

            it(`${image.name} k=${k}`, async () => {
                const path = await ensureImage(image);
                const { rgba, pixels, width, height } = await getImageRgba(path);
                const pointContainer = iq.utils.PointContainer.fromUint8Array(rgba, width, height);

                // Original
                writeOutput(`${image.name}-original`, rgba, width, height);

                // agglomerative-clustering
                const acResult = await acQuantize(rgba, k);
                writeOutput(`${image.name}-ac-k${k}`, acResult, width, height);

                // NeuQuant
                const nqPalette   = iq.buildPaletteSync([pointContainer], { paletteQuantization: 'neuquant', colors: k });
                const nqContainer = iq.applyPaletteSync(pointContainer, nqPalette);
                writeOutput(`${image.name}-neuquant-k${k}`, nqContainer.toUint8Array(), width, height);
            }, 60_000);

        }
    }

});
