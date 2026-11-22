# Value brief: reusing ordered-dithering recipes across frames (ROADMAP "Next" item 6)

Measurements: `bench/spikes/recipe-reuse/` (README, `batch-recipe.mjs` and `results-batch-recipe.txt` for the recipe, `measure.mjs` and `results.txt` for the built-in prototype `persist.patch`). Five 3-second Sintel trailer scenes (real film) and two clips made from Kodak photos whose pixels repeat exactly (a pan, a still photo with a moving region), 36 frames each at 480×270 and 160×90; palettes of 255 and 16 RGB colours cut as docs/guides.md "Animated GIFs" does, and black and white.

## Who asked

No person. The item came from the 3.1 exploratory round, which found ordered dithering slow on many-colour images (documented in docs/api.md "Speed"). For this brief, two exploratory-round agents (2026-11-23) built their project from the README and `docs/` only, before hearing of the feature:
- **A Node "clip to GIF" CLI for a chat app** (film clips): 0.5–3.2 s per 3-second clip at 255 colours; "acceptable, not snappy". Workers or `steps: 8` each gave about 2×. "If none shipped: I wouldn't really mind."
- **A browser extension exporting screen recordings as GIFs and to e-ink** (mostly still frames, in a worker): about 66 s for 20 s at 960×540, "the difference between a usable button and a broken one". "Ordered is the method the docs recommend for exactly my use case, and it is the slow one." It found and used the recipe below from the docs' note that the pattern starts at each image's top-left pixel (4–5× on its clip), and asked for it in the guides.

## The symptom

"Exporting an animated GIF with ordered dithering is slow"; "GIF export takes a minute"; "ordered dithering much slower than Floyd–Steinberg". Ordered costs 2.5–7× Floyd–Steinberg and 5–21× undithered at 16–255 colours (20–125× in black and white), because every call builds a recipe for every distinct colour, and a clip's frames share most of their colours.

## The best recipe

**Map several frames in one call.** A pixel's ordered colour depends only on its colour and its position modulo 8, and one call builds each colour's recipe once. Stack frames into one tall image, each padded to a multiple of 8 rows by repeating its last row (no new colours, no transparency), map with one `quantizeToIndicesWithPalette(..., { dither: 'ordered' })`, and slice the indices back. 20 lines (`mapFramesOrdered` in `batch-recipe.mjs`); indices byte-identical to one call per frame (checked on every frame, clip, palette and batch size).

Whole clip, against one call per frame (lower is better):

| | batch of 6 | 12 | whole clip (36) | built-in prototype |
|---|---|---|---|---|
| Film (5 scenes, both sizes) | 0.47–0.84 | 0.36–0.78 | 0.27–0.69 | 0.30–0.80 |
| Exact repeats (pan, sprite) | 0.21–0.35 | 0.12–0.29 | 0.06–0.24 | 0.08–0.31 |

Traps: forgetting the padding (a 270-row frame then shifts the pattern for every later frame; output is still valid, but no longer frame-stable, which is why ordered was chosen); padding with transparent rows (adds a transparent entry to every frame of the batch); a batch needs its frames in hand and memory for them (12 frames at 960×540 is 25 MB, plus the same again in the WebAssembly heap; a whole long clip in one call can pass the 256 MB at which the module is reloaded). Frames that arrive one at a time (live capture) can't be batched without latency.

## What a built-in adds over it

- **Speed: nothing.** Batching the whole clip matches or beats the prototype everywhere (it also saves the per-call overhead); a batch of 12 is within about 10–20% of it.
- **Quality: nothing.** Output is identical by construction.
- **Convenience:** one object instead of 20 lines and the padding rule; works on frames one at a time (streaming, live capture), where the recipe needs batching and its latency.
- **Costs:** new API for all of 3.x: a stateful object holding 8–32 MB in the WebAssembly heap with a lifetime rule (`close()`/`release()`, or garbage collection), and its worker-entry twin (both agents asked how it would cross the worker boundary). The shapes put to the agents: `preparePalette(palette, options)` was ranked last by both and misread by both (they guessed an index, not a dither cache, and asked what happens with other options); `createFrameMapper(palette, options)` with `.quantizeToIndices(frame)` and `.close()` was preferred by both, options fixed at creation so they can't mismatch. A frame mapper is a second way to map with a palette, beside `quantizeWithPalette`, which the 4.0 table keeps as the one way (ROADMAP "4.0"). PRINCIPLES 4: no state across calls unless worth it on its own.
- **Also found, separate from this item:** a long export has no progress, since `onProgress` doesn't cover mapping (ROADMAP "Larger, later": slicing pixel mapping).

## Recommendation

**Recipe.** Add "Map frames in batches" to docs/guides.md "Animated GIFs and sets of images", with the padding code and its reason, tested in `test/recipes.test.js`: byte-identical to per-frame calls, including a clip with transparent pixels in some frames only (with `transparent: true` the transparent entry and `transparentIndex` then come per batch, not per frame; harmless for a GIF's global palette, and the guide says so). Documenting it makes "the pattern is anchored at each image's top-left pixel and depends only on colour and position modulo 8" a 3.x promise; the guide states it as one. Record a built-in under ROADMAP "Considered", noting that the frame-mapper shape is the one to start from, and what would reopen it: a user whose frames arrive one at a time with a palette fixed across them, for whom batching's latency is unacceptable, shown by a measured per-frame cost (the live-video recipe cuts a palette per frame, which no cache would survive). This also settles ROADMAP "Considered"'s open condition on item 6: `Palette` keeps no methods.

**Review (scope-steward, 2026-11-23):** built-in out of scope, recipe in scope. Test 1 fails (the recipe matches or beats the prototype), test 2 weak (simulated agents only, and the one that needed it used the recipe), 4 fails (state across calls), 5 fails (function, object and worker twin), 6: `preparePalette` misread by both agents; the frame mapper reads cleanly but is a second way to map with a palette, which the 4.0 table rules out. Its three refinements (mixed transparency in the test, the promise stated, the tighter reopening condition) are folded in above.
