// The dither methods beyond Floyd-Steinberg: Atkinson diffusion and ordered (pattern) dithering.
import { describe, it, expect } from 'vitest';
import { quantize, quantizeWithPalette, quantizeToIndicesWithPalette } from '../dist/index.mjs';

// A smooth 64x64 RGBA gradient with many distinct colours.
const size = 64;
const gradientData = new Uint8Array(size * size * 4);
for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
        gradientData.set([Math.round(x / (size - 1) * 255), Math.round(y / (size - 1) * 255), 96 + ((x * 7 + y * 3) % 64), 255], 4 * (y * size + x));
    }
}
const gradient = { data: gradientData, format: 'rgba', width: size };
const eink = [0, 0, 0, 255, 255, 255, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 255, 128, 0];
const flat = (rgb, width = 64, height = width) => {
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {data.set([...rgb, 255], 4 * i);}
    return { data, format: 'rgba', width };
};
const toRgb = ({ data, width }) => {
    const rgb = new Uint8Array(data.length / 4 * 3);
    for (let i = 0; i < data.length / 4; i++) {rgb.set(data.subarray(4 * i, 4 * i + 3), 3 * i);}
    return { data: rgb, format: 'rgb', width };
};
// A small RGBA image of the given size, with varied colours.
const tiny = (width, height) => {
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {data.set([(i * 97) % 256, (i * 57 + 40) % 256, (i * 31 + 90) % 256, 255], 4 * i);}
    return { data, format: 'rgba', width };
};

// The checks every method must pass on unusual inputs.
const edgeCases = (method) => {

    it('handles tiny images', async () => {
        for (const [w, h] of [[1, 1], [3, 1], [1, 5]]) {
            const { indices, palette } = await quantizeToIndicesWithPalette(tiny(w, h), eink, { dither: method });
            expect(indices.length).toBe(w * h);
            for (const index of indices) {expect(index).toBeLessThan(palette.length / 3);}
        }
    });

    it('gives the same output for RGB and opaque RGBA', async () => {
        const rgba = await quantizeWithPalette(gradient, eink, { dither: method });
        const rgb = await quantizeWithPalette(toRgb(gradient), eink, { dither: method });
        expect(toRgb(rgba).data).toEqual(rgb.data);
    });

    it('at strength 0 equals no dithering', async () => {
        const off = await quantizeWithPalette(gradient, eink);
        expect((await quantizeWithPalette(gradient, eink, { dither: { method, strength: 0 } })).data).toEqual(off.data);
    });

};

describe('atkinson', () => {

    it('differs from floyd-steinberg and from no dithering', async () => {
        const atkinson = (await quantize(gradient, 8, { dither: 'atkinson' })).data;
        expect(atkinson).not.toEqual((await quantize(gradient, 8, { dither: true })).data);
        expect(atkinson).not.toEqual((await quantize(gradient, 8)).data);
    });

    it('mixes an unreachable colour from the e-ink inks', async () => {
        const { indices } = await quantizeToIndicesWithPalette(flat([0, 255, 255]), eink, { dither: 'atkinson' });
        const shares = new Array(7).fill(0);
        for (const index of indices) {shares[index] += 1 / indices.length;}
        const mean = [0, 1, 2].map((c) => shares.reduce((sum, share, i) => sum + share * eink[3 * i + c], 0));
        [85, 170, 170].forEach((want, c) => expect(Math.abs(mean[c] - want)).toBeLessThanOrEqual(25));
        expect(Math.max(...shares)).toBeLessThanOrEqual(0.6);
    });

    it('lets transparent pixels pass no error', async () => {
        // The left half is fully transparent: dithering the right half must come out as if it were alone.
        const half = size / 2;
        const whole = new Uint8Array(gradientData);
        for (let y = 0; y < size; y++) {for (let x = 0; x < half; x++) {whole[4 * (y * size + x) + 3] = 0;}}
        const right = new Uint8Array(half * size * 4);
        for (let y = 0; y < size; y++) {right.set(gradientData.subarray(4 * (y * size + half), 4 * (y * size + size)), 4 * y * half);}
        const options = { dither: 'atkinson', transparent: true };
        const a = await quantizeToIndicesWithPalette({ data: whole, format: 'rgba', width: size }, eink, options);
        const b = await quantizeToIndicesWithPalette({ data: right, format: 'rgba', width: half }, eink, options);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < half; x++) {expect(a.indices[y * size + half + x]).toBe(b.indices[y * half + x]);}
        }
    });

    edgeCases('atkinson');

});
