# Changelog

## 3.0.0 (unreleased)

Every function and default from 2.0 is unchanged, and palettes and quantized images are byte-identical to 2.0.0. The clustering format is new, and so are the worker entry, weights, the error curve and indexed output. See "Migrating from 2.x" in the README.

### Added
- **Worker entry, `agglomerative-clustering/worker`.** The same functions, run in a Web Worker (browsers) or worker thread (Node) so clustering doesn't block the calling thread. `createWorker()` starts a worker of its own. Its `cluster(image)` returns a handle that keeps the image and its clustering in the worker, so re-cutting (`getPalette`, `getPaletteWeights`) and re-mapping (`quantize`, `quantizeToIndices`) copy nothing across. Results are transferred rather than copied, inputs too with `createWorker({ transfer: true })`, and an idle worker never keeps a Node process alive.
- **Palette weights:** `getPaletteWeights(clustering, k)` gives each palette colour's weight in pixels (opacity-weighted, as in clustering).
- **Clustering info and error curve:** `getClusteringInfo(clustering)` gives a clustering's format version, colour space, precision, number of colours, total weight, and `errors`, the mean squared error per channel at every palette size, for choosing a size by error.
- **Indexed output:** `quantizeToIndices`, `quantizeToIndicesWithClustering` and `quantizeToIndicesWithPalette` return `{ palette, indices, transparentIndex }` instead of a mapped image: one palette index per pixel (`Uint8Array` up to 256 entries, `Uint16Array` up to 65536, else `Uint32Array`), for palette PNGs, pixel art and pattern generators. The indices pick out exactly the colours the matching `quantize*` call gives.
- **`transparentIndex` option** for indexed output: fully transparent pixels get their own entry, appended after the palette, instead of their nearest colour.

### Changed
- **Clustering format version 3.** A self-describing 13-byte header (magic byte, version, header and record lengths, colour space, precision, weight unit and total weight), then 21-byte records that add each split's parent, lighter-half weight and Ward cost to its colours. Clusterings are about 2.3 times larger than 2.x's. 1.x and 2.x clusterings still load, and a clustering from a newer format version is rejected with an error asking for an upgrade. Future versions follow the rules in `docs/ROADMAP.md`, so their clusterings can never be mistaken for older formats.
- `package.json` declares `engines: { node: "^20.19.0 || >=22.12.0" }`. The CommonJS build loads the WebAssembly glue through `require()` of an ES module, which older Node versions don't support. CI now tests Node 20, 22 and 24, including the CommonJS entry.
- The published WebAssembly is built with Emscripten 6.0.12 (was 4.0.10), the version the benchmarks were measured with. Output is identical, speed is the same within run-to-run variation, and the module is 2.4 KB smaller.
- The WebAssembly module grows from 75 KB to 84 KB, mostly because pixel mapping is now compiled for both colour and index output. Clustering and mapping speed are unchanged.

### Fixed
- A `Uint8ClampedArray` that is a view into part of a larger buffer (such as a `subarray`) was read from the start of the whole buffer, so `RawImage` data given that way was clustered and quantized from the wrong bytes. Only the view's own bytes are read now.
- Image data whose length isn't a whole number of pixels (a multiple of 4 for RGBA, 3 for RGB) was silently truncated, giving a shorter output. It is now rejected with `Invalid image data`.
- `quantizeWithPalette` checks its palette: anything other than a `Uint8Array`, `Uint8ClampedArray` or array, or a length that isn't a multiple of 3, is rejected with `Invalid palette` instead of being truncated or failing with an unrelated error. An empty palette is still accepted.
- The README gave 2.0's WebAssembly module size as 65 KB; it was 75 KB.

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
