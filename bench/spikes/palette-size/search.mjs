// The exact recipe: the smallest k whose mapped output has mean CIEDE2000 at most a target, by binary search over
// quantize (about 12 cuts and maps), with bench/lib/metrics.js's ΔE2000 (memoised per colour pair). Times it per image
// against the curve rule (rms in RGB from getClusteringInfo), which costs one call.
//   node bench/spikes/palette-size/search.mjs > bench/spikes/palette-size/results-search.txt
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';
import { meanDeltaE } from '../../lib/metrics.js';
import * as ac from '../../../dist/index.mjs';

console.log('image     cluster ms  curve rule ms  search ms (ΔE <= 2.5)  k');
for (const index of [0, 4, 13, 22]) {
    const { rgba, width } = await getImageRgba(await ensureImage(KODAK_IMAGES[index]));
    const image = { data: rgba, format: 'rgba', width };
    let t = performance.now();
    const clustering = await ac.buildClustering(image);
    const cluster = performance.now() - t;
    t = performance.now();
    const { mse } = await clustering.getClusteringInfo();
    const ruleK = mse.findIndex((m) => Math.sqrt(m) <= 5) + 1;
    const rule = performance.now() - t;
    t = performance.now();
    let lo = 1, hi = Math.min(4096, mse.length);
    while (lo < hi) {const mid = (lo + hi) >> 1; if (meanDeltaE(rgba, (await clustering.quantize(image, mid)).data) <= 2.5) {hi = mid;} else {lo = mid + 1;}}
    const search = performance.now() - t;
    console.log(`${KODAK_IMAGES[index].name.padEnd(10)}${cluster.toFixed(0).padStart(8)}${rule.toFixed(2).padStart(14)}${search.toFixed(0).padStart(16)}            ${lo} (rule ${ruleK})`);
}
