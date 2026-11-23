// Speed of two builds of dist/ on the paths the size changes touch: each build in its own process (one.mjs), alternated
// `rounds` times, the best per case. Prints the change from the first build to the second.
//   node bench/spikes/wasm-size/speed.mjs <before dist dir> <after dist dir> [rounds]
import { execFileSync } from 'node:child_process';

const [a, b, rounds = 4] = process.argv.slice(2);
const best = [{}, {}];
for (let r = 0; r < Number(rounds); r++) {
    for (const [i, dir] of (r % 2 ? [[1, b], [0, a]] : [[0, a], [1, b]])) {
        const times = JSON.parse(execFileSync('node', ['bench/spikes/wasm-size/one.mjs', dir], { encoding: 'utf8' }));
        for (const [k, t] of Object.entries(times)) {best[i][k] = Math.min(best[i][k] ?? Infinity, t);}
    }
}
console.log(`kodim23 768×512, best of ${rounds} processes × 15 runs; ${a} → ${b}`);
for (const k of Object.keys(best[0])) {
    console.log(`${k.padEnd(32)} ${best[0][k].toFixed(1).padStart(7)} ms ${best[1][k].toFixed(1).padStart(7)} ms  ${((best[1][k] / best[0][k] - 1) * 100).toFixed(1).padStart(5)}%`);
}
