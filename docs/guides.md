# Guides

Recipes by task. For what each function and option does, see the [API reference](api.md); for setting up a bundler, framework or runtime, see [Environments](environments.md).

- [Swatches and choosing a palette size](#swatches-and-choosing-a-palette-size)
- [GIFs and palette PNGs](#gifs-and-palette-pngs)
- [Animated GIFs and sets of images](#animated-gifs-and-sets-of-images)
- [Live video and camera frames](#live-video-and-camera-frames)
- [Workers](#workers)
- [Fixed palettes: e-ink, thread, bricks](#fixed-palettes-e-ink-thread-bricks)
- [Batches of images](#batches-of-images)
- [Converting the output](#converting-the-output)
- [Moving from color-thief, node-vibrant, image-q or get-image-colors](#moving-from-color-thief-node-vibrant-image-q-or-get-image-colors)

## Swatches and choosing a palette size

```js
import { getSwatches, getClustering, getSwatchesFromClustering, getClusteringInfo } from 'agglomerative-clustering';

// Colours with their share of the image, in one call
const { palette, weights, shares } = await getSwatches(image, 8);
// palette: flat RGB bytes, weights: pixels per colour, shares: each colour's share of the image (they sum to 1)

// Or cluster once and cut it as often as you like (well under a millisecond each)
const clustering = await getClustering(image);
const eight = await getSwatchesFromClustering(clustering, 8);

// The smallest palette that keeps 99% of the image's colour variance (works the same in 'rgb' and 'oklab')
const { explained } = await getClusteringInfo(clustering);
const k = explained.findIndex((share) => share >= 0.99) + 1;
```

How many to ask for: 5 to 8 for a set of swatches to show. To *pick* from them (an accent colour, a theme), ask for 12 to 16: a small vivid area, such as a red sign in a street scene, only gets a colour of its own once the bigger areas have been split. Each colour is the average of its cluster, so it is a little less saturated than the image's most vivid pixels, and a white background comes back as a near-white such as `[254, 254, 254]` rather than exactly `#ffffff`. On a smooth single-hue photo no colour has a large share (the shares fall as `k` grows), so judge the heaviest swatch against the others, not by a fixed share. See [Picking colours from swatches](#picking-colours-from-swatches).

## GIFs and palette PNGs

`quantizeToIndices` returns a palette and one index per pixel, which is what these formats store. With `transparent`, pixels below an alpha cutoff share one transparent entry, which counts in `k`; a colour is kept besides it whenever the image has visible pixels, so `k = 1` can give 2 entries (an image with no visible pixels gives just the transparent entry).

**A GIF** with [gifenc](https://github.com/mattdesl/gifenc), keeping a transparent background:

```js
import * as gifenc from 'gifenc';
// Bundlers read gifenc's ES module, which has the named export; plain Node reads its CommonJS build, which has it on the default.
const GIFEncoder = gifenc.GIFEncoder ?? gifenc.default.GIFEncoder;
import { quantizeToIndices } from 'agglomerative-clustering';

// k counts the transparent entry, so 256 is the most a GIF holds. `image` is { data, format: 'rgba', width, height }.
const { palette, indices, indexBits, transparentIndex } = await quantizeToIndices(image, 256, { transparent: true });
if (indexBits !== 8) {throw new Error('unreachable: 256 entries or fewer have 8-bit indices');}   // tells TypeScript `indices` is a Uint8Array
// gifenc and fast-png take a palette as [r, g, b] entries; the library's is flat bytes, transparent entry included.
const toEntries = (flat) => Array.from({ length: flat.length / 3 }, (_, i) => [flat[3 * i], flat[3 * i + 1], flat[3 * i + 2]]);
const entries = toEntries(palette);

const gif = GIFEncoder();
gif.writeFrame(indices, image.width, image.height, { palette: entries, transparent: transparentIndex !== null, transparentIndex: transparentIndex ?? 0 });
gif.finish();
const bytes = gif.bytes();
```

**A palette PNG** with [fast-png](https://github.com/image-js/fast-png): the same call, then move the transparent entry to the front and give it alpha 0. A PNG lists alpha for the first palette entries, in order, and fast-png writes only the alphas below 255, so the transparent entry has to come first or the alpha lands on the wrong colour:

```js
import { encode } from 'fast-png';

// Swap the transparent entry with entry 0 (when there is one), in the palette and in the indices.
const t = transparentIndex ?? 0;
const swap = (i) => (i === t ? 0 : i === 0 ? t : i);
const png = encode({
  width: image.width, height: image.height, depth: 8, channels: 1,
  data: indices.map(swap),
  palette: entries.map((_, i) => [...entries[swap(i)], i === 0 && transparentIndex !== null ? 0 : 255]),
});
```

## Animated GIFs and sets of images

One palette for a whole animation (or a set of images that should share colours) keeps colours from flickering between frames. Cluster a sample of the frames as one image, by putting their pixels end to end, then map every frame with that clustering:

```js
import { getClustering, getPaletteFromClustering, quantizeToIndicesWithPalette } from 'agglomerative-clustering';

// `frames` are { data, format: 'rgba', width, height }. Every 5th one, end to end, is one image to cluster.
const sample = frames.filter((_, i) => i % 5 === 0);
const pixels = new Uint8Array(sample.reduce((n, frame) => n + frame.data.length, 0));
let offset = 0;
for (const frame of sample) {pixels.set(frame.data, offset); offset += frame.data.length;}
const clustering = await getClustering({ data: pixels, format: 'rgba' }, { precision: 6, transparent: true });
const shared = await getPaletteFromClustering(clustering, 255);   // 255 colours, and room for the transparent entry

for (const frame of frames) {
  // The same colours at the same indices in every frame, and the transparent entry (when a frame has transparent pixels)
  // right after them: index 255, or fewer when the sample has fewer than 255 colours. Ordered dithering is a fixed pattern, so the parts of the picture that don't move stay the same from
  // frame to frame; error diffusion would make them shimmer.
  const { palette, indices, transparentIndex } = await quantizeToIndicesWithPalette(frame, shared, { transparent: true, dither: 'ordered' });
  gif.writeFrame(indices, width, height, { palette: toEntries(palette), transparent: transparentIndex !== null, transparentIndex: transparentIndex ?? 0 })
}
```

- **Cut once, map with the palette.** A palette passed to `quantizeToIndicesWithPalette` has the transparent entry added after it, so 255 colours make at most 256 entries. Cutting per frame instead (`quantizeToIndicesFromClustering(frame, clustering, 256)`) gives a frame without transparent pixels 256 colours, a finer cut with one colour split in two, so still parts of the picture would change colour between frames.
- **A frame with no transparent pixels has no transparent entry**, so its palette is one entry shorter; a GIF with one global palette can use the longer one throughout. Take the transparent entry's index from `transparentIndex` (it is `shared.length / 3`: 255 when the sample has that many colours, fewer for an animation of few colours, such as pixel art).
- **In parallel:** with the worker entry, a few `createWorker()`s map frames side by side. On small frames (320×240) the cost of sending them across outweighs the gain.

## Live video and camera frames

For a palette that follows a video or a camera (ambient light, a live theme), take each frame small and **skip frames while the worker is busy**:

```js
import { createWorker } from 'agglomerative-clustering/worker';

const worker = createWorker({ transfer: true });   // each frame's pixels are fresh, so move them rather than copy
const canvas = new OffscreenCanvas(160, 90);         // a small copy is plenty for a palette
const ctx = canvas.getContext('2d', { willReadFrequently: true });
let busy = false;

const onFrame = () => {
  if (!busy) {
    busy = true;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    worker.getPalette(ctx.getImageData(0, 0, canvas.width, canvas.height), 6, { precision: 6 })
      .then(show, console.error)
      .finally(() => {busy = false;});
  }
  video.requestVideoFrameCallback(onFrame);
};
video.requestVideoFrameCallback(onFrame);
```

- **Don't abort the running call when a new frame arrives**, as the slider in [Workers](#workers) does. A slider stops; frames keep coming, so when each palette takes longer than a frame, every call is aborted before it finishes and no palette ever arrives. Skip frames instead, or keep only the newest one waiting.
- **Size.** In a worker with `precision: 6` a palette took about 20 ms at 160×90, 50 ms at 320×180, 100 ms at 640×360 and 185 ms at 1280×720 (on a busy machine, so a ceiling); exact precision is 3 to 7 times slower. 160×90 keeps up with 30 frames a second.
- **Flicker.** Each frame is clustered on its own, so even a still scene with a little noise gives palettes whose colours shift, swap places or split differently from frame to frame. Follow the previous palette and smooth it; in testing this cut the flicker about fourfold, for a lag of two or three frames:

  ```js
  // Match each colour of the previous (smoothed) palette to its nearest new colour, then move a quarter of the way there.
  const follow = (previous, next, weight = 0.25) => {
    if (!previous || previous.length !== next.length) {return Array.from(next);}
    const free = new Set(Array.from({ length: next.length / 3 }, (_, i) => i));
    const smoothed = [];
    for (let i = 0; i < previous.length; i += 3) {
      let best = 0, bestDistance = Infinity;
      for (const j of free) {
        const d = (previous[i] - next[3 * j]) ** 2 + (previous[i + 1] - next[3 * j + 1]) ** 2 + (previous[i + 2] - next[3 * j + 2]) ** 2;
        if (d < bestDistance) {bestDistance = d; best = j;}
      }
      free.delete(best);
      for (let c = 0; c < 3; c++) {smoothed.push(previous[i + c] + weight * (next[3 * best + c] - previous[i + c]));}
    }
    return smoothed;   // fractional values: round them for display
  };
  ```
- **One palette for a whole clip** (no flicker at all) is the [animated GIF](#animated-gifs-and-sets-of-images) recipe: cluster a sample of frames once.
- **In Node**, pipe ffmpeg's raw output and hand each frame to a few `createWorker()`s; memory stayed flat over thousands of frames in testing. Ask for `-f rawvideo -pix_fmt bgra` and pass `format: 'bgra'`, or `-pix_fmt bgr0` with `format: 'bgrx'` for video without alpha (ffmpeg fills that byte with 255 for opaque sources but passes alpha through from sources that have it, so `'bgrx'` is the safe name). Frames arrive in pipe chunks of any size, so collect exactly `width × height × 4` bytes per frame:

  ```js
  import { spawn } from 'node:child_process';
  const ffmpeg = spawn('ffmpeg', ['-i', input, '-vf', 'scale=160:90', '-f', 'rawvideo', '-pix_fmt', 'bgr0', '-']);
  const size = 160 * 90 * 4;
  let pending = Buffer.alloc(0);
  for await (const chunk of ffmpeg.stdout) {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= size) {
      const frame = { data: pending.subarray(0, size), format: 'bgrx', width: 160, height: 90 };
      pending = pending.subarray(size);
      onPalette(await worker.getPalette(frame, 8, { precision: 6 }));
    }
  }
  ```
- **WebCodecs frames** copy straight into a format the library reads, cheaper than drawing to a canvas: `frame.copyTo(buffer, { format: 'BGRA' })` gives BGRA whatever the frame holds (decoders give I420), sized by `frame.allocationSize({ format: 'BGRA' })`. Pass `{ data: buffer, format: 'bgra', width: frame.visibleRect.width, height: frame.visibleRect.height }`, which is what `copyTo` copies (`displayWidth` differs for video with non-square pixels), and call `frame.close()` once copied. Ask for `'BGRA'`, not `'BGRX'`: in a `'BGRX'` copy the fourth byte isn't reliably 255 (frames made from a canvas carry their alpha into it), and if you do get `'BGRX'` frames pass them as `'bgrx'`. Frames made from a canvas copy out premultiplied; decoded video is opaque, so it is the same either way.

## Workers

Clustering a photo takes about 70 ms, too long to run on a page's main thread while someone drags a slider. The worker entry has the same functions, run in a Web Worker (or a worker thread in Node):

```js
import { quantize } from 'agglomerative-clustering/worker';   // same API, one shared worker
const reduced = await quantize(imageData, 16);
```

For live re-cutting, `createWorker().cluster(image)` keeps the image and its clustering in the worker, so each new palette size sends only `k` across:

```js
import { createWorker } from 'agglomerative-clustering/worker';

const worker = createWorker();
const handle = await worker.cluster(imageData, { precision: 6 });

let controller = null;
slider.oninput = async () => {
  controller?.abort();                  // a size the slider has already moved past isn't worth finishing
  const mine = (controller = new AbortController());
  try {
    ctx.putImageData(await handle.quantize(Number(slider.value), { dither: true, signal: mine.signal }), 0, 0);
  } catch (error) {
    if (!mine.signal.aborted) {throw error;}   // an abort is expected; anything else is a real failure
  }
};
```

Calls to one worker run in order, and re-mapping a large image takes a while (0.2 to 0.3 s at 12 megapixels, about 1 s dithered), so without the `signal` a fast drag queues up every size it passed through and the picture keeps changing after the slider stops. Re-cutting alone (`handle.getPalette(k)`, `handle.getSwatches(k)`) takes well under a millisecond and needs none of this.

Cancelling skips calls still waiting their turn, but a call already mapping finishes: mapping runs in one piece. With an expensive method (ordered dithering with many steps can take a second or more; see [Choosing a dither method](api.md#choosing-a-dither-method)), keep the picture close behind the slider by running one call at a time and only ever the newest setting:

```js
let running = false, wanted = null;
const render = async () => {
  if (running) {return;}            // the call in flight picks up `wanted` when it finishes
  running = true;
  try {
    while (wanted !== null) {
      const k = wanted;
      wanted = null;
      ctx.putImageData(await handle.quantize(k, { dither: 'ordered' }), 0, 0);
    }
  } finally {
    running = false;
  }
};
slider.oninput = () => {wanted = Number(slider.value); render();};
```

- **Bundlers.** The worker is started with `new Worker(new URL('./worker-thread.mjs', import.meta.url))`, which Vite, webpack 5, Rsbuild and Next.js pick up. Angular, plain esbuild and Rollup need the script copied for them: see [Angular, esbuild, Rollup and other bundlers](environments.md#angular-esbuild-rollup-and-other-bundlers).
- **Terminate the workers you create.** A worker you make with `createWorker()` keeps its thread until `terminate()` (or `await using worker = createWorker()`). The shared worker behind the exported functions needs nothing.
- **TypeScript:** a handle keeps the image type it was made from, so a variable that holds one is `ClusteringHandle<ImageData> | null`, not a bare `ClusteringHandle`.

The rest is in the [worker entry reference](api.md#worker-entry).

## Fixed palettes: e-ink, thread, bricks

Hardware, craft and print often have a palette you didn't choose. `quantizeToIndicesWithPalette(image, palette, options?)` maps to it and gives indices in *your* palette's order (what firmware, thread charts and parts lists need):

```js
const eink = [0,0,0, 255,255,255, 0,255,0, 0,0,255, 255,0,0, 255,255,0, 255,128,0];   // black white green blue red yellow orange
const { indices } = await quantizeToIndicesWithPalette({ data, format: 'rgba', width }, eink, { dither: true });
// indices[i] is the entry of `eink` for pixel i: pack it to 4 bits per pixel for the panel
```

- **Undithered, every pixel gets its nearest entry** (ties go to the smaller RGB value, and a repeated entry gets its first index). Dithering diffuses the error to the neighbours, and keeps working when the palette can't reach the image's colours: saturated cyan with the seven e-ink inks comes out as an even mix of white, green and blue, not solid blue. With a few widely spaced inks, dithering in sRGB values makes photos come out much lighter on the panel: convert to linear light first (a few lines, in [Dithering to a few inks: mix in light](api.md#dithering-to-a-few-inks-mix-in-light)), then use error diffusion (`dither: true`) for stills, or `dither: 'ordered'` where a fixed pattern matters (an animated or partly refreshed display). See [Choosing a dither method](api.md#choosing-a-dither-method).
- **Colour space is a choice here too, and the answer differs from clustering.** `'oklab'` keeps skin tones from going olive when mapping *without* dithering; with small palettes of widely spaced inks (e-ink, grey levels), dither in `'rgb'` after converting to linear light, as [Dithering to a few inks: mix in light](api.md#dithering-to-a-few-inks-mix-in-light) shows (in OKLab the recipe's linear values would be read as sRGB). Without that conversion every method makes photos too light, and OKLab more so in black and white.
- **Choosing N colours from a fixed set** (the 12 threads that best represent a photo out of 400) has no function of its own, but two short functions do it.
  - **`chooseThreads`** cuts the clustering, snaps each cut colour to its nearest thread, and cuts finer until N distinct threads appear. After clustering it takes about a millisecond. On the Kodak photos with large charts it beat "the N most used threads" by about 3 to 4 dB PSNR at 6 to 12 threads; the gain shrinks as N grows.
  - **`improveThreads`** then swaps threads in and out while a swap brings the mapped image closer to the photo. It can find a thread that serves several of the image's colours at once, which snapping each cut colour can't. On the 24 Kodak photos with a 584-colour chart it added 0.4 to 0.45 dB PSNR at 6 and 12 threads (0.25 at 24), was better on 22 to 24 of the 24 photos and worse on none, and gained more with dithering. It measures distance in sRGB values, so with very few inks (4 of 26 in testing) it can make the mean ΔE2000 slightly worse; if you map with `colorSpace: 'oklab'`, compare the two choices on your image. On the page it shows as a closer match in large soft areas such as backgrounds and skin. It works on 1024 swatches, so its time doesn't grow with the image; it grows with the number of threads times N: about 50 ms for 6 of 584 threads, 150 ms for 12 and 350 ms for 24, and up to 1.5 s for 40 of 1000. The loop is your own code, so the library's worker entry can't move it off the main thread: for large charts in a browser, run both functions in a Web Worker of your own that imports the main entry. Skip it when `chooseThreads` is good enough.

  ```js
  import { getClustering, getPaletteFromClustering, getSwatchesFromClustering, quantizeToIndicesWithPalette } from 'agglomerative-clustering';

  const clustering = await getClustering(image);
  const chosen = await improveThreads(clustering, threads, await chooseThreads(clustering, threads, 12));
  // chosen: indices into `threads` (flat RGB). Swapped-in threads take their predecessors' places, so the order is arbitrary.

  // The indices of n threads that represent the clustered image well.
  async function chooseThreads(clustering, threads, n) {
    let chosen = [];
    for (let k = n; k <= 4 * n && chosen.length < n; k++) {
      const cut = await getPaletteFromClustering(clustering, k);
      // The cut palette as an image of one pixel per colour, mapped to the threads.
      const { indices } = await quantizeToIndicesWithPalette({ data: cut, format: 'rgb' }, threads);
      // Split order puts the coarsest colours first, so when a cut gives more than n threads, the first n are kept.
      chosen = [...new Set(indices)].slice(0, n);
    }
    return chosen;   // can be fewer than n for an image with few colours
  }

  // Swaps threads in and out of `chosen` while that brings the image closer, measured on 1024 swatches.
  async function improveThreads(clustering, threads, chosen) {
    const { palette: colors, weights } = await getSwatchesFromClustering(clustering, 1024);
    const m = weights.length, t = threads.length / 3;
    const distance = new Float64Array(t * m);   // distance[j * m + i]: squared, from thread j to swatch i
    for (let j = 0; j < t; j++) {
      for (let i = 0; i < m; i++) {
        const dr = threads[3 * j] - colors[3 * i], dg = threads[3 * j + 1] - colors[3 * i + 1], db = threads[3 * j + 2] - colors[3 * i + 2];
        distance[j * m + i] = dr * dr + dg * dg + db * db;
      }
    }
    chosen = [...chosen];
    for (;;) {
      // Each swatch's nearest chosen thread (its position in `chosen`) and the distances to the nearest two.
      const nearest = new Int32Array(m), first = new Float64Array(m).fill(Infinity), second = new Float64Array(m).fill(Infinity);
      let current = 0;
      for (let i = 0; i < m; i++) {
        chosen.forEach((j, s) => {
          const d = distance[j * m + i];
          if (d < first[i]) {second[i] = first[i]; first[i] = d; nearest[i] = s;} else if (d < second[i]) {second[i] = d;}
        });
        current += weights[i] * first[i];
      }
      // The best swap of an unchosen thread j for the chosen thread at position s, if any is better.
      let best = null, lowest = current * (1 - 1e-9);
      for (let j = 0; j < t; j++) {
        if (chosen.includes(j)) {continue;}
        for (let s = 0; s < chosen.length; s++) {
          let error = 0;
          for (let i = 0; i < m; i++) {error += weights[i] * Math.min(distance[j * m + i], nearest[i] === s ? second[i] : first[i]);}
          if (error < lowest) {lowest = error; best = [s, j];}
        }
      }
      if (!best) {return chosen;}
      chosen[best[0]] = best[1];
    }
  }
  ```
- **Transparent pixels** map to whichever entry is nearest their colour values (often black, as fully transparent pixels are often stored as black, but not always) unless you pass `transparent`, which appends an entry for them (so a 1- or 2-bit panel has no room for it): composite the image onto your background first.
- **Index width:** up to 256 entries give 8-bit indices; more give 16-bit ones (`indexBits` says which), so a 257-colour palette doesn't fit an 8-bit format.
- **Speed:** a palette of more than 1024 colours is mapped about three times slower than one of 1024 or fewer, and dithered about four to six times slower (at 12 megapixels, about 2 s with 1024 colours against 8 to 13 s with 1025 to 2000).

## Batches of images

For placeholders, theming or colour search over a site's images, one call each is fast enough, and most of the time goes to decoding:

- **Downscale first.** 512 px on the long side changes the palette by about 2% (256 px by 6%, 64 px by half) and is 3 to 8 times faster; with `precision: 6` a photo takes about 20 ms.
- **Use a few workers, not one per image.** The main entry runs one call at a time, so throughput comes from several `createWorker()`s (the [pool](performance.md#servers)). About four is the sweet spot; more mostly adds memory.
- **Cache palettes, not clusterings:** 1,500 palettes are about half a megabyte of JSON, and 1,500 clusterings are 0.2 to 1 GB. Key the cache by the image's content hash, the library's version and your options (a bug fix in a minor release can change a palette: see [stability](stability.md)).
- **A dominant colour** is the heaviest swatch of `getSwatches(image, 5)` (sort by `shares`). These colours are averages of regions, so they are muted: for vivid accents, a library built for them (node-vibrant, color-thief) suits better.

## Converting the output

Palettes are flat RGB bytes, the compact form; each format an encoder or UI wants is a line or two away. Given a `palette` (and `weights` and `shares` from `getSwatches`):

```js
// [[r, g, b], …]: what gifenc, fast-png, color-thief and libimagequant use
const colors = Array.from({ length: palette.length / 3 }, (_, i) => [palette[3 * i], palette[3 * i + 1], palette[3 * i + 2]]);

// A CSS colour, a '#rrggbb' string and a 0xRRGGBB number
const css = (i) => `rgb(${palette[3 * i]} ${palette[3 * i + 1]} ${palette[3 * i + 2]})`;
const hexString = (i) => '#' + Array.from(palette.subarray(3 * i, 3 * i + 3), (v) => v.toString(16).padStart(2, '0')).join('');
const hex = (i) => (palette[3 * i] << 16) | (palette[3 * i + 1] << 8) | palette[3 * i + 2];

// Swatches with their share of the image (in split order: sort by `share` to put the biggest first)
const swatches = Array.from(shares, (share, i) => ({ color: css(i), share }));
```

### Heaviest first

Palettes come in split order, so the biggest colour isn't necessarily first. To rank them, sort; sorted palettes of different sizes no longer nest.

```js
// A palette and its weights, heaviest first
const order = Array.from(weights.keys()).sort((a, b) => weights[b] - weights[a]);   // old index of the 1st, 2nd, … entry
const rankedColors = order.map((i) => colors[i]);
const rankedShares = order.map((i) => shares[i]);

// An indexed image, heaviest first: count how many pixels use each entry (that is what "heaviest" means for the image),
// sort, and renumber the indices
const used = new Uint32Array(palette.length / 3);
for (const index of indices) {used[index]++;}
const byUse = Array.from(used.keys()).sort((a, b) => used[b] - used[a]);
const rank = new Uint32Array(used.length);
byUse.forEach((old, position) => {rank[old] = position;});
const rankedPalette = byUse.map((old) => colors[old]);
const rankedIndices = indices.map((index) => rank[index]);                           // same typed-array type as `indices`
const rankedTransparentIndex = transparentIndex === null ? null : rank[transparentIndex];
```

### Picking colours from swatches

The library answers which colours an image has and how much of each; choosing among them (a vivid accent, text that contrasts with a background) is colour arithmetic that a colour library already does well. With [culori](https://culorijs.org/):

```js
import { getSwatches } from 'agglomerative-clustering';
import { converter, wcagContrast, formatHex } from 'culori';

const oklch = converter('oklch');
const { palette, shares } = await getSwatches(image, 12);
const swatches = Array.from(shares, (share, i) => {
  const color = { mode: 'rgb', r: palette[3 * i] / 255, g: palette[3 * i + 1] / 255, b: palette[3 * i + 2] / 255 };
  return { hex: formatHex(color), share, ...oklch(color) };          // l (0-1), c (chroma), h (hue)
}).sort((a, b) => b.share - a.share);                                 // heaviest first

const background = swatches[0];
// The most colourful swatch that covers at least 2% of the image, as an accent
const accent = swatches.filter((s) => s.share >= 0.02 && s !== background).sort((a, b) => b.c - a.c)[0];
// Text: black or white, whichever contrasts more with the background
const text = wcagContrast(background.hex, '#000') > wcagContrast(background.hex, '#fff') ? '#000' : '#fff';
```

The colours come back as sRGB bytes whatever `colorSpace` they were clustered in; that option only changes how pixels are grouped, so the picks can differ between the two (see [Choosing a colour space](api.md#choosing-a-colour-space)).

## Moving from color-thief, node-vibrant, image-q or get-image-colors

This library takes **decoded pixels**, not files, URLs or image elements: decode first (sharp or pngjs in Node, a canvas or `createImageBitmap` in a browser), and see [Input](api.md#input) for the formats.

| You used | Use | Notes |
|---|---|---|
| color-thief `getColor(image)` | `getSwatches(image, 5, { precision: 6 })`, then the entry with the largest `shares` | The heaviest cluster's average colour. |
| color-thief `getPalette(image, n)` | `getPalette(image, n, { precision: 6 })` | Flat bytes; `[[r, g, b], …]` is one line ([Converting the output](#converting-the-output)). |
| get-image-colors | `getSwatches(image, n)`, and hex strings from the palette | Sort by `shares` for most-used first. |
| node-vibrant's named swatches (Vibrant, Muted, …) | `getSwatches(image, 16)`, then choose by saturation and lightness yourself ([Picking colours from swatches](#picking-colours-from-swatches)) | There are no named roles: these colours are averages, more muted than node-vibrant's picks. |
| image-q `buildPalette` and `applyPalette` | `quantize(image, k, { dither })`, or `getPalette` then `quantizeWithPalette` | Same idea, one call; `quantizeToIndices` for indexed output. |

- **Expect different colours.** The palettes are the ones with the least error, not the most vivid or the most frequent, so they won't match what you had (a mean ΔE2000 of 12 to 14 between matched colours, against color-thief, get-image-colors and node-vibrant, in testing).
- **Speed.** color-thief and node-vibrant sample pixels, so they are quick on photos; the exact default here is several times slower at photo sizes. With `precision: 6` it was level with color-thief at 12 megapixels; downscaling helps both. Against image-q it was 4 to 6 times faster.
- **Quality.** Undithered, the error was lower than image-q's Wu (at 16 colours, MSE 71 against 84). `dither: true` diffuses the whole error, so per-pixel error is higher than with image-q's Floyd–Steinberg while the image looks closer from a distance; a strength such as `dither: 0.5` sits between.
