// A value typed as the union `ImageLike` must be accepted by every function that takes an image, and give back the union.
import { quantize, quantizeWithPalette, quantizeWithClustering, quantizeToIndices, getPalette } from 'agglomerative-clustering';
import type { ImageLike, RawImage } from 'agglomerative-clustering';

declare const anything: ImageLike;
declare const raw: RawImage;
declare const bytes: Uint8Array;
declare const imageData: ImageData;
declare const palette: Uint8Array;
declare const clustering: Uint8Array;

export async function helpers() {
    // A helper a user would naturally write: accepts any supported input.
    const reduced: ImageLike = await quantize(anything, 16, { dither: true, width: 8 });
    const mapped: ImageLike = await quantizeWithPalette(anything, palette);
    const cut: ImageLike = await quantizeWithClustering(anything, clustering, 4);
    const swatches: Uint8Array = await getPalette(anything, 8);
    const indexed = await quantizeToIndices(anything, 8);

    // Specific inputs still give specific outputs.
    const a: Uint8Array = await quantize(bytes, 8);
    const b: ImageData = await quantize(imageData, 8);
    const c: RawImage = await quantize(raw, 8);
    const d: RawImage = await quantize({ data: bytes, format: 'rgb' }, 8);
    const format: 'rgb' | 'rgba' = (await quantize(raw, 8)).format;

    // @ts-expect-error a RawImage in does not give a Uint8Array out
    const wrong: Uint8Array = await quantize(raw, 8);
    // @ts-expect-error nor does an ImageData in give a RawImage out
    const alsoWrong: RawImage = await quantize(imageData, 8);
    void [reduced, mapped, cut, swatches, indexed, a, b, c, d, format, wrong, alsoWrong];
}
