# Re-review under the revised feature test: fixed-palette subsets and interruptible mapping

The maintainer revised the feature test on 2026-11-24 (PRINCIPLES "Settled decisions": the test weighs both sides) and asked for these two recipe decisions to be weighed again: "let's rerun the [two] decisions over the new rules". Both were measured before; this brief adds no new measurements, only the recipe's costs, which the earlier briefs didn't count. The earlier evidence: ROADMAP "Considered" (both entries), `bench/spikes/fixed-subset.md`, and `docs/superpowers/briefs/2026-11-23-slicing-mapping-brief.md` with `bench/spikes/slicing-mapping/`.

## 1. Choosing N colours from a fixed palette (`chooseThreads` + `improveThreads`)

**Who asked:** the maintainer, for the use case the README names (thread, brick and ink charts); test 2 passes under the revised rule. Before: "Build it if users ask for it" (ROADMAP "Considered").

**The symptom:** "pick the 12 threads out of 400 that best match this photo", "the best 40 bricks from the catalogue", "6 inks out of a pigment set".

**The recipe today** (docs/guides.md, "Fixed palettes"):
- **Length:** two functions, about 50 lines (`chooseThreads` 13, `improveThreads` 36), the second a swap search over 1024 swatches.
- **Quality:** `improveThreads` adds 0.4 to 0.45 dB PSNR at 6 and 12 threads over `chooseThreads`, better on 22 to 24 of 24 photos and worse on none, more with dithering (bench/spikes/fixed-subset.md).
- **Speed:** the guides say 50 ms for 6 of 584 threads, 150 ms for 12, 350 ms for 24 and up to 1.5 s for 40 of 1000, in JavaScript on the calling thread; those figures have no stored source (the spike's table, `bench/spikes/fixed-subset.md`, has 50 / 103 / 189 / 288 ms for its own search from a greedy start). Not yet measured: the guides' functions as written.
- **Traps:** it scores in sRGB, so with very few inks it can make mean ΔE2000 worse, and users mapping in OKLab must compare both choices themselves; it calls `clustering.getSwatches`, which runs on the calling thread with the main entry, so an app that clustered through the worker entry gets `wasm-load-failed` and a large chart needs a Web Worker of the user's own; its result is in no particular order, so a legend needs `rankSwatches` too; it writes out its own metric (weighted squared distance).

**What a built-in adds:** the search in C++ (not measured; and the recipe isn't at its best: `improveThreads` recomputes the whole error for every swap, O(t·N·m) a pass, where a FastPAM-style pass is O(t·m) in about as many lines; build that recipe first, then compare a C++ loop against it); scoring in the call's colour space with the library's own conversion, removing the OKLab trap; the worker entry, `signal` and `onProgress`; positions in the given palette as the result. **Its cost:** two functions (image and clustering forms), a `Clustering` method, a worker handle method, a result type and a C export (the shape in ROADMAP "Considered").

**Under the revised test:** test 1 is open: the recipe is long, writes out its metric, runs on the calling thread and has a colour-space trap and a worker-entry trap, but its speed is unmeasured as written and its strongest version (a fast swap pass) hasn't been built. Tests 3 to 6 passed before. Test 2 needs the maintainer's request for the feature itself, with its use case, not only for this review.

## 2. Interruptible mapping (`signal` and `onProgress` while mapping)

**Who asked:** before, one exploratory-round agent ("a minute after pressing Export GIF is too long … `onProgress` doesn't cover mapping"), exporting 20 s of 960×540 frames, where progress between frames is already a simple loop: a symptom, not proof that one image needs slicing. Test 2 needs the maintainer's request for the feature itself, with its use case.

**The symptom:** "can't cancel `quantizeWithPalette`", "no progress for dithering a large image", "`onProgress` rejected on quantizeToIndicesWithPalette". On a 6.3 MP photo, mapping to 256 colours takes 2.6 s with Floyd–Steinberg and 7.5 s ordered; 4 MP of noise 14.7 s ordered.

**The recipes today** (docs/guides.md, "Cancelling or showing progress while mapping a large image"):
- **Length:** `mapCancellably` (15 lines: a worker of its own, terminated on abort) and `mapInStrips` (20 lines), 35 in all; `quantize` and `quantizeToIndices` need clustering through a `Clustering` first.
- **Quality:** strips are exact without dithering and with ordered dithering; with error diffusion they change 20 to 42% of pixels and leave a faint seam at each strip edge (on the rows next to it, +0.6% to +4.3% error with Floyd–Steinberg at 4 and 16 colours but −4% at 256, and +2.2% to +7.0% with Atkinson; over the whole image within −2.3% to +1.4% of one call). Whether the seams show in use was never checked.
- **Speed:** ordered dithering 33 to 38% slower on photos (each strip rebuilds its recipes); undithered noise at 256 colours 2.5 times slower (158 against 402 ms).
- **Traps:** strip heights must be a multiple of 8 or ordered's pattern shifts; strips must stay short for the signal to be checked often; two recipes for two needs (cancel, progress).
- **An inconsistency in the API itself:** every mapping function accepts `signal` but checks it only before it starts, so an abort waits for all of the mapping; in the worker entry the call rejects at once on the caller's side but the thread runs the mapping to the end, so calls queued behind it wait, and docs/api.md ("In a worker the work in the worker stops too") is wrong for mapping; `onProgress` is accepted by the functions that cluster and rejected by those that map; the one-shot `quantize` and `quantizeToIndices` slice their clustering but not their mapping.

**What a built-in adds:** exact error diffusion across slices (no seams), no per-strip cost, `signal` honoured while mapping and `onProgress` on every function with an image, in both entries. **Its cost:** a mapping job in C (start, step, result, free, carrying the error rows, recipe table and lookup memo), JS wiring for six functions and the worker, `onProgress` accepted where it is rejected today (additive), tests that sliced equals one-shot for every method. No new function or option name: it makes existing options work everywhere they are accepted.

**Under the revised test:** test 1 leans to building (two recipes, progress with error diffusion can't be exact, slower, and the API's own `signal` half-honoured, in the worker entry too); test 5 is at its smallest (no new names); test 4: a C job like the clustering's, WebAssembly growth to be measured. The spec must also settle how `quantize` and `quantizeToIndices` split progress between clustering and mapping, show the path without `signal` or `onProgress` stays byte-identical and as fast, and measure the cost of yields on small calls.

## Recommendation

**Build interruptible mapping** (spec next, with the full review). It adds no names, makes `signal` mean what the API already says, and follows the clustering job already in C. **Measure before deciding the fixed-palette search:** time the guides' functions as written, build the fast swap pass as the strongest recipe, and compare a C++ loop against that. If the speed-up is small, improve the recipe and fix its worker trap in the guides; otherwise build the smaller shape the user-advocate proposed (the clustering form only, with its method and worker function).

**Review (2026-11-24):** `user-advocate`: build mapping; build smaller for the fixed palette, after the C++ measurement; mapping first. `scope-steward`: trim: build mapping, defer the fixed-palette search until the strongest recipe and a C++ loop are measured. Their findings are folded in above (the positions trap was wrong, the speed figures unsourced, the seam figures quoted selectively, the worker-entry traps added).
