// Which images in bench/spikes/bare-rgb's corpus does the 3.6.0 RGB rule (staggered windows) decide differently from
// 3.5.0's (even windows, bench/spikes/bare-rgb/check.mjs)? Rebuilds the cases that corpus has and this one doesn't
// (dithered, pixel art and synthetic RGB) plus the grey arrays, and compares.
//   node bench/spikes/bare-grey/rgb-changes.mjs > bench/spikes/bare-grey/results-rgb-changes.txt
import { quantize } from '../../../dist/index.mjs';
import { looksLikeRgb as shipped } from '../../../dist/shared.mjs';
import { looksLikeRgb as old } from '../bare-rgb/check.mjs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';
import { syntheticImages } from '../../lib/images.js';
import { corpus } from './corpus.mjs';

const changes = [];
let n = 0;
const compare = (kind, group, name, bytes) => {
    if (bytes.length % 4) {return;}
    n++;
    const a = old(bytes), b = shipped(bytes);
    if (a !== b) {changes.push(`${kind} ${group} ${name}: 3.5.0 ${a ? 'warns' : 'silent'}, 3.6.0 ${b ? 'warns' : 'silent'}`);}
};
for (const img of KODAK_IMAGES) {
    const { rgba, width } = await getImageRgba(await ensureImage(img));
    const rgb = new Uint8Array(rgba.length / 4 * 3);
    for (let p = 0; p < rgba.length / 4; p++) {rgb.set(rgba.subarray(4 * p, 4 * p + 3), 3 * p);}
    for (const dither of ['floyd-steinberg', 'ordered']) {
        const { data } = await quantize({ data: rgb, format: 'rgb', width }, 16, { dither });
        compare('rgb', `dithered (${dither})`, img.name, new Uint8Array(data));
    }
}
for (const img of syntheticImages()) {
    const rgb = new Uint8Array(img.rgba.length / 4 * 3);
    for (let p = 0; p < img.rgba.length / 4; p++) {rgb.set(img.rgba.subarray(4 * p, 4 * p + 3), 3 * p);}
    compare('rgb', 'synthetic', img.name, rgb);
}
for await (const row of corpus()) {compare(row.kind, row.group, row.name, row.bytes);}
console.log(`${n} arrays; decided differently: ${changes.length}`);
for (const c of changes) {console.log(`  ${c}`);}
