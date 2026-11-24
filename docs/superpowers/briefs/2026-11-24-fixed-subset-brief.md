# Value brief: choosing N colours from a fixed palette, built in

ROADMAP "Considered": "Choosing N colours from a fixed palette, built in". It was re-reviewed on 2026-11-24 (`2026-11-24-recipe-review.md`, part 1). That review left two things to measure: the recipe's speed as written, and how much the colour space it scores in matters. This brief measures the second; `bench/spikes/fixed-subset-speed/` covers the first.

## Who asked

The maintainer: "let's look at item 1" (2026-11-24), after the list of open roadmap items, for the use case the README names (thread, brick and ink charts). Under the revised test (PRINCIPLES "Settled decisions") test 2 passes once the maintainer states the use case in their own words. This brief asks for that. Before this, no outside user had asked; the spike came from the roadmap (item 3).

## The symptom

- "Pick the 12 threads out of 400 that best match this photo."
- "The best 40 bricks from the catalogue."
- "6 inks out of a pigment set."
- "Which of my colours should I buy?"
- "The pattern looks wrong with only a few colours."

## The best recipe

The guides' `chooseThreads` and `improveThreads` (docs/guides.md, "Fixed palettes"). They cut the clustering, snap each cut colour to the chart, then run a swap search over 1024 swatches with a fast pass.

- **Length:** 13 + 40 lines as the guides have it. Its strongest form adds:
  - scoring in OKLab: a 15-line conversion, plus choosing the space;
  - a result ranked by use with shares: about 10 lines (map the swatches to the chosen threads, sum the weights);
  - the function forms, so it also runs with the worker entry.

  About 80 lines in all.
- **Quality:**
  - Over "the N most used": about +3 to 4 dB at 6 to 12 of a large chart.
  - The search adds 0.4 to 0.45 dB over `chooseThreads`, and is better on 22 to 24 of the 24 photos (`bench/spikes/fixed-subset.md`).
- **Speed:** 18 ms for 12 of 584 threads, 37 ms for 40 of 1000. A C++ version was only 1.8 times faster (`bench/spikes/fixed-subset-speed/results-speed.txt`). Speed is no reason to build it.
- **Traps, with numbers:**
  1. **The scoring space.** The guides score in sRGB values. Scored in OKLab, the same search lowers mean CIEDE2000 on most charts, and costs PSNR, which measures sRGB error (`bench/spikes/fixed-subset-oklab/results.txt`, 24 Kodak photos, mapping in RGB undithered):
     - **Pigments (4 of 26):** 23.3 → 18.7. Better on 22 photos, worse on 2, −1.7 dB.
     - **Bricks (16 of 78):** 10.0 → 9.3. Better on 23, worse on 0.
     - **Threads (12 of 584):** 7.13 → 6.87. Better on 17, worse on 6.
     - **Dense (6 of 1000):** 8.91 → 8.99. Better on 7, worse on 13.

     - **Mapping in OKLab** (the `oklab` column), the gains are smaller:
       - threads 12: 6.97 → 6.89, better on 15, worse on 8;
       - bricks 16: 9.27 → 9.03;
       - pigments 4: 21.3 → 19.1;
       - dense 6: 8.87 → 8.88, better on 9, worse on 12.
     - **With Floyd–Steinberg in RGB** it is mixed:
       - threads 6: 9.48 → 9.50, 11 photos each way;
       - dense 6 and 12 get worse on more photos (8 better / 14 worse, 9 / 11).
     - **Every cell costs PSNR,** up to 2 dB.
     - **The swatches' source doesn't matter:** taken from an OKLab clustering instead, the numbers barely move (`results-oklab-clustering.txt`; pigments 4: 23.3 → 18.7, threads 12: 7.11 → 6.84).

     So the gain follows the scoring space, not the mapping space. A rule of "score where you map" is not what the data show. The rule they show is "score in OKLab if you judge by eye (ΔE), in RGB if you judge by sRGB error (PSNR)", with dense charts and dithering as exceptions. The guides only say "compare the two choices on your image"; they give no conversion and no rule.
  2. **The worker entry.** The recipe calls `Clustering` methods, which reject with `wasm-load-failed` when only the worker entry is loaded. This can be fixed in the docs: the worker entry has `getPaletteFromClustering`, `getSwatchesFromClustering` and `quantizeToIndicesWithPalette`.
  3. **The order of the result.** Swapped-in threads take their predecessors' places, so the order is arbitrary. A legend or a shopping list needs a ranking the recipe doesn't give.
  4. **Its own metric.** It writes out weighted squared distance and the swap rule, about 40 lines of search code a user has to trust and copy exactly.

## What a built-in adds over it

- **Scoring in OKLab or RGB with the library's own conversion**, with no copied constants. It removes trap 1 only if the default is chosen from the data. Tied to `colorSpace` with RGB as the default (as for mapping), default users would keep the worse ΔE choice on three of four charts. Defaulting to OKLab scoring is a policy choice (test 3) that departs from every other function's RGB default, so the spec would have to settle it. The quality is the same as the strongest recipe's; the built-in adds no quality beyond that.
- **One call instead of about 80 lines**, with a ranked result (`{ indices, palette, weights, shares }`, heaviest first), positions in the given chart, the worker entry, `signal` and `onProgress`. The last two barely matter at 18 to 37 ms.
- **Its cost:**
  - **Names:** two functions (an image form and a clustering form), a `Clustering` method, a worker handle method and a result type. The verb is open: not `build…`, which means "cluster an image".
  - **Rules users must learn:** the result is not in split order and doesn't nest (the best 12 aren't the best 11 plus one).
  - **Options:** the clustering form would be the first image-less function with options (`colorSpace`).
  - **Implementation:** it can be JavaScript over the existing swatches, with no WebAssembly growth (C++ is only 1.8 times faster), or a C export of a few KB.
  - **Upkeep:** tests, and the names, kept for the major version.
  - **Its output becomes a promise:** a better search later changes results, which waits for a major version. The 1024-swatch constant becomes hidden policy.
  - **`weights` and `shares` come from the swatches,** not from the pixels after mapping. A legend or shopping list (stitch or brick counts, which dithering changes) still needs `rankIndices` after mapping, so the ranked result is worth less than it looks: the part users can't easily rebuild is the chart positions, heaviest first.
  - **Another `…FromClustering` name** adds to the open 4.0 question of deprecating that suffix.
  - **The one-job statement** (PRINCIPLES: exact Ward, palettes nest): this is a heuristic local search whose output doesn't nest.
  - **What it won't serve:** inventory limits and ink mixing need constraints or a mixing model, so those users still write their own search.

## Weighing

Built in, it is one call with the space handled. As a recipe it is about 80 lines with a measured colour-space choice, which users won't make well. The recipe's quality is not short of the built-in's once it scores in the right space; what users would lose is mostly convenience and the trap. Test 1 is close. Test 5 costs four names and a result type.

## Review (2026-11-24)

- **`scope-steward`: trim.** Improve the recipe now: OKLab scoring with a stated rule, ranking, the function forms, and an api.md pointer. Build only on the maintainer's confirmation, as the smaller shape, with the scoring rule settled first. Tests 1, 3 and 4 are borderline; test 2 is open.
- **`user-advocate`: build smaller.** The clustering form, its method, the worker function and a handle method (a thread-count slider needs it off the calling thread; at 18 to 59 ms on the calling thread, each step can block 1 to 4 frames, unmeasured in a UI). No image form. Result: chart positions heaviest first; shares documented as estimates. Decide the default scoring space from the data. Add an api.md pointer either way, since grepping api.md for "thread", "chart" or "subset" finds nothing.

Both found that the brief first said scoring in `colorSpace` "removes trap 1" and quoted the wrong column; corrected above, with the dithered results and the OKLab-clustering measurement they asked for.

## Recommendation

**Recipe now; build later only if the maintainer wants it for a named use case.** The recipe can close every trap the data show: OKLab scoring with the measured rule, ranking, the function forms for the worker entry, and an api.md pointer. That is about 80 tested lines in the guides. A built-in adds no quality over that, and would have to settle a scoring-space default against the library's RGB convention, promise a heuristic search's output, and add four names. If the maintainer names a use case that needs it off the main thread (a live slider), build the smaller shape: the clustering form, its method, the worker function and a handle method, in JavaScript, with the scoring space decided in the spec.

**Decision (2026-11-24):** recipe. The maintainer: "ok sure recipe now". The guides' `improveThreads` scores in OKLab by default, returns the threads heaviest first, and uses the function forms; the API reference points to it; the built-in stays under ROADMAP "Considered" with these numbers.
