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

// Measurements behind the timing checks, reported with a failure so it says why.
const details = {};

async function run() {
    // A diagonal gradient through three colours, computed rather than drawn on a canvas: reading pixels back from a
    // canvas (getImageData) threw in CI's Safari under safaridriver, and the library only needs the ImageData.
    const width = 64, height = 48;
    const stops = [[0xd0, 0x34, 0x2c], [0x2c, 0x8a, 0xd0], [0xf2, 0xc1, 0x4e]];
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const t = 2 * (x + y) / (width + height - 2), i = Math.min(Math.floor(t), 1), f = t - i;
            const colour = stops[i].map((value, c) => Math.round(value + (stops[i + 1][c] - value) * f));
            pixels.set([...colour, 255], (y * width + x) * 4);
        }
    }
    const image = new ImageData(pixels, width, height);
    const checks = {};

    const mainResult = await ac.quantize(image, 8, { dither: true });
    const workerResult = await workerQuantize(image, 8, { dither: true });
    checks.dropInMatchesMain = workerResult instanceof ImageData && equal(workerResult.data, mainResult.data);
    // BGRA through the bundled worker: the same pixels with red and blue swapped give the RGBA result swapped back.
    const swap = (bytes) => {const out = new Uint8Array(bytes); for (let i = 0; i < out.length; i += 4) {out[i] = bytes[i + 2]; out[i + 2] = bytes[i];} return out;};
    // Caught, so a version without BGRA (the published one, in the "Published package" workflow) fails this check alone
    // rather than the whole page.
    try {
        const bgraResult = await workerQuantize({ data: swap(image.data), format: 'bgra', width, height }, 8, { dither: true });
        checks.bgraMatchesRgba = bgraResult.format === 'bgra' && equal(swap(bgraResult.data), mainResult.data);
    } catch (error) {
        checks.bgraMatchesRgba = false;
        details.bgraMatchesRgba = String(error && error.message);
    }
    // BGRX (the fourth byte padding, here 0) through the worker gives the RGB image's result, widened with 255.
    try {
        const rgb = image.data.filter((_, i) => i % 4 !== 3);
        const bgrx = new Uint8Array(image.data.length);
        for (let p = 0; p < width * height; p++) {bgrx.set([rgb[3 * p + 2], rgb[3 * p + 1], rgb[3 * p], 0], 4 * p);}
        const fromRgb = await workerQuantize({ data: rgb, format: 'rgb', width, height }, 8, { dither: true });
        const fromBgrx = await workerQuantize({ data: bgrx, format: 'bgrx', width, height }, 8, { dither: true });
        const widened = new Uint8Array(bgrx.length);
        for (let p = 0; p < width * height; p++) {widened.set([fromRgb.data[3 * p + 2], fromRgb.data[3 * p + 1], fromRgb.data[3 * p], 255], 4 * p);}
        checks.bgrxMatchesRgb = fromBgrx.format === 'bgrx' && equal(fromBgrx.data, widened);
    } catch (error) {
        checks.bgrxMatchesRgb = false;
        details.bgrxMatchesRgb = String(error && error.message);
    }

    const worker = createWorker();
    const handle = await worker.cluster(image, { colorSpace: 'oklab' });
    const clustering = await ac.getClustering(image, { colorSpace: 'oklab' });
    checks.handleClusteringMatchesMain = equal(await handle.getClustering(), clustering);
    // This app also runs against published versions, so it calls the names every 3.x has. Where the version has 3.4.0's
    // names, they must be the same functions, after bundling too.
    checks.buildNamesAreTheSameFunctions = typeof ac.buildPalette !== 'function'
        || (ac.buildClustering === ac.getClustering && ac.buildPalette === ac.getPalette && ac.buildSwatches === ac.getSwatches
            && worker.buildPalette === worker.getPalette && equal(await ac.buildPalette(image, 5), await ac.getPalette(image, 5)));
    let cuts = true;
    for (const k of [2, 4, 16, 64]) {
        cuts = cuts && equal(await handle.getPalette(k), await ac.getPaletteFromClustering(clustering, k));
        cuts = cuts && equal((await handle.quantize(k)).data, (await ac.quantizeFromClustering(image, clustering, k)).data);
    }
    checks.handleCutsMatchMain = cuts;
    // A clustering from the worker entry has the methods, run on this thread with the main entry (imported above).
    try {
        const fromWorker = await worker.getClustering(image, { colorSpace: 'oklab' });
        checks.methodsOnWorkerClustering = equal(await fromWorker.getPalette(8), await ac.getPaletteFromClustering(clustering, 8))
            && equal((await fromWorker.quantize(image, 8)).data, (await ac.quantizeFromClustering(image, clustering, 8)).data)
            && (await fromWorker.quantize(image, 8)) instanceof ImageData;
    } catch (error) {
        checks.methodsOnWorkerClustering = false;
        details.methodsOnWorkerClustering = `${error.code}: ${error.message}`;
    }
    // worker.load (3.8) gives a handle for a stored clustering, and chooseFrom matches the method on the clustering itself.
    try {
        checks.loadAndChooseFrom = typeof worker.load !== 'function' || await (async () => {
            const loaded = await worker.load(clustering);
            const chart = await ac.getPalette(image, 12);
            const viaHandle = await loaded.chooseFrom(chart, 6);
            const viaMethod = await clustering.chooseFrom(chart, 6);
            const same = equal(await loaded.getPalette(8), await clustering.getPalette(8))
                && equal(viaHandle.indices, viaMethod.indices) && equal(viaHandle.palette, viaMethod.palette);
            await loaded.release();
            return same;
        })();
    } catch (error) {
        checks.loadAndChooseFrom = false;
        details.loadAndChooseFrom = `${error.code}: ${error.message}`;
    }
    // A palette made in RGB (it knows that), and the same bytes without the tag.
    const custom = await ac.getPalette(image, 5);
    const plain = new Uint8Array(custom);
    // The handle was clustered in OKLab: plain bytes map in the space it was clustered in, a Palette in its own, and a
    // palette from the handle keeps the OKLab it was made in, across the worker boundary.
    checks.handlePaletteMatchesMain = equal((await handle.quantizeWithPalette(plain, { dither: true })).data, (await ac.quantizeWithPalette(image, plain, { dither: true, colorSpace: 'oklab' })).data)
        && equal((await handle.quantizeWithPalette(custom, { dither: true })).data, (await ac.quantizeWithPalette(image, custom, { dither: true })).data)
        && equal((await handle.quantizeToIndicesWithPalette(plain)).indices, (await ac.quantizeToIndicesWithPalette(image, plain, { colorSpace: 'oklab' })).indices)
        && equal((await handle.quantizeWithPalette(await handle.getPalette(5))).data, (await handle.quantize(5)).data)
        && (await handle.getPalette(5)).colorSpace === 'oklab' && (await handle.getClustering()) instanceof ac.Clustering;
    const indexed = await handle.quantizeToIndices(16);
    checks.indexedOutput = indexed.indices.length === width * height && indexed.palette.length <= 48;
    const swatches = await handle.getSwatches(16);
    checks.weightsSumToPixels = swatches.weights.reduce((a, b) => a + b, 0) === width * height && Math.abs(swatches.shares.reduce((a, b) => a + b, 0) - 1) < 1e-9;
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

    // Cancelled calls queued behind a mapping call never run: ten slow mappings sent at once, the first nine cancelled at
    // once, cost about one.
    const queueWorker = createWorker();
    const queued = await queueWorker.cluster(noise(300, 200, 9));
    const slow = { method: 'ordered', steps: 32 };
    const single = await time(queued.quantize(64, { dither: slow }));
    const controllers = Array.from({ length: 10 }, () => new AbortController());
    const calls = controllers.map((controller) => queued.quantize(64, { dither: slow, signal: controller.signal }));
    const skipped = calls.slice(0, 9).map((call) => call.then(() => 'ran', (error) => error.name));
    controllers.slice(0, 9).forEach((controller) => controller.abort());
    const last = await time(calls[9]);
    details.workerQueuedCancelSkipped = `one mapping ${Math.round(single.ms)} ms, the last of ten ${Math.round(last.ms)} ms`;
    checks.workerQueuedCancelSkipped = (await Promise.all(skipped)).every((name) => name === 'AbortError') && !last.error && last.ms < single.ms * 3;
    // Skipping a cancelled call costs next to nothing: a hundred quick calls, ninety-nine cancelled, take milliseconds (a
    // zero timeout per call would be stretched to 4 ms each once timers nest).
    const quick = await queueWorker.cluster(image);
    const many = Array.from({ length: 100 }, () => new AbortController());
    const quickCalls = many.map((controller) => quick.quantize(4, { signal: controller.signal }));
    quickCalls.slice(0, 99).forEach((call) => call.catch(() => {}));
    many.slice(0, 99).forEach((controller) => controller.abort());
    const lastQuick = await time(quickCalls[99]);
    details.workerQueuedCancelCheap = `the last of a hundred took ${Math.round(lastQuick.ms)} ms`;
    checks.workerQueuedCancelCheap = !lastQuick.error && lastQuick.ms < 150;
    await queueWorker.terminate();

    // The page stays responsive while a clustering runs in slices: timers keep firing, and the longest gap between ticks
    // is a small fraction of the whole clustering (without slices it blocks for all of it).
    const gaps = async (run) => {
        let last = performance.now(), worst = 0, ticks = 0;
        const timer = setInterval(() => {const now = performance.now(); worst = Math.max(worst, now - last); last = now; ticks++;}, 4);
        await run();
        // The gap still open when the run ends: for a run that blocks, that is the whole run, during which no tick could
        // fire (on a fast machine none fires at all).
        worst = Math.max(worst, performance.now() - last);
        clearInterval(timer);
        return { worst, ticks };
    };
    const blocking = await gaps(() => ac.getClustering(big));
    const sliced2 = await gaps(() => ac.getClustering(big, { onProgress: () => {} }));
    // The page gets turns while it slices (a few at least: a fast machine finishes in a few dozen milliseconds), and its
    // longest wait is a small part of the blocking run's.
    checks.slicingKeepsThePageResponsive = sliced2.ticks >= 3 && sliced2.worst < Math.max(150, blocking.worst * 0.5);
    details.slicingKeepsThePageResponsive = `ticks ${sliced2.ticks}, longest gap ${sliced2.worst.toFixed(1)} ms sliced against ${blocking.worst.toFixed(1)} ms blocking`;

    // transfer: true hands the pixel buffer to the worker (the caller's copy is emptied) and the result is still right.
    const movable = new ImageData(new Uint8ClampedArray(image.data), width, height);
    const reference = await ac.quantize(image, 8);
    const mover = createWorker({ transfer: true });
    const moved = await mover.quantize(movable, 8);
    checks.transferDetachesInputAndKeepsResult = movable.data.length === 0 && moved instanceof ImageData && equal(moved.data, reference.data);
    await mover.terminate();

    // A wide-gamut canvas's pixels are in display-p3, so the result has to say so or its colours shift when drawn.
    let wideGamut = null;
    try {wideGamut = new ImageData(8, 8, { colorSpace: 'display-p3' });} catch (unsupported) {/* an engine without wide-gamut ImageData */}
    // Some engines accept the setting but have no colorSpace on ImageData at all; there is nothing to keep there.
    if (wideGamut && wideGamut.colorSpace === 'display-p3') {
        for (let i = 0; i < wideGamut.data.length; i += 4) {wideGamut.data.set([(i * 7) & 255, (i * 3) & 255, 40, 255], i);}
        const gamut = createWorker();
        const viaMain = await ac.quantize(wideGamut, 4);
        const viaWorker = await gamut.quantize(wideGamut, 4);
        const viaHandle = await (await gamut.cluster(wideGamut)).quantize(4);
        await gamut.terminate();
        checks.imageDataKeepsItsColorSpace = [viaMain, viaWorker, viaHandle].every((result) => result.colorSpace === 'display-p3');
    } else {
        checks.imageDataKeepsItsColorSpace = true;
    }

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

// The name and message first: Safari's stack traces leave them out.
run().then((checks) => {window.result = {checks, details};}, (error) => {window.result = {error: error instanceof Error ? `${error.name}: ${error.message}\n${error.stack}` : String(error)};});
