# Roadmap

What comes after 2.0, roughly in order. Each release keeps output byte-identical unless it says otherwise; `test/golden.test.js` enforces that.

## 2.0.1: robustness (in progress)

- [x] `Uint8ClampedArray` subarrays are read from their own bytes, not the start of the whole buffer.
- [x] Image data that isn't a whole number of pixels is rejected instead of silently truncated.
- [x] `quantizeWithPalette` validates its palette.
- [x] `engines` field, a CommonJS smoke test, and CI on Node 20/22/24.
- [x] Golden-output test over clusterings, palettes and quantized images.
- [x] The release build uses the same Emscripten version as the benchmarks (6.0.12).
- [x] A clustering from a newer format version gets an error asking for an upgrade, not "not a clustering". 2.0.x readers will then fail clearly on 3.0 clusterings.

## Clustering format versioning

The clustering is the only format users store, so it is the only one that needs versioning. Palettes are plain RGB bytes, and messages between the main thread and the 2.1 worker never outlive one installed version of the package.

Since 2.0 every clustering starts with `[0xAC, version, colour space, precision]`. What has been luck so far is telling it apart from 1.x clusterings, which have no header. That works only because their lengths differ: 1.x lengths are 0 or 3 more than a multiple of 9, and 2.x lengths 4 or 7 more. From v3 on, these rules hold:

1. **Readers decide by the version byte, never by shape.** The length test exists only to recognise 1.x clusterings, and every version from 2 on is identified by its header.
2. **Every new version keeps out of 1.x's lengths:** its header is 4 more than a multiple of 9 bytes long, and its records a multiple of 9 bytes (padded if needed). Its lengths are then always 4 or 7 more than a multiple of 9, so no reader, including 2.0.x, can mistake it for a 1.x clustering.
3. **From v3 the header describes its own layout:** `[0xAC, version, header length, record length, colour space, precision, …]`. A reader finds the records from the stored lengths and ignores fields it doesn't know, so fields can be added at the end of the header or of each record without a new version. The version is bumped only when an existing field changes meaning.
4. **Readers reject versions newer than they know** with an error asking for an upgrade (2.0.1 does this), and never guess.
5. **Every version stays readable.** When v3 lands, commit a stored clustering of each format version (1, 2, 3) as a test fixture, with its expected palettes, so a change to the reader can't break old clusterings unnoticed.

## 2.1: off the main thread, and indexed output

No format change, so a minor release.

### Worker entry point
The API is async but runs synchronously: clustering a photo blocks the calling thread for about 100 ms, and up to about 300 ms on images with many unique colours. That's too long for the interactive sliders the library is pitched at.

- A second entry, e.g. `agglomerative-clustering/worker`, with the same functions, running the WASM module in a Web Worker (browsers) or `worker_threads` (Node).
- Image buffers are transferred, not copied, when the caller allows it (an option, since transferring detaches the caller's buffer).
- Let a clustering stay in the worker as a handle, so a slider re-cutting and re-mapping the same image doesn't copy the image and clustering across for every frame.
- Open questions: one shared worker or a small pool; how bundlers resolve the worker script (`new Worker(new URL(..., import.meta.url))` is the pattern Vite and webpack 5 both understand).

### Indexed output
`_quantize` already finds a palette index for every pixel, then writes its RGB value. Palette PNGs, pixel art, embroidery and paint-by-number tools need the indices.

- `quantizeToIndices(image, k, options?)` and `…WithClustering` / `…WithPalette` variants returning `{ palette, indices }`, with `indices` a `Uint8Array` up to 256 colours and a `Uint16Array` above.
- Open question: what fully transparent pixels get. Probably a reserved index (or -1 mapped to a documented value) chosen by an option, which also lays groundwork for palette alpha later.

### Bundler smoke test
Browsers are the main audience, but CI only exercises Node. A small Vite and webpack build of a page that imports the package (and, after this release, the worker entry) catches broken `.wasm` resolution before users do.

## 3.0: clustering format v3, with weights and merge heights

Format v3 follows the versioning rules above, and 3.0 still loads v1 and v2 clusterings. New bytes from `getClustering` were treated as a major change in 2.0, so this is planned as 3.0. If the new data turns out to be opt-in, it could ship in 2.x instead.

### Palette weights
"Dominant colours with percentages" is the most common palette request, and the weights are already computed while clustering.

- Store the root's total weight once, and each record's lighter-child weight. The heavier child's weight is the parent's minus the lighter one, so every cluster's weight can be recovered top-down from about 5 extra bytes per record. With a float32 height (below), a record is 9 + 5 + 4 = 18 bytes, which is already a multiple of 9 as rule 2 requires.
- `getPaletteFromClustering(clustering, k, { weights: true })`, or a separate function, returning weights alongside colours (as pixel counts, or fractions of the visible total).
- v1/v2 clusterings have no weights: either reject the option for them or document an approximation.

### Merge heights: cut by error, suggest k
Each merge's Ward cost (height) is the error it adds. Stored as a float32 per record, it enables:

- Cutting by error instead of size: `getPaletteFromClustering(clustering, { maxError })`.
- Suggesting a palette size, e.g. at the largest jump in height (elbow), for callers that don't know what k to ask for.
- Exposing the error curve for UIs ("64 colours: 98% of the way to the original").

Only a hierarchical method can offer these, so they play to the library's strength. They ship together with weights, so the format changes once.

## Engineering, alongside the releases

- **Native build, sanitizers and fuzzing.** A native target (CMake or a short script) for the C++ with ASan/UBSan. It gives reproducible instruction counts (callgrind) for speed work, and a libFuzzer harness for `read_clustering` and `_get_palette_from_clustering`: clusterings are stored by users and handed back as untrusted bytes.
- **Contributor setup.** Every test needs `em++`. Add a `scripts/setup-emsdk.sh` pinned to the CI version, or a devcontainer, so `npm test` works from a fresh clone, and a SessionStart hook so cloud agent sessions can build too.

## Later, if asked for

- **Palette entries with alpha**, for palette PNGs with translucent colours (clustering in RGBA rather than weighting by alpha).
- **Very large images.** Memory is capped at 2 GB, and partly transparent images above about 16.8 MP have their weights scaled down. Streaming the histogram in chunks would remove both limits.
