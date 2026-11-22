// Spike: where does the exact four-wide scan for ordered-dithering recipe steps stop beating the palette index?
// Released build (scan up to 64 RGB colours) against wide-scan.patch (up to 256), ordered dithering at several palette
// sizes, on the first 12 frames of each clip. Output is checked equal.
// Run from the repo root: node bench/spikes/recipe-reuse/sizes.mjs <frames dir> <wide-scan dist/index.mjs>
import { resolve, join } from 'path';
import { readdirSync, readFileSync } from 'fs';

const [framesDir, widePath] = process.argv.slice(2);
const base = await import(resolve('dist/index.mjs'));
const wide = await import(resolve(widePath));
const PASSES = 3, FRAMES = 12;
const SIZES = [48, 64, 65, 96, 128, 192, 255, 400];

const files = readdirSync(framesDir).filter((f) => f.endsWith('.rgba')).sort();
console.log(`Ordered dithering, 16 steps, RGB; ${FRAMES} frames, sum of per-frame minima over ${PASSES} passes, ms. ratio = wide / released.`);
console.log(`(Palettes above 256 colours don't take the scan in either build: a control.)\n`);
for (const file of files) {
    const width = Number(file.match(/-(\d+)\.rgba$/)[1]);
    const height = width * 9 / 16, size = width * height * 4;
    const bytes = readFileSync(join(framesDir, file));
    const frames = Array.from({ length: FRAMES }, (_, i) => ({ data: bytes.subarray(i * size, (i + 1) * size), format: 'rgba', width, height }));
    const sample = new Uint8Array(size * 3);
    [0, 5, 10].forEach((f, i) => sample.set(frames[f].data, i * size));
    console.log(`## ${file}`);
    console.log('colours  released    wide  ratio');
    for (const k of SIZES) {
        const palette = await base.buildPalette({ data: sample, format: 'rgba' }, k);
        const times = [];
        for (const lib of [base, wide]) {
            const best = new Array(FRAMES).fill(Infinity);
            for (let pass = 0; pass < PASSES; pass++) {
                for (let i = 0; i < FRAMES; i++) {
                    const t = performance.now();
                    await lib.quantizeToIndicesWithPalette(frames[i], palette, { dither: 'ordered' });
                    best[i] = Math.min(best[i], performance.now() - t);
                }
            }
            times.push(best.reduce((s, v) => s + v, 0));
        }
        for (let i = 0; i < FRAMES; i++) {
            const a = (await base.quantizeToIndicesWithPalette(frames[i], palette, { dither: 'ordered' })).indices;
            const b = (await wide.quantizeToIndicesWithPalette(frames[i], palette, { dither: 'ordered' })).indices;
            if (a.some((v, j) => v !== b[j])) {throw new Error(`${file} k=${k}: frame ${i} differs`);}
        }
        console.log(`${String(palette.length / 3).padStart(7)} ${times[0].toFixed(1).padStart(9)} ${times[1].toFixed(1).padStart(7)} ${(times[1] / times[0]).toFixed(2).padStart(6)}`);
    }
    console.log('');
}
