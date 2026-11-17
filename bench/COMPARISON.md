# Comparison with other palette quantizers

How `agglomerative-clustering` compares with five other JavaScript/WASM palette quantizers on quality and speed.

- **Build:** 3.0.0-beta.1 (commit `f3f126d`, which differs from the published beta only in CI and tests), the WASM build, compiled with Emscripten 6.0.12. The published 2.0.0 ran in the same run, side by side.
- **Machine:** Node v24.18.0 on an Intel Core i7-1185G7 at 3.00 GHz (a laptop, otherwise idle).
- **Timings:** each is the median of 3 runs. The whole run took 43 minutes.

The quality figures on the Kodak photos are identical to the previous run of this comparison (2.0, commit `20fe285`), and 3.0 and the published 2.0.0 give the same palettes on every image at every k. On the synthetic images a few figures moved in the second decimal, for 2.0.0 too, so the change is in the harness's images, not the library. 3.0 and 2.0.0 also take the same time: 3.0 takes 1.01× as long on the photos (geometric mean over palettes and quantizes) and 1.02× on the synthetic images, which is within run-to-run variation. Times are 20–45% lower than in the previous run, which was on a different machine (a shared cloud Xeon), and not by the same factor for every library. So compare speeds within one run, not across runs.

Reproduce with:

```sh
npm run build
node bench/run.js --runs 3 --label comparison --ac agglomerative=dist/index.mjs \
  --ac v2.0.0=path/to/agglomerative-clustering@2.0.0/dist/index.mjs \
  --ac precision6=dist/index.mjs#precision=6 --ac oklab=dist/index.mjs#colorSpace=oklab \
  --ac oklab-precision6=dist/index.mjs#colorSpace=oklab,precision=6
```

## Libraries

| Library | Algorithm | Notes |
|---|---|---|
| **agglomerative** (this package) | Exact Ward hierarchical clustering | Clusters once; any k is a cut of the hierarchy |
| image-q neuquant | NeuQuant (Kohonen neural network) | image-q 4.0.0, default options |
| image-q wuquant | Wu's colour quantizer (variance-minimising box splits) | image-q 4.0.0, default options |
| image-q rgbquant | RgbQuant (histogram + colour reduction) | image-q 4.0.0, default options |
| mmcq | Modified median cut, from Leptonica (used by color-thief) | `quantize` 1.0.2; palette only, no own pixel mapping |
| libimagequant | pngquant's engine (median cut + k-means refinement) | `libimagequant-wasm` 0.3.0, speed 4, dithering off |

## How it is measured

- **Quality** is measured on the palette alone. Every library's palette is applied with the same nearest-colour mapping, so palettes are compared like for like. The results are MSE, PSNR, and mean CIEDE2000 (ΔE, which tracks perceived colour difference).
- **MSE ratio** is the geometric mean, over images, of a library's MSE divided by agglomerative's. Above 1 means worse. **Wins** counts the images where a library's MSE is lower than agglomerative's.
- **Palette ms** is the time to produce one k-colour palette, including converting the input into the library's own format.
- **Quantize ms** is the library's own palette-plus-remap call. **Own-map PSNR** is the quality of that call's output.
- **All k** is the time to get palettes for k = 16, 64, 128 and 256. agglomerative clusters once and cuts the hierarchy at each k; the others start over for each k.
- **Images:** the 24 Kodak photos (768×512), plus 5 synthetic images. Two are gradients: hue/value and a two-channel RGB ramp. One is a flat-colour graphic with anti-aliased edges. Two are uniform noise, at 512² and 1024².

## Summary

- **Quality:** on the Kodak photos, agglomerative has the lowest MSE and highest PSNR of the six libraries at every k. The closest rivals are Wu (MSE ratio 1.03–1.11) and libimagequant (1.06–1.12). At k = 16 they each beat it on 4–5 of the 24 photos, by at most 4.2% MSE. From k = 64 up, nothing beats it on any photo.
- **Perceptual quality:** agglomerative also has the lowest mean ΔE2000 at k = 16 and 64. libimagequant draws level at k = 128 and is slightly ahead at k = 256 (1.65 vs 1.67). agglomerative minimises squared RGB error (Ward's criterion), while libimagequant tunes for perceived colour.
- **Speed:** a single palette takes about 70 ms per photo whatever k is. libimagequant is faster at k = 16 (60 ms) and slower from k = 64 up (79–95 ms); image-q takes 3–17× as long. Only MMCQ is faster (about 20 ms), but its MSE is 2–3× higher.
- **Several palette sizes:** because one clustering serves every k, all four palettes take 69 ms per photo, against 98 ms for MMCQ, 323 ms for libimagequant and 1.0–2.6 s for image-q.
- **Synthetic images:** agglomerative still has the best PSNR at every k. Wu beats it on noise at k = 64 (by 5–7% MSE) and on the RGB ramp (by up to 2%). libimagequant has better ΔE here at every k. A single palette takes about 187 ms, against 147–198 ms for libimagequant; noise has hundreds of thousands of unique colours to cluster. All four palettes take 186 ms, against 709 ms for libimagequant.

## Kodak (24 photos, 768×512)

PSNR and ΔE are means over images. Times are medians per image.

| k | Library | PSNR dB | ΔE2000 | MSE ratio | Wins | Palette ms | Quantize ms | Own-map PSNR |
|---|---|---|---|---|---|---|---|---|
| 16 | **agglomerative** | **29.98** | **4.31** | 1.00 | – | 70 | 74 | **29.98** |
| 16 | image-q wuquant | 29.84 | 4.47 | 1.03 | 4/24 | 446 | 834 | 28.59 |
| 16 | libimagequant | 29.74 | 4.39 | 1.06 | 5/24 | 60 | 78 | 29.42 |
| 16 | image-q neuquant | 28.15 | 4.86 | 1.52 | 0/24 | 229 | 603 | 27.16 |
| 16 | mmcq | 26.57 | 6.08 | 2.19 | 0/24 | 25 | – | – |
| 16 | image-q rgbquant | 25.84 | 6.68 | 2.59 | 0/24 | 243 | 629 | 24.15 |
| 64 | **agglomerative** | **35.72** | **2.56** | 1.00 | – | 70 | 75 | **35.72** |
| 64 | image-q wuquant | 35.51 | 2.61 | 1.05 | 0/24 | 532 | 935 | 34.00 |
| 64 | libimagequant | 35.39 | 2.58 | 1.08 | 0/24 | 79 | 109 | 34.92 |
| 64 | image-q neuquant | 34.41 | 2.78 | 1.35 | 0/24 | 428 | 827 | 33.04 |
| 64 | mmcq | 32.53 | 3.55 | 2.08 | 0/24 | 19 | – | – |
| 64 | image-q rgbquant | 31.95 | 3.69 | 2.38 | 0/24 | 242 | 666 | 30.00 |
| 128 | **agglomerative** | **38.16** | **2.06** | 1.00 | – | 70 | 75 | **38.16** |
| 128 | image-q wuquant | 37.88 | 2.11 | 1.07 | 0/24 | 621 | 1059 | 36.18 |
| 128 | libimagequant | 37.75 | **2.06** | 1.10 | 0/24 | 86 | 131 | 37.21 |
| 128 | image-q neuquant | 37.38 | 2.19 | 1.20 | 0/24 | 685 | 1129 | 35.81 |
| 128 | image-q rgbquant | 34.92 | 2.85 | 2.11 | 0/24 | 245 | 699 | 33.00 |
| 128 | mmcq | 34.73 | 2.98 | 2.20 | 0/24 | 17 | – | – |
| 256 | **agglomerative** | **40.49** | 1.67 | 1.00 | – | 69 | 75 | **40.49** |
| 256 | image-q wuquant | 40.05 | 1.73 | 1.11 | 0/24 | 802 | 1323 | 38.17 |
| 256 | libimagequant | 39.99 | **1.65** | 1.12 | 0/24 | 95 | 149 | 39.38 |
| 256 | image-q neuquant | 39.46 | 1.79 | 1.27 | 0/24 | 1210 | 1734 | 37.70 |
| 256 | image-q rgbquant | 37.21 | 2.29 | 2.13 | 0/24 | 262 | 782 | 35.17 |
| 256 | mmcq | 35.92 | 2.71 | 2.87 | 0/24 | 21 | – | – |

At k = 16, the photos where another library has lower MSE are:
- **Wu:** kodim01 (−2.9%), kodim17 (−2.7%), kodim20 (−3.6%) and kodim22 (−3.0%).
- **libimagequant:** kodim04 (−4.2%), kodim06 (−0.3%), kodim07 (−2.0%), kodim11 (−0.4%) and kodim22 (−3.0%).

Palettes for every k in {16, 64, 128, 256}, median ms per photo:

| Library | All k ms | How |
|---|---|---|
| **agglomerative** | **69** | One clustering, cut per k |
| mmcq | 98 | Sum of per-k palettes |
| libimagequant | 323 | Sum of per-k palettes |
| image-q rgbquant | 1006 | Sum of per-k palettes |
| image-q wuquant | 2404 | Sum of per-k palettes |
| image-q neuquant | 2562 | Sum of per-k palettes |

## Synthetic (5 images)

The images are gradient-hsv, gradient-rgb, graphic, noise-512 and noise-1024. Five images is a small sample, so read these as indicative.

| k | Library | PSNR dB | ΔE2000 | MSE ratio | Wins | Palette ms | Quantize ms | Own-map PSNR |
|---|---|---|---|---|---|---|---|---|
| 16 | **agglomerative** | **24.11** | 8.51 | 1.00 | – | 187 | 190 | **24.11** |
| 16 | image-q wuquant | 23.86 | 8.50 | 1.06 | 1/5 | 436 | 743 | 22.56 |
| 16 | libimagequant | 23.59 | **8.19** | 1.13 | 0/5 | 147 | 166 | 23.37 |
| 16 | image-q neuquant | 23.24 | 8.63 | 1.22 | 0/5 | 231 | 522 | 21.88 |
| 16 | image-q rgbquant | 21.08 | 10.83 | 2.01 | 0/5 | 639 | 1437 | 18.48 |
| 16 | mmcq | 20.02 | 10.74 | 2.56 | 0/5 | 25 | – | – |
| 64 | **agglomerative** | **30.05** | 4.91 | 1.00 | – | 186 | 190 | **30.05** |
| 64 | image-q wuquant | 29.62 | 4.87 | 1.10 | 3/5 | 512 | 840 | 28.34 |
| 64 | libimagequant | 29.07 | **4.77** | 1.25 | 0/5 | 166 | 189 | 28.80 |
| 64 | image-q neuquant | 28.34 | 5.17 | 1.48 | 0/5 | 446 | 751 | 26.82 |
| 64 | image-q rgbquant | 27.35 | 6.50 | 1.86 | 0/5 | 655 | 1441 | 25.28 |
| 64 | mmcq | 26.24 | 5.79 | 2.41 | 0/5 | 16 | – | – |
| 128 | **agglomerative** | **32.92** | 3.80 | 1.00 | – | 188 | 190 | **32.92** |
| 128 | libimagequant | 32.20 | **3.54** | 1.18 | 0/5 | 198 | 224 | 32.02 |
| 128 | image-q wuquant | 31.79 | 3.93 | 1.30 | 0/5 | 614 | 991 | 29.99 |
| 128 | image-q neuquant | 30.60 | 4.00 | 1.71 | 0/5 | 661 | 1008 | 29.11 |
| 128 | image-q rgbquant | 30.15 | 5.65 | 1.89 | 0/5 | 702 | 1486 | 27.98 |
| 128 | mmcq | 28.93 | 4.31 | 2.51 | 0/5 | 19 | – | – |
| 256 | **agglomerative** | **36.21** | 2.84 | 1.00 | – | 189 | 190 | **36.21** |
| 256 | libimagequant | 35.16 | **2.75** | 1.27 | 0/5 | 198 | 225 | 34.87 |
| 256 | image-q wuquant | 34.20 | 2.92 | 1.59 | 1/5 | 802 | 1289 | 32.42 |
| 256 | image-q neuquant | 32.46 | 3.10 | 2.37 | 0/5 | 1184 | 1594 | 30.81 |
| 256 | image-q rgbquant | 32.38 | 5.21 | 2.42 | 0/5 | 646 | 1533 | 30.14 |
| 256 | mmcq | 31.43 | 3.34 | 3.01 | 0/5 | 30 | – | – |

Wu's wins are noise-512 (−6.5% MSE) and noise-1024 (−5.4%) at k = 64, and gradient-rgb at k = 16, 64 and 256 (−0.5%, −1.5% and −2.2%).

Palettes for every k in {16, 64, 128, 256}, median ms per image:

| Library | All k ms | How |
|---|---|---|
| mmcq | 106 | Sum of per-k palettes |
| **agglomerative** | **186** | One clustering, cut per k |
| libimagequant | 709 | Sum of per-k palettes |
| image-q wuquant | 2366 | Sum of per-k palettes |
| image-q neuquant | 2561 | Sum of per-k palettes |
| image-q rgbquant | 2643 | Sum of per-k palettes |

## Caveats

- **Defaults only.** Every library ran with its default settings. libimagequant at a slower speed setting, or image-q with other colour-distance options, would trade time for quality.
- **Noisy timings.** These are wall-clock medians on one machine and can vary by about ±10% between runs. Rankings separated by less than that aren't meaningful.
- **Ward's criterion favours MSE and PSNR.** It minimises squared RGB error, which is exactly what MSE and PSNR measure. ΔE2000 is the fairer metric for comparing with libimagequant, which tunes for perceived colour.
- **Quantize ms differs by design.** It uses each library's own pixel mapping: dithering is off for libimagequant, and image-q's defaults are used. So it measures each library's whole pipeline rather than palette quality.

## Options

These are the `precision`, `colorSpace` and `dither` options, passed as `--ac name=dist/index.mjs#option=value`. PSNR and ΔE2000 here are for each build's own quantize output, so OKLab palettes are also matched in OKLab. Kodak means:

| Setting | PSNR k=16 | ΔE k=16 | ΔE k=64 | ΔE k=128 | ΔE k=256 | Palette ms (k=64) | All k ms |
|---|---|---|---|---|---|---|---|
| default (`rgb`, `precision: 8`) | 29.98 | 4.31 | 2.56 | 2.06 | 1.67 | 70 | 69 |
| `precision: 6` | 30.03 | 4.29 | 2.56 | 2.06 | 1.68 | 24 | 23 |
| `precision: 5` | 30.03 | 4.24 | 2.56 | 2.08 | 1.74 | 9 | 10 |
| `colorSpace: 'oklab'` | 29.31 | 4.46 | 2.54 | 2.01 | 1.60 | 78 | 78 |
| `colorSpace: 'oklab', precision: 6` | 29.26 | 4.44 | 2.55 | 2.02 | 1.61 | 30 | 30 |
| `dither: true` | 26.55 | 5.06 | 3.31 | 2.68 | 2.15 | 70 | 70 |
| libimagequant | 29.42 | 4.38 | 2.54 | 2.02 | 1.61 | 79 | 323 |

The `precision: 5` and `dither` rows are from a second, shorter run on the same machine (`--sets kodak --libs none --runs 3`, 2.5 minutes, with the default build alongside, which timed within 2% of the main run); the rest are from the main run. The quality columns are identical to the previous run. Exact OKLab clusters in about 10–25% more time than RGB.

- **`precision: 6`** is about 3× faster than exact at practically the same quality, and `precision: 5` about 8×. On the synthetic set `precision: 6` is about 7× faster (26 vs 186 ms at k = 64), and noise-1024 drops from 1.9 s to 0.6 s.
- **`colorSpace: 'oklab'`** gives the lowest ΔE2000 from k = 128 up on photos, and on the synthetic images (k = 64: 4.48 against libimagequant's 4.66 and RGB's 4.91; a small set, so a hint rather than a rule), at the cost of 0.3–1 dB PSNR (RGB wins PSNR on every photo). At k ≤ 16 on photos RGB is better on ΔE, and for dithered output and 3–8 colour swatches too. See "Choosing a colour space" in the README.
- **`dither`** lowers per-pixel scores by design. Its value is visual: it removes banding in smooth gradients at low colour counts, as in `docs/palette-sizes.png`. It doesn't change the palette; the quantize takes longer (99 against 75 ms at k = 64), because dithered pixels miss the colour memo more often.
