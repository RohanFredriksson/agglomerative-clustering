import { describe, it, expect } from 'vitest';
import * as ac from '../dist/index.mjs';
import { getClustering, getPalette, getPaletteFromClustering, quantize, quantizeFromClustering, quantizeWithPalette, quantizeToIndicesWithPalette } from '../dist/index.mjs';

// A minimal valid 2x2 solid red RGBA image.
const validImage = new Uint8Array([
    255, 0, 0, 255,
    255, 0, 0, 255,
    255, 0, 0, 255,
    255, 0, 0, 255,
]);

describe('image input validation', () => {

    it('throws on null', async () => {
        await expect(getClustering(null)).rejects.toThrow();
    });

    it('throws on a plain array', async () => {
        await expect(getClustering([255, 0, 0, 255])).rejects.toThrow();
    });

    it('throws on object missing data', async () => {
        await expect(getClustering({ format: 'rgba' })).rejects.toThrow('Invalid image');
    });

    it('throws on object missing format', async () => {
        await expect(getClustering({ data: validImage })).rejects.toThrow('Invalid image');
    });

    it('throws when data is not Uint8Array or Uint8ClampedArray', async () => {
        await expect(getClustering({ data: [255, 0, 0, 255], format: 'rgba' })).rejects.toThrow('Invalid image data');
    });

    it('throws on unsupported format string', async () => {
        await expect(getClustering({ data: validImage, format: 'argb' })).rejects.toThrow('Invalid format');
    });

    it('accepts Uint8ClampedArray data', async () => {
        const clamped = { data: new Uint8ClampedArray(validImage), format: 'rgba' };
        await expect(getClustering(clamped)).resolves.toBeInstanceOf(Uint8Array);
    });

    it('accepts rgb format', async () => {
        const rgbImage = { data: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0]), format: 'rgb' };
        await expect(getClustering(rgbImage)).resolves.toBeInstanceOf(Uint8Array);
    });

});

describe('k validation', () => {

    it('throws on k = 0', async () => {
        await expect(getPalette(validImage, 0)).rejects.toThrow('Invalid k');
    });

    it('throws on negative k', async () => {
        await expect(getPalette(validImage, -1)).rejects.toThrow('Invalid k');
    });

    it('throws on non-integer k', async () => {
        await expect(getPalette(validImage, 1.5)).rejects.toThrow('Invalid k');
    });

    it('throws on string k', async () => {
        await expect(getPalette(validImage, '4')).rejects.toThrow('Invalid k');
    });

    it('throws on k = 0 for quantize', async () => {
        await expect(quantize(validImage, 0)).rejects.toThrow('Invalid k');
    });

    it('accepts k = 1', async () => {
        await expect(getPalette(validImage, 1)).resolves.toBeInstanceOf(Uint8Array);
    });

});

describe('image length validation', () => {

    it('throws when an rgba image is not a whole number of pixels', async () => {
        await expect(getClustering(new Uint8Array(6))).rejects.toThrow('multiple of 4');
        await expect(quantize({ data: new Uint8Array(7), format: 'rgba' }, 2)).rejects.toThrow('multiple of 4');
    });

    it('throws when an rgb image is not a whole number of pixels', async () => {
        await expect(getPalette({ data: new Uint8Array(4), format: 'rgb' }, 2)).rejects.toThrow('multiple of 3');
    });

});

describe('typed array views', () => {

    // Red pixels framed by green ones in the same buffer: a view of the middle must only see red.
    const backing = new Uint8ClampedArray(4 * 6);
    for (let p = 0; p < 6; p++) {backing.set(p >= 2 && p < 4 ? [255, 0, 0, 255] : [0, 255, 0, 255], p * 4);}
    const view = backing.subarray(8, 16);

    it('reads only the bytes of a Uint8ClampedArray subarray', async () => {
        expect(Array.from(await getPalette({ data: view, format: 'rgba' }, 4))).toEqual([255, 0, 0]);
    });

    it('quantizes only the bytes of a Uint8ClampedArray subarray', async () => {
        const result = await quantize({ data: view, format: 'rgba' }, 4);
        expect(Array.from(result.data)).toEqual(Array.from(view));
    });

});

describe('a palette passed where a clustering is expected', () => {

    it('is rejected for every palette size, instead of being mistaken for a clustering', async () => {
        // 1.x clusterings were recognised by their length alone, so palettes of 1, 3, 4, 6, 7, 9 ... colours used to be
        // accepted as clusterings and returned nonsense.
        for (let colours = 1; colours <= 70; colours++) {
            const palette = await getPalette(validImage, 4);
            const sized = new Uint8Array(colours * 3).map((_, i) => palette[i % palette.length]);
            await expect(getPaletteFromClustering(sized, 2), `${colours} colours`).rejects.toMatchObject({ code: 'invalid-clustering' });
            await expect(quantizeFromClustering(validImage, sized, 2), `${colours} colours`).rejects.toMatchObject({ code: 'invalid-clustering' });
        }
        await expect(getPaletteFromClustering(new Uint8Array(0), 2)).rejects.toMatchObject({ code: 'invalid-clustering' });
    });

});

describe('bare typed arrays', () => {

    it('explains what to do with a Uint8ClampedArray such as imageData.data', async () => {
        for (const bare of [new Uint8ClampedArray(16), new Float32Array(4), new Int8Array(8), new DataView(new ArrayBuffer(8))]) {
            const error = await getPalette(bare, 2).catch((e) => e);
            expect(error.code).toBe('invalid-argument');
            expect(error.message).toContain('ImageData');
            expect(error.message).toContain("format: 'rgba'");
        }
        await expect(getPalette(Buffer.alloc(16, 7), 2)).resolves.toBeInstanceOf(Uint8Array);        // a Node Buffer is a Uint8Array
    });

});

describe('options and image dimensions', () => {

    it('rejects options that are not an ordinary object, instead of ignoring them', async () => {
        for (const options of [new Map([['dither', true]]), new Date(0), new ArrayBuffer(8), new Uint8Array(4), new DataView(new ArrayBuffer(8)), /re/, () => ({}), 'dither', 5, true, null, [], new Set(['dither'])]) {
            await expect(getPalette(validImage, 4, options), String(options)).rejects.toMatchObject({ code: 'invalid-argument' });
            await expect(quantize(validImage, 4, options)).rejects.toMatchObject({ code: 'invalid-argument' });
        }
    });

    it('accepts class instances and objects without a prototype as options', async () => {
        class Settings {constructor() {this.precision = 6;}}
        const bare = Object.assign(Object.create(null), { precision: 6 });
        const expected = await getPalette(validImage, 4, { precision: 6 });
        expect(await getPalette(validImage, 4, new Settings())).toEqual(expected);
        expect(await getPalette(validImage, 4, bare)).toEqual(expected);
    });

    it('validates the width and height of a RawImage', async () => {
        const data = new Uint8Array(4 * 6);    // 6 pixels
        for (const bad of [{ width: -3 }, { width: 1.5 }, { width: NaN }, { width: '3' }, { height: -1 }, { height: 2.5 }, { width: 4, height: 3 }, { width: 2, height: 2 }]) {
            await expect(getPalette({ data, format: 'rgba', ...bad }, 2), JSON.stringify(bad)).rejects.toMatchObject({ code: 'invalid-argument' });
        }
        for (const good of [{}, { width: 3 }, { height: 2 }, { width: 3, height: 2 }, { width: 6, height: 1 }, { width: 0 }]) {
            await expect(getPalette({ data, format: 'rgba', ...good }, 2), JSON.stringify(good)).resolves.toBeInstanceOf(Uint8Array);
        }
        const mapped = await quantize({ data, format: 'rgba', width: 3, height: 2 }, 2);
        expect([mapped.width, mapped.height]).toEqual([3, 2]);
        // An empty image may be 0 x 0.
        await expect(getPalette({ data: new Uint8Array(0), format: 'rgba', width: 0, height: 0 }, 2)).resolves.toBeInstanceOf(Uint8Array);
    });

});

describe('palette validation', () => {

    it('throws when the palette is not bytes', async () => {
        await expect(quantizeWithPalette(validImage, 'ff0000')).rejects.toThrow('Invalid palette');
        await expect(quantizeWithPalette(validImage, null)).rejects.toThrow('Invalid palette');
    });

    it('throws when the palette is not whole RGB triples', async () => {
        await expect(quantizeWithPalette(validImage, new Uint8Array([255, 0, 0, 0]))).rejects.toThrow('multiple of 3');
    });

    it('rejects a plain array that is not flat bytes, instead of silently turning it into zeros or wrapping it', async () => {
        const threeColours = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];     // length 3: the shape gifenc and fast-png use
        for (const palette of [threeColours, ['255', '0', '0'], [1.5, 2, 3], [NaN, 0, 0], [300, 0, 0], [-5, 0, 0], [null, 0, 0], [undefined, 0, 0]]) {
            await expect(quantizeWithPalette(validImage, palette)).rejects.toMatchObject({ code: 'invalid-argument' });
            await expect(quantizeToIndicesWithPalette(validImage, palette)).rejects.toMatchObject({ code: 'invalid-argument' });
        }
        await expect(quantizeWithPalette(validImage, threeColours)).rejects.toThrow('not an array of [r, g, b] colours');
    });

    it('accepts Uint8ClampedArray and plain array palettes', async () => {
        const expected = await quantizeWithPalette(validImage, new Uint8Array([255, 0, 0, 0, 0, 255]));
        expect(await quantizeWithPalette(validImage, new Uint8ClampedArray([255, 0, 0, 0, 0, 255]))).toEqual(expected);
        expect(await quantizeWithPalette(validImage, [255, 0, 0, 0, 0, 255])).toEqual(expected);
    });

});

describe('an image object without a format', () => {
    it('says what to add', async () => {
        const error = await getPalette({ data: new Uint8ClampedArray(16), width: 2, height: 2 }, 3).catch((e) => e);
        expect(error.code).toBe('invalid-argument');
        expect(error.message).toContain("add format: 'rgba'");
    });
});

// Arguments are validated in the order they are given, so the error you get is always about the first wrong one, whatever
// else is wrong, and the same in every function.
describe('the order arguments are checked in', () => {
    const image = new Uint8Array(16).map((_, i) => i * 13);
    const bad = { image: 'not an image', clustering: new Uint8Array(5), palette: new Uint8Array(5), k: 0, options: { nope: 1 } };
    const message = { image: 'Invalid image', clustering: 'Invalid clustering', palette: 'Invalid palette', k: 'Invalid k', options: "Invalid option 'nope'" };
    let clustering, palette;
    const signatures = {
        getClustering: ['image', 'options'],
        getPalette: ['image', 'k', 'options'],
        getSwatches: ['image', 'k', 'options'],
        getPaletteFromClustering: ['clustering', 'k'],
        getSwatchesFromClustering: ['clustering', 'k'],
        quantize: ['image', 'k', 'options'],
        quantizeFromClustering: ['image', 'clustering', 'k', 'options'],
        quantizeWithPalette: ['image', 'palette', 'options'],
        quantizeToIndices: ['image', 'k', 'options'],
        quantizeToIndicesFromClustering: ['image', 'clustering', 'k', 'options'],
        quantizeToIndicesWithPalette: ['image', 'palette', 'options'],
    };

    it('reports the first wrong argument of every function', async () => {
        clustering = await getClustering(image);
        palette = await getPalette(image, 2);
        const good = { image, clustering, palette, k: 2, options: undefined };
        for (const [name, params] of Object.entries(signatures)) {
            for (let wrongFrom = 0; wrongFrom < params.length; wrongFrom++) {
                // Everything before `wrongFrom` is valid; it and everything after it are wrong.
                const args = params.map((param, i) => (i < wrongFrom ? good[param] : bad[param]));
                const error = await ac[name](...args).then(() => null, (e) => e);
                expect(error && error.message, `${name} with ${params[wrongFrom]} and the rest wrong`).toContain(message[params[wrongFrom]]);
            }
        }
    });
});

describe('width given twice', () => {
    const data = new Uint8Array(100 * 50 * 4).map((_, i) => (i * 7) & 255);
    const raw = { data, format: 'rgba', width: 100, height: 50 };
    const functions = {
        quantize: (image, options) => ac.quantize(image, 4, options),
        quantizeToIndices: (image, options) => ac.quantizeToIndices(image, 4, options),
        quantizeWithPalette: (image, options) => ac.quantizeWithPalette(image, new Uint8Array([0, 0, 0, 255, 255, 255]), options),
    };

    it('rejects an options.width that disagrees with the image, even one that divides the pixel count', async () => {
        for (const [name, run] of Object.entries(functions)) {
            const error = await run(raw, { dither: true, width: 50 }).catch((e) => e);
            expect(error.code, name).toBe('invalid-argument');
            expect(error.message, name).toContain("does not match the image's width (100)");
        }
    });

    it('accepts the same width twice, and a width for an image that has none', async () => {
        const same = await ac.quantize(raw, 4, { dither: true, width: 100 });
        expect(same.data).toEqual((await ac.quantize(raw, 4, { dither: true })).data);
        const bare = await ac.quantize(data, 4, { dither: true, width: 100 });
        expect(bare).toEqual(same.data);
    });
});
