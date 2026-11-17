/** How pixel bytes are laid out: `'rgb'` is 3 bytes per pixel, `'rgba'` is 4 (red, green, blue, alpha). */
export type ImageFormat = 'rgb' | 'rgba';

/**
 * What went wrong, on the `code` of every error this library throws (the message is for people and may change):
 * `invalid-argument` (image, k, options or palette), `invalid-clustering`, `unsupported-version` (a clustering from a
 * newer format version or one using a colour space it doesn't know, or an older one that lacks what was asked for),
 * `out-of-memory`, `wasm-load-failed` (the WebAssembly module could not be loaded or compiled: a missing or blocked file, a
 * browser without SIMD, or a `.wasm` from another version of the library), and in the worker entry
 * `worker-terminated`, `worker-failed` and `invalid-handle`.
 */
export type ErrorCode = 'invalid-argument' | 'invalid-clustering' | 'unsupported-version' | 'out-of-memory' | 'wasm-load-failed'
    | 'worker-terminated' | 'worker-failed' | 'invalid-handle';

/**
 * Which argument an error is about, for programs (the message is for people and may change): the image, `k`, the
 * clustering or palette, the options object as a whole, or one option as `options.<name>` (for example
 * `'options.colorSpace'`). `colorSpace` is the second argument of `new Palette(source, colorSpace)`.
 */
export type ErrorArgument = 'image' | 'k' | 'clustering' | 'palette' | 'colorSpace' | 'options' | `options.${string}`;

/** An `Error` thrown by this library. There is no class to test with `instanceof`: check `code`. */
export interface CodedError extends Error {
    code: ErrorCode;
    /**
     * Which argument the error is about, when it is about one (most `invalid-argument`, `invalid-clustering` and
     * `unsupported-version` errors), so a form can point at the right field. Absent otherwise (a failed load, running
     * out of memory, the worker's state).
     */
    argument?: ErrorArgument;
}

/**
 * An image as raw bytes with an explicit layout: for RGB data, a `Uint8ClampedArray`, or Node, where there is no
 * `ImageData`. Functions that return an image give back an object of this shape with the same `format`.
 */
export interface RawImage {
    data: Uint8Array | Uint8ClampedArray;
    format: ImageFormat;
    /** Width in pixels. Optional; used for dithering, and copied to `quantize*` results. */
    width?: number | undefined;
    /** Height in pixels. Optional; copied to `quantize*` results. */
    height?: number | undefined;
}

/**
 * The platform's `ImageData` class where the global exists (the DOM lib, or typings for a canvas polyfill), and `never`
 * where it doesn't, so these declarations compile with or without the DOM lib, in browser and Node-only projects.
 */
export type PlatformImageData = typeof globalThis extends { ImageData: { prototype: infer T } } ? T : never;

/** What a function that returns an image gives back for the input it was given: the same kind of thing. */
export type ImageResult<I extends ImageLike> =
    I extends Uint8Array ? Uint8Array
    : I extends RawImage ? RawImage
    : I extends PlatformImageData ? PlatformImageData
    : never;

/** Raw RGBA bytes, `ImageData`, or `{ data, format }`. Functions that return an image give back the same kind. */
export type ImageLike = Uint8Array | PlatformImageData | RawImage;

/** `WebAssembly.Module` where the global exists, else `never` (see `PlatformImageData`). */
export type WasmModule = typeof globalThis extends { WebAssembly: { Module: { prototype: infer M } } } ? M : never;

declare const clusteringBrand: unique symbol;

/**
 * A palette: flat RGB bytes (`[r, g, b, r, g, b, …]`) that also know the colour space they were made in. It is an
 * ordinary `Uint8Array` (its `constructor` is `Uint8Array`, so `toEqual(new Uint8Array(…))` in a test passes) with a
 * hidden `colorSpace` tag, so everything that takes bytes (indexing, `length`, `subarray`, encoders, files) takes it.
 * What the tag adds: `quantizeWithPalette` and `quantizeToIndicesWithPalette` match pixels in a palette's own space
 * unless you name another, so a palette made with `colorSpace: 'oklab'` is mapped the way it was made without you
 * having to remember. Every function here that returns a palette returns this. `slice`, `subarray` and structured
 * clones (`postMessage`, storage) give plain `Uint8Array`s without the tag, matched in RGB unless you say otherwise;
 * `new Palette(bytes, 'oklab')` makes one by hand, and `value instanceof Palette` tells.
 */
export class Palette extends Uint8Array {
    /**
     * `source` is bytes (a `Uint8Array`, `Uint8ClampedArray` or plain array of integers 0-255, copied) or a length, whole colours
     * either way (a multiple of 3). It is checked like any palette passed to a function: nothing is coerced into a byte, so
     * `invalid-argument` for `[300, 0, 0]`, a string, or a length that isn't a multiple of 3.
     */
    constructor(source?: ArrayLike<number> | number, colorSpace?: ColorSpace);
    /** The space the colours were made in: how they should be matched. `'rgb'` for a palette built from plain bytes. */
    readonly colorSpace: ColorSpace;
}

/**
 * The bytes of a clustering, as `getClustering` returns them: an opaque `Uint8Array` (tagged, like `Palette`) that you can
 * store (a file, IndexedDB, next to the image) and cut to a palette of any size later. It is a type of its own, so a
 * clustering can't be passed where a palette goes (or the other way round): TypeScript says so, and at run time a
 * `Clustering` given as a palette is rejected, with no guessing about its bytes. Stored bytes come back as a plain
 * `Uint8Array`, which functions still accept at run time; `new Clustering(bytes)` gives them the type back (TypeScript
 * wants it) and checks they are a clustering.
 */
export class Clustering extends Uint8Array {
    /**
     * Bytes (a `Uint8Array`, `Uint8ClampedArray` or plain array of integers 0-255, copied), or a view of a buffer. Throws
     * `invalid-clustering` unless they are a clustering: a number, or anything that isn't bytes, is refused rather than coerced.
     */
    constructor(bytes: Uint8Array | Uint8ClampedArray | readonly number[]);
    constructor(buffer: ArrayBufferLike, byteOffset?: number, length?: number);
    /** Only a type: what makes a `Clustering` different from a palette or other bytes to the compiler. */
    readonly [clusteringBrand]: true;
}

/** What is not a clustering: a `Clustering` is not accepted where a palette is. */
type NotClustering = { readonly [clusteringBrand]?: never };

/**
 * A palette to map with: a `Palette` (which knows its colour space), flat RGB bytes as a plain `Uint8Array` or
 * `Uint8ClampedArray` (matched in RGB unless you name a space), or a plain array of integers from 0 to 255. Not a
 * `Clustering`.
 */
export type PaletteLike = (Palette | Uint8Array | Uint8ClampedArray | readonly number[]) & NotClustering;

/** The space colours are clustered and matched in. */
export type ColorSpace = 'rgb' | 'oklab';

/** How pixel opacity affects clustering. */
export type AlphaMode = 'weight' | 'ignore';

/** Cancelling a call. Every function that takes an image has it; see `RunOptions.signal`. */
export interface CancelOptions {
    /**
     * Cancels the call. A call given a `signal` clusters (where it clusters) in slices of about 10 ms and checks the
     * signal between them, so an abort takes effect within a slice, not after the whole clustering. It rejects with
     * the signal's `reason` (an `AbortError` by default), like `fetch`; note that it is that reason that is thrown, so it
     * has the signal's own `name`, not an `ErrorCode`. A signal that is already aborted does no work. On the functions
     * that only map pixels (`quantizeFromClustering`, `quantizeWithPalette` and their indexed forms) it is checked once,
     * before the call starts, since they take milliseconds. Pixel mapping, which follows the clustering, can't be
     * interrupted. The call's result is the same as without a signal. In the worker entry the worker itself stops
     * working on the call, and a call still waiting its turn never starts.
     */
    signal?: AbortSignal | undefined;
}

/** Cancelling a long call and watching it, for the functions that cluster. Both are optional and can be used apart. */
export interface RunOptions extends CancelOptions {
    /**
     * Called with the fraction done, from 0 to 1, as the call runs: a few times per slice at most, never going
     * backwards, ending with 1. It is approximate and not linear in time. Giving it also makes the call run in
     * slices, so other tasks (such as painting) get a turn while it works.
     */
    onProgress?: ((progress: number) => void) | undefined;
}

/** Options for building the colour hierarchy: `getClustering`, `getPalette`, and the clustering half of `quantize` and `quantizeToIndices`. */
export interface ClusteringOptions extends RunOptions {
    /**
     * `'rgb'` (default) minimises squared sRGB error, which is what MSE/PSNR measure.
     * `'oklab'` clusters in OKLab. Neither is better everywhere: see "Choosing a colour space" in the README.
     */
    colorSpace?: ColorSpace | undefined;
    /**
     * Bits per channel, 1-8 (default 8: every distinct colour is clustered exactly). Lower values group colours
     * that share their top bits before clustering, at their mean colour, which bounds the time spent on images
     * with very many distinct colours. 6 is a good choice for large photos.
     */
    precision?: number | undefined;
    /**
     * How RGBA pixels count. `'weight'` (default): in proportion to their opacity, so fully transparent pixels are
     * ignored and semi-transparent ones count partially. `'ignore'`: every pixel counts fully, as in 1.x.
     */
    alpha?: AlphaMode | undefined;
    /**
     * `false` (default), `true`, or an alpha cutoff from 1 to 255 (`true` means 128), for RGBA images: pixels with alpha
     * below the cutoff don't exist as far as the palette is concerned. They are left out of clustering, and the rest count
     * whole instead of by opacity (so it replaces `alpha` for this call). That is the model of indexed output (GIF, palette
     * PNG), and it gives the same palette everywhere: `getPalette(image, k, { transparent })` is the palette
     * `quantizeToIndices(image, k, { transparent })` uses, apart from that function's extra transparent entry.
     * Cluster with it to get the palette you will map with (see `IndexOptions.transparent`). The cutoff is recorded in the
     * clustering (see `ClusteringInfo.transparent`), and `quantizeToIndicesFromClustering` uses it unless you name one.
     * It replaces `alpha` (with a cutoff, pixels count whole or not at all), so giving both is an `invalid-argument` error.
     */
    transparent?: boolean | number | undefined;
}

/** Options for mapping pixels to a palette: `quantizeFromClustering`, `quantizeWithPalette`, and the mapping half of `quantize` and `quantizeToIndices`. They take `signal` but no `onProgress`: mapping takes milliseconds. */
export interface MappingOptions extends CancelOptions {
    /**
     * The space pixels are matched to their nearest palette colour in. The default is the space the colours were made in:
     * the clustering's in `quantizeFromClustering`, a `Palette`'s own in `quantizeWithPalette` and
     * `quantizeToIndicesWithPalette`; `'rgb'` for plain bytes, and in `quantize` and `quantizeToIndices`, which match in the
     * space they cluster in.
     */
    colorSpace?: ColorSpace | undefined;
    /**
     * Error-diffusion dithering (serpentine Floyd-Steinberg): `false` (default), `true`, or a strength from 0 to 1.
     * Needs the image width: taken from `ImageData` or `RawImage.width`, or given as `width`.
     */
    dither?: boolean | number | undefined;
    /**
     * Image width in pixels, for dithering a `Uint8Array` or a `RawImage` without `width`. An image that has its own
     * `width` (`ImageData`, or a `RawImage` with one) must agree with it: a different value is an `invalid-argument` error.
     */
    width?: number | undefined;
}

/** Clustering and mapping options together, for `quantize`, which does both. */
export type QuantizeOptions = ClusteringOptions & MappingOptions;

/** Options that only the `quantizeToIndices*` functions take. */
export interface IndexOptions {
    /**
     * `false` (default): every pixel gets the index of its nearest colour, whatever its alpha.
     * `true`, or an alpha cutoff from 1 to 255 (`true` means 128): if the image is RGBA and has pixels with alpha
     * below the cutoff, they get an extra entry appended after the palette (black, taking no part in matching), as
     * GIFs and palette PNGs expect; its index is the result's `transparentIndex`. Every other pixel is shown fully
     * opaque in its nearest colour. `k` counts that entry, so `k = 256` gives at most 256 entries (255 colours and the
     * transparent one) and 8-bit indices, the limit of a GIF or palette PNG; at least one colour is always kept. Where
     * this function builds the palette itself it also leaves the pixels below the cutoff out of clustering (see
     * `ClusteringOptions.transparent`), so its palette is `getPalette(image, k - 1, { transparent })`'s. With a palette
     * you supply (`quantizeToIndicesWithPalette`) there is no `k`: the entry is added to your palette as it is. In
     * `quantizeToIndicesFromClustering` the default is the cutoff the clustering was made with.
     */
    transparent?: boolean | number | undefined;
}

/** The options of `quantizeToIndices`: clustering, mapping and indexed-output options. */
export type QuantizeIndexOptions = QuantizeOptions & IndexOptions;
/** The options of `quantizeToIndicesFromClustering` and `quantizeToIndicesWithPalette`: mapping and indexed-output options. */
export type MappingIndexOptions = MappingOptions & IndexOptions;

interface IndexedImageFields {
    /**
     * Flat RGB bytes, one entry per index, including the transparent entry if there is one. Empty for an image with no
     * pixels. An image with pixels but no visible colour has a single black entry, or with `transparent`, just
     * the transparent entry. A `Palette`, so it carries the colour space it was matched in. This is what an encoder wants
     * (a GIF or palette PNG has the transparent entry in its palette); to map with these colours again, use `colors`.
     */
    palette: Palette;
    /**
     * The colours without the transparent entry: `palette` when there is none (`transparentIndex` is `null`), else
     * `palette` up to that entry. Pass it to `quantizeToIndicesWithPalette` to map another image with the same colours, so the
     * transparent entry isn't mistaken for a black colour and added twice.
     */
    colors: Palette;
    /** The index of the entry for fully transparent pixels, or `null` if there is none. */
    transparentIndex: number | null;
    /** Copied from the input, when it is `ImageData` or a `RawImage` with `width`. */
    width?: number;
    /** Copied from the input, when it is `ImageData` or a `RawImage` with `height`. */
    height?: number;
}

/**
 * One palette index per pixel in `indices`: a `Uint8Array` up to 256 palette entries, a `Uint16Array` up to 65536, else a
 * `Uint32Array`. `indexBits` says which (8, 16 or 32), and checking it narrows `indices` to that array type.
 */
export type IndexedImage =
    | (IndexedImageFields & { indexBits: 8; indices: Uint8Array })
    | (IndexedImageFields & { indexBits: 16; indices: Uint16Array })
    | (IndexedImageFields & { indexBits: 32; indices: Uint32Array });

/** Options for `init`, and for `createWorker` (which passes `wasm` on to its worker). */
export interface InitOptions {
    /**
     * Where to get the WebAssembly module, for CDNs, strict CSPs and runtimes that can't fetch or compile it from its
     * default place next to the package's script (Cloudflare Workers, for instance). One of:
     * - a URL or path string, or a `URL`, to the `clustering.wasm` file;
     * - its bytes, as an `ArrayBuffer` or a typed array;
     * - an already compiled `WebAssembly.Module`.
     */
    wasm?: string | URL | ArrayBuffer | ArrayBufferView | WasmModule | undefined;
}

/** The version of this library, as in its `package.json` (for example `'3.0.0'`). The WebAssembly module checks it matches its own when it loads. */
export const version: string;

/**
 * The version of the data this library stores: the format of the clusterings `getClustering` writes (`getClusteringInfo`
 * reports a clustering's own as its `formatVersion`). One integer for the library's stored data, unrelated to `version`: it
 * changes only when the stored format does, so a new release that keeps the format keeps this number. This build reads
 * this format and the one before it (2).
 */
export const formatVersion: 3;

/**
 * Loads the WebAssembly module. Every other function does it on first use, so calling `init` is optional, except to
 * say where the module is (`wasm`), which must come before any other call. The first load that succeeds wins; a
 * failed one can be retried.
 */
export function init(options?: InitOptions): Promise<void>;

/**
 * Builds the colour hierarchy for an image: the expensive step, done once. The result is a `Clustering` (opaque bytes) you can
 * cache or store next to the image. Cut it to a palette of any size with `getPaletteFromClustering`, or map pixels
 * with `quantizeFromClustering`. An image with no visible pixels gives a clustering that cuts to an empty palette.
 */
export function getClustering(image: ImageLike, options?: ClusteringOptions): Promise<Clustering>;

/**
 * A palette of at most `k` colours for `image` (fewer if it has fewer distinct colours), as flat RGB bytes in split
 * order (see `getPaletteFromClustering`). It clusters the image each time: to try several sizes, call `getClustering`
 * once and cut it.
 *
 * @param k The most palette entries in the result (`k` means this in every function). A flat palette has no transparent
 *     entry, so its entries are all colours. Fewer come back when the image has fewer distinct colours.
 */
export function getPalette(image: ImageLike, k: number, options?: ClusteringOptions): Promise<Palette>;

/**
 * Cuts a clustering to at most `k` colours, in split order: index 0 is the dominant colour at two colours and keeps its
 * place as the palette grows (it is not always the heaviest entry of a larger one), and the palette for
 * `k + 1` is the palette for `k` with one entry refined and one colour appended.
 *
 * @param k The most palette entries in the result (`k` means this in every function). A flat palette has no transparent
 *     entry, so its entries are all colours. Fewer come back when the image has fewer distinct colours.
 */
export function getPaletteFromClustering(clustering: Clustering, k: number): Promise<Palette>;

/**
 * A palette with how much of the image each of its colours covers, for swatches with percentages. The three arrays come
 * from one cut of one clustering, so they line up by construction: entry `i` of each describes the same colour.
 */
export interface Swatches {
    /** The colours in split order, exactly what `getPaletteFromClustering` gives for the same `k`. */
    palette: Palette;
    /**
     * Pixels per colour, counted as in clustering: by default fully transparent pixels count 0 and partly transparent ones
     * in proportion to their opacity; with `alpha: 'ignore'` every pixel counts 1; with `transparent`, pixels below the
     * cutoff count 0 and the rest 1. They sum to the image's visible weight.
     */
    weights: Float64Array;
    /** Each colour's share of the visible weight, from 0 to 1. They sum to 1 (they are empty for an image with no visible pixels). */
    shares: Float64Array;
}

/**
 * The palette for `image` at `k` colours with each colour's weight and share: one call for swatches with percentages.
 * It clusters the image each time; if you already have a clustering, use `getSwatchesFromClustering`.
 *
 * @param k The most palette entries in the result (`k` means this in every function). A flat palette has no transparent
 *     entry, so its entries are all colours. Fewer come back when the image has fewer distinct colours.
 */
export function getSwatches(image: ImageLike, k: number, options?: ClusteringOptions): Promise<Swatches>;

/**
 * The same as `getSwatches` from a clustering you already have, so trying another `k` costs well under a millisecond.
 * Needs a clustering from 3.x; a 2.x clustering has no weights and is rejected.
 *
 * @param k The most palette entries in the result (`k` means this in every function). A flat palette has no transparent
 *     entry, so its entries are all colours. Fewer come back when the image has fewer distinct colours.
 */
export function getSwatchesFromClustering(clustering: Clustering, k: number): Promise<Swatches>;

interface ClusteringInfoFields {
    colorSpace: ColorSpace;
    /** Bits per channel it was clustered with. */
    precision: number;
    /**
     * The alpha cutoff (1-255) the clustering was made with (`transparent` in `ClusteringOptions`), or `false` for none. It is
     * the default `transparent` of `quantizeToIndicesFromClustering`, so clustering and mapping agree unless you name another.
     */
    transparent: false | number;
    /** The largest palette it can be cut to: its number of distinct clustered colours (fewer than the image's own when `precision` is below 8). */
    maxColors: number;
}

/** What a 3.x clustering holds. A clustering you just made with `getClustering` is this one: check `formatVersion === 3` to narrow to it. */
export interface ClusteringInfoV3 extends ClusteringInfoFields {
    /** The format of the clustering's bytes: the data version (see `formatVersion`, the one this build writes), not the library's `version`. */
    formatVersion: 3;
    /** Total weight in pixels (opacity-weighted). */
    totalWeight: number;
    /**
     * `mse[k - 1]` is the mean squared error per channel of the k-colour clustering: each pixel's squared
     * distance to its cluster's colour, weighted as in clustering, in 8-bit RGB values (`'rgb'`) or OKLab units
     * (`'oklab'`). `mse[0]` is the image's variance. At `precision: 8`, `mse[maxColors - 1]` is 0; with a lower
     * precision it is the error that grouping colours discarded, which is recorded and included. It is an estimate,
     * computed from merge costs on integer-rounded colours. Mapping pixels to their nearest palette colour usually
     * lowers it by 10-15%.
     */
    mse: Float64Array;
    /**
     * `explained[k - 1]` is the share of the image's variance the k-colour clustering keeps, `1 - mse[k - 1] /
     * mse[0]`: 0 for one colour, rising to 1 at `maxColors`, and 1 throughout for an image of a single colour. It has no
     * units, so a target such as `0.99` means the same in `'rgb'` and `'oklab'`.
     */
    explained: Float64Array;
}

/** What a 2.x clustering holds: no weights, so no error curve. */
export interface ClusteringInfoV2 extends ClusteringInfoFields {
    /** The format of the clustering's bytes (see `ClusteringInfoV3.formatVersion`). */
    formatVersion: 2;
    totalWeight: null;
    mse: null;
    explained: null;
}

/** What `getClusteringInfo` returns: check `formatVersion` to narrow to the 3.x or 2.x shape. */
export type ClusteringInfo = ClusteringInfoV3 | ClusteringInfoV2;

/** Reads what a clustering holds, including its error curve for choosing a palette size. */
export function getClusteringInfo(clustering: Clustering): Promise<ClusteringInfo>;

/**
 * Reduces `image` to at most `k` colours and returns the mapped image as the same kind of thing you gave: a `Uint8Array`
 * for a `Uint8Array`, `ImageData` for `ImageData`, an object with the same `format` for a `RawImage` (`ImageResult`; a
 * value typed as the union `ImageLike` gives the union). Each pixel keeps its own alpha.
 *
 * @param k The most palette entries in the result (`k` means this in every function). A flat palette has no transparent
 *     entry, so its entries are all colours. Fewer come back when the image has fewer distinct colours.
 */
export function quantize<I extends ImageLike>(image: I, k: number, options?: QuantizeOptions): Promise<ImageResult<I>>;

/**
 * Maps `image` to the `k`-colour cut of a clustering you already have, so trying another `k` or another image mapping
 * costs milliseconds. Matches in the clustering's colour space unless `colorSpace` is given. Returns the same kind of
 * thing as `quantize`.
 *
 * @param k The most palette entries in the result (`k` means this in every function). A flat palette has no transparent
 *     entry, so its entries are all colours. Fewer come back when the image has fewer distinct colours.
 */
export function quantizeFromClustering<I extends ImageLike>(image: I, clustering: Clustering, k: number, options?: MappingOptions): Promise<ImageResult<I>>;

/**
 * Maps each pixel of `image` to its nearest colour in a palette you supply (an edited swatch, a brand palette, one cut
 * from a clustering). Pixels are matched in the palette's own colour space if it is a `Palette` (one this library made),
 * so an OKLab palette maps the way `quantizeFromClustering` does; plain bytes carry no space and are matched in RGB. Name a
 * `colorSpace` to override either. Returns the same kind of thing as `quantize`.
 */
export function quantizeWithPalette<I extends ImageLike>(image: I, palette: PaletteLike, options?: MappingOptions): Promise<ImageResult<I>>;

/**
 * Like `quantize`, but returns each pixel's palette index instead of its colour, with the palette (for palette
 * PNGs, pixel art and pattern generators). The palette is the one `getPalette` gives, except that with `transparent`
 * pixels below the cutoff are left out of it.
 *
 * @param k The most palette entries in the result (`k` means this in every function), counting the transparent entry
 *     if there is one, so `256` is the most a GIF or palette PNG holds. Fewer come back when the image has fewer distinct colours.
 */
export function quantizeToIndices(image: ImageLike, k: number, options?: QuantizeIndexOptions): Promise<IndexedImage>;

/**
 * Like `quantizeFromClustering`, but returns palette indices. The palette is `getPaletteFromClustering`'s.
 *
 * @param k The most palette entries in the result (`k` means this in every function), counting the transparent entry
 *     if there is one, so `256` is the most a GIF or palette PNG holds. Fewer come back when the image has fewer distinct colours.
 */
export function quantizeToIndicesFromClustering(image: ImageLike, clustering: Clustering, k: number, options?: MappingIndexOptions): Promise<IndexedImage>;

/** Like `quantizeWithPalette`, but returns indices into `palette`, which is returned too. */
export function quantizeToIndicesWithPalette(image: ImageLike, palette: PaletteLike, options?: MappingIndexOptions): Promise<IndexedImage>;
export {};
