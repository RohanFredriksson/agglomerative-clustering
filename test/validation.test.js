import { describe, it, expect } from 'vitest';
import { getClustering, getPalette, getPaletteFromClustering, quantize, quantizeWithClustering, quantizeWithPalette } from '../dist/index.mjs';

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

describe('palette validation', () => {

    it('throws when the palette is not bytes', async () => {
        await expect(quantizeWithPalette(validImage, 'ff0000')).rejects.toThrow('Invalid palette');
        await expect(quantizeWithPalette(validImage, null)).rejects.toThrow('Invalid palette');
    });

    it('throws when the palette is not whole RGB triples', async () => {
        await expect(quantizeWithPalette(validImage, new Uint8Array([255, 0, 0, 0]))).rejects.toThrow('multiple of 3');
    });

    it('accepts Uint8ClampedArray and plain array palettes', async () => {
        const expected = await quantizeWithPalette(validImage, new Uint8Array([255, 0, 0, 0, 0, 255]));
        expect(await quantizeWithPalette(validImage, new Uint8ClampedArray([255, 0, 0, 0, 0, 255]))).toEqual(expected);
        expect(await quantizeWithPalette(validImage, [255, 0, 0, 0, 0, 255])).toEqual(expected);
    });

});
