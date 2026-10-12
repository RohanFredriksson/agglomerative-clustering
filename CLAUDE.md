# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An npm package (`agglomerative-clustering`) that does colour-palette extraction and image quantization using hierarchical agglomerative clustering. The algorithm is written in C++ and compiled to WebAssembly with Emscripten; a thin JS wrapper exposes an async API for Node and browsers.

## Commands

- `npm run build`: builds everything into `dist/`. Needs `emcc` (Emscripten) on PATH for the WASM step.
  - `npm run build:wasm`: compiles only `src/clustering.cpp` → `dist/clustering.js` + `.wasm`. The full emcc flag set (exported functions, memory limits) lives in this script in `package.json`.
  - `npm run build:js`: Babel-transpiles `src/index.js` to `dist/index.cjs` and `dist/index.mjs`, and copies `index.d.ts`.
- `npm test`: runs vitest over everything under `test/`.
- Single test file: `npx vitest run test/smoke.test.js`. Single test: `npx vitest run -t "<name pattern>"`.
- `npm run bench`: vitest bench (`bench/speed.bench.js`), compared against NeuQuant from `image-q`.
- `npm run quality`: MSE comparison on the Kodak image suite (`bench/quality.js`).

**Tests and benches import from `dist/index.mjs`, not `src/`.** Rebuild (`npm run build`, or `build:wasm` after C++ changes) before you run them, or they will exercise stale code. `src/index.js` imports `./clustering.js`, which exists only in `dist/` after the emcc step.

The Kodak tests (`test/visual/kodak.test.js`), `bench/quality.js` and `fixtures/kodak.js` download images on first run into `fixtures/images/` (gitignored), so they need network access. Visual test output goes to `test/visual/output/` (also gitignored). `test/setup.js` polyfills `ImageData` from `canvas` so the ImageData code paths can be tested in Node.

## Architecture

### JS ↔ WASM boundary (`src/index.js`)
- The WASM module is initialised lazily with `init()`. Each API call `_malloc`s an input buffer in the WASM heap, copies the data in, calls an exported C function, then `unpack`s the result and frees both buffers.
- All C exports return a pointer to a buffer that the C side `malloc`ed, with a **4-byte little-endian length prefix** followed by the payload (`pack_variable_size` in C++, `unpack` in JS). JS must `_free` that pointer.
- Image format is passed as an int code: `rgba = 0`, `rgb = 1`.
- `getWrapper` makes the `quantize*` return types match the input type (Uint8Array / ImageData / `{data, format}`).
- If you add or rename a C export, update `EXPORTED_FUNCTIONS` in the `build:wasm` script, `src/index.js`, and `src/index.d.ts`.

### C++ pipeline (`src/clustering.cpp`, `src/clustering.hpp`)
1. **`_get_clustering`**: builds a colour histogram (`AgglomerativeHistogram`). Colours are upscaled from 8-bit to 16-bit per channel so that weighted-average merges keep precision. It then repeatedly merges the closest pair of colours until only one is left, merging centroids weighted by pixel count.
2. **`CoarseningGrid`**: a spatial-hash grid used to find the globally nearest pair of points. Each `Bucket` caches its best pair against the neighbouring 3×3×3 buckets. A `std::map<distance, set<Bucket*>>` orders the buckets so the global minimum is at `cache.begin()`. When no bucket has a pair, `get_nearest` lowers `resolution` (makes cells coarser), rebuilds the grid and tries again. The starting resolution comes from a heuristic on the number of unique colours in `_get_clustering`.
3. **Clustering format** (the opaque `Uint8Array` returned to users): `[root rgb (3 bytes)]` followed by one 9-byte record `[merged rgb, a rgb, b rgb]` per merge. Records are written in *reverse* merge order, so record `i` splits the palette of size `i+1` into size `i+2`. `_get_palette_from_clustering` replays the first `k-1` records to get a k-colour palette.
4. **`_quantize`**: builds a `KDTree` over the palette and maps each pixel to its nearest palette colour. Alpha is preserved for RGBA input.

C++17 is required (the header enforces it).
