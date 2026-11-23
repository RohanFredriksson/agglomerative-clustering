// Can a bare Uint8Array of RGB bytes be told from real RGBA, and what would checking cost?
//   node bench/spikes/bare-rgb/fetch-images.mjs   (once: the emoji sets)
//   node bench/spikes/bare-rgb/measure.mjs > bench/spikes/bare-rgb/results.txt
//
// The signal: E(k) = mean |d[i] - d[i-k]| over the bytes. Real RGBA is smooth at a lag of 4 (each byte is compared
// with the same channel of the pixel before); RGB is smooth at a lag of 3, and reading it with a lag of 4 compares
// each channel with the next one of the following pixel. Two scores, both > 1 meaning "not RGBA":
//   s3   = E(4) / E(3)                       (RGB only)
//   smin = E(4) / min(E(1), E(2), E(3))      (also 1- and 2-channel data: grey, grey + alpha)
// Both are computed on a sample (up to 2048 windows of 96 bytes, evenly spread) and on the whole array, to check
// the sample agrees. Harm is how much worse a misread palette maps the true image: buildPalette(bare bytes, 16),
// against buildPalette of the image given correctly, each mapped to the true RGB pixels by nearest colour (MSE ratio).
import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { buildPalette, quantize } from '../../../dist/index.mjs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';
import { syntheticImages } from '../../lib/images.js';
import { MIN_BYTES, looksLikeRgb } from './check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const emojiRoot = join(here, '../../../fixtures/images/bare-rgb');

// ---- the scores ----

const WINDOW = 96;
let WINDOWS = 2048;

function lagSums(d, start, end, sums) {
    // Grey tests, counted only where the image changes (a unit that differs from the one before it), since flat areas
    // read the same either way: share of RGB triples (step 3) whose bytes are equal (g3); share of RGBA pixels (step 4)
    // whose colour bytes are equal (g4); share of RGBA pixels whose four bytes are equal (q4: a premultiplied white
    // mask is (a, a, a, a)).
    for (let i = start + 3; i + 2 < end; i += 3) {
        if (d[i] === d[i - 3] && d[i + 1] === d[i - 2] && d[i + 2] === d[i - 1]) {continue;}
        sums[5] += (d[i] === d[i + 1] && d[i] === d[i + 2]) ? 1 : 0; sums[6]++;
    }
    for (let i = start + 4; i + 3 < end; i += 4) {
        if (d[i] === d[i - 4] && d[i + 1] === d[i - 3] && d[i + 2] === d[i - 2] && d[i + 3] === d[i - 1]) {continue;}
        const grey = d[i] === d[i + 1] && d[i] === d[i + 2];
        sums[7] += grey ? 1 : 0; sums[9] += grey && d[i] === d[i + 3] ? 1 : 0; sums[8]++;
    }
    for (let i = start + 4; i < end; i++) {
        const v = d[i];
        sums[0] += Math.abs(v - d[i - 1]);
        sums[1] += Math.abs(v - d[i - 2]);
        sums[2] += Math.abs(v - d[i - 3]);
        sums[3] += Math.abs(v - d[i - 4]);
    }
    sums[4] += Math.max(0, end - start - 4);
}

function scores(d, sampled) {
    const sums = new Float64Array(10);
    if (!sampled || d.length <= WINDOW * WINDOWS) {lagSums(d, 0, d.length, sums);}
    else {
        // window starts on a multiple of 12, so every window begins on a pixel under both readings
        const step = Math.floor((d.length - WINDOW) / (WINDOWS - 1) / 12) * 12;
        for (let w = 0; w < WINDOWS; w++) {lagSums(d, w * step, w * step + WINDOW, sums);}
    }
    const n = Math.max(1, sums[4]);
    const [e1, e2, e3, e4] = [sums[0] / n, sums[1] / n, sums[2] / n, sums[3] / n];
    const eps = 0.05; // keeps flat images (every lag 0) at a score of 1
    const g3 = sums[5] / Math.max(1, sums[6]), g4 = sums[7] / Math.max(1, sums[8]), q4 = sums[9] / Math.max(1, sums[8]);
    return { s3: (e4 + eps) / (e3 + eps), smin: (e4 + eps) / (Math.min(e1, e2, e3) + eps), e3, e4, g3, g4, q4 };
}

// The combined rule: RGB if the 3-byte step is clearly smoother, unless most changing RGBA pixels have four equal
// bytes (a premultiplied white mask); or grey RGB, whose changing bytes come in equal triples at a step of 3 but not
// at a step of 4. Below MIN_BYTES there is too little to go on.
function flagged(r, t) {
    if (r.size < MIN_BYTES) {return false;}
    return (r.s3 > t && r.q4 < 0.5) || (r.g3 > 0.9 && r.g4 < 0.6);
}

// ---- image variants ----

const luma = (r, g, b) => Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);

function rgbaFrom(rgb, alphaAt) {
    const n = rgb.length / 3, out = new Uint8Array(n * 4);
    for (let p = 0; p < n; p++) {
        out[4 * p] = rgb[3 * p]; out[4 * p + 1] = rgb[3 * p + 1]; out[4 * p + 2] = rgb[3 * p + 2];
        out[4 * p + 3] = alphaAt(p, rgb[3 * p], rgb[3 * p + 1], rgb[3 * p + 2]);
    }
    return out;
}
const stripAlpha = (rgba) => {
    const n = rgba.length / 4, out = new Uint8Array(n * 3);
    for (let p = 0; p < n; p++) {out[3 * p] = rgba[4 * p]; out[3 * p + 1] = rgba[4 * p + 1]; out[3 * p + 2] = rgba[4 * p + 2];}
    return out;
};
const onBackground = (rgba, bg) => {
    const n = rgba.length / 4, out = new Uint8Array(n * 3);
    for (let p = 0; p < n; p++) {
        const a = rgba[4 * p + 3] / 255;
        for (let c = 0; c < 3; c++) {out[3 * p + c] = Math.round(rgba[4 * p + c] * a + bg * (1 - a));}
    }
    return out;
};
const premultiply = (rgba) => {
    const out = new Uint8Array(rgba);
    for (let p = 0; p < out.length; p += 4) {
        const a = out[p + 3];
        for (let c = 0; c < 3; c++) {out[p + c] = Math.round(out[p + c] * a / 255);}
    }
    return out;
};
const greyOf = (rgb) => {
    const n = rgb.length / 3, out = new Uint8Array(n);
    for (let p = 0; p < n; p++) {out[p] = luma(rgb[3 * p], rgb[3 * p + 1], rgb[3 * p + 2]);}
    return out;
};
const expandGrey = (g) => {const out = new Uint8Array(g.length * 3); for (let p = 0; p < g.length; p++) {out[3 * p] = out[3 * p + 1] = out[3 * p + 2] = g[p];} return out;};
function crop(rgb, width, side) {
    const height = rgb.length / 3 / width, x0 = (width - side) >> 1, y0 = (height - side) >> 1;
    const out = new Uint8Array(side * side * 3);
    for (let y = 0; y < side; y++) {out.set(rgb.subarray(((y0 + y) * width + x0) * 3, ((y0 + y) * width + x0 + side) * 3), y * side * 3);}
    return out;
}

function rng(seed) {let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);}

function kodakNegatives(rgb, width, height) {
    const r = rng(7);
    const cx = width / 2, cy = height / 2, radius = 0.4 * Math.min(width, height), feather = 32;
    const featherAt = (p) => {
        const x = p % width, y = (p / width) | 0, d = Math.hypot(x - cx, y - cy);
        return Math.round(255 * Math.min(1, Math.max(0, (radius - d) / feather)));
    };
    const cutout = rgbaFrom(rgb, featherAt);
    for (let p = 0; p < cutout.length; p += 4) {if (cutout[p + 3] === 0) {cutout[p] = cutout[p + 1] = cutout[p + 2] = 0;}}
    const grey = expandGrey(greyOf(rgb));
    return {
        'opaque': rgbaFrom(rgb, () => 255),
        'feathered cutout': cutout,
        'alpha ramp': rgbaFrom(rgb, (p) => Math.round(255 * (p % width) / (width - 1))),
        'alpha = luma': rgbaFrom(rgb, (p, a, b, c) => luma(a, b, c)),
        'alpha 128': rgbaFrom(rgb, () => 128),
        'alpha noise': rgbaFrom(rgb, () => (r() * 256) | 0),
        'premultiplied cutout': premultiply(cutout),
        'premultiplied alpha = luma': premultiply(rgbaFrom(rgb, (p, a, b, c) => luma(a, b, c))),
        'grey opaque': rgbaFrom(grey, () => 255),
        'white, alpha = luma (mask)': rgbaFrom(new Uint8Array(rgb.length).fill(255), (p) => luma(rgb[3 * p], rgb[3 * p + 1], rgb[3 * p + 2])),
        'premultiplied white mask': premultiply(rgbaFrom(new Uint8Array(rgb.length).fill(255), (p) => luma(rgb[3 * p], rgb[3 * p + 1], rgb[3 * p + 2]))),
    };
}

function kodakPositives(rgb) {
    const g = greyOf(rgb), ga = new Uint8Array(g.length * 2);
    for (let p = 0; p < g.length; p++) {ga[2 * p] = g[p]; ga[2 * p + 1] = 255;}
    return {
        'rgb': { bytes: rgb, truth: rgb },
        'grey as rgb': { bytes: expandGrey(g), truth: expandGrey(g) },
        'grey, 1 channel': { bytes: g, truth: expandGrey(g) },
        'grey + alpha, 2 channels': { bytes: ga, truth: expandGrey(g) },
    };
}

// ---- harm ----

function mapMse(truthRgb, palette) {
    let sum = 0;
    const n = truthRgb.length / 3, k = palette.length / 3;
    for (let p = 0; p < n; p++) {
        const r = truthRgb[3 * p], g = truthRgb[3 * p + 1], b = truthRgb[3 * p + 2];
        let best = Infinity;
        for (let j = 0; j < k; j++) {
            const dr = r - palette[3 * j], dg = g - palette[3 * j + 1], db = b - palette[3 * j + 2];
            const d = dr * dr + dg * dg + db * db;
            if (d < best) {best = d;}
        }
        sum += best;
    }
    return sum / n / 3;
}
async function harm(bytes, truth) {
    if (bytes.length % 4) {return null;} // the library already rejects it
    const wrong = await buildPalette(new Uint8Array(bytes), 16);
    const right = await buildPalette({ data: truth, format: 'rgb' }, 16);
    const a = mapMse(truth, right), b = mapMse(truth, wrong);
    return a === 0 ? (b === 0 ? 1 : Infinity) : b / a;
}

// ---- collect ----

const rows = []; // {kind: 'rgba'|'other', group, name, bytes, harm?, sampledAgrees}
function add(kind, group, name, bytes, harmValue) {
    if (bytes.length % 4) {return;} // not a multiple of 4: rejected today, nothing to detect
    const exact = scores(bytes, false), sampled = scores(bytes, true);
    WINDOWS = 512; const small = scores(bytes, true); WINDOWS = 2048;
    rows.push({ kind, group, name, size: bytes.length, lean: looksLikeRgb(bytes), ...sampled, exactS3: exact.s3, exactSmin: exact.smin, exactRow: { size: bytes.length, ...exact }, smallRow: { size: bytes.length, ...small }, harm: harmValue });
}

const CROPS = [2, 4, 8, 16, 32, 64];
for (const img of KODAK_IMAGES) {
    const { rgba, width, height } = await getImageRgba(await ensureImage(img));
    const rgb = stripAlpha(rgba);
    for (const [variant, bytes] of Object.entries(kodakNegatives(rgb, width, height))) {add('rgba', `kodak: ${variant}`, img.name, bytes);}
    for (const [variant, { bytes, truth }] of Object.entries(kodakPositives(rgb))) {add('other', `kodak: ${variant}`, img.name, bytes, await harm(bytes, truth));}
    // pixel-level patterns: dithered to 16 colours (two methods), and pixel art (a 96×64 cut to 12 colours, upscaled 8×)
    for (const dither of ['floyd-steinberg', 'ordered']) {
        const { data } = await quantize({ data: rgb, format: 'rgb', width }, 16, { dither });
        const d = new Uint8Array(data);
        add('rgba', `kodak: dithered (${dither}), opaque`, img.name, rgbaFrom(d, () => 255));
        add('other', `kodak: dithered (${dither}), rgb`, img.name, d, await harm(d, d));
    }
    {
        const small = new Uint8Array(96 * 64 * 3);
        for (let y = 0; y < 64; y++) {for (let x = 0; x < 96; x++) {for (let c = 0; c < 3; c++) {small[(y * 96 + x) * 3 + c] = rgb[((y * 8) * width + x * 8) * 3 + c];}}}
        const { data } = await quantize({ data: small, format: 'rgb' }, 12);
        const art = new Uint8Array(width * height * 3);
        for (let y = 0; y < height; y++) {for (let x = 0; x < width; x++) {for (let c = 0; c < 3; c++) {art[(y * width + x) * 3 + c] = data[((y >> 3) * 96 + (x >> 3)) * 3 + c];}}}
        add('rgba', 'kodak: pixel art, sprite alpha', img.name, rgbaFrom(art, (p) => ((p % width) >> 3) % 5 === 0 ? 0 : 255));
        add('other', 'kodak: pixel art, rgb', img.name, art, await harm(art, art));
    }
    for (const side of CROPS) {
        const c = crop(rgb, width, side);
        add('rgba', `kodak crop ${side}×${side}: opaque`, img.name, rgbaFrom(c, () => 255));
        add('other', `kodak crop ${side}×${side}: rgb`, img.name, c, await harm(c, c));
    }
}
for (const img of syntheticImages()) {
    const rgb = stripAlpha(img.rgba);
    add('rgba', `synthetic: opaque`, img.name, img.rgba);
    add('other', `synthetic: rgb`, img.name, rgb, await harm(rgb, rgb));
}
for (const set of ['twemoji', 'noto']) {
    for (const file of (await readdir(join(emojiRoot, set))).sort()) {
        const { data } = await sharp(join(emojiRoot, set, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const rgba = new Uint8Array(data);
        add('rgba', `${set}: rgba`, file, rgba);
        add('rgba', `${set}: premultiplied`, file, premultiply(rgba));
        const white = onBackground(rgba, 255), black = onBackground(rgba, 0);
        add('other', `${set}: rgb on white`, file, white, await harm(white, white));
        add('other', `${set}: rgb on black`, file, black, await harm(black, black));
    }
}

// ---- report ----

const THRESHOLDS = [1.1, 1.25, 1.5, 2, 3];
const pct = (xs, q) => xs[Math.min(xs.length - 1, Math.floor(q * (xs.length - 1)))];
const f2 = (x) => (x === null || x === undefined ? '—' : x === Infinity ? '∞' : x.toFixed(2));

for (const score of ['s3', 'smin']) {
    console.log(`\n=== score ${score} (sampled) ===`);
    console.log(`${'group'.padEnd(44)} ${'n'.padStart(4)}  ${'min'.padStart(6)} ${'median'.padStart(6)} ${'max'.padStart(6)}   ` +
        THRESHOLDS.map((t) => `>${t}`.padStart(6)).join(' ') + '   harm of missed at 1.5 (max)');
    for (const kind of ['rgba', 'other']) {
        console.log(kind === 'rgba' ? '-- real RGBA: every flag is a false positive' : '-- not RGBA: every miss is a false negative');
        const groups = [...new Set(rows.filter((r) => r.kind === kind).map((r) => r.group))];
        for (const group of groups) {
            const rs = rows.filter((r) => r.group === group && r.kind === kind);
            const xs = rs.map((r) => r[score]).sort((a, b) => a - b);
            const counts = THRESHOLDS.map((t) => String(xs.filter((x) => x > t).length).padStart(6)).join(' ');
            const missed = rs.filter((r) => r[score] <= 1.5 && r.harm !== undefined && r.harm !== null);
            const missedHarm = kind === 'other' ? (missed.length ? `${missed.length} missed, ${f2(Math.max(...missed.map((r) => r.harm)))}×` : 'none missed') : '';
            console.log(`${group.padEnd(44)} ${String(rs.length).padStart(4)}  ${f2(xs[0]).padStart(6)} ${f2(pct(xs, 0.5)).padStart(6)} ${f2(xs[xs.length - 1]).padStart(6)}   ${counts}   ${missedHarm}`);
        }
    }
}

console.log('\n=== highest-scoring real RGBA (s3) ===');
for (const r of rows.filter((r) => r.kind === 'rgba').sort((a, b) => b.s3 - a.s3).slice(0, 12)) {
    console.log(`${r.group.padEnd(44)} ${r.name.padEnd(28)} s3 ${f2(r.s3)}  smin ${f2(r.smin)}  E3 ${f2(r.e3)} E4 ${f2(r.e4)}`);
}
console.log('\n=== lowest-scoring RGB (s3), with harm ===');
for (const r of rows.filter((r) => r.kind === 'other' && !r.group.includes('channel')).sort((a, b) => a.s3 - b.s3).slice(0, 12)) {
    console.log(`${r.group.padEnd(44)} ${r.name.padEnd(28)} s3 ${f2(r.s3)}  harm ${f2(r.harm)}×  E3 ${f2(r.e3)} E4 ${f2(r.e4)}`);
}
console.log('\n=== harm: misread palette MSE / correct palette MSE, mapping the true image (k = 16) ===');
for (const group of [...new Set(rows.filter((r) => r.kind === 'other').map((r) => r.group))]) {
    const hs = rows.filter((r) => r.group === group && r.harm !== null && r.harm !== undefined && Number.isFinite(r.harm)).map((r) => r.harm).sort((a, b) => a - b);
    if (hs.length) {console.log(`${group.padEnd(44)} ${String(hs.length).padStart(4)}  min ${f2(hs[0])}×  median ${f2(pct(hs, 0.5))}×  max ${f2(hs[hs.length - 1])}×`);}
}
const harmful = rows.filter((r) => r.kind === 'other' && r.harm >= 1.1);
console.log(`\nRGB cases a misread palette maps at least 1.1× worse: ${harmful.length} of ${rows.filter((r) => r.kind === 'other' && r.harm !== null && r.harm !== undefined).length}`);
for (const t of THRESHOLDS) {
    console.log(`  s3 > ${t}: catches ${harmful.filter((r) => r.s3 > t).length}; smin > ${t}: catches ${harmful.filter((r) => r.smin > t).length}`);
}

let disagree = 0;
for (const r of rows) {for (const t of THRESHOLDS) {if ((r.s3 > t) !== (r.exactS3 > t) || (r.smin > t) !== (r.exactSmin > t)) {disagree++; break;}}}
console.log(`\nSampled and whole-array scores fall on different sides of a threshold for ${disagree} of ${rows.length} images.`);

console.log('\n=== combined rule (sampled, 2048 windows) ===');
console.log(`grey test: g3 = share of 3-aligned equal byte triples, g4 = 4-aligned. Rule: (s3 > T and q4 < 0.5) or (g3 > 0.9 and g4 < 0.6), arrays of at least ${MIN_BYTES} bytes`);
for (const kind of ['rgba', 'other']) {
    console.log(kind === 'rgba' ? '-- real RGBA (flags are false positives), g3 / g4 / q4 medians' : '-- not RGBA (misses are false negatives)');
    for (const group of [...new Set(rows.filter((r) => r.kind === kind).map((r) => r.group))]) {
        const rs = rows.filter((r) => r.group === group && r.kind === kind);
        const med = (key) => f2(pct(rs.map((r) => r[key]).sort((a, b) => a - b), 0.5));
        const counts = THRESHOLDS.map((t) => String(rs.filter((r) => flagged(r, t)).length).padStart(6)).join(' ');
        console.log(`${group.padEnd(44)} ${String(rs.length).padStart(4)}  g3 ${med('g3')} g4 ${med('g4')} q4 ${med('q4')}   flagged at T = ${THRESHOLDS.join(' / ')}: ${counts}`);
    }
}
for (const t of THRESHOLDS) {
    const neg = rows.filter((r) => r.kind === 'rgba'), pos = rows.filter((r) => r.kind === 'other' && !r.group.includes('channel'));
    const fp = neg.filter((r) => flagged(r, t)), harmfulPos = pos.filter((r) => r.harm >= 1.1);
    const caught = harmfulPos.filter((r) => flagged(r, t));
    const bigHarmful = harmfulPos.filter((r) => r.size >= 64 * 64 * 3);
    console.log(`T = ${t}: false positives ${fp.length} of ${neg.length}; RGB (3-channel) with harm ≥ 1.1× caught ${caught.length} of ${harmfulPos.length}` +
        `, of those at least 64×64: ${bigHarmful.filter((r) => flagged(r, t)).length} of ${bigHarmful.length}`);
}
console.log('\nmissed at T = 1.25, harm ≥ 1.1×, at least 64×64:');
for (const r of rows.filter((r) => r.kind === 'other' && !r.group.includes('channel') && r.harm >= 1.1 && r.size >= 64 * 64 * 3 && !flagged(r, 1.25))) {
    console.log(`  ${r.group.padEnd(30)} ${r.name.padEnd(28)} s3 ${f2(r.s3)} g3 ${f2(r.g3)} g4 ${f2(r.g4)} q4 ${f2(r.q4)} harm ${f2(r.harm)}×`);
}
{
    const differ = rows.filter((r) => r.lean !== flagged(r, 1.25));
    console.log(`Lean check (512 windows) decided differently from the rule at T = 1.25 with 2048 windows: ${differ.length} of ${rows.length}` +
        (differ.length ? ` (${differ.map((r) => `${r.group} ${r.name}: lean ${r.lean}`).join('; ')})` : ''));
    const neg = rows.filter((r) => r.kind === 'rgba'), harmfulPos = rows.filter((r) => r.kind === 'other' && !r.group.includes('channel') && r.harm >= 1.1);
    console.log(`Lean check: false positives ${neg.filter((r) => r.lean).length} of ${neg.length}; harmful RGB caught ${harmfulPos.filter((r) => r.lean).length} of ${harmfulPos.length}`);
}
for (const [label, key] of [['whole array', 'exactRow'], ['512 windows', 'smallRow']]) {
    let differ = 0;
    for (const r of rows) {if (THRESHOLDS.some((t) => flagged(r, t) !== flagged(r[key], t))) {differ++;}}
    console.log(`Rule decided differently with the ${label} than with 2048 windows: ${differ} of ${rows.length} images`);
}

// ---- cost ----

function time(fn, reps) {const t0 = process.hrtime.bigint(); for (let i = 0; i < reps; i++) {fn();} return Number(process.hrtime.bigint() - t0) / 1e6 / reps;}
const { rgba: k23 } = await getImageRgba(await ensureImage(KODAK_IMAGES[22]));
const big = new Uint8Array(4000 * 3000 * 4); for (let i = 0; i < big.length; i++) {big[i] = k23[i % k23.length];}
const tiny = new Uint8Array(64);
console.log('\n=== cost of the check ===');
for (const [name, d] of [['768×512 RGBA', k23], ['12 MP RGBA', big], ['4×4 RGBA', tiny]]) {
    scores(d, true);
    const t2048 = time(() => scores(d, true), 200);
    WINDOWS = 512; const t512 = time(() => scores(d, true), 400); WINDOWS = 2048;
    looksLikeRgb(d);
    console.log(`${name.padEnd(14)} 2048 windows ${t2048.toFixed(3)} ms   512 windows ${t512.toFixed(3)} ms   whole array ${time(() => scores(d, false), 3).toFixed(2)} ms   lean check ${time(() => looksLikeRgb(d), 2000).toFixed(3)} ms`);
}
const t0 = performance.now(); await buildPalette(k23, 16); const t1 = performance.now();
console.log(`buildPalette(kodim23, 16): ${(t1 - t0).toFixed(1)} ms`);
const pal = await buildPalette(k23, 16);
const { quantizeWithPalette } = await import('../../../dist/index.mjs');
await quantizeWithPalette(k23, pal);
const t2 = performance.now(); for (let i = 0; i < 20; i++) {await quantizeWithPalette(k23, pal);} const t3 = performance.now();
console.log(`quantizeWithPalette(kodim23, 16 colours), the fastest call that takes an image: ${((t3 - t2) / 20).toFixed(2)} ms`);
