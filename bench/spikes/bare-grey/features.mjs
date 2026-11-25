// Collects candidate features for every corpus image (only those whose length is a multiple of 4: the rest are
// rejected today) and, for each positive, the mapping MSE of the true image with the palette of the bytes read as RGBA
// (wrong) and of the image given correctly (right), k = 16, into features.json (gitignored) for rules.mjs.
//   node bench/spikes/bare-grey/features.mjs
import { writeFile } from 'node:fs/promises';
import { buildPalette } from '../../../dist/index.mjs';
import { looksLikeRgb } from '../../../dist/shared.mjs';
import { corpus } from './corpus.mjs';
import { looksLikeGrey } from './check.mjs';


// Whole-array features: E[k] = mean |d[i] - d[i-k]| for k = 1..4, also per phase (i mod 4); exact-equality shares
// over pixels (RGBA reading) that differ from the pixel before.
export function features(d) {
    const E = new Float64Array(5), P = Array.from({ length: 4 }, () => new Float64Array(5));
    let n = 0;
    for (let i = 4; i < d.length; i++) {
        for (let k = 1; k <= 4; k++) {const x = Math.abs(d[i] - d[i - k]); E[k] += x; P[i & 3][k] += x;}
        n++;
    }
    for (let k = 1; k <= 4; k++) {E[k] /= Math.max(1, n); for (let c = 0; c < 4; c++) {P[c][k] /= Math.max(1, n / 4);}}
    let changing = 0, ga = 0, rb = 0, quad = 0, oddEq = 0;
    for (let i = 4; i + 3 < d.length; i += 4) {
        if (d[i] === d[i - 4] && d[i + 1] === d[i - 3] && d[i + 2] === d[i - 2] && d[i + 3] === d[i - 1]) {continue;}
        changing++;
        if (d[i + 1] === d[i + 3]) {ga++;}
        if (d[i] === d[i + 2]) {rb++;}
        if (d[i] === d[i + 1] && d[i] === d[i + 2] && d[i] === d[i + 3]) {quad++;}
    }
    const c = Math.max(1, changing);
    // the shipped RGB check's grey test: changing RGB triples (step 3) whose bytes are equal, and RGBA pixels (step 4)
    let g3 = 0, n3 = 0, g4 = 0;
    for (let i = 3; i + 2 < d.length; i += 3) {
        if (d[i] === d[i - 3] && d[i + 1] === d[i - 2] && d[i + 2] === d[i - 1]) {continue;}
        n3++; if (d[i] === d[i + 1] && d[i] === d[i + 2]) {g3++;}
    }
    for (let i = 4; i + 3 < d.length; i += 4) {
        if (d[i] === d[i - 4] && d[i + 1] === d[i - 3] && d[i + 2] === d[i - 2] && d[i + 3] === d[i - 1]) {continue;}
        if (d[i] === d[i + 1] && d[i] === d[i + 2]) {g4++;}
    }
    return { E: [...E].slice(1), P: P.map((p) => [...p].slice(1)), ga: ga / c, rb: rb / c, quad: quad / c, changing, g3: g3 / Math.max(1, n3), g4: g4 / c };
}

function mapMse(truth, truthFormat, palette) {
    const ch = truthFormat === 'rgba' ? 4 : 3;
    let sum = 0, w = 0;
    const k = palette.length / 3;
    for (let p = 0; p < truth.length / ch; p++) {
        const a = ch === 4 ? truth[4 * p + 3] / 255 : 1;
        if (a === 0) {continue;}
        const r = truth[ch * p], g = truth[ch * p + 1], b = truth[ch * p + 2];
        let best = Infinity;
        for (let j = 0; j < k; j++) {const dr = r - palette[3 * j], dg = g - palette[3 * j + 1], db = b - palette[3 * j + 2]; const d = dr * dr + dg * dg + db * db; if (d < best) {best = d;}}
        sum += a * best; w += a;
    }
    return w ? sum / w / 3 : 0;
}
async function harm(row) {
    const wrong = await buildPalette({ data: new Uint8Array(row.bytes), format: 'rgba' }, 16);
    const right = await buildPalette({ data: row.truth, format: row.truthFormat }, 16);
    return { right: mapMse(row.truth, row.truthFormat, right), wrong: mapMse(row.truth, row.truthFormat, wrong) };
}

const rows = [];
for await (const row of corpus()) {
    if (row.bytes.length % 4 !== 0) {continue;}
    rows.push({ kind: row.kind, group: row.group, name: row.name, size: row.bytes.length, rgbFlag: looksLikeRgb(row.bytes), lean: looksLikeGrey(row.bytes), ...features(row.bytes), mse: row.truth ? await harm(row) : null });
}
await writeFile(new URL('./features.json', import.meta.url), JSON.stringify(rows));
console.log(`${rows.length} images: ${['rgba', 'rgb', 'grey1', 'grey2'].map((k) => `${rows.filter((r) => r.kind === k).length} ${k}`).join(', ')}`);
