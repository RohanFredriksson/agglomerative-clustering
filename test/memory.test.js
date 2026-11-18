// An image too big for WebAssembly's 2 GB must fail clearly, and must not leave the module unable to handle normal
// images afterwards (the aborted call's memory is never freed, so the instance is discarded). Slow and memory-hungry
// (about 10 s and 2 GB per case), so it runs once per Node version in CI.
import { describe, it, expect } from 'vitest';
import { getPalette } from '../dist/index.mjs';

const mulberry = (seed) => () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const normal = (() => {
    const rnd = mulberry(1), width = 500, height = 300, data = new Uint8Array(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {data.set([((i >> 2) % 251) + rnd() * 5, (i >> 4) % 241, (i >> 6) % 239, 255], i);}
    return { data, format: 'rgba', width, height };
})();

// 100 megapixels of random colours: about 16 million distinct colours, far more than 2 GB can cluster exactly.
const huge = () => {
    const rnd = mulberry(2), width = 10000, height = 10000, data = new Uint8Array(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {data.set([rnd() * 256, rnd() * 256, rnd() * 256, 255], i);}
    return { data, format: 'rgba', width, height };
};

describe('running out of memory', () => {

    it('fails with a coded error that says what to do, and later calls still work', async () => {
        const expected = await getPalette(normal, 16);
        const image = huge();
        const error = await getPalette(image, 16).catch((e) => e);
        expect(error.code).toBe('out-of-memory');
        expect(error.message).toContain('precision: 6');
        // A large image is told to shrink first (found by the sixth round: the advice was only precision, which may already be low).
        expect(error.message).toContain('Scale the image down');
        expect(await getPalette(normal, 16)).toEqual(expected);

        // The same through the sliced path used for signal and onProgress.
        const sliced = await getPalette(image, 16, { onProgress: () => {} }).catch((e) => e);
        expect(sliced.code).toBe('out-of-memory');
        expect(await getPalette(normal, 16)).toEqual(expected);
    }, 240000);

});
