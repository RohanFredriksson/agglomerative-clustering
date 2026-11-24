// A createWorker() worker that is dropped without terminate() is stopped once it has been garbage-collected, so a service
// that creates workers and forgets them doesn't gather threads (found by the fifth round of testing, 3.0.0-beta.5: 271
// threads and 3.3 GB after 540 requests). It must never be stopped while a call is running on it or a handle from it is
// left. Collection is forced with --expose-gc in a child process, and threads are counted from /proc (Linux only).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createWorker } from '../dist/worker.mjs';
import { timeLimit } from './timeout.js';

const workerEntry = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../dist/worker.mjs')).href;

const script = `
import { readFileSync } from 'fs';
const { createWorker } = await import(${JSON.stringify(workerEntry)});
const threads = () => Number(/Threads:\\s+(\\d+)/.exec(readFileSync('/proc/self/status', 'utf8'))[1]);
const image = new Uint8Array(64 * 64 * 4).map((_, i) => (i * 2654435761) >>> 24);
const settle = async () => {for (let i = 0; i < 20; i++) {globalThis.gc(); await new Promise((r) => setTimeout(r, 50));}};
const results = {};
await settle();
results.base = threads();

// Dropped after its calls.
const used = async () => {for (let i = 0; i < 10; i++) {await createWorker().buildPalette(image, 4);}};
await used();
await settle();
results.afterDropped = threads();

// Dropped while its call runs: only the promise is kept, and the call still finishes.
const running = async () => {
    const calls = Array.from({ length: 4 }, () => createWorker().buildPalette(image, 4));
    await settle();
    return (await Promise.all(calls)).every((palette) => palette.length === 12);
};
results.runningCallsFinished = await running();
await settle();
results.afterRunning = threads();

// A handle keeps its worker going; once the handle goes too, the worker stops.
const keepHandle = async () => createWorker().cluster(image);
let handle = await keepHandle();
await settle();
results.handleWorks = (await handle.getPalette(3)).length === 9;
results.withHandle = threads();
handle = null;
await settle();
results.afterHandle = threads();

// A released handle, then the worker dropped.
const released = async () => {const worker = createWorker(); const kept = await worker.cluster(image); await kept.release();};
await released();
await settle();
results.afterReleased = threads();

// A loaded handle is reclaimed like an image handle.
const keepLoaded = async () => {const worker = createWorker(); return worker.load(await worker.buildClustering(image));};
let loaded = await keepLoaded();
await settle();
results.loadedWorks = (await loaded.getPalette(3)).length === 9;
results.withLoaded = threads();
loaded = null;
await settle();
results.afterLoaded = threads();

console.log(JSON.stringify(results));
`;

describe('workers that are dropped', () => {

    it.skipIf(process.platform !== 'linux')('are stopped once collected, but not while a call or a handle needs them', () => {
        const folder = mkdtempSync(join(tmpdir(), 'ac-lifetime-'));
        try {
            const file = join(folder, 'drop.mjs');
            writeFileSync(file, script);
            const run = spawnSync(process.execPath, ['--expose-gc', file], { encoding: 'utf8', timeout: timeLimit(120000) });
            expect(run.status, run.stderr).toBe(0);
            const results = JSON.parse(run.stdout.trim().split('\n').pop());
            expect(results.afterDropped).toBe(results.base);
            expect(results.runningCallsFinished).toBe(true);
            expect(results.afterRunning).toBe(results.base);
            expect(results.handleWorks).toBe(true);
            expect(results.withHandle).toBe(results.base + 1);
            expect(results.afterHandle).toBe(results.base);
            expect(results.afterReleased).toBe(results.base);
            expect(results.loadedWorks).toBe(true);
            expect(results.withLoaded).toBe(results.base + 1);
            expect(results.afterLoaded).toBe(results.base);
        } finally {
            rmSync(folder, { recursive: true, force: true });
        }
    }, timeLimit(150000));

    it.skipIf(typeof Symbol.asyncDispose !== 'symbol')('can be terminated with await using (Symbol.asyncDispose)', async () => {
        const worker = createWorker();
        await worker.getPalette(new Uint8Array(16), 2);
        expect(worker[Symbol.asyncDispose]).toBe(worker.terminate);
        await worker[Symbol.asyncDispose]();
        await expect(worker.getPalette(new Uint8Array(16), 2)).rejects.toHaveProperty('code', 'worker-terminated');
    });

});
