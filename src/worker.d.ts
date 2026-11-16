// `[Symbol.asyncDispose]` on handles needs TypeScript's `esnext.disposable` lib (TypeScript 5.2 and newer); this
// directive pulls it in. Older TypeScript versions report it unless `skipLibCheck` is on, as it is in most setups.
/// <reference lib="esnext.disposable" />

import type {
    ImageLike, RawImage, ClusteringOptions, MappingOptions, QuantizeOptions, QuantizeIndexOptions, MappingIndexOptions,
    IndexedImage, ClusteringInfo, InitOptions, ImageResult,
} from './index.js';

export type {
    ImageFormat, RawImage, ImageLike, PlatformImageData, ImageResult, WasmModule, ColorSpace, AlphaMode, ClusteringOptions, MappingOptions, QuantizeOptions,
    ErrorCode, CodedError, InitOptions, RunOptions, IndexOptions, QuantizeIndexOptions, MappingIndexOptions, IndexedImage, ClusteringInfo,
} from './index.js';

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
    getPaletteWeights(k: number): Promise<Float64Array>;
    getClusteringInfo(): Promise<ClusteringInfo>;
    /** Maps the kept image to the k-colour palette. Returns the same type as the image given to `cluster`. */
    quantize(k: number, options?: MappingOptions): Promise<Image>;
    quantizeToIndices(k: number, options?: MappingIndexOptions): Promise<IndexedImage>;
    /** Maps the kept image to a palette of your own (an edited swatch, a brand palette) without sending the pixels again. */
    quantizeWithPalette(palette: Uint8Array, options?: MappingOptions): Promise<Image>;
    quantizeToIndicesWithPalette(palette: Uint8Array, options?: MappingIndexOptions): Promise<IndexedImage>;
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
    getPaletteWeights(clustering: Uint8Array, k: number): Promise<Float64Array>;
    getClusteringInfo(clustering: Uint8Array): Promise<ClusteringInfo>;
    quantize<Image extends ImageLike>(image: Image, k: number, options?: QuantizeOptions): Promise<ImageResult<Image>>;
    quantizeWithClustering<Image extends ImageLike>(image: Image, clustering: Uint8Array, k: number, options?: MappingOptions): Promise<ImageResult<Image>>;
    quantizeWithPalette<Image extends ImageLike>(image: Image, palette: Uint8Array, options?: MappingOptions): Promise<ImageResult<Image>>;
    quantizeToIndices(image: ImageLike, k: number, options?: QuantizeIndexOptions): Promise<IndexedImage>;
    quantizeToIndicesWithClustering(image: ImageLike, clustering: Uint8Array, k: number, options?: MappingIndexOptions): Promise<IndexedImage>;
    quantizeToIndicesWithPalette(image: ImageLike, palette: Uint8Array, options?: MappingIndexOptions): Promise<IndexedImage>;
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
export const init: AgglomerativeWorker['init'];
export const getClustering: AgglomerativeWorker['getClustering'];
export const getPalette: AgglomerativeWorker['getPalette'];
export const getPaletteFromClustering: AgglomerativeWorker['getPaletteFromClustering'];
export const getPaletteWeights: AgglomerativeWorker['getPaletteWeights'];
export const getClusteringInfo: AgglomerativeWorker['getClusteringInfo'];
export const quantize: AgglomerativeWorker['quantize'];
export const quantizeWithClustering: AgglomerativeWorker['quantizeWithClustering'];
export const quantizeWithPalette: AgglomerativeWorker['quantizeWithPalette'];
export const quantizeToIndices: AgglomerativeWorker['quantizeToIndices'];
export const quantizeToIndicesWithClustering: AgglomerativeWorker['quantizeToIndicesWithClustering'];
export const quantizeToIndicesWithPalette: AgglomerativeWorker['quantizeToIndicesWithPalette'];
