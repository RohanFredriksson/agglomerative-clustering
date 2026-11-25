# 4.0, part 1: premultiplied input, `RawImage` by format, unknown image keys, narrowed results

Date: 2026-11-25. Status: revised after review (builder check, three stewards, `user-advocate`, cold reader), for approval.

## Intent

4.0 breaks once so 4.x starts with one way to do each thing (spec `2026-11-24-3-8-and-4-0-design.md`, "4.0 (breaking)"). Its items split in two parts, decided by the maintainer on 2026-11-25:

1. **This spec:** items 3, 4 and 5 of that list, which belong together (ROADMAP 4.0, "Premultiplied alpha": reading the field, typing it, and catching its typo are each breaking, so they ship as one): `premultiplied: true` on image objects, `RawImage` as a union split by `format`, unknown keys on image objects rejected, and results narrowed to the input's type.
2. **A second plan, without a spec:** the removals (`…FromClustering`, the `get…` names that cluster, the worker's old wire names), the bare-image warnings becoming errors, `transparent` on formats without alpha, and dropping Node 20 (below). Those are written out in the ROADMAP's 4.0 section (Node 20 added there with this spec).

Why premultiplied input: premultiplied buffers are common (Electron's `nativeImage.toBitmap()`, node-canvas `toBuffer('raw')`, `@napi-rs/canvas` `data()`, WebCodecs frames from a canvas, WIC `32bppPBGRA`, WebGL `readPixels`). Passed as straight alpha they darken translucent edges (#ff1d1d read as #750e0e in the 3.2.0 exploratory round). Converting in JavaScript costs about as much as `quantize` (190 ms against 210 ms on a 4K image) and runs on the calling thread even with the worker entry (ROADMAP 4.0).

No value brief: the capability, its users and the recipe's cost were established in the 3.2.0 design and exploratory round and recorded in the ROADMAP; the maintainer scheduled it for 4.0 then.

## Decisions

- **Settled before this spec** (ROADMAP 4.0, 2026-11-24 spec): `{ data, format, premultiplied: true }` for `'rgba'` and `'bgra'`; read as `min(255, round(c·255/a))` per channel, alpha 0 as black; `quantize*` output premultiplied again, `round(c·a/255)`; palettes and clusterings straight; the conversion in C++; `RawImage` a union by `format`; unknown keys on image objects rejected with a near-miss hint for `premultiply`; results `RawImage<F>` with `data: Uint8Array` and the input's `format`, `width`, `height`.
- **Where the conversion runs (2026-11-25, maintainer: A):** one in-place pass over the copy of the pixels the library already makes in the WebAssembly heap, before clustering or mapping reads them, and one in-place pass over `quantize`'s output after mapping. The pixel loops (histogram scan, mapping, the three dither methods, the output sink) are not touched.
  - Considered: two internal format codes read inside every pixel loop (no extra pass, but a branch in every reader and the sink, where the speed and size work is); converting in JavaScript (ruled out by the ROADMAP's measurement).
  - Measured: with a 64 KB table per direction, a pass over a 12 MP image takes 5 ms when every pixel is opaque (skipped), 18 ms un-premultiplying and 17 ms premultiplying with every alpha value present, against 52 and 27 ms with integer division<!-- bench/spikes/premultiplied/pass.cpp, run.mjs → results.txt -->. Clustering that image takes seconds, so the cost is a few percent at most on translucent images and close to nothing on opaque ones.
- **Node 20 is dropped in 4.0 (2026-11-25, maintainer).** `engines` becomes `>=22.12.0` (the floor for `require(esm)`, which the CommonJS build needs), CI tests 22 and 24. Node 20 reached end of life on 2026-04-30; users on it stay on 3.8. 3.8 is the last 3.x minor, so under CLAUDE.md "Branches and releases" it is the line that gets patches, on request after 4.0.0, from `patch/3.8.N` branched off the last 3.8 tag and published to `v3.8-latest`, with fixes cherry-picked to master. In part 2's plan, which also updates CLAUDE.md's `engines` and CI-matrix lines, `docs/migrating.md` ("Node 20.19+ or 22.12+") and `docs/environments.md` (the AWS Lambda Node 20 check). Recorded in the ROADMAP's 4.0 section with this spec.
- **Every function that takes an image takes `premultiplied`** (builder check, `roadmap-steward`): the clustering functions (`buildClustering`, `buildPalette`, `buildSwatches`), `quantize`, `quantizeToIndices`, `quantizeWithPalette`, `quantizeToIndicesWithPalette`, the `Clustering` methods, image handles (the handle keeps the image object, flag included) and loaded handles' mapping methods. Mapped output (`quantize`, `quantizeWithPalette`, and their methods and handles) is premultiplied again; indexed output and palettes are straight.
- **No straight-output override** (`user-advocate`): premultiplied in means premultiplied out for mapped images, always. A caller who reads a premultiplied source and writes to a straight destination (an `ImageData`, a PNG encoder) un-premultiplies the output, or converts the input before the call as in 3.x. Accepted, and stated in the docs; an option can be added later without breaking anything if it is asked for.

## The API

### Image objects

```ts
/** RGBA or BGRA bytes. `premultiplied: true` says the colours are multiplied by alpha (canvas, Electron, WebGL). */
interface RawImageWithAlpha<F extends 'rgba' | 'bgra' = 'rgba' | 'bgra'> {
    data: Uint8Array | Uint8ClampedArray;
    format: F;
    width?: number | undefined;
    height?: number | undefined;
    /** Colours multiplied by alpha. Read as straight colours (divided by alpha); `quantize*` gives them back multiplied. */
    premultiplied?: boolean | undefined;
}
/** Formats without alpha. `premultiplied: false` says nothing; `true` is rejected at run time (there is no alpha). */
interface RawImageWithoutAlpha<F extends 'rgb' | 'rgbx' | 'bgrx' = 'rgb' | 'rgbx' | 'bgrx'> {
    data: Uint8Array | Uint8ClampedArray;
    format: F;
    width?: number | undefined;
    height?: number | undefined;
    premultiplied?: boolean | undefined;
}
type RawImage<F extends ImageFormat = ImageFormat> =
    F extends 'rgba' | 'bgra' ? RawImageWithAlpha<F> : F extends 'rgb' | 'rgbx' | 'bgrx' ? RawImageWithoutAlpha<F> : never;
```

- **Why `boolean` on formats without alpha** (`api-steward`): with `false` only, an object typed `{ format: ImageFormat; premultiplied: boolean }` (a forwarded config) would stop being a `RawImage`, making the types stricter than the run-time rule. With `boolean` the compiler accepts what the run time accepts, and `premultiplied: true` on `'rgb'` is caught at run time with a message that says why. The two branch interfaces are internal names unless the type tests show callers need them; the public names are `RawImage` and `RawImage<F>`.
- **Reading:** with `premultiplied: true`, every pixel with alpha below 255 has each colour channel replaced by `min(255, round(c·255/a))`, and alpha 0 pixels become black, before anything reads them. Everything after (clustering, `alpha: 'weight'`, the transparent cutoff, mapping, dithering) sees straight colours, as if the caller had converted. Alpha itself is never changed.
- **`premultiplied: false` or absent** is today's behaviour. `premultiplied: false` on `'rgb'`, `'rgbx'` or `'bgrx'` is accepted and does nothing (like `transparent: false` there: a shared object keeps working); `premultiplied: true` on them is `invalid-argument` on `'image'`: "Invalid image: premultiplied is for 'rgba' and 'bgra'; '{format}' has no alpha, so remove it." A non-boolean is `invalid-argument` on `'image'`: "Invalid image: premultiplied must be true or false, got {value}."
- **It costs nothing on opaque pixels** (`user-advocate`): the pass skips alpha 255 (5 ms on an opaque 12 MP image, above), so a caller who can't tell whether a buffer came from a canvas (WebCodecs) can set it whenever the source may be premultiplied. The docs say so.
- **Unknown keys:** a `{ data, format }` object may have only `data`, `format`, `width`, `height` and `premultiplied`. Any other own enumerable key is `invalid-argument` on `'image'`: "Invalid image: unknown key '{key}'. An image object has data, format, width, height and premultiplied: build it from those rather than spreading a decoder's result." Keys inherited from a prototype are not checked (a class instance with `data` and `format` is checked by its own keys). A key whose value is `undefined` is still a key (a typo with an undefined value is still a typo). Near-miss hints (`scope-steward`: one rule plus one special case, no alias list):
  - `premultiply` → "Did you mean premultiplied: true?"
  - a key equal to a known one except for case, or within edit distance 1 of one (`widht`, `fromat`, `Premultiplied`) → "Did you mean '{known}'?"
  - `channels`, `size`, `depth` (sharp's `info`, fast-png's result) → "Spread only width and height from a decoder's result." (`api-steward`, `user-advocate`, cold reader: `{ ...info, data, format }` is the likeliest break, and sharp's `info.premultiplied` describes sharp's own state.)
- **`ImageData` is unchanged:** it is always straight (the canvas spec un-premultiplies `getImageData`), it is recognised by its tag or class, and its own properties (`colorSpace`, `pixelFormat`) are not image-object keys. Bare `Uint8Array`s are unchanged (straight RGBA).
- **Order of checks:** after the existing shape checks (`data` type, `format`, length, `width`/`height`), then unknown keys, then `premultiplied`. A wrong `format` is still reported first.

### Results

```ts
type ImageResult<I extends ImageLike> =
    I extends Uint8Array ? Uint8Array
    : I extends RawImage ? Omit<I, 'data'> & { data: Uint8Array }
    : I extends PlatformImageData ? PlatformImageData
    : never;
```

- A `quantize*` result for a `{ data, format }` input has exactly the input's own keys: `format`, `width` and `height` when given, `premultiplied` when given (copied as given, `false` included, not recomputed), and a new `data: Uint8Array`. This extends the ROADMAP's result list (`format`, `width`, `height`) by `premultiplied`, since the result's colours are premultiplied when the input's were (`scope-steward`, `api-steward`). At run time `data` was already always a `Uint8Array`; now the type says so, and `format` keeps its literal type. This covers the functions, the `Clustering` methods, image handles (`handle.quantize(k)` returns the type of the image the handle was made from) and loaded handles.
- **With `premultiplied: true`, the result's colours are premultiplied**, `round(c·a/255)` with the input's alpha, so the result can go back where the input came from (Electron's `createFromBitmap`, Cairo, WIC, a raw canvas surface) unchanged. Not to `ImageData` and `putImageData`, which are straight: the docs say so next to the option (`user-advocate`). Fully transparent pixels are black (0, 0, 0, 0).
- **Indexed output is unchanged:** `quantizeToIndices*` return straight palettes and indices; `IndexedImage` gains no `premultiplied` key, and its doc comment says the palette is straight even for a premultiplied input. Indexed output has no partial alpha (only the transparent entry, alpha 0, black either way), so nothing needs premultiplying (`user-advocate`).
- **The cost, accepted for 4.0, in `migrating.md` with an example each:**
  - code that reuses one `let` across calls with different literal inputs (`'rgba'` then `'bgra'`, or with and without `width`) stops compiling, as the 3.2.0 prototype showed: annotate the variable as `RawImage`;
  - `interface X extends RawImage` doesn't compile (a union can't be extended): `type X = RawImage<'rgba'>`, and the result type drops X's extra keys anyway (`Omit`);
  - a `Uint8ClampedArray` result `data` assumed by the 3.x type is now `Uint8Array`;
  - objects with extra keys, `{ ...decoded, format }` in particular, now throw: build `{ data, format, width, height }`;
  - in 3.x `premultiplied: true` was silently ignored (darkened edges, no error): code that set it hoping it worked now gets the conversion.

## How it is built

- **C++:** two exports, in place on an RGBA or BGRA buffer in the heap (alpha is the fourth byte of both): `unpremultiply(ptr, length, start, end)` and `premultiply(ptr, length, start, end)`, over pixels `[start, end)`, so JS can run them in slices; 256×256-entry tables built on first use (`table[a][c]`), alpha 255 skipped. Both formats share them, since the colour channels are treated alike. Add to `EXPORTED_FUNCTIONS`.
- **One-shot calls:** JS copies the pixels into the heap as today, calls `unpremultiply` over all of it, then runs the existing export. For `quantize*`, it calls `premultiply` on the output buffer (with the input's alpha, which mapping preserves) before reading it out.
- **Sliced calls** (`signal` or `onProgress`): the pass runs in slices of 65,536 pixels with the existing `checkAborted`/`yieldNow` between them, as the first stage of `clusterInSlices` and `mapInSlices`, and the output pass as their last stage. Its progress goes in the first (and last) slice's share, not a share of its own, unless measuring shows the bar visibly stall (`scope-steward`).
- **The JS copy of the input:** for the heap copy to be changed in place, the call must own it. Every call already copies into the heap; the worker entry's `own`/`take` copies or transfers before posting. Never convert the caller's array.
- **Worker entry:** image objects already cross as plain `{ data, format, width, height }`; `premultiplied` crosses with them, and unknown keys are checked on the caller's side before posting (so a bad key rejects without a round trip and with the same error as the main entry), then the thread checks again as the main entry does. `rebuild(image)` copies `premultiplied` to the result.
- **Types:** the union and `ImageResult` in `src/index.d.ts`, used by `src/worker.d.ts`; `test/types/*` gains:
  - `premultiplied: false` and a `boolean` on `'rgb'` compile (the run time rejects `true`);
  - a result's `data` is `Uint8Array`, `format` keeps its literal, `premultiplied` is carried;
  - `handle.quantize(k)` returns the handle's image type, a loaded handle's `quantize(image, k)` the given image's;
  - generic wrappers keep compiling: `<I extends ImageLike>(img: I) => quantize(img, 4)`, `<F extends ImageFormat>(f: F, data: Uint8Array) => quantize({ data, format: f } as RawImage<F>, 4)`, and a `RawImage<ImageFormat>` assigned to `RawImage` (`api-steward`);
  - `PlatformImageData` still resolves to `never` in the Node-only config, and a `Buffer` takes the `Uint8Array` branch;
  - an `interface X extends RawImage` that worked in 3.x is shown not to compile, with `type X = RawImage<'rgba'>` as the fix (documented).
- **Golden output is unchanged** for every input without `premultiplied: true`. New golden keys for premultiplied copies of two or three of the test images (a synthetic translucent one and a Kodak photo given a gradient alpha), clustered, cut and mapped (`quantize`, dithered and not, and `quantizeWithPalette`), plus a check that a premultiplied input gives the same palette as its straight original converted with the documented formula in JavaScript (`scope-steward`: not every image).

## Docs

- `docs/api.md` Input, rewritten where it says "straight alpha… convert premultiplied first" (cold reader):
  - the "Where pixels come from" table says `premultiplied: true` instead of "convert, then 'bgra'" (Electron, node-canvas raw, `@napi-rs/canvas`, WebGL, WebCodecs frames from a canvas, WIC PBGRA);
  - the `ImageFormat` table's "Fourth byte" column says straight, or premultiplied with the flag;
  - one sentence each: premultiplied in means premultiplied out for mapped images, not to `ImageData`; palettes and indexed output are straight; harmless on opaque data; the conversion loops are kept only for sources the flag doesn't cover (straight output from a premultiplied source);
  - `alpha: 'weight'` and `transparent` read straight alpha either way (alpha is never changed);
  - the image-object keys and the unknown-key error, with the spread example; the error table's `invalid-argument` row mentions it (no new code).
- `docs/api.md` Output: results have the input's `format`, `width`, `height` and `premultiplied`; `ImageData` and bare arrays have no flag. The "results are typed `RawImage`… cast" text goes.
- `docs/environments.md` Electron: the example passes `premultiplied: true` and draws back with `createFromBitmap`; its "planned for 4.0" sentence goes.
- `docs/migrating.md` "From 3.x to 4.0": the costs listed under Results, each with its fix, written for the first beta.
- The README's Input paragraph (line 85): "premultiplied (canvas, Electron): pass `premultiplied: true`".
- `src/index.d.ts` header comment (lines 4-5) and the `argb` hint in `src/index.js` (line 31) point at the option instead of converting first.
- The measured figures carry their source comments.

## Goals, non-goals, anti-goals

- **Goals:** premultiplied buffers go in as they come and come out the way their destination expects; a typo in an image object is an error; results carry their input's types without casts.
- **Non-goals:** premultiplied palettes or clusterings; premultiplied `ImageData`; a premultiplied `IndexedImage`; other new pixel formats (grey stays under "Considered").
- **Anti-goals:** any change to output for inputs without `premultiplied: true`; converting in JavaScript; two ways to say premultiplied (no `'bgra-premultiplied'` format name, ROADMAP).

## Constraints

- CLAUDE.md "Adding or changing public API" for every place it lists (C exports, both `.d.ts`, the worker routing, api.md, CHANGELOG, `test/api.test.js` and its snapshots, the types tests).
- Validate and take bytes before the first `await`, as every call does.
- `src/worker-thread.js` has no top-level await; tests use no `await using` syntax (Node 22 doesn't parse it) and are syntax-checked under the oldest supported Node.
- WebAssembly size: the two tables are built at run time (128 KB of zeroed memory, not in the binary); report the `.wasm` size before and after.
- ASan run and the native fuzz targets: add premultiplied inputs to `fuzz_images`.

## Release

Part 1 and part 2 land on master, which is 4.0 from the first merge (master "is the next version", CLAUDE.md); no 3.x release comes from master after that, and 3.8 patches follow the patch-line steps (above). The CHANGELOG gets a `4.0.0` section that both parts fill. `4.0.0-beta.1` on `next` once both parts are in, then an exploratory round (Sonnet agents) on it, then 4.0.0.

## Recorded with this spec

- ROADMAP 4.0: a Node 20 entry (above); the unknown-key bullet closed to "all unknown keys rejected, with near-miss hints" (it said "or the near misses of known ones"); narrowed results cover handles as well as functions and methods; "no 3.x release from master once 4.0 work merges".
- When part 1 is built: the ROADMAP's premultiplied and narrowed-results entries marked done, the in-place pass design and its figures under "Considered" (with the per-loop format codes it was chosen over), and PRINCIPLES' "deferred to 4.0" lines on premultiplied input updated.

## Not taken from review

- `api-steward` suggested part 2 make `alpha: 'weight'` throw on formats without alpha alongside `transparent: true`. It doesn't: the maintainer decided on 2026-11-24 that `alpha` never asks for anything without alpha, so no `alpha` value throws (2026-11-24 spec, decision 8; ROADMAP 4.0).

## Left to the builder

- The exact slice size and whether the pass's progress share needs measuring into `clusteringShare`.
- The near-miss distance function (edit distance 1 or case-only, as above) and where it lives (`src/shared.js`, used by both entries).
- Test layout.
