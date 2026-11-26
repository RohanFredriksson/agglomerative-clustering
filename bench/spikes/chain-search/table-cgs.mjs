// Part A instruction counts from results/callgrind-stages/<image>-rgb8.txt: Ir per stage (billions) and the merge loop's share.
import { readFileSync, existsSync } from 'fs';
console.log('| image | total Ir (G) | scan | build (convert, grid, review) | merge loop | merge share | write+CRC |'); console.log('|---|---:|---:|---:|---:|---:|---:|');
for (const img of process.argv.slice(2)) {
    const f = `results/callgrind-stages/${img}-rgb8.txt`; if (!existsSync(f)) continue;
    const r = Object.fromEntries(readFileSync(f, 'utf8').trim().split('\n').map((l) => { const p = l.split(/\s+/); return [p[0], +p[1]]; }));
    const g = (x) => (x / 1e9).toFixed(2);
    console.log(`| ${img} | ${g(r.total)} | ${g(r.scan)} | ${g(r.convert + r.grid_add + r.reindex + r.start)} | ${g(r.chain)} | ${(100 * r.chain / r.total).toFixed(0)}% | ${g(r.w_colors + r.w_sort + r.w_records + r.w_checksum)} |`);
}
