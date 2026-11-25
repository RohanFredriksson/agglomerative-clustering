# 4.0 part 1: premultiplied input, image keys, narrowed results — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the first half of 4.0 on master:
- `premultiplied: true` on `rgba`/`bgra` image objects, converted in place in the WebAssembly heap;
- unknown image-object keys rejected, with near-miss hints;
- `RawImage` as a union by `format`;
- results narrowed to their input's type.

**Architecture:**
- Two new C exports, `unpremultiply` and `premultiply`, run in place over pixel ranges of buffers already in the heap.
- JS calls them right after copying an image in (`call`, `clusterInSlices`, `mapInSlices`), and on mapped output before reading it out. The existing pixel loops don't change.
- `load(image)` in `src/index.js` validates the flag. A shared `checkImageKeys` in `src/shared.js` rejects unknown keys in both entries.
- `getWrapper` and the worker's `send` carry `premultiplied` through.

**Tech Stack:** C++17 → WebAssembly (Emscripten `em++`), JavaScript (Babel builds), TypeScript declarations, vitest, libFuzzer.

**Spec:** `docs/superpowers/specs/2026-11-25-4-0-premultiplied-and-image-types-design.md` (approved 2026-11-25). Read it before each task; it is the authority where this plan is silent.

## Global Constraints

- Read with `premultiplied: true`: each colour channel of a pixel with alpha < 255 becomes `min(255, round(c·255/a))`, and alpha 0 becomes black. Alpha is never changed. Output is premultiplied again with `round(c·a/255)` using the input's alpha.
- Palettes, clusterings and indexed output (`quantizeToIndices*`) stay straight. `IndexedImage` gains no `premultiplied` key.
- Output is byte-identical to 3.8 for every input without `premultiplied: true`: `test/golden.test.js` passes unchanged, and only new keys are added.
- The caller's array is never changed. Convert only the library's own heap copy.
- Image-object keys: only `data`, `format`, `width`, `height`, `premultiplied`. Other own enumerable keys throw, including ones whose value is `undefined`. Inherited keys are not checked. `ImageData` and bare `Uint8Array`s are unaffected.
- Exact messages (all `invalid-argument` on `'image'`):
  - `Invalid image: premultiplied is for 'rgba' and 'bgra'; '${format}' has no alpha, so remove it.`
  - `Invalid image: premultiplied must be true or false, got ${describe(value)}.`
  - `Invalid image: unknown key '${key}'. An image object has data, format, width, height and premultiplied: build it from those rather than spreading a decoder's result.` followed by a hint where one applies:
    - for `premultiply`: ` Did you mean premultiplied: true?`
    - for a key within edit distance 1 of a known key, or equal to one ignoring case: ` Did you mean '${known}'?`
    - for `channels`, `size`, `depth`: ` Spread only width and height from a decoder's result.`
- Order of checks: the existing shape checks (`data`, `format`, length, `width`/`height`) first, then unknown keys, then `premultiplied`.
- `premultiplied: false` on any format is accepted and does nothing.
- No new error code. Validate and take bytes before the first `await`. No top-level await in `src/worker-thread.js`. No `await using` syntax in tests: check new test files with `node --check` under Node 20/22, which CI still runs until part 2.
- Commits are authored by the configured git user, with no Claude trailers. Don't push. Branch `feat/4-0-premultiplied` off an up-to-date master after PR #71 merges.
- Tests import from `dist/`. C++ changes need `source ~/.local/share/emsdk/emsdk_env.sh && npm run build`; JS-only changes need `npm run build:js`.

## Review Focus

1. **A premultiplied pixel whose colour exceeds its alpha** (`c > a`, malformed input). Expected: clamped to 255, never wrapped. Test in Task 1.
2. **A view into part of a larger buffer** (`subarray`, a Node `Buffer` from the shared pool) with `premultiplied: true`. Expected: correct output, and the caller's bytes outside the view are untouched. Test in Task 1.
3. **An image handle made from a premultiplied object** (`worker.cluster({ …, premultiplied: true })`). Expected: `handle.quantize(k)` returns premultiplied output tagged `premultiplied: true`, matching the main entry. Test in Task 3.
4. **A result fed back in as input** (`quantize(await quantize(img, 16), 8)`). Expected: no unknown-key error, and the flag round-trips. Test in Task 2.
5. **An aborted sliced call during the conversion pass** (`signal` aborted on a 12 MP translucent image). Expected: it rejects with the signal's reason, and the next call works (the instance is consistent). Test in Task 1.

---

### Task 1: The conversion passes, on the main entry

**Files:**
- Modify:
  - `src/clustering.cpp`: add two `EMSCRIPTEN_KEEPALIVE` exports and their tables.
  - `package.json`: add `build:wasm` `EXPORTED_FUNCTIONS` `'_unpremultiply','_premultiply'`.
  - `src/index.js`: `load`, `call`, `clusterInSlices`, `mapInSlices`, and each function that maps.
  - `test/golden.test.js` and `test/golden.json` (new keys only).
  - `native/fuzz_images.cpp`.
- Test: `test/premultiplied.test.js` (new).

**Interfaces:**
- Produces (C):
  - `void unpremultiply(uint8_t* pixels, uint32_t start, uint32_t end)` and `void premultiply(uint8_t* pixels, uint32_t start, uint32_t end)`.
  - Both work in place on 4-byte pixels `[start, end)`, with alpha in byte 3, so they serve `rgba` and `bgra` alike. Pixels with alpha 255 are skipped.
  - Each uses a 256×256 table (`table[a][c]`) built on first use, as the spike `bench/spikes/premultiplied/pass.cpp` does.
- Produces (JS, `src/index.js`):
  - `load(image)` returns `{ data, format, width, premultiplied: boolean }`. `premultiplied` is true only for `rgba`/`bgra` objects with `premultiplied === true`.
  - In one-shot calls, `call` runs `_unpremultiply` on the image buffer right after copying it in. For mapped (non-indexed) output it runs `_premultiply` on the output payload (`outputPointer + 4`) before `unpack`.
  - The sliced functions run the input pass in slices of 65,536 pixels: `checkAborted` before each slice, `yieldNow` between slices, and none of the progress share. They run the output pass the same way after `_mapping_job_result`.

- [ ] **Step 1: Write the failing tests in `test/premultiplied.test.js`.**
  - Helpers: `premultiplyJs(rgba)` and `unpremultiplyJs(rgba)` with the spec's formulas, as in `bench/spikes/premultiplied-straight/recipes.mjs`. Images: a 64×48 synthetic gradient, and a variant with alpha `x % 256` (every alpha value) plus some opaque and alpha-0 pixels.
  - `'clusters a premultiplied image as its straight original'`: `buildClustering({data: pre, format:'rgba', premultiplied:true})` is byte-equal to `buildClustering({data: unpremultiplyJs(pre), format:'rgba'})`. The same holds for `buildPalette` and `buildSwatches`, for `'bgra'` (channels swapped), and for `{ colorSpace: 'oklab' }` and `alpha: 'ignore'`.
  - `'quantize gives premultiplied output'`: `quantize(preImg, 16, o).data` equals `premultiplyJs(quantize(straightImg, 16, o).data)`. Check `o` = `{}`, `{dither: true, width}`, `{dither: 'ordered', width}`. Do the same for `quantizeWithPalette` and `clustering.quantize`.
  - `'indexed output is straight'`: `quantizeToIndices(preImg, 16)` and `quantizeToIndicesWithPalette` deep-equal the straight original's results, with and without `transparent: true`.
  - `'alpha 0 is black and c > a is clamped'` (Review Focus 1): pixels `[10,0,0,0]` and `[200,100,50,40]` read as `[0,0,0,0]` and `[255,255,255,40]`. Check by comparing `buildPalette(…, 2)` with the straight `[0,0,0,0]` and `[255,255,255,40]` image's.
  - `'an opaque image gives the same output with or without the flag'`.
  - `'the caller's array is unchanged'`. Include a `subarray` view into a larger buffer (Review Focus 2): the bytes outside the view are untouched and the result is correct.
  - `'the same with and without signal and onProgress'`, for `buildClustering` and `quantize` with dithering.
  - `'an abort during the conversion pass rejects, and the next call works'` (Review Focus 5). Use a 4240×2832 premultiplied gradient and abort from `onProgress`'s first call or after one yield. Expect rejection with the reason, then a small call succeeds.
  - `'errors'`:
    - `premultiplied: true` on `'rgb'`, `'rgbx'` and `'bgrx'` gives the exact message.
    - `premultiplied: 1` and `'yes'` give the exact message.
    - `premultiplied: false` on `'rgb'` is accepted.
    - A bad `format` together with `premultiplied: 1` reports the format first.

- [ ] **Step 2: Run** `npm run build && npx vitest run test/premultiplied.test.js`. Expected: FAIL. The flag is ignored, so outputs differ and no errors are thrown.

- [ ] **Step 3: Implement.**
  - The C++ exports.
  - `load`'s `premultiplied` checks and return field.
  - `call` takes the image's `premultiplied` and whether the output is mapped. Pass them however fits the current call sites, so that non-premultiplied calls run exactly the old code path.
  - The sliced passes.
  - Report the `.wasm` size before and after in the report.
  - Add to `native/fuzz_images.cpp`: run `unpremultiply` over the fuzzed RGBA image (when its format has alpha) before the existing checks, and `premultiply` over mapped output. Run `scripts/native.sh fuzz 60` in the podman container command from CLAUDE.md.
  - In `test/golden.test.js`, add keys for premultiplied copies of one synthetic translucent image and one Kodak photo with alpha `x % 256`:
    - `…/premultiplied/clustering`;
    - `…/premultiplied/palette/16`;
    - `…/premultiplied/quantize/16`;
    - `…/premultiplied/quantize/16/dither`;
    - `…/premultiplied/map/16` (`quantizeWithPalette`).

- [ ] **Step 4: Run** `npx vitest run test/premultiplied.test.js test/golden.test.js && npm test`. Then `UPDATE_GOLDEN=1 npx vitest run test/golden.test.js` once. `git diff test/golden.json` must show only added `premultiplied` keys. Expected: all PASS.

- [ ] **Step 5: Commit** "Premultiplied input: convert in place in the heap, premultiplied mapped output". The message says the golden file only gains keys.

### Task 2: Unknown image keys, and results that carry `premultiplied`

**Files:**
- Modify:
  - `src/shared.js`: new `checkImageKeys(image)`.
  - `src/index.js`: `load` calls it; `getWrapper` copies `premultiplied`.
- Test: `test/image-keys.test.js` (new).

**Interfaces:**
- Produces: `export const checkImageKeys = (image) => void` in `src/shared.js`. It throws the unknown-key `fail(...)` from Global Constraints for the first offending own enumerable key, in `Object.keys` order. Task 3 calls it from the worker entry.
- Produces: `getWrapper(image)` results get `premultiplied` copied as given (`false` included) when the input has the key.

- [ ] **Step 1: Write the failing tests in `test/image-keys.test.js`.**
  - Each case expects the exact message and `{ code: 'invalid-argument', argument: 'image' }`:
    - `{ data, format:'rgba', premultiply: true }` gives the `premultiply` hint;
    - `widht` gives `Did you mean 'width'?`;
    - `Format` gives `Did you mean 'format'?`;
    - `channels: 4` gives the decoder hint;
    - `{ ...{ data, format:'rgba', foo: undefined } }` is rejected for `foo`.
  - A class instance with `data`/`format` own properties and an inherited getter is accepted.
  - `ImageData` is accepted, its own properties notwithstanding.
  - A bare `Uint8Array` is accepted.
  - Ordering: an object with a bad `format` and an unknown key reports the format.
  - `'a result carries premultiplied, copied as given'`:
    - `quantize({ data, format:'rgba', width, premultiplied:true }, 4)` has keys `data, format, width, premultiplied` with `premultiplied === true`;
    - with `premultiplied:false` the key is copied as `false`;
    - without it there is no key.
  - `'a result fed back in is accepted'` (Review Focus 4): `quantize(await quantize(img, 16), 8)` resolves, and the flag round-trips.

- [ ] **Step 2: Run** `npm run build:js && npx vitest run test/image-keys.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement** `checkImageKeys` (edit distance: plain Levenshtein ≤ 1 over the five known keys, or a case-insensitive match), the `load` call in the order the Global Constraints give, and the `getWrapper` copy.

- [ ] **Step 4: Run** `npx vitest run test/image-keys.test.js && npm test`. Some existing tests may pass objects with extra keys. Fix the test inputs (they are 4.0 breaks by design) and list each one in the report. Expected: all PASS.

- [ ] **Step 5: Commit** "Reject unknown image-object keys, with near-miss hints; results carry premultiplied".

### Task 3: The worker entry

**Files:**
- Modify: `src/worker.js` (`send`, the image functions, `cluster`, the loaded handle's mapping methods).
- Test: `test/worker-premultiplied.test.js` (new).

**Interfaces:**
- Consumes: `checkImageKeys` (Task 2), the main entry's `premultiplied` behaviour (Task 1).
- Produces: `send(image)` calls `checkImageKeys` for `{ data, format }` objects, then copies `premultiplied` onto the sent object when the input has the key. Because `send` runs on the caller's side before posting, a bad key rejects without a round trip.

- [ ] **Step 1: Write the failing tests.**
  - Each worker form returns exactly the main entry's result (`toEqual`) for the premultiplied gradient image:
    - `worker.buildPalette`;
    - `worker.quantize`, with and without dithering;
    - `worker.quantizeToIndices`;
    - `worker.quantizeWithPalette`;
    - an image handle's `quantize(k)` and `quantizeToIndices(k)` (Review Focus 3);
    - a loaded handle's `quantize(image, k)`.
  - `quantize` results carry `premultiplied: true`.
  - `'an unknown key rejects without posting'`: a `vi.spyOn(Worker.prototype, 'postMessage')` sees no call, and the error equals the main entry's (`message`, `code`, `argument`).
  - `createWorker({ transfer: true })` with a premultiplied object: the result is correct, and the caller's data is moved as for any image.

- [ ] **Step 2: Run** `npm run build:js && npx vitest run test/worker-premultiplied.test.js`. Expected: FAIL. `send` drops `premultiplied` today.

- [ ] **Step 3: Implement** the `send` changes. Check that every path that sends an image goes through `send`: the image functions, `cluster`, and the loaded handle's `mapping`.

- [ ] **Step 4: Run** `npx vitest run test/worker*.test.js && npm test`. Expected: PASS.

- [ ] **Step 5: Commit** "Worker entry: premultiplied images and image-key checks before posting".

### Task 4: Types

**Files:**
- Modify:
  - `src/index.d.ts`: the `RawImage` union, `ImageResult`, the `IndexedImage` doc comment, and the header comment (lines 4-5) pointing at the option.
  - `src/worker.d.ts`, wherever it names `RawImage` or results.
- Test:
  - `test/types/shapes.mts` (or a new `test/types/premultiplied.mts`, added to the three tsconfigs);
  - `test/api/*.snap.txt`.

**Interfaces:**
- Produces, exactly the spec's declarations ("Image objects" and "Results"):
  - `RawImage<F extends ImageFormat = ImageFormat>` as the distributive conditional over the internal `RawImageWithAlpha<F>` / `RawImageWithoutAlpha<F>`. Both have `premultiplied?: boolean | undefined`.
  - `ImageResult<I>` with the `Omit<I, 'data'> & { data: Uint8Array }` branch.
  - Only `RawImage` is a public name (plus whatever the type tests prove callers need).

- [ ] **Step 1: Write the type tests.** Each must compile, or fail where marked with `// @ts-expect-error`:
  - `premultiplied: false` and a `boolean` variable on `'rgb'` compile;
  - `const r = await quantize({ data: u8, format: 'bgra' as const, width: 4 }, 4)`: `r.data` is `Uint8Array`, `r.format` is `'bgra'`, `r.width` is `number`;
  - with `premultiplied: true`, `r.premultiplied` is `boolean`;
  - `handle.quantize(4)` from `worker.cluster(img)` returns the type of `img`'s result;
  - `loaded.quantize(img, 4)` returns `ImageResult<typeof img>`;
  - `<I extends ImageLike>(img: I) => quantize(img, 4)` compiles;
  - `<F extends ImageFormat>(f: F, data: Uint8Array) => quantize({ data, format: f } as RawImage<F>, 4)` compiles;
  - `const x: RawImage<ImageFormat> = …; const y: RawImage = x;` compiles;
  - a `Buffer` input gives `Uint8Array`;
  - in the Node-only config, `PlatformImageData` is `never`;
  - `// @ts-expect-error interface X extends RawImage {}`, with `type X = RawImage<'rgba'>` compiling;
  - `// @ts-expect-error` for a `let r = await quantize(rgbaImg, 4); r = await quantize(bgraImg, 4);` reuse.

- [ ] **Step 2: Run** `npm run build:js && npm run test:types`. Expected: FAIL on the new lines.

- [ ] **Step 3: Implement the declarations.** Write the doc comments with the spec's wording: "copied as given" for the result's `premultiplied`; "the palette is straight even for a premultiplied input" for `IndexedImage`. The `premultiplied` field's doc comment carries the straight-destination warning: "For a straight destination (ImageData, PNG encoders), use quantizeToIndices and write palette colours with the input's alpha; un-premultiplying the output loses colour."

- [ ] **Step 4: Run** `npm run test:types && npx vitest run test/api.test.js`. Review the snapshot diff, then accept it with `-u`. Expected: PASS.

- [ ] **Step 5: Commit** "Types: RawImage by format, results narrowed to the input".

### Task 5: Docs, the straight-output recipe, and the record

**Files:**
- Modify:
  - `docs/api.md`: Input, the "Where pixels come from" table, the `ImageFormat` table, Output, the `alpha`/`transparent` text, the error table row.
  - `docs/environments.md`: the Electron section.
  - `docs/guides.md`: the straight-output recipe.
  - `docs/migrating.md`: a new "From 3.x to 4.0" section.
  - `README.md`: the Input paragraph, line 85.
  - `src/index.js`: line 31, the `argb` hint.
  - `CHANGELOG.md`: a new `## 4.0.0` section.
  - `docs/ROADMAP.md` and `docs/PRINCIPLES.md`: the record.
- Test: `test/recipes.test.js`, and `test/api.test.js`'s docs checks.

**Interfaces:**
- Consumes: the behaviour of Tasks 1-4.
- Produces: the guides recipe as a function `toStraight(image, k, options)`. It returns straight RGBA (`Uint8ClampedArray`, swapped back for `'bgra'`) by `quantizeToIndices` on the premultiplied input, then writing each pixel's palette colour with the input's alpha (the spec's "Straight output is a recipe").

- [ ] **Step 1: Write the failing recipe tests in `test/recipes.test.js`.**
  - The guides' source of `toStraight` equals the test's copy.
  - `toStraight(preImg, 16)` equals `quantize(straightImg, 16).data`, for RGBA and BGRA.
  - The traps are pinned:
    - output alpha equals the input's;
    - the recipe passes no `transparent` (assert that the copied source does not contain `transparent`);
    - a BGRA input comes back swapped correctly;
    - the result constructs an `ImageData` without throwing.

- [ ] **Step 2: Run** `npx vitest run test/recipes.test.js`. Expected: FAIL (the recipe isn't in the guides yet).

- [ ] **Step 3: Write the docs**, per the spec's "Docs" section and its decision lines:
  - In api.md Input:
    - the table says `premultiplied: true` for Electron, node-canvas raw, `@napi-rs/canvas`, WebGL, WebCodecs frames from a canvas, and WIC PBGRA;
    - premultiplied output can go back to raw surfaces (Electron `createFromBitmap`, Cairo, WIC), but not to `ImageData`;
    - setting the flag is harmless on opaque data, with the figure: 5 ms on 12 MP, plus its source comment;
    - palettes and indexed output are straight;
    - the warning against un-premultiplying output, with its figures (1,171 colours for k = 16, up to 120 per channel below alpha 16), plus its source comment;
    - the conversion loops are dropped, except as needed for the recipe.
  - In api.md Output: results have the input's `format`, `width`, `height` and `premultiplied`. The "typed `RawImage`… cast" text goes.
  - environments.md: the Electron example passes `premultiplied: true` and draws back with `createFromBitmap`. Its "planned for 4.0" sentence goes.
  - migrating.md "From 3.x to 4.0" (for the first beta) lists each cost from the spec's Results section with its fix:
    - the reused `let`;
    - `interface extends RawImage`;
    - `Uint8Array` data;
    - spreading a decoder's result;
    - 3.x ignoring `premultiplied`.
  - README line 85: "premultiplied (canvas, Electron): pass `premultiplied: true`".
  - The `argb` hint in `src/index.js` line 31 points at `premultiplied: true` with `'bgra'`.
  - CHANGELOG `## 4.0.0`: Breaking (unknown keys; narrowed types) and Added (`premultiplied`).
  - ROADMAP: the premultiplied and narrowed-results entries marked done in part 1. Under "Considered": the in-place pass with its figures, over per-loop format codes.
  - PRINCIPLES: the "deferred to 4.0" lines on premultiplied input (around lines 25 and 109) updated.

- [ ] **Step 4: Run** `npm run build:js && npx vitest run test/recipes.test.js test/api.test.js && npm test`. Expected: PASS.

- [ ] **Step 5: Commit** "Docs: premultiplied input, image keys, the straight-output recipe; the 4.0 record".

### Task 6: Whole-suite checks

- [ ] **Step 1:** `source ~/.local/share/emsdk/emsdk_env.sh && npm run build && npm test && npm run test:types`. Expected: all pass. Write the output to a file and report the counts.
- [ ] **Step 2:** `CHROMIUM_PATH=$(ls -d ~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome | tail -1) npm run test:browser`. Expected: every check is `ok` in Vite, webpack and Parcel.
- [ ] **Step 3:** `scripts/asan-test.sh`, then `npm run build`. Expected: every test passes, with no sanitizer reports.
- [ ] **Step 4:** Run `node --check` under Node 20 (the podman `node:20` container) on every new or changed test file. Expected: none fails to parse.
- [ ] **Step 5:** Final branch review (the controller's job): `git diff master...HEAD` to a file; the code reviewer plus the three stewards and `user-advocate` on Sonnet; findings as an artifact page; PR with no trailers. The user merges.
