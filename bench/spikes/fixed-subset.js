/**
 * Spike (ROADMAP "Next" item 3): choosing N colours from a fixed palette.
 *
 * Compares ways of picking N entries of a fixed set F (threads, bricks, inks) for an image,
 * each scored the same way: the full image mapped to the chosen N with the library's own
 * nearest-colour mapping (RGB, undithered; --dither also scores Floyd–Steinberg), then
 * PSNR and mean CIEDE2000 against the original.
 *
 *   top-n        map the image to all of F, keep the N most used entries
 *   recipe       the guides' snippet: cut the clustering, snap to F, cut finer until N distinct
 *   snap-merge   Ward agglomeration from a cut of snap-m swatches where each cluster's cost also
 *                counts snapping its centroid to its nearest F entry; stop at N distinct entries
 *   search       choose S ⊂ F, |S| = N, minimising Σ w·min_{s∈S}‖c − s‖² over the m swatches:
 *                greedy, then best-improvement swaps until none helps
 *   recipe+swap  the recipe's choice polished by the same swaps
 *
 * Usage: node bench/spikes/fixed-subset.js [--kodak-limit 24] [--m 1024] [--dither]
 *        [--snap-m 256] [--sets kodak,synthetic] [--out bench/results/fixed-subset.json]
 * Needs a build (dist/index.mjs) and the Kodak photos in fixtures/images/.
 */

import { writeFile, mkdir } from 'fs/promises';
import { performance } from 'perf_hooks';
import { dirname } from 'path';
import { pathToFileURL } from 'url';
import {
    getClustering, getPaletteFromClustering, getSwatchesFromClustering,
    quantizeToIndicesWithPalette, quantizeWithPalette,
} from '../../dist/index.mjs';
import { loadImages } from '../lib/images.js';
import { measure } from '../lib/metrics.js';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i < 0 ? fallback : args[i + 1];
};
const KODAK_LIMIT = Number(arg('kodak-limit', 24));
const M = Number(arg('m', 1024));
const SNAP_M = Number(arg('snap-m', 256));
const DITHER = args.includes('--dither');
const SETS = arg('sets', 'kodak,synthetic').split(',');
const OUT = arg('out', 'bench/results/fixed-subset.json');

// ---------------------------------------------------------------- fixed palettes
// Synthetic stand-ins for real charts (no vendor data): built in OKLCh, clipped to sRGB.

function oklabToSrgb(L, a, b) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    const lin = [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
    return lin.map((c) => {
        const v = Math.min(1, Math.max(0, c));
        return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
    });
}

function chart({ hues, lightness, chroma, greys, hueOffset = 0 }) {
    const out = [];
    const seen = new Set();
    const add = (rgb) => {
        const key = rgb.join(',');
        if (!seen.has(key)) {seen.add(key); out.push(...rgb);}
    };
    for (let g = 0; g < greys; g++) {const v = Math.round(255 * g / (greys - 1)); add([v, v, v]);}
    for (const L of lightness) {
        for (const C of chroma) {
            for (let h = 0; h < hues; h++) {
                const angle = 2 * Math.PI * (h / hues + hueOffset);
                add(oklabToSrgb(L, C * Math.cos(angle), C * Math.sin(angle)));
            }
        }
    }
    return new Uint8Array(out);
}

function webSafe() {
    const out = [];
    for (let r = 0; r < 6; r++) {for (let g = 0; g < 6; g++) {for (let b = 0; b < 6; b++) {out.push(51 * r, 51 * g, 51 * b);}}}
    return new Uint8Array(out);
}

/** n points of the 3D Halton sequence (bases 2, 3, 5) over the RGB cube. */
function halton(n) {
    const radical = (i, base) => {let f = 1, r = 0; while (i > 0) {f /= base; r += f * (i % base); i = Math.floor(i / base);} return r;};
    const out = new Uint8Array(3 * n);
    for (let i = 0; i < n; i++) {[2, 3, 5].forEach((base, t) => {out[3 * i + t] = Math.round(255 * radical(i + 1, base));});}
    return out;
}

export const PALETTES = [
    // Thread chart: many hues, lightness and chroma levels, a grey ramp (~380 colours).
    { name: 'threads', colours: chart({ hues: 24, lightness: [0.3, 0.42, 0.54, 0.66, 0.78, 0.9], chroma: [0.04, 0.09, 0.15, 0.22], greys: 12 }), n: [6, 12, 24, 40] },
    // Brick catalogue: coarse and uneven (~60 colours).
    { name: 'bricks', colours: chart({ hues: 12, lightness: [0.4, 0.62, 0.82], chroma: [0.06, 0.16], greys: 6, hueOffset: 0.03 }), n: [8, 16, 24] },
    // Pigment set: few, saturated, plus black and white (~26 colours).
    { name: 'pigments', colours: chart({ hues: 12, lightness: [0.5, 0.75], chroma: [0.17], greys: 2 }), n: [4, 6, 8] },
    // A large, dense catalogue spread evenly over the cube, where 12 to 40 entries leave real gaps.
    { name: 'dense', colours: halton(1000), n: [6, 12, 24, 40] },
    // A regular grid, the opposite of a chart.
    { name: 'websafe', colours: webSafe(), n: [8, 16, 32] },
];

// ---------------------------------------------------------------- helpers

const count = (p) => p.length / 3;
const d2 = (a, i, b, j) => {
    const dr = a[3 * i] - b[3 * j], dg = a[3 * i + 1] - b[3 * j + 1], db = a[3 * i + 2] - b[3 * j + 2];
    return dr * dr + dg * dg + db * db;
};
export const pick = (F, ids) => {
    const out = new Uint8Array(3 * ids.length);
    ids.forEach((f, i) => out.set(F.subarray(3 * f, 3 * f + 3), 3 * i));
    return out;
};

/** Index of the nearest F entry to an RGB triple (floats allowed). */
function nearestF(F, r, g, b) {
    let best = 0, bestD = Infinity;
    for (let j = 0; j < count(F); j++) {
        const dr = r - F[3 * j], dg = g - F[3 * j + 1], db = b - F[3 * j + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) {bestD = d; best = j;}
    }
    return [best, bestD];
}

// ---------------------------------------------------------------- methods

export async function topN(image, F, n) {
    const { indices } = await quantizeToIndicesWithPalette(image, F);
    const counts = new Float64Array(count(F));
    for (const i of indices) {counts[i]++;}
    return [...counts.keys()].filter((i) => counts[i] > 0).sort((a, b) => counts[b] - counts[a]).slice(0, n);
}

export async function recipe(clustering, F, n) {
    let chosen = [];
    for (let k = n; k <= 4 * n && chosen.length < n; k++) {
        const cut = await getPaletteFromClustering(clustering, k);
        if (count(cut) < k && chosen.length >= count(cut)) {break;}   // the image has fewer colours
        const { indices } = await quantizeToIndicesWithPalette({ data: cut, format: 'rgb' }, F);
        chosen = [...new Set(indices)].slice(0, n);
    }
    return chosen;
}

/** Ward agglomeration from swatches, each cluster also paying ‖μ − nearest F‖²·W. */
function snapMerge(sw, F, n) {
    const m = sw.weights.length;
    const W = Float64Array.from(sw.weights);
    const mu = Array.from({ length: m }, (_, i) => [sw.palette[3 * i], sw.palette[3 * i + 1], sw.palette[3 * i + 2]]);
    const snap = mu.map(([r, g, b]) => nearestF(F, r, g, b));   // [f, d²]
    const alive = new Uint8Array(m).fill(1);
    const distinct = () => new Set(snap.filter((_, i) => alive[i]).map((s) => s[0])).size;
    const mergeOf = (a, b) => {
        const w = W[a] + W[b];
        const c = [0, 1, 2].map((t) => (W[a] * mu[a][t] + W[b] * mu[b][t]) / w);
        const ward = W[a] * W[b] / w * ((mu[a][0] - mu[b][0]) ** 2 + (mu[a][1] - mu[b][1]) ** 2 + (mu[a][2] - mu[b][2]) ** 2);
        const s = nearestF(F, c[0], c[1], c[2]);
        return { w, c, s, delta: ward + w * s[1] - W[a] * snap[a][1] - W[b] * snap[b][1] };
    };
    // Best partner per cluster, recomputed lazily (O(m²) per merge at worst; m ≤ ~1000 is fine for a spike).
    const best = new Array(m);
    const refresh = (a) => {
        let bp = -1, bd = Infinity;
        for (let b = 0; b < m; b++) {
            if (b === a || !alive[b]) {continue;}
            const { delta } = mergeOf(a, b);
            if (delta < bd) {bd = delta; bp = b;}
        }
        best[a] = [bp, bd];
    };
    for (let a = 0; a < m; a++) {refresh(a);}
    let k = distinct();
    let live = m;
    while (k > n && live > 1) {
        let a = -1, bd = Infinity;
        for (let i = 0; i < m; i++) {if (alive[i] && best[i][1] < bd) {bd = best[i][1]; a = i;}}
        const b = best[a][0];
        const r = mergeOf(a, b);
        W[a] = r.w; mu[a] = r.c; snap[a] = r.s; alive[b] = 0; live--;
        for (let i = 0; i < m; i++) {if (alive[i] && (i === a || best[i][0] === a || best[i][0] === b)) {refresh(i);}}
        // Others' best partner may now be the new a.
        for (let i = 0; i < m; i++) {
            if (!alive[i] || i === a) {continue;}
            const { delta } = mergeOf(i, a);
            if (delta < best[i][1]) {best[i] = [a, delta];}
        }
        k = distinct();
    }
    // Heaviest first, so a cut of the answer keeps the important entries.
    const weightOf = new Map();
    for (let i = 0; i < m; i++) {if (alive[i]) {weightOf.set(snap[i][0], (weightOf.get(snap[i][0]) ?? 0) + W[i]);}}
    return [...weightOf.keys()].sort((x, y) => weightOf.get(y) - weightOf.get(x)).slice(0, n);
}

/** Weighted p-median over swatches: greedy start (or `start`), then best-improvement swaps. */
export function search(sw, F, n, start) {
    const m = sw.weights.length, nf = count(F);
    const w = Float64Array.from(sw.weights);
    const D = new Float64Array(nf * m);   // D[f*m + i]
    for (let f = 0; f < nf; f++) {for (let i = 0; i < m; i++) {D[f * m + i] = d2(F, f, sw.palette, i);}}
    const cost = (S) => {
        let total = 0;
        for (let i = 0; i < m; i++) {
            let best = Infinity;
            for (const f of S) {const d = D[f * m + i]; if (d < best) {best = d;}}
            total += w[i] * best;
        }
        return total;
    };
    let S = start ? [...start] : [];
    if (!start) {
        const near = new Float64Array(m).fill(Infinity);
        while (S.length < Math.min(n, nf)) {
            let bf = -1, bc = Infinity;
            for (let f = 0; f < nf; f++) {
                if (S.includes(f)) {continue;}
                let c = 0;
                for (let i = 0; i < m; i++) {c += w[i] * Math.min(near[i], D[f * m + i]);}
                if (c < bc) {bc = c; bf = f;}
            }
            S.push(bf);
            for (let i = 0; i < m; i++) {near[i] = Math.min(near[i], D[bf * m + i]);}
        }
    }
    // Swaps, with nearest and second-nearest bookkeeping so a candidate costs O(m).
    let current = cost(S);
    for (let pass = 0; pass < 100; pass++) {
        const d1 = new Float64Array(m), d2s = new Float64Array(m), n1 = new Int32Array(m);
        for (let i = 0; i < m; i++) {
            let a = Infinity, b = Infinity, ai = -1;
            for (let s = 0; s < S.length; s++) {
                const d = D[S[s] * m + i];
                if (d < a) {b = a; a = d; ai = s;} else if (d < b) {b = d;}
            }
            d1[i] = a; d2s[i] = b; n1[i] = ai;
        }
        let bestGain = 1e-9 * current, bestSwap = null;
        const inS = new Set(S);
        for (let f = 0; f < nf; f++) {
            if (inS.has(f)) {continue;}
            for (let s = 0; s < S.length; s++) {
                let c = 0;
                for (let i = 0; i < m; i++) {
                    const keep = n1[i] === s ? d2s[i] : d1[i];
                    const d = D[f * m + i];
                    c += w[i] * (d < keep ? d : keep);
                }
                if (current - c > bestGain) {bestGain = current - c; bestSwap = [s, f, c];}
            }
        }
        if (!bestSwap) {break;}
        S[bestSwap[0]] = bestSwap[1];
        current = bestSwap[2];
    }
    return S;
}

// ---------------------------------------------------------------- run

async function score(image, F, ids) {
    const palette = pick(F, ids);
    const out = await quantizeWithPalette(image, palette);
    const plain = measure(image.data, out.data);
    if (!DITHER) {return { psnr: plain.psnr, deltaE: plain.deltaE };}
    const dithered = await quantizeWithPalette(image, palette, { dither: true });
    const d = measure(image.data, dithered.data);
    return { psnr: plain.psnr, deltaE: plain.deltaE, ditherPsnr: d.psnr, ditherDeltaE: d.deltaE };
}

const time = async (fn) => {
    const t = performance.now();
    const value = await fn();
    return [value, performance.now() - t];
};

// Run only when executed directly, so fixed-subset-visual.js can import the methods.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const results = [];
    for await (const img of loadImages(SETS, { kodakLimit: KODAK_LIMIT })) {
        if (img.name.startsWith('noise')) {continue;}
        const image = { data: img.rgba, format: 'rgba', width: img.width };
        const [clustering, clusterMs] = await time(() => getClustering(image));
        const [sw, swMs] = await time(() => getSwatchesFromClustering(clustering, M));
        const swSnap = await getSwatchesFromClustering(clustering, SNAP_M);
        for (const { name: paletteName, colours: F, n: ns } of PALETTES) {
            for (const n of ns) {
                const methods = {
                    'top-n': () => topN(image, F, n),
                    recipe: () => recipe(clustering, F, n),
                    'snap-merge': () => snapMerge(swSnap, F, n),
                    search: () => search(sw, F, n),
                    'recipe+swap': async () => search(sw, F, n, await recipe(clustering, F, n)),
                };
                const [ceiling] = await Promise.all([score(image, F, [...Array(count(F)).keys()])]);
                const row = { image: img.name, set: img.set, palette: paletteName, size: count(F), n, clusterMs, swatchMs: swMs, all: ceiling, methods: {} };
                for (const [method, fn] of Object.entries(methods)) {
                    const [ids, ms] = await time(fn);
                    row.methods[method] = { ms, chosen: ids.length, ...(await score(image, F, ids)) };
                }
                results.push(row);
                const cells = Object.entries(row.methods).map(([k, v]) => `${k} ${v.psnr.toFixed(2)}/${v.deltaE.toFixed(2)}`).join('  ');
                console.log(`${img.name.padEnd(13)} ${paletteName.padEnd(9)} N=${String(n).padEnd(3)} ${cells}  (all ${ceiling.psnr.toFixed(2)})`);
            }
        }
    }

    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify({ m: M, dither: DITHER, palettes: PALETTES.map((p) => ({ name: p.name, size: count(p.colours) })), results }, null, 1));

    // Summary: per palette and N, mean PSNR gain over top-n and over recipe, mean ΔE, mean time.
    const groups = new Map();
    for (const r of results) {
        const key = `${r.set === 'kodak' ? 'kodak' : r.image}|${r.palette}|${r.n}`;
        if (!groups.has(key)) {groups.set(key, []);}
        groups.get(key).push(r);
    }
    const methodNames = Object.keys(results[0].methods);
    console.log(`\nMean PSNR (dB) / mean ΔE2000 / mean ms (excluding the shared clustering, ${(results.reduce((s, r) => s + r.clusterMs, 0) / results.length).toFixed(0)} ms avg)`);
    console.log(['images', 'palette', 'size', 'N', 'all of F', ...methodNames].join('\t'));
    for (const [key, rows] of groups) {
        const [images, palette, n] = key.split('|');
        const cells = methodNames.map((mname) => {
            const mean = (f) => rows.reduce((s, r) => s + f(r.methods[mname]), 0) / rows.length;
            return `${mean((v) => v.psnr).toFixed(2)} / ${mean((v) => v.deltaE).toFixed(2)} / ${mean((v) => v.ms).toFixed(0)}`;
        });
        const all = (f) => (rows.reduce((s, r) => s + f(r.all), 0) / rows.length).toFixed(2);
        console.log([images, palette, rows[0].size, n, `${all((v) => v.psnr)} / ${all((v) => v.deltaE)}`, ...cells].join('\t'));
    }
}
