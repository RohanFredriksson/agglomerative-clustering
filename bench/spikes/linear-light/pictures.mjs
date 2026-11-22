// Crops of a few photos, side by side, each at 2x nearest-neighbour so the dither pattern is visible.
import { resolve } from 'path';
import { writeFileSync } from 'fs';
const { createCanvas } = await import(resolve(process.cwd(), 'node_modules/canvas/index.js'));
const repo = process.cwd();
// Run from the repo root: node bench/spikes/linear-light/pictures.mjs [metric] [output dir]  (metric: a key of `metrics` in linear-lib.mjs)
const here = new URL('.', import.meta.url).pathname, outDir = process.argv[3] || (await import('os')).tmpdir();
const L = await import(resolve(here, 'linear-lib.mjs'));
const { getImageRgba, IMAGES_DIR } = await import(resolve(repo, 'fixtures/kodak.js'));
const eink = [0, 0, 0, 255, 255, 255, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 255, 128, 0];
const bw = [0, 0, 0, 255, 255, 255];
const best = process.argv[2] || 'Y+opp*2';
const shots = [['kodim23', 260, 60], ['kodim05', 200, 220], ['kodim19', 150, 300]];
const size = 180, scale = 2, label = 18;
for (const [pname, palette, steps] of [['eink', eink, 16], ['bw', bw, 64]]) {
    const cols = [
        ['original', null],
        ['FS today (sRGB)', (d, w) => L.library(d, w, palette, 'floyd-steinberg')],
        ['FS recipe (linear RGB)', (d, w) => L.library(d, w, palette, 'floyd-steinberg', true)],
        [`FS linear ${best}`, (d, w) => L.diffuse(d, w, palette, L.metrics[best], 'fs')],
        ['ordered today', (d, w) => L.library(d, w, palette, 'ordered')],
        [`ordered linear ${best}`, (d, w) => L.ordered(d, w, palette, L.metrics[best], steps)],
        [`Atkinson linear ${best}`, (d, w) => L.diffuse(d, w, palette, L.metrics[best], 'atkinson')],
    ];
    const canvas = createCanvas(cols.length * size * scale, shots.length * (size * scale + label));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    for (let r = 0; r < shots.length; r++) {
        const [name, cx, cy] = shots[r];
        const { rgba, width, height } = await getImageRgba(resolve(IMAGES_DIR, name + '.png'));
        const crop = new Uint8Array(size * size * 4);
        for (let y = 0; y < size; y++) crop.set(rgba.subarray(4 * ((cy + y) * width + cx), 4 * ((cy + y) * width + cx + size)), 4 * y * size);
        for (let c = 0; c < cols.length; c++) {
            const out = cols[c][1] ? await cols[c][1](crop, size) : crop;
            const tile = createCanvas(size, size);
            const id = tile.getContext('2d').createImageData(size, size); id.data.set(out); tile.getContext('2d').putImageData(id, 0, 0);
            const x0 = c * size * scale, y0 = r * (size * scale + label);
            ctx.drawImage(tile, x0, y0 + label, size * scale, size * scale);
            ctx.fillStyle = '#000'; ctx.font = '13px sans-serif'; ctx.fillText(`${cols[c][0]}${c === 0 ? ' · ' + name : ''}`, x0 + 4, y0 + 13);
        }
    }
    writeFileSync(resolve(outDir, `pictures-${pname}.png`), canvas.toBuffer('image/png'));
}
console.log(`written to ${outDir}`);
