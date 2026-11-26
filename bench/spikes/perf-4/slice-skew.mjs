// Longest slice (gap between onProgress calls) on the tied-count synthetic images, 4.2.0 vs branch.
// Usage: node slice-skew.mjs <new dist dir> <4.2.0 dist dir> > results/slice-skew.txt
import { loadavg } from 'os';
const [newDir, oldDir] = process.argv.slice(2);
const [next, old] = await Promise.all([import(newDir + '/index.mjs'), import(oldDir + '/index.mjs')]);
let seed = 1;
const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8) & 255;
function image(width, height, fill) { const data = new Uint8Array(width * height * 4); for (let i = 0; i < width * height; i++) { const [r, g, b] = fill(i); data.set([r, g, b, 255], i * 4); } return {data, format: 'rgba', width, height}; }
const block = (i) => [100 + (i & 63), 100 + ((i >> 6) & 63), 100 + ((i >> 12) & 63)];
const dark = (i) => [i & 63, (i >> 6) & 63, (i >> 12) & 63];
const images = {
  'block + 25% scatter': image(512, 640, (i) => i < 262144 ? block(i) : [rand(), rand(), rand()]),
  'dark block + 25% scatter': image(512, 640, (i) => i < 262144 ? dark(i) : [rand(), rand(), rand()]),
  'noise 1024^2': image(1024, 1024, () => [rand(), rand(), rand()]),
};
const warm = image(8, 8, () => [rand(), rand(), rand()]); await next.buildClustering(warm); await old.buildClustering(warm);
console.log(`load before ${loadavg().map((x) => x.toFixed(2)).join('/')}`);
for (const [name, img] of Object.entries(images)) for (const [cfg, opts] of [['rgb8', {}], ['oklab', {colorSpace: 'oklab'}]]) {
  const row = [];
  for (const [label, lib] of [['4.2.0', old], ['new', next]]) {
    let worst = 0;
    for (let r = 0; r < 3; r++) { let last = performance.now(); await lib.buildClustering(img, {...opts, onProgress: () => { const t = performance.now(); worst = Math.max(worst, t - last); last = t; }}); }
    row.push(`${label} ${worst.toFixed(1)} ms`);
  }
  console.log(`${name}\t${cfg}\tlongest slice: ${row.join('\t')}`);
}
console.log(`load after ${loadavg().map((x) => x.toFixed(2)).join('/')}`);
