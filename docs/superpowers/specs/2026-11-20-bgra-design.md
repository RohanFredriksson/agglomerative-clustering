# 3.2.0: BGRA, and formats whose fourth byte isn't alpha

Roadmap item 2 (`format: 'bgra'`), extended after an exploratory round on the first release candidate. Six outside-user projects took part: Electron, a BMP tool, server-side canvases, WebCodecs, an ffmpeg-to-GIF pipeline, and a TypeScript wrapper. Their notes are in `/home/rohan/Programming/ac-explore-bgra/FINDINGS.md`.

## Why

- **BGRA:** Electron's `nativeImage`, Windows bitmaps and native capture APIs give BGRA, and users swapped the channels both ways in JavaScript. The first candidate (`'bgra'`) worked in every tester's project: byte-identical to RGBA with the channels swapped.
- **Formats whose fourth byte isn't alpha** (4 of 6 testers): Windows `BI_RGB` 32-bit bitmaps and GDI screenshots (the byte is 0), WebCodecs `BGRX`/`RGBX`, ffmpeg `bgr0`/`rgb0`, DXGI `B8G8R8X8`.
  - Passed as `'bgra'` with a zero byte, they silently give an empty palette and black or invisible output.
  - `alpha: 'ignore'` fixes clustering only. Mapping and dithering still skip alpha-0 pixels, and the garbage byte is copied to the output.
  - The docs advertise BGRA "for Windows bitmaps", so users will pass exactly these.
- **Bugs that predate this branch**, folded in at the user's request: `ImageData` validation, the worker entry under `nodeIntegrationInWorker`, and indexed output of an image with no visible pixels.

## Formats

`imageFormats` becomes `['rgb', 'rgba', 'bgra', 'rgbx', 'bgrx']`, and `ImageFormat` is that union.

| Format | Bytes | Channel order | Fourth byte |
|---|---|---|---|
| `'rgb'` | 3 | R, G, B | none |
| `'rgba'` | 4 | R, G, B | straight alpha |
| `'bgra'` | 4 | B, G, R | straight alpha |
| `'rgbx'` | 4 | R, G, B | ignored: every pixel opaque |
| `'bgrx'` | 4 | B, G, R | ignored: every pixel opaque |

- **`'bgra'`** behaves exactly like `'rgba'` with R and B swapped: alpha weighting, `transparent`, every dither method, both colour spaces, the sliced path and the worker entry.
- **The `x` formats** behave exactly like `'rgb'` with a padding byte.
  - Every pixel counts whole and is mapped and dithered.
  - `alpha` and `transparent` have nothing to act on, as with `'rgb'`.
  - Mapped output writes 255 in the fourth byte, so it is also valid BGRA or RGBA.
  - Clusterings, palettes, swatches and indices are byte-identical to the same pixels as `'rgb'`.
- **Results:** mapped images come back in the input's format. Palettes, clusterings and indices are always RGB.
- **Alpha is straight in every format.** Premultiplied input is planned for 4.0 (see "Deferred"); until then the docs show the conversion.
- **Unchanged:** the clustering format, `formatVersion`, fixtures, golden hashes, the type declarations apart from `ImageFormat`'s names, and every existing call's output.

## Bugs fixed

1. **`ImageData` validation** (`checkImageDataPixels` in `shared.js`, used by both entries).
   - Reject an `ImageData` whose `colorType` is present and not `'rgba'` (skia-canvas: `'bgra'`, `'rgb888x'`, `'gray8'` and others), as Chromium's `pixelFormat` already is. The message suggests the matching `{ data, format }` (`'bgra'`, or `'rgbx'` for `'rgb888x'`) where there is one.
   - Reject one whose `data.length !== width × height × 4` (node-canvas `pixelFormat: 'A8'`, skia `gray8`).
   - Both errors are `invalid-argument` with argument `'image'`. Today these images give wrong output (blue for red, a wrong pixel count), so this is a bug fix.
2. **The worker entry under `nodeIntegrationInWorker`** in an Electron renderer loaded from `file://`.
   - The patched glue's Node detection accepts `process.type == "worker"` (Electron's Web Workers with Node integration), takes the `node:module` path, and fails with `wasm-load-failed`, even when `wasm` bytes are given.
   - Exclude `"worker"` as `"renderer"` is excluded (`scripts/patch-glue.mjs`, both glues). The worker entry's own `hasNode` gets the same exclusion.
   - When a load fails on a dynamic import of a Node module, the message says so, rather than "could not be fetched".
   - Verified in a real Electron run.
3. **Indexed output of an image with no visible pixels** (every pixel below the `transparent` cutoff) has only the transparent entry, while the docs said "a colour is always kept besides the transparent entry". That output is deliberate and tested (`test/indices.test.js`: such pixels need no colour), so **the docs are fixed, not the code** (user decision): a colour is kept whenever the image has visible pixels. No output changes.

## Messages

- **Format error:** shows the value it got, and gives a hint for:
  - a known name in the wrong case (`'BGRA'` → `'bgra'`);
  - `'argb'`/`'xrgb'`: Cairo and node-canvas ARGB32 is BGRA in memory on little-endian machines, and premultiplied, so convert it and pass `'bgra'` (see Input);
  - `'bgr'`: 24-bit BGR isn't supported, so widen it to `'bgrx'`.
  The list of names is built from `imageFormats`.
- **The missing-format hint** and the size-limit message ("about 480 megapixels of RGBA") list the formats generically.
- **A `VideoFrame` passed directly** gets a hint: `frame.copyTo(buffer, { format: 'BGRA' })`, then `format: 'bgra'`. Or `'BGRX'` and `'bgrx'` for frames without alpha.
- **The detached-buffer message** is worded the same in both entries.

## C++

- **Format codes:** `rgba` 0, `rgb` 1, `bgra` 2, `rgbx` 3, `bgrx` 4.
- **`PixelLayout`** is `{ stride, r, b, alpha, opaque }`. `alpha` is false for `rgb` and the `x` formats; `opaque` means the output writes 255 in the fourth byte. JS never sends another code, and the `default` stays RGBA with a comment saying JS validates.
- **No new read path:** the `x` formats only set the flags. Speed must not regress (bench against master).

## JS

- `shared.js`: `imageFormats`, `channels(format)` and `hasAlpha(format)` (true for `'rgba'` and `'bgra'`).
- `index.js`: the codes; `checkNotEmpty` and the alpha paths use `hasAlpha`; the messages.
- The worker entry passes formats through and uses the shared `ImageData` check.

## Docs

- **`docs/api.md` Input:**
  - the format table;
  - a table of where pixels come from: Electron `toBitmap()`; node-canvas `toBuffer('raw')`; `@napi-rs/canvas` `data()`; skia-canvas raw and `colorType`; `getImageData`; sharp `.raw()`; WebCodecs `copyTo` (`'BGRA'`/`'BGRX'`; canvas-sourced frames are premultiplied); ffmpeg `-pix_fmt bgra`/`bgr0`; GDI `GetDIBits` / `BI_RGB`. Each row gives byte order, alpha (straight, premultiplied or none) and the format to pass;
  - the premultiplied-to-straight conversion loop and its inverse, moved here from the Electron section, plus sharp's `{ raw: { …, premultiplied: true } }` alternative;
  - the rule that a wrong channel order gives plausible palettes with red and blue swapped, which can't be detected.
- **`alpha`** says it affects clustering only.
- **"Each pixel keeps its own alpha"** is restated per format.
- **Electron section:** `toBitmap({ scaleFactor })` with the scale factor handled (the current snippet throws for `@2x` images), then the conversion from Input, then `format: 'bgra'`, and back through `createFromBitmap(…, { width, height, scaleFactor })`.
- **New recipes in the guides:** WebCodecs (`copyTo` into BGRA, with the worker) and ffmpeg rawvideo (`-pix_fmt bgra`; `bgrx` for `bgr0`).
- **Smaller fixes:**
  - the stale WASM size in environments.md;
  - the GIF guide's reuse of `colors` for gifenc's nested array;
  - the TypeScript section notes that `ImageFormat` grows, and shows the cast for a result passed where `Uint8Array` or a literal format is needed.
- **README:** the format list, and a pointer to the pixel-source table.
- **CHANGELOG:**
  - the formats;
  - the two fixes, and the corrected sentence about the transparent entry;
  - the TypeScript patterns that a growing `ImageFormat` breaks (`never` switches, `Record<ImageFormat, …>`, spelled-out unions, `if rgb … else rgba`).
- **ROADMAP:** item 2 done. The 4.0 section is extended (see "Deferred").

## Deferred to 4.0

Both are recorded in the ROADMAP's 4.0 section with this round's evidence.

- **Premultiplied alpha**, as planned there: `premultiplied` on the formats with alpha, with `RawImage` a union split by `format`. New evidence:
  - node-canvas and `@napi-rs/canvas` buffers, Electron `toBitmap()` and canvas-sourced VideoFrames are premultiplied;
  - skipping the conversion visibly darkens edges;
  - the JavaScript loops cost about as much as `quantize` and run on the calling thread even with the worker entry.

  Format names (`'bgra-premultiplied'`) were considered for 3.2 and rejected: with the planned 4.0 property they would leave two ways to say the same thing.
- **Narrowed result types** (5 of 6 testers cast `quantize`'s result): `RawImage<F>`, and results that keep the input's format, width and height, with `data: Uint8Array`. A prototype showed that narrowing breaks 3.1 code that reuses a `let` across calls with different literal inputs (`'rgba'` then `'bgra'`, or with and without `width`), so it waits for 4.0 and is designed once, with the union.

## Tests

- **`test/bgra.test.js`** is renamed `test/pixel-formats.test.js` and grows:
  - `'bgrx'` and `'rgbx'` equal `'rgb'` for clusterings, palettes, swatches, info and indices, with the fourth byte at 0, at 255 and random, and with `transparent`/`alpha` given;
  - mapped output is the RGB result in that order, with 255 in the fourth byte, for all three `quantize*` functions and each dither setting;
  - the worker entry, handles and the sliced path.
- **Validation:** the `ImageData` checks (fake skia and node-canvas `ImageData` objects, and a real node-canvas one that must still pass), and the message hints.
- **Fix 3:** the existing test of the transparent-only palette gets a BGRA case.
- **Fix 2:** a unit test of the patched glue's detection, and a one-off real Electron run recorded in the PR.
- **Types** (`test/types/*`): `'bgrx'` and `'rgbx'` compile; `@ts-expect-error` for an unknown name.
- **`test/lists.test.js`** pins the list. API snapshots are updated after review. Golden is unchanged.
- **Browser test:** a `bgrx` call through the worker, inside its own check.

## Verification

- `npm test`, `npm run test:types`, `npm run test:browser`.
- Bench against master: no regression.
- WASM size.
- ASan/UBSan.
- A real Electron run (fix 2, and the Electron recipe end to end).
- A fresh whole-branch review.
