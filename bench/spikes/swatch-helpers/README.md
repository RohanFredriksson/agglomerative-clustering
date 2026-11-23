# Spike: swatch helpers (ROADMAP "Larger, later")

Measures the best recipe for a dominant colour, heaviest-first order, swatch objects and hex strings, through `dist/index.mjs`. Write-up: `docs/superpowers/briefs/2026-11-23-swatch-helpers-brief.md`.

| File | What it is |
|---|---|
| `measure.mjs` | The `rankSwatches` recipe, checked on 24 Kodak photos at k = 2…256; how far the heaviest swatch moves with k; the heaviest at k = 5 against MMCQ's (color-thief's) first colour. Output: `results.txt`. |
| `indexed.mjs` | Indexed output, heaviest first. It compares three recipes: the guides' renumbering as written, the same renumbering with indexed loops, and mapping to a ranked `Palette`. All are timed against `quantizeToIndices` and checked for identical colours. It also times ranking 256 swatches. Output: `results-indexed.txt`. |

Run from the repository root after `npm run build`; the Kodak photos download on first run.
