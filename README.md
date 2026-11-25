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
- **Accurate and fast.** The lowest average error of the six JavaScript quantizers we benchmarked, at about the speed of libimagequant ([benchmarks](#benchmarks)).
- **Small and portable.** About 86 KB of WebAssembly (41 KB gzipped)<!-- bench/spikes/slicing-mapping/results-size.txt -->, Node and browsers, TypeScript types, no runtime dependencies, deterministic output.

## Install

```sh
npm install agglomerative-clustering
```

Upgrading? See [Migrating](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/migrating.md). From 3.3, three functions have new names, and the old ones keep working until 4.0. From 2.x, one function was renamed, and palettes and images are the same as 2.0's, with one documented exception.

It runs on Node 22.12+, and in browsers with WebAssembly SIMD (Chrome and Edge 91, Firefox 89, Safari 16.4). Deno, Bun, Cloudflare Workers, serverless functions, Electron and browser extensions work too: see [Environments](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/environments.md).

## Usage

**In Node, with [sharp](https://sharp.pixelplumbing.com/):**

```js
import sharp from 'sharp';
import { buildPalette, quantize } from 'agglomerative-clustering';

const { data, info } = await sharp('photo.jpg').rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const image = { data, format: 'rgba', width: info.width };   // in TypeScript: format: 'rgba' as const

const palette = await buildPalette(image, 8);                   // flat bytes: [r, g, b, r, g, b, ...]
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
import { buildSwatches } from 'agglomerative-clustering';

const { palette, shares } = await buildSwatches(imageData, 6);   // six colours; the shares sum to 1
shares.forEach((share, i) => {
  console.log(`rgb(${palette[3 * i]} ${palette[3 * i + 1]} ${palette[3 * i + 2]})`, `${(share * 100).toFixed(1)}%`);
});
```

Entries keep their place as `k` grows (split order), so palettes nest. For hex strings, the largest share first or a dominant colour, see [Heaviest first](docs/guides.md#heaviest-first).

**A colour-count slider:** cluster once, then cut and map as often as you like.

```js
import { buildClustering, quantizeWithPalette } from 'agglomerative-clustering';

const clustering = await buildClustering(imageData);                   // the expensive step, done once

slider.oninput = async () => {
  const palette = await clustering.getPalette(Number(slider.value));        // ~0.4 ms for any k
  ctx.putImageData(await quantizeWithPalette(imageData, palette), 0, 0);   // ~5-12 ms at 768×512
};
```

Input is decoded pixels: a bare `Uint8Array` of RGBA bytes, an `ImageData`, or `{ data, format: 'rgb' | 'rgba' | 'bgra' | 'rgbx' | 'bgrx', width?, height? }`: BGRA for Electron's `nativeImage` and Windows bitmaps, and the `x` formats for buffers whose fourth byte isn't alpha (GDI screenshots, WebCodecs `'BGRX'`, ffmpeg `bgr0`). Alpha is straight, or premultiplied (canvas, Electron): pass `premultiplied: true` with `'rgba'` or `'bgra'`; [where pixels come from](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/api.md#input) lists common sources and what to pass for each. Mapped output of a premultiplied image comes back premultiplied (palettes and indices are straight), so for an `ImageData` or a PNG encoder use the [straight-output recipe](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/guides.md#straight-pixels-from-a-premultiplied-source). RGB bytes passed bare are read as RGBA; the library warns when it sees this (an error from 4.0), so pass them as `{ data, format: 'rgb' }`. To start from a PNG, JPEG, WebP or GIF file, decode it first: [Decoding image files](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/guides.md#decoding-image-files) has a recipe for Node, browsers and edge runtimes. For a page that stays responsive while it clusters, use `agglomerative-clustering/worker`: its functions are the same, and for a slider `createWorker().cluster(image)` keeps the image and its clustering in the worker, behind a handle whose `handle.getPalette(k)` and `handle.quantize(k)` re-cut and re-map without sending the pixels again (see [Workers](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/guides.md#workers)). The `clustering.…` methods above run on the calling thread, so they don't move work off it.

## How it works

```
 image ──▶ buildClustering ──▶ a clustering ──▶ cut to k colours ──▶ a palette ──▶ map the pixels ──▶ reduced image
           once, ~70 ms        bytes you can     under 1 ms,          flat RGB       a few ms,
                               store             any k                bytes          any palette
```

The one-shot functions (`buildPalette`, `quantize`, …) do every step for you. To try many palette sizes, call `buildClustering` once and cut it as often as you like.

| You want | from the image | from a clustering you hold¹ | with a palette you supply |
|---|---|---|---|
| a palette (flat RGB) | `buildPalette` | `clustering.getPalette(k)` | |
| a palette with each colour's share | `buildSwatches` | `clustering.getSwatches(k)` | |
| the image reduced to those colours | `quantize` | `clustering.quantize(image, k)` | `quantizeWithPalette` |
| palette indices (GIF, PNG-8) | `quantizeToIndices` | `clustering.quantizeToIndices(image, k)` | `quantizeToIndicesWithPalette` |
| its error curve, for choosing a palette size | | `clustering.getClusteringInfo()` | |
| the `k` entries of a fixed palette (threads, bricks) that best fit | | `clustering.chooseFrom(palette, k)` | |

A clustering you hold has **methods** that take the colours from it, and **`…WithPalette`** takes colours you supply; with neither, the image is clustered for you. `buildClustering` builds a clustering, and `init` loads the WebAssembly module (optional). Most code only needs the first column.

The verb says how much work a call does. `build…` clusters an image (tens of milliseconds for a photo). `get…` reads or cuts what a clustering or a worker handle already holds (well under a millisecond). `quantize…` maps pixels. So `buildPalette(image, k)` and `clustering.getPalette(k)` give the same kind of result from different starting points. The `build…` names arrived in 3.4.0; [Migrating](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/migrating.md) has the old ones.

**Where to call them.** On the main thread, or in a Node script, use the methods: they are the shortest way to cut one clustering many times. **Off the thread, use a handle**: `worker.cluster(image)` keeps an image and its clustering in the worker, and `worker.load(clustering)` keeps a stored clustering (`await using loaded = await worker.load(stored)`, then `loaded.getPalette(k)` and `loaded.quantize(image, k)`). The methods always run on the thread that calls them, with the main entry, and reject with `wasm-load-failed` where only the worker entry is imported.

¹ The `…FromClustering` functions (`getPaletteFromClustering(clustering, k)`, `quantizeFromClustering(image, clustering, k)` and the rest) do the same as the methods. They are deprecated from 3.8 and removed in 4.0: see [Migrating](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/migrating.md#deprecated-in-38-removed-in-40) for the replacement of each, and [Clustering methods](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/api.md#clustering-methods).

Palettes come in **split order**: the palette for `k + 1` is the one for `k` with one colour split in two, so entries keep their place as `k` grows (they are not sorted by share). The options are `precision` (6 is about 3× faster at practically the same quality), `colorSpace` (`'rgb'` or `'oklab'`), `alpha`, `transparent`, `dither` (Floyd–Steinberg, Atkinson, or ordered for animation, which keeps still areas still), `width`, `signal` and `onProgress`: see the [API reference](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/api.md).

## Use cases

**Good fits:**
- **Interactive tools where people choose the number of colours:** palette editors, posterisers, pixel art, embroidery, paint-by-number and knitting pattern generators, and LED, e-ink or limited-palette displays.
- **Several palette sizes for the same image,** or storing one clustering and cutting it later.
- **The most accurate palette for a given size,** for example as a starting point for vectorisation or flat-colour art.

**Better served by something else:**
- **Shrinking PNG files in a build pipeline.** Use [sharp](https://sharp.pixelplumbing.com/) or pngquant, which run libimagequant natively and are tuned for compression.
- **A handful of vivid "dominant" swatches for a UI theme.** [color-thief](https://lokeshdhakar.com/projects/color-thief/) or [node-vibrant](https://github.com/Vibrant-Colors/node-vibrant) are lighter and pick vivid or salient colours rather than the lowest-error ones.
- **Palettes that need their own alpha values,** as palette PNGs with translucent entries do. Pixels are weighted by opacity, but palette colours are opaque RGB, and each pixel keeps its own alpha.

## Benchmarks

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

All rows are from one run. Full results at every palette size, on synthetic images too, with ΔE2000 and the method, are in [bench/COMPARISON.md](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/bench/COMPARISON.md); reproduce them with `node bench/run.js`. These numbers are a snapshot, so expect them to move with the hardware and the versions.

## Documentation

- **[Guides](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/guides.md):** swatches and choosing a palette size, GIFs and palette PNGs, animations, live video, workers, fixed palettes (e-ink, thread, bricks), batches of images, converting the output, and moving from color-thief, node-vibrant or image-q.
- **[API reference](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/api.md):** input formats, options, choosing a colour space, transparency, `Palette` and `Clustering`, cancelling and progress, errors, the worker entry, TypeScript, and every function.
- **[Environments](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/environments.md):** CDNs, Deno, Bun, Cloudflare Workers, serverless functions, Next.js, Angular and other bundlers, Electron, browser extensions, plugin hosts, pnpm and Yarn, and testing.
- **[Performance and limits](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/performance.md):** servers and worker pools, memory, and large images.
- **[Troubleshooting](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/troubleshooting.md):** what an error or a surprising result means, and what to do.
- **[Migrating](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/migrating.md)** from 2.x and 1.x, and the [CHANGELOG](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/CHANGELOG.md).
- **[Stability and versioning](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/stability.md):** what won't change within a major version.
- **[How the algorithm works](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/how-it-works.md)**, with architecture notes for contributors in [CLAUDE.md](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/CLAUDE.md).
- **[Roadmap](https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/ROADMAP.md):** what is planned, and what was tried and dropped.

## Demo

```sh
git clone https://github.com/RohanFredriksson/agglomerative-clustering && cd agglomerative-clustering
scripts/setup-emsdk.sh && source ~/.local/share/emsdk/emsdk_env.sh   # Emscripten, the version CI uses
npm install && npm run build
npm run demo                   # then open http://localhost:8080/demo/
```

The demo clusters an image once, then re-cuts and re-maps it live as you drag the palette-size and dithering sliders. You can switch colour space and precision, and drop in your own images.

## License

MIT © Rohan Fredriksson
