export type ImageFormat = 'rgb' | 'rgba';

export interface RawImage {
    data: Uint8Array | Uint8ClampedArray;
    format: ImageFormat;
    /** Width in pixels. Optional; used for dithering, and copied to `quantize*` results. */
    width?: number;
    /** Height in pixels. Optional; copied to `quantize*` results. */
    height?: number;
}

export type ImageLike = Uint8Array | ImageData | RawImage;

/** The space colours are clustered and matched in. */
export type ColorSpace = 'rgb' | 'oklab';

/** How pixel opacity affects clustering. */
export type AlphaMode = 'weight' | 'ignore';

export interface ClusteringOptions {
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

export interface MappingOptions {
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

export type QuantizeOptions = ClusteringOptions & MappingOptions;

export interface IndexOptions {
    /**
     * `false` (default): fully transparent pixels get the index of their nearest colour, like any other pixel.
     * `true`: if the image is RGBA and has fully transparent pixels, they get an extra entry appended after the
     * palette (black, taking no part in matching), as palette PNGs expect. Its index is `transparentIndex`.
     */
    transparentIndex?: boolean;
}

export type QuantizeIndexOptions = QuantizeOptions & IndexOptions;
export type MappingIndexOptions = MappingOptions & IndexOptions;

export interface IndexedImage {
    /** Flat RGB bytes, one entry per index. Includes the transparent entry, if there is one. */
    palette: Uint8Array;
    /** One palette index per pixel: `Uint8Array` up to 256 entries, `Uint16Array` up to 65536, else `Uint32Array`. */
    indices: Uint8Array | Uint16Array | Uint32Array;
    /** The index of the entry for fully transparent pixels, or -1 if there is none. */
    transparentIndex: number;
    /** Copied from the input, when it is `ImageData` or a `RawImage` with `width`. */
    width?: number;
    /** Copied from the input, when it is `ImageData` or a `RawImage` with `height`. */
    height?: number;
}

export function init(): Promise<void>;

export function getClustering(image: ImageLike, options?: ClusteringOptions): Promise<Uint8Array>;

export function getPalette(image: ImageLike, k: number, options?: ClusteringOptions): Promise<Uint8Array>;

/**
 * Cuts a clustering to at most `k` colours, in split order: index 0 is the dominant colour, and the palette for
 * `k + 1` is the palette for `k` with one entry refined and one colour appended.
 */
export function getPaletteFromClustering(clustering: Uint8Array, k: number): Promise<Uint8Array>;

export function quantize(image: Uint8Array, k: number, options?: QuantizeOptions): Promise<Uint8Array>;
export function quantize(image: ImageData, k: number, options?: QuantizeOptions): Promise<ImageData>;
export function quantize(image: RawImage, k: number, options?: QuantizeOptions): Promise<RawImage>;

export function quantizeWithClustering(image: Uint8Array, clustering: Uint8Array, k: number, options?: MappingOptions): Promise<Uint8Array>;
export function quantizeWithClustering(image: ImageData, clustering: Uint8Array, k: number, options?: MappingOptions): Promise<ImageData>;
export function quantizeWithClustering(image: RawImage, clustering: Uint8Array, k: number, options?: MappingOptions): Promise<RawImage>;

export function quantizeWithPalette(image: Uint8Array, palette: Uint8Array, options?: MappingOptions): Promise<Uint8Array>;
export function quantizeWithPalette(image: ImageData, palette: Uint8Array, options?: MappingOptions): Promise<ImageData>;
export function quantizeWithPalette(image: RawImage, palette: Uint8Array, options?: MappingOptions): Promise<RawImage>;

/**
 * Like `quantize`, but returns each pixel's palette index instead of its colour, with the palette (for palette
 * PNGs, pixel art and pattern generators). The palette is the one `getPalette` gives.
 */
export function quantizeToIndices(image: ImageLike, k: number, options?: QuantizeIndexOptions): Promise<IndexedImage>;

/** Like `quantizeWithClustering`, but returns palette indices. The palette is `getPaletteFromClustering`'s. */
export function quantizeToIndicesWithClustering(image: ImageLike, clustering: Uint8Array, k: number, options?: MappingIndexOptions): Promise<IndexedImage>;

/** Like `quantizeWithPalette`, but returns indices into `palette`, which is returned too. */
export function quantizeToIndicesWithPalette(image: ImageLike, palette: Uint8Array, options?: MappingIndexOptions): Promise<IndexedImage>;
