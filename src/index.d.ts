export type ImageFormat = 'rgb' | 'rgba';

export interface RawImage {
    data: Uint8Array | Uint8ClampedArray;
    format: ImageFormat;
}

export type ImageLike = Uint8Array | ImageData | RawImage;

export function init(): Promise<void>;

export function getClustering(image: ImageLike): Promise<Uint8Array>;

export function getPalette(image: ImageLike, k: number): Promise<Uint8Array>;

export function getPaletteFromClustering(clustering: Uint8Array, k: number): Promise<Uint8Array>;

export function quantize(image: Uint8Array, k: number): Promise<Uint8Array>;
export function quantize(image: ImageData, k: number): Promise<ImageData>;
export function quantize(image: RawImage, k: number): Promise<RawImage>;

export function quantizeWithClustering(image: Uint8Array, clustering: Uint8Array, k: number): Promise<Uint8Array>;
export function quantizeWithClustering(image: ImageData, clustering: Uint8Array, k: number): Promise<ImageData>;
export function quantizeWithClustering(image: RawImage, clustering: Uint8Array, k: number): Promise<RawImage>;

export function quantizeWithPalette(image: Uint8Array, palette: Uint8Array): Promise<Uint8Array>;
export function quantizeWithPalette(image: ImageData, palette: Uint8Array): Promise<ImageData>;
export function quantizeWithPalette(image: RawImage, palette: Uint8Array): Promise<RawImage>;
