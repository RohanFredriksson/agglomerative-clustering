// BGRA images ({ data, format: 'bgra' }) are read and returned in their own channel order, and otherwise behave exactly
// like the same image as RGBA: the same clusterings, palettes, swatches, info and indices, and mapped output that is the
// RGBA output with R and B swapped.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as ac from '../dist/index.mjs';
import * as dropIn from '../dist/worker.mjs';
import { createWorker } from '../dist/worker.mjs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../fixtures/kodak.js';

// Swaps bytes 0 and 2 of every 4-byte pixel: RGBA to BGRA, and back.
const toBgra = (pixels) => {
    const out = new Uint8Array(pixels);
    for (let i = 0; i < out.length; i += 4) {out[i] = pixels[i + 2]; out[i + 2] = pixels[i];}
    return out;
};

// Byte-for-byte equality of two typed arrays (vitest's deep equality is slow on megabytes): 0 when equal.
const compare = (a, b) => Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength));

const width = 32, height = 24;
const synthetic = new Uint8Array(width * height * 4);
for (let p = 0; p < width * height; p++) {
    const x = p % width, y = Math.floor(p / width);
    synthetic.set([x * 8, y * 10, (x * y) & 255, x % 9 === 0 ? 0 : x % 4 === 0 ? 100 : 255], p * 4);
}
const opaque = synthetic.map((v, i) => i % 4 === 3 ? 255 : v);

const optionSets = [{}, { colorSpace: 'oklab' }, { precision: 6 }, { alpha: 'ignore' }, { transparent: true }, { transparent: 200 }];
const ditherSets = [false, true, 'atkinson', 'ordered', { method: 'ordered', steps: 8 }];
// The options of mapping alone: the clustering options other than colorSpace don't apply.
const mapOnly = (o) => o.colorSpace ? { colorSpace: o.colorSpace } : {};

const pair = (data, w, h) => ({
    rgba: { data, format: 'rgba', width: w, height: h },
    bgra: { data: toBgra(data), format: 'bgra', width: w, height: h },
});

const images = { synthetic: pair(synthetic, width, height), opaque: pair(opaque, width, height) };
// Each image with the option sets it is checked under. Kodak is opaque, so the alpha options add nothing there, and
// clustering a photo takes about a second, so it gets fewer.
const cases = { synthetic: optionSets, opaque: optionSets, kodak: [{}, { colorSpace: 'oklab', precision: 6 }, { transparent: true }] };
// Clusterings, made once per image, option set and format: [name, options, rgba clustering, bgra clustering].
const clustered = [];
beforeAll(async () => {
    const { rgba, width: w, height: h } = await getImageRgba(await ensureImage(KODAK_IMAGES[4]));
    images.kodak = pair(rgba, w, h);
    for (const [name, sets] of Object.entries(cases)) {
        for (const o of sets) {clustered.push([name, o, await ac.getClustering(images[name].rgba, o), await ac.getClustering(images[name].bgra, o)]);}
    }
}, 300_000);

// The one-shot functions cluster on every call, so they run on the small images only.
const small = ['synthetic', 'opaque'];

describe('BGRA input behaves as the same image in RGBA', () => {

    it('clusters BGRA exactly as RGBA', () => {
        for (const [name, o, fromRgba, fromBgra] of clustered) {expect(compare(fromBgra, fromRgba), `${name} ${JSON.stringify(o)}`).toBe(0);}
    });

    it('cuts, weighs and describes BGRA as RGBA', async () => {
        for (const name of small) {
            const { rgba, bgra } = images[name];
            for (const o of optionSets) {
                const label = `${name} ${JSON.stringify(o)}`;
                expect(await ac.getPalette(bgra, 16, o), label).toEqual(await ac.getPalette(rgba, 16, o));
                expect(await ac.getSwatches(bgra, 16, o), label).toEqual(await ac.getSwatches(rgba, 16, o));
            }
        }
        for (const [name, o, fromRgba, fromBgra] of clustered) {
            expect(await ac.getClusteringInfo(fromBgra), `${name} ${JSON.stringify(o)}`).toEqual(await ac.getClusteringInfo(fromRgba));
        }
    });

    it('indexes BGRA as RGBA', async () => {
        for (const [name, o, clustering] of clustered) {
            const { rgba, bgra } = images[name];
            const palette = await ac.getPaletteFromClustering(clustering, 12);
            const transparent = o.transparent ? { transparent: o.transparent } : {};
            for (const dither of ditherSets) {
                const label = `${name} ${JSON.stringify(o)} ${JSON.stringify(dither)}`;
                const calls = [
                    (image) => ac.quantizeToIndicesFromClustering(image, clustering, 16, { ...mapOnly(o), dither, ...transparent }),
                    (image) => ac.quantizeToIndicesWithPalette(image, palette, { ...mapOnly(o), dither, ...transparent }),
                ];
                if (small.includes(name)) {calls.push((image) => ac.quantizeToIndices(image, 16, { ...o, dither }));}
                for (const call of calls) {
                    const expected = await call(rgba), actual = await call(bgra);
                    expect(actual.palette, label).toEqual(expected.palette);
                    expect(compare(actual.indices, expected.indices), label).toBe(0);
                    expect(actual.transparentIndex, label).toBe(expected.transparentIndex);
                }
            }
        }
    }, 120_000);

    it('maps BGRA to the RGBA result with R and B swapped', async () => {
        for (const [name, o, clustering] of clustered) {
            const { rgba, bgra } = images[name];
            const palette = await ac.getPaletteFromClustering(clustering, 12);
            for (const dither of ditherSets) {
                const label = `${name} ${JSON.stringify(o)} ${JSON.stringify(dither)}`;
                const calls = [
                    (image) => ac.quantizeFromClustering(image, clustering, 16, { ...mapOnly(o), dither }),
                    (image) => ac.quantizeWithPalette(image, palette, { ...mapOnly(o), dither }),
                ];
                if (small.includes(name)) {calls.push((image) => ac.quantize(image, 16, { ...o, dither }));}
                for (const call of calls) {
                    const expected = await call(rgba), actual = await call(bgra);
                    expect(actual.format, label).toBe('bgra');
                    expect(actual.width, label).toBe(bgra.width);
                    expect(actual.height, label).toBe(bgra.height);
                    expect(compare(actual.data, toBgra(expected.data)), label).toBe(0);
                }
            }
        }
    }, 120_000);

    it('takes the sliced path for BGRA with the same results', async () => {
        const { bgra } = images.synthetic;
        const controls = () => ({ signal: new AbortController().signal, onProgress: () => {} });
        for (const o of optionSets) {
            expect(await ac.getClustering(bgra, { ...o, ...controls() })).toEqual(await ac.getClustering(bgra, o));
            expect(await ac.getPalette(bgra, 16, { ...o, ...controls() })).toEqual(await ac.getPalette(bgra, 16, o));
            expect((await ac.quantize(bgra, 16, { ...o, dither: true, ...controls() })).data).toEqual((await ac.quantize(bgra, 16, { ...o, dither: true })).data);
            expect((await ac.quantizeToIndices(bgra, 16, { ...o, ...controls() })).indices).toEqual((await ac.quantizeToIndices(bgra, 16, o)).indices);
        }
    });

    it('reads a Uint8ClampedArray subarray as BGRA', async () => {
        const bytes = images.synthetic.bgra.data;
        const big = new Uint8ClampedArray(bytes.length + 16);
        big.set(bytes, 8);
        const view = new Uint8ClampedArray(big.buffer, 8, bytes.length);
        expect(await ac.getPalette({ data: view, format: 'bgra' }, 16)).toEqual(await ac.getPalette({ data: new Uint8Array(bytes), format: 'bgra' }, 16));
    });

    it('handles empty and fully transparent BGRA images', async () => {
        expect((await ac.getPalette({ data: new Uint8Array(0), format: 'bgra' }, 4)).length).toBe(0);
        const clear = { data: new Uint8Array([10, 20, 30, 0, 40, 50, 60, 0]), format: 'bgra' };
        expect((await ac.getPalette(clear, 4)).length).toBe(0);
        await expect(ac.quantizeWithPalette(clear, new Uint8Array(0))).resolves.toBeTruthy();
        const visible = { data: new Uint8Array([10, 20, 30, 255]), format: 'bgra' };
        await expect(ac.quantizeWithPalette(visible, new Uint8Array(0))).rejects.toMatchObject({ code: 'invalid-argument', argument: 'palette' });
    });

    it('maps its own BGRA output back to itself', async () => {
        const { bgra } = images.synthetic;
        const palette = await ac.getPalette(bgra, 8);
        const once = await ac.quantizeWithPalette(bgra, palette);
        const twice = await ac.quantizeWithPalette(once, palette);
        expect(twice.format).toBe('bgra');
        expect(twice.data).toEqual(once.data);
    });

});

describe('BGRA through the worker entry', () => {

    const worker = createWorker();
    afterAll(() => {worker.terminate(); dropIn.terminate();});

    it('quantizes and indexes BGRA as the main entry does', async () => {
        const { bgra } = images.synthetic;
        for (const dither of ditherSets) {
            for (const api of [worker, dropIn]) {
                const result = await api.quantize(bgra, 8, { dither });
                const expected = await ac.quantize(bgra, 8, { dither });
                expect(result.format, JSON.stringify(dither)).toBe('bgra');
                expect([result.width, result.height]).toEqual([width, height]);
                expect(compare(result.data, expected.data), JSON.stringify(dither)).toBe(0);
            }
        }
        const indexed = await worker.quantizeToIndices(bgra, 8, { transparent: true });
        const expected = await ac.quantizeToIndices(bgra, 8, { transparent: true });
        expect(compare(indexed.indices, expected.indices)).toBe(0);
        expect(indexed.transparentIndex).toBe(expected.transparentIndex);
    });

    it('serves a BGRA handle as the main entry does', async () => {
        const { bgra } = images.synthetic;
        const handle = await worker.cluster(bgra);
        const clustering = await ac.getClustering(bgra);
        expect(compare(await handle.getClustering(), clustering)).toBe(0);
        const fromHandle = await handle.quantize(8);
        expect(fromHandle.format).toBe('bgra');
        expect(compare(fromHandle.data, (await ac.quantizeFromClustering(bgra, clustering, 8)).data)).toBe(0);
        const palette = await ac.getPalette(bgra, 5);
        expect(compare((await handle.quantizeWithPalette(palette)).data, (await ac.quantizeWithPalette(bgra, palette)).data)).toBe(0);
    });

    it('moves a BGRA image with transfer: true and gives the same result', async () => {
        const mover = createWorker({ transfer: true });
        try {
            const { bgra } = images.synthetic;
            const copy = { ...bgra, data: new Uint8Array(bgra.data) };
            const result = await mover.quantize(copy, 8);
            expect(copy.data.byteLength).toBe(0);
            expect(compare(result.data, (await ac.quantize(bgra, 8)).data)).toBe(0);
        } finally {
            mover.terminate();
        }
    });

});

describe('BGRA validation', () => {

    for (const [entry, api] of [['main', ac], ['worker', dropIn]]) {
        it(`reports bad BGRA images from the ${entry} entry`, async () => {
            await expect(api.getPalette({ data: new Uint8Array(6), format: 'bgra' }, 2)).rejects.toMatchObject({
                message: "Invalid image data: length must be a multiple of 4 for 'bgra'.", code: 'invalid-argument', argument: 'image',
            });
            await expect(api.getPalette({ data: new Uint8Array(8), format: 'argb' }, 2)).rejects.toMatchObject({
                message: "Invalid format: must be 'rgb', 'rgba' or 'bgra'.", code: 'invalid-argument', argument: 'image',
            });
            await expect(api.quantize({ data: new Uint8Array(16), format: 'bgra' }, 2, { dither: true })).rejects.toMatchObject({
                code: 'invalid-argument', argument: 'options.width',
            });
        });
    }

});
