import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as ac from '../dist/index.mjs';
import * as dropIn from '../dist/worker.mjs';
import { createWorker } from '../dist/worker.mjs';

const width = 32, height = 24;
const image = new Uint8Array(width * height * 4);
for (let p = 0; p < width * height; p++) {
    const x = p % width, y = Math.floor(p / width);
    image.set([x * 8, y * 10, (x * y) & 255, x % 9 === 0 ? 0 : x % 4 === 0 ? 100 : 255], p * 4);
}

const worker = createWorker();
afterAll(() => worker.terminate());

describe('a worker gives the same results as the main entry', () => {

    const raw = { data: image, format: 'rgba', width, height };

    it('dithers with every method like the main entry', async () => {
        for (const dither of ['atkinson', 'ordered', { method: 'ordered', steps: 8 }]) {
            expect((await worker.quantize(raw, 8, { dither })).data, JSON.stringify(dither)).toEqual((await ac.quantize(raw, 8, { dither })).data);
        }
    });

    it('for clusterings, palettes, weights and info', async () => {
        const options = { colorSpace: 'oklab', precision: 6 };
        const clustering = await worker.getClustering(image, options);
        expect(clustering).toEqual(await ac.getClustering(image, options));
        expect(await worker.getPalette(image, 12, options)).toEqual(await ac.getPalette(image, 12, options));
        expect(await worker.getPaletteFromClustering(clustering, 7)).toEqual(await ac.getPaletteFromClustering(clustering, 7));
        expect(await worker.getSwatchesFromClustering(clustering, 7)).toEqual(await ac.getSwatchesFromClustering(clustering, 7));
        expect(await worker.getClusteringInfo(clustering)).toEqual(await ac.getClusteringInfo(clustering));
    });

    it('for mapped images, in the type they were given', async () => {
        const clustering = await ac.getClustering(image);
        const palette = await ac.getPalette(image, 5);
        expect(await worker.quantize(image, 8)).toEqual(await ac.quantize(image, 8));
        expect(await worker.quantize(raw, 8, { dither: true })).toEqual(await ac.quantize(raw, 8, { dither: true }));
        expect(await worker.quantizeFromClustering(raw, clustering, 6)).toEqual(await ac.quantizeFromClustering(raw, clustering, 6));
        expect(await worker.quantizeWithPalette(image, palette, { colorSpace: 'oklab' })).toEqual(await ac.quantizeWithPalette(image, palette, { colorSpace: 'oklab' }));

        const imageData = new ImageData(new Uint8ClampedArray(image), width, height);
        const result = await worker.quantize(imageData, 8, { dither: 0.5 });
        expect(result).toBeInstanceOf(ImageData);
        expect([result.width, result.height]).toEqual([width, height]);
        expect(new Uint8Array(result.data.buffer)).toEqual(new Uint8Array((await ac.quantize(imageData, 8, { dither: 0.5 })).data.buffer));
    });

    it('for indexed output', async () => {
        const clustering = await ac.getClustering(image);
        const palette = await ac.getPalette(image, 5);
        expect(await worker.quantizeToIndices(raw, 300, { transparent: true })).toEqual(await ac.quantizeToIndices(raw, 300, { transparent: true }));
        expect(await worker.quantizeToIndicesFromClustering(image, clustering, 6)).toEqual(await ac.quantizeToIndicesFromClustering(image, clustering, 6));
        expect(await worker.quantizeToIndicesWithPalette(image, palette)).toEqual(await ac.quantizeToIndicesWithPalette(image, palette));
    });

    it('for many calls at once', async () => {
        const ks = Array.from({ length: 20 }, (_, i) => i + 1);
        const results = await Promise.all(ks.map((k) => worker.getPalette(image, k)));
        for (const [i, k] of ks.entries()) {expect(results[i]).toEqual(await ac.getPalette(image, k));}
    });

    it('and the same errors', async () => {
        await expect(worker.quantize(image, 0)).rejects.toThrow('Invalid k');
        await expect(worker.getClustering({ data: image, format: 'argb' })).rejects.toThrow('Invalid format');
        await expect(worker.getClustering(null)).rejects.toThrow('Invalid image');
        await expect(worker.getPaletteFromClustering(new Uint8Array(5), 2)).rejects.toThrow('Invalid clustering');
        await expect(worker.quantize(image, 4, { colour: 'rgb' })).rejects.toThrow("Invalid option 'colour'");
    });

});

describe('handles', () => {

    it('keep an image and its clustering in the worker', async () => {
        const handle = await worker.cluster(image, { colorSpace: 'oklab' });
        const clustering = await ac.getClustering(image, { colorSpace: 'oklab' });
        expect(await handle.getClustering()).toEqual(clustering);
        expect(await handle.getPalette(9)).toEqual(await ac.getPaletteFromClustering(clustering, 9));
        expect(await handle.getSwatches(9)).toEqual(await ac.getSwatchesFromClustering(clustering, 9));
        expect(await handle.getClusteringInfo()).toEqual(await ac.getClusteringInfo(clustering));
        expect(await handle.quantize(9, { dither: true, width })).toEqual(await ac.quantizeFromClustering(image, clustering, 9, { dither: true, width }));
        expect(await handle.quantizeToIndices(9, { transparent: true })).toEqual(await ac.quantizeToIndicesFromClustering(image, clustering, 9, { transparent: true }));
        await handle.release();
        await expect(handle.getPalette(2)).rejects.toThrow('released');
    });

    it('release through Symbol.asyncDispose, and releasing twice is harmless', async () => {
        const handle = await worker.cluster(image);
        if (typeof Symbol.asyncDispose === 'symbol') {
            await handle[Symbol.asyncDispose]();
            await expect(handle.getPalette(2)).rejects.toThrow('released');
        }
        await handle.release();
        await handle.release();
    });

    it('map the kept image with a palette of your own', async () => {
        const handle = await worker.cluster(image);
        const palette = await ac.getPalette(image, 6);
        expect(await handle.quantizeWithPalette(palette, { dither: true, width })).toEqual(await ac.quantizeWithPalette(image, palette, { dither: true, width }));
        expect(await handle.quantizeToIndicesWithPalette(palette, { transparent: true })).toEqual(await ac.quantizeToIndicesWithPalette(image, palette, { transparent: true }));
        await expect(handle.quantizeWithPalette(new Uint8Array(4))).rejects.toMatchObject({ code: 'invalid-argument' });
        const aborted = new AbortController();
        aborted.abort();
        await expect(handle.quantizeWithPalette(palette, { signal: aborted.signal })).rejects.toMatchObject({ name: 'AbortError' });
        await handle.release();
    });

    it('map with their own palette in the space they were clustered in, unless told otherwise', async () => {
        // A smooth, photo-like image: nearest-colour matching differs between RGB and OKLab here (it would not for a few
        // well-separated colours, which would make this test pass for the wrong reason).
        const w = 80, h = 60, photo = new Uint8Array(w * h * 4);
        let seed = 3; const rnd = () => {seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296;};
        for (let p = 0; p < w * h; p++) {const x = p % w, y = Math.floor(p / w); photo.set([x * 3 + rnd() * 8, y * 4 + rnd() * 8, 128 + 100 * Math.sin(x / 9 + y / 13) + rnd() * 8, 255], p * 4);}

        const handle = await worker.cluster(photo, { colorSpace: 'oklab' });
        const palette = await handle.getPalette(12);
        const inOklab = await ac.quantizeWithPalette(photo, palette, { colorSpace: 'oklab' });
        const inRgb = await ac.quantizeWithPalette(photo, palette, { colorSpace: 'rgb' });
        expect(inOklab).not.toEqual(inRgb);                                                 // the test can tell the spaces apart
        // The handle's own palette maps to the same image as handle.quantize, and to OKLab matching.
        expect(await handle.quantizeWithPalette(palette)).toEqual(await handle.quantize(12));
        expect(await handle.quantizeWithPalette(palette)).toEqual(inOklab);
        expect((await handle.quantizeToIndicesWithPalette(palette)).indices).toEqual((await ac.quantizeToIndicesWithPalette(photo, palette, { colorSpace: 'oklab' })).indices);
        // Naming a space wins; invalid options are still rejected, not replaced by the default.
        expect(await handle.quantizeWithPalette(palette, { colorSpace: 'rgb' })).toEqual(inRgb);
        expect(await handle.quantizeWithPalette(palette, { colorSpace: undefined })).toEqual(inOklab);
        await expect(handle.quantizeWithPalette(palette, new Map())).rejects.toMatchObject({ code: 'invalid-argument' });
        await handle.release();

        // Plain bytes carry no space, so they are matched in the handle's own; a Palette knows its own, which wins over the handle's.
        const rgbHandle = await worker.cluster(photo);
        expect(await rgbHandle.quantizeWithPalette(new Uint8Array(palette))).toEqual(inRgb);
        expect(await rgbHandle.quantizeWithPalette(palette)).toEqual(inOklab);
        await rgbHandle.release();
    });

    it('give results in the type of the image they were made from', async () => {
        const imageData = new ImageData(new Uint8ClampedArray(image), width, height);
        const handle = await worker.cluster(imageData);
        const result = await handle.quantize(4, { dither: true });
        expect(result).toBeInstanceOf(ImageData);
        expect(new Uint8Array(result.data.buffer)).toEqual(new Uint8Array((await ac.quantize(imageData, 4, { dither: true })).data.buffer));
        const rawHandle = await worker.cluster({ data: image, format: 'rgba', width });
        expect(await rawHandle.quantize(4)).toEqual(await ac.quantize({ data: image, format: 'rgba', width }, 4));
        await handle.release();
        await rawHandle.release();
    });

    it('report clustering errors when created', async () => {
        await expect(worker.cluster(image, { precision: 9 })).rejects.toThrow('Invalid precision');
    });

});

describe('createWorker', () => {

    it('copies inputs by default, and transfers them with transfer: true', async () => {
        const copy = image.slice();
        await worker.getPalette(copy, 4);
        expect(copy.length).toBe(image.length);
        const moving = createWorker({ transfer: true });
        const transferred = image.slice();
        expect(await moving.getPalette(transferred, 4)).toEqual(await ac.getPalette(image, 4));
        expect(transferred.length).toBe(0);
        await moving.terminate();
    });

    it('with transfer: true, copies images that are only part of their buffer, or whose buffer cannot be transferred', async () => {
        const moving = createWorker({ transfer: true });
        // A view into a larger buffer: transferring the buffer would empty the caller's other views of it.
        const shared = new Uint8Array(image.length * 2);
        shared.set(image);
        shared.set(image, image.length);
        const [first, second] = [shared.subarray(0, image.length), shared.subarray(image.length)];
        expect(await moving.getPalette(first, 4)).toEqual(await ac.getPalette(image, 4));
        expect([first.length, second.length]).toEqual([image.length, image.length]);
        expect(second).toEqual(image);
        // Small Node Buffers share a pool that can never be transferred.
        const pooled = Buffer.from(image.subarray(0, 64));
        expect(await moving.getPalette(pooled, 2)).toEqual(await ac.getPalette(new Uint8Array(pooled), 2));
        expect(pooled.length).toBe(64);
        // A buffer of its own is still transferred, also when kept by a handle.
        const own = image.slice();
        await (await moving.cluster(own)).release();
        expect(own.length).toBe(0);
        await moving.terminate();
    });

    it('stops and restarts the shared worker', async () => {
        const first = await dropIn.getPalette(image, 4);
        await dropIn.terminate();
        await dropIn.terminate();
        expect(await dropIn.getPalette(image, 4)).toEqual(first);
        await dropIn.terminate();
    });

    it('reports arguments that cannot be sent to the worker as invalid, and keeps working', async () => {
        for (const bad of [
            () => worker.getPalette(image, 4, { bogus: () => {} }),
            () => worker.getPalette(image, Symbol('k')),
            () => worker.getPalette(Promise.resolve(image), 4),
            () => worker.quantizeWithPalette(image, class Palette {}),
            () => worker.getPaletteFromClustering({ toJSON() {}, fn() {} }, 2),
        ]) {
            await expect(bad()).rejects.toMatchObject({ code: 'invalid-argument' });
        }
        expect(await worker.getPalette(image, 4)).toEqual(await ac.getPalette(image, 4));
    });

    it('validates its options', () => {
        expect(() => createWorker({ transfer: 'yes' })).toThrow('Invalid transfer');
        expect(() => createWorker({ threads: 2 })).toThrow("Invalid option 'threads'");
    });

    it('stops a worker that is still starting once, however many calls wait for it', async () => {
        // Found by the sixth round (3.0.0-beta.6): each waiting call terminated the started worker again, and in Node more
        // than ten of them printed a MaxListenersExceededWarning.
        const warnings = [];
        const listen = (warning) => warnings.push(warning);
        process.on('warning', listen);
        try {
            const starting = createWorker();
            const calls = Array.from({ length: 12 }, () => starting.getPalette(image, 4).catch((error) => error.code));
            const first = starting.terminate();
            const second = starting.terminate();
            expect(second).toBe(first);
            await first;
            expect(await Promise.all(calls)).toEqual(Array(12).fill('worker-terminated'));
            await new Promise((done) => setTimeout(done, 50));
            expect(warnings.filter((warning) => warning.name === 'MaxListenersExceededWarning')).toEqual([]);
        } finally {
            process.off('warning', listen);
        }
    });

    it('rejects calls waiting on a terminated worker, and later calls', async () => {
        const doomed = createWorker();
        await doomed.init();
        const waiting = expect(doomed.getPalette(image, 4)).rejects.toThrow('terminated');
        await doomed.terminate();
        await waiting;
        await expect(doomed.getPalette(image, 4)).rejects.toThrow('terminated');
    });

});

describe('the drop-in module', () => {

    it('exports the main entry\'s functions, plus createWorker', () => {
        expect(Object.keys(dropIn).sort()).toEqual([...Object.keys(ac), 'createWorker', 'terminate'].sort());
    });

    it('runs them in a shared worker', async () => {
        expect(await dropIn.quantize(image, 6)).toEqual(await ac.quantize(image, 6));
    });

    it('never keeps a Node process alive while idle', async () => {
        const script = `import { getPalette } from ${JSON.stringify(new URL('../dist/worker.mjs', import.meta.url).href)};
            console.log((await getPalette(new Uint8Array([1, 2, 3, 255, 200, 100, 0, 255]), 2)).length);`;
        const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { timeout: 20_000 });
        expect(stdout.trim()).toBe('6');
    }, 30_000);

});
