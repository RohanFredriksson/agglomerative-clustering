// Can the weighted matching be done outside the library? Encode linear-light Y, Cb, Cr (BT.709 on linear values,
// colour axes times w) into bytes (Cr, Y, Cb in the R, G, B slots), so the library's Euclidean RGB matching and
// error carrying act on the weighted space. Map indices back to the real palette.
// Run from the repo root: node bench/spikes/linear-light/encoded-recipe.mjs
import { resolve } from 'path';
const repo = process.cwd();
const { quantizeToIndicesWithPalette, buildPalette } = await import(resolve(repo, 'dist/index.mjs'));
const { meanDeltaE } = await import(resolve(repo, 'bench/lib/metrics.js'));
const { getImageRgba, IMAGES_DIR, KODAK_IMAGES } = await import(resolve(repo, 'fixtures/kodak.js'));
const dec = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const enc = (l) => { l = Math.min(1, Math.max(0, l)); return 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055); };
const LIN = new Float64Array(256).map((_, i) => dec(i));
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
function encoder(w) {
    const s = 255 / w; // keeps s*w*Cb within [-127.5, 127.5]
    return (r8, g8, b8) => {
        const r = LIN[r8], g = LIN[g8], b = LIN[b8];
        const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return [clamp(128 + s * w * (r - Y) / 1.5748), clamp(s * Y), clamp(128 + s * w * (b - Y) / 1.8556)];
    };
}
function blurLinear(rgba, width) {
    const height = rgba.length / 4 / width, sg = 1.5, r = 5, k = []; let sum = 0;
    for (let i = -r; i <= r; i++) {const v = Math.exp(-(i * i) / (2 * sg * sg)); k.push(v); sum += v;}
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    const a = new Float64Array(width * height * 3), b = new Float64Array(width * height * 3);
    for (let i = 0; i < width * height; i++) for (let c = 0; c < 3; c++) a[3 * i + c] = LIN[rgba[4 * i + c]];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) {
        let v = 0; for (let i = -r; i <= r; i++) {const xx = Math.min(width - 1, Math.max(0, x + i)); v += k[i + r] * a[3 * (y * width + xx) + c];}
        b[3 * (y * width + x) + c] = v;
    }
    const o = new Uint8Array(rgba.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        for (let c = 0; c < 3; c++) {let v = 0; for (let i = -r; i <= r; i++) {const yy = Math.min(height - 1, Math.max(0, y + i)); v += k[i + r] * b[3 * (yy * width + x) + c];} o[4 * (y * width + x) + c] = Math.round(enc(v));}
        o[4 * (y * width + x) + 3] = 255;
    }
    return o;
}
const eink = [0, 0, 0, 255, 255, 255, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 255, 128, 0];
const bw = [0, 0, 0, 255, 255, 255];
const results = {};
for (const { name } of KODAK_IMAGES) {
    const { rgba, width } = await getImageRgba(resolve(IMAGES_DIR, name + '.png'));
    const data = Uint8Array.from(rgba), ref = blurLinear(data, width);
    const extracted = Array.from(await buildPalette({ data, format: 'rgba', width }, 16));
    for (const [pname, palette] of [['eink', eink], ['bw', bw], ['extracted', extracted]]) {
        for (const w of [1, 1.5, 2]) {
            const e = encoder(w), img = new Uint8Array(data.length), pal = [];
            for (let i = 0; i < data.length; i += 4) {const v = e(data[i], data[i + 1], data[i + 2]); img[i] = v[0]; img[i + 1] = v[1]; img[i + 2] = v[2]; img[i + 3] = 255;}
            for (let j = 0; j < palette.length; j += 3) pal.push(...e(palette[j], palette[j + 1], palette[j + 2]));
            for (const method of ['floyd-steinberg', 'ordered']) {
                const { indices } = await quantizeToIndicesWithPalette({ data: img, format: 'rgba', width }, Uint8Array.from(pal), { dither: method });
                const out = new Uint8Array(data.length);
                for (let p = 0; p < indices.length; p++) {const j = indices[p]; out[4 * p] = palette[3 * j]; out[4 * p + 1] = palette[3 * j + 1]; out[4 * p + 2] = palette[3 * j + 2]; out[4 * p + 3] = 255;}
                const key = `${pname} ${method} w${w}`;
                (results[key] ||= []).push(meanDeltaE(ref, blurLinear(out, width)));
            }
        }
    }
    console.error(name);
}
for (const [key, v] of Object.entries(results)) console.log(key.padEnd(34), (v.reduce((a, b) => a + b) / v.length).toFixed(2), `[${Math.min(...v).toFixed(2)}–${Math.max(...v).toFixed(2)}]`);
