# Value brief: detecting RGB bytes passed bare

ROADMAP "Larger, later": "Detecting RGB bytes passed bare." Measurements: `bench/spikes/bare-rgb/`, through `dist/index.mjs` (3.4.2):
- `check.mjs`: the candidate check;
- `measure.mjs` → `results.txt`;
- `evidence.mjs` → `results-evidence.txt`: the decoding round's files;
- `fetch-images.mjs`: downloads the emoji sets.

## Who asked

No person or issue. Exploratory-round agents in the decoding brief's round (`bench/spikes/decoding/rounds.md`, 2026-11-23):
- **The Node CLI agent** (sharp): without `ensureAlpha()`, "a bare buffer gives silent garbage with no error. That's the one that would have bitten me." Asked for a built-in decoder, it answered no, and wanted "a runtime check against the silent-garbage cases" instead.
- **The edge agent** (jpeg-js): avoided it only "because the README warns".

Neither agent actually hit it. The CLI agent's glue had `.ensureAlpha()` from the README snippet, so its "would have bitten me" is hypothetical. The docs reached both agents.

The case rests on what the trap does when it is sprung. The decoding brief measured it as the commonest silent wrong output in that round: sharp's plain `.raw()` (what sharp's own README leads with) passed bare gave a worse palette, with no error, on 11 of 13 test files (`bench/spikes/decoding/results-node.txt`).

## The symptom

"The palette is garbage / the colours are wrong / grey comes out as colours", from `sharp(file).raw().toBuffer()` or another decoder that returns 3 bytes per pixel. There is no error whenever the byte count divides by 4, which is any image whose pixel count does: 768×512 does, as does every even-by-even size.

## The best recipe

What users can do today, with no new API:
- **Pass the format:** `{ data, format: 'rgb' }`, or add the alpha byte (sharp's `.ensureAlpha()`). README, `docs/api.md` Input and the guides' decoding section all warn about this.
- **Pass `width` and `height` together:** then RGB read as RGBA fails the pixel-count check (`width × height` doesn't match). `width` alone doesn't catch it: 768×512 RGB read as RGBA is 384 whole rows.

Both work only for a user who already knows about the trap, and the trap is that nothing tells them. A user could also copy a detector (the 30 lines in `check.mjs`) into their own code, but nobody copies a check for a mistake they don't know they're making. So the recipe is the docs warning we already ship. In the round it worked: the docs reached both agents. Its limit is the user who reads sharp's README instead of ours.

## What a built-in adds over it

A check on bare `Uint8Array`s only (the file-header check's scope: `{ data, format }` and `ImageData` are never inspected). It samples 512 windows of 96 bytes, so the cost doesn't depend on image size. On each sample it applies two tests:

- **Smoothness, for colour images.** Each byte is compared with the byte 3 places back and the byte 4 places back. Real RGBA changes least at a 4-byte step and RGB at a 3-byte step, so the score is the mean change at 4 divided by the mean change at 3. A score above 1.25 means RGB, unless most changing pixels have four equal bytes (`(a, a, a, a)`: a premultiplied white mask, the one real RGBA layout that scores high).
- **Equal triples, for grey images.** Grey RGB is too smooth for the first test (its score is about 1.16), but it has an exact signature: where the image changes, its bytes come in equal triples at a 3-byte step and not at a 4-byte step.
- **A size floor.** Arrays under 192 bytes (48 RGBA pixels) aren't checked.

The test images:
- **Real RGBA (should never be flagged):** 2,103 of them:
  - 809 Twemoji and Noto emoji, straight and premultiplied, whose anti-aliased edges and soft shadows are the likeliest real false positives;
  - the 24 Kodak photos opaque, and with feathered cutouts, alpha ramps, alpha equal to brightness, constant 128 and noise, straight and premultiplied;
  - grey, white masks, Floyd–Steinberg and ordered dithering, pixel art with sprite alpha;
  - crops from 2×2 to 64×64, and the synthetic set.
- **RGB passed bare (should be flagged):** the same images as 3-channel RGB, grey RGB, emoji on white and on black, dithered, pixel art and crops.

Results:

<!-- bench/spikes/bare-rgb/measure.mjs → results.txt -->
| | Result |
|---|---|
| False positives on real RGBA | **0 of 2,103**, at every threshold from 1.1 to 3. The highest score of any RGBA image the rule can flag is 0.94 (alpha = brightness); dithered and pixel art are at most 0.23 |
| Harmful RGB caught (palette ≥ 1.1× worse) | **1,833 of 1,884**. At 64×64 and above, 1,762 of 1,764: the two misses are ordered-dithered photos scoring 1.20 and just under 1.25. The other misses are 2×2 and 4×4 crops (under the floor) and a few 8×8 |
| Damage when missed today (mapping error with the misread palette ÷ with the right one, k = 16) | Kodak colour 1.75–3.48× (median 2.19), Kodak grey 1.10–3.40× (median 1.68), emoji median 5–26× (`results.txt`, "harm") |
| The decoding round's own case (`results-evidence.txt`) | sharp's plain `.raw()` on its 15 files: two are RGBA. The check flags **12 of the 13 RGB buffers**, grey.png included (sharp gives grey PNGs 3 channels). It misses onebit.png, which is harmless: misread, it still gives a black-and-white palette, with a mapping error of 0 |
| Cost | 0.32 ms per call at any size (768×512 and 12 MP alike). That is 4% of `quantizeWithPalette` on a 768×512 photo (8.5 ms, the fastest call that takes an image) and 0.2% of `buildPalette` (195 ms) |
| Sampling | the lean check (512 windows) and the rule on 2,048 windows disagree on 1 of 4,038 images, an RGB one near the threshold. At five thresholds from 1.1 to 3, the rule decides differently on 2,048 windows than on the whole array for 9 images, and than on 512 windows for 25 |

Not covered: 1- and 2-channel grey (fast-png's grey PNGs). No measured rule covers them. The score that catches them also reaches 1.41 on real RGBA (alpha = brightness), and their only reported case, fast-png's bit-packed rows, can't be repaired by a byte-level test anyway. They're left for a later brief, 2-channel first since its harm is far the largest (274–1,980×).

**What a 3.x warning would cost** (the 4.0 throw costs only the check, its tests and docs):
- **The library's first warning.** Every failure so far reaches callers as an error, and the glue's `print` and `printErr` are silenced. A warning can't be caught the way an error can, and users who only meet the library through a dependency will see it and can't fix it. That is partly the point, since the dependency has the bug.
- **A rule to keep warnings from spreading,** settled in PRINCIPLES and promised in stability.md, which doesn't mention warnings today:
  - warn only for a likely mistake that the next major release will make an error;
  - once per code, per copy of the library;
  - through `process.emitWarning` where it exists, so Node users get `--no-warnings`, `process.on('warning')` and `--trace-warnings` (which shows the call site in a dependency) with no new API, and `console.warn` elsewhere;
  - silenced by being explicit (`{ data, format }`), with no global switch to add and later remove;
  - each warning named with a kebab-case code (`rgb-as-rgba`), documented in a "Warnings" section of `docs/api.md`, not added to `errorCodes`.
- **Module-level state** (whether it has warned), where the main entry keeps none today.
- **Undoing a deliberate choice.** 3.0 silenced the glue's console output on purpose ("the error is the report", CHANGELOG), and test setups that fail on console output would see a change.
- **About 40 lines of JS** in `src/index.js`, next to the file-header check, plus tests for both readings on Kodak and emoji.
- **The worker entry:** the check lives in `shared.js`, and `worker.js` runs it on the calling thread before `own`/`take`, since a `transfer: true` call detaches the buffer. The thread must not warn a second time, and a Node worker's `emitWarning` wouldn't reach the caller's `process.on('warning')` anyway. The thread still gives the encoded-file error itself.
- **A promise kept for the major line.** Changing the thresholds later changes who sees the warning, not any result.

**4.0:** the same check throws `invalid-argument` on `'image'` ("Invalid image: these bytes look like RGB (3 per pixel), not RGBA …", leading with both fixes), with the same escape hatch. It runs after the encoded-file check and the multiple-of-4 check, so a call never gets both. Like that check, it doesn't reopen "A bare `Uint8Array` is RGBA": a bare array is still never read as RGB, and bytes very unlikely to be RGBA are refused. If 4.0 wants a margin for a throw, 1.5 still gives 0 false positives and catches 1,737 of 1,764 at 64×64 and above.

## Recommendation

**Build the check.** Both stewards agree it is in scope (`scope-steward`: trim; `api-steward`: concerns, all about delivery):
- 0 false positives in 2,103 RGBA images;
- every harmful case at 64×64 and above caught except two;
- 12 of 12 harmful cases in the decoding round caught;
- 0.32 ms a call.

The open question is 3.x, for the maintainer:
- **(a) A 4.0 throw only** (`scope-steward`'s trim). 3.x keeps the docs warning, and nothing about warnings is added to the design. The warning comes back for consideration if a person reports hitting the trap.
- **(b) A warning in 3.x as well,** delivered as above. 3.x users who copy sharp's README get told now rather than at 4.0, at the cost of the library's first warning channel and the rule that limits it.

I lean to (b). Whatever silent wrong output 3.x gives keeps happening until 4.0 ships, and `emitWarning` answers most of the costs. But the case is weaker than the first draft said: no one has hit the trap in testing who had read our docs.

Either way the ROADMAP's 4.0 section gets the throw, and 1- and 2-channel grey get an entry under "Larger, later". The maintainer decides.
