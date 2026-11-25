// `premultiplied: true` on an image object: the colours are converted in place on the WebAssembly heap copy before anything reads
// them, and mapped output is premultiplied again. The reference here is the same conversion written in JavaScript with the
// documented formulas (bench/spikes/premultiplied-straight/recipes.mjs).
import { describe, it, expect, beforeAll } from 'vitest';
import { init, buildClustering, buildPalette, buildSwatches, quantize, quantizeWithPalette, quantizeToIndices, quantizeToIndicesWithPalette } from '../dist/index.mjs';
import { timeLimit } from './timeout.js';

const unpremultiplyJs = (src) => {
    const out = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i += 4) {
        const a = src[i + 3];
        out[i + 3] = a;
        if (a === 255) {out.set(src.subarray(i, i + 3), i);}
        else if (a !== 0) {for (let k = 0; k < 3; k++) {out[i + k] = Math.min(255, Math.round(src[i + k] * 255 / a));}}
    }
    return out;
};
const premultiplyJs = (src) => {
    const out = src.slice();
    for (let i = 0; i < out.length; i += 4) {
        const a = out[i + 3];
        if (a !== 255) {for (let k = 0; k < 3; k++) {out[i + k] = Math.round(out[i + k] * a / 255);}}
    }
    return out;
};
const swapRb = (src) => {
    const out = src.slice();
    for (let i = 0; i < out.length; i += 4) {out[i] = src[i + 2]; out[i + 2] = src[i];}
    return out;
};

const width = 64, height = 48;
// A straight gradient with alpha x % 256 (every alpha value), some opaque and some alpha-0 pixels; premultiplied it is what a canvas holds.
const make = (alphaOf) => {
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            rgba.set([x * 4, y * 5, (x * y) & 255, alphaOf(x, y)], (y * width + x) * 4);
        }
    }
    return rgba;
};
const gradient = make(() => 255);
const translucent = make((x, y) => y === 0 ? 0 : y === 1 ? 255 : (x * 4 + y) % 256);
// What premultiplied bytes look like: the straight image premultiplied; the library reads them as unpremultiplyJs(pre).
const pre = premultiplyJs(translucent);
const straight = unpremultiplyJs(pre);

const img = (data, extra) => ({ data, format: 'rgba', width, height, ...extra });
const preImg = img(pre, { premultiplied: true });
const straightImg = img(straight);

beforeAll(async () => {await init();});

describe('premultiplied: true', () => {

    it('clusters a premultiplied image as its straight original', async () => {
        for (const o of [{}, { colorSpace: 'oklab' }, { alpha: 'ignore' }]) {
            expect(await buildClustering(preImg, o)).toEqual(await buildClustering(straightImg, o));
            expect(await buildPalette(preImg, 16, o)).toEqual(await buildPalette(straightImg, 16, o));
            expect(await buildSwatches(preImg, 16, o)).toEqual(await buildSwatches(straightImg, 16, o));
        }
        const bgraPre = { data: swapRb(pre), format: 'bgra', premultiplied: true };
        const bgraStraight = { data: swapRb(straight), format: 'bgra' };
        expect(await buildClustering(bgraPre)).toEqual(await buildClustering(bgraStraight));
        expect(await buildPalette(bgraPre, 8, { colorSpace: 'oklab' })).toEqual(await buildPalette(bgraStraight, 8, { colorSpace: 'oklab' }));
    }, timeLimit(30_000));

    it('quantize gives premultiplied output', async () => {
        const clustering = await buildClustering(straightImg);
        const palette = await buildPalette(straightImg, 16);
        for (const o of [{}, { dither: true, width }, { dither: 'ordered', width }]) {
            const expected = premultiplyJs((await quantize(straightImg, 16, o)).data);
            const result = await quantize(preImg, 16, o);
            expect(result.data).toEqual(expected);
            expect(result.format).toBe('rgba');
            expect((await quantizeWithPalette(preImg, palette, o)).data).toEqual(premultiplyJs((await quantizeWithPalette(straightImg, palette, o)).data));
            expect((await clustering.quantize(preImg, 16, o)).data).toEqual(premultiplyJs((await clustering.quantize(straightImg, 16, o)).data));
        }
        const bgra = await quantize({ data: swapRb(pre), format: 'bgra', premultiplied: true }, 16);
        expect(bgra.data).toEqual(swapRb(premultiplyJs((await quantize(straightImg, 16)).data)));
    }, timeLimit(30_000));

    it('indexed output is straight', async () => {
        const palette = await buildPalette(straightImg, 16);
        for (const o of [{}, { transparent: true }]) {
            expect(await quantizeToIndices(preImg, 16, o)).toEqual(await quantizeToIndices(straightImg, 16, o));
            expect(await quantizeToIndicesWithPalette(preImg, palette, o)).toEqual(await quantizeToIndicesWithPalette(straightImg, palette, o));
        }
    }, timeLimit(30_000));

    it('alpha 0 is black and c > a is clamped', async () => {
        const read = new Uint8Array([0, 0, 0, 0, 255, 255, 255, 40]);
        const given = new Uint8Array([10, 0, 0, 0, 200, 100, 50, 40]);
        // alpha: 'ignore' counts the alpha-0 pixel too, so both read colours show in the palette.
        const palette = await buildPalette({ data: given, format: 'rgba', premultiplied: true }, 2, { alpha: 'ignore' });
        expect(palette).toEqual(await buildPalette({ data: read, format: 'rgba' }, 2, { alpha: 'ignore' }));
        expect([...palette].sort((x, y) => x - y)).toEqual([0, 0, 0, 255, 255, 255]);
    });

    it('an opaque image gives the same output with or without the flag', async () => {
        const plain = { data: gradient, format: 'rgba', width, height };
        const flagged = { ...plain, premultiplied: true };
        expect(await buildClustering(flagged)).toEqual(await buildClustering(plain));
        expect((await quantize(flagged, 8, { dither: true, width })).data).toEqual((await quantize(plain, 8, { dither: true, width })).data);
    });

    it("the caller's array is unchanged", async () => {
        const copy = pre.slice();
        await buildClustering(preImg);
        await quantize(preImg, 8);
        await quantize(preImg, 8, { signal: new AbortController().signal });
        expect(pre).toEqual(copy);
        // A view into a larger buffer: bytes outside it stay as they were, and the result is the same.
        const big = new Uint8Array(pre.length + 64).fill(77);
        big.set(pre, 32);
        const view = big.subarray(32, 32 + pre.length);
        const result = await quantize({ data: view, format: 'rgba', width, height, premultiplied: true }, 8);
        expect(result.data).toEqual((await quantize(preImg, 8)).data);
        expect(big.subarray(0, 32).every((v) => v === 77)).toBe(true);
        expect(big.subarray(32 + pre.length).every((v) => v === 77)).toBe(true);
        expect(view).toEqual(pre);
    });

    it('the same with and without signal and onProgress', async () => {
        const controls = { signal: new AbortController().signal, onProgress: () => {} };
        expect(await buildClustering(preImg, controls)).toEqual(await buildClustering(preImg));
        for (const o of [{}, { dither: true, width }]) {
            expect(await quantize(preImg, 16, { ...o, ...controls })).toEqual(await quantize(preImg, 16, o));
        }
        const palette = await buildPalette(straightImg, 16);
        expect(await quantizeWithPalette(preImg, palette, controls)).toEqual(await quantizeWithPalette(preImg, palette));
    }, timeLimit(30_000));

    it('an abort during the conversion pass rejects, and the next call works', async () => {
        const w = 4240, h = 2832;
        const big = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) {
            const a = (i % w) % 256;
            big.set([a >> 1, a >> 2, a >> 3, a], i * 4);
        }
        const reason = new Error('stop');
        const controller = new AbortController();
        const promise = buildClustering({ data: big, format: 'rgba', premultiplied: true }, { signal: controller.signal, onProgress: () => controller.abort(reason) });
        await expect(promise).rejects.toBe(reason);
        const second = new AbortController();
        const quantizing = quantize({ data: big, format: 'rgba', premultiplied: true }, 4, { signal: second.signal, precision: 4 });
        second.abort(reason);
        await expect(quantizing).rejects.toBe(reason);
        expect((await buildPalette(preImg, 4)).length).toBe(12);
    }, timeLimit(60_000));

    it('errors', async () => {
        for (const format of ['rgb', 'rgbx', 'bgrx']) {
            const data = new Uint8Array(format === 'rgb' ? 12 : 16);
            await expect(buildClustering({ data, format, premultiplied: true })).rejects.toMatchObject({
                code: 'invalid-argument', argument: 'image',
                message: `Invalid image: premultiplied is for 'rgba' and 'bgra'; '${format}' has no alpha, so remove it.`,
            });
        }
        for (const [value, text] of [[1, '1'], ['yes', "'yes'"]]) {
            await expect(buildClustering({ data: new Uint8Array(16), format: 'rgba', premultiplied: value })).rejects.toMatchObject({
                code: 'invalid-argument', argument: 'image',
                message: `Invalid image: premultiplied must be true or false, got ${text}.`,
            });
        }
        await expect(buildClustering({ data: new Uint8Array(12), format: 'rgb', premultiplied: false })).resolves.toBeDefined();
        await expect(buildClustering({ data: new Uint8Array(16), format: 'nope', premultiplied: 1 })).rejects.toMatchObject({ message: expect.stringMatching(/^Invalid format/) });
    });

});
