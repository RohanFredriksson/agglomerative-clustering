// Mapping in slices (3.7.0): with `signal` or `onProgress` the functions that map run in slices of about 10 ms, and
// the result must be exactly one call's, for every dither method, format, output type and palette size. The images
// are big enough that each case takes several slices, which the progress values below show.
import { describe, it, expect } from 'vitest';
import {
    buildClustering, quantize, quantizeToIndices, quantizeWithPalette, quantizeFromClustering,
    quantizeToIndicesFromClustering, quantizeToIndicesWithPalette,
} from '../dist/index.mjs';
import { createWorker } from '../dist/worker.mjs';
import { timeLimit } from './timeout.js';

const random = (seed) => () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;

// A smooth photo-like RGBA image with noise and every kind of alpha (opaque, partial, transparent corners).
const picture = (width, height, seed = 1) => {
    const rnd = random(seed), data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const p = 4 * (y * width + x);
            data[p] = (x * 255 / width + 30 * rnd()) & 255;
            data[p + 1] = (y * 255 / height + 30 * rnd()) & 255;
            data[p + 2] = (128 + 100 * Math.sin((x + y) / 40) + 20 * rnd()) & 255;
            data[p + 3] = x < 16 && y < 16 ? 0 : x < 64 && y < 64 ? 128 : 255;
        }
    }
    return { data, format: 'rgba', width, height };
};
const asFormat = ({ data, width, height }, format) => {
    const n = width * height, stride = format === 'rgb' ? 3 : 4, out = new Uint8Array(n * stride);
    for (let p = 0; p < n; p++) {
        const [r, g, b, a] = data.subarray(4 * p, 4 * p + 4);
        out.set(format === 'rgb' ? [r, g, b] : format === 'bgra' ? [b, g, r, a] : [b, g, r, 255], stride * p);
    }
    return { data: out, format, width, height };
};
const paletteOf = (n, seed) => {const rnd = random(seed); return new Uint8Array(3 * n).map(() => Math.floor(256 * rnd()));};

// A progress callback that records its values; `sliced` says the call took more than one slice.
const watch = () => {
    const values = [];
    return { values, onProgress: (v) => values.push(v), sliced: () => values.some((v) => v > 0 && v < 1) };
};
const same = (a, b) => {
    if (a.indices) {
        expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
        expect(Array.from(a.palette)).toEqual(Array.from(b.palette));
        expect([a.transparentIndex, a.indexBits]).toEqual([b.transparentIndex, b.indexBits]);
    } else {
        const da = a.data ?? a, db = b.data ?? b;
        expect(Buffer.from(da).equals(Buffer.from(db))).toBe(true);
        expect(a.constructor).toBe(b.constructor);
    }
};

const image = picture(640, 480, 3);
const methods = [
    ['Floyd–Steinberg', { dither: true }],
    ['Atkinson', { dither: 'atkinson' }],
    ['ordered, 16 steps', { dither: 'ordered' }],
    ['ordered, 64 steps, half strength', { dither: { method: 'ordered', steps: 64, strength: 0.5 } }],
];

describe('mapping in slices gives one call\'s result', () => {

    for (const [name, options] of methods) {
        it(`${name}: every mapping function, RGB and OKLab`, async () => {
            const clustering = await buildClustering(image, { precision: 6 });
            const palette = await clustering.getPalette(48);
            const cases = [
                [(o) => quantizeWithPalette(image, palette, { ...options, ...o })],
                [(o) => quantizeWithPalette(image, palette, { ...options, colorSpace: 'oklab', ...o })],
                [(o) => quantizeToIndicesWithPalette(image, palette, { ...options, transparent: true, ...o })],
                [(o) => quantizeFromClustering(image, clustering, 40, { ...options, ...o })],
                [(o) => quantizeToIndicesFromClustering(image, clustering, 40, { ...options, transparent: 200, ...o })],
                [(o) => clustering.quantize(image, 24, { ...options, ...o })],
            ];
            for (const [run] of cases) {
                const progress = watch();
                same(await run({ onProgress: progress.onProgress }), await run({}));
                expect(progress.values.at(-1)).toBe(1);
            }
        }, timeLimit(60_000));
    }

    it('takes several slices on these images (so the cases above test slicing)', async () => {
        const progress = watch();
        await quantizeWithPalette(image, paletteOf(48, 2), { dither: 'atkinson', onProgress: progress.onProgress });
        expect(progress.sliced()).toBe(true);
    });

    it('quantize and quantizeToIndices, which cluster and then map', async () => {
        for (const options of [{ dither: true }, { dither: 'ordered', colorSpace: 'oklab' }, { transparent: true, dither: 'atkinson' }]) {
            const a = watch(), b = watch();
            same(await quantize(image, 32, { precision: 6, ...options, onProgress: a.onProgress }), await quantize(image, 32, { precision: 6, ...options }));
            same(await quantizeToIndices(image, 32, { precision: 6, ...options, onProgress: b.onProgress }), await quantizeToIndices(image, 32, { precision: 6, ...options }));
            for (const { values } of [a, b]) {
                expect(values.at(-1)).toBe(1);
                expect(values.every((v, i) => i === 0 || v > values[i - 1])).toBe(true);
            }
        }
    }, timeLimit(120_000));

    it('every input format and ImageData, with colour and index output', async () => {
        const palette = paletteOf(40, 5);
        for (const format of ['rgb', 'bgra', 'bgrx']) {
            const input = asFormat(image, format);
            same(await quantizeWithPalette(input, palette, { dither: true, onProgress: () => {} }), await quantizeWithPalette(input, palette, { dither: true }));
            same(await quantizeToIndicesWithPalette(input, palette, { dither: 'ordered', signal: new AbortController().signal }), await quantizeToIndicesWithPalette(input, palette, { dither: 'ordered' }));
        }
        const imageData = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
        const sliced = await quantizeWithPalette(imageData, palette, { dither: 'atkinson', onProgress: () => {} });
        expect(sliced).toBeInstanceOf(ImageData);
        same(sliced, await quantizeWithPalette(imageData, palette, { dither: 'atkinson' }));
    }, timeLimit(60_000));

    it('a palette over 1024 colours (the k-d tree), and an empty palette for a transparent image', async () => {
        const palette = paletteOf(3000, 7);
        same(await quantizeWithPalette(image, palette, { dither: true, onProgress: () => {} }), await quantizeWithPalette(image, palette, { dither: true }));
        same(await quantizeToIndicesWithPalette(image, palette, { onProgress: () => {} }), await quantizeToIndicesWithPalette(image, palette));
        const clear = { data: new Uint8Array(64 * 64 * 4), format: 'rgba', width: 64 };
        same(await quantizeToIndicesWithPalette(clear, new Uint8Array(0), { transparent: true, onProgress: () => {} }), await quantizeToIndicesWithPalette(clear, new Uint8Array(0), { transparent: true }));
    }, timeLimit(60_000));

    it('without dithering, a large image passed without a width is sliced too (it may stop mid-row)', async () => {
        const big = picture(2000, 1500, 9), bare = big.data;
        const palette = paletteOf(1000, 3), progress = watch();
        same(await quantizeWithPalette(bare, palette, { onProgress: progress.onProgress }), await quantizeWithPalette(bare, palette));
        expect(progress.sliced()).toBe(true);
    }, timeLimit(60_000));

    it('a slice can end mid-row with every method (a very wide image)', async () => {
        const wide = picture(200000, 2, 17), palette = paletteOf(48, 6);
        for (const [, options] of methods) {
            for (const colorSpace of ['rgb', 'oklab']) {
                const progress = watch();
                same(await quantizeToIndicesWithPalette(wide, palette, { ...options, colorSpace, transparent: true, onProgress: progress.onProgress }), await quantizeToIndicesWithPalette(wide, palette, { ...options, colorSpace, transparent: true }));
                expect(progress.sliced()).toBe(true);
            }
        }
    }, timeLimit(120_000));

    it('progress keeps rising past 4.3 million pixels (32-bit overflow before 3.7.2)', async () => {
        const big = picture(2400, 2000, 21), palette = paletteOf(16, 9), values = [];
        await quantizeWithPalette(big, palette, { dither: 'ordered', onProgress: (v) => values.push(v) });
        expect(values.at(-1)).toBe(1);
        // Reports are about every 10 ms; before the fix they stopped at 0.89 (4.29 of 4.8 million pixels) and jumped to 1.
        expect(values.at(-2)).toBeGreaterThan(0.95);
    }, timeLimit(60_000));

    it('a width of 1, and an image one row high', async () => {
        const palette = paletteOf(16, 4);
        for (const [w, h] of [[1, 3000], [3000, 1]]) {
            const tall = picture(w, h, 11);
            for (const [, options] of methods) {
                same(await quantizeWithPalette(tall, palette, { ...options, onProgress: () => {} }), await quantizeWithPalette(tall, palette, options));
            }
        }
    });

});

describe('aborting while mapping', () => {

    const big = picture(1600, 1200, 13);
    const slow = { dither: { method: 'ordered', steps: 64 } };

    it('rejects with the signal\'s reason part way through, in every mapping function', async () => {
        const clustering = await buildClustering(big, { precision: 5 });
        const palette = await clustering.getPalette(64);
        const calls = [
            (o) => quantizeWithPalette(big, palette, { ...slow, ...o }),
            (o) => quantizeToIndicesWithPalette(big, palette, { ...slow, ...o }),
            (o) => quantizeFromClustering(big, clustering, 64, { ...slow, ...o }),
            (o) => quantizeToIndicesFromClustering(big, clustering, 64, { ...slow, ...o }),
            (o) => clustering.quantizeToIndices(big, 64, { ...slow, ...o }),
        ];
        for (const call of calls) {
            const controller = new AbortController(), reason = new Error('superseded');
            let seen = 0;
            const outcome = await call({ signal: controller.signal, onProgress: (v) => {seen = v; if (v > 0) {controller.abort(reason);}} }).then(() => 'resolved', (e) => e);
            expect(outcome).toBe(reason);
            expect(seen).toBeGreaterThan(0);
            expect(seen).toBeLessThan(1);
        }
    }, timeLimit(120_000));

    it('in the worker entry, stops the thread: a call queued behind a cancelled mapping starts within a slice', async () => {
        const worker = createWorker();
        try {
            const palette = paletteOf(64, 8);
            await worker.quantizeWithPalette(picture(8, 8), palette);   // started and loaded
            const controller = new AbortController();
            const cancelled = worker.quantizeWithPalette(big, palette, { ...slow, signal: controller.signal, onProgress: (v) => {if (v > 0) {controller.abort();}} });
            const next = worker.quantizeWithPalette(picture(8, 8), palette);
            await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
            const started = performance.now();
            await next;
            // One call of this mapping takes seconds; the queued call waits at most for the slice in progress.
            expect(performance.now() - started).toBeLessThan(500);
        } finally {
            await worker.terminate();
        }
    }, timeLimit(60_000));

    it('in the worker entry\'s handle methods: progress, ImageData back as ImageData, and aborts part way', async () => {
        const worker = createWorker();
        try {
            const imageData = new ImageData(new Uint8ClampedArray(big.data), big.width, big.height);
            const handle = await worker.cluster(imageData, { precision: 5 });
            const palette = paletteOf(64, 12);
            const calls = [
                (o) => handle.quantize(64, { ...slow, ...o }),
                (o) => handle.quantizeToIndices(64, { ...slow, ...o }),
                (o) => handle.quantizeWithPalette(palette, { ...slow, ...o }),
                (o) => handle.quantizeToIndicesWithPalette(palette, { ...slow, ...o }),
            ];
            const one = await calls[0]({});
            for (const [i, call] of calls.entries()) {
                if (i === 0) {
                    const progress = watch();
                    const result = await call({ onProgress: progress.onProgress });
                    expect(result).toBeInstanceOf(ImageData);
                    same(result, one);
                    expect(progress.sliced()).toBe(true);
                    expect(progress.values.at(-1)).toBe(1);
                }
                const controller = new AbortController();
                const outcome = await call({ signal: controller.signal, onProgress: (v) => {if (v > 0) {controller.abort();}} }).then(() => 'resolved', (e) => e.name);
                expect(outcome).toBe('AbortError');
            }
        } finally {
            await worker.terminate();
        }
    }, timeLimit(120_000));

    it('a small call with a signal finishes without giving up its turn', async () => {
        const palette = paletteOf(16, 1), small = picture(32, 32);
        await quantizeWithPalette(small, palette);   // module loaded
        let other = false;
        setImmediate(() => {other = true;});
        await quantizeWithPalette(small, palette, { dither: true, signal: new AbortController().signal });
        expect(other).toBe(false);
    });

});
