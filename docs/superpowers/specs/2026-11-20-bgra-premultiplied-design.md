# 3.2.0: BGRA and premultiplied input and output

Roadmap item 2 (`format: 'bgra'`), widened to premultiplied alpha after checking where BGRA comes from.

## Why

Electron's `nativeImage`, Windows bitmaps and some native capture APIs give BGRA, and today users swap the channels both ways in JavaScript. Checking the sources showed the main one is also premultiplied:

- Electron: `toBitmap()`/`getBitmap()` write `SkImageInfo::MakeN32Premul`, and `createFromBitmap` reads `kPremul_SkAlphaType` (`shell/common/api/electron_api_native_image.cc`). The docs call the format "platform-dependent" and say nothing about alpha. The paint event's image is a `NativeImage`, so presumably the same.
- Windows: WIC has straight `32bppBGRA` and premultiplied `32bppPBGRA` as separate formats. GDI `AlphaBlend` requires premultiplied.

Premultiplication is independent of channel order (WebGL `readPixels` and other native APIs give premultiplied RGBA), so it is a property of its own, not a format name.

## API

- **`format: 'bgra'`** on a `{ data, format }` image. It behaves exactly like `'rgba'` with R and B swapped: alpha weighting, `transparent`, every dither method, both colour spaces. `imageFormats` becomes `['rgb', 'rgba', 'bgra']`.
- **`premultiplied: true`** on a `{ data, format }` image whose format has alpha (`'rgba'` or `'bgra'`). It sits beside `format`, `width` and `height` because it describes the bytes and travels with them. `ImageData` and bare `Uint8Array`s are always straight, so it applies only to image objects.
  - Each pixel is read as straight `min(255, round(c·255/a))` per colour channel. Alpha 0 reads as black. Values above alpha, which are invalid premultiplied data, clamp to 255 silently, with no validation pass.
  - Everything after reading (histogram, weights, cutoff, mapping, dithering) works on straight colours.
- **Results.**
  - `quantize`, `quantizeFromClustering` and `quantizeWithPalette` give back the input's layout: `{ data, format, premultiplied?, width?, height? }`. `premultiplied` (true or false) is copied when the input had it, as `width` and `height` are. Each pixel's colour is the palette colour, re-premultiplied as `round(c·a/255)` when `premultiplied` is true, written in the input's channel order. Its alpha is the input's.
  - Palettes, swatches, clustering info, the `quantizeToIndices*` palettes and clusterings stay straight RGB. A BGRA or premultiplied image gives byte-identical clusterings, palettes and indices to its straight RGBA equivalent (the straight image the read rule above produces).
- **Errors** (`invalid-argument`, `argument: 'image'`, `Invalid …:` messages):
  - `premultiplied` present and not a boolean.
  - `premultiplied: true` with `format: 'rgb'` (no alpha to divide by). `premultiplied: false` is accepted with any format.
  - The unknown-format message is built from `imageFormats`, so it names all three.
  - A `'bgra'` length that isn't a multiple of 4 gets the existing per-format message.
- **Types.** `ImageFormat` gains `'bgra'`. `RawImage` gains `premultiplied?: boolean | undefined`, with a doc comment. `ImageResult<I>` keeps the input's fields.
- **Unchanged:** the clustering format, `formatVersion`, fixtures, golden hashes, and every existing call's output.

## C++

- **Format code.** The low bits are the layout (`rgba` 0, `rgb` 1, `bgra` 2), and `+4` means premultiplied. Every export keeps its signature. JS never sends any other value.
- **`PixelLayout`** `{ stride, r, b, alpha, premultiplied }`, from `layout_of(code)`. Pixel reads use `pixel[r]`, `pixel[1]`, `pixel[b]`.
- **Premultiplied pixels** are converted through a 64 KB `unpremultiply[a][c]` table, built once on first use, behind one per-image branch that the CPU predicts every time. The `_quantize` sink re-premultiplies through a `premultiply[a][c]` table (or `(c·a + 127) / 255` if that measures as fast).
- **Read sites:**
  - The `ClusteringJob` scan: the stride, the histogram key, and alpha present = `layout.alpha` in place of `format == 0`.
  - `map_pixels`: the stride, the four `pixel[0..2]` read sites, and the three alpha-cutoff checks.
  - `_quantize`'s sink: the channel order on write, plus re-premultiplication.
  - `has_transparent_entry`, `colours_for_entries` and `_quantize_indices`: `layout.alpha`.
- **No templating on the layout.** `map_pixels` is already compiled twice, and the WASM size matters to single-file plugin hosts. Speed must not regress for RGBA (see Verification).

## JS

- `src/shared.js`: `imageFormats` gains `'bgra'`, and a `channels(format)` helper is shared by both entries.
- `src/index.js`:
  - `codes` gains `bgra: 2`, and the C code adds 4 when the image is premultiplied.
  - `channels()` replaces the four `=== 'rgb' ? 3 : 4` checks (`load`, `parseOptions` width checks, `checkNotEmpty`).
  - `load` validates `premultiplied` and returns it.
  - `getWrapper` copies `premultiplied`.
  - The hints for bare arrays and ImageData stay RGBA.
- `src/worker.js`: `send` passes `premultiplied` through. `worker-thread.js` needs nothing: it calls the main entry.
- No new options, functions or error codes, so the options tables are unchanged.

## Docs

- `docs/api.md`: the image shape, the straight-alpha bullet (premultiplied pixels can now be passed as they are), "Alpha matters only for RGBA" (now RGBA and BGRA), the lists of names, and the TypeScript note about `as const`.
- `docs/environments.md`, Electron section: `{ data: img.toBitmap(), format: 'bgra', premultiplied: true, width, height }` and the way back with `nativeImage.createFromBitmap`. The "BGRA on desktop" claim is checked against Chromium's Skia config (`SK_PMCOLOR_IS_BGRA` / `SK_R32_SHIFT`) or a real Electron run before it is written.
- README input section, CHANGELOG `## 3.2.0`, and ROADMAP item 2 marked done (with premultiplied).

## Tests

- **New `test/bgra.test.js`**, with references in plain JavaScript:
  - **Equivalence:** on synthetic images and a Kodak photo, BGRA gives the same clustering bytes, palette, swatches, info and indexed output as RGBA. This covers both colour spaces, `precision: 6`, both `alpha` modes, `transparent`, and each dither method. `quantize*` output is the RGBA output with R and B swapped, for all three `quantize*` functions, with and without `signal` (the sliced path).
  - **Premultiplied:** the same equivalences against the straight image the read rule gives. The read rule is checked exhaustively over all 65,536 `(a, c)` pairs. Output is checked against `round(c·a/255)`, and `c > a` against the clamp.
  - **Round trip:** for every `c ≤ a`, premultiplying the un-premultiplied value gives back `c`. So an image whose straight colours are all in the palette maps back to its own bytes.
  - **Results** keep `format`, `premultiplied`, `width` and `height`. The worker entry (functions and handles) gives identical results.
- **Validation:** the errors above, with their codes and arguments.
- **Updated:**
  - `test/lists.test.js` (the pinned list).
  - `test/types/*` (a BGRA premultiplied image compiles and its result keeps `format`; a non-boolean `premultiplied` is a `@ts-expect-error`).
  - `api.test.js` snapshots (`-u` after review).
  - The browser app: one BGRA premultiplied call through the worker.
- **Golden:** passes unchanged.

## Verification

- `npm test`, `npm run test:types`, `npm run test:browser`.
- `npm run bench` on RGBA against a master build (`--ac`): no regression above noise. BGRA and premultiplied cost recorded in the PR.
- WASM size before and after, in the PR.
- One ASan/UBSan run (recipe in CLAUDE.md) over the suite.
