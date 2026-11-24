import { describe, it, expect } from 'vitest';
import {
    buildClustering, buildPalette, quantize, quantizeToIndices, quantizeWithPalette, quantizeFromClustering,
    quantizeToIndicesFromClustering, quantizeToIndicesWithPalette,
} from '../dist/index.mjs';
import { timeLimit } from './timeout.js';

const random = (seed) => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

// An RGBA image with thousands of distinct colours (so clustering takes several slices) and every kind of alpha.
const width = 128, height = 96;
const image = new Uint8Array(width * height * 4);
{
    const rnd = random(5);
    for (let p = 0; p < width * height; p++) {
        const x = p % width, y = Math.floor(p / width);
        image.set([x * 1.5 + rnd() * 40, y * 2 + rnd() * 40, ((x * y) >> 2) + rnd() * 30, x % 11 === 0 ? 0 : x % 5 === 0 ? 100 : 255], p * 4);
    }
}

// Noise with about half a million distinct colours: its clustering takes many slices even on a fast machine. Slices
// are about 10 ms each, so the small image above can finish in as few as two on a fast runner.
// (An integer generator: `random` above multiplies in floating point, loses precision and repeats, so its noise has only
// about twelve thousand colours.)
const busy = new Uint8Array(800 * 600 * 4);
{
    let seed = 11;
    for (let i = 0; i < busy.length; i++) {busy[i] = i % 4 === 3 ? 255 : (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 24;}
}

const progressOf = () => {
    const calls = [];
    return { calls, onProgress: (value) => calls.push(value) };
};

describe('a call with a signal or onProgress gives the same result as without', () => {

    it('getClustering', async () => {
        const expected = await buildClustering(image);
        for (const options of [{ colorSpace: 'oklab' }, { precision: 6 }, { alpha: 'ignore' }, {}]) {
            const reference = await buildClustering(image, options);
            expect(await buildClustering(image, { ...options, signal: new AbortController().signal })).toEqual(reference);
            expect(await buildClustering(image, { ...options, onProgress: () => {} })).toEqual(reference);
        }
        expect(await buildClustering(image, { onProgress: () => {} })).toEqual(expected);
    }, timeLimit(60000));

    it('getPalette, quantize and the indexed functions', async () => {
        const signal = new AbortController().signal;
        expect(await buildPalette(image, 12, { signal })).toEqual(await buildPalette(image, 12));
        for (const options of [{}, { colorSpace: 'oklab' }, { dither: true, width }, { precision: 6, dither: 0.5, width }]) {
            expect(await quantize(image, 9, { ...options, signal })).toEqual(await quantize(image, 9, options));
            expect(await quantizeToIndices(image, 9, { ...options, signal })).toEqual(await quantizeToIndices(image, 9, options));
            expect(await quantizeToIndices(image, 9, { ...options, transparent: true, signal })).toEqual(await quantizeToIndices(image, 9, { ...options, transparent: true }));
        }
        const imageData = new ImageData(new Uint8ClampedArray(image), width, height);
        const rawResult = await quantize({ data: image, format: 'rgba', width, height }, 6, { signal });
        expect(rawResult.width).toBe(width);
        expect((await quantize(imageData, 6, { signal })).data).toEqual((await quantize(imageData, 6)).data);
        const rgb = { data: new Uint8Array(3 * 300).map((_, i) => (i * 37) & 255), format: 'rgb' };
        expect(await buildPalette(rgb, 5, { signal })).toEqual(await buildPalette(rgb, 5));
    }, timeLimit(60000));

    it('the functions that only map pixels', async () => {
        const clustering = await buildClustering(image);
        const palette = await buildPalette(image, 8);
        const signal = new AbortController().signal;
        expect(await quantizeFromClustering(image, clustering, 8, { signal })).toEqual(await quantizeFromClustering(image, clustering, 8));
        expect(await quantizeWithPalette(image, palette, { signal })).toEqual(await quantizeWithPalette(image, palette));
        expect(await quantizeToIndicesFromClustering(image, clustering, 8, { signal })).toEqual(await quantizeToIndicesFromClustering(image, clustering, 8));
        expect(await quantizeToIndicesWithPalette(image, palette, { signal })).toEqual(await quantizeToIndicesWithPalette(image, palette));
    });

    it('empty and fully transparent images', async () => {
        const signal = new AbortController().signal;
        expect(await buildClustering(new Uint8Array(0), { signal })).toEqual(await buildClustering(new Uint8Array(0)));
        const hidden = new Uint8Array(64);
        expect(await buildClustering(hidden, { signal })).toEqual(await buildClustering(hidden));
        expect(await quantizeToIndices(hidden, 4, { signal, transparent: true })).toEqual(await quantizeToIndices(hidden, 4, { transparent: true }));
    });

});

describe('progress', () => {

    it('goes up from 0 to 1, in several steps for a big enough image', async () => {
        const { calls, onProgress } = progressOf();
        await buildClustering(busy, { onProgress });
        expect(calls[0]).toBe(0);
        expect(calls[calls.length - 1]).toBe(1);
        expect(calls.length).toBeGreaterThan(3);
        for (let i = 1; i < calls.length; i++) {expect(calls[i]).toBeGreaterThan(calls[i - 1]);}
    });

    it('also ends at 1 for palettes and mapped images, including the functions that only map', async () => {
        for (const run of [
            (onProgress) => buildPalette(image, 8, { onProgress }),
            (onProgress) => quantize(image, 8, { onProgress }),
            (onProgress) => quantizeToIndices(image, 8, { onProgress }),
            (onProgress) => quantizeWithPalette(image, new Uint8Array([1, 2, 3]), { onProgress }),
            (onProgress) => quantizeToIndicesWithPalette(image, new Uint8Array([1, 2, 3]), { onProgress }),
        ]) {
            const { calls, onProgress } = progressOf();
            await run(onProgress);
            expect(calls[calls.length - 1]).toBe(1);
        }
        expect((await quantizeWithPalette(image, new Uint8Array([1, 2, 3]), { signal: new AbortController().signal })).length).toBe(image.length);
    });

    it('lets an exception in the callback reject the call, leaving the module usable', async () => {
        await expect(buildClustering(image, { onProgress: () => {throw new Error('stop');} })).rejects.toThrow('stop');
        expect(await buildPalette(image, 4)).toEqual(await buildPalette(image, 4, { onProgress: () => {} }));
    });

});

describe('aborting', () => {

    it('rejects at once with the reason if the signal is already aborted, without working', async () => {
        const controller = new AbortController();
        controller.abort();
        const { calls, onProgress } = progressOf();
        const error = await buildClustering(image, { signal: controller.signal, onProgress }).catch((e) => e);
        expect(error.name).toBe('AbortError');
        expect(calls.length).toBe(0);
        const reason = new Error('mine');
        const custom = new AbortController();
        custom.abort(reason);
        await expect(quantize(image, 4, { signal: custom.signal })).rejects.toBe(reason);
        await expect(quantizeWithPalette(image, new Uint8Array(3), { signal: custom.signal })).rejects.toBe(reason);
    });

    it('stops a running clustering between slices', async () => {
        const controller = new AbortController();
        let calls = 0;
        const error = await buildClustering(image, {
            signal: controller.signal,
            onProgress: (value) => {calls++; if (value > 0 && value < 1) {controller.abort();}},
        }).catch((e) => e);
        expect(error.name).toBe('AbortError');
        // It stopped after the slice in which it was aborted, not at the end.
        expect(calls).toBeLessThan(5);
        // Nothing is left behind: later calls work and give the same answers.
        expect(await buildClustering(image, { signal: new AbortController().signal })).toEqual(await buildClustering(image));
    });

    it('stops getPalette, quantize and quantizeToIndices too', async () => {
        for (const run of [
            (options) => buildPalette(image, 8, options),
            (options) => quantize(image, 8, options),
            (options) => quantizeToIndices(image, 8, options),
        ]) {
            const controller = new AbortController();
            const error = await run({ signal: controller.signal, onProgress: (v) => {if (v > 0 && v < 1) {controller.abort();}} }).catch((e) => e);
            expect(error.name).toBe('AbortError');
        }
    });

    it('validates its options', async () => {
        for (const signal of [null, 5, {}, 'abort', { aborted: false }]) {
            await expect(buildClustering(image, { signal })).rejects.toMatchObject({ code: 'invalid-argument' });
        }
        for (const onProgress of [null, 5, 'x']) {
            await expect(buildPalette(image, 4, { onProgress })).rejects.toMatchObject({ code: 'invalid-argument' });
        }
    });

});
