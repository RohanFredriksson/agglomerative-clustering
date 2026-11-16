// Runs the README's "Using the output" recipes against the real encoders, so the documentation can't drift from the API.
import { describe, it, expect } from 'vitest';
import * as gifenc from 'gifenc';
import { GifReader } from 'omggif';
import { encode as encodePng, decode as decodePng } from 'fast-png';
import { getClustering, getPaletteFromClustering, getPaletteWeights, quantizeToIndices } from '../dist/index.mjs';

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
        const palette = await getPaletteFromClustering(clustering, 3);
        const weights = await getPaletteWeights(clustering, 3);
        const colors = toColors(palette);
        const css = (i) => `rgb(${palette[3 * i]} ${palette[3 * i + 1]} ${palette[3 * i + 2]})`;
        const hex = (i) => (palette[3 * i] << 16) | (palette[3 * i + 1] << 8) | palette[3 * i + 2];
        const total = weights.reduce((a, b) => a + b, 0);
        const swatches = Array.from(weights, (w, i) => ({ color: css(i), share: w / total }));
        expect(colors).toEqual([[220, 50, 40], [40, 110, 220], [60, 200, 90]]);
        expect(swatches.map((s) => s.color)).toEqual(['rgb(220 50 40)', 'rgb(40 110 220)', 'rgb(60 200 90)']);
        expect(hex(0)).toBe(0xdc3228);
        expect(swatches.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 12);
        expect(swatches[0].share).toBeGreaterThan(swatches[2].share);
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
