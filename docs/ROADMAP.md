# Roadmap

What is planned, what is only being considered, and what was decided against, with the reasons. Each release keeps output byte-identical unless it says otherwise; `test/golden.test.js` enforces that.

**The rule for what goes where.** 3.0 freezes the API: anything that would change the shape or defaults of an existing function was decided before it. Everything below only adds (a new option, a new value of an option, a new function), so it can come in any 3.x release without breaking anyone. Most items come from exploratory testing of the 3.0 betas: fresh agents building real projects from the npm package alone (Electron, a Chrome extension, Jest and Vitest suites, e-ink and embroidery tools, a static-site build, a wrapper package, CDNs, Deno, Bun, Cloudflare Workers, SvelteKit, Nuxt, Next.js, servers, animated GIFs).

## 2.0.1: robustness (merged, never released; ships in 3.0)

- [x] `Uint8ClampedArray` subarrays are read from their own bytes, not the start of the whole buffer.
- [x] Image data that isn't a whole number of pixels is rejected instead of silently truncated.
- [x] `quantizeWithPalette` validates its palette.
- [x] `engines` field, a CommonJS smoke test, and CI on Node 20/22/24.
- [x] Golden-output test over clusterings, palettes and quantized images.
- [x] The release build uses the same Emscripten version as the benchmarks (6.0.12).
- [x] A clustering from a newer format version gets an error asking for an upgrade, not "not a clustering".

## Clustering format versioning

The clustering is the only format users store, so it is the only one that needs versioning. Palettes are plain RGB bytes, and messages between the main thread and the worker never outlive one installed version of the package.

Since 2.0 every clustering starts with `[0xAC, version, …]`. Clusterings from 1.x had no header and were recognised only by their length (0 or 3 more than a multiple of 9, where 2.x lengths are 4 or 7 more). That was fragile in a way that mattered: many other byte strings, such as palettes of 1, 3, 4, 6, 7 or 9 colours, have those lengths and were accepted as clusterings, returning nonsense. 3.0 stopped reading 1.x clusterings, so a buffer is a clustering only if it carries the header. These rules hold:

1. **Readers decide by the version byte, never by shape.** Every version is identified by its header.
2. **Versions 2 and 3 pad the end with zero bytes** so the length is 4 (empty) or 7 more than a multiple of 9. The padding dates from when that kept them out of 1.x's lengths; it stays so existing bytes stay stable, and readers ignore it (it is shorter than a record).
3. **From v3 the header describes its own layout:** `[0xAC, version, header length, record length, colour space, precision, …]`. A reader finds the records from the stored lengths and ignores fields it doesn't know, so fields can be added at the end of the header or of each record without a new version. The version is bumped only when an existing field changes meaning.
4. **Readers reject versions newer than they know** with an error asking for an upgrade, and never guess. The same goes for a header field with a fixed set of meanings (the colour space, the weight unit) that holds a value they don't know: that is how a later release adds one, so it is `unsupported-version`, not "damaged".
5. **Every version from 2 on stays readable.** `fixtures/clusterings/` holds a stored clustering of each format version with the palettes (and from v3 the weights and mean squared errors) its release gave, and `test/formats.test.js` checks them. Each new version adds a fixture; existing ones are never regenerated.

## 3.0: worker, indexed output, weights and error curve (released as 3.0.0)

What was planned as 2.1 and 3.0 ships together as 3.0, since the clustering format changes anyway.

- [x] **Worker entry** `agglomerative-clustering/worker`: `createWorker()` with handles that keep an image and its clustering in the worker, and drop-in exports over one shared worker. Web Worker in browsers, `worker_threads` in Node.
- [x] **Indexed output:** `quantizeToIndices*`, with `transparent` (an alpha cutoff).
- [x] **Clustering format v3**, following the rules above. Records are 21 bytes: colours, the split's parent index, the lighter half's weight and the Ward cost. The parent index is needed because different clusters can share an 8-bit colour, which would otherwise make weights ambiguous.
- [x] **Swatches** (`getSwatches`, `getSwatchesFromClustering`: palette, weights and shares) and the **error curve** (`getClusteringInfo().mse`, and the unitless `explained`), for choosing a palette size by error.
- [x] **Cancellation and progress:** `signal` and `onProgress` on every function with an image; the clustering is a resumable job run in slices, and the worker stops working on a cancelled call.
- [x] **`init({ wasm })`** and the `clustering.wasm` export, for CDNs, strict CSPs and edge runtimes; one shared load.
- [x] **Error codes** on every error, kept across the worker boundary, with `errorCodes` and the `isCodedError` guard.
- [x] **Runs where people put it:** CDNs (cross-origin workers through a `blob:` module), Deno, Bun, Cloudflare Workers, Next.js server bundles, SvelteKit and Nuxt, Electron (packaged with asar), browser extensions, Jest's CommonJS mode, jsdom; `createWorker({ script })` for bundlers that don't emit the worker script (Angular, esbuild, Rollup).
- [x] **Tests as a consumer sees the package:** a Vite build run in headless Chromium (worker, `.wasm`, slices, aborts, `wasm` locations), strict TypeScript against the built declarations, and the full suite on Node 20, 22 and 24, in CI.

## 3.1: planned, in this order

1. **Ordered (Bayer) dithering**, as a new option alongside the error-diffusion `dither` (for example `ditherMethod: 'ordered'`; the name is open). Error diffusion makes each frame's pattern depend on every pixel before it, so an animated GIF's dither crawls from frame to frame even where the picture is still; an ordered pattern is fixed to the pixel grid, so still areas stay still. It also suits 1-bit and 2-bit e-ink panels, where error diffusion's worms are most visible. Atkinson diffusion (lighter, higher contrast, the classic 1-bit look) is a small addition once the option exists. Asked for by the hardware-palette round; the animated-GIF round showed the flicker.
2. **BGRA input and output** (`format: 'bgra'`): Electron's `nativeImage`, Windows bitmaps and some native capture APIs give BGRA, and today users swap the channels both ways in JavaScript. It is a pixel-reading change in C++ (the histogram and the mapping sinks), with `quantize` returning BGRA for BGRA input. Asked for by the Electron round.
3. **Choosing N colours from a fixed palette** (12 threads out of 400, 40 bricks out of a full catalogue, 6 inks out of a pigment set): the README lists embroidery, LEGO and e-ink as use cases, but the library only maps to a whole palette. The documented recipe (cluster, snap each cut colour to its nearest fixed one, grow the cut until N distinct ones appear) works (the guides have it as a snippet) and beat "the N most used" by 3 to 8 dB for N up to 12, but by under 1 dB at N = 24, and it can't weigh a fixed colour that is close to several clusters. A built-in could cluster with each merge's result snapped to the fixed set, or score subsets by the mapping error. **Start with a spike** comparing those against the recipe on Kodak and logos (PSNR and CIEDE2000 after mapping, time), and add a function only if it clearly wins.

Each lands with tests, documentation and CHANGELOG entries, and (for 1 and 3) a quality comparison recorded here.

## Larger, after 3.1

- **Decoding image files** (asked for in every round of testing, and the biggest usability gain left; its own project because of the decoders' size and dependencies). Today a PNG, JPEG, GIF, WebP, BMP, TIFF, AVIF or HEIC file passed as a bare `Uint8Array` is recognised (`sniffImageFormat` in `src/index.js`) and rejected with a message saying how to decode it. The goal is that an encoded image just works. The groundwork is in place: detection is in one function, in the one place images enter (`load`), and only bare byte arrays are inspected, so a `{ data, format }` or `ImageData` is never second-guessed. Decoding would be added at that seam, which makes `load` asynchronous. The open questions are where the decoders come from (the browser's `createImageBitmap` where there is one; in Node, an optional peer such as sharp, or small bundled decoders for PNG, JPEG and GIF, which would add dependencies and size) and what to do with animation and EXIF orientation and colour profiles.
- **Swatch helpers: a dominant colour, heaviest-first order, swatch objects, hex strings.** Moved up from "Considered" below: asked for again in the fourth round (migrating from color-thief and node-vibrant took 26 to 41 lines of glue, and a video tool wanted the same). Additive, so any 3.x. Needs a design that keeps palettes in split order by default (it is what makes them nest), for example a `getSwatches` option or a small `rankSwatches(swatches)` helper returning `{ color, hex, share }` objects heaviest first.
- **Slicing pixel mapping.** Cancellation and progress cover the clustering, which is most of the work. Mapping (a few milliseconds for a photo, more with dithering on very large images) still runs in one piece; it could be sliced by rows the same way. Clustering a 12-megapixel photo also has a couple of unsliced steps (the histogram and the precision grouping) of up to about 150 ms; on 12 megapixels of noise at full precision one takes over a second, so slicing those would help servers that cancel on hostile input.
- **A Parcel smoke test**, alongside the Vite and webpack ones.
- **Smaller WebAssembly.** Pixel mapping is compiled twice (colour and index output), which accounts for much of the growth from 75 KB to about 93 KB. Plugin hosts that take one file (Figma, Obsidian) embed it as base64 (about 122 KB, 54 KB gzipped); a smaller module, or a gzipped copy in the package for `DecompressionStream`, would help them.
- **Methods on `Clustering`** (`clustering.getPalette(k)`, `clustering.getSwatches(k)`, `clustering.quantize(image, k)`, `clustering.getInfo()`), mirroring the worker's `ClusteringHandle`, so "cluster once, cut anywhere" reads without the `…FromClustering` suffixes. Planned for 3.1, additively: `Clustering` is already a class. From the naming review before 3.0.0, which kept the function names (including `get…` for the functions that cluster: the cheap cuts are getters, the Promise says the heavy ones do work, it is the convention of color-thief and node-vibrant, and `getPalette` is the most-used 2.x call).
  - **The docs then lead with the methods for the cluster-once workflow:** the slider example and the cluster-once recipes use `clustering.getPalette(k)` and `clustering.quantize(image, k)`, and the README's function table gets a methods column in place of the `…FromClustering` one.
  - **What stays:** the one-shot functions (`getPalette(image, k)`, `quantize(image, k)`, `getSwatches(image, k)`) stay the first thing people see, since a single palette has no clustering to call a method on. The `…WithPalette` functions stay too (unless `Palette` gets a matching `quantize(image)`, a separate decision).
  - **The `…FromClustering` functions stay, documented as the function form, and are not deprecated in 3.x:** they take a stored clustering as plain bytes in JavaScript, and the worker entry's exports are functions that mirror the main entry's. Whether to deprecate them is a 4.0 question, settled by how much they are used.
  - **Methods are a main-entry concept; the worker has handles.** A `Clustering` from the worker entry is bytes on the calling thread, so its methods would run on that thread's module, not in the worker. Off the main thread, `worker.cluster(image)` and its handle stay the answer. The methods take the handle's names so the two read alike, and the docs have to say which to use where.
  - **Open questions:** whether the methods are synchronous (the module is loaded once a `Clustering` exists, but the handle's methods are async, and matching them may matter more), and how they behave on a stored clustering wrapped with `new Clustering(bytes)` (the same, presumably).
- **Suggesting a palette size** from the error curve (an elbow heuristic), if users ask for more than `mse` and `explained`.

## Engineering, alongside the releases

- **Native build and coverage-guided fuzzing.** Sanitizers are done by hand through Emscripten's ASan/UBSan WebAssembly build (recipe in CLAUDE.md; the suite and the hostile-input fuzzers are clean), but not in CI. A native target (CMake or a short script) for the C++ would add reproducible instruction counts (callgrind) for speed work and a libFuzzer harness for `read_clustering`, `_get_palette_from_clustering` and `_get_palette_weights`: clusterings are stored by users and handed back as untrusted bytes. A CI job running the suite against the sanitized build would keep it clean.
- **Contributor setup.** Every test needs `em++`. Add a `scripts/setup-emsdk.sh` pinned to the CI version, or a devcontainer, so `npm test` works from a fresh clone, and a SessionStart hook so cloud agent sessions can build too.

## Considered, and why not (yet)

These came up in testing. Each is either covered by a recipe in the docs or not worth its permanent API yet; any can move up if users ask for it.

- **A background (matte) colour for transparent pixels** (`matte: [255, 255, 255]`), for logos sent to opaque hardware. Compositing onto a background before the call is a few lines, and it is unclear whether an option should affect clustering, mapping or both. Guides: "Fixed palettes".
- **A built-in worker pool.** Every server tester wanted one, but its queueing policy (small images behind large ones, backpressure, memory per worker) depends on the app. Performance and limits: the pool recipe in "Servers".
- **Clustering several images at once** (`getClustering([frames])`), for one palette across an animated GIF or a set of images. Concatenating sampled frames into one image already does it in one line, with the same result. Guides: "Animated GIFs and sets of images".
- **Palette PNG and GIF writers.** fast-png and gifenc do it well; the guides have both recipes, which decode pixel-exactly.
- **Smoothing palettes between video frames.** Each frame is clustered on its own, so palettes flicker; matching each palette to the last and easing towards it cut the flicker about fourfold in the fourth round. It is a dozen lines with app-specific choices (weight, lag, what to do when the colour count changes), so it is a recipe in the guides ("Live video and camera frames"). A built-in would need state across calls, which nothing else here has.
- **An abort check (`isAbortError`) or a code for "this worker is gone, retry elsewhere".** An abort is the signal's own reason, so the caller's `signal.aborted` is the reliable test (API reference: "Cancelling and progress"); `worker-terminated` and `worker-failed` already separate a stopped worker from a crashed one (API reference: "Errors").
- **An idle timeout for workers** (`createWorker({ idleTimeout })`: stop the thread after some idle seconds, start it again on the next call). It would free the memory an idle worker keeps after a large image, but held clusterings live in the thread, so it could only stop with none held, and a restart costs 10 to 70 ms. A dropped worker is now stopped once collected, and `terminate()` frees memory at once; this can come later as an option if long-running services ask for it.
- **Our own error class** (`instanceof AgglomerativeError`). Errors from the worker are rebuilt on the calling side, and errors that cross Electron's IPC or a `postMessage` are plain objects, so `instanceof` would mislead; `isCodedError` works in all three.

## Later, if asked for

- **Palette entries with alpha**, for palette PNGs with translucent colours. A spike (exact Ward in premultiplied RGBA, on the unmerged branch `spike/rgba-4d`) was exact and matched libimagequant on that case, but was 4-6× slower on photos with smooth alpha, needed a second engine and a format change, and lost about 6 dB against today's alpha-weighted clusters with per-pixel alpha for canvas output. Not worth it for 3.0; libimagequant is the better tool for translucent palette PNGs.
- **Very large images.** Memory is capped at 2 GB, and partly transparent images above about 16.8 MP have their weights scaled down. Streaming the histogram in chunks would remove both limits.
