// `transparent: true` or a cutoff on a format with no alpha is an error, in both entries; a clustering's stored cutoff
// used as the default, `false` and either `alpha` value never are.
import { describe, it, expect, afterAll } from 'vitest';
import * as ac from '../dist/index.mjs';
import { createWorker } from '../dist/worker.mjs';

const worker = createWorker();
afterAll(() => worker.terminate());

const pixels = 64;
const bytes = (n) => new Uint8Array(pixels * n).map((_, i) => (i * 37 + (i >> 3) * 11) % 256);
const make = (format) => ({ data: bytes(format === 'rgb' ? 3 : 4), format });
const noAlpha = ['rgb', 'rgbx', 'bgrx'];
const hint = " If the fourth byte really is alpha, use 'rgba' or 'bgra'.";
const message = (format) => `Invalid transparent: '${format}' has no alpha, so no pixel can be transparent. Leave transparent out (false is accepted).${format === 'rgb' ? '' : hint}`;

const clustering = await ac.buildClustering(make('rgba'), { transparent: true });
const palette = await ac.buildPalette(make('rgb'), 4);

const functions = {
    buildClustering: (m, image, o) => m.buildClustering(image, o),
    buildPalette: (m, image, o) => m.buildPalette(image, 4, o),
    buildSwatches: (m, image, o) => m.buildSwatches(image, 4, o),
    quantize: (m, image, o) => m.quantize(image, 4, o),
    quantizeToIndices: (m, image, o) => m.quantizeToIndices(image, 4, o),
    quantizeToIndicesWithPalette: (m, image, o) => m.quantizeToIndicesWithPalette(image, palette, o),
    'clustering.quantizeToIndices': (m, image, o) => clustering.quantizeToIndices(image, 4, o),
};

const entries = { main: ac, worker };

describe.each(Object.keys(entries))('transparent on a format without alpha (%s entry)', (entry) => {
    const m = entries[entry];
    for (const [name, run] of Object.entries(functions)) {
        if (entry === 'worker' && name.startsWith('clustering.')) {continue;}
        for (const format of noAlpha) {
            it(`${name} with ${format}: true and a cutoff throw, the rest resolve`, async () => {
                for (const transparent of [true, 128]) {
                    const error = await run(m, make(format), { transparent }).then(() => null, (e) => e);
                    expect(error, String(transparent)).toBeInstanceOf(Error);
                    expect(error.message).toBe(message(format));
                    expect(error.code).toBe('invalid-argument');
                    expect(error.argument).toBe('options.transparent');
                }
                const options = name === 'quantizeToIndicesWithPalette' || name === 'clustering.quantizeToIndices' ? [{ transparent: false }, undefined] : [{ transparent: false }, { alpha: 'weight' }, { alpha: 'ignore' }, undefined];
                for (const option of options) {
                    await expect(run(m, make(format), option)).resolves.toBeDefined();
                }
            });
        }
        it(`${name} with rgba and bgra and transparent: true resolve`, async () => {
            for (const format of ['rgba', 'bgra']) {
                await expect(run(m, make(format), { transparent: true })).resolves.toBeDefined();
            }
        });
    }

    it('transparent: 0 on rgb keeps the value message', async () => {
        const error = await m.quantize(make('rgb'), 4, { transparent: 0 }).then(() => null, (e) => e);
        expect(error.message).toBe('Invalid transparent: must be a boolean or an integer alpha cutoff from 1 to 255.');
        expect(error.argument).toBe('options.transparent');
    });
});

describe('a stored cutoff is not an option', () => {
    it('clustering from RGBA with transparent, then an RGB image with no options', async () => {
        await expect(clustering.quantizeToIndices(make('rgb'), 8)).resolves.toBeDefined();
        await expect(clustering.quantize(make('rgb'), 8)).resolves.toBeDefined();
    });
    it('shared options { transparent: false, alpha: "ignore" } with rgb', async () => {
        await expect(ac.quantize(make('rgb'), 4, { transparent: false, alpha: 'ignore' })).resolves.toBeDefined();
    });
});

describe('worker handles', () => {
    const rejects = async (promise, format) => {
        const error = await promise.then(() => null, (e) => e);
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe(message(format));
        expect(error.code).toBe('invalid-argument');
        expect(error.argument).toBe('options.transparent');
    };
    it('a clustering handle and a loaded handle give the same errors', async () => {
        for (const format of noAlpha) {
            const handle = await worker.cluster(make(format));
            await rejects(handle.quantizeToIndices(8, { transparent: true }), format);
            await handle.quantizeToIndices(8, { transparent: false });
            handle.close?.();
            const loaded = await worker.load(clustering);
            await rejects(loaded.quantizeToIndices(make(format), 8, { transparent: true }), format);
            await expect(loaded.quantizeToIndices(make(format), 8)).resolves.toBeDefined();
            loaded.close?.();
        }
    });
});
