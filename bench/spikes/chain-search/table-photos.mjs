// The real-photo table: subject, size, colours, WebAssembly clustering time (median of 5, full precision and precision 6, merge-loop share) and the native merge loop's instruction count.
import { readFileSync, existsSync } from 'fs';
const meta = JSON.parse(readFileSync('data/images.json', 'utf8'));
const subj = Object.fromEntries(readFileSync('photos.tsv', 'utf8').trim().split('\n').map((l) => { const p = l.split('\t'); return [p[0], p[2]]; }));
subj.k23 = 'Kodak 768x512 (reference)'; subj.mos12 = 'mosaic of 24 Kodak photos'; subj.up12 = 'k23 upscaled x5.6 (bilinear)';
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const stage = (img, cfg) => { const f = `results/stages-wasm/${img}-${cfg}.txt`; const t = readFileSync(f, 'utf8'); const runs = t.split('RUN ').slice(1).map((r) => { const o = {}; for (const l of r.split('\n')) { const m = l.match(/^(STAGE (\w+)|TOTAL) ([\d.]+)/); if (m) o[m[2] || m[1]] = +m[3]; } return o; }); return { total: med(runs.map((r) => r.TOTAL)), chain: med(runs.map((r) => r.chain ?? 0)) }; };
console.log('| image | subject | licence | MP | colours | full precision ms | merge loop | precision 6 ms | merge loop Ir (G, native) | share of Ir |'); console.log('|---|---|---|---:|---:|---:|---:|---:|---:|---:|');
const lic = Object.fromEntries(readFileSync('sources.txt', 'utf8').trim().split('\n').map((l) => { const p = l.split('\t'); return [p[0], p[2]]; }));
for (const img of ['wk', 'komar', 'sky', 'night', 'fern', 'birch', 'city', 'sp', 'old', 'pip', 'k23', 'mos12', 'up12']) {
    const a = stage(img, 'rgb8'), b = stage(img, 'rgb6');
    let ir = '-', sh = '-'; const f = `results/callgrind-stages/${img}-rgb8.txt`;
    if (existsSync(f)) { const r = Object.fromEntries(readFileSync(f, 'utf8').trim().split('\n').map((l) => { const p = l.split(/\s+/); return [p[0], +p[1]]; })); ir = (r.chain / 1e9).toFixed(2); sh = (100 * r.chain / r.total).toFixed(0) + '%'; }
    console.log(`| ${img} | ${subj[img]} | ${lic[img] ?? ''} | ${(meta[img].pixels / 1e6).toFixed(1)} | ${meta[img].distinct} | ${a.total.toFixed(0)} | ${(100 * a.chain / a.total).toFixed(0)}% | ${b.total.toFixed(0)} | ${ir} | ${sh} |`);
}
