// Inputs that exploratory testing of 3.0.0-beta.1 found handled badly: arrays changed after the call returned, a
// clustering or palette passed as the image, objects from another realm, detached buffers, empty palettes, and widths
// that don't fit the image.
import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { runInNewContext } from 'vm';
import * as ac from '../dist/index.mjs';
import { createWorker } from '../dist/worker.mjs';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
let copies = 0;
// A copy of the main entry that hasn't loaded its module yet.
const fresh = () => import(/* @vite-ignore */ `${pathToFileURL(resolve(dist, 'index.mjs')).href}?inputs=${copies++}`);

const solid = (rgb, pixels = 100) => {
    const data = new Uint8Array(pixels * 4);
    for (let p = 0; p < pixels; p++) {data.set([...rgb, 255], p * 4);}
    return data;
};
const red = [255, 0, 0], blue = [0, 0, 255];
const paint = (data, rgb) => {for (let p = 0; p < data.length / 4; p++) {data.set([...rgb, 255], p * 4);}};

describe('bytes are read when the call is made', () => {

    // A frame loop that reuses one buffer changes it right after each call: the result must be of the pixels at the call.
    it.each([
        ['before the module has loaded', fresh],
        ['once it has loaded', async () => {const entry = await fresh(); await entry.init(); return entry;}],
    ])('in the main entry, %s', async (_, entry) => {
        const lib = await entry();
        const image = solid(red);
        const palette = lib.getPalette(image, 2);
        const indexed = lib.quantizeToIndices({ data: image, format: 'rgba', width: 10 }, 2, { dither: true });
        paint(image, blue);
        expect(Array.from(await palette)).toEqual(red);
        expect(Array.from((await indexed).palette)).toEqual(red);
    });

    it('in the main entry, with a signal (clustering in slices)', async () => {
        const image = solid(red);
        const palette = ac.getPalette(image, 2, { signal: new AbortController().signal });
        paint(image, blue);
        expect(Array.from(await palette)).toEqual(red);
    });

    it('in the main entry, for clusterings and palettes', async () => {
        const lib = await fresh();
        const clustering = new Uint8Array(await ac.getClustering(solid(red)));
        const palette = new Uint8Array(red);
        const cut = lib.getPaletteFromClustering(clustering, 2);
        const mapped = lib.quantizeWithPalette(solid(blue, 4), palette);
        clustering.fill(0);
        palette.set(blue);
        expect(Array.from(await cut)).toEqual(red);
        expect(Array.from((await mapped).subarray(0, 3))).toEqual(red);
    });

    it.each([
        ['a new worker', () => createWorker()],
        ['a new worker with transfer: true', () => createWorker({ transfer: true })],
    ])('in the worker entry, with %s', async (_, make) => {
        const worker = make();
        try {
            const image = solid(red);
            const first = worker.getPalette(image, 2);
            if (image.length > 0) {paint(image, blue);}
            expect(Array.from(await first)).toEqual(red);
            const again = solid(red);
            const second = worker.getPalette(again, 2);
            if (again.length > 0) {paint(again, blue);}
            expect(Array.from(await second)).toEqual(red);
        } finally {
            await worker.terminate();
        }
    });

});

describe('arguments in the wrong place', () => {

    it('rejects a clustering or a palette passed as the image', async () => {
        const clustering = await ac.getClustering(solid(red));
        const palette = await ac.getPalette(solid(red), 2);
        for (const call of [() => ac.getPalette(clustering, 4), () => ac.quantize(clustering, 4), () => ac.getClustering(clustering)]) {
            await expect(call()).rejects.toMatchObject({ code: 'invalid-argument', argument: 'image', message: expect.stringContaining('getPaletteFromClustering') });
        }
        await expect(ac.getPalette(palette, 4)).rejects.toMatchObject({ code: 'invalid-argument', argument: 'image', message: expect.stringContaining('palette') });
    });

});

describe('values from another realm', () => {

    // An iframe's ImageData has another realm's prototype; its tag still says what it is.
    it('takes an ImageData from another realm', async () => {
        const width = 5, height = 4;
        const data = new Uint8ClampedArray(width * height * 4).map((_, i) => (i * 37) & 255);
        const foreign = runInNewContext(`({ data: new Uint8ClampedArray(bytes), width: ${width}, height: ${height}, colorSpace: 'srgb', [Symbol.toStringTag]: 'ImageData' })`, { bytes: data });
        const local = new ImageData(new Uint8ClampedArray(data), width, height);
        expect(await ac.getPalette(foreign, 3)).toEqual(await ac.getPalette(local, 3));
        const mapped = await ac.quantize(foreign, 3, { dither: true });
        expect(mapped).toBeInstanceOf(ImageData);
        expect(mapped.data).toEqual((await ac.quantize(local, 3, { dither: true })).data);
        const worker = createWorker();
        try {
            expect(await worker.getPalette(foreign, 3)).toEqual(await ac.getPalette(local, 3));
        } finally {
            await worker.terminate();
        }
    });

});

describe('detached buffers', () => {

    const detach = (view) => {structuredClone(view.buffer, { transfer: [view.buffer] }); return view;};

    it('reports pixels whose buffer was transferred away, with a code', async () => {
        for (const make of [
            () => detach(solid(red)),
            () => ({ data: detach(solid(red)), format: 'rgba' }),
            () => {const image = new ImageData(new Uint8ClampedArray(solid(red)), 10, 10); detach(image.data); return image;},
        ]) {
            await expect(ac.getPalette(make(), 2)).rejects.toMatchObject({ code: 'invalid-argument', argument: 'image', message: expect.stringContaining('detached') });
        }
    });

});

describe('empty palettes', () => {

    it('rejects mapping visible pixels to an empty palette', async () => {
        await expect(ac.quantizeWithPalette(solid(red, 4), new Uint8Array(0))).rejects.toMatchObject({ code: 'invalid-argument', argument: 'palette' });
        await expect(ac.quantizeWithPalette({ data: new Uint8Array(6), format: 'rgb' }, [])).rejects.toMatchObject({ code: 'invalid-argument', argument: 'palette' });
    });

    it('still maps an image with no visible pixels, whose palette is empty', async () => {
        const clear = new Uint8Array(16);
        const palette = await ac.getPalette(clear, 4);
        expect(palette.length).toBe(0);
        expect(Array.from(await ac.quantizeWithPalette(clear, palette))).toEqual(Array.from(clear));
    });

});

describe('width and height', () => {

    it('checks a width or height given alone, and options.width without dithering', async () => {
        const data = new Uint8Array(4 * 6);
        for (const bad of [{ width: 4 }, { width: 500 }, { height: 4 }, { width: 0 }]) {
            await expect(ac.getPalette({ data, format: 'rgba', ...bad }, 2), JSON.stringify(bad)).rejects.toMatchObject({ code: 'invalid-argument', argument: 'image' });
        }
        for (const width of [4, 0, -5, 1.5]) {
            await expect(ac.quantize(data, 2, { width }), String(width)).rejects.toMatchObject({ code: 'invalid-argument', argument: 'options.width' });
        }
        expect((await ac.quantize({ data, format: 'rgba', width: 3 }, 2)).width).toBe(3);
        await expect(ac.quantize(data, 2, { width: 2 })).resolves.toBeInstanceOf(Uint8Array);
    });

});
