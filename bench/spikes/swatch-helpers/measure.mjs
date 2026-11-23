// Spike for ROADMAP "Larger, later": swatch helpers (a dominant colour, heaviest-first order,
// swatch objects, hex strings). Measures the best recipe through dist/index.mjs.
//
//   node bench/spikes/swatch-helpers/measure.mjs > bench/spikes/swatch-helpers/results.txt
//
// 1. The recipe itself (rankSwatches, below), checked on every Kodak photo at several k.
// 2. How much "the dominant colour" depends on k: the heaviest swatch at k = 2…64, from one
//    clustering, against the heaviest at k = 5 (the guides' advice), in CIEDE2000.
// 3. The heaviest swatch at k = 5 (precision 6) against MMCQ's first colour at 5 (what color-thief's
//    getColor returns), in CIEDE2000.
// 4. Ties in weights (where the sort order is decided by sort stability, i.e. split order).
import { buildClustering } from '../../../dist/index.mjs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';
import { ciede2000 } from '../../lib/metrics.js';
import { mmcq } from '../../lib/quantizers.js';

// ---- The recipe (what a user would paste) --------------------------------------------------
const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
function rankSwatches({ palette, weights, shares }) {
    return Array.from(shares, (share, i) => {
        const [r, g, b] = palette.subarray(3 * i, 3 * i + 3);
        return { color: [r, g, b], hex: hex(r, g, b), share, weight: weights[i], index: i };
    }).sort((a, b) => b.weight - a.weight);
}
// A dominant colour: rankSwatches(await buildSwatches(image, 5))[0]
// ---------------------------------------------------------------------------------------------

const linear = new Float64Array(256).map((_, i) => {
    const c = i / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
function lab([R, G, B]) {
    const r = linear[R], g = linear[G], b = linear[B];
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const fx = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
    const fy = f(0.2126729 * r + 0.7151522 * g + 0.0721750 * b);
    const fz = f((0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const dE = (a, b) => ciede2000(lab(a), lab(b));
const fmt = (v, d = 1) => v.toFixed(d).padStart(5);

const KS = [2, 3, 4, 5, 6, 8, 12, 16, 32, 64];
const thief = mmcq();
const rows = [];
let checked = 0, tiePairs = 0, rankings = 0;

for (const image of KODAK_IMAGES) {
    const path = await ensureImage(image);
    const img = await getImageRgba(path);
    const clustering = await buildClustering(img.rgba);
    const heaviest = {};
    for (const k of [...KS, 128, 256]) {
        const ranked = rankSwatches(await clustering.getSwatches(k));
        // Recipe checks: shares sum to 1, weights descending, every entry present once
        const sum = ranked.reduce((s, x) => s + x.share, 0);
        if (Math.abs(sum - 1) > 1e-9) throw new Error(`${image.name} k=${k}: shares sum ${sum}`);
        for (let i = 1; i < ranked.length; i++) {
            if (ranked[i].weight > ranked[i - 1].weight) throw new Error('not descending');
            if (ranked[i].weight === ranked[i - 1].weight) tiePairs++;
        }
        if (new Set(ranked.map((x) => x.index)).size !== ranked.length) throw new Error('lost an entry');
        rankings++;
        checked += ranked.length;
        if (KS.includes(k)) heaviest[k] = ranked[0];
    }
    // color-thief-style: precision 6, k = 5, against MMCQ's first colour
    const c6 = await buildClustering(img.rgba, { precision: 6 });
    const ours = rankSwatches(await c6.getSwatches(5))[0];
    const mm = thief.palette(img, 5);
    const thiefFirst = [mm[0], mm[1], mm[2]];
    rows.push({ name: image.name, heaviest, ours, thiefFirst });
}

console.log('Recipe: rankSwatches is 7 lines (plus a 1-line hex helper); dominant colour is 1 line on top.');
console.log(`Checked ${rankings} rankings (${checked} swatches, k = 2…256 on 24 Kodak photos): shares sum to 1, order descending, no entry lost.`);
console.log(`Equal-weight neighbours after sorting: ${tiePairs} (their order is split order, by sort stability).\n`);

console.log('2. Heaviest swatch at k against the heaviest at k = 5: CIEDE2000, and the heaviest share');
console.log('image    ' + KS.map((k) => `k=${k}`.padStart(11)).join(''));
const drift = Object.fromEntries(KS.map((k) => [k, []]));
for (const { name, heaviest } of rows) {
    const ref = heaviest[5].color;
    console.log(name.padEnd(9) + KS.map((k) => {
        const d = dE(heaviest[k].color, ref);
        drift[k].push(d);
        return `${fmt(d)} ${(heaviest[k].share * 100).toFixed(0).padStart(3)}%`.padStart(11);
    }).join(''));
}
const median = (v) => [...v].sort((a, b) => a - b)[v.length >> 1];
console.log('median   ' + KS.map((k) => fmt(median(drift[k])).padStart(11)).join(''));
console.log('ΔE > 10  ' + KS.map((k) => String(drift[k].filter((d) => d > 10).length).padStart(11)).join(''));

console.log('\n3. Heaviest at k = 5 (precision 6) against MMCQ (color-thief getColor) first colour, CIEDE2000');
const vs = rows.map(({ name, ours, thiefFirst }) => {
    const d = dE(ours.color, thiefFirst);
    console.log(`${name.padEnd(9)} ours ${ours.hex} (${(ours.share * 100).toFixed(0)}%)  mmcq ${hex(...thiefFirst)}  ΔE ${fmt(d)}`);
    return d;
});
console.log(`median ΔE ${fmt(median(vs))}, mean ${fmt(vs.reduce((a, b) => a + b) / vs.length)}, ΔE > 10 on ${vs.filter((d) => d > 10).length} of ${vs.length}`);
