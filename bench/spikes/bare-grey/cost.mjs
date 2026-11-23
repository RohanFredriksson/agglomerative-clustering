// What the sampled grey check costs per call, beside the shipped RGB check.
//   node bench/spikes/bare-grey/cost.mjs > bench/spikes/bare-grey/results-cost.txt
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';
import { looksLikeRgb } from '../../../dist/shared.mjs';
import { looksLikeGrey } from './check.mjs';

// Both checks in one pass: the shipped RGB check's loops with lags 1 and 2 added (the decision itself isn't timed apart:
// it is a few comparisons).
function combined(d) {
    if (d.length < 192) {return null;}
    const whole = d.length <= 96 * 512;
    const windows = whole ? 1 : 512, size = whole ? d.length : 96;
    const step = whole ? 0 : Math.floor((d.length - 96) / 511 / 12) * 12;
    let e1 = 0, e2 = 0, e3 = 0, e4 = 0, n = 0, g3 = 0, n3 = 0, g4 = 0, q4 = 0, n4 = 0;
    for (let w = 0; w < windows; w++) {
        const start = w * step, end = start + size;
        for (let i = start + 4; i < end; i++) {
            const v = d[i], a = v - d[i - 1], b = v - d[i - 2], c = v - d[i - 3], e = v - d[i - 4];
            e1 += a < 0 ? -a : a; e2 += b < 0 ? -b : b; e3 += c < 0 ? -c : c; e4 += e < 0 ? -e : e;
        }
        n += size - 4;
        for (let i = start + 3; i + 2 < end; i += 3) {
            if (d[i] === d[i - 3] && d[i + 1] === d[i - 2] && d[i + 2] === d[i - 1]) {continue;}
            n3++; if (d[i] === d[i + 1] && d[i] === d[i + 2]) {g3++;}
        }
        for (let i = start + 4; i + 3 < end; i += 4) {
            if (d[i] === d[i - 4] && d[i + 1] === d[i - 3] && d[i + 2] === d[i - 2] && d[i + 3] === d[i - 1]) {continue;}
            n4++; if (d[i] === d[i + 1] && d[i] === d[i + 2]) {g4++; if (d[i] === d[i + 3]) {q4++;}}
        }
    }
    const E1 = e1 / n + 0.05, E2 = e2 / n + 0.05, E3 = e3 / n + 0.05, E4 = e4 / n + 0.05;
    if (E4 / E2 > 1.1 && E2 / E1 < 0.5) {return 'grey-alpha';}
    if (g3 > 0.9 * Math.max(1, n3) && g4 < 0.6 * Math.max(1, n4)) {return 'rgb';}
    const rgb = E4 / E3 > 1.25 && q4 < 0.5 * Math.max(1, n4), grey = E4 / E1 > 1.5 && q4 < 0.5 * Math.max(1, n4);
    return rgb && grey ? (E1 < E3 ? 'grey' : 'rgb') : rgb ? 'rgb' : grey ? 'grey' : null;
}

function time(fn, reps) {for (let i = 0; i < 50; i++) {fn();} const t0 = process.hrtime.bigint(); for (let i = 0; i < reps; i++) {fn();} return Number(process.hrtime.bigint() - t0) / 1e6 / reps;}
const { rgba } = await getImageRgba(await ensureImage(KODAK_IMAGES[22]));
const big = new Uint8Array(4000 * 3000 * 4); for (let i = 0; i < big.length; i++) {big[i] = rgba[i % rgba.length];}
const grey = new Uint8Array(rgba.length / 4); for (let p = 0; p < grey.length; p++) {grey[p] = rgba[4 * p + 1];}
for (const [name, d] of [['768×512 RGBA', rgba], ['12 MP RGBA', big], ['768×512 grey (1 channel)', grey], ['16×16 RGBA', rgba.subarray(0, 1024)]]) {
    console.log(`${name.padEnd(26)} grey check ${time(() => looksLikeGrey(d), 2000).toFixed(3)} ms   RGB check (shipped) ${time(() => looksLikeRgb(d), 2000).toFixed(3)} ms   both in one pass ${time(() => combined(d), 2000).toFixed(3)} ms`);
}
