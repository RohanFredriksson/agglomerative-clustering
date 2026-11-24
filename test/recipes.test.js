// Runs the recipes in docs/guides.md ("Converting the output" and others) against the real encoders, so the documentation can't drift from the API.
import { describe, it, expect } from 'vitest';
import * as gifenc from 'gifenc';
import { GifReader } from 'omggif';
import { encode as encodePng, decode as decodePng } from 'fast-png';
import { Palette, buildSwatches, buildClustering, quantizeToIndices, quantizeToIndicesWithPalette, quantizeWithPalette, buildPalette } from '../dist/index.mjs';
import { timeLimit } from './timeout.js';


// gifenc is CommonJS with an ES build: named exports in bundlers, only a default export in plain Node ESM.
const GIFEncoder = gifenc.GIFEncoder ?? gifenc.default.GIFEncoder;

// A logo-like image: coloured discs with anti-aliased edges on a transparent background.
const width = 96, height = 72;
const data = new Uint8Array(width * height * 4);
const discs = [[30, 30, 24, [220, 50, 40]], [62, 36, 20, [40, 110, 220]], [48, 54, 16, [60, 200, 90]]];
for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
        let best = [0, 0, 0, 0];
        for (const [cx, cy, r, c] of discs) {
            const cover = Math.max(0, Math.min(1, r + 0.5 - Math.hypot(x - cx, y - cy)));
            if (cover * 255 > best[3]) {best = [...c, cover * 255];}
        }
        data.set(best.map(Math.round), (y * width + x) * 4);
    }
}
const image = { data, format: 'rgba', width, height };

const toColors = (palette) => Array.from({ length: palette.length / 3 }, (_, i) => [palette[3 * i], palette[3 * i + 1], palette[3 * i + 2]]);

describe('recipes in the guides', () => {

    // The guides' "Converting the output" and "Heaviest first" recipes. Their functions are checked against the guides' text
    // below, so the two can't drift apart.
    const toHex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    function rankSwatches({ palette, shares }) {
      return Array.from(shares, (share, i) => {
        const [r, g, b] = palette.subarray(3 * i, 3 * i + 3);
        return { color: [r, g, b], hex: toHex(r, g, b), share };
      }).sort((a, b) => b.share - a.share);   // equal shares keep split order
    }
    const rankPalette = (swatches) => new Palette(rankSwatches(swatches).flatMap((s) => s.color), swatches.palette.colorSpace);
    // The transparent entry, if there is one, stays last, so `transparentIndex` and `colors` keep their meaning.
    function rankIndices(result) {
      const { palette, colors, indices } = result;
      const n = colors.length / 3;                                                       // the colour entries
      const used = new Uint32Array(palette.length / 3);
      for (let p = 0; p < indices.length; p++) {used[indices[p]]++;}
      const byUse = Array.from({ length: n }, (_, i) => i).sort((a, b) => used[b] - used[a]);   // old index of the 1st, 2nd, …
      const rank = Uint32Array.from(used.keys());
      const ranked = Uint8Array.from(palette);
      byUse.forEach((old, position) => {
        rank[old] = position;
        ranked.set(palette.subarray(3 * old, 3 * old + 3), 3 * position);
      });
      const rankedIndices = indices.slice();                                             // same typed-array type as `indices`
      for (let p = 0; p < indices.length; p++) {rankedIndices[p] = rank[indices[p]];}
      // The rest of the result (indexBits, transparentIndex, width, height) carries over.
      return { ...result, palette: new Palette(ranked, palette.colorSpace), colors: new Palette(ranked.subarray(0, 3 * n), palette.colorSpace),
        indices: rankedIndices };
    }

    it('the swatch-ranking recipes are the ones in the guides', async () => {
        const { readFile } = await import('fs/promises');
        const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
        // A declaration's lines, trimmed: one line for a `const`, to the closing brace at its indentation for a function.
        const source = (text, start) => {
            const lines = text.split('\n');
            const first = lines.findIndex((line) => line.trim().startsWith(start));
            expect(first, `${start} is in the file`).toBeGreaterThanOrEqual(0);
            if (start.startsWith('const')) {return lines[first].trim();}
            const indent = lines[first].match(/^ */)[0];
            const end = lines.findIndex((line, i) => i > first && line === `${indent}}`);
            expect(end, `${start} has a closing brace at its indentation`).toBeGreaterThan(first);
            return lines.slice(first, end + 1).map((line) => line.trim()).join('\n');
        };
        const [guides, test] = await Promise.all([read('../docs/guides.md'), read('./recipes.test.js')]);
        for (const start of ['const toHex =', 'function rankSwatches(', 'const rankPalette =', 'function rankIndices(']) {
            expect(source(test, start)).toBe(source(guides, start));
        }
    });

    it('palette conversions', async () => {
        const clustering = await buildClustering(image);
        const { palette, shares } = await clustering.getSwatches(3);
        const colors = toColors(palette);
        const css = (i) => `rgb(${palette[3 * i]} ${palette[3 * i + 1]} ${palette[3 * i + 2]})`;
        const hexString = (i) => toHex(...palette.subarray(3 * i, 3 * i + 3));
        const hexNumber = (i) => (palette[3 * i] << 16) | (palette[3 * i + 1] << 8) | palette[3 * i + 2];
        expect(colors).toEqual([[220, 50, 40], [40, 110, 220], [60, 200, 90]]);
        expect(css(0)).toBe('rgb(220 50 40)');
        expect(hexString(0)).toBe('#dc3228');
        expect(toHex(0, 5, 255)).toBe('#0005ff');
        expect(hexNumber(0)).toBe(0xdc3228);
        expect(shares.reduce((a, s) => a + s, 0)).toBeCloseTo(1, 12);
    });

    // 40 red pixels and two similar blues of 30: in split order at three colours the first entry is a blue (30 pixels) and
    // the heaviest, red, is second.
    const split = (() => {
        const px = [];
        const add = (rgb, n) => {for (let i = 0; i < n; i++) {px.push(...rgb, 255);}};
        add([255, 0, 0], 40); add([0, 0, 255], 30); add([20, 20, 235], 30);
        return { data: new Uint8Array(px), format: 'rgba', width: 10, height: 10 };
    })();

    it('ranks swatches heaviest first, as objects, and a dominant colour', async () => {
        const clustering = await buildClustering(split);
        const swatches = await clustering.getSwatches(3);
        expect(Array.from(swatches.weights)).toEqual([30, 40, 30]);              // split order: not heaviest first
        const ranked = rankSwatches(swatches);
        expect(ranked).toEqual([
            { color: [255, 0, 0], hex: '#ff0000', share: 0.4 },
            // Equal shares keep split order.
            { color: toColors(swatches.palette)[0], hex: toHex(...swatches.palette.subarray(0, 3)), share: 0.3 },
            { color: toColors(swatches.palette)[2], hex: toHex(...swatches.palette.subarray(6, 9)), share: 0.3 },
        ]);
        expect(rankSwatches(await buildSwatches(split, 5))[0].hex).toBe('#ff0000');
        expect(rankSwatches(await buildSwatches({ data: new Uint8Array(0), format: 'rgba' }, 5))).toEqual([]);
    });

    it('a ranked palette keeps its colour space', async () => {
        const clustering = await buildClustering(image, { colorSpace: 'oklab' });
        const swatches = await clustering.getSwatches(3);
        const ranked = rankPalette(swatches);
        expect(ranked).toBeInstanceOf(Palette);
        expect(ranked.colorSpace).toBe('oklab');
        expect(toColors(ranked)).toEqual(rankSwatches(swatches).map((s) => s.color));
    });

    it('heaviest first for an indexed image: by cluster weight, by mapping to the ranked palette', async () => {
        for (const [source, k, options] of [[split, 3, {}], [image, 11, { transparent: true }], [image, 11, { transparent: true, dither: true }]]) {
            const clustering = await buildClustering(source, { transparent: true });
            const result = await quantizeToIndicesWithPalette(source, rankPalette(await clustering.getSwatches(k)), options);
            const plain = await clustering.quantizeToIndices(source, options.transparent ? k + 1 : k, options);
            // The same picture as the unranked call: every pixel has the same colour (or is transparent in both).
            expect(result.transparentIndex === null).toBe(plain.transparentIndex === null);
            for (let p = 0; p < result.indices.length; p++) {
                const a = result.indices[p], b = plain.indices[p];
                expect(a === result.transparentIndex).toBe(b === plain.transparentIndex);
                if (a !== result.transparentIndex) {expect(toColors(result.palette)[a]).toEqual(toColors(plain.palette)[b]);}
            }
            // The transparent entry comes after the palette: k colours and one more.
            if (result.transparentIndex !== null) {expect(result.transparentIndex).toBe(result.colors.length / 3);}
            expect(result.colors.length / 3).toBeLessThanOrEqual(k);
        }
        // On the split image, red (the heaviest) is now entry 0.
        const clustering = await buildClustering(split);
        const { palette } = await quantizeToIndicesWithPalette(split, rankPalette(await clustering.getSwatches(3)));
        expect(Array.from(palette.subarray(0, 3))).toEqual([255, 0, 0]);
    });

    it('heaviest first for an indexed image: by pixels mapped, with its transparent entry', async () => {
        for (const [source, options] of [[split, {}], [image, { transparent: true }], [image, { transparent: true, colorSpace: 'oklab', dither: true }]]) {
            const result = await quantizeToIndices(source, source === split ? 3 : 12, options);
            const ranked = rankIndices(result);
            const { palette, colors, indices, transparentIndex } = ranked;
            const before = toColors(result.palette), after = toColors(palette);

            // Same picture: every pixel still has the same colour.
            for (let p = 0; p < indices.length; p++) {expect(after[indices[p]]).toEqual(before[result.indices[p]]);}
            // Heaviest first: usage never increases along the colour entries.
            const n = colors.length / 3;
            const use = new Uint32Array(after.length);
            for (const index of indices) {use[index]++;}
            for (let i = 1; i < n; i++) {expect(use[i]).toBeLessThanOrEqual(use[i - 1]);}
            // The transparent entry stays where it was, last, and `colors` is still the palette without it.
            expect(transparentIndex).toBe(result.transparentIndex);
            if (transparentIndex !== null) {expect(transparentIndex).toBe(n);}
            expect(Array.from(colors)).toEqual(Array.from(palette.subarray(0, 3 * n)));
            expect(palette.colorSpace).toBe(result.palette.colorSpace);
            expect(colors.colorSpace).toBe(result.palette.colorSpace);
            expect(indices.constructor).toBe(result.indices.constructor);
            expect([ranked.indexBits, ranked.width, ranked.height]).toEqual([result.indexBits, result.width, result.height]);
        }
        // The split-order example really does put the heaviest colour second, so the recipe is doing something.
        const indexed = await quantizeToIndices(split, 3);
        const counts = [0, 0, 0]; for (const index of indexed.indices) {counts[index]++;}
        expect(counts[0]).toBeLessThan(Math.max(...counts));
        expect(Array.from(rankIndices(indexed).palette.subarray(0, 3))).toEqual([255, 0, 0]);
    });

    it('a GIF with a transparent background', async () => {
        const { palette, indices, transparentIndex } = await quantizeToIndices(image, 256, { transparent: true });
        const colors = toColors(palette);
        const gif = GIFEncoder();
        gif.writeFrame(indices, image.width, image.height, { palette: colors, transparent: transparentIndex !== null, transparentIndex: transparentIndex ?? 0 });
        gif.finish();
        const reader = new GifReader(Buffer.from(gif.bytes()));
        const decoded = new Uint8Array(width * height * 4);
        reader.decodeAndBlitFrameRGBA(0, decoded);
        const at = (x, y) => Array.from(decoded.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
        expect(at(2, 2)[3]).toBe(0);                               // background: transparent
        expect(at(30, 30)).toEqual([220, 50, 40, 255]);            // disc centre: opaque, its colour
        for (let i = 3; i < decoded.length; i += 4) {expect([0, 255]).toContain(decoded[i]);}
    });

    // Decoded pixel by pixel: 3.0.0-beta.1's recipe passed a check that the PNG had a tRNS chunk, but fast-png writes only
    // the alphas below 255 and PNG applies them from entry 0, so its transparency landed on the wrong entry.
    it('a palette PNG whose transparent pixels decode as transparent, and the rest as their colours', async () => {
        const { palette, indices, transparentIndex } = await quantizeToIndices(image, 256, { transparent: true });
        const colors = toColors(palette);
        expect(indices).toBeInstanceOf(Uint8Array);
        expect(transparentIndex).toBeGreaterThan(0);   // the case the old recipe got wrong
        const t = transparentIndex ?? 0;
        const swap = (i) => (i === t ? 0 : i === 0 ? t : i);
        const png = encodePng({
            width: image.width, height: image.height, depth: 8, channels: 1,
            data: indices.map(swap),
            palette: colors.map((_, i) => [...colors[swap(i)], i === 0 && transparentIndex !== null ? 0 : 255]),
        });
        const back = decodePng(png);
        expect(back.channels).toBe(1);
        for (let p = 0; p < indices.length; p++) {
            const [r, g, b, a] = back.palette[back.data[p]];
            if (indices[p] === transparentIndex) {
                expect(a, `pixel ${p}`).toBe(0);
            } else {
                expect([r, g, b, a ?? 255], `pixel ${p}`).toEqual([...colors[indices[p]], 255]);
            }
        }
        // And the source's transparent background stays transparent, its opaque disc centre opaque.
        expect(back.palette[back.data[2 * width + 2]][3]).toBe(0);
        expect(back.palette[back.data[30 * width + 30]][3] ?? 255).toBe(255);
    });


    it('an animated GIF with one palette for every frame, from a sample of the frames', async () => {
        const [w, h] = [64, 48];
        const frames = Array.from({ length: 12 }, (_, f) => {
            const data = new Uint8Array(w * h * 4);
            for (let p = 0; p < w * h; p++) {
                const x = p % w, y = Math.floor(p / w);
                data.set([(x * 4 + f * 9) & 255, (y * 5) & 255, (x * y + f * 20) & 255, f === 3 && x < 8 ? 0 : 255], p * 4);
            }
            return { data, format: 'rgba', width: w, height: h };
        });
        const sample = frames.filter((_, i) => i % 5 === 0);
        const pixels = new Uint8Array(sample.reduce((n, frame) => n + frame.data.length, 0));
        let offset = 0;
        for (const frame of sample) {pixels.set(frame.data, offset); offset += frame.data.length;}
        const clustering = await buildClustering({ data: pixels, format: 'rgba' }, { precision: 6, transparent: true });
        const gif = GIFEncoder();
        for (const frame of frames) {
            const { palette, indices, transparentIndex } = await clustering.quantizeToIndices(frame, 256, { dither: 0.5 });
            expect(palette.length / 3).toBeLessThanOrEqual(256);
            expect(indices).toBeInstanceOf(Uint8Array);
            gif.writeFrame(indices, w, h, { palette: toColors(palette), transparent: transparentIndex !== null, transparentIndex: transparentIndex ?? 0 });
        }
        gif.finish();
        const reader = new GifReader(Buffer.from(gif.bytes()));
        expect(reader.numFrames()).toBe(12);
        const decoded = new Uint8Array(w * h * 4);
        reader.decodeAndBlitFrameRGBA(3, decoded);
        expect(decoded[3]).toBe(0);                              // frame 3's transparent strip
        expect(decoded[(20 * w + 20) * 4 + 3]).toBe(255);
    });

    // "Fixed palettes": choosing N colours from a fixed set is clustering.chooseFrom (tested against the 3.7.2 recipe in
    // test/choose-from.test.js, which covers the choice itself: exact k, scoring spaces, fewer colours than k, empty
    // images, errors). Here: the guides' countThreads, as written there, and chooseFrom with the legend.

    // Pixels per chosen thread, most used first, leaving out threads no pixel was mapped to (it happens, more often with
    // 'oklab'). `options` are quantizeToIndicesWithPalette's: dither as you will stitch, and pass `transparent: true` for
    // an image with transparent areas, or they are counted to the nearest thread.
    async function countThreads(image, threads, choice, options) {
      const { indices, transparentIndex } = await quantizeToIndicesWithPalette(image, choice.palette, options);
      const counts = new Array(choice.indices.length).fill(0);
      for (const s of indices) {if (s !== transparentIndex) {counts[s]++;}}
      return choice.indices.map((j, s) => ({ thread: j, count: counts[s] })).filter((e) => e.count > 0).sort((x, y) => y.count - x.count);
    }

    it('countThreads is the one in the guides', async () => {
        const { readFile } = await import('fs/promises');
        const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
        // A function's lines, trimmed: from its declaration to the closing brace at the declaration's indentation.
        const source = (text, name) => {
            const lines = text.split('\n');
            const start = lines.findIndex((line) => new RegExp(`^\\s*(async )?function ${name}\\(`).test(line));
            expect(start, `${name} is in the file`).toBeGreaterThanOrEqual(0);
            const indent = lines[start].match(/^ */)[0];
            const end = lines.findIndex((line, i) => i > start && line === `${indent}}`);
            expect(end, `${name} has a closing brace at its indentation`).toBeGreaterThan(start);
            return lines.slice(start, end + 1).map((line) => line.trim()).join('\n');
        };
        const [guides, test] = await Promise.all([read('../docs/guides.md'), read('./recipes.test.js')]);
        expect(source(test, 'countThreads')).toBe(source(guides, 'countThreads'));
    });

    it('chooseFrom picks n threads that beat the n most used threads', async () => {
        // A smooth photo-like image, and 120 pseudo-random threads.
        const w = 64, h = 48, photo = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) {photo.set([(i % w) * 4, Math.floor(i / w) * 5, ((i % w) * 3 + Math.floor(i / w) * 2) & 255, 255], i * 4);}
        let seed = 11;
        const threads = new Uint8Array(120 * 3).map(() => (seed = (seed * 16807) % 2147483647) % 256);
        const pick = (chosen) => new Uint8Array(chosen.flatMap((i) => [threads[3 * i], threads[3 * i + 1], threads[3 * i + 2]]));
        const error = async (palette) => {
            const mapped = (await quantizeWithPalette(photo, palette));
            let sum = 0;
            for (let i = 0; i < photo.length; i++) {if (i % 4 !== 3) {sum += (photo[i] - mapped[i]) ** 2;}}
            return sum;
        };
        const { indices } = await quantizeToIndicesWithPalette(photo, threads);
        const used = new Uint32Array(120);
        for (const index of indices) {used[index]++;}
        const clustering = await buildClustering({ data: photo, format: 'rgba', width: w });
        for (const n of [4, 8, 12]) {
            const choice = await clustering.chooseFrom(threads, n);
            expect(choice.indices).toHaveLength(n);
            expect(new Set(choice.indices).size).toBe(n);
            const top = Array.from(used.keys()).sort((a, b) => used[b] - used[a]).slice(0, n);
            expect(await error(pick(choice.indices))).toBeLessThan(await error(pick(top)));
            expect(Array.from(choice.palette)).toEqual(Array.from(pick(choice.indices)));
        }
    });

    it('countThreads counts pixels per thread, most used first, without unused threads or transparent pixels', async () => {
        // 10, 30 and 50 pixels of three colours, then 10 transparent ones, and a chart holding near matches among distractors.
        const data = new Uint8Array(100 * 4);
        for (let p = 0; p < 100; p++) {data.set(p < 10 ? [200, 40, 40, 255] : p < 40 ? [40, 160, 60, 255] : p < 90 ? [30, 40, 150, 255] : [0, 0, 0, 0], 4 * p);}
        const threads = new Uint8Array([0, 0, 0, 255, 255, 255, 202, 42, 38, 128, 128, 128, 28, 42, 152, 38, 158, 62, 250, 250, 0]);
        const image = { data, format: 'rgba', width: 10 };
        const clustering = await buildClustering(image);
        for (const options of [undefined, { colorSpace: 'oklab' }]) {
            const choice = await clustering.chooseFrom(threads, 3, options);
            expect(choice.indices).toEqual([2, 4, 5]);
            expect(await countThreads(image, threads, choice, { transparent: true })).toEqual([{ thread: 4, count: 50 }, { thread: 5, count: 30 }, { thread: 2, count: 10 }]);
        }
        // Without `transparent`, the transparent pixels (stored black) go to their nearest thread; and a thread no pixel
        // is nearest to (white, here) is left out.
        const wide = await clustering.chooseFrom(threads, 5);
        expect(wide.indices).toEqual([0, 1, 2, 4, 5]);
        expect(await countThreads(image, threads, wide)).toEqual([{ thread: 4, count: 50 }, { thread: 5, count: 30 }, { thread: 0, count: 10 }, { thread: 2, count: 10 }]);   // ties keep the ascending order
    });

    it('the guides\' chooseFrom call gives the same choice through a loaded worker handle', async () => {
        const worker = await import('../dist/worker.mjs');
        const data = new Uint8Array(40 * 30 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 251));
        const threads = new Uint8Array(3 * 60).map((_, i) => (i * 97) % 256);
        const clustering = await buildClustering({ data, format: 'rgba', width: 40 });
        const pool = worker.createWorker();
        const loaded = await pool.load(clustering);
        try {
            const here = await clustering.chooseFrom(threads, 6);
            const there = await loaded.chooseFrom(threads, 6);
            expect(there.indices).toEqual(here.indices);
            expect(Array.from(there.palette)).toEqual(Array.from(here.palette));
            expect(Array.from((await loaded.chooseFrom(threads, 6, { colorSpace: 'oklab' })).indices)).toEqual((await clustering.chooseFrom(threads, 6, { colorSpace: 'oklab' })).indices);
        } finally {await loaded.release(); await pool.terminate();}
    });

    // "Live video and camera frames": following the previous palette (the guides' function, as written there).
    it('follows the previous palette, moving a quarter of the way to the matched colours', async () => {
        const follow = (previous, next, weight = 0.25) => {
            if (!previous || previous.length !== next.length) {return Array.from(next);}
            const free = new Set(Array.from({ length: next.length / 3 }, (_, i) => i));
            const smoothed = [];
            for (let i = 0; i < previous.length; i += 3) {
                let best = 0, bestDistance = Infinity;
                for (const j of free) {
                    const d = (previous[i] - next[3 * j]) ** 2 + (previous[i + 1] - next[3 * j + 1]) ** 2 + (previous[i + 2] - next[3 * j + 2]) ** 2;
                    if (d < bestDistance) {bestDistance = d; best = j;}
                }
                free.delete(best);
                for (let c = 0; c < 3; c++) {smoothed.push(previous[i + c] + weight * (next[3 * best + c] - previous[i + c]));}
            }
            return smoothed;
        };
        const first = await buildPalette(image, 3);
        expect(follow(null, first)).toEqual(Array.from(first));
        // The same colours in another order: each keeps its slot, and doesn't move.
        const swapped = new Uint8Array([...first.slice(3, 6), ...first.slice(0, 3), ...first.slice(6, 9)]);
        expect(follow(Array.from(first), swapped)).toEqual(Array.from(first));
        // A colour that moved: a quarter of the way.
        const moved = Uint8Array.from(first);
        moved[0] = first[0] >= 128 ? first[0] - 40 : first[0] + 40;
        expect(follow(Array.from(first), moved)[0]).toBeCloseTo(first[0] + 0.25 * (moved[0] - first[0]));
        // A different number of colours starts again.
        expect(follow(Array.from(first), first.slice(0, 6))).toEqual(Array.from(first.slice(0, 6)));
    });

    // "Animated GIFs": mapping frames in batches with ordered dithering. The function is the guides' own, checked against
    // their text; the promise it rests on is that a pixel's ordered colour depends only on its colour and its position in
    // the 8×8 pattern, anchored at the image's top-left pixel.
    // Maps `frames` (all the same size, { data, format: 'rgba', width, height }) with `palette`, `batch` frames per call.
    // Returns { palette, indices, transparentIndex } for each frame. A batch's indices share one buffer: .slice() one
// before transferring it.
    async function mapFramesInBatches(frames, palette, batch = 12) {
        const { width, height } = frames[0];
        const rows = Math.ceil(height / 8) * 8;   // each frame starts on the 8×8 pattern's grid
        const rowBytes = width * 4;
        const results = [];
        for (let start = 0; start < frames.length; start += batch) {
            const group = frames.slice(start, start + batch);
            const data = new Uint8Array(group.length * rows * rowBytes);
            group.forEach((frame, i) => {
                data.set(frame.data, i * rows * rowBytes);
                // Pad by repeating the last row: it adds no colours or transparency the frame didn't have.
                const last = frame.data.subarray((height - 1) * rowBytes, height * rowBytes);
                for (let y = height; y < rows; y++) {data.set(last, (i * rows + y) * rowBytes);}
            });
            const { palette: entries, indices, transparentIndex } = await quantizeToIndicesWithPalette(
                { data, format: 'rgba', width, height: group.length * rows }, palette, { transparent: true, dither: 'ordered' });
            group.forEach((_, i) => {
                results.push({ palette: entries, indices: indices.subarray(i * rows * width, (i * rows + height) * width), transparentIndex });
            });
        }
        return results;
    }

    describe('mapping frames in batches', () => {
        // Frames of a moving scene, 13 rows high (not a multiple of 8): a gradient that shifts, with a disc moving
        // across it. In `holes`, some frames have fully transparent pixels.
        const fw = 40, fh = 13;
        const makeFrames = (count, holes = []) => Array.from({ length: count }, (_, f) => {
            const frame = new Uint8Array(fw * fh * 4);
            for (let y = 0; y < fh; y++) {
                for (let x = 0; x < fw; x++) {
                    const inDisc = Math.hypot(x - 3 * f, y - 6) < 5;
                    const alpha = holes.includes(f) && x < 4 ? 0 : 255;
                    frame.set(inDisc ? [230, 60 + 9 * f, 40, alpha] : [(x * 6 + f * 4) & 255, y * 17, 200 - x * 3, alpha], (y * fw + x) * 4);
                }
            }
            return { data: frame, format: 'rgba', width: fw, height: fh };
        });
        const one = (frame, palette) => quantizeToIndicesWithPalette(frame, palette, { transparent: true, dither: 'ordered' });

        it('is the function printed in the guides', async () => {
            const { readFile } = await import('fs/promises');
            const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
            const source = (text) => {
                const lines = text.split('\n');
                const start = lines.findIndex((line) => line.trim().startsWith('async function mapFramesInBatches('));
                expect(start).toBeGreaterThanOrEqual(0);
                const indent = lines[start].match(/^ */)[0];
                const end = lines.findIndex((line, i) => i > start && line === `${indent}}`);
                return lines.slice(start, end + 1).map((line) => line.trim()).join('\n');
            };
            const [guides, test] = await Promise.all([read('../docs/guides.md'), read('./recipes.test.js')]);
            expect(source(test)).toBe(source(guides));
        });

        it('gives every frame the indices one call per frame gives, at any batch size', async () => {
            const frames = makeFrames(10);
            for (const palette of [await buildPalette(makeFrames(1)[0], 12), new Uint8Array([0, 0, 0, 255, 255, 255])]) {
                const expected = await Promise.all(frames.map((frame) => one(frame, palette)));
                for (const batch of [1, 3, 4, 12]) {
                    const got = await mapFramesInBatches(frames, palette, batch);
                    expect(got).toHaveLength(frames.length);
                    got.forEach((result, f) => {
                        expect(Array.from(result.indices), `batch ${batch}, frame ${f}`).toEqual(Array.from(expected[f].indices));
                        expect(Array.from(result.palette)).toEqual(Array.from(expected[f].palette));
                        expect(result.transparentIndex).toBe(null);
                    });
                }
            }
        });

        it('gives the transparent entry to every frame of a batch that has transparent pixels, with the same indices', async () => {
            const frames = makeFrames(6, [1, 4]);
            const palette = await buildPalette(makeFrames(1)[0], 8);
            const expected = await Promise.all(frames.map((frame) => one(frame, palette)));
            expect(expected[0].transparentIndex).toBe(null);
            expect(expected[1].transparentIndex).toBe(palette.length / 3);
            const got = await mapFramesInBatches(frames, palette, 3);
            got.forEach((result, f) => {
                expect(Array.from(result.indices), `frame ${f}`).toEqual(Array.from(expected[f].indices));
                expect(result.transparentIndex).toBe(palette.length / 3);   // each batch of three has a frame with holes
                expect(result.palette.length).toBe(palette.length + 3);
            });
        });

        it('rests on a promise that holds for every ordered setting (api.md, stability.md)', async () => {
            // A pixel's result depends only on its colour, its alpha against the cutoff and its position modulo 8, so
            // frames stacked on the 8-row grid give each frame's own indices, whatever the options.
            const frames = makeFrames(5).map((frame, f) => {
                const data = Uint8Array.from(frame.data);
                for (let p = 0; p < data.length / 4; p++) {if ((p + f) % 7 === 0) {data[4 * p + 3] = p % 2 ? 100 : 200;}}
                return { ...frame, data };
            });
            const palette = await buildPalette(makeFrames(1)[0], 12);
            const rows = 16;
            const data = new Uint8Array(frames.length * rows * fw * 4);
            frames.forEach((frame, i) => {
                data.set(frame.data, i * rows * fw * 4);
                for (let y = fh; y < rows; y++) {data.copyWithin((i * rows + y) * fw * 4, (i * rows + fh - 1) * fw * 4, (i * rows + fh) * fw * 4);}
            });
            const stacked = { data, format: 'rgba', width: fw, height: frames.length * rows };
            const settings = [
                { dither: 'ordered', colorSpace: 'oklab' },
                { dither: { method: 'ordered', steps: 2 } },
                { dither: { method: 'ordered', steps: 32 } },
                { dither: { method: 'ordered', strength: 0.25 } },
                { dither: 'ordered', transparent: 128 },
            ];
            for (const options of settings) {
                const { indices } = await quantizeToIndicesWithPalette(stacked, palette, options);
                for (let f = 0; f < frames.length; f++) {
                    const own = (await quantizeToIndicesWithPalette(frames[f], palette, options)).indices;
                    expect(Array.from(indices.subarray(f * rows * fw, (f * rows + fh) * fw)), `${JSON.stringify(options)}, frame ${f}`).toEqual(Array.from(own));
                }
            }
        });

        it('without the padding, later frames would get a shifted pattern', async () => {
            // The reason for the padding, kept honest: stacking 13-row frames directly changes some frame's indices.
            const frames = makeFrames(4);
            const palette = await buildPalette(makeFrames(1)[0], 12);
            const expected = await Promise.all(frames.map((frame) => one(frame, palette)));
            const data = new Uint8Array(frames.length * fw * fh * 4);
            frames.forEach((frame, i) => data.set(frame.data, i * fw * fh * 4));
            const { indices } = await quantizeToIndicesWithPalette({ data, format: 'rgba', width: fw, height: frames.length * fh }, palette, { transparent: true, dither: 'ordered' });
            const differs = frames.some((_, f) => Array.from(indices.subarray(f * fw * fh, (f + 1) * fw * fh)).some((v, j) => v !== expected[f].indices[j]));
            expect(differs).toBe(true);
        });
    });

    // "Dithering to a few inks: mix in light" (docs/api.md). The function is the docs' own, checked against their text.
    // Dithers an RGBA image ({ data, width }, or ImageData) to `inks` (flat RGB values, like `eink` above), mixing colours
    // as light. Resolves like quantizeToIndicesWithPalette(image, inks, options): indices[i] is the entry of `inks` for
    // pixel i. It dithers with Floyd–Steinberg unless `options.dither` says otherwise.
    async function ditherInLight(image, inks, options = {}) {
        if (image.format !== undefined && image.format !== 'rgba') {throw new TypeError(`Invalid image: ditherInLight takes RGBA data, got format '${image.format}'.`);}
        if (options.colorSpace !== undefined && options.colorSpace !== 'rgb') {throw new TypeError('Invalid options.colorSpace: ditherInLight matches in linear light; leave colorSpace out.');}
        // sRGB 0-255 to linear light, 0-1
        const linear = Array.from({ length: 256 }, (_, v) => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        // Writes a colour (from `source` at `i`) as three bytes: red-green difference, brightness, blue-yellow difference
        // (BT.709 weights, on linear values). A Uint8ClampedArray `target` rounds and clamps them.
        const inLight = (source, target, i) => {
            const r = linear[source[i]], g = linear[source[i + 1]], b = linear[source[i + 2]];
            const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            target[i] = 128 + 255 * (r - y) / 1.5748;
            target[i + 1] = 127.5 * y;
            target[i + 2] = 128 + 255 * (b - y) / 1.8556;
        };
        const data = new Uint8ClampedArray(image.data.length);
        for (let i = 0; i < data.length; i += 4) {
            inLight(image.data, data, i);
            data[i + 3] = image.data[i + 3];   // alpha stays as it is
        }
        const palette = new Uint8ClampedArray(inks.length);
        for (let i = 0; i < inks.length; i += 3) {inLight(inks, palette, i);}
        const result = await quantizeToIndicesWithPalette({ data, format: 'rgba', width: image.width }, new Uint8Array(palette), { dither: true, ...options });
        result.palette.set(inks);   // the inks' own colours; with `transparent`, its entry stays after them
        return result;
    }

    describe('mixing in light', () => {
        const eink = [0, 0, 0, 255, 255, 255, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 255, 128, 0];
        const linear = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        // Mean brightness in light (relative luminance) of an RGBA image, or of indices into a palette.
        const brightness = (colours) => colours.reduce((sum, [r, g, b]) => sum + 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b), 0) / colours.length;
        const pixels = (rgba) => Array.from({ length: rgba.length / 4 }, (_, i) => [rgba[4 * i], rgba[4 * i + 1], rgba[4 * i + 2]]);
        const inks = (indices, palette) => Array.from(indices, (j) => [palette[3 * j], palette[3 * j + 1], palette[3 * j + 2]]);
        // A smooth photo-like image: a grey ramp across, a hue wash down.
        const w = 96, h = 64, photo = new Uint8Array(w * h * 4);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const v = (x / (w - 1)) * 255, t = y / (h - 1);
                photo.set([v * (1 - 0.4 * t), v, v * (1 - 0.4 * (1 - t)), 255].map(Math.round), 4 * (y * w + x));
            }
        }

        it('is the function in the API reference', async () => {
            const { readFile } = await import('fs/promises');
            const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
            const source = (text) => {
                const lines = text.split('\n');
                const start = lines.findIndex((line) => line.trim().startsWith('async function ditherInLight('));
                expect(start, 'the function is in the file').toBeGreaterThanOrEqual(0);
                const indent = lines[start].match(/^ */)[0];
                const end = lines.findIndex((line, i) => i > start && line === `${indent}}`);
                return lines.slice(start, end + 1).map((line) => line.trim()).join('\n');
            };
            const [api, test] = await Promise.all([read('../docs/api.md'), read('./recipes.test.js')]);
            expect(source(test)).toBe(source(api));
        });

        it('keeps the brightness that dithering sRGB values loses, with error diffusion and ordered', async () => {
            const original = brightness(pixels(photo));
            for (const dither of [true, 'ordered']) {
                const srgb = await quantizeToIndicesWithPalette({ data: photo, format: 'rgba', width: w }, eink, { dither });
                const light = await ditherInLight({ data: photo, width: w }, eink, { dither });
                expect(brightness(inks(srgb.indices, eink)) / original, `${dither}: sRGB values come out too light`).toBeGreaterThan(1.3);
                expect(brightness(inks(light.indices, eink)) / original, `${dither}: in light`).toBeCloseTo(1, 1);
            }
            // Black and white too.
            const bw = [0, 0, 0, 255, 255, 255];
            const light = await ditherInLight({ data: photo, width: w }, bw);
            expect(brightness(inks(light.indices, bw)) / original).toBeCloseTo(1, 1);
        });

        it('takes ImageData, keeps the image\'s alpha, passes options on, and gives back the inks as the palette', async () => {
            const withHole = Uint8ClampedArray.from(photo);
            for (let i = 3; i < 4 * w * 4; i += 4) {withHole[i] = 0;}   // the first four rows are fully transparent
            const result = await ditherInLight(new ImageData(withHole, w, h), eink, { transparent: true });
            expect(result.transparentIndex).toBe(7);
            expect(Array.from(result.palette.slice(0, 21))).toEqual(eink);
            expect(result.palette.length).toBe(8 * 3);
            expect(Array.from(result.indices.slice(0, 4 * w)).every((j) => j === 7)).toBe(true);
            expect(Array.from(result.indices.slice(4 * w)).every((j) => j < 7)).toBe(true);
            // Options without `dither` still dither: the same indices as asking for it.
            const asked = await ditherInLight(new ImageData(withHole, w, h), eink, { transparent: true, dither: true });
            expect(Array.from(result.indices)).toEqual(Array.from(asked.indices));
            const plain = await ditherInLight(new ImageData(withHole, w, h), eink, { transparent: true, dither: false });
            expect(Array.from(result.indices)).not.toEqual(Array.from(plain.indices));
        });

        it('rejects RGB data and another colour space rather than misreading them', async () => {
            await expect(ditherInLight({ data: photo.slice(0, 3 * w), format: 'rgb', width: w }, eink)).rejects.toThrow(/takes RGBA data, got format 'rgb'/);
            await expect(ditherInLight({ data: photo, width: w }, eink, { colorSpace: 'oklab' })).rejects.toThrow(/leave colorSpace out/);
            await expect(ditherInLight({ data: photo, format: 'rgba', width: w }, eink, { colorSpace: 'rgb' })).resolves.toBeTruthy();
        });
    });

    describe('choosing a palette size', () => {
        // The smallest palette whose error is at most `rms` (root mean squared, per channel), up to `most` colours.
        async function sizeForError(clustering, rms, most = 256) {
          const { mse } = await clustering.getClusteringInfo();
          const k = mse.findIndex((m) => Math.sqrt(m) <= rms) + 1;   // 0 when no size gets that low
          return Math.max(1, Math.min(k || mse.length, most));
        }

        // The smallest palette whose mapped image scores at most `target`, up to `most` colours. `score(original, mapped)`
        // compares two RGBA byte arrays, lower is better (a mean ΔE2000 from a colour library, say). `image` is ImageData or
        // { data, format: 'rgba', width }.
        async function sizeForScore(clustering, image, score, target, most = 256) {
          let low = 1, high = Math.min(most, (await clustering.getClusteringInfo()).maxColors);
          while (low < high) {
            const k = (low + high) >> 1;
            const mapped = await clustering.quantize(image, k);
            if (score(image.data, mapped.data) <= target) {high = k;} else {low = k + 1;}
          }
          return low;   // the cap when no smaller size scores well enough
        }

        // A soft two-colour gradient with a disc: a few hundred colours.
        const w = 64, h = 48, pixels = new Uint8Array(w * h * 4);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const disc = Math.hypot(x - 40, y - 20) < 12;
                pixels.set(disc ? [230, 60, 40, 255] : [Math.round(x * 4), Math.round(80 + y * 3), 160, 255], 4 * (y * w + x));
            }
        }
        const gradient = { data: pixels, format: 'rgba', width: w };
        // Mean squared error per channel between two RGBA arrays: a score that needs no library.
        const rgbError = (a, b) => {let s = 0; for (let i = 0; i < a.length; i++) {if ((i & 3) !== 3) {s += (a[i] - b[i]) ** 2;}} return s / (a.length * 0.75);};

        it('sizeForError gives the smallest size under the error, capped, and never 0', async () => {
            const clustering = await buildClustering(gradient);
            const { mse, maxColors } = await clustering.getClusteringInfo();
            for (const rms of [20, 8, 5, 2]) {
                const k = await sizeForError(clustering, rms, 10_000);
                expect(Math.sqrt(mse[k - 1])).toBeLessThanOrEqual(rms);
                if (k > 1) {expect(Math.sqrt(mse[k - 2])).toBeGreaterThan(rms);}
            }
            expect(maxColors).toBeGreaterThan(40);
            expect(await sizeForError(clustering, 0, 40)).toBe(40);
            // Below precision 8 the error never reaches 0: a setting too low gives the largest size, not 0.
            const grouped = await buildClustering(gradient, { precision: 4 });
            const info = await grouped.getClusteringInfo();
            expect(info.mse[info.maxColors - 1]).toBeGreaterThan(0);
            expect(await sizeForError(grouped, 0, 10_000)).toBe(info.maxColors);
        });

        it('sizeForScore finds the smallest size a linear scan finds, and the cap when none is good enough', async () => {
            const clustering = await buildClustering(gradient);
            const scores = [];
            for (let k = 1; k <= 64; k++) {scores.push(rgbError(pixels, (await clustering.quantize(gradient, k)).data));}
            for (const target of [scores[2], scores[9], scores[30], (scores[20] + scores[21]) / 2]) {
                const k = await sizeForScore(clustering, gradient, rgbError, target, 64);
                expect(k).toBe(scores.findIndex((s) => s <= target) + 1);
            }
            expect(await sizeForScore(clustering, gradient, rgbError, -1, 64)).toBe(64);
        });

        it('matches the guides', async () => {
            const { readFile } = await import('node:fs/promises');
            const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
            const source = (text, start) => {
                const lines = text.split('\n');
                const first = lines.findIndex((line) => line.trim().startsWith(start));
                expect(first, `${start} is in the file`).toBeGreaterThanOrEqual(0);
                const indent = lines[first].match(/^ */)[0];
                const end = lines.findIndex((line, i) => i > first && line === `${indent}}`);
                let top = first;
                while (lines[top - 1].trim().startsWith('//')) {top--;}   // with the comment above it
                return lines.slice(top, end + 1).map((line) => line.trim()).join('\n');
            };
            const [guides, test] = await Promise.all([read('../docs/guides.md'), read('./recipes.test.js')]);
            for (const start of ['async function sizeForError(', 'async function sizeForScore(']) {
                expect(source(test, start)).toBe(source(guides, start));
            }
        });
    });

});

// The guides' "Decoding image files": the Node (sharp) and edge (jsquash + omggif) recipes, run on files of every
// layout a decoder can return, and checked against the guides' text. The browser recipe is measured in
// bench/spikes/decoding/ instead: reading a canvas back throws in CI's Safari (see test/browser/app/main.js).
describe('decoding image files (guides)', () => {
    const w = 48, h = 32;
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {rgba.set([x * 5, y * 7, 255 - x * 3, x < 8 ? x * 32 : 255], (y * w + x) * 4);}
    }
    const opaque = rgba.map((v, i) => (i % 4 === 3 ? 255 : v));
    const raw = () => ({ raw: { width: w, height: h, channels: 4 } });

    // The guides' functions, as they appear there (the names are the same in each environment, so each is in a block).
    let decodeWithSharp, decodeOnTheEdge;
    const sharpReady = (async () => {
        const { default: sharp } = await import('sharp');
        {
            async function decodeImage(input) {
                const { data, info } = await sharp(input)        // a path, a Buffer or a Uint8Array
                    .rotate()                                     // apply the EXIF orientation
                    .ensureAlpha()                                // always 4 channels; sharp already gives 8-bit sRGB
                    .raw()
                    .toBuffer({ resolveWithObject: true });
                return { data, format: 'rgba', width: info.width, height: info.height };
            }
            decodeWithSharp = decodeImage;
        }
        return sharp;
    })();
    const edgeReady = (async () => {
        const { readFile } = await import('fs/promises');
        const { createRequire } = await import('module');
        const require = createRequire(import.meta.url);
        const compile = async (path) => WebAssembly.compile(await readFile(require.resolve(path)));
        const { default: decodePng, init: initPng } = await import('@jsquash/png/decode.js');
        const { default: decodeJpeg, init: initJpeg } = await import('@jsquash/jpeg/decode.js');
        const { default: decodeWebp, init: initWebp } = await import('@jsquash/webp/decode.js');
        // In Node the .wasm files are compiled from their bytes; Wrangler imports them as modules (the guides' imports).
        const ready = Promise.all([initPng(await compile('@jsquash/png/codec/pkg/squoosh_png_bg.wasm')),
            initJpeg(await compile('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm')), initWebp(await compile('@jsquash/webp/codec/dec/webp_dec.wasm'))]);
        {
            async function decodeImage(bytes) {
                await ready;
                const ascii = (start, text) => String.fromCharCode(...bytes.subarray(start, start + text.length)) === text;
                let image;
                if (ascii(1, 'PNG')) {image = await decodePng(bytes.slice().buffer);}
                else if (bytes[0] === 0xFF && bytes[1] === 0xD8) {image = await decodeJpeg(bytes.slice().buffer, { preserveOrientation: true });}
                else if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) {image = await decodeWebp(bytes.slice().buffer);}
                else if (ascii(0, 'GIF')) {
                    const gif = new GifReader(bytes);
                    const data = new Uint8Array(gif.width * gif.height * 4);
                    gif.decodeAndBlitFrameRGBA(0, data);
                    return { data, format: 'rgba', width: gif.width, height: gif.height };
                } else {throw new Error('Unsupported image format: send PNG, JPEG, WebP or GIF');}
                return { data: new Uint8Array(image.data.buffer), format: 'rgba', width: image.width, height: image.height };
            }
            decodeOnTheEdge = decodeImage;
        }
    })();

    it('the decoding functions are the ones in the guides', async () => {
        await Promise.all([sharpReady, edgeReady]);
        const { readFile } = await import('fs/promises');
        const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
        const [guides, test] = await Promise.all([read('../docs/guides.md'), read('./recipes.test.js')]);
        // Every decodeImage in a text, each from its declaration to the closing brace at its indentation, lines trimmed.
        const functions = (text) => {
            const lines = text.split('\n'), found = [];
            lines.forEach((line, start) => {
                if (!line.trim().startsWith('async function decodeImage(')) {return;}
                const indent = line.match(/^ */)[0];
                const end = lines.findIndex((other, i) => i > start && other === `${indent}}`);
                found.push(lines.slice(start, end + 1).map((l) => l.trim()).join('\n'));
            });
            return found;
        };
        const section = guides.slice(guides.indexOf('## Decoding image files'), guides.indexOf('\n## ', guides.indexOf('## Decoding image files') + 1));
        const [node, , edge] = functions(section);
        expect(functions(section)).toHaveLength(3);         // Node, browser, edge
        expect(functions(test)).toEqual([node, edge]);
        expect(section).toContain("const ready = Promise.all([initPng(pngWasm), initJpeg(jpegWasm), initWebp(webpWasm)]);");
    });

    it('give the same straight 8-bit RGBA for every PNG layout, GIF and lossless WebP, upright for a rotated JPEG', async () => {
        const sharp = await sharpReady;
        await edgeReady;
        const files = {
            rgba: await sharp(rgba, raw()).png().toBuffer(),
            sixteenBit: await sharp(rgba, raw()).toColourspace('rgb16').png().toBuffer(),
            grey: await sharp(opaque, raw()).toColourspace('b-w').png().toBuffer(),
            palette: await sharp(opaque, raw()).png({ palette: true, colours: 16 }).toBuffer(),
            oneBit: await sharp(opaque, raw()).toColourspace('b-w').threshold(128).png({ palette: true, colours: 2 }).toBuffer(),
            gif: await sharp(opaque, raw()).gif().toBuffer(),
            webp: await sharp(rgba, raw()).webp({ lossless: true, exact: true }).toBuffer(),
        };
        for (const [name, file] of Object.entries(files)) {
            const a = await decodeWithSharp(file), b = await decodeOnTheEdge(new Uint8Array(file));
            expect([a.format, a.width, a.height, a.data.length], name).toEqual(['rgba', w, h, w * h * 4]);
            expect([b.format, b.width, b.height], name).toEqual(['rgba', w, h]);
            expect(Buffer.compare(Buffer.from(a.data), Buffer.from(b.data)), name).toBe(0);
            await buildPalette(b, 4);
        }
        expect(Buffer.compare((await decodeWithSharp(files.rgba)).data, Buffer.from(rgba))).toBe(0);
        expect(Buffer.compare((await decodeWithSharp(files.webp)).data, Buffer.from(rgba))).toBe(0);

        // A phone photo: pixels stored turned, with EXIF orientation 6. Both recipes give it upright and close.
        const turned = await sharp(opaque, raw()).rotate(-90).withMetadata({ orientation: 6 }).jpeg({ quality: 95 }).toBuffer();
        const a = await decodeWithSharp(turned), b = await decodeOnTheEdge(new Uint8Array(turned));
        expect([a.width, a.height, b.width, b.height]).toEqual([w, h, w, h]);
        let difference = 0;
        for (let i = 0; i < a.data.length; i++) {difference += Math.abs(a.data[i] - b.data[i]);}
        expect(difference / a.data.length).toBeLessThan(2);

        // Animations (the guides' "Animations give their first frame"): a second frame of solid red is never returned,
        // and an animated WebP fails on the edge.
        const frames = Buffer.concat([Buffer.from(opaque), Buffer.alloc(opaque.length).fill(Buffer.from([255, 0, 0, 255]))]);
        const animation = { raw: { width: w, height: 2 * h, channels: 4, pageHeight: h } };
        const gif = await sharp(frames, animation).gif({ loop: 0 }).toBuffer(), webp = await sharp(frames, animation).webp({ lossless: true, loop: 0 }).toBuffer();
        for (const decoded of [await decodeWithSharp(gif), await decodeOnTheEdge(new Uint8Array(gif)), await decodeWithSharp(webp)]) {
            expect([decoded.width, decoded.height]).toEqual([w, h]);
            expect(Array.from(decoded.data.subarray(4 * 20, 4 * 20 + 3))).not.toEqual([255, 0, 0]);
        }
        await expect(decodeOnTheEdge(new Uint8Array(webp))).rejects.toThrow();

        // Why the Node recipe keeps ensureAlpha: sharp's plain raw() gives a JPEG as RGB.
        expect((await sharp(turned).raw().toBuffer({ resolveWithObject: true })).info.channels).toBe(3);
        await expect(decodeOnTheEdge(new Uint8Array([0x42, 0x4D, 0, 0]))).rejects.toThrow('Unsupported image format');
    });
});

// The guides' "Keeping fast-png" recipe: every fast-png result the library takes becomes an image, and the rest is refused
// (bench/spikes/bare-grey/results-palette.txt: fast-png gives an 8-bit palette PNG as channels 1, depth 8, plus a palette).
describe('fastPngToImage', () => {
    function fastPngToImage({ data, width, height, channels, depth, palette }) {
        if (palette || depth !== 8) throw new Error('needs a decoder that expands palette, 16-bit and packed PNGs (pngjs)');
        if (channels === 4) return { data, format: 'rgba', width, height };
        if (channels === 3) return { data, format: 'rgb', width, height };
        const out = new Uint8Array(width * height * 4);
        for (let p = 0; p < width * height; p++) {
            out[4 * p] = out[4 * p + 1] = out[4 * p + 2] = data[p * channels];
            out[4 * p + 3] = channels === 2 ? data[p * 2 + 1] : 255;
        }
        return { data: out, format: 'rgba', width, height };
    }

    it('matches the guides', async () => {
        const { readFile } = await import('fs/promises');
        const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
        const source = (text) => {
            const lines = text.split('\n');
            const first = lines.findIndex((line) => line.trim().startsWith('function fastPngToImage('));
            const indent = lines[first].match(/^ */)[0];
            const end = lines.findIndex((line, i) => i > first && line === `${indent}}`);
            return lines.slice(first, end + 1).map((line) => line.trim()).join('\n');
        };
        const [guides, test] = await Promise.all([read('../docs/guides.md'), read('./recipes.test.js')]);
        expect(source(test)).toBe(source(guides));
    });

    // The logo above, as each kind of PNG fast-png writes
    const rgb = new Uint8Array(width * height * 3), grey = new Uint8Array(width * height), greyAlpha = new Uint8Array(width * height * 2);
    for (let p = 0; p < width * height; p++) {
        rgb.set(data.subarray(4 * p, 4 * p + 3), 3 * p);
        grey[p] = Math.round(0.2126 * data[4 * p] + 0.7152 * data[4 * p + 1] + 0.0722 * data[4 * p + 2]);
        greyAlpha[2 * p] = grey[p];
        greyAlpha[2 * p + 1] = data[4 * p + 3];
    }
    const roundTrip = (png) => decodePng(encodePng({ width, height, depth: 8, ...png }));
    const expandGrey = (alpha) => {
        const out = new Uint8Array(width * height * 4);
        for (let p = 0; p < width * height; p++) {out.fill(grey[p], 4 * p, 4 * p + 3); out[4 * p + 3] = alpha ? data[4 * p + 3] : 255;}
        return out;
    };

    it('takes RGBA, RGB, grey and grey with alpha, giving the palette of the image passed correctly', async () => {
        const cases = [
            [roundTrip({ data, channels: 4 }), { data, format: 'rgba' }],
            [roundTrip({ data: rgb, channels: 3 }), { data: rgb, format: 'rgb' }],
            [roundTrip({ data: grey, channels: 1 }), { data: expandGrey(false), format: 'rgba' }],
            [roundTrip({ data: greyAlpha, channels: 2 }), { data: expandGrey(true), format: 'rgba' }],
        ];
        for (const [decoded, truth] of cases) {
            expect(await buildPalette(fastPngToImage(decoded), 6)).toEqual(await buildPalette({ ...truth, width, height }, 6));
        }
    });

    it('refuses palette, 16-bit and packed PNGs', () => {
        const indexed = decodePng(encodePng({ width, height, depth: 8, channels: 1, data: new Uint8Array(width * height), palette: [[0, 0, 0], [255, 255, 255]] }));
        const deep = decodePng(encodePng({ width, height, depth: 16, channels: 1, data: new Uint16Array(width * height) }));
        const packed = decodePng(encodePng({ width, height, depth: 1, channels: 1, data: new Uint8Array(Math.ceil(width / 8) * height) }));
        for (const png of [indexed, deep, packed]) {expect(() => fastPngToImage(png)).toThrow('needs a decoder that expands');}
    });
});

// docs/environments.md "Plugins and single-file hosts": embedding the module gzipped. The plugin and the runtime lines are
// read from the docs' text, so they can't drift: bundled with esbuild, the result must load and cluster.
describe('embedding the module gzipped (the esbuild plugin)', () => {
    it('bundles the module gzipped, and the bundle decompresses it, loads and clusters', async () => {
        const { readFile, mkdtemp, writeFile, rm } = await import('fs/promises');
        const { tmpdir } = await import('os');
        const { join } = await import('path');
        const { build } = await import('esbuild');
        const { spawnSync } = await import('child_process');
        const docs = await readFile(new URL('../docs/environments.md', import.meta.url), 'utf8');
        // The docs' two blocks, by their first lines, without the two-space list indent.
        const block = (first) => {
            const start = docs.indexOf(first);
            return docs.slice(start, docs.indexOf('```', start)).split('\n').map((l) => l.replace(/^ {2}/, '')).join('\n');
        };
        const buildScript = block('// build.mjs'), pluginScript = block('// plugin.js');
        expect(buildScript).toContain('plugins: [gzipWasm]');
        // The build script's plugin, run here (its own build call targets the user's files).
        const definition = buildScript.slice(buildScript.indexOf('const gzipWasm'), buildScript.indexOf('} };') + 4);
        const { gzipSync } = await import('node:zlib');
        const { readFileSync } = await import('node:fs');
        const gzipWasm = new Function('gzipSync', 'readFileSync', `${definition}\nreturn gzipWasm;`)(gzipSync, readFileSync);

        // A file path, not the URL's pathname: on Windows that is /D:/..., which esbuild can't find.
        const dist = (await import('url')).fileURLToPath(new URL('../dist/', import.meta.url));
        const folder = await mkdtemp(join(tmpdir(), 'ac-gzip-'));
        try {
            // The plugin script as the docs have it, plus a check that it clusters; the package's names resolve to dist/.
            await writeFile(join(folder, 'entry.mjs'), `${pluginScript}
import { buildPalette } from 'agglomerative-clustering';
const palette = await buildPalette(new Uint8Array(32 * 32 * 4).map((_, i) => (i * 7) & 255), 4);
console.log(gz.length, palette.length / 3);`);
            await build({ entryPoints: [join(folder, 'entry.mjs')], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022',
                mainFields: ['module', 'main'], external: ['node:*'], plugins: [{ name: 'this-package', setup(b) {
                    b.onResolve({ filter: /^agglomerative-clustering(\/clustering\.wasm)?$/ }, (args) => ({ path: args.path.endsWith('.wasm') ? `${dist}clustering.wasm` : `${dist}index.mjs` }));
                } }, gzipWasm], outfile: join(folder, 'out.mjs'), logLevel: 'error' });
            const run = spawnSync(process.execPath, [join(folder, 'out.mjs')], { encoding: 'utf8', timeout: timeLimit(60000) });
            expect(run.stderr).toBe('');
            const [embedded, colours] = run.stdout.trim().split(' ').map(Number);
            expect(colours).toBe(4);
            expect(embedded).toBeLessThan(readFileSync(`${dist}clustering.wasm`).length * 0.6);   // it was gzipped
        } finally {
            await rm(folder, { recursive: true, force: true });
        }
    });
});

// docs/environments.md "Plugins and single-file hosts": the worker script as a data: URL. The plugin is the docs' block,
// written inside the repository (so the package's name resolves to itself, as it would from node_modules) and run.
describe('the worker script as a data: URL (the esbuild plugin)', () => {
    it('gives a data: URL that starts a worker, given the bytes', async () => {
        const { readFile, mkdir, writeFile, rm } = await import('fs/promises');
        const { readFileSync } = await import('node:fs');
        const { build } = await import('esbuild');
        const { fileURLToPath } = await import('url');
        const { createWorker } = await import('../dist/worker.mjs');
        const docs = await readFile(new URL('../docs/environments.md', import.meta.url), 'utf8');
        const start = docs.indexOf('// worker-script.mjs');
        const pluginModule = docs.slice(start, docs.indexOf('```', start)).split('\n').map((l) => l.replace(/^ {2}/, '')).join('\n');
        const folder = new URL(`../build/recipe-worker-script-${process.pid}/`, import.meta.url);
        await mkdir(folder, { recursive: true });
        try {
            await writeFile(new URL('worker-script.mjs', folder), pluginModule);
            await writeFile(new URL('entry.mjs', folder), "import script from 'worker-script';\nexport default script;\n");
            const { workerScript } = await import(new URL('worker-script.mjs', folder).href);
            await build({ entryPoints: [fileURLToPath(new URL('entry.mjs', folder))], bundle: true, format: 'esm', plugins: [workerScript], outfile: fileURLToPath(new URL('out.mjs', folder)), logLevel: 'error' });
            const { default: script } = await import(new URL('out.mjs', folder).href);
            expect(script).toMatch(/^data:text\/javascript;base64,/);
            const worker = createWorker({ script, wasm: readFileSync(new URL('../dist/clustering.wasm', import.meta.url)) });
            try {
                expect((await worker.buildPalette(new Uint8Array(64 * 4).map((_, i) => (i * 37) & 255), 4)).length).toBe(12);
            } finally {
                await worker.terminate();
            }
        } finally {
            await rm(folder, { recursive: true, force: true });
        }
    }, timeLimit(60000));
});
