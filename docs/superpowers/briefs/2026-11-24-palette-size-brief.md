# Value brief: suggesting a palette size

## Who asked

The maintainer: "i want to do smaller web assembly and suggesting a palette size as well" (2026-11-24). No user or issue has asked. The ROADMAP entry ("Larger, later") is gated on users asking "for more than `mse` and `explained`", and PRINCIPLES "What it leaves to others" lists "picking a palette size for the user" as application policy, to be a recipe. PRINCIPLES test 2 is therefore not met by a user request.

## The symptom

"How many colours does this image need?" / "pick k automatically" / "smallest palette that still looks the same". A user handling many images wants one setting that works across photos, flat graphics and gradients (the measurement has 24 photos but only one graphic and two gradients), instead of a fixed `k` that is too many for a logo and too few for a sunset.

## The best recipe

Measured through `dist/` on 27 images (24 Kodak photos and three synthetic: an HSV gradient, an RGB ramp, a flat graphic; noise left out, as it needs thousands of colours for any target)<!-- bench/spikes/palette-size/rules.mjs → results-rules.txt -->. The reference for each image is the smallest `k` whose mapped output (`quantize`, RGB, no dither) has mean ΔE2000 at most a target: 2.5 (close to faithful: needs 7 to 292 colours, median 55) or 4 (visibly reduced: 3 to 114, median 19). Each rule's one threshold was tuned over the whole set; scored leave-one-out (each image with the threshold tuned on the other 26) every factor is the same, so the fit doesn't rest on any one image. "Off by" is the geometric mean factor between the rule's `k` and the reference. Measured for an RGB clustering, mapped without dither, scored by mean ΔE2000 only. The reference and the exact recipe use a binary search, which assumes ΔE falls as `k` grows: on four photos, every `k` from 1 to 320, it rose at most 0.002 and the search found the true smallest `k` in all 8 cases<!-- bench/spikes/palette-size/monotone.mjs → results-monotone.txt -->.

| Rule on `getClusteringInfo()` | ΔE ≤ 2.5: off by, worst | ΔE ≤ 4: off by, worst | ΔE at the rule's k (target 4) |
|---|---|---|---|
| `explained ≥ 0.99` (the guides' recipe as written) | 1.7×, 12× | 2.9×, 28× | 0.8 to 4.1 |
| `explained ≥ t`, re-tuned (t = 0.99 / 0.97) | 1.7×, 12× | 1.6×, 9× | 1.2 to 6.1 |
| `explained ≥ t`, OKLab clustering | 1.7×, 12× | 1.6×, 10× | 1.2 to 5.8 |
| **`√mse ≤ t`, RGB (t = 5 / 8)** | **1.5×, 2.7×** | **1.3×, 3.0×** | **2.0 to 5.2** |
| `√mse ≤ t`, OKLab clustering (t = 0.008 / 0.015) | 1.4×, 3.1× | 1.3×, 3.0× | 2.0 to 5.4 |
| Elbow (Kneedle on log k, no threshold) | 14×, 73× | 4.9×, 16× | 2.5 to 13.7 |

- **The curve rule:** the smallest `k` with `Math.sqrt(mse[k - 1]) <= t`, where `t` is a dial with two measured anchors: 5 for ΔE about 2.5, 8 for ΔE about 4 (in an OKLab clustering, 0.008 and 0.015). A few lines with its guards: `findIndex` gives -1 when nothing reaches `t` (possible with `precision` < 8, whose grouped error keeps `mse` above 0), and a cap such as 256 for GIF and PNG (noise would ask for thousands). 4 to 13 ms after clustering, on four photos (timed with `t` = 5; it is `getClusteringInfo`'s time)<!-- bench/spikes/palette-size/search.mjs → results-search.txt -->. An *absolute* error target beats the guides' *relative* `explained`, which asks a smooth photo (low variance) for far more colours than it needs and a busy one for too few (kodim02: 83 colours where 7 reach ΔE 2.5).
- **The elbow is no good:** it picks 2 to 9 colours on every image, whatever it holds. The ROADMAP's "an elbow heuristic" should not be built.
- **The exact recipe:** binary search on `k`, mapping with `clustering.quantize` and scoring with a function the caller supplies, about 8 lines. With a ΔE2000 score (about 70 lines in `bench/lib/metrics.js`, or a package) it hits the target, but takes 0.6 to 1.2 s on four Kodak photos in JS, against 70 to 170 ms to cluster.
- **Traps:** `quantize` of a `{ data, format }` returns the same shape, so the score must read `.data` (the spike got this wrong first); `explained` reads as "how good", but it is relative to the image's own variance; a target in RGB units changes meaning in an OKLab clustering (`mse` is in OKLab units there).

## What a built-in adds over it

- **Over the curve rule:** nothing in quality. A built-in would be the same one line with a default threshold, and a default threshold is the policy PRINCIPLES leaves to apps (4 colours or 40 for "looks the same" depends on the use).
- **Over the exact search:** speed. A WebAssembly search scoring in OKLab or ΔE could plausibly run in 100–200 ms instead of 0.6–1.2 s (not measured: it would need building). It would also save users the ΔE2000 code. It would cost a new function and option set kept for the major version, a perceptual metric in the C++ (WebAssembly size, which this branch is cutting), and a target whose meaning users must learn.

## Recommendation

**Recipe.** Replace the guides' `explained ≥ 0.99` line with the absolute rule as a dial (5 for ΔE about 2.5, 8 for about 4; 0.008 and 0.015 in OKLab), with its guards and a cap, the measured spread in a sentence (fitted on Kodak, undithered RGB), and keep `explained` for what it is: a share of variance. Add the exact search taking the caller's score, with its cost. Test both in `test/recipes.test.js`. Under ROADMAP "Considered": the elbow (a Kneedle elbow on log k up to 256, measured: picks 2–9 colours everywhere) and the built-in search (no one asked; recipe exists; reopen if users ask for a perceptual target and the 1 s search is their complaint). Drop the "Suggesting a palette size" entry from "Larger, later".
