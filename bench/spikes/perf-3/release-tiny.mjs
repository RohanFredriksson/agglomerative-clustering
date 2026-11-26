// Tiny images: quantize (k = 16, no dither) of the first w x h pixels of data/k23.rgba, 4.1.0 against this build, median of 7 (paths edited to the run's).
// Result: results/release-tiny.txt. Edit the two import paths to your dist folders.
import {readFileSync} from 'fs';
const old = await import('/home/rohan/Programming/agglomerative-clustering/bench/spikes/perf-3/build/dist-base/index.mjs'), neu = await import('/home/rohan/Programming/agglomerative-clustering/dist/index.mjs');
const raw = readFileSync('/home/rohan/Programming/agglomerative-clustering/bench/spikes/perf-3/data/k23.rgba');
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
for (const [w, h] of [[1,1],[8,8],[64,64],[768,512]]) {
  const image = {data: new Uint8Array(raw.buffer, raw.byteOffset, w*h*4), format: 'rgba', width: w, height: h};
  const a = await old.buildClustering(image), b = await neu.buildClustering(image);
  const reps = w*h < 5000 ? 2000 : 20; const t = {old: [], neu: []};
  for (let r = 0; r < 7; r++) for (const [n, l, c] of [['old', old, a], ['neu', neu, b]]) {
    const s = performance.now(); for (let i = 0; i < reps; i++) await c.quantize(image, 16, {dither: false}); t[n].push((performance.now() - s) / reps);
  }
  console.log(w + 'x' + h, 'old', med(t.old).toFixed(4), 'new', med(t.neu).toFixed(4), 'ms per quantize');
}
