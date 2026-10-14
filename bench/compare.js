/**
 * Compares two or more results files written by bench/run.js, e.g. before and after a change:
 *
 *   node bench/compare.js bench/results/before.json bench/results/after.json
 *
 * Only (set, image, library, k) combinations present in every file are compared. For each
 * library and k it prints mean PSNR, mean CIEDE2000 and median palette time per file, with
 * the change relative to the first file.
 */

import { readFileSync } from 'fs';
import { basename } from 'path';
import { mean, median } from './lib/summary.js';

const files = process.argv.slice(2);
if (files.length < 2) {
    console.error('Usage: node bench/compare.js <results.json> <results.json> [...]');
    process.exit(1);
}

const runs = files.map(file => ({ label: basename(file, '.json'), ...JSON.parse(readFileSync(file, 'utf8')) }));
const key = (r) => `${r.set}|${r.image}|${r.lib}|${r.k}`;
const common = runs.map(run => new Set(run.results.map(key))).reduce((a, b) => new Set([...a].filter(x => b.has(x))));
if (common.size === 0) {
    console.error('No (set, image, library, k) combinations in common.');
    process.exit(1);
}

for (const run of runs) {console.log(`${run.label}: commit ${run.meta.commit ?? '?'}, ${run.meta.date}, ${run.meta.cpu ?? 'unknown CPU'}`);}

const rows = runs.map(run => run.results.filter(r => common.has(key(r))));
const groups = [...new Set(rows[0].map(r => `${r.set}|${r.lib}|${r.k}`))];
const pct = (v, base) => (base ? `${v >= base ? '+' : ''}${((v / base - 1) * 100).toFixed(1)}%` : '-');

for (const set of [...new Set(rows[0].map(r => r.set))]) {
    const images = new Set(rows[0].filter(r => r.set === set).map(r => r.image));
    console.log(`\n=== ${set} (${images.size} image${images.size === 1 ? '' : 's'}) ===`);
    console.table(groups.filter(g => g.startsWith(`${set}|`)).flatMap(group => {
        const [, lib, k] = group.split('|');
        const stats = rows.map(run => {
            const own = run.filter(r => `${r.set}|${r.lib}|${r.k}` === group);
            return { psnr: mean(own.map(r => r.shared.psnr)), deltaE: mean(own.map(r => r.shared.deltaE)), ms: median(own.map(r => r.paletteMs)) };
        });
        return stats.map((s, i) => ({
            library: lib,
            k: Number(k),
            run: runs[i].label,
            'PSNR dB': s.psnr?.toFixed(2) ?? '-',
            'Δ PSNR': i === 0 ? '' : (s.psnr - stats[0].psnr).toFixed(2),
            'ΔE2000': s.deltaE?.toFixed(3) ?? '-',
            'palette ms': s.ms?.toFixed(1) ?? '-',
            'Δ time': i === 0 ? '' : pct(s.ms, stats[0].ms),
        }));
    }));
}
