// Test images for the perf spike, written as raw RGBA to data/ (gitignored) with data/images.json listing them.
//   k23, k03, k20      Kodak photos as they are (768x512, 0.39 MP)
//   up12, up50         kodim23 upscaled with bilinear interpolation to 4320x2880 (12.4 MP) and 8640x5760 (49.8 MP);
//                      interpolation makes new in-between colours, as a real large photo has
//   mos12, mos50       mosaics of different Kodak photos (every second tile mirrored once the 24 photos run out):
//                      5x6 tiles = 3840x3072 (11.8 MP), 11x11 tiles = 8448x5632 (47.6 MP)
import { getImageRgba } from '../../../fixtures/kodak.js';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const here = dirname(fileURLToPath(import.meta.url));
const data = join(here, 'data'); mkdirSync(data, { recursive: true });
const root = join(here, '../../..');
const load = async (n) => { const r = await getImageRgba(join(root, `fixtures/images/kodim${String(n).padStart(2, '0')}.png`)); return r.rgba ? r : { rgba: r, width: 768, height: 512 }; };
const first = await load(23);
const W0 = first.width ?? 768, H0 = first.height ?? 512;
const distinct = (rgba) => { const seen = new Uint8Array(1 << 21); let n = 0; for (let i = 0; i < rgba.length; i += 4) { const k = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]; const b = 1 << (k & 7); if (!(seen[k >> 3] & b)) { seen[k >> 3] |= b; n++; } } return n; };
const out = {};
const save = (name, rgba, width, height, how) => { writeFileSync(join(data, name + '.rgba'), rgba); out[name] = { width, height, pixels: width * height, distinct: distinct(rgba), how }; console.log(name, out[name]); };
for (const n of [23, 3, 20]) { const im = await load(n); save('k' + String(n).padStart(2, '0'), im.rgba, im.width ?? W0, im.height ?? H0, `kodim${n}`); }
function bilinear(src, w, h, W, H) {
    const dst = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
        const fy = (y + 0.5) * h / H - 0.5, y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), ty = Math.max(0, fy - y0);
        for (let x = 0; x < W; x++) {
            const fx = (x + 0.5) * w / W - 0.5, x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), tx = Math.max(0, fx - x0);
            for (let c = 0; c < 3; c++) {
                const a = src[(y0 * w + x0) * 4 + c] * (1 - tx) + src[(y0 * w + x1) * 4 + c] * tx;
                const b = src[(y1 * w + x0) * 4 + c] * (1 - tx) + src[(y1 * w + x1) * 4 + c] * tx;
                dst[(y * W + x) * 4 + c] = Math.round(a * (1 - ty) + b * ty);
            }
            dst[(y * W + x) * 4 + 3] = 255;
        }
    }
    return dst;
}
save('up12', bilinear(first.rgba, W0, H0, 4320, 2880), 4320, 2880, 'kodim23 bilinear x5.625');
save('up50', bilinear(first.rgba, W0, H0, 8640, 5760), 8640, 5760, 'kodim23 bilinear x11.25');
const photos = []; for (let n = 1; n <= 24; n++) photos.push(await load(n));
function mosaic(cols, rows) {
    const W = cols * W0, H = rows * H0, dst = new Uint8Array(W * H * 4);
    for (let t = 0; t < cols * rows; t++) {
        const tx = t % cols, ty = (t / cols) | 0, p = photos[t % 24], flip = Math.floor(t / 24) % 2 === 1;
        for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) {
            const sx = flip ? W0 - 1 - x : x, s = (y * W0 + sx) * 4, d = ((ty * H0 + y) * W + tx * W0 + x) * 4;
            dst[d] = p.rgba[s]; dst[d + 1] = p.rgba[s + 1]; dst[d + 2] = p.rgba[s + 2]; dst[d + 3] = 255;
        }
    }
    return { dst, W, H };
}
for (const [name, c, r] of [['mos12', 5, 6], ['mos50', 11, 11]]) { const m = mosaic(c, r); save(name, m.dst, m.W, m.H, `${c}x${r} Kodak tiles`); }
writeFileSync(join(data, 'images.json'), JSON.stringify(out, null, 1));
