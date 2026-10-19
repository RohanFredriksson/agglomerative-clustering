import { describe, it, expect } from 'vitest';
import {
    getClustering, getPalette, getPaletteFromClustering, quantize, quantizeWithClustering, quantizeWithPalette,
    quantizeToIndices, quantizeToIndicesWithClustering, quantizeToIndicesWithPalette,
} from '../dist/index.mjs';

const width = 48, height = 32;

// A colourful RGBA image with every kind of alpha: opaque, partial and fully transparent pixels.
const image = new Uint8Array(width * height * 4);
for (let p = 0; p < width * height; p++) {
    const x = p % width, y = Math.floor(p / width);
    image.set([x * 5, y * 8, (x * y) & 255, x % 7 === 0 ? 0 : x % 5 === 0 ? 128 : 255], p * 4);
}
const opaque = image.map((value, i) => i % 4 === 3 ? 255 : value);

// Rebuilds the mapped image from a palette and indices, copying alpha from `source`, to compare with quantize*.
function expand({ palette, indices }, source) {
    const out = new Uint8Array(source.length);
    for (let p = 0; p < indices.length; p++) {
        out.set(palette.subarray(indices[p] * 3, indices[p] * 3 + 3), p * 4);
        out[p * 4 + 3] = source[p * 4 + 3];
    }
    return out;
}

describe('indexed output matches the mapped image', () => {

    const cases = [
        ['defaults', {}],
        ['oklab', { colorSpace: 'oklab' }],
        ['dithered', { dither: true, width }],
        ['oklab, half dither', { colorSpace: 'oklab', dither: 0.5, width }],
    ];

    it.each(cases)('quantizeToIndices, %s', async (_, options) => {
        for (const k of [1, 2, 16, 200]) {
            const result = await quantizeToIndices(image, k, options);
            const clusterOptions = options.colorSpace ? { colorSpace: options.colorSpace } : {};
            expect(result.palette).toEqual(await getPalette(image, k, clusterOptions));
            expect(expand(result, image)).toEqual(await quantize(image, k, options));
            expect(result.indices.length).toBe(width * height);
            expect(result.transparentIndex).toBe(-1);
        }
    });

    it.each(cases)('quantizeToIndicesWithClustering, %s', async (_, options) => {
        const clustering = await getClustering(image, { colorSpace: 'oklab' });
        const result = await quantizeToIndicesWithClustering(image, clustering, 24, options);
        expect(result.palette).toEqual(await getPaletteFromClustering(clustering, 24));
        expect(expand(result, image)).toEqual(await quantizeWithClustering(image, clustering, 24, options));
    });

    it.each(cases)('quantizeToIndicesWithPalette, %s', async (_, options) => {
        const palette = await getPalette(opaque, 40);
        const result = await quantizeToIndicesWithPalette(image, palette, options);
        expect(result.palette).toEqual(palette);
        expect(expand(result, image)).toEqual(await quantizeWithPalette(image, palette, options));
    });

    it('works on rgb data', async () => {
        const rgb = new Uint8Array(width * height * 3);
        for (let p = 0; p < width * height; p++) {rgb.set(opaque.subarray(p * 4, p * 4 + 3), p * 3);}
        const result = await quantizeToIndices({ data: rgb, format: 'rgb' }, 8);
        expect(result.palette).toEqual(await getPalette(opaque, 8));
        expect(result.indices).toEqual((await quantizeToIndices(opaque, 8)).indices);
    });

});

describe('index types', () => {

    const palette = (n) => {
        const colours = new Uint8Array(n * 3);
        for (let i = 0; i < n; i++) {colours.set([i & 255, (i >> 8) & 255, (i * 37) & 255], i * 3);}
        return colours;
    };

    it('are Uint8Array up to 256 entries, Uint16Array up to 65536, Uint32Array above', async () => {
        expect((await quantizeToIndicesWithPalette(opaque, palette(256))).indices).toBeInstanceOf(Uint8Array);
        const medium = await quantizeToIndicesWithPalette(opaque, palette(257));
        expect(medium.indices).toBeInstanceOf(Uint16Array);
        expect(expand(medium, opaque)).toEqual(await quantizeWithPalette(opaque, palette(257)));
        const large = await quantizeToIndicesWithPalette(opaque, palette(65537));
        expect(large.indices).toBeInstanceOf(Uint32Array);
        expect(expand(large, opaque)).toEqual(await quantizeWithPalette(opaque, palette(65537)));
    });

});

describe('transparentIndex', () => {

    it('maps fully transparent pixels to their nearest colour by default', async () => {
        const result = await quantizeToIndices(image, 8);
        expect(result.transparentIndex).toBe(-1);
        expect(result.palette.length).toBe(24);
    });

    it('gives fully transparent pixels an extra entry after the palette', async () => {
        const plain = await quantizeToIndices(image, 8);
        const result = await quantizeToIndices(image, 8, { transparentIndex: true });
        expect(result.transparentIndex).toBe(8);
        expect(Array.from(result.palette)).toEqual([...plain.palette, 0, 0, 0]);
        for (let p = 0; p < width * height; p++) {
            expect(result.indices[p]).toBe(image[p * 4 + 3] === 0 ? 8 : plain.indices[p]);
        }
    });

    it('needs a wider index type when the extra entry makes 257', async () => {
        const result = await quantizeToIndicesWithPalette(image, (await getPalette(opaque, 256)), { transparentIndex: true });
        expect(result.palette.length).toBe(257 * 3);
        expect(result.indices).toBeInstanceOf(Uint16Array);
        expect(result.transparentIndex).toBe(256);
    });

    it('adds no entry when no pixel is fully transparent, or for rgb data', async () => {
        const result = await quantizeToIndices(opaque, 8, { transparentIndex: true });
        expect(result.transparentIndex).toBe(-1);
        expect(result.palette).toEqual(await getPalette(opaque, 8));
        const rgb = { data: new Uint8Array(12).fill(9), format: 'rgb' };
        expect((await quantizeToIndices(rgb, 4, { transparentIndex: true })).transparentIndex).toBe(-1);
    });

    it('also leaves transparent pixels out of dithering', async () => {
        const plain = await quantizeToIndices(image, 8, { dither: true, width });
        const result = await quantizeToIndices(image, 8, { dither: true, width, transparentIndex: true });
        for (let p = 0; p < width * height; p++) {
            expect(result.indices[p]).toBe(image[p * 4 + 3] === 0 ? 8 : plain.indices[p]);
        }
    });

});

describe('edge cases and options', () => {

    it('an empty image gives no indices', async () => {
        const result = await quantizeToIndices(new Uint8Array(0), 4);
        expect(result.indices.length).toBe(0);
    });

    it('an image with no visible pixels maps to a single black entry, as quantize does', async () => {
        const hidden = new Uint8Array(16);
        const result = await quantizeToIndices(hidden, 4);
        expect(Array.from(result.palette)).toEqual([0, 0, 0]);
        expect(Array.from(result.indices)).toEqual([0, 0, 0, 0]);
        const slotted = await quantizeToIndices(hidden, 4, { transparentIndex: true });
        expect(Array.from(slotted.palette)).toEqual([0, 0, 0, 0, 0, 0]);
        expect(slotted.transparentIndex).toBe(1);
        expect(Array.from(slotted.indices)).toEqual([1, 1, 1, 1]);
    });

    it('copies width and height from ImageData and RawImage, not from a bare Uint8Array', async () => {
        const fromImageData = await quantizeToIndices(new ImageData(new Uint8ClampedArray(image), width, height), 4);
        expect([fromImageData.width, fromImageData.height]).toEqual([width, height]);
        const fromRaw = await quantizeToIndices({ data: image, format: 'rgba', width }, 4);
        expect(fromRaw.width).toBe(width);
        expect('height' in fromRaw).toBe(false);
        const fromBytes = await quantizeToIndices(image, 4, { dither: true, width });
        expect('width' in fromBytes).toBe(false);
    });

    it('validates transparentIndex, and only the indexed functions accept it', async () => {
        await expect(quantizeToIndices(image, 4, { transparentIndex: 1 })).rejects.toThrow('Invalid transparentIndex');
        await expect(quantize(image, 4, { transparentIndex: true })).rejects.toThrow("Invalid option 'transparentIndex'");
        await expect(quantizeToIndicesWithPalette(image, new Uint8Array([0, 0]))).rejects.toThrow('Invalid palette');
        await expect(quantizeToIndicesWithClustering(image, new Uint8Array(5), 4)).rejects.toThrow('Invalid clustering');
    });

});
