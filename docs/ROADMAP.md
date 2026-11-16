# Roadmap

What comes after 2.0, roughly in order. Each release keeps output byte-identical unless it says otherwise; `test/golden.test.js` enforces that.

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

## 3.0: worker, indexed output, weights and error curve (done, unreleased)

What was planned as 2.1 and 3.0 ships together as 3.0, since the clustering format changes anyway.

- [x] **Worker entry** `agglomerative-clustering/worker`: `createWorker()` with handles that keep an image and its clustering in the worker, and drop-in exports over one shared worker. Web Worker in browsers, `worker_threads` in Node.
- [x] **Indexed output:** `quantizeToIndices*`, with `transparent` (an alpha cutoff).
- [x] **Clustering format v3**, following the rules above. Records are 21 bytes: colours, the split's parent index, the lighter half's weight and the Ward cost. The parent index is needed because different clusters can share an 8-bit colour, which would otherwise make weights ambiguous.
- [x] **Swatches** (`getSwatches`, `getSwatchesFromClustering`: palette, weights and shares) and the **error curve** (`getClusteringInfo().mse`, and the unitless `explained`), for choosing a palette size by error.
- [x] **Cancellation and progress:** `signal` and `onProgress` on every function with an image; the clustering is a resumable job run in slices, and the worker stops working on a cancelled call.
- [x] **`init({ wasm })`** and the `clustering.wasm` export, for CDNs, strict CSPs and edge runtimes; one shared load.
- [x] **Error codes** on every error, kept across the worker boundary.
- [x] **Tests as a consumer sees the package:** a Vite build run in headless Chromium (worker, `.wasm`, slices, aborts, `wasm` locations), strict TypeScript against the built declarations, and the full suite on Node 20, 22 and 24, in CI.

## Next

- **Slicing pixel mapping.** Cancellation and progress cover the clustering, which is most of the work. Mapping (a few milliseconds for a photo, more with dithering on very large images) still runs in one piece; it could be sliced by rows the same way.
- **A Parcel smoke test**, alongside the Vite and webpack ones.
- **Smaller WebAssembly.** Pixel mapping is compiled twice (colour and index output), which accounts for much of the growth from 75 KB to 88 KB.
- **Decoding image files.** Today a PNG, JPEG, GIF, WebP, BMP, TIFF, AVIF or HEIC file passed as a bare `Uint8Array` is recognised (`sniffImageFormat` in `src/index.js`) and rejected with a message saying how to decode it. The goal is that an encoded image just works. The groundwork is in place: detection is in one function, in the one place images enter (`load`), and only bare byte arrays are inspected, so a `{ data, format }` or `ImageData` is never second-guessed. Decoding would be added at that seam, which makes `load` asynchronous. The open questions are where the decoders come from (the browser's `createImageBitmap` where there is one; in Node, an optional peer such as sharp, or small bundled decoders for PNG, JPEG and GIF, which would add dependencies and size) and what to do with animation and EXIF orientation and colour profiles.
- **Suggesting a palette size** from the error curve (an elbow heuristic), if users ask for more than `mse` and `explained`.

## Engineering, alongside the releases

- **Native build and coverage-guided fuzzing.** Sanitizers are done by hand through Emscripten's ASan/UBSan WebAssembly build (recipe in CLAUDE.md; the suite and the hostile-input fuzzers are clean), but not in CI. A native target (CMake or a short script) for the C++ would add reproducible instruction counts (callgrind) for speed work and a libFuzzer harness for `read_clustering`, `_get_palette_from_clustering` and `_get_palette_weights`: clusterings are stored by users and handed back as untrusted bytes. A CI job running the suite against the sanitized build would keep it clean.
- **Contributor setup.** Every test needs `em++`. Add a `scripts/setup-emsdk.sh` pinned to the CI version, or a devcontainer, so `npm test` works from a fresh clone, and a SessionStart hook so cloud agent sessions can build too.

## Later, if asked for

- **Palette entries with alpha**, for palette PNGs with translucent colours. A spike (exact Ward in premultiplied RGBA, on the unmerged branch `spike/rgba-4d`) was exact and matched libimagequant on that case, but was 4-6× slower on photos with smooth alpha, needed a second engine and a format change, and lost about 6 dB against today's alpha-weighted clusters with per-pixel alpha for canvas output. Not worth it for 3.0; libimagequant is the better tool for translucent palette PNGs.
- **Very large images.** Memory is capped at 2 GB, and partly transparent images above about 16.8 MP have their weights scaled down. Streaming the histogram in chunks would remove both limits.
