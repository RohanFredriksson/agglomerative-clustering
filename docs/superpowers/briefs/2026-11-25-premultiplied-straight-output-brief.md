# Value brief: straight output from a premultiplied input

Date: 2026-11-25. For the open item in the 4.0 part 1 spec (`docs/superpowers/specs/2026-11-25-4-0-premultiplied-and-image-types-design.md`, "Open: straight output").

## Who asked

The maintainer, 2026-11-25, after the spec review: "i want to explore straight output from pre multiplied input and what the value of that is, i have not made a decision on that yet". It came from `user-advocate`'s review of the spec: "there is no way to ask for straight output from a premultiplied input. Someone reading node-canvas raw data and writing PNG or WebP through fast-png or UPNG, which expect straight, must un-premultiply the output again in JS, which is the recipe back." No outside user has asked; premultiplied input itself is not shipped yet.

## The symptom

The source is premultiplied but the destination is straight, so 4.0's premultiplied-out output is wrong for it: "the PNG I wrote has dark, muddy edges", "putImageData shows the quantized image too dark where it's see-through". Sources: node-canvas `toBuffer('raw')`, `@napi-rs/canvas` `data()`, WebGL `readPixels`, WebCodecs frames from a canvas, Electron `toBitmap()`. Straight destinations: `ImageData`/`putImageData` (browser and node-canvas), the JavaScript PNG encoders (fast-png, UPNG, pngjs), `sharp` with its default `raw` input, saving an `ImageData` through a canvas. (Electron's `createFromBitmap`, Cairo and WIC take premultiplied, which is 4.0's default.)

## The best recipe

Measured through `dist/` (3.8.0) on a 12 MP translucent image (kodim23 tiled, every alpha value), k = 16, the 4.0 behaviour reproduced exactly with the spec's formulas<!-- bench/spikes/premultiplied-straight/recipes.mjs → results.txt -->.

| Recipe | Exact? | Extra JS on the calling thread | Lines |
|---|---|---|---|
| R1: un-premultiply the input in JS, then call as for straight input (the 3.x docs' loop) | yes (it is the answer) | 204 ms | ~8 |
| R2: take 4.0's premultiplied output and un-premultiply it in JS | **no** | 164 ms | ~8 |
| R3: `quantizeToIndices` on the premultiplied input (straight palette), then write `palette[index]` with the input's alpha | yes, 0 pixels differ from R1, dithered or not | 55 ms | ~10 |

`quantize` itself took 7.6 s undithered and 8.1 s dithered on this image, so R3's loop is under 1% and R1's under 3%. R3 also holds the indices (12 MB) and its output (48 MB) in the caller's memory; writing straight into an `ImageData` saves a copy. With the worker entry R1's and R3's loops both run on the calling thread, where the result arrives (55 ms is about three frames, once per call; clustering and mapping stay off it).

**The trap is R2**, the one a user would write first, because it reads as "undo what the library did". Rounding twice loses the colour where alpha is small: every pixel below alpha 16 is off (by up to 120 per channel), 99% of pixels at alpha 16-63 (up to 8), and 67% at alpha 64-254 (up to 2); the output has 1,171 distinct colours where the answer has at most 16, so a "16-colour" image isn't one. R1 works but throws away what 4.0's flag is for (it is the 3.x recipe, on the calling thread even with the worker entry). R3 is exact and cheapest, with traps a test can pin: indexed output must be known to be straight; the loop must take alpha from the input (the palette is RGB, so taking it from there makes everything opaque); `transparent` must not be passed (its extra entry reads past the palette, `undefined`, written as 0); BGRA needs a channel swap (visibly wrong if missed); an `ImageData` needs a `Uint8ClampedArray`.

```js
// R3: straight RGBA from a premultiplied source, exactly what quantize would give for straight input.
const { indices, palette } = await quantizeToIndices({ data, format: 'rgba', width, height, premultiplied: true }, 16);
const out = new Uint8ClampedArray(data.length);
for (let i = 0, o = 0; i < indices.length; i++, o += 4) {
  const s = indices[i] * 3;
  out[o] = palette[s]; out[o + 1] = palette[s + 1]; out[o + 2] = palette[s + 2]; out[o + 3] = data[o + 3];
}
// For 'bgra', swap out[o] and out[o + 2] (the palette is RGB).
```

## What a built-in adds over it

- **Quality:** none over R3, which is exact. Over R2 (the likely first attempt): k colours instead of about 1,200, and correct low-alpha colours.
- **Speed:** R3's 55 ms loop moves into the WebAssembly output step (the output pass is skipped instead of run), and off the calling thread with the worker entry. Small next to mapping.
- **Convenience and traps:** one option instead of knowing that indexed output is straight and writing the loop (and the BGRA swap); removes the R2 trap for everyone who would try it.

What it costs:
- A mapping option kept for 4.x on `quantize`, `quantizeWithPalette`, the methods and both handle kinds, with its type: the result's `premultiplied` would no longer be "copied from the input" but "what the output is", so `ImageResult` needs a second case.
- A naming problem: the convention allows no prefixed sibling options (`premultipliedOutput`), and `premultiplied` already describes the input. Candidates: an object form on the image key (`premultiplied: { output: false }`?) or a mapping option (`output: 'straight'`); a cold read would be needed.
- One more rule to document, and tests (golden keys, types, worker).
- It is additive: 4.0 can ship without it and a 4.x minor can add it, so waiting costs nothing but the R3 recipe in the docs meanwhile.

## Recommendation

**Decided 2026-11-25 by the maintainer: recipe** (option A), with the built-in under ROADMAP "Later, if asked for".

**Reviewed (2026-11-25):** `scope-steward` recipe (test 1 fails against an exact ten-line R3, test 6 has no clean shape yet; 4.0 already turned down a second way to say premultiplied, `'bgra-premultiplied'`); `user-advocate` recipe, with the R2 warning in the option's own docs entry and doc comment as well as the guide, and two reopening triggers. If it is ever built, `user-advocate` prefers the object form on the image key (`premultiplied: { output: false }`, input and output in one place), after a cold read.

**Recipe now, built-in later if asked for:** document R3 next to the premultiplied option in 4.0 ("for a straight destination, map to indices and write the palette colours"), with a warning against R2 and the measured reason, test it in `test/recipes.test.js`, and record the built-in under ROADMAP "Later, if asked for", reopened by any report or exploratory-round run that writes R2 (the 4.0 beta round can include the task "write a 16-colour PNG from node-canvas raw data"), or a worker-entry user who reports the calling-thread loop as a problem. The warning goes in the `premultiplied` entry in `docs/api.md` and its doc comment too, where these users already are. R3 is exact, ten lines and under 1% of the call; the built-in's real gain is removing the R2 trap, which the docs can also do, and its shape needs a naming decision the evidence doesn't yet justify. The maintainer decides.
