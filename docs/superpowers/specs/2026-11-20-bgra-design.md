# 3.2.0: BGRA input and output

Roadmap item 2 (`format: 'bgra'`). Premultiplied alpha was designed alongside it and deferred to 4.0 (see "Deferred" below and the ROADMAP's 4.0 section).

## Why

Electron's `nativeImage`, Windows bitmaps (WIC `32bppBGRA`) and some native capture APIs give BGRA, and today users swap the channels both ways in JavaScript.

## API

- **`format: 'bgra'`** on a `{ data, format }` image. It behaves exactly like `'rgba'` with R and B swapped: alpha weighting, `transparent`, every dither method, both colour spaces, the sliced (`signal`/`onProgress`) path and the worker entry.
- **`imageFormats`** becomes `['rgb', 'rgba', 'bgra']`, and `ImageFormat` gains `'bgra'`. The stability doc already allows both (lists grow, types widen; switch over `ImageFormat` with a default branch).
- **Results.**
  - `quantize`, `quantizeFromClustering` and `quantizeWithPalette` give back `{ data, format: 'bgra', width?, height? }`: each pixel is its palette colour in B, G, R order, with its own alpha.
  - Palettes, swatches, clustering info, the `quantizeToIndices*` palettes and clusterings stay RGB.
  - A BGRA image gives byte-identical clusterings, palettes, swatches, info and indices to the same image as RGBA.
- **Errors:**
  - The unknown-format message is built from `imageFormats`, so it names all three.
  - A `'bgra'` length that isn't a multiple of 4 gets the existing per-format message.
  - No new error codes.
- **Hints:** bare arrays and `ImageData` stay RGBA, and their hints are unchanged.
- **Unchanged:** the clustering format, `formatVersion`, fixtures, golden hashes, `RawImage`'s shape, and every existing call's output. Only calls that throw today (`format: 'bgra'`) behave differently.

## C++

- **Format code:** `rgba` 0, `rgb` 1, `bgra` 2. Every export keeps its signature.
- **`PixelLayout`** `{ stride, r, b, alpha }` from `layout_of(code)`. Pixel reads use `pixel[r]`, `pixel[1]`, `pixel[b]`.
- **Read sites:**
  - The `ClusteringJob` scan: the stride, the histogram key, and alpha present = `layout.alpha` in place of `format == 0`.
  - `map_pixels`: the stride, the four `pixel[0..2]` read sites, and the three alpha-cutoff checks.
  - `_quantize`'s sink: writes `out[r]`, `out[1]`, `out[b]` and copies alpha.
  - `has_transparent_entry`, `colours_for_entries` and `_quantize_indices`: `layout.alpha`.
- **No templating on the layout.** `map_pixels` is already compiled twice, and the WASM size matters to single-file plugin hosts. The offsets are read at run time, and RGBA speed must not regress (see Verification).

## JS

- `src/shared.js`: `imageFormats` gains `'bgra'`, and a `channels(format)` helper is shared by both entries.
- `src/index.js`:
  - `codes` gains `bgra: 2`.
  - `channels()` replaces the four `=== 'rgb' ? 3 : 4` checks (`load`, the `parseOptions` width checks, `checkNotEmpty`).
  - The format error is built from `imageFormats`.
  - `getWrapper` needs nothing: it already copies `format`.
- `src/worker.js` and `worker-thread.js` need nothing: `send` passes `format` through and the thread validates. Covered by tests.
- No new options, functions or error codes.

## Docs

- `docs/api.md`: the image shape (`format: 'rgb' | 'rgba' | 'bgra'`), "Alpha matters only for RGBA" (now RGBA and BGRA), and the lists of names.
- `docs/environments.md`, Electron section: replace "swap the channels" with `{ data: img.toBitmap(), format: 'bgra', width, height }` and the way back through `nativeImage.createFromBitmap`.
  - Say that `toBitmap()` is premultiplied, so partly transparent pixels need un-premultiplying first, with the short loop and its inverse for the way back. Opaque images (screenshots, captures, opaque pages) need nothing.
  - Before writing "BGRA", check the byte order of Skia's N32 on desktop Electron (Chromium's `SK_PMCOLOR_IS_BGRA` / `SK_R32_SHIFT`, or a real Electron run). Electron's docs say only "platform-dependent".
- README input section, CHANGELOG `## 3.2.0`, and ROADMAP item 2 marked done.

## Tests

- **New `test/bgra.test.js`**, with references in plain JavaScript:
  - **Equivalence:** on synthetic images (opaque, with partial and full transparency) and a Kodak photo, BGRA gives the same clustering bytes, palette, swatches, info and indexed output as RGBA. This covers both colour spaces, `precision: 6`, both `alpha` modes, `transparent`, and each dither method.
  - **Swapped output:** `quantize*` output is the RGBA output with R and B swapped, for all three `quantize*` functions, with and without `signal`.
  - **Results** keep `format: 'bgra'`, `width` and `height`. The worker entry (functions and handles) gives identical results.
- **Validation:** a length that isn't a multiple of 4. The unknown-format message names all three formats.
- **Updated:**
  - `test/lists.test.js` (the pinned list).
  - `test/types/*`: a BGRA image compiles and its `quantize` result is a `RawImage`.
  - `api.test.js`: docs checks, and snapshots with `-u` after review.
  - The browser app: one BGRA call through the worker.
- **Golden:** passes unchanged.

## Verification

- `npm test`, `npm run test:types`, `npm run test:browser`.
- `npm run bench` on RGBA against a master build (`--ac`): no regression above noise. BGRA cost recorded in the PR.
- WASM size before and after, in the PR.
- One ASan/UBSan run (recipe in CLAUDE.md) over the suite.

## Deferred: premultiplied alpha (4.0)

It was designed here (an image property `premultiplied: true` for RGBA and BGRA: un-premultiply on read, premultiply `quantize*` output) and deferred, because doing it well in 3.x would break code:
- Reading a field that image objects may already carry changes existing calls.
- A compile-time check of `rgb` + `premultiplied` needs `RawImage` as a union, or a conditional parameter type that breaks callers' generic wrappers (prototyped).
- Typos would pass silently unless unknown image keys are rejected, which is breaking too.

The ROADMAP's 4.0 section records it.
