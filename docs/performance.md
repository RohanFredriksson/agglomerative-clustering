# Performance and limits

Times are from an idle laptop (Intel Core i7-1185G7, Node 24). A busy or throttled machine, a laptop on battery or a CI runner can be several times slower.

## Speed

Time and memory grow with the number of *distinct colours*, not just pixels. A 768×512 photo clusters in about 70 ms (24 ms with `precision: 6`), and every cut after that takes about 0.4 ms. A 12-megapixel photo takes 2 to 8 s exact (0.2 to 0.9 million distinct colours) and 0.1 to 0.4 s with `precision: 6`; 36 megapixels of random noise (the worst case) take about 6 s with `precision: 6`. Mapping pixels to a palette takes milliseconds: 6 ms at 768×512, 27 ms dithered (seconds for a large image dithered: [the guides](guides.md#cancelling-or-showing-progress-while-mapping-a-large-image) show how to cancel it or show progress).

For a palette, downscale first: 512 px on the long side changes the palette by about 2% and is 3 to 8 times faster. See the [benchmarks](../bench/COMPARISON.md) for comparisons with other libraries.

## Servers

Cap the pixel count of uploads (check the header's dimensions before decoding, as sharp's `limitInputPixels` does), use `precision: 6` (it bounds the memory an image with very many colours needs), and run the work in workers so a clustering doesn't block the event loop. One worker runs one call at a time, so create a few:

```js
import { createWorker } from 'agglomerative-clustering/worker';

// Four workers; each call goes to the one with the least work waiting.
const pool = Array.from({ length: 4 }, () => ({ worker: createWorker(), waiting: 0 }));
const run = async (method, ...args) => {
  const slot = pool.reduce((best, next) => (next.waiting < best.waiting ? next : best));
  slot.waiting++;
  const call = slot.worker[method];
  try {return await call(...args);} finally {slot.waiting--;}
};

// In a request handler (Fastify shown): stop the work if the client goes away. In Node, listen on the response's
// 'close' (reply.raw, or res in Express), not the request's.
const controller = new AbortController();
reply.raw.on('close', () => {if (!reply.raw.writableFinished) {controller.abort();}});
const swatches = await run('buildSwatches', image, 8, { precision: 6, signal: controller.signal });
```

- **Small images wait behind large ones** in a shared pool. If you serve both, give large uploads a pool of their own.
- **Reuse workers.** Create a few and keep them; a worker created per request and dropped keeps its thread until it is terminated (or, eventually, garbage-collected). `terminate()` on each worker shuts the pool down.
- **Stored clusterings:** make them with `precision: 6`. An exact clustering of a noisy 4-megapixel image is 78 MB, against 5.5 MB at `precision: 6`. Read back, wrap the bytes once with `new Clustering(bytes)` and keep that object while you use it: its checksum is checked the first time an object is used (2 to 3 ms for a photo's clustering).

## Memory

- **Per call:** one WebAssembly instance can use up to 2 GB, so a pool of four workers can peak near 8 GB on hostile input; a pixel cap and `precision: 6` keep it to a fraction of that. Running out is a catchable `out-of-memory` error, and later calls work normally.
- **Coming back:** WebAssembly memory only grows, so after a call that leaves it above 256 MB the library drops the instance (the next call loads a fresh one, in milliseconds). The engine frees the old instance's memory at its next garbage collection, which in an idle process or worker can be much later: a worker that clustered 12 megapixels of noise held about 1 GB until it had served about a hundred more calls. `terminate()` frees a worker's memory at once.
- **Address space:** each WebAssembly instance (the main entry's, and one per worker) reserves about 10 GB of *virtual* memory up front on 64-bit engines, of which it uses only what it needs. A virtual-memory limit (`ulimit -v`) refuses that reservation, which shows as `wasm-load-failed`; limit resident memory instead. A container's memory limit (a cgroup's `memory.max`, Docker's `--memory`) applies to what is used, but when it is reached the kernel kills the process: there is no `out-of-memory` error to catch, so cap the image size below it.

## Large images

An image's pixel data must stay under about 1.9 GB (about 480 megapixels of RGBA: 22000 × 22000 works), as one WebAssembly instance holds at most 2 GB for the pixels and the work on them. Larger input is rejected up front with `out-of-memory`, giving its size. For a palette of a huge image, scale it down (a few megapixels give as good a palette); to map a full-size image, map it in strips with `quantizeWithPalette`.

<!-- bench/spikes/slicing-build/slices.mjs → results-slices.txt -->
With `signal` or `onProgress`, clustering runs in slices of about 10 ms, every step of it, so an abort takes effect within a slice. A slice can overrun a little: the longest measured was 25 ms on a 12-megapixel photo and 37 ms on 4 megapixels of noise at full precision (before 3.6.0, building the grid and writing the result ran in one piece: 220 ms on that photo and 1.4 s on that noise in OKLab). Progress moves unevenly, since merging takes most of the time.

<!-- bench/spikes/slicing-mapping/slices.mjs → results-slices.txt; overhead.mjs → results-overhead.txt -->
From 3.7.0 mapping runs in slices too, with every dither method, so `signal` stops a mapping within a slice and `onProgress` reports during it. On a 6.3-megapixel photo and 4 megapixels of noise, at 16 to 4096 colours, slices were 10 to 16 ms, and up to 39 ms with ordered dithering at 64 steps and 4096 colours. The result is the same as one call's, and a sliced call takes within about 2% of the time of one call from 768×512 up (on a 64×64 image a few hundredths of a millisecond more). Each sliced call on the main thread holds its image and result in the WebAssembly heap until it finishes, so several running at once add up; the instance is dropped afterwards as usual (see "Coming back" above).
