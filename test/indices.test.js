import { describe, it, expect } from 'vitest';
import {
    getClustering, getPalette, getPaletteFromClustering, quantize, quantizeFromClustering, quantizeWithPalette,
    quantizeToIndices, quantizeToIndicesFromClustering, quantizeToIndicesWithPalette,
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
            expect(result.transparentIndex).toBeNull();
        }
    });

    it.each(cases)('quantizeToIndicesFromClustering, %s', async (_, options) => {
        const clustering = await getClustering(image, { colorSpace: 'oklab' });
        const result = await quantizeToIndicesFromClustering(image, clustering, 24, options);
        expect(result.palette).toEqual(await getPaletteFromClustering(clustering, 24));
        expect(expand(result, image)).toEqual(await quantizeFromClustering(image, clustering, 24, options));
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
        expect([(await quantizeToIndicesWithPalette(opaque, palette(256))).indexBits, medium.indexBits, large.indexBits]).toEqual([8, 16, 32]);
        expect(expand(large, opaque)).toEqual(await quantizeWithPalette(opaque, palette(65537)));
    });

});

describe('transparent', () => {

    // The colours quantizeToIndices picked (without the transparent entry).
    const colours = (result) => result.palette.subarray(0, result.transparentIndex === null ? result.palette.length : result.transparentIndex * 3);

    it('maps every pixel to its nearest colour by default, whatever its alpha', async () => {
        const result = await quantizeToIndices(image, 8);
        expect(result.transparentIndex).toBeNull();
        expect(result.palette.length).toBe(24);
    });

    it('gives pixels with alpha below 128 an extra entry after the palette when true', async () => {
        const result = await quantizeToIndices(image, 8, { transparent: true });
        expect(result.transparentIndex).toBe(8);
        expect(Array.from(result.palette.subarray(24))).toEqual([0, 0, 0]);
        const mapped = await quantizeToIndicesWithPalette(image, colours(result));
        for (let p = 0; p < width * height; p++) {
            expect(result.indices[p]).toBe(image[p * 4 + 3] < 128 ? 8 : mapped.indices[p]);
        }
    });

    it('takes the cutoff from a number: pixels below it are transparent, the rest opaque', async () => {
        const countTransparent = async (transparent) => {
            const result = await quantizeToIndices(image, 8, { transparent });
            return Array.from(result.indices).filter((index) => index === result.transparentIndex).length;
        };
        const expected = (below) => { let n = 0; for (let p = 0; p < width * height; p++) {n += image[p * 4 + 3] < below;} return n; };
        expect(await countTransparent(1)).toBe(expected(1));
        expect(await countTransparent(128)).toBe(expected(128));
        expect(await countTransparent(129)).toBe(expected(129));
        expect(expected(129)).toBeGreaterThan(expected(128));
        expect(await countTransparent(true)).toBe(expected(128));
    });

    it('leaves pixels below the cutoff out of the palette, and counts the rest whole', async () => {
        const result = await quantizeToIndices(image, 8, { transparent: true });
        const visible = [];
        for (let p = 0; p < width * height; p++) {
            if (image[p * 4 + 3] >= 128) {visible.push(image[p * 4], image[p * 4 + 1], image[p * 4 + 2], 255);}
        }
        expect(colours(result)).toEqual(await getPalette(Uint8Array.from(visible), 8));
    });

    it('does not depend on the colours of pixels below the cutoff, with or without dithering', async () => {
        const scrambled = image.slice();
        for (let p = 0; p < width * height; p++) {
            if (image[p * 4 + 3] < 128) {scrambled.set([(p * 37) & 255, (p * 91) & 255, (p * 13) & 255], p * 4);}
        }
        for (const options of [{}, { dither: true, width }, { colorSpace: 'oklab', dither: 0.5, width }]) {
            expect(await quantizeToIndices(scrambled, 8, { transparent: true, ...options })).toEqual(await quantizeToIndices(image, 8, { transparent: true, ...options }));
        }
    });

    it('needs a wider index type when the extra entry makes 257', async () => {
        const result = await quantizeToIndicesWithPalette(image, (await getPalette(opaque, 256)), { transparent: true });
        expect(result.palette.length).toBe(257 * 3);
        expect(result.indices).toBeInstanceOf(Uint16Array);
        expect(result.transparentIndex).toBe(256);
    });

    it('adds no entry when no pixel is below the cutoff, or for rgb data', async () => {
        const result = await quantizeToIndices(opaque, 8, { transparent: true });
        expect(result.transparentIndex).toBeNull();
        expect(result.palette).toEqual(await getPalette(opaque, 8));
        const rgb = { data: new Uint8Array(12).fill(9), format: 'rgb' };
        expect((await quantizeToIndices(rgb, 4, { transparent: true })).transparentIndex).toBeNull();
        expect((await quantizeToIndices(image, 8, { transparent: 1 })).transparentIndex).toBe(8);
    });

});

describe('edge cases and options', () => {

    it('an empty image gives an empty palette and no indices', async () => {
        for (const options of [{}, { transparent: true }, { dither: true, width: 1 }]) {
            const result = await quantizeToIndices(new Uint8Array(0), 4, options);
            expect(result.palette.length).toBe(0);
            expect(result.indices.length).toBe(0);
            expect(result.transparentIndex).toBeNull();
        }
    });

    it('an image with no visible pixels maps to a single black entry, as quantize does', async () => {
        const hidden = new Uint8Array(16);
        const result = await quantizeToIndices(hidden, 4);
        expect(Array.from(result.palette)).toEqual([0, 0, 0]);
        expect(Array.from(result.indices)).toEqual([0, 0, 0, 0]);
    });

    it('with transparent, an image with no visible pixels has just the transparent entry', async () => {
        const hidden = new Uint8Array(16);
        for (const options of [{}, { dither: true, width: 2 }, { colorSpace: 'oklab' }]) {
            const slotted = await quantizeToIndices(hidden, 4, { transparent: true, ...options });
            expect(Array.from(slotted.palette)).toEqual([0, 0, 0]);
            expect(slotted.transparentIndex).toBe(0);
            expect(Array.from(slotted.indices)).toEqual([0, 0, 0, 0]);
        }
        const withClustering = await quantizeToIndicesFromClustering(hidden, await getClustering(hidden), 4, { transparent: true });
        expect([Array.from(withClustering.palette), withClustering.transparentIndex]).toEqual([[0, 0, 0], 0]);
    });

    it('a user palette that is empty still gets a placeholder for visible pixels', async () => {
        const visible = new Uint8Array([10, 20, 30, 255, 0, 0, 0, 0]);
        const result = await quantizeToIndicesWithPalette(visible, new Uint8Array(0), { transparent: true });
        expect(Array.from(result.palette)).toEqual([0, 0, 0, 0, 0, 0]);
        expect(result.transparentIndex).toBe(1);
        expect(Array.from(result.indices)).toEqual([0, 1]);
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

    it('validates transparent, and only the indexed functions accept it', async () => {
        for (const bad of [0, 256, -1, 1.5, '128', null, NaN]) {
            await expect(quantizeToIndices(image, 4, { transparent: bad })).rejects.toThrow('Invalid transparent');
        }
        await expect(quantize(image, 4, { transparent: true })).rejects.toThrow("Invalid option 'transparent'");
        await expect(quantizeToIndicesWithPalette(image, new Uint8Array([0, 0]))).rejects.toThrow('Invalid palette');
        await expect(quantizeToIndicesFromClustering(image, new Uint8Array(5), 4)).rejects.toThrow('Invalid clustering');
    });

});
