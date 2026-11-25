import { describe, it, expect } from 'vitest';
import { Clustering, buildClustering, buildPalette, buildSwatches } from '../dist/index.mjs';
import { createWorker } from '../dist/worker.mjs';

// 40 red pixels and two similar blues of 30, plus 20 fully transparent ones.
const px = [];
const add = (rgb, n, alpha = 255) => {for (let i = 0; i < n; i++) {px.push(...rgb, alpha);}};
add([255, 0, 0], 40); add([0, 0, 255], 30); add([20, 20, 235], 30); add([9, 9, 9], 20, 0);
const image = new Uint8Array(px);

// A 48 x 48 gradient with many distinct colours.
const gradient = new Uint8Array(48 * 48 * 4);
for (let p = 0; p < 48 * 48; p++) {gradient.set([(p % 48) * 5, Math.floor(p / 48) * 5, ((p % 48) * Math.floor(p / 48)) % 256, 255], p * 4);}

describe('Clustering.getSwatches', () => {

    it('gives the palette, the pixels each colour covers and each colour\'s share, lined up', async () => {
        const clustering = await buildClustering(image);
        const { palette, weights, shares } = await clustering.getSwatches(3);
        expect(palette).toEqual(await clustering.getPalette(3));
        expect(palette).toBeInstanceOf(Uint8Array);
        expect(weights).toBeInstanceOf(Float64Array);
        expect(shares).toBeInstanceOf(Float64Array);
        // Split order: a blue first (30 pixels), then red (40), then the other blue. The transparent pixels count nothing.
        expect(Array.from(weights)).toEqual([30, 40, 30]);
        expect(Array.from(shares)).toEqual([0.3, 0.4, 0.3]);
        expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    });

    it('lines the three arrays up and sums the shares to 1 at every size', async () => {
        const clustering = await buildClustering(gradient);
        for (const k of [1, 2, 3, 10, 100, 5000]) {
            const { palette, weights, shares } = await clustering.getSwatches(k);
            expect(weights.length).toBe(palette.length / 3);
            expect(shares.length).toBe(weights.length);
            expect(weights.reduce((a, b) => a + b, 0)).toBe(48 * 48);
            expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
            for (let i = 0; i < weights.length; i++) {expect(shares[i]).toBeCloseTo(weights[i] / (48 * 48), 12);}
        }
    });

    it('agrees with how many pixels the colours really cover when nothing is merged', async () => {
        const clustering = await buildClustering(gradient);
        const { maxColors: colors } = await clustering.getClusteringInfo();
        const { weights } = await clustering.getSwatches(colors);
        const indexed = await clustering.quantizeToIndices(gradient, colors);
        const used = new Float64Array(indexed.palette.length / 3);
        for (const index of indexed.indices) {used[index]++;}
        expect(Array.from(weights)).toEqual(Array.from(used));
    });

    it('gives empty arrays for an image with no visible pixels', async () => {
        const hidden = await (await buildClustering(new Uint8Array(16))).getSwatches(4);
        expect([hidden.palette.length, hidden.weights.length, hidden.shares.length]).toEqual([0, 0, 0]);
        const none = await (await buildClustering(new Uint8Array(0))).getSwatches(4);
        expect([none.palette.length, none.weights.length, none.shares.length]).toEqual([0, 0, 0]);
    });

    it('rejects what the other clustering functions reject', async () => {
        await expect((async () => new Clustering(new Uint8Array(5)).getSwatches(3))()).rejects.toMatchObject({ code: 'invalid-clustering' });
        await expect((await buildClustering(image)).getSwatches(0)).rejects.toMatchObject({ code: 'invalid-argument' });
        // A 2.x clustering has no weights.
        const v2 = new Uint8Array(await buildClustering(image));
        v2[1] = 2;
        await expect((async () => new Clustering(v2).getSwatches(3))()).rejects.toMatchObject({ code: 'invalid-clustering' });
    });

});

describe('getSwatches', () => {

    it('is the same as clustering and then cutting, for every kind of image', async () => {
        for (const source of [image, { data: image, format: 'rgba', width: 12, height: 10 }, { data: new Uint8Array(30).map((_, i) => (i * 29) & 255), format: 'rgb' }]) {
            for (const options of [{}, { colorSpace: 'oklab', precision: 6 }, { alpha: 'ignore' }]) {
                const direct = await buildSwatches(source, 3, options);
                expect(direct).toEqual(await (await buildClustering(source, options)).getSwatches(3));
                if (!options.alpha) {expect(direct.palette).toEqual(await buildPalette(source, 3, options));}
            }
        }
    });

    it('rejects a bad k before doing the work, and takes only clustering options', async () => {
        await expect(buildSwatches(image, 0)).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(buildSwatches(image, 3, { dither: true })).rejects.toThrow("Invalid option 'dither'");
        await expect(buildSwatches('not an image', 3)).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('can be cancelled and reports progress, like the other functions that cluster', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(buildSwatches(image, 3, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
        const progress = [];
        const swatches = await buildSwatches(image, 3, { onProgress: (value) => progress.push(value) });
        expect(progress[progress.length - 1]).toBe(1);
        expect(swatches).toEqual(await buildSwatches(image, 3));
    });

});

describe('swatches in the worker entry', () => {

    it('give the same results from a worker, a handle and the main entry', async () => {
        const worker = createWorker();
        try {
            const expected = await buildSwatches(gradient, 12);
            expect(await worker.buildSwatches(gradient, 12)).toEqual(expected);
            expect(await (await buildClustering(gradient)).getSwatches(12)).toEqual(expected);
            const handle = await worker.cluster(gradient);
            expect(await handle.getSwatches(12)).toEqual(expected);
            await handle.release();
        } finally {
            await worker.terminate();
        }
    });

});
