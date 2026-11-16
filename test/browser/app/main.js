// Bundled by test/browser/run.mjs. Runs both entries in the browser and reports to window.result.
import * as ac from 'agglomerative-clustering';
import { createWorker, quantize as workerQuantize } from 'agglomerative-clustering/worker';
// The package exports its .wasm file; each bundler has its own way to turn that into the URL it serves it at, so
// run.mjs writes this module per bundler.
import wasmUrl from './wasm-url.js';

const equal = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

// Noise with a few hundred thousand distinct colours: clustering it takes long enough to cancel.
function noise(width, height, seed) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        const r = (t ^ (t >>> 14)) >>> 0;
        data[i] = r & 255; data[i + 1] = (r >>> 8) & 255; data[i + 2] = (r >>> 16) & 255; data[i + 3] = 255;
    }
    return new ImageData(data, width, height);
}

const time = async (promise) => {
    const start = performance.now();
    const outcome = await promise.then((value) => ({ value }), (error) => ({ error }));
    return { ...outcome, ms: performance.now() - start };
};

async function run() {
    const width = 64, height = 48;
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#d0342c');
    gradient.addColorStop(0.5, '#2c8ad0');
    gradient.addColorStop(1, '#f2c14e');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    const checks = {};

    const mainResult = await ac.quantize(image, 8, { dither: true });
    const workerResult = await workerQuantize(image, 8, { dither: true });
    checks.dropInMatchesMain = workerResult instanceof ImageData && equal(workerResult.data, mainResult.data);

    const worker = createWorker();
    const handle = await worker.cluster(image, { colorSpace: 'oklab' });
    const clustering = await ac.getClustering(image, { colorSpace: 'oklab' });
    checks.handleClusteringMatchesMain = equal(await handle.getClustering(), clustering);
    let cuts = true;
    for (const k of [2, 4, 16, 64]) {
        cuts = cuts && equal(await handle.getPalette(k), await ac.getPaletteFromClustering(clustering, k));
        cuts = cuts && equal((await handle.quantize(k)).data, (await ac.quantizeWithClustering(image, clustering, k)).data);
    }
    checks.handleCutsMatchMain = cuts;
    const custom = await ac.getPalette(image, 5);
    checks.handlePaletteMatchesMain = equal((await handle.quantizeWithPalette(custom, { dither: true })).data, (await ac.quantizeWithPalette(image, custom, { dither: true })).data)
        && equal((await handle.quantizeToIndicesWithPalette(custom)).indices, (await ac.quantizeToIndicesWithPalette(image, custom)).indices);
    const indexed = await handle.quantizeToIndices(16);
    checks.indexedOutput = indexed.indices.length === width * height && indexed.palette.length <= 48;
    checks.weightsSumToPixels = (await handle.getPaletteWeights(16)).reduce((a, b) => a + b, 0) === width * height;
    await handle.release();
    await worker.terminate();

    // Slices on the main thread: the same result, progress that ends at 1, and an abort that lands between slices.
    const big = noise(500, 400, 7);
    const progress = [];
    const whole = await time(ac.getClustering(big));
    const sliced = await ac.getClustering(big, { onProgress: (fraction) => progress.push(fraction) });
    checks.slicedMatchesWhole = equal(sliced, whole.value);
    checks.progressRisesToOne = progress.length > 3 && progress[progress.length - 1] === 1 && progress.every((value, i) => i === 0 || value > progress[i - 1]);
    const controller = new AbortController();
    const aborted = await ac.getClustering(big, { signal: controller.signal, onProgress: (fraction) => {if (fraction > 0.3) {controller.abort();}} }).catch((error) => error);
    checks.mainAbortRejects = aborted instanceof DOMException && aborted.name === 'AbortError';

    // Aborting a call in a Web Worker stops the worker, so a small call after it is not kept waiting.
    const cancelWorker = createWorker();
    await cancelWorker.getPalette(image, 2);
    const fullTime = await time(cancelWorker.getClustering(big));
    const workerController = new AbortController();
    const workerAbort = await time(cancelWorker.getClustering(big, { signal: workerController.signal, onProgress: (fraction) => {if (fraction > 0.3) {workerController.abort();}} }));
    const next = await time(cancelWorker.getPalette(image, 4));
    checks.workerAbortRejects = workerAbort.error instanceof DOMException && workerAbort.error.name === 'AbortError';
    checks.workerAbortFreesWorker = equal(next.value, await ac.getPaletteFromClustering(await ac.getClustering(image), 4)) && next.ms < fullTime.ms * 0.5;
    await cancelWorker.terminate();

    // The page stays responsive while a clustering runs in slices: timers keep firing, and the longest gap between ticks
    // is a small fraction of the whole clustering (without slices it blocks for all of it).
    const gaps = async (run) => {
        let last = performance.now(), worst = 0, ticks = 0;
        const timer = setInterval(() => {const now = performance.now(); worst = Math.max(worst, now - last); last = now; ticks++;}, 4);
        await run();
        clearInterval(timer);
        return { worst, ticks };
    };
    const blocking = await gaps(() => ac.getClustering(big));
    const sliced2 = await gaps(() => ac.getClustering(big, { onProgress: () => {} }));
    checks.slicingKeepsThePageResponsive = sliced2.ticks > 10 && sliced2.worst < Math.max(150, blocking.worst * 0.5);

    // transfer: true hands the pixel buffer to the worker (the caller's copy is emptied) and the result is still right.
    const movable = new ImageData(new Uint8ClampedArray(image.data), width, height);
    const reference = await ac.quantize(image, 8);
    const mover = createWorker({ transfer: true });
    const moved = await mover.quantize(movable, 8);
    checks.transferDetachesInputAndKeepsResult = movable.data.length === 0 && moved instanceof ImageData && equal(moved.data, reference.data);
    await mover.terminate();

    // Disposal: where the browser has Symbol.asyncDispose, a handle disposes through it and then refuses calls.
    const disposer = createWorker();
    const disposable = await disposer.cluster(image);
    if (typeof Symbol.asyncDispose === 'symbol') {await disposable[Symbol.asyncDispose]();} else {await disposable.release();}
    checks.disposedHandleRefusesCalls = await disposable.getPalette(2).then(() => false, (error) => error.code === 'invalid-handle');
    await disposer.terminate();

    // Telling a worker where its WebAssembly is: a URL, the bytes, a compiled module.
    const expected = await ac.getPalette(image, 6);
    const sources = {
        url: wasmUrl,
        bytes: await (await fetch(wasmUrl)).arrayBuffer(),
        module: await WebAssembly.compileStreaming(fetch(wasmUrl)),
    };
    for (const [name, wasm] of Object.entries(sources)) {
        const located = createWorker({ wasm });
        checks[`workerWasm_${name}`] = equal(await located.getPalette(image, 6), expected);
        await located.terminate();
    }
    return checks;
}

run().then((checks) => {window.result = {checks};}, (error) => {window.result = {error: String(error && error.stack || error)};});
