// The Emscripten glue decides whether it runs in Node from `process` (patched by scripts/patch-glue.mjs). Electron gives
// pages and their Web Workers Node's globals (process.type 'renderer' and 'worker') without Node's module loader, so those
// must take the web path: a Web Worker with nodeIntegrationInWorker took the Node path and failed to load the module.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const dist = (name) => fileURLToPath(new URL(`../dist/${name}`, import.meta.url));

// The glue's detection expression, as a function of a stand-in `process`.
const detection = (file) => {
    const text = readFileSync(dist(file), 'utf8');
    const found = text.match(/ENVIRONMENT_IS_NODE=([^;]*);/);
    expect(found, file).toBeTruthy();
    const expression = found[1]
        .replaceAll('globalThis.process', 'proc').replace(/\bprocess\./g, 'proc.')
        .replaceAll('import.meta.url', "'file:///app/node_modules/agglomerative-clustering/dist/clustering.js'")
        .replaceAll('__filename', "'/app/node_modules/agglomerative-clustering/dist/clustering.cjs'");
    return new Function('proc', `return !!(${expression});`);
};

describe('the glue', () => {

    for (const file of ['clustering.js', 'clustering.cjs']) {
        it(`treats Electron renderers and their workers as browsers (${file})`, () => {
            const isNode = detection(file);
            const proc = (type) => ({ versions: { node: '22.0.0' }, type, getBuiltinModule: () => ({}) });
            expect(isNode(proc('renderer'))).toBe(false);
            expect(isNode(proc('worker'))).toBe(false);
            expect(isNode(proc(undefined))).toBe(true);    // Node, and its worker_threads
            expect(isNode(proc('browser'))).toBe(true);    // Electron's main process
            expect(isNode(proc('utility'))).toBe(true);    // Electron's utilityProcess
            expect(isNode(undefined)).toBe(false);         // a browser
        });
    }

});
