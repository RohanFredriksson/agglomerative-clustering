/**
 * Speed benchmark: agglomerative-clustering vs NeuQuant (image-q)
 *
 * All libraries perform the same task: reduce an RGBA image to k colours.
 * NeuQuant is a fast neural-network-based quantizer; agglomerative clustering
 * trades speed for higher palette quality.
 * - agglomerative-clustering: quantize()
 * - NeuQuant (neural-network quantization): buildPaletteSync(..., { paletteQuantization: 'neuquant' })
 */

import { createRequire } from 'module';
import { bench, describe, beforeAll } from 'vitest';
import { init, quantize as acQuantize } from '../dist/index.mjs';

const require = createRequire(import.meta.url);
const iq = require('image-q');

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

/** Build a reproducible pseudo-random RGBA Uint8Array (LCG so it's fast). */
function makeImage(pixels) {
    const data = new Uint8Array(pixels * 4);
    let s = 0xdeadbeef;
    for (let i = 0; i < data.length; i++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        data[i] = s >>> 24;
    }
    return data;
}

function toPointContainer(rgba, side) {
    return iq.utils.PointContainer.fromUint8Array(rgba, side, side);
}

// Pre-build images at each size
const sizes = {
    '64x64':     { pixels: 64   * 64,   side: 64   },
    '256x256':   { pixels: 256  * 256,  side: 256  },
    '512x512':   { pixels: 512  * 512,  side: 512  },
    //'1024x1024': { pixels: 1024 * 1024, side: 1024 },
};

for (const [, s] of Object.entries(sizes)) {
    s.rgba           = makeImage(s.pixels);
    s.pointContainer = toPointContainer(s.rgba, s.side);
}

const kValues = [16, 64, 128, 256];

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

beforeAll(async () => {
    await init();
});

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

for (const k of kValues) {
    for (const [label, { rgba, pointContainer }] of Object.entries(sizes)) {

        describe(`quantize to ${k} colours — ${label}`, () => {

            bench('agglomerative-clustering (wasm)', async () => {
                await acQuantize(rgba, k);
            });

            bench('NeuQuant (image-q)', () => {
                iq.buildPaletteSync([pointContainer], { paletteQuantization: 'neuquant', colors: k });
            });

        });

    }
}
