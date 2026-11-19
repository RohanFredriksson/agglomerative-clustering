// `[Symbol.asyncDispose]` on handles needs TypeScript's `esnext.disposable` lib (TypeScript 5.2 and newer); this
// directive pulls it in. Older TypeScript versions report it unless `skipLibCheck` is on, as it is in most setups.
/// <reference lib="esnext.disposable" />

import type {
    ImageLike, RawImage, ClusteringOptions, MappingOptions, QuantizeOptions, QuantizeIndexOptions, MappingIndexOptions,
    IndexedImage, ClusteringInfo, InitOptions, ImageResult, PaletteLike, Swatches,
} from './index.js';
import type { Palette, Clustering } from './index.js';

/** The same class as the main entry's `Palette`: flat RGB bytes that know their colour space. */
export { Palette } from './index.js';

/** The same class as the main entry's `Clustering`: the typed bytes of a clustering. */
export { Clustering } from './index.js';

/** The same list as the main entry's `errorCodes`: the worker entry's errors have the same codes. */
export { errorCodes } from './index.js';

/** The same lists as the main entry's: every colour space, image format, alpha mode, dither method and step count. */
export { colorSpaces, imageFormats, alphaModes, ditherMethods, ditherSteps } from './index.js';

/** The main entry's `isCodedError`: true for this library's errors, from either entry. */
export { isCodedError } from './index.js';

/** The version of this library, as in its `package.json`: the same value as the main entry's `version`. */
export const version: string;

/** The version of the data this library stores (clusterings): the same value as the main entry's `formatVersion`. */
export const formatVersion: number;

export type {
    ImageFormat, RawImage, ImageLike, PaletteLike, PlatformImageData, ImageResult, WasmModule, ColorSpace, AlphaMode, DitherMethod, DitherOptions, DitherSteps, ClusteringOptions, MappingOptions, QuantizeOptions,
    ErrorCode, ErrorArgument, CodedError, InitOptions, ProgressOptions, CancelOptions, IndexOptions, QuantizeIndexOptions, MappingIndexOptions, IndexedImage, ClusteringInfo, Swatches,
} from './index.js';

/** Options for `createWorker`. */
export interface WorkerOptions {
    /**
     * `false` (default): images are copied to the worker. `true`: their pixel buffers are transferred instead,
     * which is faster for large images but leaves the caller's buffer detached (empty) afterwards. Only pixels that
     * are a whole buffer of their own are transferred: a view into part of a larger buffer (a subarray, a small Node
     * Buffer) is copied, so the caller's other data in that buffer is never detached.
     */
    transfer?: boolean | undefined;
    /** Where the worker gets its WebAssembly module; see `InitOptions`. It is sent as the worker's first call. */
    wasm?: InitOptions['wasm'] | undefined;
    /**
     * The worker script to start, where the package's own isn't emitted or found: Angular's application builder, esbuild
     * or Rollup without a worker plugin, a bundled Electron main process run from another directory. Point it at a copy
     * of the package's `dist/worker-thread.mjs`, served or kept next to the rest of `dist/` (which it imports). A URL
     * (relative URLs resolve against the page), or in Node a path (relative to the working directory) or `file:` URL.
     */
    script?: string | URL | undefined;
}

/** Options for the worker entry's shared `init`: the main entry's, plus the shared worker's `script`. */
export interface SharedInitOptions extends InitOptions {
    /**
     * The shared worker's script (see `WorkerOptions.script`). Give it before any other call to the worker entry's
     * functions: once the shared worker has started, a different script is rejected (call `terminate()` first).
     */
    script?: string | URL | undefined;
}

/** An image and its clustering, kept in the worker so re-cutting and re-mapping them copies nothing across. */
export interface ClusteringHandle<Image extends ImageLike = ImageLike> {
    getClustering(): Promise<Clustering>;
    getPalette(k: number): Promise<Palette>;
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
    getClustering(image: ImageLike, options?: ClusteringOptions): Promise<Clustering>;
    getPalette(image: ImageLike, k: number, options?: ClusteringOptions): Promise<Palette>;
    getPaletteFromClustering(clustering: Clustering, k: number): Promise<Palette>;
    getSwatches(image: ImageLike, k: number, options?: ClusteringOptions): Promise<Swatches>;
    getSwatchesFromClustering(clustering: Clustering, k: number): Promise<Swatches>;
    getClusteringInfo(clustering: Clustering): Promise<ClusteringInfo>;
    quantize<Image extends ImageLike>(image: Image, k: number, options?: QuantizeOptions): Promise<ImageResult<Image>>;
    quantizeFromClustering<Image extends ImageLike>(image: Image, clustering: Clustering, k: number, options?: MappingOptions): Promise<ImageResult<Image>>;
    quantizeWithPalette<Image extends ImageLike>(image: Image, palette: PaletteLike, options?: MappingOptions): Promise<ImageResult<Image>>;
    quantizeToIndices(image: ImageLike, k: number, options?: QuantizeIndexOptions): Promise<IndexedImage>;
    quantizeToIndicesFromClustering(image: ImageLike, clustering: Clustering, k: number, options?: MappingIndexOptions): Promise<IndexedImage>;
    quantizeToIndicesWithPalette(image: ImageLike, palette: PaletteLike, options?: MappingIndexOptions): Promise<IndexedImage>;
    /** Clusters `image` and keeps it, with its clustering, in the worker. */
    cluster<Image extends ImageLike>(image: Image, options?: ClusteringOptions): Promise<ClusteringHandle<ImageResult<Image>>>;
    /** Stops the worker. Calls still waiting are rejected, and later calls fail. */
    terminate(): Promise<void>;
    /** The same as `terminate()`, for `await using worker = createWorker()`. Present where the runtime has `Symbol.asyncDispose`. */
    [Symbol.asyncDispose](): Promise<void>;
}

/**
 * Starts a worker: a Web Worker in browsers, a worker thread in Node. It never keeps a Node process alive while idle.
 * Call `terminate()` when you are done with it (or use `await using`): its thread and memory stay until then. As a
 * safety net, a worker you dropped without terminating is stopped some time after it is garbage-collected, once no call
 * is in flight and no handle from it is left; when that happens is up to the engine.
 */
export function createWorker(options?: WorkerOptions): AgglomerativeWorker;

/** Stops the shared worker used by the exports below, rejecting calls still waiting. The next call starts a new one. */
export function terminate(): Promise<void>;

// The main entry's functions, run in one shared worker started on first use.
/**
 * The main entry's `init`, run in the shared worker (see `createWorker` for a worker of your own). It also takes the
 * shared worker's `script`, before any other call.
 */
export function init(options?: SharedInitOptions): Promise<void>;
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
