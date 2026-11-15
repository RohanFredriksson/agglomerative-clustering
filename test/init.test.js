import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createWorker } from '../dist/worker.mjs';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const wasmPath = resolve(dist, 'clustering.wasm');
const bytes = readFileSync(wasmPath);
const image = new Uint8Array(4 * 64);
for (let p = 0; p < 64; p++) {image.set([p * 4, 255 - p * 4, (p * 37) & 255, 255], p * 4);}

// Each import with a different query string is a fresh copy of the module, with its own "loaded" state.
let copies = 0;
const fresh = () => import(/* @vite-ignore */ `${pathToFileURL(resolve(dist, 'index.mjs')).href}?copy=${copies++}`);
const expected = await (await fresh()).getPalette(image, 6);

const asArrayBuffer = () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

describe('init({ wasm })', () => {

    it.each([
        ['a path string', () => wasmPath],
        ['a file URL string', () => pathToFileURL(wasmPath).href],
        ['a URL', () => pathToFileURL(wasmPath)],
        ['an ArrayBuffer', asArrayBuffer],
        ['a Uint8Array view into a larger buffer', () => {
            const padded = new Uint8Array(bytes.length + 16);
            padded.set(bytes, 8);
            return padded.subarray(8, 8 + bytes.length);
        }],
        ['a compiled WebAssembly.Module', () => new WebAssembly.Module(bytes)],
    ])('loads from %s', async (_, make) => {
        const ac = await fresh();
        await ac.init({ wasm: make() });
        expect(await ac.getPalette(image, 6)).toEqual(expected);
    });

    it('reports a wrong location, and a failed init can be retried', async () => {
        const ac = await fresh();
        await expect(ac.init({ wasm: resolve(dist, 'missing.wasm') })).rejects.toThrow();
        await ac.init({ wasm: wasmPath });
        expect(await ac.getPalette(image, 6)).toEqual(expected);
    });

    it('rejects garbage bytes', async () => {
        const ac = await fresh();
        await expect(ac.init({ wasm: new Uint8Array([1, 2, 3, 4]) })).rejects.toThrow();
        expect(await ac.getPalette(image, 6)).toEqual(expected);
    });

    it('shares one load between concurrent calls, and the first load wins', async () => {
        const ac = await fresh();
        const results = await Promise.all([ac.getPalette(image, 6), ac.getPalette(image, 6), ac.init(), ac.init({ wasm: wasmPath })]);
        expect(results[0]).toEqual(expected);
        expect(results[1]).toEqual(expected);
        // Already loaded: a later wasm option is accepted and ignored, even one that would not load.
        await ac.init({ wasm: resolve(dist, 'missing.wasm') });
    });

    it('validates its options, even once loaded', async () => {
        const ac = await fresh();
        await ac.init();
        for (const bad of [null, [], 3, { threads: 2 }]) {
            await expect(ac.init(bad)).rejects.toMatchObject({ code: 'invalid-argument' });
        }
        for (const wasm of [42, {}, null, true]) {
            await expect(ac.init({ wasm })).rejects.toMatchObject({ code: 'invalid-argument' });
        }
    });

});

describe('createWorker({ wasm })', () => {

    it.each([
        ['a path string', () => wasmPath],
        ['a URL', () => pathToFileURL(wasmPath)],
        ['bytes', asArrayBuffer],
        ['a compiled module', () => new WebAssembly.Module(bytes)],
    ])('starts the worker with %s', async (_, make) => {
        const worker = createWorker({ wasm: make() });
        try {
            expect(await worker.getPalette(image, 6)).toEqual(expected);
            const handle = await worker.cluster(image);
            expect(await handle.getPalette(6)).toEqual(expected);
        } finally {
            await worker.terminate();
        }
    });

    it('reports a wrong location on the first call and on later ones, without falling back to the default', async () => {
        const worker = createWorker({ wasm: resolve(dist, 'missing.wasm') });
        try {
            await expect(worker.getPalette(image, 6)).rejects.toThrow();
            await expect(worker.getPalette(image, 6)).rejects.toThrow();
        } finally {
            await worker.terminate();
        }
    });

    it('takes the location from worker.init too', async () => {
        const worker = createWorker();
        try {
            await worker.init({ wasm: asArrayBuffer() });
            expect(await worker.getPalette(image, 6)).toEqual(expected);
            await expect(worker.init({ wasm: 5 })).rejects.toMatchObject({ code: 'invalid-argument' });
        } finally {
            await worker.terminate();
        }
    });

    it('validates wasm when created', () => {
        expect(() => createWorker({ wasm: 5 })).toThrow(expect.objectContaining({ code: 'invalid-argument' }));
    });

});
