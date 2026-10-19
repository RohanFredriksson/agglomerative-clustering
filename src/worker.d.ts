import type {
    ImageLike, RawImage, ClusteringOptions, MappingOptions, QuantizeOptions, QuantizeIndexOptions, MappingIndexOptions,
    IndexedImage, ClusteringInfo,
} from './index';

export type * from './index';

export interface WorkerOptions {
    /**
     * `false` (default): images are copied to the worker. `true`: their pixel buffers are transferred instead,
     * which is faster for large images but leaves the caller's buffer detached (empty) afterwards.
     */
    transfer?: boolean;
}

/** An image and its clustering, kept in the worker so re-cutting and re-mapping them copies nothing across. */
export interface ClusteringHandle<Image extends ImageLike = ImageLike> {
    getClustering(): Promise<Uint8Array>;
    getPalette(k: number): Promise<Uint8Array>;
    getPaletteWeights(k: number): Promise<Float64Array>;
    getInfo(): Promise<ClusteringInfo>;
    /** Maps the kept image to the k-colour palette. Returns the same type as the image given to `cluster`. */
    quantize(k: number, options?: MappingOptions): Promise<Image>;
    quantizeToIndices(k: number, options?: MappingIndexOptions): Promise<IndexedImage>;
    /** Frees the image and clustering in the worker. Later calls on the handle fail. */
    release(): Promise<void>;
}

/** The main entry's functions, run in a worker, plus handles and `terminate`. */
export interface AgglomerativeWorker {
    init(): Promise<void>;
    getClustering(image: ImageLike, options?: ClusteringOptions): Promise<Uint8Array>;
    getPalette(image: ImageLike, k: number, options?: ClusteringOptions): Promise<Uint8Array>;
    getPaletteFromClustering(clustering: Uint8Array, k: number): Promise<Uint8Array>;
    getPaletteWeights(clustering: Uint8Array, k: number): Promise<Float64Array>;
    getClusteringInfo(clustering: Uint8Array): Promise<ClusteringInfo>;
    quantize<Image extends ImageLike>(image: Image, k: number, options?: QuantizeOptions): Promise<Image extends ImageData ? ImageData : Image extends RawImage ? RawImage : Uint8Array>;
    quantizeWithClustering<Image extends ImageLike>(image: Image, clustering: Uint8Array, k: number, options?: MappingOptions): Promise<Image extends ImageData ? ImageData : Image extends RawImage ? RawImage : Uint8Array>;
    quantizeWithPalette<Image extends ImageLike>(image: Image, palette: Uint8Array, options?: MappingOptions): Promise<Image extends ImageData ? ImageData : Image extends RawImage ? RawImage : Uint8Array>;
    quantizeToIndices(image: ImageLike, k: number, options?: QuantizeIndexOptions): Promise<IndexedImage>;
    quantizeToIndicesWithClustering(image: ImageLike, clustering: Uint8Array, k: number, options?: MappingIndexOptions): Promise<IndexedImage>;
    quantizeToIndicesWithPalette(image: ImageLike, palette: Uint8Array, options?: MappingIndexOptions): Promise<IndexedImage>;
    /** Clusters `image` and keeps it, with its clustering, in the worker. */
    cluster<Image extends ImageLike>(image: Image, options?: ClusteringOptions): Promise<ClusteringHandle<Image extends ImageData ? ImageData : Image extends RawImage ? RawImage : Uint8Array>>;
    /** Stops the worker. Calls still waiting are rejected, and later calls fail. */
    terminate(): Promise<void>;
}

/** Starts a worker: a Web Worker in browsers, a worker thread in Node. It never keeps a Node process alive while idle. */
export function createWorker(options?: WorkerOptions): AgglomerativeWorker;

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
