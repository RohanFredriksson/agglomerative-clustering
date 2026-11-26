// Makes the README's images and GIFs from the library itself.
//
//   npm run build && node docs/media/make.mjs [--only <name>]
//
// Names: hero, nesting, pixel-art, eink, threads, transparency, swatches, animation.
// Every GIF frame is the library's own indexed output (quantizeToIndices* with the palette it returns); swatch bars are
// drawn into the same index arrays, so a frame needs no colour of its own beyond one background entry.
// Output is deterministic (fixed photos, crops, frame lists, no dates), except the timings in results.json.
// Dependencies: sharp (decode, resize), gifenc, fast-png, quantize (the nesting strip's MMCQ row): all dev dependencies.

import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import os from 'node:os';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import gifenc from 'gifenc';
const { GIFEncoder } = gifenc;
import { encode } from 'fast-png';
import quantizeMMCQ from 'quantize';
import { buildClustering, buildPalette, quantize, quantizeToIndicesWithPalette } from '../../dist/index.mjs';

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


const FONT = 'DejaVu Sans, Liberation Sans, Arial, sans-serif';
const escapeXml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** An SVG of text items [{x, y (baseline), text, size, weight?, anchor?}] on nothing, to composite over a canvas. */
function textSvg(width, height, items, fill = '#ececf0') {
    const texts = items
        .map((t) => `<text x="${t.x}" y="${t.y}" font-family="${FONT}" font-size="${t.size}" font-weight="${t.weight ?? 'normal'}" text-anchor="${t.anchor ?? 'start'}" fill="${fill}">${escapeXml(t.text)}</text>`)
        .join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${texts}</svg>`;
}

/** Like writePng, with text drawn over the canvas (an SVG overlay composited by sharp); the result stays opaque. */
async function writeLabelled(file, canvas, items) {
    const base = Buffer.from(encode({ width: canvas.width, height: canvas.height, data: canvas.data, channels: 4, depth: 8 }));
    await sharp(base)
        .composite([{ input: Buffer.from(textSvg(canvas.width, canvas.height, items)) }])
        .removeAlpha()
        .png({ compressionLevel: 9 })
        .toFile(file);
}

/** A palette PNG: 8-bit indices, PLTE, and a tRNS chunk making `transparentIndex` (the last entry) fully transparent. */
function indexedPng(width, height, indices, palette, transparentIndex) {
    const chunk = (type, data) => {
        const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
        const head = Buffer.alloc(4);
        head.writeUInt32BE(data.length);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(zlib.crc32(body));
        return Buffer.concat([head, body, crc]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 3, 0, 0, 0], 8); // 8 bits, palette colour, deflate, no filter method, no interlace
    const rows = Buffer.alloc(height * (width + 1));
    for (let y = 0; y < height; y++) rows.set(indices.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
    const alpha = Buffer.alloc(transparentIndex + 1, 255);
    alpha[transparentIndex] = 0;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header), chunk('PLTE', Buffer.from(palette)), chunk('tRNS', alpha),
        chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
    ]);
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

const HERO_FRAMES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64];

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
        const { palette, shares } = await clustering.getSwatches(k);
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
        if (!HERO_FRAMES.includes(k)) continue;

        const { indices } = await clustering.quantizeToIndices(image, k);
        const bg = k;
        const canvas = indexCanvas(width, height, bg);
        canvas.blit(0, 0, indices, image.width, image.height);
        for (const s of segments(order, shares, width, 1)) canvas.rect(s.x, image.height + gapRows, s.w, barHeight, s.index);
        const flat = new Uint8Array(3 * (k + 1));
        flat.set(palette);
        flat.set(BG, 3 * k);
        // One even pace, and a longer look at the last frame: 20 x 400 ms + 2000 ms = 10 s.
        frames.push({ pixels: canvas.pixels, palette: flat, delay: k === 64 ? 2000 : 400 });
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
    const barHeight = 34;
    const rowGap = 8;
    const margin = 24;
    const labelWidth = 96;
    const header = 52;
    const middle = 40;
    const width = margin * 2 + labelWidth + barWidth * 2 + middle;
    const height = header + margin + ks.length * barHeight + (ks.length - 1) * rowGap + margin;
    const canvas = rgbaCanvas(width, height);
    const leftX = margin + labelWidth;
    const rightX = leftX + barWidth + middle;
    const labels = [
        { x: leftX, y: 34, text: 'median cut (color-thief)', size: 22, weight: 'bold' },
        { x: rightX, y: 34, text: 'agglomerative-clustering', size: 22, weight: 'bold' },
    ];

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
        const y = header + margin + ks.indexOf(k) * (barHeight + rowGap);
        labels.push({ x: margin, y: y + barHeight / 2 + 7, text: `k = ${k}`, size: 20 });
        for (const seg of segments(order, shares, barWidth, 2)) canvas.rect(rightX + seg.x, y, seg.w, barHeight, palCol(palette, seg.index));
        // Median cut (`quantize`, as color-thief uses it), in the order it returns its colours.
        const mmcq = quantizeMMCQ(pixels, k).palette();
        const counts = shareOf(mmcq);
        for (const seg of segments(mmcq.map((_, i) => i), counts, barWidth, 2)) canvas.rect(leftX + seg.x, y, seg.w, barHeight, mmcq[seg.index]);
    }
    await writeLabelled(out('nesting.png'), canvas, labels);
}

// ---------------------------------------------------------------- pixel art: flat blocks, no dither

async function pixelArt() {
    // The row of hats, tightly cropped: clustered in OKLab at 16 colours, mapped with no dither, blocks scaled up.
    const crop = { left: 0, top: 30, width: 768, height: 380 };
    const smallWidth = 72;
    const k = 16;
    const scale = 6;
    const smallHeight = Math.round((smallWidth * crop.height) / crop.width);
    const source = sharp(path.join(photos, 'kodim03.png')).extract(crop);
    const { data } = await source.clone().resize(smallWidth, smallHeight, { kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const small = { data: new Uint8Array(data.buffer, data.byteOffset, data.length), format: 'rgba', width: smallWidth, height: smallHeight };
    const clustering = await buildClustering(small, { colorSpace: 'oklab' });
    const { palette, indices } = await clustering.quantizeToIndices(small, k);
    const w = smallWidth * scale;
    const h = smallHeight * scale;
    const smooth = await source.clone().resize(w, h, { kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer();

    const margin = 16;
    const gap = 16;
    const top = 44;
    const chips = 28;
    const width = margin * 2 + w * 2 + gap;
    const height = top + h + 14 + chips + margin;
    const canvas = rgbaCanvas(width, height);
    canvas.blit(margin, top, { width: w, height: h, data: smooth });
    const x2 = margin + w + gap;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const v = indices[Math.floor(y / scale) * smallWidth + Math.floor(x / scale)];
            canvas.rect(x2 + x, top + y, 1, 1, palCol(palette, v));
        }
    }
    const n = palette.length / 3;
    const chipW = w / n;
    for (let i = 0; i < n; i++) {
        const x0 = Math.round(i * chipW);
        canvas.rect(x2 + x0, top + h + 14, Math.round((i + 1) * chipW) - x0 - 3, chips, palCol(palette, i));
    }
    await writeLabelled(out('pixel-art.png'), canvas, [
        { x: margin, y: 30, text: 'original', size: 20, weight: 'bold' },
        { x: x2, y: 30, text: `${k} colours, ${smallWidth} px wide`, size: 20, weight: 'bold' },
    ]);
}

// ---------------------------------------------------------------- e-ink: the photo next to its seven-ink version

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
    const image = await load('kodim23', 384, 256);
    // docs/guides.md "Fixed palettes": black white green blue red yellow orange
    const inks = [0, 0, 0, 255, 255, 255, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 255, 128, 0];
    const { indices, palette } = await ditherInLight(image, inks, { dither: 'floyd-steinberg' });
    const margin = 16;
    const gap = 16;
    const top = 44;
    const chips = 26;
    const width = margin * 2 + image.width * 2 + gap;
    const height = top + image.height + 14 + chips + margin;
    const canvas = rgbaCanvas(width, height);
    canvas.blit(margin, top, image);
    const mapped = { width: image.width, height: image.height, data: new Uint8Array(image.width * image.height * 4) };
    for (let i = 0; i < indices.length; i++) mapped.data.set([...palCol(palette, indices[i]), 255], 4 * i);
    const x2 = margin + image.width + gap;
    canvas.blit(x2, top, mapped);
    const chipW = Math.floor(image.width / 7);
    for (let i = 0; i < 7; i++) canvas.rect(x2 + i * chipW, top + image.height + 14, chipW - 4, chips, palCol(inks, i));
    await writeLabelled(out('eink.png'), canvas, [
        { x: margin, y: 30, text: 'original', size: 20, weight: 'bold' },
        { x: x2, y: 30, text: '7 e-ink inks, Floyd–Steinberg', size: 20, weight: 'bold' },
    ]);
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
    const choice = await clustering.chooseFrom(chart, 12);
    const { indices, palette } = await quantizeToIndicesWithPalette(image, choice.palette);

    const margin = 16;
    const gap = 14;
    const inner = image.width * 2 + gap; // 654
    const width = margin * 2 + inner;
    const photoTop = margin;
    const chosenLabelY = photoTop + image.height + 34;
    const chosenTop = chosenLabelY + 12;
    const chosenH = 46;
    const allLabelY = chosenTop + chosenH + 34;
    const allTop = allLabelY + 12;
    const allH = 30;
    const height = allTop + allH + margin;
    const canvas = rgbaCanvas(width, height);
    canvas.blit(margin, photoTop, image);
    const mapped = { width: image.width, height: image.height, data: new Uint8Array(image.width * image.height * 4) };
    for (let i = 0; i < indices.length; i++) mapped.data.set([...palCol(palette, indices[i]), 255], 4 * i);
    canvas.blit(margin + image.width + gap, photoTop, mapped);
    const chosenCell = Math.floor(inner / 12);
    choice.indices.forEach((entry, i) => canvas.rect(margin + i * chosenCell, chosenTop, chosenCell - 4, chosenH, threads[entry]));
    const allCell = Math.floor(inner / 24);
    threads.forEach((c, i) => canvas.rect(margin + i * allCell, allTop, allCell - 2, allH, c));
    await writeLabelled(out('threads.png'), canvas, [
        { x: margin, y: chosenLabelY, text: 'chosen 12 of 24', size: 20, weight: 'bold' },
        { x: margin, y: allLabelY, text: 'the set of 24 colours (illustrative)', size: 18 },
    ]);
}

// ---------------------------------------------------------------- transparency: a logo's palette has no background

/** An app-icon-style illustration on a transparent background: gradient rounded square, a paint drop, a soft shadow. */
async function icon(size) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">
<defs>
<linearGradient id="body" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="#7a5cff"/><stop offset="0.55" stop-color="#c14fe0"/><stop offset="1" stop-color="#ff6b8a"/></linearGradient>
<linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.38"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
<linearGradient id="drop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3b8"/><stop offset="1" stop-color="#ffb347"/></linearGradient>
<filter id="shadow" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="12" stdDeviation="11" flood-color="#2a1260" flood-opacity="0.55"/></filter>
<filter id="soft" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#6a1a70" flood-opacity="0.35"/></filter>
</defs>
<rect x="36" y="28" width="184" height="184" rx="44" fill="url(#body)" filter="url(#shadow)"/>
<rect x="36" y="28" width="184" height="184" rx="44" fill="url(#gloss)"/>
<path d="M128 62 C128 62 88 108 88 138 C88 160 106 176 128 176 C150 176 168 160 168 138 C168 108 128 62 128 62 Z" fill="url(#drop)" filter="url(#soft)"/>
<ellipse cx="111" cy="142" rx="7" ry="13" transform="rotate(18 111 142)" fill="#c14fe0" fill-opacity="0.45"/>
</svg>`;
    const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), format: 'rgba', width: info.width, height: info.height };
}

async function transparency() {
    const image = await icon(256);
    const k = 16;
    const palette = await buildPalette(image, k);
    // Mapped output keeps each pixel's own alpha. quantizeToIndices (palette indices) cannot: an indexed pixel is
    // opaque unless it takes the one transparent entry, so a soft shadow would come out as a hard-edged opaque shape.
    const mapped = await quantize(image, k);
    const board = (x, y) => (((x >> 4) + (y >> 4)) & 1 ? [204, 204, 208] : [244, 244, 246]);
    const dark = [52, 54, 66];
    const over = (canvas, left, top, rgba, w, h, background) => {
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const p = 4 * (y * w + x);
                const a = rgba[p + 3] / 255;
                const b = background(x, y);
                canvas.rect(left + x, top + y, 1, 1, [0, 1, 2].map((c) => Math.round(rgba[p + c] * a + b[c] * (1 - a))));
            }
        }
    };
    const margin = 20;
    const gap = 24;
    const top = 52;
    const panel = image.width;
    const chipTop = top + panel + 84;
    const chipH = 34;
    const width = margin * 2 + panel * 3 + gap * 2;
    const height = chipTop + chipH + margin;
    const canvas = rgbaCanvas(width, height);
    over(canvas, margin, top, image.data, panel, panel, board);
    over(canvas, margin + panel + gap, top, mapped.data, panel, panel, board);
    over(canvas, margin + (panel + gap) * 2, top, mapped.data, panel, panel, () => dark);
    const chipsWidth = width - margin * 2;
    for (let i = 0; i < k; i++) {
        const x0 = Math.round((i * chipsWidth) / k);
        canvas.rect(margin + x0, chipTop, Math.round(((i + 1) * chipsWidth) / k) - x0 - 4, chipH, palCol(palette, i));
    }
    await writeLabelled(out('transparency.png'), canvas, [
        { x: margin, y: 32, text: 'original, on a checkerboard', size: 17, weight: 'bold' },
        { x: margin + panel + gap, y: 32, text: 'quantize(icon, 16)', size: 17, weight: 'bold' },
        { x: margin + (panel + gap) * 2, y: 32, text: 'the same pixels on dark', size: 17, weight: 'bold' },
        { x: margin, y: top + panel + 28, text: 'soft shadow, antialiased edges', size: 15 },
        { x: margin + panel + gap, y: top + panel + 28, text: 'each pixel keeps its alpha', size: 15 },
        { x: margin, y: chipTop - 10, text: '16 colours, no background colour', size: 18, weight: 'bold' },
    ]);
    // The palette holds the icon's colours only: count entries near either checkerboard colour or the dark background.
    // (A near-black entry is the shadow's faintest pixels, whose colour is dark by construction; it is counted apart.)
    const background = [[204, 204, 208], [244, 244, 246], dark];
    const near = (c) => background.some((b) => Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]) < 30);
    const partial = (data) => { let n = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 0 && data[i] < 255) n++; return n; };
    const distinct = new Set();
    for (let i = 0; i < mapped.data.length; i += 4) if (mapped.data[i + 3] > 0) distinct.add(`${mapped.data[i]},${mapped.data[i + 1]},${mapped.data[i + 2]}`);
    let sameAlpha = true;
    for (let i = 3; i < image.data.length; i += 4) if (image.data[i] !== mapped.data[i]) sameAlpha = false;
    results.transparency = {
        output: 'quantize (mapped): palette colours with each pixel\'s own alpha',
        paletteEntries: palette.length / 3,
        paletteEntriesNearBackgroundColours: rgbList(palette).filter(near).length,
        paletteEntriesNearBlack: rgbList(palette).filter((c) => Math.hypot(...c) < 30).length,
        outputDistinctColours: distinct.size,
        partiallyTransparentPixels: partial(image.data),
        outputAlphaIdenticalToInput: sameAlpha,
    };
}

// ---------------------------------------------------------------- swatches: colours with their share of the image

async function swatchesCard() {
    const image = await load('kodim03', 320, 214, 'north');
    const clustering = await buildClustering(image);
    const k = 8;
    const { palette, shares } = await clustering.getSwatches(k);
    const order = [...shares.keys()].sort((a, b) => shares[b] - shares[a] || a - b);
    const margin = 14;
    const gap = 16;
    const rowH = 24;
    const rowGap = 4;
    const panelW = 270;
    const width = margin * 2 + image.width + gap + panelW;
    const height = margin * 2 + image.height;
    const canvas = rgbaCanvas(width, height);
    canvas.blit(margin, margin, image);
    const x0 = margin + image.width + gap;
    const top = margin + Math.round((image.height - (k * rowH + (k - 1) * rowGap)) / 2);
    const barMax = panelW - rowH - 8 - 64;
    const biggest = shares[order[0]];
    const labels = [];
    order.forEach((index, r) => {
        const y = top + r * (rowH + rowGap);
        const c = palCol(palette, index);
        canvas.rect(x0, y, rowH, rowH, c);
        canvas.rect(x0 + rowH + 8, y + 8, barMax, 8, [50, 50, 56]);
        canvas.rect(x0 + rowH + 8, y + 8, Math.max(3, Math.round((barMax * shares[index]) / biggest)), 8, c);
        const pct = shares[index] * 100;
        labels.push({ x: x0 + rowH + 8 + barMax + 10, y: y + 18, text: pct < 1 ? '<1%' : `${Math.round(pct)}%`, size: 15 });
    });
    await writeLabelled(out('swatches.png'), canvas, labels);
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
    const n = palette.length / 3;

    // Palette entries after the 12 colours: the page background, a six-step ramp from it to white for the labels, black and magenta.
    const RAMP = 6;
    const bg = n, ramp = n + 1, black = n + 1 + RAMP, magenta = black + 1;
    const flat = new Uint8Array(3 * (magenta + 1));
    flat.set(palette);
    flat.set(BG, 3 * bg);
    for (let i = 0; i < RAMP; i++) flat.set(BG.map((v) => Math.round(v + ((236 - v) * i) / (RAMP - 1))), 3 * (ramp + i));
    flat.set([0, 0, 0], 3 * black);
    flat.set([255, 0, 255], 3 * magenta);

    const gutter = 4;
    const width = base.width * 2 + gutter;
    const labelH = 26;
    const height = labelH + base.height + labelH + base.height;
    // A strip of text as palette indices: rendered by sharp, then each pixel's brightness picks a step of the ramp.
    const textStrip = async (items) => {
        const svg = textSvg(width, labelH, items);
        const raw = await sharp({ create: { width, height: labelH, channels: 3, background: { r: BG[0], g: BG[1], b: BG[2] } } })
            .composite([{ input: Buffer.from(svg) }]).removeAlpha().raw().toBuffer();
        const strip = new Uint8Array(width * labelH);
        for (let i = 0; i < strip.length; i++) {
            const level = (raw[3 * i] - BG[0]) / (236 - BG[0]);
            strip[i] = ramp + Math.max(0, Math.min(RAMP - 1, Math.round(level * (RAMP - 1))));
        }
        return strip;
    };
    const top = await textStrip([
        { x: base.width / 2, y: 18, text: 'Floyd–Steinberg', size: 16, weight: 'bold', anchor: 'middle' },
        { x: base.width + gutter + base.width / 2, y: 18, text: 'ordered', size: 16, weight: 'bold', anchor: 'middle' },
    ]);
    const middle = await textStrip([
        { x: width / 2, y: 18, text: 'pixels that changed since the last frame, away from the disk', size: 14, anchor: 'middle' },
    ]);

    // For results.json: the share of pixels away from the disk (further than its radius + 8 from where it was in either
    // frame) that change between one frame and the next, for each method.
    const away = (t, previous, i) => {
        const x = i % base.width + 0.5, y = Math.floor(i / base.width) + 0.5;
        const here = ball(t), before = ball(previous);
        return Math.hypot(x - here.x, y - here.y) > here.r + 8 && Math.hypot(x - before.x, y - before.y) > before.r + 8;
    };
    const changed = { 'floyd-steinberg': [0, 0], ordered: [0, 0] };
    const frames = [];
    let last = null;
    for (const [t, image] of clips.entries()) {
        const left = await quantizeToIndicesWithPalette(image, palette, { dither: 'floyd-steinberg' });
        const right = await quantizeToIndicesWithPalette(image, palette, { dither: 'ordered' });
        const canvas = indexCanvas(width, height, bg);
        canvas.blit(0, 0, top, width, labelH);
        canvas.blit(0, labelH, left.indices, base.width, base.height);
        canvas.blit(base.width + gutter, labelH, right.indices, base.width, base.height);
        canvas.blit(0, labelH + base.height, middle, width, labelH);
        const marks = [new Uint8Array(base.width * base.height).fill(black), new Uint8Array(base.width * base.height).fill(black)];
        if (last) {
            [['floyd-steinberg', left.indices, last.left], ['ordered', right.indices, last.right]].forEach(([name, now, then], m) => {
                for (let i = 0; i < now.length; i++) {
                    if (!away(t, t - 1, i)) continue;
                    changed[name][1]++;
                    if (now[i] !== then[i]) {
                        changed[name][0]++;
                        marks[m][i] = magenta;
                    }
                }
            });
        }
        canvas.blit(0, 2 * labelH + base.height, marks[0], base.width, base.height);
        canvas.blit(base.width + gutter, 2 * labelH + base.height, marks[1], base.width, base.height);
        last = { left: left.indices, right: right.indices };
        frames.push({ pixels: canvas.pixels, palette: flat, delay: 100 });
    }
    await writeGif(out('animation.gif'), width, height, frames, { delta: true });
    const pct = ([a, b]) => Math.round((1000 * a) / b) / 10;
    results.animation = { photo: 'kodim08', frames: frameCount, colours: 12, pixelsChangedAwayFromBallPercent: { 'floyd-steinberg': pct(changed['floyd-steinberg']), ordered: pct(changed.ordered) } };
}

// ---------------------------------------------------------------- run

const jobs = { hero, nesting, 'pixel-art': pixelArt, eink, threads: threadsCard, transparency, swatches: swatchesCard, animation };
if (only && !jobs[only]) throw new Error(`unknown name "${only}"; names: ${Object.keys(jobs).join(', ')}`);
for (const [name, job] of Object.entries(jobs)) if (wanted(name)) await job();

const files = {};
for (const name of (await readdir(here)).sort()) {
    if (/\.(gif|png)$/.test(name)) files[name] = (await stat(out(name))).size;
}
results.files = files;
await writeFile(resultsFile, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({ hero: results.hero && { totalMs: results.hero.totalMs }, files }, null, 1));
