// The main entry bundled into a CommonJS file for Node (esbuild, as a server build, a VS Code or Obsidian plugin would be),
// run from a directory where the package isn't installed: import.meta.url is gone, so the glue can't find its .wasm or tell
// that it runs in Node, and init({ wasm }) must still accept a path or a file: URL, as the docs say.
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasm = resolve(root, 'dist/clustering.wasm');
const folder = mkdtempSync(join(tmpdir(), 'ac-bundled-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

// Bundles a script that loads with `option` (source text) and prints the palette size or the error, and runs it elsewhere.
const run = async (option, name) => {
    const result = await build({
        stdin: {
            contents: `const ac = require(${JSON.stringify(resolve(root, 'dist/index.cjs'))});
                ac.init(${option}).then(() => ac.getPalette(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]), 2))
                    .then((p) => console.log(p.length), (e) => console.log(e.code + ': ' + e.message));`,
            resolveDir: root,
        },
        bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
        // The .wasm is not bundled: the script is told where it is.
        external: ['*.wasm'],
    });
    const file = join(folder, `${name}.cjs`);
    writeFileSync(file, result.outputFiles[0].text);
    const ran = spawnSync(process.execPath, [file], { cwd: folder, encoding: 'utf8', timeout: 60000 });
    return `${ran.stdout}${ran.stderr}`.trim();
};

describe('init({ wasm }) in a CommonJS bundle for Node', () => {

    it('loads the .wasm from a path, a file: URL string and a URL', async () => {
        expect(await run(`{ wasm: ${JSON.stringify(wasm)} }`, 'path')).toBe('6');
        expect(await run(`{ wasm: ${JSON.stringify(pathToFileURL(wasm).href)} }`, 'file-url')).toBe('6');
        expect(await run(`{ wasm: new URL(${JSON.stringify(pathToFileURL(wasm).href)}) }`, 'url')).toBe('6');
    }, 60000);

    it('names the path when the file is not there, and says what to do without one', async () => {
        const missing = join(folder, 'nowhere', 'clustering.wasm');
        const output = await run(`{ wasm: ${JSON.stringify(missing)} }`, 'missing');
        expect(output).toMatch(/^wasm-load-failed: /);
        expect(output).toContain(missing);
        const unset = await run('', 'unset');
        expect(unset).toMatch(/^wasm-load-failed: /);
        expect(unset).toContain('init({ wasm: path })');
        expect(unset).not.toMatch(/Invalid URL/);
    }, 60000);

});
