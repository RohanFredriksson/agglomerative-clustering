// Question 2 tables from results/rounds/ (run-rounds-profile.sh: work profile, equality) and results/rounds-threads/
// (run-rounds-threads.sh: measured times on threads). Usage: node table-rounds.mjs > results-rounds.md
import { readFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const here = dirname(fileURLToPath(import.meta.url));
const meta = JSON.parse(readFileSync(join(here, 'data/images.json'), 'utf8'));
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const out = [];
const order = ['k23', 'k03', 'k20', 'up12', 'mos12', 'up50', 'mos50'];
const grab = (t, re) => { const m = t.match(re); return m ? m[1] : '-'; };
out.push('## Work profile of the rounds version, RGB full precision (native; counts do not depend on timing)\n');
out.push('| image | colours | chain searches | rounds | rounds / colours | merges per round: first / median / last | rounds searches | searches vs chain | clustering bytes identical | merges not in the chain\'s | palette colours shared k=16 / 256 | error ratio k=16 / 256 |');
out.push('|---|---:|---:|---:|---:|---|---:|---:|---|---:|---|---|');
for (const img of order) {
    const f = join(here, `results/rounds/${img}-rgb8.txt`); if (!existsSync(f)) continue;
    const t = readFileSync(f, 'utf8');
    const chain = +grab(t, /SEARCHES (\d+)/), r = t.match(/ROUNDS (\d+) merges_first (\d+) merges_median (\d+) merges_last (\d+) searches (\d+)/);
    const k = (n) => (t.match(new RegExp(`k=${n}: (\\d+) colours vs \\d+, shared (\\d+)`)) || []).slice(1).join('/');
    const e = (n) => grab(t, new RegExp(`k=${n}: error \\S+ vs \\S+, ratio (\\S+)`));
    out.push(`| ${img} | ${meta[img].distinct} | ${chain} | ${r[1]} | ${(100 * r[1] / meta[img].distinct).toFixed(3)}% | ${r[2]} / ${r[3]} / ${r[4]} | ${r[5]} | ${(r[5] / chain).toFixed(2)}x | ${grab(t, /identical bytes: (\w+)/)} | ${grab(t, /not in a: (\d+)/)} of ${meta[img].distinct - 1} | ${k(16).replace(/^\d+\//, '')} / ${k(256).replace(/^\d+\//, '')} of 16 / 256 | ${e(16)} / ${e(256)} |`);
}
out.push('\nControl: the shipped chain started from the newest cluster instead of the oldest, against the shipped chain (same comparisons):\n');
out.push('| image | clustering bytes identical | merges not in the other\'s | palette colours shared k=16 / 256 | error ratio k=16 / 256 |');
out.push('|---|---|---:|---|---|');
for (const img of order) {
    const f = join(here, `results/rounds/${img}-rgb8-chain-reverse.txt`); if (!existsSync(f)) continue;
    const t = readFileSync(f, 'utf8');
    const k = (n) => (t.match(new RegExp(`k=${n}: \\d+ colours vs \\d+, shared (\\d+)`)) || [])[1];
    const e = (n) => grab(t, new RegExp(`k=${n}: error \\S+ vs \\S+, ratio (\\S+)`));
    out.push(`| ${img} | ${grab(t, /identical bytes: (\w+)/)} | ${grab(t, /not in a: (\d+)/)} | ${k(16)} / ${k(256)} of 16 / 256 | ${e(16)} / ${e(256)} |`);
}
out.push('\nOther colour spaces and precision (rounds against the chain):\n');
out.push('| image, config | rounds | bytes identical | merges not in the chain\'s | palettes shared k=16 / 256 | error ratio k=16 / 256 |');
out.push('|---|---:|---|---:|---|---|');
for (const f of readdirSync(join(here, 'results/rounds')).filter((x) => /-(oklab8|rgb6)\.txt$/.test(x)).sort()) {
    const t = readFileSync(join(here, 'results/rounds', f), 'utf8');
    const k = (n) => (t.match(new RegExp(`k=${n}: \\d+ colours vs \\d+, shared (\\d+)`)) || [])[1];
    const e = (n) => grab(t, new RegExp(`k=${n}: error \\S+ vs \\S+, ratio (\\S+)`));
    out.push(`| ${f.replace('.txt', '')} | ${grab(t, /ROUNDS (\d+)/)} | ${grab(t, /identical bytes: (\w+)/)} | ${grab(t, /not in a: (\d+)/)} | ${k(16)} / ${k(256)} | ${e(16)} / ${e(256)} |`);
}
// Modelled and measured parallel speed-up
out.push('\n## Parallel speed-up of the merge loop, rounds on threads\n');
out.push('Measured: native clang -O2 in a container, median of the runs, the whole clustering (scan, build and write are single-threaded and included). Modelled: from the rounds\' search counts and the single-thread time split, each round\'s searches spread over min(T, searches / 64) threads, merges serial.\n');
out.push('| image | chain ms | rounds 1 thread | 2 | 4 | 8 | speed-up vs chain 1 / 2 / 4 / 8 | speed-up vs rounds-1 2 / 4 / 8 | modelled vs rounds-1 2 / 4 / 8 |');
out.push('|---|---:|---:|---:|---:|---:|---|---|---|');
for (const img of order) {
    const f = join(here, `results/rounds-threads/${img}.txt`); if (!existsSync(f)) continue;
    const parts = readFileSync(f, 'utf8').split(/^== /m).slice(1);
    const tot = {}; const prof = {};
    for (const p of parts) {
        const name = p.split('\n')[0].trim();
        const totals = [...p.matchAll(/^TOTAL ([\d.]+)/gm)].map((m) => +m[1]);
        tot[name] = median(totals);
        const m = [...p.matchAll(/t_search ([\d.]+) t_merge ([\d.]+) t_other ([\d.]+)/g)]; if (m.length) prof[name] = m.map((x) => x.slice(1).map(Number));
    }
    const c = tot['chain'], r1 = tot['rounds threads=1'];
    // model from the 1-thread profile and rounds.csv
    let model = '-';
    const csv = join(here, `results/rounds/${img}-rgb8-rounds.csv`);
    if (existsSync(csv) && prof['rounds threads=1']) {
        const rows = readFileSync(csv, 'utf8').trim().split('\n').map((l) => l.split(',').map(Number));
        const ts = median(prof['rounds threads=1'].map((x) => x[0])), tm = median(prof['rounds threads=1'].map((x) => x[1] + x[2]));
        const total = rows.reduce((a, x) => a + x[1], 0), perSearch = ts / total;
        model = [2, 4, 8].map((T) => { const par = rows.reduce((a, x) => a + x[1] * perSearch / (x[1] < 256 ? 1 : Math.min(T, Math.ceil(x[1] / 64))), 0); return (r1 / (r1 - ts + par)).toFixed(2); }).join(' / ');
    }
    const cell = (n) => (tot[`rounds threads=${n}`] ?? NaN).toFixed(0);
    out.push(`| ${img} | ${c.toFixed(0)} | ${cell(1)} | ${cell(2)} | ${cell(4)} | ${cell(8)} | ${[1, 2, 4, 8].map((n) => (c / tot[`rounds threads=${n}`]).toFixed(2)).join(' / ')} | ${[2, 4, 8].map((n) => (r1 / tot[`rounds threads=${n}`]).toFixed(2)).join(' / ')} | ${model} |`);
}

// Rounds in WebAssembly threads (run-rounds-wasm.sh)
{
    const o = ['\n## Rounds on threads in WebAssembly (-pthread build, Node 24; the whole clustering, median of the runs)\n', '| image | chain ms | rounds 1 thread | 2 | 4 | 8 | speed-up vs chain 1 / 2 / 4 / 8 | speed-up vs rounds-1 2 / 4 / 8 | same bytes at every thread count |', '|---|---:|---:|---:|---:|---:|---|---|---|'];
    for (const img of ['k23', 'mos12', 'up12', 'up50']) {
        const f = join(here, `results/rounds-wasm/${img}.txt`); if (!existsSync(f)) continue;
        const tot = {}, hashes = {};
        for (const p of readFileSync(f, 'utf8').split(/^== /m).slice(1)) {
            const name = p.split('\n')[0].trim();
            tot[name] = median([...p.matchAll(/^TOTAL ([\d.]+)/gm)].map((m) => +m[1]));
            hashes[name] = new Set([...p.matchAll(/^HASH (\w+)/gm)].map((m) => m[1]));
        }
        const r = (n) => tot[`rounds threads=${n}`];
        const same = [1, 2, 4, 8].every((n) => hashes[`rounds threads=${n}`].size === 1 && [...hashes[`rounds threads=${n}`]][0] === [...hashes['rounds threads=1']][0]);
        o.push(`| ${img} | ${tot.chain.toFixed(0)} | ${r(1).toFixed(0)} | ${r(2).toFixed(0)} | ${r(4).toFixed(0)} | ${r(8).toFixed(0)} | ${[1, 2, 4, 8].map((n) => (tot.chain / r(n)).toFixed(2)).join(' / ')} | ${[2, 4, 8].map((n) => (r(1) / r(n)).toFixed(2)).join(' / ')} | ${same ? 'yes' : 'NO'} |`);
    }
    out.push(...o);
}
console.log(out.join('\n'));
