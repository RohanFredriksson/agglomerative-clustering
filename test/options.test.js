import { describe, it, expect } from 'vitest';
import { getClustering, getPalette, getPaletteFromClustering, quantize, quantizeWithClustering, quantizeWithPalette } from '../dist/index.mjs';

// A smooth 64x64 RGBA gradient: many distinct colours, so palettes, binning and dithering all have work to do.
const width = 64, height = 64;
const gradient = new Uint8Array(width * height * 4);
for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        gradient[o] = Math.round(x / (width - 1) * 255);
        gradient[o + 1] = Math.round(y / (height - 1) * 255);
        gradient[o + 2] = 96 + ((x * 7 + y * 3) % 64);
        gradient[o + 3] = 255;
    }
}

const colours = (data, channels = 4) => {
    const set = new Set();
    for (let i = 0; i < data.length; i += channels) {set.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);}
    return set;
};

const paletteSet = (palette) => colours(palette, 3);

const meanColour = (data) => {
    const sum = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) {for (let c = 0; c < 3; c++) {sum[c] += data[i + c];}}
    return sum.map((s) => s / (data.length / 4));
};

describe('options validation', () => {

    it('throws on a non-object', async () => {
        await expect(getClustering(gradient, 'oklab')).rejects.toThrow('Invalid options');
    });

    it('throws on an unknown option, naming it', async () => {
        await expect(getClustering(gradient, { colourSpace: 'oklab' })).rejects.toThrow("Invalid option 'colourSpace'");
    });

    it('throws on an option the function does not take', async () => {
        await expect(getClustering(gradient, { dither: true })).rejects.toThrow("Invalid option 'dither'");
        await expect(quantizeWithPalette(gradient, new Uint8Array([0, 0, 0]), { precision: 6 })).rejects.toThrow("Invalid option 'precision'");
    });

    it('throws on an unknown colorSpace', async () => {
        await expect(getClustering(gradient, { colorSpace: 'lab' })).rejects.toThrow('Invalid colorSpace');
    });

    it('throws on precision out of range or not an integer', async () => {
        for (const precision of [0, 9, 4.5, '6']) {
            await expect(getClustering(gradient, { precision })).rejects.toThrow('Invalid precision');
        }
    });

    it('throws on dither out of range', async () => {
        for (const dither of [-0.1, 1.5, 'yes']) {
            await expect(quantize(gradient, 8, { dither, width })).rejects.toThrow('Invalid dither');
        }
    });

    it('throws when dithering without a width', async () => {
        await expect(quantize(gradient, 8, { dither: true })).rejects.toThrow('Invalid width');
    });

    it('throws when the width does not divide the pixel count', async () => {
        await expect(quantize(gradient, 8, { dither: true, width: 60 })).rejects.toThrow('not a multiple');
    });

});

describe('default options', () => {

    it('match passing no options', async () => {
        const plain = await getClustering(gradient);
        expect(await getClustering(gradient, {})).toEqual(plain);
        expect(await getClustering(gradient, { colorSpace: 'rgb', precision: 8 })).toEqual(plain);
        expect(await quantize(gradient, 16, { dither: false })).toEqual(await quantize(gradient, 16));
    });

});

describe('colorSpace: oklab', () => {

    it('gives a palette of k colours', async () => {
        const palette = await getPalette(gradient, 16, { colorSpace: 'oklab' });
        expect(palette.length).toBe(16 * 3);
    });

    it('is deterministic', async () => {
        const a = await getClustering(gradient, { colorSpace: 'oklab' });
        const b = await getClustering(gradient, { colorSpace: 'oklab' });
        expect(a).toEqual(b);
    });

    it('differs from rgb clustering', async () => {
        expect(await getClustering(gradient, { colorSpace: 'oklab' })).not.toEqual(await getClustering(gradient));
    });

    it('quantizes to colours from its own palette', async () => {
        const clustering = await getClustering(gradient, { colorSpace: 'oklab' });
        const palette = paletteSet(await getPaletteFromClustering(clustering, 12));
        const result = await quantizeWithClustering(gradient, clustering, 12, { colorSpace: 'oklab' });
        for (const colour of colours(result)) {expect(palette.has(colour)).toBe(true);}
    });

    it('keeps a single colour exact', async () => {
        const red = new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255]);
        expect(Array.from(await getPalette(red, 4, { colorSpace: 'oklab' }))).toEqual([255, 0, 0]);
    });

});

describe('precision', () => {

    it('bounds the clustering by the number of bins', async () => {
        // 3 bits per channel leaves at most 8^3 = 512 bins, so at most 511 merges.
        const clustering = await getClustering(gradient, { precision: 3 });
        const merges = (clustering.length - 3) / 9;
        expect(merges).toBeLessThan(512);
        expect(merges).toBeLessThan(colours(gradient).size - 1);
    });

    it('still gives a full palette', async () => {
        const palette = await getPalette(gradient, 32, { precision: 5 });
        expect(palette.length).toBe(32 * 3);
    });

    it('works with quantize', async () => {
        const result = await quantize(gradient, 16, { precision: 4 });
        expect(result.length).toBe(gradient.length);
        expect(colours(result).size).toBeLessThanOrEqual(16);
    });

});

describe('dither', () => {

    const palette = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0, 255]);

    it('only uses palette colours', async () => {
        const result = await quantizeWithPalette(gradient, palette, { dither: true, width });
        const allowed = paletteSet(palette);
        for (const colour of colours(result)) {expect(allowed.has(colour)).toBe(true);}
    });

    it('keeps the mean colour closer to the original than plain mapping', async () => {
        const original = meanColour(gradient);
        const error = (data) => meanColour(data).reduce((sum, v, c) => sum + (v - original[c]) ** 2, 0);
        const plain = await quantizeWithPalette(gradient, palette);
        const dithered = await quantizeWithPalette(gradient, palette, { dither: true, width });
        expect(error(dithered)).toBeLessThan(error(plain));
    });

    it('changes the output, and a strength of 0 does not', async () => {
        const plain = await quantize(gradient, 8);
        expect(await quantize(gradient, 8, { dither: 1, width })).not.toEqual(plain);
        expect(await quantize(gradient, 8, { dither: 0 })).toEqual(plain);
    });

    it('preserves alpha and leaves fully transparent pixels undithered', async () => {
        const image = new Uint8Array(gradient);
        for (let i = 3; i < image.length; i += 4) {image[i] = (i >> 2) % 3 === 0 ? 0 : 200;}
        const plain = await quantizeWithPalette(image, palette);
        const result = await quantizeWithPalette(image, palette, { dither: true, width });
        for (let i = 3; i < image.length; i += 4) {
            expect(result[i]).toBe(image[i]);
            if (image[i] === 0) {expect(Array.from(result.subarray(i - 3, i))).toEqual(Array.from(plain.subarray(i - 3, i)));}
        }
    });

    it('takes the width from a RawImage and passes it through', async () => {
        const result = await quantize({ data: gradient, format: 'rgba', width, height }, 8, { dither: true });
        expect(result.width).toBe(width);
        expect(result.height).toBe(height);
    });

    it('takes the width from ImageData', async () => {
        const image = new ImageData(new Uint8ClampedArray(gradient), width, height);
        const result = await quantize(image, 8, { dither: true });
        expect(result).toBeInstanceOf(ImageData);
        expect(result.width).toBe(width);
        expect(Array.from(result.data)).not.toEqual(Array.from((await quantize(image, 8)).data));
    });

    it('works on rgb data', async () => {
        const rgb = new Uint8Array(width * height * 3);
        for (let p = 0; p < width * height; p++) {for (let c = 0; c < 3; c++) {rgb[p * 3 + c] = gradient[p * 4 + c];}}
        const result = await quantize({ data: rgb, format: 'rgb', width }, 8, { dither: true });
        expect(result.data.length).toBe(rgb.length);
    });

});
