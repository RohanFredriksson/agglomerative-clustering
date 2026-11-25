import { describe, it, expect, afterAll } from 'vitest';
import { deepStrictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';
import { Clustering, buildClustering, buildPalette } from '../dist/index.mjs';
import { createWorker } from '../dist/worker.mjs';

// A 32 x 32 gradient with many distinct colours, its bottom rows partly transparent.
const width = 32;
const image = new Uint8Array(width * width * 4);
for (let p = 0; p < width * width; p++) {
    image.set([(p % width) * 8, Math.floor(p / width) * 8, ((p % width) * Math.floor(p / width)) % 256, p < width * 28 ? 255 : 60], p * 4);
}

const worker = createWorker();
afterAll(() => worker.terminate());

const names = ['getPalette', 'getSwatches', 'getClusteringInfo', 'quantize', 'quantizeToIndices'];

// Each source of a Clustering the methods are on.
const sources = {
    'buildClustering': () => buildClustering(image),
    'new Clustering(bytes)': async () => new Clustering(new Uint8Array(await buildClustering(image))),
    'a worker handle': async () => {
        const handle = await worker.cluster(image);
        try {return await handle.getClustering();} finally {await handle.release();}
    },
};

describe('methods on Clustering', () => {

    for (const [source, make] of Object.entries(sources)) {
        it(`give what a loaded worker handle gives, on a clustering from ${source}`, async () => {
            const clustering = await make();
            const handle = await worker.load(clustering);
            try {
                expect(await clustering.getPalette(6)).toEqual(await handle.getPalette(6));
                expect(await clustering.getSwatches(6)).toEqual(await handle.getSwatches(6));
                expect(await clustering.getClusteringInfo()).toEqual(await handle.getClusteringInfo());
                expect(await clustering.quantize(image, 6, { dither: 'atkinson', width })).toEqual(await handle.quantize(image, 6, { dither: 'atkinson', width }));
                expect(await clustering.quantizeToIndices(image, 6)).toEqual(await handle.quantizeToIndices(image, 6));
            } finally {
                await handle.release();
            }
        });
    }

    it('keep the result type of the image, like quantize', async () => {
        const clustering = await buildClustering(image);
        const raw = await clustering.quantize({ data: image, format: 'rgba', width, height: width }, 4);
        expect(raw.format).toBe('rgba');
        expect(raw.width).toBe(width);
        const data = new ImageData(new Uint8ClampedArray(image), width, width);
        expect(await clustering.quantize(data, 4)).toBeInstanceOf(ImageData);
    });

    it('map in the clustering\'s colour space unless one is named', async () => {
        const clustering = await buildClustering(image, { colorSpace: 'oklab' });
        const own = await clustering.quantize(image, 8);
        expect(own).toEqual(await clustering.quantize(image, 8, { colorSpace: 'oklab' }));
        expect(own).toEqual(await clustering.quantize(image, 8, { colorSpace: 'oklab' }));
        expect(own).not.toEqual(await clustering.quantize(image, 8, { colorSpace: 'rgb' }));
        expect((await clustering.getPalette(8)).colorSpace).toBe('oklab');
    });

    it('give indexed output the clustering\'s cutoff unless one is named', async () => {
        const clustering = await buildClustering(image, { transparent: 128 });
        const indexed = await clustering.quantizeToIndices(image, 8);
        expect(indexed.transparentIndex).not.toBeNull();
        expect((await clustering.quantizeToIndices(image, 8, { transparent: false })).transparentIndex).toBeNull();
    });

    it('stay hidden: a clustering is still plain bytes', async () => {
        const clustering = await buildClustering(image);
        const plain = new Uint8Array(clustering);
        expect(clustering.constructor).toBe(Uint8Array);
        expect(clustering).toEqual(plain);
        deepStrictEqual(clustering, plain);
        expect(Object.keys(clustering)).toEqual(Object.keys(plain));
        for (const name of names) {
            expect(typeof clustering[name]).toBe('function');
            expect(Object.getOwnPropertyDescriptor(clustering, name).enumerable).toBe(false);
        }
        // Slices and clones are plain bytes, as they are without their tags.
        expect(clustering.slice().getPalette).toBeUndefined();
        expect(clustering.subarray(0).getPalette).toBeUndefined();
        expect(structuredClone(clustering).getPalette).toBeUndefined();
    });

    it('are on palettes from no function: a Palette has no methods', async () => {
        expect((await buildPalette(image, 4)).quantize).toBeUndefined();
    });

});

describe('errors from methods on Clustering', () => {

    const rejects = async (promise, code, argument, message) => {
        const error = await promise.then(() => null, (reason) => reason);
        expect(error, 'the call rejects').not.toBeNull();
        expect(error.code).toBe(code);
        expect(error.argument).toBe(argument);
        expect(error.message).toMatch(message);
    };

    it('reject a call without its clustering, and say how to make it', async () => {
        const clustering = await buildClustering(image);
        const { getPalette: detached } = clustering;
        await rejects(detached(4), 'invalid-clustering', 'clustering', /^Invalid clustering: getPalette was called without its clustering \(this is undefined\)\. Call it as clustering\.getPalette\(k\), or use a loaded handle's getPalette: \(await worker\.load\(clustering\)\)\.getPalette\(k\)\.$/);
        await rejects(clustering.quantize.call({}, image, 4), 'invalid-clustering', 'clustering', /without its clustering .*\(await worker\.load\(clustering\)\)\.quantize\(image, k\)/);
    });

    it('never throw synchronously: every error is a rejection', async () => {
        const clustering = await buildClustering(image);
        expect(() => clustering.getPalette.call(undefined, 4).catch(() => {})).not.toThrow();
        expect(() => clustering.quantize(16).catch(() => {})).not.toThrow();
    });

    it('read bytes that are not a clustering', async () => {
        const clustering = await buildClustering(image);
        const palette = await buildPalette(image, 4);
        await rejects(clustering.getPalette.call(palette, 4), 'invalid-clustering', 'clustering', /this is a palette, not a clustering/);
        // Untagged bytes that are a clustering are accepted, as by the functions.
        expect(await clustering.getPalette.call(new Uint8Array(clustering), 4)).toEqual(await clustering.getPalette(4));
    });

    it('explain the worker handle\'s shape, quantize(k), given where the image goes', async () => {
        const clustering = await buildClustering(image);
        await rejects(clustering.quantize(16), 'invalid-argument', 'image', /^Invalid image: got 16\. clustering\.quantize takes the image first: clustering\.quantize\(image, k\)\. \(A worker handle's quantize\(k\) maps the image it holds\.\)$/);
        await rejects(clustering.quantizeToIndices(16), 'invalid-argument', 'image', /clustering\.quantizeToIndices\(image, k\)/);
    });

    it('reject options on a cut, naming the method form', async () => {
        const clustering = await buildClustering(image);
        const message = /^Invalid arguments: clustering\.getPalette takes no options .* use clustering\.quantize\(image, k, options\)\.$/;
        await rejects(clustering.getPalette(4, {}), 'invalid-argument', 'options', message);
        await rejects(clustering.getSwatches(4, { colorSpace: 'oklab' }), 'invalid-argument', 'options', /clustering\.getSwatches takes no options/);
        await rejects(clustering.getClusteringInfo({}), 'invalid-argument', 'options', /clustering\.getClusteringInfo takes no options/);
    });

    it('check the receiver, then k and the rest', async () => {
        const clustering = await buildClustering(image);
        await rejects(clustering.getPalette(0), 'invalid-argument', 'k', /./);
        await rejects(clustering.quantize(image, 4, { dither: 'nope' }), 'invalid-argument', 'options.dither', /./);
    });

    it('need a 3.x clustering for weights', async () => {
        const v2 = new Clustering(readFileSync(new URL('../fixtures/clusterings/v2.bin', import.meta.url)));
        expect((await v2.getPalette(4)).length).toBeGreaterThan(0);
        await rejects(v2.getSwatches(4), 'unsupported-version', 'clustering', /no weights/);
        await rejects(v2.getClusteringInfo(), 'unsupported-version', 'clustering', /no weights/);
    });

});

describe('the engine behind the methods', () => {

    it('lets a test spy on a method, as on any method', async () => {
        const clustering = await buildClustering(image);
        const descriptor = Object.getOwnPropertyDescriptor(clustering, 'getPalette');
        expect(descriptor).toMatchObject({ writable: true, configurable: true, enumerable: false });
    });

});
