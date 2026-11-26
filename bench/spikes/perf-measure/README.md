# Perf spike: where does the time go, and would threads pay?

A measurement spike on branch `spike/perf-measure`. Nothing in `src/`, `dist/`, the tests or the docs changed: everything is a copy,
instrumented or modified, under this directory. The maintainer's constraint, verbatim: "i do not wish to ruin the usability of the
library at the cost of performance". Each finding below says what it costs users next to what it saves.

Machine: i7-1185G7, which is **4 physical cores with SMT, shown as 8 cores**. Thread speed-ups at 8 threads therefore cap near
2.2 to 3x, not 8x. Node 24.18, Emscripten 6.0.12 (the `-O3 -msimd128` flags of `build:wasm`), clang 18.1.3 for native builds (in the
`localhost/ac-native` container). All timings are medians of the runs (5 runs at 0.4 and 12 MP, 3 at 50 MP, with exceptions listed
under "Not measured / caveats"). All timed tables come from runs on an otherwise quiet machine. The first full set of stage timings
was taken while a game was running on the same machine and was **2.2 to 3.4 times slower** (k23 304 ms against 144 ms, up12 25.6 s
against 7.5 s); it is kept in `results/stages-wasm-loaded/` and `results-stages-wasm-loaded.md` as a warning, and not used.

## Test images (`make-images.mjs`, written to `data/`, not committed)

| name | pixels | distinct colours | how made |
|---|---:|---:|---|
| k23, k03, k20 | 0.39 MP (768x512) | 72,079 / 34,871 / 24,470 | Kodak photos as they are |
| up12 | 12.4 MP (4320x2880) | 907,499 | kodim23, bilinear upscale x5.6 (new in-between colours) |
| up50 | 49.8 MP (8640x5760) | 1,261,092 | kodim23, bilinear upscale x11.25 |
| mos12 | 11.8 MP (3840x3072) | 288,588 | 5x6 mosaic of the 24 Kodak photos (mirrored once they repeat) |
| mos50 | 47.6 MP (8448x5632) | 288,588 | 11x11 mosaic of the same (so the same colours as mos12: it tests pixel count alone) |

The upscaled images are artificial: bilinear interpolation makes huge numbers of exactly tied costs (see question 2).

## Summary

1. **Stage split (single thread, shipped build, RGB, full precision).** The merge loop is 75 to 83% of the clustering at 0.4 MP, 87 to 93%
   at 12 MP and 79 to 98% at 50 MP (98% on the 1.26 M-colour image). The pixel scan is 2 to 17%, sorting the records 0.5 to 6%, the CRC 0.1 to
   2.5%. Callgrind agrees: the chain is 84% (k23), 87% (mos12) and 82% (mos50) of the clustering's instructions, `WardGrid::search` inside it.
   With `precision: 6` the merge loop falls to 31 to 72% and the scan rises to 12 to 66%: the 50 MP upscale clusters in 1.0 s instead of 43.6 s. The JS
   boundary (heap copy in and out, premultiply and unpremultiply) is 0.3 to 1% of a clustering call but 10 to 30% of a no-dither k=16 mapping call.
2. **Parallel exact Ward by rounds.** Merging all mutual nearest-neighbour pairs per round takes **40 to 90 rounds** (0.007 to 0.18% of the
   colours; the first round merges 8 to 22% of them). It does 1.4 to 1.9 times the chain's searches. **It is not byte-identical to the
   shipped clustering, and cannot be**: the shipped chain is not canonical either (the chain started from the other end differs from the shipped
   chain in the same way, same size of difference), because exact cost ties are everywhere on integer colours. Palettes at k=16 and 256 and
   the error curve are identical on all photos and mosaics; on the upscaled images k=16 differs by up to 1.5% in error and 3 to 12 colours,
   the same as the chain against itself. Output is byte-identical across 1, 2, 4 and 8 threads. Speed-up of the whole clustering, 8 threads:
   **1.4x (0.4 MP), 2.0 to 2.2x (mosaics), 3.5x (up12), 11.4x (up50; 9.3x in WebAssembly) over the shipped chain**; against rounds on one thread only 1.9 to 2.3x.
   Single-threaded, rounds is *slower* than the chain on 0.4 MP photos (0.7x), equal on mosaics, and *faster* on the images with many
   colours (1.6x up12, 4.4 to 4.9x up50, native and in WebAssembly alike).
3. **Threaded mapping** (`-pthread` WebAssembly, 12 and 50 MP, row stripes): no dither 2.6 to 2.9x at 8 threads, ordered dither 2.6 to 2.8x, both
   **byte-identical** to the shipped `quantize` at every thread count. Floyd-Steinberg cannot be byte-identical: serpentine order makes row r+1
   start at the end of row r, so a wavefront cannot start (explanation below); restarting the error at each stripe gives 3.3x but a different
   dither pattern.
4. **What threads cost users:** the `-pthread` `.wasm` is +12.3 KB (+14%), glue +13.5 KB (3.2 to 7.0 KB gzipped); shipping both builds
   adds 128 KB (56 KB gzipped) to the package. Browsers need cross-origin isolation; **without it the threaded module does not fail, it hangs** (never resolves,
   `DataCloneError` in the page), so a library must test `crossOriginIsolated` before loading it (that test worked in Chromium and Firefox). Node 24
   and Deno 2.9 work with no configuration; **Bun 1.4.5 hangs**; Cloudflare Workers (workerd) has `SharedArrayBuffer` but no `Worker`, so the pool cannot
   start. Start-up adds about 10 ms per pool worker (+50 ms for 4, +82 ms for 8 in Node). Mapping output is thread-count independent; clustering by rounds
   is too, but **differs from the shipped chain's bytes**, so it would have to replace the chain for everybody (golden hashes change), or output would depend
   on whether threads are available.
5. **Cheaper single-thread wins: none found.** `-O3` is already the shipped flag. `-O2` is 0 to 4% slower and 1.7% smaller, `-Os` 4 to 12% slower
   and 15.5% smaller. `-mrelaxed-simd` compiles (21 `relaxed_madd`), gives no speed-up beyond noise and can change cost bits per engine and CPU. Cold start
   in Node is about 9 ms of library work; caching the compiled module saves at most a few ms there.

## Recommendation

| idea | speed-up | what it costs users | verdict |
|---|---|---|---|
| Threaded mapping, no dither / ordered, stripes (byte-identical) | 2.6 to 2.9x at 8 threads on 4 cores; 1.6x at 2 | second `.wasm` (+56 KB gzipped in the package), COOP/COEP in browsers (hangs without; must detect), no Workers or Bun, +50 to 80 ms start-up in Node, pool memory | **Not worth designing now.** Mapping at 12 MP is 0.15 to 2.6 s single thread; the existing `createWorker()` already keeps it off the main thread. Revisit only if users ask for 50 MP ordered dithering. |
| Floyd-Steinberg / Atkinson threaded | not identical | different dither pattern per thread count | **No.** Serpentine order forbids a wavefront. |
| Threaded clustering by rounds | 1.4x (0.4 MP) to 2.2x (12 MP mosaic) to 9 to 11x (50 MP upscale) over the chain on 8 threads | all of the above, plus output differs from the chain's bytes | **No, not for threads.** The thread gain over rounds-on-one-thread is 1.9 to 2.3x at 8 threads. |
| **Rounds, single-threaded, as the merge algorithm** | 1.6x (up12), 4.9x (up50) faster; 0.7x slower on 0.4 MP photos, equal on mosaics | no new build, no new constraint; changes clustering bytes (golden hashes, a 4.0-style change) | **Worth a closer look**, with limits: it is a prototype without the grid's per-cluster candidate caches; a hybrid (chain below some colour count) would avoid the 0.4 MP loss. Needs a quality check on real large photos, not only upscales, before anyone designs it. |
| Tell users `precision: 6` for large images | up12 7.5 s to 0.40 s, up50 43.6 s to 1.0 s | docs only; palette differs slightly | Already the shipped answer; it dwarfs every idea above. |
| `-O2`, `-Os`, relaxed SIMD | none | size or determinism | **No.** |

## 1. Per-stage time, single thread, as shipped

WebAssembly through an instrumented copy of `src/` (`instrument.mjs` adds `STAMP`s at the stage boundaries of `ClusteringJob` and nothing else;
`build-wasm.sh` compiles it with the shipped flags; its clusterings hash equal to `dist/`'s, `results-dist-hash.txt`). Full tables, with
OKLab and `precision: 6`, are in `results-stages-wasm.md`; raw runs in `results/stages-wasm/`. RGB, full precision, ms and % of the clustering total:

| stage | k23 0.4 MP | up12 12 MP | mos12 12 MP | up50 50 MP | mos50 50 MP |
|---|---:|---:|---:|---:|---:|
| pixel scan (histogram) | 5.5 (3.8%) | 208.6 (2.8%) | 124.1 (7.6%) | 629.5 (1.4%) | 495.6 (17.3%) |
| colours to coordinates, grid add, first size review | 7.9 (5.5%) | 79.8 (1.1%) | 32.4 (2.0%) | 109.2 (0.3%) | 33.0 (1.1%) |
| **merge loop (chain + search)** | **119.2 (82.5%)** | **7025 (93.4%)** | **1410 (86.9%)** | **42552 (97.6%)** | **2275 (79.2%)** |
| write: colours to sRGB, sort, records | 10.4 (7.1%) | 158.4 (2.1%) | 50.0 (3.1%) | 249.2 (0.6%) | 56.2 (2.0%) |
| checksum (CRC-32) | 3.3 (2.3%) | 40.1 (0.5%) | 12.4 (0.8%) | 56.6 (0.1%) | 12.9 (0.4%) |
| **total** | **144** | **7518** | **1623** | **43596** | **2872** |
| chain searches | 205,314 | 2,638,594 | 832,264 | 3,663,239 | 839,632 |

Totals for the other two configurations (merge-loop share): OKLab k23 179 ms (77%), up12 11.1 s (94%), mos12 4.6 s (94%), up50 53.7 s (97.5%), mos50 6.3 s (89%);
`precision: 6` k23 52 ms (72%), up12 397 ms (43%, scan 49%), mos12 375 ms (60%), up50 1026 ms (31%, scan 66%), mos50 849 ms (37%, scan 59%).

**Mapping** (ms, RGB, the shipped `_quantize` on the same heap): `results-stages-wasm.md` has all seven images; these are from the quiet-machine threads run
(`results-map-threads.md`, the "shipped" column; palette cut from a `precision: 6` clustering):

| | k=16 none | k=16 FS | k=16 ordered | k=256 none | k=256 FS | k=256 ordered |
|---|---:|---:|---:|---:|---:|---:|
| up12 (12 MP) | 158 | 769 | 1385 | 207 | 1030 | 2645 |
| up50 (50 MP) | 513 | 3033 | 3029 | 629 | 4085 | 5665 |

(The mapping rows of `results-stages-wasm.md`, from the stage runs with a palette from the full-precision clustering, agree within 4%. Ordered k=256 is the slowest case everywhere.)

**JS boundary** (`js-boundary.mjs`, `results-js-boundary.md`, dist/, ms):

| image | copy in | unpremultiply | C++ map (k=16, none) | copy out | premultiply | public `quantizeWithPalette` |
|---|---:|---:|---:|---:|---:|---:|
| k23 | 0.1 | 0.6 | 6.2 | 0.5 | 0.1 | 6.2 |
| up12 | 2.8 | 14.6 | 151.1 | 18.8 | 4.9 | 177.2 |
| up50 | 10.4 | 52.4 | 499.8 | 67.4 | 20.6 | 796.0 |

At 50 MP the public call takes about 220 ms more than the parts add up to. I did not isolate it; the likely cause is the heap passing 256 MB, so `retireIfLarge`
discards the instance and the next call loads a fresh one (unverified). The premultiplied-input path costs no more than straight input in these runs.

**Instruction counts** (native clang -O2, callgrind with the counters zeroed at each stage, `run-callgrind.sh`, `results/callgrind-*.txt`; Ir = instructions):

| image | scan | build (convert, grid, review) | merge loop | write (colours, sort, records) | CRC |
|---|---:|---:|---:|---:|---:|
| k23 (0.4 MP) | 33.5 M (3.4%) | 51.9 M (5.2%) | 836.0 M (84.0%) | 57.9 M (5.8%) | 15.9 M (1.6%) |
| mos12 (11.8 MP) | 837 M (8.0%) | 196 M (1.9%) | 9,073 M (87.1%) | 251 M (2.4%) | 64 M (0.6%) |
| mos50 (47.6 MP) | 3,280 M (15.7%) | 196 M (0.9%) | 17,066 M (81.8%) | 251 M (1.2%) | 64 M (0.3%) |

Mapping Ir, k23: 39 M / 225 M / 536 M (k=16 none / FS / ordered), 59 M / 319 M / 1,049 M (k=256); mos12: 1.15 G / 7.0 G / 7.4 G and 1.43 G / 7.66 G / 16.6 G.
Not run: callgrind on up12 and up50 (it would take an hour or more; mos12 and mos50 stand in for 12 and 50 MP), and mapping Ir at 50 MP (it scales with pixels).

## 2. Parallel exact Ward by rounds

`rounds.mjs` copies the instrumented source and adds `merge_rounds` (`cpp/merge_rounds.inc`) beside the chain, switched by `ROUNDS_THREADS`. Each round: find the
cheapest partner (`WardGrid::search`, with the old partner's replacement as the `hint` bound) of every cluster that needs one; merge all mutual pairs the way the chain
merges one; the next round's work is the new clusters plus the clusters whose partner just died (Ward is reducible, so every other cluster's partner is unchanged). The
searches of a round only read the grid, so they run on a small `std::thread` pool; merging, which edits the grid, is serial. The grid's `private:` is `public:` in the copy so the
search can be called directly. `results-rounds.md` has every table; raw output in `results/rounds*/`.

**Byte-identical? No.** On every image the rounds clustering has different bytes. Findings:

- Cause: not a bug in the rounds code. Exact cost ties are everywhere (56% of the records of a noise image share an exact cost with another; every Kodak clustering starts with
  thousands of cost-0.5 merges), and in a tie the hierarchy depends on the order merges are made. Control: **the shipped chain started from the newest cluster instead of the oldest
  (`CHAIN_REVERSE=1`) differs from the shipped chain in the same way** (k23: 6,219 merges not in the other, rounds: 9,119; up12: chain vs reversed chain 85,470, chain vs rounds 109,035).
  The chain's output is deterministic for the code as written, but it is not a canonical function of the image, so no parallel algorithm can reproduce it except by
  doing what the chain does.
- Effect: palettes at k=16 and k=256 are identical, and the error curve equal to six digits, on k23, k03, k20, mos12 and mos50, in RGB, OKLab and `precision: 6`. On up12
  the k=16 palette shares 4 of 16 colours (error ratio 0.985) and on up50 13 of 16 (1.0012); the chain against its own reversed start gives 9 of 16 (0.982) on up12.
  The differences are of the same size and sign-random: the upscaled images are tie-saturated. (On k23, palettes agree for every k up to 32,768 of 72,079 colours.)
- Making it identical would mean changing the tie-break so that the hierarchy is canonical (a rule that does not depend on creation order), which also changes the chain's output.

Work profile (native counts, RGB; `rounds / colours` is the round count as a share of the distinct colours):

| image | colours | chain searches | rounds | rounds / colours | merges per round, first / median / last | rounds' searches | vs chain |
|---|---:|---:|---:|---:|---|---:|---:|
| k23 | 72,079 | 205,314 | 48 | 0.067% | 15,620 / 115 / 1 | 284,849 | 1.39x |
| k03 | 34,871 | 99,217 | 44 | 0.126% | 7,464 / 87 / 1 | 139,716 | 1.41x |
| k20 | 24,470 | 70,678 | 45 | 0.184% | 4,827 / 66 / 1 | 101,457 | 1.44x |
| up12 | 907,499 | 2,638,594 | 90 | 0.010% | 86,202 / 648 / 1 | 4,678,496 | 1.77x |
| mos12 | 288,588 | 832,264 | 63 | 0.022% | 51,794 / 219 / 1 | 1,293,102 | 1.55x |
| up50 | 1,261,092 | 3,663,239 | 89 | 0.007% | 96,613 / 958 / 1 | 7,119,974 | 1.94x |
| mos50 | 288,588 | 839,632 | 61 | 0.021% | 53,441 / 287 / 1 | 1,275,586 | 1.52x |

The rounds are few and the first one does 8 to 22% of all merges; the long tail of small rounds (median 66 to 958 merges) limits the speed-up more than the round count does.

Speed (whole clustering, ms; native in the container, `results-rounds.md`; the chain is the shipped loop; "model" is the estimate from the work profile for rounds on 2 / 4 / 8 threads
against rounds on one):

| image | chain | rounds 1 | 2 | 4 | 8 | speed-up vs chain at 8 | vs rounds-1 at 2 / 4 / 8 | model vs rounds-1 at 2 / 4 / 8 |
|---|---:|---:|---:|---:|---:|---:|---|---|
| k23 | 132 | 182 | 132 | 104 | 94 | 1.40x | 1.38 / 1.74 / 1.94 | 1.55 / 2.14 / 2.64 |
| up12 | 7088 | 4483 | 3145 | 2313 | 2010 | 3.53x | 1.43 / 1.94 / 2.23 | 1.62 / 2.34 / 3.00 |
| mos12 | 1507 | 1556 | 1108 | 812 | 714 | 2.11x | 1.40 / 1.92 / 2.18 | 1.65 / 2.43 / 3.19 |
| up50 | 44455 | 8990 | 6241 | 4444 | 3891 | 11.42x | 1.44 / 2.02 / 2.31 | 1.65 / 2.46 / 3.24 |
| mos50 | 2630 | 2810 | 1974 | 1435 | 1305 | 2.02x | 1.42 / 1.96 / 2.15 | 1.62 / 2.35 / 3.03 |

In WebAssembly with `-pthread` (Node 24, `results-rounds.md`, last table): k23 143 / 187 / 142 / 113 / 103 ms (chain / rounds 1, 2, 4, 8), mos12 1708 / 1677 / 1164 / 848 / 770,
up12 7529 / 4691 / 3277 / 2450 / 2177, up50 (one run) 44332 / 9980 / 6956 / 5155 / 4766. The same hashes at every thread count in every run. The model is optimistic by about 1.3x
(SMT cores share execution units; the searches are memory-bound). Most of the large "speed-up" on up12 and up50 is the single-threaded algorithm change, not the threads.

## 3. Threaded mapping

`cpp/mapthreads.cpp`, built by `build-wasm-threads.sh` (`-pthread -sPTHREAD_POOL_SIZE=8`, shipped flags otherwise): each thread runs a `MappingTask` (the shipped class, unchanged;
it has no mutable statics) on a stripe of whole rows. Ordered dithering depends only on the colour and `(x & 7, y & 7)`, so stripes start on multiples of 8 rows and the output is the
shipped output. The palette comes from a `precision: 6` clustering (only its colours matter here). Results, `results-map-threads.md`:

| image | k | dither | shipped (ms) | 1 thread | 2 | 4 | 8 | speed-up 2 / 4 / 8 | bytes identical |
|---|---:|---|---:|---:|---:|---:|---:|---|---|
| up12 | 16 | none | 158 | 161 | 97 | 62 | 54 | 1.63 / 2.56 / 2.93 | yes |
| up12 | 16 | ordered | 1385 | 1355 | 882 | 646 | 516 | 1.57 / 2.14 / 2.69 | yes |
| up12 | 256 | none | 207 | 210 | 133 | 84 | 71 | 1.56 / 2.46 / 2.92 | yes |
| up12 | 256 | ordered | 2645 | 2778 | 1713 | 1284 | 1024 | 1.54 / 2.06 / 2.58 | yes |
| up50 | 16 | none | 513 | 520 | 311 | 204 | 184 | 1.65 / 2.51 / 2.78 | yes |
| up50 | 16 | ordered | 3029 | 3060 | 1941 | 1457 | 1115 | 1.56 / 2.08 / 2.72 | yes |
| up50 | 256 | none | 629 | 637 | 388 | 249 | 221 | 1.62 / 2.53 / 2.85 | yes |
| up50 | 256 | ordered | 5665 | 5734 | 3559 | 2864 | 2055 | 1.59 / 1.98 / 2.76 | yes |
| up12 | 256 | FS, error restarted per stripe | 1030 | 1017 | 633 | 387 | 324 | 1.63 / 2.66 / 3.17 | no |
| up50 | 256 | FS, error restarted per stripe | 4085 | 4076 | 2497 | 1527 | 1252 | 1.64 / 2.68 / 3.26 | no |

(Rows for k=16 FS are in the results file.) The thread start (spawn) costs 0.05 to 0.25 ms per call once the pool exists. Output was the same at every thread count.
The split-and-copy here writes each stripe's output to a buffer and copies it into the result (included in the timings); a library version would write in place.

**Floyd-Steinberg wavefront: not built, and not feasible byte-identically.** The shipped loop is serpentine: even rows go left to right, odd rows right to left. Pixel (x, r+1)
needs the errors of (x-1, r), (x, r) and (x+1, r). Row r finishes at the right edge, and row r+1 starts there, at x = W-1, needing (W-2, r) and (W-1, r), the last pixels of row r.
So row r+1 cannot start before row r is done: the dependency chain is the whole image. A wavefront ("row r may run once row r-1 is two pixels ahead") needs every row to go
the same way; that changes the output (and loses what serpentine buys), needs a synchronisation every few pixels, and is not byte-identical to the shipped dither either. The same holds for
Atkinson (two rows of reach). What threads can do for error diffusion is stripes with the error restarted (the last rows above): 3.2 to 3.3x at 8 threads, different pattern, and a
visible seam is possible (not looked at). With `quantizeToIndices`/streaming users could also get this by running each stripe as a separate call today.

## 4. What it costs users

- **`-pthread` build size** (`build-lib.sh`, same flags as `build:wasm`, `results-sizes.txt`; the unthreaded rebuild is 87,320 bytes, byte for byte `dist/clustering.wasm`):

| build | `.wasm` | gzip | glue | gzip |
|---|---:|---:|---:|---:|
| shipped | 87,320 | 41,178 | 10,092 | 3,213 |
| `-pthread` (no threaded code) | 99,627 (+12,307, +14%) | 46,723 | 23,622 | 6,953 |
| `-pthread` + threaded mapping (`std::thread`) | 103,422 (+16,102, +18%) | 48,649 | 24,563 | 7,167 |

  Shipping both builds: +128 KB unpacked (+56 KB gzipped) in the package: the threaded `.wasm` and glue are 55.8 KB gzipped against 44.4 KB for the shipped pair. `em++` warns `-pthread + ALLOW_MEMORY_GROWTH may run non-wasm code slowly`.
- **Browsers** (`browser-sab.mjs`, `results-browser-sab.txt`, Playwright Chromium and Firefox, page served with and without COOP same-origin + COEP require-corp):
  without isolation `crossOriginIsolated` is false and `SharedArrayBuffer` undefined. `new WebAssembly.Memory({shared: true})` still constructs, so a feature test on it would
  *pass*. The threaded module then **never resolves** (a `DataCloneError` is raised in the page when the glue posts the memory to its first worker; the promise stays pending: 10 s timeout in the test)
  in both browsers. So a fallback has to be chosen **before** loading the threaded glue, with `crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'`; that test chose correctly in both
  pages in both browsers (the single-threaded module worked everywhere). It does not make a site isolated: COOP/COEP also breaks cross-origin images, iframes and embeds without
  CORP/CORS, which is the site owner's decision, not the library's. WebKit: not measured (Playwright's WebKit failed to launch here).
  Start-up when isolated: Chromium 78 ms (single) against 97 ms (pool of 4), Firefox 171 against 249 ms.
- **Node and other runtimes** (`rt-test.mjs`, `results-runtimes.txt`, `results-workerd.txt`): Node 24 works with no flags; Deno 2.9.6 works; **Bun 1.4.5 hangs** (10 s timeout, load only, not investigated);
  **workerd 2026-11-25 has `SharedArrayBuffer` and shared memory but no `Worker`**, so Emscripten's pool cannot start (I did not load the glue there). Cloudflare Workers is a runtime the library's `wasm` init option exists for, so it would always take the fallback.
- **Start-up** (`startup.mjs`, `results-startup.md`, Node 24, fresh process per sample, median of 15): spawn-to-exit 93 ms with the shipped module, 152 ms with a pool of 4, 188 ms with 8: the glue
  starts every pool worker at load, about 10 ms each. The in-library cost of the shipped module is about 9 ms (import 1, load 6, first call 2). Starting the pool lazily (on the first threaded call) would need
  `PROXY_TO_PTHREAD` or an async thread creation path, which I did not build.
- **Packaging:** two `.wasm` and two glue files; the threaded glue starts its workers with `new Worker(new URL("lib-threaded.mjs", import.meta.url), {type:"module"})`, a self-reference to its own file
  that bundlers (Vite, webpack, Parcel) handle by file name, so a renamed or inlined glue breaks it. The existing bundler tests (`test/browser`) only cover the single-threaded build, and I did
  not run a bundler on the threaded glue (**not measured**). The `wasm` init option (URL, bytes, module) would need a threaded twin, and a compiled `WebAssembly.Module` for a shared-memory build
  must be instantiated with a shared memory, so the cached-module recipes change too (reasoned, not tested).
- **Determinism:** threaded mapping (no dither, ordered) is byte-identical to the shipped call at 1, 2, 4 and 8 threads. Rounds clustering is byte-identical at every thread count but **not to the shipped
  chain** (question 2), so adopting it means regenerating `test/golden.json` and shifting every stored clustering the library makes, for single-threaded users too; the alternative (chain without threads,
  rounds with threads) would make output depend on the environment, which I would not accept for a library whose clusterings are stored and compared.
- **Memory:** a threaded `quantize` call needs the input, and either per-stripe outputs or in-place writes; the 50 MP runs (200 MB in, 200 MB out) fit inside the 2 GB limit with the extra copies of this
  harness. Each thread also has its own memo and recipe tables (up to 8 MB each for ordered dithering).

## 5. Cheaper single-threaded wins

`results-q5-flags.md` (`q5-flags.mjs`: the four builds alternate run by run, median of 9 / 9 / 3; all outputs byte-identical to `-O3` on k23, k03, mos12):

| | `-O3` (shipped) | `-O2` | `-Os` | `-mrelaxed-simd` |
|---|---:|---:|---:|---:|
| `.wasm` bytes | 87,320 | 85,814 (-1.7%) | 73,804 (-15.5%) | 87,257 (-0.1%) |
| clustering k23 / k03 / mos12 (ms) | 141 / 61 / 1629 | +4% / +2% / +3% | +12% / +10% / +6% | -2% / -3% / -3% |
| map k=256 ordered k23 / k03 / mos12 | 143 / 80 / 2173 | -1% / +1% / +2% | +8% / +10% / +13% | 0% / 0% / +1% |

- **The shipped flag already is `-O3`.** `-O2` and `-Os` are not faster; `-Os` buys 13.5 KB at a 4 to 13% cost in speed.
- **Relaxed SIMD:** compiles. Clang turns `a*b+c` into 9 `f32x4.relaxed_madd` and 12 `f64x2.relaxed_madd` (the search's float filter and its exact double cost). It does not speed anything up beyond noise
  (the -2 to -3% is within the run-to-run spread), and the outputs were byte-identical on this CPU (which has FMA). But `relaxed_madd` is allowed to fuse or not depending on engine and CPU, and the exact cost
  comparison relies on matching the scalar `get_weight` bit for bit, so on other hardware it could change tie-breaks and therefore clusterings. I could not test another engine or CPU. **Not worth it.**
- **Cold start**: see section 4. A compiled-module cache saves little in Node: compiling the `.wasm` from bytes takes about 1 ms in-process against 0.5 ms to instantiate a compiled module (an in-process measurement,
  where V8 can reuse its own caches, so it understates a cold process; there is no cross-process module cache in Node). The browser case (IndexedDB-stored modules) was not measured.

## Not measured, caveats

- **Run counts:** up50 and mos50: 3 runs (up50 rounds in WebAssembly 1 run; native chain at 50 MP 1 run; the rounds-on-threads native runs 2). The brief asked for 5.
- **Machine:** 4 physical cores. The thread tables are for this CPU; on a 8-physical-core machine the 8-thread numbers should be better, and I cannot say by how much.
- **Contamination:** the first stage timings, rounds work-profile timings (`results/rounds/` TOTAL lines) and the first mapping numbers were taken with a game and other jobs running; I did not use them for speed (counts
  in `results/rounds/` are unaffected). Every speed table above comes from a quiet-machine rerun. One native up12 chain run on a loaded machine took 29 s against 7.1 s quiet.
- **Rounds prototype:** no per-cluster candidate caches (the chain has them), pool grain 64 and parallel minimum 256 not tuned, merging and `reindex` serial. A tuned version could do better; I did not tune it.
- **Quality of rounds on real large photos:** only upscales (tie-saturated) and mosaics; I have no real 12 or 50 MP photo. The `golden.json` hashes were not used: I compared with the shipped build's own hashes
  (`results-dist-hash.txt`) and with the native build, which agree.
- **WebKit** (launch failed), **bundlers on the pthread glue**, **Deno/Bun speed** (load test only), **workerd loading the pthread glue**, **browser thread speed** (start-up only), and the `retireIfLarge` suspicion above are not measured.
- Callgrind: k23, mos12, mos50 only; mapping Ir not at 50 MP.

## Re-running

Needs `em++` (`source ~/.local/share/emsdk/emsdk_env.sh`), podman with an image that has clang and valgrind (`localhost/ac-native`, or `ubuntu:24.04` with `apt-get install clang valgrind`; adjust `native-run.sh` and `build-native.sh`), `fixtures/images/kodim*.png`, and an
otherwise idle machine. Run from this directory; large inputs and builds go to `data/` and `build/` (gitignored).

```
node make-images.mjs                                   # data/*.rgba and data/images.json
./build-wasm.sh && ./run-stages.sh                     # Q1: stage times, results/stages-wasm/; node table-stages.mjs > results-stages-wasm.md
node js-boundary.mjs k23 up12 up50                     # Q1: JS boundary
./build-native.sh && ./run-callgrind.sh k23 0 8        # Q1: instruction counts (MAP=1 adds mapping; also mos12, mos50)
./run-rounds-profile.sh                                # Q2: work profile and equality (REVERSE=1 adds the chain-order control)
./run-rounds-threads.sh                                # Q2: native threads;  node table-rounds.mjs > results-rounds.md
./build-wasm-threads.sh cpp/driver.cpp driver-rounds-mt -DROUNDS && ./run-rounds-wasm.sh   # Q2 in WebAssembly
./build-wasm-threads.sh cpp/mapthreads.cpp mapthreads  # Q3: node build/mapthreads.js data/up12.rgba 4320 0 5 1,2,4,8; node table-map-threads.mjs
./build-lib.sh base ../../../src/clustering.cpp; ./build-lib.sh pthread ../../../src/clustering.cpp -pthread -sPTHREAD_POOL_SIZE=4
EXPORT_EXTRA=",'_quantize_with_palette_threaded'" ./build-lib.sh threaded cpp/lib_threaded.cpp -pthread -sPTHREAD_POOL_SIZE=4   # also threaded8 with POOL_SIZE=8, base-o2 (-O2), base-os (-Os), base-relaxed (-mrelaxed-simd)
node browser-sab.mjs; node startup.mjs 15; node q5-flags.mjs base base-o2 base-os base-relaxed
(cd runtimes && npm install --cache ./.npm-cache workerd deno bun) && for rt in node "runtimes/node_modules/.bin/deno run -A" runtimes/node_modules/.bin/bun; do $rt rt-test.mjs; done   # delete runtimes/node_modules and .npm-cache afterwards
```

`run-quiet-batch.sh` is the order the quiet-machine timings were taken in. `compare-clusterings.mjs`, `error-curves.mjs`, `compare-palettes.mjs` and `dist-hash.mjs` are the equality checks.
