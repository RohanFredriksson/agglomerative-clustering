/** How pixel bytes are laid out: `'rgb'` is 3 bytes per pixel, `'rgba'` is 4 (red, green, blue, alpha). */
export type ImageFormat = 'rgb' | 'rgba';

/**
 * What went wrong, on the `code` of every error this library throws (the message is for people and may change):
 * `invalid-argument` (image, k, options or palette), `invalid-clustering`, `unsupported-version` (a clustering from a
 * newer format version or one using a colour space it doesn't know, or an older one that lacks what was asked for),
 * `out-of-memory`, `wasm-load-failed` (the WebAssembly module could not be loaded or compiled: a missing or blocked file, a
 * browser without SIMD), and in the worker entry
 * `worker-terminated`, `worker-failed` and `invalid-handle`.
 */
export type ErrorCode = 'invalid-argument' | 'invalid-clustering' | 'unsupported-version' | 'out-of-memory' | 'wasm-load-failed'
    | 'worker-terminated' | 'worker-failed' | 'invalid-handle';

/** An `Error` thrown by this library. There is no class to test with `instanceof`: check `code`. */
export interface CodedError extends Error {
    code: ErrorCode;
}

/**
 * An image as raw bytes with an explicit layout: for RGB data, a `Uint8ClampedArray`, or Node, where there is no
 * `ImageData`. Functions that return an image give back an object of this shape with the same `format`.
 */
export interface RawImage {
    data: Uint8Array | Uint8ClampedArray;
    format: ImageFormat;
    /** Width in pixels. Optional; used for dithering, and copied to `quantize*` results. */
    width?: number;
    /** Height in pixels. Optional; copied to `quantize*` results. */
    height?: number;
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

/** A palette to map with: flat RGB bytes, as a `Uint8Array` (what every function here returns), a `Uint8ClampedArray`, or a plain array of integers from 0 to 255. */
export type PaletteLike = Uint8Array | Uint8ClampedArray | readonly number[];

/** The space colours are clustered and matched in. */
export type ColorSpace = 'rgb' | 'oklab';

/** How pixel opacity affects clustering. */
export type AlphaMode = 'weight' | 'ignore';

/** Cancelling a long call and watching it. Both are optional and can be used apart. */
export interface RunOptions {
    /**
     * Cancels the call. A call given a `signal` (or an `onProgress`) clusters in slices of about 10 ms and checks the
     * signal between them, so an abort takes effect within a slice, not after the whole clustering. It rejects with
     * the signal's `reason` (an `AbortError` by default), like `fetch`. Pixel mapping, which follows the
     * clustering, can't be interrupted: it takes a few milliseconds for typical images. The call's result is the
     * same as without a signal. In the worker entry the worker itself stops working on the call.
     */
    signal?: AbortSignal;
    /**
     * Called with the fraction done, from 0 to 1, as the call runs: a few times per slice at most, never going
     * backwards, ending with 1. It is approximate and not linear in time. Giving it also makes the call run in
     * slices, so other tasks (such as painting) get a turn while it works.
     */
    onProgress?(progress: number): void;
}

/** Options for building the colour hierarchy: `getClustering`, `getPalette`, and the clustering half of `quantize` and `quantizeToIndices`. */
export interface ClusteringOptions extends RunOptions {
    /**
     * `'rgb'` (default) minimises squared sRGB error, which is what MSE/PSNR measure.
     * `'oklab'` clusters in OKLab, where distances track perceived colour difference.
     */
    colorSpace?: ColorSpace;
    /**
     * Bits per channel, 1-8 (default 8: every distinct colour is clustered exactly). Lower values group colours
     * that share their top bits before clustering, at their mean colour, which bounds the time spent on images
     * with very many distinct colours. 6 is a good choice for large photos.
     */
    precision?: number;
    /**
     * How RGBA pixels count. `'weight'` (default): in proportion to their opacity, so fully transparent pixels are
     * ignored and semi-transparent ones count partially. `'ignore'`: every pixel counts fully, as in 1.x.
     */
    alpha?: AlphaMode;
}

/** Options for mapping pixels to a palette: `quantizeWithClustering`, `quantizeWithPalette`, and the mapping half of `quantize` and `quantizeToIndices`. */
export interface MappingOptions extends RunOptions {
    /**
     * The space pixels are matched to their nearest palette colour in. Default `'rgb'`, except in
     * `quantizeWithClustering`, where it defaults to the space the clustering was made in.
     */
    colorSpace?: ColorSpace;
    /**
     * Error-diffusion dithering (serpentine Floyd-Steinberg): `false` (default), `true`, or a strength from 0 to 1.
     * Needs the image width: taken from `ImageData` or `RawImage.width`, or given as `width`.
     */
    dither?: boolean | number;
    /** Image width in pixels, for dithering a `Uint8Array` or a `RawImage` without `width`. */
    width?: number;
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
     * opaque in its nearest colour. Where this function builds the palette itself (`quantizeToIndices`), pixels below
     * the cutoff are left out of it and the rest count whole, so it can differ from `getPalette`'s for the same image.
     */
    transparent?: boolean | number;
}

/** The options of `quantizeToIndices`: clustering, mapping and indexed-output options. */
export type QuantizeIndexOptions = QuantizeOptions & IndexOptions;
/** The options of `quantizeToIndicesWithClustering` and `quantizeToIndicesWithPalette`: mapping and indexed-output options. */
export type MappingIndexOptions = MappingOptions & IndexOptions;

interface IndexedImageFields {
    /**
     * Flat RGB bytes, one entry per index, including the transparent entry if there is one. Empty for an image with no
     * pixels. An image with pixels but no visible colour has a single black entry, or with `transparent`, just
     * the transparent entry.
     */
    palette: Uint8Array;
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
    wasm?: string | URL | ArrayBuffer | ArrayBufferView | WasmModule;
}

/**
 * Loads the WebAssembly module. Every other function does it on first use, so calling `init` is optional, except to
 * say where the module is (`wasm`), which must come before any other call. The first load that succeeds wins; a
 * failed one can be retried.
 */
export function init(options?: InitOptions): Promise<void>;

/**
 * Builds the colour hierarchy for an image: the expensive step, done once. The result is an opaque `Uint8Array` you can
 * cache or store next to the image. Cut it to a palette of any size with `getPaletteFromClustering`, or map pixels
 * with `quantizeWithClustering`. An image with no visible pixels gives a clustering that cuts to an empty palette.
 */
export function getClustering(image: ImageLike, options?: ClusteringOptions): Promise<Uint8Array>;

/**
 * A palette of at most `k` colours for `image` (fewer if it has fewer distinct colours), as flat RGB bytes in split
 * order (see `getPaletteFromClustering`). It clusters the image each time: to try several sizes, call `getClustering`
 * once and cut it.
 */
export function getPalette(image: ImageLike, k: number, options?: ClusteringOptions): Promise<Uint8Array>;

/**
 * Cuts a clustering to at most `k` colours, in split order: index 0 is the dominant colour at two colours and keeps its
 * place as the palette grows (it is not always the heaviest entry of a larger one), and the palette for
 * `k + 1` is the palette for `k` with one entry refined and one colour appended.
 */
export function getPaletteFromClustering(clustering: Uint8Array, k: number): Promise<Uint8Array>;

/**
 * The weight of each colour in `getPaletteFromClustering(clustering, k)`, in the same order, in pixels: fully
 * transparent pixels count 0 and partly transparent ones in proportion to their opacity, as in clustering.
 * Needs a clustering from 3.x; older ones have no weights and are rejected.
 */
export function getPaletteWeights(clustering: Uint8Array, k: number): Promise<Float64Array>;

interface ClusteringInfoFields {
    colorSpace: ColorSpace;
    /** Bits per channel it was clustered with. */
    precision: number;
    /** The largest palette it can be cut to: its number of distinct clustered colours. */
    colors: number;
}

/** What a 3.x clustering holds. A clustering you just made with `getClustering` is this one: check `version === 3` to narrow to it. */
export interface ClusteringInfoV3 extends ClusteringInfoFields {
    version: 3;
    /** Total weight in pixels (opacity-weighted). */
    totalWeight: number;
    /**
     * `mse[k - 1]` is the mean squared error per channel of the k-colour clustering: each pixel's squared
     * distance to its cluster's colour, weighted as in clustering, in 8-bit RGB values (`'rgb'`) or OKLab units
     * (`'oklab'`). `mse[0]` is the image's variance. At `precision: 8`, `mse[colors - 1]` is 0; with a lower
     * precision it is the error that grouping colours discarded, which is recorded and included. It is an estimate,
     * computed from merge costs on integer-rounded colours. Mapping pixels to their nearest palette colour usually
     * lowers it by 10-15%.
     */
    mse: Float64Array;
    /**
     * `explained[k - 1]` is the share of the image's variance the k-colour clustering keeps, `1 - mse[k - 1] /
     * mse[0]`: 0 for one colour, rising to 1 at `colors`, and 1 throughout for an image of a single colour. It has no
     * units, so a target such as `0.99` means the same in `'rgb'` and `'oklab'`.
     */
    explained: Float64Array;
}

/** What a 2.x clustering holds: no weights, so no error curve. */
export interface ClusteringInfoV2 extends ClusteringInfoFields {
    version: 2;
    totalWeight: null;
    mse: null;
    explained: null;
}

/** What `getClusteringInfo` returns: check `version` to narrow to the 3.x or 2.x shape. */
export type ClusteringInfo = ClusteringInfoV3 | ClusteringInfoV2;

/** Reads what a clustering holds, including its error curve for choosing a palette size. */
export function getClusteringInfo(clustering: Uint8Array): Promise<ClusteringInfo>;

/**
 * Reduces `image` to at most `k` colours and returns the mapped image as the same kind of thing you gave: a `Uint8Array`
 * for a `Uint8Array`, `ImageData` for `ImageData`, an object with the same `format` for a `RawImage` (`ImageResult`; a
 * value typed as the union `ImageLike` gives the union). Each pixel keeps its own alpha.
 */
export function quantize<I extends ImageLike>(image: I, k: number, options?: QuantizeOptions): Promise<ImageResult<I>>;

/**
 * Maps `image` to the `k`-colour cut of a clustering you already have, so trying another `k` or another image mapping
 * costs milliseconds. Matches in the clustering's colour space unless `colorSpace` is given. Returns the same kind of
 * thing as `quantize`.
 */
export function quantizeWithClustering<I extends ImageLike>(image: I, clustering: Uint8Array, k: number, options?: MappingOptions): Promise<ImageResult<I>>;

/**
 * Maps each pixel of `image` to its nearest colour in a palette you supply (an edited swatch, a brand palette, one cut
 * from a clustering). A palette doesn't record the colour space it was made in: if it came from an OKLab clustering,
 * pass `colorSpace: 'oklab'` to map the way `quantizeWithClustering` does. Returns the same kind of thing as `quantize`.
 */
export function quantizeWithPalette<I extends ImageLike>(image: I, palette: PaletteLike, options?: MappingOptions): Promise<ImageResult<I>>;

/**
 * Like `quantize`, but returns each pixel's palette index instead of its colour, with the palette (for palette
 * PNGs, pixel art and pattern generators). The palette is the one `getPalette` gives, except that with `transparent`
 * pixels below the cutoff are left out of it.
 */
export function quantizeToIndices(image: ImageLike, k: number, options?: QuantizeIndexOptions): Promise<IndexedImage>;

/** Like `quantizeWithClustering`, but returns palette indices. The palette is `getPaletteFromClustering`'s. */
export function quantizeToIndicesWithClustering(image: ImageLike, clustering: Uint8Array, k: number, options?: MappingIndexOptions): Promise<IndexedImage>;

/** Like `quantizeWithPalette`, but returns indices into `palette`, which is returned too. */
export function quantizeToIndicesWithPalette(image: ImageLike, palette: PaletteLike, options?: MappingIndexOptions): Promise<IndexedImage>;
