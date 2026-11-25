# API reference

Both entries, `agglomerative-clustering` and `agglomerative-clustering/worker`, export the same functions; the worker entry runs them in a worker (see [Worker entry](#worker-entry)). For recipes, see the [guides](guides.md).

- [Terms](#terms)
- [Input](#input) and [output](#output)
- [Options](#options): [choosing a colour space](#choosing-a-colour-space), [choosing a dither method](#choosing-a-dither-method), [transparency](#transparency)
- [Palette and Clustering](#palette-and-clustering), and [methods on a clustering](#clustering-methods)
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
- **build… and get…**: a name says how much work a call does. `build…` clusters an image; `get…` reads or cuts what a clustering or a worker handle already holds, so `buildPalette(image, k)` takes tens of milliseconds for a photo and `clustering.getPalette(k)` well under one. `quantize…` maps pixels, and may cluster first.
- **clustering and mapping**: "clustering" functions build a clustering (`buildClustering`, `buildPalette`, `buildSwatches`, `quantize`, `quantizeToIndices`); "mapping" functions map pixels to a palette (`quantize`, `clustering.quantize`, `quantizeWithPalette` and the indexed versions). A function that does both takes both sets of options.

## Input

Every function that takes an image accepts:

```ts
Uint8Array                                   // raw RGBA bytes
ImageData                                    // from a canvas: always RGBA, width included
{ data: Uint8Array | Uint8ClampedArray,      // explicit format, for other layouts or clamped arrays
  format: 'rgb' | 'rgba' | 'bgra' | 'rgbx' | 'bgrx',
  width?: number, height?: number,           // optional: used for dithering, copied to results
  premultiplied?: boolean }                  // 'rgba' and 'bgra' only: the colours are premultiplied by alpha
```

An image object may have only these keys. Any other key is an `invalid-argument` error naming it, with a hint for near misses (`premultiply`, `widht`) and for the fields of a decoder's result (`channels`, `size`, `depth`): build `{ data, format, width, height }` from what you need instead of spreading a decoder's result, as `{ ...info, data, format }` would.

| `format` | Bytes per pixel | Channel order | Fourth byte |
|---|---|---|---|
| `'rgb'` | 3 | red, green, blue | none |
| `'rgba'` | 4 | red, green, blue | alpha, straight or (with `premultiplied: true`) premultiplied |
| `'bgra'` | 4 | blue, green, red | alpha, straight or (with `premultiplied: true`) premultiplied |
| `'rgbx'` | 4 | red, green, blue | padding: ignored, every pixel is opaque |
| `'bgrx'` | 4 | blue, green, red | padding: ignored, every pixel is opaque |

Each format is read as it is and mapped images come back in it, with no swapping on your side; palettes, clusterings and indices are RGB in every case. The `x` formats are for buffers whose fourth byte isn't alpha (Windows `BI_RGB` bitmaps and GDI screenshots, where it is usually 0; WebCodecs `'BGRX'`; ffmpeg `bgr0`): they behave exactly like `'rgb'`, and mapped output writes 255 in that byte. Passing such a buffer as `'bgra'` instead reads it as fully transparent, which gives an empty palette and black output. `width` and `height` must be whole numbers, and when both are given they must account for exactly the pixels in `data`. A Node `Buffer` (sharp's `.raw()` output) is a `Uint8Array`, so it can be passed as it is.

**Where pixels come from**, and what to pass:

| Source | Bytes | Alpha | Pass |
|---|---|---|---|
| `getImageData()` (browsers, node-canvas, skia-canvas, `@napi-rs/canvas`) | RGBA | straight | the `ImageData` |
| sharp `.raw()` | RGB or RGBA | straight | `'rgb'` or `'rgba'` (its `info.channels`) |
| skia-canvas `toBuffer('raw')`; with `{ colorType: 'bgra' }` | RGBA; BGRA | straight | `'rgba'`; `'bgra'` |
| Electron `nativeImage.toBitmap()` (Windows, macOS, Linux) | BGRA | premultiplied | `'bgra'`, `premultiplied: true` |
| node-canvas `canvas.toBuffer('raw')` (Cairo ARGB32, little-endian) | BGRA | premultiplied | `'bgra'`, `premultiplied: true` |
| `@napi-rs/canvas` `canvas.data()` | RGBA | premultiplied | `'rgba'`, `premultiplied: true` |
| WebGL `readPixels` (default `premultipliedAlpha: true`; rows bottom-up) | RGBA | premultiplied | `'rgba'`, `premultiplied: true` |
| WebCodecs `frame.copyTo(buffer, { format: 'BGRA' })`; `'BGRX'` | BGRA; BGRX | straight for decoded video, premultiplied for frames made from a canvas | `'bgra'` (with `premultiplied: true` for canvas frames); `'bgrx'` |
| ffmpeg `-f rawvideo -pix_fmt bgra`; `bgr0` | BGRA; BGRX | straight | `'bgra'`; `'bgrx'` |
| Windows `GetDIBits`, 32-bit `BI_RGB` BMPs (rows usually bottom-up) | BGRX | none (usually 0) | `'bgrx'` |
| Windows WIC `32bppBGRA`; `32bppPBGRA` | BGRA | straight; premultiplied | `'bgra'`; `'bgra'`, `premultiplied: true` |

For the sources marked premultiplied, mapped output comes back premultiplied: that suits Electron's `createFromBitmap` and Cairo, but for a straight destination (`ImageData`, PNG encoders) use the guides' [straight-output recipe](guides.md#straight-pixels-from-a-premultiplied-source).

Two things about canvases and WebGL in a browser. **`readPixels` bytes are premultiplied only when the framebuffer holds premultiplied colour**: with the default `premultipliedAlpha: true` and a shader that writes `rgb * a`, they are, and the row above is right; a shader that writes straight colour gives straight bytes, so leave `premultiplied` off for those. And **a result drawn with `putImageData` and read back with `getImageData` has more than `k` colours** when it has translucent pixels, because a canvas stores its pixels premultiplied and rounds them again: count colours (or take the palette) from the result the library returned, not from the canvas.

A wrong channel order can't be detected: red and blue come out swapped (orange as blue) in palettes that otherwise look plausible, so check one pixel of a known colour when trying a new source.

**`premultiplied: true`** says the colours in `data` were multiplied by alpha, as the sources marked premultiplied above give them. It is for `'rgba'` and `'bgra'` only: with any other format it is an `invalid-argument` error, and `false` is the same as leaving it out. The library undoes the multiplication in its own copy of the pixels before it clusters, so palettes and clusterings are of the picture's real colours, and your array is never changed. Read without the flag, premultiplied pixels are taken as straight, which darkens the partly transparent ones (opaque and fully transparent pixels are the same either way).

- **Premultiplied in means premultiplied out** for mapped images (`quantize*` returning an image): the result's colours are multiplied by the input's alpha again, so it can go back where the input came from, such as Electron's `nativeImage.createFromBitmap`, Cairo or WIC. It can't go to an `ImageData` (`putImageData`), which is straight. Palettes, clusterings, swatches and indexed output (`quantizeToIndices*`) are always straight.
- **Setting it on opaque data does nothing**, and costs about 5 ms on 12 megapixels, so set it whenever the source may be premultiplied (a WebCodecs frame, which is premultiplied only when made from a canvas). <!-- bench/spikes/premultiplied/run.mjs → results.txt: 5.1 and 5.5 ms for the opaque case, the in-place pass over a 12 MP image -->
- **`alpha: 'weight'` and `transparent`** read the pixels' straight alpha, which the flag never changes.
- **For straight pixels out of a premultiplied source** (an `ImageData`, a PNG encoder), use the recipe in the guides, [Straight pixels from a premultiplied source](guides.md#straight-pixels-from-a-premultiplied-source): map to indices and write each pixel's palette colour with the input's alpha. Don't un-premultiply the mapped output: the rounding happens twice, and a 16-colour result came back with 1,171 colours, with errors up to 120 per channel below alpha 16. <!-- bench/spikes/premultiplied-straight/recipes.mjs → results.txt -->
- **In Node, sharp** can undo the multiplication itself: `await sharp(data, { raw: { width, height, channels: 4, premultiplied: true } }).raw().toBuffer()` gives straight pixels in the same channel order, which you pass without the flag.

- **A bare `Uint8Array` is read as RGBA**, like `ImageData`, and one whose bytes look like RGB (3 per pixel), grey (1) or grey and alpha (2) is an `invalid-argument` error on `'image'` (3.x warned, once). RGB bytes passed bare would be misread, with no other error when their length happens to be a multiple of 4. Pass RGB as `{ data, format: 'rgb', width }`, or add an alpha channel (sharp's `.ensureAlpha()`); expand grey to RGBA (there is no grey format); and if the bytes really are RGBA, pass `{ data, format: 'rgba' }` to say so. <!-- bench/spikes/bare-rgb/measure.mjs → results.txt; bench/spikes/bare-grey/shipped.mjs → results-shipped.txt, results-cost.txt --> The check samples the bytes, so it costs well under a millisecond at any size. It was tested on 2,984 real RGBA images (photos, emoji, cutouts, grey images with alpha, dithered images, pixel art, premultiplied pixels) and flagged none. The check recognises RGB and grey from how the bytes look, so it misses some grey input (photos dithered to a few grey levels, flat or graphic grey whose changing pixels mostly come in runs of four equal bytes, which look exactly like RGBA, and some one-channel images): always pass grey expanded to RGBA. `ImageData` and `{ data, format }` are never inspected.
- **Pixels are 8-bit sRGB**, straight alpha as `getImageData()` gives them, or premultiplied with `premultiplied: true` (above). Convert anything else first: 16-bit or floating-point pixels (16-bit PNGs, HDR) to 8 bits, and grey or grey-and-alpha pixels to RGBA; a grey buffer passed as it is gets misread, and the library rejects it when it sees one. Apply a photo's EXIF orientation and colour profile when decoding; the library doesn't read either. The recipes in [Decoding image files](guides.md#decoding-image-files) do all of this (sharp's `.rotate().ensureAlpha().raw()` in Node). An `ImageData` in another pixel format (Chromium's `pixelFormat: 'rgba-float16'`, skia-canvas's `colorType: 'bgra'` or `'gray8'`, or one whose `data` doesn't hold `width × height` RGBA pixels) is rejected with `invalid-argument`: ask for `getImageData(x, y, w, h, { pixelFormat: 'rgba-unorm8' })` (or skia-canvas's default `colorType`), or pass its data as `{ data, format }` in the format it holds.
- **Image files are not pixels.** A bare `Uint8Array` that starts like a PNG, JPEG, GIF, WebP, BMP, TIFF, AVIF or HEIC file (from `fs.readFile` or `fetch`) is rejected with `invalid-argument` naming the format. Decode it first: `createImageBitmap` in a browser, sharp in Node, jsquash on edge runtimes ([Decoding image files](guides.md#decoding-image-files) has each). Only bare arrays are checked, so if raw pixels really do begin like a file header, pass `{ data, format: 'rgba' }`.

## Output

The functions that return an image give back the type they were given: a `Uint8Array`, `ImageData`, or an object with the same `format`, `width`, `height` and `premultiplied` (each only if the input had it; `premultiplied` is copied as given) whose `data` is a `Uint8Array`. In TypeScript the result type follows the input (`ImageResult<I>`): a `RawImage<'bgra'>` gives its own keys back with `data: Uint8Array`, so no cast is needed (see [TypeScript](#typescript)). A result for `premultiplied: true` input is premultiplied (see [Input](#input)). Palettes come back as a `Palette`, clusterings as a `Clustering`, and the other results are `Swatches`, `IndexedImage` and `ClusteringInfo` objects. In formats with alpha each pixel keeps its own alpha (a fully transparent pixel still gets its nearest colour; premultiplied, it is black); the `x` formats get 255 in the fourth byte; `'rgb'` has none.

## Options

Every function that takes an image also takes an optional last argument of options. They are all off by default, and the defaults give exact results.

| Option | Applies to | Values | What it does |
|---|---|---|---|
| `precision` | clustering | `1`–`8`, default `8` | Groups colours that share their top `precision` bits per channel before clustering, at their mean colour. **`6` is about 3× faster on photos at practically the same quality** (−0.02 dB), and caps the work on images with huge numbers of colours. `5` is about 8× faster for a small loss. |
| `colorSpace` | clustering and mapping | `'rgb'` (default), `'oklab'` | `'rgb'` minimises squared error in sRGB (the best PSNR); `'oklab'` clusters and matches in [OKLab](https://bottosson.github.io/posts/oklab/). Neither wins everywhere: see [Choosing a colour space](#choosing-a-colour-space). |
| `alpha` | clustering | `'weight'` (default), `'ignore'` | `'weight'` counts each RGBA or BGRA pixel in proportion to its opacity, so transparent pixels don't count (exact pixel counting for opaque images). `'ignore'` counts every pixel fully, as 1.x did. Clustering only: mapping and dithering still treat alpha-0 pixels as transparent, so for a buffer whose fourth byte isn't alpha use `'rgbx'` or `'bgrx'`. |
| `transparent` | clustering; indexed output | `false` (default), `true`, or an alpha cutoff `1`–`255` | Pixels with alpha below the cutoff (128 for `true`) are left out of clustering and the rest count whole; indexed output gives them a transparent entry, counted in `k`. For GIFs and palette PNGs; see [Transparency](#transparency). With `'rgb'`, `'rgbx'` or `'bgrx'` input, `true` or a cutoff is an `invalid-argument` error (those formats have no alpha); `false` is accepted. |
| `dither` | mapping | `false` (default), `true`, `0`–`1`, `'floyd-steinberg'`, `'atkinson'`, `'ordered'`, or `{ method, strength, steps }` | Dithering, which hides banding at low colour counts at a cost in per-pixel metrics such as PSNR. `true` or a strength from 0 to 1 is Floyd–Steinberg error diffusion; a method name picks another; the object form sets `strength` (0 to 1, default 1) and, for `'ordered'`, `steps` (2, 4, 8, 16, 32 or 64; default 64 for two colours, else 16). See [Choosing a dither method](#choosing-a-dither-method). Fully transparent pixels are left undithered, and with a strength of 0 no width is needed. |
| `width` | mapping | integer | The image width, for dithering a `Uint8Array` or a `RawImage` without one. If the image has a width of its own, this must equal it. |
| `signal` | any call with an image | an `AbortSignal` | Cancels the call; see [Cancelling and progress](#cancelling-and-progress). |
| `onProgress` | any call with an image | `(fraction) => void` | Reports 0 to 1 as the call runs; see [Cancelling and progress](#cancelling-and-progress). |

Pass an ordinary object. It is copied once before use (its enumerable properties, inherited ones included, so `Object.create(defaults)` works), and an unknown key is an error, including one that another function takes: an object with both `precision` and `dither` passed to `buildClustering` throws on `dither`. TypeScript doesn't catch that when the object is a variable typed `QuantizeOptions`, so give each call the options it takes, or keep one object per stage.

**Option shapes.** An option is a plain value (a boolean, a number or a string) while it has one setting. An option with several settings, or with settings that apply to only some of its values, also takes an object, and its plain values stay valid as shorthands for that object: `dither: 'ordered'` is `dither: { method: 'ordered' }`. Unknown keys inside the object are an `invalid-argument` error, as unknown options are. Options that describe the image rather than how to process it (`width`) stay top-level, and so do `signal` and `onProgress`.

**Lists of names.** Every option whose value is one of a fixed set of names has that set exported as a frozen list, from both entries: [`colorSpaces`, `imageFormats`, `alphaModes`, `ditherMethods` and `ditherSteps`](#lists-of-names-colorspaces-imageformats-alphamodes-dithermethods-and-dithersteps), as `errorCodes` lists the error codes. Use them to build a choice in a form, or to turn a string from one into the option's type. A minor release can add a name to a list (a new image format, say), so code that must handle every name should take it from the list rather than spell the names out.

```js
// Perceptual palettes for a photo, quickly
const palette = await buildPalette(photo, 128, { colorSpace: 'oklab', precision: 6 });

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

**`strength`** (0 to 1, default 1) sets how much of each pixel's error is passed on, or for `'ordered'`, how far each recipe reaches for other colours. 0 is no dithering. Ordered dithering responds very differently to the raw amount (with 64 steps, a hundredth of it already does a third of the work), so its strength goes through a table, measured for each step count, that makes it change about the same share of pixels as Floyd–Steinberg at the same strength: on photos, about 6% of full strength's changes at 0.05, 30% at 0.25 and 60% at 0.5. Atkinson tracks Floyd–Steinberg closely by itself.

**`steps`** (`'ordered'` only) is how many cells of the 8×8 pattern each colour's mix is spread over, so two colours blend in `steps + 1` shades: 2, 4, 8, 16, 32 or 64. The default is 64 for a palette of two colours (black and white), where every shade shows on a smooth gradient, and 16 otherwise. Each doubling about doubles the time; at 16 colours, 8 to 16 was about 5% more accurate (ΔE 2.87 to 2.72) and visibly smoother on gradients, and 16 to 32 about 5% more again (2.59), with little visible difference. The pattern starts at each image's top-left pixel, so tiles dithered separately line up only at offsets that are multiples of 8. For a given palette and options, a pixel's result with `'ordered'` depends only on its own colour (and, with `transparent`, whether its alpha is below the cutoff) and on its column and row modulo 8, counted from the image's top-left pixel; this holds through 3.x, so frames stacked into one image give the same result as one call each ([guides: map frames in batches](guides.md#faster-ordered-dithering-map-frames-in-batches)). The colours chosen can still change between releases ([Stability](stability.md)).

**Speed.** Mapping a 768×512 photo (kodim23) to 16 colours took 6 ms undithered, 27 ms with Floyd–Steinberg, 26 ms with Atkinson, and 33, 66 and 144 ms ordered with 8, 16 and 32 steps (64 colours: 7, 35, 28, and 51, 101 and 213 ms; 256 colours with 64 steps took about a second). In black and white the default 64 steps took about 220 ms, against 48 ms with 16. Ordered dithering builds a recipe for every distinct colour in the image, on every call, so its time follows the number of distinct colours more than the size: on smaller frames it is a larger multiple of Floyd–Steinberg's time (about 7× at 384×256), and on images where nearly every pixel is a different colour it is far slower (768×512 noise: 2 s with 16 colours and 64 steps, 10 s with 256; a 16-megapixel image of all different colours: 22 s at the default for 16 colours, 58 s in black and white). For such images use fewer steps, or scale them down; to let the user cancel or watch it, pass `signal` and `onProgress` (see [Cancelling and progress](#cancelling-and-progress)). `bench/dither.bench.js` measures it.

#### Dithering to a few inks: mix in light

**If dithered photos come out too light on an e-ink panel, or in black and white, this is why.** Every method mixes colours as sRGB values, the numbers in the image (which are gamma-encoded). The eye and the panel mix light, which is not proportional to those numbers: a pattern of half black and half white pixels looks like sRGB grey 188, not 128. With a palette of many colours this hardly shows, because the colours mixed are close together. With black and white or a handful of inks it shows a lot: on the 24 Kodak photos with the seven e-ink inks, dithered photos came out 1.1 to 2.8 times too bright (up to 3.1 in black and white).

The function below, `ditherInLight`, mixes in linear light. It turns each colour, of the image and of the inks, into three bytes the library dithers as it always does:
- the colour's brightness in light;
- two colour differences (red against green, blue against yellow), counted double so that greys are made of black, white and grey inks rather than speckled with coloured ones.

Since those bytes measure light, the library's averaging becomes averaging light. The function hands back your inks as the palette, so the result is used as `quantizeToIndicesWithPalette`'s would be. It is code to copy into your project, not an export of the library:

```js
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

const { indices } = await ditherInLight({ data, width }, eink);
const ordered = await ditherInLight({ data, width }, eink, { dither: 'ordered' });
```

Measured in light (CIEDE2000 after a slight blur in linear light, mean over the 24 Kodak photos), against dithering the sRGB values:

| Palette | Method | sRGB values | In light |
|---|---|---|---|
| Seven e-ink inks | Floyd–Steinberg | 19.8 | 4.3 |
| | ordered | 20.6 | 6.2 |
| Black and white | Floyd–Steinberg | 22.5 | 12.2 |
| | ordered | 23.2 | 12.3 |

Brightness comes out right: with the e-ink inks within 3% of the original's on every photo, against up to 2.8 times too bright. In black and white, ordered dithering stays within 4%; Floyd–Steinberg does on most photos, but on dark ones it loses shadows (one photo came out at 0.62 of its brightness). Converting to linear values without the brightness weighting, as this section used to show, left colour casts in grey areas (4.3 against 5.3 on e-ink with Floyd–Steinberg, 6.2 against 8.9 ordered).
<!-- Measured by bench/spikes/linear-light/: results-recipe.txt (recipe.mjs runs this function) and results.txt. -->

Keep to these:

- **Use it for a few fixed inks**, not for a palette cut from the image itself. There the colours mixed are close together and sRGB mixing is already about right: at 16 extracted colours this function was slightly worse with Floyd–Steinberg (2.69 against 2.47) and slightly better with ordered (2.33 against 2.59).
- **Use Floyd–Steinberg or ordered dithering.** Atkinson drops a quarter of the error, which in light turns shadows black. Undithered (`dither: false`), every dark tone snaps to black.
- **Very dark gradients can band.** Brightness gets 128 levels in light, and every sRGB value below about 12 becomes black; black and white shows it most.
- **Look at the result at 1:1, or on the panel.** A viewer that shrinks the image averages its pixels as sRGB values, so a correct result looks too dark when shown small.
- **It runs on the calling thread**, before the library is called: about 10 to 20 ns a pixel (8 ms for a 768×512 photo, 100 ms for 4K). With the worker entry, call it in your own worker, or accept that cost on the main thread.

### Transparency

Alpha matters only for RGBA and BGRA input (bare `Uint8Array`s and `ImageData` are RGBA). `'rgb'`, `'rgbx'` and `'bgrx'` have none: `alpha` is accepted for them and does nothing, and `transparent: false` too, but `transparent: true` or a cutoff throws `invalid-argument` on `'options.transparent'` (no pixel of such an image can be transparent, and for `'rgbx'` and `'bgrx'` it usually means the fourth byte is alpha after all: use `'rgba'` or `'bgra'`). A clustering's stored cutoff is not an option, so mapping an `'rgb'` image with a clustering made with `transparent` still works. Two options handle it, at different stages, and naming both is an error:

- **`alpha`** (the default, `'weight'`) weighs each pixel by its opacity when clustering, and each pixel keeps its own alpha in the output. Use it for swatches and for images that keep their alpha.
- **`transparent`** is for destinations with one transparent colour, as GIF and palette PNG have. Pass it in the clustering step too, so the palette you cut is the one you map with. Translucent palette colours are not supported.

The cutoff decides which side a half-transparent pixel falls on. With the default (128), a soft drop shadow under 50% opacity disappears, and the darker part of it becomes solid; raise the cutoff (`transparent: 200`) to drop more of it, or lower it to keep more.

## Palette and Clustering

The palettes and clusterings this library returns are ordinary `Uint8Array`s with a hidden tag: what they are and, for a palette, the colour space it was made in. Anything that takes bytes takes them, and their `constructor` is `Uint8Array`, so `expect(palette).toEqual(new Uint8Array([...]))` passes in your tests. The tags buy five things:

- **A palette maps in the space it was made in.** `quantizeWithPalette(image, palette)` matches an OKLab palette in OKLab without being told; name a `colorSpace` to override it. Plain bytes are matched in RGB.
- **A clustering can't be passed as a palette**, or the other way round. TypeScript rejects it, and at run time it throws (`invalid-argument` or `invalid-clustering`), with no guessing about bytes.
- **`new Palette(bytes, colorSpace)` and `new Clustering(bytes)` give bytes their type back**, and check them: `new Palette([300, 0, 0])` throws rather than wrapping 300 to 44, and `new Clustering(bytes)` throws `invalid-clustering` unless they are one. The functions still accept a clustering as plain bytes, so stored clusterings keep working in JavaScript; TypeScript wants the constructor.
- **A clustering is checked before it is used.** Clusterings carry a checksum, so stored bytes that came back damaged (truncated, a changed byte, a lossy base64 round trip) are reported as `invalid-clustering` rather than cut into a wrong palette. It is checked the first time an array is used, so bytes changed in place after that aren't caught. Clusterings from 2.x have no checksum. It catches accidents, not tampering (anyone can recompute it): a clustering or palette from an untrusted user can't crash the library or make it hang, but it can describe any palette it likes.
- **A clustering has [methods](#clustering-methods)** for cutting and mapping it: `clustering.getPalette(k)`, `clustering.quantize(image, k)` and the rest.

```js
import { Clustering, Palette } from 'agglomerative-clustering';

const stored = new Uint8Array(await db.get('clustering'));       // what storage gives back: plain bytes
const clustering = new Clustering(stored);                        // typed again, and checked
const palette = await clustering.getPalette(8);
palette instanceof Palette;                                       // true
palette.colorSpace;                                               // 'rgb' or 'oklab', as it was clustered
palette.slice(0, 3) instanceof Palette;                           // false: slice, subarray and clones are plain bytes
```

`slice`, `subarray`, `structuredClone`, `postMessage` and storage give plain, untagged `Uint8Array`s (the worker entry carries the tags across for you). In Node, `console.log` shows the tag: `Palette(oklab) Uint8Array(6) [ … ]`.

**Copies of the package.** An app can load more than one copy: the ES-module and CommonJS builds, a bundler's duplicate chunk, or a dependency's own copy in `node_modules`. Copies of the same version recognise each other's palettes and clusterings: `instanceof Palette` and `instanceof Clustering` hold, a palette keeps its colour space, and each copy's functions take the other's values. Today a clustering's methods run on the calling thread with the main entry that shares its copy of the package (the first one loaded, if there are several); where that entry isn't loaded, they reject with `wasm-load-failed`, so use the functions of the copy you imported, or wrap the bytes with its `new Clustering(bytes)`. A clustering from a copy older than 3.3 still passes `instanceof Clustering` but has no methods (calling one throws a `TypeError`): wrap it the same way. Each copy loads its own WebAssembly module, so call `init({ wasm })` on each copy you use.

**Storing a clustering.** A clustering of a 768×512 photo is 0.3 to 1.5 MB, typically 0.7 MB (0.2 MB with `precision: 6`). Its format is versioned and its colour space is in its bytes, so `new Clustering(bytes)` is all it needs when read back. The guides have a [recipe](guides.md#storing-clusterings) with the errors to expect.

**Storing a palette.** Storage keeps a palette's bytes but not its colour space, and plain bytes are matched in RGB. So an OKLab palette that you store and read back maps differently from the one you stored, without an error. Store the colour space with it and give it back:

```js
await db.put('palette', { bytes: Array.from(palette), colorSpace: palette.colorSpace });
const { bytes, colorSpace } = await db.get('palette');
const restored = new Palette(bytes, colorSpace);   // maps exactly as the palette you stored
```

## Clustering methods

A `Clustering` has methods for the cluster-once workflow: cut it to a palette, read what it holds, map an image with it. They run on the calling thread with the main entry; off it, a loaded handle (`worker.load(clustering)`) has the same methods. The receiver is checked first, as it is written first. Three messages name the method, because the mistake is in how it was called: a method called without its clustering, `clustering.quantize(16)` (the image goes first), and options passed to a cut.

```js
import { buildClustering, Clustering } from 'agglomerative-clustering';

const clustering = await buildClustering(image, { colorSpace: 'oklab' });   // the expensive step, done once
const palette = await clustering.getPalette(8);                            // well under a millisecond, for any k
const { explained } = await clustering.getClusteringInfo();
const reduced = await clustering.quantize(image, 16, { dither: 'atkinson' });

const restored = new Clustering(await db.get('clustering'));               // stored bytes get the methods back
```

- **Where they are:** on every clustering the library returns (from either entry, and from a worker's `handle.getClustering()`), and on `new Clustering(bytes)`. `slice`, `subarray`, clones and storage give plain bytes without them, as they drop the tags: wrap stored bytes with `new Clustering(bytes)`, or load them in a worker with `worker.load(bytes)`.
- **Where they run:** on the calling thread, with the main entry. With only the worker entry imported, they reject with `wasm-load-failed` (see [Worker entry](#worker-entry)).
- **They are async,** like the functions. Once the module is loaded, a cut settles at once, so a slider can call `clustering.getPalette(k)` on every input event.
- **Only clusterings made by 3.3 or later have them.** A clustering from an older copy of the package (say a dependency that still pins 3.2) is tagged but has no methods, so `clustering.getPalette` is `undefined` there; wrap it with this copy's `new Clustering(bytes)`.
- **In tests,** a mock of the module doesn't see `clustering.getPalette(k)`: the method doesn't call through the module's exports. Spy on `clustering.getPalette` itself, on a real clustering, with `vi.spyOn` (or `jest.spyOn`).

### `clustering.getPalette(k): Promise<Palette>`
Cuts a clustering to at most `k` colours, returned as flat RGB bytes. This takes well under a millisecond. Colours come in split order: index 0 is the dominant colour at two colours and keeps its place as the palette grows (it is not always the heaviest entry of a larger palette), and the palette for `k + 1` is the palette for `k` with one entry refined (the larger half of a split keeps its parent's place) and the smaller half appended. Accepts clusterings from 2.x too. `k` is a maximum: an image with fewer distinct colours gives fewer entries. Takes no options. Off the thread: `(await worker.load(clustering)).getPalette(k)`.

### `clustering.getSwatches(k): Promise<Swatches>`
The same as `buildSwatches` from a clustering you already have, well under a millisecond. Needs a clustering from 3.x: 2.x clusterings don't record weights, so they are rejected. Takes no options.

### `clustering.getClusteringInfo(): Promise<ClusteringInfo>`
What a clustering holds: `{ formatVersion, colorSpace, precision, transparent, maxColors, totalWeight, mse, explained }`. Needs a clustering from 3.x: a 2.x clustering recorded no weights, so it is rejected with `unsupported-version` (the palette and mapping methods still read it). Takes no options.

- `formatVersion`: the format of its bytes (compare it with the exported `formatVersion`).
- `transparent`: the alpha cutoff it was made with, or `false`. `clustering.quantizeToIndices` uses it by default.
- `maxColors`: the largest palette it can be cut to.
- `mse[k - 1]`: the mean squared error per channel of the `k`-colour clustering, in 8-bit RGB values (OKLab units for an OKLab clustering). `mse[0]` is the image's variance, and `mse[maxColors - 1]` is 0 at the default `precision: 8` (below 8, it is the error that grouping colours discarded). It is an estimate from merge costs; mapping pixels to the palette usually lowers it by another 10–15%.
- `explained[k - 1]`: `1 - mse[k - 1] / mse[0]`, the share of the image's variance the `k`-colour palette keeps, from 0 to 1. It has no units, so a target such as `0.99` means the same in both colour spaces. Being relative to the image's own variance, it is a poor guide to how many colours an image needs: to choose a palette size by error, see [the guides](guides.md#choosing-a-palette-size).

### `clustering.quantize(image, k, options?): Promise<the type of image>`
Maps the image to the `k`-colour palette of the clustering you already have, matched in the clustering's colour space unless you name one. Returns the same kind of thing as `quantize`. It takes the image first, unlike a worker handle's `quantize(k)`, which maps the image it holds.

Options: `colorSpace` (defaults to the clustering's), `dither`, `width`, `signal`, `onProgress`.

### `clustering.quantizeToIndices(image, k, options?): Promise<IndexedImage>`
The same as `quantizeToIndices`, from a clustering you already have. The default `transparent` is the cutoff the clustering was made with (`(await clustering.getClusteringInfo()).transparent`), so clustering and mapping agree unless you name another.

Options: `colorSpace` (defaults to the clustering's), `dither`, `width`, `signal`, `onProgress`, `transparent`.

### `clustering.chooseFrom(palette, k, options?): Promise<PaletteChoice>`
Chooses the `k` entries of a fixed palette (the threads you own, the bricks in a set, the inks of a panel) that best represent the clustered image. It returns `{ indices, palette }`: `indices` are exactly `k` positions in the palette you gave, ascending and not ranked (count the mapped pixels for a legend), and `palette` holds those entries' colours in the same order, tagged `'rgb'` whatever space the search measured in, so `quantizeToIndicesWithPalette(image, result.palette)` maps in RGB and index `s` is entry `indices[s]`. The result is a good choice, not always the best one: it is a search (snap each cut of the clustering to its nearest entries, then swap entries in and out while that brings the image closer), the same as the guides' [fixed-palette recipe](guides.md#fixed-palettes-e-ink-thread-bricks), and it depends only on the clustering, the palette's bytes, `k` and `colorSpace`. It runs on the calling thread, with the main entry. An image with fewer colours than `k` still gets `k` entries, and an empty image gets the first `k`.

`k` is a whole number from 1 to the palette's entry count. `colorSpace` is the space the search measures distance in, `'rgb'` unless you pass it: it does not follow the clustering's space, nor a `Palette`'s tag. `'oklab'` lowers the mean ΔE2000 but can grey out small vivid areas. There is no function form and no `onProgress`: the search takes 18 to 64 ms (86 ms at worst) for 12 to 40 of 584 to 1000 entries, and `signal` is checked between its passes. Time and memory grow with the palette's entry count (the search keeps an entries × 1024 table): for 12 to 40 of 4096 entries, 110 to 250 ms scoring in RGB and 168 to 304 ms in OKLab (471 ms at worst). It is sized for charts of up to a few thousand entries.<!-- bench/spikes/choose-from/speed.mjs → results-speed.txt -->

Options: `colorSpace`, `signal`.

## Cancelling and progress

Every function that takes an image accepts `signal` and `onProgress`, whether it clusters, maps pixels or both. **A cancelled call rejects with the signal's `reason`**, a DOM `AbortError` unless you gave another, and not with one of this library's errors: it has no `code` from the [error table](#errors), so check `signal.aborted` to tell a cancel from a failure.


```js
const controller = new AbortController();
const clustering = await buildClustering(image, {
  signal: controller.signal,                       // controller.abort() cancels it
  onProgress: (fraction) => bar.value = fraction,  // 0 to 1
});
```

- **Slices.** With either option, clustering and mapping run in slices of about 10 ms (one can overrun to a few tens of milliseconds on a very large image: see [Performance and limits](performance.md#large-images)), so an abort takes effect within a slice and the page stays responsive. The result is the same, for every dither method; slicing costs about 5% more time when clustering and about 3% when mapping<!-- bench/spikes/slicing-mapping/overhead.mjs → results-overhead.txt -->. A call that finishes within its first slice (a small image) doesn't yield at all.
- **Aborting** rejects with the signal's `reason` (an `AbortError` by default), like `fetch`. It is not one of this library's errors, and has none of their codes (a `DOMException`'s `code` is a number). To tell an abort from a failure, check your signal (`signal.aborted`), not the error: a reason you gave (`controller.abort(new Error('superseded'))`) keeps its own name. An already aborted signal does no work.
- **Progress** is approximate, never goes backwards, and ends at exactly 1. It is reported between slices, about every 10 ms, so a small image may report only 0 and 1. In `quantize` and `quantizeToIndices` it covers the clustering and the mapping together.
- **Before 3.7.0** mapping ran in one piece: the functions that only map checked the signal before they started and rejected `onProgress`, and a mapping already running finished (in the worker entry too, holding up the calls queued behind it).
- **In a worker** the work in the worker stops too, and a call still queued is removed without running. The worker keeps running for later calls.

## Errors

Every error the library throws is an `Error` with a `code`, so you don't have to match on message text. The exception is a cancelled call, which rejects with the signal's own `reason` (a DOM `AbortError` by default, with no library `code`: see [Cancelling and progress](#cancelling-and-progress)). `createWorker()`, `new Clustering()` and `new Palette()` are not async: they throw their errors synchronously, where every other function rejects. Messages start `Invalid <thing>:`, except an `unsupported-version` error, which is about a valid clustering from another format version and starts `Unsupported clustering:`.

When an error is about one argument, `error.argument` names it: `'image'`, `'k'`, `'clustering'`, `'palette'`, `'options'`, `'colorSpace'` (from `new Palette`), or `'options.<name>'` (for example `'options.colorSpace'`, and `'options.script'`, `'options.wasm'` or `'options.transfer'` for the options of `init` and `createWorker`), or `'options.dither.<name>'` (`method`, `strength` or `steps`: a setting inside the dither option's object form, or the name of a key it doesn't take), so a form can point at the right field. Arguments are checked in the order you pass them, so the error is about the first that is wrong.

| `code` | When |
| --- | --- |
| `invalid-argument` | A bad image (including a key an image object doesn't have, or `premultiplied: true` on a format without alpha, or a `premultiplied` that isn't a boolean), `k`, option or palette. |
| `invalid-clustering` | Bytes that aren't a clustering this version can read, or a stored clustering that came back damaged (its checksum or its records don't fit). |
| `unsupported-version` | A clustering from a newer format, or using a colour space it doesn't know (upgrade the package), or an older one without what you asked for (cluster again, e.g. for `clustering.getSwatches(k)`). |
| `out-of-memory` | The WebAssembly module couldn't allocate: an image with very many colours, or pixel data over its 2 GB (the message gives the size). |
| `wasm-load-failed` | The WebAssembly module couldn't be loaded or compiled: a missing or blocked `.wasm` file, a server bundle that moved it, a browser without SIMD, or a `.wasm` from a different version of the library than the script (a stale cache or CDN copy; the message names both versions). The message leads with the engine's reason and says what to check, and `cause` is the engine's own error. Also a [`Clustering` method](#clustering-methods) called where the main entry isn't loaded, with no `cause`: import the main entry on that thread. |
| `worker-terminated`, `worker-failed`, `invalid-handle` | Worker entry only: the worker was stopped, failed, or a handle was released. `worker-terminated` is for calls running or waiting when `terminate()` was called, and every later call on that `createWorker()` worker, so retrying on it can't help (the shared worker starts again on the next call). `worker-failed` is also for a worker script from another version of the package (the first message to every worker asks its version): every call on it rejects until you use this version's `worker-thread.mjs`. After `worker-failed` (it couldn't start, crashed, exited or was the wrong version), the next call starts a new worker. |

```js
import { Clustering, isCodedError } from 'agglomerative-clustering';

try {
  await new Clustering(stored).getPalette(16);
} catch (error) {
  // isCodedError narrows the type in TypeScript, and is false for errors that aren't the library's (Node's ENOENT, an abort)
  if (isCodedError(error) && (error.code === 'unsupported-version' || error.code === 'invalid-clustering')) { /* cluster the image again */ }
  else { throw error; }
}
```

`errorCodes` lists every code, for code that forwards them (a wrapper package re-exporting them, a bridge between processes). `isCodedError` also accepts a plain object with a known `code` and a `message`, which is what an error becomes after Electron's IPC or a `postMessage`. New codes can appear in a minor release, so switch over them with a default branch.

Messages are for people and may change. The worker entry fails the same way as the main entry, with your call's stack (the worker's is on `cause`). A failure that isn't the library's own, such as a WebAssembly trap, has no `code`. For what to do about each, see [Troubleshooting](troubleshooting.md).

### Warnings

There are none. A 3.x release may warn about a call the next major version will reject, and 4.0 turned the two warnings it had (`rgb-as-rgba` and `gray-as-rgba`, for a bare `Uint8Array` that looks like RGB or grey) into the `invalid-argument` error on `'image'` described under "Input". If a warning is added in a later 4.x release, it will go through `process.emitWarning` in Node, Bun and Deno (a warning named `AgglomerativeClusteringWarning` with a `code`) and `console.warn` elsewhere, and become an error in 5.0.

## Worker entry

`agglomerative-clustering/worker` exports every function of the main entry, run in one shared worker started on first use, plus `terminate()`, which stops it (the next call starts a new one), and `createWorker(options?)`, which starts a worker of your own. A worker has every function as a method, plus:

- **`cluster(image, options?)`** keeps the image and its clustering in the worker, behind a handle with `handle.getClustering()`, `handle.getPalette(k)`, `handle.getSwatches(k)`, `handle.getClusteringInfo()`, `handle.chooseFrom(palette, k, options?)` (the clustering method of the same name, run in the worker: `colorSpace` and `signal` only), `handle.quantize(k, options?)`, `handle.quantizeToIndices(k, options?)`, `handle.quantizeWithPalette(palette, options?)` and `handle.quantizeToIndicesWithPalette(palette, options?)`. A palette of plain bytes is matched in the handle's colour space, and `quantizeToIndices` uses the cutoff it was clustered with. Free it with `release()`, or declare it with `await using handle = await worker.cluster(image)`; a dropped handle is freed only when the garbage collector gets to it.
- **`load(clustering)`** keeps a stored clustering in the worker, behind a `LoadedClusteringHandle` with `loaded.getPalette(k)`, `loaded.getSwatches(k)`, `loaded.getClusteringInfo()`, `loaded.chooseFrom(palette, k, options?)`, `loaded.quantize(image, k, options?)` and `loaded.quantizeToIndices(image, k, options?)`. It holds no image, so the mapping methods take the one to map (and return its type), and it has no `loaded.getClustering()` (you passed the clustering in) and no `…WithPalette` methods (use `worker.quantizeWithPalette`). The clustering is checked and its bytes taken at the call, as for any argument. `signal` and `onProgress` work on the mapping methods. Free it with `release()`, or `await using loaded = await worker.load(clustering)`, which sends the clustering once instead of with every call.

  The two kinds of handle differ in what they keep, and so in how they map:

  | Handle from | Keeps | Maps with |
  |---|---|---|
  | `cluster(image)` | the image and its clustering | `quantize(k)` |
  | `load(clustering)` | only the clustering | `quantize(image, k)` |
- **`terminate()`** stops the worker and rejects the calls still waiting. `await using worker = createWorker()` calls it at the end of the block. After it, the next call starts a new worker only for the shared worker (the `terminate()` the entry itself exports); a `createWorker()` worker is finished, and every later call on it rejects with `worker-terminated`.

**A `Clustering`'s methods run on the calling thread,** using the main entry: import `agglomerative-clustering` in that thread (and call its `init({ wasm })` if you set where the module comes from), or they reject with `wasm-load-failed`. To cut or map a clustering off the thread, use `worker.load(clustering)` or a `worker.cluster()` handle.

**Terminate the workers you create.** A worker's thread, and the memory its last images needed, stay until `terminate()`: a running worker is never garbage-collected, so a server or page that creates a worker per request and drops it gathers threads. Keep a few workers and reuse them (see [the pool](performance.md#servers)), or use the shared worker. As a safety net, a worker you dropped is stopped some time after the garbage collector has collected it, once no call is running on it and no handle from it is left, but when that happens is up to the engine (it may be never, in a process with little memory pressure).

`createWorker` takes `transfer`, `wasm` (see [Loading the WebAssembly module](environments.md#loading-the-webassembly-module)) and `script`: the URL (or in Node, the path) of the `worker-thread.mjs` in a copy of the package's `dist/` folder, for setups whose bundler doesn't emit the package's own. Copy all of `dist/` (as [Environments](environments.md#loading-the-webassembly-module) says under "Copying files"), not that one file: the script imports `index.mjs`, `shared.mjs`, `choose.mjs`, `clustering.js` and `clustering.wasm` from beside it, and files from different versions of the package fail to start (`worker-failed`). For the shared worker, `init({ script })` does the same, before any other call. `createWorker()` itself throws synchronously (it is not async) for a bad option; the calls on the worker it returns reject.

Calls run one at a time, in order. Results are transferred back without copying. Images, and clusterings passed to `load`, are copied in, unless you create the worker with `createWorker({ transfer: true })`, which is faster but leaves your buffer empty (at once if the worker has not started yet, otherwise when the call posts it). Only an array that is a whole buffer of its own is transferred; a view into part of a larger buffer, such as a `subarray` or a small Node `Buffer`, is copied.

The worker is started with `new Worker(new URL('./worker-thread.mjs', import.meta.url))`, the form bundlers look for (see [Environments](environments.md#angular-esbuild-rollup-and-other-bundlers) for those that don't). Loaded from a CDN (another origin than the page), it starts the worker through a small `blob:` script, as browsers don't start workers from other origins' scripts. In Node an idle worker never keeps the process alive.

The entry is an ES module, with a CommonJS build for `require()` in Node and in Jest. In a browser bundle, import it rather than `require()` it: bundlers find the worker script only from the ES module, so the CommonJS build there needs `createWorker({ script })`.

## TypeScript

Both entries ship declarations, checked in CI under strict mode with `nodenext` (ES module and CommonJS importers), `bundler`, and a Node-only project without the DOM lib. The worker entry's declarations use `await using` for handles, so they need **TypeScript 5.2 or newer** (or `skipLibCheck: true`); the main entry works on older versions. Both entries have CommonJS declarations too, so a `.cts` file or a CommonJS project imports either.

- **Image objects:** one assigned to a variable before it is passed widens `format: 'rgba'` to `string`, which no longer matches `RawImage`: write `format: 'rgba' as const`, or declare the variable as `RawImage`.
- **Dither settings in a variable** widen the same way: `const dither = { method: 'ordered', steps: 32 }` has `method: string`. Write `as const`, or declare it as `DitherOptions`. A `steps` value from a slider is a `number`, and a method from a `<select>` a `string`: narrow them with the exported lists, `ditherSteps.find((s) => s === value)` and `ditherMethods.find((m) => m === value)` (see [Lists of names](#lists-of-names-colorspaces-imageformats-alphamodes-dithermethods-and-dithersteps)).
- **Results narrow:** checking `result.indexBits === 8` makes `indices` a `Uint8Array`.
- **Results keep the input's types:** a mapped `{ data, format: 'bgra' }` result has `format: 'bgra'` and `data: Uint8Array`, so you can write its bytes or pass it on without a cast. `RawImage` is a union split by `format`, and `premultiplied: true` on `'rgb'`, `'rgbx'` or `'bgrx'` is rejected at run time (`invalid-argument`; the types accept a boolean). A variable reused for inputs of different formats needs the annotation `RawImage`, and `interface X extends RawImage` becomes `type X = RawImage<'rgba'>` ([Migrating](migrating.md#from-3x-to-40)).
- **`ImageFormat` grows** in minor releases (3.2 added `'bgra'`, `'rgbx'` and `'bgrx'`), so code that lists every format (an exhaustive `switch`, a `Record<ImageFormat, …>`, a union spelled out as `'rgb' | 'rgba'`) needs a new case when it does; take the names from `imageFormats`, or end a `switch` with a default branch.
- **Clustering methods** exist only on values from the library or `new Clustering(bytes)`: a cast (`stored as Clustering`) or a `structuredClone` of a clustering is typed `Clustering` but is plain bytes, so calling a method on it compiles, then fails with `TypeError: … is not a function`. Wrap it: `new Clustering(structuredClone(clustering))`. Types can't tell whether the main entry is loaded either: in a worker-only app the methods compile, then reject with `wasm-load-failed`.
- **Palettes:** palette parameters take a `PaletteLike` (a `Palette`, plain bytes or a `number[]`, not a `Clustering`). Stored bytes need `new Clustering(bytes)` to be accepted as a clustering.
- **Errors** are `CodedError`s with `code` and `argument`.
- **Handles** keep the image type they were made from: a variable that holds one is `ClusteringHandle<ImageData> | null`, not a bare `ClusteringHandle`, whose `quantize` returns the general image type.

## Functions

### `buildClustering(image, options?): Promise<Clustering>`
Builds the colour hierarchy for an image. Cut it with its [methods](#clustering-methods) (`clustering.getPalette(k)`, `clustering.quantize(image, k)`) to get any number of palettes without clustering again. In the worker entry, `buildClustering(image)` returns the clustering's bytes, as here; `worker.cluster(image)` instead keeps the image and its clustering in the worker and returns a handle.

Options: `colorSpace`, `precision`, `alpha`, `transparent`, `signal`, `onProgress`.

### `buildPalette(image, k, options?): Promise<Palette>`
`buildClustering` followed by `clustering.getPalette(k)`.

Options: `colorSpace`, `precision`, `alpha`, `transparent`, `signal`, `onProgress`.

### `buildSwatches(image, k, options?): Promise<Swatches>`
A palette with how much of the image each colour covers, for swatches with percentages. It returns `{ palette, weights, shares }`, three arrays from one cut of one clustering, so entry `i` of each describes the same colour:
- `palette` is flat RGB bytes in split order (what `clustering.getPalette(k)` gives).
- `weights` are pixels per colour. Fully transparent pixels count 0 and partly transparent ones in proportion to their opacity, as in clustering; with `alpha: 'ignore'` every pixel counts 1.
- `shares` are the weights divided by their total, so they sum to 1.

All three are empty for an image with no visible pixels, and `k` is a maximum, so lay swatches out from the arrays' length, not from `k`. It clusters the image each time: to try several sizes, use `buildClustering` once and `clustering.getSwatches(k)`.

Options: `colorSpace`, `precision`, `alpha`, `transparent`, `signal`, `onProgress`.

### `quantize(image, k, options?): Promise<the type of image>`
Reduces the image to at most `k` colours.

Options: `colorSpace`, `precision`, `alpha`, `transparent`, `dither`, `width`, `signal`, `onProgress`.

### `quantizeWithPalette(image, palette, options?): Promise<the type of image>`
Maps each pixel to its nearest colour in any palette: a `Palette`, or flat RGB bytes (a `Uint8Array`, `Uint8ClampedArray`, or plain array of integers 0–255; flatten an array of `[r, g, b]` colours first with `colors.flat()`). A `Palette` is matched in its own colour space and plain bytes in RGB, unless you name a `colorSpace`. The result doesn't depend on the palette's order: equally near colours are decided by their RGB value.

Options: `colorSpace` (defaults to the palette's own), `dither`, `width`, `signal`, `onProgress`.

### `quantizeToIndices(image, k, options?): Promise<IndexedImage>`
Like `quantize`, but returns each pixel's palette index rather than its colour: what palette PNGs, GIFs, pixel art and pattern generators need.

Options: `colorSpace`, `precision`, `alpha`, `transparent`, `dither`, `width`, `signal`, `onProgress`.

The result is `{ palette, colors, indices, indexBits, transparentIndex }`, plus `width` and `height` when the input has them:
- `palette`: the flat RGB bytes an encoder wants, including the transparent entry if there is one.
- `colors`: the same without the transparent entry, to pass to `quantizeToIndicesWithPalette` for more images with these colours.
- `indices`: one per pixel, a `Uint8Array` for up to 256 entries, `Uint16Array` up to 65536, else `Uint32Array`; `indexBits` (8, 16 or 32) says which.
- `transparentIndex`: the transparent entry's index, or `null`.

With `transparent`, pixels of an RGBA or BGRA image below the cutoff get the transparent entry (appended after the colours, and counted in `k`) and every other pixel is shown fully opaque, which is all a GIF can express, so anti-aliased edges snap to one side. The colours are chosen from the visible pixels, the same as `buildPalette(image, k - 1, { transparent: true })` when the image has pixels below the cutoff; when it has none there is no transparent entry, and all `k` entries are colours. At least one colour is always kept. See [Transparency](#transparency).

```js
const { palette, colors, indices, transparentIndex } = await quantizeToIndices(imageData, 256, { transparent: true });
```

### `quantizeToIndicesWithPalette(image, palette, options?): Promise<IndexedImage>`
The same as `quantizeToIndices`, with a palette you supply. The result's `palette` is the palette you give, in its order, so each index is a position in it. There is no `k`: the transparent entry is added after the palette you give, so a 256-colour palette gives 257 entries. To use only some of a large chart (the 12 threads out of 400 that best match a photo, the bricks to buy), choose them first: see [Fixed palettes](guides.md#fixed-palettes-e-ink-thread-bricks) in the guides.

Options: `colorSpace` (defaults to the palette's own), `dither`, `width`, `signal`, `onProgress`, `transparent`.

### `init(options?): Promise<void>`
Loads the WebAssembly module. Every other function does this on first use, so calling it is optional, for example to warm up before a batch. Concurrent calls share one load, and a failed load can be retried. To say where the module is, see [Loading the WebAssembly module](environments.md#loading-the-webassembly-module).

### `errorCodes: readonly string[]` and `isCodedError(value): boolean`
`errorCodes` is a frozen array of every `code` the library's errors have (see [Errors](#errors)). `isCodedError(value)` is true when `value` has a string `message` and one of those codes; in TypeScript it narrows to `CodedError`. Both entries export both.

### Lists of names: `colorSpaces`, `imageFormats`, `alphaModes`, `ditherMethods` and `ditherSteps`
Frozen arrays of every value of the options that take one of a fixed set of names (see [Lists of names](#options)): `colorSpaces` (`'rgb'`, `'oklab'`), `imageFormats` (`'rgb'`, `'rgba'`, `'bgra'`, `'rgbx'`, `'bgrx'`), `alphaModes` (`'weight'`, `'ignore'`), `ditherMethods` (`'floyd-steinberg'`, `'atkinson'`, `'ordered'`) and `ditherSteps` (2, 4, 8, 16, 32, 64). In TypeScript each is typed as a list of its option's type, so `find` narrows a value from a form: `ditherMethods.find((m) => m === select.value)` is a `DitherMethod` or `undefined`, and `ditherSteps.find((s) => s === Number(slider.value))` a `DitherSteps`. No dithering is `dither: false`, not a method. Both entries export all of them.

### `version: string` and `formatVersion: number`
`version` is the library's version (such as `'3.0.0'`), for bug reports and runtime checks. `formatVersion` is the version of the data it stores (the clustering format), which changes only when that format does: a minor release may raise it, and every earlier format from 2 on stays readable. To keep stored clusterings current, cluster the image again when `(await new Clustering(stored).getClusteringInfo()).formatVersion` is below it, or when `new Clustering(stored)` throws or `getClusteringInfo()` rejects with `unsupported-version` (a 2.x clustering, which has no weights, or one from a newer version than this one). Both entries export both, and a `.wasm` from another version fails to load with `wasm-load-failed`.
