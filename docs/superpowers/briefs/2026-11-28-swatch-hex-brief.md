# Value brief: swatches as hex strings, largest share first

The swatch-helpers item again (ROADMAP "Considered"), narrowed to what was asked this time. Earlier brief: `2026-11-23-swatch-helpers-brief.md`. Measurements: `bench/spikes/swatch-hex/measure.mjs` → `results.txt`, through `dist/index.mjs` (4.3.1). The other two wishes from the same report (palette-PNG-ready indexed output, shares that include the transparent area) get their own briefs. Revised after review (last section).

## Who asked

The `first-time-user` exploratory-round agent, 4.0.0-beta.4 round, building a Node script that writes a palette JSON per image and a browser page that shows swatches:

> `swatches` with hex strings and sorted by share (a `toHex` or `ranked` option, or `{ hex, share }` objects). Everyone writes this.

> Hex codes and shares: the README swatch example prints `rgb(...)`. `toHex` is not in the README. It is defined in the guides "Converting the output" section (not in the "Heaviest first" snippet that uses it, which depends on it being defined earlier). I assembled it myself.

The same report says the first run worked and "Yes, I would ship with this beta". The maintainer then called the first-time user's wishes valid (2026-11-26) and asked for this brief (2026-11-28). No issue or outside person has asked.

**Why the 2026-11-23 verdict is open again:** its reopen condition is met ("a request made after the recipes are linked from the migration table and the README": the beta.4 README linked "Heaviest first"); the feature test was revised on 2026-11-24 to count a recipe's own costs; and the agent hit a flaw in the recipe.

## The symptom

Paraphrased: "I want hex codes, biggest colour first."

## The recipe the guides ship is broken

This is a bug whatever is decided.

| What a user does with the first "Heaviest first" block | Result |
|---|---|
| copies it alone | `ReferenceError: buildSwatches is not defined` |
| adds the import | `ReferenceError: toHex is not defined` |
| adds `toHex` from the section above | runs |
| uses it in strict TypeScript | 7 errors |

`test/recipes.test.js` compares the block's text with its own copy and defines `toHex` itself, but never runs the block alone. The README's link, the migration table and the culori recipe all lead to it.

## The best recipe

Self-contained, 8 lines of code with its import:

```js
import { buildSwatches } from 'agglomerative-clustering';

// Swatches as objects, the largest share first: [{ color: [r, g, b], hex: '#rrggbb', share }]
function rankSwatches({ palette, shares }) {
  return Array.from(shares, (share, i) => {
    const [r, g, b] = palette.subarray(3 * i, 3 * i + 3);
    const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    return { color: [r, g, b], hex, share };
  }).sort((a, b) => b.share - a.share);   // equal shares keep split order
}
```

- **Correctness:** 240 rankings on the 24 Kodak photos (ten sizes from k = 1 to 256, 12,360 swatches): none out of order, and no hex or colour parted from its share.
- **Speed:** 0.003 ms at k = 5, under 0.2 ms at k = 256, about 2 ms at k = 4,096. `buildSwatches` takes about 110 ms on the same photo.
- **Dependencies and internals:** none. It takes any `Swatches`, so it works on `clustering.getSwatches` and worker results too.
- **TypeScript:** annotating the parameter (`: Swatches`) gives 0 errors under `strict`. Two gaps remain for the repair to close: 1 error with `noUncheckedIndexedAccess`, and `color` is typed `number[]`, not `[number, number, number]`.

**Traps in writing it by hand:**
- Without `padStart`, 568 of 12,360 swatches (4.6%; 2.0% at k up to 8) give a malformed string. 178 of those are 3 or 4 digits long, which CSS reads as a different colour.
- `JSON.stringify` on `buildSwatches`' own result gives `{"palette":{"0":0,…`; the recipe's plain arrays serialise as expected.
- `.map` on the typed arrays coerces strings to numbers in plain JavaScript (found by review).
- From the earlier brief: a ranked palette rebuilt as bare bytes loses its colour space, and the "dominant" colour moves with k.

## What a built-in adds over it

Against the repaired recipe: **no quality and no speed.** It saves 8 lines and the copy step, gives types and autocomplete, and comes with the version promise and our fixes (the current block has been broken in the guides since 2026-11-23).

| Shape | Solves | Costs, kept through 4.x |
|---|---|---|
| **A pure `rankSwatches(swatches)` export** (both entries) | hex, order, JSON shape, the `padStart` trap | one function and one type, docs, snapshots; field names, hex case and tie order become API. Not the colour-space or k traps |
| A `hex: string[]` field on `Swatches` | hex only | built on every cut, wanted or not; order, JSON and sorting stay with the user |
| A sort option | order only | declined 2026-11-23: the first non-clustering option there, and `Swatches` order would mean two things |

Under test 1: the recipe is far below 25 lines, needs no third-party code or internals, and a built-in would run no faster. "Easy to copy wrong" is present, and the failures seen were in our docs, which docs can fix.

## Recommendation

**Recipe, repaired:**
1. The block above replaces the broken one, with the import and hex inside it.
2. TypeScript: it compiles under `strict` and `noUncheckedIndexedAccess`, with `color` as a tuple; `rankPalette`'s parameter annotated.
3. `test/recipes.test.js` takes the blocks from the guides, runs them as written and type-checks them, replacing its hand-kept copy.
4. Make it findable: hex in the README's swatches example (run by the snippet test), the README link made absolute, links from the guides' "Swatches and choosing a palette size", `api.md` `buildSwatches` and the `Swatches` doc comment, and one sentence on JSON output.
5. ROADMAP "Considered": record this request. A request made after the repaired release goes to the maintainer as a build candidate (a pure `rankSwatches(swatches)` returning `{ color, hex, share }`), not as another repair.

The case for building now: this is the second round to ask, "a recipe that keeps being needed is evidence for the built-in" (PRINCIPLES), and the export is small. The maintainer decides.

## Review

**scope-steward: recipe.** Only test 1's "easy to copy wrong" sign is present. It asked for a smaller repair: no one-call wrapper (dropped), TypeScript as one annotation and a sentence, and the test reading the guides' block instead of a copy. If built anyway: one pure function, no field or option.

**user-advocate: recipe is enough, if repaired further than the first draft.** It added the discoverability links, TypeScript under `noUncheckedIndexedAccess` with a tuple `color`, the JSON and typed-array traps, and the rule that the next request becomes a build candidate. Its smallest built-in is the same function.

**Where they differ:** how much TypeScript to write. Item 2 follows the advocate for `rankSwatches` and `rankPalette`, and leaves `rankIndices` as it is (a different job, not asked for). The culori block isn't run by the test, since culori isn't a dependency.

Both found the first draft's correctness check too weak (it didn't pair each hex with its share); it was tightened and rerun.

## Decision

**Recipe** (the maintainer, 2026-11-28), with items 1 to 5 as recommended.

The shipped block differs from the one printed above in one line: it builds `color` from three indexed reads (not `subarray` destructuring), so that TypeScript can type it as a tuple. The figures above were measured on the printed one; `test/recipes.test.js` runs the shipped one.
