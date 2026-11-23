// Writes the seed inputs for native/fuzz_images.cpp to native/seeds/fuzz_images (committed; rerun only to change them):
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
