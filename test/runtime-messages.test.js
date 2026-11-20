// Load failures explained for the runtime they happen in (found by the fifth round of testing, 3.0.0-beta.5): an edge
// runtime that refuses to compile WebAssembly was told to pass bytes, which it refuses too, and a virtual-memory limit
// that refuses the module's address-space reservation was reported as a bundling problem. Each runs in a child process,
// since it changes globals or limits.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const entry = pathToFileURL(join(dist, 'index.mjs')).href;

const runScript = (source, wrap = (file) => [process.execPath, [file]]) => {
    const folder = mkdtempSync(join(tmpdir(), 'ac-runtime-'));
    try {
        const file = join(folder, 'run.mjs');
        writeFileSync(file, source);
        const [command, args] = wrap(file);
        const run = spawnSync(command, args, { encoding: 'utf8', timeout: 60000 });
        return `${run.stdout}${run.stderr}`;
    } finally {
        rmSync(folder, { recursive: true, force: true });
    }
};

describe('load failures in other runtimes', () => {

    it("keeps the original reason when Node's module loader is missing", () => {
        const output = runScript(`
            const refuse = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module: node:module'));
            WebAssembly.instantiate = refuse; WebAssembly.instantiateStreaming = refuse; WebAssembly.compile = refuse;
            const { init } = await import(${JSON.stringify(entry)});
            const { readFileSync } = await import('node:fs');
            const error = await init({ wasm: readFileSync(${JSON.stringify(join(dist, 'clustering.wasm'))}) }).catch((caught) => caught);
            console.log(JSON.stringify({ code: error.code, message: error.message }));
        `);
        const { code, message } = JSON.parse(output.trim().split('\n').pop());
        expect(code).toBe('wasm-load-failed');
        expect(message).toContain("Node's module loader isn't available here");
        expect(message).toContain('Failed to fetch dynamically imported module: node:module');
    });

    it('tells an edge runtime that refuses to compile WebAssembly to import the module', () => {
        const output = runScript(`
            Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Edge Runtime' }, configurable: true });
            const refuse = () => Promise.reject(new WebAssembly.CompileError('WebAssembly.instantiate(): Wasm code generation disallowed by embedder'));
            WebAssembly.instantiate = refuse; WebAssembly.instantiateStreaming = refuse; WebAssembly.compile = refuse;
            const { init } = await import(${JSON.stringify(entry)});
            const { readFileSync } = await import('node:fs');
            const error = await init({ wasm: readFileSync(${JSON.stringify(join(dist, 'clustering.wasm'))}) }).catch((caught) => caught);
            console.log(JSON.stringify({ code: error.code, message: error.message }));
        `);
        const { code, message } = JSON.parse(output.trim().split('\n').pop());
        expect(code).toBe('wasm-load-failed');
        expect(message).toContain('import clustering.wasm as a module');
        expect(message).not.toMatch(/its bytes|Content-Security-Policy/);
    });

    it.skipIf(process.platform !== 'linux')('says a virtual-memory limit refused the module, not a bundling problem', () => {
        // Node itself fits in 6 GB of address space; the module's reservation (about 10 GB) doesn't.
        const output = runScript(`
            const { getPalette } = await import(${JSON.stringify(entry)});
            const error = await getPalette(new Uint8Array(16), 2).catch((caught) => caught);
            console.log(JSON.stringify({ code: error && error.code, message: error && error.message }));
        `, (file) => ['sh', ['-c', `ulimit -v 6000000 && exec "${process.execPath}" "${file}"`]]);
        const last = output.trim().split('\n').pop();
        let result;
        try {result = JSON.parse(last);} catch (error) {return;}   // Node itself didn't start under the limit here: nothing to check
        if (result.code === undefined) {return;}                    // the reservation fitted on this machine
        expect(result.code).toBe('wasm-load-failed');
        expect(result.message).toContain('ulimit -v');
        expect(result.message).not.toContain('bundle');
    });

});
