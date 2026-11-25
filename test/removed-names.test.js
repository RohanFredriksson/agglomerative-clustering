// 4.0 removed the names 3.4 and 3.8 deprecated, in both entries: the get… functions that cluster an image, and the
// …FromClustering functions (docs/migrating.md has the 4.0 form of each). What stays: the methods on a clustering and on
// worker handles, which keep the get… names, and the internals the methods run through.
import { describe, it, expect, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as main from '../dist/index.mjs';
import * as workerEntry from '../dist/worker.mjs';
import { timeLimit } from './timeout.js';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const removed = ['getClustering', 'getPalette', 'getSwatches', 'getPaletteFromClustering', 'getSwatchesFromClustering', 'getClusteringInfo', 'quantizeFromClustering', 'quantizeToIndicesFromClustering'];
const image = new Uint8Array(4 * 64).map((_, i) => (i * 37 + 11) & 255);

afterAll(() => workerEntry.terminate());

describe('the removed names', () => {

    it('are not exported by either entry, in either module system', () => {
        const entries = { main, workerEntry, 'index.cjs': require('../dist/index.cjs'), 'worker.cjs': require('../dist/worker.cjs') };
        for (const [label, entry] of Object.entries(entries)) {
            for (const name of removed) {expect(Object.keys(entry), `${label} exports ${name}`).not.toContain(name);}
            for (const name of ['buildClustering', 'buildPalette', 'buildSwatches']) {expect(typeof entry[name], `${label} ${name}`).toBe('function');}
        }
    });

    it('are not on a worker instance, and the handle methods stay', async () => {
        const worker = workerEntry.createWorker();
        try {
            for (const name of removed) {expect(worker[name], `worker.${name}`).toBeUndefined();}
            const handle = await worker.cluster(image);
            for (const name of ['getClustering', 'getPalette', 'getSwatches', 'getClusteringInfo', 'quantize', 'quantizeToIndices', 'chooseFrom']) {
                expect(typeof handle[name], `handle.${name}`).toBe('function');
            }
            await handle.release();
            const loaded = await worker.load(await main.buildClustering(image));
            for (const name of ['getPalette', 'getSwatches', 'getClusteringInfo', 'quantize', 'quantizeToIndices', 'chooseFrom']) {
                expect(typeof loaded[name], `loaded.${name}`).toBe('function');
            }
            await loaded.release();
        } finally {
            await worker.terminate();
        }
    });

    it('leave every method on Clustering in place', async () => {
        const clustering = await main.buildClustering(image);
        for (const name of ['getPalette', 'getSwatches', 'getClusteringInfo', 'quantize', 'quantizeToIndices', 'chooseFrom']) {
            expect(typeof clustering[name], `clustering.${name}`).toBe('function');
        }
    });

    it('are not in the built files, as a function or an export', () => {
        const dist = join(root, 'dist');
        const files = readdirSync(dist).filter((file) => /\.(mjs|cjs)$/.test(file) && !/^clustering\./.test(file));
        expect(files.length).toBeGreaterThan(4);
        for (const file of files) {
            const text = readFileSync(join(dist, file), 'utf8');
            for (const name of ['getPaletteFromClustering', 'getSwatchesFromClustering']) {
                expect(new RegExp(`\\b${name}\\b`).test(text), `${file} still has ${name}`).toBe(false);
            }
            expect(/export\s+(const|function)\s+(getPalette|getClusteringInfo)\b/.test(text), `${file} exports a removed name`).toBe(false);
            expect(/\bexports\.(getPalette|getClusteringInfo|quantizeFromClustering|quantizeToIndicesFromClustering)\b/.test(text), `${file} exports a removed name (CommonJS)`).toBe(false);
        }
    });

    it('are not called in the user docs (the migration notes name them on purpose)', () => {
        const docs = ['README.md', 'docs/api.md', 'docs/guides.md', 'docs/environments.md', 'docs/performance.md', 'docs/troubleshooting.md', 'docs/how-it-works.md', 'docs/stability.md'];
        const calls = [/\bgetPaletteFromClustering\b/, /\bgetSwatchesFromClustering\b/, /\bquantizeFromClustering\b/, /\bquantizeToIndicesFromClustering\b/, /(?<![.\w])getClusteringInfo\(\s*c/, /\bworker\.getClusteringInfo\b/];
        for (const file of docs) {
            const text = readFileSync(join(root, file), 'utf8');
            for (const pattern of calls) {expect(pattern.test(text), `${file} names a removed function (${pattern})`).toBe(false);}
        }
    });

    it('are not named by error messages and hints', async () => {
        const clustering = await main.buildClustering(image);
        const palette = await main.buildPalette(image, 2);
        const messages = [
            (await main.buildPalette(clustering, 4).catch((e) => e)).message,
            (await main.buildPalette(palette, 4).catch((e) => e)).message,
            (await main.quantizeWithPalette(image, clustering).catch((e) => e)).message,
            (await clustering.getPalette.call(palette, 4).catch((e) => e)).message,
            (await clustering.getPalette.call(new Uint8Array(9), 4).catch((e) => e)).message,
            (await clustering.getPalette(4, {}).catch((e) => e)).message,
            (await clustering.quantize.call(undefined, image, 4).catch((e) => e)).message,
        ];
        for (const message of messages) {
            expect(message).toBeTruthy();
            for (const name of removed) {expect(message, message).not.toMatch(new RegExp(`(?<![.\\w])${name}\\b`));}
        }
        expect(messages[0]).toContain('clustering.getPalette(k)');
        expect(messages[0]).toContain('clustering.quantize(image, k)');
        expect(messages[2]).toContain('clustering.getPalette(k)');
        expect(messages[3]).toContain('clustering.getPalette(k)');
    });

    it('give a palette passed to new Clustering the same hint as the functions', () => {
        const palette = new main.Palette(new Uint8Array(30));
        expect(() => new main.Clustering(palette)).toThrow(expect.objectContaining({ code: 'invalid-clustering', argument: 'clustering', message: expect.stringContaining('this is a palette, not a clustering') }));
    });

});

describe('a worker script from 3.x', () => {

    // A 3.8 thread has no method named buildClustering, buildPalette or buildSwatches (it answers to the get… names), so it
    // answers each of them as it answers any method it doesn't know: `Unknown method '…'.` with code invalid-argument, in the
    // reply shape worker-thread.js posts for an error.
    it('rejects with worker-failed, not invalid-argument, and does not hang', async () => {
        const folder = mkdtempSync(join(tmpdir(), 'old-worker-'));
        try {
            const script = join(folder, 'worker-thread.mjs');
            writeFileSync(script, `
                import { parentPort } from 'node:worker_threads';
                parentPort.on('message', ({ id, method }) => {
                    parentPort.postMessage({ id, error: { name: 'Error', message: "Unknown method '" + method + "'.", code: 'invalid-argument', argument: undefined, stack: 'Error: stub' } });
                });
            `);
            const worker = workerEntry.createWorker({ script });
            try {
                for (const call of [() => worker.buildPalette(image, 4), () => worker.buildClustering(image), () => worker.buildSwatches(image, 4)]) {
                    const error = await call().catch((caught) => caught);
                    expect(error.code).toBe('worker-failed');
                    expect(error.argument).toBeUndefined();
                    expect(error.message).toMatch(/^The worker script is from another version of agglomerative-clustering \('build(Clustering|Palette|Swatches)' is unknown to it\)\. Use the worker-thread\.mjs from this version\.$/);
                }
            } finally {
                await worker.terminate();
            }
        } finally {
            rmSync(folder, { recursive: true, force: true });
        }
    }, timeLimit(2000));

});
