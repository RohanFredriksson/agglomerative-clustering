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
const expected = await (await fresh()).buildPalette(image, 6);

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
        expect(await ac.buildPalette(image, 6)).toEqual(expected);
    });

    it('reports a wrong location, and a failed init can be retried', async () => {
        const ac = await fresh();
        await expect(ac.init({ wasm: resolve(dist, 'missing.wasm') })).rejects.toMatchObject({ code: 'wasm-load-failed' });
        await ac.init({ wasm: wasmPath });
        expect(await ac.buildPalette(image, 6)).toEqual(expected);
    });

    it('rejects garbage bytes', async () => {
        const ac = await fresh();
        const error = await ac.init({ wasm: new Uint8Array([1, 2, 3, 4]) }).catch((e) => e);
        expect(error.code).toBe('wasm-load-failed');
        expect(error.message).toContain('expected magic word');  // leads with what went wrong (the engine's reason)
        expect(error.message).not.toContain('SIMD');             // and doesn't blame SIMD, which this engine has
        expect(error.message).toContain('init({ wasm })');
        expect(error.cause).toBeInstanceOf(Error);               // the engine's own error is kept
        expect(await ac.buildPalette(image, 6)).toEqual(expected);
    });

    it('says when the bytes are gzipped, and how to decompress them, in both entries', async () => {
        const { gzipSync } = await import('zlib');
        const gz = gzipSync(bytes);
        for (const wasm of [new Uint8Array(gz), gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength)]) {
            const ac = await fresh();
            const error = await ac.init({ wasm }).catch((e) => e);
            expect(error.code).toBe('wasm-load-failed');
            expect(error.message).toContain('are gzipped');
            expect(error.message).toContain('DecompressionStream');
            // Decompressed as the message says, the same bytes load.
            const unzipped = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
            await ac.init({ wasm: unzipped });
            expect(await ac.buildPalette(image, 6)).toEqual(expected);
        }
        const worker = createWorker({ wasm: new Uint8Array(gz) });
        try {
            await expect(worker.buildPalette(image, 6)).rejects.toMatchObject({ code: 'wasm-load-failed', message: expect.stringContaining('are gzipped') });
        } finally {
            await worker.terminate();
        }
    });

    // Found by the fourth round (3.0.0-beta.4): a 404 page served as the .wasm read as a bare compile error.
    it('says when the file at a location is not WebAssembly (an error page in its place), and names it', async () => {
        const { mkdtempSync, writeFileSync, rmSync } = await import('fs');
        const { tmpdir } = await import('os');
        const folder = mkdtempSync(resolve(tmpdir(), 'ac-page-'));
        try {
            const page = resolve(folder, 'clustering.wasm');
            writeFileSync(page, '<!doctype html><title>404 Not Found</title>');
            for (const worker of [false, true]) {
                const target = worker ? createWorker() : await fresh();
                const error = await target.init({ wasm: page }).catch((e) => e);
                if (worker) {await target.terminate();}
                expect(error.code).toBe('wasm-load-failed');
                expect(error.message).toContain('is not WebAssembly');
                expect(error.message).toContain('error page');
                expect(error.message).toContain(page);
            }
        } finally {
            rmSync(folder, { recursive: true, force: true });
        }
    });

    // A valid module that isn't this library's once threw inside the glue, where nothing caught it: the load never settled
    // and Node reported an unhandled rejection.
    it.each([
        ['bytes', () => new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])],
        ['a compiled module', () => new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))],
    ])('rejects a valid module that is not this library\'s, given as %s', async (_, make) => {
        const ac = await fresh();
        const error = await ac.init({ wasm: make() }).catch((e) => e);
        expect(error).toMatchObject({ code: 'wasm-load-failed' });
        await ac.init({ wasm: bytes });
        expect(await ac.buildPalette(image, 6)).toEqual(expected);
    });

    // Next.js Edge's `import wasm from '….wasm?module'` gives a module made by another realm's WebAssembly.Module.
    it('accepts a WebAssembly.Module from another realm', async () => {
        const { runInNewContext } = await import('vm');
        const foreign = runInNewContext('new WebAssembly.Module(bytes)', { bytes });
        expect(foreign instanceof WebAssembly.Module).toBe(false);
        const ac = await fresh();
        await ac.init({ wasm: foreign });
        expect(await ac.buildPalette(image, 6)).toEqual(expected);
    });

    it('shares one load between concurrent calls, and the first load wins', async () => {
        const ac = await fresh();
        const results = await Promise.all([ac.buildPalette(image, 6), ac.buildPalette(image, 6), ac.init(), ac.init({ wasm: wasmPath })]);
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
            expect(await worker.buildPalette(image, 6)).toEqual(expected);
            const handle = await worker.cluster(image);
            expect(await handle.getPalette(6)).toEqual(expected);
        } finally {
            await worker.terminate();
        }
    });

    it('reports a wrong location on the first call and on later ones, without falling back to the default', async () => {
        const worker = createWorker({ wasm: resolve(dist, 'missing.wasm') });
        try {
            await expect(worker.buildPalette(image, 6)).rejects.toMatchObject({ code: 'wasm-load-failed' });
            await expect(worker.buildPalette(image, 6)).rejects.toMatchObject({ code: 'wasm-load-failed' });
        } finally {
            await worker.terminate();
        }
    });

    it('takes the location from worker.init too', async () => {
        const worker = createWorker();
        try {
            await worker.init({ wasm: asArrayBuffer() });
            expect(await worker.buildPalette(image, 6)).toEqual(expected);
            await expect(worker.init({ wasm: 5 })).rejects.toMatchObject({ code: 'invalid-argument' });
        } finally {
            await worker.terminate();
        }
    });

    it('validates wasm when created', () => {
        expect(() => createWorker({ wasm: 5 })).toThrow(expect.objectContaining({ code: 'invalid-argument' }));
    });

});
