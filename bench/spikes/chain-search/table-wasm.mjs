// Table of results/wasm/<image>/<variant>.txt: median clustering time (ms) over the runs, change against base, hash equal to base's, and the load averages seen.
import { readFileSync, readdirSync, existsSync } from 'fs';
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const imgs = readdirSync('results/wasm');
const order = ['base', 'final', 's-fastoffer', 's-minw', 's-colprune', 's-review', 's-adaptive', 's-skip1', 'c1', 'c2', 'c3', 'c4', 'l-minw', 'l-colprune', 'l-review', 'l-adaptive', 'base2'];
const data = {};
for (const img of imgs) for (const v of order) {
    const f = `results/wasm/${img}/${v}.txt`; if (!existsSync(f)) continue;
    const t = readFileSync(f, 'utf8');
    const times = [...t.matchAll(/^RUN \d+ TOTAL ([\d.]+)/gm)].map((m) => +m[1]);
    const hashes = [...new Set([...t.matchAll(/^HASH (\w+)/gm)].map((m) => m[1]))];
    data[img + '/' + v] = { ms: med(times), min: Math.min(...times), max: Math.max(...times), hash: hashes.join(','), load: [...t.matchAll(/load \w+: ([\d.]+)/g)].map((m) => m[1]).join('/') };
}
console.log('| variant | ' + imgs.join(' | ') + ' | identical |');
console.log('|---|' + imgs.map(() => '---:').join('|') + '|---|');
for (const v of order) {
    if (!imgs.some((i) => data[i + '/' + v])) continue;
    const cells = imgs.map((i) => { const d = data[i + '/' + v], b = data[i + '/base']; return d ? `${d.ms.toFixed(0)}${v === 'base' ? '' : ' (' + ((d.ms / b.ms - 1) * 100).toFixed(0) + '%)'}` : '-'; });
    const same = imgs.every((i) => !data[i + '/' + v] || data[i + '/' + v].hash === data[i + '/base'].hash);
    console.log(`| ${v} | ${cells.join(' | ')} | ${same ? 'yes' : '**NO**'} |`);
}
console.log('\nSpread (min..max ms) and load averages per run set, base, final and the drift check base2:\n');
for (const v of ['base', 'final', 'base2']) console.log(`- ${v}: ` + imgs.map((i) => data[i + '/' + v] && `${i} ${data[i + '/' + v].min.toFixed(0)}..${data[i + '/' + v].max.toFixed(0)} (load ${data[i + '/' + v].load})`).filter(Boolean).join('; '));
