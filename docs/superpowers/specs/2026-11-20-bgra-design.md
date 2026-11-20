# 3.2.0: BGRA, formats without alpha, and premultiplied alpha

Roadmap item 2 (`format: 'bgra'`), widened after an exploratory round on the first release candidate. Six outside-user projects took part: Electron, a BMP tool, server-side canvases, WebCodecs, an ffmpeg-to-GIF pipeline, and a TypeScript wrapper.

## Why

- **BGRA:** Electron's `nativeImage`, Windows bitmaps and native capture APIs give BGRA, and users swapped the channels both ways in JavaScript. The first candidate (format `'bgra'`) worked: byte-identical to RGBA with the channels swapped, in every tester's project.
- **No alpha in the fourth byte** (4 of 6 testers): Windows `BI_RGB` 32-bit bitmaps and GDI screenshots (the byte is 0), WebCodecs `BGRX`/`RGBX`, ffmpeg `bgr0`/`rgb0`, and DXGI `B8G8R8X8`.
  - Passed as `'bgra'` with a zero byte, they silently give an empty palette and black or invisible output.
  - `alpha: 'ignore'` fixes clustering only. Mapping and dithering still skip alpha-0 pixels, and the garbage alpha is copied to the output.
- **Premultiplied** (2 of 6, plus the reviewer):
  - Electron `toBitmap()` and node-canvas `toBuffer('raw')` give premultiplied BGRA; `@napi-rs/canvas` `data()` gives premultiplied RGBA. Canvas-sourced VideoFrames copy out premultiplied too.
  - Passed as straight data, translucent edges darken (red #ff1d1d became #750e0e), with no error.
  - The JavaScript conversion costs about as much as `quantize`, and runs on the calling thread even with the worker entry.
  - The 4.0 deferral was about an image *property* (`premultiplied: true`). **Format names** have none of its problems: every new name throws in 3.1, so no existing call changes; there is no RGB variant, so TypeScript rejects the impossible combination; a typo throws.
- **Result types** (5 of 6): `quantize`'s result for a `RawImage` is typed as plain `RawImage` (`format: ImageFormat`, `data: Uint8Array | Uint8ClampedArray`, `width?`), so callers cast. The widening also makes `ImageFormat`'s growth break more code than it needs to.
- **Bugs that predate this branch**, folded in at the user's request: `ImageData` validation, the worker entry under `nodeIntegrationInWorker`, and indexed output of an image with no visible pixels.

## Formats

`imageFormats` becomes `['rgb', 'rgba', 'bgra', 'rgbx', 'bgrx', 'rgba-premultiplied', 'bgra-premultiplied']`, in that order. `ImageFormat` is the union of these names.

| Format | Bytes | Channel order | Fourth byte |
|---|---|---|---|
| `'rgb'` | 3 | R, G, B | none |
| `'rgba'` | 4 | R, G, B | straight alpha |
| `'bgra'` | 4 | B, G, R | straight alpha |
| `'rgbx'` | 4 | R, G, B | ignored: every pixel opaque |
| `'bgrx'` | 4 | B, G, R | ignored: every pixel opaque |
| `'rgba-premultiplied'` | 4 | R, G, B | premultiplied alpha |
| `'bgra-premultiplied'` | 4 | B, G, R | premultiplied alpha |

- **`x` formats** behave exactly like `'rgb'` with a padding byte. Every pixel counts whole and is mapped and dithered. `alpha` and `transparent` have nothing to act on, as with `'rgb'`. Mapped output writes 255 in the fourth byte, so it is also valid BGRA or RGBA. Clusterings, palettes, swatches and indices are byte-identical to the same pixels as `'rgb'`.
- **Premultiplied formats:**
  - **Reading:** each colour channel is read as straight `min(255, round(c·255/a))`, and alpha 0 reads as black. Values above alpha are invalid premultiplied data and clamp, with no validation pass.
  - **Behaviour after reading:** everything works as for the straight format: alpha weighting, `transparent`, dithering. So clusterings, palettes, swatches and indices are byte-identical to the straight image the read rule gives.
  - **Mapped output** is premultiplied again, `round(c·a/255)` per channel with the pixel's own alpha. The output is therefore valid premultiplied data; fully transparent pixels come out as 0, 0, 0, 0.
- **Results:** mapped images come back in the input's format. Palettes, clusterings and indices are always straight RGB.
- **Naming:** the option-shape convention lets these names become shorthands for a later object form (`format: { order, alpha }`), additively, if more variants appear.

## Result types

- **`RawImage<F extends ImageFormat = ImageFormat>`** `{ data: Uint8Array | Uint8ClampedArray; format: F; width?; height? }`. The default keeps every existing use of `RawImage` meaning what it did.
- **`ImageResult<I>`:** for `I extends RawImage`, the result is `{ data: Uint8Array; format: I['format']; width: I['width']; height: I['height'] }`, exported as `RawResult<I>`.
  - At run time `data` is always a `Uint8Array` (from the module's buffer) and `width`/`height` are copied when given, so the types now say what happens.
  - A narrower result is assignable wherever the old wide one was. Generic wrappers (`<J extends ImageLike>(img: J) => quantize(img, k)`) keep compiling, because `ImageResult` stays a conditional type over `I`. A test proves this.
- `Uint8Array` and `ImageData` inputs are unchanged.

## Bugs fixed

1. **`ImageData` validation** (`checkImageDataPixels` in `shared.js`, used by both entries).
   - Reject an `ImageData` whose `colorType` is present and not `'rgba'` (skia-canvas: `'bgra'`, `'rgb888x'`, `'gray8'` and others), as Chromium's `pixelFormat` already is. The hint names the right `format` for the BGRA case (`{ data: id.data, format: 'bgra', width, height }`) or says to ask for `'rgba'`.
   - Reject one whose `data.length !== width × height × 4` (node-canvas `pixelFormat: 'A8'`, skia `gray8`).
   - Both errors are `invalid-argument` with argument `'image'`. Today these images give wrong output (blue for red, a wrong pixel count), so this is a bug fix.
2. **The worker entry under `nodeIntegrationInWorker`** in an Electron renderer loaded from `file://`.
   - The patched glue's Node detection accepts `process.type == "worker"` (Electron's Web Workers with Node integration), takes the `node:module` path, and fails with `wasm-load-failed`, even when `wasm` bytes are given.
   - Exclude `"worker"` as `"renderer"` is excluded (`scripts/patch-glue.mjs`), so those workers take the web path, which the tester confirmed works there (the `.wasm` fetches with status 200). Check the JS entries' own Node checks for the same assumption.
   - Verified in a real Electron run (`show: false`, headless).
   - The `wasm-load-failed` message should not blame fetching when bytes were given.
3. **Indexed output of an image with no visible pixels** (all below the `transparent` cutoff) has no colour entry, only the transparent one. The docs promise at least one colour.
   - Give it one black colour entry, then the transparent entry, as the same image without `transparent` already gets one black entry.
   - This changes the output of that edge case, as a documented bug fix.

## Messages

- **Format error:** shows the value it got. Hints for:
  - a known name in the wrong case (`'BGRA'` → `'bgra'`);
  - `'argb'` and `'xrgb'` (Cairo, node-canvas: "native-endian ARGB32 is 'bgra-premultiplied' in memory on little-endian machines");
  - `'bgr'` (24-bit BGR isn't supported: widen to `'bgrx'`).
  The message is built from `imageFormats`.
- **The missing-format hint** ("add `format: 'rgba'` (or `'rgb'`)") and the size-limit message ("about 480 megapixels of RGBA") name formats generically or list them all.
- **A `VideoFrame` passed directly** gets a hint: `frame.copyTo(buffer, { format: 'BGRA' })`, then `format: 'bgra'`. Or `'BGRX'` and `'bgrx'` for frames without alpha.
- **The detached-buffer message** is worded the same in both entries.

## C++

- **Format codes:** `rgba` 0, `rgb` 1, `bgra` 2, `rgbx` 3, `bgrx` 4, `rgba-premultiplied` 5, `bgra-premultiplied` 6. `layout_of` returns `{ stride, r, b, alpha, premultiplied }`: `alpha` false for `x` formats, and their output writes 255. JS never sends another code, and the `default` stays RGBA with a comment saying JS validates.
- **Un-premultiplying** goes through a 64 KB `[a][c]` table built once, behind one per-image branch at each read site. Every read site gets its colour through one helper, `read(pixel) -> r, g, b`, so the histogram key, the memo keys and dithering all see straight colours.
- **The `_quantize` sink** writes the channel order, then either alpha as given, or 255 for `x` formats, or premultiplies the colour by the pixel's alpha.
- **Speed:** no regression for RGB, RGBA or BGRA (bench against master, as before). Premultiplied costs are recorded.

## JS

- `shared.js`: `imageFormats`, `channels(format)` and `hasAlpha(format)` (false for `rgb`, `rgbx` and `bgrx`).
- `index.js`: the codes; `checkNotEmpty` and the `transparent` paths use `hasAlpha`; the hints.
- The worker entry passes formats through. Its `send` validation for `ImageData` uses the shared check.

## Docs

- **`docs/api.md` Input:**
  - the format table above;
  - a table of where pixels come from: Electron `toBitmap()`, node-canvas `toBuffer('raw')`, `@napi-rs/canvas` `data()`, skia-canvas raw and `colorType`, `getImageData`, sharp `.raw()`, WebCodecs `copyTo` (`'BGRA'`/`'BGRX'`; canvas-sourced frames are premultiplied), ffmpeg `-pix_fmt bgra`/`bgr0`, GDI `GetDIBits` / `BI_RGB`;
  - the rule that a wrong channel order gives plausible palettes with red and blue swapped, which can't be detected.
- **`alpha`** says it affects clustering only.
- **"Each pixel keeps its own alpha"** is restated per format.
- **Electron section:** `{ data: img.toBitmap({ scaleFactor }), format: 'bgra-premultiplied', width, height }` with the scale factor handled (the current snippet throws for `@2x` images), and the way back with `createFromBitmap(…, { width, height, scaleFactor })`. The JavaScript conversion loops go.
- **New recipes:** WebCodecs (`copyTo` into BGRA, with the worker) and ffmpeg rawvideo (`-pix_fmt bgra`; use `bgrx` for `bgr0`).
- **Smaller fixes:**
  - the stale WASM size in environments.md (92 KB → the real figure);
  - the GIF guide's reuse of `colors` for gifenc's nested array;
  - the TypeScript section notes that `ImageFormat` grows.
- **README:** the format list, and a pointer to the pixel-source table.
- **CHANGELOG:**
  - the formats;
  - the narrowed result types;
  - the three fixes, the last as a changed edge case;
  - the TypeScript patterns that a growing `ImageFormat` breaks (`never` switches, `Record<ImageFormat, …>`, spelled-out unions, `if rgb … else rgba`).
- **ROADMAP:** item 2 done, and the 4.0 section's premultiplied entry replaced by a note that it shipped as format names. A possible object form of `format` and rejecting unknown image keys stay there as 4.0 ideas.

## Tests

- **`test/bgra.test.js`** is renamed **`test/pixel-formats.test.js`** and grows, with plain-JavaScript references:
  - `'bgrx'` and `'rgbx'` equal `'rgb'` for clusterings, palettes and indices, with the fourth byte at 0, at 255 and random. Mapped output is the RGB result in that order, with 255 in the fourth byte.
  - The premultiplied formats equal the straight image produced by the read rule. The rule is checked over all 65,536 `(a, c)` pairs. Output is checked against `round(c·a/255)`. Round trip: premultiplying an un-premultiplied value gives back `c` for every `c ≤ a`.
  - Every format goes through the worker entry, handles and the sliced path.
- **Validation:** the new `ImageData` checks (fake skia and node-canvas `ImageData` objects), and the message hints.
- **Fix 3** gets a test of the black entry plus the transparent entry.
- **Fix 2:**
  - A unit test of the patched glue's detection string, as `test/bundle.test.js` checks the glue.
  - A one-off real Electron run recorded in the PR. Electron is too heavy for CI.
- **Types** (`test/types/*`):
  - narrowed results for each format (`format`, `data: Uint8Array`, `width: number`);
  - `RawImage` with no type argument as before;
  - a generic wrapper still compiling;
  - `@ts-expect-error` for an unknown format name.
- **Lists:** `test/lists.test.js` pins the new list.
- **API snapshots:** updated with `-u` after review.
- **Golden:** unchanged.
- **Browser test:** one premultiplied BGRA call and one `bgrx` call through the worker, each inside its own check.

## Verification

- `npm test`, `npm run test:types`, `npm run test:browser`.
- Bench and mapping timings against master: no regression for RGB, RGBA or BGRA.
- WASM size.
- ASan/UBSan, with long timeouts as on this branch.
- A real Electron run (fix 2, and the Electron recipe end to end).
- A fresh whole-branch review.
