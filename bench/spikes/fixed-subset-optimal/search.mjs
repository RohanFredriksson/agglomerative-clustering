// Is there a better search than the guides' (and 3.8's chooseFrom): chooseThreads' snap, then the fast swap pass?
// For each Kodak photo and chart, in both scoring spaces, it runs the guides' search and the same swap pass from
// random starts (and from a greedy start), records each objective (weighted squared distance of the 1024 swatches
// to their nearest chosen entry), and maps the photo to any better choice found to see whether it shows (mean CIEDE2000).
// It writes the instances for bound.py, which computes a lower bound on the best possible objective.
//   node bench/spikes/fixed-subset-optimal/search.mjs [kodak limit] [random starts] > bench/spikes/fixed-subset-optimal/results-search.txt
import { writeFile, mkdir } from 'node:fs/promises';
import { buildClustering, quantizeToIndicesWithPalette, quantizeWithPalette } from '../../../dist/index.mjs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';
import { measure } from '../../lib/metrics.js';
import { PALETTES } from '../fixed-subset.js';

const limit = Number(process.argv[2] ?? 24), starts = Number(process.argv[3] ?? 10);
const charts = PALETTES.filter((p) => p.name !== 'websafe');
// ---- the guides' recipes (docs/guides.md "Fixed palettes"), with the distance as a parameter
async function chooseThreads(clustering, threads, n) {
    let chosen = [];
    for (let k = n; k <= 4 * n && chosen.length < n; k++) {
        const cut = await clustering.getPalette(k);
        const { indices } = await quantizeToIndicesWithPalette({ data: cut, format: 'rgb' }, threads);
        chosen = [...new Set(indices)].slice(0, n);
    }
    return chosen;
}
// `a` and `b`: coordinates (3 per colour) of the threads and the swatches, in the space the distance is measured in.
function improve(a, b, weights, chosen) {
    const m = weights.length, t = a.length / 3, n = chosen.length;
    const distance = new Float64Array(t * m);
    for (let j = 0; j < t; j++) {
        for (let i = 0; i < m; i++) {
            const dr = a[3 * j] - b[3 * i], dg = a[3 * j + 1] - b[3 * i + 1], db = a[3 * j + 2] - b[3 * i + 2];
            distance[j * m + i] = dr * dr + dg * dg + db * db;
        }
    }
    chosen = [...chosen];
    const nearest = new Int32Array(m), first = new Float64Array(m), second = new Float64Array(m), change = new Float64Array(n);
    for (;;) {
        let current = 0;
        for (let i = 0; i < m; i++) {
            let f = Infinity, g = Infinity, near = 0;
            for (let s = 0; s < n; s++) {
                const d = distance[chosen[s] * m + i];
                if (d < f) {g = f; f = d; near = s;} else if (d < g) {g = d;}
            }
            nearest[i] = near; first[i] = f; second[i] = g; current += weights[i] * f;
        }
        let best = null, lowest = current * (1 - 1e-9);
        for (let j = 0; j < t; j++) {
            if (chosen.includes(j)) {continue;}
            let shared = 0;
            change.fill(0);
            for (let i = 0; i < m; i++) {
                const d = distance[j * m + i], gain = d < first[i] ? weights[i] * (d - first[i]) : 0;
                shared += gain;
                change[nearest[i]] += weights[i] * (Math.min(d, second[i]) - first[i]) - gain;
            }
            for (let s = 0; s < n; s++) {
                const error = current + shared + change[s];
                if (error < lowest) {lowest = error; best = [s, j];}
            }
        }
        if (!best) {return chosen;}
        chosen[best[0]] = best[1];
    }
}
// What a user would add to score in OKLab: sRGB bytes to OKLab (Björn Ottosson's matrices).
const toLinear = (v) => {v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;};
function oklab(rgb) {
    const out = new Float64Array(rgb.length);
    for (let i = 0; i < rgb.length; i += 3) {
        const r = toLinear(rgb[i]), g = toLinear(rgb[i + 1]), b = toLinear(rgb[i + 2]);
        const l = Math.cbrt(0.4122214708 * r + 0.5363329343 * g + 0.0514459929 * b);
        const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
        const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
        out[i] = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
        out[i + 1] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
        out[i + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    }
    return out;
}
const pick = (F, ids) => {const p = new Uint8Array(3 * ids.length); ids.forEach((j, i) => p.set(F.subarray(3 * j, 3 * j + 3), 3 * i)); return p;};


function objective(a, b, weights, chosen) {
    let total = 0;
    for (let i = 0; i < weights.length; i++) {
        let f = Infinity;
        for (const j of chosen) {const dr = a[3 * j] - b[3 * i], dg = a[3 * j + 1] - b[3 * i + 1], db = a[3 * j + 2] - b[3 * i + 2]; f = Math.min(f, dr * dr + dg * dg + db * db);}
        total += weights[i] * f;
    }
    return total;
}
// Greedy: add the entry that lowers the objective most, n times.
function greedy(a, b, weights, n) {
    const t = a.length / 3, chosen = [];
    while (chosen.length < n) {
        let best = -1, lowest = Infinity;
        for (let j = 0; j < t; j++) {if (!chosen.includes(j)) {const e = objective(a, b, weights, [...chosen, j]); if (e < lowest) {lowest = e; best = j;}}}
        chosen.push(best);
    }
    return chosen;
}
let seed = 12345;
const random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
function randomStart(t, n) {const s = new Set(); while (s.size < n) {s.add(Math.floor(random() * t));} return [...s];}

const instances = [];
const rows = new Map();
for (const entry of KODAK_IMAGES.slice(0, limit)) {
    const { rgba, width, height } = await getImageRgba(await ensureImage(entry));
    const image = { data: rgba, format: 'rgba', width, height };
    const clustering = await buildClustering(image);
    const { palette: colors, weights } = await clustering.getSwatches(1024);
    const lab = oklab(colors);
    for (const { name, colours: F, n: ns } of charts) {
        const Flab = oklab(F), t = F.length / 3;
        for (const n of ns) {
            const start = await chooseThreads(clustering, F, n);
            for (const space of ['rgb', 'oklab']) {
                const [a, b] = space === 'rgb' ? [Float64Array.from(F), Float64Array.from(colors)] : [Flab, lab];
                const guides = improve(a, b, weights, start), eg = objective(a, b, weights, guides);
                let best = guides, eb = eg, wins = 0;
                const tries = [greedy(a, b, weights, n), ...Array.from({ length: starts }, () => randomStart(t, n))];
                for (const s of tries) {
                    const c = improve(a, b, weights, s), e = objective(a, b, weights, c);
                    if (e < eg * (1 - 1e-9)) {wins++;}
                    if (e < eb) {eb = e; best = c;}
                }
                const key = `${name} (${t}), N = ${n}, ${space}`;
                if (!rows.has(key)) {rows.set(key, { gain: [], wins: [], better: 0, dG: [], dB: [] });}
                const r = rows.get(key);
                r.gain.push(1 - eb / eg); r.wins.push(wins / tries.length);
                if (eb < eg * (1 - 1e-9)) {
                    r.better++;
                    const g = measure(rgba, (await quantizeWithPalette(image, pick(F, guides))).data);
                    const h = measure(rgba, (await quantizeWithPalette(image, pick(F, best))).data);
                    r.dG.push(g.deltaE); r.dB.push(h.deltaE);
                }
                instances.push({ photo: entry.name ?? String(instances.length), chart: name, n, space, guides: eg, best: eb, a: Array.from(a), b: Array.from(b), w: Array.from(weights) });
            }
        }
    }
}
await mkdir(new URL('../../../build/', import.meta.url), { recursive: true });
await writeFile(new URL('../../../build/fixed-subset-instances.json', import.meta.url), JSON.stringify(instances));
const mean = (v) => v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN;
console.log(`${limit} Kodak photos (RGB clustering, 1024 swatches); the guides' search against the same swap pass from a greedy start and ${starts} random starts.`);
console.log('Columns: photos where any start beat the guides / mean objective gain of the best start (%) / max gain (%) / share of starts that beat it;');
console.log('then, on the photos where one did, mean CIEDE2000 of the photo mapped (RGB, undithered) to the guides\' choice / to the best.\n');
for (const [key, r] of rows) {
    console.log(`${key.padEnd(30)} ${String(r.better).padStart(2)}/${r.gain.length}  ${(100 * mean(r.gain)).toFixed(3)}%  ${(100 * Math.max(...r.gain)).toFixed(3)}%  ${(100 * mean(r.wins)).toFixed(0)}%   ${r.dG.length ? `${mean(r.dG).toFixed(3)} / ${mean(r.dB).toFixed(3)}` : '-'}`);
}
