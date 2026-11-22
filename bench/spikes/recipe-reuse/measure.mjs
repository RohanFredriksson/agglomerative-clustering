// Spike (ROADMAP "Next" item 6): how much would keeping ordered-dithering recipes between calls save on a real animation?
// Compares the released build with a prototype whose recipe table persists across calls (persist.patch, applied to
// src/clustering.cpp; it is cleared when the distinct palette colours, steps, strength or colour space change).
// Frames are mapped the way docs/guides.md "Animated GIFs" does it: one palette cut from every 5th frame, then
// quantizeToIndicesWithPalette(frame, palette, { transparent: true, dither: 'ordered' }) for each frame in order.
//
// Run from the repo root (see README.md for making the frames and the prototype build):
//   node bench/spikes/recipe-reuse/measure.mjs <frames dir> <prototype dist/index.mjs> > results.txt
// The frames dir holds <clip>-<width>.rgba files of raw RGBA frames at 16:9 (ffmpeg -pix_fmt rgba).
import { resolve, join } from 'path';
import { readdirSync, readFileSync } from 'fs';

const [framesDir, protoPath] = process.argv.slice(2);
const base = await import(resolve('dist/index.mjs'));
const proto = await import(resolve(protoPath));
const PASSES = 5;

function loadClip(file) {
    const width = Number(file.match(/-(\d+)\.rgba$/)[1]);
    const height = width * 9 / 16;
    const bytes = readFileSync(join(framesDir, file));
    const size = width * height * 4;
    const frames = [];
    for (let o = 0; o + size <= bytes.length; o += size) {
        frames.push({ data: bytes.subarray(o, o + size), format: 'rgba', width, height });
    }
    return frames;
}

function sampleImage(frames) {
    const sample = frames.filter((_, i) => i % 5 === 0);
    const pixels = new Uint8Array(sample.reduce((n, f) => n + f.data.length, 0));
    let offset = 0;
    for (const f of sample) {pixels.set(f.data, offset); offset += f.data.length;}
    return pixels;
}

// Distinct colours per frame and how many were already seen: in the previous frame, or in any earlier frame (what an
// unbounded cache would hit). Shares are of the frame's distinct colours, and of its pixels.
function colourStats(frames) {
    const ever = new Set();
    let previous = new Set();
    const rows = [];
    for (const f of frames) {
        const counts = new Map();
        for (let i = 0; i < f.data.length; i += 4) {
            const key = (f.data[i] << 16) | (f.data[i + 1] << 8) | f.data[i + 2];
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        let seenEver = 0, seenPrev = 0, pixEver = 0;
        for (const [key, n] of counts) {
            if (ever.has(key)) {seenEver++; pixEver += n;}
            if (previous.has(key)) {seenPrev++;}
        }
        rows.push({ distinct: counts.size, ever: seenEver / counts.size, prev: seenPrev / counts.size, pixEver: pixEver / (f.data.length / 4) });
        for (const key of counts.keys()) {ever.add(key);}
        previous = new Set(counts.keys());
    }
    return rows;
}

const reset = async () => {
    // A different palette clears the prototype's table, so every pass starts cold.
    await proto.quantizeToIndicesWithPalette({ data: new Uint8Array([9, 9, 9, 255]), format: 'rgba', width: 1, height: 1 }, new Uint8Array([1, 2, 3, 4, 5, 6]), { dither: 'ordered' });
};

// Per-frame minimum over passes, so one slow pass (GC, a busy machine) doesn't count.
async function timeFrames(lib, frames, palette, options, before) {
    const best = new Array(frames.length).fill(Infinity);
    let outputs = null;
    for (let pass = 0; pass < PASSES; pass++) {
        if (before) {await before();}
        const out = [];
        for (let i = 0; i < frames.length; i++) {
            const t = performance.now();
            const r = await lib.quantizeToIndicesWithPalette(frames[i], palette, options);
            best[i] = Math.min(best[i], performance.now() - t);
            if (pass === 0) {out.push(r.indices);}
        }
        if (pass === 0) {outputs = out;}
    }
    return { times: best, outputs };
}

const sum = (a) => a.reduce((s, v) => s + v, 0);
const median = (a) => {const s = [...a].sort((x, y) => x - y); return s[s.length >> 1];};
const f1 = (v) => v.toFixed(1).padStart(7);
const f2 = (v) => v.toFixed(2).padStart(6);

const files = readdirSync(framesDir).filter((f) => f.endsWith('.rgba')).sort();
console.log(`Prototype: ${protoPath}; ${PASSES} passes, per-frame minimum. Times in ms.`);
console.log('ordered/none = ordered time over no dithering; reuse = prototype over released ordered (same output, checked).');
console.log('later = median of frames 2..n; floor = the prototype mapping frame 1 a second time (every recipe already built).\n');

const configs = [
    { name: '255 RGB', k: 255, build: {} },
    { name: '16 RGB', k: 16, build: {} },
    { name: '16 OKLab', k: 16, build: { colorSpace: 'oklab' } },
    { name: 'black/white', fixed: new Uint8Array([0, 0, 0, 255, 255, 255]) },
];

const summary = [];
for (const file of files) {
    const frames = loadClip(file);
    const stats = colourStats(frames);
    const later = stats.slice(1);
    console.log(`## ${file}: ${frames.length} frames of ${frames[0].width}x${frames[0].height}`);
    console.log(`colours per frame: median ${median(stats.map((s) => s.distinct))}; of a later frame's colours, seen in the previous frame ${(100 * median(later.map((s) => s.prev))).toFixed(0)}%, in any earlier frame ${(100 * median(later.map((s) => s.ever))).toFixed(0)}% (${(100 * median(later.map((s) => s.pixEver))).toFixed(0)}% of pixels)`);
    console.log('palette       none     fs  ordered  proto | ord/none fs/none | reuse  first  later  floor (proto, per frame)');
    const sample = { data: sampleImage(frames), format: 'rgba' };
    for (const config of configs) {
        const palette = config.fixed ?? await base.buildPalette(sample, config.k, config.build);
        const options = { transparent: true };
        const none = await timeFrames(base, frames, palette, { ...options, dither: false });
        const fs = await timeFrames(base, frames, palette, { ...options, dither: true });
        const ord = await timeFrames(base, frames, palette, { ...options, dither: 'ordered' });
        const pro = await timeFrames(proto, frames, palette, { ...options, dither: 'ordered' }, reset);
        for (let i = 0; i < frames.length; i++) {
            const a = ord.outputs[i], b = pro.outputs[i];
            if (a.length !== b.length || a.some((v, j) => v !== b[j])) {throw new Error(`${file} ${config.name}: frame ${i} differs`);}
        }
        // Floor: frame 0 once to fill the table, then frame 0 again (minimum over passes).
        let floor = Infinity;
        for (let pass = 0; pass < PASSES; pass++) {
            await reset();
            await proto.quantizeToIndicesWithPalette(frames[0], palette, { ...options, dither: 'ordered' });
            const t = performance.now();
            await proto.quantizeToIndicesWithPalette(frames[0], palette, { ...options, dither: 'ordered' });
            floor = Math.min(floor, performance.now() - t);
        }
        const [tn, tf, to, tp] = [none, fs, ord, pro].map((r) => sum(r.times));
        console.log(`${config.name.padEnd(11)} ${f1(tn)}${f1(tf)}${f1(to)}${f1(tp)} | ${f2(to / tn)}  ${f2(tf / tn)}   | ${f2(tp / to)} ${f2(pro.times[0])} ${f2(median(pro.times.slice(1)))} ${f2(floor)}`);
        summary.push({ file, palette: config.name, none: tn, fs: tf, ordered: to, proto: tp });
    }
    console.log('');
}

console.log('## Summary: whole clip, prototype over released ordered (lower is better)');
for (const p of configs.map((c) => c.name)) {
    for (const w of ['160', '480']) {
        const rows = summary.filter((r) => r.palette === p && r.file.endsWith(`-${w}.rgba`));
        const ratios = rows.map((r) => r.proto / r.ordered);
        const overNone = rows.map((r) => r.proto / r.none);
        const ordOverNone = rows.map((r) => r.ordered / r.none);
        console.log(`${p.padEnd(11)} ${w}w: reuse ${Math.min(...ratios).toFixed(2)}–${Math.max(...ratios).toFixed(2)}; ordered/none ${Math.min(...ordOverNone).toFixed(1)}–${Math.max(...ordOverNone).toFixed(1)} → with reuse ${Math.min(...overNone).toFixed(1)}–${Math.max(...overNone).toFixed(1)}`);
    }
}
