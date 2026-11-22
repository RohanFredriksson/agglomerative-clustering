// Run by test/jest.test.js under Jest's default CommonJS mode (node and jsdom environments): the worker entry's CommonJS
// build (dist/worker.cjs) starts its worker thread from worker-thread.mjs, which Node runs itself, outside Jest's modules.
const { getPalette, createWorker, terminate, isCodedError } = require('agglomerative-clustering/worker');
const main = require('agglomerative-clustering');

// Red, blue, green, red.
const image = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255]);

afterAll(() => terminate());

test('runs the shared worker, with the same results as the main entry', async () => {
    expect(Array.from(await getPalette(image, 3))).toEqual(Array.from(await main.getPalette(image, 3)));
});

test('the 3.4.0 names are the old names, on the shared exports and on a worker', async () => {
    const entry = require('agglomerative-clustering/worker');
    const worker = createWorker();
    try {
        for (const [old, now] of [['getClustering', 'buildClustering'], ['getPalette', 'buildPalette'], ['getSwatches', 'buildSwatches']]) {
            expect(typeof entry[now]).toBe('function');
            expect(entry[old]).toBe(entry[now]);
            expect(worker[old]).toBe(worker[now]);
        }
        expect(Array.from(await entry.buildPalette(image, 3))).toEqual(Array.from(await main.buildPalette(image, 3)));
    } finally {
        await worker.terminate();
    }
});

test('runs a worker of its own, and reports its errors with codes', async () => {
    const worker = createWorker();
    try {
        expect((await worker.quantize(image, 2)).length).toBe(image.length);
        const error = await worker.getPalette(image, 0).catch((caught) => caught);
        expect(isCodedError(error)).toBe(true);
        expect(error).toMatchObject({ code: 'invalid-argument', argument: 'k' });
    } finally {
        await worker.terminate();
    }
});
