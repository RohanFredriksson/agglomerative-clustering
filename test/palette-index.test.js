// Mapping to a palette you supply: every size uses an index that gives exactly the brute-force nearest entry (ties to the
// smaller packed RGB value, then for a repeated colour the first entry), so indices line up with the palette's order.
import { describe, it, expect } from 'vitest';
import { quantizeToIndicesWithPalette } from '../dist/index.mjs';

let seed = 12345;
const random = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
const bytes = (n) => Uint8Array.from({ length: n }, () => Math.floor(random() * 256));

const bruteForce = (palette, r, g, b) => {
    let best = -1, bestDistance = Infinity, bestKey = Infinity;
    for (let i = 0; i < palette.length / 3; i++) {
        const distance = (palette[3 * i] - r) ** 2 + (palette[3 * i + 1] - g) ** 2 + (palette[3 * i + 2] - b) ** 2;
        const key = (palette[3 * i] << 16) | (palette[3 * i + 1] << 8) | palette[3 * i + 2];
        if (distance < bestDistance || (distance === bestDistance && key < bestKey)) {best = i; bestDistance = distance; bestKey = key;}
    }
    return best;
};

describe('mapping to palettes of every size', () => {

    it.each([2, 7, 256, 257, 400, 1024, 1025, 3000])('matches the brute-force nearest entry with %i colours', async (size) => {
        const palette = bytes(3 * size);
        // Repeat a few entries, so the first-of-equal-entries rule is exercised.
        for (let i = 0; i + 1 < size && i < 6; i += 2) {palette.copyWithin(3 * (size - 1 - i), 3 * i, 3 * i + 3);}
        const pixels = 20000;
        const image = bytes(3 * pixels);
        // Also every repeated colour itself, which ties exactly.
        for (let i = 0; i < 6 && i < size; i++) {image.set(palette.subarray(3 * i, 3 * i + 3), 3 * i);}
        const { indices } = await quantizeToIndicesWithPalette({ data: image, format: 'rgb' }, palette);
        let wrong = 0;
        for (let p = 0; p < pixels; p++) {
            if (indices[p] !== bruteForce(palette, image[3 * p], image[3 * p + 1], image[3 * p + 2])) {wrong++;}
        }
        expect(wrong).toBe(0);
    });

});
