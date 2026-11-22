# Spike: reusing ordered-dithering recipes across calls (ROADMAP "Next" item 6)

Ordered dithering builds a recipe for every distinct colour on every call. This measures what keeping recipes between calls would save on animations mapped the way docs/guides.md "Animated GIFs" does it (one palette from every 5th frame, then `quantizeToIndicesWithPalette(frame, palette, { transparent: true, dither: 'ordered' })` per frame).

| File | What it is |
|---|---|
| `persist.patch` | Prototype: the recipe table persists across calls, cleared when the distinct palette colours, steps, strength or colour space change |
| `bigger-table.patch` | Control: no persistence, recipe table with 4× the slots (capped by the image at 2× for 480×270) |
| `measure.mjs` | Times none / Floyd–Steinberg / ordered (released) / ordered (a patched build), per frame, minimum of 5 passes; checks the patched output equals the released output on every frame |
| `results.txt` | `persist.patch`, 7 clips × 2 sizes × 4 palettes |
| `results-bigger-table.txt` | `bigger-table.patch`, four 480×270 clips |
| `wide-scan.patch`, `results-wide-scan.txt` | Control: no persistence, the exact four-wide scan for recipe steps up to 256 RGB colours (released: 64) |
| `sizes.mjs`, `results-sizes.txt` | Released against `wide-scan.patch` at 48 to 400 colours, to find where the scan stops beating the index |
| `batch-recipe.mjs`, `results-batch-recipe.txt` | The recipe (frames stacked into one call, padded to 8 rows) at batches of 6, 12 and the whole clip, against per-frame calls and `persist.patch`; checks identical indices |
| `compact.patch`, `results-compact.txt` | Control: no persistence, key and recipe in one record with entries in the narrowest integer type; four clips at both sizes |

**Frames** (36 per clip, 12 fps, 480×270 and 160×90, raw RGBA): five 3-second scenes of the Sintel trailer (Blender Foundation, CC-BY; `https://download.blender.org/durian/trailer/sintel_trailer-480p.mp4`, at 4, 12, 21, 30 and 36 s), plus two made from Kodak photos: `pan` (kodim23, 2 px a frame, no resampling) and `sprite` (kodim21 with a kodim15 crop moving across it). Commands:

```sh
for c in "snow 4" "elder 12" "dusk 21" "girl 30" "desert 36"; do set -- $c; for w in 480 160; do h=$((w*9/16))
  ffmpeg -ss $2 -t 3 -i sintel.mp4 -vf "fps=12,scale=$w:$h:flags=bicubic" -f rawvideo -pix_fmt rgba $1-$w.rgba; done; done
for w in 480 160; do h=$((w*9/16)); sw=$((w*8/5))
  ffmpeg -loop 1 -i fixtures/images/kodim23.png -vf "scale=$sw:-2:flags=bicubic,crop=$w:$h:x='2*n':y=0,setsar=1" -frames:v 36 -f rawvideo -pix_fmt rgba pan-$w.rgba
  ffmpeg -loop 1 -i fixtures/images/kodim21.png -loop 1 -i fixtures/images/kodim15.png -filter_complex "[0]scale=$w:$h:flags=bicubic,setsar=1[bg];[1]scale=$((w/4)):-2:flags=bicubic[fg];[bg][fg]overlay=x='mod(4*n,$w)':y=$((h/3))" -frames:v 36 -f rawvideo -pix_fmt rgba sprite-$w.rgba; done
```

**Patched build:** copy `dist/` elsewhere, apply the patch to a copy of `src/`, and compile it with the `build:wasm` flags into that copy's `clustering.js` (no `patch-glue` step needed in Node). Then `node bench/spikes/recipe-reuse/measure.mjs <frames dir> <copy>/index.mjs`.

## Findings (2026-11-22, one machine, Node 24)

- **Reuse saves about half on real video, 3–12× on content whose pixels repeat exactly.** Whole clip, persisted over released: Sintel scenes 0.30–0.77 (160 wide) and 0.39–0.67 (480 wide); pan and sprite 0.08–0.22 and 0.19–0.30. Codec noise keeps making new exact colours: a later frame shares 14–59% of its colours with the previous frame, 44–91% with any earlier frame.
- **Even with every recipe built, ordered stays well above no dithering.** Mapping a frame a second time with the persisted table ("floor") still took 2–14× the no-dither time at 480 wide (girl: 35 ms against 3 ms; desert: 5 ms against 2 ms), rising with the number of distinct colours.
- **A single call's cost is building recipes, not the table.** Neither layout change, without persistence, made a call faster: twice the slots changed nothing (0.96–1.02, `results-bigger-table.txt`), and a compact table (`compact.patch`: key and recipe in one record, entries as bytes up to 256 colours, so 20 bytes a slot instead of 68 at 16 steps) was the same or slower (1.00–1.10, `results-compact.txt`, eight clips; slowest at 16 RGB and black and white, from the extra copy and narrowing). So within a call the time goes to the recipe searches (16 or 64 nearest-colour picks per distinct colour), and speeding a single call means making those picks faster. What the floor above is made of (slot collisions between colours that alternate, or the hits themselves) was not separated.
- Released ordered costs 5–21× no dithering at 16–255 colours and 20–125× with black and white (64 steps); about 2.5–7× Floyd–Steinberg. On the snow scene at 480 wide it was faster than Floyd–Steinberg.
- **A wider exact scan doesn't help GIF palettes.** At 255 colours the scan is 12–34% slower than the palette index (`results-wide-scan.txt`, eight clips; the 16-colour and black-and-white rows, which take the scan in both builds, stayed at 0.96–1.01). The sweep (`results-sizes.txt`) puts the crossover near 128 colours: the scan is 7–21% faster from 65 to 96 colours, about even at 128, and slower above. Moving the limit from 64 to 96 or 128 is a small speed-only gain for those sizes; it does nothing for 255.

## Outcome (2026-11-23)

The batching recipe matched or beat the built-in prototype (whole clip in one call: 0.27–0.69 on film, 0.06–0.24 on exact repeats, against 0.30–0.80 and 0.08–0.31), with identical indices. Item 6 ended as a recipe: "Faster ordered dithering: map frames in batches" in docs/guides.md (`mapFramesInBatches`). Value brief: `docs/superpowers/briefs/2026-11-23-recipe-reuse-brief.md`; the built-in is under ROADMAP "Considered".

## Conclusion before the recipe was measured

A single call can't be made much faster by the table's layout or the step search: building recipes is the cost, and the index is already the faster search at GIF sizes. Keeping recipes between calls is the only large lever: about half on real video, 3–12× on animations whose pixels repeat exactly. Whether it is kept implicitly or by an explicit object is the roadmap's open question; with these numbers, the gain on real video (the usual source of a GIF) is about 2×, which is what a decision should weigh against 8–32 MB held between calls or new API.
