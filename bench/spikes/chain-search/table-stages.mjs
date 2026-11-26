// Part A table from results/stages-wasm/*.txt: medians over the runs of total and per-stage time, merge-loop share, searches, load.
// Usage: node table-stages.mjs > results-stages-wasm.md
import { readFileSync, readdirSync } from 'fs';
const meta = JSON.parse(readFileSync('data/images.json', 'utf8'));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const order = ['k23', 'mos12', 'up12', 'birch', 'city', 'fern', 'komar', 'night', 'pip', 'sky', 'sp', 'wk', 'old'];
const rows = [];
for (const cfg of ['rgb8', 'rgb6']) {
  console.log(`\n### ${cfg === 'rgb8' ? 'RGB, full precision' : 'RGB, precision 6'} (ms, median of 5 runs; run 0 is excluded from nothing: all 5 counted)\n`);
  console.log('| image | MP | colours | total | scan | convert+grid+review | merge loop | write+CRC | merge share | chain searches | min..max total | load before / after (1 min) |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|');
  for (const img of order) {
    let t; try { t = readFileSync(`results/stages-wasm/${img}-${cfg}.txt`, 'utf8'); } catch { continue; }
    const runs = t.split('RUN ').slice(1).map((r) => { const o = {}; for (const l of r.split('\n')) { const m = l.match(/^(STAGE (\w+)|TOTAL|SEARCHES) ([\d.]+)/); if (m) o[m[2] || m[1]] = +m[3]; } return o; });
    const g = (k) => med(runs.map((r) => r[k] ?? 0));
    const total = g('TOTAL'), chain = g('chain'), scan = g('scan');
    const build = g('convert') + g('group') + g('grouped_error') + g('grid_add') + g('reindex');
    const write = g('w_colors') + g('w_sort') + g('w_records') + g('w_checksum');
    const tt = runs.map((r) => r.TOTAL);
    const loads = [...t.matchAll(/load (?:before|after): ([\d.]+)/g)].map((m) => m[1]);
    console.log(`| ${img} | ${(meta[img].pixels / 1e6).toFixed(1)} | ${meta[img].distinct} | ${total.toFixed(0)} | ${scan.toFixed(0)} | ${build.toFixed(0)} | ${chain.toFixed(0)} | ${write.toFixed(0)} | ${(100 * chain / total).toFixed(0)}% | ${g('SEARCHES')} | ${Math.min(...tt).toFixed(0)}..${Math.max(...tt).toFixed(0)} | ${loads.join(' / ')} |`);
  }
}
