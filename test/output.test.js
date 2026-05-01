import { describe, it, expect } from 'vitest';
import { getClustering, getPalette, quantize, quantizeWithClustering, quantizeWithPalette } from '../dist/index.mjs';

// A 2x2 solid red RGBA image — each unique color appears at least twice so it
// reaches the histogram threshold and is included in clustering.
const solidRed2x2 = new Uint8Array([
    255, 0, 0, 255,
    255, 0, 0, 255,
    255, 0, 0, 255,
    255, 0, 0, 255,
]);

describe('quantize output type mirrors input type', () => {

    it('Uint8Array in → Uint8Array out', async () => {
        const result = await quantize(solidRed2x2, 1);
        expect(result).toBeInstanceOf(Uint8Array);
    });

    it('RawImage (rgba) in → RawImage (rgba) out', async () => {
        const input = { data: solidRed2x2, format: 'rgba' };
        const result = await quantize(input, 1);
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('format', 'rgba');
        expect(result.data).toBeInstanceOf(Uint8Array);
    });

    it('RawImage preserves format: rgb', async () => {
        const rgbData = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0]);
        const input = { data: rgbData, format: 'rgb' };
        const result = await quantize(input, 1);
        expect(result).toHaveProperty('format', 'rgb');
    });

    it('Uint8ClampedArray data in RawImage → Uint8Array in result', async () => {
        const input = { data: new Uint8ClampedArray(solidRed2x2), format: 'rgba' };
        const result = await quantize(input, 1);
        expect(result.data).toBeInstanceOf(Uint8Array);
    });

});

describe('quantizeWithClustering output type mirrors input type', () => {

    it('Uint8Array in → Uint8Array out', async () => {
        const clustering = await getClustering(solidRed2x2);
        const result = await quantizeWithClustering(solidRed2x2, clustering, 1);
        expect(result).toBeInstanceOf(Uint8Array);
    });

    it('RawImage in → RawImage out', async () => {
        const input = { data: solidRed2x2, format: 'rgba' };
        const clustering = await getClustering(solidRed2x2);
        const result = await quantizeWithClustering(input, clustering, 1);
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('format', 'rgba');
    });

});

describe('quantizeWithPalette output type mirrors input type', () => {

    it('Uint8Array in → Uint8Array out', async () => {
        const palette = await getPalette(solidRed2x2, 1);
        const result = await quantizeWithPalette(solidRed2x2, palette);
        expect(result).toBeInstanceOf(Uint8Array);
    });

    it('RawImage in → RawImage out', async () => {
        const input = { data: solidRed2x2, format: 'rgba' };
        const palette = await getPalette(solidRed2x2, 1);
        const result = await quantizeWithPalette(input, palette);
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('format', 'rgba');
    });

});
