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
        expect(Object.getOwnPropertySymbols(Object.getOwnPropertyDescriptors(palette)).length).toBe(1);
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
