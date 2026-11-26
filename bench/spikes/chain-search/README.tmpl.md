# Chain spike: real large photos, why the chain is slow, and speed-ups that keep every byte

A measurement spike on branch `spike/perf-measure`, second round. Nothing in `src/`, `dist/`, the tests or the docs changed: every
change is a transformation of a copy of `src/` (`make-variant.py`, built by `build.sh`). Machine: i7-1185G7 (4 cores, 8 threads),
Node 24.18, Emscripten 6.0.12 with the shipped `build:wasm` flags, clang 18.1.3 in the `localhost/ac-native` container for native
builds and callgrind. The maintainer's rules held throughout: one WebAssembly build, no setup, no API change, and **byte-identical
clusterings** (a change that altered one byte would have been discarded; none did).

## Summary

- **Real large photos behave like the mosaics, not like the upscales.** Ten 16 to 24 MP Wikimedia Commons photos have 149,000 to
  351,000 distinct colours (the greyscale portrait has 256). Clustering takes **0.9 to 2.8 s** at full precision in WebAssembly
  (landscape 1.1, foliage 1.8, night street 2.8), the merge loop is **75 to 90%** of the instructions, and `precision: 6` takes
  0.23 to 0.50 s. The 12 MP upscale (0.9 M colours, 7.6 s) is not representative of photos.
- **The main cause of slow chains is the candidate cache of heavy clusters.** The cache's searches (limit 16) are 0.6 to 2.3% of all
  searches but 19 to 80% of all clusters examined (up12 74%, night 80%, komar 73%, mos12 54%, fern 28%). Each time a cache runs out
  (6 to 7% of queries to a cached cluster) the cluster is searched again from scratch for 16 candidates; a limit-16 search examines
  19,000 clusters on average on mos12 and 54,000 on up12. A better starting bound is not the problem: a search given the true answer
  as its hint examines only 1.5% fewer clusters. The rest of the time is the per-search cost: on the photos 71 to 117 cells and 104 to 322 chunks per search, of which
  54 to 82% of cells are rejected by their bound and only 1.3 to 3.3% of the chunks need an exact cost.
- **Best identical change: the combination `final`, 114 of 114 clusterings byte-identical to the shipped `dist/` (38 images x RGB,
  precision 6, OKLab) and the repo's `golden.test.js` passing against it.** Instruction counts, full precision RGB:
  **-28% fern, -34% mos12, -47% night street, -50% up12, -10% k23** (k23 is a Kodak photo, 0.4 MP); WebAssembly wall clock (median of 5): -25% fern, -35% mos12,
  -50% night, -58% up12, -13% sky, -12% k23. OKLab gains more (-55 to -64% instructions and -57 to -58% wall clock on mos12, fern, night and up12; 5.5 s to 2.4 s on fern). The `.wasm` grows by
  1,215 bytes (87,320 to 88,535; +449 bytes gzipped) and a cache entry grows from about 0.2 KB to 0.8 KB.

## Real photos (Part A)

Photos downloaded with `fetch.sh` into `data/` (not committed); `sources.txt` lists each URL and licence (public domain, CC0, FAL,
CC BY, CC BY-SA, all as Commons shows them). Decoded with ImageMagick (`make-photos.mjs`: auto-orient, sRGB, 8 bits, opaque alpha).
`pip` is a greyscale JPEG: it has only 256 colours, so its clustering is trivial (119 ms, all of it the pixel scan), kept in the
table as an extreme. Time is the instrumented build of the last spike (`../perf-measure/build/driver.js`, the shipped flags),
median of 5 runs in one process (run 0 included), machine idle; load averages are in `results-stages-wasm.md`. Merge-loop Ir is
callgrind on the native build of the same source (`run-callgrind-stages.sh`).

@@results/table-photos.md@@

Not measured: callgrind on up12 (the base total is in the table below), the stage split of the 50 MP images (not repeated here).

Full tables with the other stages and the load seen: `results-stages-wasm.md` (medians; spread of every run set). Stage split in
instructions: `results/table-cgs.md`.

@@results/table-cgs.md@@

### The last spike's headline numbers again (idle machine, load below 1.2 except where stated)

| | last spike | now | note |
|---|---:|---:|---|
| k23 clustering, ms | 144 | 144 | `results-stages-wasm.md` |
| mos12, ms | 1623 | 1666 | +2.6% |
| up12, ms | 7518 | 7635 | +1.6% |
| chain, one thread, k23 / mos12 / up12, ms | | 143 / 1644 / 7697 | `results/rounds-wasm/` (median of 5, the first run is slower) |
| rounds, one thread, k23 / mos12 / up12, ms | | 188 / 1661 / 4694 | same runs |
| rounds against chain | 0.7x / 1.0x / 1.6x | 0.76x / 0.99x / 1.64x | unchanged |

None of them moved by more than 3%: the last spike's numbers hold.

## Why the chain is slow when there are many colours (Part B)

`variants/count` is the shipped source with counters (`-DCOUNTERS`, never in a shipped build); its clustering hashes equal the shipped
ones. `results/counters/<image>-rgb8.txt` has every raw counter; `results/table-counters.md` is the summary. A "limit 1" search is the
ordinary search for the cheapest partner; a "limit 16" search fills (or refills) a cluster's candidate cache. "Fresh" queries are of a
cluster just pushed on the chain, "exposed" of one uncovered by a merge above it, "start" of the first cluster of a new chain.

@@results/table-counters.md@@

Per merge the chain asks `nearest()` 2.7 to 3.0 times and runs 2.6 to 2.7 searches; 27 to 33% of the queries are for a cluster that has
been queried before; chains are 8 to 29 clusters long on average (one outlier, sp: 369).

**Top causes, with numbers** (mos12 and up12 are the first two columns of the numbers; the others agree in direction, see the table):

1. **Cache searches dominate on many-colour images.** Limit-16 searches: 11,682 of 758,586 on mos12 (1.5%) examine 54% of all clusters
   examined (226 M of 416 M); on up12 29,002 of 2.44 M (1.2%) examine 74% (1.58 G of 2.13 G). Three things produce them: 6,265
   (mos12) and 12,735 (up12) cache builds, 5,417 and 16,267 fallbacks (the cache ran dry or its best candidate was not below the
   threshold: 6 to 7% of queries to cached clusters), and a build costs two searches, the limit-1 search that found the cluster
   expensive again and then the limit-16 one. One cluster is queried up to 70,093 times (up12), 41,959 (night), 42,452 (komar). A
   16-entry cache is too small for the clusters that live longest.
2. **The cell and chunk tests of every search.** On the photos 71 to 117 non-empty cells are visited per search and 54 to 82% of them are
   rejected by the bound (a visit costs about 30 instructions: index, bounds load, six vector operations, a horizontal sum); the
   rest hand over 104 to 322 chunks per search, of which only 1.3 to 3.3% pass the float filter and need an exact cost (k23: 24 cells, 49 chunks, 6.3%). On fern (callgrind lines)
   the cell tests are 2.7 G of 11.9 G instructions, the chunk filter 2.3 G, the ring and column loops 1.1 G.
3. **The ring stop assumes a one-pixel partner** (`get_weight(n, 1)`), but after the first merges few clusters of one pixel are left.
   The searches keep going out over rings that cannot hold a partner of the smallest live count. Using the smallest live count
   saves 24% of the cell visits on fern.
4. **Bounds that only loosen.** Removals never tighten a cell's colour box or its smallest count, until the grid is rebuilt when the
   live count has halved. Rebuilding at 7/8 of the count instead cuts instructions by 3 to 12% on the photos (and costs 2% on k23).
5. **Not causes** (measured): *the hint*: a second search given the true nearest as its hint examines at most 1.5% fewer clusters in the limit-1 searches (k23 1.5%, fern 1.0%, mos12 1.2%, night 1.2%), and the
   same cells (fern 321.5 M to 318.4 M, mos12 190.7 M to 188.5 M, night 222.1 M to 219.4 M; `results/oracle/oracle.txt`), so a better starting bound
   (the merged cluster, a remembered partner) cannot give more than that. *Grid rebuilds*: 11 to 14 rebuilds, relinking 0.14 to 1.7 M
   clusters, about 1% of the instructions. *Chain length* and *re-searches of the base cluster*: 30% of queries are repeats, but a
   repeated query of a cheap cluster costs about the same as a fresh one (examined per search: fresh 314, exposed 518 on fern).
6. **Why rounds was 4.9x faster on up50 (an inference, not a new measurement):** the rounds prototype of the last spike has no candidate
   caches (its README says so), so it never runs a limit-16 search, which is 74% of the chain's work on up12; it does 1.4 to 1.9x as many
   searches, each a limit-1 search with a tight hint. The chain loses that time to the caches; the changes below take the chain on
   up12 from 7.6 s to 3.2 s in WebAssembly, below the one-thread rounds time of the last spike (4.7 s). I did not run up50 here.

## Changes tried (Part C)

Every change is a transformation in `make-variant.py`, listed with its variant name in `variants.txt`. All of them are conservative:
they prune or reorder work, never what is offered. Instruction counts are callgrind totals of the whole clustering (native clang -O2),
full precision RGB, billions, with the change against `base` (the shipped source). WebAssembly times are medians of 5 runs
(3 for up12) in the shipped flags with the load average recorded in `results/wasm/`; `base2` is `base` run again at the end of each
image's block as a drift check (within 4%).

What each change is:

| name | change | idea |
|---|---|---|
| `fastoffer` | `offer()` compares costs inline and calls `is_before` only for equal costs | the insertion of a candidate into a long sorted list called a function per step |
| `minw` | the ring stop and the early bound use the smallest live cluster count (a histogram of counts below 4096, a pointer that only moves up) instead of one pixel | a partner has at least that many pixels |
| `colprune` | skip an x slab or an (x, y) column whose cell interval is already too far for a partner of the smallest weight | corner and edge columns of a ring |
| `review` | review the grid (and rebuild its bounds) when the live count falls to 7/8 of the last review's, not 1/2 | bounds only loosen between rebuilds |
| `adaptive` | a cache that fell back to a full search is rebuilt twice as large, up to 64 candidates (needs `fastoffer`) | only the long-lived clusters pay for a big cache |
| `skip1` | a cluster already marked expensive goes straight to the cache-building search instead of a limit-1 search first | a build cost two searches |

Instruction counts (G) and change, full precision RGB; `s-` is the change alone, `c1` to `c4` are cumulative, `l-` is `final` without
one change, `final` is all six:

@@results/table-ir.md@@

Wall clock in WebAssembly (ms, median, change against `base`). The k23 runs and the start of the mos12 runs began with a 1-minute load average of 4 to 5
that was left over from my own just-finished instruction-count jobs (the average lags; nothing else was running); the rest ran at 1.0 to 1.7.
`base` and `base2` agree within 4% everywhere, and the load is in `results/wasm/`:

@@results/table-wasm.md@@

Other settings and what was tried and dropped (all byte-identical, instructions from `results/sweep-*.txt`):

- **Cache size, fixed** 16 / 32 / 64 / 128 / 256 (`results/sweep-cache-size.txt`, with counters on): up12 7.6 / 5.4 / 4.7 / 5.1 / 6.5 s native, fern 1.70 / 1.75 /
  1.98 / 2.65 / 4.81 s. Bigger caches halve the examined clusters on up12 but make `offer()` quadratic (callgrind: `is_before` 3.5 G of 24 G
  instructions at 128 on fern), which is why `fastoffer` and a per-cluster size (`adaptive`) exist: with them fern no longer slows down.
- **`cache_after`** 256 / 1024 / 4096: no gain (up12: 7.97 / 7.43 / 7.27 s with counters on).
- **Grid occupancy target** `target_occupancy` 10 to 48 (`results/sweep-occupancy-ir.txt` for the shipped source, `-adapt-ir.txt` with the changes): 24 is the best on mos12 and
  fern with the changes (and within 1% of 32's on the shipped source: 32 is 5% lower on mos12 and fern, 3% higher on k23); k23 prefers 10 to 14 (-4%). Left at 24.
- **Review at** 1/2, 5/8, 3/4, 7/8, 15/16, 31/32 (`results/sweep-review-ir.txt`, on top of `minw` and `colprune`, against 1/2): 7/8 to 31/32 plateau (mos12 -11%, fern -7 to -9%, k23 +3.5%).
- **A better starting bound** (merged cluster, remembered partner): not built, because the oracle measurement above shows at most 1.4%.
- **Not tried:** a binary heap for `offer()`; per-count sub-buckets in each cell (would make the cell test tighter for heavy clusters;
  a larger change); a coarser second grid level for the cell test.

Other configurations (instruction counts, base then `final`; the clusterings are identical):

Precision 6, RGB:

@@results/table-ir-rgb6.md@@

OKLab, full precision:

@@results/table-ir-oklab.md@@

up12, full precision RGB (callgrind, native):

@@results/table-ir-up12.md@@

WebAssembly, other configurations (`results/wasm-config/`, median of 5, `base` run twice to show drift):

@@results/table-wasm-config.md@@

`.wasm` size (the shipped build:wasm flags, library exports, unpatched glue; `base` is byte-for-byte the size of `dist/clustering.wasm`):

| variant | bytes | change |
|---|---:|---:|
| base | 87,320 | |
| s-fastoffer | 87,413 | +93 |
| s-minw | 87,742 | +422 |
| s-colprune | 87,493 | +173 |
| s-review | 87,323 | +3 |
| s-adaptive | 87,506 | +186 |
| s-skip1 | 87,955 | +635 |
| **final** | **88,535** | **+1,215 (+1.4%); gzip 41,180 to 41,629 (+449)** |

### Byte-identity checks

- `check-identical.mjs <variant>`: every image (24 Kodak, 3 mosaic/upscale pairs: mos12, mos50, up12, up50, and the 10 photos) at full
  precision, precision 6 and OKLab, the clustering hash against the shipped `dist/` (WebAssembly, public `buildClustering`; `ref-hashes.mjs`
  wrote `results/ref-hashes.json`). `base`: 114 of 114 identical (so the native build equals the shipped one); `final`: **114 of 114**
  (`results/identical.txt`). Every row of the instruction-count table also compares the hash with `base`'s.
- `make-golden-test.sh final`: the repo's `test/golden.test.js`, unchanged but for its import paths, against a dist-like folder with the
  variant's `clustering.js` and `.wasm` (`make-dist.sh`): 17 of 17 tests pass, so every clustering, palette, mapped and dithered output
  hash in `test/golden.json` is unchanged.
- Not run: the rest of `npm test` (the other test files read `dist/`) against the variant.

## Recommendation

Put all six changes into the library as one change, in two steps if the maintainer wants smaller reviews:

1. **Cache work (`fastoffer`, `adaptive`, `skip1`; `fastoffer` gains nothing alone, it makes the bigger caches cheap)**: the largest gain on night,
   komar, sp and the upscales (-41% instructions on night, -45% wall clock on night and up12), -18% instructions on mos12, -7% on fern. About 100
   lines in `clustering.hpp`; +0.9 KB of `.wasm`; per-cache memory 0.8 KB instead of 0.2 KB (a cache per expensive cluster: at most about
   13,000 built on up12, so up to about 10 MB; caches are freed with their cluster and reused). komar and sp were measured only in the counters, not in the timing runs.
2. **Search work (`minw`, `colprune`, `review`)**: on fern alone -12% (`minw`), -2% (`colprune`), -9% (`review`); together with the cache
   work k23 gains 10%. They help photos with few heavy clusters, where the cache changes do little.

Expected gain on real photos from the whole set, full precision: **-25% (foliage) to -50% (night street) in WebAssembly time**, -28% to -47%
in instructions; at `precision: 6` -18% to -30% in instructions on the photos and the mosaic (-9% on k23; clustering there is partly the pixel scan);
in OKLab -55 to -64% instructions and -57 to -58% wall clock (k23 -21%); at `precision: 6` -17 to -23% wall clock. For the 50 MP upscale the gain should be larger (the cache share grows with colour count), which I did not run.
No user-visible change: same API, same bytes, same one `.wasm`; one more member for the per-cache size (`limit`) and a small histogram.

What I would not do: change `target_occupancy`, `cache_after` or the fixed cache size alone; or chase a better hint (1.4% at most).
A bigger step would be a different cell test (per-count sub-buckets or a second grid level); I did not try it.

Review points for the maintainer: `review` raises k23's instruction count by 2 to 4% (the small images rebuild more often); `skip1` builds
and drops a cache when the second search turns out cheap; the `minw` histogram stops at counts below 4096 (a lower bound beyond it).

## Re-run

```
./fetch.sh                                   # photos from photos.tsv into data/ (slow: 10 s pause per download)
node make-photos.mjs && node make-kodak.mjs  # RGBA files and data/images.json (needs ../perf-measure/data for the mosaics and upscales)
source ~/.local/share/emsdk/emsdk_env.sh
./build.sh base native wasm lib; ./build.sh final native wasm lib        # variants.txt lists every variant
node ref-hashes.mjs && node check-identical.mjs final                    # byte identity against dist/ (needs a built dist/)
./make-dist.sh final && ./make-golden-test.sh final                      # the repo's golden test against the variant
./run-stages-wasm.sh; node table-stages.mjs > results-stages-wasm.md     # Part A, WebAssembly (idle machine)
for i in mos12 fern; do ./run-callgrind-stages.sh $i 0 8; done           # Part A, instructions
./build.sh count count; ./sum-counters.sh build/count/driver-count fern  # Part B counters (raw: results/counters/)
./run-ir-matrix.sh "base final" "k23 mos12 fern night"; node table-ir.mjs  # Part C instructions
./run-wasm-timing.sh "base final" "k23 mos12 fern"; node table-wasm.mjs    # Part C wall clock (idle machine)
```
