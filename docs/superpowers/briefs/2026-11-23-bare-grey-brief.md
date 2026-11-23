# Value brief: 1- and 2-channel grey passed bare

ROADMAP "Larger, later": "1- and 2-channel grey passed bare." The 3.5.0 `rgb-as-rgba` check covers 3-channel RGB only. Measurements are in `bench/spikes/bare-grey/`, through `dist/index.mjs` (3.5.0):
- `decoders.mjs` → `results-decoders.txt`: which decoders return 1 or 2 channels;
- `corpus.mjs`, `features.mjs`, `rules.mjs` → `results-rules.txt`: the rules, on the bare-RGB corpus plus grey;
- `check.mjs`: the candidate check, sampled like the shipped one;
- `cost.mjs` → `results-cost.txt`;
- `recipe.mjs` → `results-recipe.txt`;
- `packed.mjs` → `results-packed.txt`: fast-png's bit-packed grey.

## Who asked

No person or issue. The one first-hand case is the edge agent in the decoding round (`bench/spikes/decoding/rounds.md`, fast-png and jpeg-js):
- 1-, 2- and 4-bit grey PNGs stay bit-packed in fast-png, so a black-and-white image came out "#000000 98%" with no error: "the API looked fine and was wrong".
- "palette, grey+alpha and 16-bit PNGs each need their own handling".

It found the bug itself in testing, after 10 more minutes.

**Where 1- and 2-channel bytes come from** (`results-decoders.txt`, true grey PNGs written with fast-png's encoder):

| Decoder | Grey PNG | Grey + alpha PNG |
|---|---|---|
| sharp `.raw()` | 3 bytes per pixel (covered by `rgb-as-rgba`) | 4 |
| pngjs, jpeg-js (default) | 4 | 4 |
| **fast-png `decode`** | **1** (16-bit as a `Uint16Array`; 1/2/4-bit still packed) | **2** |

So the trap is fast-png's, among the decoders tested. The guides already warn about it (`docs/guides.md` "Decoders that return the file's own layout", `docs/api.md` Input). Hand-made buffers (ffmpeg `gray`/`ya8`, numpy) are other likely sources; they weren't measured.

## The symptom

"Grey PNG gives a coloured palette", "grayscale image palette wrong / mostly transparent / black". Nothing fails whenever the length divides by 4: any even pixel count for grey + alpha, and any multiple of 4 pixels for grey.
- **Grey + alpha** read as RGBA gives `(g, a, g′, a′)` pixels: green and magenta tints, alpha taken from the next pixel. The palette maps the true image 274–1,980× worse on opaque photos (median 544×), 15–79× with real transparency, and a median of 260–450× on emoji saved grey.
- **Grey** read as RGBA packs four pixels into one, with the fourth as alpha. That is 1.4–5× worse on photos, a median of 9–20× on emoji on white, and 16–132× on photos dithered to 8 grey levels.

Ratios are mapping MSE with the misread palette ÷ with the right one, k = 16 (`results-rules.txt`, "harm").

## The best recipe

What users can do today, with no new API:
- **Use a decoder that expands** (sharp with `.ensureAlpha()`, pngjs), as the guides say.
- **Expand fast-png's result**: `greyToRgba` in `recipe.mjs`, 10 lines. It costs 2 ms at 768×512 and 46 ms at 12 MP, against 91 ms for `buildPalette` on the same 12 MP grey image. The palette comes out all grey, as it should.
- **Pass `width` and `height`**: the pixel count then doesn't match, and the call fails.

As with RGB, all three work only for a user who knows about the trap. The guides' warning is a paragraph that a fast-png user reaching for `decode(...).data` may not read.

## What a built-in adds over it

### A check (a warning in 3.x, an error in 4.0, as for RGB)

It runs on bare `Uint8Array`s only, sampled like the shipped check (512 windows of 96 bytes). It uses E(k), the mean change between a byte and the one k places before it:
- **Grey + alpha** is smooth at a 2-byte step and rough at a 1-byte step, since grey and alpha bytes alternate. The rule: E4/E2 > 1.1 and E2/E1 < 0.5.
- **Grey** is smoothest at a 1-byte step. The rule: E4/E1 > 1.5, unless most changing pixels have four equal bytes. That `(g, g, g, g)` layout is real RGBA: grey with alpha = grey, or a premultiplied white mask.

Results (`results-rules.txt`, "the sampled check"; corpus: the bare-RGB brief's 2,103 RGBA images plus grey RGBA, 2,984 in all):

<!-- bench/spikes/bare-grey/rules.mjs → results-rules.txt; cost.mjs → results-cost.txt; packed.mjs → results-packed.txt -->
| | Result |
|---|---|
| False positives on real RGBA | **0 of 2,984**. Wide margins for grey + alpha: RGBA with E4/E2 > 1.1 has E2/E1 ≥ 1.95 (the threshold is 0.5); RGBA with E2/E1 < 0.5 has E4/E2 ≤ 0.16. For grey the margin is narrower: the highest real RGBA score is 1.12, against a threshold of 1.5 |
| Grey + alpha, harmful, caught | **929 of 931** at 64×64 and above (976 of 1,051 at all sizes). It never fires on RGB, and fires on 3 of the grey arrays |
| Grey, harmful, caught | **802 of 911** at 64×64 and above (839 of 1,029). The misses: photos dithered to 8 grey levels (E4/E1 below 1), and arrays where most changing pixels have four equal bytes (emoji on white, pixel art), which are byte for byte what real `(g, g, g, g)` RGBA looks like |
| fast-png's bit-packed grey (the round's case) | flagged as grey on 17, 19 and 17 of 24 photos at 1, 2 and 4 bits. The RGB check flags 0–1 of them |
| Cost | 0.25 ms on its own; folded into the RGB check's pass, 0.32 ms for both against 0.24 ms for the RGB check alone (768×512 and 12 MP alike) |

**A problem the 3.5.0 warning already has.** `rgb-as-rgba` fires on **611 of the 1,029** harmful grey cases. Its advice, `{ data, format: 'rgb' }`, is wrong for them: the bytes are then read as a third as many RGB pixels, still wrong, and now silently. A combined check fixes that:
- grey + alpha first;
- grey RGB next, by its equal byte triples;
- then, when both remaining rules fire, whichever step is smoother (E1 for grey, E3 for RGB).

With it, no harmful grey array is called RGB. But 34 of 1,690 RGB images at 64×64 and above (near-grey emoji, 2%) would then be called grey. These can't be told apart: E3/E1 reaches 2.97 on both. So a grey message has to say "grey, or near-grey RGB", and the 3.5.0 RGB message should mention grey.

**Found in the spike:** byte ramps (`(i * k) & 255`) are flagged as grey, as they were as RGB, so the shipped ramp exclusion has to cover this check too.

**What it costs:**
- one or two warning codes, and their 4.0 errors (the 4.0 entry for `rgb-as-rgba` then names its siblings);
- about 30 lines in `looksLikeRgb`'s pass;
- tests on the corpus and the test-suite guard;
- a "Warnings" section entry.

It adds no options and no WebAssembly. The warning convention (PRINCIPLES) already covers delivery.

### A format (`format: 'grey'` / `'grey-alpha'`)

It would save the recipe's 46 ms at 12 MP (half the clustering time on a grey image) and its 4× memory, and it would give fast-png users a direct path. Against it:
- one known decoder returns these layouts;
- no one asked;
- it adds two names to `imageFormats` for the major line, and a C++ pixel layout (read at run time, as BGRA's is);
- the check plus the recipe already avoid the wrong output.

## Recommendation

**Build the check, in the smaller form below; wait on the format.** `scope-steward`'s verdict is **trim**, and this recommendation follows it.

1. **Fix the `rgb-as-rgba` message whatever else is decided.** Today it gives grey input the wrong advice (611 of 1,029 harmful grey cases). It should say "RGB (3 bytes per pixel), or grey". This is a fix to shipped wording and needs no new rule. 4.0 then rejects grey under that code as well, which the 4.0 entry's "or more after measuring again" allows.
2. **Grey + alpha check: build.** It does the worst harm of any layout measured (hundreds of times worse), it has the cleanest signature (0 false positives, wide margins), and the RGB check never flags it.
3. **Grey check: build, but run it only after the RGB check passes.** This drops the brief's three-step classifier, which would call 34 near-grey RGB images grey. With the RGB check first, RGB gives "rgb 1761, none 48, grey 1" (`results-rules.txt`, "Order, if the RGB check runs first"). The 611 grey arrays the RGB check catches get the corrected message from point 1. The grey rule adds about 230 more, fast-png's bit-packed grey among them: the round's one real case. The threshold (1.5, against 1.12 for the highest real RGBA) has to be chosen as the 4.0 error threshold, since 4.0 rejects at least what 3.x warns about.
4. **Document `greyToRgba`** in the guides' fast-png paragraph, as the fix the warning points to. It covers 8-bit only: for 16-bit and packed rows the answer stays "use a decoder that expands", and the message must not suggest otherwise.
5. **Format: wait** (ROADMAP "Later, if asked for"). Reopen it if a user with grey input asks, or if the recipe's cost shows up in a report. Until then, a true grey array's warning can't be silenced by naming its format; the user converts it instead.

Also in the same change: the ROADMAP's "Larger, later" entry says no byte-level test can handle fast-png's bit-packed rows (it can detect them, 17–19 of 24, though not repair them), and it quotes 1.41 for real RGBA (1.12 with the equal-four-bytes exclusion). The docs must also say what the check misses: photos dithered to 8 grey levels.

Open for the spec: one warning code for both grey layouts (their fix is the same; `scope-steward` leans to one) or one each; the wording for bit-packed input.

The maintainer decides: build as above, recipe only (`greyToRgba` in the guides plus the message fix), or wait.

## Changed during implementation

- **The sampling windows were aliased with image rows.** They were evenly spaced, and for 768×512 RGBA (and grey + alpha) the spacing is exactly one row, so every window saw only the left edge. A grey + alpha cutout with its transparent pixels zeroed went unflagged, and so did RGB with a flat left margin: 3.5.0 caught 6 of 24 RGB cutouts on black (`results-margins.txt`). Each window now starts at a fixed pseudo-random multiple of 12 within its slot. Re-measured on the whole corpus with the shipped function: 0 of 2,984 false positives, RGB decided as before, 9 dithered grey arrays near the threshold decided differently, and 24 of 24 on both flat-margin cases (`results-shipped.txt`). The bare-RGB measurement rerun against it is in `results-bare-rgb-rerun.txt`. The check now costs about 0.35 ms a call (`results-cost.txt`).
- **The recipe became `fastPngToImage`,** because fast-png gives an 8-bit palette PNG as `channels: 1, depth: 8` plus a `palette`, and an expander that ignored it would turn indices into grey (`results-palette.txt`, found by the cold-read review).
- **Shipped figures** (`results-shipped.txt`, `results-packed.txt`): grey + alpha 953 of 955 at 64×64 and above (the corpus gained 24 margin cases), grey 806 of 911 warned under either code, packed rows 17, 18 and 17 of 24.
