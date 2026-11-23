// 3.5.0's sampling (evenly spaced windows, as in bench/spikes/bare-rgb/check.mjs) against the shipped jittered windows, on
// images with a flat margin: a feathered cutout on black, as RGB, and as grey + alpha with the transparent pixels zeroed.
//   node bench/spikes/bare-grey/margins.mjs > bench/spikes/bare-grey/results-margins.txt
import { looksLikeRgb as evenRgb } from '../bare-rgb/check.mjs';
import { bareLayout } from '../../../dist/shared.mjs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';

const counts = { even: 0, jittered: 0, n: 0, gEven: 0, gJittered: 0 };
for (const img of KODAK_IMAGES) {
    const { rgba, width, height } = await getImageRgba(await ensureImage(img));
    const cx = width / 2, cy = height / 2, radius = 0.4 * Math.min(width, height);
    const alpha = (p) => Math.min(1, Math.max(0, (radius - Math.hypot(p % width - cx, Math.floor(p / width) - cy)) / 32));
    const rgb = new Uint8Array(width * height * 3);
    for (let p = 0; p < width * height; p++) {for (let c = 0; c < 3; c++) {rgb[3 * p + c] = Math.round(rgba[4 * p + c] * alpha(p));}}
    counts.n++;
    if (evenRgb(rgb)) {counts.even++;}
    if (bareLayout(rgb) === 'rgb') {counts.jittered++;}
}
console.log(`RGB feathered cutout on black, 768×512 (${counts.n} Kodak photos): 3.5.0's even windows flag ${counts.even}, the jittered windows ${counts.jittered}`);
