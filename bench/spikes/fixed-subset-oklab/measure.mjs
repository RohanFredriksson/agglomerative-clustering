// Does scoring the fixed-palette search in OKLab beat the guides' sRGB scoring? For each Kodak photo (24) and the
// fixed-subset spike's charts, the guides' chooseThreads then improveThreads (fast swap pass, distances in sRGB values)
// against the same search with distances in OKLab (swatches and threads converted in JavaScript), both from the same
// start and the same 1024 swatches of an RGB clustering. Each choice is scored by mapping the photo to it with the
// library, in RGB and in OKLab, undithered and with Floyd-Steinberg: mean CIEDE2000 and PSNR against the photo.
//   node bench/spikes/fixed-subset-oklab/measure.mjs [kodak limit] > bench/spikes/fixed-subset-oklab/results.txt
// --cluster-oklab takes the swatches (and chooseThreads' cuts) from an OKLab clustering instead (results-oklab-clustering.txt).
import { buildClustering, quantizeToIndicesWithPalette, quantizeWithPalette } from '../../../dist/index.mjs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';
import { measure } from '../../lib/metrics.js';
import { PALETTES } from '../fixed-subset.js';

const numbers = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const limit = Number(numbers[0] ?? 24);
const clusterSpace = process.argv.includes('--cluster-oklab') ? 'oklab' : 'rgb';
const charts = PALETTES.filter((p) => p.name !== 'websafe').map((p) => ({ ...p, n: p.name === 'threads' || p.name === 'dense' ? [6, 12, 24] : p.n }));

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

const modes = [['rgb', false], ['rgb', true], ['oklab', false], ['oklab', true]];
const rows = new Map();   // `${chart} ${n}` → per mode: {srgb: [dE], oklab: [dE], psnrS, psnrO}
for (const entry of KODAK_IMAGES.slice(0, limit)) {
    const { rgba, width, height } = await getImageRgba(await ensureImage(entry));
    const image = { data: rgba, format: 'rgba', width, height };
    const clustering = await buildClustering(image, { colorSpace: clusterSpace });
    const { palette: colors, weights } = await clustering.getSwatches(1024);
    const swatchesLab = oklab(colors);
    for (const { name, colours: F, n: ns } of charts) {
        const threadsLab = oklab(F);
        for (const n of ns) {
            const start = await chooseThreads(clustering, F, n);
            const bySrgb = improve(F, colors, weights, start), byOklab = improve(threadsLab, swatchesLab, weights, start);
            const key = `${name} (${F.length / 3}), N = ${n}`;
            if (!rows.has(key)) {rows.set(key, modes.map(() => ({ s: [], o: [], ps: [], po: [], c: [], pc: [] })));}
            const same = bySrgb.slice().sort().join() === byOklab.slice().sort().join();
            for (const [i, [colorSpace, dither]] of modes.entries()) {
                const r = rows.get(key)[i];
                const a = measure(rgba, (await quantizeWithPalette(image, pick(F, bySrgb), { colorSpace, dither })).data);
                const b = same ? a : measure(rgba, (await quantizeWithPalette(image, pick(F, byOklab), { colorSpace, dither })).data);
                const c = measure(rgba, (await quantizeWithPalette(image, pick(F, start), { colorSpace, dither })).data);
                r.s.push(a.deltaE); r.o.push(b.deltaE); r.ps.push(a.psnr); r.po.push(b.psnr); r.c.push(c.deltaE); r.pc.push(c.psnr);
            }
        }
    }
}
const mean = (v) => v.reduce((x, y) => x + y, 0) / v.length;
console.log(`${limit} Kodak photos, swatches of an ${clusterSpace === 'oklab' ? 'OKLab' : 'RGB'} clustering. Mean CIEDE2000 (lower is better) of the photo mapped to the threads chosen by the search scored in sRGB / in OKLab;`);
console.log('then the photos where OKLab scoring was better / worse by more than 0.05 ΔE, and the PSNR change (dB, OKLab scoring minus sRGB).\n');
console.log('chart, N'.padEnd(26) + modes.map(([c, d]) => `${c}${d ? ' + dither' : ''}`.padEnd(30)).join(''));
for (const [key, perMode] of rows) {
    console.log(key.padEnd(26) + perMode.map((r) => {
        const better = r.s.filter((v, i) => r.o[i] < v - 0.05).length, worse = r.s.filter((v, i) => r.o[i] > v + 0.05).length;
        return `${mean(r.s).toFixed(2)}/${mean(r.o).toFixed(2)} ${better}/${worse} ${(mean(r.po) - mean(r.ps)).toFixed(2)}`.padEnd(30);
    }).join(''));
}
console.log('\nAgainst the start (chooseThreads alone): mean CIEDE2000 of the start / of the OKLab-scored search, the photos where the search');
console.log('was better / worse by more than 0.05 ΔE, and its PSNR change (dB); then the same for the sRGB-scored search.\n');
console.log('chart, N'.padEnd(26) + modes.map(([c, d]) => `${c}${d ? ' + dither' : ''}`.padEnd(30)).join(''));
const versus = (start, after, ps, pa) => `${mean(start).toFixed(2)}/${mean(after).toFixed(2)} ${start.filter((v, i) => after[i] < v - 0.05).length}/${start.filter((v, i) => after[i] > v + 0.05).length} ${(mean(pa) - mean(ps)).toFixed(2)}`;
for (const [key, perMode] of rows) {
    console.log(key.padEnd(26) + perMode.map((r) => versus(r.c, r.o, r.pc, r.po).padEnd(30)).join(''));
    console.log('  (sRGB-scored)'.padEnd(26) + perMode.map((r) => versus(r.c, r.s, r.pc, r.ps).padEnd(30)).join(''));
}
