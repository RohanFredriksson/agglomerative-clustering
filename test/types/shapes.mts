// The shapes of results and inputs: what narrows, and which palette inputs the types accept. Uses only types that exist
// without the DOM lib, so it is compiled in every configuration.
import { getClustering, getClusteringInfo, quantizeToIndices, quantizeWithPalette, quantizeToIndicesWithPalette, ditherMethods, ditherSteps, colorSpaces, imageFormats, alphaModes } from 'agglomerative-clustering';
import { createWorker } from 'agglomerative-clustering/worker';
import type { AlphaMode, ClusteringInfo, ColorSpace, DitherMethod, DitherSteps, ImageFormat, IndexedImage, PaletteLike, RawImage } from 'agglomerative-clustering';

declare const raw: RawImage;

export async function shapes() {
    // Checking indexBits narrows indices to the array type.
    const indexed = await quantizeToIndices(raw, 16);
    if (indexed.indexBits === 8) {const a: Uint8Array = indexed.indices; void a;}
    else if (indexed.indexBits === 16) {const b: Uint16Array = indexed.indices; void b;}
    else {const c: Uint32Array = indexed.indices; void c;}
    // @ts-expect-error without checking indexBits, indices could be any of the three
    const unnarrowed: Uint8Array = indexed.indices;
    const typed: IndexedImage = indexed;

    // One shape: the error curve and weights are always there (a 2.x clustering is rejected), and the format is a number,
    // so a later format needs no new type.
    const info: ClusteringInfo = await getClusteringInfo(await getClustering(raw));
    const precision: number = info.precision;
    const mse: Float64Array = info.mse;
    const explained: Float64Array = info.explained;
    const total: number = info.totalWeight;
    const format: number = info.formatVersion;
    void [mse, explained, total, format];

    // Palettes: flat bytes in any of the forms the runtime accepts.
    const palettes: PaletteLike[] = [new Uint8Array(6), new Uint8ClampedArray(6), [255, 0, 0, 0, 255, 0], [1, 2, 3] as readonly number[]];
    for (const palette of palettes) {
        await quantizeWithPalette(raw, palette);
        await quantizeToIndicesWithPalette(raw, palette);
    }
    // @ts-expect-error an array of [r, g, b] colours is not a flat palette
    await quantizeWithPalette(raw, [[255, 0, 0], [0, 255, 0]]);
    // @ts-expect-error nor are strings
    await quantizeWithPalette(raw, 'ff0000');

    // The same on a worker handle.
    const handle = await createWorker().cluster(raw);
    await handle.quantizeWithPalette([255, 0, 0, 0, 255, 0]);
    await handle.quantizeToIndicesWithPalette(new Uint8ClampedArray(6));
    void [unnarrowed, typed, precision];

    // Dithering: every form, and `steps` only with 'ordered'.
    await quantizeWithPalette(raw, [0, 0, 0], { dither: true });
    await quantizeWithPalette(raw, [0, 0, 0], { dither: 0.5 });
    await quantizeWithPalette(raw, [0, 0, 0], { dither: 'atkinson' });
    await quantizeWithPalette(raw, [0, 0, 0], { dither: { method: 'ordered', steps: 32, strength: 0.75 } });
    await quantizeWithPalette(raw, [0, 0, 0], { dither: { strength: 0.5 } });
    await handle.quantize(16, { dither: { method: 'ordered' } });
    // @ts-expect-error steps needs method: 'ordered'
    await quantizeWithPalette(raw, [0, 0, 0], { dither: { steps: 8 } });
    // @ts-expect-error nor does Atkinson take one
    await quantizeWithPalette(raw, [0, 0, 0], { dither: { method: 'atkinson', steps: 8 } });
    // @ts-expect-error steps is one of the sizes that divide the 8x8 pattern
    await quantizeWithPalette(raw, [0, 0, 0], { dither: { method: 'ordered', steps: 12 } });
    // A number from a slider narrows to DitherSteps with a check.
    const slider: number = 32;
    const steps: DitherSteps = ([2, 4, 8, 16, 32, 64] as const).find((s) => s === slider) ?? 16;
    await quantizeWithPalette(raw, [0, 0, 0], { dither: { method: 'ordered', steps } });
    // @ts-expect-error not a method
    await quantizeWithPalette(raw, [0, 0, 0], { dither: 'bayer' });
    // The exported lists narrow strings and numbers from a form.
    const selected: string = 'ordered', slid: number = 32;
    const method: DitherMethod | undefined = ditherMethods.find((m) => m === selected);
    const fromSlider: DitherSteps | undefined = ditherSteps.find((s) => s === slid);
    const space: ColorSpace | undefined = colorSpaces.find((c) => c === selected);
    const imageFormat: ImageFormat | undefined = imageFormats.find((f) => f === selected);
    const alpha: AlphaMode | undefined = alphaModes.find((a) => a === selected);
    void [method, fromSlider, space, imageFormat, alpha];
    // BGRA images go in and come back as image objects in the same format.
    const bgra: RawImage = { data: new Uint8Array(8), format: 'bgra', width: 2 };
    const mappedBgra: RawImage = await quantizeWithPalette(bgra, [0, 0, 0]);
    const bgraFormat: ImageFormat = 'bgra';
    // @ts-expect-error not an image format
    const notAFormat: ImageFormat = 'argb';
    void [mappedBgra, bgraFormat, notAFormat];
    // UI state holding any method: steps is caught unless the method is known to be 'ordered'.
    const ui: { method: DitherMethod; strength: number; steps: DitherSteps } = { method: 'atkinson', strength: 1, steps: 16 };
    // @ts-expect-error steps with a method that may not be 'ordered'
    await quantizeWithPalette(raw, [0, 0, 0], { dither: { method: ui.method, strength: ui.strength, steps: ui.steps } });
    await quantizeWithPalette(raw, [0, 0, 0], { dither: ui.method === 'ordered' ? { method: 'ordered', strength: ui.strength, steps: ui.steps } : { method: ui.method, strength: ui.strength } });
}
