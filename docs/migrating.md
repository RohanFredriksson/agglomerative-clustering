# Migrating

Upgrading from an earlier major version. The full list of changes in every release is in the [CHANGELOG](../CHANGELOG.md).

## From 2.x to 3.0

3.0 keeps every function and default except one rename, and palettes and quantized images are byte-identical to 2.0. What changes:

- **`quantizeWithClustering` is now `quantizeFromClustering`.** The same arguments and behaviour; find and replace the name. It makes one word mean "the colours come from a clustering" (see "The idea in one minute" in the [README](../README.md#the-idea-in-one-minute)).

- **Clustering format.** `getClustering` writes format version 3, which records weights and merge costs: 21 bytes per distinct colour instead of 9, so clusterings are about 2.3 times larger. Clusterings saved by 2.x still load; `getSwatchesFromClustering` needs a 3.x clustering, and `getClusteringInfo` gives `null` weights, `mse` and `explained` for a 2.x one. **Clusterings saved by 1.x are no longer read.** They had no header and could only be recognised by their length, which many other byte strings share, so a palette passed in place of a clustering was accepted and returned nonsense. Cluster the image again (the README has always suggested storing the clustering next to the image). **2.x cannot read 3.x clusterings** (it rejects them as invalid), so if clusterings are stored where an older version of the package may still read them, upgrade the readers first. Anything that read the raw bytes needs the new layout (see [CLAUDE.md](../CLAUDE.md)).
- **A palette made in OKLab maps in OKLab.** `getPalette` and the other functions now return a `Palette`, which remembers its colour space, and `quantizeWithPalette` / `quantizeToIndicesWithPalette` match in it unless you name another. In 2.x they matched in RGB, so `quantizeWithPalette(image, await getPalette(image, k, { colorSpace: 'oklab' }))` now gives a different (OKLab-matched) image. This is the only call whose output changes from 2.0 (checked by comparing 2.0.0 with 3.0 over 1,600 random cases); RGB palettes, plain bytes, `quantize`, `quantizeFromClustering` and every clustering made by 2.x give byte-identical results. To get the 2.x result, pass `colorSpace: 'rgb'`.
- **TypeScript: clusterings are a `Clustering`.** `getClustering` returns one, and the functions that take a clustering are typed to want one, so bytes you stored and read back need `new Clustering(bytes)` (JavaScript still accepts plain bytes). Palettes come back as `Palette`, which is a `Uint8Array` as before.
- **Stricter input.** Image data that isn't a whole number of pixels, and palettes that aren't whole RGB triples, now throw instead of being truncated. A bare `Uint8Array` that is really the bytes of an image file (PNG, JPEG, …) is rejected instead of being read as pixels, and a `width` option that disagrees with the image's own width is an error.
- **Node 20.19+ or 22.12+.** The CommonJS build needs Node's `require()` of ES modules.
- **Package exports.** The package now exports `.`, `./worker` and `./clustering.wasm` (and `./package.json`); other deep imports are not available. TypeScript users get separate declarations for `import` and `require`.
- **New, not breaking:** the worker entry, `signal` and `onProgress`, indexed output, swatches (weights and shares) and the error curve, the `Palette` and `Clustering` types, `version` and `formatVersion`, `transparent` for GIF and palette PNG output, `init({ wasm })`, and a `code` on every error.

## From 1.x to 2.0

2.0 keeps the same functions and defaults (`rgb`, no dithering, exact `precision`). What changes:

- **Palette order.** Palettes come in split order (index 0 is the dominant colour at two colours and keeps its place as the palette grows), rather than in an arbitrary order. For opaque images they contain exactly the same colours as 1.2.
- **Transparency.** RGBA pixels are weighted by opacity, so palettes of images with transparency change: fully transparent pixels no longer contribute. Pass `{ alpha: 'ignore' }` for the 1.x behaviour.
- **Clustering bytes.** Clusterings gain a 4-byte header recording their colour space and precision. Clusterings saved by 1.x load in 2.x but are no longer read in 3.x (cluster the image again). Anything that inspected the raw bytes needs to skip the header.
- **`quantizeFromClustering`** matches in the clustering's colour space unless you pass `colorSpace`.
- **Exact ties** in pixel mapping go to the colour with the smaller RGB value, so results don't depend on palette order. A small number of pixels that sit exactly between two palette colours may map differently from 1.2.
- **Invalid clusterings** passed to `getPaletteFromClustering` or `quantizeFromClustering` now throw instead of giving an empty palette.
