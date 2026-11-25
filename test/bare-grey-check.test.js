// The grey rules behind the gray-as-rgba warning: a bare Uint8Array whose bytes look like grey (1 per pixel) or grey and
// alpha (2 per pixel) rather than the RGBA it is read as. Measured on 2,984 real RGBA images and the grey versions of the
// same sources in bench/spikes/bare-grey/ (results-rules.txt, results-packed.txt); these cases pin its answers so a change
// to it fails here. The RGB rule decides first (bare-rgb-check.test.js).
import { describe, it, expect, beforeAll } from 'vitest';
import { encode, decode } from 'fast-png';
import { bareLayout, bareImageError } from '../dist/shared.mjs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../fixtures/kodak.js';
import { timeLimit } from './timeout.js';

const luma = (r, g, b) => Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
// Interleave per-pixel bytes from functions of the pixel index.
const pixels = (n, ...channels) => {
    const out = new Uint8Array(n * channels.length);
    for (let p = 0; p < n; p++) {channels.forEach((f, c) => {out[p * channels.length + c] = f(p);});}
    return out;
};

let kodak; // kodim23: { rgba, width, height, grey }
beforeAll(async () => {
    const { rgba, width, height } = await getImageRgba(await ensureImage(KODAK_IMAGES[22]));
    const grey = new Uint8Array(width * height);
    for (let p = 0; p < grey.length; p++) {grey[p] = luma(rgba[4 * p], rgba[4 * p + 1], rgba[4 * p + 2]);}
    kodak = { rgba, width, height, grey };
}, timeLimit(120_000));

// A soft-edged icon (a shaded disc with an anti-aliased edge, transparent outside), as an emoji or app icon would be
const icon = (side) => {
    const n = side * side, c = (side - 1) / 2, r = side * 0.4;
    const at = (p) => ({ x: p % side, y: Math.floor(p / side) });
    const alpha = (p) => {const { x, y } = at(p); return Math.round(255 * Math.min(1, Math.max(0, r - Math.hypot(x - c, y - c))));};
    const shade = (p) => {const { x, y } = at(p); return alpha(p) ? Math.round(80 + 150 * (x + y) / (2 * side)) : 0;};
    return { n, alpha, shade };
};

describe('bareLayout: grey', () => {
    it('flags a grey photo, 1 byte per pixel', () => {
        expect(bareLayout(kodak.grey)).toBe('grey');
    });
    it('flags fast-png\'s 1-bit packed rows of a photo known to be caught (kodim23; 7 of 24 Kodak photos are not)', () => {
        const { width, height, grey } = kodak, rowBytes = Math.ceil(width / 8), packed = new Uint8Array(rowBytes * height);
        for (let y = 0; y < height; y++) {for (let x = 0; x < width; x++) {if (grey[y * width + x] >= 128) {packed[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);}}}
        expect(bareLayout(decode(encode({ width, height, data: packed, channels: 1, depth: 1 })).data)).toBe('grey');
    });
});

describe('bareLayout: grey and alpha', () => {
    it('flags a grey photo with alpha 255, 2 bytes per pixel', () => {
        expect(bareLayout(pixels(kodak.grey.length, (p) => kodak.grey[p], () => 255))).toBe('grey-alpha');
    });
    it('flags a grey photo as a feathered cutout', () => {
        const { width, height, grey } = kodak, cx = width / 2, cy = height / 2, radius = 0.4 * Math.min(width, height);
        const alpha = (p) => Math.round(255 * Math.min(1, Math.max(0, (radius - Math.hypot(p % width - cx, Math.floor(p / width) - cy)) / 32)));
        expect(bareLayout(pixels(grey.length, (p) => (alpha(p) ? grey[p] : 0), alpha))).toBe('grey-alpha');
    });
    it('flags a soft-edged icon saved as grey and alpha', () => {
        const { n, alpha, shade } = icon(72);
        expect(bareLayout(pixels(n, shade, alpha))).toBe('grey-alpha');
    });
});

describe('bareLayout: real RGBA near the grey rules', () => {
    it('passes grey with alpha equal to the grey, (g, g, g, g)', () => {
        const g = (p) => kodak.grey[p];
        expect(bareLayout(pixels(kodak.grey.length, g, g, g, g))).toBe(null);
    });
    it('passes a premultiplied white mask', () => {
        const a = (p) => kodak.grey[p];
        expect(bareLayout(pixels(kodak.grey.length, a, a, a, a))).toBe(null);
    });
    it('passes a photo with alpha equal to its brightness (the highest-scoring RGBA in the spike)', () => {
        const d = kodak.rgba;
        expect(bareLayout(pixels(kodak.grey.length, (p) => d[4 * p], (p) => d[4 * p + 1], (p) => d[4 * p + 2], (p) => kodak.grey[p]))).toBe(null);
    });
    it('passes a soft-edged icon as RGBA, straight and as grey', () => {
        const { n, alpha, shade } = icon(72);
        expect(bareLayout(pixels(n, shade, (p) => Math.round(shade(p) * 0.8), (p) => Math.round(shade(p) * 0.5), alpha))).toBe(null);
        expect(bareLayout(pixels(n, shade, shade, shade, alpha))).toBe(null);
    });
    it('passes the photo itself', () => {
        expect(bareLayout(kodak.rgba)).toBe(null);
    });
});

describe('bareLayout: never grey', () => {
    it('skips byte ramps, which score 4 as grey whatever the step', () => {
        for (const k of [1, 3, 7]) {expect(bareLayout(new Uint8Array(4096).map((_, i) => (i * k) & 255))).toBe(null);}
    });
    it('skips arrays under 192 bytes', () => {
        expect(bareLayout(kodak.grey.subarray(0, 188))).toBe(null);
    });
    it('calls an RGB photo RGB, never grey', () => {
        const rgb = pixels(kodak.grey.length, (p) => kodak.rgba[4 * p], (p) => kodak.rgba[4 * p + 1], (p) => kodak.rgba[4 * p + 2]);
        expect(bareLayout(rgb.subarray(0, rgb.length - (rgb.length % 4)))).toBe('rgb');
    });
});

describe('bareImageError: grey', () => {
    it('gives the grey and grey-and-alpha texts', () => {
        const grey = bareImageError(kodak.grey);
        expect(grey.message).toMatch(/^Invalid image: these [\d,]+ bytes look like grey \(1 per pixel\), not RGBA/);
        expect(grey.code).toBe('invalid-argument');
        expect(grey.argument).toBe('image');
        const both = bareImageError(pixels(kodak.grey.length, (p) => kodak.grey[p], () => 255));
        expect(both.message).toMatch(/^Invalid image: these [\d,]+ bytes look like grey and alpha \(2 per pixel\), not RGBA/);
    });
});
