# Spike: choosing N colours from a fixed palette

ROADMAP "Next" item 3. Question: does a built-in clearly beat the guides' recipe (cluster, snap each cut colour to its nearest fixed one, cut finer until N distinct)? Script: `bench/spikes/fixed-subset.js`. Run: `node bench/spikes/fixed-subset.js --dither` on 3.2.0 (2026-11-20), 24 Kodak photos plus `gradient-hsv`, `gradient-rgb` and `graphic` from `bench/lib/images.js`.

## Setup

Every method returns N indices into the fixed set F. The full image is then mapped to those N colours with `quantizeWithPalette` (RGB), undithered and with Floyd–Steinberg, and scored by PSNR and mean CIEDE2000.

| Method | What it does |
|---|---|
| top-n | Map the image to all of F and keep the N most used entries. |
| recipe | The guides' snippet, as written. |
| snap-merge | Ward agglomeration from a 256-colour cut. A cluster also pays `W·‖μ − nearest F‖²`, and merging stops at N distinct F entries. |
| search | Picks the N entries of F that minimise `Σ w·min‖c − s‖²` over a 1024-colour cut's swatches: greedy, then best-improvement swaps. This is the roadmap's "score subsets by the mapping error". |
| recipe+swap | The recipe's choice, polished by the same swaps. |

The fixed sets are synthetic stand-ins, with no vendor data:

| Set | Colours | N tried | Built from |
|---|---|---|---|
| threads | 584 | 6, 12, 24, 40 | an OKLCh chart: 24 hues × 6 lightness × 4 chroma, plus a grey ramp |
| bricks | 78 | 8, 16, 24 | a coarse chart |
| pigments | 26 | 4, 6, 8 | 12 saturated hues × 2 lightness, plus black and white |
| dense | 1000 | 6, 12, 24, 40 | Halton points over the RGB cube |
| websafe | 216 | 8, 16, 32 | the 6×6×6 web-safe grid |

## Results

Kodak, means over 24 photos. Cells are PSNR (dB) / ΔE2000 / ms; the ms column excludes the shared clustering, which averages 71 ms. The full table, synthetic images included, is printed by the script; raw rows go to `bench/results/fixed-subset.json`.

| F | N | all of F | top-n | recipe | snap-merge | search |
|---|---|---|---|---|---|---|
| threads | 6 | 28.43 / 6.63 | 20.52 / 10.16 | 23.97 / 9.25 / 0 | 24.29 / 8.93 / 290 | **24.36 / 8.54** / 50 |
| threads | 12 | | 23.41 / 8.38 | 26.16 / 7.77 / 0 | 26.58 / 7.18 / 286 | **26.61 / 7.08** / 103 |
| threads | 24 | | 25.68 / 7.25 | 27.56 / 6.88 / 1 | 27.79 / 6.66 / 287 | **27.81 / 6.65** / 189 |
| threads | 40 | | 27.24 / 6.84 | 28.09 / 6.64 / 6 | 28.19 / 6.61 / 287 | **28.21 / 6.59** / 288 |
| dense | 12 | 29.73 / 6.66 | 23.42 / 8.75 | 26.61 / 8.17 / 0 | 26.83 / 7.92 / 474 | **26.92 / 7.79** / 163 |
| bricks | 8 | 24.36 / 10.02 | 22.28 / 10.98 | 23.15 / 10.83 / 0 | 23.44 / 10.14 / 85 | **23.48 / 10.07** / 5 |
| pigments | 6 | 15.67 / 21.70 | 15.21 / 22.27 | 15.39 / 22.34 / 0 | 15.46 / 22.54 / 56 | **15.47** / 22.48 / 1 |
| websafe | 8 | 24.94 / 9.50 | 22.37 / 10.22 | 23.49 / 10.31 / 0 | 23.74 / 9.77 / 165 | **23.77 / 9.75** / 10 |

Search minus recipe on Kodak, at the sizes where the choice matters (N at most about a quarter of F):

| F, N | ΔPSNR plain | ΔPSNR dithered | ΔΔE plain | Images better / same / worse |
|---|---|---|---|---|
| threads 6 | +0.40 | +0.51 | −0.71 | 23 / 1 / 0 |
| threads 12 | +0.45 | +0.75 | −0.68 | 24 / 0 / 0 |
| threads 24 | +0.25 | +0.20 | −0.23 | 24 / 0 / 0 |
| dense 12 | +0.31 | +0.43 | −0.38 | 23 / 1 / 0 |
| dense 24 | +0.28 | +0.30 | −0.26 | 24 / 0 / 0 |
| bricks 8 | +0.33 | +0.56 | −0.75 | 23 / 1 / 0 |
| websafe 8 | +0.28 | +0.61 | −0.57 | 21 / 3 / 0 |
| pigments 4 | +0.10 | +0.10 | +0.42 (worse) | 15 / 8 / 1 |

On the synthetic images the pattern is the same: +0.1 to +0.6 dB undithered and up to +1 dB dithered. Each palette and N there is 3 images.

## Findings

1. **The recipe already gets most of the gain.** It is 2 to 4 dB above top-n for N ≤ 12 on photos, which confirms what the guides say.
2. **Subset search beats the recipe almost everywhere, by a modest amount:** about +0.3 to +0.45 dB and −0.4 to −0.75 ΔE at the sizes people ask for (6 to 12 threads, 8 bricks). It is better on 90–100% of photos there and almost never worse: 5 of 24 photos at dense N = 6, where the greedy start is weak. The gain shrinks as N approaches the point where the subset nearly matches all of F. Dithered gains are larger, up to +0.75 dB.
3. **Snap-merge is dominated.** It is slightly worse than search and slower. Drop it.
4. **recipe+swap is about the same as search,** so the starting point barely matters, except that the recipe start does a little better at dense N = 6 (24.38 against 24.32 dB), where the greedy start is weakest. A built-in could start from the recipe and polish.
5. **The objective should probably be the colour space's.** With pigments at N = 4, search wins on RGB error but loses 0.42 ΔE, because it minimises squared RGB distance. In OKLab the objective would track ΔE. In a built-in, that would follow the existing `colorSpace` option.
6. **Speed.** In this JavaScript spike, search takes 1 to 400 ms over 1024 swatches, growing with |F|·N, against under a millisecond for the recipe. In C++ with SIMD it should be several times faster and below the clustering's cost. That is an estimate; it hasn't been measured.
7. **It answers the roadmap's open point:** "the recipe can't weigh a fixed colour that is close to several clusters." Search weighs it by construction, and that is where its wins come from.

## Verdict

**The win is consistent but not large.** A third of a dB and about half a ΔE unit at 6 to 12 colours is visible on gradients and skin tones. It is smaller than the 3 to 8 dB the recipe already has over top-n. Whether that clears "clearly wins" is the maintainer's call. The alternatives:

- **A function:** for example `chooseFromPalette(clusteringOrImage, palette, n, options?)`, returning indices into the fixed palette. It would run the search in C++, start from the recipe, use the `colorSpace` objective, and offer the cancellation the clustering has. This is new API to keep for all of 3.x and would need a spec and the three reviewers.
- **Keep the recipe:** add the numbers above to the guides and ROADMAP, and close item 3 as "recipe is enough". A JavaScript swap polish is about 40 lines, which is too long for a guide snippet.

Not tried: random restarts of the search, the full histogram instead of 1024 swatches, real thread or brick charts, or an OKLab objective (finding 5).
