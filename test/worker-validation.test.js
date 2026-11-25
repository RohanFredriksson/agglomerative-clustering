import { describe, it, expect, afterAll } from 'vitest';
import * as ac from '../dist/index.mjs';
import * as shared from '../dist/worker.mjs';
import { createWorker } from '../dist/worker.mjs';

// The worker entry checks a call's k, palette and options before it posts anything, with the main entry's own checks, in the
// same order: so for every wrong value the two give the same error, whatever kind of value it is (a function, a Symbol or a
// Proxy cannot be cloned, so a worker that posted first said "cannot be sent" instead), and a call that is refused leaves
// the caller's buffer and an already aborted signal alone.

const pixels = () => ({ data: new Uint8Array(16 * 4).map((_, i) => (i * 37) % 256), format: 'rgba', width: 4, height: 4 });
const image = pixels();

const plain = createWorker();
const moving = createWorker({ transfer: true });
afterAll(async () => { await plain.terminate(); await moving.terminate(); await shared.terminate(); });

const main = await ac.buildClustering(image);
const stored = new Uint8Array(main);
const palette = await ac.buildPalette(image, 3);

const caught = async (call) => {
    try { await call(); } catch (error) { return { name: error.name, message: error.message, code: error.code, argument: error.argument }; }
    return 'resolved';
};

const fn = () => 1;
const proxy = new Proxy(() => 1, {});
const aborted = () => AbortSignal.abort();
const onprogress = { onprogress() {} };

// What each wrong value is put in place of: the options object, one option's value, k, a palette.
const asOptions = [
    ['a function', fn], ['a Symbol', Symbol('o')], ['a Proxy of a function', proxy],
    ['colorSpace a function', { colorSpace: fn }], ['colorSpace a Symbol', { colorSpace: Symbol('c') }],
    ['precision a Proxy', { precision: proxy }], ['alpha a function', { alpha: fn }],
    ['dither a function', { dither: fn }], ['dither a Symbol', { dither: Symbol('d') }], ['dither.method a function', { dither: { method: fn } }],
    ['width a Symbol', { width: Symbol('w') }], ['an unknown option and a function', { bogus: 1, other: fn }],
    ['a near miss', onprogress], ['transparent a function', { transparent: fn }],
];
const asK = [['a function', fn], ['a Symbol', Symbol('k')], ['a Proxy of a function', proxy], ['an object', {}], ['zero', 0]];
const asPalette = [
    ['a function', fn], ['a Symbol', Symbol('p')], ['a Proxy of a function', proxy], ['an array holding a function', [fn, 1, 2]],
    ['an array holding a Symbol', [Symbol('x'), 1, 2]], ['null', null], ['a class', class Palette {}],
];

// Every method that takes the thing, as [label, the main entry's call, the worker's call] over {k, palette, options}.
const functionTargets = (w) => [
    ['buildClustering', (a) => ac.buildClustering(pixels(), a.options), (a) => w.buildClustering(pixels(), a.options), ['options']],
    ['buildPalette', (a) => ac.buildPalette(pixels(), a.k, a.options), (a) => w.buildPalette(pixels(), a.k, a.options), ['k', 'options']],
    ['buildSwatches', (a) => ac.buildSwatches(pixels(), a.k, a.options), (a) => w.buildSwatches(pixels(), a.k, a.options), ['k', 'options']],
    ['quantize', (a) => ac.quantize(pixels(), a.k, a.options), (a) => w.quantize(pixels(), a.k, a.options), ['k', 'options']],
    ['quantizeToIndices', (a) => ac.quantizeToIndices(pixels(), a.k, a.options), (a) => w.quantizeToIndices(pixels(), a.k, a.options), ['k', 'options']],
    ['quantizeWithPalette', (a) => ac.quantizeWithPalette(pixels(), a.palette, a.options), (a) => w.quantizeWithPalette(pixels(), a.palette, a.options), ['palette', 'options']],
    ['quantizeToIndicesWithPalette', (a) => ac.quantizeToIndicesWithPalette(pixels(), a.palette, a.options), (a) => w.quantizeToIndicesWithPalette(pixels(), a.palette, a.options), ['palette', 'options']],
];

// A handle from cluster(): the image is the handle's. The main entry's version is the Clustering method with the same image.
const imageHandleTargets = (h) => [
    ['quantize', (a) => main.quantize(pixels(), a.k, a.options), (a) => h().quantize(a.k, a.options), ['k', 'options']],
    ['quantizeToIndices', (a) => main.quantizeToIndices(pixels(), a.k, a.options), (a) => h().quantizeToIndices(a.k, a.options), ['k', 'options']],
    ['quantizeWithPalette', (a) => ac.quantizeWithPalette(pixels(), a.palette, a.options), (a) => h().quantizeWithPalette(a.palette, a.options), ['palette', 'options']],
    ['quantizeToIndicesWithPalette', (a) => ac.quantizeToIndicesWithPalette(pixels(), a.palette, a.options), (a) => h().quantizeToIndicesWithPalette(a.palette, a.options), ['palette', 'options']],
    ['chooseFrom', (a) => main.chooseFrom(a.palette, a.k, a.options), (a) => h().chooseFrom(a.palette, a.k, a.options), ['palette', 'k', 'options']],
    ['getPalette', (a) => main.getPalette(a.k), (a) => h().getPalette(a.k), ['k']],
    ['getSwatches', (a) => main.getSwatches(a.k), (a) => h().getSwatches(a.k), ['k']],
];
// A handle from load(): each call gets its image.
const loadedHandleTargets = (h) => [
    ['quantize', (a) => main.quantize(pixels(), a.k, a.options), (a) => h().quantize(pixels(), a.k, a.options), ['k', 'options']],
    ['quantizeToIndices', (a) => main.quantizeToIndices(pixels(), a.k, a.options), (a) => h().quantizeToIndices(pixels(), a.k, a.options), ['k', 'options']],
    ['chooseFrom', (a) => main.chooseFrom(a.palette, a.k, a.options), (a) => h().chooseFrom(a.palette, a.k, a.options), ['palette', 'k', 'options']],
    ['getPalette', (a) => main.getPalette(a.k), (a) => h().getPalette(a.k), ['k']],
    ['getSwatches', (a) => main.getSwatches(a.k), (a) => h().getSwatches(a.k), ['k']],
];

const defaults = { k: 2, palette: new Uint8Array(palette), options: undefined };

const surfaces = [
    ['the shared worker', () => functionTargets(shared)],
    ['createWorker()', () => functionTargets(plain)],
    ['createWorker({ transfer: true })', () => functionTargets(moving)],
];

describe('the worker entry reports a wrong argument as the main entry does', () => {
    const handles = {};
    const loaded = {};
    afterAll(async () => { for (const h of [...Object.values(handles), ...Object.values(loaded)]) { await h.release(); } });

    const all = [
        ...surfaces.map(([name, targets]) => [name, targets]),
        ['a cluster() handle', () => imageHandleTargets(() => handles.plain)],
        ['a cluster() handle (transfer)', () => imageHandleTargets(() => handles.moving)],
        ['a load() handle', () => loadedHandleTargets(() => loaded.plain)],
        ['a load() handle (transfer)', () => loadedHandleTargets(() => loaded.moving)],
    ];

    it('has handles to test', async () => {
        handles.plain = await plain.cluster(pixels());
        handles.moving = await moving.cluster(pixels());
        loaded.plain = await plain.load(new Uint8Array(stored));
        loaded.moving = await moving.load(new Uint8Array(stored));
    });

    for (const [surface, targets] of all) {
        describe(surface, () => {
            for (const [role, values] of [['options', asOptions], ['k', asK], ['palette', asPalette]]) {
                it(`gives the main entry's error for a wrong ${role}`, async () => {
                    const failures = [];
                    for (const [label, mainCall, workerCall, takes] of targets()) {
                        if (!takes.includes(role)) { continue; }
                        for (const [what, value] of values) {
                            const args = { ...defaults, [role]: value };
                            const expected = await caught(() => mainCall(args));
                            const got = await caught(() => workerCall(args));
                            if (expected === 'resolved') { continue; }
                            try { expect(got, `${label}, ${role} ${what}`).toEqual(expected); } catch (error) { failures.push(error.message); }
                        }
                    }
                    expect(failures).toEqual([]);
                });
            }

            it('reports a wrong option before an aborted signal', async () => {
                const failures = [];
                for (const [label, mainCall, workerCall, takes] of targets()) {
                    if (!takes.includes('options')) { continue; }
                    for (const options of [{ signal: aborted(), colorSpace: 'x' }, { signal: aborted(), bogus: 1 }, { signal: aborted(), dither: fn }]) {
                        const expected = await caught(() => mainCall({ ...defaults, options }));
                        const got = await caught(() => workerCall({ ...defaults, options }));
                        try {
                            expect(expected).toMatchObject({ code: 'invalid-argument' });
                            expect(got, label).toEqual(expected);
                        } catch (error) { failures.push(error.message); }
                    }
                }
                expect(failures).toEqual([]);
            });

            it('reports a wrong palette or k before an aborted signal', async () => {
                const failures = [];
                for (const [label, mainCall, workerCall, takes] of targets()) {
                    for (const role of ['k', 'palette']) {
                        if (!takes.includes(role)) { continue; }
                        const args = { ...defaults, [role]: role === 'k' ? 'two' : null, options: { signal: aborted() } };
                        const expected = await caught(() => mainCall(args));
                        const got = await caught(() => workerCall(args));
                        try {
                            expect(expected).toMatchObject({ code: 'invalid-argument', argument: role });
                            expect(got, `${label} ${role}`).toEqual(expected);
                        } catch (error) { failures.push(error.message); }
                    }
                }
                expect(failures).toEqual([]);
            });
        });
    }
});

describe('a cold worker (its first call, made before it has started)', () => {
    it.each(asOptions.slice(0, 5))('gives the main entry\'s error for options: %s', async (_, value) => {
        const cold = createWorker();
        try {
            const expected = await caught(() => ac.buildPalette(pixels(), 2, value));
            expect(await caught(() => cold.buildPalette(pixels(), 2, value))).toEqual(expected);
            expect((await caught(() => createWorker().cluster(pixels(), value)))).toEqual(await caught(() => ac.buildClustering(pixels(), value)));
        } finally { await cold.terminate(); }
    });
});

describe('createWorker({ transfer: true })', () => {
    it('keeps the caller\'s buffer when the call is refused', async () => {
        const mover = createWorker({ transfer: true });
        try {
            const tries = [
                (image) => mover.buildPalette(image, 0),
                (image) => mover.buildPalette(image, 2, { colorSpace: fn }),
                (image) => mover.quantize(image, 2, { bogus: 1 }),
                (image) => mover.quantizeWithPalette(image, null),
                (image) => mover.cluster(image, { colorSpace: 'x' }),
                (image) => mover.quantizeToIndices(image, Symbol('k')),
            ];
            // before the worker has started, and after it has
            for (const round of [0, 1]) {
                for (const attempt of tries) {
                    const sent = pixels();
                    const length = sent.data.length;
                    await expect(attempt(sent)).rejects.toMatchObject({ code: 'invalid-argument' });
                    expect(sent.data.length, `round ${round}`).toBe(length);
                }
                await mover.init();
            }
            const handle = await mover.load(new Uint8Array(stored));
            const sent = pixels();
            await expect(handle.quantize(sent, 0)).rejects.toMatchObject({ code: 'invalid-argument', argument: 'k' });
            await expect(handle.quantize(sent, 2, { colorSpace: fn })).rejects.toMatchObject({ code: 'invalid-argument', argument: 'options.colorSpace' });
            expect(sent.data.length).toBe(64);
            await handle.release();
            // a good call still moves the buffer
            const good = pixels();
            await mover.buildPalette(good, 2);
            expect(good.data.length).toBe(0);
        } finally { await mover.terminate(); }
    });
});

describe('a width option that is not a number', () => {
    // Found by the beta.3 round: with an image that has its own width, a Symbol as options.width was put into the message
    // text, which throws a TypeError (no code) for a Symbol.
    it.each([['a Symbol', Symbol('w')], ['a function', () => 2], ['a string', '2']])('is a coded error, in the main entry and the worker: %s', async (_, width) => {
        const withWidth = () => ({ data: new Uint8Array(16).map((_, i) => (i * 37) % 256), format: 'rgba', width: 2, height: 2 });
        const calls = [
            (api) => api.quantize(withWidth(), 2, { width }),
            (api) => api.quantizeToIndices(withWidth(), 2, { width }),
            (api) => api.quantizeWithPalette(withWidth(), palette, { width }),
            (api) => api.quantizeToIndicesWithPalette(withWidth(), palette, { width }),
            (api) => api.buildPalette(withWidth(), 2, { width }),
        ];
        for (const call of calls) {
            const expected = await caught(() => call(ac));
            expect(expected).toMatchObject({ name: 'Error', code: 'invalid-argument', argument: 'options.width' });
            expect(await caught(() => call(plain))).toEqual(expected);
        }
        const viaMethod = await caught(() => main.quantize(withWidth(), 2, { width }));
        expect(viaMethod).toMatchObject({ code: 'invalid-argument', argument: 'options.width' });
    });
});
