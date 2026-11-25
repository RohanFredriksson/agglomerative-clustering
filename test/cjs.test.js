import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import * as esm from '../dist/index.mjs';

// The CommonJS build requires the ES-module WASM glue, which needs Node's require(esm) (see `engines`).
const require = createRequire(import.meta.url);

describe('CommonJS entry', () => {

    const gradient = new Uint8Array(4 * 64);
    for (let p = 0; p < 64; p++) {gradient.set([p * 4, 255 - p * 4, (p * 37) & 255, 255], p * 4);}

    it('loads with require and exports the same functions', () => {
        const cjs = require('../dist/index.cjs');
        expect(Object.keys(cjs).filter((key) => key !== '__esModule').sort()).toEqual(Object.keys(esm).sort());
    });

    it('gives the same results as the ES module', async () => {
        const cjs = require('../dist/index.cjs');
        expect(await cjs.buildClustering(gradient)).toEqual(await esm.buildClustering(gradient));
        expect(await cjs.quantize(gradient, 8)).toEqual(await esm.quantize(gradient, 8));
    });

    it('can require the worker entry through the exports map', async () => {
        const worker = require('agglomerative-clustering/worker');
        expect(typeof worker.createWorker).toBe('function');
        try {
            expect(await worker.buildPalette(gradient, 4)).toEqual(await esm.buildPalette(gradient, 4));
        } finally {
            await worker.terminate();
        }
    });

});
