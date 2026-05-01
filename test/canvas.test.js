import { describe, it, expect } from 'vitest';
import { getClustering, getPalette, quantize, quantizeWithClustering, quantizeWithPalette } from '../dist/index.mjs';

// These tests cover the ImageData input path, which is polyfilled in test/setup.js
// via the `canvas` package so it works in Node.js.
//
// ImageData is always RGBA by the Canvas API spec, so the format is always 'rgba'.
//
// Determinism note: the algorithm merges the two closest colours first. When all
// pairwise distances are distinct there is only one possible merge order, so the
// quantisation result is fully determined. The "three-colour" fixture below is
// designed to exploit this property: dist²(black, near-black) ≈ 6.6 M whereas
// dist²(*, red) ≈ 4 B, so {black, near-black} must merge into centroid (5,0,0)
// before red is ever considered. This yields a single uniquely-optimal k=2 output.

// 2x2 solid red — 1 unique color.
const solidRedData = new Uint8ClampedArray([
    255, 0, 0, 255,
    255, 0, 0, 255,
    255, 0, 0, 255,
    255, 0, 0, 255,
]);

// 2x2 two-color — red and blue, each appearing twice.
const twoColorData = new Uint8ClampedArray([
    255, 0,   0, 255,
    0,   0, 255, 255,
    255, 0,   0, 255,
    0,   0, 255, 255,
]);

// 3x1 three-color — black, near-black, red (one pixel each).
// Only one optimal k=2 grouping: {black, near-black} + {red}.
// Merged centroid: uint16_to_uint8(merge(uint8_to_uint16(0), uint8_to_uint16(10))) = (5,0,0).
const threeColorData = new Uint8ClampedArray([
    0,   0, 0, 255,  // black
    10,  0, 0, 255,  // near-black
    255, 0, 0, 255,  // red
]);

const solidRedImageData  = new ImageData(solidRedData,  2, 2);
const twoColorImageData  = new ImageData(twoColorData,  2, 2);
const threeColorImageData = new ImageData(threeColorData, 3, 1);

describe('getClustering with ImageData', () => {

    it('accepts ImageData and returns a Uint8Array', async () => {
        const result = await getClustering(solidRedImageData);
        expect(result).toBeInstanceOf(Uint8Array);
        expect(result.length).toBeGreaterThan(0);
    });

    it('returns 3 bytes for a solid image (1 unique color)', async () => {
        const result = await getClustering(solidRedImageData);
        expect(result.length).toBe(3);
    });

    it('returns 12 bytes for a 2-color image', async () => {
        const result = await getClustering(twoColorImageData);
        expect(result.length).toBe(12);
    });

});

describe('getPalette with ImageData', () => {

    it('accepts ImageData and returns a Uint8Array', async () => {
        const result = await getPalette(solidRedImageData, 1);
        expect(result).toBeInstanceOf(Uint8Array);
    });

    it('returns 3 bytes for k = 1', async () => {
        const result = await getPalette(solidRedImageData, 1);
        expect(result.length).toBe(3);
    });

    it('returns the correct color for a solid red image', async () => {
        const result = await getPalette(solidRedImageData, 1);
        expect(result[0]).toBe(255); // R
        expect(result[1]).toBe(0);   // G
        expect(result[2]).toBe(0);   // B
    });

    it('returns k * 3 bytes when the image has enough unique colors', async () => {
        const result = await getPalette(twoColorImageData, 2);
        expect(result.length).toBe(6);
    });

});

describe('quantize with ImageData', () => {

    it('ImageData in → ImageData out', async () => {
        const result = await quantize(solidRedImageData, 1);
        expect(result).toBeInstanceOf(ImageData);
    });

    it('output preserves width and height', async () => {
        const result = await quantize(solidRedImageData, 1);
        expect(result.width).toBe(solidRedImageData.width);
        expect(result.height).toBe(solidRedImageData.height);
    });

    it('output data is Uint8ClampedArray (Canvas API spec)', async () => {
        const result = await quantize(solidRedImageData, 1);
        expect(result.data).toBeInstanceOf(Uint8ClampedArray);
    });

    it('output length equals input length', async () => {
        const result = await quantize(solidRedImageData, 1);
        expect(result.data.length).toBe(solidRedImageData.data.length);
    });

    it('quantizing a solid red image to k=1 returns all red pixels', async () => {
        const result = await quantize(solidRedImageData, 1);
        for (let i = 0; i < result.data.length; i += 4) {
            expect(result.data[i]).toBe(255);   // R
            expect(result.data[i + 1]).toBe(0); // G
            expect(result.data[i + 2]).toBe(0); // B
            expect(result.data[i + 3]).toBe(255); // A preserved
        }
    });

});

describe('quantizeWithClustering with ImageData', () => {

    it('ImageData in → ImageData out', async () => {
        const clustering = await getClustering(solidRedImageData);
        const result = await quantizeWithClustering(solidRedImageData, clustering, 1);
        expect(result).toBeInstanceOf(ImageData);
    });

    it('output preserves dimensions', async () => {
        const clustering = await getClustering(solidRedImageData);
        const result = await quantizeWithClustering(solidRedImageData, clustering, 1);
        expect(result.width).toBe(solidRedImageData.width);
        expect(result.height).toBe(solidRedImageData.height);
    });

    it('output data is Uint8ClampedArray', async () => {
        const clustering = await getClustering(solidRedImageData);
        const result = await quantizeWithClustering(solidRedImageData, clustering, 1);
        expect(result.data).toBeInstanceOf(Uint8ClampedArray);
    });

});

describe('quantizeWithPalette with ImageData', () => {

    it('ImageData in → ImageData out', async () => {
        const palette = await getPalette(solidRedImageData, 1);
        const result = await quantizeWithPalette(solidRedImageData, palette);
        expect(result).toBeInstanceOf(ImageData);
    });

    it('output preserves dimensions', async () => {
        const palette = await getPalette(solidRedImageData, 1);
        const result = await quantizeWithPalette(solidRedImageData, palette);
        expect(result.width).toBe(solidRedImageData.width);
        expect(result.height).toBe(solidRedImageData.height);
    });

    it('output data is Uint8ClampedArray', async () => {
        const palette = await getPalette(solidRedImageData, 1);
        const result = await quantizeWithPalette(solidRedImageData, palette);
        expect(result.data).toBeInstanceOf(Uint8ClampedArray);
    });

});

describe('quantize deterministic result with ImageData', () => {

    // The three-color fixture has one uniquely-optimal k=2 grouping (see header comment).
    // Centroid maths (all integer arithmetic matching the WASM implementation):
    //   uint8_to_uint16(x)  = x * 257          (because 255 * 257 = 65535)
    //   merge(0,0,0) and (2570,0,0) with equal weights → (1285, 0, 0)
    //   uint16_to_uint8(1285) = floor((1285*255 + 32767) / 65535) = floor(360442/65535) = 5
    // So the two palette colours are (5,0,0) and (255,0,0).

    it('black and near-black pixels are mapped to their cluster centroid (5,0,0)', async () => {
        const result = await quantize(threeColorImageData, 2);
        // pixel 0 — black (0,0,0) → nearest palette colour (5,0,0)
        expect(result.data[0]).toBe(5);
        expect(result.data[1]).toBe(0);
        expect(result.data[2]).toBe(0);
        expect(result.data[3]).toBe(255); // alpha preserved
        // pixel 1 — near-black (10,0,0) → nearest palette colour (5,0,0)
        expect(result.data[4]).toBe(5);
        expect(result.data[5]).toBe(0);
        expect(result.data[6]).toBe(0);
        expect(result.data[7]).toBe(255);
    });

    it('red pixel is mapped to itself (255,0,0)', async () => {
        const result = await quantize(threeColorImageData, 2);
        // pixel 2 — red (255,0,0) → nearest palette colour (255,0,0)
        expect(result.data[8]).toBe(255);
        expect(result.data[9]).toBe(0);
        expect(result.data[10]).toBe(0);
        expect(result.data[11]).toBe(255);
    });

    it('getPalette returns exactly {(5,0,0), (255,0,0)} for k=2', async () => {
        const palette = await getPalette(threeColorImageData, 2);
        expect(palette.length).toBe(6);
        // palette order is non-deterministic (unordered_set), so check as a set
        const colors = new Set();
        for (let i = 0; i < palette.length; i += 3) {
            colors.add(`${palette[i]},${palette[i + 1]},${palette[i + 2]}`);
        }
        expect(colors.has('5,0,0')).toBe(true);
        expect(colors.has('255,0,0')).toBe(true);
    });

});
