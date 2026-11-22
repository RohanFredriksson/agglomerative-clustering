// Value brief for slicing pixel mapping (ROADMAP "Larger, later"): the best recipe today is mapping in strips of rows,
// checking a signal and reporting progress between them. Measures, on a 6.3-megapixel photo (kodim23 scaled 4x with
// bilinear filtering, so it has a large photo's many colours) and 4 MP of noise: one call against strips of 64 rows
// (a multiple of 8, so ordered dithering keeps its grid), for no dithering, ordered and Floyd-Steinberg: total time,
// the longest strip (how long an abort waits), and whether the output equals one call's.
// Run from the repo root: node bench/spikes/slicing-mapping/strips.mjs > bench/spikes/slicing-mapping/results-strips.txt
import { resolve } from 'path';
const { buildPalette, quantizeToIndicesWithPalette } = await import(resolve('dist/index.mjs'));
const { getImageRgba } = await import(resolve('fixtures/kodak.js'));

const source = await getImageRgba(resolve('fixtures/images/kodim23.png'));
const scale = 4, W = source.width * scale, H = source.height * scale;
const photo = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) {
    const sy = Math.min(source.height - 1.001, y / scale), y0 = Math.floor(sy), fy = sy - y0;
    for (let x = 0; x < W; x++) {
        const sx = Math.min(source.width - 1.001, x / scale), x0 = Math.floor(sx), fx = sx - x0;
        for (let c = 0; c < 4; c++) {
            const at = (xx, yy) => source.rgba[(yy * source.width + xx) * 4 + c];
            const v = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
            photo[(y * W + x) * 4 + c] = c === 3 ? 255 : Math.round(v);
        }
    }
}
const NW = 2048, NH = 2048;
let seed = 5;
const noise = new Uint8Array(NW * NH * 4).map((_, i) => (i % 4 === 3 ? 255 : (seed = (seed * 16807) % 2147483647) & 255));

// The recipe: strips of `rows` rows, each mapped on its own; between strips, check the signal and report progress.
async function mapInStrips(image, palette, options, rows, { signal, onProgress } = {}) {
    const { width, height, data } = image;
    const out = new Uint8Array(width * height);
    let longest = 0;
    for (let top = 0; top < height; top += rows) {
        signal?.throwIfAborted();
        const h = Math.min(rows, height - top);
        const t = performance.now();
        const { indices } = await quantizeToIndicesWithPalette({ data: data.subarray(top * width * 4, (top + h) * width * 4), format: 'rgba', width, height: h }, palette, options);
        longest = Math.max(longest, performance.now() - t);
        out.set(indices, top * width);
        onProgress?.((top + h) / height);
    }
    return { indices: out, longest };
}

console.log('image             palette  dither      one call   strips(64 rows)  longest strip  same output');
for (const [name, image] of [[`photo ${W}x${H}`, { data: photo, format: 'rgba', width: W, height: H }], [`noise ${NW}x${NH}`, { data: noise, format: 'rgba', width: NW, height: NH }]]) {
    for (const k of [16, 256]) {
        const palette = await buildPalette({ data: image.data.subarray(0, Math.min(image.data.length, 4 * 1024 * 1024)), format: 'rgba' }, k, { precision: 6 });
        for (const dither of [false, 'ordered', true]) {
            const options = { dither };
            const t = performance.now();
            const { indices: whole } = await quantizeToIndicesWithPalette(image, palette, options);
            const one = performance.now() - t;
            const s = performance.now();
            const { indices: striped, longest } = await mapInStrips(image, palette, options, 64);
            const strips = performance.now() - s;
            let differ = 0;
            for (let i = 0; i < whole.length; i++) {if (whole[i] !== striped[i]) {differ++;}}
            const same = differ === 0 ? 'yes' : `no: ${(100 * differ / whole.length).toFixed(2)}% of pixels`;
            console.log(`${name.padEnd(17)} ${String(k).padStart(7)}  ${String(dither).padEnd(9)} ${one.toFixed(0).padStart(8)} ms ${strips.toFixed(0).padStart(10)} ms ${longest.toFixed(0).padStart(11)} ms   ${same}`);
        }
    }
}

// Does striped Floyd-Steinberg look worse, or only different? Error against the original after a 5x5 box blur (what
// dithering is for: the blurred result should match), over the whole photo and over the rows next to strip edges only
// (where each strip starts without the error carried from above: a seam would show there).
console.log('\nError diffusion, photo: RMS error after a 5x5 box blur (lower is better), all rows / rows within 2 of a strip edge');
const blurError = (indices, palette, rowFilter) => {
    let sum = 0, n = 0;
    for (let y = 2; y < H - 2; y++) {
        if (!rowFilter(y)) {continue;}
        for (let x = 2; x < W - 2; x += 3) {
            for (let c = 0; c < 3; c++) {
                let a = 0, b = 0;
                for (let dy = -2; dy <= 2; dy++) {
                    for (let dx = -2; dx <= 2; dx++) {
                        const p = (y + dy) * W + x + dx;
                        a += photo[p * 4 + c];
                        b += palette[indices[p] * 3 + c];
                    }
                }
                sum += ((a - b) / 25) ** 2;
                n++;
            }
        }
    }
    return Math.sqrt(sum / n);
};
const nearEdge = (y) => {const r = y % 64; return r <= 1 || r >= 62;};
for (const method of ['floyd-steinberg', 'atkinson']) {
    for (const k of [4, 16, 256]) {
        const palette = await buildPalette({ data: photo, format: 'rgba' }, k, { precision: 6 });
        const image = { data: photo, format: 'rgba', width: W, height: H };
        const { indices: whole } = await quantizeToIndicesWithPalette(image, palette, { dither: method });
        const { indices: striped } = await mapInStrips(image, palette, { dither: method }, 64);
        const pct = (a, b) => `${b >= a ? '+' : ''}${(100 * (b - a) / a).toFixed(2)}%`;
        const [wa, we, sa, se] = [blurError(whole, palette, () => true), blurError(whole, palette, nearEdge), blurError(striped, palette, () => true), blurError(striped, palette, nearEdge)];
        console.log(`${method.padEnd(15)} ${String(k).padStart(3)} colours: one call ${wa.toFixed(3)} / ${we.toFixed(3)};  strips ${sa.toFixed(3)} (${pct(wa, sa)}) / ${se.toFixed(3)} (${pct(we, se)})`);
    }
}
