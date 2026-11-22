# 3.5.0: dithering in linear light (not built)

> **Not built (2026-11-22).** The reviews of this spec, and a measurement made for them, showed that a recipe gets the same quality through the existing API: `ditherInLight` in docs/api.md ("Dithering to a few inks: mix in light"), with the numbers in `bench/spikes/linear-light/results-encoded-recipe.txt`. The option is under ROADMAP "Considered", which also records the shape the reviews reached, as a starting point should it be built (`linearLight`, `colorSpace` setting only the clustering, Atkinson allowed). This spec is kept as the record of the measurements.

ROADMAP item 7. `dither: { linear: true }` mixes colours as light instead of as sRGB values. The error is carried in linear light and matched in a weighted linear space, so dithered images keep their brightness on a panel and neutral areas stay neutral. It changes no existing call's output.

## Why

- **Every method mixes sRGB values, and the eye mixes light.** A half-black, half-white pattern looks like sRGB 188, not 128. With a few widely spaced inks, dithered photos come out much lighter on the panel: on 24 Kodak photos with the seven e-ink inks, Floyd–Steinberg is 1.1–2.6× too bright, and its ΔE measured in light is 19.8.
- **Who asked:** the e-ink, 1-bit and sprite tester in the 3.1.0 release-candidate round, an outside-user agent, not a person. Its only should-fix was this: "mixing happens in sRGB values, not light, and output on a panel gets lighter". It asked for docs, which shipped in 3.1.0 as the "mix in light" recipe in docs/api.md, and called "a linear-light mixing option … a nice to have". No person has asked. The README names the use case ("LED, e-ink or limited-palette displays"), and PRINCIPLES test 2 accepts a request from an exploratory round.
- **Why build it, when a recipe exists:** the spike (below) found that the built-in can do something the recipe can't, which is to match in a weighted linear space. That beats the recipe by about 15% with Floyd–Steinberg on e-ink and about 33% with ordered dithering, removes the colour casts the recipe leaves in neutral areas, and also helps palettes extracted from the image. Full float precision on its own gains nothing over the recipe's 8 bits. The other gains are convenience:
  - there's no trick to know;
  - there's no JavaScript conversion on the calling thread (with the worker entry too);
  - there's no mapping of indices back to the real palette.

## The spike

`bench/spikes/linear-light/` holds the scripts and `results.txt`. Each script's header says how to run it. Method:
- 24 Kodak photos, plus a dark ramp (sRGB 0–48).
- Palettes: the seven e-ink inks, black and white, and 16 colours extracted from each photo.
- Score: mean CIEDE2000 between the original and the result, both blurred with a σ 1.5 Gaussian in linear light (what a panel or a 1:1 view shows), and mean luminance against the original's.

The library's own output and the 8-bit recipe were run through the real package, and they reproduce the numbers recorded in 3.1 (e-ink Floyd–Steinberg 19.6–21.6, recipe 4.7–7.2 on the first six photos). The linear variants are a JavaScript reference.

**Matching space.** The error is always carried in linear light. What varies is how the nearest entry is chosen:

| Matched by | e-ink FS | e-ink ordered | 16 extracted, FS | Verdict |
|---|---|---|---|---|
| (today: sRGB values, no linear light) | 19.81 | 20.63 | 2.47 | |
| linear RGB, unweighted (= the recipe) | 5.26 | 8.85 | 2.49 | colour casts in neutral areas |
| **linear YCbCr, colour axes ×2** | **4.43** | **6.03** | **2.26** | chosen |
| OKLab (nonlinear) | 24.49 (6 photos) | | | worse than today |
| OKLab's linear LMS stage | 26.48 (6 photos) | | | axes overlap |
| S-CIELAB opponent space | 27.39 | 22.14 | 2.98 | bad |

**Colour-axis weight sweep** (linear YCbCr, 24 photos):

| Weight | ×1 | ×1.5 | ×2 | ×3 | ×4 | ×6 |
|---|---|---|---|---|---|---|
| e-ink FS | 4.75 | 4.35 | 4.43 | 4.37 | 4.36 | 4.36 |
| e-ink ordered | 8.57 | 6.39 | 6.03 | 5.86 | 5.80 | 5.75 |
| extracted FS | 2.39 | 2.30 | 2.26 | 2.26 | 2.31 | 2.50 |
| extracted ordered | 2.45 | 2.32 | 2.25 | 2.22 | 2.26 | 2.41 |

The weight has a broad plateau from 1.5 to 3. Extracted palettes turn worse from 4.

**Black and white.** Only the brightness axis matters here, so every Y-weighted metric gives the same result.
- Ordered: 12.24 against the recipe's 12.39, better on 24 of 24 photos, with brightness exactly 1.00 (the recipe's ranges 0.88–1.23).
- Floyd–Steinberg is mixed: 13.04 against 12.88, better on 15 of 24, with one photo much worse (32.2 against 28.1).

**Atkinson in linear light** is too dark under every matching rule (luminance 0.45–0.97 on e-ink, 0.11–1.00 in black and white). In the pictures (`pictures.mjs`) it crushes shadows to solid black: half of kodim23's crop, and the bikes in kodim05. A variant that dropped Atkinson's quarter in sRGB terms was worse still.

## Surface

```js
quantizeWithPalette(image, eink, { dither: { linear: true } });                     // Floyd–Steinberg in light
quantizeWithPalette(image, eink, { dither: { method: 'ordered', linear: true } });  // ordered in light
```

- **`linear` is a key of the `dither` object:** `boolean`, default `false`. It has no plain-value shorthand, because `'linear'` isn't a method and must not enter `ditherMethods`. It has no list of names, because it has two states. The only plausible third state, "mix perceptually", is what `colorSpace: 'oklab'` already does. A list (`light: 'srgb' | 'linear'`) would also respell sRGB, which the API calls `'rgb'`.
- **It reaches every function that takes `dither`:** `quantize`, `quantizeToIndices`, `quantizeFromClustering`, `quantizeToIndicesFromClustering`, `quantizeWithPalette`, `quantizeToIndicesWithPalette`, the `Clustering` methods `quantize` and `quantizeToIndices`, the worker entry's functions, and `worker.cluster()` handles. `parseDither` in `src/shared.js` reads it, so both entries read it alike. No new routing is needed.
- **Clustering is unaffected.** In `quantize(image, k, { dither: { linear: true } })`, the palette is extracted exactly as today and only the mapping mixes in light.
- **Output:** the colours written, and the indices, are the palette's own entries. Alpha handling, the transparent entry and skipped alpha-0 pixels are unchanged.

### What is rejected

Each rejection is an `invalid-argument` error. It applies at every strength, because it is the combination that is wrong, not the amount.

| Combination | `argument` | Why |
|---|---|---|
| `linear: true` with `method: 'atkinson'` | `options.dither.linear` | In light, dropping a quarter of the error crushes shadows (spike). Accepting it later is additive. |
| `linear: true` when the call matches in OKLab: `colorSpace: 'oklab'`, or by default an OKLab `Palette` or clustering | `options.dither.linear` | Light adds up only in a linear space, so OKLab can't carry the error, and matching in OKLab with linear error was worse than today. The weighting OKLab would add is already built into `linear`. |
| `linear` that isn't a boolean | `options.dither.linear` | |

The messages, in the library's `Invalid <thing>: …` form:
- `Invalid dither.linear: linear light works with Floyd–Steinberg and ordered dithering; Atkinson drops part of the error, which in light turns shadows black. Use method: 'floyd-steinberg' or 'ordered', or leave linear out.`
- `Invalid dither.linear: linear light mixes and matches in its own linear space, but this call matches in 'oklab' (<source>). Pass colorSpace: 'rgb', or leave linear out.` Here `<source>` is `the colorSpace option`, `the palette's own colour space` or `the clustering's colour space`, whichever made it OKLab.
- `Invalid dither.linear: got <value>; it must be true or false.`

The OKLab check needs the matching space, so it runs where that space is resolved (`matchingSpace` and the clustering header). That is still synchronous and before any await, after the image, k or palette and the other options are checked, in the order docs/api.md gives. With `colorSpace: 'rgb'` passed explicitly, an OKLab palette or clustering is matched in RGB as today, and `linear` is accepted.

**Accepted as no dithering:** `{ linear: true, strength: 0 }`, so a strength slider that reaches 0 doesn't start throwing. This matches how `steps` is accepted at strength 0. `dither: false` has no way to say `linear`.

### Hints for misplaced settings

- `linear`, `light`, `linearLight` and `gamma` given as top-level options join `ditherSettings` (src/index.js), so they get the hint pointing at the object form. Both hint texts become `dither: { method, strength, steps, linear }`.
- `dither: 'linear'` (and `'linear-light'`) gets the generic message plus: ` To mix in linear light, write dither: { linear: true }.`
- An unknown key inside the object lists the known ones: `expected method, strength, steps or linear.`
- `light: …` inside the object gets that message plus: ` To mix in linear light, write linear: true.`

### Types

- Add `linear?: boolean | undefined` to both arms of `DitherOptions` in `src/index.d.ts`. `worker.d.ts` re-exports it. It stays a two-arm union. Rejecting Atkinson with `linear` is a run-time error, not a third arm, so `DitherOptions` doesn't change shape, and narrowing it can wait for a reason.
- Doc comments on `DitherOptions` and `MappingOptions.dither` must say:
  - it mixes in linear light;
  - it works with Floyd–Steinberg and ordered dithering;
  - it doesn't combine with OKLab matching;
  - the colours written are the palette's own;
  - the CSS term for the idea is `srgb-linear`.
- `test/types`: `{ linear: true }` and `{ method: 'ordered', linear: true }` compile, and `linear: 'yes'` doesn't (`@ts-expect-error`).

## Behaviour (C++)

All of this is inside `map_pixels`, behind a new trailing argument `dither_linear` (0 or 1) on every export that takes `dither_method`, in step with `EXPORTED_FUNCTIONS` and `src/index.js`. With 0, the code path and output are exactly today's: the golden tests pass unchanged.

With 1:
1. **Coordinates.** Each 8-bit channel decodes to linear light by the exact sRGB transfer function (a 256-entry table of doubles: `c ≤ 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4` with c = v/255). A colour's matching coordinates are the matrix below applied to its linear R, G, B:
   - `Y  = 0.2126 R + 0.7152 G + 0.0722 B`
   - `Cb = w · (B − Y) / 1.8556`
   - `Cr = w · (R − Y) / 1.5748`
   - with **w = 2** (the BT.709 matrix on linear values, colour axes weighted).

   The palette's entries are converted once and the pixels through a memo. Since this is a linear map of linear light, carrying the error in these coordinates is the same as carrying it in linear RGB.
2. **Floyd–Steinberg:** the existing serpentine loop and kernel, with the error carried in these coordinates as doubles (or floats, whichever the JS reference below reproduces exactly). The error each pixel receives is capped in length at the coordinate range, as today's vector bound is. A target outside the range of the palette's reachable colours is matched exactly by a pass over the palette, as `nearest_outside` is now.
3. **Ordered:**
   - Each distinct colour gets a recipe of `steps` picks in these coordinates: pick the entry nearest the target plus the carried error times the internal strength, then add target − pick to the error.
   - The recipe is sorted by `Y` (ties by packed key) and laid out by the same Bayer matrix.
   - Recipes are memoised as today. The recipe-table key need not include `linear`, because a call uses one setting.
4. **Nearest entry:** exact under squared Euclidean distance in these coordinates, with exact ties going to the smaller packed RGB key and then to the first index, the same rule as today. How it is indexed is the builder's choice: a grid or k-d tree over the new coordinates, or a plain scan for small palettes. It must give the same answers as an exhaustive search.
5. **Ordered strength.** The `knot_internal` table was fitted so ordered dithering changes about the same share of pixels as Floyd–Steinberg at each strength, in sRGB. Measure that response under linear light, comparing ordered with linear Floyd–Steinberg at 0.05, 0.1, 0.25, 0.5 and 0.75. If it stays within a few points, reuse the table; otherwise fit a second one by the same method and record both in the ROADMAP.
6. **Determinism.** Output depends only on the inputs: no platform-dependent maths beyond what WASM pins down. `pow` runs only when the 256-entry table is built.

The weight w = 2 is final unless the check before release (below) shows a reason to move it within the 1.5–3 plateau. It is an internal constant, not an option, and changing it later changes output, so it is fixed for 3.x once released.

## Checks before release

- **A JavaScript reference test** (`test/dither-linear.test.js`, like `test/dither-methods.test.js`) reimplements both methods in plain JavaScript and checks byte-exact equality. It covers:
  - RGB palettes of 2, 7, 16, more than 64 and more than 1024 colours (every lookup path);
  - images with alpha, the transparent entry, and strengths 0.05 and 1;
  - out-of-range targets (the e-ink cyan case).
- **Goldens** for linear Floyd–Steinberg and ordered on the synthetic images and one Kodak photo, added to `test/golden.json`. The existing hashes don't change.
- **Quality:**
  - Rerun `bench/spikes/linear-light/measure.mjs` with the built-in in place of the reference. It must reproduce the spike's numbers within noise.
  - Also run the synthetic images in `bench/lib/images.js` and the 3.1 round's sprite case (the PICO-8 palette on small sprites), to confirm that w = 2 holds off the photos it was tuned on.
- **Speed:** `bench/dither.bench.js` gains linear cases. Record time against the sRGB path for Floyd–Steinberg and ordered at 7 inks, 2 colours and 16 colours, plus the recipe's JavaScript conversion time on 768×512 and 4K. If linear is over 2× the sRGB path, bring it to the maintainer before release.
- **Size:** record the `.wasm` size change, which the ROADMAP watches. If it grows over 5 KB, bring it to the maintainer before release.
- **Sanitizers:** run the ASan/UBSan recipe in CLAUDE.md.
- **Errors:** both entries give the same `code`, `argument` and message for each rejection, including OKLab by default from a `Palette` and from a clustering. That goes in `test/api.test.js` or the worker parity tests, wherever the existing dither checks live.

## Docs and records

- **docs/api.md:**
  - Replace "Dithering to a few inks: mix in light" with the option. Keep what still holds:
    - the explanation of mixing light;
    - looking at the result at 1:1, because a viewer that shrinks the image averages sRGB values and makes it look too dark;
    - the measured gains;
    - that extracted palettes gain a little too.
  - Drop the recipe and "A built-in way … is on the roadmap".
  - Add `linear` to the `dither` row of the options table, and add the method and colour-space limits.
- **docs/guides.md:** update the fixed-palette and e-ink advice (around lines 263–272).
- **README:** a line only if the e-ink mention benefits from it.
- **CHANGELOG** `## 3.5.0`: Added. It says output is unchanged unless `linear` is set, and that types gain `linear?`.
- **ROADMAP:**
  - Tick item 7 with the measurements.
  - Move it above item 6, since "Next" is ordered; the reason is that 6 starts with a measurement and a 4.0-reaching API question.
  - Add `linear` to item 6's recipe-cache key.
  - Under "Considered":
    - `colorSpace: 'linear'`: it would also change clustering and the stored header byte, and give 4.0 two ways to say it;
    - a top-level option: against the option-shape convention;
    - `light: 'srgb' | 'linear'`: respells `'rgb'`;
    - linear with OKLab matching, and linear Atkinson: measured worse, so rejected and open to a request;
    - linear-light clustering: nobody asked, and it would need a new colour-space code;
    - a user-set weight: an internal constant until someone asks.
- **PRINCIPLES "Settled decisions":** linear light is `dither: { linear: true }`, a boolean in the object form. It carries error in linear light and matches in weighted linear YCbCr. It is rejected with Atkinson and with OKLab matching.
- **CLAUDE.md:** the `map_pixels` paragraph gains the linear path, and the trailing-argument list gains `dither_linear`.
- **bench/spikes/linear-light/:** scripts runnable from the repo, a short `README.md` with the tables above, and the pictures command.

## Non-goals

- Linear-light clustering, or a `colorSpace` value for it.
- A conversion helper (`toLinear`) or any colour-management export.
- A user-set weight, or other transfer curves (`gamma: number`).
- Changing any default. Making linear light the default for small palettes would change output, so it is not planned. If someone asks, it goes into 4.0 then.
- Atkinson and OKLab with `linear`. Both are rejected now and open to a later, additive acceptance.

## Builder's calls

- Doubles or floats for the error, whichever a JavaScript reference reproduces bit for bit.
- The nearest-entry index for the new coordinates.
- Where exactly the OKLab check sits in `src/index.js`, provided it is synchronous, comes after the existing checks, and gives the messages above.
- Whether the ordered strength table needs a linear twin. That is decided by the measurement in Behaviour 5.

## Delivery

- Branch `docs/3.5-linear-light-spec` from master. The spec, plan and implementation all go on it.
- Commits authored by the user, with no Claude trailers.
- One PR, which the user merges, then release 3.5.0 with the usual flow.
