import { describe, it, expect } from 'vitest';
import { Palette, Clustering, buildClustering } from '../dist/index.mjs';

// A smooth photo-like image, and 120 pseudo-random threads (as in test/recipes.test.js).
const w = 64, h = 48, photo = new Uint8Array(w * h * 4);
for (let i = 0; i < w * h; i++) {photo.set([(i % w) * 4, Math.floor(i / w) * 5, ((i % w) * 3 + Math.floor(i / w) * 2) & 255, 255], i * 4);}
let seed = 11;
const threads = new Uint8Array(120 * 3).map(() => (seed = (seed * 16807) % 2147483647) % 256);
const slice = (bytes, j) => Array.from(bytes.slice(3 * j, 3 * j + 3));
const fail = (promise) => promise.then(() => null, (error) => error);

describe('clustering.chooseFrom', () => {

    it('returns exactly k distinct positions, ascending, and their colours', async () => {
        const clustering = await buildClustering(photo);
        for (const k of [4, 8, 12]) {
            const result = await clustering.chooseFrom(threads, k);
            expect(result.indices).toHaveLength(k);
            expect(new Set(result.indices).size).toBe(k);
            for (let s = 1; s < k; s++) {expect(result.indices[s]).toBeGreaterThan(result.indices[s - 1]);}
            expect(Array.from(result.palette)).toEqual(result.indices.flatMap((j) => slice(threads, j)));
        }
    });

    it('tags the result palette rgb, even after scoring in oklab', async () => {
        const clustering = await buildClustering(photo);
        for (const colorSpace of ['rgb', 'oklab']) {
            const result = await clustering.chooseFrom(threads, 8, { colorSpace });
            expect(result.palette.colorSpace).toBe('rgb');
            expect(result.palette instanceof Palette).toBe(true);
        }
    });

    it('fills to k on an image with fewer colours than k', async () => {
        const data = new Uint8Array(4 * 30);
        for (let p = 0; p < 30; p++) {data.set([[255, 0, 0], [0, 255, 0], [0, 0, 255]][p % 3], p * 4); data[p * 4 + 3] = 255;}
        const clustering = await buildClustering(data);
        const result = await clustering.chooseFrom(threads, 5);
        expect(result.indices).toHaveLength(5);
        expect(new Set(result.indices).size).toBe(5);
    });

    it('gives the first k entries for an empty image', async () => {
        const clustering = await buildClustering(new Uint8Array(4 * 10));
        const result = await clustering.chooseFrom(threads, 6);
        expect(result.indices).toEqual([0, 1, 2, 3, 4, 5]);
        expect(Array.from(result.palette)).toEqual(Array.from(threads.slice(0, 18)));
    });

    it('k equal to the entry count returns every entry', async () => {
        const clustering = await buildClustering(photo);
        const result = await clustering.chooseFrom(threads, 120);
        expect(result.indices).toEqual(Array.from({ length: 120 }, (_, j) => j));
    });

    it('repeated entries give distinct positions', async () => {
        const chart = threads.slice(0, 30 * 3);
        chart.set(chart.slice(3 * 3, 3 * 3 + 3), 7 * 3);
        const clustering = await buildClustering(photo);
        for (const k of [10, 29, 30]) {
            const { indices } = await clustering.chooseFrom(chart, k);
            expect(new Set(indices).size).toBe(k);
        }
    });

    it('an oklab-tagged chart scores in rgb by default', async () => {
        const clustering = await buildClustering(photo);
        const plain = await clustering.chooseFrom(threads, 12);
        const tagged = await clustering.chooseFrom(new Palette(threads, 'oklab'), 12);
        expect(tagged.indices).toEqual(plain.indices);
        expect(Array.from(tagged.palette)).toEqual(Array.from(plain.palette));
    });

    it('the same with and without a signal', async () => {
        const clustering = await buildClustering(photo);
        for (const colorSpace of ['rgb', 'oklab']) {
            const plain = await clustering.chooseFrom(threads, 12, { colorSpace });
            const signalled = await clustering.chooseFrom(threads, 12, { colorSpace, signal: new AbortController().signal });
            expect(signalled.indices).toEqual(plain.indices);
        }
    });

    it('an aborted signal rejects with its reason', async () => {
        const clustering = await buildClustering(photo);
        const reason = new Error('stop');
        const controller = new AbortController();
        controller.abort(reason);
        expect(await fail(clustering.chooseFrom(threads, 12, { signal: controller.signal }))).toBe(reason);
        const later = new AbortController();
        const pending = clustering.chooseFrom(threads, 12, { signal: later.signal });
        later.abort(reason);
        expect(await fail(pending)).toBe(reason);
    });

    describe('errors', () => {
        const cases = [
            ['an empty palette', (c) => c.chooseFrom(new Uint8Array(0), 1), 'palette'],
            ['a palette of 7 bytes', (c) => c.chooseFrom(new Uint8Array(7), 1), 'palette'],
            ['k = 0', (c) => c.chooseFrom(threads, 0), 'k'],
            ['k = 2.5', (c) => c.chooseFrom(threads, 2.5), 'k'],
            ["k = '4'", (c) => c.chooseFrom(threads, '4'), 'k'],
            ['k above the entry count', (c) => c.chooseFrom(threads, 121), 'k'],
            ['a bad colorSpace', (c) => c.chooseFrom(threads, 4, { colorSpace: 'lab' }), 'options.colorSpace'],
            ['onProgress', (c) => c.chooseFrom(threads, 4, { onProgress() {} }), 'options.onProgress'],
            ['dither', (c) => c.chooseFrom(threads, 4, { dither: true }), 'options.dither'],
            ['a clustering as the palette', (c) => c.chooseFrom(c, 4), 'palette'],
        ];
        for (const [name, call, argument] of cases) {
            it(name, async () => {
                const clustering = await buildClustering(photo);
                const error = await fail(call(clustering));
                expect(error).toMatchObject({ code: 'invalid-argument', argument });
            });
        }
        it('names the entry count in k above it', async () => {
            const clustering = await buildClustering(photo);
            const error = await fail(clustering.chooseFrom(threads, 121));
            expect(error.message).toBe('Invalid k: 121 is more than the 120 entries in the palette; use 120 or fewer.');
        });
    });

    it('is a method: non-enumerable, never throws synchronously', async () => {
        const clustering = await buildClustering(photo);
        expect(Object.keys(clustering)).not.toContain('chooseFrom');
        let promise;
        expect(() => {promise = clustering.chooseFrom.call(undefined, threads, 4);}).not.toThrow();
        expect(await fail(promise)).toMatchObject({ code: 'invalid-clustering' });
        expect(new Clustering(clustering).chooseFrom).toBeTypeOf('function');
    });

});
