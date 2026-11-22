// 3.4.0 renamed the three functions that cluster an image: getClustering → buildClustering, getPalette → buildPalette,
// getSwatches → buildSwatches. The old names stay through 3.x as the very same functions (not wrappers), in both entries,
// both module systems and on every worker, and 4.0 removes them. This file keeps calling the old names on purpose.
import { describe, it, expect, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import * as main from '../dist/index.mjs';
import * as workerEntry from '../dist/worker.mjs';

const require = createRequire(import.meta.url);
const pairs = [['getClustering', 'buildClustering'], ['getPalette', 'buildPalette'], ['getSwatches', 'buildSwatches']];
const image = new Uint8Array(4 * 64).map((_, i) => (i * 37 + 11) & 255);

afterAll(() => workerEntry.terminate());

describe('each old name is the new function', () => {

    it('in the ES module build', () => {
        for (const [old, now] of pairs) {
            expect(typeof main[now], now).toBe('function');
            expect(main[old], old).toBe(main[now]);
            expect(typeof workerEntry[now], `worker ${now}`).toBe('function');
            expect(workerEntry[old], `worker ${old}`).toBe(workerEntry[now]);
        }
    });

    it('in the CommonJS build', () => {
        const cjs = require('../dist/index.cjs');
        for (const [old, now] of pairs) {
            expect(typeof cjs[now], now).toBe('function');
            expect(cjs[old], old).toBe(cjs[now]);
        }
    });

    it('in the worker entry\'s CommonJS build', () => {
        const cjs = require('../dist/worker.cjs');
        for (const [old, now] of pairs) {
            expect(typeof cjs[now], now).toBe('function');
            expect(cjs[old], old).toBe(cjs[now]);
        }
    });

    it('on a worker instance', async () => {
        const worker = workerEntry.createWorker();
        try {
            for (const [old, now] of pairs) {
                expect(typeof worker[now], now).toBe('function');
                expect(worker[old], old).toBe(worker[now]);
            }
        } finally {
            await worker.terminate();
        }
    });

});

describe('the new names', () => {

    it('give what the old ones gave', async () => {
        expect(await main.buildPalette(image, 3)).toEqual(await main.getPalette(image, 3));
        expect([...await main.buildClustering(image)]).toEqual([...await main.getClustering(image)]);
        expect(await main.buildSwatches(image, 3)).toEqual(await main.getSwatches(image, 3));
        expect(await workerEntry.buildPalette(image, 3)).toEqual(await main.getPalette(image, 3));
    });

    it('reject like the old ones before the worker has started', async () => {
        const a = workerEntry.createWorker();
        const b = workerEntry.createWorker();
        try {
            await expect(a.getPalette(image, 0)).rejects.toMatchObject({ code: 'invalid-argument', argument: 'k' });
            await expect(b.buildPalette(image, 0)).rejects.toMatchObject({ code: 'invalid-argument', argument: 'k' });
        } finally {
            await Promise.all([a.terminate(), b.terminate()]);
        }
    });

    it('are the ones messages name', async () => {
        const notClustering = await main.getPaletteFromClustering(new Uint8Array(9), 2).catch((e) => e);
        expect(notClustering.message).toContain('buildClustering');
        expect(notClustering.message).not.toMatch(/\bgetClustering\b/);
        const clustering = await main.buildClustering(image);
        const clusteringAsPalette = await main.quantizeWithPalette(image, clustering).catch((e) => e);
        expect(clusteringAsPalette.message).toContain('buildClustering');
        expect(clusteringAsPalette.message).not.toMatch(/\bgetClustering\b/);
    });

});
