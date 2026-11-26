// Writes the seed inputs for native/fuzz_images.cpp to native/seeds/fuzz_images, and for native/fuzz_identical.cpp to
// native/seeds/fuzz_identical (committed; rerun only to change them):
// a header in the harness's byte order, a palette, then pixels cropped from Kodak photos, so fuzzing starts from real
// image sizes instead of growing inputs from a few bytes. Run from the repo root: node native/make-seeds.mjs
import { writeFileSync, mkdirSync } from 'fs';
import { getImageRgba } from '../fixtures/kodak.js';

const dir = 'native/seeds/fuzz_images';
mkdirSync(dir, { recursive: true });
const photo = await getImageRgba('fixtures/images/kodim23.png');
const crop = (x0, y0, w, h, format) => {
    const stride = format === 1 ? 3 : 4, out = [];
    for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
            const i = (y * photo.width + x) * 4, [r, g, b] = [photo.rgba[i], photo.rgba[i + 1], photo.rgba[i + 2]];
            const a = Math.max(0, 255 - (x - x0) * 9);   // an alpha ramp, for the formats that read alpha
            if (format === 1) {out.push(r, g, b);} else if (format === 2 || format === 4) {out.push(b, g, r, a);} else {out.push(r, g, b, a);}
        }
    }
    return out.slice(0, w * h * stride);
};
// [format, colour space, precision, weight alpha, k, dither (0-4 = 0..1), method, steps index, transparent, palette colours, width seed]
const seeds = {
    'rgba-photo-fs': [0, 0, 8, 1, 16, 4, 0, 0, 128, 0, 47],
    'rgb-photo-ordered-oklab': [1, 1, 6, 0, 64, 4, 2, 4, 0, 7, 39],
    'bgra-photo-atkinson-palette': [2, 0, 8, 1, 4, 2, 1, 0, 200, 12, 31],
    'rgbx-photo-ordered-steps64': [3, 0, 5, 0, 2, 4, 2, 6, 0, 2, 23],
};
for (const [name, header] of Object.entries(seeds)) {
    const palette = Array.from({ length: header[9] * 3 }, (_, i) => (i * 97 + 13) & 255);
    writeFileSync(`${dir}/${name}`, Uint8Array.from([...header, ...palette, ...crop(300, 200, 48, 32, header[0])]));
}
console.log(`wrote ${Object.keys(seeds).length} seeds to ${dir}`);

// fuzz_identical reads the same header, but for generated pixels: [format, colour space, precision, weight alpha, generated pixels
// (2^(n-1)), scatter (2^n levels), mode, centres, transparent, palette colours (the centres), width seed], then pixels as they are.
const identicalDir = 'native/seeds/fuzz_identical';
mkdirSync(identicalDir, { recursive: true });
const identical = {
    'rgba-noise-8192': [0, 0, 8, 1, 14, 5, 0, 20, 0, 6, 47],
    'rgb-gradient-oklab': [1, 1, 8, 0, 13, 4, 1, 8, 0, 3, 39],
    'bgra-ramp-transparent': [2, 0, 8, 1, 12, 3, 2, 12, 128, 4, 31],
    'rgbx-precision6-wide': [3, 0, 6, 0, 10, 8, 0, 40, 0, 2, 23],
};
for (const [name, header] of Object.entries(identical)) {
    const palette = Array.from({ length: header[9] * 3 }, (_, i) => (i * 97 + 13) & 255);
    writeFileSync(`${identicalDir}/${name}`, Uint8Array.from([...header, ...palette, ...crop(300, 200, 16, 16, header[0])]));
}
console.log(`wrote ${Object.keys(identical).length} seeds to ${identicalDir}`);
