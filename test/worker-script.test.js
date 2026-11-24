// Where the worker entry finds its worker script, and how it decides between worker_threads and a Web Worker:
// createWorker({ script }) and init({ script }) for setups that don't emit the package's own script (Angular, esbuild,
// Rollup, a bundled Electron main process), a DOM in Node (jsdom, happy-dom), and the worker entry bundled into CommonJS.
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, cpSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname, relative } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { build } from 'esbuild';
import { createWorker } from '../dist/worker.mjs';
import { buildPalette } from '../dist/index.mjs';
import { timeLimit } from './timeout.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const image = new Uint8Array(4 * 64).map((_, i) => (i * 37 + 11) & 255);
const folder = mkdtempSync(join(tmpdir(), 'ac-script-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

// Runs a module in a fresh Node process (so its globals and working directory are its own) and returns its output.
const runModule = (source, { cwd = root, name = 'run.mjs' } = {}) => {
    const file = join(folder, name);
    writeFileSync(file, source);
    const run = spawnSync(process.execPath, [file], { cwd, encoding: 'utf8', timeout: timeLimit(60000) });
    return { status: run.status, output: `${run.stdout}${run.stderr}`.trim() };
};

describe('createWorker({ script })', () => {

    it('starts the script it is given (a path, or a file: URL) and gives the same results', async () => {
        const copy = join(folder, 'copy');
        cpSync(dist, copy, { recursive: true });
        const expected = await buildPalette(image, 4);
        for (const script of [relative(process.cwd(), join(copy, 'worker-thread.mjs')), pathToFileURL(join(copy, 'worker-thread.mjs')), pathToFileURL(join(copy, 'worker-thread.mjs')).href]) {
            const worker = createWorker({ script });
            try {
                expect(await worker.buildPalette(image, 4)).toEqual(expected);
            } finally {
                await worker.terminate();
            }
        }
    });

    it('reports a script that fails as worker-failed, with one "Worker failed:"', async () => {
        const broken = join(folder, 'broken.mjs');
        writeFileSync(broken, "throw new Error('broken on purpose');\n");
        const worker = createWorker({ script: broken });
        try {
            const error = await worker.buildPalette(image, 4).catch((caught) => caught);
            expect(error.code).toBe('worker-failed');
            expect(error.message).toContain('broken on purpose');
            expect(error.message.match(/Worker failed/g)).toHaveLength(1);
        } finally {
            await worker.terminate();
        }
    });

    // Found by the fourth round (3.0.0-beta.4): Node's bare "Cannot find module" said nothing about what to do.
    it('says what the script needs next to it when it was copied without the rest of dist/', async () => {
        const alone = join(folder, 'alone');
        cpSync(join(dist, 'worker-thread.mjs'), join(alone, 'worker-thread.mjs'));
        for (const script of [join(alone, 'worker-thread.mjs'), join(folder, 'nowhere', 'worker-thread.mjs')]) {
            const worker = createWorker({ script });
            try {
                const error = await worker.buildPalette(image, 4).catch((caught) => caught);
                expect(error.code).toBe('worker-failed');
                expect(error.message).toContain('keep dist/ together');
                expect(error.message).toContain('createWorker({ script })');
            } finally {
                await worker.terminate();
            }
        }
    });

    it('rejects a script that is not a URL or path', () => {
        for (const script of ['', 3, {}, null]) {
            expect(() => createWorker({ script })).toThrow(expect.objectContaining({ code: 'invalid-argument', argument: 'options.script' }));
        }
    });

    it("takes no script in a worker's init: that is chosen when it is created", async () => {
        const worker = createWorker();
        try {
            await expect(worker.init({ script: join(dist, 'worker-thread.mjs') })).rejects.toMatchObject({ code: 'invalid-argument', argument: 'options.script' });
        } finally {
            await worker.terminate();
        }
    });

});

describe('init({ script }) for the shared worker', () => {

    it('chooses the script before the first call, and refuses to change it after', () => {
        const copy = join(folder, 'shared-copy');
        cpSync(dist, copy, { recursive: true });
        const { status, output } = runModule(`
            import * as ac from ${JSON.stringify(pathToFileURL(join(dist, 'worker.mjs')).href)};
            await ac.init({ script: ${JSON.stringify(join(copy, 'worker-thread.mjs'))} });
            const palette = await ac.buildPalette(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]), 2);
            const later = await ac.init({ script: ${JSON.stringify(join(dist, 'worker-thread.mjs'))} }).then(() => 'accepted', (error) => error.code + ' ' + error.argument);
            const same = await ac.init({ script: ${JSON.stringify(join(copy, 'worker-thread.mjs'))} }).then(() => 'accepted', (error) => error.code);
            console.log(palette.length, later, same);
            await ac.terminate();
        `);
        expect(output).toBe('6 invalid-argument options.script accepted');
        expect(status).toBe(0);
    });

});

describe('choosing worker_threads or a Web Worker', () => {

    // jsdom and happy-dom define `window` (but no Worker) in Node: the worker entry still uses worker_threads.
    it('uses worker_threads under a DOM in Node (window, no Worker)', () => {
        const { status, output } = runModule(`
            globalThis.window = globalThis;
            globalThis.document = { baseURI: 'http://localhost/' };
            const { buildPalette, terminate } = await import(${JSON.stringify(pathToFileURL(join(dist, 'worker.mjs')).href)});
            const palette = await buildPalette(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]), 2);
            console.log(palette.length);
            await terminate();
        `);
        expect(output).toBe('6');
        expect(status).toBe(0);
    });

    // A Node build bundled into CommonJS has no import.meta.url: the worker still starts in Node (the package's own
    // script, found from the working directory), and where it can't, the error says why.
    it('works bundled into CommonJS, and says why when it cannot find the script', async () => {
        const result = await build({
            stdin: { contents: `const ac = require(${JSON.stringify(join(dist, 'worker.mjs'))}); ac.buildPalette(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]), 2).then((p) => { console.log(p.length); return ac.terminate(); }, (e) => { console.log(e.code + ': ' + e.message); return ac.terminate(); });`, resolveDir: root },
            bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
        });
        const bundle = join(folder, 'bundle.cjs');
        writeFileSync(bundle, result.outputFiles[0].text);
        // From the project (where Node finds the package by name, as an app's would be).
        const found = spawnSync(process.execPath, [bundle], { cwd: root, encoding: 'utf8', timeout: timeLimit(60000) });
        expect(`${found.stdout}${found.stderr}`.trim()).toBe('6');
        // From somewhere the package isn't installed.
        const lost = spawnSync(process.execPath, [bundle], { cwd: tmpdir(), encoding: 'utf8', timeout: timeLimit(60000) });
        const output = `${lost.stdout}${lost.stderr}`.trim();
        expect(output).toMatch(/^worker-failed: Worker failed: the worker entry can't find its worker script/);
        expect(output).toContain('createWorker({ script })');
        expect(output.match(/Worker failed/g)).toHaveLength(1);
    }, timeLimit(60000));

});

describe('images the worker entry checks itself', () => {

    it('reports a detached image as invalid-argument, as the main entry does', async () => {
        const worker = createWorker({ transfer: true });
        try {
            const data = new Uint8ClampedArray(4 * 16).fill(200);
            const imageData = new ImageData(data, 4, 4);
            await worker.buildPalette(imageData, 2);
            expect(imageData.data.byteLength).toBe(0);
            for (const detached of [imageData, { data: imageData.data, format: 'rgba' }]) {
                await expect(worker.buildPalette(detached, 2)).rejects.toMatchObject({ code: 'invalid-argument', argument: 'image' });
            }
        } finally {
            await worker.terminate();
        }
    });

});
