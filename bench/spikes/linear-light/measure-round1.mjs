// Throwaway spike: linear-light dithering with Atkinson and with OKLab matching.
// Run from the repo root: node bench/spikes/linear-light/measure-round1.mjs  (six photos; the OKLab and LMS rows)
import { resolve } from 'path';
const repo = process.cwd();
const { quantizeWithPalette } = await import(resolve(repo, 'dist/index.mjs'));
const { meanDeltaE } = await import(resolve(repo, 'bench/lib/metrics.js'));
const { getImageRgba, IMAGES_DIR } = await import(resolve(repo, 'fixtures/kodak.js'));

const dec = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const enc = (l) => { l = Math.min(1, Math.max(0, l)); return 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055); };
const LIN = new Float64Array(256).map((_, i) => dec(i));
const toLinear8 = new Uint8Array(256).map((_, v) => Math.round(v <= 10 ? v / 12.92 : 255 * ((v / 255 + 0.055) / 1.055) ** 2.4));

function oklab(r, g, b) { // linear rgb in [0,1]
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}

// Error diffusion in linear light at full precision.
// match: 'linear' | 'oklab'. method: 'fs' | 'atkinson' | 'atkinson-srgb-drop'
const mul = (M, c) => [0, 1, 2].map((r) => M[r][0] * c[0] + M[r][1] * c[1] + M[r][2] * c[2]);
// OKLab's linear first stage (LMS), and XYZ-like luminance plus opponent axes.
const LMS = [[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]];
const YOPP = [[0.2126, 0.7152, 0.0722], [0.5, -0.5, 0], [0.25, 0.25, -0.5]];
function ditherLinear(rgba, width, palette, { match, method, M }) {
    const height = rgba.length / 4 / width;
    const n = palette.length / 3;
    const pl = [], po = [], pm = [];
    for (let j = 0; j < n; j++) {
        const c = [LIN[palette[3 * j]], LIN[palette[3 * j + 1]], LIN[palette[3 * j + 2]]];
        pl.push(c); po.push(oklab(...c)); pm.push(M ? mul(M, c) : c);
    }
    const buf = new Float64Array(width * height * 3);
    for (let i = 0; i < width * height; i++) for (let c = 0; c < 3; c++) buf[3 * i + c] = LIN[rgba[4 * i + c]];
    const out = new Uint8Array(rgba.length);
    const fs = [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]];
    const at = [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]];
    const kernel = method === 'fs' ? fs : at;
    for (let y = 0; y < height; y++) {
        const rev = y & 1;
        for (let xi = 0; xi < width; xi++) {
            const x = rev ? width - 1 - xi : xi;
            const i = y * width + x;
            const t = [buf[3 * i], buf[3 * i + 1], buf[3 * i + 2]];
            let best = 0, bd = Infinity;
            const q = match === 'oklab' ? oklab(...t.map((v) => Math.min(1, Math.max(0, v)))) : M ? mul(M, t) : t;
            const ref = match === 'oklab' ? po : M ? pm : pl;
            for (let j = 0; j < n; j++) {
                const d = (q[0] - ref[j][0]) ** 2 + (q[1] - ref[j][1]) ** 2 + (q[2] - ref[j][2]) ** 2;
                if (d < bd) {bd = d; best = j;}
            }
            const ch = pl[best];
            let err = [t[0] - ch[0], t[1] - ch[1], t[2] - ch[2]];
            if (method === 'atkinson-srgb-drop') {
                // Atkinson drops a quarter of the error measured in sRGB values, not in light:
                // pass on (in light) the difference between the chosen colour and the colour 3/4 of the way to the target in sRGB.
                // The kernel then passes all 6/6 of that (each 1/6), since the drop is already applied.
                err = [0, 1, 2].map((c) => {
                    const cs = enc(ch[c]), ts = enc(t[c]) + (t[c] > 1 ? 255 * (t[c] - 1) : t[c] < 0 ? 255 * t[c] : 0);
                    const ks = cs + 0.75 * (ts - cs);
                    const kl = ks < 0 ? ks / 255 : ks > 255 ? 1 + (ks - 255) / 255 : dec(ks);
                    return (kl - ch[c]) * (8 / 6);
                });
            }
            // cap the error length at the range, as the library does
            const len = Math.hypot(...err);
            if (len > 1) err = err.map((e) => e / len);
            for (const [dx, dy, w] of kernel) {
                const nx = x + (rev ? -dx : dx), ny = y + dy;
                if (nx < 0 || nx >= width || ny >= height) continue;
                const k = 3 * (ny * width + nx);
                for (let c = 0; c < 3; c++) buf[k + c] += err[c] * w;
            }
            for (let c = 0; c < 3; c++) out[4 * i + c] = palette[3 * best + c];
            out[4 * i + 3] = 255;
        }
    }
    return out;
}

// Gaussian blur (sigma 1.5) in linear light, back to 8-bit sRGB: what the eye sees at a viewing distance.
function blurLinear(rgba, width) {
    const height = rgba.length / 4 / width, s = 1.5, r = 5;
    const k = []; let sum = 0;
    for (let i = -r; i <= r; i++) {const v = Math.exp(-(i * i) / (2 * s * s)); k.push(v); sum += v;}
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    const a = new Float64Array(width * height * 3), b = new Float64Array(width * height * 3);
    for (let i = 0; i < width * height; i++) for (let c = 0; c < 3; c++) a[3 * i + c] = LIN[rgba[4 * i + c]];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) {
        let v = 0; for (let i = -r; i <= r; i++) {const xx = Math.min(width - 1, Math.max(0, x + i)); v += k[i + r] * a[3 * (y * width + xx) + c];}
        b[3 * (y * width + x) + c] = v;
    }
    const o = new Uint8Array(rgba.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        for (let c = 0; c < 3; c++) {
            let v = 0; for (let i = -r; i <= r; i++) {const yy = Math.min(height - 1, Math.max(0, y + i)); v += k[i + r] * b[3 * (yy * width + x) + c];}
            o[4 * (y * width + x) + c] = Math.round(enc(v));
        }
        o[4 * (y * width + x) + 3] = 255;
    }
    return o;
}
const lum = (rgba) => {let s = 0; for (let i = 0; i < rgba.length; i += 4) s += 0.2126 * LIN[rgba[i]] + 0.7152 * LIN[rgba[i + 1]] + 0.0722 * LIN[rgba[i + 2]]; return s / (rgba.length / 4);};

const palettes = {
    eink: [0, 0, 0, 255, 255, 255, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 255, 128, 0],
    bw: [0, 0, 0, 255, 255, 255],
};

async function library(rgba, width, palette, opts, recipe) {
    const data = recipe ? rgba.map((v, i) => (i % 4 === 3 ? v : toLinear8[v])) : rgba;
    const pal = recipe ? Uint8Array.from(palette, (v) => toLinear8[v]) : Uint8Array.from(palette);
    const res = await quantizeWithPalette({ data: Uint8Array.from(data), format: 'rgba', width }, pal, opts);
    if (!recipe) return res.data;
    // map linear palette colours back to the real palette
    const out = new Uint8Array(rgba.length);
    const back = new Map(); for (let j = 0; j < palette.length / 3; j++) back.set(pal[3 * j] << 16 | pal[3 * j + 1] << 8 | pal[3 * j + 2], j);
    for (let i = 0; i < rgba.length; i += 4) {const j = back.get(res.data[i] << 16 | res.data[i + 1] << 8 | res.data[i + 2]); out[i] = palette[3 * j]; out[i + 1] = palette[3 * j + 1]; out[i + 2] = palette[3 * j + 2]; out[i + 3] = 255;}
    return out;
}

const variants = {
    'FS sRGB (library today)': (img, w, p) => library(img, w, p, { dither: 'floyd-steinberg' }),
    'FS sRGB, oklab (library today)': (img, w, p) => library(img, w, p, { dither: 'floyd-steinberg', colorSpace: 'oklab' }),
    'FS 8-bit recipe (library)': (img, w, p) => library(img, w, p, { dither: 'floyd-steinberg' }, true),
    'FS linear, match linear': (img, w, p) => ditherLinear(img, w, p, { match: 'linear', method: 'fs' }),
    'FS linear, match linear LMS': (img, w, p) => ditherLinear(img, w, p, { match: 'linear', method: 'fs', M: LMS }),
    'FS linear, match Y+opponent': (img, w, p) => ditherLinear(img, w, p, { match: 'linear', method: 'fs', M: YOPP }),
    'FS linear, match OKLab': (img, w, p) => ditherLinear(img, w, p, { match: 'oklab', method: 'fs' }),
    'Atkinson sRGB (library today)': (img, w, p) => library(img, w, p, { dither: 'atkinson' }),
    'Atkinson 8-bit recipe (library)': (img, w, p) => library(img, w, p, { dither: 'atkinson' }, true),
    'Atkinson linear, match linear': (img, w, p) => ditherLinear(img, w, p, { match: 'linear', method: 'atkinson' }),
    'Atkinson linear, match LMS': (img, w, p) => ditherLinear(img, w, p, { match: 'linear', method: 'atkinson', M: LMS }),
    'Atkinson linear, match Y+opp': (img, w, p) => ditherLinear(img, w, p, { match: 'linear', method: 'atkinson', M: YOPP }),
    'Atkinson linear, drop in sRGB': (img, w, p) => ditherLinear(img, w, p, { match: 'linear', method: 'atkinson-srgb-drop' }),
    'Atkinson linear, OKLab': (img, w, p) => ditherLinear(img, w, p, { match: 'oklab', method: 'atkinson' }),
    'Atkinson linear, OKLab, drop in sRGB': (img, w, p) => ditherLinear(img, w, p, { match: 'oklab', method: 'atkinson-srgb-drop' }),
};

// Images: six Kodak photos, plus a dark ramp (sRGB 0..48 left to right) for the precision question.
const images = [];
for (const name of ['kodim01', 'kodim03', 'kodim05', 'kodim14', 'kodim19', 'kodim23']) {
    const { rgba: data, width } = await getImageRgba(resolve(IMAGES_DIR, name + '.png'));
    images.push({ name, data: Uint8Array.from(data), width });
}
{
    const width = 768, height = 128, data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {const v = Math.round(48 * x / (width - 1)); data.set([v, v, v, 255], 4 * (y * width + x));}
    images.push({ name: 'dark ramp', data, width });
}

const rows = [];
for (const [pname, palette] of Object.entries(palettes)) {
    for (const img of images) {
        const ref = blurLinear(img.data, img.width), y0 = lum(img.data);
        for (const [vname, fn] of Object.entries(variants)) {
            const out = await fn(img.data, img.width, palette);
            rows.push({ palette: pname, image: img.name, variant: vname, dE: meanDeltaE(ref, blurLinear(out, img.width)), Y: lum(out) / y0 });
        }
    }
}
const fmt = (v, d = 2) => v.toFixed(d);
for (const pname of Object.keys(palettes)) {
    console.log(`\n## ${pname}: ΔE2000 after a linear-light blur (photos: min–max, mean), mean luminance vs original; dark ramp ΔE`);
    for (const vname of Object.keys(variants)) {
        const ph = rows.filter((r) => r.palette === pname && r.variant === vname && r.image !== 'dark ramp');
        const ramp = rows.find((r) => r.palette === pname && r.variant === vname && r.image === 'dark ramp');
        const dEs = ph.map((r) => r.dE), Ys = ph.map((r) => r.Y);
        console.log(`${vname.padEnd(38)} ΔE ${fmt(Math.min(...dEs))}–${fmt(Math.max(...dEs))} mean ${fmt(dEs.reduce((a, b) => a + b) / dEs.length)}  Y ${fmt(Math.min(...Ys))}–${fmt(Math.max(...Ys))}  ramp ΔE ${fmt(ramp.dE)} Y ${fmt(ramp.Y)}`);
    }
}
