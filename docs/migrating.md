# Migrating

Upgrading from an earlier major version, and replacing names deprecated along the way. The full list of changes in every release is in the [CHANGELOG](../CHANGELOG.md).

## Deprecated in 3.8 (removed in 4.0)

3.8 deprecates the five functions that take a stored clustering, in both entries. They keep working through 3.x, with no warning at run time, and 4.0 removes them. Use the method on the main thread, and a loaded handle off it: `worker.load(clustering)` keeps one copy of the clustering in the worker, so a slider or a batch no longer sends the bytes with every call.

| Deprecated (both entries) | Main thread | Off the thread |
|---|---|---|
| `getPaletteFromClustering(c, k)` | `c.getPalette(k)` | `(await worker.load(c)).getPalette(k)` |
| `getSwatchesFromClustering(c, k)` | `c.getSwatches(k)` | `….getSwatches(k)` |
| `getClusteringInfo(c)` (the function) | `c.getClusteringInfo()` | `….getClusteringInfo()` |
| `quantizeFromClustering(image, c, k)` | `c.quantize(image, k)` | `….quantize(image, k)` |
| `quantizeToIndicesFromClustering(image, c, k)` | `c.quantizeToIndices(image, k)` | `….quantizeToIndices(image, k)` |

- **The methods give the same results, defaults and errors.** The image still comes first in the mapping methods, as in the function forms. A clustering read from storage has no methods until `new Clustering(bytes)`.
- **A one-off call in a worker** (`await worker.getPaletteFromClustering(c, k)`) becomes `await using loaded = await worker.load(c)` and a call on `loaded`: one copy of the clustering is sent, and you can cut it as often as you like.
- **Mocks and spies:** a mock of the module's `getPaletteFromClustering` doesn't see `clustering.getPalette(k)`; spy on the method of a real clustering instead.
- **`getClusteringInfo` as a function is deprecated, the method is not.** Only `getClusteringInfo(clustering)` goes; `clustering.getClusteringInfo()` and a handle's `getClusteringInfo()` stay.

## Deprecated in 3.4 (removed in 4.0)

3.4.0 gave the three functions that cluster an image verb names, so that from 4.0 a name starting with `get` only reads or cuts what it is given. The old names keep working through 3.x and are removed in 4.0.

| Before 3.4 | From 3.4 |
|---|---|
| `getClustering(image, options?)` | `buildClustering(image, options?)` |
| `getPalette(image, k, options?)` | `buildPalette(image, k, options?)` |
| `getSwatches(image, k, options?)` | `buildSwatches(image, k, options?)` |

- **Replace whole names, at calls that take an image first; nothing else changes.** That is `getPalette(image, …)`, `worker.getPalette(image, …)`, imports and mock factories. A plain-text replace would also rename names that stay (`getPaletteFromClustering`, `getClusteringInfo`, `handle.getClustering()`) to names that don't exist, which plain JavaScript only finds at run time; TypeScript reports them. Each old name is the same function as its new one (`getPalette === buildPalette`), in both entries, both module systems and on every `createWorker()` worker, with the same arguments, options, results and errors. TypeScript marks the old names deprecated, so editors strike them through and lint rules such as `@typescript-eslint/no-deprecated` flag them.
- **Leave the methods alone.** `clustering.getPalette(k)`, `clustering.getSwatches(k)`, `clustering.getClusteringInfo()` and a worker handle's `handle.getClustering()`, `handle.getPalette(k)` and `handle.getSwatches(k)` keep their names: they read what the clustering or handle already holds. So do `getPaletteFromClustering`, `getSwatchesFromClustering` and `getClusteringInfo`, through 3.x.
- **Update mock factories and spies with the call sites.** The two names are one function, but a mock replaces only the name it lists: a `vi.mock` factory that gives `getPalette` leaves `buildPalette` out, so a call through the new name fails (Vitest says `No "buildPalette" export is defined on the "agglomerative-clustering" mock`).
- **A class that implements `AgglomerativeWorker`** (a typed fake, or a wrapper) needs both names until 4.0: add `buildClustering`, `buildPalette` and `buildSwatches`, and keep the old three, which the interface still lists. Renaming them instead gives "missing … getClustering, getPalette, getSwatches". A fake that types itself as `Pick<AgglomerativeWorker, 'buildPalette' | 'cluster'>`, listing only the members your code calls, is spared this churn. Calls to the old names on your own class are flagged by `no-deprecated` as well, because TypeScript carries the tag over from the interface.

## From 2.x to 3.0

The code in this section uses the names of 3.0 to 3.3. From 3.4, write `buildClustering`, `buildPalette` and `buildSwatches` for them (see above).

3.0 keeps every function and default except one rename, and palettes and quantized images are byte-identical to 2.0. What changes:

- **`quantizeWithClustering` is now `quantizeFromClustering`.** The same arguments and behaviour; find and replace the name. It makes one word mean "the colours come from a clustering" (see "How it works" in the [README](../README.md#how-it-works)).

- **Clustering format.** `getClustering` writes format version 3, which records weights and merge costs: 21 bytes per distinct colour instead of 9, so clusterings are about 2.3 times larger. Clusterings saved by 2.x still load; the palette and mapping functions read them, but `getSwatchesFromClustering` and `getClusteringInfo` need a 3.x clustering (2.x recorded no weights) and reject a 2.x one with `unsupported-version`. **Clusterings saved by 1.x are no longer read.** They had no header and could only be recognised by their length, which many other byte strings share, so a palette passed in place of a clustering was accepted and returned nonsense. Cluster the image again (the README has always suggested storing the clustering next to the image). **2.x cannot read 3.x clusterings** (it rejects them as invalid), so if clusterings are stored where an older version of the package may still read them, upgrade the readers first. Code that read the header bytes itself (the colour space was `clustering[2]`) reads the wrong fields now: use `clustering.getClusteringInfo()` (the function form `getClusteringInfo(clustering)` in 3.0 to 3.7), which gives the colour space, precision and number of colours of a 3.x clustering. For a 2.x one, a palette cut from it carries its colour space (from 3.8, `(await clustering.getPalette(1)).colorSpace`; in 3.0 to 3.7, `(await getPaletteFromClustering(clustering, 1)).colorSpace`).
- **A palette made in OKLab maps in OKLab.** `getPalette` and the other functions now return a `Palette`, which remembers its colour space, and `quantizeWithPalette` / `quantizeToIndicesWithPalette` match in it unless you name another. In 2.x they matched in RGB, so `quantizeWithPalette(image, await getPalette(image, k, { colorSpace: 'oklab' }))` now gives a different (OKLab-matched) image. This is the only call whose output changes from 2.0 (checked by comparing 2.0.0 with 3.0 over 1,600 random cases); RGB palettes, plain bytes, `quantize` and `quantizeFromClustering` give byte-identical results. It applies to an OKLab palette however you got it, including one cut from a stored 2.x OKLab clustering with `getPaletteFromClustering` (which now maps as `quantizeFromClustering` always did). To get the 2.x result, pass `colorSpace: 'rgb'`.
- **If you store palettes, store their colour space too.** A palette read back from storage (JSON, a database, `slice`, `structuredClone`) is plain bytes, and plain bytes are matched in RGB. So in 3.0 an OKLab palette maps one way when it is fresh and another way when it comes from your cache (in 2.x both matched in RGB). Store `palette.colorSpace` with the bytes and restore with `new Palette(bytes, colorSpace)`, or pass `colorSpace` when you map.
- **TypeScript: clusterings are a `Clustering`.** `getClustering` returns one, and the functions that take a clustering are typed to want one, so bytes you stored and read back need `new Clustering(bytes)` (JavaScript still accepts plain bytes). Palettes come back as `Palette`, which is a `Uint8Array` as before.
- **Stricter input.** Image data that isn't a whole number of pixels, and palettes that aren't whole RGB triples, now throw instead of being truncated. A bare `Uint8Array` that is really the bytes of an image file (PNG, JPEG, …) is rejected instead of being read as pixels, and a `width` option that disagrees with the image's own width is an error.
- **Node 20.19+ or 22.12+.** The CommonJS build needs Node's `require()` of ES modules.
- **Package exports.** The package exports `.`, `./worker` and `./clustering.wasm` (and `./package.json`); deep imports into `dist/` aren't available (as in 2.x). TypeScript users get separate declarations for `import` and `require`.
- **In CommonJS, a missed rename fails late.** `require('agglomerative-clustering').quantizeWithClustering` is `undefined`, so the error is a plain "is not a function" when it is called. Search for the name rather than waiting for the error.
- **New, not breaking:** the worker entry, `signal` and `onProgress`, indexed output, swatches (weights and shares) and the error curve, the `Palette` and `Clustering` types, `version` and `formatVersion`, `transparent` for GIF and palette PNG output, `init({ wasm })`, and a `code` on every error.

## From 1.x to 2.0

2.0 keeps the same functions and defaults (`rgb`, no dithering, exact `precision`). What changes:

- **Palette order.** Palettes come in split order (index 0 is the dominant colour at two colours and keeps its place as the palette grows), rather than in an arbitrary order. For opaque images they contain exactly the same colours as 1.2.
- **Transparency.** RGBA pixels are weighted by opacity, so palettes of images with transparency change: fully transparent pixels no longer contribute. Pass `{ alpha: 'ignore' }` for the 1.x behaviour.
- **Clustering bytes.** Clusterings gain a 4-byte header recording their colour space and precision. Clusterings saved by 1.x load in 2.x but are no longer read in 3.x (cluster the image again). Anything that inspected the raw bytes needs to skip the header.
- **`quantizeFromClustering`** matches in the clustering's colour space unless you pass `colorSpace`.
- **Exact ties** in pixel mapping go to the colour with the smaller RGB value, so results don't depend on palette order. A small number of pixels that sit exactly between two palette colours may map differently from 1.2.
- **Invalid clusterings** passed to `getPaletteFromClustering` or `quantizeFromClustering` now throw instead of giving an empty palette.
