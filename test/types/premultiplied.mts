// Image objects by format, and results narrowed to the input. Uses only types that exist without the DOM lib, so it is
// compiled in every configuration.
import { quantize, quantizeWithPalette, buildClustering } from 'agglomerative-clustering';
import { createWorker } from 'agglomerative-clustering/worker';
import type { ImageFormat, ImageLike, ImageResult, RawImage } from 'agglomerative-clustering';

declare const u8: Uint8Array;

export async function premultiplied() {
    // premultiplied: false is accepted on every format; a boolean too (the run time rejects only true without alpha).
    const noAlpha: RawImage = { data: u8, format: 'rgb', premultiplied: false };
    const flag: boolean = Math.random() > 0.5;
    const noAlphaFlag: RawImage = { data: u8, format: 'rgb', premultiplied: flag };
    const forwarded: { format: ImageFormat; premultiplied: boolean } = { format: 'rgbx', premultiplied: flag };
    const fromConfig: RawImage = { data: u8, ...forwarded };
    void [noAlpha, noAlphaFlag, fromConfig];

    // The result has the input's own keys, with data a Uint8Array and the literal format kept.
    const r = await quantize({ data: u8, format: 'bgra' as const, width: 4 }, 4);
    const rd: Uint8Array = r.data;
    const rf: 'bgra' = r.format;
    const rw: number = r.width;
    void [rd, rf, rw];
    // @ts-expect-error the format is bgra, not rgba
    const wrongFormat: 'rgba' = r.format;
    // @ts-expect-error no height was given
    r.height;
    void wrongFormat;

    const p = await quantize({ data: u8, format: 'rgba' as const, premultiplied: true as const }, 4);
    const pf: boolean = p.premultiplied;
    void pf;

    // A handle's quantize returns the type of the image it was made from.
    const worker = createWorker();
    const img = { data: u8, format: 'bgra' as const, width: 4, premultiplied: true as const };
    const handle = await worker.cluster(img);
    const hr = await handle.quantize(4);
    const hf: 'bgra' = hr.format;
    const hp: boolean = hr.premultiplied;
    const hd: Uint8Array = hr.data;
    const direct: ImageResult<typeof img> = hr;
    void [hf, hp, hd, direct];
    // @ts-expect-error the handle's image is bgra, not rgba
    const hWrong: 'rgba' = hr.format;
    // @ts-expect-error no height was given
    hr.height;
    void hWrong;
    // A loaded handle takes the image, then k.
    const loaded = await worker.load(await buildClustering(img));
    const lr: ImageResult<typeof img> = await loaded.quantize(img, 4);
    const lf: 'bgra' = lr.format;
    void lf;
    // @ts-expect-error the loaded handle's result is bgra, not rgba
    const lWrong: 'rgba' = lr.format;
    // @ts-expect-error no height was given
    lr.height;
    void lWrong;

    // Generic callers.
    const generic = <I extends ImageLike>(image: I) => quantize(image, 4);
    const byFormat = <F extends ImageFormat>(f: F, data: Uint8Array) => quantize({ data, format: f } as RawImage<F>, 4);
    await generic(img);
    await byFormat('rgb', u8);
    await quantizeWithPalette({ data: u8, format: 'rgbx' as const }, [0, 0, 0]);

    // RawImage<F> is assignable to RawImage.
    const x: RawImage<ImageFormat> = { data: u8, format: 'rgba' };
    const y: RawImage = x;
    const z: RawImage = {} as RawImage<'bgrx'>;
    void [y, z];

    // A union can't be extended, but an alias of one member works.
    // @ts-expect-error an interface can't extend a union type
    interface Extended extends RawImage { extra: number }
    type Rgba = RawImage<'rgba'>;
    const rgba: Rgba = { data: u8, format: 'rgba' };
    void rgba;

    // One variable can't hold results of different literal inputs: annotate it as RawImage.
    const rgbaImg = { data: u8, format: 'rgba' as const };
    const bgraImg = { data: u8, format: 'bgra' as const };
    let reused = await quantize(rgbaImg, 4);
    // @ts-expect-error the first result's format is 'rgba'
    reused = await quantize(bgraImg, 4);
    let annotated: RawImage = await quantize(rgbaImg, 4);
    annotated = await quantize(bgraImg, 4);
    void [reused, annotated];
}
