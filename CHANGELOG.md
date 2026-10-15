# Changelog

## 2.0.0

The same functions and defaults (`rgb`, no dithering, `precision: 8`), with these changes. See "Migrating from 1.x" in the README.

### Performance
- **Faster clustering, with identical output.** On the Kodak photos (WASM, Node 22), one palette takes about 100 ms instead of 155 ms, and with `colorSpace: 'oklab'` about 110 ms instead of 250 ms, so OKLab now costs no more than RGB. `precision: 6` takes about 30 ms. The partner search's grid comes in sizes between powers of two with coarser cells, steps over empty cells with per-column occupancy bits, tests cells with a division-free float bound, and starts each search from a known partner.
- **Faster pixel mapping, with identical output.** For palettes up to 256 colours, lookups go through a grid whose cells (built on first use) list the palette entries that can be nearest there, instead of the KD-tree, and dithering in OKLab memoises colour conversions. `quantizeWithPalette` at 64 colours takes about 6 ms per photo instead of 15 ms; a dithered `quantize` about 150 ms instead of 250–325 ms.
- Every clustering, palette and quantized image is byte-identical to before.
- The WebAssembly module grows from 58 KB to 65 KB.

### Changed
- **Palettes come in split order.** Index 0 is the dominant colour, and the palette for `k + 1` is the palette for `k` with one entry refined (the heavier half of a split keeps its parent's place) and the lighter half appended. For opaque images the colours are exactly those of 1.2, in this order.
- **Alpha weighting, `alpha: 'weight'` (the new default).** RGBA pixels count in proportion to their opacity: fully transparent pixels are ignored and semi-transparent ones count partially. Opaque images, and images whose pixels are all fully opaque or fully transparent, use exact pixel counts. `alpha: 'ignore'` restores the 1.x behaviour.
- **Clusterings carry a 4-byte header:** a magic byte, the format version, the colour space and the precision. Merge records list the heavier child first. 1.x clusterings still load: they are 0 or 3 bytes more than a multiple of 9, where 2.0's are 4 or 7.
- **`quantizeWithClustering` matches in the clustering's colour space** by default. An explicit `colorSpace` overrides it.
- **Pixel mapping breaks exact ties by the smaller packed RGB value,** so results don't depend on palette order. Mapping is a few percent slower as a result.
- **Invalid clusterings** now throw `Invalid clustering` instead of giving an empty palette.
- An empty or fully transparent image gives a clustering of just the header.

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
