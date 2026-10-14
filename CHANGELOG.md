# Changelog

## 1.2.0

**Palettes differ from 1.1.x.** Clusters are now merged by Ward's method, so results change for practically every image even with default options; see Changed. The new options are all off by default.

### Added
- **`colorSpace: 'oklab'`**: clusters and matches colours in OKLab, where distance tracks perceived difference. It gives lower ΔE2000 from about 128 colours up and on smooth gradients, but lower PSNR. The clustering format is unchanged.
- **`precision` (1–8 bits per channel)**: groups colours that share their top bits before clustering, at their mean colour. `6` is about 3× faster on photos at practically the same quality.
- **`dither`** (`true` or a strength from 0 to 1) on `quantize`, `quantizeWithClustering` and `quantizeWithPalette`: serpentine Floyd–Steinberg error diffusion. It needs the image width, from `ImageData`, `RawImage.width` or the `width` option. Fully transparent pixels are left undithered.
- Every function that takes an image accepts these as an optional trailing `options` object. Unknown option names are rejected.
- `RawImage` accepts optional `width` and `height`, which are copied to `quantize*` results.
- `npm run demo`: an interactive page that clusters once and re-cuts on a palette-size slider.

### Changed
- **Clusters merge by Ward's method.** Each merge joins the two clusters whose merge adds the least squared error, `n_a·n_b/(n_a+n_b)·‖a−b‖²`, instead of the two nearest centroids, and the hierarchy is built exactly with a nearest-neighbour chain. Palettes are more accurate (see `bench/COMPARISON.md`) but differ from 1.1.x. Code that compares stored palettes or clusterings with 1.1.x output will see changes. Clusterings saved by 1.1.x still load, since the format is unchanged.
- **Faster partner search.** A spatial grid with SIMD Ward costs, pruning by each cell's colour box and a float pre-filter make the Ward search interactive: about 150–200 ms for a 768×512 photo.
- **Faster histogram and mapping.** The colour histogram is an open-addressing table, and pixel mapping memoises recent colours.
- The WebAssembly module grows from 41 KB to 55 KB.

### Fixed
- An image with no pixels aborted the WebAssembly module and left it unusable for the rest of the process. It now gives an empty clustering and palette.
