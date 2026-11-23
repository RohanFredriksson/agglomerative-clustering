// Value brief, suggesting a palette size: how well can a recipe on getClusteringInfo() predict the palette size an image
// needs? The reference ("ideal") k for an image is the smallest whose mapped output (quantize, RGB clustering, no
// dither) has mean CIEDE2000 at most a target, found by binary search. Each rule picks k from the error curve with one
// threshold, tuned over the whole set to fit the ideal best (so the fit is optimistic); the elbow has no threshold.
// Scored by |log2(k_rule / k_ideal)| (1 = off by a factor of 2) and by the mean ΔE the rule's k gives.
//   node bench/spikes/palette-size/rules.mjs [kodak limit] > bench/spikes/palette-size/results-rules.txt
import { loadImages } from '../../lib/images.js';
import { meanDeltaE } from '../../lib/metrics.js';
import * as ac from '../../../dist/index.mjs';

const TARGETS = [2.5, 4];
const KMAX = 4096;
const images = [];
for await (const img of loadImages(['kodak', 'synthetic'], { kodakLimit: Number(process.argv[2] ?? 24) })) {
    if (img.name.startsWith('noise')) {continue;} // noise needs thousands of colours for any target: no size to suggest
    const image = { data: img.rgba, format: 'rgba', width: img.width };
    const rgb = await ac.buildClustering(image), oklab = await ac.buildClustering(image, { colorSpace: 'oklab' });
    const [ri, oi] = [await rgb.getClusteringInfo(), await oklab.getClusteringInfo()];
    const de = new Map();
    const deltaE = async (k) => {
        if (!de.has(k)) {de.set(k, meanDeltaE(img.rgba, (await rgb.quantize(image, k)).data));}
        return de.get(k);
    };
    const ideal = {};
    for (const t of TARGETS) {
        let lo = 1, hi = Math.min(KMAX, ri.maxColors);
        while (lo < hi) {const mid = (lo + hi) >> 1; if (await deltaE(mid) <= t) {hi = mid;} else {lo = mid + 1;}}
        ideal[t] = lo;
    }
    images.push({ name: img.name, image, rgb, ri, oi, deltaE, ideal });
    process.stderr.write(`${img.name} ideal ${JSON.stringify(ideal)}\n`);
}

const first = (curve, test) => {const i = curve.findIndex(test); return i < 0 ? curve.length : i + 1;};
// Kneedle on the error curve against log k (1..256): the k furthest below the straight line from k=1 to k=256.
const elbow = (mse) => {
    const n = Math.min(256, mse.length), x = (k) => Math.log(k) / Math.log(n), y = (k) => mse[k - 1] / mse[0];
    let best = 1, gap = -Infinity;
    for (let k = 1; k <= n; k++) {const d = (1 - x(k)) - y(k) + (y(n) - 0) * x(k) - 0; if (d > gap) {gap = d; best = k;}}
    return best;
};
const RULES = {
    'explained (rgb) >= 0.99, as the guides': { grid: [0.99], pick: (im, t) => first(im.ri.explained, (e) => e >= t) },
    'explained (rgb) >= t': { grid: [0.95, 0.97, 0.98, 0.985, 0.99, 0.993, 0.995, 0.997, 0.998, 0.999], pick: (im, t) => first(im.ri.explained, (e) => e >= t) },
    'explained (oklab) >= t': { grid: [0.95, 0.97, 0.98, 0.985, 0.99, 0.993, 0.995, 0.997, 0.998, 0.999], pick: (im, t) => first(im.oi.explained, (e) => e >= t) },
    'rms (rgb) <= t, 8-bit units': { grid: [2, 3, 4, 5, 6, 7, 8, 10, 12, 15], pick: (im, t) => first(im.ri.mse, (m) => Math.sqrt(m) <= t) },
    'rms (oklab) <= t': { grid: [0.004, 0.006, 0.008, 0.01, 0.012, 0.015, 0.02, 0.025, 0.03, 0.04], pick: (im, t) => first(im.oi.mse, (m) => Math.sqrt(m) <= t) },
    'elbow (rgb, log k), no threshold': { grid: [null], pick: (im) => elbow(im.ri.mse) },
};
const fmt = (v, d = 2) => v.toFixed(d);
console.log(`${images.length} images (Kodak + synthetic, noise excluded). ideal k = smallest k with mean ΔE2000 <= target (rgb clustering, quantize, no dither)`);
for (const target of TARGETS) {
    const ks = images.map((im) => im.ideal[target]).sort((a, b) => a - b);
    console.log(`\n## target ΔE <= ${target}: ideal k from ${ks[0]} to ${ks.at(-1)} (median ${ks[ks.length >> 1]})`);
    for (const [name, rule] of Object.entries(RULES)) {
        let best = null;
        for (const t of rule.grid) {
            const errs = images.map((im) => Math.abs(Math.log2(rule.pick(im, t) / im.ideal[target])));
            const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
            if (!best || mean < best.mean) {best = { t, mean, worst: Math.max(...errs), within: errs.filter((e) => e <= 0.5).length };}
        }
        // Leave-one-out: each image scored with the threshold tuned on the other images, so the fit isn't in-sample.
        const loo = images.map((im) => {
            let pick = null;
            for (const t of rule.grid) {
                const others = images.filter((o) => o !== im).map((o) => Math.abs(Math.log2(rule.pick(o, t) / o.ideal[target])));
                const m = others.reduce((a, b) => a + b, 0) / others.length;
                if (!pick || m < pick.m) {pick = { t, m };}
            }
            return Math.abs(Math.log2(rule.pick(im, pick.t) / im.ideal[target]));
        });
        best.loo = loo.reduce((a, b) => a + b, 0) / loo.length;
        best.looWorst = Math.max(...loo);
        const des = [];
        for (const im of images) {des.push(await im.deltaE(Math.min(KMAX, rule.pick(im, best.t))));}
        console.log(`${name.padEnd(34)} t=${String(best.t).padEnd(6)} mean |log2 ratio| ${fmt(best.mean)}  worst ${fmt(best.worst)}  within 1.41x: ${best.within}/${images.length}  off by ${fmt(2 ** best.mean)}x (leave-one-out ${fmt(2 ** best.loo)}x, worst ${fmt(2 ** best.looWorst)}x)  ΔE at its k: ${fmt(Math.min(...des))}..${fmt(Math.max(...des))}`);
    }
}
console.log('\nper image: name, ideal k at each target, k by explained(rgb)>=0.99, rms(oklab)<=0.015, elbow');
for (const im of images) {console.log(`${im.name.padEnd(14)} ${TARGETS.map((t) => String(im.ideal[t]).padStart(5)).join('')}  ${String(RULES['explained (rgb) >= t'].pick(im, 0.99)).padStart(5)} ${String(RULES['rms (oklab) <= t'].pick(im, 0.015)).padStart(5)} ${String(elbow(im.ri.mse)).padStart(5)}`);}
