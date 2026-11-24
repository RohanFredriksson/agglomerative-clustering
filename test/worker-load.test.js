// worker.load(clustering): a handle for a stored clustering, kept in the worker (3.8).
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { Worker } from 'worker_threads';
import * as ac from '../dist/index.mjs';
import { createWorker } from '../dist/worker.mjs';

const width = 32, height = 24;
const image = new Uint8Array(width * height * 4);
for (let p = 0; p < width * height; p++) {
    const x = p % width, y = Math.floor(p / width);
    image.set([x * 8, y * 10, (x * y) & 255, x % 9 === 0 ? 0 : x % 4 === 0 ? 100 : 255], p * 4);
}

const worker = createWorker();
// `await using` is syntax Node 20 and 22 can't parse, so the tests release their handles here instead; the syntax
// itself is type-checked in test/types/disposable.mts.
const open = [];
const track = (handle) => {open.push(handle); return handle;};
afterEach(async () => {for (const handle of open.splice(0)) {await handle.release();}});
afterAll(() => worker.terminate());

const imageData = () => new ImageData(new Uint8ClampedArray(image), width, height);

describe('worker.load', () => {

    it('matches the deprecated function forms byte for byte', async () => {
        for (const clusterOptions of [{}, { colorSpace: 'oklab' }]) {
            const clustering = await ac.buildClustering(image, clusterOptions);
            const loaded = track(await worker.load(clustering));
            for (const k of [4, 16]) {
                expect(await loaded.getPalette(k)).toEqual(await worker.getPaletteFromClustering(clustering, k));
                expect(await loaded.getSwatches(k)).toEqual(await worker.getSwatchesFromClustering(clustering, k));
                for (const o of [{}, { transparent: true }, { colorSpace: 'rgb' }, { dither: true, width }]) {
                    const label = JSON.stringify([clusterOptions, k, o]);
                    // `transparent` is for the indexed output only.
                    if (!o.transparent) {expect(await loaded.quantize(image, k, o), label).toEqual(await worker.quantizeFromClustering(image, clustering, k, o));}
                    expect(await loaded.quantizeToIndices(image, k, o), label).toEqual(await worker.quantizeToIndicesFromClustering(image, clustering, k, o));
                }
            }
            expect(await loaded.getClusteringInfo()).toEqual(await worker.getClusteringInfo(clustering));
        }
    });

    it('returns the type of the image it is given', async () => {
        const clustering = await ac.buildClustering(image);
        const loaded = track(await worker.load(clustering));
        expect(await loaded.quantize(image, 4)).toBeInstanceOf(Uint8Array);
        const data = await loaded.quantize(imageData(), 4);
        expect(data).toBeInstanceOf(ImageData);
        expect(data.width).toBe(width);
        const raw = await loaded.quantize({ data: image.filter((_, i) => i % 4 !== 3), format: 'rgb' }, 4);
        expect(raw.format).toBe('rgb');
        // One handle maps different images.
        expect((await loaded.quantize(image.slice(0, 16 * 4), 4)).length).toBe(16 * 4);
    });

    it('rejects a damaged clustering, a palette or an image before posting', async () => {
        const clustering = await ac.buildClustering(image);
        await worker.getClusteringInfo(clustering);
        const damaged = clustering.slice();
        damaged[40] ^= 0xFF;
        const posts = vi.spyOn(Worker.prototype, 'postMessage');
        try {
            for (const bad of [damaged, await ac.buildPalette(image, 4), image, new Uint8Array(3), 'x', null]) {
                await expect(worker.load(bad)).rejects.toMatchObject({ code: 'invalid-clustering', argument: 'clustering' });
            }
            expect(posts).not.toHaveBeenCalled();
        } finally {
            posts.mockRestore();
        }
    });

    it('takes the bytes at the call', async () => {
        for (const fresh of [createWorker(), worker]) {
            const clustering = await ac.buildClustering(image);
            const expected = await ac.getPaletteFromClustering(clustering, 6);
            const pending = fresh.load(clustering.slice());
            const copy = clustering.slice();
            const loading = fresh.load(copy);
            copy.fill(0);
            await pending;
            const loaded = await loading;
            expect(await loaded.getPalette(6)).toEqual(expected);
            await loaded.release();
            if (fresh !== worker) {await fresh.terminate();}
        }
    });

    it('extra arguments to load are an error', async () => {
        const clustering = await ac.buildClustering(image);
        await expect(worker.load(clustering, {})).rejects.toMatchObject({ code: 'invalid-argument', argument: 'options' });
    });

    it('a number where the image goes says what the handle holds', async () => {
        const clustering = await ac.buildClustering(image);
        const loaded = track(await worker.load(clustering));
        const message = "Invalid image: this handle holds a clustering, not an image (from worker.load); pass the image, then k.";
        await expect(loaded.quantize(4)).rejects.toMatchObject({ code: 'invalid-argument', argument: 'image', message });
        await expect(loaded.quantizeToIndices(4)).rejects.toMatchObject({ code: 'invalid-argument', argument: 'image', message });
    });

    it('signal and onProgress work on its mapping methods', async () => {
        const clustering = await ac.buildClustering(image);
        const loaded = track(await worker.load(clustering));
        const reason = new Error('stop');
        await expect(loaded.quantize(image, 4, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
        await expect(loaded.quantizeToIndices(image, 4, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
        await expect(loaded.quantize(image, 0, { signal: AbortSignal.abort(reason) })).rejects.toMatchObject({ code: 'invalid-argument', argument: 'k' });
        const seen = [];
        await loaded.quantize(image, 4, { onProgress: (p) => seen.push(p) });
        expect(seen.at(-1)).toBe(1);
        const seenIndices = [];
        await loaded.quantizeToIndices(image, 4, { onProgress: (p) => seenIndices.push(p) });
        expect(seenIndices.at(-1)).toBe(1);
    });

    it('release, await using, and calls after release', async () => {
        const clustering = await ac.buildClustering(image);
        const loaded = await worker.load(clustering);
        await loaded.release();
        await loaded.release();
        for (const call of [() => loaded.getPalette(4), () => loaded.getSwatches(4), () => loaded.getClusteringInfo(), () => loaded.quantize(image, 4), () => loaded.quantizeToIndices(image, 4), () => loaded.chooseFrom(new Uint8Array(6), 1)]) {
            await expect(call()).rejects.toMatchObject({ code: 'invalid-handle' });
        }
        // What `await using` calls at the end of its block (where the runtime has Symbol.asyncDispose).
        if (typeof Symbol.asyncDispose === 'symbol') {
            const inBlock = await worker.load(clustering);
            expect(inBlock[Symbol.asyncDispose]).toBe(inBlock.release);
            expect((await inBlock.getPalette(4)).length).toBe(12);
            await inBlock[Symbol.asyncDispose]();
            await expect(inBlock.getPalette(4)).rejects.toMatchObject({ code: 'invalid-handle' });
        }
    });

    it('has no getClustering and no …WithPalette methods', async () => {
        const loaded = track(await worker.load(await ac.buildClustering(image)));
        for (const name of ['getClustering', 'quantizeWithPalette', 'quantizeToIndicesWithPalette']) {expect(loaded[name]).toBeUndefined();}
    });

    it('chooseFrom on a loaded handle equals clustering.chooseFrom', async () => {
        const clustering = await ac.buildClustering(image);
        const fixed = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 200, 200, 0]);
        const loaded = track(await worker.load(clustering));
        expect(await loaded.chooseFrom(fixed, 3)).toEqual(await clustering.chooseFrom(fixed, 3));
        expect(await loaded.chooseFrom(fixed, 3, { colorSpace: 'oklab' })).toEqual(await clustering.chooseFrom(fixed, 3, { colorSpace: 'oklab' }));
    });

    it('with transfer: true moves the clustering, before the worker has started and once it is running, and the handle still cuts', async () => {
        const clustering = await ac.buildClustering(image);
        const expected = await ac.getPalette(image, 5);
        const moving = createWorker({ transfer: true });
        try {
            // A clustering that is a whole buffer of its own: not yet started, the bytes are moved out of the caller's hands at once.
            const first = new Uint8Array(clustering);
            const pending = moving.load(first);
            expect(first.length).toBe(0);
            const early = await pending;
            expect(await early.getPalette(5)).toEqual(expected);
            // Running: posting moves them, as it does for an image.
            const second = new Uint8Array(clustering);
            const later = await moving.load(second);
            expect(second.length).toBe(0);
            expect(await later.getPalette(5)).toEqual(expected);
            // A view into part of a larger buffer is copied, not moved.
            const inside = new Uint8Array(clustering.length + 8);
            inside.set(clustering, 4);
            const view = inside.subarray(4, 4 + clustering.length);
            const copied = await moving.load(view);
            expect(view.length).toBe(clustering.length);
            expect(await copied.getPalette(5)).toEqual(expected);
        } finally {
            await moving.terminate();
        }
    });

});
