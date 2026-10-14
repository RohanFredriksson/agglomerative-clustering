import { describe, it, expect } from 'vitest';
import { getClustering, getPalette, getPaletteFromClustering, quantize, quantizeWithClustering, quantizeWithPalette } from '../dist/index.mjs';

// A 48x48 RGBA gradient with many distinct colours.
const width = 48, height = 48;
const gradient = new Uint8Array(width * height * 4);
for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        gradient[o] = Math.round(x / (width - 1) * 255);
        gradient[o + 1] = Math.round(y / (height - 1) * 255);
        gradient[o + 2] = (x * 5 + y * 3) % 256;
        gradient[o + 3] = 255;
    }
}

const colours = (palette) => {
    const list = [];
    for (let i = 0; i < palette.length; i += 3) {list.push((palette[i] << 16) | (palette[i + 1] << 8) | palette[i + 2]);}
    return list;
};

// Pixels of one colour and alpha, repeated `count` times.
const pixels = (count, r, g, b, a) => Array.from({ length: count }, () => [r, g, b, a]).flat();

describe('clustering header', () => {

    it('starts with the magic byte, version, colour space and precision', async () => {
        expect(Array.from((await getClustering(gradient)).subarray(0, 4))).toEqual([0xAC, 2, 0, 8]);
        expect(Array.from((await getClustering(gradient, { colorSpace: 'oklab', precision: 6 })).subarray(0, 4))).toEqual([0xAC, 2, 1, 6]);
    });

    it('still reads 1.x clusterings, which have no header', async () => {
        const clustering = await getClustering(gradient);
        const legacy = clustering.slice(4);
        for (const k of [1, 2, 7, 32, 200]) {
            const current = colours(await getPaletteFromClustering(clustering, k)).sort();
            const old = colours(await getPaletteFromClustering(legacy, k)).sort();
            expect(old).toEqual(current);
        }
        expect(await quantizeWithClustering(gradient, legacy, 12)).toEqual(await quantizeWithClustering(gradient, clustering, 12));
    });

    it('rejects things that are not clusterings', async () => {
        await expect(getPaletteFromClustering(new Uint8Array(5), 4)).rejects.toThrow('Invalid clustering');
        const wrongMagic = (await getClustering(gradient)).slice();
        wrongMagic[0] = 0;
        await expect(getPaletteFromClustering(wrongMagic, 4)).rejects.toThrow('Invalid clustering');
        await expect(getPaletteFromClustering([0xAC, 2, 0, 8], 4)).rejects.toThrow('Invalid clustering');
        await expect(quantizeWithClustering(gradient, new Uint8Array(8), 4)).rejects.toThrow('Invalid clustering');
    });

});

describe('split-order palettes', () => {

    it('start with the root colour and grow by refining one entry and appending one', async () => {
        const clustering = await getClustering(gradient);
        let previous = colours(await getPaletteFromClustering(clustering, 1));
        expect(previous).toHaveLength(1);
        for (let k = 2; k <= 64; k++) {
            const palette = colours(await getPaletteFromClustering(clustering, k));
            expect(palette).toHaveLength(k);
            const changed = previous.filter((c, i) => palette[i] !== c).length;
            expect(changed).toBeLessThanOrEqual(1);
            previous = palette;
        }
    });

    it('keep the dominant colour first', async () => {
        // 300 red, 100 green and 50 blue pixels: red is the heaviest branch at every cut.
        const image = new Uint8Array([...pixels(300, 220, 30, 30, 255), ...pixels(100, 30, 200, 30, 255), ...pixels(50, 30, 30, 220, 255)]);
        for (const k of [1, 2, 3]) {
            const [r, g, b] = await getPalette(image, k);
            expect(r).toBeGreaterThan(g);
            expect(r).toBeGreaterThan(b);
        }
        expect(Array.from(await getPalette(image, 3))).toEqual([220, 30, 30, 30, 200, 30, 30, 30, 220]);
    });

    it('map pixels the same whatever order a palette is given in', async () => {
        const palette = await getPalette(gradient, 24);
        const reversed = new Uint8Array(colours(palette).reverse().flatMap((c) => [c >> 16, (c >> 8) & 255, c & 255]));
        expect(await quantizeWithPalette(gradient, reversed)).toEqual(await quantizeWithPalette(gradient, palette));
    });

});

describe('quantizeWithClustering colour space', () => {

    it('defaults to the space the clustering was made in', async () => {
        const clustering = await getClustering(gradient, { colorSpace: 'oklab' });
        const inherited = await quantizeWithClustering(gradient, clustering, 16);
        expect(inherited).toEqual(await quantizeWithClustering(gradient, clustering, 16, { colorSpace: 'oklab' }));
    });

    it('can be overridden', async () => {
        const clustering = await getClustering(gradient, { colorSpace: 'oklab' });
        const palette = await getPaletteFromClustering(clustering, 16);
        expect(await quantizeWithClustering(gradient, clustering, 16, { colorSpace: 'rgb' })).toEqual(await quantizeWithPalette(gradient, palette, { colorSpace: 'rgb' }));
    });

});

describe('alpha weighting', () => {

    it('ignores fully transparent pixels', async () => {
        const image = new Uint8Array([...pixels(20, 200, 0, 0, 255), ...pixels(80, 0, 0, 0, 0)]);
        expect(Array.from(await getPalette(image, 4))).toEqual([200, 0, 0]);
        expect(colours(await getPalette(image, 4, { alpha: 'ignore' }))).toHaveLength(2);
    });

    it('clusters an image with transparent holes exactly like its visible pixels alone', async () => {
        const holes = new Uint8Array(gradient);
        const visible = [];
        for (let i = 0; i < holes.length; i += 4) {
            if ((i >> 2) % 5 === 0) {holes[i + 3] = 0;} else {visible.push(...holes.subarray(i, i + 4));}
        }
        expect(Array.from((await getClustering(holes)).subarray(4))).toEqual(Array.from((await getClustering(new Uint8Array(visible))).subarray(4)));
    });

    it('gives an empty palette for a fully transparent image', async () => {
        const image = new Uint8Array(pixels(16, 10, 20, 30, 0));
        expect((await getClustering(image)).length).toBe(4);
        expect((await getPalette(image, 4)).length).toBe(0);
        const result = await quantize(image, 4);
        expect(result.length).toBe(image.length);
        for (let i = 3; i < result.length; i += 4) {expect(result[i]).toBe(0);}
    });

    it('counts semi-transparent pixels in proportion to their opacity', async () => {
        // As many faint blue pixels as opaque red ones: weighted, the single colour leans to red.
        const image = new Uint8Array([...pixels(50, 240, 0, 0, 255), ...pixels(50, 0, 0, 240, 25)]);
        const [wr, , wb] = await getPalette(image, 1);
        const [ir, , ib] = await getPalette(image, 1, { alpha: 'ignore' });
        expect(wr).toBeGreaterThan(wb);
        expect(Math.abs(ir - ib)).toBeLessThanOrEqual(1);
    });

    it('leaves opaque images exactly as with alpha ignored', async () => {
        expect(await getClustering(gradient)).toEqual(await getClustering(gradient, { alpha: 'ignore' }));
    });

    it('does not apply to rgb data', async () => {
        const rgb = { data: new Uint8Array([10, 20, 30, 10, 20, 30, 200, 100, 0]), format: 'rgb' };
        expect(await getClustering(rgb)).toEqual(await getClustering(rgb, { alpha: 'ignore' }));
    });

    it('preserves alpha when quantizing', async () => {
        const image = new Uint8Array(gradient);
        for (let i = 3; i < image.length; i += 4) {image[i] = (i * 7) % 256;}
        const result = await quantize(image, 8);
        for (let i = 3; i < image.length; i += 4) {expect(result[i]).toBe(image[i]);}
    });

    it('rejects unknown modes', async () => {
        await expect(getClustering(gradient, { alpha: 'premultiply' })).rejects.toThrow('Invalid alpha');
        await expect(quantizeWithPalette(gradient, new Uint8Array([0, 0, 0]), { alpha: 'weight' })).rejects.toThrow("Invalid option 'alpha'");
    });

});
