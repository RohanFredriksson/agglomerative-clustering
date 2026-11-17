// A worker thread that fails must not leave the instance hanging: waiting calls get a coded error, later calls fail the
// same way instead of waiting forever on a thread that will never answer, and the instance recovers once the problem is
// gone. (A blocked or missing worker script, such as under a strict CSP or a misconfigured bundler, looks like this.)
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, copyFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as dropIn from '../dist/worker.mjs';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const image = new Uint8Array(4 * 64).map((_, i) => (i * 37 + 11) & 255);

const folder = mkdtempSync(join(tmpdir(), 'ac-broken-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));
// The package without its worker thread script.
for (const file of ['index.mjs', 'shared.mjs', 'clustering.js', 'clustering.wasm', 'worker.mjs']) {copyFileSync(join(dist, file), join(folder, file));}

const settle = (promise, ms = 8000) => Promise.race([
    promise.then(() => 'resolved', (error) => error),
    new Promise((resolveTimer) => setTimeout(() => resolveTimer('HUNG'), ms)),
]);

describe('a worker that cannot start', () => {

    it('fails every call clearly, and starts working once the script is there', async () => {
        const broken = await import(/* @vite-ignore */ pathToFileURL(join(folder, 'worker.mjs')).href);
        const worker = broken.createWorker();
        for (let attempt = 1; attempt <= 3; attempt++) {
            const outcome = await settle(worker.getPalette(image, 4));
            expect(outcome, `call ${attempt}`).not.toBe('HUNG');
            expect(outcome.code, `call ${attempt}`).toBe('worker-failed');
        }
        // Calls made together all fail, not just the first.
        const together = await Promise.all([settle(worker.getPalette(image, 4)), settle(worker.getClustering(image)), settle(worker.cluster(image))]);
        expect(together.map((outcome) => outcome.code)).toEqual(['worker-failed', 'worker-failed', 'worker-failed']);

        // The problem goes away: the next call starts a fresh worker and works.
        copyFileSync(join(dist, 'worker-thread.mjs'), join(folder, 'worker-thread.mjs'));
        expect(await worker.getPalette(image, 4)).toEqual(await broken.createWorker().getPalette(image, 4));
        await worker.terminate();
    }, 60000);

});

describe('the shared worker', () => {

    it('passes init its options', async () => {
        await expect(dropIn.init({ wasm: 5 })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(dropIn.init({ wasm: join(folder, 'no-such-file.wasm') })).rejects.toBeTruthy();
        await dropIn.terminate();
        // And it still starts normally afterwards.
        expect((await dropIn.getPalette(image, 4)).length).toBeGreaterThan(0);
        await dropIn.terminate();
    });

});
