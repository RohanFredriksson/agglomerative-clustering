import { describe, it, expect, afterAll } from 'vitest';
import * as ac from '../dist/index.mjs';
import { createWorker } from '../dist/worker.mjs';

// The methods on Clustering read their receiver, so they run on any bytes through `call`.
const made = await ac.buildClustering(new Uint8Array(4 * 16).fill(200));
const cut = (bytes, k) => made.getPalette.call(bytes, k);

const image = new Uint8Array(4 * 16).fill(200);
const worker = createWorker();
afterAll(() => worker.terminate());

const caught = async (promise) => {
    try {await promise;} catch (error) {return error;}
    throw new Error('Expected a rejection.');
};

describe('errors carry a code', () => {

    it.each([
        ['an invalid image', () => ac.buildPalette('nope', 4), 'invalid-argument'],
        ['an invalid k', () => ac.buildPalette(image, 0), 'invalid-argument'],
        ['an unknown option', () => ac.buildPalette(image, 4, { dither: true }), 'invalid-argument'],
        ['an invalid palette', () => ac.quantizeWithPalette(image, new Uint8Array(4)), 'invalid-argument'],
        ['bytes that are not a clustering', () => cut(new Uint8Array([1, 2, 3, 4, 5]), 2), 'invalid-clustering'],
        ['a clustering from a newer format', () => cut(new Uint8Array([0xAC, 99, 0, 0, 0, 0, 0]), 2), 'unsupported-version'],
    ])('%s', async (_, call, code) => {
        const error = await caught(call());
        expect(error).toBeInstanceOf(Error);
        expect(error.code).toBe(code);
    });

    it('needs a 3.x clustering for weights', async () => {
        const v2 = new Uint8Array([0xAC, 2, 0, 8, 1, 2, 3]);
        expect((await caught(made.getSwatches.call(v2, 1))).code).toBe('unsupported-version');
    });

});

describe('a worker fails like the main entry', () => {

    // A stored clustering enters through `new Clustering` on the main entry and `worker.load` on a worker.
    const loaded = async (api, bytes) => api === ac ? new ac.Clustering(bytes) : api.load(bytes);

    const cases = [
        ['an invalid k', (api) => api.buildPalette(image, 0)],
        ['an unknown option', (api) => api.buildPalette(image, 4, { dither: true })],
    ];

    it.each(cases)('with %s', async (_, call) => {
        const expected = await caught(call(ac));
        const error = await caught(call(worker));
        expect(error.name).toBe(expected.name);
        expect(error.message).toBe(expected.message);
        expect(error.code).toBe(expected.code);
        expect(error.stack).toContain('errors.test');
        // checked on the caller's side, before anything is posted, so there is no remote stack to attach as a cause
    });

    // `worker.load` checks the bytes on the caller's side (there is no remote stack to attach as a cause).
    it.each([
        ['an invalid clustering', new Uint8Array([1, 2, 3, 4, 5])],
        ['a newer clustering', new Uint8Array([0xAC, 99, 0, 0, 0, 0, 0])],
    ])('with %s given to load', async (_, bytes) => {
        const expected = await caught(loaded(ac, bytes));
        const error = await caught(loaded(worker, bytes));
        expect(error.message).toBe(expected.message);
        expect(error.code).toBe(expected.code);
        expect(error.argument).toBe(expected.argument);
    });

    it('codes handle and termination errors', async () => {
        const handle = await worker.cluster(image);
        await handle.release();
        expect((await caught(handle.getPalette(2))).code).toBe('invalid-handle');
        const doomed = createWorker();
        await doomed.terminate();
        expect((await caught(doomed.buildPalette(image, 4))).code).toBe('worker-terminated');
        expect(() => createWorker({ transfer: 'yes' })).toThrow(expect.objectContaining({ code: 'invalid-argument' }));
    });

});

describe('which argument an error is about', () => {
    const image = new Uint8Array(64).map((_, i) => (i * 37) & 255);
    const argumentOf = async (promise) => (await promise.then(() => null, (e) => e))?.argument;

    it('names it for programs, in every function, and through the worker', async () => {
        const { createWorker } = await import('../dist/worker.mjs');
        const clustering = await ac.buildClustering(image);
        const worker = createWorker();
        try {
            for (const entry of [ac, worker]) {
                expect(await argumentOf(entry.buildPalette('nope', 4))).toBe('image');
                expect(await argumentOf(entry.buildPalette(image, 0))).toBe('k');
                expect(await argumentOf(entry.buildPalette(image, 4, null))).toBe('options');
                expect(await argumentOf(entry.buildPalette(image, 4, { colorSpace: 'lab' }))).toBe('options.colorSpace');
                expect(await argumentOf(entry.buildPalette(image, 4, { colourSpace: 'oklab' }))).toBe('options.colourSpace');
                expect(await argumentOf(entry.buildPalette(image, 4, { precision: 9 }))).toBe('options.precision');
                expect(await argumentOf(entry.quantize(image, 4, { dither: true }))).toBe('options.width');
                expect(await argumentOf((entry === ac ? cut(new Uint8Array(5), 2) : entry.load(new Uint8Array(5))))).toBe('clustering');
                expect(await argumentOf(entry.quantizeWithPalette(image, [300, 0, 0]))).toBe('palette');
                expect(await argumentOf(entry.quantizeWithPalette(image, clustering))).toBe('palette');
                expect(await argumentOf((entry === ac ? clustering.quantize(image, 4, { onProgress: 5 }) : entry.load(clustering).then((handle) => handle.quantize(image, 4, { onProgress: 5 }))))).toBe('options.onProgress');
            }
        } finally {
            await worker.terminate();
        }
    });

    it('is on constructor errors too, and absent when an error is not about an argument', async () => {
        expect(() => new ac.Palette([1, 2, 3], 'lab')).toThrow(expect.objectContaining({ argument: 'colorSpace' }));
        expect(() => new ac.Palette([300, 0, 0])).toThrow(expect.objectContaining({ argument: 'palette' }));
        expect(() => new ac.Clustering(new Uint8Array(5))).toThrow(expect.objectContaining({ argument: 'clustering' }));
        const { createWorker } = await import('../dist/worker.mjs');
        const worker = createWorker();
        await worker.terminate();
        const terminated = await worker.buildPalette(image, 4).catch((e) => e);
        expect(terminated.code).toBe('worker-terminated');
        expect('argument' in terminated).toBe(false);
    });
});

describe('errorCodes and isCodedError', () => {

    it('lists exactly the codes the source can throw, in both entries, frozen', async () => {
        const { readFileSync } = await import('fs');
        const source = ['index.js', 'shared.js', 'worker.js', 'worker-thread.js'].map((file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')).join('\n');
        const thrown = new Set([...source.matchAll(/fail\('([a-z-]+)'/g)].map((match) => match[1]));
        expect([...ac.errorCodes].sort()).toEqual([...thrown].sort());
        expect(Object.isFrozen(ac.errorCodes)).toBe(true);
        const workerEntry = await import('../dist/worker.mjs');
        expect(workerEntry.errorCodes).toBe(ac.errorCodes);
        expect(workerEntry.isCodedError).toBe(ac.isCodedError);
    });

    it("is true for the library's errors, from both entries, and for them after crossing IPC", async () => {
        const main = await caught(ac.buildPalette(image, 0));
        const remote = await caught(worker.buildPalette(image, 0));
        for (const error of [main, remote, { message: remote.message, code: remote.code, argument: remote.argument }, JSON.parse(JSON.stringify({ message: 'x', code: 'worker-failed' }))]) {
            expect(ac.isCodedError(error)).toBe(true);
        }
    });

    it("is false for errors that aren't the library's", async () => {
        const enoent = Object.assign(new Error('no such file'), { code: 'ENOENT' });
        const controller = new AbortController();
        controller.abort();
        const aborted = await caught(ac.buildPalette(image, 2, { signal: controller.signal }));
        for (const value of [enoent, aborted, new Error('plain'), { code: 'invalid-argument' }, 'invalid-argument', null, undefined, 42]) {
            expect(ac.isCodedError(value)).toBe(false);
        }
    });

});

describe('message wording', () => {
    const message = async (call) => (await caught(Promise.resolve().then(call))).message;

    it('counts bytes and entries in the singular', async () => {
        expect(await message(() => new ac.Clustering(new Uint8Array(1)))).toContain("(1 byte that doesn't start");
        expect(await message(() => new ac.Clustering(new Uint8Array(2)))).toContain('(2 bytes that don\'t start');
        expect(await message(() => made.chooseFrom(new Uint8Array(3), 2))).toBe('Invalid k: 2 is more than the 1 entry in the palette; use 1 or fewer.');
    });

    it('calls an empty clustering empty, not a 1.x clustering', async () => {
        const text = await message(() => new ac.Clustering(new Uint8Array(0)));
        expect(text).toContain('empty');
        expect(text).not.toContain('1.x');
        expect(await message(() => new ac.Clustering(new Uint8Array(12)))).toContain('1.x');
    });

    it('says what to do with 16-bit pixels', async () => {
        for (const call of [() => ac.buildPalette({ data: new Uint16Array(16), format: 'rgba' }, 2), () => ac.buildPalette(new Uint16Array(16), 2)]) {
            expect(await message(call)).toContain('Uint8Array.from(data, (v) => v >> 8)');
        }
        // other arrays don't get the advice
        expect(await message(() => ac.buildPalette(new Float32Array(16), 2))).not.toContain('>> 8');
    });

    it('describes a function as a function, never printing its source', async () => {
        const secret = () => 'the-source-text';
        for (const call of [() => ac.buildPalette(image, 2, { colorSpace: secret }), () => worker.buildPalette(image, 2, { dither: secret }), () => worker.buildPalette(image, 2, { precision: secret })]) {
            expect(await message(call)).not.toContain('the-source-text');
        }
    });
});
