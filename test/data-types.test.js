import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import * as ac from '../dist/index.mjs';
import * as workerEntry from '../dist/worker.mjs';

const { Palette, Clustering } = ac;
const require = createRequire(import.meta.url);

// A smooth image, so RGB and OKLab matching give different results (the tests that follow tell the spaces apart).
const w = 64, h = 48, photo = new Uint8Array(w * h * 4);
let seed = 7; const rnd = () => {seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296;};
for (let p = 0; p < w * h; p++) {const x = p % w, y = Math.floor(p / w); photo.set([x * 3 + rnd() * 8, y * 4 + rnd() * 8, 128 + 100 * Math.sin(x / 9 + y / 13) + rnd() * 8, 255], p * 4);}

describe('Palette', () => {

    it('is an ordinary Uint8Array with a hidden colour space, so tests and tools see plain bytes', async () => {
        const palette = await ac.getPalette(photo, 6, { colorSpace: 'oklab' });
        expect(palette).toBeInstanceOf(Palette);
        expect(palette).toBeInstanceOf(Uint8Array);
        expect(palette.constructor).toBe(Uint8Array);
        expect(palette.colorSpace).toBe('oklab');
        expect(palette.length).toBe(18);
        // Nothing but the bytes is visible: `toEqual` against plain bytes works, and the tags are not enumerable
        expect(palette).toEqual(new Uint8Array(palette));
        expect(Object.keys(palette)).toEqual(Array.from({ length: 18 }, (_, i) => String(i)));
        // two hidden symbols: what it is, and how console.log shows it; neither is enumerable
        const symbols = Object.getOwnPropertySymbols(palette);
        expect(symbols.map(String).sort()).toEqual(['Symbol(agglomerative-clustering.palette)', 'Symbol(nodejs.util.inspect.custom)']);
        expect(symbols.every((symbol) => !Object.getOwnPropertyDescriptor(palette, symbol).enumerable)).toBe(true);
        expect(Object.getOwnPropertyDescriptor(palette, 'colorSpace').enumerable).toBe(false);
        expect(Buffer.from(palette).length).toBe(18);
    });

    it('is plain again after slice, subarray and a structured clone, which also means RGB when mapped', async () => {
        const palette = await ac.getPalette(photo, 6, { colorSpace: 'oklab' });
        for (const copy of [palette.slice(), palette.subarray(0), structuredClone(palette), new Uint8Array(palette)]) {
            expect(copy).not.toBeInstanceOf(Palette);
            expect(copy.colorSpace).toBeUndefined();
        }
    });

    it('takes its colour space from where it was made, in every function that returns a palette', async () => {
        for (const colorSpace of ['rgb', 'oklab']) {
            const clustering = await ac.getClustering(photo, { colorSpace });
            expect((await ac.getPalette(photo, 5, { colorSpace })).colorSpace).toBe(colorSpace);
            expect((await ac.getPaletteFromClustering(clustering, 5)).colorSpace).toBe(colorSpace);
            expect((await ac.getSwatches(photo, 5, { colorSpace })).palette.colorSpace).toBe(colorSpace);
            expect((await ac.getSwatchesFromClustering(clustering, 5)).palette.colorSpace).toBe(colorSpace);
            expect((await ac.quantizeToIndices(photo, 5, { colorSpace })).palette.colorSpace).toBe(colorSpace);
            expect((await ac.quantizeToIndicesFromClustering(photo, clustering, 5)).palette.colorSpace).toBe(colorSpace);
            // the palette of an indexed result was made in the clustering's space, whatever space it was matched in
            const other = colorSpace === 'rgb' ? 'oklab' : 'rgb';
            expect((await ac.quantizeToIndicesFromClustering(photo, clustering, 5, { colorSpace: other })).palette.colorSpace).toBe(colorSpace);
        }
        expect((await ac.getPalette(photo, 5)).colorSpace).toBe('rgb');
    });

    it('maps in its own space where 2.x mapped in RGB: the one deliberate difference from 2.0', async () => {
        // In 2.x getPalette returned plain bytes, so quantizeWithPalette(image, oklabPalette) matched in RGB. A 3.0 Palette knows its
        // space and matches in it; `colorSpace: 'rgb'` (or plain bytes) gives the 2.x result. docs/migrating.md says so.
        const oklab = await ac.getPalette(photo, 12, { colorSpace: 'oklab' });
        const twoDotX = await ac.quantizeWithPalette(photo, new Uint8Array(oklab));
        expect(await ac.quantizeWithPalette(photo, oklab, { colorSpace: 'rgb' })).toEqual(twoDotX);
        expect(await ac.quantizeWithPalette(photo, oklab)).not.toEqual(twoDotX);
        // an RGB palette, the default, is unchanged from 2.x either way
        const rgb = await ac.getPalette(photo, 12);
        expect(await ac.quantizeWithPalette(photo, rgb)).toEqual(await ac.quantizeWithPalette(photo, new Uint8Array(rgb)));
    });

    it('is mapped in its own colour space unless one is named', async () => {
        const oklab = await ac.getPalette(photo, 12, { colorSpace: 'oklab' });
        const inOklab = await ac.quantizeWithPalette(photo, new Uint8Array(oklab), { colorSpace: 'oklab' });
        const inRgb = await ac.quantizeWithPalette(photo, new Uint8Array(oklab), { colorSpace: 'rgb' });
        expect(inOklab).not.toEqual(inRgb);                                        // the image can tell the spaces apart
        expect(await ac.quantizeWithPalette(photo, oklab)).toEqual(inOklab);        // its own space
        expect(await ac.quantizeWithPalette(photo, oklab, { colorSpace: 'rgb' })).toEqual(inRgb);   // naming one wins
        expect(await ac.quantizeWithPalette(photo, new Uint8Array(oklab))).toEqual(inRgb);          // plain bytes: RGB
        expect((await ac.quantizeToIndicesWithPalette(photo, oklab)).indices).toEqual((await ac.quantizeToIndicesWithPalette(photo, new Uint8Array(oklab), { colorSpace: 'oklab' })).indices);
        // and it is what quantizeFromClustering does by default, so the two ways of mapping agree
        const clustering = await ac.getClustering(photo, { colorSpace: 'oklab' });
        expect(await ac.quantizeWithPalette(photo, await ac.getPaletteFromClustering(clustering, 12))).toEqual(await ac.quantizeFromClustering(photo, clustering, 12));
        // an indexed result keeps its palette's space
        expect((await ac.quantizeToIndicesWithPalette(photo, oklab)).palette.colorSpace).toBe('oklab');
    });

    it('can be made by hand and checks the space it is given', () => {
        const made = new Palette(new Uint8Array([1, 2, 3, 4, 5, 6]), 'oklab');
        expect(made).toBeInstanceOf(Palette);
        expect(made.colorSpace).toBe('oklab');
        expect(Array.from(made)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(new Palette([9, 8, 7]).colorSpace).toBe('rgb');
        expect(new Palette(6).length).toBe(6);
        expect(() => new Palette(new Uint8Array(3), 'lab')).toThrow(/Invalid colorSpace/);
        // it copies: changing the source afterwards does not change it
        const source = new Uint8Array([1, 2, 3]); const copy = new Palette(source); source[0] = 99;
        expect(copy[0]).toBe(1);
    });

});

describe('Clustering', () => {

    it('is what getClustering returns: a Uint8Array with a hidden tag', async () => {
        const clustering = await ac.getClustering(photo);
        expect(clustering).toBeInstanceOf(Clustering);
        expect(clustering).toBeInstanceOf(Uint8Array);
        expect(clustering.constructor).toBe(Uint8Array);
        expect(clustering).toEqual(new Uint8Array(clustering));
        expect(new Uint8Array(clustering)).not.toBeInstanceOf(Clustering);
        expect(await ac.getClustering(photo, { onProgress: () => {} })).toBeInstanceOf(Clustering);
    });

    it('gets its type back from stored bytes, and is checked when it does', async () => {
        const clustering = await ac.getClustering(photo);
        const stored = structuredClone(clustering);                        // what IndexedDB or postMessage gives back
        expect(stored).not.toBeInstanceOf(Clustering);
        const typed = new Clustering(stored);
        expect(typed).toBeInstanceOf(Clustering);
        expect(typed).toEqual(clustering);
        expect(await ac.getPaletteFromClustering(typed, 6)).toEqual(await ac.getPaletteFromClustering(clustering, 6));
        // plain bytes are still accepted by the functions, so stored clusterings keep working in JavaScript
        expect(await ac.getPaletteFromClustering(stored, 6)).toEqual(await ac.getPaletteFromClustering(clustering, 6));
        for (const bad of [new Uint8Array(5), new Uint8Array(0), new Uint8Array(clustering.subarray(0, 8)).fill(0)]) {
            expect(() => new Clustering(bad)).toThrow(expect.objectContaining({ code: 'invalid-clustering' }));
        }
        // like any typed array it can view a buffer instead of copying it
        const view = new Clustering(stored.buffer, stored.byteOffset, stored.length);
        stored[stored.length - 1] ^= 0;
        expect(view.buffer).toBe(stored.buffer);
    });

    it('refuses what is not bytes with a coded error, instead of coercing it or allocating', async () => {
        for (const bad of [-3, 2 ** 40, 1.5, 7, NaN, Symbol('x'), 10n, {}, 'str', null, undefined, new Map(), () => 1, new Float32Array(30), [300, 0], ['a'], [1.5], new DataView(new ArrayBuffer(8))]) {
            for (const make of [Clustering, workerEntry.Clustering]) {
                expect(() => make(bad), String(typeof bad === 'symbol' ? 'symbol' : bad)).toThrow(expect.objectContaining({ code: 'invalid-clustering' }));
            }
        }
        const stored = new Uint8Array(await ac.getClustering(photo));
        for (const bad of [[stored.buffer, -1, 4], [stored.buffer, 3, 2 ** 40], [stored.buffer, stored.length + 5]]) {
            expect(() => new Clustering(...bad)).toThrow(expect.objectContaining({ code: 'invalid-clustering' }));
        }
        expect(new Clustering(Array.from(stored))).toEqual(new Uint8Array(stored));          // a plain array of bytes is fine
        expect(new Clustering(stored.buffer.slice(0), 0, stored.length)).toEqual(new Uint8Array(stored));
    });

    it('is not accepted as a palette, and a palette is not accepted as a clustering, with no guessing', async () => {
        const clustering = await ac.getClustering(photo);
        const palette = await ac.getPalette(photo, 4);
        for (const call of [(c) => ac.quantizeWithPalette(photo, c), (c) => ac.quantizeToIndicesWithPalette(photo, c)]) {
            const error = await call(clustering).catch((e) => e);
            expect(error.code).toBe('invalid-argument');
            expect(error.message).toContain('this is a clustering');
        }
        for (const call of [(p) => ac.getPaletteFromClustering(p, 2), (p) => ac.getSwatchesFromClustering(p, 2), (p) => ac.getClusteringInfo(p), (p) => ac.quantizeFromClustering(photo, p, 2), (p) => ac.quantizeToIndicesFromClustering(photo, p, 2)]) {
            const error = await call(palette).catch((e) => e);
            expect(error.code).toBe('invalid-clustering');
            expect(error.message).toContain('this is a palette');
        }
    });

});

describe('across entries and copies of the library', () => {

    it('are recognised by the CommonJS build and the worker entry, which are separate copies', async () => {
        const cjs = require('../dist/index.cjs');
        const palette = await ac.getPalette(photo, 5, { colorSpace: 'oklab' });
        const clustering = await ac.getClustering(photo);
        expect(palette).toBeInstanceOf(cjs.Palette);
        expect(palette).toBeInstanceOf(workerEntry.Palette);
        expect(clustering).toBeInstanceOf(cjs.Clustering);
        expect(await cjs.getPalette(photo, 5, { colorSpace: 'oklab' })).toBeInstanceOf(Palette);
        // and they keep their meaning: the other copy maps in the palette's own space, and rejects a clustering as a palette
        expect(await cjs.quantizeWithPalette(photo, palette)).toEqual(await ac.quantizeWithPalette(photo, palette));
        expect(await cjs.quantizeWithPalette(photo, clustering).catch((e) => e.code)).toBe('invalid-argument');
    });

    it('survive a round trip through a worker: results arrive typed and a palette argument keeps its space', async () => {
        const worker = workerEntry.createWorker();
        try {
            const palette = await worker.getPalette(photo, 12, { colorSpace: 'oklab' });
            expect(palette).toBeInstanceOf(Palette);
            expect(palette.colorSpace).toBe('oklab');
            expect(palette).toEqual(await ac.getPalette(photo, 12, { colorSpace: 'oklab' }));
            const clustering = await worker.getClustering(photo, { colorSpace: 'oklab' });
            expect(clustering).toBeInstanceOf(Clustering);
            const swatches = await worker.getSwatchesFromClustering(clustering, 12);
            expect(swatches.palette).toBeInstanceOf(Palette);
            expect(swatches.palette.colorSpace).toBe('oklab');
            const indexed = await worker.quantizeToIndices(photo, 12, { colorSpace: 'oklab' });
            expect(indexed.palette.colorSpace).toBe('oklab');
            // the palette argument crosses with its colour space
            expect(await worker.quantizeWithPalette(photo, palette)).toEqual(await ac.quantizeWithPalette(photo, palette));
            expect(await worker.quantizeWithPalette(photo, new Uint8Array(palette))).toEqual(await ac.quantizeWithPalette(photo, new Uint8Array(palette)));
            // and a clustering is rejected as a palette on the other side too
            expect(await worker.quantizeWithPalette(photo, clustering).catch((e) => e.code)).toBe('invalid-argument');
            // handles
            const handle = await worker.cluster(photo, { colorSpace: 'oklab' });
            expect(await handle.getClustering()).toBeInstanceOf(Clustering);
            expect((await handle.getPalette(12)).colorSpace).toBe('oklab');
            expect((await handle.getSwatches(12)).palette.colorSpace).toBe('oklab');
            expect(await handle.quantizeWithPalette(palette)).toEqual(await ac.quantizeWithPalette(photo, palette));
            expect((await handle.quantizeToIndicesWithPalette(palette)).palette.colorSpace).toBe('oklab');
            await handle.release();
        } finally {
            await worker.terminate();
        }
    });

});

describe('Palette sources are checked like any palette', () => {

    it('refuses what would be coerced into a byte, and what is not whole colours', () => {
        for (const bad of [[300, 0, 0], [-1, 0, 0], [1.5, 2, 3], ['a', 'b', 'c'], [[1, 2, 3]], [1, 2], 4, -3, 1.5, NaN, 'abc', null, {}, new Float32Array(3), new Int16Array(3), new Uint8Array(4), new ArrayBuffer(3)]) {
            expect(() => new Palette(bad), String(bad)).toThrow(expect.objectContaining({ code: 'invalid-argument' }));
            expect(() => new workerEntry.Palette(bad), 'worker entry: ' + String(bad)).toThrow(expect.objectContaining({ code: 'invalid-argument' }));
        }
    });

    it('takes bytes, clamped bytes, byte arrays and whole-colour lengths, in both entries', () => {
        for (const make of [Palette, workerEntry.Palette]) {
            expect(Array.from(make(new Uint8Array([1, 2, 3])))).toEqual([1, 2, 3]);
            expect(Array.from(make(new Uint8ClampedArray([1, 2, 3, 4, 5, 6]), 'oklab'))).toEqual([1, 2, 3, 4, 5, 6]);
            expect(Array.from(new make([255, 0, 7]))).toEqual([255, 0, 7]);
            expect(new make(9).length).toBe(9);
            expect(new make().length).toBe(0);
            expect(new make([]).length).toBe(0);
        }
    });

    it('does not take a clustering', async () => {
        await expect(async () => new Palette(await ac.getClustering(photo))).rejects.toMatchObject({ code: 'invalid-argument' });
    });
});

describe('colors of an indexed result', () => {
    const sprite = new Uint8Array(400 * 4);
    for (let i = 0; i < 400; i++) {sprite.set([(i * 7) & 255, (i * 13) & 255, (i * 29) & 255, i % 4 === 0 ? 0 : 255], i * 4);}

    it('is the palette without the transparent entry, and maps again to the same result', async () => {
        const indexed = await ac.quantizeToIndices(sprite, 8, { transparent: true });
        expect(indexed.transparentIndex).toBe(7);
        expect(indexed.palette.length).toBe(24);
        expect(indexed.colors.length).toBe(21);
        expect(indexed.colors).toBeInstanceOf(Palette);
        expect(indexed.colors).toEqual(indexed.palette.slice(0, 21));
        // the whole point: it can be given back, where `palette` would add the transparent entry twice
        const again = await ac.quantizeToIndicesWithPalette(sprite, indexed.colors, { transparent: true });
        expect(again.palette).toEqual(indexed.palette);
        expect(again.indices).toEqual(indexed.indices);
        expect((await ac.quantizeToIndicesWithPalette(sprite, indexed.palette, { transparent: true })).palette.length).toBe(27);   // the trap
    });

    it('is the palette itself when there is no transparent entry, and keeps its colour space', async () => {
        const opaque = await ac.quantizeToIndices(photo, 8, { colorSpace: 'oklab' });
        expect(opaque.transparentIndex).toBeNull();
        expect(opaque.colors).toEqual(opaque.palette);
        expect(opaque.colors.colorSpace).toBe('oklab');
        const clustering = await ac.getClustering(sprite, { transparent: true, colorSpace: 'oklab' });
        expect((await ac.quantizeToIndicesFromClustering(sprite, clustering, 8)).colors.colorSpace).toBe('oklab');
        expect((await ac.quantizeToIndicesWithPalette(sprite, opaque.colors)).colors.colorSpace).toBe('oklab');
    });

    it('crosses the worker boundary typed', async () => {
        const worker = workerEntry.createWorker();
        try {
            const indexed = await worker.quantizeToIndices(sprite, 8, { transparent: true, colorSpace: 'oklab' });
            expect(indexed.colors).toBeInstanceOf(Palette);
            expect(indexed.colors.colorSpace).toBe('oklab');
            expect(indexed.colors).toEqual((await ac.quantizeToIndices(sprite, 8, { transparent: true, colorSpace: 'oklab' })).colors);
            const handle = await worker.cluster(sprite, { transparent: true });
            expect((await handle.quantizeToIndices(8)).colors.length).toBe(21);
            await handle.release();
        } finally {
            await worker.terminate();
        }
    });
});

describe('the transparent cutoff a clustering was made with', () => {
    const sprite = new Uint8Array(400 * 4);
    for (let i = 0; i < 400; i++) {sprite.set([(i * 7) & 255, (i * 13) & 255, (i * 29) & 255, [0, 90, 150, 255][i % 4]], i * 4);}

    it('is recorded, and reported by getClusteringInfo', async () => {
        expect((await ac.getClusteringInfo(await ac.getClustering(sprite))).transparent).toBe(false);
        expect((await ac.getClusteringInfo(await ac.getClustering(sprite, { transparent: true }))).transparent).toBe(128);
        expect((await ac.getClusteringInfo(await ac.getClustering(sprite, { transparent: 200 }))).transparent).toBe(200);
        expect((await ac.getClusteringInfo(await ac.getClustering(sprite, { transparent: false }))).transparent).toBe(false);
        // an RGB image has no alpha for a cutoff to apply to, so none is recorded
        expect((await ac.getClusteringInfo(await ac.getClustering({ data: new Uint8Array(30), format: 'rgb' }, { transparent: true }))).transparent).toBe(false);
        // clusterings from 2.x had no such option (nor weights, so getClusteringInfo rejects them; mapping reads them as none)
        await expect(ac.getClusteringInfo(new Uint8Array([0xAC, 2, 0, 8]))).rejects.toMatchObject({ code: 'unsupported-version' });
    });

    it('is the default cutoff when mapping to indices, so clustering and mapping agree', async () => {
        for (const cutoff of [true, 128, 200]) {
            const clustering = await ac.getClustering(sprite, { transparent: cutoff });
            const viaClustering = await ac.quantizeToIndicesFromClustering(sprite, clustering, 8);
            expect(viaClustering).toEqual(await ac.quantizeToIndicesFromClustering(sprite, clustering, 8, { transparent: cutoff }));
            expect(viaClustering).toEqual(await ac.quantizeToIndices(sprite, 8, { transparent: cutoff }));
        }
        const clustering = await ac.getClustering(sprite, { transparent: 200 });
        const defaulted = await ac.quantizeToIndicesFromClustering(sprite, clustering, 8);
        // a cutoff named at mapping wins over the recorded one, and false turns it off
        expect((await ac.quantizeToIndicesFromClustering(sprite, clustering, 8, { transparent: 100 })).indices.filter((i) => i === 7).length)
            .toBeLessThan(defaulted.indices.filter((i) => i === 7).length);
        expect((await ac.quantizeToIndicesFromClustering(sprite, clustering, 8, { transparent: false })).transparentIndex).toBeNull();
        // a clustering made without a cutoff keeps today's behaviour: no transparent entry unless asked for
        expect((await ac.quantizeToIndicesFromClustering(sprite, await ac.getClustering(sprite), 8)).transparentIndex).toBeNull();
    });

    it('is carried through a worker handle', async () => {
        const worker = workerEntry.createWorker();
        try {
            const handle = await worker.cluster(sprite, { transparent: 200 });
            expect(await handle.quantizeToIndices(8)).toEqual(await ac.quantizeToIndices(sprite, 8, { transparent: 200 }));
            expect((await handle.getClusteringInfo()).transparent).toBe(200);
            await handle.release();
        } finally {
            await worker.terminate();
        }
    });
});

describe('one implementation behind both entries', () => {
    it('is the same Palette and Clustering, so the entries cannot drift apart', () => {
        expect(workerEntry.Palette).toBe(Palette);
        expect(workerEntry.Clustering).toBe(Clustering);
        expect(workerEntry.version).toBe(ac.version);
    });

    it('shows the tag when logged in Node', async () => {
        const { inspect } = await import('util');
        expect(inspect(await ac.getPalette(photo, 2, { colorSpace: 'oklab' }))).toMatch(/^Palette\(oklab\) Uint8Array\(6\) \[/);
        expect(inspect(await ac.getClustering(photo))).toMatch(/^Clustering Uint8Array\(\d+\) \[/);
        expect(inspect(new Uint8Array(3))).toBe('Uint8Array(3) [ 0, 0, 0 ]');      // plain bytes are untouched
    });

    it('recognises typed arrays from another realm', async () => {
        const vm = await import('vm');
        const foreign = vm.runInNewContext('new Uint8Array(64).map((_, i) => (i * 37) & 255)');
        expect(foreign instanceof Uint8Array).toBe(false);                         // the reason instanceof was not enough
        expect((await ac.getPalette(foreign, 3)).length).toBeGreaterThan(0);
        const palette = vm.runInNewContext('new Uint8Array([10, 20, 30, 200, 100, 50])');
        expect((await ac.quantizeWithPalette(foreign, palette)).length).toBe(64);
        const clustering = vm.runInNewContext('(bytes) => new Uint8Array(bytes)')(await ac.getClustering(foreign));
        expect((await ac.getClusteringInfo(clustering)).maxColors).toBeGreaterThan(0);
    });
});
