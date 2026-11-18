// Dithering against palettes that can't reach the image's colours (fixed hardware palettes: e-ink, grey levels, black and
// white). Clamping the target to the RGB cube used to throw away the error that should move later pixels to other
// entries: flat cyan with the 7-colour e-ink palette came out solid blue.
import { describe, it, expect } from 'vitest';
import { quantizeToIndicesWithPalette, quantizeToIndices } from '../dist/index.mjs';

const eink = [0, 0, 0, 255, 255, 255, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 255, 128, 0];
const flat = (rgb, size = 64) => {
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {data.set([...rgb, 255], 4 * i);}
    return { data, format: 'rgba', width: size };
};
// The mean colour of the dithered result, and the share of each entry.
const outcome = async (rgb, palette, options = {}) => {
    const { indices } = await quantizeToIndicesWithPalette(flat(rgb), palette, { dither: true, ...options });
    const entries = palette.length / 3;
    const shares = new Array(entries).fill(0);
    for (const index of indices) {shares[index] += 1 / indices.length;}
    const mean = [0, 1, 2].map((c) => shares.reduce((sum, share, i) => sum + share * palette[3 * i + c], 0));
    return { mean, shares };
};

describe('dithering to colours the palette cannot reach', () => {

    it('mixes cyan and magenta from the e-ink inks instead of picking one', async () => {
        // White, green and blue in equal parts is the nearest mix to cyan these inks can make; likewise for magenta.
        const cyan = await outcome([0, 255, 255], eink);
        expect(cyan.mean.map(Math.round)).toEqual([85, 170, 170]);
        const magenta = await outcome([255, 0, 255], eink);
        expect(magenta.mean.map(Math.round)).toEqual([170, 85, 170]);
        // Print cyan used to come out 75% blue, 25% green and no white.
        const print = await outcome([0, 174, 239], eink);
        expect(print.shares[1]).toBeGreaterThan(0.1);
        expect(Math.abs(print.mean[1] - 174)).toBeLessThan(70);
    });

    it('keeps the brightness of saturated colours with grey levels and black and white', async () => {
        const grey = [0, 0, 0, 85, 85, 85, 170, 170, 170, 255, 255, 255];
        expect(Math.round((await outcome([0, 255, 255], grey)).mean[0])).toBe(170);
        // Cyan's mean value is 170: black and white mix towards it rather than going all white.
        const bw = await outcome([0, 255, 255], [0, 0, 0, 255, 255, 255]);
        expect(bw.shares[0]).toBeGreaterThan(0.15);
    });

    it('in OKLab too', async () => {
        const cyan = await outcome([0, 255, 255], eink, { colorSpace: 'oklab' });
        expect(cyan.shares.filter((share) => share > 0.05).length).toBeGreaterThan(1);
    });

    it('stays even and in range on colours the palette covers', async () => {
        // A grey the palette can mix exactly comes out as that mix, and no index is out of range.
        const grey = await outcome([128, 128, 128], [0, 0, 0, 255, 255, 255]);
        expect(Math.abs(grey.mean[0] - 128)).toBeLessThan(2);
        const { indices, palette } = await quantizeToIndices(flat([30, 200, 90], 32), 3, { dither: true });
        expect(Math.max(...indices)).toBeLessThan(palette.length / 3);
    });

});
