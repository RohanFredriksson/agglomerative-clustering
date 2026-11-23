# Value brief: decoding image files (ROADMAP "Larger, later")

Measurements: `bench/spikes/decoding/`. `make-images.mjs` writes the test files from Kodak; `recipes-node.mjs` → `results-node.txt`; `recipes-browser.mjs` → `results-browser.txt` (headless Chromium, main thread); `sizes.mjs` → `results-sizes.txt` (KiB). `rounds.md` covers the three outside-user projects, with their glue in `*-glue.js`.

The 13 test files:
- kodim23 as PNG, JPEG, an EXIF-orientation-6 JPEG, a Display P3 JPEG with its profile, GIF, WebP and AVIF;
- palette, grey, 1-bit and 16-bit PNGs;
- a 12 MP JPEG;
- kodim05 with an alpha ramp.

The reference decode is sharp: orientation applied, profiles converted to sRGB, 8-bit straight RGBA. Each recipe's 16-colour palette is scored by the error of mapping the *reference* pixels to it, so a garbage decode shows up as a worse palette.

## Who asked

No person has asked. The ROADMAP's "asked for in every round of testing" has no recorded quote. For this brief, three exploratory-round agents (2026-11-23) each built a project from the README and `docs/` only, and were asked about a built-in decoder only at the end. Their answers were prompted, so they don't count as demand:
- **A Node CLI** (dominant colours of a folder of phone photos). It used sharp from the README's snippet and had correct output in about 70 seconds. "For me it would matter little." **"If it never shipped, would you mind?" No.**
- **An edge API on Cloudflare Workers** (colours of an uploaded or fetched image). It used fast-png and jpeg-js: 81 lines, and a silent bug on 1-bit PNGs. "The colour maths was 5 lines. Everything else was format plumbing I'll get subtly wrong." **"Yes, moderately."**
- **A browser app** (drop a file, palette and preview in the worker entry). It used `createImageBitmap`: 34 lines. "I'd use it immediately", if it decoded in the worker with the browser's own decoders. **"Mildly. Orientation and formats are solved by the browser in one call."**

## The symptom

In the words the agents would search for:
- "decode PNG JPEG to RGBA in Cloudflare Worker without sharp"
- "sharp raw buffer palette wrong colors grayscale png"
- "fast-png 1 bit grayscale wrong colors"
- "getImageData semi transparent pixels wrong color"

Passing `readFile()` bytes was a first try. The current error ("these bytes are an encoded JPEG file … Decode it first") "told me exactly what to do" (CLI agent), and the browser agent called it "Excellent". For the edge agent its advice (sharp, pngjs) "doesn't fit here".

## The best recipe

There is one per environment. Timings are medians from `results-node.txt` and `results-browser.txt`.

| Recipe | Code | Right on all 13 files? | Decode, 768×512 / 12 MP | What it adds |
|---|---|---|---|---|
| **Node: sharp** (`.rotate().toColourspace('srgb').ensureAlpha().raw()`) | 5 lines | yes (it is the reference) | 2.6–20 ms / 52 ms | a native module, 18 MB installed |
| **Browser: `createImageBitmap` + `OffscreenCanvas`** | 6 lines | all but partly transparent pixels (below); orientation, P3, 16-bit and AVIF are right | 3.8–10.6 ms / 84 ms | nothing |
| **Edge: jsquash** (squoosh's codecs in WebAssembly) | about 20 lines in Node | all but orientation and profiles; no GIF (add omggif) | 2.3–16 ms (AVIF 54) / 103 ms | gzipped: PNG 82 KB, JPEG 62, WebP 48, AVIF 332 |
| **Node without native modules: pngjs + jpeg-js + omggif** | about 20 lines | all but orientation and profiles; no WebP or AVIF | 6–46 ms / 535 ms | pngjs needs Node's `util`, `zlib` and `stream`, so it doesn't bundle for an edge runtime |
| **Edge, pure JS: fast-png + jpeg-js** (the edge agent's) | 55 lines, expanding palette, grey, packed and 16-bit PNGs by hand | PNG and JPEG only, after the 1-bit bug was fixed | PNG 31–35 ms, 12 MP JPEG 1.1–1.5 s (the agent's CPU times) | 20 KB gzipped |

**Measured after the review, for the guide** (`measure-edge.mjs` → `results-edge.txt`, `measure-browser-worker.mjs` → `results-browser-worker.txt`):
- **The jsquash recipe under `wrangler dev`** (`edge/decode.js`, 27 lines, with omggif for GIF): 768×512 images decode in 4–20 ms and the 12 MP JPEG in 139 ms; with jsquash's `preserveOrientation: true` the rotated JPEG comes out upright. The 5-colour palettes are identical to sharp's on every file but the P3 one. The worker, with the library, is 290 KiB gzipped. Memory was not measured: wrangler dev doesn't enforce the 128 MB limit.
- **The browser recipe on the main thread and in a worker** (Chromium): decoding the 12 MP JPEG on the page blocked it for up to 75 ms (a first run saw no task over 50 ms; machine load varies), and `premultiplyAlpha: 'none'` added about 25 ms. In a worker the page saw no task over 50 ms in any run. Two-frame GIF and WebP animations give their first frame.
- **The guides' exact sharp chain** (`guide-recipes.mjs` → `results-guide-recipes.txt`): `.rotate().ensureAlpha().raw()` gives the same bytes as the spike's longer reference chain on the P3, 16-bit, grey and rotated files. Animated GIFs give their first frame with sharp and omggif; an animated WebP fails in jsquash ("Decoding error").

**Decoding against clustering.** Clustering the photos takes 144–536 ms at 768×512 and 2.4 s at 12 MP (`buildPalette`, k = 16). There, sharp, the browser and jsquash spend 2–10% of the time decoding. On images of few colours clustering takes 2.5–2.8 ms, so decoding costs more than clustering (4–23 ms). On the edge with pure JavaScript, decoding is the main cost: the agent measured PNG decoding at 31–35 ms against 29–35 ms of clustering, and the 12 MP JPEG at 1.1–1.5 s against 45 ms (after downscaling).

**What the misses cost:**
- **Orientation:** a palette doesn't depend on pixel order, so it is unchanged (1.00× on the rotated JPEG). Only the shape of `quantize` output changes.
- **Colour profiles:** decoded without conversion, the P3 photo gives a palette 1.44× (pngjs/jpeg-js) or 1.47× (jsquash) worse. Only sharp and the browser convert.
- **Partly transparent pixels in the browser** pass through the canvas premultiplied: a mean channel error of 8.3 where alpha < 32. The browser agent saw orange at alpha 3 come back as "dusty pink". Those pixels weigh little, so the palette is 1.01× worse. The agent reports that neither `premultiplyAlpha: 'none'` nor `ImageDecoder` avoided it; the spike's recipe passes no options.

**Traps.** None of them is in decoding itself:
- **A bare 3-channel array passes silently.** sharp's plain `.raw()` gives RGB. Passed bare, it is read as RGBA and gives a worse palette with no error on 11 of 13 files: 1.6–1.8× on the colour ones and 1.24× on grey. Only the RGBA file and the two-colour one escape. The CLI agent: "That's the one that would have bitten me." The edge agent avoided it "because the README warns".
- **fast-png returns what the file holds:**
  - palette indices;
  - 1 or 2 channels;
  - a `Uint16Array` at 16 bits;
  - 1-, 2- and 4-bit rows still packed: the edge agent's black-and-white image came out as "#000000 98%".

  Without expansion it fails or misleads on 4 of the 5 PNGs that aren't RGBA. Yet `docs/environments.md` points Workers users at fast-png, while jsquash expands everything to 8-bit RGBA.
- **Animated GIF and WebP** give their first frame in every recipe, silently.
- **The main thread:** decoding a 12 MP photo there blocked the page in the browser agent's app. Its long tasks were 59, 69 and 168 ms, and it didn't split `createImageBitmap` from `drawImage`/`getImageData`.

## What a built-in adds over it

- **Quality: nothing in Node or the browser.** sharp is the reference. A built-in on the browser's decoders would inherit the browser's premultiplied rounding, and fixing that needs a bundled PNG and WebP decoder. On the edge it could add profile conversion (1.44× → 1.00×), but only by also bundling a colour-management library.
- **Speed: nothing.** The decoders would be the same ones: sharp, the browser's, squoosh's. The one speed-up is decoding at reduced size (JPEG DCT scaling), which the edge agent asked for for CPU and memory. No recipe above does it, and it was not measured.
- **Convenience:**
  - On the edge: about 20 lines, and the choice of decoder.
  - In the browser: decoding inside the library's worker without a second worker. The time this saves on the main thread is unmeasured.
  - In Node: nothing.
- **Costs:**
  - **Size.** The library is 44 KB gzipped. PNG, JPEG and WebP decoders add 192 KB (4.4×), AVIF another 332 KB, plus EXIF and ICC handling to be correct. The browser and CLI agents said bundled codecs would bother them more than the glue. The CLI agent said a half-done one ("no CMYK, no profiles") "would be worse than none". The edge agent accepted 60–100 KB gzipped, "ideally as a separate entry point".
  - **API:**
    - images become `Uint8Array | Blob | ArrayBuffer | Response | …`;
    - a decoded file has no `format` to give `quantize` output back in;
    - animation needs a policy;
    - a pixel cap is needed before decoding;
    - unsupported formats need an error code (HEIC in Chromium);
    - behaviour differs by environment, so a worker-only Blob input breaks "Both entries behave alike".
  - **Scope.** PRINCIPLES' charter "takes decoded pixels".

## Recommendation

**Recipe:**
1. **A "Decoding image files" section in docs/guides.md**, with a recipe per environment:
   - sharp in Node;
   - `createImageBitmap` in a worker of one's own that imports the main entry, measured first, including how long it blocks the main thread;
   - jsquash on edge runtimes, with omggif for GIF, run in workerd first for its line count, CPU time and memory at 12 MP;
   - pngjs + jpeg-js in Node without native modules.

   Each is tested in `test/recipes.test.js` where it can run, and the section lists the traps: bare RGB, first frame only, profiles, premultiplied canvas pixels. Also change `docs/environments.md` line 66 from fast-png to jsquash, and make the error message's advice name a decoder per environment.
2. **Record a built-in decoder under ROADMAP "Considered".** It would reopen when a real edge-runtime user asks in an issue and shows that the guides' jsquash recipe fails them: CPU or memory limits, or WebAssembly loading on their runtime. Any built-in would then have to answer colour profiles and decoding at reduced size, or it is the half-done decoder. In the same change:
   - take decoding out of "Larger, later";
   - correct its "asked for in every round";
   - update PRINCIPLES "What it leaves to others".
3. **Look separately at the silent bare-RGB trap.** It is not decoding, and it is the most common wrong output in the rounds. A bare `Uint8Array` being RGBA is a settled decision, so any check would make some calls that work today throw (docs/stability.md). It needs its own short brief on false positives and an `api-steward` review, not an internal fix.

**Review (scope-steward, 2026-11-23):** out of scope for now, and the recommendation follows from the numbers.
- **Node built-in: drop.** Tests 1, 2 and 4 fail.
- **Browser or worker-entry Blob built-in: defer.**
  - Its only gain is unmeasured.
  - It breaks "Both entries behave alike".
  - It would own the premultiplied drift, against "Mistakes are errors, never silent wrong output".
- **Edge `/decode` entry: defer.**
  - Test 2 fails for real users.
  - Test 4: 4.4× the size.
  - Test 5: it is the largest shape.
  - Test 6: without profiles it is the half-done decoder.

Its corrections are folded in above:
- the edge and in-worker recipes are marked as not yet measured;
- a script now gives the sizes;
- figures are quoted from the results files;
- "a few percent" is now split by image;
- the quotes are attributed to one agent each;
- the reopening condition no longer fixes the shape.

It also disagreed with this brief's first draft, which called the bare-RGB check "an internal fix, no brief". That check would reject calls that succeed today, so it is now item 3 here.
