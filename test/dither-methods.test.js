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

describe('ordered', () => {

    it('keeps still areas still when part of the image changes', async () => {
        const palette = [0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 160, 0, 0, 0, 200, 230, 200, 40, 120, 120, 120, 90, 40, 160];
        const changed = new Uint8Array(gradientData);
        const inBlock = (x, y) => x >= 24 && x < 40 && y >= 24 && y < 40;
        for (let y = 24; y < 40; y++) {for (let x = 24; x < 40; x++) {changed.set([255, 0, 0, 255], 4 * (y * size + x));}}
        const outsideDiffers = async (dither) => {
            const a = (await quantizeWithPalette(gradient, palette, { dither })).data;
            const b = (await quantizeWithPalette({ data: changed, format: 'rgba', width: size }, palette, { dither })).data;
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const o = 4 * (y * size + x);
                    if (!inBlock(x, y) && (a[o] !== b[o] || a[o + 1] !== b[o + 1] || a[o + 2] !== b[o + 2])) {return true;}
                }
            }
            return false;
        };
        expect(await outsideDiffers('ordered')).toBe(false);
        // Error diffusion carries the change past the block, which shows the comparison can fail.
        expect(await outsideDiffers(true)).toBe(true);
    });

    it('repeats every 8 pixels on a flat colour', async () => {
        // A dark grey: about 27% white. (Error diffusion makes a mid-grey a checkerboard, which also repeats.)
        const { indices } = await quantizeToIndicesWithPalette(flat([70, 70, 70], 32), [0, 0, 0, 255, 255, 255], { dither: 'ordered' });
        for (let y = 0; y < 32; y++) {
            for (let x = 0; x < 32; x++) {expect(indices[y * 32 + x]).toBe(indices[(y % 8) * 32 + (x % 8)]);}
        }
        let white = 0;
        for (let y = 0; y < 8; y++) {for (let x = 0; x < 8; x++) {white += indices[y * 32 + x];}}
        expect(Math.abs(white - 64 * 70 / 255)).toBeLessThanOrEqual(4);
    });

    it('defaults to 64 steps for two colours and 16 for more', async () => {
        const run = (palette, dither) => quantizeWithPalette(gradient, palette, { dither }).then((result) => result.data);
        const two = [0, 0, 0, 255, 255, 255];
        expect(await run(two, 'ordered')).toEqual(await run(two, { method: 'ordered', steps: 64 }));
        expect(await run(two, 'ordered')).not.toEqual(await run(two, { method: 'ordered', steps: 16 }));
        // A repeated entry is still one colour.
        expect(await run([...two, 0, 0, 0], 'ordered')).toEqual(await run(two, { method: 'ordered', steps: 64 }));
        expect(await run(eink, 'ordered')).toEqual(await run(eink, { method: 'ordered', steps: 16 }));
        expect(await run(eink, { method: 'ordered', steps: 4 })).not.toEqual(await run(eink, { method: 'ordered', steps: 16 }));
    });

    it('gives two colours steps + 1 shades', async () => {
        // A grey ramp in black and white: each 8x8 tile is a shade, so count the distinct shares of white.
        const ramp = new Uint8Array(256 * 8 * 4);
        for (let y = 0; y < 8; y++) {for (let x = 0; x < 256; x++) {ramp.set([x, x, x, 255], 4 * (y * 256 + x));}}
        for (const steps of [4, 16, 64]) {
            const { indices } = await quantizeToIndicesWithPalette({ data: ramp, format: 'rgba', width: 256 }, [0, 0, 0, 255, 255, 255], { dither: { method: 'ordered', steps } });
            const shades = new Set();
            for (let tile = 0; tile < 32; tile++) {
                let white = 0;
                for (let y = 0; y < 8; y++) {for (let x = 0; x < 8; x++) {white += indices[y * 256 + tile * 8 + x];}}
                shades.add(white);
            }
            expect(shades.size, `steps ${steps}`).toBe(Math.min(steps + 1, 32));
        }
    });

    it('scales with strength about as error diffusion does', async () => {
        // The share of pixels that differ from undithered, at a strength, against at full strength.
        const share = async (method, strength) => {
            const none = (await quantizeWithPalette(gradient, eink)).data;
            const out = (await quantizeWithPalette(gradient, eink, { dither: { method, strength } })).data;
            let changed = 0;
            for (let i = 0; i < none.length; i += 4) {if (none[i] !== out[i] || none[i + 1] !== out[i + 1] || none[i + 2] !== out[i + 2]) {changed++;}}
            return changed;
        };
        const full = await share('ordered', 1);
        const half = await share('ordered', 0.5) / full, quarter = await share('ordered', 0.25) / full, tenth = await share('ordered', 0.1) / full;
        expect(tenth).toBeGreaterThan(0);
        expect(quarter).toBeLessThan(0.55);
        expect(half).toBeLessThan(0.9);
        expect(tenth).toBeLessThan(quarter);
        expect(quarter).toBeLessThan(half);
    });

    it('does not depend on palette order', async () => {
        const reversed = [];
        for (let i = eink.length - 3; i >= 0; i -= 3) {reversed.push(...eink.slice(i, i + 3));}
        const a = await quantizeWithPalette(gradient, eink, { dither: 'ordered' });
        const b = await quantizeWithPalette(gradient, reversed, { dither: 'ordered' });
        expect(a.data).toEqual(b.data);
    });

    it('gives transparent pixels the transparent entry', async () => {
        const image = tiny(4, 4);
        image.data[3] = 0;
        const { indices, transparentIndex } = await quantizeToIndicesWithPalette(image, eink, { dither: 'ordered', transparent: true });
        expect(indices[0]).toBe(transparentIndex);
    });

    it('handles one-colour and duplicated palettes', async () => {
        const one = await quantizeToIndicesWithPalette(gradient, [9, 9, 9], { dither: 'ordered' });
        expect(one.indices.every((index) => index === 0)).toBe(true);
        const repeated = await quantizeToIndicesWithPalette(gradient, [0, 0, 0, 255, 255, 255, 0, 0, 0], { dither: 'ordered' });
        expect(repeated.indices.includes(2)).toBe(false);
    });

    it('works with a palette over 1024 colours', async () => {
        let seed = 7;
        const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 24;
        const palette = Array.from({ length: 2000 * 3 }, random);
        const reversed = [];
        for (let i = palette.length - 3; i >= 0; i -= 3) {reversed.push(...palette.slice(i, i + 3));}
        const a = await quantizeWithPalette(gradient, palette, { dither: 'ordered' });
        const colours = new Set();
        for (let i = 0; i < palette.length; i += 3) {colours.add((palette[i] << 16) | (palette[i + 1] << 8) | palette[i + 2]);}
        for (let i = 0; i < a.data.length; i += 4) {expect(colours.has((a.data[i] << 16) | (a.data[i + 1] << 8) | a.data[i + 2])).toBe(true);}
        expect((await quantizeWithPalette(gradient, reversed, { dither: 'ordered' })).data).toEqual(a.data);
    });

    it('matches a reference implementation of the recipes', async () => {
        // The algorithm written plainly. At full strength in RGB everything is a whole number, so this is exact: targets
        // more than 32 outside the cube are matched as they are, the rest clamped to it; ties go to the smaller packed key.
        const bayer = [[0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26], [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
            [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25], [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]];
        const reference = (data, width, palette, steps) => {
            const colours = [];
            for (let i = 0; i < palette.length; i += 3) {
                const key = (palette[i] << 16) | (palette[i + 1] << 8) | palette[i + 2];
                if (!colours.some((c) => c.key === key)) {colours.push({ rgb: palette.slice(i, i + 3), key, luma: 299 * palette[i] + 587 * palette[i + 1] + 114 * palette[i + 2] });}
            }
            const nearest = (t) => {
                let best = null, bestDistance = Infinity;
                for (const c of colours) {
                    const d = (c.rgb[0] - t[0]) ** 2 + (c.rgb[1] - t[1]) ** 2 + (c.rgb[2] - t[2]) ** 2;
                    if (d < bestDistance || (d === bestDistance && c.key < best.key)) {best = c; bestDistance = d;}
                }
                return best;
            };
            const out = new Uint8Array(data.length);
            for (let p = 0; p < data.length / 4; p++) {
                const base = [data[4 * p], data[4 * p + 1], data[4 * p + 2]];
                const e = [0, 0, 0], recipe = [];
                for (let i = 0; i < steps; i++) {
                    let t = base.map((b, c) => b + e[c]);
                    if (!t.some((v) => v < -255 / 8 || v > 255 + 255 / 8)) {t = t.map((v) => Math.min(255, Math.max(0, v)));}
                    const chosen = nearest(t);
                    recipe.push(chosen);
                    for (let c = 0; c < 3; c++) {e[c] += base[c] - chosen.rgb[c];}
                }
                recipe.sort((a, b) => a.luma - b.luma || a.key - b.key);
                const x = p % width, y = Math.floor(p / width);
                out.set([...recipe[Math.floor(bayer[y & 7][x & 7] * steps / 64)].rgb, 255], 4 * p);
            }
            return out;
        };
        let seed = 3;
        const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 24;
        const palettes = { eink, sixteen: Array.from({ length: 48 }, random), sixtyFour: Array.from({ length: 192 }, random), hundred: Array.from({ length: 300 }, random) };
        for (const [name, palette] of Object.entries(palettes)) {
            for (const steps of [4, 16]) {
                const result = await quantizeWithPalette(gradient, palette, { dither: { method: 'ordered', steps } });
                expect(result.data, `${name}, steps ${steps}`).toEqual(reference(gradientData, size, palette, steps));
            }
        }
    });

    edgeCases('ordered');

});
