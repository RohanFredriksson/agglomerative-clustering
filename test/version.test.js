import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import * as ac from '../dist/index.mjs';
import * as worker from '../dist/worker.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const image = new Uint8Array(64).map((_, i) => (i * 29) & 255);

describe('version and formatVersion', () => {

    it('are the package version and the stored-data format, the same in both entries', async () => {
        expect(ac.version).toBe(pkg.version);
        expect(ac.version).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
        expect(worker.version).toBe(ac.version);
        expect(ac.formatVersion).toBe(3);
        expect(worker.formatVersion).toBe(ac.formatVersion);
        expect((await (await ac.buildClustering(image)).getClusteringInfo()).formatVersion).toBe(ac.formatVersion);
    });

    it('are in step with the .wasm and its source: the build checks it, and so does the module', () => {
        const wasm = readFileSync(new URL('../dist/clustering.wasm', import.meta.url));
        expect(wasm.includes(Buffer.from(`agglomerative-clustering@${pkg.version}`))).toBe(true);
        const check = spawnSync(process.execPath, ['scripts/sync-version.mjs', '--check'], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' });
        expect(check.status, check.stderr).toBe(0);
    });

    it('--check fails, and the plain run repairs it, when a copy has drifted', () => {
        const copy = mkdtempSync(join(tmpdir(), 'ac-version-'));
        mkdirSync(join(copy, 'src')); mkdirSync(join(copy, 'scripts'));
        const here = fileURLToPath(new URL('..', import.meta.url));
        for (const file of ['package.json', 'src/shared.js', 'src/version.hpp', 'scripts/sync-version.mjs']) {cpSync(join(here, file), join(copy, file));}
        const stale = readFileSync(join(copy, 'src/shared.js'), 'utf8').replace(/export const version = '[^']*';/, "export const version = '0.0.1';");
        writeFileSync(join(copy, 'src/shared.js'), stale);
        const run = (...args) => spawnSync(process.execPath, ['scripts/sync-version.mjs', ...args], { cwd: copy, encoding: 'utf8' });
        expect(run('--check').status).toBe(1);
        expect(run().status).toBe(0);
        expect(run('--check').status).toBe(0);
        expect(readFileSync(join(copy, 'src/shared.js'), 'utf8')).toContain(`export const version = '${pkg.version}';`);
        // a reworded line can't silently stop being synced
        writeFileSync(join(copy, 'src/shared.js'), readFileSync(join(copy, 'src/shared.js'), 'utf8').replace('export const version', 'export const libraryVersion'));
        expect(run().status).not.toBe(0);
    });

});

describe('a .wasm from another version', () => {

    // The real module's bytes with the version string's last character changed: the same length, so it still compiles.
    const mismatched = () => {
        const bytes = new Uint8Array(readFileSync(new URL('../dist/clustering.wasm', import.meta.url)));
        const text = Buffer.from(`agglomerative-clustering@${pkg.version}`);
        const at = Buffer.from(bytes).indexOf(text);
        expect(at).toBeGreaterThan(-1);
        const end = at + text.length - 1;
        bytes[end] = bytes[end] === 0x39 ? 0x38 : 0x39;
        return bytes;
    };

    it('is refused when it loads, naming both versions, and the real module still loads after', async () => {
        const { init } = await import('../dist/index.mjs?mismatch');
        const error = await init({ wasm: mismatched() }).catch((e) => e);
        expect(error.code).toBe('wasm-load-failed');
        expect(error.message).toContain(`this script is agglomerative-clustering@${pkg.version}`);
        expect(error.message).toMatch(/module is agglomerative-clustering@\S+, but/);
        await init();    // a failed load can be retried
    });

    it('is refused in a worker too', async () => {
        const w = worker.createWorker({ wasm: mismatched() });
        try {
            const error = await w.buildPalette(image, 2).catch((e) => e);
            expect(error.code).toBe('wasm-load-failed');
            expect(error.message).toContain('this script is');
        } finally {
            await w.terminate();
        }
    });

});
