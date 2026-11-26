# Comparison with other palette quantizers

How `agglomerative-clustering` compares with five other JavaScript/WASM palette quantizers on quality and speed.

- **Build:** 4.3.0 (commit `9187d2f`, whose `src/` is that of the 4.3.0 release), the WASM build, compiled with Emscripten 6.0.12.
- **Machine:** Node v24.18.0 on an Intel Core i7-1185G7 at 3.00 GHz (a laptop, otherwise idle: load average about 1.2 before and after).
- **Timings:** each is the median of 3 runs. The whole run took 33 minutes (2,001 s).
- **Results:** `bench/results-4.3.0.json` (the main run) and `bench/results-4.3.0-options.json` (the `precision: 5` and `dither` rows of "Options").

The quality figures on the Kodak photos and the synthetic images are identical to the previous run of this comparison (3.0.0-beta.1) at every k: the clustering has not changed. Times are lower than in that run: this library's by about 25% (70 to 53 ms for a palette at k = 64 on the photos), the other libraries' by 0–20%, so compare speeds within one run, not across runs.

Reproduce with:

```sh
npm run build
node bench/run.js --runs 3 --label comparison-4.3 --ac agglomerative=dist/index.mjs \
  --ac precision6=dist/index.mjs#precision=6 --ac oklab=dist/index.mjs#colorSpace=oklab \
  --ac oklab-precision6=dist/index.mjs#colorSpace=oklab,precision=6
```

The "Options" rows for `precision: 5` and `dither` come from a second run, `node bench/run.js --sets kodak --libs none --runs 3 --label options-4.3 --ac agglomerative=dist/index.mjs --ac precision5=dist/index.mjs#precision=5 --ac dither=dist/index.mjs#dither=true` (2 minutes; its default build timed within 2% of the main run).

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
- **Speed:** a single palette takes about 52 ms per photo whatever k is. libimagequant is slightly faster at k = 16 (49 ms) and slower from k = 64 up (64–78 ms); image-q takes 4–20× as long. Only MMCQ is faster (15–24 ms), but its MSE is 2–3× higher.
- **Several palette sizes:** because one clustering serves every k, all four palettes take 53 ms per photo, against 82 ms for MMCQ, 262 ms for libimagequant and 0.8–2.1 s for image-q.
- **Synthetic images:** agglomerative still has the best PSNR at every k. Wu beats it on noise at k = 64 (by 5–7% MSE) and on the RGB ramp (by up to 2%). libimagequant has better ΔE here at every k. A single palette takes about 172 ms, against 121–165 ms for libimagequant; noise has hundreds of thousands of unique colours to cluster. All four palettes take 172 ms, against 585 ms for libimagequant.

## Kodak (24 photos, 768×512)

PSNR and ΔE are means over images. Times are medians per image.

| k | Library | PSNR dB | ΔE2000 | MSE ratio | Wins | Palette ms | Quantize ms | Own-map PSNR |
|---|---|---|---|---|---|---|---|---|
| 16 | **agglomerative** | **29.98** | **4.31** | 1.00 | – | 52 | 54 | **29.98** |
| 16 | image-q wuquant | 29.84 | 4.47 | 1.03 | 4/24 | 367 | 672 | 28.59 |
| 16 | libimagequant | 29.74 | 4.39 | 1.06 | 5/24 | 49 | 62 | 29.42 |
| 16 | image-q neuquant | 28.15 | 4.86 | 1.52 | 0/24 | 191 | 507 | 27.16 |
| 16 | mmcq | 26.57 | 6.08 | 2.19 | 0/24 | 24 | – | – |
| 16 | image-q rgbquant | 25.84 | 6.68 | 2.59 | 0/24 | 196 | 516 | 24.15 |
| 64 | **agglomerative** | **35.72** | **2.56** | 1.00 | – | 53 | 55 | **35.72** |
| 64 | image-q wuquant | 35.51 | 2.61 | 1.05 | 0/24 | 433 | 761 | 34.00 |
| 64 | libimagequant | 35.39 | 2.58 | 1.08 | 0/24 | 64 | 89 | 34.92 |
| 64 | image-q neuquant | 34.41 | 2.78 | 1.35 | 0/24 | 361 | 707 | 33.04 |
| 64 | mmcq | 32.53 | 3.55 | 2.08 | 0/24 | 20 | – | – |
| 64 | image-q rgbquant | 31.95 | 3.69 | 2.38 | 0/24 | 194 | 541 | 30.00 |
| 128 | **agglomerative** | **38.16** | 2.06 | 1.00 | – | 52 | 55 | **38.16** |
| 128 | image-q wuquant | 37.88 | 2.11 | 1.07 | 0/24 | 517 | 876 | 36.18 |
| 128 | libimagequant | 37.75 | **2.06** | 1.10 | 0/24 | 71 | 106 | 37.21 |
| 128 | image-q neuquant | 37.38 | 2.19 | 1.20 | 0/24 | 574 | 950 | 35.81 |
| 128 | image-q rgbquant | 34.92 | 2.85 | 2.11 | 0/24 | 199 | 578 | 33.00 |
| 128 | mmcq | 34.73 | 2.98 | 2.20 | 0/24 | 16 | – | – |
| 256 | **agglomerative** | **40.49** | 1.67 | 1.00 | – | 51 | 58 | **40.49** |
| 256 | image-q wuquant | 40.05 | 1.73 | 1.11 | 0/24 | 661 | 1113 | 38.17 |
| 256 | libimagequant | 39.99 | **1.65** | 1.12 | 0/24 | 77 | 122 | 39.38 |
| 256 | image-q neuquant | 39.46 | 1.79 | 1.27 | 0/24 | 1022 | 1469 | 37.70 |
| 256 | image-q rgbquant | 37.21 | 2.29 | 2.13 | 0/24 | 209 | 644 | 35.17 |
| 256 | mmcq | 35.92 | 2.71 | 2.87 | 0/24 | 15 | – | – |

At k = 16, the photos where another library has lower MSE are:
- **Wu:** kodim01 (−2.9%), kodim17 (−2.7%), kodim20 (−3.6%) and kodim22 (−3.0%).
- **libimagequant:** kodim04 (−4.2%), kodim06 (−0.3%), kodim07 (−2.0%), kodim11 (−0.4%) and kodim22 (−3.0%).

Palettes for every k in {16, 64, 128, 256}, median ms per photo:

| Library | All k ms | How |
|---|---|---|
| **agglomerative** | **53** | One clustering, cut per k |
| mmcq | 82 | Sum of per-k palettes |
| libimagequant | 262 | Sum of per-k palettes |
| image-q rgbquant | 791 | Sum of per-k palettes |
| image-q wuquant | 1989 | Sum of per-k palettes |
| image-q neuquant | 2147 | Sum of per-k palettes |

## Synthetic (5 images)

The images are gradient-hsv, gradient-rgb, graphic, noise-512 and noise-1024. Five images is a small sample, so read these as indicative.

| k | Library | PSNR dB | ΔE2000 | MSE ratio | Wins | Palette ms | Quantize ms | Own-map PSNR |
|---|---|---|---|---|---|---|---|---|
| 16 | **agglomerative** | **24.11** | 8.51 | 1.00 | – | 169 | 174 | **24.11** |
| 16 | image-q wuquant | 23.86 | 8.50 | 1.06 | 1/5 | 328 | 568 | 22.56 |
| 16 | libimagequant | 23.59 | **8.19** | 1.13 | 0/5 | 121 | 134 | 23.37 |
| 16 | image-q neuquant | 23.24 | 8.63 | 1.22 | 0/5 | 184 | 425 | 21.88 |
| 16 | image-q rgbquant | 21.08 | 10.83 | 2.01 | 0/5 | 507 | 1087 | 18.48 |
| 16 | mmcq | 20.02 | 10.74 | 2.56 | 0/5 | 25 | – | – |
| 64 | **agglomerative** | **30.05** | 4.91 | 1.00 | – | 171 | 175 | **30.05** |
| 64 | image-q wuquant | 29.62 | 4.87 | 1.10 | 3/5 | 385 | 698 | 28.34 |
| 64 | libimagequant | 29.07 | **4.77** | 1.25 | 0/5 | 136 | 155 | 28.80 |
| 64 | image-q neuquant | 28.34 | 5.17 | 1.48 | 0/5 | 356 | 623 | 26.82 |
| 64 | image-q rgbquant | 27.35 | 6.50 | 1.86 | 0/5 | 526 | 1095 | 25.28 |
| 64 | mmcq | 26.24 | 5.79 | 2.41 | 0/5 | 26 | – | – |
| 128 | **agglomerative** | **32.92** | 3.80 | 1.00 | – | 174 | 175 | **32.92** |
| 128 | libimagequant | 32.20 | **3.54** | 1.18 | 0/5 | 164 | 182 | 32.02 |
| 128 | image-q wuquant | 31.79 | 3.93 | 1.30 | 0/5 | 469 | 799 | 29.99 |
| 128 | image-q neuquant | 30.60 | 4.00 | 1.71 | 0/5 | 554 | 855 | 29.11 |
| 128 | image-q rgbquant | 30.15 | 5.65 | 1.89 | 0/5 | 523 | 1099 | 27.98 |
| 128 | mmcq | 28.93 | 4.31 | 2.51 | 0/5 | 13 | – | – |
| 256 | **agglomerative** | **36.21** | 2.84 | 1.00 | – | 172 | 178 | **36.21** |
| 256 | libimagequant | 35.16 | **2.75** | 1.27 | 0/5 | 165 | 185 | 34.87 |
| 256 | image-q wuquant | 34.20 | 2.92 | 1.59 | 1/5 | 605 | 1067 | 32.42 |
| 256 | image-q neuquant | 32.46 | 3.10 | 2.37 | 0/5 | 987 | 1323 | 30.81 |
| 256 | image-q rgbquant | 32.38 | 5.21 | 2.42 | 0/5 | 536 | 1145 | 30.14 |
| 256 | mmcq | 31.43 | 3.34 | 3.01 | 0/5 | 25 | – | – |

Wu's wins are noise-512 (−6.5% MSE) and noise-1024 (−5.4%) at k = 64, and gradient-rgb at k = 16, 64 and 256 (−0.5%, −1.5% and −2.2%).

Palettes for every k in {16, 64, 128, 256}, median ms per image:

| Library | All k ms | How |
|---|---|---|
| mmcq | 93 | Sum of per-k palettes |
| **agglomerative** | **172** | One clustering, cut per k |
| libimagequant | 585 | Sum of per-k palettes |
| image-q wuquant | 1798 | Sum of per-k palettes |
| image-q rgbquant | 2092 | Sum of per-k palettes |
| image-q neuquant | 2095 | Sum of per-k palettes |

## Caveats

- **Defaults only.** Every library ran with its default settings. libimagequant at a slower speed setting, or image-q with other colour-distance options, would trade time for quality.
- **Noisy timings.** These are wall-clock medians on one machine and can vary by about ±10% between runs. Rankings separated by less than that aren't meaningful.
- **Ward's criterion favours MSE and PSNR.** It minimises squared RGB error, which is exactly what MSE and PSNR measure. ΔE2000 is the fairer metric for comparing with libimagequant, which tunes for perceived colour.
- **Quantize ms differs by design.** It uses each library's own pixel mapping: dithering is off for libimagequant, and image-q's defaults are used. So it measures each library's whole pipeline rather than palette quality.

## Options

These are the `precision`, `colorSpace` and `dither` options, passed as `--ac name=dist/index.mjs#option=value`. PSNR and ΔE2000 here are for each build's own quantize output, so OKLab palettes are also matched in OKLab. Kodak means:

| Setting | PSNR k=16 | ΔE k=16 | ΔE k=64 | ΔE k=128 | ΔE k=256 | Palette ms (k=64) | All k ms |
|---|---|---|---|---|---|---|---|
| default (`rgb`, `precision: 8`) | 29.98 | 4.31 | 2.56 | 2.06 | 1.67 | 53 | 53 |
| `precision: 6` | 30.03 | 4.29 | 2.56 | 2.06 | 1.68 | 18 | 18 |
| `precision: 5` | 30.03 | 4.24 | 2.56 | 2.08 | 1.74 | 6.4 | 6.5 |
| `colorSpace: 'oklab'` | 29.31 | 4.46 | 2.54 | 2.01 | 1.60 | 59 | 59 |
| `colorSpace: 'oklab', precision: 6` | 29.26 | 4.44 | 2.55 | 2.02 | 1.61 | 24 | 24 |
| `dither: true` | 26.15 | 5.16 | 3.32 | 2.68 | 2.15 | 51 | 53 |
| libimagequant | 29.42 | 4.38 | 2.54 | 2.02 | 1.61 | 64 | 262 |

The `precision: 5` and `dither` rows are from a second, shorter run on the same machine (`--sets kodak --libs none --runs 3`, about 2 minutes, with the default build alongside, which timed within 2% of the main run); the rest are from the main run. The quality columns match the previous run, except `dither`, whose scores moved in the second decimal (26.55 to 26.15 dB at k = 16). Exact OKLab clusters in about 13% more time than RGB on the photos (59 against 53 ms), and with `precision: 6` in about 34% more (24 against 18 ms).

- **`precision: 6`** is about 3× faster than exact at practically the same quality, and `precision: 5` about 8×. On the synthetic set `precision: 6` is about 9× faster (20 vs 171 ms at k = 64), and noise-1024 drops from 1.8 s to 0.46 s.
- **`colorSpace: 'oklab'`** gives the lowest ΔE2000 from k = 128 up on photos, and on the synthetic images (k = 64: 4.48 against libimagequant's 4.66 and RGB's 4.91; a small set, so a hint rather than a rule), at the cost of 0.3–1.1 dB PSNR (RGB wins PSNR on every photo). At k ≤ 16 on photos RGB is better on ΔE, and for dithered output and 3–8 colour swatches too. See [Choosing a colour space](../docs/api.md#choosing-a-colour-space).
- **`dither`** lowers per-pixel scores by design. Its value is visual: it removes banding in smooth gradients at low colour counts. It doesn't change the palette; the quantize takes longer (78 against 55 ms at k = 64), because dithered pixels miss the colour memo more often.
