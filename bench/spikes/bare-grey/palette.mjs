// fast-png returns a palette PNG as its indices (1 byte per pixel at 8 bits) plus a `palette`: what does it report, and
// do the checks flag those index bytes passed bare?
//   node bench/spikes/bare-grey/palette.mjs > bench/spikes/bare-grey/results-palette.txt
import { createRequire } from 'node:module';
import { looksLikeRgb } from '../../../dist/shared.mjs';
import { bareLayout } from '../../../dist/shared.mjs';
const looksLikeGrey = (d) => {const l = bareLayout(d); return l === 'rgb' ? null : l;}; // the shipped check (3.6.0), grey answers only
import { KODAK_IMAGES, ensureImage } from '../../../fixtures/kodak.js';

const require = createRequire(new URL('../decoding/package.json', import.meta.url));
const fastPng = await import(require.resolve('fast-png'));
const sharp = (await import(require.resolve('sharp'))).default;
for (const colours of [256, 16, 4]) {
    const c = { n: 0, multiple: 0, grey: 0, greyAlpha: 0, rgb: 0 };
    let shape = '';
    for (const img of KODAK_IMAGES) {
        const png = await sharp(await ensureImage(img)).png({ palette: true, colours, dither: 1 }).toBuffer();
        const d = fastPng.decode(png);
        shape = `channels ${d.channels}, depth ${d.depth}, palette ${d.palette ? d.palette.length + ' entries' : 'none'}, ${d.data.length} bytes for ${d.width * d.height} pixels`;
        c.n++; if (d.data.length % 4) {continue;} c.multiple++;
        const g = looksLikeGrey(d.data); if (g === 'grey') {c.grey++;} if (g === 'grey-alpha') {c.greyAlpha++;} if (looksLikeRgb(d.data)) {c.rgb++;}
    }
    console.log(`${colours} colours (e.g. ${shape}): ${c.multiple} of ${c.n} a multiple of 4; grey check says grey ${c.grey}, grey + alpha ${c.greyAlpha}; RGB check flags ${c.rgb}`);
}
