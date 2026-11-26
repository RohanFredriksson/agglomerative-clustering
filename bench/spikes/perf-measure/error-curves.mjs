// Quality of two clusterings of the same image as the squared error they leave at palette sizes k (sum of the costs of
// the records from index k-1 on, in the stored cost units), and the same as a ratio. Usage: node error-curves.mjs a.bin b.bin
import { readFileSync } from 'fs';
const H = 22, R = 21;
const curve = (f) => { const b = readFileSync(f); const n = Math.floor((b.length - H - 3) / R); const e = new Float64Array(n + 2); for (let i = n - 1; i >= 0; i--) e[i] = e[i + 1] + b.readFloatLE(H + 3 + i * R + 17); return e; };
const [a, b] = process.argv.slice(2).map(curve);
for (const k of [2, 4, 16, 64, 256, 1024, 4096]) if (k - 1 < a.length) console.log(`k=${k}: error ${a[k - 1].toExponential(6)} vs ${b[k - 1].toExponential(6)}, ratio ${(b[k - 1] / a[k - 1]).toFixed(6)}`);
