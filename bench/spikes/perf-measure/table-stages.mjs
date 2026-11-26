// Aggregates results/stages-wasm/*.txt (run-stages.sh) into results-stages-wasm.md: the median of each stage over the
// runs, in milliseconds and as a share of the clustering total, and the mapping medians.
// Usage: node table-stages.mjs [dir] > file
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const here = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] || join(here, 'results/stages-wasm');
const meta = JSON.parse(readFileSync(join(here, 'data/images.json'), 'utf8'));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const stageNames = ['scan', 'convert', 'group', 'grouped_error', 'grid_add', 'reindex', 'chain', 'w_colors', 'w_sort', 'w_records', 'w_checksum'];
const labels = { scan: 'pixel scan (histogram)', convert: 'colours to coordinates', group: 'precision grouping', grouped_error: 'grouped error', grid_add: 'grid: add clusters', reindex: 'grid: first size review', chain: 'merge loop (chain + search)', w_colors: 'write: colours to sRGB', w_sort: 'write: sort merges', w_records: 'write: records', w_checksum: 'checksum (CRC-32)' };
const order = ['k23', 'k03', 'k20', 'up12', 'mos12', 'up50', 'mos50'];
const files = readdirSync(dir).filter((f) => f.endsWith('.txt')).sort();
const parse = (text) => {
    const runs = []; let cur = null; const maps = {};
    for (const line of text.split('\n')) {
        const p = line.trim().split(/\s+/);
        if (p[0] === 'RUN') { cur = { stages: {}, searches: 0 }; runs.push(cur); }
        else if (p[0] === 'STAGE') cur.stages[p[1]] = +p[2];
        else if (p[0] === 'TOTAL') cur.total = +p[1];
        else if (p[0] === 'SEARCHES') cur.searches = +p[1];
        else if (p[0] === 'HASH') cur.hash = p[1];
        else if (p[0] === 'MAP') (maps[`${p[1]} ${p[2]}`] ||= []).push(+p[4]);
    }
    return { runs, maps };
};
const out = [];
for (const cfg of ['rgb8', 'oklab8', 'rgb6']) {
    out.push(`\n## Clustering stages, ${{ rgb8: 'RGB, full precision', oklab8: 'OKLab, full precision', rgb6: 'RGB, precision 6' }[cfg]} (WebAssembly in Node 24, median of the runs; ms and % of the total)\n`);
    const imgs = order.filter((i) => files.includes(`${i}-${cfg}.txt`));
    out.push('| stage | ' + imgs.map((i) => `${i} (${(meta[i].pixels / 1e6).toFixed(1)} MP, ${meta[i].distinct} colours)`).join(' | ') + ' |');
    out.push('|---|' + imgs.map(() => '---:|').join(''));
    const data = imgs.map((i) => parse(readFileSync(join(dir, `${i}-${cfg}.txt`), 'utf8')));
    for (const s of stageNames) {
        if (!data.some((d) => d.runs.some((r) => r.stages[s] !== undefined))) continue;
        out.push(`| ${labels[s]} | ` + data.map((d) => { const m = median(d.runs.map((r) => r.stages[s] ?? 0)); const t = median(d.runs.map((r) => r.total)); return `${m.toFixed(1)} (${(100 * m / t).toFixed(1)}%)`; }).join(' | ') + ' |');
    }
    out.push('| **total** | ' + data.map((d) => `**${median(d.runs.map((r) => r.total)).toFixed(0)}** (runs: ${d.runs.length})`).join(' | ') + ' |');
    out.push('| nearest-partner searches in the chain | ' + data.map((d) => d.runs[0].searches).join(' | ') + ' |');
}
for (const cfg of ['rgb8', 'oklab8']) {
    const imgs = order.filter((i) => files.includes(`${i}-${cfg}.txt`));
    out.push(`\n## Mapping, ${cfg === 'rgb8' ? 'RGB' : 'OKLab'} (ms, median of the runs; the palette is cut from the same clustering)\n`);
    out.push('| k, dither | ' + imgs.map((i) => i).join(' | ') + ' |');
    out.push('|---|' + imgs.map(() => '---:|').join(''));
    const data = imgs.map((i) => parse(readFileSync(join(dir, `${i}-${cfg}.txt`), 'utf8')));
    for (const key of ['16 none', '16 fs', '16 ordered', '256 none', '256 fs', '256 ordered']) {
        out.push(`| k=${key.replace(' ', ', ')} | ` + data.map((d) => d.maps[key] ? median(d.maps[key]).toFixed(0) : '-').join(' | ') + ' |');
    }
}
console.log(out.join('\n'));
