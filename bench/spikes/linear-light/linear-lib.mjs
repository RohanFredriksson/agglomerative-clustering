// Throwaway spike, round 2: linear-light dithering under several linear matching metrics,
// three methods, three palettes, 24 Kodak photos + a dark ramp.
// Run from the repo root: node <this file> <eink|bw|extracted> <out.json>
import { resolve } from 'path';
import { writeFileSync } from 'fs';
const repo = process.cwd();
const { quantizeWithPalette, buildPalette } = await import(resolve(repo, 'dist/index.mjs'));
const { meanDeltaE } = await import(resolve(repo, 'bench/lib/metrics.js'));
const { getImageRgba, IMAGES_DIR, KODAK_IMAGES } = await import(resolve(repo, 'fixtures/kodak.js'));



const dec = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const enc = (l) => { l = Math.min(1, Math.max(0, l)); return 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055); };
const LIN = new Float64Array(256).map((_, i) => dec(i));
const toLinear8 = new Uint8Array(256).map((_, v) => Math.round(v <= 10 ? v / 12.92 : 255 * ((v / 255 + 0.055) / 1.055) ** 2.4));

const matmul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
const XYZ = [[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]];
const metrics = {
    'RGB': [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    'Y+opp': [[0.2126, 0.7152, 0.0722], [0.5, -0.5, 0], [0.25, 0.25, -0.5]],
    'Y+opp/2': [[0.2126, 0.7152, 0.0722], [0.25, -0.25, 0], [0.125, 0.125, -0.25]],
    'Y+opp*2': [[0.2126, 0.7152, 0.0722], [1, -1, 0], [0.5, 0.5, -1]],
    'YCbCr': [[0.2126, 0.7152, 0.0722], [-0.2126 / 1.8556, -0.7152 / 1.8556, 0.9278 / 1.8556], [0.7874 / 1.5748, -0.7152 / 1.5748, -0.0722 / 1.5748]],
    'S-CIELAB opp': matmul([[0.279, 0.72, -0.107], [-0.449, 0.29, -0.077], [0.086, -0.59, 0.501]], XYZ),
};
const mul = (M, a, b, c) => [M[0][0] * a + M[0][1] * b + M[0][2] * c, M[1][0] * a + M[1][1] * b + M[1][2] * c, M[2][0] * a + M[2][1] * b + M[2][2] * c];

const bayer = (() => {
    let m = [[0]];
    for (let n = 1; n < 8; n *= 2) {
        const r = Array.from({ length: 2 * n }, () => new Array(2 * n));
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
            const v = 4 * m[y][x];
            r[y][x] = v; r[y][x + n] = v + 2; r[y + n][x] = v + 3; r[y + n][x + n] = v + 1;
        }
        m = r;
    }
    return m;
})();

function prepare(palette, M) {
    const n = palette.length / 3, lin = [], met = [];
    for (let j = 0; j < n; j++) {
        const c = [LIN[palette[3 * j]], LIN[palette[3 * j + 1]], LIN[palette[3 * j + 2]]];
        lin.push(c); met.push(mul(M, ...c));
    }
    const nearest = (t0, t1, t2) => {
        const q = mul(M, t0, t1, t2);
        let best = 0, bd = Infinity;
        for (let j = 0; j < n; j++) {
            const d = (q[0] - met[j][0]) ** 2 + (q[1] - met[j][1]) ** 2 + (q[2] - met[j][2]) ** 2;
            if (d < bd) {bd = d; best = j;}
        }
        return best;
    };
    return { n, lin, nearest };
}

function diffuse(rgba, width, palette, M, method) {
    const height = rgba.length / 4 / width;
    const { lin, nearest } = prepare(palette, M);
    const buf = new Float64Array(width * height * 3);
    for (let i = 0; i < width * height; i++) for (let c = 0; c < 3; c++) buf[3 * i + c] = LIN[rgba[4 * i + c]];
    const out = new Uint8Array(rgba.length);
    const kernel = method === 'fs'
        ? [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]]
        : [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]];
    for (let y = 0; y < height; y++) {
        const rev = y & 1;
        for (let xi = 0; xi < width; xi++) {
            const x = rev ? width - 1 - xi : xi, i = y * width + x;
            const t0 = buf[3 * i], t1 = buf[3 * i + 1], t2 = buf[3 * i + 2];
            const best = nearest(t0, t1, t2), ch = lin[best];
            let e0 = t0 - ch[0], e1 = t1 - ch[1], e2 = t2 - ch[2];
            const len = Math.hypot(e0, e1, e2);
            if (len > 1) {e0 /= len; e1 /= len; e2 /= len;}
            for (const [dx, dy, w] of kernel) {
                const nx = x + (rev ? -dx : dx), ny = y + dy;
                if (nx < 0 || nx >= width || ny >= height) continue;
                const k = 3 * (ny * width + nx);
                buf[k] += e0 * w; buf[k + 1] += e1 * w; buf[k + 2] += e2 * w;
            }
            out[4 * i] = palette[3 * best]; out[4 * i + 1] = palette[3 * best + 1]; out[4 * i + 2] = palette[3 * best + 2]; out[4 * i + 3] = 255;
        }
    }
    return out;
}

function ordered(rgba, width, palette, M, steps) {
    const height = rgba.length / 4 / width;
    const { lin, nearest } = prepare(palette, M);
    const Y = lin.map((c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]);
    const memo = new Map();
    const out = new Uint8Array(rgba.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = y * width + x, key = (rgba[4 * i] << 16) | (rgba[4 * i + 1] << 8) | rgba[4 * i + 2];
        let recipe = memo.get(key);
        if (!recipe) {
            const b = [LIN[rgba[4 * i]], LIN[rgba[4 * i + 1]], LIN[rgba[4 * i + 2]]], e = [0, 0, 0];
            recipe = [];
            for (let s = 0; s < steps; s++) {
                const j = nearest(b[0] + e[0], b[1] + e[1], b[2] + e[2]);
                recipe.push(j);
                for (let c = 0; c < 3; c++) e[c] += b[c] - lin[j][c];
            }
            recipe.sort((a, c) => Y[a] - Y[c] || a - c);
            memo.set(key, recipe);
        }
        const j = recipe[(bayer[y & 7][x & 7] * steps) >> 6];
        out[4 * i] = palette[3 * j]; out[4 * i + 1] = palette[3 * j + 1]; out[4 * i + 2] = palette[3 * j + 2]; out[4 * i + 3] = 255;
    }
    return out;
}

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

async function library(rgba, width, palette, dither, recipe) {
    const data = recipe ? rgba.map((v, i) => (i % 4 === 3 ? v : toLinear8[v])) : rgba;
    const pal = recipe ? Uint8Array.from(palette, (v) => toLinear8[v]) : Uint8Array.from(palette);
    const res = await quantizeWithPalette({ data: Uint8Array.from(data), format: 'rgba', width }, pal, { dither });
    if (!recipe) return res.data;
    const back = new Map();
    for (let j = palette.length / 3 - 1; j >= 0; j--) back.set(pal[3 * j] << 16 | pal[3 * j + 1] << 8 | pal[3 * j + 2], j);
    const out = new Uint8Array(rgba.length);
    for (let i = 0; i < rgba.length; i += 4) {const j = back.get(res.data[i] << 16 | res.data[i + 1] << 8 | res.data[i + 2]); out[i] = palette[3 * j]; out[i + 1] = palette[3 * j + 1]; out[i + 2] = palette[3 * j + 2]; out[i + 3] = 255;}
    return out;
}


export { metrics, diffuse, ordered, library, LIN };
