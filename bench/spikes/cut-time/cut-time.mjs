// How long one cut (clustering.getPalette(k)) takes, on kodim23 and on large real photos, at k = 16 to 1024.
// Usage (from the repo root, after npm run build): [PHOTOS=<dir>/] node bench/spikes/cut-time/cut-time.mjs > bench/spikes/cut-time/results.txt
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import sharp from 'sharp';
import { buildClustering } from '../../../dist/index.mjs';
const data = process.env.PHOTOS ?? new URL('../chain-search/data/', import.meta.url).pathname; // the chain spike's photos (gitignored; see its README)
const meta = JSON.parse(readFileSync(data + 'images.json', 'utf8'));
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const load = () => loadavg().map((x) => x.toFixed(2)).join('/');
const images = [];
{ const { data: d, info } = await sharp(new URL('../../../fixtures/images/kodim23.png', import.meta.url).pathname).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  images.push(['kodim23', { data: new Uint8Array(d.buffer, d.byteOffset, d.length), format: 'rgba', width: info.width, height: info.height }]); }
for (const name of ['fern', 'sky', 'night']) { const raw = readFileSync(`${data}${name}.rgba`); images.push([name, { data: new Uint8Array(raw.buffer, raw.byteOffset, raw.length), format: 'rgba', width: meta[name].width, height: meta[name].height }]); }
console.log(`load before ${load()}; median of 21 cuts per k, after 3 warm-up cuts`);
console.log('image\tclustering bytes\tk\tms per cut');
for (const [name, image] of images) {
  const clustering = await buildClustering(image);
  for (const k of [16, 64, 256, 1024]) {
    for (let i = 0; i < 3; i++) await clustering.getPalette(k);
    const t = [];
    for (let i = 0; i < 21; i++) { const s = performance.now(); await clustering.getPalette(k); t.push(performance.now() - s); }
    console.log(`${name}\t${clustering.length}\t${k}\t${median(t).toFixed(3)}`);
  }
}
console.log(`load after ${load()}`);
