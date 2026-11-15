import { describe, it, expect, afterAll } from 'vitest';
import * as ac from '../dist/index.mjs';
import { createWorker } from '../dist/worker.mjs';

const image = new Uint8Array(4 * 16).fill(200);
const worker = createWorker();
afterAll(() => worker.terminate());

const caught = async (promise) => {
    try {await promise;} catch (error) {return error;}
    throw new Error('Expected a rejection.');
};

describe('errors carry a code', () => {

    it.each([
        ['an invalid image', () => ac.getPalette('nope', 4), 'invalid-argument'],
        ['an invalid k', () => ac.getPalette(image, 0), 'invalid-argument'],
        ['an unknown option', () => ac.getPalette(image, 4, { dither: true }), 'invalid-argument'],
        ['an invalid palette', () => ac.quantizeWithPalette(image, new Uint8Array(4)), 'invalid-argument'],
        ['bytes that are not a clustering', () => ac.getPaletteFromClustering(new Uint8Array([1, 2, 3, 4, 5]), 2), 'invalid-clustering'],
        ['a clustering from a newer format', () => ac.getPaletteFromClustering(new Uint8Array([0xAC, 99, 0, 0, 0, 0, 0]), 2), 'unsupported-version'],
    ])('%s', async (_, call, code) => {
        const error = await caught(call());
        expect(error).toBeInstanceOf(Error);
        expect(error.code).toBe(code);
    });

    it('needs a 3.x clustering for weights', async () => {
        const v2 = new Uint8Array([0xAC, 2, 0, 8, 1, 2, 3]);
        expect((await caught(ac.getPaletteWeights(v2, 1))).code).toBe('unsupported-version');
    });

});

describe('a worker fails like the main entry', () => {

    const cases = [
        ['an invalid k', (api) => api.getPalette(image, 0)],
        ['an unknown option', (api) => api.getPalette(image, 4, { dither: true })],
        ['an invalid clustering', (api) => api.getPaletteFromClustering(new Uint8Array([1, 2, 3, 4, 5]), 2)],
        ['a newer clustering', (api) => api.getClusteringInfo(new Uint8Array([0xAC, 99, 0, 0, 0, 0, 0]))],
    ];

    it.each(cases)('with %s', async (_, call) => {
        const expected = await caught(call(ac));
        const error = await caught(call(worker));
        expect(error.name).toBe(expected.name);
        expect(error.message).toBe(expected.message);
        expect(error.code).toBe(expected.code);
        expect(error.stack).toContain('errors.test');
        expect(error.cause?.message).toBe(expected.message);
    });

    it('codes handle and termination errors', async () => {
        const handle = await worker.cluster(image);
        await handle.release();
        expect((await caught(handle.getPalette(2))).code).toBe('invalid-handle');
        const doomed = createWorker();
        await doomed.terminate();
        expect((await caught(doomed.getPalette(image, 4))).code).toBe('worker-terminated');
        expect(() => createWorker({ transfer: 'yes' })).toThrow(expect.objectContaining({ code: 'invalid-argument' }));
    });

});
