import { describe, it, expect } from 'vitest';
import { getClustering, getPaletteFromClustering, getPaletteWeights, getClusteringInfo } from '../dist/index.mjs';

// Pixels of the given colours, each repeated `count` times, with alpha `alpha`.
function pixels(entries) {
    const out = [];
    for (const { rgb, count, alpha = 255 } of entries) {for (let i = 0; i < count; i++) {out.push(...rgb, alpha);}}
    return new Uint8Array(out);
}

// A 48x48 RGBA gradient with many distinct colours.
const width = 48, height = 48;
const gradient = new Uint8Array(width * height * 4);
for (let p = 0; p < width * height; p++) {
    const x = p % width, y = Math.floor(p / width);
    gradient.set([x * 5, y * 5, (x * y) % 256, 255], p * 4);
}

const byColour = (palette, weights) => Object.fromEntries(Array.from(weights, (w, i) => [Array.from(palette.subarray(i * 3, i * 3 + 3)).join(','), w]));

describe('getPaletteWeights', () => {

    const five = [
        { rgb: [250, 10, 10], count: 50 },
        { rgb: [10, 250, 10], count: 30 },
        { rgb: [10, 10, 250], count: 12 },
        { rgb: [250, 250, 10], count: 5 },
        { rgb: [10, 10, 10], count: 3 },
    ];

    it('gives each colour its pixel count when nothing is merged', async () => {
        const clustering = await getClustering(pixels(five));
        const weights = await getPaletteWeights(clustering, 5);
        expect(weights).toBeInstanceOf(Float64Array);
        expect(byColour(await getPaletteFromClustering(clustering, 5), weights)).toEqual(Object.fromEntries(five.map(({ rgb, count }) => [rgb.join(','), count])));
    });

    it('lines up with the palette and sums to the pixel count at every size', async () => {
        const clustering = await getClustering(gradient);
        for (const k of [1, 2, 3, 10, 100, 5000]) {
            const palette = await getPaletteFromClustering(clustering, k);
            const weights = await getPaletteWeights(clustering, k);
            expect(weights.length).toBe(palette.length / 3);
            expect(weights.reduce((a, b) => a + b, 0)).toBe(width * height);
            expect(Math.min(...weights)).toBeGreaterThan(0);
        }
        // Index 0 keeps the heavier half of every split it is in.
        const [first, second] = await getPaletteWeights(clustering, 2);
        expect(first).toBeGreaterThanOrEqual(second);
    });

    it('counts pixels by opacity, as clustering does', async () => {
        const image = pixels([
            { rgb: [250, 10, 10], count: 10 },
            { rgb: [10, 250, 10], count: 10, alpha: 51 },
            { rgb: [10, 10, 250], count: 10, alpha: 0 },
        ]);
        const clustering = await getClustering(image);
        const weights = byColour(await getPaletteFromClustering(clustering, 3), await getPaletteWeights(clustering, 3));
        expect(weights).toEqual({ '250,10,10': 10, '10,250,10': 2 });
        const ignored = await getClustering(image, { alpha: 'ignore' });
        expect(Array.from(await getPaletteWeights(ignored, 3))).toEqual([10, 10, 10]);
    });

    it('gives nothing for an empty clustering', async () => {
        expect((await getPaletteWeights(await getClustering(new Uint8Array(0)), 4)).length).toBe(0);
    });

    it('rejects a clustering whose records name an impossible parent', async () => {
        const clustering = new Uint8Array(await getClustering(gradient));
        clustering[16 + 9] = 200; // record 0's parent index, which must be 0
        await expect(getPaletteWeights(clustering, 4)).rejects.toThrow('weights are inconsistent');
    });

});

describe('getClusteringInfo', () => {

    it('describes the clustering', async () => {
        const info = await getClusteringInfo(await getClustering(gradient, { colorSpace: 'oklab', precision: 6 }));
        expect(info.version).toBe(3);
        expect(info.colorSpace).toBe('oklab');
        expect(info.precision).toBe(6);
        expect(info.totalWeight).toBe(width * height);
        expect(info.colors).toBe(info.errors.length);
        expect(info.colors).toBe((await getPaletteFromClustering(await getClustering(gradient, { colorSpace: 'oklab', precision: 6 }), 1e6)).length / 3);
    });

    it('gives an error curve that falls to 0 with every colour separate', async () => {
        const { errors, colors } = await getClusteringInfo(await getClustering(gradient));
        expect(errors[colors - 1]).toBe(0);
        for (let k = 1; k < colors; k++) {expect(errors[k]).toBeLessThanOrEqual(errors[k - 1]);}
    });

    it('starts at the variance of the image, per channel', async () => {
        const { errors } = await getClusteringInfo(await getClustering(gradient));
        let variance = 0;
        for (let c = 0; c < 3; c++) {
            let sum = 0, squares = 0;
            for (let p = 0; p < width * height; p++) {sum += gradient[p * 4 + c]; squares += gradient[p * 4 + c] ** 2;}
            variance += squares / (width * height) - (sum / (width * height)) ** 2;
        }
        expect(errors[0]).toBeCloseTo(variance / 3, 0);
    });

    it('describes an empty clustering', async () => {
        const info = await getClusteringInfo(await getClustering(new Uint8Array(0)));
        expect([info.colors, info.totalWeight, info.errors.length]).toEqual([0, 0, 0]);
    });

    it('rejects things that are not clusterings', async () => {
        await expect(getClusteringInfo(new Uint8Array(5))).rejects.toThrow('Invalid clustering');
    });

});
