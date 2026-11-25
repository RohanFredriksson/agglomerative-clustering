// Times the passes in pass.cpp on Kodak photos made translucent, at 12 MP (the photo tiled), median of 7 runs.
import createModule from '../../../build/premul.mjs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';

const m = await createModule();
const names = ['un-premultiply, division', 'un-premultiply, table', 'premultiply, division', 'premultiply, table'];
const w = 4240, h = 2832, n = w * h * 4;
const photo = await getImageRgba(await ensureImage(KODAK_IMAGES[22]));
// Alpha patterns: all opaque (the pass skips), a gradient (every alpha), and mostly transparent.
const patterns = {opaque: () => 255, gradient: (x) => x % 256, 'mostly 0': (x) => (x % 10 === 0 ? 128 : 0)};
const median = (v) => v.sort((a, b) => a - b)[v.length >> 1];
console.log(`One in-place pass over a ${w}x${h} (12 MP) RGBA image in the WebAssembly heap, ms, median of 7; kodim23 tiled.`);
console.log('em++ -O3 -msimd128, Node ' + process.version + '\n');
const ptr = m._malloc(n);
for (const [label, alpha] of Object.entries(patterns)) {
    const src = new Uint8Array(n);
    for (let i = 0; i < w * h; i++) {
        const x = i % w, y = Math.floor(i / w);
        const s = ((y % photo.height) * photo.width + (x % photo.width)) * 4, a = alpha(x);
        src[i * 4] = Math.round(photo.rgba[s] * a / 255); src[i * 4 + 1] = Math.round(photo.rgba[s + 1] * a / 255);
        src[i * 4 + 2] = Math.round(photo.rgba[s + 2] * a / 255); src[i * 4 + 3] = a;
    }
    const row = [];
    for (let mode = 0; mode < 4; mode++) {
        const times = [];
        for (let r = 0; r < 7; r++) {m.HEAPU8.set(src, ptr); times.push(m._run(ptr, n, mode));}
        row.push(`${names[mode]} ${median(times).toFixed(1)}`);
    }
    console.log(`${label.padEnd(9)} ${row.join(' | ')}`);
}
