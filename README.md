# agglomerative-clustering

**Exact Ward colour quantization for JavaScript. Cluster an image once, then cut it to a palette of any size in under a millisecond.**

[![npm](https://img.shields.io/npm/v/agglomerative-clustering)](https://www.npmjs.com/package/agglomerative-clustering)
[![license](https://img.shields.io/npm/l/agglomerative-clustering)](LICENSE)
![types](https://img.shields.io/badge/types-included-blue)

![The Kodak parrots photo cut to 4, 16 and 64 colours from one clustering, and 16 colours with dithering](https://raw.githubusercontent.com/RohanFredriksson/agglomerative-clustering/master/docs/palette-sizes.png)

Most colour quantizers answer one question: *give me k colours*. Ask for a different k and they start over. This library clusters an image's colours once, into a complete tree, and every palette size is then a cheap cut of that tree. A colour-count slider, or a set of 8, 16, 32 and 64 colour versions, costs one clustering instead of one per size.

- **Every palette size from one pass.** Clustering a photo takes about 70 ms. After that, a palette of any size takes about 0.4 ms.
- **Palettes nest, in a stable order.** The 16-colour palette is the 32-colour one with pairs merged, so swatches don't jump around as the count changes.
- **It knows each colour's share of the image,** so you can show swatches with percentages, or pick the smallest palette that meets an error target.
- **Transparency-aware.** A logo's transparent background never ends up in its palette. GIF and palette PNG output are built in.
- **Off the main thread.** `agglomerative-clustering/worker` runs the same API in a Web Worker or Node worker thread.
- **Accurate and fast.** The lowest average error of the six JavaScript quantizers we benchmarked, at about the speed of libimagequant ([numbers](#how-it-compares)).
- **Small and portable.** 91 KB of WebAssembly, Node and browsers, TypeScript types, no runtime dependencies, deterministic output.

[Install](#install) · [Quick start](#quick-start) · [The idea](#the-idea-in-one-minute) · [Guides](#guides) · [Reference](#reference) · [API](#api) · [Troubleshooting](#troubleshooting)

## Install

```sh
npm install agglomerative-clustering@next
```

**3.0 is in beta.** This page describes 3.0, which is published under the `next` tag until its release; a plain `npm install agglomerative-clustering` still gives 2.0 (see [its README](https://www.npmjs.com/package/agglomerative-clustering/v/2.0.0) and [what changed](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/migrating.md)).

It runs on Node 20.19+ and 22.12+, and in browsers with WebAssembly SIMD (see [Where it runs](#where-it-runs)).

## Quick start

**In Node, with [sharp](https://sharp.pixelplumbing.com/):**

```js
import sharp from 'sharp';
import { getPalette, quantize } from 'agglomerative-clustering';

const { data, info } = await sharp('photo.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const image = { data: new Uint8Array(data.buffer, data.byteOffset, data.length), format: 'rgba', width: info.width };

const palette = await getPalette(image, 8);                   // flat bytes: [r, g, b, r, g, b, ...]
const reduced = await quantize(image, 16, { dither: true });  // the image, in 16 colours

await sharp(Buffer.from(reduced.data), { raw: { width: info.width, height: info.height, channels: 4 } }).toFile('photo-16.png');
```

**In the browser, with a canvas:**

```js
import { quantize } from 'agglomerative-clustering';

const ctx = canvas.getContext('2d');
const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

ctx.putImageData(await quantize(imageData, 16, { dither: true }), 0, 0);   // ImageData in, ImageData out
```

**Swatches, with each colour's share of the image:**

```js
import { getSwatches } from 'agglomerative-clustering';

const { palette, shares } = await getSwatches(imageData, 6);   // six colours; the shares sum to 1
shares.forEach((share, i) => {
  console.log(`rgb(${palette[3 * i]} ${palette[3 * i + 1]} ${palette[3 * i + 2]})`, `${(share * 100).toFixed(1)}%`);
});
```

Those three are all you need to get started. The rest of this page is organised by what you want to do (the [guides](#guides)) and by what to look up (the [reference](#reference) and the [API](#api)).

## The idea in one minute

```
 image ──▶ getClustering ──▶ a clustering ──▶ cut to k colours ──▶ a palette ──▶ map the pixels ──▶ reduced image
           once, ~70 ms      bytes you can     under 1 ms,          flat RGB       a few ms,
                             store             any k                bytes          any palette
```

The one-shot functions (`getPalette`, `quantize`, …) do the first steps for you. To try many palette sizes, call `getClustering` once and cut it as often as you like.

| You want | from the image | from a clustering you hold | with a palette you supply |
|---|---|---|---|
| a palette (flat RGB) | `getPalette` | `getPaletteFromClustering` | |
| a palette with each colour's share | `getSwatches` | `getSwatchesFromClustering` | |
| the image reduced to those colours | `quantize` | `quantizeFromClustering` | `quantizeWithPalette` |
| palette indices (GIF, PNG-8) | `quantizeToIndices` | `quantizeToIndicesFromClustering` | `quantizeToIndicesWithPalette` |

The names follow one rule: **`…FromClustering`** derives the colours from a clustering you already hold, and **`…WithPalette`** takes colours you supply. With neither, the image is clustered for you. `getClustering` builds the clustering to hold, `getClusteringInfo` reads one, and `init` loads the WebAssembly module (optional). Most code only needs the first column.

Five words are used throughout:

- **clustering**: the tree of an image's colours. It is opaque bytes (a `Clustering`) that you can store next to the image.
- **palette**: flat RGB bytes, `[r, g, b, r, g, b, …]`. A `Palette` knows the colour space it was made in.
- **k**: the most palette entries in what you get back, in every function. A flat palette has no transparent entry, so its entries are all colours; in indexed output with `transparent`, the transparent entry is one of the `k`, so `256` is the most a GIF holds. Fewer come back when the image has fewer distinct colours. The one exception: indexed output always keeps a colour for the visible pixels, so `k = 1` with a transparent entry gives 2.
- **split order**: palettes come out so that the palette for `k + 1` is the one for `k` with one colour split in two. Entries keep their place as `k` grows, but the palette is not sorted by share.
- **precision**: an option that groups similar colours before clustering, about 3× faster at practically the same quality.

## Is it the right tool?

**A good fit:**
- **Interactive tools where people choose the number of colours:** palette editors, posterisers, pixel art, embroidery, paint-by-number and knitting pattern generators, and LED, e-ink or limited-palette displays.
- **Several palette sizes for the same image,** or storing one clustering and cutting it later.
- **The most accurate palette for a given size,** for example as a starting point for vectorisation or flat-colour art.

**Probably not the right tool:**
- **Shrinking PNG files in a build pipeline.** Use [sharp](https://sharp.pixelplumbing.com/) or pngquant, which run libimagequant natively and are tuned for compression.
- **A handful of "dominant" swatches for a UI theme.** [color-thief](https://lokeshdhakar.com/projects/color-thief/) or [node-vibrant](https://github.com/Vibrant-Colors/node-vibrant) are lighter and pick vivid or salient colours rather than the lowest-error ones.
- **Palettes that need their own alpha values,** as palette PNGs with translucent entries do. Pixels are weighted by opacity, but palette colours are opaque RGB, and each pixel keeps its own alpha.

### How it compares

The 24 Kodak photos (768×512) at 64 colours. "Error vs ours" is mean squared error relative to this library, so 1.08× means 8% more error. Every palette is mapped to pixels the same way, so palettes are compared like for like. Times are medians per image, in WASM on Node 24 on a laptop (Intel Core i7-1185G7).

| Library | PSNR | Error vs ours | One palette | Palettes at 16/64/128/256 |
|---|---|---|---|---|
| **agglomerative-clustering** | **35.72 dB** | **1.00×** | 70 ms | **69 ms** |
| agglomerative-clustering, `precision: 6` | 35.70 dB | 1.00× | 24 ms | 23 ms |
| libimagequant (pngquant's engine) | 35.39 dB | 1.08× | 79 ms | 323 ms |
| image-q Wu | 35.51 dB | 1.05× | 532 ms | 2404 ms |
| image-q NeuQuant | 34.41 dB | 1.35× | 428 ms | 2562 ms |
| MMCQ (color-thief's algorithm) | 32.53 dB | 2.08× | 19 ms | 98 ms |
| image-q RgbQuant | 31.95 dB | 2.38× | 242 ms | 1006 ms |

All rows are from one run. Full results at every palette size, on synthetic images too, with ΔE2000 and the method, are in [bench/COMPARISON.md](bench/COMPARISON.md); reproduce them with `node bench/run.js`. These numbers are a snapshot, so expect them to move with the hardware and the versions.

## Guides

### Cluster once, cut anywhere

```js
import { getClustering, getPaletteFromClustering, quantizeWithPalette } from 'agglomerative-clustering';

const clustering = await getClustering(imageData);         // the expensive step, done once

slider.oninput = async () => {
  const k = Number(slider.value);
  const palette = await getPaletteFromClustering(clustering, k);   // ~0.4 ms for any k
  const result = await quantizeWithPalette(imageData, palette);    // ~5-12 ms for a 768×512 image
  ctx.putImageData(result, 0, 0);
};
```

A clustering of a 768×512 photo is 0.3 to 1.5 MB, typically 0.7 MB (0.2 MB with `precision: 6`). Store it next to the image if you like: its format is versioned, and `new Clustering(bytes)` gives stored bytes their type back (see [Palette and Clustering](#palette-and-clustering)).

### Swatches, and choosing a palette size

```js
import { getSwatches, getClustering, getSwatchesFromClustering, getClusteringInfo } from 'agglomerative-clustering';

// Colours with their share of the image, in one call
const { palette, weights, shares } = await getSwatches(image, 8);
// palette: flat RGB bytes, weights: pixels per colour, shares: each colour's share of the image (they sum to 1)

// Or cluster once and cut it as often as you like (well under a millisecond each)
const clustering = await getClustering(image);
const eight = await getSwatchesFromClustering(clustering, 8);

// The smallest palette that keeps 99% of the image's colour variance (works the same in 'rgb' and 'oklab')
const { explained } = await getClusteringInfo(clustering);   // null only for a clustering from 2.x
const k = (explained ?? []).findIndex((share) => share >= 0.99) + 1;
```

### GIFs and palette PNGs

`quantizeToIndices` returns a palette and one index per pixel, which is what these formats store. With `transparent`, pixels below an alpha cutoff share one transparent entry, which counts in `k`.

**A GIF** with [gifenc](https://github.com/mattdesl/gifenc), keeping a transparent background:

```js
import * as gifenc from 'gifenc';
// Bundlers read gifenc's ES module, which has the named export; plain Node reads its CommonJS build, which has it on the default.
const GIFEncoder = gifenc.GIFEncoder ?? gifenc.default.GIFEncoder;
import { quantizeToIndices } from 'agglomerative-clustering';

// k counts the transparent entry, so 256 is the most a GIF holds. `image` is { data, format: 'rgba', width, height }.
const { palette, indices, indexBits, transparentIndex } = await quantizeToIndices(image, 256, { transparent: true });
if (indexBits !== 8) {throw new Error('unreachable: 256 entries or fewer have 8-bit indices');}   // tells TypeScript `indices` is a Uint8Array
const colors = Array.from({ length: palette.length / 3 }, (_, i) => [palette[3 * i], palette[3 * i + 1], palette[3 * i + 2]]);

const gif = GIFEncoder();
gif.writeFrame(indices, image.width, image.height, { palette: colors, transparent: transparentIndex !== null, transparentIndex: transparentIndex ?? 0 });
gif.finish();
const bytes = gif.bytes();
```

**A palette PNG** with [fast-png](https://github.com/image-js/fast-png): the same call, then move the transparent entry to the front and give it alpha 0. A PNG lists alpha for the first palette entries, in order, and fast-png writes only the alphas below 255, so the transparent entry has to come first or the alpha lands on the wrong colour:

```js
import { encode } from 'fast-png';

// Swap the transparent entry with entry 0 (when there is one), in the palette and in the indices.
const t = transparentIndex ?? 0;
const swap = (i) => (i === t ? 0 : i === 0 ? t : i);
const png = encode({
  width: image.width, height: image.height, depth: 8, channels: 1,
  data: indices.map(swap),
  palette: colors.map((_, i) => [...colors[swap(i)], i === 0 && transparentIndex !== null ? 0 : 255]),
});
```

With at most 256 entries, `indices` is a `Uint8Array`, as these formats need (`indexBits` says so).

### Animated GIFs and sets of images

One palette for a whole animation (or a set of images that should share colours) keeps colours from flickering between frames. Cluster a sample of the frames as one image, by putting their pixels end to end, then map every frame with that clustering:

```js
import { getClustering, quantizeToIndicesFromClustering } from 'agglomerative-clustering';

// `frames` are { data, format: 'rgba', width, height }. Every 5th one, end to end, is one image to cluster.
const sample = frames.filter((_, i) => i % 5 === 0);
const pixels = new Uint8Array(sample.reduce((n, frame) => n + frame.data.length, 0));
let offset = 0;
for (const frame of sample) {pixels.set(frame.data, offset); offset += frame.data.length;}
const clustering = await getClustering({ data: pixels, format: 'rgba' }, { precision: 6, transparent: true });

for (const frame of frames) {
  // The same 256 entries for every frame (transparent one included), dithered lightly to limit shimmer between frames.
  const { palette, indices, transparentIndex } = await quantizeToIndicesFromClustering(frame, clustering, 256, { dither: 0.5 });
  // … gif.writeFrame(indices, width, height, { palette: …, transparent: transparentIndex !== null, transparentIndex: transparentIndex ?? 0 })
}
```

Cutting the clustering keeps `k` counting the transparent entry, so the palette fits a GIF. (A palette passed to `quantizeToIndicesWithPalette` has the transparent entry added to it, so 256 colours become 257 entries: cut 255.) A frame with no transparent pixels has no transparent entry, so its palette can be one entry shorter than another frame's; a GIF with one global palette should reserve a slot for it. With the worker entry, a few `createWorker()`s map frames in parallel; on small frames (320×240) the cost of sending them across outweighs the gain.

### Live video and camera frames

For a palette that follows a video or a camera (ambient light, a live theme), take each frame small and **skip frames while the worker is busy**:

```js
import { createWorker } from 'agglomerative-clustering/worker';

const worker = createWorker({ transfer: true });   // each frame's pixels are fresh, so move them rather than copy
const canvas = new OffscreenCanvas(160, 90);         // a small copy is plenty for a palette
const ctx = canvas.getContext('2d', { willReadFrequently: true });
let busy = false;

const onFrame = () => {
  if (!busy) {
    busy = true;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    worker.getPalette(ctx.getImageData(0, 0, canvas.width, canvas.height), 6, { precision: 6 })
      .then(show, console.error)
      .finally(() => {busy = false;});
  }
  video.requestVideoFrameCallback(onFrame);
};
video.requestVideoFrameCallback(onFrame);
```

- **Don't abort the running call when a new frame arrives**, as the slider example does. A slider stops; frames keep coming, so when each palette takes longer than a frame, every call is aborted before it finishes and no palette ever arrives (none in 6 seconds at 640×360 and 30 frames a second, in testing). Each abort also costs the worker a little. Skip frames instead, or keep only the newest one waiting.
- **Size.** In a worker with `precision: 6` a palette took about 20 ms at 160×90, 50 ms at 320×180, 100 ms at 640×360 and 185 ms at 1280×720 (on a busy machine, so a ceiling); exact precision is 3 to 7 times slower. 160×90 keeps up with 30 frames a second.
- **Flicker.** Each frame is clustered on its own, so even a still scene with a little noise gives palettes whose colours shift, swap places or split differently from frame to frame. Follow the previous palette and smooth it; in testing this cut the flicker about fourfold, for a lag of two or three frames:

  ```js
  // Match each colour of the previous (smoothed) palette to its nearest new colour, then move a quarter of the way there.
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
    return smoothed;   // fractional values: round them for display
  };
  ```
- **One palette for a whole clip** (no flicker at all) is the animated-GIF recipe above: cluster a sample of frames once.
- **In Node**, pipe ffmpeg's raw output (`-f rawvideo -pix_fmt rgba`) and hand each frame to a few `createWorker()`s; memory stayed flat over thousands of frames in testing.

### Off the main thread

Clustering a photo takes about 70 ms, too long to run on a page's main thread while someone drags a slider. The worker entry has the same functions, run in a Web Worker (or a worker thread in Node):

```js
import { quantize } from 'agglomerative-clustering/worker';   // same API, one shared worker
const reduced = await quantize(imageData, 16);
```

For live re-cutting, `createWorker().cluster(image)` keeps the image and its clustering in the worker, so each new palette size sends only `k` across:

```js
import { createWorker } from 'agglomerative-clustering/worker';

const worker = createWorker();
const handle = await worker.cluster(imageData, { precision: 6 });

let controller = null;
slider.oninput = async () => {
  controller?.abort();                  // a size the slider has already moved past isn't worth finishing
  const mine = (controller = new AbortController());
  try {
    ctx.putImageData(await handle.quantize(Number(slider.value), { dither: true, signal: mine.signal }), 0, 0);
  } catch (error) {
    if (!mine.signal.aborted) {throw error;}   // an abort is expected; anything else is a real failure
  }
};
```

Calls to one worker run in order, and re-mapping a large image takes a while (0.2 to 0.3 s at 12 megapixels, about 1 s dithered), so without the `signal` a fast drag queues up every size it passed through and the picture keeps changing after the slider stops. Aborting the previous call drops it from the queue. Re-cutting alone (`handle.getPalette(k)`, `handle.getSwatches(k)`) takes well under a millisecond and needs none of this. This suits a slider, which stops; for a stream that never does, such as video frames, see [Live video and camera frames](#live-video-and-camera-frames).

It starts the worker with `new Worker(new URL('./worker-thread.mjs', import.meta.url))`, the form bundlers look for: CI tests Vite and webpack 5, Parcel 2 works with its `packageExports` option on (see [below](#angular-esbuild-rollup-and-other-bundlers)), and for Next.js see [Next.js](#nextjs). Bundlers that don't emit that script (Angular's `application` builder, plain esbuild or Rollup) need it given to them: see [Angular, esbuild, Rollup and other bundlers](#angular-esbuild-rollup-and-other-bundlers). Loaded from a CDN (another origin than the page), it starts the worker through a small `blob:` script, as browsers don't start workers from other origins' scripts. In TypeScript a handle keeps the image type it was made from: a variable that holds one is `ClusteringHandle<ImageData> | null`, not a bare `ClusteringHandle`, whose `quantize` returns the general image type. In Node an idle worker never keeps the process alive. See the [worker reference](#worker-entry).

### Fixed palettes: e-ink, thread, bricks

Hardware, craft and print often have a palette you didn't choose. `quantizeToIndicesWithPalette(image, palette, options?)` maps to it and gives indices in *your* palette's order (what firmware, thread charts and parts lists need):

```js
const eink = [0,0,0, 255,255,255, 0,255,0, 0,0,255, 255,0,0, 255,255,0, 255,128,0];   // black white green blue red yellow orange
const { indices } = await quantizeToIndicesWithPalette({ data, format: 'rgba', width }, eink, { dither: true });
// indices[i] is the entry of `eink` for pixel i: pack it to 4 bits per pixel for the panel
```

- **Undithered, every pixel gets its nearest entry** (ties go to the smaller RGB value, and a repeated entry gets its first index). Dithering diffuses the error to the neighbours, and keeps working when the palette can't reach the image's colours: saturated cyan with the seven e-ink inks comes out as an even mix of white, green and blue, not solid blue.
- **Colour space is a choice here too, and the answer differs from clustering.** `'oklab'` keeps skin tones from going olive when mapping *without* dithering; with small palettes of widely spaced inks (e-ink, grey levels) `'rgb'` dithers better, and OKLab brightens black and white. Try both on your panel.
- **Choosing N colours from a fixed set** (the 12 threads that best represent a photo out of 400) has no function of its own, but a few lines do it: cut the clustering, snap each cut colour to its nearest thread, and cut finer until N distinct threads appear. In testing it beat "the N most used threads" by 3 to 8 dB PSNR for N up to 12; the gain shrinks as N grows (under 1 dB at 24).

  ```js
  import { getClustering, getPaletteFromClustering, quantizeToIndicesWithPalette } from 'agglomerative-clustering';

  // The indices (into `threads`, flat RGB) of the n threads that best represent `image`.
  async function chooseThreads(image, threads, n) {
    const clustering = await getClustering(image);
    let chosen = [];
    for (let k = n; k <= 4 * n && chosen.length < n; k++) {
      const cut = await getPaletteFromClustering(clustering, k);
      // The cut palette as an image of one pixel per colour, mapped to the threads.
      const { indices } = await quantizeToIndicesWithPalette({ data: cut, format: 'rgb' }, threads);
      // Split order puts the coarsest colours first, so when a cut gives more than n threads, the first n are kept.
      chosen = [...new Set(indices)].slice(0, n);
    }
    return chosen;   // can be fewer than n for an image with few colours
  }
  ```
- **Transparent pixels** map to black unless you pass `transparent`, which appends an entry for them (so a 1- or 2-bit panel has no room for it): composite the image onto your background first.
- **Index width:** up to 256 entries give 8-bit indices; more give 16-bit ones (`indexBits` says which), so a 257-colour palette doesn't fit an 8-bit format.
- **Speed:** a palette of more than 1024 colours is mapped about three times slower than one of 1024 or fewer, and dithered about four to six times slower (at 12 megapixels, about 2 s with 1024 colours against 8 to 13 s with 1025 to 2000).

### Swatches for many images (a build step)

For placeholders, theming or colour search over a site's images, one call each is fast enough, and most of the time goes to decoding:

- **Downscale first.** 512 px on the long side changes the palette by about 2% (256 px by 6%, 64 px by half) and is 3 to 8 times faster; with `precision: 6` a photo takes about 20 ms.
- **Use a few workers, not one per image.** The main entry runs one call at a time, so throughput comes from several `createWorker()`s (the pool in [Performance and limits](#performance-and-limits)). About four is the sweet spot; more mostly adds memory.
- **Cache palettes, not clusterings:** 1,500 palettes are about half a megabyte of JSON, and 1,500 clusterings are 0.2 to 1 GB. Key the cache by the image's content hash, plus the library's major version and your options; palettes are the same for every 3.x release (see [stability](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/stability.md)).
- "Dominant colour" is up to you: the heaviest swatch of `getSwatches(image, 5)` (sort by `shares`) is a good one. These colours are averages of regions, so they are muted: for vivid accents, a library built for them (node-vibrant, colorthief) suits better.
- A sharp `Buffer` from `.raw()` can be passed as it is, with `{ data, format: 'rgba', width }`.

### Using the output

Palettes are flat RGB bytes, the compact form; each format an encoder or UI wants is a line or two away. Given a `palette` (and `weights` and `shares` from `getSwatches`):

```js
// [[r, g, b], …]: what gifenc, fast-png, color-thief and libimagequant use
const colors = Array.from({ length: palette.length / 3 }, (_, i) => [palette[3 * i], palette[3 * i + 1], palette[3 * i + 2]]);

// A CSS colour, and a 0xRRGGBB number
const css = (i) => `rgb(${palette[3 * i]} ${palette[3 * i + 1]} ${palette[3 * i + 2]})`;
const hex = (i) => (palette[3 * i] << 16) | (palette[3 * i + 1] << 8) | palette[3 * i + 2];

// Swatches with their share of the image (the palette is in split order, not sorted by share: sort `swatches` by `share` to put the biggest first)
const swatches = Array.from(shares, (share, i) => ({ color: css(i), share }));
```

**Heaviest first.** Palettes come in split order, so the biggest colour isn't necessarily first. To rank them, sort; sorted palettes of different sizes no longer nest.

```js
// A palette and its weights, heaviest first
const order = Array.from(weights.keys()).sort((a, b) => weights[b] - weights[a]);   // old index of the 1st, 2nd, … entry
const rankedColors = order.map((i) => colors[i]);
const rankedShares = order.map((i) => shares[i]);

// An indexed image, heaviest first: count how many pixels use each entry (that is what "heaviest" means for the image),
// sort, and renumber the indices
const used = new Uint32Array(palette.length / 3);
for (const index of indices) {used[index]++;}
const byUse = Array.from(used.keys()).sort((a, b) => used[b] - used[a]);
const rank = new Uint32Array(used.length);
byUse.forEach((old, position) => {rank[old] = position;});
const rankedPalette = byUse.map((old) => colors[old]);
const rankedIndices = indices.map((index) => rank[index]);                           // same typed-array type as `indices`
const rankedTransparentIndex = transparentIndex === null ? null : rank[transparentIndex];
```

### Coming from color-thief, node-vibrant, image-q or get-image-colors

This library takes **decoded pixels**, not files, URLs or image elements: decode first (sharp or pngjs in Node, a canvas or `createImageBitmap` in a browser). Pixels without alpha go in as `{ data, format: 'rgb' }`; passed bare they are read as RGBA, so sharp's `.raw()` without `.ensureAlpha()` gives a palette that is quietly wrong.

| You used | Use | Notes |
|---|---|---|
| color-thief `getColor(image)` | `getSwatches(image, 5, { precision: 6 })`, then the entry with the largest `shares` | The heaviest cluster's average colour. |
| color-thief `getPalette(image, n)` | `getPalette(image, n, { precision: 6 })` | Flat bytes; `[[r, g, b], …]` is one line ("Using the output"). |
| get-image-colors | `getSwatches(image, n)`, and hex strings from the palette | Sort by `shares` for most-used first. |
| node-vibrant's named swatches (Vibrant, Muted, …) | `getSwatches(image, 16)`, then choose by saturation and lightness yourself | There are no named roles: these colours are averages, more muted than node-vibrant's picks. |
| image-q `buildPalette` and `applyPalette` | `quantize(image, k, { dither })`, or `getPalette` then `quantizeWithPalette` | Same idea, one call; `quantizeToIndices` for indexed output. |

- **Expect different colours.** The palettes are the ones with the least error, not the most vivid or the most frequent, so they won't match what you had (a mean ΔE2000 of 12 to 14 between matched colours, against color-thief, get-image-colors and node-vibrant, in testing).
- **Speed.** color-thief and node-vibrant sample pixels, so they are quick on photos; the exact default here is several times slower at photo sizes. With `precision: 6` it was level with color-thief at 12 megapixels; downscaling helps both. Against image-q it was 4 to 6 times faster.
- **Quality.** Undithered, the error was lower than image-q's Wu (at 16 colours, MSE 71 against 84). `dither: true` diffuses the whole error, so per-pixel error is higher than with image-q's Floyd–Steinberg while the image looks closer from a distance; a strength such as `dither: 0.5` sits between.
- **Missing pieces** are a few lines each: hex strings and ranking by share in [Using the output](#using-the-output), and a dominant colour above.

## Reference

### Input and output
Every function that takes an image accepts:

```ts
Uint8Array                                   // raw RGBA bytes
ImageData                                    // from a canvas: always RGBA, width included
{ data: Uint8Array | Uint8ClampedArray,      // explicit format, for RGB data or clamped arrays
  format: 'rgb' | 'rgba',
  width?: number, height?: number }          // optional: used for dithering, copied to results
```

`width` and `height` must be whole numbers, and when both are given they must account for exactly the pixels in `data`.

> **A bare `Uint8Array` is read as RGBA**, like `ImageData`. RGB bytes passed bare are misread, with no error when their length happens to be a multiple of 4. Pass them as `{ data, format: 'rgb', width }`, or add an alpha channel (sharp's `.ensureAlpha()`).

> **Image files are not pixels.** A bare `Uint8Array` that starts like a PNG, JPEG, GIF, WebP, BMP, TIFF, AVIF or HEIC file (from `fs.readFile` or `fetch`) is rejected with `invalid-argument` naming the format. Decode it first: a canvas or `createImageBitmap` in a browser, sharp or pngjs in Node. Only bare arrays are checked, so if raw pixels really do begin like a file header, pass `{ data, format: 'rgba' }`. Decoding is [planned](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/ROADMAP.md).

The functions that return an image give back the type they were given: a `Uint8Array`, `ImageData`, or an object with the same `format` (and `width` and `height`). In TypeScript the result type follows the input (`ImageResult<I>`). Palettes come back as a `Palette`, clusterings as a `Clustering`, and the other results are `Swatches`, `IndexedImage` and `ClusteringInfo` objects.

### Options

Every function that takes an image also takes an optional last argument of options. They are all off by default, and the defaults give the exact results shown above.

| Option | Applies to | Values | What it does |
|---|---|---|---|
| `precision` | clustering | `1`–`8`, default `8` | Groups colours that share their top `precision` bits per channel before clustering, at their mean colour. **`6` is about 3× faster on photos at practically the same quality** (−0.02 dB), and caps the work on images with huge numbers of colours. `5` is about 8× faster for a small loss. |
| `colorSpace` | clustering and mapping | `'rgb'` (default), `'oklab'` | `'rgb'` minimises squared error in sRGB (the best PSNR); `'oklab'` clusters and matches in [OKLab](https://bottosson.github.io/posts/oklab/). Neither wins everywhere: see "Choosing a colour space". |
| `alpha` | clustering | `'weight'` (default), `'ignore'` | `'weight'` counts each RGBA pixel in proportion to its opacity, so transparent pixels don't count (exact pixel counting for opaque images). `'ignore'` counts every pixel fully, as 1.x did. Each pixel keeps its own alpha in the output. |
| `dither` | mapping | `false` (default), `true`, or `0`–`1` | Serpentine Floyd–Steinberg error diffusion, with a strength from 0 to 1. Hides banding in gradients at low colour counts, at a cost in per-pixel metrics such as PSNR. Fully transparent pixels are left undithered. |
| `width` | mapping | integer | The image width, for dithering a `Uint8Array` or a `RawImage` without one. If the image has a width of its own, this must equal it. |
| `signal` | any call with an image | an `AbortSignal` | Cancels the call; see "Cancelling and progress". |
| `onProgress` | clustering | `(fraction) => void` | Reports 0 to 1 as the clustering runs; see "Cancelling and progress". |
| `transparent` | clustering; indexed output | `false` (default), `true`, or an alpha cutoff `1`–`255` | Pixels with alpha below the cutoff (128 for `true`) are left out of clustering and the rest count whole; indexed output gives them a transparent entry, counted in `k`. For GIFs and palette PNGs; see "Transparency". |

"Clustering" means any function that builds a clustering (`getClustering`, `getPalette`, `getSwatches`, `quantize` and `quantizeToIndices`), and "mapping" means any that maps pixels to a palette (`quantize`, `quantizeFromClustering`, `quantizeWithPalette` and the indexed versions). A function that does both takes both sets of options.

Pass an ordinary object. It is copied once before use (its enumerable properties, inherited ones included, so `Object.create(defaults)` works), and an unknown key is an error, including one that another function takes: an object with both `precision` and `dither` passed to `getClustering` throws on `dither`. TypeScript doesn't catch that when the object is a variable typed `QuantizeOptions` (extra properties of a variable are allowed), so give each call the options it takes, or keep one object per stage.

```js
// Perceptual palettes for a photo, quickly
const palette = await getPalette(photo, 128, { colorSpace: 'oklab', precision: 6 });

// Retro look: 8 colours, dithered
const retro = await quantize(imageData, 8, { dither: true });

// Dithering a raw buffer needs its width
const out = await quantize(rgbaBytes, 32, { dither: 0.8, width: 640 });
```

#### Choosing a colour space

`'rgb'` is the default and the right choice for most photos. Measured on the 24 Kodak photos and the synthetic set, at 3 to 256 colours:

| You are making | Colours | Use | What the numbers say |
|---|---|---|---|
| Swatches, dominant colours | 3–8 | `'rgb'` | Keeps more of the image's colourfulness (chroma retention 0.88–0.91 against 0.85–0.88 on photos); mean ΔE is tied. |
| PNG-8 and web compression | 64–256 | `'rgb'` for PSNR, `'oklab'` for ΔE | RGB has about 0.7–1.1 dB more PSNR on every photo; OKLab has about 4% lower ΔE at 256 colours (better on 22 of 24 photos). |
| Dithered GIF, retro look | 8–64 | `'rgb'` | Looks closer from a distance: blurred ΔE 2.59 against 2.86 at 16 colours. |
| Flat graphics, logos, pixel art | 8–32 | either | About equal. |
| Smooth gradients and skies, not dithered | 8–64 | `'oklab'` | Mean ΔE 11.0 against 13.4 at 8 colours on the synthetic gradients (two images, so a hint). |
| Noisy or very varied images | any | `'oklab'` | Mean ΔE 7.0 against 7.9 at 64 colours (one synthetic image). |

`'oklab'` also takes 10–25% longer. Pixel values are treated as sRGB whatever the canvas colour space; a wide-gamut `ImageData` (`display-p3`) comes back in its own colour space, unshifted, but `'oklab'` is then approximate.

How the options trade speed and quality, measured on the Kodak photos:

| Setting | 16 colours ΔE2000 | 256 colours ΔE2000 | One 64-colour palette |
|---|---|---|---|
| default (`rgb`, exact) | **4.31** | 1.67 | 70 ms |
| `precision: 6` | **4.29** | 1.68 | 24 ms |
| `colorSpace: 'oklab'` | 4.46 | **1.60** | 78 ms |
| `colorSpace: 'oklab', precision: 6` | 4.44 | 1.61 | 30 ms |
| libimagequant, for reference | 4.38 | 1.61 | 79 ms |

#### Transparency

Three things in this library are about alpha, and they act at different stages:

| | What it is | Stage | Effect |
|---|---|---|---|
| `'rgba'` input | The format of the pixels (bare `Uint8Array` and `ImageData` are RGBA; `{ data, format: 'rgb' }` has none) | input | RGB images have no alpha, so nothing below applies to them. |
| `alpha` | An option: `'weight'` (default) or `'ignore'` | clustering | `'weight'` counts each RGBA pixel in proportion to its opacity, so transparent pixels don't count; `'ignore'` counts every pixel fully, as 1.x did. Each pixel keeps its own alpha in the output. |
| `transparent` | An option: `false` (default), `true`, or an alpha cutoff `1`–`255` | clustering; indexed output | Pixels with alpha below the cutoff (128 for `true`) are left out of clustering and the rest count whole; indexed output gives them one transparent entry, counted in `k`. |

Give one or the other: `transparent` replaces `alpha`, so naming both is an error. Use `alpha` (the default) for swatches and for images that keep each pixel's alpha, and `transparent` when the destination has one transparent colour, as GIF and palette PNG do, in the clustering step too, so the palette you cut is the one you map with. Translucent palette colours are not supported.

The cutoff decides which side a half-transparent pixel falls on. With the default (128), a soft drop shadow under 50% opacity disappears, and the darker part of it becomes solid; raise the cutoff (`transparent: 200`) to drop more of it, or lower it to keep more.

### Palette and Clustering
The palettes and clusterings this library returns are ordinary `Uint8Array`s with a hidden tag: what they are and, for a palette, the colour space it was made in. Anything that takes bytes takes them, and their `constructor` is `Uint8Array`, so `expect(palette).toEqual(new Uint8Array([...]))` passes in your tests. The tags buy three things:

- **A palette maps in the space it was made in.** `quantizeWithPalette(image, palette)` matches an OKLab palette in OKLab without being told; name a `colorSpace` to override it. Plain bytes are matched in RGB.
- **A clustering can't be passed as a palette**, or the other way round. TypeScript rejects it, and at run time it throws (`invalid-argument` or `invalid-clustering`), with no guessing about bytes.
- **`new Palette(bytes, colorSpace)` and `new Clustering(bytes)` give bytes their type back**, and check them: `new Palette([300, 0, 0])` throws rather than wrapping 300 to 44, and `new Clustering(bytes)` throws `invalid-clustering` unless they are one. The functions still accept a clustering as plain bytes, so stored clusterings keep working in JavaScript; TypeScript wants the constructor.
- **A clustering is checked before it is used.** Clusterings carry a checksum, so stored bytes that came back damaged (truncated, a changed byte, a lossy base64 round trip) are reported as `invalid-clustering` rather than cut into a wrong palette.

```js
import { Clustering, Palette, getPaletteFromClustering } from 'agglomerative-clustering';

const stored = new Uint8Array(await db.get('clustering'));       // what storage gives back: plain bytes
const clustering = new Clustering(stored);                        // typed again, and checked
const palette = await getPaletteFromClustering(clustering, 8);
palette instanceof Palette;                                       // true
palette.colorSpace;                                               // 'rgb' or 'oklab', as it was clustered
palette.slice(0, 3) instanceof Palette;                           // false: slice, subarray and clones are plain bytes
```

`slice`, `subarray`, `structuredClone`, `postMessage` and storage give plain, untagged `Uint8Array`s (the worker entry carries the tags across for you). In Node, `console.log` shows the tag: `Palette(oklab) Uint8Array(6) [ … ]`.

**Storing a palette.** Storage keeps a palette's bytes but not its colour space, and plain bytes are matched in RGB. So an OKLab palette that you store and read back maps differently from the one you stored, without an error. Store the colour space with it and give it back:

```js
await db.put('palette', { bytes: Array.from(palette), colorSpace: palette.colorSpace });
const { bytes, colorSpace } = await db.get('palette');
const restored = new Palette(bytes, colorSpace);   // maps exactly as the palette you stored
```

A clustering needs none of this: its colour space is in its bytes.

### Cancelling and progress
Every function that takes an image accepts `signal`; the ones that cluster (`getClustering`, `getPalette`, `getSwatches`, `quantize`, `quantizeToIndices`) also accept `onProgress`:

```js
const controller = new AbortController();
const clustering = await getClustering(image, {
  signal: controller.signal,                       // controller.abort() cancels it
  onProgress: (fraction) => bar.value = fraction,  // 0 to 1
});
```

- **Slices.** With either option, clustering runs in slices of about 10 ms (a large image has a few unsliced steps of up to 150 ms in between), so an abort takes effect within a slice and the page stays responsive. The result is the same; slicing costs about 5% more time.
- **Aborting** rejects with the signal's `reason` (an `AbortError` by default), like `fetch`. It is not one of this library's errors, and has none of their codes (a `DOMException`'s `code` is a number). To tell an abort from a failure, check your signal (`signal.aborted`), not the error: a reason you gave (`controller.abort(new Error('superseded'))`) keeps its own name. An already aborted signal does no work.
- **Mapping can't be interrupted** (it takes milliseconds: 6 ms at 768×512, 27 ms dithered). The functions that only map check the signal before they start, and don't take `onProgress`.
- **Progress** is approximate, never goes backwards, and ends at exactly 1.
- **In a worker** the work in the worker stops too, and a call still queued is removed without running. The worker keeps running for later calls.

### Errors

Every error the library throws is an `Error` with a `code`, so you don't have to match on message text (except an abort, which rejects with the signal's own `reason`).

When an error is about one argument, `error.argument` names it: `'image'`, `'k'`, `'clustering'`, `'palette'`, `'options'`, `'colorSpace'` (from `new Palette`), or `'options.<name>'` (for example `'options.colorSpace'`), so a form can point at the right field. Arguments are checked in the order you pass them, so the error is about the first that is wrong.

| `code` | When |
| --- | --- |
| `invalid-argument` | A bad image, `k`, option or palette. |
| `invalid-clustering` | Bytes that aren't a clustering this version can read, or a stored clustering that came back damaged (its checksum or its records don't fit). |
| `unsupported-version` | A clustering from a newer format, or using a colour space it doesn't know (upgrade the package), or an older one without what you asked for (cluster again, e.g. for `getSwatchesFromClustering`). |
| `out-of-memory` | The WebAssembly module couldn't allocate. |
| `wasm-load-failed` | The WebAssembly module couldn't be loaded or compiled: a missing or blocked `.wasm` file, a server bundle that moved it, a browser without SIMD, or a `.wasm` from a different version of the library than the script (a stale cache or CDN copy; the message names both versions). The message leads with the engine's reason and says what to check, and `cause` is the engine's own error. |
| `worker-terminated`, `worker-failed`, `invalid-handle` | Worker entry only: the worker was stopped, failed, or a handle was released. `worker-terminated` is for calls running or waiting when `terminate()` was called, and every later call on that `createWorker()` worker, so retrying on it can't help (the shared worker starts again on the next call). After `worker-failed` (it couldn't start, crashed or exited), the next call starts a new worker. |

```js
import { getPaletteFromClustering, isCodedError } from 'agglomerative-clustering';

try {
  await getPaletteFromClustering(stored, 16);
} catch (error) {
  // isCodedError narrows the type in TypeScript, and is false for errors that aren't the library's (Node's ENOENT, an abort)
  if (isCodedError(error) && (error.code === 'unsupported-version' || error.code === 'invalid-clustering')) { /* cluster the image again */ }
  else { throw error; }
}
```

`errorCodes` lists every code, for code that forwards them (a wrapper package re-exporting them, a bridge between processes). `isCodedError` also accepts a plain object with a known `code` and a `message`, which is what an error becomes after Electron's IPC or a `postMessage`.

Messages are for people and may change. The worker entry fails the same way as the main entry, with your call's stack (the worker's is on `cause`). A failure that isn't the library's own, such as a WebAssembly trap, has no `code`.

### Worker entry
`agglomerative-clustering/worker` exports every function above, run in one shared worker started on first use, plus `terminate()`, which stops it (the next call starts a new one), and `createWorker(options?)`, which starts a worker of your own. A worker has every function as a method, plus:

- **`cluster(image, options?)`** keeps the image and its clustering in the worker, behind a handle with `getClustering()`, `getPalette(k)`, `getSwatches(k)`, `getClusteringInfo()`, `quantize(k, options?)`, `quantizeToIndices(k, options?)`, `quantizeWithPalette(palette, options?)` and `quantizeToIndicesWithPalette(palette, options?)`. A palette of plain bytes is matched in the handle's colour space, and `quantizeToIndices` uses the cutoff it was clustered with. Free it with `release()`, or declare it with `await using handle = await worker.cluster(image)`; a dropped handle is freed only when the garbage collector gets to it.
- **`terminate()`** stops the worker and rejects the calls still waiting.

`createWorker` takes `transfer`, `wasm` (see [Loading the WebAssembly module](#loading-the-webassembly-module)) and `script`: the URL (or in Node, the path) of a copy of the package's `dist/worker-thread.mjs`, for setups whose bundler doesn't emit the package's own. For the shared worker, `init({ script })` does the same, before any other call.

Calls run one at a time, in order. Results are transferred back without copying. Images are copied in, unless you create the worker with `createWorker({ transfer: true })`, which is faster but leaves your buffer empty. Only pixels that are a whole buffer of their own are transferred; a view into part of a larger buffer, such as a `subarray` or a small Node `Buffer`, is copied.

The entry is an ES module, with a CommonJS build for `require()` in Node and in Jest. In a browser bundle, import it rather than `require()` it: bundlers find the worker script only from the ES module, so the CommonJS build there needs `createWorker({ script })`.

### TypeScript
Both entries ship declarations, checked in CI under strict mode with `nodenext` (ES module and CommonJS importers), `bundler`, and a Node-only project without the DOM lib. The worker entry's declarations use `await using` for handles, so they need **TypeScript 5.2 or newer** (or `skipLibCheck: true`); the main entry works on older versions. Both entries have CommonJS declarations too, so a `.cts` file or a CommonJS project imports either.

Results narrow: checking `result.indexBits === 8` makes `indices` a `Uint8Array`, and checking `info.formatVersion === 3` makes `mse`, `explained` and `totalWeight` present. Palette parameters take a `PaletteLike` (a `Palette`, plain bytes or a `number[]`, not a `Clustering`), and errors are `CodedError`s with `code` and `argument`.

An image object assigned to a variable before it is passed widens `format: 'rgba'` to `string`, which no longer matches `RawImage`: write `format: 'rgba' as const`, or declare the variable as `RawImage`.

## API

### `getClustering(image, options?): Promise<Clustering>`
Builds the colour hierarchy for an image. Pass the result to `getPaletteFromClustering` or `quantizeFromClustering` to get any number of palettes without clustering again.

Options: `colorSpace`, `precision`, `alpha`, `transparent`, `signal`, `onProgress`.

### `getPaletteFromClustering(clustering, k): Promise<Palette>`
Cuts a clustering to at most `k` colours, returned as flat RGB bytes. This takes well under a millisecond. Colours come in split order: index 0 is the dominant colour at two colours and keeps its place as the palette grows (it is not always the heaviest entry of a larger palette), and the palette for `k + 1` is the palette for `k` with one entry refined (the larger half of a split keeps its parent's place) and the smaller half appended. Accepts clusterings from 2.x too. `k` is a maximum: an image with fewer distinct colours gives fewer entries.

### `getPalette(image, k, options?): Promise<Palette>`
`getClustering` followed by `getPaletteFromClustering`.

Options: `colorSpace`, `precision`, `alpha`, `transparent`, `signal`, `onProgress`.

### `getSwatches(image, k, options?): Promise<Swatches>`
A palette with how much of the image each colour covers, for swatches with percentages. It returns `{ palette, weights, shares }`, three arrays from one cut of one clustering, so entry `i` of each describes the same colour:
- `palette` is flat RGB bytes in split order (what `getPaletteFromClustering` gives).
- `weights` are pixels per colour. Fully transparent pixels count 0 and partly transparent ones in proportion to their opacity, as in clustering; with `alpha: 'ignore'` every pixel counts 1.
- `shares` are the weights divided by their total, so they sum to 1.

All three are empty for an image with no visible pixels, and `k` is a maximum, so lay swatches out from the arrays' length, not from `k`. It clusters the image each time: to try several sizes, use `getClustering` once and `getSwatchesFromClustering`.

Options: `colorSpace`, `precision`, `alpha`, `transparent`, `signal`, `onProgress`.

### `getSwatchesFromClustering(clustering, k): Promise<Swatches>`
The same from a clustering you already have, well under a millisecond. Needs a clustering from 3.x: 2.x clusterings don't record weights, so they are rejected.

### `getClusteringInfo(clustering): Promise<ClusteringInfo>`
What a clustering holds: `{ formatVersion, colorSpace, precision, transparent, maxColors, totalWeight, mse, explained }`.

- `formatVersion`: the format of its bytes (compare it with the exported `formatVersion`).
- `transparent`: the alpha cutoff it was made with, or `false`. `quantizeToIndicesFromClustering` uses it by default.
- `maxColors`: the largest palette it can be cut to.
- `mse[k - 1]`: the mean squared error per channel of the `k`-colour clustering, in 8-bit RGB values (OKLab units for an OKLab clustering). `mse[0]` is the image's variance, and `mse[maxColors - 1]` is 0 at the default `precision: 8` (below 8, it is the error that grouping colours discarded). It is an estimate from merge costs; mapping pixels to the palette usually lowers it by another 10–15%.
- `explained[k - 1]`: `1 - mse[k - 1] / mse[0]`, the share of the image's variance the `k`-colour palette keeps, from 0 to 1. It has no units, so a target such as `0.99` means the same in both colour spaces.

For a 2.x clustering, `formatVersion` is 2 and `totalWeight`, `mse` and `explained` are `null`; in TypeScript, checking `info.formatVersion === 3` narrows them to present.

### `quantize(image, k, options?): Promise<the type of image>`
Reduces the image to at most `k` colours.

Options: `colorSpace`, `precision`, `alpha`, `transparent`, `dither`, `width`, `signal`, `onProgress`.

### `quantizeFromClustering(image, clustering, k, options?): Promise<the type of image>`
Quantizes using a clustering you already have.

Options: `colorSpace` (defaults to the clustering's), `dither`, `width`, `signal`.

### `quantizeWithPalette(image, palette, options?): Promise<the type of image>`
Maps each pixel to its nearest colour in any palette: a `Palette`, or flat RGB bytes (a `Uint8Array`, `Uint8ClampedArray`, or plain array of integers 0–255; flatten an array of `[r, g, b]` colours first with `colors.flat()`). A `Palette` is matched in its own colour space and plain bytes in RGB, unless you name a `colorSpace`. The result doesn't depend on the palette's order: equally near colours are decided by their RGB value.

Options: `colorSpace` (defaults to the palette's own), `dither`, `width`, `signal`.

### `quantizeToIndices(image, k, options?): Promise<IndexedImage>`
Like `quantize`, but returns each pixel's palette index rather than its colour: what palette PNGs, GIFs, pixel art and pattern generators need.

Options: `colorSpace`, `precision`, `alpha`, `transparent`, `dither`, `width`, `signal`, `onProgress`.

The result is `{ palette, colors, indices, indexBits, transparentIndex }`, plus `width` and `height` when the input has them:
- `palette`: the flat RGB bytes an encoder wants, including the transparent entry if there is one.
- `colors`: the same without the transparent entry, to pass to `quantizeToIndicesWithPalette` for more images with these colours.
- `indices`: one per pixel, a `Uint8Array` for up to 256 entries, `Uint16Array` up to 65536, else `Uint32Array`; `indexBits` (8, 16 or 32) says which.
- `transparentIndex`: the transparent entry's index, or `null`.

With `transparent`, RGBA pixels below the cutoff get the transparent entry (appended after the colours, and counted in `k`) and every other pixel is shown fully opaque, which is all a GIF can express, so anti-aliased edges snap to one side. The colours are chosen from the visible pixels, the same as `getPalette(image, k - 1, { transparent: true })` when the image has pixels below the cutoff; when it has none there is no transparent entry, and all `k` entries are colours. At least one colour is always kept. See [Transparency](#transparency).

```js
const { palette, colors, indices, transparentIndex } = await quantizeToIndices(imageData, 256, { transparent: true });
```

### `quantizeToIndicesFromClustering(image, clustering, k, options?): Promise<IndexedImage>`
The same as `quantizeToIndices`, from a clustering you already have. The default cutoff is the one the clustering was made with (`getClusteringInfo(clustering).transparent`), so clustering and mapping agree unless you name another.

Options: `colorSpace` (defaults to the clustering's), `dither`, `width`, `signal`, `transparent`.

### `quantizeToIndicesWithPalette(image, palette, options?): Promise<IndexedImage>`
The same as `quantizeToIndices`, with a palette you supply. There is no `k`: the transparent entry is added to the palette you give, so a 256-colour palette gives 257 entries.

Options: `colorSpace` (defaults to the palette's own), `dither`, `width`, `signal`, `transparent`.

### `init(options?): Promise<void>`
Loads the WebAssembly module. Every other function does this on first use, so calling it is optional, for example to warm up before a batch. Concurrent calls share one load, and a failed load can be retried. To say where the module is, see [Loading the WebAssembly module](#loading-the-webassembly-module).

### `errorCodes: readonly string[]` and `isCodedError(value): boolean`
`errorCodes` is a frozen array of every `code` the library's errors have (see [Errors](#errors)). `isCodedError(value)` is true when `value` has a string `message` and one of those codes; in TypeScript it narrows to `CodedError`. Both entries export both.

### `version: string` and `formatVersion: number`
`version` is the library's version (such as `'3.0.0'`), for bug reports and runtime checks. `formatVersion` is the version of the data it stores (the clustering format), which changes only when that format does: if a stored clustering's `getClusteringInfo(stored).formatVersion` differs, cluster the image again (2.x clusterings still load, but have no weights). Both entries export both, and a `.wasm` from another version fails to load with `wasm-load-failed`.

## Running it

### Where it runs

Node 20.19+ and 22.12+ (CI tests Node 20, 22 and 24, on Linux and Windows), and browsers with WebAssembly SIMD: Chrome and Edge 91, Firefox 89, Safari 16.4 or newer ([support table](https://caniuse.com/wasm-simd)). CI bundles a test page with Vite and webpack 5 and runs it in Chromium, Firefox and WebKit on Linux and in Safari on macOS. In a browser without SIMD, or where the `.wasm` is blocked or missing, `init` and every other call reject with a `wasm-load-failed` error.

CI also loads `dist/` from another origin, as a page using a CDN does, and the worker entry from a sandboxed iframe, in the same browsers, and runs both entries under Jest. Checked by hand, not in CI: Deno 2.9, Bun 1.4, Cloudflare Workers (Wrangler, workerd), Vercel's edge runtime, SvelteKit and Nuxt, Next.js and Parcel 2 (see below).

### From a CDN, without a build step

```html
<script type="module">
  import { getSwatches } from 'https://cdn.jsdelivr.net/npm/agglomerative-clustering@next/dist/index.mjs';
  import { createWorker } from 'https://cdn.jsdelivr.net/npm/agglomerative-clustering@next/dist/worker.mjs';
</script>
```

Import `dist/index.mjs` and `dist/worker.mjs` by their paths (jsDelivr and unpkg don't follow the package's `exports` for subpaths such as `/worker`); `https://esm.sh/agglomerative-clustering@next` works too. The `.wasm` is found next to the script, so `init` needs no `wasm` option, and the worker entry starts its worker through a `blob:` script (browsers don't start workers from another origin's script). A Content-Security-Policy needs the CDN in `script-src` and `connect-src` (the `.wasm` is fetched) and `'wasm-unsafe-eval'` in `script-src`. The worker entry also needs `worker-src blob:` *and* the CDN, since the `blob:` worker imports its script from there: `worker-src blob: https://cdn.jsdelivr.net`. Pin an exact version in production, as `@3.0.0` rather than `@next`.

### Deno, Bun and Cloudflare Workers

- **Bun** needs nothing: `bun add agglomerative-clustering`, then both entries work as in Node.
- **Deno**: `import { getPalette } from 'npm:agglomerative-clustering@next'`, run with `--allow-read` (the `.wasm` is read from the package). Importing from a CDN URL works too, without it. The worker entry runs on Deno's `worker_threads`, which is about 3 times slower per call than the main entry; for a few calls, use the main entry. Deno doesn't install npm versions less than a day old by default, so on the day of a release it may quietly install the previous one (`"minimumDependencyAge": 0` in `deno.json` turns that off; the exported `version` says what you got).
- **Cloudflare Workers**: Wrangler imports a `.wasm` file as a compiled module, so give it to `init` before the first call. There are no threads, so use the main entry.

  ```js
  import { init, getSwatches } from 'agglomerative-clustering';
  import wasm from 'agglomerative-clustering/clustering.wasm';

  const ready = init({ wasm });
  export default {
    async fetch(request) {
      await ready;
      // … decode the upload to pixels (fast-png works here), then getSwatches(pixels, 8)
    },
  };
  ```

### Loading the WebAssembly module
By default the module is found next to the package's script, which Node and bundlers such as Vite handle. Otherwise, say where it is before any other call (the first load that succeeds wins):

```js
await init({ wasm: 'https://cdn.example.com/clustering.wasm' });      // a URL or path string, or a URL
await init({ wasm: await (await fetch(url)).arrayBuffer() });          // the bytes
await init({ wasm: wasmModule });                                      // a compiled WebAssembly.Module
```

The package exports the file as `agglomerative-clustering/clustering.wasm`, so a bundler that imports `.wasm` files as compiled modules (Wrangler, for Cloudflare Workers) can give you `wasmModule`. In Node a path or `file:` URL is read from disk, also when the package is bundled into CommonJS. A strict Content-Security-Policy needs `'wasm-unsafe-eval'` in `script-src`. `createWorker({ wasm })` passes the same option to a worker.

### SvelteKit, Nuxt and other frameworks

SvelteKit (adapter-node) and Nuxt (Nitro's node-server) need no configuration, in development and production builds: the worker entry for pages, the main entry in server routes. Importing either entry during server rendering is safe, and `createWorker()` starts no thread until its first call. On Nitro's Cloudflare preset, turn on `nitro: { experimental: { wasm: true } }` and pass the module from `import wasm from 'agglomerative-clustering/clustering.wasm?module'` to `init`, as for the Edge runtime below.

### Next.js

Checked with Next.js 16, under Turbopack and webpack, in production builds:

- **Client components** need nothing: the main entry and the worker entry both work as they are.
- **Route handlers and Server Components** (the Node runtime) work as they are too. A server bundle moves the package's files away from each other, so the library then loads `clustering.wasm` and the worker script from the package in `node_modules`, found from the directory the server runs in. If your deployment doesn't ship `node_modules` with the server (a `standalone` output copied elsewhere, say), leave the package out of the bundle instead, which keeps its files together:

  ```js
  // next.config.js
  export default { serverExternalPackages: ['agglomerative-clustering'] };
  ```
- **The Edge runtime** can't fetch or compile a `.wasm` file itself, so import the module and pass it to `init`. The import has to be a relative path to the file (the bundler drops the `?module` query from a package path):

  ```ts
  import { init, getSwatches } from 'agglomerative-clustering';
  // @ts-expect-error -- `?module` gives a compiled WebAssembly.Module
  import wasm from '../../../node_modules/agglomerative-clustering/dist/clustering.wasm?module';

  export const runtime = 'edge';

  export async function POST(request: Request) {
    await init({ wasm });   // loads once; later calls return at once
    // … decode the upload to pixels, then getSwatches(pixels, 8)
  }
  ```

### Angular, esbuild, Rollup and other bundlers

The main entry works in all of them. The worker entry needs its script (`worker-thread.mjs`, which imports the package's other files) next to the rest of `dist/`, and some bundlers emit neither it nor `clustering.wasm`. Then a worker call fails at run time with `worker-failed` or `wasm-load-failed`, often only after deploying, because a dev server serves `node_modules` as it is. Copy the package's `dist/` files out as static assets and say where they are:

```js
import { createWorker } from 'agglomerative-clustering/worker';
const worker = createWorker({
  script: '/assets/agglomerative-clustering/worker-thread.mjs',   // relative URLs resolve against the page
  wasm: '/assets/agglomerative-clustering/clustering.wasm',
});
```

- **Angular** (the default `application` builder): add the files to the app's `angular.json` assets, then use the code above.

  ```json
  "assets": [{ "glob": "{worker-thread.mjs,shared.mjs,index.mjs,clustering.js,clustering.wasm}", "input": "node_modules/agglomerative-clustering/dist", "output": "assets/agglomerative-clustering" }]
  ```
- **esbuild, Rollup and `bun build`** do not recognise `new Worker(new URL(...))`, so copy the same files into the output and give `script` (and `wasm`). Rollup users can also build `worker-thread.mjs` as a second entry.
- **Vite, webpack 5 and Rsbuild** find the script themselves. So does **Parcel 2**, once it reads package `exports` (without this it can't resolve `agglomerative-clustering/worker`):

  ```json
  "@parcel/resolver-default": { "packageExports": true }
  ```
  in your `package.json`.
- **The main entry** can also be told where the `.wasm` is with `init({ wasm })`.
- **A server bundle** (esbuild or Rollup with a Node target, CommonJS or ES module): leave the package external if you ship `node_modules`. Bundled, it finds its files from the working directory, if at all: pass `init({ wasm: path })` and `createWorker({ script: path })`, with paths to copies of `dist/` that you ship.

### Electron

Everything works in dev and in an app packaged with `asar` (no `asarUnpack`), in the renderer, the main process and a `utilityProcess`, loaded from `file://`, a custom scheme or a dev server. For responsiveness, **decode in the renderer and use `agglomerative-clustering/worker`** there: the main entry in the main process blocks the whole app for the length of a clustering. Two traps:

- **Keep the package external in a bundled main process** (electron-vite does by default; with webpack or esbuild mark it external). A bundle that inlines it finds the `.wasm` and worker script only when the app starts from the project directory, which a packaged app doesn't. If you must bundle it, pass `init({ wasm })` for the main entry and `createWorker({ script })` for the worker.
- **`nodeIntegrationInWorker: true`** is supported: the worker script talks through `self` there.

Errors lose their `code` and `argument` crossing Electron's IPC (only the message survives), so send `{ message, code, argument }` yourself; `isCodedError` accepts that object on the other side. `nativeImage` gives BGRA pixels: swap the channels to RGBA first.

### Browser extensions

The main entry runs in every extension context: a Manifest V3 service worker, an offscreen document, extension pages and content scripts (a page's own Content-Security-Policy does not apply to the main entry in a content script). Tested in Chrome and in Firefox's extension pages and background.

- **Manifest CSP.** Compiling WebAssembly in the service worker, an offscreen document or an extension page needs `'wasm-unsafe-eval'` (not `'wasm-eval'`, which Chrome refuses in a manifest): `"content_security_policy": { "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" }`. The main entry in a content script needs nothing.
- **A service worker has no `Worker`**, so use the main entry there, which already keeps the page's thread free. The worker entry works in an offscreen document or an extension page. In a content script it starts its worker through a `blob:` URL, and that worker follows the *page's* policy, so it works only on pages whose CSP allows `worker-src blob:` and `'wasm-unsafe-eval'` (or has no CSP); on other pages, use the main entry in the content script, or hand the pixels to an offscreen document.
- **Files.** With Vite and CRXJS the `.wasm` and worker script are emitted and made web-accessible for you. Without a bundler, copy `dist/*.mjs`, `clustering.js` and `clustering.wasm` into the extension and list them under `web_accessible_resources` if a content script loads them (all of them: a `.wasm` left out fails as "could not be fetched", and only the browser's console names the key).
- A service worker can fetch cross-origin images with host permissions (a content script gets a tainted canvas), so cluster there. Typed arrays become plain objects through `chrome.runtime.sendMessage`: convert with `Array.from(palette)` and back with `new Uint8Array(...)`.

### Plugins and single-file hosts: Figma, VS Code, Obsidian

Some hosts load a plugin as one file, or a few fixed ones, so the package's `.wasm` and worker script can't sit next to it. Embed them, and say where everything is: in these hosts the package can't find its own files. (Tested against stand-ins for these hosts: a sandboxed iframe, a Node host process, an Electron renderer. Not inside the apps themselves.)

- **The `.wasm` as bytes.** Import it with your bundler's binary loader (esbuild: `--loader:.wasm=binary`, importing `agglomerative-clustering/clustering.wasm`) and pass the bytes: `init({ wasm: bytes })` for the main entry, `createWorker({ wasm: bytes })` for a worker. Set esbuild's `target` (such as `es2022`), or the decoder it emits may use `Uint8Array.fromBase64`, which not every runtime has. The file is about 92 KB, 122 KB as base64, and 54 KB gzipped then base64 (decompress it with `DecompressionStream` before passing it).
- **The worker script as a `data:` URL.** Bundle `node_modules/agglomerative-clustering/dist/worker-thread.mjs` into one ES module (esbuild `--bundle --format=esm`) and pass it as `createWorker({ script: 'data:text/javascript;base64,…', wasm: bytes })`. In a sandboxed iframe (Figma's UI) a `blob:` worker fails in Chromium; a `data:` one works. The main entry alone is often enough for a plugin's images, and needs only the bytes.
- **VS Code.** The extension host is Node: bundle your extension with the package external and ship it in `node_modules`, or bundle it and pass a path to a `.wasm` you ship (`init({ wasm: path.join(context.extensionPath, 'dist', 'clustering.wasm') })`); a bundled extension otherwise looks for the package from the working directory, which is not your extension's. A webview's CSP needs `'wasm-unsafe-eval'` in `script-src`, and `worker-src` for the worker entry.
- **Obsidian** ships `main.js`, `manifest.json` and `styles.css` only, so embed the `.wasm` bytes. Its renderer has Node's globals and a real `Worker`, so both entries work once given the bytes (and, for workers, the `data:` script).
- **Copying `dist/` files instead**, keep their `.mjs` names: they are ES modules by their extension. Renamed to `.js`, they need a `package.json` with `"type": "module"` next to them.
- **Get it wrong** and the error says so: a bundled main entry without its `.wasm` fails with `wasm-load-failed` asking for `init({ wasm })`, and a worker without its script with `worker-failed` naming `createWorker({ script })`.

### Testing code that uses it

- **Vitest** needs no configuration, in node, jsdom, happy-dom and browser mode. **Storybook** (Vite builder) works as it is.
- **Jest** works in its default CommonJS mode, in the node and jsdom environments, with both entries, without transforms or `--experimental-vm-modules` (both have CommonJS builds). Mocha and `node:test` work too.
- **jsdom and happy-dom** have no `ImageData` (install `canvas`, `@napi-rs/canvas` or `skia-canvas`, or pass `{ data, format: 'rgba', width }`) and no `Worker`: the worker entry then uses a Node worker thread, which is fine for tests. Results come back in the class of the `ImageData` you passed.
- **Leaks.** Call `terminate()` (from `agglomerative-clustering/worker`, or on a `createWorker()`) in `afterAll`. It doesn't stop Jest from exiting, but each test file otherwise leaves a worker thread, 15 to 30 MB, in the process until the run ends.
- **Mocking.** Mock the module with a factory (`vi.mock('agglomerative-clustering', () => ({ getPalette: vi.fn(...) }))`), or in Vitest keep the real `Palette` with `importOriginal`. Build fake palettes with `new Palette(bytes, colorSpace)`, and fake errors as `Object.assign(new Error(message), { code: 'invalid-argument' })` (`isCodedError` accepts them).
- **Snapshots.** Palettes (and swatches, indices, mapped pixels) are identical across platforms, Node versions and browsers, and stay the same within a major version: snapshot them. Clustering bytes are not promised to stay the same, so don't hash them. `toEqual` doesn't see a palette's `colorSpace`: compare it explicitly.
- Fake timers don't affect it. An unawaited call still running at the end holds Jest open until it finishes.

### Writing a package that wraps it

Make `agglomerative-clustering` a **`peerDependency`** and keep it **external** in your build (tsup `external`, Rollup `external`): the app's bundler then finds the worker script and `.wasm` once, with one copy in the output. Bundling it into your package leaves `./worker-thread.mjs` unresolved. Re-export `errorCodes`, `isCodedError` and the types you need (`CodedError`, `ErrorCode`, `ClusteringOptions`, …), check `version` against your supported range at run time, and let your users pass `wasm` and `script` through. Importing it on the server (SSR) doesn't run anything: only calls load the module.

### Performance and limits

**Servers.** Cap the pixel count of uploads (check the header's dimensions before decoding, as sharp's `limitInputPixels` does), use `precision: 6` (it bounds the memory an image with very many colours needs), and run the work in workers so a clustering doesn't block the event loop. One worker runs one call at a time, so create a few:

```js
import { createWorker } from 'agglomerative-clustering/worker';

// Four workers; each call goes to the one with the least work waiting.
const pool = Array.from({ length: 4 }, () => ({ worker: createWorker(), waiting: 0 }));
const run = async (method, ...args) => {
  const slot = pool.reduce((best, next) => (next.waiting < best.waiting ? next : best));
  slot.waiting++;
  const call = slot.worker[method];
  try {return await call(...args);} finally {slot.waiting--;}
};

// In a request handler (Fastify shown): stop the work if the client goes away. In Node, listen on the response's
// 'close' (reply.raw, or res in Express), not the request's.
const controller = new AbortController();
reply.raw.on('close', () => {if (!reply.raw.writableFinished) {controller.abort();}});
const swatches = await run('getSwatches', image, 8, { precision: 6, signal: controller.signal });
```

- **Small images wait behind large ones** in a shared pool. If you serve both, give large uploads a pool of their own.
- **Memory:** one image can need up to 2 GB in a worker, so a pool of four can peak near 8 GB on hostile input; a pixel cap and `precision: 6` keep it to a fraction of that. Memory comes back after a large image (below).
- **Stored clusterings:** make them with `precision: 6`. An exact clustering of a noisy 4-megapixel image is 78 MB, against 5.5 MB at `precision: 6`. Read back, wrap the bytes once with `new Clustering(bytes)` and keep that object while you use it: its checksum is checked the first time an object is used (2 to 3 ms for a photo's clustering).
- Running out of memory is a catchable `out-of-memory` error, and `terminate()` on each worker shuts the pool down.

**Large images.** Time and memory grow with the number of *distinct colours*, not just pixels: a 12-megapixel photo takes 2 to 8 s exact (0.2 to 0.9 million distinct colours) and 0.1 to 0.4 s with `precision: 6`, and 36 megapixels of random noise (the worst case) about 6 s with `precision: 6`. (Times are from an idle machine; a busy or throttled one, a laptop on battery or a CI runner can be several times slower.) One WebAssembly instance can use up to 2 GB; an image that needs more is rejected with `out-of-memory`, and later calls work normally. WebAssembly memory only grows, so after a call that leaves it above 256 MB the library replaces the instance (the next call loads a fresh one, in milliseconds): a server's memory comes back down after a huge image instead of staying at its peak.

### Troubleshooting

| What you see | Why | What to do |
|---|---|---|
| `wasm-load-failed` | The `.wasm` is missing, blocked, served from another version, moved by a server bundle, or the browser has no WebAssembly SIMD. | Check the file is served and the Content-Security-Policy allows `'wasm-unsafe-eval'`; say where it is with `init({ wasm })`. In Next.js, see "Next.js". |
| `invalid-argument` naming a PNG, JPEG, … | You passed an image file's bytes, not pixels. | Decode it first (canvas or `createImageBitmap` in a browser, sharp in Node). |
| A palette of nonsense, no error | RGB bytes were passed bare, so they were read as RGBA. | Pass `{ data, format: 'rgb', width }`, or add an alpha channel (`sharp(...).ensureAlpha()`). |
| `invalid-argument` for a canvas, `Blob` or `ImageBitmap` | Those aren't pixels. | Draw to a canvas and pass `getImageData()`. |
| The palette isn't sorted by how much of the image each colour covers | Palettes come in split order, so they nest. | Sort by `shares` (see "Using the output"), or accept the order. |
| `quantizeWithPalette` maps differently from a plain-bytes palette | A `Palette` is matched in the space it was made in, unless you name one. | Pass `colorSpace` explicitly if you want a specific space. |
| A stored OKLab palette maps differently from when it was made | Storage dropped its colour space, so it is matched in RGB. | Store `palette.colorSpace` too and restore it with `new Palette(bytes, colorSpace)` (see "Palette and Clustering"). |
| `invalid-clustering` for a clustering you stored | Its bytes changed in storage (truncated, re-encoded, mixed up). | Cluster the image again, and check how it is stored: as a binary blob, or base64 that is decoded in full. |
| `out-of-memory` | An image with very many distinct colours. | Use `precision: 6`, or a smaller image. |
| The worker doesn't start under a bundler (`worker-failed`, or a 404 for `worker-thread.mjs`) | The bundler didn't emit the worker script (Angular, esbuild, Rollup). | Copy the package's `dist/` files and pass `createWorker({ script })`: see [Angular, esbuild, Rollup and other bundlers](#angular-esbuild-rollup-and-other-bundlers). |
| Jest: "Must use import to load ES Module" (or "Cannot use import statement" for `/worker`) | An older package version; this one loads in Jest's CommonJS mode, both entries. | Upgrade to the latest `3.0.0-beta`. |
| `wasm-load-failed` mentioning a Content-Security-Policy | The page or extension forbids compiling WebAssembly. | Add `'wasm-unsafe-eval'` to `script-src`: the page's for the worker entry's worker, also from a content script. |
| `wasm-load-failed`: "is not WebAssembly" | An error page (a 404, or a server's fallback page) was served in place of `clustering.wasm`. | Open the `.wasm` URL in the browser; copy the file where it is expected, or say where it is with `init({ wasm })`. |
| `worker-failed` with the worker entry from a CDN, under a CSP | `worker-src` allows `blob:` but not the CDN the worker imports from. | `worker-src blob: <the CDN's origin>`. |
| TypeScript says a `Uint8Array` isn't a `Clustering` | Stored bytes lost their type. | `new Clustering(bytes)` (see "Palette and Clustering"). |

## More

- **[Migrating](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/migrating.md)** from 2.x (and 1.x) to the current version, and the [CHANGELOG](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/CHANGELOG.md) for every release.
- **[Stability and versioning](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/stability.md)**: what won't change within a major version.
- **[How it works](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/how-it-works.md)**: the algorithm, and the architecture notes for contributors in [CLAUDE.md](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/CLAUDE.md).
- **[Roadmap](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/ROADMAP.md)**: what is planned and what was tried and dropped.

### Demo

```sh
git clone https://github.com/RohanFredriksson/agglomerative-clustering && cd agglomerative-clustering
npm install && npm run build   # building needs Emscripten (em++) on your PATH
npm run demo                   # then open http://localhost:8080/demo/
```

The demo clusters an image once, then re-cuts and re-maps it live as you drag the palette-size and dithering sliders. You can switch colour space and precision, and drop in your own images.

## License

MIT © Rohan Fredriksson
