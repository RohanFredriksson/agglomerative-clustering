// Makes the README's images and GIFs from the library itself.
//
//   npm run build && node docs/media/make.mjs [--only <name>]
//
// Names: hero, nesting, pixel-art, eink, threads, indexed, swatches, animation.
// Every GIF frame is the library's own indexed output (quantizeToIndices* with the palette it returns); swatch bars are
// drawn into the same index arrays, so a frame needs no colour of its own beyond one background entry.
// Output is deterministic (fixed photos, crops, frame lists, no dates), except the timings in results.json.
// Dependencies: sharp (decode, resize), gifenc, fast-png, quantize (the nesting strip's MMCQ row): all dev dependencies.

import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import gifenc from 'gifenc';
const { GIFEncoder } = gifenc;
import { encode } from 'fast-png';
import quantizeMMCQ from 'quantize';
import { buildClustering, quantizeToIndicesWithPalette } from '../../dist/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const photos = path.join(here, '../../fixtures/images');
const out = (name) => path.join(here, name);

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const wanted = (name) => !only || only === name;

// ---------------------------------------------------------------- helpers

/** A Kodak photo, cropped to cover width x height (centred unless `position` says otherwise), as an RGBA raw image. */
async function load(name, width, height, position = 'centre') {
    const { data, info } = await sharp(path.join(photos, `${name}.png`))
        .resize(width, height, { fit: 'cover', position, kernel: 'lanczos3' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), format: 'rgba', width: info.width, height: info.height };
}

const rgbList = (flat) => Array.from({ length: flat.length / 3 }, (_, i) => [flat[3 * i], flat[3 * i + 1], flat[3 * i + 2]]);
const BG = [24, 24, 28];

/** An index canvas: a width x height array of palette indices, a fill and a blit. */
function indexCanvas(width, height, fill) {
    const pixels = new Uint8Array(width * height).fill(fill);
    return {
        width, height, pixels,
        rect(x, y, w, h, index) {
            for (let j = y; j < y + h; j++) pixels.fill(index, j * width + x, j * width + x + w);
        },
        blit(x, y, source, w, h) {
            for (let j = 0; j < h; j++) pixels.set(source.subarray(j * w, (j + 1) * w), (y + j) * width + x);
        },
    };
}

/** Segments of a bar of `width` pixels for `weights` in the order `order`: [{index, x, w}], rounded so they tile it. */
function segments(order, weights, width, gap = 0) {
    const total = order.reduce((s, i) => s + weights[i], 0) || 1;
    const list = [];
    let cumulative = 0;
    let x = 0;
    for (const index of order) {
        cumulative += weights[index];
        const end = Math.round((width * cumulative) / total);
        if (end > x) list.push({ index, x, w: end - x - (end - x >= 3 ? gap : 0) });
        x = end;
    }
    return list;
}

const bitsFor = (n) => Math.max(2, Math.ceil(Math.log2(Math.max(n, 2))));

/**
 * Writes a GIF. frames: [{pixels, palette (flat RGB), delay (ms)}] sharing a size. With `delta`, a pixel whose colour
 * equals what the frame before shows is written as transparent over it (the frame is left in place, not cleared), so
 * the picture is the same and the file is smaller; every visible pixel is still the library's output.
 */
async function writeGif(file, width, height, frames, { delta = false } = {}) {
    const gif = GIFEncoder();
    let shown = null; // the previous frame's colours, 3 bytes a pixel
    frames.forEach((f, i) => {
        let pixels = f.pixels;
        let palette = f.palette;
        const options = { delay: f.delay, repeat: 0 };
        if (delta) {
            const colours = new Uint8Array(width * height * 3);
            for (let p = 0; p < pixels.length; p++) colours.set(f.palette.subarray(3 * pixels[p], 3 * pixels[p] + 3), 3 * p);
            if (shown) {
                const slot = f.palette.length / 3;
                pixels = new Uint8Array(f.pixels);
                for (let p = 0; p < pixels.length; p++) {
                    if (colours[3 * p] === shown[3 * p] && colours[3 * p + 1] === shown[3 * p + 1] && colours[3 * p + 2] === shown[3 * p + 2]) pixels[p] = slot;
                }
                palette = new Uint8Array(f.palette.length + 3);
                palette.set(f.palette);
                Object.assign(options, { transparent: true, transparentIndex: slot, dispose: 1 });
            } else {
                Object.assign(options, { dispose: 1 });
            }
            shown = colours;
        }
        gif.writeFrame(pixels, width, height, { ...options, palette: rgbList(palette), colorDepth: bitsFor(palette.length / 3) });
    });
    gif.finish();
    await writeFile(file, gif.bytes());
}

/** A PNG on an opaque background: `canvas` is {width, height, data: RGBA}. */
async function writePng(file, canvas) {
    await writeFile(file, encode({ width: canvas.width, height: canvas.height, data: canvas.data, channels: 4, depth: 8 }, { zlib: { level: 9 } }));
}

function rgbaCanvas(width, height, color = BG) {
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set([...color, 255], 4 * i);
    return {
        width, height, data,
        rect(x, y, w, h, c) {
            for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) data.set([c[0], c[1], c[2], 255], 4 * (j * width + i));
        },
        blit(x, y, image) {
            for (let j = 0; j < image.height; j++) {
                for (let i = 0; i < image.width; i++) {
                    const s = 4 * (j * image.width + i);
                    data.set([image.data[s], image.data[s + 1], image.data[s + 2], 255], 4 * ((y + j) * width + x + i));
                }
            }
        },
    };
}

const median = (list) => [...list].sort((a, b) => a - b)[list.length >> 1];
const palCol = (flat, i) => [flat[3 * i], flat[3 * i + 1], flat[3 * i + 2]];

// ---------------------------------------------------------------- results

const resultsFile = out('results.json');
let results = {};
try {
    results = JSON.parse(await readFile(resultsFile, 'utf8'));
} catch {}

// ---------------------------------------------------------------- hero: 2 to 64 colours from one clustering

async function hero() {
    const width = 768;
    const image = await load('kodim23', width, 512);
    const barHeight = 34;
    const gapRows = 8;
    const height = image.height + gapRows + barHeight;

    // The number in the caption: clustering plus all 63 cuts, k = 2..64, decoding and resizing excluded; median of 5.
    const settings = { photo: 'kodim23', width: image.width, height: image.height, colorSpace: 'rgb', precision: 8, k: '2..64', runs: 5 };
    const loadBefore = os.loadavg()[0];
    const once = async () => {
        const t0 = performance.now();
        const c = await buildClustering(image);
        const t1 = performance.now();
        for (let k = 2; k <= 64; k++) await c.getPalette(k);
        const t2 = performance.now();
        return { clusterMs: t1 - t0, cutsMs: t2 - t1, totalMs: t2 - t0 };
    };
    await once(); // warm-up: loads the WebAssembly
    const runs = [];
    for (let i = 0; i < 5; i++) runs.push(await once());
    const loadAfter = os.loadavg()[0];
    const round = (v) => Math.round(v * 10) / 10;
    results.hero = {
        width: image.width, height: image.height,
        clusterMs: round(median(runs.map((r) => r.clusterMs))),
        cutsMs: round(median(runs.map((r) => r.cutsMs))),
        totalMs: round(median(runs.map((r) => r.totalMs))),
        runsTotalMs: runs.map((r) => round(r.totalMs)),
        settings,
    };
    results.machine = `${os.cpus()[0].model} x ${os.cpus().length}, ${os.platform()} ${os.release()}`;
    results.node = process.version;
    results.load = { before: loadBefore, after: loadAfter };

    // The frames.
    const clustering = await buildClustering(image);
    const frames = [];
    let order = [0]; // display order of palette indices in the bar; a split inserts the new colour beside its parent
    let previous = await clustering.getPalette(1);
    for (let k = 2; k <= 64; k++) {
        const { palette, indices } = await clustering.quantizeToIndices(image, k);
        const { shares } = await clustering.getSwatches(k);
        // The split: the heavier child takes the parent's index and the lighter child is appended, so the one index
        // that changed is the parent, and index k-1 is its new neighbour.
        let parent = order[order.length - 1];
        for (let i = 0; i < previous.length / 3; i++) {
            if (previous[3 * i] !== palette[3 * i] || previous[3 * i + 1] !== palette[3 * i + 1] || previous[3 * i + 2] !== palette[3 * i + 2]) {
                parent = i;
                break;
            }
        }
        order.splice(order.indexOf(parent) + 1, 0, k - 1);
        previous = palette;

        const bg = k;
        const canvas = indexCanvas(width, height, bg);
        canvas.blit(0, 0, indices, image.width, image.height);
        for (const s of segments(order, shares, width, 1)) canvas.rect(s.x, image.height + gapRows, s.w, barHeight, s.index);
        const flat = new Uint8Array(3 * (k + 1));
        flat.set(palette);
        flat.set(BG, 3 * k);
        // 2 colours is a slow start worth showing; 64 is the held end.
        frames.push({ pixels: canvas.pixels, palette: flat, delay: k === 2 ? 700 : k === 64 ? 2200 : 90 });
    }
    await writeGif(out('hero.gif'), width, height, frames, { delta: true });
}

// ---------------------------------------------------------------- nesting strip: median cut against this library

async function nesting() {
    const image = await load('kodim23', 384, 256);
    const clustering = await buildClustering(image);
    const pixels = [];
    for (let i = 0; i < image.data.length; i += 4) pixels.push([image.data[i], image.data[i + 1], image.data[i + 2]]);

    // One bar per k, as wide as the image, each colour as wide as its share of the pixels, so a split shows as one
    // swatch becoming two in the row below and every other swatch staying exactly where it was.
    const ks = [4, 5, 6, 7, 8, 9, 10, 11, 12];
    const barWidth = 400;
    const barHeight = 28;
    const rowGap = 6;
    const margin = 18;
    const middle = 44;
    const width = margin * 2 + barWidth * 2 + middle;
    const height = margin * 2 + ks.length * barHeight + (ks.length - 1) * rowGap;
    const canvas = rgbaCanvas(width, height);

    // The share of pixels whose nearest colour (in RGB) is each of the median cut's colours.
    const shareOf = (colours) => {
        const counts = new Array(colours.length).fill(0);
        for (const p of pixels) {
            let best = 0, bestD = Infinity;
            colours.forEach((c, i) => {
                const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
                if (d < bestD) { bestD = d; best = i; }
            });
            counts[best]++;
        }
        return counts;
    };

    let order = [0]; // this library's display order: a split puts the new colour beside its parent
    let previous = await clustering.getPalette(1);
    for (let k = 2; k <= ks[ks.length - 1]; k++) {
        const { palette, shares } = await clustering.getSwatches(k);
        let parent = order[order.length - 1];
        for (let i = 0; i < previous.length / 3; i++) {
            if (previous[3 * i] !== palette[3 * i] || previous[3 * i + 1] !== palette[3 * i + 1] || previous[3 * i + 2] !== palette[3 * i + 2]) { parent = i; break; }
        }
        order.splice(order.indexOf(parent) + 1, 0, k - 1);
        previous = palette;
        if (!ks.includes(k)) continue;
        const y = margin + ks.indexOf(k) * (barHeight + rowGap);
        for (const seg of segments(order, shares, barWidth, 2)) {
            canvas.rect(margin + barWidth + middle + seg.x, y, seg.w, barHeight, palCol(palette, seg.index));
        }
        // Median cut (`quantize`, as color-thief uses it), in the order it returns its colours.
        const mmcq = quantizeMMCQ(pixels, k).palette();
        const counts = shareOf(mmcq);
        for (const seg of segments(mmcq.map((_, i) => i), counts, barWidth, 2)) canvas.rect(margin + seg.x, y, seg.w, barHeight, mmcq[seg.index]);
    }
    await writePng(out('nesting.png'), canvas);
}

// ---------------------------------------------------------------- pixel art: 4, 8, 16 colours, ordered dither

async function pixelArt() {
    const small = await load('kodim22', 120, 80);
    const scale = 3;
    const clustering = await buildClustering(small);
    const width = small.width * scale;
    const barHeight = 18;
    const height = small.height * scale + 8 + barHeight;
    const frames = [];
    for (const k of [4, 8, 16, 8]) {
        const { palette, indices } = await clustering.quantizeToIndices(small, k, { dither: 'ordered' });
        const n = palette.length / 3;
        const canvas = indexCanvas(width, height, n);
        for (let y = 0; y < small.height; y++) {
            for (let x = 0; x < small.width; x++) {
                const v = indices[y * small.width + x];
                for (let j = 0; j < scale; j++) canvas.pixels.fill(v, (y * scale + j) * width + x * scale, (y * scale + j) * width + x * scale + scale);
            }
        }
        const cellW = width / n;
        for (let i = 0; i < n; i++) {
            const x0 = Math.round(i * cellW);
            canvas.rect(x0, small.height * scale + 8, Math.round((i + 1) * cellW) - x0, barHeight, i);
        }
        const flat = new Uint8Array(3 * (n + 1));
        flat.set(palette);
        flat.set(BG, 3 * n);
        frames.push({ pixels: canvas.pixels, palette: flat, delay: k === 16 ? 1400 : 1000 });
    }
    await writeGif(out('pixel-art.gif'), width, height, frames);
}

// ---------------------------------------------------------------- e-ink: seven inks, with and without dithering

/**
 * The recipe from docs/api.md "Dithering to a few inks: mix in light", copied as it stands there: it dithers in
 * linear light, which is what an e-ink panel mixes (dithering sRGB values, photos come out up to 2.8 times too light).
 */
async function ditherInLight(image, inks, options = {}) {
    const linear = Array.from({ length: 256 }, (_, v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    const inLight = (source, target, i) => {
        const r = linear[source[i]], g = linear[source[i + 1]], b = linear[source[i + 2]];
        const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        target[i] = 128 + (255 * (r - y)) / 1.5748;
        target[i + 1] = 127.5 * y;
        target[i + 2] = 128 + (255 * (b - y)) / 1.8556;
    };
    const data = new Uint8ClampedArray(image.data.length);
    for (let i = 0; i < data.length; i += 4) {
        inLight(image.data, data, i);
        data[i + 3] = image.data[i + 3];
    }
    const palette = new Uint8ClampedArray(inks.length);
    for (let i = 0; i < inks.length; i += 3) inLight(inks, palette, i);
    const result = await quantizeToIndicesWithPalette({ data, format: 'rgba', width: image.width }, new Uint8Array(palette), { dither: true, ...options });
    result.palette.set(inks);
    return result;
}

async function eink() {
    const image = await load('kodim12', 400, 267);
    // docs/guides.md "Fixed palettes": black white green blue red yellow orange
    const inks = [0, 0, 0, 255, 255, 255, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 255, 128, 0];
    const frames = [];
    const plain = await quantizeToIndicesWithPalette(image, inks, { dither: false });
    frames.push({ pixels: plain.indices, palette: plain.palette, delay: 1500 });
    for (const dither of ['floyd-steinberg', 'ordered']) {
        const { indices, palette } = await ditherInLight(image, inks, { dither });
        frames.push({ pixels: indices, palette, delay: 1500 });
    }
    await writeGif(out('eink.gif'), image.width, image.height, frames);
}

// ---------------------------------------------------------------- threads: choose k colours from a fixed set

/** "A fixed set of 24 colours (illustrative)": hand-picked, not a real chart. Also printed in the README card. */
export const threads = [
    [250, 250, 245], [30, 30, 32], [120, 122, 128], [196, 198, 200],
    [190, 30, 45], [235, 100, 110], [232, 120, 40], [245, 190, 50],
    [250, 225, 120], [120, 160, 60], [40, 110, 70], [20, 70, 60],
    [60, 150, 170], [40, 100, 190], [25, 45, 110], [110, 80, 170],
    [170, 70, 140], [245, 170, 190], [150, 95, 60], [90, 60, 40],
    [215, 180, 140], [240, 215, 190], [150, 30, 70], [100, 170, 220],
];

async function threadsCard() {
    const image = await load('kodim15', 320, 214);
    const chart = threads.flat();
    const clustering = await buildClustering(image);
    const choice = await clustering.chooseFrom(chart, 8);
    const { indices, palette } = await quantizeToIndicesWithPalette(image, choice.palette);

    const margin = 14;
    const gap = 14;
    const cols = 24;
    const cell = Math.floor((image.width * 2 + gap) / cols); // 27
    const rowWidth = cell * cols;
    const width = margin * 2 + Math.max(rowWidth, image.width * 2 + gap);
    const photoTop = margin;
    const stripTop = photoTop + image.height + 18;
    const height = stripTop + 44 + margin;
    const canvas = rgbaCanvas(width, height);
    canvas.blit(margin, photoTop, image);
    // The mapped image, from the library's indices.
    const mapped = { width: image.width, height: image.height, data: new Uint8Array(image.width * image.height * 4) };
    for (let i = 0; i < indices.length; i++) mapped.data.set([...palCol(palette, indices[i]), 255], 4 * i);
    canvas.blit(margin + image.width + gap, photoTop, mapped);
    const chosen = new Set(choice.indices);
    for (let i = 0; i < cols; i++) {
        const x = margin + i * cell;
        if (chosen.has(i)) {
            canvas.rect(x, stripTop, cell - 2, 34, threads[i]);
            canvas.rect(x, stripTop + 38, cell - 2, 4, [245, 245, 245]);
        } else {
            canvas.rect(x, stripTop + 8, cell - 2, 26, threads[i].map((v, c) => Math.round(BG[c] + (v - BG[c]) * 0.35)));
        }
    }
    await writePng(out('threads.png'), canvas);
}

// ---------------------------------------------------------------- indexed output: one palette for a whole GIF

async function indexed() {
    const full = await load('kodim20', 640, 427);
    const view = { w: 320, h: 214 };
    const crop = async (zoom) => {
        const w = Math.round(full.width / zoom);
        const h = Math.round(full.height / zoom);
        const left = Math.round((full.width - w) * 0.28);
        const top = Math.round((full.height - h) * 0.36);
        const { data } = await sharp(Buffer.from(full.data.buffer, full.data.byteOffset, full.data.length), { raw: { width: full.width, height: full.height, channels: 4 } })
            .extract({ left, top, width: w, height: h })
            .resize(view.w, view.h, { kernel: 'lanczos3' })
            .raw()
            .toBuffer({ resolveWithObject: true });
        return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), format: 'rgba', width: view.w, height: view.h };
    };
    const zooms = [1, 1.1, 1.25, 1.45, 1.7, 2, 2.35, 2.35, 2, 1.7, 1.45, 1.25, 1.1, 1];
    const images = [];
    for (const z of zooms) images.push(await crop(z));
    // One palette for every frame (so there is one colour table): cluster the first frame, map them all to it.
    const clustering = await buildClustering(images[0]);
    const palette = await clustering.getPalette(32);
    const frames = [];
    for (const image of images) {
        const result = await quantizeToIndicesWithPalette(image, palette, { dither: true });
        frames.push({ pixels: result.indices, palette: result.palette, delay: 100 });
    }
    await writeGif(out('indexed.gif'), view.w, view.h, frames);
}

// ---------------------------------------------------------------- swatches: colours with their share of the image

async function swatchesCard() {
    const image = await load('kodim03', 320, 214, 'north');
    const clustering = await buildClustering(image);
    const k = 8;
    const { palette, shares } = await clustering.getSwatches(k);
    const order = [...shares.keys()].sort((a, b) => shares[b] - shares[a] || a - b);
    const margin = 14;
    const gap = 14;
    const rowH = 22;
    const rowGap = 5;
    const panelW = 190;
    const width = margin * 2 + image.width + gap + panelW;
    const height = margin * 2 + image.height;
    const canvas = rgbaCanvas(width, height);
    canvas.blit(margin, margin, image);
    const x0 = margin + image.width + gap;
    const top = margin + Math.round((image.height - (k * rowH + (k - 1) * rowGap)) / 2);
    const barMax = panelW - rowH - 8;
    const biggest = shares[order[0]];
    order.forEach((index, r) => {
        const y = top + r * (rowH + rowGap);
        const c = palCol(palette, index);
        canvas.rect(x0, y, rowH, rowH, c);
        // A bar for the share, in the swatch's colour, on a lighter track so dark colours stay visible.
        canvas.rect(x0 + rowH + 8, y + 7, barMax, 8, [50, 50, 56]);
        canvas.rect(x0 + rowH + 8, y + 7, Math.max(3, Math.round((barMax * shares[index]) / biggest)), 8, c);
    });
    await writePng(out('swatches.png'), canvas);
}

// ---------------------------------------------------------------- animation: ordered dithering keeps still areas still

async function animation() {
    const base = await load('kodim08', 240, 180);
    const frameCount = 20;
    const ball = (t) => ({ x: 30 + (180 * t) / (frameCount - 1), y: 90 + 40 * Math.sin((t / (frameCount - 1)) * Math.PI * 2), r: 15 });
    const render = (t) => {
        const data = new Uint8Array(base.data);
        const { x, y, r } = ball(t);
        for (let j = 0; j < base.height; j++) {
            for (let i = 0; i < base.width; i++) {
                const d = Math.hypot(i + 0.5 - x, j + 0.5 - y);
                const a = Math.min(1, Math.max(0, r + 0.5 - d));
                if (a > 0) {
                    const p = 4 * (j * base.width + i);
                    const c = [250, 215, 40];
                    for (let ch = 0; ch < 3; ch++) data[p + ch] = Math.round(data[p + ch] * (1 - a) + c[ch] * a);
                }
            }
        }
        return { data, format: 'rgba', width: base.width, height: base.height };
    };
    const clips = [];
    for (let t = 0; t < frameCount; t++) clips.push(render(t));
    // One fixed 12-colour palette for the whole clip, from the middle frame.
    const palette = await (await buildClustering(clips[frameCount >> 1])).getPalette(12);
    const gutter = 4;
    const width = base.width * 2 + gutter;
    const height = base.height;
    const frames = [];
    // For results.json: the share of pixels away from the ball (further than its radius + 8 from where it was in either
    // frame) that change between one frame and the next, for each method.
    const away = (t, previous, i) => {
        const x = i % base.width + 0.5, y = Math.floor(i / base.width) + 0.5;
        const here = ball(t), before = ball(previous);
        return Math.hypot(x - here.x, y - here.y) > here.r + 8 && Math.hypot(x - before.x, y - before.y) > before.r + 8;
    };
    const changed = { 'floyd-steinberg': [0, 0], ordered: [0, 0] };
    let last = null;
    for (const [t, image] of clips.entries()) {
        const left = await quantizeToIndicesWithPalette(image, palette, { dither: 'floyd-steinberg' });
        const right = await quantizeToIndicesWithPalette(image, palette, { dither: 'ordered' });
        if (last) {
            for (const [name, now, then] of [['floyd-steinberg', left.indices, last.left], ['ordered', right.indices, last.right]]) {
                for (let i = 0; i < now.length; i++) {
                    if (!away(t, t - 1, i)) continue;
                    changed[name][1]++;
                    if (now[i] !== then[i]) changed[name][0]++;
                }
            }
        }
        last = { left: left.indices, right: right.indices };
        const n = palette.length / 3;
        const canvas = indexCanvas(width, height, n);
        canvas.blit(0, 0, left.indices, base.width, base.height);
        canvas.blit(base.width + gutter, 0, right.indices, base.width, base.height);
        const flat = new Uint8Array(3 * (n + 1));
        flat.set(left.palette);
        flat.set(BG, 3 * n);
        frames.push({ pixels: canvas.pixels, palette: flat, delay: 100 });
    }
    await writeGif(out('animation.gif'), width, height, frames, { delta: true });
    const pct = ([n, d]) => Math.round((1000 * n) / d) / 10;
    results.animation = { photo: 'kodim08', frames: frameCount, colours: 12, pixelsChangedAwayFromBallPercent: { 'floyd-steinberg': pct(changed['floyd-steinberg']), ordered: pct(changed.ordered) } };
}

// ---------------------------------------------------------------- run

const jobs = { hero, nesting, 'pixel-art': pixelArt, eink, threads: threadsCard, indexed, swatches: swatchesCard, animation };
if (only && !jobs[only]) throw new Error(`unknown name "${only}"; names: ${Object.keys(jobs).join(', ')}`);
for (const [name, job] of Object.entries(jobs)) if (wanted(name)) await job();

const files = {};
for (const name of (await readdir(here)).sort()) {
    if (/\.(gif|png)$/.test(name)) files[name] = (await stat(out(name))).size;
}
results.files = files;
await writeFile(resultsFile, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({ hero: results.hero && { totalMs: results.hero.totalMs }, files }, null, 1));
