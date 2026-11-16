// See main.mts.
import { createWorker, init, getPalette, quantize, quantizeToIndices, terminate } from 'agglomerative-clustering/worker';
import type { AgglomerativeWorker, ClusteringHandle, ImageLike, ErrorCode, CodedError, RunOptions, InitOptions } from 'agglomerative-clustering/worker';

declare const imageData: ImageData;
declare const bytes: Uint8Array;
const controller = new AbortController();

async function main() {
    const worker: AgglomerativeWorker = createWorker({ transfer: false, wasm: 'x.wasm' });
    await worker.init({ wasm: new Uint8Array(1) });
    const handle: ClusteringHandle<ImageData> = await worker.cluster(imageData, { signal: controller.signal, onProgress: (p) => void p });
    const q: ImageData = await handle.quantize(8, { dither: true, signal: controller.signal });
    const palette: Uint8Array = await handle.getPalette(8);
    const info = await handle.getClusteringInfo();
    const mse: Float64Array | null = info.mse;
    const indexed = await handle.quantizeToIndices(16, { transparent: 128 });
    const edited: ImageData = await handle.quantizeWithPalette(palette, { dither: true, signal: controller.signal });
    const editedIndexed = await handle.quantizeToIndicesWithPalette(palette, { transparent: true });
    void [edited, editedIndexed];
    await handle.release();
    await terminate();

    // The result type follows the input type, as in the main entry.
    const x: ImageData = await quantize(imageData, 4, { signal: controller.signal });
    const y: Uint8Array = await quantize(bytes, 4);
    const z = await quantizeToIndices(imageData, 4, { transparent: true });
    const p: Uint8Array = await getPalette(imageData, 4);
    await init();
    const code: ErrorCode = 'worker-terminated';
    const e = null as unknown as CodedError;
    const run: RunOptions = {};
    const o: InitOptions = {};
    const like: ImageLike = bytes;
    void [q, palette, mse, indexed, x, y, z, p, code, e, run, o, like];
}

// @ts-expect-error getInfo was renamed
declare const h: ClusteringHandle; h.getInfo();
void main;
