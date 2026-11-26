# Perf spike 3: per-function profile of 4.1.0, and speed-ups that keep every byte

A measurement spike on branch `spike/perf-3` (off 4.1.0). Nothing in `src/`, `dist/`, the tests or the docs changed: every change is a
copy of `src/` with files laid over it (`variants/<name>/`, built by `build.sh`). Rules held: same API, one WebAssembly build, no setup for
users, **byte-identical output** (a change that altered a byte was discarded; none of the kept ones did).

Machine: i7-1185G7 (4 cores, 8 threads), Node 24.18 (V8 only: no other engine was measured), Emscripten 6.0.12 with the shipped `build:wasm`
flags (my `base` build is byte-for-byte the shipped `dist/clustering.wasm`, 88,221 bytes), clang 18.1.3 and valgrind in the
`localhost/ac-native` container for the native builds and callgrind. WebAssembly times are the median of 5 runs, the builds alternating run by
run, with the load average recorded before and after (1.0 to 1.8 throughout: a desktop with Steam and a browser open; the load is in the first
and last line of each `results/time-*.txt`).

## Summary

- **Where the time is (callgrind, 4.1.0, RGB full precision, 20 MP photos):** `WardGrid::search` is 70 to 73% of all instructions (offer
  included), of which the four-lane **float filter over chunks is 27 to 33%**, ring and column stepping 14 to 16%, cell bounds tests 5 to 11%,
  `offer` 3 to 6%, the exact double cost only 3%. The **pixel scan is 14 to 17%** (histogram `add` 8 to 10%, the scan loop 6 to 7%), grid
  maintenance 5%, writing 4%, chain and cache bookkeeping about 2%. In mapping, an undithered pixel costs 82 to 145 instructions (memo,
  the sink's call, palette index on misses); a dithered one 360 to 1,660, of which `lroundf` is 8 to 14%.
- **Best identical clustering gain: the pixel scan** (hoist the loop's fields into locals, force `add` inline): the scan alone **-31% to
  -34%** in WebAssembly (fern 248 to 170 ms, night 167 to 111, sky 218 to 150, mos50 503 to 340, the greyscale pip 113 to 59). Whole clustering
  with the final set `f1`: **-4 to -6% at full precision, -14 to -20% at `precision: 6`** (where the scan is half the time), -2 to -6% in OKLab;
  instructions -8% (fern, night, sky). `.wasm` +1.7 KB for the scan alone.
- **Best identical mapping gain** (`f1`): undithered mapping through the JS API **-15% to -31%** (night 239 to 164 ms, fern 522 to 435, sky
  362 to 309); dithered **-3% to -11%**; `quantize` at k=16, clustering included, **-5% to -9%** on 20 MP photos. Two changes: `lroundf` replaced by an
  exact equivalent (checked over every float in range), and a four-byte-pixel fast path for mapped output (memo keyed by the raw pixel bytes
  holding the output pixel). **Build levers give nothing**: `-flto` is 2 to 6% slower, `wasm-opt -O3/-O4 --converge` changes nothing (+-2%),
  PGO works for wasm32 (a native `-fprofile-instr-generate` profile is accepted, 1 of 139 functions mismatched) and gives -1 to -2% at full
  precision on 4.1.0, but **adds nothing on top of the scan change** and costs +9% `.wasm`.
- **Nothing found for the search itself** (the 70% that matters at full precision) that survives WebAssembly: loop unrolling of the chunk
  filter saves 4 to 6% of instructions but is **4 to 10% slower** in V8; an integer reach test saves 2% of instructions and 0 to 3% of time.
  Splitting each cell's bucket by count class cuts chunk visits by 41% on fern but costs 5% *more* instructions in the naive form (simulated
  saving 52 to 60% of chunks, `results/sim-class-split.txt`); a design with less per-cell overhead is the one open lead.
- **Identity**: `f1` gives the 4.1.0 bytes for 114 of 114 clusterings (38 images x RGB, `precision: 6`, OKLab), 448 of 448 mapped outputs
  (`quantize` and `quantizeToIndices` at k = 2 to 256, four dither settings, RGB and OKLab, Kodak and four photos), 26,021 fuzz runs of
  `native/fuzz_identical.cpp` (ASan and UBSan, 331 s, against the 4.0.0 reference) and the repo's suite against `f1`'s `.wasm`
  (`results/vitest-f1.txt`: 906 of 908 tests in the first run; the two failures were files missing from the scratch copy, and they pass once those are added; one visual test file can't load there and was not run: see "Identity").

## Profile of 4.1.0 (step 1)

Instruction counts are callgrind (`--dump-instr=no`) on the native `-O2 -g` build of the shipped source. Inclusive and exclusive tables per
function: `results/prof/base-*-{excl,incl}.txt`; the categories below come from `ptable.py`, which sums the exclusive cost of each source-line
range of `search` (the lines of the shipped `clustering.hpp`) and of each function.

### Clustering (RGB, precision 8)

Total 8.56 G (fern), 9.73 G (night), 8.68 G (sky), 0.91 G (k23: a 0.4 MP Kodak photo).

| where (exclusive Ir, callgrind, native -O2, 4.1.0, RGB full precision) | night (9.73 G) | fern (8.56 G) | sky (8.68 G) | k23 (0.91 G) |
|---|---:|---:|---:|---:|
| search: chunk float filter (4 lanes: loads, 3 sub, 3 mul, 3 add, compare, any-true) | 33.2% | 29.7% | 27.3% | 28.9% |
| search: ring and column stepping | 14.0% | 13.7% | 16.0% | 13.5% |
| search: cell tests (bounds test) | 7.3% | 10.9% | 10.8% | 4.6% |
| search: other (line 0: compiler-generated spills and loop control) | 8.6% | 8.2% | 8.9% | 10.3% |
| search: exact double cost + lane loop | 3.1% | 3.1% | 2.9% | 5.5% |
| offer (candidate list insert) | 6.1% | 3.7% | 3.3% | 5.6% |
| nearest (cache bookkeeping) | 1.5% | 1.0% | 1.1% | 2.3% |
| chain bookkeeping and merge (`merge_some`) | 0.8% | 0.9% | 0.9% | 1.8% |
| pixel scan: histogram add | 8.0% | 9.1% | 9.6% | 1.9% |
| pixel scan: loop | 6.2% | 7.0% | 7.2% | 1.3% |
| grid maintenance (link, remove, reindex, count) | 4.8% | 5.5% | 5.1% | 11.6% |
| write (colours, sort, records, CRC) | 3.9% | 4.2% | 4.1% | 8.0% |
| libc memset/memcpy | 1.1% | 1.3% | 1.3% | 1.0% |

Inclusive (`results/prof/base-clust-*-incl.txt`): `search` 72.8% / 69.9% / 69.7% / 69.6% (it contains `offer`), `merge_some` 78.1% /
75.7% / 75.0% / 81.4%, `scan` 14.4% / 16.3% / 17.0% / (k23 1.3% + 1.9%). The brief's split of the merge loop: exact double cost 3%, float filter
27 to 33%, cell tests and ring stepping 19 to 27%, `offer` 3 to 6%, chain and cache bookkeeping 2 to 3%.

### Mapping (`quantize` at k = 16; one `_quantize` call, collected with `--toggle-collect`)

Source: `results/profile-mapping.md` (the whole table is there; fern and night shown).

| image | dither | Ir/pixel | where (exclusive, top) |
|---|---|---:|---|
| night | none | 82 | `step` 46%, `PixelSink::operator()` 38%, `PaletteIndex::get_nearest` 16% |
| fern | none | 145 | `get_nearest` 45%, `step` 33%, `PixelSink::operator()` 21% |
| night | Floyd-Steinberg | 527 | `pick` lambda 43%, `step` 30%, `lroundf` 10%, `get_nearest` 8% |
| fern | Floyd-Steinberg | 604 | `pick` lambda 46%, `step` 26%, `get_nearest` 13%, `lroundf` 8% |
| night | ordered | 362 | `step` 80%, `lroundf` 11%, sink 9% |
| fern | ordered | 1658 | `step` 83% (recipe building), `lroundf` 14% |

The undithered per-pixel cost depends on the memo's hit rate: fern's pixels repeat colours only 35% of the time in a 2^14 memo, night's 86%
(`hitrate.cpp`), so on fern 13 M of 20 M pixels go to the index.

## Every change tried

"Ir" is callgrind of the whole native clustering (`irset.sh`, results in `results/ir.txt`) on fern, night, sky and k23; wasm time is the median of 5
from `time-dist.mjs` (files named in the last column), full precision / `precision: 6`, on the same four images and the mosaic mos12.
Identical: the clustering hash equals the shipped one in every run of the timing (`identical` column of the files) and in `irset.sh`; the full
38-image check is on `f1` only (the set of everything kept).

| # | change | identical | Ir change (fern, night, sky, k23) | wasm time change, full precision | wasm time change, `precision: 6` | `.wasm` size | files |
|---|---|---|---|---|---|---|---|
| 2a | `target_occupancy` 8, 12, 16, 32, 48 (24 shipped) | yes (all) | 24 is the minimum on fern, night, sky, mos12; k23 -4% at 12 to 16; 8 is +23 to +47% | not measured (no Ir gain) | | none | `sweep-occupancy-ir.txt` |
| 2b | two-level grid for dense regions | not built | | | | | see "What is left" |
| 3a | **scan: fields in locals, `add` inline** (`scan-a`) | yes | -6.2%, -5.5%, -6.4%, -1.0% | fern -8%, night -4%, sky -4%, mos12 -4%, k23 -4% | fern -21%, night -20%, sky -17%, mos12 -14% | +1,701 (+1.9%) | `time-cluster-final.txt` |
| 3b | scan: front cache of recent colours with deferred counts (`scan-b`) | yes | scan alone: fern -13%, night -42%, pip -55% | scan alone: fern **+9%**, sky **+6%**, mos50 **+12%**, night -13%, pip -57% (mixed: helps few colours, hurts many) | | not built as a library | `scan-timing.txt`, `scan-ir.txt` |
| 3c | scan: 64-pixel opaque fast path on top of 3a (`scan-c`) | yes | scan alone -44% (3a -36%) | same as 3a within noise (scan alone mos50 -37% against 3a -32%) | same as 3a | +2,016 (+315 over 3a) | `time-cluster-final.txt`, `scan-timing.txt` |
| 4 | exact cost | not tried: it is 3% of Ir (`offer` 3 to 6%), the profile does not justify it | | | | | |
| S1 | integer `reach` replaces the per-cell double multiply, redundant `none` check (`m1`) | yes | -2.2%, -2.2%, -2.8%, -1.2% | -3% to +2% (fern -3.0%, night -0.2%, sky +0.1%, k23 +1.7%) | about 0 | +155 | `time-cluster-final.txt` |
| S2 | chunk filter unrolled 4 at a time, one test per group (`m2`, `UNROLL=4`) | yes | -5.1%, -5.9%, -4.8%, -3.8% | **+3% to +10% slower** (k23 +10%, fern +4.5%, night +4.7%, mos12 +6.7%, sky +2.8%) | -0.3 to +8% | +5,368 | `time-cluster-levers.txt` |
| S2' | the same, 2 at a time (`UNROLL=2`) | yes | -4.2%, -4.5%, -4.2%, -2.7% | **slower** (+4 to +7%: k23 +7.0%, night +5.6%, mos12 +4.4%, sky +3.7%; fern -0.2%) | -2 to +3% | +4,726 | `time-cluster-final.txt` |
| S3 | S2 with the exact-cost lambda `noinline` (`m3`) | yes | fern -2.5%, k23 +0.5% (night, sky not measured) | **slower** (+4 to +11%) | +1 to +9% | -620 | `time-cluster-levers.txt` |
| S4 | `Chunk` fields reordered so the filter's four vectors are one 64-byte line, 128-byte aligned (`lay`) | yes | none (same instructions) | 0 to +4% | -1.5 to +1.3% | +219 | `time-cluster-lay-f1.txt` |
| S5 | bucket split by count class, 3 classes (`cls`) | yes | fern +4.9%, k23 +4.8% | not built for wasm | | | `ir.txt`, `sim-class-split.txt` |
| **F** | **`f1` = 3a + S1 + the mapping changes M1, M2 below** | **yes: 114/114, mapping 448/448, fuzz, suite** | **-8.5%, -7.7%, -9.2%, -2.2%** | **fern -5.5%, night -4.2%, sky -5.4%, mos12 -4.6%, k23 +2.7% (noise: 124 to 130 ms)** | **fern -20%, night -21%, sky -20%, mos12 -13%** | **+2,963 (+3.4%)** | `time-cluster-f1-pgo.txt`, `time-cluster-lay-f1.txt` |

`time-cluster-final.txt`'s last row (mos12, OKLab) was measured while another job ran and is not used; the clean run is
`time-cluster-mos12-oklab.txt` (scan-a -2.9%, `f1` -1.5%). OKLab elsewhere in that file: fern -3.6% (3a), night -3.5%, sky -5.0%, k23 -4.1%.

### Mapping changes (`results/map-ir-mp1.md`, `time-map-f1.txt`, `time-quantize-f1.txt`)

| # | change | identical | Ir change (night, fern, sky, k23) | wasm time change | `.wasm` |
|---|---|---|---|---|---|
| M1 | `lroundf` replaced by `int(x + 0x1.fffffep-2f)` for the clamped, non-negative targets; the plain loop writes the sink inline; the memo holds palette indices (`mp1`) | yes (192 Kodak cases) | Floyd-Steinberg -11.7%, -9.1%, -10.7%, -11.2%; ordered -10.9%, -14.3%, -12.6%, -13.5%; none -0.8%, +3.1%, +1.1%, +0.7% | dithered -5% to -11% | +592 |
| M2 | four-byte pixels to mapped output: memo keyed by the raw first three pixel bytes and holding the output pixel (`mp2`, on top of M1) | yes | none: night -52%, fern -30%, sky -32%, k23 -40% | none: night 242 to 162 ms (-33%), sky 363 to 304 (-16%) (`time-map.txt`; its first rows overlapped another job, so fern is taken from the clean run below) | +1,107 (with M1) |
| both, `f1`, clean run | | yes | | JS `clustering.quantize` (clustering built beforehand): none night -31%, fern -17%, sky -15%, k23 -18%; Floyd-Steinberg -3% to -9%; Atkinson -7% to -11%; ordered -6% to -11% | |
| `f1`, whole `quantize` (clustering included, k = 16) | | yes | | none: night -8%, fern -9%; Floyd-Steinberg -5%; ordered -5% to -9% (k23 within noise) | |

`round_nonnegative` is `round-check.cpp`: all 1,199,570,689 non-negative floats up to 65,535 give the same integer as `lround`
(0 mismatches); it is used only after the clamp to `[0, limit]`. M2's memo is a local `std::vector` made in each `step()` call, so a sliced
mapping starts each 10 ms slice with a cold 128 KB memo; making it a member of the job is the obvious fix and is not measured.

### JS boundary, 20 MP undithered `quantize` at k = 16 (step 5)

`results/copy-bench.txt`, `results/boundary-wasm-only.txt`, `results/time-map-f1.txt`. The two big copies of an 80 MB call: `HEAPU8.set` of the input is
5 to 6 ms (the heap's pages are already mapped); the output copy `new Uint8Array(HEAPU8.subarray(...))` is 29 to 51 ms (28.8 ms in the quiet run,
51 ms under load), and it is **page-faulting a fresh 80 MB buffer**: `subarray.slice()`, a pre-sized array plus `set` and `buffer.slice` all cost the same.
So the boundary is about 35 to 55 ms per 20 MP call: 15 to 25% of an undithered night quantize (164 to 239 ms through JS, 130 to 205 ms in
WebAssembly alone: `boundary-wasm-only.txt`), 8% of fern's. I looked for a redundant pass or copy and found none: no premultiply pass for straight input,
`getWrapper` returns the output as it is for `Uint8Array` and wraps it without a copy for ImageData and `{data, format}`, the input is copied once.
(The standalone WebAssembly driver and the JS call are not directly comparable: the JS figure includes growing the heap by the two buffers.)
A four-wide SIMD scan for small palettes on the undithered path was **not tried**: M2 shows the cost is the memo and the writes (a hit is about 15
instructions), and a miss is the index lookup (about 95 instructions), which a scan over 16 colours would roughly match.

### Build levers on the 4.1.0 source (step 6)

`results/time-cluster-levers.txt` (full precision / `precision: 6`, change against `base`; all outputs identical):

| lever | `.wasm` size | full precision | `precision: 6` | notes |
|---|---:|---|---|---|
| `-flto` (single translation unit) | 91,209 (+3.4%) | +1% to +4% (slower) | +3% to +6% (slower) | no gain: nothing to link-time optimise |
| `wasm-opt -all -O3 --converge` after `em++` | 88,161 (-0.1%) | -0.4% to +1.8% (noise) | -2.5% to +1.9% | `em++ -O3` already runs `wasm-opt -O3` |
| `wasm-opt -all -O4 --converge` | 88,431 (+0.2%) | -0.0% to +1.7% | -0.4% to +2.8% | |
| PGO: native `-fprofile-instr-generate` run on fern, night, k23, mos12 (and OKLab, precision 6, mapping), then `em++ -fprofile-instr-use` | 96,561 (+9.4%) | -0.9% to -2.5% (fern -1.8%, sky -2.5%, k23 +1.7%) | -9.6% to -11.7% (the scan) | **clang accepts a native profile for wasm32**: frontend instrumentation is target independent; "of 139 functions, 1 has mismatched data" (the code that differs under `__EMSCRIPTEN__`). The raw profile has to be merged with the container's `llvm-profdata-18` (the emsdk's is newer and rejects raw format 9) |
| PGO on top of `f1` (profile from `f1`'s source) | 94,539 (+3.7% over `f1`) | fern -3.9% (`f1` alone -5.5%), night -3.2% (-4.2%), sky -5.0% (-5.4%) | about the same or worse (-18% against `f1`'s -20%) | **adds nothing**: `results/time-cluster-f1-pgo.txt` |

## Identity

- **Clustering**: `node check-identical.mjs f1` runs the native `f1` driver on all 38 images (Kodak 24, mos12 and mos50, up12 and up50, the ten
  photos, k03 and k20) in RGB, `precision: 6` and OKLab and compares the FNV-1a hash of each clustering with `results/ref-hashes.json` (the
  shipped build's): **114 of 114** (`results/identical-f1.log`). The WebAssembly builds are compared run by run in every `time-*.txt` (`identical`
  column; the check hashes the clustering or the quantized bytes of the first run of each build).
- **Fuzz**: `./fuzz-variant.sh f1 330` builds the repo's `native/fuzz_identical.cpp` (libFuzzer, ASan, UBSan, compares a clustering from the
  variant with the 4.0.0 copy in `native/reference/`) over `f1`'s source: 26,021 runs in 331 s, no crash or difference (`results/fuzz-f1.txt`).
  The repo's seed corpus is used; the brief asked for at least 5 minutes.
- **Mapping**: `./map-identity.sh f1 ...` compares native `quantize` and `quantizeToIndices` output hashes of `f1` against the shipped source's,
  per image x RGB/OKLab x k x dither (none, Floyd-Steinberg, Atkinson, ordered) x (colours, indices): Kodak k01, k05, k23, k03, k20 at k = 2, 16,
  64, 256 (320 of 320, `map-identity-f1-kodak.txt`) and the photos fern, night, sky and the greyscale pip at k = 16 and 256 (128 of 128,
  `map-identity-f1-photos.txt`). **The brief asked for the photos at k = 2 and 64 too: those were not run** (the 20 MP runs take minutes each).
  The earlier variants `mp1`, `mp2`: `map-identity-mp1.txt` (192 Kodak cases), `map-identity-mp2.txt` (32).
- **Scan, alpha and formats**: `scan-alpha-identity.txt`: the histogram of `scan-a`, `scan-c` and `f1` is the shipped one for every format (RGBA, RGB,
  BGRA, RGBX, BGRX) with and without alpha weighting on an image with partly transparent blocks (`build/alpha-test.rgba`, made from k23).
- **The repo's test suite against `f1`**: `results/vitest-f1.txt`. The suite is run from a scratch copy of the repo with `f1`'s `dist`
  (`clustering.js`, `.wasm`, `.cjs` swapped): 56 of 59 test files and 906 of 908 tests passed in the first run; the three failures were files the
  scratch copy lacked (`LICENSE`, `.babelrc`, `bench/COMPARISON.md`, `CLAUDE.md` for the docs-link tests), and after adding them `api`, `engines`,
  `golden`, `formats`, `dither-methods` and `mapping-slices` pass (66 tests). `test/visual/choose-from-kodak.test.js` imports `bench/spikes/` files
  and cannot load in the scratch copy: **not run against `f1`**. `golden.test.js` passing means the SHA-256 hashes of clusterings, palettes and
  quantized images for the synthetic images and two Kodak photos are unchanged.

## What is left, and what was not measured

- **The search** is still 70% of the instructions at full precision and no change here moved its wall time by more than 3%. Instruction counts
  and V8 time disagree for the micro-changes (S2, S3 saved 2 to 6% of instructions and cost 4 to 10% of time), so a native count is a
  necessary but not sufficient test. The chunk filter (27 to 33%) is 10 vector operations per four lanes and is at its floor.
- **Bucket split by count class** (S5) is the one structural lead. `sim-class-split.txt` (an instrumented build that, for every cell that passes
  the cell test, computes what a split into classes of counts < 8, 8 to 127 and >= 128 would have kept): 52 to 60% of the chunks visited on fern, night and
  sky would be skipped (22% on k23); the naive implementation (`variants/cls`: `cells` grows to three slots per cell, `scan` loops over them) really
  does cut chunk visits by 41% on fern (92.3 M to 54.3 M, `results/cls-counts.txt`) and the chunk-filter instructions by 41%, but the per-cell loop (+0.79 G) and the
  doubled cell tests (+0.5 G) cost more than the saving (+5% net). A version that keeps one cell test, stores a per-cell class bitmask and
  visits only present classes might net about -5 to -10%; not built. Two classes (`SIM_T` 32/100000) saved 46 to 56% in the simulation.
- **Two-level grid** (item 2): not built. The occupancy sweep has its minimum at 24 on four of five images, and 16 and 32 are both +5 to +10%, so
  no coarser or finer uniform grid helps; S5 is the version of that idea that the profile supports.
- **Step 4 (exact cost)**: not done; `search: exact double cost` is 3.1% and `offer` 3 to 6% of the instructions.
- **Not measured**: gzip sizes; `f1`'s clustering time on mos50 and up50 (the scan on mos50 is: 503 to 340 ms for `scan-a`, 327 for `f1`); Ir of `f1` in OKLab and at
  `precision: 6` (wall time is); instructions of `m3` on night and sky and of `cls` on night and sky; M2's Ir under dithering (it does not
  touch it); sliced mapping with M2; any engine other than V8 (the unrolling result in particular may differ); the `lay` variant's Ir (identical by construction).
- **Contaminated, not used**: the mos12 OKLab row of `time-cluster-final.txt` (above); the first rows of `time-map.txt` (a second timing job started during
  them: `time-map-f1.txt` is the clean run of the same comparison).

## Files

- `variants/<name>/`: modified `clustering.cpp` / `clustering.hpp` (laid over the shipped `src/` by `build.sh`): `scan-a`, `scan-b`, `scan-c`
  (= `s-c`), `m1`, `m2` (unroll), `m3`, `c1` (scan-a + m2), `lay`, `cls`, `sim` and the counting copies (`basecnt`, `clscnt`), `occ` (the sweep), `mp1`,
  `mp2`, **`f1`** (scan-a + m1 + mp2), `pgo`/`f1-pgo` (the unchanged source built with a profile), `lto`.
- Drivers: `driver.cpp` (clustering, copied from the chain spike), `mapdriver.cpp` (mapping), `scandriver.cpp` (the scan alone),
  `hitrate.cpp`, `round-check.cpp`, `copy-bench.mjs`.
- Tools: `build.sh`, `make-dist.sh` (a dist-like folder with a variant's `.wasm` and glue), `time-dist.mjs`, `irset.sh`, `profile.sh`, `ptable.py`,
  `lines.py`, `map-ir-table.py`, `check-identical.mjs`, `map-identity.sh`, `fuzz-variant.sh`, `pgo-train.sh`, `scan-ir.sh`, `scan-timing.sh`,
  `run-map-profiles.sh`, `native-run.sh`.
- `results/`: everything above; `results/prof/` the callgrind tables.

## Re-run

```sh
cd bench/spikes/perf-3                                  # needs the photos in ../chain-search/data (data -> that folder), podman image localhost/ac-native, em++ on PATH
source ~/.local/share/emsdk/emsdk_env.sh
./build.sh base native                                   # native clustering driver of the shipped source (callgrind-ready)
DRIVER=mapdriver.cpp ./build.sh base native              # mapping driver
./profile.sh base clust fern                             # callgrind; then: python3 ptable.py build/prof/base-clust-fern-s0-p8.out
./run-map-profiles.sh base                               # mapping profiles (4 images x none, Floyd-Steinberg, ordered)
./build.sh f1 native && node check-identical.mjs f1      # 114 clusterings against the shipped hashes
DRIVER=mapdriver.cpp ./build.sh f1 native && KS="2 16 64 256" ./map-identity.sh f1 "k23 k03 k20 k01 k05"   # mapping identity
./fuzz-variant.sh f1 330                                 # fuzz_identical on f1's source
./make-dist.sh base && ./make-dist.sh f1                 # dist-like folders (then put {"type":"module"} in build/dist-*/package.json)
node time-dist.mjs cluster 5 k23,fern,night,sky,mos12 rgb8,rgb6 base=$PWD/build/dist-base f1=$PWD/build/dist-f1
node time-dist.mjs map 5 k23,fern,night,sky none,fs,atkinson,ordered base=$PWD/build/dist-base f1=$PWD/build/dist-f1
DRIVER=scandriver.cpp ./build.sh f1 native wasm && ./scan-timing.sh "base f1" "fern night"      # the scan alone (build base the same way first)
./pgo-train.sh f1 && EMFLAGS="-O3 -msimd128 -fprofile-instr-use=$PWD/build/pgo-f1/train.profdata" ./make-dist.sh f1-pgo   # PGO
EMFLAGS="-O3 -msimd128 -flto" ./make-dist.sh lto         # LTO
```
