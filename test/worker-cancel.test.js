import { describe, it, expect, afterAll } from 'vitest';
import { performance } from 'perf_hooks';
import * as ac from '../dist/index.mjs';
import { createWorker } from '../dist/worker.mjs';

// Noise with ~half a million distinct colours: clustering it takes most of a second, long enough to cancel.
const mulberry = (seed) => () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const noise = (width, height, seed) => {
    const rnd = mulberry(seed), data = new Uint8Array(width * height * 4);
    for (let p = 0; p < width * height; p++) {data.set([rnd() * 256, rnd() * 256, rnd() * 256, 255], p * 4);}
    return { data, format: 'rgba', width, height };
};
const big = noise(800, 600, 1);
const small = noise(16, 16, 2);

const worker = createWorker();
afterAll(() => worker.terminate());

// Byte-for-byte equality; vitest's toEqual is far too slow for megabytes of typed array.
const same = (a, b) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

const timed = async (promise) => {
    const start = performance.now();
    const settled = await promise.then((value) => ({ value }), (error) => ({ error }));
    return { ...settled, ms: performance.now() - start };
};

// How long the whole clustering takes when nothing interrupts it.
const whole = await timed(worker.getClustering(big));

describe('a worker call with a signal or onProgress', () => {

    it('gives the same results, and reports progress', async () => {
        const calls = [];
        const options = { onProgress: (value) => calls.push(value), signal: new AbortController().signal };
        expect(await worker.getClustering(small, options)).toEqual(await ac.getClustering(small));
        expect(await worker.getPalette(small, 4, options)).toEqual(await ac.getPalette(small, 4));
        expect(await worker.quantize(small, 4, { ...options, dither: true })).toEqual(await ac.quantize(small, 4, { dither: true, width: 16 }));
        expect(await worker.quantizeToIndices(small, 4, options)).toEqual(await ac.quantizeToIndices(small, 4));
        expect(calls[0]).toBe(0);
        expect(calls[calls.length - 1]).toBe(1);

        const bigCalls = [];
        const clustering = await worker.getClustering(big, { onProgress: (value) => bigCalls.push(value) });
        expect(same(clustering, whole.value)).toBe(true);
        expect(bigCalls.length).toBeGreaterThan(10);
        for (let i = 1; i < bigCalls.length; i++) {expect(bigCalls[i]).toBeGreaterThan(bigCalls[i - 1]);}
        expect(bigCalls[bigCalls.length - 1]).toBe(1);
    }, 60000);

    it('stops the worker when aborted mid-run, so the next call is not kept waiting', async () => {
        // The test only means something if the clustering is long enough to cancel (it takes ~1 s here).
        expect(whole.ms).toBeGreaterThan(150);
        const controller = new AbortController();
        const running = timed(worker.getClustering(big, { signal: controller.signal, onProgress: (value) => {if (value > 0.3) {controller.abort();}} }));
        const { error } = await running;
        expect(error.name).toBe('AbortError');
        // A small call right behind it finishes long before the clustering would have.
        const next = await timed(worker.getPalette(small, 4));
        expect(next.value).toEqual(await ac.getPalette(small, 4));
        expect(next.ms).toBeLessThan(whole.ms * 0.4);
    }, 60000);

    it('rejects at once with the reason, and a queued call that is cancelled never runs', async () => {
        const start = performance.now();
        const first = worker.getClustering(big);
        const controller = new AbortController();
        const second = worker.getClustering(big, { signal: controller.signal });
        const third = worker.getPalette(small, 4);
        const reason = new Error('no longer needed');
        controller.abort(reason);
        await expect(second).rejects.toBe(reason);
        expect(performance.now() - start).toBeLessThan(whole.ms * 0.5);
        const firstResult = await first;
        const thirdResult = await third;
        const elapsed = performance.now() - start;
        // The cancelled clustering never ran: the three calls took about one clustering, not two.
        expect(elapsed).toBeLessThan(whole.ms * 1.6);
        expect(same(firstResult, whole.value)).toBe(true);
        expect(thirdResult).toEqual(await ac.getPalette(small, 4));
    }, 60000);

    it('rejects a call whose signal is already aborted without sending or detaching anything', async () => {
        const moving = createWorker({ transfer: true });
        try {
            const controller = new AbortController();
            controller.abort();
            const image = small.data.slice();
            await expect(moving.getClustering(image, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
            expect(image.length).toBe(small.data.length);
            await expect(moving.cluster(image, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
        } finally {
            await moving.terminate();
        }
    });

    it('works through handles: cluster, quantize and quantizeToIndices', async () => {
        const controller = new AbortController();
        await expect(worker.cluster(big, { signal: controller.signal, onProgress: (v) => {if (v > 0.2) {controller.abort();}} })).rejects.toMatchObject({ name: 'AbortError' });

        const handle = await worker.cluster(small, { signal: new AbortController().signal });
        const calls = [];
        expect(await handle.quantize(4, { onProgress: (v) => calls.push(v) })).toEqual(await worker.quantizeWithClustering(small, await ac.getClustering(small), 4));
        expect(calls[calls.length - 1]).toBe(1);
        const aborted = new AbortController();
        aborted.abort();
        await expect(handle.quantize(4, { signal: aborted.signal })).rejects.toMatchObject({ name: 'AbortError' });
        await expect(handle.quantizeToIndices(4, { signal: aborted.signal })).rejects.toMatchObject({ name: 'AbortError' });
        expect((await handle.quantizeToIndices(4, { signal: new AbortController().signal })).indices.length).toBe(256);
        await handle.release();
    }, 60000);

    it('fails the call with the error of an onProgress that throws, and stops the worker, like the main thread', async () => {
        const start = performance.now();
        const error = await worker.getClustering(big, { onProgress: (value) => {if (value > 0.2) {throw new Error('boom');}} }).catch((e) => e);
        expect(error.message).toBe('boom');
        // The clustering was cancelled, not run to the end: the next call is not kept waiting for it.
        const next = await timed(worker.getPalette(small, 4));
        expect(next.value).toEqual(await ac.getPalette(small, 4));
        expect(performance.now() - start).toBeLessThan(whole.ms * 0.6);
        const handle = await worker.cluster(small);
        await expect(handle.quantize(4, { onProgress: () => {throw new Error('boom again');} })).rejects.toThrow('boom again');
        await handle.release();
    }, 60000);

    it('lets a handle be released after its worker was terminated, in either order', async () => {
        const doomed = createWorker();
        const handle = await doomed.cluster(small);
        await doomed.terminate();
        await handle.release();
        await handle.release();
        await expect(handle.getPalette(2)).rejects.toMatchObject({ code: 'invalid-handle' });
        // And the way `await using` does it: terminate() first, then the handle's dispose at the end of the scope. (The
        // syntax itself is left out of tests so they parse on every supported Node version; types/ checks it.)
        const other = createWorker();
        const kept = await other.cluster(small);
        await kept.getPalette(2);
        await other.terminate();
        if (typeof Symbol.asyncDispose === 'symbol') {await kept[Symbol.asyncDispose]();}
    });

    it('validates signal and onProgress on this side', async () => {
        await expect(worker.getClustering(small, { signal: {} })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(worker.getPalette(small, 4, { onProgress: 3 })).rejects.toMatchObject({ code: 'invalid-argument' });
        const handle = await worker.cluster(small);
        await expect(handle.quantize(4, { signal: 'no' })).rejects.toMatchObject({ code: 'invalid-argument' });
        await handle.release();
    });

});
