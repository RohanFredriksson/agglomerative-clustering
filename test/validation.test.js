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
