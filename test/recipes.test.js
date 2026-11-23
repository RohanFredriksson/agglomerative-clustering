// Runs the recipes in docs/guides.md ("Converting the output" and others) against the real encoders, so the documentation can't drift from the API.
import { describe, it, expect } from 'vitest';
import * as gifenc from 'gifenc';
import { GifReader } from 'omggif';
import { encode as encodePng, decode as decodePng } from 'fast-png';
import { buildClustering, getPaletteFromClustering, getSwatchesFromClustering, quantizeToIndices, quantizeToIndicesFromClustering, quantizeToIndicesWithPalette, quantizeWithPalette, buildPalette } from '../dist/index.mjs';
import { createWorker } from '../dist/worker.mjs';


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

    it('palette conversions and swatches with shares', async () => {
        const clustering = await buildClustering(image);
        const { palette, weights, shares } = await getSwatchesFromClustering(clustering, 3);
        const colors = toColors(palette);
        const css = (i) => `rgb(${palette[3 * i]} ${palette[3 * i + 1]} ${palette[3 * i + 2]})`;
        const hex = (i) => (palette[3 * i] << 16) | (palette[3 * i + 1] << 8) | palette[3 * i + 2];
        const swatches = Array.from(shares, (share, i) => ({ color: css(i), share }));
        expect(colors).toEqual([[220, 50, 40], [40, 110, 220], [60, 200, 90]]);
        expect(swatches.map((s) => s.color)).toEqual(['rgb(220 50 40)', 'rgb(40 110 220)', 'rgb(60 200 90)']);
        expect(hex(0)).toBe(0xdc3228);
        expect(swatches.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 12);
        expect(swatches[0].share).toBeGreaterThan(swatches[2].share);
    });

    // The guides' "Heaviest first" recipes. 40 red pixels and two similar blues of 30: in split order at three colours
    // the first entry is a blue (30 pixels) and the heaviest, red, is second.
    const split = (() => {
        const px = [];
        const add = (rgb, n) => {for (let i = 0; i < n; i++) {px.push(...rgb, 255);}};
        add([255, 0, 0], 40); add([0, 0, 255], 30); add([20, 20, 235], 30);
        return { data: new Uint8Array(px), format: 'rgba', width: 10, height: 10 };
    })();

    it('heaviest first for a palette and its weights', async () => {
        const clustering = await buildClustering(split);
        const { palette, weights, shares } = await getSwatchesFromClustering(clustering, 3);
        const colors = toColors(palette);
        expect(Array.from(weights)).toEqual([30, 40, 30]);                       // split order: not heaviest first

        const order = Array.from(weights.keys()).sort((a, b) => weights[b] - weights[a]);
        const rankedColors = order.map((i) => colors[i]);
        const rankedShares = order.map((i) => shares[i]);
        expect(rankedColors[0]).toEqual([255, 0, 0]);
        expect(rankedShares).toEqual([0.4, 0.3, 0.3]);
        expect(rankedColors.length).toBe(colors.length);
    });

    it('heaviest first for an indexed image, with its transparent entry', async () => {
        for (const [source, options] of [[split, {}], [image, { transparent: true }]]) {
            const { palette, indices, transparentIndex } = await quantizeToIndices(source, source === split ? 3 : 12, options);
            const colors = toColors(palette);

            const used = new Uint32Array(palette.length / 3);
            for (const index of indices) {used[index]++;}
            const byUse = Array.from(used.keys()).sort((a, b) => used[b] - used[a]);
            const rank = new Uint32Array(used.length);
            byUse.forEach((old, position) => {rank[old] = position;});
            const rankedPalette = byUse.map((old) => colors[old]);
            const rankedIndices = indices.map((index) => rank[index]);
            const rankedTransparentIndex = transparentIndex === null ? null : rank[transparentIndex];

            // Same picture: every pixel still has the same colour.
            for (let p = 0; p < indices.length; p++) {expect(rankedPalette[rankedIndices[p]]).toEqual(colors[indices[p]]);}
            // Heaviest first: usage never increases along the new order.
            const rankedUse = new Uint32Array(used.length);
            for (const index of rankedIndices) {rankedUse[index]++;}
            for (let i = 1; i < rankedUse.length; i++) {expect(rankedUse[i]).toBeLessThanOrEqual(rankedUse[i - 1]);}
            // The transparent entry is still the one the transparent pixels use.
            if (transparentIndex !== null) {
                for (let p = 0; p < indices.length; p++) {expect(rankedIndices[p] === rankedTransparentIndex).toBe(indices[p] === transparentIndex);}
            }
            expect(rankedIndices.constructor).toBe(indices.constructor);
        }
        // The split-order example really does put the heaviest colour second, so the recipe is doing something.
        const indexed = await quantizeToIndices(split, 3);
        const counts = [0, 0, 0]; for (const index of indexed.indices) {counts[index]++;}
        expect(counts[0]).toBeLessThan(Math.max(...counts));
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
            const { palette, indices, transparentIndex } = await quantizeToIndicesFromClustering(frame, clustering, 256, { dither: 0.5 });
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

    // "Fixed palettes": choosing N colours from a fixed set. The two functions are the guides' own, and the test checks
    // that their text matches the guides' (ignoring indentation), so the two can't drift apart.
    async function chooseThreads(clustering, threads, n) {
      let chosen = [];
      for (let k = n; k <= 4 * n && chosen.length < n; k++) {
        const cut = await clustering.getPalette(k);
        // The cut palette as an image of one pixel per colour, mapped to the threads.
        const { indices } = await quantizeToIndicesWithPalette({ data: cut, format: 'rgb' }, threads);
        // Split order puts the coarsest colours first, so when a cut gives more than n threads, the first n are kept.
        chosen = [...new Set(indices)].slice(0, n);
      }
      return chosen;   // can be fewer than n for an image with few colours
    }

    // Swaps threads in and out of `chosen` while that brings the image closer, measured on 1024 swatches.
    async function improveThreads(clustering, threads, chosen) {
      const { palette: colors, weights } = await clustering.getSwatches(1024);
      const m = weights.length, t = threads.length / 3;
      const distance = new Float64Array(t * m);   // distance[j * m + i]: squared, from thread j to swatch i
      for (let j = 0; j < t; j++) {
        for (let i = 0; i < m; i++) {
          const dr = threads[3 * j] - colors[3 * i], dg = threads[3 * j + 1] - colors[3 * i + 1], db = threads[3 * j + 2] - colors[3 * i + 2];
          distance[j * m + i] = dr * dr + dg * dg + db * db;
        }
      }
      chosen = [...chosen];
      for (;;) {
        // Each swatch's nearest chosen thread (its position in `chosen`) and the distances to the nearest two.
        const nearest = new Int32Array(m), first = new Float64Array(m).fill(Infinity), second = new Float64Array(m).fill(Infinity);
        let current = 0;
        for (let i = 0; i < m; i++) {
          chosen.forEach((j, s) => {
            const d = distance[j * m + i];
            if (d < first[i]) {second[i] = first[i]; first[i] = d; nearest[i] = s;} else if (d < second[i]) {second[i] = d;}
          });
          current += weights[i] * first[i];
        }
        // The best swap of an unchosen thread j for the chosen thread at position s, if any is better.
        let best = null, lowest = current * (1 - 1e-9);
        for (let j = 0; j < t; j++) {
          if (chosen.includes(j)) {continue;}
          for (let s = 0; s < chosen.length; s++) {
            let error = 0;
            for (let i = 0; i < m; i++) {error += weights[i] * Math.min(distance[j * m + i], nearest[i] === s ? second[i] : first[i]);}
            if (error < lowest) {lowest = error; best = [s, j];}
          }
        }
        if (!best) {return chosen;}
        chosen[best[0]] = best[1];
      }
    }

    it('the thread-choosing functions are the ones in the guides', async () => {
        const { readFile } = await import('fs/promises');
        const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
        // A function's lines, trimmed: from its declaration to the closing brace at the declaration's indentation.
        const source = (text, name) => {
            const lines = text.split('\n');
            const start = lines.findIndex((line) => line.trim().startsWith(`async function ${name}(`));
            expect(start, `${name} is in the file`).toBeGreaterThanOrEqual(0);
            const indent = lines[start].match(/^ */)[0];
            const end = lines.findIndex((line, i) => i > start && line === `${indent}}`);
            expect(end, `${name} has a closing brace at its indentation`).toBeGreaterThan(start);
            return lines.slice(start, end + 1).map((line) => line.trim()).join('\n');
        };
        const [guides, test] = await Promise.all([read('../docs/guides.md'), read('./recipes.test.js')]);
        for (const name of ['chooseThreads', 'improveThreads']) {expect(source(test, name)).toBe(source(guides, name));}
    });

    it('chooses n threads from a fixed set, beats the n most used threads, and the swaps never make it worse', async () => {
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
            const chosen = await chooseThreads(clustering, threads, n);
            expect(chosen).toHaveLength(n);
            expect(new Set(chosen).size).toBe(n);
            const top = Array.from(used.keys()).sort((a, b) => used[b] - used[a]).slice(0, n);
            expect(await error(pick(chosen))).toBeLessThan(await error(pick(top)));

            const improved = await improveThreads(clustering, threads, chosen);
            expect(improved).toHaveLength(n);
            expect(new Set(improved).size).toBe(n);
            expect(await error(pick(improved))).toBeLessThanOrEqual(await error(pick(chosen)));
        }
    });

    it('improveThreads handles an image with fewer colours than n, and one with none visible', async () => {
        const threads = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0, 255]);
        const two = new Uint8Array([250, 10, 10, 255, 5, 5, 240, 255]);
        const clustering = await buildClustering(two);
        const chosen = await chooseThreads(clustering, threads, 3);
        expect(chosen.sort()).toEqual([2, 3]);
        expect((await improveThreads(clustering, threads, chosen)).sort()).toEqual([2, 3]);
        const empty = await buildClustering(new Uint8Array([9, 9, 9, 0]));
        expect(await chooseThreads(empty, threads, 2)).toEqual([]);
        expect(await improveThreads(empty, threads, [])).toEqual([]);
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

    describe('mapping a large image: cancelling and progress', () => {
        // quantizeToIndicesWithPalette, stopped part way when `signal` aborts: it rejects with the signal's reason.
        // `workerOptions` go to createWorker ({ wasm, script }, where your setup needs them).
        async function mapCancellably(image, palette, options, signal, workerOptions) {
          signal?.throwIfAborted();
          const worker = createWorker(workerOptions);
            const stop = () => worker.terminate();
            signal?.addEventListener('abort', stop, { once: true });
            try {
                return await worker.quantizeToIndicesWithPalette(image, palette, options);
            } catch (error) {
                if (signal?.aborted) {throw signal.reason;}   // not 'worker-terminated': the caller asked for it
                throw error;
            } finally {
                signal?.removeEventListener('abort', stop);
                worker.terminate();
            }
        }

        // quantizeToIndicesWithPalette for `image` (ImageData, or { data, format: 'rgba', width, height }) in strips of rows,
        // checking `signal` and calling `onProgress` (0 to 1) between them. Strips are a multiple of 8 rows high, so ordered
        // dithering keeps its pattern.
        async function mapInStrips(image, palette, options = {}, { signal, onProgress } = {}) {
          const { data, width, height, format = 'rgba' } = image;
          if (format !== 'rgba') {throw new TypeError("mapInStrips takes RGBA pixels: ImageData or { format: 'rgba' }.");}
          if (!(height > 0)) {return quantizeToIndicesWithPalette(image, palette, options);}
          const rows = Math.max(8, Math.floor(200_000 / width / 8) * 8);   // about 200,000 pixels per strip
          const parts = [];
          for (let top = 0; top < height; top += rows) {
            signal?.throwIfAborted();
            const strip = Math.min(rows, height - top);
            parts.push(await quantizeToIndicesWithPalette(
              { data: data.subarray(top * width * 4, (top + strip) * width * 4), format: 'rgba', width, height: strip }, palette, options));
            onProgress?.((top + strip) / height);
          }
          // Only strips with transparent pixels get the transparent entry, after the palette; take the palette, `colors` and
          // index width (1, 2 or 4 bytes) from one of them.
          const widest = parts.reduce((a, b) => (b.palette.length > a.palette.length ? b : a));
          const indices = new widest.indices.constructor(width * height);
          parts.forEach((part, i) => indices.set(part.indices, i * rows * width));
          return { ...widest, indices, width, height };
        }

        it('are the functions printed in the guides', async () => {
            const { readFile } = await import('fs/promises');
            const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
            const source = (text, name) => {
                const lines = text.split('\n');
                const start = lines.findIndex((line) => line.trim().startsWith(`async function ${name}(`));
                expect(start, `${name} is in the file`).toBeGreaterThanOrEqual(0);
                const indent = lines[start].match(/^ */)[0];
                const end = lines.findIndex((line, i) => i > start && line === `${indent}}`);
                return lines.slice(start, end + 1).map((line) => line.trim()).join('\n');
            };
            const [guides, test] = await Promise.all([read('../docs/guides.md'), read('./recipes.test.js')]);
            for (const name of ['mapCancellably', 'mapInStrips']) {expect(source(test, name), name).toBe(source(guides, name));}
        });

        // A gradient with a band of noise, `width` wide; with `holes`, a few fully transparent pixels in some rows.
        const makeImage = (width, height, holes = []) => {
            const data = new Uint8Array(width * height * 4);
            let seed = 11;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const n = (seed = (seed * 16807) % 2147483647) & 63;
                    const alpha = holes.includes(y) && x % 97 === 0 ? 0 : 255;
                    data.set([(x * 7) & 255, (y * 5 + n) & 255, (x + y + 2 * n) & 255, alpha], (y * width + x) * 4);
                }
            }
            return { data, format: 'rgba', width, height };
        };

        it('in strips gives one call\'s indices without dithering and with ordered dithering, whatever the strip count', async () => {
            // 64-row strips (3 of them, the last short), and the 8-row minimum (3, the last short)
            for (const image of [makeImage(3000, 150), makeImage(30000, 20)]) {
                const few = await buildPalette(image, 16, { precision: 6 }), many = await buildPalette(image, 300, { precision: 6 });
                // over 256 entries the indices are 2 bytes each
                for (const [palette, dither] of [[few, false], [few, 'ordered'], [many, false], [many, { method: 'ordered', steps: 4 }]]) {
                    const whole = await quantizeToIndicesWithPalette(image, palette, { dither });
                    const progress = [];
                    const got = await mapInStrips(image, palette, { dither }, { onProgress: (p) => progress.push(p) });
                    const label = `${image.width} wide, ${palette.length / 3} colours, dither ${JSON.stringify(dither)}`;
                    expect(got.indices.constructor, label).toBe(whole.indices.constructor);
                    expect(got.indices.BYTES_PER_ELEMENT, label).toBe(palette === many ? 2 : 1);
                    expect(got.indices.length).toBe(whole.indices.length);
                    expect(got.indices.every((v, i) => v === whole.indices[i]), label).toBe(true);
                    expect(Array.from(got.palette)).toEqual(Array.from(whole.palette));
                    expect(progress).toHaveLength(3);
                    expect(progress.at(-1)).toBe(1);
                    expect(progress.every((p, i) => i === 0 || p > progress[i - 1])).toBe(true);
                }
            }
        }, 60000);

        it('in strips keeps the transparent entry, its colors and its index width when only a later strip has transparent pixels', async () => {
            const image = makeImage(3000, 150, [70, 71]);   // only the second strip has transparent pixels
            for (const k of [12, 256]) {   // at 256 colours the transparent entry makes the indices 2 bytes wide
                const palette = await buildPalette(image, k, { precision: 6 });
                expect(palette.length / 3).toBe(k);
                for (const options of [{ transparent: true }, { transparent: true, dither: 'ordered' }]) {
                    const whole = await quantizeToIndicesWithPalette(image, palette, options);
                    const got = await mapInStrips(image, palette, options);
                    expect(whole.transparentIndex).toBe(k);
                    const { indices, ...rest } = got, { indices: expected, ...expectedRest } = whole;
                    expect(rest).toEqual(expectedRest);   // palette, colors, indexBits, transparentIndex, width, height
                    expect(indices.constructor).toBe(expected.constructor);
                    expect(indices.every((v, i) => v === expected[i]), `${k} colours`).toBe(true);
                }
            }
        }, 30000);

        it('in strips takes ImageData and an empty image, and refuses other pixel formats', async () => {
            const image = makeImage(3000, 150);
            const palette = await buildPalette(image, 16, { precision: 6 });
            const imageData = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
            const whole = await quantizeToIndicesWithPalette(imageData, palette, { dither: 'ordered' });
            const got = await mapInStrips(imageData, palette, { dither: 'ordered' });
            expect(got.indices.every((v, i) => v === whole.indices[i])).toBe(true);
            expect(await mapInStrips({ data: new Uint8Array(0), format: 'rgba', width: 5, height: 0 }, palette))
                .toEqual(await quantizeToIndicesWithPalette({ data: new Uint8Array(0), format: 'rgba', width: 5, height: 0 }, palette));
            await expect(mapInStrips({ ...image, format: 'bgra' }, palette)).rejects.toThrow(TypeError);
        });

        it('in strips stops between strips on abort, with the signal\'s reason', async () => {
            const image = makeImage(3000, 150);
            const palette = await buildPalette(image, 16, { precision: 6 });
            const controller = new AbortController();
            const progress = [];
            const reason = new Error('superseded');
            const run = mapInStrips(image, palette, {}, { signal: controller.signal, onProgress: (p) => {progress.push(p); controller.abort(reason);} });
            await expect(run).rejects.toBe(reason);
            expect(progress).toHaveLength(1);
        });

        it('in strips gives error diffusion its own output, close to one call\'s', async () => {
            const image = makeImage(3000, 150);
            const palette = await buildPalette(image, 16, { precision: 6 });
            const whole = await quantizeToIndicesWithPalette(image, palette, { dither: true });
            const got = await mapInStrips(image, palette, { dither: true });
            // the first strip is mapped exactly as one call maps its rows; the rest start without the carried error
            const first = 64 * image.width;
            expect(got.indices.subarray(0, first).every((v, i) => v === whole.indices[i])).toBe(true);
            expect(got.indices.some((v, i) => v !== whole.indices[i])).toBe(true);
        });

        it('through a worker gives the plain call\'s result, and an abort rejects at once with the signal\'s reason', async () => {
            const image = makeImage(3000, 150, [3]);
            const palette = await buildPalette(image, 16);
            const options = { dither: 'atkinson', transparent: true };
            const plain = await quantizeToIndicesWithPalette(image, palette, options);
            const got = await mapCancellably(image, palette, options, new AbortController().signal);
            expect(Array.from(got.indices)).toEqual(Array.from(plain.indices));
            expect(Array.from(got.palette)).toEqual(Array.from(plain.palette));
            expect(got.transparentIndex).toBe(plain.transparentIndex);
            await expect(mapCancellably(image, palette, options)).resolves.toBeTruthy();   // no signal

            // a mapping of several seconds (ordered dithering, 256 colours, 1 MP of noise), aborted soon after it starts
            let seed = 5;
            const noise = { data: new Uint8Array(1024 * 1024 * 4).map((_, i) => (i % 4 === 3 ? 255 : (seed = (seed * 16807) % 2147483647) & 255)), format: 'rgba', width: 1024, height: 1024 };
            const many = new Uint8Array(768).map((_, i) => (i * 97) & 255);
            const controller = new AbortController();
            const run = mapCancellably(noise, many, { dither: 'ordered' }, controller.signal);
            await new Promise((done) => setTimeout(done, 100));
            const start = performance.now();
            controller.abort();
            await expect(run).rejects.toMatchObject({ name: 'AbortError' });
            expect(performance.now() - start).toBeLessThan(100);

            const already = new AbortController();
            already.abort();
            await expect(mapCancellably(image, palette, options, already.signal)).rejects.toMatchObject({ name: 'AbortError' });
        }, 30000);
    });

});
