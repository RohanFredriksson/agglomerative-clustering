# Spike: dithering in linear light (3.5, not built)

Whether to add a built-in option that dithers in linear light (ROADMAP "Later, if asked for"; spec in `docs/superpowers/specs/2026-11-22-linear-light-design.md`, marked not built). It ended as a recipe: `ditherInLight` in docs/api.md, "Dithering to a few inks: mix in light".

Score: mean CIEDE2000 between the original and the result after both are blurred (σ 1.5) in linear light, which is what a panel or a 1:1 view shows; and mean luminance against the original's. 24 Kodak photos (`fixtures/kodak.js`) and a dark ramp; palettes: the seven e-ink inks, black and white, 16 colours cut from each photo.

| File | What it measures | Results |
|---|---|---|
| `measure-round1.mjs` | Six photos: error in linear light matched in linear RGB, OKLab, OKLab's LMS stage, a first opponent space; Atkinson variants | `results-round1.txt` |
| `measure.mjs` (functions also in `linear-lib.mjs`) | 24 photos, three methods, six linear matching metrics, against today's output and the old 8-bit recipe | `results.txt` (`summarise.mjs`) |
| `sweep.mjs` | The colour-axis weight of linear YCbCr, ×1 to ×6 | `results-sweep.txt`, `sweep-*.json` |
| `encoded-recipe.mjs` | The same matching done outside the library, through the real package | `results-encoded-recipe.txt` |
| `recipe.mjs` | `ditherInLight` exactly as docs/api.md prints it: quality, brightness and timing against dithering the sRGB values | `results-recipe.txt` |
| `pictures.mjs` | Crops side by side, at 2× (writes PNGs to the temp directory) | |

What it found:
- **Precision doesn't matter; the matching does.** Error carried in linear light at full float precision equals the 8-bit recipe (e-ink Floyd–Steinberg 5.26 against 5.25). Matching in linear YCbCr with the colour axes ×2 (brightness first) gives 4.4 (built-in, float), ordered 6.0 against 8.9, and keeps greys free of coloured inks. The weight has a plateau from 1.5 to 3.
- **OKLab can't carry the error** (light adds up only in a linear space): matching in OKLab or its LMS stage with linear error was worse than not converting. The S-CIELAB opponent space was bad too. Atkinson in light crushes shadows under every metric.
- **A recipe gets it all for few-ink palettes**: encoding the weighted coordinates into the three bytes makes the library's RGB matching and error carrying act in them (the recipe: e-ink 4.3 and 6.2, black and white 12.2 and 12.3). Only palettes cut from the image gain from a built-in (2.26 against the recipe's 2.69 and today's 2.47), so it wasn't built.
