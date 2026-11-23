// Indexed output, heaviest first: three recipes.
//   node bench/spikes/swatch-helpers/indexed.mjs > bench/spikes/swatch-helpers/results-indexed.txt
//
// A. The guides' recipe as written (for…of, indices.map, `colors[old]` arrays), after quantizeToIndices.
// B. The same renumbering with indexed loops.
// C. No renumbering: cut the clustering, rank the palette by swatch weight, and map to it with
//    quantizeToIndicesWithPalette (index order follows the given palette). Checked against
//    quantizeToIndices: same colour for every pixel.
import { buildClustering, quantizeToIndices, quantizeToIndicesWithPalette, Palette } from '../../../dist/index.mjs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';

function rankAsWritten({ palette, indices, transparentIndex }) {
    const colors = Array.from({ length: palette.length / 3 }, (_, i) => [palette[3 * i], palette[3 * i + 1], palette[3 * i + 2]]);
    const used = new Uint32Array(palette.length / 3);
    for (const index of indices) {used[index]++;}
    const byUse = Array.from(used.keys()).sort((a, b) => used[b] - used[a]);
    const rank = new Uint32Array(used.length);
    byUse.forEach((old, position) => {rank[old] = position;});
    const rankedPalette = byUse.map((old) => colors[old]);
    const rankedIndices = indices.map((index) => rank[index]);
    return { palette: rankedPalette, indices: rankedIndices, transparentIndex: transparentIndex === null ? null : rank[transparentIndex] };
}

function rankLoops({ palette, indices, transparentIndex }) {
    const used = new Uint32Array(palette.length / 3);
    for (let i = 0; i < indices.length; i++) used[indices[i]]++;
    const byUse = Array.from(used.keys()).sort((a, b) => used[b] - used[a]);
    const rank = new Uint32Array(used.length);
    const rankedPalette = new Uint8Array(palette.length);
    byUse.forEach((old, position) => {
        rank[old] = position;
        rankedPalette.set(palette.subarray(3 * old, 3 * old + 3), 3 * position);
    });
    const rankedIndices = new indices.constructor(indices.length);
    for (let i = 0; i < indices.length; i++) rankedIndices[i] = rank[indices[i]];
    return { palette: rankedPalette, indices: rankedIndices, transparentIndex: transparentIndex === null ? null : rank[transparentIndex] };
}

async function rankByMapping(clustering, image, k) {
    const { palette, weights } = await clustering.getSwatches(k);
    const order = Array.from(weights.keys()).sort((a, b) => weights[b] - weights[a]);
    const ranked = new Uint8Array(palette.length);
    order.forEach((old, position) => ranked.set(palette.subarray(3 * old, 3 * old + 3), 3 * position));
    // Keep the palette's colour space: plain bytes would be matched in RGB
    return quantizeToIndicesWithPalette(image, new Palette(ranked, palette.colorSpace));
}

const time = async (fn, runs) => {
    let best = Infinity, out;
    for (let i = 0; i < runs; i++) {
        const t = performance.now();
        out = await fn();
        best = Math.min(best, performance.now() - t);
    }
    return [best, out];
};

const sameColours = (a, b) => {
    for (let i = 0; i < a.indices.length; i++) {
        const p = 3 * a.indices[i], q = 3 * b.indices[i];
        if (a.palette[p] !== b.palette[q] || a.palette[p + 1] !== b.palette[q + 1] || a.palette[p + 2] !== b.palette[q + 2]) return false;
    }
    return true;
};

const base = await getImageRgba(await ensureImage(KODAK_IMAGES[22]));   // kodim23, 768×512
const tiles = 31;                                                       // tiled to 12.2 MP
const big = new Uint8Array(base.rgba.length * tiles);
for (let t = 0; t < tiles; t++) big.set(base.rgba, t * base.rgba.length);

for (const [label, rgba] of [['kodim23 0.39 MP', base.rgba], ['kodim23 tiled 12.2 MP', big]]) {
    const clustering = await buildClustering(rgba);
    for (const k of [16, 256]) {
        await quantizeToIndices(rgba, k);                               // warm-up
        const [tq, result] = await time(() => quantizeToIndices(rgba, k), 3);
        const [ta] = await time(() => rankAsWritten(result), 5);
        const [tb, loops] = await time(() => rankLoops(result), 5);
        const [tc, mapped] = await time(() => rankByMapping(clustering, rgba, k), 3);
        const [tcut] = await time(() => clustering.quantizeToIndices(rgba, k), 3);
        console.log(`${label} k=${k}`);
        console.log(`  quantizeToIndices (clusters)          ${tq.toFixed(1).padStart(7)} ms`);
        console.log(`  A. renumber, as in the guides         ${ta.toFixed(1).padStart(7)} ms`);
        console.log(`  B. renumber, indexed loops            ${tb.toFixed(1).padStart(7)} ms   same colours: ${sameColours(result, loops)}`);
        console.log(`  clustering.quantizeToIndices (cut)    ${tcut.toFixed(1).padStart(7)} ms`);
        console.log(`  C. ranked palette, then map to it     ${tc.toFixed(1).padStart(7)} ms   same colours: ${sameColours(result, mapped)}`);
    }
}
console.log('\nSorting the swatches themselves (k = 256, the guides\' rankSwatches):');
{
    const clustering = await buildClustering(base.rgba);
    const { palette, shares } = await clustering.getSwatches(256);
    const toHex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    const rank = () => Array.from(shares, (share, i) => {
        const [r, g, b] = palette.subarray(3 * i, 3 * i + 3);
        return { color: [r, g, b], hex: toHex(r, g, b), share };
    }).sort((a, b) => b.share - a.share);
    for (let i = 0; i < 100; i++) rank();
    const t = performance.now();
    for (let i = 0; i < 1000; i++) rank();
    console.log(`  ${((performance.now() - t)).toFixed(0)} µs per ranking (mean of 1000)`);
}
