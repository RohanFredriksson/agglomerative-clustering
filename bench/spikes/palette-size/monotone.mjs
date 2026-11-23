// Whether mean ΔE2000 of the mapped output (quantize, RGB, no dither) falls with k, which the binary searches in
// rules.mjs and search.mjs assume: every k from 1 to 320 on four Kodak photos, counting rises and the largest one, and
// comparing the binary search's answer with the true smallest k for targets 2.5 and 4.
//   node bench/spikes/palette-size/monotone.mjs > bench/spikes/palette-size/results-monotone.txt
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';
import { meanDeltaE } from '../../lib/metrics.js';
import * as ac from '../../../dist/index.mjs';

for (const index of [0, 4, 13, 22]) {
    const { rgba, width } = await getImageRgba(await ensureImage(KODAK_IMAGES[index]));
    const image = { data: rgba, format: 'rgba', width };
    const clustering = await ac.buildClustering(image);
    const de = [];
    for (let k = 1; k <= 320; k++) {de.push(meanDeltaE(rgba, (await clustering.quantize(image, k)).data));}
    let rises = 0, largest = 0;
    for (let i = 1; i < de.length; i++) {if (de[i] > de[i - 1]) {rises++; largest = Math.max(largest, de[i] - de[i - 1]);}}
    const answers = [2.5, 4].map((t) => {
        const exact = de.findIndex((d) => d <= t) + 1;
        let lo = 1, hi = 320;
        while (lo < hi) {const mid = (lo + hi) >> 1; if (de[mid - 1] <= t) {hi = mid;} else {lo = mid + 1;}}
        return `ΔE<=${t}: smallest ${exact}, binary search ${lo}`;
    });
    console.log(`${KODAK_IMAGES[index].name}: ${rises} rises in 319 steps, largest ${largest.toFixed(3)}; ${answers.join('; ')}`);
}
