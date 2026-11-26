// Worst cases for the 4.3 bounds recompute: big cells of equally light clusters.
// Usage: node skew-check.mjs <new dist> <old dist> [runs=3]
import { loadavg } from 'os';
const [newDir, oldDir, runsArg] = process.argv.slice(2);
const runs = Number(runsArg ?? 3);
const [next, old] = await Promise.all([import(newDir + '/index.mjs'), import(oldDir + '/index.mjs')]);
let seed = 1;
const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8) & 255;
function image(width, height, fill) {
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) { const [r, g, b] = fill(i); data.set([r, g, b, 255], i * 4); }
    return {data, format: 'rgba', width, height};
}
const block = (i) => [100 + (i & 63), 100 + ((i >> 6) & 63), 100 + ((i >> 12) & 63)];
const images = {
    'dense block 64^3, all count 1': image(512, 512, block),
    'dense block + 25% sparse scatter': image(512, 640, (i) => i < 262144 ? block(i) : [rand(), rand(), rand()]),
    'noise 1024^2': image(1024, 1024, () => [rand(), rand(), rand()]),
    'dense 32^3 x 8 copies + scatter': image(512, 1024, (i) => i < 262144 ? [120 + (i & 31), 120 + ((i >> 5) & 31), 120 + ((i >> 10) & 31)] : [rand(), rand(), rand()]),
};
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
console.log(`load before ${loadavg().map((x) => x.toFixed(2)).join('/')}`);
for (const [name, img] of Object.entries(images)) {
    for (const [cfg, opts] of [['rgb8', {}], ['rgb6', {precision: 6}], ['oklab', {colorSpace: 'oklab'}]]) {
        const a = [], b = [];
        let same = true;
        for (let i = 0; i < runs; i++) {
            let t = performance.now(); const x = await old.buildClustering(img, opts); a.push(performance.now() - t);
            t = performance.now(); const y = await next.buildClustering(img, opts); b.push(performance.now() - t);
            if (Buffer.compare(Buffer.from(x), Buffer.from(y)) !== 0) same = false;
        }
        console.log(`${name}\t${cfg}\t4.2.0 ${Math.round(median(a))} ms\tnew ${Math.round(median(b))} ms\t${((median(b) / median(a) - 1) * 100).toFixed(1)}%\t${same ? 'identical' : 'DIFFERENT'}`);
    }
}
console.log(`load after ${loadavg().map((x) => x.toFixed(2)).join('/')}`);
