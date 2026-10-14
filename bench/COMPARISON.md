# Comparison with other palette quantizers

How `agglomerative-clustering` compares with five other JavaScript/WASM palette quantizers on quality and speed.

- **Build:** commit `ef61dea` (2.0 with the faster partner search and pixel mapping). It is the WASM build, compiled with Emscripten 6.0.12.
- **Machine:** Node v22.22.0 on an Intel Xeon at 2.10 GHz, in a shared cloud container.
- **Timings:** each is the median of 3 runs. The whole run took 50 minutes.

The quality figures are identical to the previous run of this comparison (commit `ef16b6b`, before 2.0): the speed-ups don't change any clustering, palette or mapped pixel, and every benchmark image is opaque, so 2.0's palettes hold the same colours, in split order. Only the timings changed. That earlier run was on a different machine (2.80 GHz), so compare speeds within one run, not across runs.

Reproduce with:

```sh
npm run build
node bench/run.js --runs 3 --label comparison
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
- **Speed:** a single palette takes about 100 ms per photo whatever k is. That is as fast as libimagequant at k = 16 (105 ms) and faster from k = 64 up (134–169 ms), and 3.7–15× faster than image-q. Only MMCQ is faster (about 25 ms), but its MSE is 2–3× higher.
- **Several palette sizes:** because one clustering serves every k, all four palettes take 99 ms per photo, against 552 ms for libimagequant and 1.5–3.5 s for image-q.
- **Synthetic images:** agglomerative still has the best PSNR at every k. Wu beats it on noise at k = 64 (by 5–6% MSE) and on the RGB ramp (by up to 2%). libimagequant has better ΔE here at every k. A single palette takes 246–263 ms, slightly faster than libimagequant (261–359 ms); noise has hundreds of thousands of unique colours to cluster. All four palettes take 246 ms, against 1267 ms for libimagequant.

## Kodak (24 photos, 768×512)

PSNR and ΔE are means over images. Times are medians per image.

| k | Library | PSNR dB | ΔE2000 | MSE ratio | Wins | Palette ms | Quantize ms | Own-map PSNR |
|---|---|---|---|---|---|---|---|---|
| 16 | **agglomerative** | **29.98** | **4.31** | 1.00 | – | 100 | 107 | **29.98** |
| 16 | image-q wuquant | 29.84 | 4.47 | 1.03 | 4/24 | 646 | 1139 | 28.59 |
| 16 | libimagequant | 29.74 | 4.39 | 1.06 | 5/24 | 105 | 130 | 29.42 |
| 16 | image-q neuquant | 28.15 | 4.86 | 1.52 | 0/24 | 370 | 882 | 27.16 |
| 16 | mmcq | 26.57 | 6.08 | 2.19 | 0/24 | 33 | – | – |
| 16 | image-q rgbquant | 25.84 | 6.68 | 2.59 | 0/24 | 392 | 933 | 24.15 |
| 64 | **agglomerative** | **35.72** | **2.56** | 1.00 | – | 97 | 101 | **35.72** |
| 64 | image-q wuquant | 35.51 | 2.61 | 1.05 | 0/24 | 740 | 1261 | 34.00 |
| 64 | libimagequant | 35.39 | 2.58 | 1.08 | 0/24 | 134 | 195 | 34.92 |
| 64 | image-q neuquant | 34.41 | 2.78 | 1.35 | 0/24 | 609 | 1151 | 33.04 |
| 64 | mmcq | 32.53 | 3.55 | 2.08 | 0/24 | 24 | – | – |
| 64 | image-q rgbquant | 31.95 | 3.69 | 2.38 | 0/24 | 385 | 937 | 30.00 |
| 128 | **agglomerative** | **38.16** | **2.06** | 1.00 | – | 93 | 107 | **38.16** |
| 128 | image-q wuquant | 37.88 | 2.11 | 1.07 | 0/24 | 848 | 1484 | 36.18 |
| 128 | libimagequant | 37.75 | **2.06** | 1.10 | 0/24 | 149 | 242 | 37.21 |
| 128 | image-q neuquant | 37.38 | 2.19 | 1.20 | 0/24 | 923 | 1527 | 35.81 |
| 128 | image-q rgbquant | 34.92 | 2.85 | 2.11 | 0/24 | 391 | 1000 | 33.00 |
| 128 | mmcq | 34.73 | 2.98 | 2.20 | 0/24 | 25 | – | – |
| 256 | **agglomerative** | **40.49** | 1.67 | 1.00 | – | 106 | 116 | **40.49** |
| 256 | image-q wuquant | 40.05 | 1.73 | 1.11 | 0/24 | 1132 | 1787 | 38.17 |
| 256 | libimagequant | 39.99 | **1.65** | 1.12 | 0/24 | 169 | 267 | 39.38 |
| 256 | image-q neuquant | 39.46 | 1.79 | 1.27 | 0/24 | 1537 | 2247 | 37.70 |
| 256 | image-q rgbquant | 37.21 | 2.29 | 2.13 | 0/24 | 377 | 1084 | 35.17 |
| 256 | mmcq | 35.92 | 2.71 | 2.87 | 0/24 | 26 | – | – |

At k = 16, the photos where another library has lower MSE are:
- **Wu:** kodim01 (−2.9%), kodim17 (−2.7%), kodim20 (−3.6%) and kodim22 (−3.0%).
- **libimagequant:** kodim04 (−4.2%), kodim06 (−0.3%), kodim07 (−2.0%), kodim11 (−0.4%) and kodim22 (−3.0%).

Palettes for every k in {16, 64, 128, 256}, median ms per photo:

| Library | All k ms | How |
|---|---|---|
| **agglomerative** | **99** | One clustering, cut per k |
| mmcq | 120 | Sum of per-k palettes |
| libimagequant | 552 | Sum of per-k palettes |
| image-q rgbquant | 1535 | Sum of per-k palettes |
| image-q wuquant | 3387 | Sum of per-k palettes |
| image-q neuquant | 3461 | Sum of per-k palettes |

## Synthetic (5 images)

The images are gradient-hsv, gradient-rgb, graphic, noise-512 and noise-1024. Five images is a small sample, so read these as indicative.

| k | Library | PSNR dB | ΔE2000 | MSE ratio | Wins | Palette ms | Quantize ms | Own-map PSNR |
|---|---|---|---|---|---|---|---|---|
| 16 | **agglomerative** | **24.13** | 8.51 | 1.00 | – | 246 | 254 | **24.13** |
| 16 | image-q wuquant | 23.88 | 8.50 | 1.06 | 1/5 | 641 | 1038 | 22.56 |
| 16 | libimagequant | 23.62 | **8.19** | 1.12 | 0/5 | 261 | 294 | 23.39 |
| 16 | image-q neuquant | 23.25 | 8.62 | 1.22 | 0/5 | 330 | 708 | 21.91 |
| 16 | image-q rgbquant | 21.11 | 10.83 | 2.01 | 0/5 | 939 | 1832 | 18.60 |
| 16 | mmcq | 20.03 | 10.65 | 2.57 | 0/5 | 31 | – | – |
| 64 | **agglomerative** | **30.05** | 4.91 | 1.00 | – | 263 | 264 | **30.05** |
| 64 | image-q wuquant | 29.66 | 4.86 | 1.09 | 3/5 | 782 | 1234 | 28.34 |
| 64 | libimagequant | 29.06 | **4.77** | 1.25 | 0/5 | 295 | 370 | 28.79 |
| 64 | image-q neuquant | 28.43 | 5.17 | 1.45 | 0/5 | 564 | 977 | 26.87 |
| 64 | image-q rgbquant | 27.44 | 6.50 | 1.82 | 0/5 | 982 | 1894 | 25.40 |
| 64 | mmcq | 26.24 | 5.79 | 2.40 | 0/5 | 32 | – | – |
| 128 | **agglomerative** | **32.92** | 3.79 | 1.00 | – | 249 | 272 | **32.92** |
| 128 | libimagequant | 32.17 | **3.54** | 1.19 | 0/5 | 359 | 410 | 32.01 |
| 128 | image-q wuquant | 31.87 | 3.91 | 1.27 | 0/5 | 864 | 1350 | 30.06 |
| 128 | image-q neuquant | 30.48 | 4.00 | 1.75 | 0/5 | 936 | 1252 | 29.03 |
| 128 | image-q rgbquant | 30.13 | 5.65 | 1.90 | 0/5 | 942 | 1867 | 27.96 |
| 128 | mmcq | 28.96 | 4.31 | 2.49 | 0/5 | 22 | – | – |
| 256 | **agglomerative** | **36.19** | 2.84 | 1.00 | – | 262 | 259 | **36.19** |
| 256 | libimagequant | 35.12 | **2.75** | 1.28 | 0/5 | 351 | 431 | 34.84 |
| 256 | image-q wuquant | 34.23 | 2.92 | 1.57 | 1/5 | 1049 | 1865 | 32.44 |
| 256 | image-q neuquant | 32.48 | 3.10 | 2.35 | 0/5 | 1527 | 1880 | 30.87 |
| 256 | image-q rgbquant | 32.35 | 5.21 | 2.42 | 0/5 | 917 | 1949 | 30.07 |
| 256 | mmcq | 31.44 | 3.34 | 2.98 | 0/5 | 22 | – | – |

Wu's wins are noise-512 (−6.5% MSE) and noise-1024 (−5.4%) at k = 64, and gradient-rgb at k = 16, 64 and 256 (−0.5%, −1.5% and −2.2%).

Palettes for every k in {16, 64, 128, 256}, median ms per image:

| Library | All k ms | How |
|---|---|---|
| mmcq | 99 | Sum of per-k palettes |
| **agglomerative** | **246** | One clustering, cut per k |
| libimagequant | 1267 | Sum of per-k palettes |
| image-q neuquant | 3272 | Sum of per-k palettes |
| image-q wuquant | 3333 | Sum of per-k palettes |
| image-q rgbquant | 3781 | Sum of per-k palettes |

## Caveats

- **Defaults only.** Every library ran with its default settings. libimagequant at a slower speed setting, or image-q with other colour-distance options, would trade time for quality.
- **Noisy timings.** These are wall-clock medians on a shared cloud machine and can vary by about ±10% between runs. Rankings separated by less than that aren't meaningful.
- **Ward's criterion favours MSE and PSNR.** It minimises squared RGB error, which is exactly what MSE and PSNR measure. ΔE2000 is the fairer metric for comparing with libimagequant, which tunes for perceived colour.
- **Quantize ms differs by design.** It uses each library's own pixel mapping: dithering is off for libimagequant, and image-q's defaults are used. So it measures each library's whole pipeline rather than palette quality.

## Options

These are the `precision`, `colorSpace` and `dither` options, measured on the same machine with `--libs libimagequant --runs 3` and builds passed as `--ac name=dist/index.mjs#option=value`. PSNR and ΔE2000 here are for each build's own quantize output, so OKLab palettes are also matched in OKLab. Kodak means:

| Setting | PSNR k=16 | ΔE k=16 | ΔE k=64 | ΔE k=128 | ΔE k=256 | Palette ms (k=64) | All k ms |
|---|---|---|---|---|---|---|---|
| default (`rgb`, `precision: 8`) | 29.98 | 4.31 | 2.56 | 2.06 | 1.67 | 102 | 97 |
| `precision: 6` | 30.03 | 4.29 | 2.56 | 2.06 | 1.68 | 31 | 31 |
| `precision: 5` | 30.03 | 4.24 | 2.56 | 2.08 | 1.74 | 11 | 12 |
| `colorSpace: 'oklab'` | 29.31 | 4.46 | 2.54 | 2.01 | 1.60 | 104 | 103 |
| `colorSpace: 'oklab', precision: 6` | 29.26 | 4.44 | 2.55 | 2.02 | 1.61 | 39 | 39 |
| `dither: true` | 26.55 | 5.06 | 3.31 | 2.68 | 2.15 | 94 | 101 |
| libimagequant | 29.42 | 4.38 | 2.54 | 2.02 | 1.61 | 147 | 575 |

All rows are from one run (`bench/run.js --libs libimagequant --runs 3`, commit `ef61dea`). With the faster search, exact OKLab now clusters as fast as RGB.

- **`precision: 6`** is about 3× faster than exact at practically the same quality. On the synthetic set it is about 7× faster (33 vs 238 ms at k = 64), and noise-1024 drops from 2.9 s to 0.8 s.
- **`colorSpace: 'oklab'`** gives the lowest ΔE2000 from k = 128 up on photos, and at every k on the synthetic set (k = 64: 4.48 against libimagequant's 4.66 and RGB's 4.91), at the cost of 0.3–1 dB PSNR. At k = 16 on photos RGB is better.
- **`dither`** lowers per-pixel scores by design. Its value is visual: it removes banding in smooth gradients at low colour counts, as in `docs/palette-sizes.png`. Quantize time rises because dithered pixels miss the colour memo more often.
