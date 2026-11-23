// The check behind the rgb-as-rgba warning: a bare Uint8Array whose bytes look like RGB (3 per pixel) rather than
// the RGBA it is read as. The rule was measured on 2,103 real RGBA images and 1,884 harmful RGB cases in
// bench/spikes/bare-rgb/ (results.txt); these synthetic images pin its answers so a change to it fails here.
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import * as shared from '../dist/shared.mjs';
import { looksLikeRgb, bareRgbWarning, Palette } from '../dist/shared.mjs';

const hsv = (h, s, v) => {
    const i = Math.floor(h * 6), f = h * 6 - i;
    const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6].map((c) => Math.round(c * 255));
};
const rgbOf = (w, h, fill) => {
    const out = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++) {for (let x = 0; x < w; x++) {out.set(fill(x, y), (y * w + x) * 3);}}
    return out;
};
const rgbaOf = (w, h, fill, alpha) => {
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {for (let x = 0; x < w; x++) {out.set([...fill(x, y), alpha(x, y)], (y * w + x) * 4);}}
    return out;
};
const gradient = (side) => (x, y) => hsv(x / side, 0.85, 0.3 + 0.7 * y / side);
const greyRamp = (x, y) => {const v = Math.round(255 * (x + y) / 126); return [v, v, v];};
const opaque = () => 255;
const noise = (length) => {
    const out = new Uint8Array(length);
    let s = 0xdeadbeef;
    for (let i = 0; i < length; i++) {s = (Math.imul(s, 1664525) + 1013904223) >>> 0; out[i] = s >>> 24;}
    return out;
};

const gradientRgb = rgbOf(64, 64, gradient(64));

describe('looksLikeRgb', () => {
    it('flags a colour image written as RGB', () => {
        expect(looksLikeRgb(gradientRgb)).toBe(true);
    });
    it('flags a small one, read whole rather than sampled (16×16, 768 bytes)', () => {
        expect(looksLikeRgb(rgbOf(16, 16, gradient(16)))).toBe(true);
    });
    it('flags grey written as RGB (the equal-triples test)', () => {
        expect(looksLikeRgb(rgbOf(64, 64, greyRamp))).toBe(true);
    });
    it('passes the same image as opaque RGBA', () => {
        expect(looksLikeRgb(rgbaOf(64, 64, gradient(64), opaque))).toBe(false);
    });
    it('passes a soft cutout, transparent pixels zeroed', () => {
        const cutout = rgbaOf(64, 64, gradient(64), (x, y) => Math.round(255 * Math.min(1, Math.max(0, (24 - Math.hypot(x - 32, y - 32)) / 8))));
        for (let p = 0; p < cutout.length; p += 4) {if (cutout[p + 3] === 0) {cutout.fill(0, p, p + 3);}}
        expect(looksLikeRgb(cutout)).toBe(false);
    });
    it('passes a premultiplied white mask, whose pixels are (a, a, a, a)', () => {
        expect(looksLikeRgb(rgbaOf(64, 64, greyRamp, (x, y) => greyRamp(x, y)[0]))).toBe(false);
    });
    it('passes noise, where both readings look alike (a harmless miss)', () => {
        expect(looksLikeRgb(noise(64 * 64 * 3))).toBe(false);
    });
    it('passes byte ramps, the usual fake image in tests (not pixels of either kind)', () => {
        expect(looksLikeRgb(new Uint8Array(20000).map((_, i) => (i * 7) & 255))).toBe(false);
        expect(looksLikeRgb(new Uint8Array(40000).map((_, i) => i & 255))).toBe(false);
        expect(looksLikeRgb(new Uint8Array(40000).map((_, i) => i % 251))).toBe(false);
    });
    it('passes arrays under the 192-byte floor', () => {
        expect(looksLikeRgb(gradientRgb.subarray(0, 188))).toBe(false);
    });
    it('checks a Node Buffer like any bare array, including a small one inside Node\'s shared pool', () => {
        const pooled = Buffer.from(rgbOf(16, 16, gradient(16)));
        expect(pooled.byteOffset).toBeGreaterThan(0);
        expect(looksLikeRgb(pooled)).toBe(true);
        expect(looksLikeRgb(Buffer.from(gradientRgb))).toBe(true);
    });
    it('samples only its own range when it is a view into a larger buffer', () => {
        // RGB far into a buffer of RGBA: reading from the buffer's start instead would see only RGBA.
        const big = rgbaOf(128, 128, gradient(128), opaque);
        big.set(gradientRgb, 40960);
        expect(looksLikeRgb(new Uint8Array(big.buffer, 40960, gradientRgb.length))).toBe(true);
        expect(looksLikeRgb(new Uint8Array(big.buffer, 0, gradientRgb.length))).toBe(false);
    });
});

describe('looksLikeRgb on real images (fixtures/bare-rgb/)', () => {
    const fixture = (name) => fileURLToPath(new URL(`../fixtures/bare-rgb/${name}`, import.meta.url));
    const raw = async (name, alpha) => new Uint8Array(await (alpha ? sharp(fixture(name)).ensureAlpha() : sharp(fixture(name)).removeAlpha()).raw().toBuffer());

    it('flags a Kodak photo as RGB and passes it as RGBA', async () => {
        expect(looksLikeRgb(await raw('kodim23-crop.png', false))).toBe(true);
        expect(looksLikeRgb(await raw('kodim23-crop.png', true))).toBe(false);
    });
    it('passes an anti-aliased emoji, straight and premultiplied, and flags it flattened onto white as RGB', async () => {
        const rgba = await raw('noto-emoji_u1f34e.png', true);
        const premultiplied = new Uint8Array(rgba), onWhite = new Uint8Array(rgba.length / 4 * 3);
        for (let p = 0; p < rgba.length / 4; p++) {
            const a = rgba[4 * p + 3] / 255;
            for (let c = 0; c < 3; c++) {
                premultiplied[4 * p + c] = Math.round(rgba[4 * p + c] * a);
                onWhite[3 * p + c] = Math.round(rgba[4 * p + c] * a + 255 * (1 - a));
            }
        }
        expect(looksLikeRgb(rgba)).toBe(false);
        expect(looksLikeRgb(premultiplied)).toBe(false);
        expect(looksLikeRgb(onWhite)).toBe(true);
    });
});

describe('bareRgbWarning', () => {
    it('keeps its record of warned codes private: only resetWarnings and silenceWarnings change it', () => {
        expect(shared.warned).toBeUndefined();
    });
    it('names the warning for bare RGB bytes', () => {
        expect(bareRgbWarning(gradientRgb)).toBe('rgb-as-rgba');
    });
    it('ignores images that say what they are', () => {
        expect(bareRgbWarning({ data: gradientRgb, format: 'rgba' })).toBe(null);
    });
    it('ignores a palette passed as the image (flat RGB bytes, rejected anyway)', () => {
        expect(bareRgbWarning(new Palette(gradientRgb.subarray(0, 768)))).toBe(null);
    });
    it('ignores an encoded file (rejected anyway)', () => {
        const png = new Uint8Array(gradientRgb.length + 8);
        png.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        png.set(gradientRgb, 8);
        expect(bareRgbWarning(png)).toBe(null);
    });
    it('ignores a length that is not a multiple of 4 (rejected anyway)', () => {
        expect(bareRgbWarning(gradientRgb.subarray(0, gradientRgb.length - 2))).toBe(null);
    });
    it('ignores a bare Uint8ClampedArray (rejected anyway)', () => {
        expect(bareRgbWarning(new Uint8ClampedArray(gradientRgb))).toBe(null);
    });
});
