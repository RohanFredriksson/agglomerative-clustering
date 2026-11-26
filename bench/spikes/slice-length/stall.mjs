// Where the onProgress gaps are: the three longest gaps, each with the progress values on both sides.
// Usage: node stall.mjs <dist dir> <raw dir>
import { readFileSync } from 'fs';
const [dir, rawDir] = process.argv.slice(2);
const lib = await import(dir + '/index.mjs');
for (const [n, w, h] of [['block', 512, 640], ['dark', 512, 640]]) for (const opts of [{}, {colorSpace: 'oklab'}]) {
  const img = {data: new Uint8Array(readFileSync(rawDir + '/' + n + '.rgba')), format: 'rgba', width: w, height: h};
  let last = performance.now(), lastV = 0; const gaps = [];
  await lib.buildClustering(img, {...opts, onProgress: (v) => { const t = performance.now(); gaps.push([t - last, lastV, v]); last = t; lastV = v; }});
  gaps.sort((a, b) => b[0] - a[0]);
  console.log(n, JSON.stringify(opts), gaps.slice(0, 3).map(([g, a, b]) => `${g.toFixed(0)} ms (${a.toFixed(3)} -> ${b.toFixed(3)})`).join('; '), `| ${gaps.length} reports`);
}
