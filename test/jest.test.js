// The CommonJS build under Jest (test/jest/): its module system can't require() the ES-module Emscripten glue, so
// index.cjs falls back to the CommonJS copy (dist/clustering.cjs, see scripts/patch-glue.mjs and patch-cjs.mjs).
import { it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

it('runs under Jest in CommonJS mode, in the node and jsdom environments', () => {
    const run = spawnSync(process.execPath, [resolve(root, 'node_modules/jest/bin/jest.js'), '--config', 'test/jest/jest.config.cjs', '--ci'], {
        cwd: root, encoding: 'utf8', timeout: 120000,
        // Without --experimental-vm-modules, as Jest runs by default.
        env: { ...process.env, NODE_OPTIONS: '' },
    });
    const output = `${run.stdout}\n${run.stderr}`;
    expect(output, output).toMatch(/Tests:\s+6 passed, 6 total/);
    expect(run.status, output).toBe(0);
}, 150000);
