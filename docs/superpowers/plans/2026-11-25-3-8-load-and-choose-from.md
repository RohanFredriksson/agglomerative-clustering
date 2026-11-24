# 3.8: `worker.load`, `chooseFrom`, deprecating `…FromClustering` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 3.8.0. It adds `clustering.chooseFrom(palette, k, options?)` (the fixed-palette search, moved into the library), `worker.load(clustering)` returning a `LoadedClusteringHandle`, and `chooseFrom` on both handle kinds. It marks the five `…FromClustering` functions `@deprecated` in both entries. Nothing changes at run time for existing calls.

**Architecture:**
- The search is plain JavaScript in a new `src/choose.js`. It is given the cut, swatch and snap functions, so it has no dependency on an entry.
- `index.js` validates the arguments, copies the palette and runs the search. It is registered in the engine slot, and `shared.js` adds it as a `Clustering` method.
- In the worker entry, the handle object built inside `cluster()` is factored into a builder. That builder makes both kinds of handle: an image handle (`cluster`) and a loaded handle (`load`).
- The thread keeps loaded handles in the same `handles` map, with no image.

**Tech Stack:** JavaScript (Babel builds `src/*.js` to `.mjs`/`.cjs`), TypeScript declarations, vitest, Vite/webpack/Parcel browser harness.

**Spec:** `docs/superpowers/specs/2026-11-24-3-8-and-4-0-design.md` (approved 2026-11-25). Read its "3.8 (additive)" section before each task.

## Global Constraints

- No change to clustering, palette or mapping output: `test/golden.test.js` passes unchanged. Only new keys are added.
- Every call validates its arguments and copies its bytes before its first `await`. Methods never throw synchronously.
- Errors are made with `fail(code, message, argument)`, keep the `Invalid <thing>: …` form, and add no new error code.
- `chooseFrom` defaults `colorSpace` to `'rgb'`, whatever the clustering's space. The snap always maps in RGB. The result palette is always tagged `'rgb'`.
- `chooseFrom` has no function form in either entry, and its options are only `colorSpace` and `signal`. `onProgress` is rejected like any unknown option.
- `src/worker-thread.js` must not use top-level await.
- The deprecations are type-level only: there is no warning and no change in behaviour.
- New figures in `docs/` or the README carry an HTML comment naming the script and results file.
- Commits are authored by the user, with no Claude author or trailers. Branch `feat/3-8-load-choose-from` off an up-to-date master, after PR #67 is merged. The user merges.
- Tests import from `dist/`. Run `npm run build:js` (or `npm run build`) before running them.

## Review Focus

1. **A palette with repeated entries** (two threads with the same RGB). Expected: `indices` are k *distinct* positions, and `palette` repeats the colour. Test in Task 1.
2. **k equal to the palette's entry count.** Expected: `indices` is `[0, 1, …, t-1]` and `palette` equals the input. Test in Task 1.
3. **The palette array changed right after the call** (CLAUDE.md "validate and take bytes before awaiting"). Expected: the result is the same as with the array left alone. Test in Task 1, alongside `test/inputs.test.js`.
4. **A `Palette` tagged `'oklab'` passed as the chart.** Expected: by default the snap and the scoring are still RGB, and the result is identical to passing the same bytes untagged. Test in Task 1.
5. **A bad argument together with an already-aborted signal** (on the main entry and on a loaded handle). Expected: the argument error wins, as in every other function (`test/validation-order.test.js`). Tests in Task 1 and Task 4.

---

### Task 1: `clustering.chooseFrom` on the main entry

**Files:**
- Create: `src/choose.js`
- Modify:
  - `src/index.js`: add the `chooseFrom` engine function next to `cutSwatches` and add it to `setEngine` (line 1094).
  - `src/shared.js:395-443`: add to `methodNames` and `methods`.
  - `src/index.d.ts`: add the method on `class Clustering` and the interfaces `ChooseOptions` and `PaletteChoice`.
  - `docs/api.md`: add an entry under "Clustering methods".
  - `CHANGELOG.md`: start a `## 3.8.0` section with `### Added`.
- Test:
  - `test/choose-from.test.js` (new).
  - `test/methods-worker-only.test.js`: chooseFrom rejects there with `wasm-load-failed`.
  - `test/inputs.test.js`: mutating the palette after the call.
  - `test/validation-order.test.js`: a bad k with an aborted signal.
  - `test/types/main.mts`.
  - `test/api/*.snap.txt`.

**Interfaces:**
- Produces (`src/choose.js`):
  ```js
  // Positions in `entries`, in search order (unsorted), exactly k of them.
  export async function choose(
    { cut, swatches, snap, pause },   // cut(k) → Promise<Uint8Array>; swatches() → Promise<{palette, weights}> (the 1024 cut);
                                      // snap(colours) → Promise<ArrayLike<number>> (nearest entry per colour, RGB);
                                      // pause() → Promise<void> (checks the signal, and yields if one was given)
    entries,                          // Uint8Array, 3 bytes per entry, an untagged copy
    k,                                // whole number, 1..entries.length/3 (already checked)
    space,                            // 'rgb' | 'oklab'
  ): Promise<number[]>
  ```
- Produces (engine, `src/index.js`): `chooseFrom(name, clustering, palette, k, options) → Promise<PaletteChoice>`. `name` is used in messages, as with `cut`.
- Produces (types): `ChooseOptions { colorSpace?: ColorSpace; signal?: AbortSignal }` and `PaletteChoice { indices: number[]; palette: Palette }`, exported from `index.d.ts`. `worker.d.ts` re-exports them.

- [ ] **Step 1: Write the failing tests in `test/choose-from.test.js`.** Use a 64×48 synthetic photo and the seeded 120-thread chart from `test/recipes.test.js:409-413`.
  - `'returns exactly k distinct positions, ascending, and their colours'`: for k in 4, 8, 12, `indices.length === k`, they are distinct and strictly ascending, and `palette` equals `indices.flatMap(j => threads.slice(3j, 3j+3))`.
  - `'tags the result palette rgb, even after scoring in oklab'`: `result.palette.colorSpace === 'rgb'` for both values of `colorSpace`, and `result.palette instanceof Palette`.
  - `'fills to k on an image with fewer colours than k'`: a 3-colour image with k = 5 gives 5 indices.
  - `'gives the first k entries for an empty image'`: on the header-only clustering of a fully transparent image, `indices` equals `[0, 1, …, k-1]`.
  - `'k equal to the entry count returns every entry'` (Review Focus 2).
  - `'repeated entries give distinct positions'` (Review Focus 1): use a chart where entries 3 and 7 are the same colour.
  - `'an oklab-tagged chart scores in rgb by default'` (Review Focus 4): wrap the chart as `new Palette(bytes, 'oklab')` (the construction `test/methods.test.js` uses). The result must deep-equal the result for the plain bytes.
  - `'the same with and without a signal'`: `{ signal: new AbortController().signal }` gives the same result as no options, in both spaces.
  - `'an aborted signal rejects with its reason'`.
  - `'errors'`, each with `{ code: 'invalid-argument', argument }`:
    - An empty palette, and one of 7 bytes, on `'palette'`.
    - k = 0, 2.5 and `'4'` on `'k'`.
    - k = 121 on `'k'`, with the exact message `"Invalid k: 121 is more than the 120 entries in the palette; use 120 or fewer."`.
    - `colorSpace: 'lab'` on `'options.colorSpace'`.
    - `{ onProgress() {} }` and `{ dither: true }` rejected as unknown options.
    - A `Clustering` passed as the palette, on `'palette'`.
  - `'is a method: non-enumerable, never throws synchronously'`: `chooseFrom` called with `this` undefined returns a rejected promise with `invalid-clustering`.

  Add to the other files:
  - `test/methods-worker-only.test.js`: `chooseFrom` rejects with `wasm-load-failed`, and the message names `worker.load`.
  - `test/inputs.test.js`: fill the palette with zeros right after the call. The result equals the unmutated call's (Review Focus 3).
  - `test/validation-order.test.js`: k = 0 with an aborted signal rejects on `'k'` (Review Focus 5).

- [ ] **Step 2: Run the tests to see them fail.**
  Run `npm run build:js && npx vitest run test/choose-from.test.js test/methods-worker-only.test.js test/inputs.test.js test/validation-order.test.js`.
  Expected: they FAIL with "chooseFrom is not a function" (or undefined).

- [ ] **Step 3: Implement `choose` in `src/choose.js`.** The algorithm, in order:
  1. **Snap.** The guides' `chooseThreads` as of 3.7.2 (`docs/guides.md:497-507`): for c = k … 4k, while fewer than k are chosen, set `chosen = [...new Set(await snap(await cut(c)))].slice(0, k)`.
  2. **Fill.** If `chosen.length < k`, add entries one at a time. Each time, add the unchosen entry j (ascending) whose addition gives the strictly lowest `Σ wᵢ·min(nearestᵢ, d(j,i))` over the swatches, measured in `space`. Ties go to the lower j. With no entry chosen yet, `nearestᵢ` is `Infinity`.
  3. **Swap.** The guides' `improveThreads` as of 3.7.2 (`docs/guides.md:511-556`), verbatim in its arithmetic: the same distance table, the same `current * (1 - 1e-9)` threshold, the same loop order and strict `<`. The only additions are calls to `await pause()` before each pass and after every 64 candidate entries j.
  4. **Coordinates.** Move `coordinates(rgb, space)` (`docs/guides.md:571-585`) in unchanged.

  Then implement `chooseFrom` in `src/index.js`. Before any `await`, it must:
  - check the palette with `checkPalette`, and reject a `Clustering` on `'palette'`;
  - copy the palette to a plain `Uint8Array`;
  - check k against `t = length / 3`, using the pinned message for k > t;
  - check the options with `parseOptions(options, ['colorSpace', 'signal'])`, or whatever form `parseOptions` takes for an allowed-key list.

  Then it runs `choose` with:
  - `cut` = `cutPalette`;
  - `swatches` = `cutSwatches(…, 1024)`;
  - `snap` = `quantizeToIndicesWithPalette({ data, format: 'rgb' }, copy, { colorSpace: 'rgb' })`, returning `.indices`;
  - `pause` = `checkAborted`, then `yieldNow()` when a signal was given.

  It returns `{ indices: sorted ascending, palette: markPalette(entries at indices, 'rgb') }`.

  Finally:
  - In `shared.js`, add `chooseFrom: ['chooseFrom(palette, k, options?)', "a loaded handle's chooseFrom: (await worker.load(clustering)).chooseFrom(palette, k)"]` to `methodNames`. Add the method, which forwards to `receive('chooseFrom', this).chooseFrom('clustering.chooseFrom', this, palette, k, options)`. Adjust the `wasm-load-failed` message so it reads correctly for a method with no function form.
  - Write the types, with the spec's doc comments copied verbatim (spec lines 92-106).
  - Add the `docs/api.md` entry `### \`clustering.chooseFrom(palette, k, options?): Promise<PaletteChoice>\``, with an `Options:` list of `colorSpace` and `signal`. It says "fixed palette", "a good choice, not always the best one", that `indices` are ascending and not ranked, that the palette is tagged `'rgb'`, and that `colorSpace` doesn't follow the clustering. It links the guides' section.
  - Add the CHANGELOG line.

- [ ] **Step 4: Run the tests, then the API checks.**
  Run `npm run build:js && npx vitest run test/choose-from.test.js test/methods-worker-only.test.js test/inputs.test.js test/validation-order.test.js test/api.test.js test/methods.test.js`, then `npm run test:types`.
  Expected: PASS. `api.test.js` fails only on the snapshot. Review that diff, then accept it with `npx vitest run test/api.test.js -u`.

- [ ] **Step 5: Commit:** "Add clustering.chooseFrom: choose k entries of a fixed palette".

### Task 2: Parity with the 3.7.2 recipe, and golden hashes

**Files:**
- Create: `test/reference/fixed-palette-recipe.js`. It holds `chooseThreads`, `improveThreads` and `coordinates`, copied verbatim from `docs/guides.md:497-585` as of 3.7.2. They take `{ getPaletteFromClustering, getSwatchesFromClustering, quantizeToIndicesWithPalette }` as a parameter, so the guides can drop them.
- Create: `test/visual/choose-from-kodak.test.js`.
- Modify: `test/golden.test.js`, `test/golden.json` (new keys only).

**Interfaces:**
- Consumes: `clustering.chooseFrom` (Task 1); `PALETTES` from `bench/spikes/fixed-subset.js` (charts `threads`, 584 entries, and `dense`, 1000 entries); `KODAK_IMAGES`, `ensureImage` and `getImageRgba` from `fixtures/kodak.js`.
- Produces: `export function recipe(entry) → { chooseThreads, improveThreads }`, which `test/recipes.test.js` reuses in Task 6.

- [ ] **Step 1: Write the failing test** `'chooseFrom matches the 3.7.2 recipe on the 24 Kodak photos'`. For each photo, it clusters once in RGB. For each chart in threads and dense, each n in 6, 12, 24 and 40, and each space in rgb and oklab:
  - Compute `ref = improveThreads(c, chart, await chooseThreads(c, chart, n), space)`.
  - If the snap gave n entries, `expect((await c.chooseFrom(chart, n, { colorSpace: space })).indices).toEqual([...ref].sort((a, b) => a - b))`.
  - Otherwise, count the case and expect the count to be 0 on these photos. Print it in the failure message so a change in this is visible.
  - Use `timeLimit(300_000)`.

  In `test/golden.test.js`, add to `'clusterings and palettes'` the keys `${name}/chooseFrom/rgb/12` and `${name}/chooseFrom/oklab/12`. They use a seeded 200-entry chart (the same LCG as `test/recipes.test.js:412`, seed 11) on the RGB clustering. Hash `new Uint8Array([...new Uint8Array(Uint16Array.from(indices).buffer), ...palette])`.

- [ ] **Step 2: Run** `npx vitest run test/visual/choose-from-kodak.test.js`.
  Expected: PASS at once if Task 1 was faithful. If any case differs, fix `src/choose.js`, never the reference.

- [ ] **Step 3: Write the golden hashes:** `UPDATE_GOLDEN=1 npx vitest run test/golden.test.js`. Then check `git diff test/golden.json`: it may only add the new `chooseFrom` keys.

- [ ] **Step 4: Run** `npx vitest run test/golden.test.js`. Expected: PASS.

- [ ] **Step 5: Commit:** "Test chooseFrom against the 3.7.2 recipe on Kodak; golden hashes" (the message says the golden file gained new keys only).

### Task 3: One handle builder in the worker entry; `chooseFrom` on image handles; the converse wrong-shape error

**Files:**
- Modify:
  - `src/worker.js:586-653`: move the handle object's construction out of `cluster()` into `makeHandle(id, kind, output)`, where `kind` is `'image' | 'clustering'`.
  - `src/worker-thread.js`: add `handleChooseFrom` to the methods and `handleChooseFrom: 3` to `optionsIndex`.
  - `src/worker.d.ts`: add `chooseFrom` on `ClusteringHandle`.
  - `docs/api.md` "Worker entry".
- Test: `test/worker.test.js`, `test/worker-cancel.test.js`, `test/types/worker.mts`.

**Interfaces:**
- Consumes: the engine's `chooseFrom`, through the thread's `ac` import: `handleChooseFrom: (id, palette, k, options) => handle(id).clustering.chooseFrom(palette, k, options)`. The stored clustering is the library's own, so it has the methods.
- Produces: `makeHandle(id, kind, output)`, which returns the handle object. For both kinds it has the cuts, `chooseFrom`, `release` and `Symbol.asyncDispose`, and it registers with `reclaim`. For `'image'` it also has `getClustering`, `quantize(k, o)`, `quantizeToIndices(k, o)` and the `…WithPalette` methods, exactly as today. Task 4 adds the `'clustering'` mapping methods.

- [ ] **Step 1: Write the failing tests.**
  - `test/worker.test.js`, `'handle.chooseFrom equals clustering.chooseFrom'`: in both spaces, `(await handle.chooseFrom(chart, 8, o))` deep-equals `await clustering.chooseFrom(chart, 8, o)` for the main-entry clustering of the same image. The returned palette is a `Palette` tagged `'rgb'`.
  - `'handle.chooseFrom errors match the main entry'`: the same cases as Task 1's `'errors'`, comparing `code`, `argument` and `message`.
  - `'an image handle given an image for k says so'`: `handle.quantize(image, 4)` rejects with `invalid-argument` on `'k'`. The message matches `/this handle holds an image \(from worker\.cluster\).*worker\.load/`. The same applies to `quantizeToIndices`. "An image" means a `Uint8Array`, an ImageData, or an object with `data`.
  - `test/worker-cancel.test.js`: an aborted signal on `handle.chooseFrom` rejects with its reason.
  - `test/types/worker.mts`: add `handle.chooseFrom(threads, 12)` returning `Promise<PaletteChoice>`, and a `// @ts-expect-error` line for `handle.quantize(image, 4)`.

- [ ] **Step 2: Run** `npm run build:js && npx vitest run test/worker.test.js test/worker-cancel.test.js`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement.**
  - Refactor `cluster()` to call `makeHandle(id, 'image', rebuild(image))`. Its behaviour stays the same: the existing worker tests pass before any new method is added.
  - Add `chooseFrom(palette, k, options)`. It goes through `withControls`, which takes only the signal (no `onProgress`), so the thread sees and rejects anything else exactly as the main entry does.
  - Add the k-is-an-image check on the image handle's `quantize` and `quantizeToIndices`. The message is `"Invalid k: this handle holds an image (from worker.cluster) and maps it with quantize(k); pass k, not an image. To map other images with a stored clustering, use worker.load(clustering)."`.
  - Update the docs and types.

- [ ] **Step 4: Run** `npx vitest run test/worker*.test.js test/api.test.js && npm run test:types`. Expected: PASS. Update the API snapshot after reviewing it.

- [ ] **Step 5: Commit:** "Worker handles: one builder, chooseFrom, a clearer error for an image passed as k".

### Task 4: `worker.load(clustering)` and `LoadedClusteringHandle`

**Files:**
- Modify:
  - `src/worker.js`: add `instance.load`, and the `'clustering'` kind in `makeHandle`.
  - `src/worker-thread.js`: add `load`, `handleQuantizeImage` and `handleQuantizeToIndicesImage`, and `optionsIndex` entries `handleQuantizeImage: 3` and `handleQuantizeToIndicesImage: 3`.
  - `src/worker.d.ts`: add `load` on `AgglomerativeWorker` and the shared worker's exports (whatever form `cluster` has there), and the `LoadedClusteringHandle` interface (spec lines 60-76, with doc comments).
  - `docs/api.md` "Worker entry": add `load` and a two-row table, "`cluster(image)` keeps the image, maps it with `quantize(k)`" and "`load(clustering)` keeps only the clustering, maps with `quantize(image, k)`".
  - `CHANGELOG.md`.
- Test: `test/worker-load.test.js` (new), `test/worker-lifetime.test.js`, `test/types/worker.mts`, `test/types/disposable.mts`.

**Interfaces:**
- Consumes: `makeHandle` (Task 3); `readHeader`, `own`/`take`/`send`, `pixelBuffers`, `rebuild`, `bareImageWarning`/`warnOnce` and `takeControls`, all already in `worker.js`.
- Produces:
  - Wire calls: `load(id, clusteringBytes)` → the thread stores `{ clustering: new ac.Clustering(bytes) }`.
  - `handleQuantizeImage(id, image, k, options)` → `ac.quantizeFromClustering(image, handle(id).clustering, k, options)`.
  - `handleQuantizeToIndicesImage(id, image, k, options)` → the indices form, likewise.
  - The loaded handle's methods: `getPalette`, `getSwatches`, `getClusteringInfo`, `quantize(image, k, o)`, `quantizeToIndices(image, k, o)`, `chooseFrom`, `release` and `Symbol.asyncDispose`. It has no `getClustering` and no `…WithPalette`.

- [ ] **Step 1: Write the failing tests in `test/worker-load.test.js`.**
  - `'matches the deprecated function forms byte for byte'`. For an RGBA image with transparent pixels, clustered once with `{}` and once with `{ colorSpace: 'oklab' }`:
    - `getPalette(k)`, `getSwatches(k)`, `getClusteringInfo()`, `quantize(img, k, o)` and `quantizeToIndices(img, k, o)` equal `worker.getPaletteFromClustering` … `worker.quantizeToIndicesFromClustering`.
    - k is 4 and 16, and o is `{}`, `{ transparent: true }`, `{ colorSpace: 'rgb' }` and `{ dither: true, width }`.
    - `quantize` returns the input's type for a bare `Uint8Array`, `ImageData` and `{ data, format: 'rgb' }`.
  - `'rejects a damaged clustering, a palette or an image before posting'`: each rejects with `invalid-clustering` on `'clustering'`. A spy on the thread's message count shows nothing was posted.
  - `'takes the bytes at the call'`: zero the clustering right after `load(...)`. The cuts are unchanged. Also run this before the worker has started.
  - `'extra arguments to load are an error'`: `load(c, {})` rejects with `invalid-argument` on `'options'`.
  - `'a number where the image goes says what the handle holds'`: `loaded.quantize(4)` rejects on `'image'` with the exact message `"Invalid image: this handle holds a clustering, not an image (from worker.load); pass the image, then k."`. The same holds for `quantizeToIndices`.
  - `'signal and onProgress work on its mapping methods'`: an aborted signal rejects with its reason, and onProgress ends at 1. Review Focus 5: `loaded.quantize(image, 0, { signal: aborted })` rejects on `'k'`.
  - `'release, await using, and calls after release'`: after `release()` every method rejects with `invalid-handle`. `await using` releases at the end of the block.
  - `'chooseFrom on a loaded handle equals clustering.chooseFrom'`.
  - `test/worker-lifetime.test.js`: a dropped loaded handle is reclaimed. It follows the existing image-handle test.
  - Type tests:
    - `loaded.quantize(image, 4)` types as the image's result type.
    - `// @ts-expect-error loaded.quantize(4)`.
    - `// @ts-expect-error loaded.getClustering()`.
    - `await using` in `disposable.mts`.

- [ ] **Step 2: Run** `npm run build:js && npx vitest run test/worker-load.test.js test/worker-lifetime.test.js`. Expected: FAIL (`load` is not a function).

- [ ] **Step 3: Implement `instance.load(clustering, ...extra)`.**
  - It validates synchronously inside a try that returns a rejected promise:
    - extra arguments → `invalid-argument` on `'options'`;
    - not a `Uint8Array` → `invalid-clustering`;
    - otherwise `readHeader(clustering)`.
  - It copies the bytes, or moves them with `transfer`, through the same path a clustering argument takes today.
  - It counts `liveHandles` and invokes `load`. On failure it releases the id, as `cluster()` does.
  - It returns `makeHandle(id, 'clustering')`.

  The loaded handle's mapping methods follow the `imageFunctions` loop in `worker.js:527-554`:
  - the number-as-image check first;
  - `takeControls`;
  - the aborted path, which checks arguments with `{check: true}` and then throws the reason;
  - the bare-image warning;
  - `send`/`take`, and `pixelBuffers`;
  - `rebuild(image)(result)` for `quantize`.

  Then:
  - Add the thread methods and `optionsIndex` entries.
  - Update the types and docs. The docs show `await using loaded = await worker.load(c)` as the replacement for one-off `worker.getPaletteFromClustering(c, k)`.
  - Add `load` to the shared-worker exports if `cluster` is one of them.

- [ ] **Step 4: Run** `npx vitest run test/worker*.test.js test/api.test.js && npm run test:types`. Expected: PASS. Update the snapshot after reviewing it.

- [ ] **Step 5: Commit:** "Add worker.load(clustering): a handle for a stored clustering".

### Task 5: Deprecate the five `…FromClustering` functions

**Files:**
- Modify:
  - `src/index.d.ts` and `src/worker.d.ts`: add `@deprecated` to `getPaletteFromClustering`, `getSwatchesFromClustering`, the function `getClusteringInfo(clustering)`, `quantizeFromClustering` and `quantizeToIndicesFromClustering`. Each doc line names the method and the loaded-handle replacement, as in the spec's table at lines 124-130.
  - `src/worker.d.ts:16`: the header comment stops recommending `…FromClustering`.
  - `docs/api.md`:
    - line 305: "Moving existing code to the methods is optional" becomes a deprecation note with the spec's table;
    - the five entries move under a "Deprecated" heading, as the `get…` names did in 3.4.0;
    - the `Options:` lists are kept.
  - `README.md:99-111`: drop the function forms from the brackets and footnote ¹, add a `chooseFrom` row, and point off-thread users at `worker.load`.
  - `docs/migrating.md`: add a "3.8: `…FromClustering` → methods and `worker.load`" section with the table.
  - `CHANGELOG.md` `### Deprecated`.
  - `CLAUDE.md`: in the architecture lines on handles and methods, mention `load` and `chooseFrom`.
- Test: `test/api.test.js` (its doc checks), and `test/types/*` still compiling.

- [ ] **Step 1: Write the failing test.** In `test/api.test.js`, add `'the …FromClustering functions are deprecated in both entries'`. It reads `src/index.d.ts` and `src/worker.d.ts`, and expects a `@deprecated` tag in the doc comment of each of the five declarations. Each tag must name the replacement: it matches `/clustering\.\w+\(/` and `/worker\.load/`.

- [ ] **Step 2: Run** `npx vitest run test/api.test.js`. Expected: FAIL.

- [ ] **Step 3: Add the tags and the docs changes listed above.** No source `.js` changes.

- [ ] **Step 4: Run** `npm run build:js && npx vitest run test/api.test.js && npm run test:types`. Expected: PASS, with the snapshot unchanged (comments are stripped).

- [ ] **Step 5: Commit:** "Deprecate the …FromClustering functions in both entries".

### Task 6: Guides and recipes move to the methods and handles

**Files:**
- Create: `bench/spikes/choose-from/count-slider.mjs` and its `results-count.txt`. They time the counting pass `quantizeToIndicesWithPalette(image, result.palette)` plus the count, on kodim23 upscaled (nearest) to 4240×2832 (12 MP), at 12 and 40 entries, undithered and dithered. Report the median of 5 runs, and the same at a 1 MP downscale.
- Modify:
  - `docs/guides.md:479-586`: replace `chooseThreads`/`improveThreads` with `clustering.chooseFrom`, keeping the heading words "Choosing N colours from a fixed set" and the measured bullets (quality, which space, speed), reworded for the method.
  - The same section: shorten `countThreads(image, threads, choice, options)` to map with `choice.palette`, count, and return `{ thread: choice.indices[s], count }`. Keep its dithering and `transparent` notes.
  - The same section: add the slider-cost sentence with its sourced figures. Advise a downscaled image for the live legend when the 12 MP pass is slow.
  - The rest of `docs/guides.md`: `sizeForError`, `rankSwatches`, the frame mapper and the workers/pool recipe use `clustering.…` or a loaded handle instead of `…FromClustering`.
  - `test/recipes.test.js`:
    - The guides-source equality check (line 405) covers the new `countThreads` and the other changed recipes.
    - The `chooseThreads`/`improveThreads` tests switch to `test/reference/fixed-palette-recipe.js`, or are deleted where `test/choose-from.test.js` covers them.
    - The worker-entry test at lines 495-510 uses a loaded handle.
- Test: `test/recipes.test.js`, and `test/api.test.js`'s docs checks (links, anchors, removed names).

- [ ] **Step 1: Update `test/recipes.test.js` first** to the new recipes' sources and expectations:
  - `countThreads(image, threads, await clustering.chooseFrom(threads, 3), { transparent: true })` keeps the expected counts at line 466.
  - Every recipe that called a `…FromClustering` function now calls the method.

- [ ] **Step 2: Run** `npx vitest run test/recipes.test.js`. Expected: FAIL, because the guides' sources differ.

- [ ] **Step 3: Write the guides changes. Run the spike** with `node bench/spikes/choose-from/count-slider.mjs > bench/spikes/choose-from/results-count.txt`, and cite it in an HTML comment.

- [ ] **Step 4: Run** `npm run build:js && npx vitest run test/recipes.test.js test/api.test.js`. Then `grep -n "FromClustering" docs/guides.md README.md` must show only text that names the deprecated functions as deprecated. Expected: PASS.

- [ ] **Step 5: Commit:** "Guides: chooseFrom replaces the fixed-palette recipe; recipes use methods and worker.load".

### Task 7: Browser check, and the whole suite

**Files:**
- Modify: `test/browser/app/main.js`. Add the check `loadAndChooseFrom`, gated like `buildNamesAreTheSameFunctions` (`typeof worker.load !== 'function' || …`), so the published-package job still passes against 3.7.x. It checks two things:
  - `(await worker.load(clustering)).getPalette(8)` equals `clustering.getPalette(8)`;
  - `loaded.chooseFrom(chart, 6)` equals `clustering.chooseFrom(chart, 6)`.
- Modify: `test/browser/run.mjs`, if checks are listed there.

- [ ] **Step 1: Add the check, and run** `npm run build && CHROMIUM_PATH=… npm run test:browser`. Expected: every check is `true` in Vite, webpack and Parcel.

- [ ] **Step 2: Run the whole suite:** `npm test && npm run test:types`. Expected: all pass. Write the output to a file and report the pass count.

- [ ] **Step 3: Run** `scripts/asan-test.sh` (about 8 minutes). Expected: every test passes with no reports.

- [ ] **Step 4: Commit:** "Browser check for worker.load and chooseFrom".

- [ ] **Step 5: Final branch review** (CLAUDE.md "In the final branch review"):
  - Write `git diff master...HEAD` to a file.
  - Run the three stewards and `user-advocate` on Sonnet, in parallel, with the code reviewer.
  - Publish the findings to the user as an artifact page.
  - Open the PR with no Claude trailers. The user merges it, and releasing 3.8.0 waits for their go-ahead.
