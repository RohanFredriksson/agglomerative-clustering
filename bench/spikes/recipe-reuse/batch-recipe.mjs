// Value brief for item 6: the best recipe a user can write today. Ordered dithering gives a pixel a colour that depends
// only on its own colour and its position modulo 8, and every call builds each distinct colour's recipe once. So frames
// stacked into one tall image (each padded to a multiple of 8 rows by repeating its last row, which adds no colours)
// and mapped in one call share their recipes, with the same indices as mapping each frame on its own (checked here).
//
// Compares, per clip and palette: frames one call each (released), the recipe at batch sizes 6, 12 and all, and the
// persisted-table prototype (persist.patch) as the stand-in for an explicit prepared palette.
// Run from the repo root: node bench/spikes/recipe-reuse/batch-recipe.mjs <frames dir> <persist.patch dist/index.mjs>
import { resolve, join } from 'path';
import { readdirSync, readFileSync } from 'fs';

const [framesDir, protoPath] = process.argv.slice(2);
const lib = await import(resolve('dist/index.mjs'));
const proto = await import(resolve(protoPath));
const { buildPalette, quantizeToIndicesWithPalette } = lib;
const PASSES = 3;

// ---- The recipe, as a user would write it (what the guides would print) ----
// Maps `frames` (same width and height, { data, format: 'rgba', width, height }) with one call per `batch` frames.
// Returns one indices array per frame, equal to mapping each frame with its own call.
async function mapFramesOrdered(frames, palette, options, batch = frames.length) {
    const { width, height } = frames[0];
    const padded = Math.ceil(height / 8) * 8;   // keep every frame on the 8x8 pattern's grid
    const rowBytes = width * 4;
    const results = [];
    for (let start = 0; start < frames.length; start += batch) {
        const group = frames.slice(start, start + batch);
        const data = new Uint8Array(group.length * padded * rowBytes);
        group.forEach((frame, i) => {
            const top = i * padded * rowBytes;
            data.set(frame.data, top);
            const last = frame.data.subarray((height - 1) * rowBytes, height * rowBytes);
            for (let y = height; y < padded; y++) {data.set(last, top + y * rowBytes);}
        });
        const { indices, palette: entries, transparentIndex } = await quantizeToIndicesWithPalette(
            { data, format: 'rgba', width, height: group.length * padded }, palette, { ...options, dither: 'ordered' });
        const size = width * padded;
        group.forEach((_, i) => results.push({ indices: indices.subarray(i * size, i * size + width * height), palette: entries, transparentIndex }));
    }
    return results;
}
// ---- end of the recipe ----

const files = readdirSync(framesDir).filter((f) => f.endsWith('.rgba')).sort();
const configs = [
    { name: '255 RGB', k: 255 },
    { name: '16 RGB', k: 16 },
    { name: 'black/white', fixed: new Uint8Array([0, 0, 0, 255, 255, 255]) },
];
const reset = () => proto.quantizeToIndicesWithPalette({ data: new Uint8Array([9, 9, 9, 255]), format: 'rgba', width: 1, height: 1 }, new Uint8Array([1, 2, 3, 4, 5, 6]), { dither: 'ordered' });
const best = async (fn) => {let t = Infinity; for (let p = 0; p < PASSES; p++) {const s = performance.now(); await fn(); t = Math.min(t, performance.now() - s);} return t;};

console.log(`Whole clip, ms (minimum of ${PASSES} passes). Ratios are against one released call per frame (lower is better).`);
console.log('batch N = the recipe above with N frames per call; prepared = persist.patch, one call per frame, table kept between them.\n');
console.log('clip              palette      per-frame  batch 6  batch 12  batch all  prepared');
const rows = [];
for (const file of files) {
    const width = Number(file.match(/-(\d+)\.rgba$/)[1]);
    const height = width * 9 / 16, size = width * height * 4;
    const bytes = readFileSync(join(framesDir, file));
    const frames = [];
    for (let o = 0; o + size <= bytes.length; o += size) {frames.push({ data: bytes.subarray(o, o + size), format: 'rgba', width, height });}
    const sample = new Uint8Array(frames.filter((_, i) => i % 5 === 0).length * size);
    frames.filter((_, i) => i % 5 === 0).forEach((f, i) => sample.set(f.data, i * size));
    for (const config of configs) {
        const palette = config.fixed ?? await buildPalette({ data: sample, format: 'rgba' }, config.k);
        const options = { transparent: true };
        const single = [];
        for (const f of frames) {single.push((await quantizeToIndicesWithPalette(f, palette, { ...options, dither: 'ordered' })).indices);}
        for (const batch of [6, 12, frames.length]) {
            const got = await mapFramesOrdered(frames, palette, options, batch);
            got.forEach((r, i) => {if (r.indices.some((v, j) => v !== single[i][j])) {throw new Error(`${file} ${config.name} batch ${batch}: frame ${i} differs`);}});
        }
        const perFrame = await best(async () => {for (const f of frames) {await quantizeToIndicesWithPalette(f, palette, { ...options, dither: 'ordered' });}});
        const b6 = await best(() => mapFramesOrdered(frames, palette, options, 6));
        const b12 = await best(() => mapFramesOrdered(frames, palette, options, 12));
        const bAll = await best(() => mapFramesOrdered(frames, palette, options));
        const prepared = await best(async () => {await reset(); for (const f of frames) {await proto.quantizeToIndicesWithPalette(f, palette, { ...options, dither: 'ordered' });}});
        const r = (v) => (v / perFrame).toFixed(2).padStart(8);
        console.log(`${file.padEnd(17)} ${config.name.padEnd(11)} ${perFrame.toFixed(0).padStart(9)} ${r(b6)} ${r(b12)}  ${r(bAll)}  ${r(prepared)}`);
        rows.push({ file, palette: config.name, b6: b6 / perFrame, b12: b12 / perFrame, bAll: bAll / perFrame, prepared: prepared / perFrame });
    }
}
console.log('\nRange over clips (ratio to per-frame):');
for (const kind of ['sintel', 'repeat']) {
    const pick = rows.filter((r) => (kind === 'repeat') === /^(pan|sprite)/.test(r.file));
    const range = (k) => `${Math.min(...pick.map((r) => r[k])).toFixed(2)}–${Math.max(...pick.map((r) => r[k])).toFixed(2)}`;
    console.log(`${kind === 'repeat' ? 'pan, sprite' : 'Sintel scenes'}: batch 6 ${range('b6')}, batch 12 ${range('b12')}, batch all ${range('bAll')}, prepared ${range('prepared')}`);
}
