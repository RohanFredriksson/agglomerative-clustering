// Runs the README's "Using the output" recipes against the real encoders, so the documentation can't drift from the API.
import { describe, it, expect } from 'vitest';
import * as gifenc from 'gifenc';
import { GifReader } from 'omggif';
import { encode as encodePng, decode as decodePng } from 'fast-png';
import { getClustering, getPaletteFromClustering, getSwatchesFromClustering, quantizeToIndices } from '../dist/index.mjs';


// gifenc is CommonJS with an ES build: named exports in bundlers, only a default export in plain Node ESM.
const GIFEncoder = gifenc.GIFEncoder ?? gifenc.default.GIFEncoder;

// A logo-like image: coloured discs with anti-aliased edges on a transparent background.
const width = 96, height = 72;
const data = new Uint8Array(width * height * 4);
const discs = [[30, 30, 24, [220, 50, 40]], [62, 36, 20, [40, 110, 220]], [48, 54, 16, [60, 200, 90]]];
for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
        let best = [0, 0, 0, 0];
        for (const [cx, cy, r, c] of discs) {
            const cover = Math.max(0, Math.min(1, r + 0.5 - Math.hypot(x - cx, y - cy)));
            if (cover * 255 > best[3]) {best = [...c, cover * 255];}
        }
        data.set(best.map(Math.round), (y * width + x) * 4);
    }
}
const image = { data, format: 'rgba', width, height };

const toColors = (palette) => Array.from({ length: palette.length / 3 }, (_, i) => [palette[3 * i], palette[3 * i + 1], palette[3 * i + 2]]);

describe('README recipes', () => {

    it('palette conversions and swatches with shares', async () => {
        const clustering = await getClustering(image);
        const { palette, weights, shares } = await getSwatchesFromClustering(clustering, 3);
        const colors = toColors(palette);
        const css = (i) => `rgb(${palette[3 * i]} ${palette[3 * i + 1]} ${palette[3 * i + 2]})`;
        const hex = (i) => (palette[3 * i] << 16) | (palette[3 * i + 1] << 8) | palette[3 * i + 2];
        const swatches = Array.from(shares, (share, i) => ({ color: css(i), share }));
        expect(colors).toEqual([[220, 50, 40], [40, 110, 220], [60, 200, 90]]);
        expect(swatches.map((s) => s.color)).toEqual(['rgb(220 50 40)', 'rgb(40 110 220)', 'rgb(60 200 90)']);
        expect(hex(0)).toBe(0xdc3228);
        expect(swatches.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 12);
        expect(swatches[0].share).toBeGreaterThan(swatches[2].share);
    });

    // The README's "Heaviest first" recipes. 40 red pixels and two similar blues of 30: in split order at three colours
    // the first entry is a blue (30 pixels) and the heaviest, red, is second.
    const split = (() => {
        const px = [];
        const add = (rgb, n) => {for (let i = 0; i < n; i++) {px.push(...rgb, 255);}};
        add([255, 0, 0], 40); add([0, 0, 255], 30); add([20, 20, 235], 30);
        return { data: new Uint8Array(px), format: 'rgba', width: 10, height: 10 };
    })();

    it('heaviest first for a palette and its weights', async () => {
        const clustering = await getClustering(split);
        const { palette, weights, shares } = await getSwatchesFromClustering(clustering, 3);
        const colors = toColors(palette);
        expect(Array.from(weights)).toEqual([30, 40, 30]);                       // split order: not heaviest first

        const order = Array.from(weights.keys()).sort((a, b) => weights[b] - weights[a]);
        const rankedColors = order.map((i) => colors[i]);
        const rankedShares = order.map((i) => shares[i]);
        expect(rankedColors[0]).toEqual([255, 0, 0]);
        expect(rankedShares).toEqual([0.4, 0.3, 0.3]);
        expect(rankedColors.length).toBe(colors.length);
    });

    it('heaviest first for an indexed image, with its transparent entry', async () => {
        for (const [source, options] of [[split, {}], [image, { transparent: true }]]) {
            const { palette, indices, transparentIndex } = await quantizeToIndices(source, source === split ? 3 : 12, options);
            const colors = toColors(palette);

            const used = new Uint32Array(palette.length / 3);
            for (const index of indices) {used[index]++;}
            const byUse = Array.from(used.keys()).sort((a, b) => used[b] - used[a]);
            const rank = new Uint32Array(used.length);
            byUse.forEach((old, position) => {rank[old] = position;});
            const rankedPalette = byUse.map((old) => colors[old]);
            const rankedIndices = indices.map((index) => rank[index]);
            const rankedTransparentIndex = transparentIndex === null ? null : rank[transparentIndex];

            // Same picture: every pixel still has the same colour.
            for (let p = 0; p < indices.length; p++) {expect(rankedPalette[rankedIndices[p]]).toEqual(colors[indices[p]]);}
            // Heaviest first: usage never increases along the new order.
            const rankedUse = new Uint32Array(used.length);
            for (const index of rankedIndices) {rankedUse[index]++;}
            for (let i = 1; i < rankedUse.length; i++) {expect(rankedUse[i]).toBeLessThanOrEqual(rankedUse[i - 1]);}
            // The transparent entry is still the one the transparent pixels use.
            if (transparentIndex !== null) {
                for (let p = 0; p < indices.length; p++) {expect(rankedIndices[p] === rankedTransparentIndex).toBe(indices[p] === transparentIndex);}
            }
            expect(rankedIndices.constructor).toBe(indices.constructor);
        }
        // The split-order example really does put the heaviest colour second, so the recipe is doing something.
        const indexed = await quantizeToIndices(split, 3);
        const counts = [0, 0, 0]; for (const index of indexed.indices) {counts[index]++;}
        expect(counts[0]).toBeLessThan(Math.max(...counts));
    });

    it('a GIF with a transparent background', async () => {
        const { palette, indices, transparentIndex } = await quantizeToIndices(image, 255, { transparent: true });
        const colors = toColors(palette);
        const gif = GIFEncoder();
        gif.writeFrame(indices, image.width, image.height, { palette: colors, transparent: transparentIndex !== null, transparentIndex: transparentIndex ?? 0 });
        gif.finish();
        const reader = new GifReader(Buffer.from(gif.bytes()));
        const decoded = new Uint8Array(width * height * 4);
        reader.decodeAndBlitFrameRGBA(0, decoded);
        const at = (x, y) => Array.from(decoded.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
        expect(at(2, 2)[3]).toBe(0);                               // background: transparent
        expect(at(30, 30)).toEqual([220, 50, 40, 255]);            // disc centre: opaque, its colour
        for (let i = 3; i < decoded.length; i += 4) {expect([0, 255]).toContain(decoded[i]);}
    });

    it('a palette PNG whose transparent entry has alpha 0', async () => {
        const { palette, indices, transparentIndex } = await quantizeToIndices(image, 255, { transparent: true });
        const colors = toColors(palette);
        expect(indices).toBeInstanceOf(Uint8Array);
        const png = encodePng({
            width: image.width, height: image.height, data: indices, depth: 8, channels: 1,
            palette: colors.map((color, i) => [...color, i === transparentIndex ? 0 : 255]),
        });
        expect(Buffer.from(png).includes(Buffer.from('tRNS'))).toBe(true);
        const back = decodePng(png);
        expect(back.channels).toBe(1);
        expect(back.palette.length).toBe(colors.length);
        expect(Array.from(back.data)).toEqual(Array.from(indices));
    });

});
