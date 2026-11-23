// One build of dist/ in its own process (so JIT warm-up and heap state don't favour whichever runs first): the best of
// 15 runs of each case on kodim23, as JSON. speed.sh runs it alternately for two builds.
//   node bench/spikes/wasm-size/one.mjs <dist dir>
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';

const l = await import(new URL(`${process.argv[2].replace(/\/$/, '')}/index.mjs`, `file://${process.cwd()}/`).href);
const { rgba, width } = await getImageRgba(await ensureImage(KODAK_IMAGES[22]));
const image = { data: rgba, format: 'rgba', width };
const [p16, p256, p1024, p8192] = [await l.buildPalette(image, 16), await l.buildPalette(image, 256), await l.buildPalette(image, 1024), await l.buildPalette(image, 8192)];
const clustering = await l.buildClustering(image);
const cases = {
    'palette from clustering, k=16384': () => l.getPaletteFromClustering(clustering, 16384),
    'swatches from clustering, k=16384': () => l.getSwatchesFromClustering(clustering, 16384),
    'ordered, 16 colours, 16 steps': () => l.quantizeWithPalette(image, p16, { dither: { method: 'ordered', steps: 16 } }),
    'ordered, 16 colours, 64 steps': () => l.quantizeWithPalette(image, p16, { dither: { method: 'ordered', steps: 64 } }),
    'ordered, 256 colours, 16 steps': () => l.quantizeWithPalette(image, p256, { dither: 'ordered' }),
    'floyd-steinberg, 256 colours': () => l.quantizeWithPalette(image, p256, { dither: true }),
    'no dither, 256 colours': () => l.quantizeWithPalette(image, p256),
    'no dither, 1024 colours': () => l.quantizeWithPalette(image, p1024),
    'no dither, 8192 colours (k-d tree)': () => l.quantizeWithPalette(image, p8192),
    'buildPalette 16': () => l.buildPalette(image, 16),
};
const out = {};
for (const [name, run] of Object.entries(cases)) {
    let b = Infinity;
    for (let i = 0; i < 15; i++) {const t = performance.now(); await run(); b = Math.min(b, performance.now() - t);}
    out[name] = b;
}
console.log(JSON.stringify(out));
