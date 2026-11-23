# Design: warn on grey bytes passed bare (3.6.0)

Value brief: `docs/superpowers/briefs/2026-11-23-bare-grey-brief.md`. The maintainer chose option 1, "build": the message fix, both grey rules with the RGB check first, and the guides recipe. Measurements and the candidate check are in `bench/spikes/bare-grey/`:
- `check.mjs`;
- `results-rules.txt`, `results-cost.txt`, `results-packed.txt`, `results-palette.txt`, `results-recipe.txt`.

It follows the 3.5.0 design (`2026-11-23-bare-rgb-warning-design.md`) and PRINCIPLES "Warnings only bridge to an error in the next major". This spec covers only what differs from 3.5.0. It was revised after review by the three stewards and a cold-read user (see "Review" at the end).

## Intent

fast-png returns grey PNGs as 1 byte per pixel, grey + alpha PNGs as 2, and 1-, 2- and 4-bit grey still packed. A bare `Uint8Array` is read as RGBA, so these bytes are misread with no error whenever their length divides by 4. The palette then maps 274–1,980× worse on opaque grey + alpha photos and 1.4–5× worse on grey photos. And today's `rgb-as-rgba` warning fires on 611 of 1,029 harmful grey arrays, with advice (`format: 'rgb'`) that is wrong for them.

**Goals**
- Flag bare grey and grey + alpha bytes in every function that takes an image, in both entries, exactly as `rgb-as-rgba` is flagged: on the caller's side, once per code, and only after the call's own checks pass.
- Stop `rgb-as-rgba` giving wrong advice to grey input.
- Give the warning a fix to point to: a guides recipe that turns any fast-png result the library can take into an image, and refuses the rest.
- Change no result, error or type. The cost is at most about 0.1 ms per call more than 3.5.0 (both checks take 0.32 ms against 0.24 ms, `results-cost.txt`), and nothing once both codes have warned.

**Non-goals**
- A grey format (ROADMAP "Later, if asked for", per the brief).
- Repairing bit-packed, palette or 16-bit input. The check may flag packed rows or palette indices; for those, the fix it names is a decoder that expands them.
- Anything for `ImageData` or `{ data, format }` input.

**Anti-goals**, failures even if it works:
- A false positive on real RGBA. The brief measured 0 of 2,984 for both checks, and any change to the rules must be measured again in `bench/spikes/bare-grey/`.
- Calling RGB input grey. With the RGB check first, 1 of 1,810 RGB arrays was called grey; the shipped rule must do no worse.
- A recipe that quietly accepts palette indices as grey. fast-png gives an 8-bit palette PNG as `channels: 1, depth: 8` plus a `palette` (`results-palette.txt`), which looks exactly like grey.

## Approaches

Decided in the brief, with `scope-steward`'s trim:
- **The RGB check first, and the grey rules only when it passes. Chosen.** The three-step classifier was rejected: it calls 34 of 1,690 RGB images grey.
- **The 611 grey arrays that the RGB check catches keep `rgb-as-rgba`**, and its message gains the grey case.

Decided in review:
- **One code, `gray-as-rgba`, for 1 and 2 channels. Chosen**, with the layout named in the message. All three stewards favoured one code.
  - The fix is the same for both layouts.
  - 4.0 turns both into the same `invalid-argument` error, so a second code buys nothing there.
  - It is one docs row and one name fewer.
- **Two codes. Rejected,** because the 4.0 errors share one code anyway.
- **Spelling: `gray` in identifiers, "grey" in prose (`api-steward`). Confirmed by the maintainer on 2026-11-23,** together with one code, the amended silencing promise and release as 3.6.0.
  - Identifiers already use American spelling (`colorSpace`, `colorSpaces`) and prose British ("colour").
  - Users compare the code in their own code (`w.code === 'gray-as-rgba'`).
  - The code fixes the spelling of a later grey format in advance (`<format>-as-rgba`). The web platform, ffmpeg and skia spell it `gray`.
  - It is recorded as a settled decision, so the future format becomes `format: 'gray'` / `'gray-alpha'`.

## The design

### The check (`src/shared.js`)

`looksLikeGrey(bytes)` returns `'grey'`, `'grey-alpha'` or `null`. It is the rule in `bench/spikes/bare-grey/check.mjs`, computed over the RGB check's windows: 512 windows of 96 bytes, each starting on a multiple of 12, or the whole array up to 48 KB.
- **The sums:** E(k) = mean |d[i] − d[i−k]| + 0.05, for k = 1, 2 and 4. The quad share is the share of changing 4-byte pixels whose four bytes are equal.
- **`'grey-alpha'`** when E4/E2 > 1.1 and E2/E1 < 0.5.
- **Otherwise `'grey'`** when E4/E1 > 1.5 and the quad share is under 0.5. 1.5 is the 4.0 error threshold as well; the highest real RGBA scored 1.12.
- **The size floor and the byte-ramp test apply as for RGB:** under 192 bytes, or bytes that mostly rise by one fixed step, never flag. A ramp scores E4/E1 = 4, so it would otherwise be called grey.

The builder may fold these sums into `looksLikeRgb`'s pass; that is what `results-cost.txt` timed as "both in one pass". The decisions must stay exactly as above, with the RGB rule deciding first.

### The gate (`src/shared.js`) and its callers

`bareRgbWarning` becomes `bareImageWarning(image)` (internal; the name is the builder's). It returns `{ code, layout }` or `null`:
1. It makes the same skips as today: not a bare `Uint8Array`, a `Palette` or `Clustering`, a recognised file, a length that isn't a multiple of 4.
2. It returns `null` at once only when **every** code has warned, or the copy is silenced.
3. It classifies: `looksLikeRgb` first, then `looksLikeGrey`.
4. It returns the result only if that code hasn't warned yet. An array the RGB rule flags never falls through to the grey rules because `rgb-as-rgba` was used.

After `rgb-as-rgba` has warned, calls keep sampling (about 0.32 ms) until `gray-as-rgba` has warned too. The three call sites (`src/index.js` 340–341, `src/worker.js` 546–551 and 591–607) carry the result and call `warnOnce(code, byteLength, layout)`.

### Messages (`src/shared.js`)

They keep the form "This image (N bytes) looks like … From 4.0 this is an error. Shown once." They carry no URLs, as today.

> **rgb-as-rgba:** This image (1,179,648 bytes) looks like RGB bytes (3 per pixel), or grey, passed as a bare Uint8Array, which is read as RGBA (4 per pixel) and would give wrong colours. If it is RGB, pass { data, format: 'rgb' } (sharp's .raw() gives RGB for an image without alpha unless you add .ensureAlpha()). If it is grey (fast-png's decode() of a grey PNG), expand it to RGBA; format: 'rgb' would misread it too. If it really is RGBA, pass { data, format: 'rgba' } to say so. From 4.0 this is an error. Shown once.

> **gray-as-rgba, 1 channel:** This image (393,216 bytes) looks like grey bytes (1 per pixel) passed as a bare Uint8Array, which is read as RGBA (4 per pixel) and would give wrong colours. fast-png's decode() gives this for a grey PNG, and for a palette PNG's indices, with rows below 8 bits still packed. Expand 8-bit grey to RGBA, or decode with something that gives RGBA (pngjs, or sharp with .ensureAlpha()). There is no grey format to pass. If it really is RGBA, pass { data, format: 'rgba' } to say so. From 4.0 this is an error. Shown once.

> **gray-as-rgba, 2 channels:** This image (786,432 bytes) looks like grey and alpha bytes (2 per pixel) passed as a bare Uint8Array, which is read as RGBA (4 per pixel) and would give wrong colours. fast-png's decode() gives this for a grey PNG with alpha. Expand it to RGBA, or decode with something that gives RGBA (pngjs, or sharp with .ensureAlpha()). There is no grey format to pass. If it really is RGBA, pass { data, format: 'rgba' } to say so. From 4.0 this is an error. Shown once.

### Where it runs

As for `rgb-as-rgba`: the main entry, the worker entry on the caller's side, and the worker thread silenced. `silenceWarnings` covers every code through `Object.keys(warningText)`.

### Docs (proposed text)

**`docs/api.md` "Warnings":**
- "There is one:" becomes "They are:".
- Add "Their text may change; match on `code`."
- The `rgb-as-rgba` row:
  - **When:** "A bare `Uint8Array` whose bytes look like RGB (3 per pixel), or grey (1 per pixel), which is read as RGBA (4 per pixel) and gives wrong colours. sharp's plain `.raw()` gives RGB."
  - **What to do** gains: "If it is grey, convert it to RGBA as for `gray-as-rgba`; `format: 'rgb'` would misread it too."
- A new row:

| `code` | When | What to do |
| --- | --- | --- |
| `gray-as-rgba` | A bare `Uint8Array` whose bytes look like grey: 1 byte per pixel, or 2 with alpha. fast-png's `decode()` gives these for grey PNGs (and 1 byte of palette index per pixel for palette PNGs), keeping rows below 8 bits packed. Read as RGBA, 1-byte grey packs four pixels into one, with every fourth byte as alpha; grey and alpha bytes become tinted pixels with the wrong alpha. | With fast-png, use [`fastPngToImage`](guides.md#decoding-image-files), which expands 8-bit grey and refuses what it can't expand; or decode with something that gives RGBA (pngjs, or sharp with `.ensureAlpha()`), which also covers palette, packed and 16-bit files. There is no grey format. If it really is RGBA, pass `{ data, format: 'rgba' }`. From 4.0 this is an `invalid-argument` error. |

- **The paragraph under the table** says the checks were tested on 2,984 real RGBA images and warned on none (it said 2,103). It adds what the grey check misses: grey photos dithered to a few levels, and grey whose changing pixels mostly come in runs of four equal bytes. "Saying what the bytes are silences it" gains "(for grey, which has no format, converting it does)".
- **`docs/api.md` Input**, the bullet about grey: the prose "gray" becomes "grey" (skia's `'gray8'` stays), and it gains "the library [warns](#warnings) when it sees grey bytes passed bare".

**`docs/guides.md`:** after the "Decoders that return the file's own layout" bullet, a short paragraph, not a block inside the bullet:

> To keep fast-png, turn its result into an image the library takes, and refuse what that can't cover:
> ```js
> function fastPngToImage({ data, width, height, channels, depth, palette }) {
>   if (palette || depth !== 8) throw new Error('needs a decoder that expands palette, 16-bit and packed PNGs (pngjs)');
>   if (channels === 4) return { data, format: 'rgba', width, height };
>   if (channels === 3) return { data, format: 'rgb', width, height };
>   const out = new Uint8Array(width * height * 4);
>   for (let p = 0; p < width * height; p++) {
>     out[4 * p] = out[4 * p + 1] = out[4 * p + 2] = data[p * channels];
>     out[4 * p + 3] = channels === 2 ? data[p * 2 + 1] : 255;
>   }
>   return { data: out, format: 'rgba', width, height };
> }
> ```
> Expanding grey takes about 45–50 ms at 12 megapixels. The library [warns](api.md#warnings) about grey or RGB bytes passed bare.

The 46 ms figure carries an HTML comment naming `bench/spikes/bare-grey/results-recipe.txt`, which is re-measured on this function.

**README:** no change.

**`docs/stability.md:10`:** "is silenced by saying what the input is (`{ data, format }`)" gains "or, for a layout the library doesn't take (grey), by converting it to one it does".

**PRINCIPLES:**
- "A bare `Uint8Array` is RGBA":
  - "bytes that look like RGB" becomes "bytes that look like RGB or grey";
  - "A bare array is never read as RGB" becomes "never read as RGB or grey".
- "Warnings … What it never does": the same clause as stability.md.
- "The first is `rgb-as-rgba` (3.5.0)" gains "the second `gray-as-rgba` (3.6.0)".
- "Deferred to 4.0": "the `rgb-as-rgba` warning becoming an `invalid-argument` error" becomes "the bare-image warnings (`rgb-as-rgba`, `gray-as-rgba`) becoming `invalid-argument` errors".
- "Settled decisions" gains "**Identifiers spell gray and color; prose spells grey and colour.**" It is decided by the maintainer with this spec, and it binds a later grey format to `'gray'` / `'gray-alpha'`.

**ROADMAP:**
- **Next, item 9 "(released as 3.6.0)"** spells out the brief:
  - no person asked; the one case is the decoding round's edge agent;
  - the two rules;
  - 0 of 2,984 false positives;
  - 929 of 931 grey + alpha and 802 of 911 grey caught at 64×64 and above;
  - packed rows flagged on 17, 19 and 17 of 24 photos;
  - the misses;
  - the 611 RGB-flagged grey arrays and the corrected message;
  - "RGB check first" chosen over the classifier (34 of 1,690);
  - each figure cited to its `bench/spikes/bare-grey/` file.
- The "Larger, later" bullet is deleted. Its outdated "1.41" and "no byte-level test" claims go with it.
- Line 45: "All nine are done (3, 6 and 7 as recipes)". Line 86: "items 8 and 9 have no quality comparison".
- **The 4.0 entry becomes "The bare-image warnings become errors"**, for both codes:
  - `invalid-argument` on `'image'`, rejecting exactly what 3.x warns about or more, never fewer;
  - the `rgb-as-rgba` error message gains the grey case;
  - the grey error message names the layout it saw and the conversion, not a format ("Invalid image: these bytes look like grey (1 per pixel), not RGBA. …");
  - re-measuring uses `bench/spikes/bare-rgb/` and `bench/spikes/bare-grey/`;
  - the RGB rule still decides first, since per-call errors make the same order matter;
  - both codes leave api.md "Warnings".
- **"Later, if asked for"** gets "`format: 'gray'` / `'gray-alpha'`", with the brief's reasons and its reopen triggers:
  - a user with grey input asks;
  - the recipe's cost shows up in a report;
  - grey can be silenced only by converting.

**CHANGELOG, "Unreleased (3.6.0)":**
- one new warning, `gray-as-rgba`, with the false-alarm figure (comment naming the spike);
- the corrected `rgb-as-rgba` text;
- the guides recipe;
- 3.5.0's notices again: from 4.0 it is an error, how to silence it, and that tools which parse stderr or fail on `console.warn` will see it;
- output is unchanged.

### Tests

- **`test/bare-grey-check.test.js`, a fixed set:**
  - Kodak grey as 1 channel → `'grey'`;
  - Kodak grey + alpha (alpha 255, and a feathered cutout) → `'grey-alpha'`;
  - an emoji as grey + alpha → `'grey-alpha'`;
  - one fast-png 1-bit packed Kodak photo known to be caught (made in the test), named as such. 7 of 24 aren't caught, so a later tuning may change others;
  - real RGBA near the rules → `null`: grey with alpha = grey, a premultiplied white mask, Kodak alpha = luma, an emoji;
  - byte ramps and arrays under 192 bytes → `null`;
  - Kodak RGB → `rgb-as-rgba`, never grey.
- **`test/warnings.test.js`:**
  - `gray-as-rgba` warns once, with the layout in the message;
  - none on a rejected call, none from the worker thread, nothing for `{ data, format }`;
  - after `rgb-as-rgba` has warned, an RGB array gives no `gray-as-rgba`;
  - the two codes warn independently;
  - the `rgb-as-rgba` text mentions grey.
- **`test/recipes.test.js`:**
  - `fastPngToImage` matches the guides' text;
  - on fast-png-decoded RGB, RGBA, grey and grey + alpha PNGs, its result gives the same palette as the image passed correctly;
  - it throws for a palette PNG, a 16-bit PNG and a 1-bit PNG.
- **One measurement before merge, not a maintained test:** the spike rerun against the shipped function (imported from `dist/shared.mjs`), written to a results file in `bench/spikes/bare-grey/`. It must show 0 of 2,984 false positives and the brief's catch counts.
- **The test-suite guard** (`test/setup.js`) already fails any test that warns.

### Left to the builder

- How the grey sums share the RGB pass.
- The gate's internal name and the shape it returns.
- Exact wording within the facts above.

### Release

3.6.0, a minor release:
- stability.md allows a minor release to add a warning;
- the RGB rule is unchanged and first, but its windows are staggered (see "Changed during implementation"): on 7,051 test arrays it decided 20 differently from 3.5.0, all RGB arrays that 3.5.0 missed, and none that 3.5.0 warned about goes quiet (`results-rgb-changes.txt`);
- the text of a warning is not a promise (now said in api.md "Warnings").

No type changes.

## Changed during implementation

- **Staggered sampling windows,** a deviation from "The check" above. Evenly spaced windows were one row apart at 768×512 RGBA, so they saw only the left edge: 3.5.0 caught 6 of 24 RGB cutouts on black, and a grey + alpha cutout with zeroed transparency went unflagged. Each window now starts at a fixed pseudo-random multiple of 12 in its slot. It was re-measured as stability.md requires: 0 of 2,984 false positives, and the RGB decisions changed only from silent to warning (`results-shipped.txt`, `results-margins.txt`, `results-rgb-changes.txt`). The check now costs about 0.35 ms.
- **The packed and palette counts** were re-measured with the shipped check: packed rows 17, 18 and 17 of 24 (it was 17, 19 and 17 with the spike's windows).
- **The 1-channel message** says "a grey PNG (rows below 8 bits stay packed)", so it doesn't read as if every grey PNG were packed (`api-steward`, final review).

## Review

The three stewards and a cold-read user reviewed the first draft. Every finding is taken unless a rebuttal says otherwise.
- **`roadmap-steward`, concerns:**
  - [conflict] Grey can't be silenced by saying what the input is, as stability.md and PRINCIPLES promise. Resolved by amending both, and api.md, to "or, for a layout the library doesn't take, by converting it".
  - The 4.0 entry, PRINCIPLES "Deferred to 4.0", the item-9 text and the ROADMAP's counts were incomplete. All are spelled out above.
  - One spelling for the code and any later format. Taken, see `api-steward`.
- **`api-steward`, concerns:**
  - `gray` in identifiers. Taken, and confirmed by the maintainer.
  - The call sites do change. Fixed: the gate returns `{ code, layout }`.
  - The messages put the fix before the cause, and the 2-channel text kept a packed-rows clause that can't apply to it. Rewritten.
  - The `rgb-as-rgba` text should say "or grey" up front. Done.
  - "They are:" instead of a count, and "match on `code`". Done.
- **`scope-steward`, in scope:**
  - The recipe should return the guides' image shape and stand outside the bullet. Done.
  - The corpus rerun is a one-off measurement. Done.
  - The packed-row test names a known-caught image. Done.
- **Cold-read user:**
  - It read `grey-as-rgba` correctly from the name alone.
  - It found the real trap: fast-png's 8-bit palette PNGs come as `channels: 1, depth: 8` with a `palette`, so the first recipe would have turned indices into grey with no error. Checked in `results-palette.txt`: the warning itself fires on only 2–6 of 24 palette images. The recipe now refuses `palette`, and the message and row mention palette indices.
  - It asked for one function covering all of fast-png's results, rather than three pieces to put together. Done: `fastPngToImage`.
  - It asked for "there is no grey format" in the message. Done.
  - Its note on the log prefix came from my test prompt, which wrongly showed a Node-style prefix for a Worker. The docs are right: Workers get `console.warn`.
