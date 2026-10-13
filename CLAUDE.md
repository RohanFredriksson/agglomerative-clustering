# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An npm package (`agglomerative-clustering`) that does colour-palette extraction and image quantization using hierarchical agglomerative clustering. The algorithm is written in C++ and compiled to WebAssembly with Emscripten; a thin JS wrapper exposes an async API for Node and browsers.

## Commands

- `npm run build`: builds everything into `dist/`. Needs Emscripten (`em++`) on PATH for the WASM step.
  - `npm run build:wasm`: compiles only `src/clustering.cpp` → `dist/clustering.js` + `.wasm`. The full `em++` flag set (it must be `em++`, not `emcc`: current Emscripten no longer links libc++ for `emcc`) (exported functions, memory limits) lives in this script in `package.json`.
  - `npm run build:js`: Babel-transpiles `src/index.js` to `dist/index.cjs` and `dist/index.mjs`, and copies `index.d.ts`.
- `npm test`: runs vitest over everything under `test/`.
- Single test file: `npx vitest run test/smoke.test.js`. Single test: `npx vitest run -t "<name pattern>"`.
- `npm run bench`: quick vitest bench (`bench/speed.bench.js`): palette time at k=64 and for k=16/64/128/256, on two Kodak photos and noise, against the other libraries.
- `npm run bench:full`: the full harness (`bench/run.js`, options documented at the top of the file). For each image (Kodak + synthetic in `bench/lib/images.js`), library and k it records palette time, quality of that palette under one shared nearest-colour mapping (MSE, PSNR, mean CIEDE2000), and the library's own quantize time/quality. Results go to `bench/results/<label>.json` (gitignored) and a summary is printed. A full run takes about 20 minutes; use `--libs none`, `--kodak-limit`, `--k` and `--sets` to narrow it.
  - `--ac name=path/to/dist/index.mjs` (repeatable) benchmarks other builds of this library side by side, e.g. a build of `master`.
  - `npm run bench:compare -- a.json b.json` compares results files (before/after a change).
  - `npm run quality`: the harness without the own-quantize timings.
- Other libraries live behind adapters in `bench/lib/quantizers.js` (image-q NeuQuant/Wu/RgbQuant, MMCQ via `quantize`, libimagequant via `libimagequant-wasm`). They are dev dependencies used only for benchmarking.

**Tests and benches import from `dist/index.mjs`, not `src/`.** Rebuild (`npm run build`, or `build:wasm` after C++ changes) before you run them, or they will exercise stale code. `src/index.js` imports `./clustering.js`, which exists only in `dist/` after the WASM step.

The Kodak tests (`test/visual/kodak.test.js`), the benchmarks and `fixtures/kodak.js` download images on first run into `fixtures/images/` (gitignored), so they need network access. Node's `fetch` ignores `HTTPS_PROXY`, so behind a proxy, pre-download them with `curl` from one of the URLs in `fixtures/kodak.js`, saved as `fixtures/images/kodimNN.png`. Visual test output goes to `test/visual/output/` (also gitignored). `test/setup.js` polyfills `ImageData` from `canvas` so the ImageData code paths can be tested in Node.

## Architecture

### JS ↔ WASM boundary (`src/index.js`)
- The WASM module is initialised lazily with `init()`. Each API call `_malloc`s an input buffer in the WASM heap, copies the data in, calls an exported C function, then `unpack`s the result and frees both buffers.
- All C exports return a pointer to a buffer that the C side `malloc`ed, with a **4-byte little-endian length prefix** followed by the payload (`pack_variable_size` in C++, `unpack` in JS). JS must `_free` that pointer.
- Image format is passed as an int code: `rgba = 0`, `rgb = 1`.
- `getWrapper` makes the `quantize*` return types match the input type (Uint8Array / ImageData / `{data, format}`).
- If you add or rename a C export, update `EXPORTED_FUNCTIONS` in the `build:wasm` script, `src/index.js`, and `src/index.d.ts`.

### C++ pipeline (`src/clustering.cpp`, `src/clustering.hpp`)
1. **`_get_clustering`**: builds a colour histogram (`AgglomerativeHistogram`). Colours are upscaled from 8-bit to 16-bit per channel so that weighted-average merges keep precision. It then repeatedly merges the closest pair of colours until only one is left, merging centroids weighted by pixel count.
2. **`CoarseningGrid`**: a uniform grid used to find the closest pair of points among *neighbouring* cells (3×3×3). This is an approximation: a closer pair two cells apart is not considered.
   - Cells are a dense array (resolution capped at 7, i.e. ≤129³ cells). Each occupied cell stores its points contiguously as `Member`s, which carry the fields a scan reads: coordinates and the point's cached nearest neighbour. `Point` slots hold cold data (key, version, location of the member). Removal swaps with the cell's last member.
   - Each point caches its nearest local neighbour, and a binary heap of `(distance, key, neighbour key)` entries finds the global minimum. Entries are invalidated lazily through per-point `version`s, and `compact()` rebuilds the heap when stale entries pile up.
   - `merge(nearest, m)` removes the pair, recomputes only the points whose cached neighbour was removed (`repair`), then inserts `m` and offers it to its neighbours.
   - Ties break on distance, then packed coordinates, so output is deterministic. When no local pair exists, `get_nearest` lowers `resolution` (coarser cells) and rebuilds. The starting resolution comes from a unique-colour-count heuristic in `_get_clustering`.
   - Changes here alter clustering output, so check them with `npm run quality` (MSE on Kodak), not just the tests.
3. **Clustering format** (the opaque `Uint8Array` returned to users): `[root rgb (3 bytes)]` followed by one 9-byte record `[merged rgb, a rgb, b rgb]` per merge. Records are written in *reverse* merge order, so record `i` splits the palette of size `i+1` into size `i+2`. `_get_palette_from_clustering` replays the first `k-1` records to get a k-colour palette.
4. **`_quantize`**: builds a `KDTree` over the palette and maps each pixel to its nearest palette colour, writing straight into the length-prefixed output buffer. Alpha is preserved for RGBA input.

C++17 is required (the header enforces it).
