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

Since 2.0 every clustering starts with `[0xAC, version, …]`. What was luck in 2.0 is telling it apart from 1.x clusterings, which have no header. That works only because their lengths differ: 1.x lengths are 0 or 3 more than a multiple of 9, and 2.x lengths 4 or 7 more. From v3 on, these rules hold:

1. **Readers decide by the version byte, never by shape.** The length test exists only to recognise 1.x clusterings, and every version from 2 on is identified by its header.
2. **Every new version keeps out of 1.x's lengths:** writers pad the end with zero bytes so the length is 4 (empty) or 7 more than a multiple of 9. No reader, including 2.0.x, can then mistake it for a 1.x clustering, and readers ignore the padding (it is shorter than a record).
3. **From v3 the header describes its own layout:** `[0xAC, version, header length, record length, colour space, precision, …]`. A reader finds the records from the stored lengths and ignores fields it doesn't know, so fields can be added at the end of the header or of each record without a new version. The version is bumped only when an existing field changes meaning.
4. **Readers reject versions newer than they know** with an error asking for an upgrade, and never guess.
5. **Every version stays readable.** `fixtures/clusterings/` holds a stored clustering of each format version with the palettes (and from v3 the weights and errors) its release gave, and `test/formats.test.js` checks them. Each new version adds a fixture; existing ones are never regenerated.

## 3.0: worker, indexed output, weights and error curve (done, unreleased)

What was planned as 2.1 and 3.0 ships together as 3.0, since the clustering format changes anyway.

- [x] **Worker entry** `agglomerative-clustering/worker`: `createWorker()` with handles that keep an image and its clustering in the worker, and drop-in exports over one shared worker. Web Worker in browsers, `worker_threads` in Node.
- [x] **Indexed output:** `quantizeToIndices*`, with `transparentIndex`.
- [x] **Clustering format v3**, following the rules above. Records are 21 bytes: colours, the split's parent index, the lighter half's weight and the Ward cost. The parent index is needed because different clusters can share an 8-bit colour, which would otherwise make weights ambiguous.
- [x] **Palette weights** (`getPaletteWeights`) and the **error curve** (`getClusteringInfo().errors`), for choosing a palette size by error.
- [x] **Bundler smoke test:** a Vite build run in headless Chromium, in CI.

## Next

- **Webpack and Parcel smoke tests**, alongside the Vite one.
- **Quieter bundling.** Vite warns that the Emscripten glue's Node-only `import('module')` is externalized for the browser. Building separate web and Node glue (`-s ENVIRONMENT`) would remove it.
- **Smaller WebAssembly.** Pixel mapping is compiled twice (colour and index output), which accounts for most of the growth from 75 KB to 84 KB.
- **Suggesting a palette size** from the error curve (an elbow heuristic), if users ask for more than `errors`.

## Engineering, alongside the releases

- **Native build, sanitizers and fuzzing.** A native target (CMake or a short script) for the C++ with ASan/UBSan. It gives reproducible instruction counts (callgrind) for speed work, and a libFuzzer harness for `read_clustering`, `_get_palette_from_clustering` and `_get_palette_weights`: clusterings are stored by users and handed back as untrusted bytes.
- **Contributor setup.** Every test needs `em++`. Add a `scripts/setup-emsdk.sh` pinned to the CI version, or a devcontainer, so `npm test` works from a fresh clone, and a SessionStart hook so cloud agent sessions can build too.

## Later, if asked for

- **Palette entries with alpha**, for palette PNGs with translucent colours (clustering in RGBA rather than weighting by alpha).
- **Very large images.** Memory is capped at 2 GB, and partly transparent images above about 16.8 MP have their weights scaled down. Streaming the histogram in chunks would remove both limits.
