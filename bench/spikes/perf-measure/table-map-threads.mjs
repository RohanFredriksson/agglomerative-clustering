// Question 3 table from results/map-threads/*.txt (build/mapthreads.js, -pthread WebAssembly in Node 24).
// Columns: the shipped single-threaded _quantize (0), then 1, 2, 4, 8 stripes in ms, speed-up at 8 over the shipped call,
// and whether every thread count gave the shipped call's bytes. Usage: node table-map-threads.mjs > results-map-threads.md
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const here = dirname(fileURLToPath(import.meta.url));
const meta = JSON.parse(readFileSync(join(here, 'data/images.json'), 'utf8'));
const out = ['| image | k | dither | shipped (ms) | 1 thread | 2 | 4 | 8 | speed-up 2 / 4 / 8 | bytes identical to shipped |', '|---|---:|---|---:|---:|---:|---:|---:|---|---|'];
for (const img of ['up12', 'up50']) {
    const f = join(here, `results/map-threads/${img}-rgb.txt`); if (!existsSync(f)) continue;
    const rows = {};
    for (const l of readFileSync(f, 'utf8').split('\n')) { const p = l.split(/\s+/); if (p[0] === 'MAPT') (rows[`${p[1]} ${p[2]}`] ||= {})[p[3]] = { ms: +p[4], same: p[6] === 'identical' }; }
    for (const [key, r] of Object.entries(rows)) {
        const [k, kind] = key.split(' ');
        const same = [1, 2, 4, 8].every((t) => r[t].same);
        out.push(`| ${img} (${(meta[img].pixels / 1e6).toFixed(0)} MP) | ${k} | ${kind === 'fs-stripes' ? 'Floyd-Steinberg restarted per stripe' : kind} | ${r[0].ms.toFixed(0)} | ${r[1].ms.toFixed(0)} | ${r[2].ms.toFixed(0)} | ${r[4].ms.toFixed(0)} | ${r[8].ms.toFixed(0)} | ${[2, 4, 8].map((t) => (r[0].ms / r[t].ms).toFixed(2)).join(' / ')} | ${same ? 'yes' : kind === 'fs-stripes' ? 'NO (different dither pattern)' : 'NO'} |`);
    }
}
console.log(out.join('\n'));
