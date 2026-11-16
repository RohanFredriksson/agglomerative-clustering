// The shapes of results and inputs: what narrows, and which palette inputs the types accept. Uses only types that exist
// without the DOM lib, so it is compiled in every configuration.
import { getClustering, getClusteringInfo, quantizeToIndices, quantizeWithPalette, quantizeToIndicesWithPalette } from 'agglomerative-clustering';
import { createWorker } from 'agglomerative-clustering/worker';
import type { ClusteringInfo, ClusteringInfoV3, IndexedImage, PaletteLike, RawImage } from 'agglomerative-clustering';

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

    // Checking version narrows the error curve and weights to present or absent.
    const info: ClusteringInfo = await getClusteringInfo(await getClustering(raw));
    const precision: number = info.precision;                                   // never null now
    if (info.version === 3) {
        const mse: Float64Array = info.mse;
        const explained: Float64Array = info.explained;
        const total: number = info.totalWeight;
        const same: ClusteringInfoV3 = info;
        void [mse, explained, total, same];
    } else {
        const none: null = info.mse;
        const version: 2 = info.version;
        void [none, version];
    }
    // @ts-expect-error not narrowed: a 2.x clustering has no error curve
    const maybe: Float64Array = info.mse;

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
    void [unnarrowed, typed, precision, maybe];
}
