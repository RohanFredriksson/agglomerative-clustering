import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Only the worker entry: vitest gives each test file its own module graph, so the main entry isn't loaded here until the
// last test imports it. Nothing above that import may load '../dist/index.mjs'.
import { buildClustering, terminate } from '../dist/worker.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
afterAll(() => terminate());

const image = new Uint8Array(4 * 64);
for (let p = 0; p < 64; p++) {image.set([p * 4, 255 - p * 4, (p * 37) & 255, 255], p * 4);}

const forms = {
    getPalette: [(c) => c.getPalette(4), "(await worker.load(clustering)).getPalette(k)"],
    getSwatches: [(c) => c.getSwatches(4), "(await worker.load(clustering)).getSwatches(k)"],
    getClusteringInfo: [(c) => c.getClusteringInfo(), "(await worker.load(clustering)).getClusteringInfo()"],
    quantize: [(c) => c.quantize(image, 4), "(await worker.load(clustering)).quantize(image, k)"],
    quantizeToIndices: [(c) => c.quantizeToIndices(image, 4), "(await worker.load(clustering)).quantizeToIndices(image, k)"],
};

describe('methods on Clustering without the main entry', () => {

    it('reject with wasm-load-failed, and say what to import or call instead', async () => {
        const clustering = await buildClustering(image);
        for (const [name, [call, form]] of Object.entries(forms)) {
            const error = await call(clustering).then(() => null, (reason) => reason);
            expect(error, name).not.toBeNull();
            expect(error.code).toBe('wasm-load-failed');
            expect(error.argument).toBeUndefined();
            expect(error.message).toMatch(new RegExp(`^clustering\\.${name} can't run here: a clustering's methods run on the calling thread with the main entry, 'agglomerative-clustering'`));
            expect(error.message).toContain(`use a loaded handle's ${name}: ${form}`);
        }
    });

    it('chooseFrom rejects with wasm-load-failed and names worker.load', async () => {
        const clustering = await buildClustering(image);
        const error = await clustering.chooseFrom(new Uint8Array(30), 4).then(() => null, (reason) => reason);
        expect(error).not.toBeNull();
        expect(error.code).toBe('wasm-load-failed');
        expect(error.message).toMatch(/^clustering\.chooseFrom can't run here/);
        expect(error.message).toContain('worker.load');
    });

    it('still check their receiver first, and the handle-shaped quantize(k), before the main entry', async () => {
        const clustering = await buildClustering(image);
        const error = await clustering.getPalette.call(undefined, 4).then(() => null, (reason) => reason);
        expect(error.code).toBe('invalid-clustering');
        const shape = await clustering.quantize(16).then(() => null, (reason) => reason);
        expect(shape).toMatchObject({ code: 'invalid-argument', argument: 'image' });
    });

    it('work once the main entry is imported, on clusterings made before', async () => {
        const clustering = await buildClustering(image);
        const main = await import('../dist/index.mjs');
        const palette = await clustering.getPalette(4);
        expect(palette).toEqual(await main.buildPalette(image, 4));
        expect(await clustering.quantize(image, 4)).toEqual(await main.quantizeWithPalette(image, palette));
    });

});

describe('methods on Clustering across module systems', () => {

    // Each case runs in a fresh Node, so which entries are loaded is exactly what the script loads.
    const run = (source) => execFileSync(process.execPath, ['--input-type=module', '-e', source], { cwd: root, encoding: 'utf8' }).trim();
    const prelude = `
        import { createRequire } from 'node:module';
        const require = createRequire(process.cwd() + '/');
        const image = new Uint8Array(4 * 64).map((_, i) => i % 4 === 3 ? 255 : (i * 37) & 255);
        const outcome = (promise) => promise.then(() => 'ok', (error) => error.code);
    `;

    it('in CommonJS: reject with only the worker entry, work once the main entry is required', () => {
        const output = run(`${prelude}
            const worker = require('./dist/worker.cjs');
            const clustering = await worker.buildClustering(image);
            const before = await outcome(clustering.getPalette(4));
            require('./dist/index.cjs');
            const after = await outcome(clustering.getPalette(4));
            await worker.terminate();
            console.log(before, after);
        `);
        expect(output).toBe('wasm-load-failed ok');
    });

    it('use the main entry of their own module system', () => {
        const output = run(`${prelude}
            const worker = require('./dist/worker.cjs');
            await import('./dist/index.mjs');
            const fromCjs = await worker.buildClustering(image);
            const fromEsm = await (await import('./dist/worker.mjs')).buildClustering(image);
            console.log(await outcome(fromCjs.getPalette(4)), await outcome(fromEsm.getPalette(4)));
            await worker.terminate();
            await (await import('./dist/worker.mjs')).terminate();
        `);
        expect(output).toBe('wasm-load-failed ok');
    });

});
