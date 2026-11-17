// Runs the README's "Using the output" recipes against the real encoders, so the documentation can't drift from the API.
import { describe, it, expect } from 'vitest';
import * as gifenc from 'gifenc';
import { GifReader } from 'omggif';
import { encode as encodePng, decode as decodePng } from 'fast-png';
import { getClustering, getPaletteFromClustering, getSwatchesFromClustering, quantizeToIndices, quantizeToIndicesFromClustering } from '../dist/index.mjs';


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
        const { palette, indices, transparentIndex } = await quantizeToIndices(image, 256, { transparent: true });
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

    // Decoded pixel by pixel: 3.0.0-beta.1's recipe passed a check that the PNG had a tRNS chunk, but fast-png writes only
    // the alphas below 255 and PNG applies them from entry 0, so its transparency landed on the wrong entry.
    it('a palette PNG whose transparent pixels decode as transparent, and the rest as their colours', async () => {
        const { palette, indices, transparentIndex } = await quantizeToIndices(image, 256, { transparent: true });
        const colors = toColors(palette);
        expect(indices).toBeInstanceOf(Uint8Array);
        expect(transparentIndex).toBeGreaterThan(0);   // the case the old recipe got wrong
        const t = transparentIndex ?? 0;
        const swap = (i) => (i === t ? 0 : i === 0 ? t : i);
        const png = encodePng({
            width: image.width, height: image.height, depth: 8, channels: 1,
            data: indices.map(swap),
            palette: colors.map((_, i) => [...colors[swap(i)], i === 0 && transparentIndex !== null ? 0 : 255]),
        });
        const back = decodePng(png);
        expect(back.channels).toBe(1);
        for (let p = 0; p < indices.length; p++) {
            const [r, g, b, a] = back.palette[back.data[p]];
            if (indices[p] === transparentIndex) {
                expect(a, `pixel ${p}`).toBe(0);
            } else {
                expect([r, g, b, a ?? 255], `pixel ${p}`).toEqual([...colors[indices[p]], 255]);
            }
        }
        // And the source's transparent background stays transparent, its opaque disc centre opaque.
        expect(back.palette[back.data[2 * width + 2]][3]).toBe(0);
        expect(back.palette[back.data[30 * width + 30]][3] ?? 255).toBe(255);
    });


    it('an animated GIF with one palette for every frame, from a sample of the frames', async () => {
        const [w, h] = [64, 48];
        const frames = Array.from({ length: 12 }, (_, f) => {
            const data = new Uint8Array(w * h * 4);
            for (let p = 0; p < w * h; p++) {
                const x = p % w, y = Math.floor(p / w);
                data.set([(x * 4 + f * 9) & 255, (y * 5) & 255, (x * y + f * 20) & 255, f === 3 && x < 8 ? 0 : 255], p * 4);
            }
            return { data, format: 'rgba', width: w, height: h };
        });
        const sample = frames.filter((_, i) => i % 5 === 0);
        const pixels = new Uint8Array(sample.reduce((n, frame) => n + frame.data.length, 0));
        let offset = 0;
        for (const frame of sample) {pixels.set(frame.data, offset); offset += frame.data.length;}
        const clustering = await getClustering({ data: pixels, format: 'rgba' }, { precision: 6, transparent: true });
        const gif = GIFEncoder();
        for (const frame of frames) {
            const { palette, indices, transparentIndex } = await quantizeToIndicesFromClustering(frame, clustering, 256, { dither: 0.5 });
            expect(palette.length / 3).toBeLessThanOrEqual(256);
            expect(indices).toBeInstanceOf(Uint8Array);
            gif.writeFrame(indices, w, h, { palette: toColors(palette), transparent: transparentIndex !== null, transparentIndex: transparentIndex ?? 0 });
        }
        gif.finish();
        const reader = new GifReader(Buffer.from(gif.bytes()));
        expect(reader.numFrames()).toBe(12);
        const decoded = new Uint8Array(w * h * 4);
        reader.decodeAndBlitFrameRGBA(3, decoded);
        expect(decoded[3]).toBe(0);                              // frame 3's transparent strip
        expect(decoded[(20 * w + 20) * 4 + 3]).toBe(255);
    });

});
