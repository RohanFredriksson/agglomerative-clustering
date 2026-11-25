// `premultiplied` and the image-key check through the worker entry: the same results as the main entry.
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { Worker } from 'worker_threads';
import * as ac from '../dist/index.mjs';
import { createWorker } from '../dist/worker.mjs';

const width = 48, height = 32;
const make = () => {
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const a = y === 0 ? 0 : (x * 5 + y) % 256;
            // Premultiplied bytes: no colour channel above alpha.
            data.set([Math.round(x * 5 * a / 255), Math.round(y * 7 * a / 255), Math.round(((x * y) & 255) * a / 255), a], (y * width + x) * 4);
        }
    }
    return data;
};
const image = () => ({ data: make(), format: 'rgba', width, height, premultiplied: true });

const worker = createWorker();
const open = [];
const track = (handle) => {open.push(handle); return handle;};
afterEach(async () => {vi.restoreAllMocks(); for (const handle of open.splice(0)) {await handle.release();}});
afterAll(() => worker.terminate());

describe('worker entry, premultiplied images', () => {

    it('buildPalette matches the main entry', async () => {
        expect(await worker.buildPalette(image(), 16)).toEqual(await ac.buildPalette(image(), 16));
    });

    it('quantize matches the main entry, with and without dithering, and carries premultiplied', async () => {
        for (const options of [{}, { dither: true }, { dither: 'ordered' }]) {
            const got = await worker.quantize(image(), 16, options);
            expect(got).toEqual(await ac.quantize(image(), 16, options));
            expect(got.premultiplied).toBe(true);
        }
    });

    it('quantizeToIndices and quantizeWithPalette match the main entry', async () => {
        expect(await worker.quantizeToIndices(image(), 16)).toEqual(await ac.quantizeToIndices(image(), 16));
        const palette = await ac.buildPalette(image(), 8);
        expect(await worker.quantizeWithPalette(image(), palette)).toEqual(await ac.quantizeWithPalette(image(), palette));
    });

    it('an image handle maps like the main entry', async () => {
        const handle = track(await worker.cluster(image()));
        const clustering = await ac.buildClustering(image());
        expect(await handle.quantize(16)).toEqual(await clustering.quantize(image(), 16));
        expect(await handle.quantizeToIndices(16)).toEqual(await clustering.quantizeToIndices(image(), 16));
    });

    it('a loaded handle maps a premultiplied image', async () => {
        const clustering = await ac.buildClustering(image());
        const loaded = track(await worker.load(clustering));
        expect(await loaded.quantize(image(), 16)).toEqual(await clustering.quantize(image(), 16));
    });

    it('an unknown key rejects without posting', async () => {
        const post = vi.spyOn(Worker.prototype, 'postMessage');
        const bad = { ...image(), premultiply: true };
        const expected = await ac.buildPalette(bad, 4).catch((e) => e);
        const error = await worker.buildPalette(bad, 4).then(() => null, (e) => e);
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe(expected.message);
        expect(error.code).toBe(expected.code);
        expect(error.argument).toBe(expected.argument);
        expect(post).not.toHaveBeenCalled();
    });

    it('transfer: true moves a premultiplied image and gives the right result', async () => {
        const moving = createWorker({ transfer: true });
        try {
            const input = image();
            const got = await moving.quantize(input, 16);
            expect(got).toEqual(await ac.quantize(image(), 16));
            expect(input.data.byteLength).toBe(0);
        } finally {
            await moving.terminate();
        }
    });
});
