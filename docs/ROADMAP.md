# Roadmap

What comes after 2.0, roughly in order. Each release keeps output byte-identical unless it says otherwise; `test/golden.test.js` enforces that.

## 2.0.1: robustness (in progress)

- [x] `Uint8ClampedArray` subarrays are read from their own bytes, not the start of the whole buffer.
- [x] Image data that isn't a whole number of pixels is rejected instead of silently truncated.
- [x] `quantizeWithPalette` validates its palette.
- [x] `engines` field, a CommonJS smoke test, and CI on Node 20/22/24.
- [x] Golden-output test over clusterings, palettes and quantized images.
- [x] The release build uses the same Emscripten version as the benchmarks (6.0.12).

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

The header's version byte lets 3.0 add data to each record while still loading v1 and v2 clusterings. New bytes from `getClustering` were treated as a major change in 2.0, so this is planned as 3.0. If the new data turns out to be opt-in, it could ship in 2.x instead.

### Palette weights
"Dominant colours with percentages" is the most common palette request, and the weights are already computed while clustering.

- Store the root's total weight once, and each record's lighter-child weight. The heavier child's weight is the parent's minus the lighter one, so every cluster's weight can be recovered top-down for about 4–5 extra bytes per record.
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
