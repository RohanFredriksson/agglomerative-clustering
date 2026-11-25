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
import { buildPalette, version } from '../dist/index.mjs';
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
                expect(error.message).toContain("Serve all of the package's dist/ files from this version.");
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

describe('init({ script }) leaves nothing unhandled', () => {

    it('as a setup line without await: a script that cannot start fails the calls, not the process', () => {
        const { status, output } = runModule(`
            import * as ac from ${JSON.stringify(pathToFileURL(join(dist, 'worker.mjs')).href)};
            ac.init({ script: '/nonexistent/worker-thread.mjs' });
            const code = await ac.buildPalette({ data: new Uint8Array(16).fill(9), format: 'rgba' }, 2).then(() => 'ok', (error) => error.code);
            console.log(code);
            await ac.terminate();
        `);
        expect(output).toBe('worker-failed');
        expect(status).toBe(0);
    });

    it('awaited, it resolves once the options are recorded, and the next call rejects with worker-failed', () => {
        const { status, output } = runModule(`
            import * as ac from ${JSON.stringify(pathToFileURL(join(dist, 'worker.mjs')).href)};
            const first = await ac.init({ script: '/nonexistent/worker-thread.mjs' }).then(() => 'resolved', (error) => error.code);
            const code = await ac.buildPalette({ data: new Uint8Array(16).fill(9), format: 'rgba' }, 2).then(() => 'ok', (error) => error.code);
            const bad = await ac.init({ wasm: 5 }).then(() => 'resolved', (error) => error.code + ' ' + error.argument);
            console.log(first, code, bad);
            await ac.terminate();
        `);
        expect(output).toBe('resolved worker-failed invalid-argument options.wasm');
        expect(status).toBe(0);
    });

});

describe('a worker script that fails to link, in Node', () => {

    // A stale 3.8 worker-thread.mjs next to 4.0 files fails at link time (a named export that no longer exists).
    it('is worker-failed, with the different-versions hint and the engine text', async () => {
        const stale = join(folder, 'stale');
        cpSync(dist, stale, { recursive: true });
        writeFileSync(join(stale, 'worker-thread.mjs'), "import { noSuchExport } from './index.mjs';\nconsole.log(noSuchExport);\n");
        const worker = createWorker({ script: join(stale, 'worker-thread.mjs') });
        try {
            const error = await worker.buildPalette(image, 4).catch((caught) => caught);
            expect(error.code).toBe('worker-failed');
            expect(error.message).toContain('noSuchExport');
            expect(error.message).toContain("Serve all of the package's dist/ files from this version.");
            expect(String(error.cause && error.cause.message)).toContain('noSuchExport');
        } finally {
            await worker.terminate();
        }
    });

});

describe('a worker script that throws, in Node', () => {

    it('keeps its own message, with no versions hint, and the error as the cause', async () => {
        for (const [source, text] of [["throw new Error('broken on purpose');", 'broken on purpose'], ['throw undefined;', 'not an Error'], ["throw 'a string';", 'not an Error']]) {
            const script = join(folder, 'throws.mjs');
            writeFileSync(script, `${source}\n`);
            const worker = createWorker({ script });
            try {
                const error = await worker.buildPalette(image, 4).catch((caught) => caught);
                expect(error.code).toBe('worker-failed');
                expect(error.message).toContain(text);
                expect(error.message).not.toContain('undefined');
                expect(error.message).not.toContain('dist/');
                if (text === 'broken on purpose') {expect(error.cause.message).toBe(text);}
            } finally {
                await worker.terminate();
            }
        }
    });

});

describe('init({ wasm }) twice in a row', () => {

    // The warm-up call that init starts resends the newer location anyway, which hides the race this guards against
    // (clearing the newer `wasm` when the older send finishes), so this test can't fail on the old code: it checks the
    // outcome only.
    // A stub thread that logs the locations it is sent and answers an init slowly, so a newer one can be recorded while the
    // older is on its way.
    it('sends the newest wasm location last', async () => {
        const stubFolder = mkdtempSync(join(tmpdir(), 'init-race-'));
        const script = join(stubFolder, 'worker-thread.mjs');
        writeFileSync(script, `
            import { parentPort } from 'node:worker_threads';
            const seen = [];
            parentPort.on('message', ({ id, method, args }) => {
                if (method === 'handshake') {parentPort.postMessage({ id, result: ${JSON.stringify(version)} });}
                else if (method === 'init') {
                    if (args[0] && args[0].wasm) {seen.push(args[0].wasm);}
                    setTimeout(() => parentPort.postMessage({ id, result: null }), 150);
                } else {parentPort.postMessage({ id, result: seen });}
            });
        `);
        const worker = createWorker({ script });
        try {
            await worker.init({ wasm: 'first.wasm' });
            const first = worker.buildPalette(image, 2);     // sends the first location ...
            await new Promise((done) => setTimeout(done, 50));
            await worker.init({ wasm: 'second.wasm' });       // ... and a newer one is recorded while it is on its way
            await first;
            // The newer location is the last the thread has been sent, whatever the timing of the older one.
            expect((await worker.buildPalette(image, 2)).at(-1)).toBe('second.wasm');
        } finally {
            await worker.terminate();
            rmSync(stubFolder, { recursive: true, force: true });
        }
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
