# Value brief: swatch helpers

ROADMAP "Larger, later": a dominant colour, heaviest-first order, swatch objects, hex strings. Measurements: `bench/spikes/swatch-helpers/` (`results.txt`, `results-indexed.txt`), through `dist/index.mjs` (3.4.2).

## Who asked

Exploratory-round agents, in the fourth round (written up 2026-11-18, commit d8480c1), which PRINCIPLES test 2 counts as asking: code migrated from color-thief and node-vibrant "took 26 to 41 lines of glue", and a video tool wanted the same. No issue or person has asked.

Those line counts cover the whole migration, decoding included, not only this. The write-up doesn't give the split. The round wrote its glue against beta.4, whose README already had the hex and heaviest-first recipes (added 2026-11-16, a5b72b0). So the agents either didn't find those recipes or wrote their own anyway. Either way a built-in would have to be found too, which makes discoverability the first fix.

## The symptom

"How do I get the dominant colour?", "the palette isn't sorted by how much of the image each colour covers", "I want hex codes / `{ hex, percent }` objects like color-thief and get-image-colors give me."

## The best recipe

Built in `measure.mjs`. It is 7 lines, plus a 1-line hex helper:

```js
const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const rankSwatches = ({ palette, weights, shares }) => Array.from(shares, (share, i) => {
  const [r, g, b] = palette.subarray(3 * i, 3 * i + 3);
  return { color: [r, g, b], hex: hex(r, g, b), share, weight: weights[i], index: i };
}).sort((a, b) => b.weight - a.weight);
const dominant = rankSwatches(await buildSwatches(image, 5))[0];
```

- **Correctness:** it was checked on 288 rankings (24 Kodak photos, k = 2…256, 12,864 swatches). The shares sum to 1, the order is descending and no entry is lost. There were 290 equal-weight neighbours; `Array.prototype.sort` is stable, so those keep split order and the result is deterministic.
- **Speed:** 105 µs to rank 256 swatches with the guides' version (`results-indexed.txt`), nothing next to the clustering.
- **Indexed images, heaviest first** (`indexed.mjs`, kodim23, and the same photo tiled to 12.2 MP):

  | Recipe | 0.39 MP | 12.2 MP | Colours identical |
  |---|---|---|---|
  | A. The guides' recipe as written (`for…of`, `indices.map`), after `quantizeToIndices` | +8 ms | +246 ms | yes |
  | B. The same renumbering with indexed loops | +1.3 ms | +39–43 ms | yes |
  | C. Rank the swatches, then `quantizeToIndicesWithPalette` to the ranked `Palette` | the cut's own time | the cut's own time | yes |

  - **C** costs exactly what `clustering.quantizeToIndices(image, k)` costs, since index order follows the palette it's given. Exact ties go by packed colour, so the pixels come out the same.
  - **C ranks by cluster weight, not by pixels mapped.** The two can differ, most of all with dithering, so a caller who wants "most-used entry first" for an encoder wants B.
  - **C counts k differently.** `k` counts the transparent entry in `quantizeToIndices` but not when mapping with a palette, so a 256-entry GIF needs a cut of 255 when the image has transparent pixels.

  All three are recipes. A's slowness is a fix to the guides.
- **Traps when copying it:**
  - The palette has to be sorted as RGB triples, not bytes. The recipe does this.
  - **A ranked palette rebuilt as plain bytes loses its colour space.** Plain bytes are matched in RGB (api.md), so an OKLab palette reordered into a `Uint8Array` maps in RGB with no error. The recipe has to rebuild it with `new Palette(bytes, swatches.palette.colorSpace)`, as C does. A built-in would keep the tag for free. That is a small plus, not enough to pass test 1.
  - **fast-png needs the transparent entry first** (guides, "GIFs and palette PNGs"), and ranking moves it. The recipe should say: rank, then do the PNG swap.
  - Sorted palettes of different sizes no longer nest. The guides say so.
  - The colours are muted averages. The guides say so.
  - **The dominant colour depends on k** (next section). A user can't see this coming, and a built-in couldn't hide it either.

### "The dominant colour" isn't one colour

This table compares the heaviest swatch at each k with the heaviest at k = 5, the size the guides recommend, using one clustering per photo and CIEDE2000:

| k | 2 | 3 | 4 | 6 | 8 | 12 | 16 | 32 | 64 |
|---|---|---|---|---|---|---|---|---|---|
| median ΔE from k = 5 | 7.2 | 5.2 | 0.0 | 0.0 | 9.7 | 5.0 | 7.0 | 7.0 | 7.4 |
| photos with ΔE > 10 | 5 | 4 | 4 | 4 | 11 | 6 | 9 | 9 | 7 |

Going from 5 to 8 colours changes the "dominant" colour by more than ΔE 10 on 11 of 24 photos. On kodim01 it jumps by 35, from the brick to a different region. The heaviest swatch is whichever region the cut hasn't split yet, so the answer depends on k as much as on the image. With `precision: 6`, our k = 5 colour was a median ΔE 6.0 (mean 6.6, over 10 on 6 of 24) from MMCQ's first colour, which is what color-thief's `getColor` returns.

## What a built-in adds over it

| Shape | Adds | Costs |
|---|---|---|
| **A `rankSwatches(swatches)` function** (both entries, pure JS) | It saves pasting 7 lines. | One more export and type kept through 3.x. Hex strings and objects are formatting choices the library avoids elsewhere (palettes are flat bytes). It fails PRINCIPLES test 1: a user can do this correctly and fast in a few lines. |
| **An ordering option** (`buildSwatches(image, k, { order: 'weight' })`) | The same result as one argument; by test 5 an option comes before a function. | `buildSwatches` takes `ClusteringOptions`, so this would be the first option there that isn't about clustering. `clustering.getSwatches(k)`, `getSwatchesFromClustering` and the handles take no options today and would need them, and the worker routing changes. It also makes a `Swatches` whose order means two different things, and a rule to learn ("ranked palettes don't nest"). Quality and speed don't change. |
| **A one-call dominant colour** (`buildDominantColor(image)`) | One line. | PRINCIPLES lists "a few vivid dominant UI colours" as a job color-thief and node-vibrant do better. It also hides a k choice that moves the answer by ΔE 10 on about half the photos, and test 3 puts that policy with the app. |

None of these improves quality, and none is faster than the recipe. Each would add only convenience.

## Recommendation

**Recipe.** In the guides:
- merge "Converting the output", "Heaviest first" and the swatch objects in the culori recipe around one `rankSwatches` and one hex helper, and run it in `test/recipes.test.js`;
- for indexed output, give C (map to the ranked `Palette`, tagged) when ranking by cluster weight is enough, and B (indexed loops, 246 → 39–43 ms at 12 MP) when entries must be ranked by pixels mapped. Say how k counts the transparent entry, and that the PNG swap comes after ranking;
- link the recipe from the migration table and the README's swatches example;
- add the k-dependence table to the dominant-colour advice, with the one-line recipe.

Then move the item from "Larger, later" to ROADMAP "Considered", with this brief as the reason, and reword ROADMAP's fixed-subset line, which points at "the swatch helpers in 'Larger, later'". What would reopen it: a request made after the recipe is linked from the migration table and the README, or a need the recipe can't meet.

Scope review (`scope-steward`, value brief stage): **recipe**. It found that all three shapes fail test 1, the option and the dominant colour fail test 6, and the dominant colour fails test 3. Its findings are folded in above: test 2 is met by an exploratory round, recipe C, the colour-space and transparent-entry traps, and the plain-loop timings, which are now measured.
