// Table of results/ir-matrix.txt: instruction counts (billions, whole clustering) per variant and image, with the change against base, and whether the hash equals base's.
// Usage: node table-ir.mjs [matrix file]
import { readFileSync } from 'fs';
const rows = readFileSync(process.argv[2] || 'results/ir-matrix.txt', 'utf8').trim().split('\n').map((l) => { const m = l.match(/build\/([\w-]+)\/driver-native (\w+) (\d) (\d) Ir (\d+) hash (\w+)/); return m && { v: m[1], img: m[2], space: m[3], prec: m[4], ir: +m[5], hash: m[6] }; }).filter(Boolean);
const imgs = [...new Set(rows.map((r) => r.img))], vs = [...new Set(rows.map((r) => r.v))];
const get = (v, img) => rows.find((r) => r.v === v && r.img === img);
console.log('| variant | ' + imgs.join(' | ') + ' | identical to base |');
console.log('|---|' + imgs.map(() => '---:').join('|') + '|---|');
for (const v of vs) {
    const cells = imgs.map((img) => { const r = get(v, img), b = get('base', img); return r ? `${(r.ir / 1e9).toFixed(2)} (${v === 'base' ? '' : ((r.ir / b.ir - 1) * 100).toFixed(1) + '%'})` : '-'; });
    const same = imgs.every((img) => { const r = get(v, img), b = get('base', img); return !r || r.hash === b.hash; });
    console.log(`| ${v} | ${cells.join(' | ')} | ${same ? 'yes' : '**NO**'} |`);
}
