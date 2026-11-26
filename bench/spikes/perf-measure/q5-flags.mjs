// Question 5: compiler flag variants of the shipped library (build-lib.sh), run in Node 24: clustering and mapping times
// (builds interleaved run by run, so drift in machine load hits all of them alike; median), and whether the output is
// byte-identical to the -O3 build. Usage: node q5-flags.mjs name1 name2 ... (builds are build/lib-<name>.mjs; the first is the reference)
import { readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
const here = dirname(fileURLToPath(import.meta.url));
const names = process.argv.slice(2);
const meta = JSON.parse(readFileSync(join(here, 'data/images.json'), 'utf8'));
const mods = {};
for (const n of names) mods[n] = await (await import(pathToFileURL(join(here, `build/lib-${n}.mjs`)).href)).default();
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const hash = (b) => createHash('sha256').update(b).digest('hex').slice(0, 12);
const cases = [['k23', 9], ['k03', 9], ['mos12', 3]];
console.log('| image | step | ' + names.join(' | ') + ' |'); console.log('|---|---|' + names.map(() => '---:|').join(''));
for (const [img, runs] of cases) {
    const raw = readFileSync(join(here, `data/${img}.rgba`));
    const { width } = meta[img];
    const t = Object.fromEntries(names.map((n) => [n, { c: [], q: [], o: [], fs: [] }])), h = {};
    const ptr = {};
    for (const n of names) { ptr[n] = mods[n]._malloc(raw.length); mods[n].HEAPU8.set(raw, ptr[n]); }
    // palette (16 colours) from the reference build, so every build maps with the same palette
    const M0 = mods[names[0]];
    let cl = M0._get_clustering(ptr[names[0]], raw.length, 0, 0, 8, 1, 0);
    let p = M0._get_palette_from_clustering(cl + 4, new DataView(M0.HEAPU8.buffer).getUint32(cl, true), 256);
    const plen = new DataView(M0.HEAPU8.buffer).getUint32(p, true);
    const palette = M0.HEAPU8.slice(p + 4, p + 4 + plen);
    for (let r = 0; r < runs; r++) for (const n of names) {
        const M = mods[n];
        let s = performance.now();
        const c = M._get_clustering(ptr[n], raw.length, 0, 0, 8, 1, 0);
        t[n].c.push(performance.now() - s);
        const len = new DataView(M.HEAPU8.buffer).getUint32(c, true);
        h[n] = hash(M.HEAPU8.slice(c + 4, c + 4 + len)); M._free(c);
        const pp = M._malloc(palette.length); M.HEAPU8.set(palette, pp);
        for (const [key, dither, method] of [['q', 0, 0], ['fs', 1, 0], ['o', 1, 2]]) {
            s = performance.now();
            const q = M._quantize_with_palette(ptr[n], raw.length, 0, pp, palette.length, 0, dither, method, 0, width, 0);
            t[n][key].push(performance.now() - s);
            if (r === 0) h[n + key] = hash(M.HEAPU8.slice(q + 4, q + 4 + raw.length));
            M._free(q);
        }
        M._free(pp);
    }
    const row = (label, key) => console.log(`| ${img} | ${label} | ` + names.map((n) => { const m = median(t[n][key]); return `${m.toFixed(0)} (${(100 * m / median(t[names[0]][key])).toFixed(0)}%)`; }).join(' | ') + ' |');
    row('clustering (RGB, 8 bit)', 'c'); row('map k=256, no dither', 'q'); row('map k=256, Floyd-Steinberg', 'fs'); row('map k=256, ordered', 'o');
    console.log(`| ${img} | output identical to ${names[0]} (clustering / none / fs / ordered) | ` + names.map((n) => ['', 'q', 'fs', 'o'].map((k) => h[n + k] === h[names[0] + k] ? 'yes' : 'NO').join(' / ')).join(' | ') + ' |');
}
