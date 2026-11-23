// The rgb-as-rgba warning (PRINCIPLES "Warnings only bridge to an error in the next major"): once per copy of the
// library, only for a call whose arguments were accepted, never changing a result.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPalette, buildClustering, buildSwatches, quantize, quantizeWithPalette, quantizeToIndices, Palette } from '../dist/index.mjs';
import { resetWarnings } from '../dist/shared.mjs';
import { createWorker } from '../dist/worker.mjs';

// This file expects warnings; test/setup.js fails any other file that causes one.
globalThis.__acExpectWarnings = true;

const dist = (file) => fileURLToPath(new URL(`../dist/${file}`, import.meta.url));
// For `import` in a child: a file: URL, since an absolute Windows path (D:\...) isn't a valid specifier.
const distUrl = (file) => new URL(`../dist/${file}`, import.meta.url).href;

const hsv = (h, s, v) => {
    const i = Math.floor(h * 6), f = h * 6 - i;
    const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6].map((c) => Math.round(c * 255));
};
const side = 64;
const bareRgb = new Uint8Array(side * side * 3);
const bareRgba = new Uint8Array(side * side * 4);
for (let p = 0; p < side * side; p++) {
    const colour = hsv((p % side) / side, 0.85, 0.3 + 0.7 * Math.floor(p / side) / side);
    bareRgb.set(colour, p * 3);
    bareRgba.set([...colour, 255], p * 4);
}

let seen = [];
const listener = (warning) => {if (warning.name === 'AgglomerativeClusteringWarning') {seen.push(warning);}};
const tick = () => new Promise((resolve) => setImmediate(resolve));
// Warnings from what `run` does, after Node has emitted them (process.emitWarning waits for the next tick).
const warningsFrom = async (run) => {
    seen = [];
    try {await run();} catch (error) {/* the call's own outcome is checked by the test */}
    await tick();
    return seen;
};

beforeEach(() => {resetWarnings(); seen = []; process.on('warning', listener);});
afterEach(() => {process.off('warning', listener);});

// A child process gets fresh copies of the library, so it shows what happens before the module has loaded and in the
// CommonJS build; it prints the rgb-as-rgba warnings it heard.
const inChild = (source, type = 'module') => JSON.parse(execFileSync(process.execPath, [`--input-type=${type}`, '-e', source], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop());
// The same, also returning everything the child wrote to stderr, where Node prints every warning of every thread.
const inChildWithStderr = (source) => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' });
    return { heard: JSON.parse(result.stdout.trim().split('\n').pop()), stderr: result.stderr };
};
const childImage = `
const side = 64, rgb = new Uint8Array(side * side * 3);
for (let p = 0; p < side * side; p++) {const h = (p % side) / side; rgb.set([Math.round(255 * h), Math.round(255 * (1 - h)), Math.round(255 * Math.floor(p / side) / side)], p * 3);}
let heard = 0;
process.on('warning', (w) => {if (w.code === 'rgb-as-rgba') {heard++;}});
`;

describe('main entry', () => {
    it('warns once for RGB bytes passed bare, naming the image and the fix', async () => {
        const first = await warningsFrom(() => buildPalette(bareRgb, 8));
        expect(first).toHaveLength(1);
        expect(first[0].code).toBe('rgb-as-rgba');
        expect(first[0].message).toContain('This image (12,288 bytes) looks like RGB bytes (3 per pixel)');
        expect(first[0].message).toContain("{ data, format: 'rgb' }");
        expect(first[0].message).toContain('From 4.0 this is an error');
        expect(await warningsFrom(() => buildPalette(bareRgb, 8))).toHaveLength(0);
    });

    it('warns from every function that takes an image, and from Clustering methods', async () => {
        const palette = await buildPalette(bareRgba, 4);
        const clustering = await buildClustering(bareRgba);
        const runs = [
            () => buildClustering(bareRgb),
            () => buildSwatches(bareRgb, 4),
            () => quantize(bareRgb, 4),
            () => quantizeWithPalette(bareRgb, palette),
            () => quantizeToIndices(bareRgb, 4),
            () => clustering.quantize(bareRgb, 4),
        ];
        for (const run of runs) {
            resetWarnings();
            expect(await warningsFrom(run)).toHaveLength(1);
        }
    });

    it('stays silent for RGBA and for images that say what they are', async () => {
        const silent = [
            () => buildPalette(bareRgba, 8),
            () => buildPalette({ data: bareRgb, format: 'rgb' }, 8),
            () => buildPalette({ data: bareRgb, format: 'rgba' }, 8),
            () => buildPalette(new ImageData(new Uint8ClampedArray(bareRgba), side, side), 8),
            () => buildPalette(new Uint8Array(188), 8),
            () => buildPalette(new Palette(bareRgb.subarray(0, 768)), 8),
            async () => buildPalette(await buildClustering(bareRgba), 8),
        ];
        for (const run of silent) {expect(await warningsFrom(run)).toHaveLength(0);}
    });

    it("doesn't spend the warning on a call that fails its own checks", async () => {
        await expect(buildPalette(bareRgb, 0)).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(buildPalette(bareRgb, 8, { bogus: 1 })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(quantizeWithPalette(bareRgb, new Uint8Array(4))).rejects.toMatchObject({ code: 'invalid-argument' });
        await tick();
        expect(seen).toHaveLength(0);
        expect(await warningsFrom(() => buildPalette(bareRgb, 8))).toHaveLength(1);
    });

    it("doesn't spend the warning on a call whose signal is already aborted", async () => {
        const aborted = AbortSignal.abort();
        await expect(buildPalette(bareRgb, 8, { signal: aborted })).rejects.toBeDefined();
        await expect(quantize(bareRgb, 8, { signal: aborted })).rejects.toBeDefined();
        await tick();
        expect(seen).toHaveLength(0);
        expect(await warningsFrom(() => buildPalette(bareRgb, 8))).toHaveLength(1);
    });

    it('uses console.warn on runtimes that only imitate Node (Cloudflare Workers: emitWarning there prints nothing)', async () => {
        const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Cloudflare-Workers' }, configurable: true, writable: true });
            const warnings = await warningsFrom(() => buildPalette(bareRgb, 8));
            expect(warnings).toHaveLength(0);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0][0]).toMatch(/^agglomerative-clustering \[rgb-as-rgba\]: This image/);
        } finally {
            if (navigatorDescriptor) {Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);} else {delete globalThis.navigator;}
            warn.mockRestore();
        }
    });

    it('never warns about an image it rejects', async () => {
        const png = new Uint8Array(bareRgb.length + 8);
        png.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        png.set(bareRgb, 8);
        await expect(buildPalette(png, 8)).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(buildPalette(bareRgb.subarray(0, bareRgb.length - 2), 8)).rejects.toMatchObject({ code: 'invalid-argument' });
        await tick();
        expect(seen).toHaveLength(0);
    });

    it('changes no result: bare RGB gives what the same bytes as { data, format: "rgba" } give', async () => {
        expect(await buildPalette(bareRgb, 8)).toEqual(await buildPalette({ data: bareRgb, format: 'rgba' }, 8));
        expect(await quantize(bareRgb, 8)).toEqual((await quantize({ data: bareRgb, format: 'rgba' }, 8)).data);
    });

    it('falls back to console.warn where process.emitWarning is missing (a bundler polyfill)', async () => {
        const emitWarning = process.emitWarning;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            process.emitWarning = undefined;
            await buildPalette(bareRgb, 8);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0][0]).toMatch(/^agglomerative-clustering \[rgb-as-rgba\]: This image/);
        } finally {
            process.emitWarning = emitWarning;
            warn.mockRestore();
        }
    });

    it('warns once for several calls made before the module has loaded', () => {
        const heard = inChild(`
import { buildPalette } from ${JSON.stringify(distUrl('index.mjs'))};
${childImage}
await Promise.all([buildPalette(rgb, 8), buildPalette(rgb, 8), buildPalette(rgb, 8)]);
await new Promise((resolve) => setImmediate(resolve));
console.log(JSON.stringify(heard));
`);
        expect(heard).toBe(1);
    });

    it('warns in the CommonJS build too (its own copy)', () => {
        const heard = inChild(`
const { buildPalette } = require(${JSON.stringify(dist('index.cjs'))});
${childImage}
buildPalette(rgb, 8).then(() => setImmediate(() => console.log(JSON.stringify(heard))));
`, 'commonjs');
        expect(heard).toBe(1);
    });
});

describe('worker entry', () => {
    const workers = [];
    const worker = (options) => {const made = createWorker(options); workers.push(made); return made;};
    afterEach(async () => {await Promise.all(workers.splice(0).map((made) => made.terminate()));});

    it("warns once, on the caller's side, after the call succeeds", async () => {
        const w = worker();
        expect(await warningsFrom(() => w.buildPalette(bareRgb, 8))).toHaveLength(1);
        expect(await warningsFrom(() => w.buildPalette(bareRgb, 8))).toHaveLength(0);
    });

    it('warns for worker.cluster(image)', async () => {
        const w = worker();
        expect(await warningsFrom(async () => (await w.cluster(bareRgb)).release())).toHaveLength(1);
    });

    it("doesn't spend the warning on a call the thread rejects", async () => {
        const w = worker();
        await expect(w.buildPalette(bareRgb, 0)).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(w.buildPalette(new Palette(bareRgb.subarray(0, 768)), 4)).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(w.buildPalette(bareRgb, 8, { bogus: 1 })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(w.quantizeWithPalette(bareRgb, new Uint8Array(4))).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(w.buildPalette(bareRgb, 8, { signal: AbortSignal.abort() })).rejects.toBeDefined();
        await tick();
        expect(seen).toHaveLength(0);
        expect(await warningsFrom(() => w.buildPalette(bareRgb, 8))).toHaveLength(1);
    });

    it('checks before transfer: true empties the array, naming its original size', async () => {
        const w = worker({ transfer: true });
        const bytes = bareRgb.slice();
        const warnings = await warningsFrom(() => w.buildPalette(bytes, 8));
        expect(bytes.length).toBe(0);
        expect(warnings).toHaveLength(1);
        expect(warnings[0].message).toContain('(12,288 bytes)');
    });

    it('never warns from the thread, with the package script or a given one', () => {
        const { heard, stderr } = inChildWithStderr(`
import { createWorker } from ${JSON.stringify(distUrl('worker.mjs'))};
import { resetWarnings } from ${JSON.stringify(distUrl('shared.mjs'))};
${childImage}
const own = createWorker();
await own.buildPalette(rgb, 8);
await own.terminate();
await new Promise((resolve) => setImmediate(resolve));
resetWarnings();
const given = createWorker({ script: ${JSON.stringify(dist('worker-thread.mjs'))} });
await given.buildPalette(rgb, 8);
await given.terminate();
await new Promise((resolve) => setImmediate(resolve));
console.log(JSON.stringify(heard));
`);
        expect(heard).toBe(2);
        expect(stderr.split('rgb-as-rgba').length - 1).toBe(2);
    });
});
