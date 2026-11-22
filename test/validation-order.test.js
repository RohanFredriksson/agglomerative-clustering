// With two mistakes in one call, both entries report the same one. The main entry checks the arguments in the order they
// are passed (image, then k or the palette, then the options), and the worker entry must agree, though it reads `signal`,
// `onProgress` and an object-form `dither` on the caller's side, as they can't be sent to the worker as they are.
import { describe, it, expect, afterAll } from 'vitest';
import * as main from '../dist/index.mjs';
import * as workerEntry from '../dist/worker.mjs';

const image = new Uint8Array(4 * 16).fill(100);
const aborted = () => {const controller = new AbortController(); controller.abort(); return controller.signal;};
const own = workerEntry.createWorker();
afterAll(() => Promise.all([own.terminate(), workerEntry.terminate()]));

// What a call rejects with, as the fields a caller can match on.
const outcome = async (call) => {
    try {await call(); return 'resolved';} catch (error) {return {name: error.name, code: error.code, argument: error.argument, message: error.message};}
};

const cases = {
    'a bad k and a bad onProgress': (f) => f(image, 0, { onProgress: 'x' }),
    'a bad k and a bad signal': (f) => f(image, 0, { signal: 5 }),
    'a bad image and a bad onProgress': (f) => f('nope', 4, { onProgress: 'x' }),
    'a bad image and a bad signal': (f) => f(image.subarray(0, 5), 4, { signal: {} }),
    'a bad k and a bad dither object': (f) => f(image, 0, { dither: { method: 'zzz' } }),
    'a bad k and an aborted signal': (f) => f(image, 0, { signal: aborted() }),
    'a bad image and an aborted signal': (f) => f({ data: image, format: 'nope' }, 4, { signal: aborted() }),
};
const functions = ['buildPalette', 'buildSwatches', 'quantize', 'quantizeToIndices'];

describe('with two mistakes, the worker entry reports the one the main entry does', () => {
    for (const [name, call] of Object.entries(cases)) {
        for (const fn of functions) {
            if (name.includes('dither') && fn.startsWith('build')) {continue;}   // they take no dither option
            it(`${fn}: ${name}`, async () => {
                const expected = await outcome(() => call(main[fn]));
                expect(expected).not.toBe('resolved');
                expect(await outcome(() => call(workerEntry[fn])), 'shared worker').toEqual(expected);
                expect(await outcome(() => call(own[fn])), 'createWorker()').toEqual(expected);
            });
        }
    }

    it('quantizeWithPalette: a bad palette and a bad signal, or an aborted one', async () => {
        for (const call of [(f) => f(image, 'nope', { signal: 5 }), (f) => f(image, 'nope', { signal: aborted() })]) {
            const expected = await outcome(() => call(main.quantizeWithPalette));
            expect(await outcome(() => call(own.quantizeWithPalette))).toEqual(expected);
        }
    });

    it('a function that only maps pixels rejects onProgress with the main entry\'s message', async () => {
        const palette = new Uint8Array([0, 0, 0, 255, 255, 255]);
        const call = (f) => f(image, palette, { onProgress: () => {} });
        const expected = await outcome(() => call(main.quantizeWithPalette));
        expect(expected).toMatchObject({ code: 'invalid-argument', argument: 'options.onProgress' });
        expect(expected.message).toMatch(/only map pixels/);
        expect(await outcome(() => call(own.quantizeWithPalette))).toEqual(expected);
    });

});

describe('an aborted signal with nothing else wrong', () => {

    it('rejects with the signal\'s reason, in both entries', async () => {
        const reason = new Error('stop');
        const controller = new AbortController();
        controller.abort(reason);
        await expect(main.buildPalette(image, 4, { signal: controller.signal })).rejects.toBe(reason);
        await expect(own.buildPalette(image, 4, { signal: controller.signal })).rejects.toBe(reason);
        await expect(workerEntry.quantize(image, 4, { signal: controller.signal })).rejects.toBe(reason);
    });

    it('leaves the image with the caller, even when the worker transfers', async () => {
        const moving = workerEntry.createWorker({ transfer: true });
        try {
            const pixels = new Uint8Array(4 * 16).fill(50);
            await expect(moving.buildPalette(pixels, 4, { signal: aborted() })).rejects.toMatchObject({ name: 'AbortError' });
            expect(pixels.length).toBe(64);
            await expect(moving.buildPalette(pixels.subarray(0, 5), 4, { signal: aborted() })).rejects.toMatchObject({ argument: 'image' });
            expect(pixels.length).toBe(64);
        } finally {
            await moving.terminate();
        }
    });

});
