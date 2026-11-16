// `[Symbol.asyncDispose]` on handles needs TypeScript's `esnext.disposable` lib (TypeScript 5.2 and newer); this
// directive pulls it in. Older TypeScript versions report it unless `skipLibCheck` is on, as it is in most setups.
/// <reference lib="esnext.disposable" />

import type {
    ImageLike, RawImage, ClusteringOptions, MappingOptions, QuantizeOptions, QuantizeIndexOptions, MappingIndexOptions,
    IndexedImage, ClusteringInfo, InitOptions, ImageResult, PaletteLike, Swatches,
} from './index.js';

export type {
    ImageFormat, RawImage, ImageLike, PaletteLike, PlatformImageData, ImageResult, WasmModule, ColorSpace, AlphaMode, ClusteringOptions, MappingOptions, QuantizeOptions,
    ErrorCode, CodedError, InitOptions, RunOptions, IndexOptions, QuantizeIndexOptions, MappingIndexOptions, IndexedImage, ClusteringInfo, ClusteringInfoV2, ClusteringInfoV3, Swatches,
} from './index.js';

/** Options for `createWorker`. */
export interface WorkerOptions {
    /**
     * `false` (default): images are copied to the worker. `true`: their pixel buffers are transferred instead,
     * which is faster for large images but leaves the caller's buffer detached (empty) afterwards.
     */
    transfer?: boolean;
    /** Where the worker gets its WebAssembly module; see `InitOptions`. It is sent as the worker's first call. */
    wasm?: InitOptions['wasm'];
}

/** An image and its clustering, kept in the worker so re-cutting and re-mapping them copies nothing across. */
export interface ClusteringHandle<Image extends ImageLike = ImageLike> {
    getClustering(): Promise<Uint8Array>;
    getPalette(k: number): Promise<Uint8Array>;
    getSwatches(k: number): Promise<Swatches>;
    getClusteringInfo(): Promise<ClusteringInfo>;
    /** Maps the kept image to the k-colour palette. Returns the same type as the image given to `cluster`. */
    quantize(k: number, options?: MappingOptions): Promise<Image>;
    quantizeToIndices(k: number, options?: MappingIndexOptions): Promise<IndexedImage>;
    /** Maps the kept image to a palette of your own (an edited swatch, a brand palette) without sending the pixels again. */
    quantizeWithPalette(palette: PaletteLike, options?: MappingOptions): Promise<Image>;
    quantizeToIndicesWithPalette(palette: PaletteLike, options?: MappingIndexOptions): Promise<IndexedImage>;
    /**
     * Frees the image and clustering in the worker. Later calls on the handle fail. Call it when you are done, or
     * declare the handle with `await using`, which does. A handle that is dropped without either is freed once it is
     * garbage-collected, but when that happens is up to the JavaScript engine.
     */
    release(): Promise<void>;
    /** The same as `release()`, for `await using`. Present where the runtime has `Symbol.asyncDispose`. */
    [Symbol.asyncDispose](): Promise<void>;
}

/** The main entry's functions, run in a worker, plus handles and `terminate`. */
export interface AgglomerativeWorker {
    /** Loads the module in the worker. `wasm` is the only option, and `createWorker({ wasm })` does the same. */
    init(options?: InitOptions): Promise<void>;
    getClustering(image: ImageLike, options?: ClusteringOptions): Promise<Uint8Array>;
    getPalette(image: ImageLike, k: number, options?: ClusteringOptions): Promise<Uint8Array>;
    getPaletteFromClustering(clustering: Uint8Array, k: number): Promise<Uint8Array>;
    getSwatches(image: ImageLike, k: number, options?: ClusteringOptions): Promise<Swatches>;
    getSwatchesFromClustering(clustering: Uint8Array, k: number): Promise<Swatches>;
    getClusteringInfo(clustering: Uint8Array): Promise<ClusteringInfo>;
    quantize<Image extends ImageLike>(image: Image, k: number, options?: QuantizeOptions): Promise<ImageResult<Image>>;
    quantizeFromClustering<Image extends ImageLike>(image: Image, clustering: Uint8Array, k: number, options?: MappingOptions): Promise<ImageResult<Image>>;
    quantizeWithPalette<Image extends ImageLike>(image: Image, palette: PaletteLike, options?: MappingOptions): Promise<ImageResult<Image>>;
    quantizeToIndices(image: ImageLike, k: number, options?: QuantizeIndexOptions): Promise<IndexedImage>;
    quantizeToIndicesFromClustering(image: ImageLike, clustering: Uint8Array, k: number, options?: MappingIndexOptions): Promise<IndexedImage>;
    quantizeToIndicesWithPalette(image: ImageLike, palette: PaletteLike, options?: MappingIndexOptions): Promise<IndexedImage>;
    /** Clusters `image` and keeps it, with its clustering, in the worker. */
    cluster<Image extends ImageLike>(image: Image, options?: ClusteringOptions): Promise<ClusteringHandle<ImageResult<Image>>>;
    /** Stops the worker. Calls still waiting are rejected, and later calls fail. */
    terminate(): Promise<void>;
}

/** Starts a worker: a Web Worker in browsers, a worker thread in Node. It never keeps a Node process alive while idle. */
export function createWorker(options?: WorkerOptions): AgglomerativeWorker;

/** Stops the shared worker used by the exports below, rejecting calls still waiting. The next call starts a new one. */
export function terminate(): Promise<void>;

// The main entry's functions, run in one shared worker started on first use.
/** The main entry's `init`, run in the shared worker (see `createWorker` for a worker of your own). */
export const init: AgglomerativeWorker['init'];
/** The main entry's `getClustering`, run in the shared worker (see `createWorker` for a worker of your own). */
export const getClustering: AgglomerativeWorker['getClustering'];
/** The main entry's `getPalette`, run in the shared worker (see `createWorker` for a worker of your own). */
export const getPalette: AgglomerativeWorker['getPalette'];
/** The main entry's `getPaletteFromClustering`, run in the shared worker (see `createWorker` for a worker of your own). */
export const getPaletteFromClustering: AgglomerativeWorker['getPaletteFromClustering'];
/** The main entry's `getSwatches`, run in the shared worker (see `createWorker` for a worker of your own). */
export const getSwatches: AgglomerativeWorker['getSwatches'];
/** The main entry's `getSwatchesFromClustering`, run in the shared worker (see `createWorker` for a worker of your own). */
export const getSwatchesFromClustering: AgglomerativeWorker['getSwatchesFromClustering'];
/** The main entry's `getClusteringInfo`, run in the shared worker (see `createWorker` for a worker of your own). */
export const getClusteringInfo: AgglomerativeWorker['getClusteringInfo'];
/** The main entry's `quantize`, run in the shared worker (see `createWorker` for a worker of your own). */
export const quantize: AgglomerativeWorker['quantize'];
/** The main entry's `quantizeFromClustering`, run in the shared worker (see `createWorker` for a worker of your own). */
export const quantizeFromClustering: AgglomerativeWorker['quantizeFromClustering'];
/** The main entry's `quantizeWithPalette`, run in the shared worker (see `createWorker` for a worker of your own). */
export const quantizeWithPalette: AgglomerativeWorker['quantizeWithPalette'];
/** The main entry's `quantizeToIndices`, run in the shared worker (see `createWorker` for a worker of your own). */
export const quantizeToIndices: AgglomerativeWorker['quantizeToIndices'];
/** The main entry's `quantizeToIndicesFromClustering`, run in the shared worker (see `createWorker` for a worker of your own). */
export const quantizeToIndicesFromClustering: AgglomerativeWorker['quantizeToIndicesFromClustering'];
/** The main entry's `quantizeToIndicesWithPalette`, run in the shared worker (see `createWorker` for a worker of your own). */
export const quantizeToIndicesWithPalette: AgglomerativeWorker['quantizeToIndicesWithPalette'];
