// Release check for 4.1.0: clustering time of this branch's dist/ against a 4.0.0 dist/, in the real WebAssembly (public buildClustering),
// on the ten real photos and kodim23 (data/, see README "Re-run"), at full precision RGB, precision 6 and OKLab. Median of RUNS runs, the two
// builds alternating per run; load average before and after; also checks the two clusterings are byte-identical.
// Usage: node release-check.mjs <new dist dir> <4.0.0 dist dir> [runs=5] > results-release.txt
import { readFileSync } from 'fs';
import { loadavg } from 'os';
const [newDir, oldDir, runsArg] = process.argv.slice(2);
const runs = Number(runsArg ?? 5);
const [next, old] = await Promise.all([import(newDir + '/index.mjs'), import(oldDir + '/index.mjs')]);
const meta = JSON.parse(readFileSync('data/images.json', 'utf8'));
const names = ['birch', 'city', 'fern', 'komar', 'night', 'old', 'pip', 'sky', 'sp', 'wk', 'k23'];
const cfgs = { 'rgb8': {}, 'rgb6': { precision: 6 }, 'oklab8': { colorSpace: 'oklab' } };
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const load = () => loadavg().map((x) => x.toFixed(2)).join('/');
console.log(`runs ${runs}; load before ${load()}`);
console.log('image\tconfig\tcolours\t4.0.0 ms\tnew ms\tchange\tidentical');
let different = 0;
for (const name of names) {
    const raw = readFileSync(`data/${name}.rgba`);
    const image = { data: new Uint8Array(raw.buffer, raw.byteOffset, raw.length), format: 'rgba', width: meta[name].width, height: meta[name].height };
    for (const [cfg, options] of Object.entries(cfgs)) {
        const a = [], b = [];
        let same = true;
        for (let i = 0; i < runs; i++) {
            let t = performance.now(); const x = await old.buildClustering(image, options); a.push(performance.now() - t);
            t = performance.now(); const y = await next.buildClustering(image, options); b.push(performance.now() - t);
            if (x.length !== y.length || x.some((v, j) => v !== y[j])) same = false;
        }
        if (!same) different++;
        const [ma, mb] = [median(a), median(b)];
        console.log(`${name}\t${cfg}\t${meta[name].distinct}\t${Math.round(ma)}\t${Math.round(mb)}\t${((mb / ma - 1) * 100).toFixed(1)}%\t${same ? 'yes' : 'NO'}`);
    }
}
console.log(`load after ${load()}; clusterings that differ: ${different}`);
