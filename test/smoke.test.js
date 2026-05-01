import { describe, it, expect } from 'vitest';
import { getClustering, getPalette, getPaletteFromClustering, quantize } from '../dist/index.mjs';

// 2x2 solid red RGBA — 1 unique color, each appearing 4 times.
const solidRed2x2 = new Uint8Array([
    255, 0, 0, 255,
    255, 0, 0, 255,
    255, 0, 0, 255,
    255, 0, 0, 255,
]);

// 2x2 two-color RGBA — each color appears twice so both pass the histogram threshold.
const twoColor2x2 = new Uint8Array([
    255, 0,   0, 255,   // red
    0,   0, 255, 255,   // blue
    255, 0,   0, 255,   // red
    0,   0, 255, 255,   // blue
]);

describe('getClustering', () => {

    it('returns a non-empty Uint8Array', async () => {
        const result = await getClustering(solidRed2x2);
        expect(result).toBeInstanceOf(Uint8Array);
        expect(result.length).toBeGreaterThan(0);
    });

    // Clustering format: 3 + 9 * (uniqueColors - 1) bytes.
    it('returns 3 bytes for a solid image (1 unique color)', async () => {
        const result = await getClustering(solidRed2x2);
        expect(result.length).toBe(3);
    });

    it('returns 12 bytes for a 2-color image', async () => {
        const result = await getClustering(twoColor2x2);
        expect(result.length).toBe(12);
    });

});

describe('getPalette', () => {

    it('returns 3 bytes for k = 1', async () => {
        const result = await getPalette(solidRed2x2, 1);
        expect(result).toBeInstanceOf(Uint8Array);
        expect(result.length).toBe(3);
    });

    it('returns k * 3 bytes when image has enough unique colors', async () => {
        const k = 2;
        const result = await getPalette(twoColor2x2, k);
        expect(result.length).toBe(k * 3);
    });

    it('returns the correct color for a solid red image', async () => {
        const result = await getPalette(solidRed2x2, 1);
        expect(result[0]).toBe(255);  // R
        expect(result[1]).toBe(0);    // G
        expect(result[2]).toBe(0);    // B
    });

});

describe('getPaletteFromClustering', () => {

    it('returns 3 bytes for k = 1', async () => {
        const clustering = await getClustering(solidRed2x2);
        const result = await getPaletteFromClustering(clustering, 1);
        expect(result).toBeInstanceOf(Uint8Array);
        expect(result.length).toBe(3);
    });

    it('returns k * 3 bytes for a 2-color clustering', async () => {
        const clustering = await getClustering(twoColor2x2);
        const result = await getPaletteFromClustering(clustering, 2);
        expect(result.length).toBe(6);
    });

});

describe('quantize', () => {

    it('output length equals input length for RGBA', async () => {
        const result = await quantize(solidRed2x2, 1);
        expect(result.length).toBe(solidRed2x2.length);
    });

    it('output length equals input length for RGB', async () => {
        const rgbImage = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0]);
        const result = await quantize({ data: rgbImage, format: 'rgb' }, 1);
        expect(result.data.length).toBe(rgbImage.length);
    });

    it('quantizing a solid red image to k=1 returns all red pixels', async () => {
        const result = await quantize(solidRed2x2, 1);
        for (let i = 0; i < result.length; i += 4) {
            expect(result[i]).toBe(255);    // R
            expect(result[i + 1]).toBe(0);  // G
            expect(result[i + 2]).toBe(0);  // B
            // alpha is preserved from input
            expect(result[i + 3]).toBe(255);
        }
    });

});
