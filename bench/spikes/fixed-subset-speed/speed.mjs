// Speed of the fixed-palette subset search, three ways, on the same inputs: the guides' improveThreads as written;
// fastImprove, the same search with a FastPAM-style pass (one sweep over the swatches per candidate thread instead of
// one per (thread, position) pair), as a recipe would write it; and that pass in C++ compiled to WebAssembly
// (swap.cpp). All start from the guides' chooseThreads and score on the same 1024 swatches. Also checks that the three
// reach the same choice and error. Kodak photos (24 by default), the spike's thread chart (584) and dense chart (1000).
//   node bench/spikes/fixed-subset-speed/speed.mjs [kodak limit] > bench/spikes/fixed-subset-speed/results-speed.txt
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';
import { buildClustering, quantizeToIndicesWithPalette } from '../../../dist/index.mjs';

const here = new URL('.', import.meta.url).pathname;
mkdirSync(`${here}../../../build`, { recursive: true });
const out = `${here}../../../build/swap.cjs`;
execFileSync('em++', [`${here}swap.cpp`, '-O3', '-msimd128', '-sMODULARIZE=1', '-sALLOW_MEMORY_GROWTH=1', "-sEXPORTED_FUNCTIONS=['_improve','_malloc','_free']", "-sEXPORTED_RUNTIME_METHODS=['HEAPU8']", '-o', out]);
const wasm = await createRequire(import.meta.url)(out)();

// ---- the spike's charts (bench/spikes/fixed-subset.js), copied so this file runs alone
function oklabToSrgb(L, a, b) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s]
        .map((c) => {const v = Math.min(1, Math.max(0, c)); return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));});
}
function chart({ hues, lightness, chroma, greys }) {
    const out = [], seen = new Set(), add = (rgb) => {const k = rgb.join(','); if (!seen.has(k)) {seen.add(k); out.push(...rgb);}};
    for (let g = 0; g < greys; g++) {const v = Math.round(255 * g / (greys - 1)); add([v, v, v]);}
    for (const L of lightness) {for (const C of chroma) {for (let h = 0; h < hues; h++) {const a = 2 * Math.PI * h / hues; add(oklabToSrgb(L, C * Math.cos(a), C * Math.sin(a)));}}}
    return new Uint8Array(out);
}
function halton(n) {
    const radical = (i, base) => {let f = 1, r = 0; while (i > 0) {f /= base; r += f * (i % base); i = Math.floor(i / base);} return r;};
    const out = new Uint8Array(3 * n);
    for (let i = 0; i < n; i++) {[2, 3, 5].forEach((base, t) => {out[3 * i + t] = Math.round(255 * radical(i + 1, base));});}
    return out;
}
const CHARTS = [
    { name: 'threads', colours: chart({ hues: 24, lightness: [0.3, 0.42, 0.54, 0.66, 0.78, 0.9], chroma: [0.04, 0.09, 0.15, 0.22], greys: 12 }) },
    { name: 'dense', colours: halton(1000) },
];
const NS = [6, 12, 24, 40];

// ---- the guides' recipes, as written (docs/guides.md "Fixed palettes")
async function chooseThreads(clustering, threads, n) {
  let chosen = [];
  for (let k = n; k <= 4 * n && chosen.length < n; k++) {
    const cut = await clustering.getPalette(k);
    const { indices } = await quantizeToIndicesWithPalette({ data: cut, format: 'rgb' }, threads);
    chosen = [...new Set(indices)].slice(0, n);
  }
  return chosen;
}
async function improveThreads(clustering, threads, chosen) {
  const { palette: colors, weights } = await clustering.getSwatches(1024);
  const m = weights.length, t = threads.length / 3;
  const distance = new Float64Array(t * m);
  for (let j = 0; j < t; j++) {
    for (let i = 0; i < m; i++) {
      const dr = threads[3 * j] - colors[3 * i], dg = threads[3 * j + 1] - colors[3 * i + 1], db = threads[3 * j + 2] - colors[3 * i + 2];
      distance[j * m + i] = dr * dr + dg * dg + db * db;
    }
  }
  chosen = [...chosen];
  for (;;) {
    const nearest = new Int32Array(m), first = new Float64Array(m).fill(Infinity), second = new Float64Array(m).fill(Infinity);
    let current = 0;
    for (let i = 0; i < m; i++) {
      chosen.forEach((j, s) => {
        const d = distance[j * m + i];
        if (d < first[i]) {second[i] = first[i]; first[i] = d; nearest[i] = s;} else if (d < second[i]) {second[i] = d;}
      });
      current += weights[i] * first[i];
    }
    let best = null, lowest = current * (1 - 1e-9);
    for (let j = 0; j < t; j++) {
      if (chosen.includes(j)) {continue;}
      for (let s = 0; s < chosen.length; s++) {
        let error = 0;
        for (let i = 0; i < m; i++) {error += weights[i] * Math.min(distance[j * m + i], nearest[i] === s ? second[i] : first[i]);}
        if (error < lowest) {lowest = error; best = [s, j];}
      }
    }
    if (!best) {return chosen;}
    chosen[best[0]] = best[1];
  }
}

// ---- the same search with a fast swap pass: the strongest recipe
async function fastImprove(clustering, threads, chosen) {
  const { palette: colors, weights } = await clustering.getSwatches(1024);
  const m = weights.length, t = threads.length / 3, n = chosen.length;
  const distance = new Float64Array(t * m);
  for (let j = 0; j < t; j++) {
    for (let i = 0; i < m; i++) {
      const dr = threads[3 * j] - colors[3 * i], dg = threads[3 * j + 1] - colors[3 * i + 1], db = threads[3 * j + 2] - colors[3 * i + 2];
      distance[j * m + i] = dr * dr + dg * dg + db * db;
    }
  }
  chosen = [...chosen];
  const nearest = new Int32Array(m), first = new Float64Array(m), second = new Float64Array(m), change = new Float64Array(n);
  for (;;) {
    const taken = new Uint8Array(t);
    for (const j of chosen) {taken[j] = 1;}
    let current = 0;
    for (let i = 0; i < m; i++) {
      let f = Infinity, g = Infinity, near = 0;
      for (let s = 0; s < n; s++) {const d = distance[chosen[s] * m + i]; if (d < f) {g = f; f = d; near = s;} else if (d < g) {g = d;}}
      nearest[i] = near; first[i] = f; second[i] = g; current += weights[i] * f;
    }
    // For thread j: the change in error from swapping it in for position s is shared + change[s], from one sweep.
    let best = null, lowest = current * (1 - 1e-9);
    for (let j = 0; j < t; j++) {
      if (taken[j]) {continue;}
      let shared = 0;
      change.fill(0);
      for (let i = 0; i < m; i++) {
        const d = distance[j * m + i], w = weights[i], gain = d < first[i] ? w * (d - first[i]) : 0;
        shared += gain;
        change[nearest[i]] += w * (Math.min(d, second[i]) - first[i]) - gain;
      }
      for (let s = 0; s < n; s++) {if (current + shared + change[s] < lowest) {lowest = current + shared + change[s]; best = [s, j];}}
    }
    if (!best) {return chosen;}
    chosen[best[0]] = best[1];
  }
}

// ---- the C++ pass, with the distance table built the same way in JavaScript (timed with it)
async function wasmImprove(clustering, threads, chosen) {
  const { palette: colors, weights } = await clustering.getSwatches(1024);
  const m = weights.length, t = threads.length / 3, n = chosen.length;
  const dp = wasm._malloc(8 * t * m), wp = wasm._malloc(8 * m), cp = wasm._malloc(4 * n);
  const distance = new Float64Array(wasm.HEAPU8.buffer, dp, t * m);
  for (let j = 0; j < t; j++) {
    for (let i = 0; i < m; i++) {
      const dr = threads[3 * j] - colors[3 * i], dg = threads[3 * j + 1] - colors[3 * i + 1], db = threads[3 * j + 2] - colors[3 * i + 2];
      distance[j * m + i] = dr * dr + dg * dg + db * db;
    }
  }
  new Float64Array(wasm.HEAPU8.buffer, wp, m).set(weights);
  new Int32Array(wasm.HEAPU8.buffer, cp, n).set(chosen);
  wasm._improve(dp, wp, t, m, cp, n);
  const result = Array.from(new Int32Array(wasm.HEAPU8.buffer, cp, n));
  wasm._free(dp); wasm._free(wp); wasm._free(cp);
  return result;
}

const errorOf = async (clustering, threads, chosen) => {
  const { palette: colors, weights } = await clustering.getSwatches(1024);
  let e = 0;
  for (let i = 0; i < weights.length; i++) {
    let f = Infinity;
    for (const j of chosen) {const dr = threads[3 * j] - colors[3 * i], dg = threads[3 * j + 1] - colors[3 * i + 1], db = threads[3 * j + 2] - colors[3 * i + 2]; f = Math.min(f, dr * dr + dg * dg + db * db);}
    e += weights[i] * f;
  }
  return e;
};
const time = async (fn) => {const t = performance.now(); const r = await fn(); return [performance.now() - t, r];};

const limit = Number(process.argv[2] ?? 24);
const rows = {};
let same = 0, total = 0, worse = [];
for (const img of KODAK_IMAGES.slice(0, limit)) {
  const { rgba, width } = await getImageRgba(await ensureImage(img));
  const clustering = await buildClustering({ data: rgba, format: 'rgba', width });
  for (const { name, colours } of CHARTS) {
    for (const n of NS) {
      const start = await chooseThreads(clustering, colours, n);
      await clustering.getSwatches(1024); // warm
      const [guide, a] = await time(() => improveThreads(clustering, colours, start));
      const [fast, b] = await time(() => fastImprove(clustering, colours, start));
      const [cpp, c] = await time(() => wasmImprove(clustering, colours, start));
      const [ea, eb, ec] = [await errorOf(clustering, colours, a), await errorOf(clustering, colours, b), await errorOf(clustering, colours, c)];
      total++;
      if (a.join() === b.join() && a.join() === c.join()) {same++;} else {worse.push(`${img.name} ${name} ${n}: error ${(eb / ea - 1) * 100}% / ${(ec / ea - 1) * 100}%`);}
      const key = `${name} (${colours.length / 3}), N = ${n}`;
      (rows[key] ??= []).push([guide, fast, cpp]);
    }
  }
  process.stderr.write(`${img.name}\n`);
}
const median = (v) => {const s = [...v].sort((x, y) => x - y); return s[s.length >> 1];};
console.log(`${limit} Kodak photos; times in ms (median, max) for improveThreads as in the guides, the fast swap pass in JavaScript, and in C++/WebAssembly.`);
console.log('chart, N                      guides            fast JS            C++ (WASM)       speed-up fast/guides, C++/fast');
for (const [key, v] of Object.entries(rows)) {
  const col = (k) => `${median(v.map((r) => r[k])).toFixed(1).padStart(7)} ${Math.max(...v.map((r) => r[k])).toFixed(1).padStart(7)}`;
  console.log(`${key.padEnd(28)} ${col(0)}  ${col(1)}  ${col(2)}     ${(median(v.map((r) => r[0])) / median(v.map((r) => r[1]))).toFixed(1)}x, ${(median(v.map((r) => r[1])) / median(v.map((r) => r[2]))).toFixed(1)}x`);
}
console.log(`\nsame choice as the guides' function: ${same} of ${total}${worse.length ? '; differing: ' + worse.join('; ') : ''}`);
