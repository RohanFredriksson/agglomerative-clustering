// See main.mts.
import { createWorker, init, buildPalette, quantize, quantizeToIndices, terminate } from 'agglomerative-clustering/worker';
import { Palette, Clustering } from 'agglomerative-clustering/worker';
import type { PaletteChoice, AgglomerativeWorker, ClusteringHandle, LoadedClusteringHandle, ImageLike, ErrorCode, CodedError, ProgressOptions, InitOptions, SharedInitOptions, WorkerOptions } from 'agglomerative-clustering/worker';

declare const imageData: ImageData;
declare const bytes: Uint8Array;
const controller = new AbortController();

async function main() {
    const worker: AgglomerativeWorker = createWorker({ transfer: false, wasm: 'x.wasm' });
    await worker.init({ wasm: new Uint8Array(1) });
    // A worker script of your own, for bundlers that don't emit the package's (a URL, or a path in Node).
    const options: WorkerOptions = { script: new URL('/assets/agglomerative-clustering/worker-thread.mjs', 'https://example.com') };
    createWorker(options);
    createWorker({ script: './node_modules/agglomerative-clustering/dist/worker-thread.mjs' });
    const shared: SharedInitOptions = { script: '/assets/worker-thread.mjs', wasm: '/assets/clustering.wasm' };
    await init(shared);
    // @ts-expect-error A worker's own init takes no script: it is chosen with createWorker({ script }).
    await worker.init({ script: 'x.mjs' });
    const handle: ClusteringHandle<ImageData> = await worker.cluster(imageData, { signal: controller.signal, onProgress: (p) => void p });
    const q: ImageData = await handle.quantize(8, { dither: true, signal: controller.signal, onProgress: (p) => void p });
    const palette: Palette = await handle.getPalette(8);
    const info = await handle.getClusteringInfo();
    const mse: Float64Array = info.mse;
    const indexed = await handle.quantizeToIndices(16, { transparent: 128 });
    const edited: ImageData = await handle.quantizeWithPalette(palette, { dither: true, signal: controller.signal });
    await worker.quantizeToIndicesWithPalette(imageData, palette, { onProgress: (p) => void p });
    const editedIndexed = await handle.quantizeToIndicesWithPalette(palette, { transparent: true });
    void [edited, editedIndexed];
    const choice: PaletteChoice = await handle.chooseFrom(new Uint8Array(36), 12);
    void choice;
    // @ts-expect-error an image handle maps with quantize(k): the image is the one it holds
    await handle.quantize(imageData, 4);
    await handle.release();
    await terminate();

    // The result type follows the input type, as in the main entry.
    const x: ImageData = await quantize(imageData, 4, { signal: controller.signal });
    const y: Uint8Array = await quantize(bytes, 4);
    const z = await quantizeToIndices(imageData, 4, { transparent: true });
    const p: Palette = await buildPalette(imageData, 4);
    const stored: Clustering = await handle.getClustering();
    await init();
    const code: ErrorCode = 'worker-terminated';
    const e = null as unknown as CodedError;
    const run: ProgressOptions = {};
    const o: InitOptions = {};
    const like: ImageLike = bytes;
    // A clustering from the worker entry has the main entry's methods (they run on this thread).
    const cut: Palette = await stored.getPalette(4);
    const mapped: ImageData = await stored.quantize(imageData, 4);
    const loaded: LoadedClusteringHandle = await worker.load(stored);
    const loadedMapped: ImageData = await loaded.quantize(imageData, 4);
    const loadedBytes: Uint8Array = await loaded.quantize(bytes, 4, { colorSpace: 'rgb' });
    const loadedIndexed = await loaded.quantizeToIndices(bytes, 4, { transparent: true });
    await loaded.getPalette(4);
    void [loadedMapped, loadedBytes, loadedIndexed];
    void [stored, new Palette(bytes, 'oklab'), q, palette, mse, indexed, x, y, z, p, code, e, run, o, like, cut, mapped];
}

// @ts-expect-error a loaded handle takes the image, then k
declare const loadedHandle: LoadedClusteringHandle; loadedHandle.quantize(4);
// @ts-expect-error a loaded handle has no getClustering
loadedHandle.getClustering();
// @ts-expect-error getInfo was renamed
declare const h: ClusteringHandle; h.getInfo();
void main;
