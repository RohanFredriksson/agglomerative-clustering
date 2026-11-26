# Perf spike 4: the nearest-partner search, same bytes

Base: this branch's `src/` (4.2.0 build commit 1b7f14c). Every number below comes from a script and a results file in `results/`.

## Summary

- **Class split (the open lead): nothing worth shipping.** A lean split (one cell test, count classes in separate chunk lists, a per-class test only for cells that hold more than one class) is byte-identical but saves at most 0.1 to 0.9% of instructions on the photos and costs 2.6% on k23. With per-class bounds it costs +0.8 to +3.6%. It does cut chunk visits (fern 92.3 M to 74.7 M with 2 classes of 32; 59.5 M with 3 classes of 8/128), but the cell bounds it relies on were already loose (see next point), and once they are exact the split adds nothing (below). Not timed in V8, since instructions were not better than the simpler variant.
- **The finding: the cell bounds go stale, and tightening them is exact and worth 10 to 17%.** `bucket_bounds` is the colour box and the lightest count of everything *ever linked* into a cell; removals only loosen it. Merging removes about every cluster, so by the time a cell is searched its box and its lightest count describe clusters that are gone, and the cell test lets through cells and chunks that can't hold the partner. Recomputing a cell's bounds from its live lanes when a removed cluster was at one of the bounds' extremes (or was the lightest) cuts cells visited on fern from 9.02 M to 4.14 M and chunks from 92.3 M to 58.2 M.
  - Exact: the bounds are always valid bounds of the live lanes (tighter than before), the test stays conservative, and nothing is pruned that could tie with the best. Output is byte-identical (114 of 114 native clusterings; every WebAssembly timing run compares output hashes: all yes).
  - WebAssembly in V8, clustering (median of 7): mos12, fern, night, sky at full precision **-14.5%, -13.8%, -13.6%, -16.4%**; OKLab -13.3, -10.4, -10.2, -18.1%; `precision: 6` -5.8, -9.3, -1.6, -14.4%; mos50 -7.2%, up50 -52.8%. Kodak (24 images, full precision, 7 runs): mean -2.6%, between -9% and +2.5%: small images, where the search is a smaller part and the recompute is not free (k23 +2.5%). `.wasm` +945 bytes (91920 to 92865).
- **Ring stepping and the float filter: not pursued.** The line profile of the tightened build (k23) shows no single clear cost: the chunk filter is 30% of `search`, the ring and axis-gap bookkeeping is spread over many lines of 1 to 3% each. After tightening, fewer chunks reach the filter anyway.
- **Recommendation for 4.3.0: ship `variants/tight`** (about 40 lines in `WardGrid`: `exact_bounds` and a check in `remove`). Expected gain on real photos: about 10 to 15% of clustering time at full precision and OKLab, 2 to 14% at `precision: 6`, and nothing on small images (Kodak size), where it is within noise (-2.6% mean, +2.5% worst).

## Variants

Instructions: callgrind (native clang, `-O2`), clustering RGB, full precision. Base: k23 899.4 M, fern 8032.6 M, night 9195.7 M, sky 8118.4 M. Every variant gave the base hash on all four (`results/ir-*.txt`, `yes`); Ir lines: `results/ir-base-tight-lazy.txt`, `ir-tight-split.txt`, `ir-tight1.txt` (scalar eager). The two `cls32` rows and the vectorised-eager row were read from the console during the spike and not saved (the source was edited since); the macros in `variants/cls` rebuild everything else. Only `tight` was checked on all 114 clusterings and fuzzed.

| variant | what | Ir k23 | fern | night | sky | chunks visited, fern | V8 time |
|---|---|---|---|---|---|---|---|
| cls32 (static) | 2 classes (<32, >=32), per-class test with the class's minimum count against the cell's gap | +2.6% | -0.1% | -0.9% | -0.9% | not counted | not timed |
| cls32 (bounds) | the same with per-class boxes and lightest counts (stale ones) | +3.6% | +1.6% | +0.8% | +2.6% | 74.7 M (2 classes), 74.7 M (3 classes 32/100000), 78.3 M (4/..) , 59.5 M (3 classes 8/128) | not timed |
| tight, eager, no skip | recompute a cell's bounds on every removal (scalar loop) | +26% | +0.9% | +0.9% | -4.1% | 58.2 M | not timed |
| tight, eager, vectorised | the same, vector min/max over chunks | +8.7% | -6.9% | -8.4% | -10.1% | | not timed |
| **tight** | recompute only if the removed cluster was at an extreme of the bounds or the lightest | **+2.4%** | **-10.4%** | **-12.1%** | **-12.9%** | 58.2 M | **-14% (mos12, fern, night), -16% (sky)**; OKLab -10 to -18%; `precision: 6` -2 to -14%; Kodak mean -2.6% |
| tight, lazy | mark the cell dirty on such a removal, recompute when a search reaches it | +3.1% | -8.2% | -10.6% | -10.6% | | not timed |
| tight + 2 classes (32) | tight plus the split | +6.9% | -8.9% | -11.0% | -10.9% | 49.4 M | not timed |
| tight + 2 classes (8) | | +6.3% | -9.0% | -11.0% | -10.8% | | not timed |
| tight + 3 classes (8/128) | | +7.9% | -8.8% | -10.9% | -10.3% | | not timed |

Identity of `tight`: 114 of 114 clusterings (38 images x RGB, `precision: 6`, OKLab) equal the shipped hashes (`results/identical-tight.txt`); `native/fuzz_identical.cpp` for 331 s (25,576 runs, ASan and UBSan, no crash, no difference: `results/fuzz-tight.txt`); every V8 timing row: identical = yes (`results/time-tight*.txt`). Size: 92,865 bytes against 91,920 (+945), not gzipped.

## Why the split lost

With the bounds as they were, a cell holding one old light cluster passes the cell test for the heavy ones; a split fixes that by giving each class its own bounds. But the same staleness hits each class's bounds too, and recomputing them exactly removes most of what the split would have saved (chunks visited 58.2 M with tight alone, 49.4 M with the split on top), while a second bounds record per class, the per-cell class loop and the extra test cost more than the 15% fewer chunks save.

## Why `tight` is exact

A cell is skipped only when its lightest possible member at the nearest point of its colour box can't beat the bound. Any valid lower bound of the live members' cost keeps that test conservative. Bounds computed from the live lanes are such a bound and no looser than the ever-linked ones. The recompute is skipped when the removed lane was strictly inside every extreme, because then the live box and lightest count are unchanged, so the stored (exact) bounds still hold. Search order and which clusters are offered change only by dropping cells that couldn't beat the bound, and ties break by the total order in `offer`, independent of visiting order. `examined` is unchanged in definition (cell sizes of visited cells), so the cache-flagging rule stays well defined; output was identical on every image anyway.

## Re-run

```
cd /home/rohan/Programming/agglomerative-clustering/bench/spikes/perf-4
./build.sh base native && ./irset.sh build/base/driver-native base 0 8 fern night sky k23   # Ir and hash (rgb8)
./build.sh tight native && ./irset.sh build/tight/driver-native tight 0 8 fern night sky k23
node check-identical.mjs tight               # 114 hashes against results/ref-hashes.json
./fuzz-variant.sh tight 330                  # libFuzzer, ASan, UBSan
source ~/.local/share/emsdk/emsdk_env.sh
./make-dist.sh base; ./make-dist.sh tight    # build/dist-<name>
node time-dist.mjs cluster 7 k23,mos12,fern,night,sky rgb8 base=./build/dist-base tight=./build/dist-tight
# class-split variants: variants/cls (macros CLS_N, CLS_T1, CLS_T2, CLS_TIGHT, CLS_LAZY, CLS_CNT), e.g.
NATIVEFLAGS="-DCLS_N=2 -DCLS_T1=32 -DCLS_TIGHT" ./build.sh T2s native    # (copy variants/cls to variants/T2s first)
```
`variants/tight/clustering.hpp` is the shipped `src/clustering.hpp` with the change; `data` is a link to the chain spike's photos; tools are copies of perf-3's (`native-run.sh` points at perf-4).

## Lazy bounds (the worst cases for the eager recompute)

Eager `tight` (now in `src/`) is slower than 4.2.0 on images where every colour appears once or counts tie, because almost every removal hits the "was an extreme or the lightest" test and recomputes the cell's bounds, while the recomputed bounds rarely reject anything more. `skew-check.mjs` (copied here; WebAssembly, median of 5, alternating with 4.2.0, load 0.4 to 1.1 before and after each batch) and callgrind on three small versions of the same images (`results/ir-skew-lazy.txt`) show it. Output is byte-identical in every row.

Variants (`variants/<name>/clustering.hpp`, all on top of the eager source):
- `eager`: the current `src/` (03e78ac).
- `lazy1`: `remove` marks the cell dirty (`bounds_dirty`); `search` recomputes a dirty cell on every visit, before the cell test.
- `lazy2`: as lazy1, but a dirty cell is recomputed only when its loose (valid) bounds do not already reject it.
- **`lazy3`**: lazy2 plus a per-cell back-off: a recompute that does not make the cell test reject the cell is a strike; after s strikes in a row the next 2^s - 1 recomputes of that cell are skipped (loose bounds are valid, so this changes speed only); a recompute that rejects resets it. Two bytes per cell more (`refresh_strikes`, `refresh_skip`); `bounds_dirty` is cleared with the other per-cell vectors when the grid is rebuilt.
- `lazy4`: lazy3 with 16-bit skip and up to 1023 skipped visits: same Ir as lazy3 on the synthetic images and k23, slightly faster on photos in WebAssembly (`results/release-sub-lazy4.txt`).
- `lazy6`: lazy3 with the dirty path out of line (to save size): slower (skC +4.4% Ir), not pursued. `lazy5`, `lazyN`, `lazy4c`: diagnostics (a first-visit skip changes nothing; never marking dirty costs +0.4% Ir from the checks alone; counters).

Why lazy1 and lazy2 are not enough: on the dense block the eager version recomputes 0.9 M chunks to save 1 M chunk visits (skA: 44 M chunks recomputed against 243 M scanned, 1% fewer visited). Lazy refresh only moves the recompute to the visit; most dirty cells that are visited do get recomputed. On photos the same counters are 5% of scanned chunks recomputed, for 37% fewer chunks (fern 92.3 M to 58.2 M).

WebAssembly, clustering time against 4.2.0 (`results/skew-eager.txt`, `skew-lazy1.txt`, `skew-lazy3.txt`):

| image | config | eager | lazy1 | lazy3 |
|---|---|---|---|---|
| dense 64^3 block | full / 6 / OKLab | -0.4 / -3.0 / +6.5% | +4.5 / +2.1 / +9.2% | +4.5 / +0.2 / +3.8% |
| block + 25% scatter | full / 6 / OKLab | +16.9 / -1.0 / +14.4% | +7.5 / +0.8 / +12.4% | +1.6 / +1.9 / +2.1% |
| noise 1024^2 | full / 6 / OKLab | +9.3 / +5.3 / +5.9% | +7.4 / +8.6 / +1.8% | -1.0 / +4.1 / +2.5% |
| 32^3 x 8 + scatter | full / 6 / OKLab | +1.8 / +2.7 / +5.6% | +3.6 / +4.6 / +5.4% | +2.1 / +3.5 / +4.5% |

Callgrind Ir (native, RGB full precision), lazy3 against the 4.2.0 source: skA (block + scatter) +0.3% (eager +27.7%), skB (noise) +2.3% (eager +7.4%), skC (block) +2.0% (eager +8.2%). Never marking dirty costs +0.4% on skC, so the remaining 1.6% is the first recompute of each cell.

Photos (`release-check.mjs`, ten photos plus k23, median of 5, 4.2.0 alternating; `results/release-lazy3.txt`, `release-eager.txt`): mean over nine photos (excluding pip and k23):

| config | eager | lazy3 |
|---|---|---|
| full precision | -15.0% | -11.9% |
| `precision: 6` | -5.7% | -3.9% |
| OKLab | -14.3% | -11.1% |

k23 (small, 24 ms-class noise of about 4%): eager -4.1 / -5.1 / +0.4%, lazy3 +4.4 / -3.2 / +4.9%. pip: within 2.3%. Callgrind on the photos (`results/ir-lazy.txt`) shows lazy3 keeps the gain in instructions (fern -10.2%, night -11.6%, sky -12.5%, k23 -0.2% against eager -10.4, -12.1, -12.9, +2.4), so the 3 points it loses in V8 are not instruction count; the extra byte vectors and the dirty branch in the hot `scan` lambda are the suspects, not measured further. `.wasm`: 4.2.0 91,920 bytes, eager 92,865, lazy3 95,879 (lazy4 96,082, lazy6 94,126).

Identity of lazy3: 114 of 114 native clusterings equal the shipped hashes (`results/identical-lazy.txt`); `test/golden.test.js` passes (17 of 17, built into `dist/` from the variant: `results/golden-lazy3.txt`); `fuzz_identical` 301 s, 12,151 runs, ASan and UBSan, no crash and no difference (`results/fuzz-lazy3.txt`); every timing row identical = yes.

Recommendation: lazy3 meets the goal only in part. It is within ±2% on 4 of 12 skew rows and +4.5% at worst (eager +16.9%), and it gives up 1.8 to 3.2 points of the photo gain. Eager is simpler (about 40 lines, one vector fewer, 3 KB smaller) and better on every real image; lazy3 is better only on tied-count synthetic images, where it still is not better than 4.2.0. Ship eager unless slowing images of that kind by up to 17% matters more than the 3 points on photos; if it does, take lazy3 (lazy4 if the extra 2 bytes per cell are acceptable) and expect +2 to +4% on the dense images.
