// Palettes at very large k, where different clusters can share an 8-bit colour (their 16-bit centroids round to the same
// value). Kodak's kodim14 has such pairs from k = 50271. 3.0.0-beta.2 rejected its own clustering of that photo from
// k = 54469 (and the one-shot functions returned an empty palette), and 2.x's palettes there came out one colour short;
// the palette must be exactly the distinct colours of the k clusters.
import { describe, it, expect, beforeAll } from 'vitest';
import { buildClustering, buildPalette } from '../dist/index.mjs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../fixtures/kodak.js';
import { timeLimit } from './timeout.js';

let image, clustering, maxColors;
beforeAll(async () => {
    image = (await getImageRgba(await ensureImage(KODAK_IMAGES[13]))).rgba;
    clustering = await buildClustering(image);
    maxColors = (await clustering.getClusteringInfo()).maxColors;
}, timeLimit(120000));

// The colours of the k clusters, followed by index through the records' parent fields, independently of the library's cut.
const clusterColours = (k) => {
    const header = clustering[2], record = clustering[3];
    const key = (at) => (clustering[at] << 16) | (clustering[at + 1] << 8) | clustering[at + 2];
    const colours = [key(header)];
    for (let i = 0; i < Math.min(k, maxColors) - 1; i++) {
        const at = header + 3 + record * i;
        const parent = clustering[at + 9] | (clustering[at + 10] << 8) | (clustering[at + 11] << 16) | (clustering[at + 12] << 24);
        colours[parent] = key(at + 3);
        colours.push(key(at + 6));
    }
    return colours;
};
const paletteKeys = (palette) => Array.from({ length: palette.length / 3 }, (_, i) => (palette[3 * i] << 16) | (palette[3 * i + 1] << 8) | palette[3 * i + 2]);

describe('palettes at very large k (kodim14)', () => {

    it('has clusters that share a colour, so this tests something', () => {
        const colours = clusterColours(50271);
        expect(new Set(colours).size).toBeLessThan(colours.length);
    });

    it('cuts to exactly the distinct colours of the k clusters, at every size it is cut to', async () => {
        const sizes = [];
        for (let k = 50000; k <= maxColors; k += 499) {sizes.push(k);}
        sizes.push(50270, 50271, 53363, 54468, 54469, maxColors - 1, maxColors, maxColors + 5000);
        for (const k of sizes) {
            const palette = await clustering.getPalette(k);
            const keys = paletteKeys(palette);
            const expected = new Set(clusterColours(k));
            expect(keys.length, `k = ${k}`).toBe(expected.size);
            expect(new Set(keys).size, `k = ${k}: no colour twice`).toBe(keys.length);
            for (const key of keys) {expect(expected.has(key), `k = ${k}`).toBe(true);}
        }
    }, timeLimit(120000));

    it('gives the same palette from the image as from the clustering, and swatches and indices that agree', async () => {
        for (const k of [54469, maxColors]) {
            const palette = await clustering.getPalette(k);
            expect(await buildPalette(image, k)).toEqual(palette);
            const { palette: swatchPalette, shares } = await clustering.getSwatches(k);
            expect(swatchPalette).toEqual(palette);
            expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
            const indexed = await clustering.quantizeToIndices(image, k);
            expect(indexed.palette).toEqual(palette);
        }
    }, timeLimit(120000));

});
