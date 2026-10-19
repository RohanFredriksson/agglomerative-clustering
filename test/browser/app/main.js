// Bundled by test/browser/run.mjs. Runs both entries in the browser and reports to window.result.
import * as ac from 'agglomerative-clustering';
import { createWorker, quantize as workerQuantize } from 'agglomerative-clustering/worker';

const equal = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

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
    const indexed = await handle.quantizeToIndices(16);
    checks.indexedOutput = indexed.indices.length === width * height && indexed.palette.length <= 48;
    checks.weightsSumToPixels = (await handle.getPaletteWeights(16)).reduce((a, b) => a + b, 0) === width * height;
    await handle.release();
    await worker.terminate();
    return checks;
}

run().then((checks) => {window.result = {checks};}, (error) => {window.result = {error: String(error && error.stack || error)};});
