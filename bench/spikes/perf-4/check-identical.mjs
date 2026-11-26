// Runs a variant's native driver on every image x config and compares the clustering hash with results/ref-hashes.json (the shipped dist/).
// Usage: node check-identical.mjs <variant> [image ...]   -> prints mismatches and a total; exit 1 on any difference. Four runs at a time.
import { execFile } from 'child_process';
import { readFileSync, appendFileSync } from 'fs';
const [variant, ...only] = process.argv.slice(2);
const ref = JSON.parse(readFileSync('results/ref-hashes.json', 'utf8'));
const jobs = [];
for (const img of only.length ? only : Object.keys(ref)) for (const [cfg, args] of Object.entries({ rgb8: '0 8', rgb6: '0 6', oklab8: '1 8' })) if (ref[img][cfg]) jobs.push({ img, cfg, args });
let ok = 0, bad = 0, next = 0;
async function worker() {
    while (next < jobs.length) {
        const j = jobs[next++];
        const out = await new Promise((res) => execFile('./native-run.sh', [`build/${variant}/driver-native`, `data/${j.img}.rgba`, ...j.args.split(' '), '1'], { maxBuffer: 1 << 24 }, (e, so) => res(so || '')));
        const h = (out.match(/^HASH (\w+)/m) || [])[1];
        if (h === ref[j.img][j.cfg]) ok++; else { bad++; console.log('MISMATCH', variant, j.img, j.cfg, h, 'expected', ref[j.img][j.cfg]); }
    }
}
await Promise.all([1, 2, 3, 4].map(worker));
const line = `${variant}: ${ok} identical, ${bad} different, of ${jobs.length} clusterings`;
console.log(line); appendFileSync('results/identical.txt', line + '\n');
process.exit(bad ? 1 : 0);
