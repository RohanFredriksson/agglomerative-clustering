// The recipe for cancelling any mapping exactly: run it in a worker of its own and terminate the worker on abort.
// Measures, in Node, how long after the abort the call rejects (a 3072x2048 noise image, ordered dithering at 256
// colours, about 15 s in one piece, aborted after 300 ms), and what a worker of its own costs: the first call on a
// fresh createWorker() (start the thread, load the module) against the same call on a worker already running.
// Run from the repo root: node bench/spikes/slicing-mapping/cancel-worker.mjs > bench/spikes/slicing-mapping/results-cancel-worker.txt
import { resolve } from 'path';
const { createWorker } = await import(resolve('dist/worker.mjs'));

const W = 3072, H = 2048;
let seed = 7;
const noise = () => new Uint8Array(W * H * 4).map((_, i) => (i % 4 === 3 ? 255 : (seed = (seed * 16807) % 2147483647) & 255));
const palette = new Uint8Array(768).map((_, i) => (i * 97) & 255);
const tiny = { data: new Uint8Array(64 * 64 * 4).fill(200), format: 'rgba', width: 64, height: 64 };

const median = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
const runs = 7, toReject = [], cold = [], warm = [];
for (let run = 0; run < runs; run++) {
    const worker = createWorker();
    await worker.quantizeToIndicesWithPalette(tiny, palette);          // started and loaded
    const call = worker.quantizeToIndicesWithPalette({ data: noise(), format: 'rgba', width: W, height: H }, palette, { dither: 'ordered' });
    await new Promise((done) => setTimeout(done, 300));
    const aborted = performance.now();
    worker.terminate();
    try {await call;} catch (error) {if (error.code !== 'worker-terminated') {throw error;}}
    toReject.push(performance.now() - aborted);

    const fresh = createWorker();
    let t = performance.now();
    await fresh.quantizeToIndicesWithPalette(tiny, palette);
    cold.push(performance.now() - t);
    t = performance.now();
    await fresh.quantizeToIndicesWithPalette(tiny, palette);
    warm.push(performance.now() - t);
    await fresh.terminate();
}
const show = (xs) => `median ${median(xs).toFixed(1)} ms, range ${Math.min(...xs).toFixed(1)} to ${Math.max(...xs).toFixed(1)} ms`;
console.log(`Node ${process.version}, ${runs} runs`);
console.log(`abort to rejection (terminate during a ~15 s ordered mapping): ${show(toReject)}`);
console.log(`first call on a fresh worker (64x64 image):                    ${show(cold)}`);
console.log(`same call on a running worker:                                 ${show(warm)}`);
