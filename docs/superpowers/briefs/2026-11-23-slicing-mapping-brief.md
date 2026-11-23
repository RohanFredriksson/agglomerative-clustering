# Value brief: cancelling and progress while mapping pixels (ROADMAP "Larger, later": slicing pixel mapping)

Measurements: `bench/spikes/slicing-mapping/strips.mjs`, output in `results-strips.txt`. A 6.3-megapixel photo (kodim23 scaled 4× with bilinear filtering) and 4 MP of noise, palettes of 16 and 256 colours cut at `precision: 6`, through `dist/`.

## Who asked

No person. One exploratory-round agent (2026-11-23, the screen-recording extension in the recipe-reuse brief) exporting 20 s of 960×540 frames: "a minute after pressing Export GIF is too long … I would need a progress bar, and `onProgress` doesn't cover mapping". The library's own error for `onProgress` on a mapping function says those functions "finish in milliseconds".

## The symptom

"Can't cancel `quantizeWithPalette`"; "no progress for dithering a large image"; "`onProgress` rejected on quantizeToIndicesWithPalette". Mapping is not milliseconds at large sizes: on the 6.3 MP photo, 256 colours took 0.2 s undithered, 2.6 s with Floyd–Steinberg and 7.5 s ordered; 4 MP of noise took 14.7 s ordered. A `signal` is checked only before mapping starts, so an abort waits for all of it.

## The best recipe

**Map in strips of rows**, checking the signal and reporting progress between them (`mapInStrips` in `strips.mjs`, 15 lines; a strip is a `subarray` of the image, so nothing is copied).

| 6.3 MP photo | one call | strips of 64 rows | longest strip | output |
|---|---|---|---|---|
| 16 colours, none / ordered / Floyd–Steinberg | 112 / 875 / 421 ms | 100 / 1161 / 403 ms | 5 / 55 / 16 ms | same / same / differs |
| 256 colours, none / ordered / Floyd–Steinberg | 203 / 7510 / 2617 ms | 240 / 10381 / 2293 ms | 12 / 537 / 111 ms | same / same / differs |

(4 MP of noise: ordered at 256 colours 14.7 s against 14.8 s, longest strip 0.5 s; undithered at 256 colours 158 ms against 402 ms, the strips' fixed cost per call; the rest under 0.6 s either way.)

- **Exact for no dithering and ordered dithering** (64 rows keeps ordered's 8-row grid, the 3.x promise in docs/stability.md). Ordered pays up to about 40% on photos (+33% at 16 colours, +38% at 256), since each strip builds its own recipes; noise pays about 3%.
- **Floyd–Steinberg and Atkinson give different output** (20 to 42% of pixels), since each strip starts without the error carried from above, and **slightly worse at strip edges**. After a 5×5 blur, the photo's error overall was within −2.3% to +1.4% of one call's (Floyd–Steinberg) and +0.3% to +0.6% (Atkinson); on the rows within 2 of a strip edge it was +0.6% to +4.3% (Floyd–Steinberg, except −4% at 256 colours) and +2.2% to +7.0% (Atkinson), at 4, 16 and 256 colours: a faint seam every strip, worst with Atkinson.
- **Cancelling alone needs no strips:** run the call in a worker of its own and `terminate()` it on abort: the call rejects within 0.3 ms, and a fresh worker costs about 40 ms before its first call (`cancel-worker.mjs`, `results-cancel-worker.txt`, Node). Progress is the only gap with no recipe that keeps error diffusion exact.
- **Traps:** strip heights not a multiple of 8 shift ordered's pattern; the signal is checked between strips, so a strip should stay short (rows × width under about 200,000 pixels kept every strip here under 0.5 s); `quantize` and `quantizeToIndices` (cluster, then map) would need clustering through a `Clustering` and then the strips.

## What a built-in adds over it

- **Exact error diffusion when sliced:** the error rows carry across slices, so Floyd–Steinberg and Atkinson give one call's output, without the recipe's faint seams (+2% to +7% error on edge rows).
- **Speed:** no recipe rebuild per slice for ordered (the recipe's 33 to 38% on photos), and no fixed cost per strip (2.5× on undithered noise at 256 colours, 158 against 402 ms); otherwise equal.
- **Convenience:** `signal` and `onProgress` on every mapping function and through the one-shot `quantize`/`quantizeToIndices` (their clustering is sliced today, their mapping isn't), and in the worker entry, where a cancelled call stops between slices instead of the caller terminating the worker.
- **Costs:** a mapping job in C (start, step, result, free, holding the error rows, the recipe table and the lookup memo across slices) and its JS wiring for six functions and the worker; `onProgress` accepted where it is rejected today (additive, so a minor release, 3.5.0 at the earliest, not 3.4.2); a progress share between clustering and mapping in the one-shot functions; tests that sliced equals one-shot for every method.

## Recommendation

**Recipe now, built-in later if asked.** In the guides, "Cancelling or showing progress while mapping a large image": cancelling through the worker entry and `terminate()` (any method, exact), and progress with `mapInStrips` (exact without dithering and with ordered, strip heights a multiple of 8; with error diffusion, faint seams, measured above). Tested in `test/recipes.test.js`. Correct the "finish in milliseconds" message (`src/index.js`) and docs with these timings: message text isn't promised (docs/api.md "Errors": match on `code`, not on message text), so this fits 3.4.2. Keep the built-in under ROADMAP "Larger, later", with what would bring it forward: a person asking; seams that show in use (low k, smooth gradients, Atkinson); or the strips' overhead hurting someone.

**Review (scope-steward, 2026-11-23):** trim: recipe now, built-in deferred (test 1 fails: the recipe does the job exactly for none and ordered; test 2 weak). Its findings are folded in: Atkinson and 256 colours measured (which showed the edge-row seams the first, 4- and 16-colour Floyd–Steinberg check missed), the table quotes the stored results, and cancelling through the worker is named as the recipe for cancelling alone.
