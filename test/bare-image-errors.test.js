// A bare Uint8Array that looks like RGB, grey, or grey and alpha is an error (it was the rgb-as-rgba and gray-as-rgba
// warnings in 3.x): on every call, on every function that takes an image, in both entries, with the same message.
import { describe, it, expect, vi } from 'vitest';
import { buildPalette, buildClustering, buildSwatches, quantize, quantizeWithPalette, quantizeToIndices, quantizeToIndicesWithPalette, Palette } from '../dist/index.mjs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createWorker } from '../dist/worker.mjs';

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
// Grey as a random walk, so the RGB rule passes it and the grey rule takes it.
const bareGrey = new Uint8Array(side * side);
{
    let s = 7, v = 128;
    for (let p = 0; p < bareGrey.length; p++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        v = Math.max(20, Math.min(235, v + Math.round((s / 2 ** 32 - 0.5) * 16)));
        bareGrey[p] = v;
    }
}
const bareGreyAlpha = new Uint8Array(side * side * 2);
for (let p = 0; p < side * side; p++) {
    bareGreyAlpha[2 * p] = bareGrey[p];
    bareGreyAlpha[2 * p + 1] = Math.round(255 * Math.min(1, Math.max(0, (26 - Math.hypot(p % side - 32, Math.floor(p / side) - 32)) / 4)));
}

const tail = "If it really is RGBA, pass { data, format: 'rgba' } to say so.";
const texts = (n) => ({
    rgb: `Invalid image: these ${n} bytes look like RGB (3 per pixel) or grey, not RGBA, and a bare Uint8Array is read as RGBA (4 per pixel). If it is RGB, pass { data, format: 'rgb' } (sharp's .raw() gives RGB for an image without alpha unless you add .ensureAlpha()). If it is grey (fast-png's decode() of a grey PNG), expand it to RGBA: format: 'rgb' would misread it too. ${tail}`,
    grey: `Invalid image: these ${n} bytes look like grey (1 per pixel), not RGBA, and a bare Uint8Array is read as RGBA (4 per pixel). fast-png's decode() gives this for a grey PNG (rows below 8 bits stay packed) and for a palette PNG's indices. Expand 8-bit grey to RGBA, or decode with something that gives RGBA (pngjs, or sharp with .ensureAlpha()); there is no grey format to pass. ${tail}`,
    greyAlpha: `Invalid image: these ${n} bytes look like grey and alpha (2 per pixel), not RGBA, and a bare Uint8Array is read as RGBA (4 per pixel). fast-png's decode() gives this for a grey PNG with alpha. Expand it to RGBA, or decode with something that gives RGBA (pngjs, or sharp with .ensureAlpha()); there is no grey format to pass. ${tail}`,
});
const cases = [
    ['RGB', bareRgb, texts('12,288').rgb],
    ['grey', bareGrey, texts('4,096').grey],
    ['grey and alpha', bareGreyAlpha, texts('8,192').greyAlpha],
];
const expected = (message) => ({ code: 'invalid-argument', argument: 'image', message });

describe('main entry', () => {
    for (const [name, image, message] of cases) {
        it(`rejects bare ${name} bytes with the exact text, on every call`, async () => {
            await expect(buildPalette(image, 8)).rejects.toMatchObject(expected(message));
            await expect(buildPalette(image, 8)).rejects.toMatchObject(expected(message));
        });
    }

    it('rejects from every function that takes an image, and from Clustering methods', async () => {
        const palette = await buildPalette(bareRgba, 4);
        const clustering = await buildClustering(bareRgba);
        const runs = [
            () => buildClustering(bareRgb),
            () => buildPalette(bareRgb, 4),
            () => buildSwatches(bareRgb, 4),
            () => quantize(bareRgb, 4),
            () => quantizeWithPalette(bareRgb, palette),
            () => quantizeToIndices(bareRgb, 4),
            () => quantizeToIndicesWithPalette(bareRgb, palette),
            () => clustering.quantize(bareRgb, 4),
            () => clustering.quantizeToIndices(bareRgb, 4),
        ];
        for (const run of runs) {await expect(run()).rejects.toMatchObject(expected(texts('12,288').rgb));}
        for (const [, image, message] of cases) {
            await expect(quantizeToIndices(image, 4)).rejects.toMatchObject(expected(message));
        }
    });

    it('reports the image before k and the options', async () => {
        await expect(buildPalette(bareRgb, 0)).rejects.toMatchObject({ argument: 'image' });
        await expect(buildPalette(bareRgb, 8, { bogus: 1 })).rejects.toMatchObject({ argument: 'image' });
    });

    it('reports an encoded file and a bad length with their own errors', async () => {
        const png = new Uint8Array(bareRgb.length + 8);
        png.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        png.set(bareRgb, 8);
        await expect(buildPalette(png, 8)).rejects.toMatchObject({ argument: 'image', message: expect.stringContaining('encoded PNG file') });
        await expect(buildPalette(bareRgb.subarray(0, bareRgb.length - 2), 8)).rejects.toMatchObject({ argument: 'image', message: expect.stringContaining('multiple of 4') });
        expect(bareRgba.length % 4).toBe(0);
        await expect(buildPalette(bareRgba.subarray(0, bareRgba.length - 2), 8)).rejects.toMatchObject({ argument: 'image', message: expect.stringContaining('multiple of 4') });
    });

    it('accepts the same bytes when they say what they are, and RGBA, ImageData and palettes-as-palettes', async () => {
        expect((await buildPalette({ data: bareRgb, format: 'rgba' }, 8)).length).toBeGreaterThan(0);
        expect((await buildPalette({ data: bareRgb, format: 'rgb' }, 8)).length).toBeGreaterThan(0);
        expect((await buildPalette(bareRgba, 8)).length).toBeGreaterThan(0);
        expect((await buildPalette(new ImageData(new Uint8ClampedArray(bareRgba), side, side), 8)).length).toBeGreaterThan(0);
        await expect(buildPalette(new Palette(bareRgb.subarray(0, 768)), 8)).rejects.toMatchObject({ message: expect.stringContaining('a palette, not pixels') });
        expect((await buildPalette(new Uint8Array(188), 8)).length).toBeGreaterThanOrEqual(0);
    });
});

describe('CommonJS build and first call', () => {
    it('rejects bare RGB with the same error as the ES build', async () => {
        const cjs = createRequire(import.meta.url)('../dist/index.cjs');
        await expect(cjs.buildPalette(bareRgb, 8)).rejects.toMatchObject(expected(texts('12,288').rgb));
    });

    it('rejects as the very first call of a freshly loaded module', () => {
        const url = new URL('../dist/index.mjs', import.meta.url).href;
        const source = `
import { buildPalette } from ${JSON.stringify(url)};
const rgb = new Uint8Array(64 * 64 * 3);
for (let p = 0; p < 64 * 64; p++) {const h = (p % 64) / 64; rgb.set([Math.round(255 * h), Math.round(255 * (1 - h)), Math.round(255 * Math.floor(p / 64) / 64)], p * 3);}
try {await buildPalette(rgb, 8); console.log(JSON.stringify(null));} catch (e) {console.log(JSON.stringify({code: e.code, argument: e.argument, message: e.message}));}
`;
        const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' }).trim().split('\n').pop());
        expect(out).toMatchObject({ code: 'invalid-argument', argument: 'image' });
        expect(out.message).toBe(texts('12,288').rgb);
    });
});

describe('worker entry', () => {
    it('rejects the same three layouts with the same message, code and argument, and posts nothing', async () => {
        const worker = createWorker();
        try {
            await worker.buildPalette(bareRgba, 4);
            const clustering = await worker.buildClustering(bareRgba);
            const palette = await worker.buildPalette(bareRgba, 4);
            const loaded = await worker.load(clustering);
            const post = vi.spyOn((await import('node:worker_threads')).Worker.prototype, 'postMessage');
            try {
                for (const [, image, message] of cases) {
                    const runs = [
                        () => worker.buildPalette(image, 8),
                        () => worker.buildClustering(image),
                        () => worker.quantize(image, 4),
                        () => worker.quantizeWithPalette(image, palette),
                        () => worker.cluster(image),
                        () => worker.cluster(image, { signal: AbortSignal.abort() }),
                        () => loaded.quantize(image, 4),
                    ];
                    for (const run of runs) {
                        let promise;
                        expect(() => {promise = run();}).not.toThrow();
                        await expect(promise).rejects.toMatchObject(expected(message));
                    }
                }
                expect(post).not.toHaveBeenCalled();
            } finally {
                post.mockRestore();
            }
            await loaded.release();
        } finally {
            await worker.terminate();
        }
    });

    it('leaves the caller\'s array intact when transfer: true is refused', async () => {
        const worker = createWorker({ transfer: true });
        try {
            const copy = bareRgb.slice();
            await expect(worker.buildPalette(copy, 8)).rejects.toMatchObject(expected(texts('12,288').rgb));
            expect(copy.byteLength).toBe(bareRgb.length);
            expect(copy).toEqual(bareRgb);
            expect((await worker.buildPalette({ data: bareRgb, format: 'rgba' }, 8)).length).toBeGreaterThan(0);
        } finally {
            await worker.terminate();
        }
    });
});
