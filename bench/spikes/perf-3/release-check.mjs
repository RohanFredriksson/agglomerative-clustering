// Release check for 4.2.0: this branch's dist/ against a 4.1.0 dist/, in the real WebAssembly (the public API), on the ten real photos and
// kodim23 (data/, see ../chain-search/README.md "Re-run"). Median of RUNS runs, the two builds alternating per run; load average before and
// after; every output is also compared byte for byte with the other build's.
//   cluster:  buildClustering at full precision RGB, `precision: 6` and OKLab
//   quantize: quantize (clustering included) at k = 16, no dither and Floyd-Steinberg
//   sliced:   clustering.quantize at k = 16 with an `onProgress` callback (the sliced mapping path; the clustering is made before the clock)
// Usage: node release-check.mjs <new dist dir> <4.1.0 dist dir> [runs=5] > results-release.txt   (run from this directory)
import { readFileSync } from 'fs';
import { loadavg } from 'os';
const [newDir, oldDir, runsArg] = process.argv.slice(2);
const runs = Number(runsArg ?? 5);
const [next, old] = await Promise.all([import(newDir + '/index.mjs'), import(oldDir + '/index.mjs')]);
const meta = JSON.parse(readFileSync('data/images.json', 'utf8'));
const names = ['birch', 'city', 'fern', 'komar', 'night', 'old', 'pip', 'sky', 'sp', 'wk', 'k23'];
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const load = () => loadavg().map((x) => x.toFixed(2)).join('/');
const bytes = (r) => r.data ?? r;
const equal = (x, y) => { x = bytes(x); y = bytes(y); return x.length === y.length && Buffer.compare(Buffer.from(x.buffer, x.byteOffset, x.length), Buffer.from(y.buffer, y.byteOffset, y.length)) === 0; };
const progress = () => {};
const jobs = [
    ['cluster', 'rgb8', (l, image) => l.buildClustering(image)],
    ['cluster', 'rgb6', (l, image) => l.buildClustering(image, {precision: 6})],
    ['cluster', 'oklab8', (l, image) => l.buildClustering(image, {colorSpace: 'oklab'})],
    ['quantize', 'none', (l, image) => l.quantize(image, 16, {dither: false})],
    ['quantize', 'fs', (l, image) => l.quantize(image, 16, {dither: 'floyd-steinberg'})],
    ['sliced', 'none', (l, image, c) => c.quantize(image, 16, {dither: false, onProgress: progress})],
    ['sliced', 'fs', (l, image, c) => c.quantize(image, 16, {dither: 'floyd-steinberg', onProgress: progress})],
    ['oneshot', 'none', (l, image, c) => c.quantize(image, 16, {dither: false})],
    ['oneshot', 'fs', (l, image, c) => c.quantize(image, 16, {dither: 'floyd-steinberg'})],
];
console.log(`runs ${runs}; load before ${load()}`);
console.log('image\tmode\tconfig\tcolours\t4.1.0 ms\tnew ms\tchange\tidentical');
let different = 0;
for (const name of names) {
    const raw = readFileSync(`data/${name}.rgba`);
    const image = {data: new Uint8Array(raw.buffer, raw.byteOffset, raw.length), format: 'rgba', width: meta[name].width, height: meta[name].height};
    const clusterings = [await old.buildClustering(image), await next.buildClustering(image)];
    for (const [mode, cfg, run] of jobs) {
        const a = [], b = [];
        let same = true;
        for (let i = 0; i < runs; i++) {
            let t = performance.now(); const x = await run(old, image, clusterings[0]); a.push(performance.now() - t);
            t = performance.now(); const y = await run(next, image, clusterings[1]); b.push(performance.now() - t);
            if (!equal(x, y)) same = false;
        }
        if (!same) different++;
        const [ma, mb] = [median(a), median(b)];
        console.log(`${name}\t${mode}\t${cfg}\t${meta[name].distinct}\t${Math.round(ma)}\t${Math.round(mb)}\t${((mb / ma - 1) * 100).toFixed(1)}%\t${same ? 'yes' : 'NO'}`);
    }
}
console.log(`load after ${load()}; outputs that differ: ${different}`);
