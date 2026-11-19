# API reference

Both entries, `agglomerative-clustering` and `agglomerative-clustering/worker`, export the same functions; the worker entry runs them in a worker (see [Worker entry](#worker-entry)). For recipes, see the [guides](guides.md).

- [Terms](#terms)
- [Input](#input) and [output](#output)
- [Options](#options): [choosing a colour space](#choosing-a-colour-space), [choosing a dither method](#choosing-a-dither-method), [transparency](#transparency)
- [Palette and Clustering](#palette-and-clustering)
- [Cancelling and progress](#cancelling-and-progress)
- [Errors](#errors)
- [Worker entry](#worker-entry)
- [TypeScript](#typescript)
- [Functions](#functions)

## Terms

- **clustering**: the tree of an image's colours. It is opaque bytes (a `Clustering`) that you can store next to the image.
- **palette**: flat RGB bytes, `[r, g, b, r, g, b, …]`. A `Palette` knows the colour space it was made in.
- **k**: the most palette entries in what you get back, in every function. A flat palette has no transparent entry, so its entries are all colours; in indexed output with `transparent`, the transparent entry is one of the `k`, so `256` is the most a GIF holds. Fewer come back when the image has fewer distinct colours. The one exception: indexed output always keeps a colour for the visible pixels, so `k = 1` with a transparent entry gives 2.
- **split order**: palettes come out so that the palette for `k + 1` is the one for `k` with one colour split in two. Entries keep their place as `k` grows, but the palette is not sorted by share.
- **clustering and mapping**: "clustering" functions build a clustering (`getClustering`, `getPalette`, `getSwatches`, `quantize`, `quantizeToIndices`); "mapping" functions map pixels to a palette (`quantize`, `quantizeFromClustering`, `quantizeWithPalette` and the indexed versions). A function that does both takes both sets of options.

## Input

Every function that takes an image accepts:

```ts
Uint8Array                                   // raw RGBA bytes
ImageData                                    // from a canvas: always RGBA, width included
{ data: Uint8Array | Uint8ClampedArray,      // explicit format, for RGB data or clamped arrays
  format: 'rgb' | 'rgba',
  width?: number, height?: number }          // optional: used for dithering, copied to results
```

`width` and `height` must be whole numbers, and when both are given they must account for exactly the pixels in `data`. A Node `Buffer` (sharp's `.raw()` output) is a `Uint8Array`, so it can be passed as it is.

- **A bare `Uint8Array` is read as RGBA**, like `ImageData`. RGB bytes passed bare are misread, with no error when their length happens to be a multiple of 4. Pass them as `{ data, format: 'rgb', width }`, or add an alpha channel (sharp's `.ensureAlpha()`).
- **Pixels are 8-bit sRGB with straight alpha**, as `getImageData()` gives them. Convert anything else first: premultiplied pixels (from some native and WebGL APIs) back to straight alpha, 16-bit or floating-point pixels (16-bit PNGs, HDR) to 8 bits (sharp: `.toColourspace('srgb').raw({ depth: 'uchar' })`; pngjs: `inputHasAlpha` and its 8-bit output), and gray or gray-and-alpha pixels to RGBA (sharp's `.toColourspace('srgb').ensureAlpha()`); a gray buffer passed as it is gets misread. Apply a photo's EXIF orientation (sharp's `.rotate()`) and colour profile when decoding; the library doesn't read either. An `ImageData` in another pixel format (Chromium's `pixelFormat: 'rgba-float16'`) is rejected with `invalid-argument`: ask for `getImageData(x, y, w, h, { pixelFormat: 'rgba-unorm8' })`.
- **Image files are not pixels.** A bare `Uint8Array` that starts like a PNG, JPEG, GIF, WebP, BMP, TIFF, AVIF or HEIC file (from `fs.readFile` or `fetch`) is rejected with `invalid-argument` naming the format. Decode it first: a canvas or `createImageBitmap` in a browser, sharp or pngjs in Node. Only bare arrays are checked, so if raw pixels really do begin like a file header, pass `{ data, format: 'rgba' }`. Decoding is [planned](ROADMAP.md).

## Output

The functions that return an image give back the type they were given: a `Uint8Array`, `ImageData`, or an object with the same `format` (and `width` and `height`). In TypeScript the result type follows the input (`ImageResult<I>`). Palettes come back as a `Palette`, clusterings as a `Clustering`, and the other results are `Swatches`, `IndexedImage` and `ClusteringInfo` objects. Each pixel keeps its own alpha.

## Options

Every function that takes an image also takes an optional last argument of options. They are all off by default, and the defaults give exact results.

| Option | Applies to | Values | What it does |
|---|---|---|---|
| `precision` | clustering | `1`–`8`, default `8` | Groups colours that share their top `precision` bits per channel before clustering, at their mean colour. **`6` is about 3× faster on photos at practically the same quality** (−0.02 dB), and caps the work on images with huge numbers of colours. `5` is about 8× faster for a small loss. |
| `colorSpace` | clustering and mapping | `'rgb'` (default), `'oklab'` | `'rgb'` minimises squared error in sRGB (the best PSNR); `'oklab'` clusters and matches in [OKLab](https://bottosson.github.io/posts/oklab/). Neither wins everywhere: see [Choosing a colour space](#choosing-a-colour-space). |
| `alpha` | clustering | `'weight'` (default), `'ignore'` | `'weight'` counts each RGBA pixel in proportion to its opacity, so transparent pixels don't count (exact pixel counting for opaque images). `'ignore'` counts every pixel fully, as 1.x did. |
| `transparent` | clustering; indexed output | `false` (default), `true`, or an alpha cutoff `1`–`255` | Pixels with alpha below the cutoff (128 for `true`) are left out of clustering and the rest count whole; indexed output gives them a transparent entry, counted in `k`. For GIFs and palette PNGs; see [Transparency](#transparency). |
| `dither` | mapping | `false` (default), `true`, `0`–`1`, `'floyd-steinberg'`, `'atkinson'`, `'ordered'`, or `{ method, strength, steps }` | Dithering, which hides banding at low colour counts at a cost in per-pixel metrics such as PSNR. `true` or a strength from 0 to 1 is Floyd–Steinberg error diffusion; a method name picks another; the object form sets `strength` (0 to 1, default 1) and, for `'ordered'`, `steps` (2, 4, 8, 16, 32 or 64; default 64 for two colours, else 16). See [Choosing a dither method](#choosing-a-dither-method). Fully transparent pixels are left undithered, and with a strength of 0 no width is needed. |
| `width` | mapping | integer | The image width, for dithering a `Uint8Array` or a `RawImage` without one. If the image has a width of its own, this must equal it. |
| `signal` | any call with an image | an `AbortSignal` | Cancels the call; see [Cancelling and progress](#cancelling-and-progress). |
| `onProgress` | clustering | `(fraction) => void` | Reports 0 to 1 as the clustering runs; see [Cancelling and progress](#cancelling-and-progress). |

Pass an ordinary object. It is copied once before use (its enumerable properties, inherited ones included, so `Object.create(defaults)` works), and an unknown key is an error, including one that another function takes: an object with both `precision` and `dither` passed to `getClustering` throws on `dither`. TypeScript doesn't catch that when the object is a variable typed `QuantizeOptions`, so give each call the options it takes, or keep one object per stage.

**Option shapes.** An option is a plain value (a boolean, a number or a string) while it has one setting. An option with several settings, or with settings that apply to only some of its values, also takes an object, and its plain values stay valid as shorthands for that object: `dither: 'ordered'` is `dither: { method: 'ordered' }`. Unknown keys inside the object are an `invalid-argument` error, as unknown options are. Options that describe the image rather than how to process it (`width`) stay top-level, and so do `signal` and `onProgress`.

```js
// Perceptual palettes for a photo, quickly
const palette = await getPalette(photo, 128, { colorSpace: 'oklab', precision: 6 });

// Retro look: 8 colours, dithered
const retro = await quantize(imageData, 8, { dither: true });

// Dithering a raw buffer needs its width
const out = await quantize(rgbaBytes, 32, { dither: 0.8, width: 640 });

// A fixed pattern for animation frames, and a gentler one
const frame = await quantizeWithPalette(frameData, palette, { dither: 'ordered' });
const soft = await quantizeWithPalette(frameData, palette, { dither: { method: 'ordered', strength: 0.5 } });
```

### Choosing a colour space

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

### Choosing a dither method

| Method | What it does | Use it for |
|---|---|---|
| `'floyd-steinberg'` (`true`) | Spreads each pixel's error to the pixels after it. | Still images: it is the most accurate. |
| `'ordered'` | Gives each colour a recipe of palette colours that average out to it, and lays the recipe out in a fixed 8×8 (Bayer) pattern. A pixel's colour depends only on its own colour and position. | Animation and video, where a still area must stay still from frame to frame (error diffusion makes it shimmer), and displays that need a stable pattern, such as partly refreshed e-ink. |
| `'atkinson'` | Error diffusion that passes on only 3/4 of the error, to six neighbours. | Its look: higher contrast, with clean highlights and shadows, the classic 1-bit style. It suits text and line art. |

Measured on six Kodak photos after a slight blur (to stand in for viewing distance), mean ΔE2000 at 16 colours was 2.55 for Floyd–Steinberg, 2.72 for ordered and 3.09 for Atkinson, against 3.72 undithered (64 colours: 1.21, 1.41, 1.57 and 1.97). Ordered dithering is never more accurate than error diffusion on a still image; its value is the fixed pattern.

**`strength`** (0 to 1, default 1) sets how much of each pixel's error is passed on, or for `'ordered'`, how far each recipe reaches for other colours. 0 is no dithering, and for every method equal steps of strength give roughly equal changes: at 0.25, about a quarter to a third of the pixels that full strength changes.

**`steps`** (`'ordered'` only) is how many cells of the 8×8 pattern each colour's mix is spread over, so two colours blend in `steps + 1` shades: 2, 4, 8, 16, 32 or 64. The default is 64 for a palette of two colours (black and white), where every shade shows on a smooth gradient, and 16 otherwise. Each doubling about doubles the time; at 16 colours, 8 to 16 was about 5% more accurate (ΔE 2.87 to 2.72) and visibly smoother on gradients, and 16 to 32 about 5% more again (2.59), with little visible difference. The pattern starts at each image's top-left pixel, so tiles dithered separately line up only at offsets that are multiples of 8.

**Speed.** Mapping a 768×512 photo (kodim23) to 16 colours took 6 ms undithered, 27 ms with Floyd–Steinberg, 26 ms with Atkinson, and 33, 66 and 144 ms ordered with 8, 16 and 32 steps (64 colours: 7, 35, 28, and 51, 101 and 213 ms; 256 colours with 64 steps took about a second). Ordered dithering builds a recipe for every distinct colour in the image, on every call, so its time grows with the number of colours as well as the size: on smaller frames it is a larger multiple of Floyd–Steinberg's time (about 7× at 384×256). `bench/dither.bench.js` measures it.

#### Dithering to a few inks: mix in light

Every method mixes colours as sRGB values, the numbers in the image. The eye mixes light, which is not proportional to those numbers: a pattern of half black and half white pixels looks much lighter than sRGB grey 128. With a palette of many colours this hardly shows, because the colours mixed are close together. With black and white or a handful of e-ink inks it shows a lot: dithered photos come out much lighter on the panel, or at 1:1 on screen. Measured in light, on three photos with the seven e-ink inks, every method was far off (ΔE 17 to 22), and Atkinson only looked least bad because it drops part of the error.

To mix in light, convert the image and the palette to linear values first, and use the indices with your palette as it is:

```js
// sRGB 0-255 to linear light, scaled back to 0-255
const toLinear = (v) => Math.round(v <= 10 ? v / 12.92 : 255 * ((v / 255 + 0.055) / 1.055) ** 2.4);
const linear = data.map((v, i) => (i % 4 === 3 ? v : toLinear(v)));
const { indices } = await quantizeToIndicesWithPalette({ data: linear, format: 'rgba', width }, eink.map(toLinear), { dither: true });
// indices[i] is the entry of `eink` (in its own colours) for pixel i
```

On the same photos this cut the error in light from 17–22 to 5–7 with Floyd–Steinberg on the seven inks, and from 22–25 to 11–18 in black and white; ordered dithering improves about as much, Atkinson little. Eight-bit linear values have few dark shades, so very dark gradients can band. A built-in way to mix in light is on the [roadmap](ROADMAP.md).

### Transparency

Alpha matters only for RGBA input (bare `Uint8Array`s and `ImageData` are RGBA; `{ data, format: 'rgb' }` has none). Two options handle it, at different stages, and naming both is an error:

- **`alpha`** (the default, `'weight'`) weighs each pixel by its opacity when clustering, and each pixel keeps its own alpha in the output. Use it for swatches and for images that keep their alpha.
- **`transparent`** is for destinations with one transparent colour, as GIF and palette PNG have. Pass it in the clustering step too, so the palette you cut is the one you map with. Translucent palette colours are not supported.

The cutoff decides which side a half-transparent pixel falls on. With the default (128), a soft drop shadow under 50% opacity disappears, and the darker part of it becomes solid; raise the cutoff (`transparent: 200`) to drop more of it, or lower it to keep more.

## Palette and Clustering

The palettes and clusterings this library returns are ordinary `Uint8Array`s with a hidden tag: what they are and, for a palette, the colour space it was made in. Anything that takes bytes takes them, and their `constructor` is `Uint8Array`, so `expect(palette).toEqual(new Uint8Array([...]))` passes in your tests. The tags buy four things:

- **A palette maps in the space it was made in.** `quantizeWithPalette(image, palette)` matches an OKLab palette in OKLab without being told; name a `colorSpace` to override it. Plain bytes are matched in RGB.
- **A clustering can't be passed as a palette**, or the other way round. TypeScript rejects it, and at run time it throws (`invalid-argument` or `invalid-clustering`), with no guessing about bytes.
- **`new Palette(bytes, colorSpace)` and `new Clustering(bytes)` give bytes their type back**, and check them: `new Palette([300, 0, 0])` throws rather than wrapping 300 to 44, and `new Clustering(bytes)` throws `invalid-clustering` unless they are one. The functions still accept a clustering as plain bytes, so stored clusterings keep working in JavaScript; TypeScript wants the constructor.
- **A clustering is checked before it is used.** Clusterings carry a checksum, so stored bytes that came back damaged (truncated, a changed byte, a lossy base64 round trip) are reported as `invalid-clustering` rather than cut into a wrong palette. It is checked the first time an array is used, so bytes changed in place after that aren't caught. Clusterings from 2.x have no checksum. It catches accidents, not tampering (anyone can recompute it): a clustering or palette from an untrusted user can't crash the library or make it hang, but it can describe any palette it likes.

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

**Storing a clustering.** A clustering of a 768×512 photo is 0.3 to 1.5 MB, typically 0.7 MB (0.2 MB with `precision: 6`). Its format is versioned and its colour space is in its bytes, so `new Clustering(bytes)` is all it needs when read back.

**Storing a palette.** Storage keeps a palette's bytes but not its colour space, and plain bytes are matched in RGB. So an OKLab palette that you store and read back maps differently from the one you stored, without an error. Store the colour space with it and give it back:

```js
await db.put('palette', { bytes: Array.from(palette), colorSpace: palette.colorSpace });
const { bytes, colorSpace } = await db.get('palette');
const restored = new Palette(bytes, colorSpace);   // maps exactly as the palette you stored
```

## Cancelling and progress

Every function that takes an image accepts `signal`; the ones that cluster (`getClustering`, `getPalette`, `getSwatches`, `quantize`, `quantizeToIndices`) also accept `onProgress`:

```js
const controller = new AbortController();
const clustering = await getClustering(image, {
  signal: controller.signal,                       // controller.abort() cancels it
  onProgress: (fraction) => bar.value = fraction,  // 0 to 1
});
```

- **Slices.** With either option, clustering runs in slices of about 10 ms (a large photo has a few unsliced steps of up to 150 ms in between; an image with millions of distinct colours, longer: see [Performance and limits](performance.md#large-images)), so an abort takes effect within a slice and the page stays responsive. The result is the same; slicing costs about 5% more time.
- **Aborting** rejects with the signal's `reason` (an `AbortError` by default), like `fetch`. It is not one of this library's errors, and has none of their codes (a `DOMException`'s `code` is a number). To tell an abort from a failure, check your signal (`signal.aborted`), not the error: a reason you gave (`controller.abort(new Error('superseded'))`) keeps its own name. An already aborted signal does no work.
- **Mapping can't be interrupted** (for a 768×512 photo: 6 ms, 27 ms dithered, 66 ms with ordered dithering, and up to about a second for ordered dithering with 64 steps and 256 colours). The functions that only map check the signal before they start, and don't take `onProgress`.
- **Progress** is approximate, never goes backwards, and ends at exactly 1.
- **In a worker** the work in the worker stops too, and a call still queued is removed without running. The worker keeps running for later calls.

## Errors

Every error the library throws is an `Error` with a `code`, so you don't have to match on message text (except an abort, which rejects with the signal's own `reason`).

When an error is about one argument, `error.argument` names it: `'image'`, `'k'`, `'clustering'`, `'palette'`, `'options'`, `'colorSpace'` (from `new Palette`), or `'options.<name>'` (for example `'options.colorSpace'`), so a form can point at the right field. Arguments are checked in the order you pass them, so the error is about the first that is wrong.

| `code` | When |
| --- | --- |
| `invalid-argument` | A bad image, `k`, option or palette. |
| `invalid-clustering` | Bytes that aren't a clustering this version can read, or a stored clustering that came back damaged (its checksum or its records don't fit). |
| `unsupported-version` | A clustering from a newer format, or using a colour space it doesn't know (upgrade the package), or an older one without what you asked for (cluster again, e.g. for `getSwatchesFromClustering`). |
| `out-of-memory` | The WebAssembly module couldn't allocate: an image with very many colours, or pixel data over its 2 GB (the message gives the size). |
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

`errorCodes` lists every code, for code that forwards them (a wrapper package re-exporting them, a bridge between processes). `isCodedError` also accepts a plain object with a known `code` and a `message`, which is what an error becomes after Electron's IPC or a `postMessage`. New codes can appear in a minor release, so switch over them with a default branch.

Messages are for people and may change. The worker entry fails the same way as the main entry, with your call's stack (the worker's is on `cause`). A failure that isn't the library's own, such as a WebAssembly trap, has no `code`. For what to do about each, see [Troubleshooting](troubleshooting.md).

## Worker entry

`agglomerative-clustering/worker` exports every function of the main entry, run in one shared worker started on first use, plus `terminate()`, which stops it (the next call starts a new one), and `createWorker(options?)`, which starts a worker of your own. A worker has every function as a method, plus:

- **`cluster(image, options?)`** keeps the image and its clustering in the worker, behind a handle with `getClustering()`, `getPalette(k)`, `getSwatches(k)`, `getClusteringInfo()`, `quantize(k, options?)`, `quantizeToIndices(k, options?)`, `quantizeWithPalette(palette, options?)` and `quantizeToIndicesWithPalette(palette, options?)`. A palette of plain bytes is matched in the handle's colour space, and `quantizeToIndices` uses the cutoff it was clustered with. Free it with `release()`, or declare it with `await using handle = await worker.cluster(image)`; a dropped handle is freed only when the garbage collector gets to it.
- **`terminate()`** stops the worker and rejects the calls still waiting. `await using worker = createWorker()` calls it at the end of the block.

**Terminate the workers you create.** A worker's thread, and the memory its last images needed, stay until `terminate()`: a running worker is never garbage-collected, so a server or page that creates a worker per request and drops it gathers threads. Keep a few workers and reuse them (see [the pool](performance.md#servers)), or use the shared worker. As a safety net, a worker you dropped is stopped some time after the garbage collector has collected it, once no call is running on it and no handle from it is left, but when that happens is up to the engine (it may be never, in a process with little memory pressure).

`createWorker` takes `transfer`, `wasm` (see [Loading the WebAssembly module](environments.md#loading-the-webassembly-module)) and `script`: the URL (or in Node, the path) of a copy of the package's `dist/worker-thread.mjs`, for setups whose bundler doesn't emit the package's own. For the shared worker, `init({ script })` does the same, before any other call.

Calls run one at a time, in order. Results are transferred back without copying. Images are copied in, unless you create the worker with `createWorker({ transfer: true })`, which is faster but leaves your buffer empty. Only pixels that are a whole buffer of their own are transferred; a view into part of a larger buffer, such as a `subarray` or a small Node `Buffer`, is copied.

The worker is started with `new Worker(new URL('./worker-thread.mjs', import.meta.url))`, the form bundlers look for (see [Environments](environments.md#angular-esbuild-rollup-and-other-bundlers) for those that don't). Loaded from a CDN (another origin than the page), it starts the worker through a small `blob:` script, as browsers don't start workers from other origins' scripts. In Node an idle worker never keeps the process alive.

The entry is an ES module, with a CommonJS build for `require()` in Node and in Jest. In a browser bundle, import it rather than `require()` it: bundlers find the worker script only from the ES module, so the CommonJS build there needs `createWorker({ script })`.

## TypeScript

Both entries ship declarations, checked in CI under strict mode with `nodenext` (ES module and CommonJS importers), `bundler`, and a Node-only project without the DOM lib. The worker entry's declarations use `await using` for handles, so they need **TypeScript 5.2 or newer** (or `skipLibCheck: true`); the main entry works on older versions. Both entries have CommonJS declarations too, so a `.cts` file or a CommonJS project imports either.

- **Image objects:** one assigned to a variable before it is passed widens `format: 'rgba'` to `string`, which no longer matches `RawImage`: write `format: 'rgba' as const`, or declare the variable as `RawImage`.
- **Dither settings in a variable** widen the same way: `const dither = { method: 'ordered', steps: 32 }` has `method: string`. Write `as const`, or declare it as `DitherOptions`. A `steps` value from a slider is a `number`: narrow it to `DitherSteps` with a check, such as `([2, 4, 8, 16, 32, 64] as const).find((s) => s === value)`.
- **Results narrow:** checking `result.indexBits === 8` makes `indices` a `Uint8Array`.
- **Palettes:** palette parameters take a `PaletteLike` (a `Palette`, plain bytes or a `number[]`, not a `Clustering`). Stored bytes need `new Clustering(bytes)` to be accepted as a clustering.
- **Errors** are `CodedError`s with `code` and `argument`.
- **Handles** keep the image type they were made from: a variable that holds one is `ClusteringHandle<ImageData> | null`, not a bare `ClusteringHandle`, whose `quantize` returns the general image type.

## Functions

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

It needs a clustering from 3.x, like `getSwatchesFromClustering`: a 2.x clustering recorded no weights, so it is rejected with `unsupported-version` (the palette and mapping functions still read it).

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
Loads the WebAssembly module. Every other function does this on first use, so calling it is optional, for example to warm up before a batch. Concurrent calls share one load, and a failed load can be retried. To say where the module is, see [Loading the WebAssembly module](environments.md#loading-the-webassembly-module).

### `errorCodes: readonly string[]` and `isCodedError(value): boolean`
`errorCodes` is a frozen array of every `code` the library's errors have (see [Errors](#errors)). `isCodedError(value)` is true when `value` has a string `message` and one of those codes; in TypeScript it narrows to `CodedError`. Both entries export both.

### `version: string` and `formatVersion: number`
`version` is the library's version (such as `'3.0.0'`), for bug reports and runtime checks. `formatVersion` is the version of the data it stores (the clustering format), which changes only when that format does: a minor release may raise it, and every earlier format from 2 on stays readable. To keep stored clusterings current, cluster the image again when `getClusteringInfo(stored).formatVersion` is below it, or when `getClusteringInfo` rejects the clustering with `unsupported-version` (a 2.x clustering, which has no weights, or one from a newer version than this one). Both entries export both, and a `.wasm` from another version fails to load with `wasm-load-failed`.
