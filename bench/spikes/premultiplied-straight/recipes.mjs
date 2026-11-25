// Straight output from a premultiplied input: the recipes a user could write, measured through dist/ (3.8.0, which has
// no `premultiplied`; the 4.0 behaviour is reproduced exactly by un-premultiplying the input with the spec's formula
// first, which is what the C++ pass will do, and premultiplying `quantize`'s output with the spec's formula after).
//   node bench/spikes/premultiplied-straight/recipes.mjs > bench/spikes/premultiplied-straight/results.txt
//
// R1 convert the input in JavaScript, then call as for straight input (the 3.x recipe; still works in 4.0).
// R2 4.0 premultiplied in, premultiplied out, then un-premultiply the output in JavaScript.
// R3 4.0 quantizeToIndices on the premultiplied input (straight palette), then expand palette[index] with the input's alpha.
import { quantize, quantizeToIndices, quantizeWithPalette, buildPalette } from '../../../dist/index.mjs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';

const unpremultiply = (src) => {   // the spec's read: min(255, round(c*255/a)), alpha 0 as black
    const out = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i += 4) {
        const a = src[i + 3];
        out[i + 3] = a;
        if (a === 255) {out[i] = src[i]; out[i + 1] = src[i + 1]; out[i + 2] = src[i + 2];}
        else if (a !== 0) {for (let k = 0; k < 3; k++) {out[i + k] = Math.min(255, Math.round(src[i + k] * 255 / a));}}
    }
    return out;
};
const premultiplyInPlace = (p) => {   // the spec's write: round(c*a/255)
    for (let i = 0; i < p.length; i += 4) {
        const a = p[i + 3];
        if (a !== 255) {for (let k = 0; k < 3; k++) {p[i + k] = Math.round(p[i + k] * a / 255);}}
    }
    return p;
};
const expand = (indices, palette, alphaFrom) => {   // R3: palette colour, the input's own alpha
    const out = new Uint8Array(indices.length * 4);
    for (let i = 0, o = 0; i < indices.length; i++, o += 4) {
        const s = indices[i] * 3;
        out[o] = palette[s]; out[o + 1] = palette[s + 1]; out[o + 2] = palette[s + 2]; out[o + 3] = alphaFrom[o + 3];
    }
    return out;
};
const time = (f) => {const t = performance.now(); const r = f(); return [r, performance.now() - t];};
const timeAsync = async (f) => {const t = performance.now(); const r = await f(); return [r, performance.now() - t];};
const median = (v) => [...v].sort((a, b) => a - b)[v.length >> 1];

// A Kodak photo tiled to 12 MP with a horizontal alpha gradient (every alpha value), premultiplied.
const w = 4240, h = 2832, n = w * h;
const photo = await getImageRgba(await ensureImage(KODAK_IMAGES[22]));
const premul = new Uint8Array(n * 4);
for (let i = 0; i < n; i++) {
    const x = i % w, y = Math.floor(i / w), s = ((y % photo.height) * photo.width + (x % photo.width)) * 4, a = x % 256;
    for (let k = 0; k < 3; k++) {premul[i * 4 + k] = Math.round(photo.rgba[s + k] * a / 255);}
    premul[i * 4 + 3] = a;
}
const k = 16, runs = 3;
console.log(`Straight output from a premultiplied ${w}x${h} (12 MP) RGBA image, kodim23 tiled, alpha gradient 0-255, k = ${k}.`);
console.log(`dist/ 3.8.0, Node ${process.version}; times are medians of ${runs} runs, ms.\n`);

for (const dither of [false, true]) {
    const o = dither ? { dither: true, width: w } : {};
    const label = dither ? 'dithered' : 'undithered';
    const t = { r1conv: [], quantize: [], r2back: [], indices: [], r3expand: [] };
    let reference, r2out, r3out;
    for (let r = 0; r < runs; r++) {
        // R1: JS conversion on the calling thread, then straight quantize. Its output is the straight answer.
        const [straightIn, c1] = time(() => unpremultiply(premul));
        t.r1conv.push(c1);
        const [q, cq] = await timeAsync(() => quantize({ data: straightIn, format: 'rgba', width: w }, k, o));
        t.quantize.push(cq);
        reference = q.data;
        // R2: what 4.0 returns (premultiplied), then un-premultiplied in JS.
        const fourOh = premultiplyInPlace(reference.slice());
        const [back, c2] = time(() => unpremultiply(fourOh));
        t.r2back.push(c2);
        r2out = back;
        // R3: indices (4.0 would take the premultiplied input directly; the C++ pass is ~18 ms, not counted here).
        const [ix, ci] = await timeAsync(() => quantizeToIndices({ data: straightIn, format: 'rgba', width: w }, k, o));
        t.indices.push(ci);
        const [ex, c3] = time(() => expand(ix.indices, ix.palette, premul));
        t.r3expand.push(c3);
        r3out = ex;
    }
    // How far R2's double rounding lands from the straight answer, by alpha band (alpha 0 pixels are black in both).
    const bands = [[1, 15], [16, 63], [64, 254], [255, 255]];
    const stats = bands.map(() => ({ pixels: 0, off: 0, max: 0 }));
    let r3diff = 0;
    for (let i = 0; i < n * 4; i += 4) {
        const a = premul[i + 3];
        if (r3out[i] !== reference[i] || r3out[i + 1] !== reference[i + 1] || r3out[i + 2] !== reference[i + 2] || r3out[i + 3] !== reference[i + 3]) {r3diff++;}
        if (a === 0) {continue;}
        const b = bands.findIndex(([lo, hi]) => a >= lo && a <= hi), s = stats[b];
        s.pixels++;
        let d = 0;
        for (let c = 0; c < 3; c++) {d = Math.max(d, Math.abs(r2out[i + c] - reference[i + c]));}
        if (d > 0) {s.off++;}
        s.max = Math.max(s.max, d);
    }
    console.log(`${label}:`);
    console.log(`  quantize itself                           ${median(t.quantize).toFixed(0)}`);
    console.log(`  R1 JS un-premultiply of the input         ${median(t.r1conv).toFixed(0)}  (exact: it is the reference)`);
    console.log(`  R2 JS un-premultiply of 4.0's output      ${median(t.r2back).toFixed(0)}`);
    console.log(`  R3 quantizeToIndices                      ${median(t.indices).toFixed(0)}  + expand in JS ${median(t.r3expand).toFixed(0)}  (pixels differing from R1: ${r3diff})`);
    console.log('  R2 against the straight answer, by input alpha: pixels off / max channel error');
    for (let b = 0; b < bands.length; b++) {
        const s = stats[b];
        console.log(`    alpha ${String(bands[b][0]).padStart(3)}-${String(bands[b][1]).padEnd(3)}  ${(100 * s.off / s.pixels).toFixed(1).padStart(5)}% of ${s.pixels} px, max ${s.max}`);
    }
    // R2 off-palette: how many distinct colours its output has among translucent pixels (the straight answer has k).
    const distinct = new Set();
    for (let i = 0; i < n * 4; i += 4) {if (premul[i + 3] !== 0) {distinct.add((r2out[i] << 16) | (r2out[i + 1] << 8) | r2out[i + 2]);}}
    console.log(`  R2 distinct colours among visible pixels: ${distinct.size} (the straight answer has at most ${k})\n`);
}
