# Design: cancelling and progress while mapping (3.7.0)

Value brief: `docs/superpowers/briefs/2026-11-24-recipe-review.md` (part 2), re-reviewed under the feature test revised on 2026-11-24, with the measurements of `docs/superpowers/briefs/2026-11-23-slicing-mapping-brief.md` and `bench/spikes/slicing-mapping/`. Both reviewers of the brief said build (user-advocate: build; scope-steward: keep). It reopens a declined item (PRINCIPLES "Declined so far", ROADMAP "Considered": "No person asked; it fails PRINCIPLES tests 1 and 2"). The new evidence is the revised feature test (PR #56, which must merge first) and the recipe costs the re-review counted. **Test 2 needs the maintainer's own words for the feature and its use case, quoted here on approval** (the request so far, "show me what i have to review for mapping", asks for a review); the use case proposed is cancelling and showing progress when mapping large images, dithered especially, on the main thread and through the worker entry.

## Intent

Every function that takes an image accepts `signal`, but the ones that map check it only before they start, and in the worker entry a cancelled mapping keeps running in the thread while the calls queued behind it wait (docs/api.md "Cancelling and progress" says "In a worker the work in the worker stops too", which is wrong for mapping). `onProgress` is accepted by the functions that cluster and rejected by those that only map. Mapping a 6.3 MP photo to 256 colours takes 2.6 s with Floyd–Steinberg and 7.5 s with ordered dithering.

**Goals**
- `signal` takes effect while mapping, within one slice (about 10 ms, as for clustering), in every function that maps, in both entries; in the worker entry the thread stops too, so later calls aren't held up.
- `onProgress` is accepted by every function that takes an image, and the one-shot `quantize` and `quantizeToIndices` report clustering and mapping as one progress.
- Sliced mapping gives exactly one call's output, for every dither method, format and output type (error rows, recipe table and lookup memo carried across slices).
- A call with neither option runs exactly as today: same bytes, same speed. A call with `signal` (or `onProgress`) that finishes inside its first slice never yields, as `clusterInSlices` already does, so small calls with a signal (slider re-maps, animation frames) pay only the job's start and finish.

**Non-goals**
- New functions, options or option values. No `onProgress` on `getPaletteFromClustering`, `getSwatchesFromClustering` or `getClusteringInfo` (they take no image and finish at once).
- Slicing the palette-index build (lazy, per cell) or the k-d tree build separately from the pixels; they happen inside the slices.

**Anti-goals**, failures even if it works:
- Any change in output, sliced or not (golden tests unchanged; sliced compared with one-shot).
- The one-shot path slower by more than noise, or the sliced path by more than about 5% (clustering's figure).
- WebAssembly growth beyond about 6 KB (the module is 82 KB after 3.6.0; measured, and stated in the CHANGELOG).

## Surface

No new names. Behaviour changes, all additive:

| Function | `signal` today | after | `onProgress` today | after |
|---|---|---|---|---|
| `quantizeWithPalette`, `quantizeToIndicesWithPalette` | checked before mapping | checked between slices | rejected (`invalid-argument` with a hint) | accepted |
| `quantizeFromClustering`, `quantizeToIndicesFromClustering`, and the `clustering.quantize` / `clustering.quantizeToIndices` methods | checked before mapping | between slices | rejected | accepted |
| `quantize`, `quantizeToIndices` | clustering sliced, mapping not | both sliced | clustering only, then 1 | clustering and mapping |
| Worker entry: the functions above, and a handle's `quantize`, `quantizeToIndices`, `quantizeWithPalette`, `quantizeToIndicesWithPalette` | caller rejects at once, thread keeps mapping | thread stops at the next slice | rejected on the handle's mapping methods | accepted |

The functions that only cluster (`buildClustering`, `buildPalette`, `buildSwatches`, and the `get…` names) already take both options and don't change.

**One behaviour changes:** a call whose signal aborts during mapping now rejects with the signal's reason; before, the mapping finished and the call resolved. The docs stated the old behaviour as a limitation ("Mapping can't be interrupted", docs/api.md; "a mapping already running finishes", `src/index.d.ts`), so this is not covered by "nothing promised it". It fits a minor release because (a) whether an abort landed before or after the one check was always down to timing, so no caller could rely on "aborted, yet resolved"; (b) in the worker entry the caller already rejects at once, so only the main entry's result changes; (c) rejecting with the reason is the documented contract ("Aborting rejects with the signal's `reason`"), and "can't be interrupted" was a limitation, not a guarantee. It goes under "Changed" in the CHANGELOG in so many words. Proposed for docs/stability.md (maintainer's decision): "How soon an abort takes effect can improve in a minor release."

**Calls that pass only `signal` to a mapping function** take the sliced path from 3.7.0: on large images about 5% slower (to be measured; clustering's figure) and yielding every 10 ms; small calls that finish in one slice don't yield. Stated in the CHANGELOG.

`onProgress` moving from rejected to accepted is additive (docs/stability.md: a rejected input becoming accepted is a minor change).

## Decisions, with the reasons

1. **A mapping job in C, like `ClusteringJob`** (`mapping_job_start / step / result / free`). `map_pixels` becomes a `MappingJob` holding what lives across rows today as locals: the palette index or k-d tree, the lookup memo, the error rows (Floyd–Steinberg two, Atkinson three), the ordered recipe table, and the next row. `step(budget_ms)` maps until the budget is spent. As first specified (superseded, see the change below): checking the clock every 65,536 pixels, dithered methods stopping only at row ends (their state between rows is explicit, the error rows); undithered mapping, one flat loop that needs no width, may stop at any pixel, so a large image passed without `width` is cancellable too. **Changed while building:** stopping only at row ends gave slices of up to 231 ms (ordered dithering, 64 steps, 4096 colours: one row of recipes), so every method now stops at any pixel. The error rows are indexed by column and nothing else is carried between pixels, so it needs no extra state. The clock is read every 16,384 pixels undithered, every 1,024 dithered, and in ordered dithering also after every 64 recipes built (`results-slices.txt`). The existing `_quantize*` exports run the job with an infinite budget, which never reads the clock, so the one-shot path takes the same steps (the rule `_get_clustering` follows since 3.6.0). (Originally: rows were the unit because every method's state between rows is explicit, the error rows; see the change above.)
2. **The JS side reuses the clustering machinery:** `isControlled(o)` (a `signal` or an `onProgress`) sends a mapping through `mapInSlices` (10 ms slices, `yieldNow` between them, `checkAborted` and the monotonic `reporter` each time), as `clusterInSlices` does. Without either option, the existing single calls stay.
3. **Progress in `quantize` and `quantizeToIndices`** is one 0-to-1 progress over clustering then mapping. The split is internal and undocumented, so it can be retuned in any patch: keyed on the dither method and, for ordered, the step count (each doubling of steps about doubles mapping), from measured ratios on the Kodak photos, the 6.3 MP photo and noise, stored with its script, with the spread of ratios reported. The one documented promise stays: approximate, never backwards, ends at exactly 1, and "reported between slices, about every 10 ms; a small image may report only 0 and 1". Today clustering takes 0.9 (or 0.99) and mapping jumps to 1. (Rejected: a single constant split, which stalls for seconds at 0.9 on ordered dithering with many steps.)
4. **The worker entry** already injects an AbortSignal and a progress poster into the options in the thread (`optionsIndex`); once mapping is sliced, a cancel message is read between slices and the thread drops the call. `takeControls` stops rejecting `onProgress` for the mapping functions and the handle's mapping methods. The note in `worker-thread.js` that mapping runs "in one piece" goes.
5. **Version: 3.7.0**, a minor: accepted inputs widen and an abort now takes effect where it was ignored.
6. **The guides' recipes:** "Cancelling or showing progress while mapping a large image" is replaced by a short section saying to pass `signal` and `onProgress`; `mapCancellably` and `mapInStrips` leave the guides (and `test/recipes.test.js`; `bench/spikes/slicing-mapping/strips.mjs` keeps its copy), with a line for users of 3.6 and older linking the tagged file (`blob/v3.6.0/docs/guides.md#cancelling-or-showing-progress-while-mapping-a-large-image`). The CHANGELOG tells users who copied them that they can delete them (both keep working). The `invalid-argument` hint for `onProgress` on mapping functions goes (src/index.js), and its comment there.
7. **The test hook for small slices stays internal:** no export, option or type. The tests reach it as the clustering's resume harness does, through a test build of the WebAssembly with a budget of 0, so the API snapshot doesn't change.

## Errors

No new codes. An abort during mapping rejects with the signal's reason (not one of the library's errors), as during clustering. `invalid-argument` for `onProgress` that isn't a function, as today.

## Types

`src/index.d.ts`: `MappingOptions extends ProgressOptions` (was `CancelOptions`), so `onProgress` has one declaration (the settled name, PRINCIPLES "Names"). `CancelOptions` stays exported, documented as the base of `ProgressOptions`. Three comments change: `signal`'s ("a mapping already running finishes"), `ProgressOptions`' ("for the functions that cluster") and `MappingOptions`' ("no `onProgress`: mapping runs in one piece"). `src/worker.d.ts` follows with no edits (it uses `MappingOptions` and `MappingIndexOptions`). `QuantizeOptions = ClusteringOptions & MappingOptions` stays sound (the two `onProgress` members are the same). Nothing in 3.x code stops compiling; the API snapshot (`test/api/*.snap.txt`) changes and is reviewed.

## Docs

- `docs/api.md` "Cancelling and progress": `onProgress` on "every function that takes an image"; the "Slices" bullet says mapping runs in slices too, so the page stays responsive; the bullet "Mapping can't be interrupted" is replaced by mapping's slices (result identical; progress between slices, a small image may report only 0 and 1); "In a worker the work in the worker stops too" becomes true. The options table row for `onProgress` ("clustering") becomes "any call with an image". Each mapping function's `Options:` list gains `onProgress` (checked by `test/api.test.js`).
- `docs/performance.md` "Large images": mapping is sliced too, with the measured longest slice; several sliced calls on the main thread can hold their images in the heap at once (`retireIfLarge` covers it, as for clustering).
- `docs/guides.md`: the mapping section above, shortened; "Workers" (the paragraph saying "a call already mapping finishes: mapping runs in one piece" and the `running`/`wanted` render loop built around it) rewritten: aborting the stale call stops it within a slice, and the loop stays only as a way to skip wasted work, if at all.
- docs/stability.md: the proposed sentence above, if the maintainer agrees.
- CHANGELOG 3.7.0: "Added" (`onProgress` on mapping; `signal` honoured while mapping, in both entries), "Changed" (an abort during mapping now rejects; calls with only `signal` sliced), the docs fixes (api.md's worker sentence was wrong for mapping until now), the recipes' removal, and the WebAssembly size before and after.

## Record edits, in the same change

- PRINCIPLES "Declined so far": remove "sliced pixel mapping, with `signal` and `onProgress` taking effect while mapping …", citing the maintainer's request and the revised test.
- ROADMAP: remove the "Considered" entry "Slicing pixel mapping, built in"; add item 11 under "Next", "released as 3.7.0", with the measured longest slice, speed and size, and one sentence on the rejected alternative (strips of rows and a worker of its own: seams with error diffusion, up to 4% and 7% more error at strip edges, ordered up to 40% slower) so the reasons survive; update "All ten are done"; update item 1's pointer to the guides' mapping recipes.
- ROADMAP "Smaller WebAssembly, further": the size before and after (baseline: `dist/clustering.wasm` of the 3.6.0 release, 82,405 bytes).

## Tests

- Sliced equals one-shot, byte for byte, for every dither method (none, Floyd–Steinberg, Atkinson, ordered at several step counts), RGB and OKLab matching, RGBA/RGB/BGRA/BGRX input, ImageData and `{ data, format }` input with their result types (ImageData stays ImageData), colour and index output, with and without `transparent`, small and large palettes (index and k-d tree), widths of 1, very wide images and images passed without `width`, with slices forced small (decision 7).
- A small call with `signal` that finishes in one slice doesn't yield (checked with a microtask counter, as for clustering).
- A resume harness under ASan and UBSan with a budget of 0, as `bench/spikes/slicing-build/resume.mjs`.
- An abort during mapping rejects with the reason, for each function, the `Clustering` methods and the worker's functions and handle methods; a call queued behind a cancelled mapping in the shared worker starts within a slice.
- Progress: monotonic, ends at 1, called more than once on a large image, for each function, including the worker's handle methods with `onProgress` (ImageData crossing the worker comes back as ImageData).
- Golden tests unchanged.

## Measurements to pass, stored in `bench/spikes/slicing-mapping/`

- Longest slice while mapping, on the 6.3 MP photo and 4 MP of noise, every method, with 16, 256 and 4096 colours (the k-d tree and the index are built inside the first slice) (target: tens of ms, like clustering).
- One-shot mapping time against 3.6.0: within noise.
- Sliced mapping time against one-shot: within about 5%, on the large images and on small ones (64×64, a 768×512 photo, a 960×540 frame, each with and without `signal`, in both entries).
- The progress split's ratios and their spread (decision 3).
- WebAssembly size: before and after (baseline 82,405 bytes, 3.6.0's `dist/clustering.wasm`).

## 4.0

Nothing deferred.

## Unchanged

Results, errors, the clustering format, the functions that don't take an image, the one-shot path's speed.

## Approval

Approved by the maintainer on 2026-11-24, answering the six decisions on the review page: "1. yes im fine to proceed 2. we can do this as 3.7.0 3. sure we can add that line. 4. i think that makes sense. 5 ok. 6. yes let's do that." Decision 1 confirmed the request and its use case (cancelling and showing progress when mapping large images, dithered especially, on the main thread and through the worker entry), which passes test 2; PR #56 was merged first.

## Review history

Spec reviewed 2026-11-24 by api-steward (concerns; one conflict: the PRINCIPLES "Declined so far" line, now in "Record edits"), roadmap-steward (concerns: record edits, PR #56 first, test 2's quote), scope-steward (in scope: small-call cost, progress split, test hook) and user-advocate (build: four docs places, no-width slicing, ImageData and worker tests). All findings are folded in above; the compatibility argument was rewritten after api-steward showed the docs had stated the old behaviour.
