// Compares two clusterings (version 3 format): byte equality, then record by record, then as sets of merges.
// Usage: node compare-clusterings.mjs a.bin b.bin
import { readFileSync } from 'fs';
const [a, b] = process.argv.slice(2).map((f) => readFileSync(f));
console.log('lengths', a.length, b.length, 'identical bytes:', Buffer.compare(a, b) === 0);
const H = 22, R = 21, n = Math.floor((a.length - H - 3) / R);
const rec = (x, i) => x.subarray(H + 3 + i * R, H + 3 + (i + 1) * R);
let diff = 0, first = -1;
for (let i = 0; i < n; i++) if (Buffer.compare(rec(a, i), rec(b, i)) !== 0) { diff++; if (first < 0) first = i; }
console.log('records', n, 'differing at same position', diff, 'first', first);
const key = (x, i) => { const r = rec(x, i); return Buffer.from(r.subarray(0, 9)).toString('hex') + ':' + r.readUInt32LE(13) + ':' + r.readFloatLE(17); };
const setA = new Map(); for (let i = 0; i < n; i++) { const k = key(a, i); setA.set(k, (setA.get(k) || 0) + 1); }
let missing = 0; for (let i = 0; i < n; i++) { const k = key(b, i); const c = setA.get(k) || 0; if (!c) missing++; else setA.set(k, c - 1); }
console.log('records of b whose (colours, weight, cost) are not in a:', missing);
const hd = []; for (let i = 0; i < H; i++) if (a[i] !== b[i]) hd.push(i); console.log('header bytes differing', hd.join(','));
