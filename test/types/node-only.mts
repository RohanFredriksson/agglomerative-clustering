// A Node-only project: no DOM lib, so no global `ImageData`. The declarations must compile with `skipLibCheck` off,
// and the types must stay precise (not fall back to `any`).
import { quantize, quantizeToIndices, init, getClusteringInfo, buildClustering } from 'agglomerative-clustering';
import { createWorker, quantize as workerQuantize } from 'agglomerative-clustering/worker';
import type { ImageLike, PlatformImageData, RawImage } from 'agglomerative-clustering';

declare const raw: RawImage;
declare const bytes: Uint8Array;
declare const buffer: Buffer;
declare const anything: ImageLike;

export async function run() {
    const a: RawImage = await quantize(raw, 16);
    const b: Uint8Array = await quantize(bytes, 16);
    const c: Uint8Array = await quantize(buffer, 16);                // a Node Buffer is a Uint8Array
    const d: ImageLike = await quantize(anything, 16);
    const e: RawImage = await workerQuantize(raw, 16);
    const f = await createWorker().cluster(raw);
    const g: RawImage = await f.quantize(4);
    const indexed = await quantizeToIndices(buffer, 8, { transparent: true, signal: new AbortController().signal });
    const info = await getClusteringInfo(await buildClustering(bytes));
    const mse: Float64Array = info.mse;
    await init({ wasm: 'clustering.wasm' });
    await init({ wasm: new Uint8Array(8) });

    // These only prove something if the types did not collapse to `any`:
    // @ts-expect-error a RawImage result is not a string
    const notAString: string = a;
    // @ts-expect-error the result for a Uint8Array is not a RawImage
    const notRaw: RawImage = b;
    // @ts-expect-error an unknown option
    await quantize(raw, 4, { reserveTransparent: true });
    const h: RawImage = await quantize({ data: bytes, format: 'bgra' as const, width: 4 }, 4);
    // Methods on Clustering, typed without the DOM lib.
    const clustering = await buildClustering(raw);
    const m: RawImage = await clustering.quantize(raw, 4);
    const n: Uint8Array = await clustering.quantize(buffer, 4);
    // @ts-expect-error the result for a RawImage is not a string
    const notAString2: string = await clustering.quantize(raw, 4);
    // Without the DOM lib there is no ImageData: the platform type is never, and a Buffer in gives a Uint8Array out.
    const noPlatform: [PlatformImageData] extends [never] ? true : false = true;
    const fromBuffer: Uint8Array = await quantize(buffer, 4);
    void [noPlatform, fromBuffer];
    void [a, b, c, d, e, g, h, m, n, indexed, mse, notAString, notRaw, notAString2];
}
