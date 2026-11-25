# Principles

What this library is for, how its API is designed, and the decisions that are already made. The other documents cover the rest:
- [ROADMAP.md](ROADMAP.md) holds the plans: what comes next, what waits for 4.0, and what was considered and turned down.
- [stability.md](stability.md) holds the promise to users: what a minor release may and may not change.
- `CLAUDE.md` holds the coding conventions and the process, and `test/api.test.js` checks that the code, the types and the docs agree.

Changes to this document go through a pull request that says why. The design reviewers (`.claude/agents/`) read it.

## What the library is for

One job: **exact Ward colour quantization.**
- **Cluster** an image's colours once into a complete tree.
- **Cut** it into a palette of any size: palettes nest, in a stable order.
- **Map** images to a palette, with dithering and indexed output.
- **Report** each colour's share and the error at every size.
- **Store** a clustering as bytes, to cut later.

It takes decoded pixels in the byte layouts that real sources produce (`imageFormats`, `ImageData`). It runs from one WebAssembly module in Node and browsers, on the calling thread or in a worker, with no runtime dependencies. Its output is deterministic.

## What it leaves to others

- **Encoding files:** palette PNG and GIF writers (fast-png, gifenc). The guides show how to use them.
- **Decoding files:** sharp, the browser (`createImageBitmap`) and squoosh's codecs do it; the guides have a recipe for each environment. An encoded file passed as pixels is recognised and rejected with a message (Settled decisions).
- **Image processing that isn't quantization:** resizing, compositing onto a background, colour management. Premultiplied input is read with `premultiplied: true` (4.0); converting premultiplied pixels to straight output is a recipe in the guides.
- **Application policy:** worker pools and their queueing, smoothing palettes across video frames, picking a palette size for the user. These depend on the app, so they are recipes.
- **Neighbouring jobs that other tools do better:** compression-tuned PNG pipelines (libimagequant, pngquant), a few vivid "dominant" UI colours (color-thief, node-vibrant), palettes with translucent entries.

## The test for a new feature

A feature belongs in the library when all of these hold:
1. **It needs the library.** It uses the tree, the WebAssembly heap or the pixel loops, or a user can't do it correctly and fast enough in a few lines outside. Otherwise it is a recipe in the guides. This test is shown, not asserted: before a spec is written, the strongest recipe is built and measured through the published API, and the case for the feature is what the built-in adds over that recipe (the value brief, CLAUDE.md "Design review"). The linear-light dither option failed here only once that was done: a recipe matched it (ROADMAP "Considered").
   - **A recipe has costs too, and they count against it.** Every user who needs it copies it, keeps it working, and gets no types, no semver promise and no fixes. It leans towards building when the recipe is long (more than about 25 lines), needs a third-party library or a metric written out, needs knowledge of the internals (the clustering format, tags, worker routing), runs much slower than a built-in would (a second pass, work on the calling thread, a loop in JavaScript that the WebAssembly could run), or is easy to copy wrong (count its traps). The question is which costs users more over the major version: the API, or the recipe in every app that needs it. A recipe is not the default answer; neither is the built-in.
2. **Someone asked for it**, for a use case the README names or should name: a user in an issue, an exploratory round's agents, or the maintainer. The maintainer asking, with the use case, passes this test; the library has few outside requests, so a test that only users can pass would decline everything. A feature nobody asked for is not added.
3. **Its policy isn't the app's.** If the right setting depends on the application (timing, queueing, weights), it stays in the application.
4. **It doesn't change what the library is:** no state kept across calls, no second engine, no runtime dependency and no large growth of the WebAssembly, unless the feature is worth that cost on its own, and the reasons are written down.
5. **It fits the shapes that exist:** a new value of an option before a new option, an option before a new function, and a function before a new entry point. Choose the smallest that solves it, and only when it can be kept working for the rest of the major version.
6. **Its API is clean.** A capability that can only be offered through a confusing shape (several interaction rules, a name users misread, a setting that quietly changes another's meaning) waits until a clean shape is found, or stays a recipe. A useful feature doesn't excuse a messy API.

**Recipes are reviewed again.** A decision that made a recipe is not final. Before each major version (and whenever a recipe is fixed twice or a user reports copying it wrong), the recipes and the built-ins in ROADMAP "Considered" are weighed again under these tests, and the ones that pass go to the maintainer as candidates for the API. For this review, the revised test is itself the new evidence that reopening a declined item needs. Decisions settled as outside the library ("What it leaves to others": decoding, encoding, app policy) are not part of it; only the maintainer reopens those. A recipe that keeps being needed is evidence for the built-in.

## API design

The mechanical conventions are in `CLAUDE.md`: option shapes, lists of names, errors made with `fail`, argument names, and taking the bytes before awaiting. The principles behind them:
- **Simple to use correctly, hard to misuse: this comes first.** A user should be able to guess what a name does before reading its docs, and use it without learning rules about how it combines with other options. Count the rules a new option brings (settings it forbids, settings it overrides, settings it changes the meaning of): each one is a cost, and a design that needs several is the wrong design, however consistent it is. Prefer a shape in which the wrong combination can't be written over one that rejects it with an error. Name things for what the user wants (`light`), not for how it is done (`linear`). Check this with a cold-read user (CLAUDE.md "Design review"), not by argument.
  - Example: the linear-light dither option (ROADMAP "Considered") followed every convention below, yet needed five rules (no Atkinson, no OKLab, OKLab arriving from a palette's tag, `colorSpace` meaning less in `quantize`, a `colorSpace: 'rgb'` written only to pass a check), and a cold reader took `linear` for a scan order.
- **One way to say a thing,** now and after planned changes. An additive 3.x feature that would leave 4.0 with two ways to do one thing conflicts with the roadmap, even though it breaks nothing today.
  - Example: while designing 3.2.0, format names like `'bgra-premultiplied'` were turned down because 4.0 plans a `premultiplied` property.
- **Names follow their family:**
  - `get…` for calls that read or cut what their arguments or receiver already hold (a cut of a clustering, its info, a handle's kept data); they never cluster, map or search. A call that does that work is named with a verb (`buildPalette`, `quantize`, `cluster`). `getClustering`, `getPalette` and `getSwatches`, which predate this rule, are deprecated names of `buildClustering`, `buildPalette` and `buildSwatches` since 3.4.0, and 4.0 removes them (ROADMAP).
  - `…FromClustering` for those that take a stored clustering (through 3.x; deprecated from 3.8 and removed in 4.0, see "Settled decisions");
  - `…WithPalette` for those that take a palette.
  - A method takes its function form's name without the suffix that names the receiver (`clustering.getPalette(k)`), so the two always share a stem and the rule above names both. Methods that manage a live object are named for the action (`release`, `terminate`).
  - A new name should read as a sibling of the names around it.
- **Methods go where losing them costs nothing; results stay plain data.** A method goes on a live object (a worker, a handle), or on a tagged value whose bytes are the whole value, that its constructor restores, and that its operations take only in that form (`Clustering`). A function that also accepts a plain form (`PaletteLike`) gets no method, since most callers hold the plain form. Through 3.7 every such method had a function form in both entries; from 3.8 a new one has a handle method instead (`worker.load(clustering)`), and from 4.0 none has a function form ("Settled decisions"). Results the library doesn't tag (`Swatches`, `ClusteringInfo`, indexed and mapped images) get no methods. A helper over a result is an option of the call that makes it, or a function.
- **Mistakes are errors, never silent wrong output.** Inputs are validated, unknown option keys throw, and messages say what was received and what would work. Every error has a `code`, and an `argument` when it is about one. Errors are the last line of defence, not the design: when a combination needs a rule, first look for a shape that doesn't.
- **Both entries behave alike.** The worker entry takes the same arguments and gives the same results and errors as the main entry.
- **Types describe what happens at run time.** Strict TypeScript catches what it can, but not at the cost of breaking existing code. Conditional parameter types break generic wrappers, and narrowed result types break a `let` reused across calls (both were prototyped).
- **Compatibility:** [stability.md](stability.md). Within 3.x, changes are additive, and widening a union of names is allowed. Anything that changes what an existing call returns, or stops code that compiles against 3.x from compiling, goes to the roadmap's 4.0 section. One exception, written into stability.md in 3.4.0: interfaces the library implements (`Clustering`, `AgglomerativeWorker`, `ClusteringHandle`) gain members when functions are added.
- **Measured against well-made libraries.** A new API should hold up next to the platform's own (`ImageData`, WebCodecs, `AbortSignal`) and to sharp's. Look for clear names, few concepts, defaults that suit most callers, and errors that teach.

## Settled decisions

These were argued through and decided. Reopen one only with new evidence, and only the maintainer reopens it.
- **The feature test weighs both sides** (decided by the maintainer on 2026-11-24). Every value brief for a new feature or option from 3.4 to 3.6 had ended as a recipe or a decline (linear light, recipe reuse, swatch helpers, sliced mapping, decoding, palette size; only the two bare-image warnings were built), because test 2 couldn't pass without outside requests and a recipe's costs to users weren't counted. Now the maintainer's request passes test 2, a recipe's own costs count against it (test 1), a `user-advocate` reviewer argues the users' side next to the stewards, and recipes are reviewed again before each major. Earlier verdicts stand until they are reviewed under these rules.
- **The library doesn't decode image files.** It takes decoded pixels, adds no decoders and no dependency on one; decoding is the job of sharp, the browser and squoosh's codecs, which do it better than a copy would. The guides give a tested recipe per environment. Decided by the maintainer on 2026-11-23, after a value brief (`docs/superpowers/briefs/2026-11-23-decoding-brief.md`) found a built-in would add no quality or speed over those recipes (ROADMAP "Considered").
- **Palettes are flat, opaque RGB bytes in split order.** Alpha belongs to pixels: `quantize` passes it through, and indexed output uses a transparent entry. Palette entries with alpha were spiked (`spike/rgba-4d`) and dropped (ROADMAP "Later, if asked for").
- **A bare `Uint8Array` is RGBA.** Other layouts are given as `{ data, format }`. Bytes that are very unlikely to be RGBA are refused, never reinterpreted: encoded files (an error since 3.0.0), from 3.5.0 bytes that look like RGB, and from 3.6.0 bytes that look like grey (warnings, errors in 4.0; below). A bare array is never read as RGB or grey.
- **`premultiplied: true` without alpha is a run-time error, not a type error.** Decided by the maintainer on 2026-11-25, after a review by the three stewards and `user-advocate`. The image types accept `premultiplied?: boolean` on every format; `true` on `'rgb'`, `'rgbx'` or `'bgrx'` throws `invalid-argument` on the first call, with a message that says to remove it. Typing it out (`premultiplied?: false` on those formats) would catch only a literal `true`, since TypeScript can't tell a `boolean` that is `false` in practice from `true`; it rejected 6 of 8 realistic correct callers that build the image object from variables (a forwarded config, a channel-count helper, a spread with a flag), which then need a cast that hides the run-time mistake too<!-- bench/spikes/premultiplied-type-check/run.sh → results.txt -->. A type check with false positives is worse than a run-time check without them. Revisit only in 5.0 (tightening the type is breaking); ROADMAP "Considered" has the measurement.
- **Identifiers spell gray and color; prose spells grey and colour.** Names users type or compare in code (`colorSpace`, the `gray-as-rgba` warning code, a later `format: 'gray'`) use American spelling, like the web platform, ffmpeg and skia; the docs and messages use British. Decided by the maintainer on 2026-11-23, with the bare-grey spec (`docs/superpowers/specs/2026-11-23-bare-grey-warning-design.md`).
- **Warnings only bridge to an error in the next major.** Decided by the maintainer on 2026-11-23, on the bare-RGB value brief (`docs/superpowers/briefs/2026-11-23-bare-rgb-brief.md`), which chose a 3.x warning over waiting for 4.0's error because silent wrong output keeps happening until then.
  - **When:** a minor release may warn about a call that the next major will reject, and about nothing else. Advice, speed hints and deprecated names (those are `@deprecated` in the types) are not warnings.
  - **How:** once per warning code, per copy of the library. It goes through `process.emitWarning` in Node, Bun and Deno (type `AgglomerativeClusteringWarning`, a kebab-case `code`), so Node's `--no-warnings`, `process.on('warning')` and `--trace-warnings` work, and through `console.warn` elsewhere, including runtimes that only imitate Node, whose `emitWarning` may print nothing (Cloudflare Workers). Only a call whose arguments were accepted warns, so the one warning isn't spent on a call that fails anyway. Every warning check runs on the caller's side: the worker thread's copy is silenced, and a check that only the thread could make would be lost.
  - **What 4.0 rejects:** exactly what 3.x warned about, or more after measuring again, never less. "3.x" means the last 3.x release's rules, not the first that warned (confirmed by the maintainer on 2026-11-24, when 3.6.0 widened the bare-RGB check).
  - **What it never does:** change a result. It is silenced by saying what the input is, or, for a layout the library doesn't take (grey), by converting it to one it does, with no switch of its own. Codes are documented under "Warnings" in docs/api.md, not added to `errorCodes`.
  - **The first** is `rgb-as-rgba` (3.5.0), the second `gray-as-rgba` (3.6.0); both became the `invalid-argument` error on `'image'` in 4.0.
- **The 3.0 function names keep working through 3.x:** `get…`, `…FromClustering` and `…WithPalette`. `get…` was reviewed before 3.0.0 and kept then: the cheap cuts are getters, the Promise says the heavy ones do work, it matches color-thief and node-vibrant, and `getPalette` was the most-used 2.x call. Whether `…FromClustering` is deprecated in 4.0 is open (ROADMAP 4.0). In 3.4.0 the three `get…` functions that cluster an image became deprecated names of the `build…` functions (below).
- **`get…` means a read, from 4.0.** Reopened by the maintainer in 3.3.0, on evidence new since 3.0: the `Clustering` methods put `clustering.getPalette(k)` (about 0.4 ms) beside `getPalette(image, k)` (about 70 ms), and a planned subset search (150 ms to 1.5 s) would have taken `get…` too. The functions that cluster an image get verb names in 3.4.0 with the old names `@deprecated`, and 4.0 removes the old names (ROADMAP). Until then, no new name that clusters, maps or searches starts with `get`.
- **The verb is `build…`** (3.4.0, chosen by the maintainer after a survey): `buildClustering`, `buildPalette`, `buildSwatches`. The leading quantizers do the work under a verb and read results under `get…` (libimagequant's `quantizeImage` then `getPalette`, image-q's `buildPalette` then `applyPalette`, Android's `generate`, Pillow's `quantize`, SciPy's `linkage` then `fcluster`). `quantize` was taken by mapping, and image-q uses `buildPalette` with exactly this meaning. Rejected: `extract…` (`extractClustering` reads oddly, one small library's precedent), `generate…` (`generateClustering`), `compute…` (bland, no precedent), `make…` (`makePalette` reads as building one from colours), and `cluster…` and `load…` (taken by the worker's handles). `build…` now means "cluster an image", so other work (a subset search) takes another verb.
- **`Palette` and `Clustering` are tagged plain `Uint8Array`s, made by plain functions,** not subclasses (a subclass breaks `toEqual(new Uint8Array(…))` in users' tests) and not `class`es. Copies of the same version recognise each other's tags (a `Symbol.for` key), which stability.md promises from 3.3; between versions it works but is not promised, so the keys could be versioned later.
- **Methods on `Clustering`** (3.3.0) are non-enumerable own properties, added with the tags, so a clustering stays plain bytes; they are async, run on the calling thread with the main entry of the same copy of the package, and reject with `wasm-load-failed` without it. Each forwards to its function form, so they agree by construction. Rejected:
  - a prototype or subclass (fails `deepStrictEqual`, and risks typed-array fast paths);
  - a non-byte object with `.bytes` (breaks storing a clustering as it is);
  - routing calls to the worker that made the clustering (it can be terminated, and stored bytes have none);
  - the main entry if loaded, else the worker (an import would change where code runs).

  A lazy loader in the worker entry and one slot across copies of the package were left out, not rejected for good: both are additive later (ROADMAP "Considered").
- **Off the calling thread, the handle is the answer; `…FromClustering` goes in 4.0** (decided by the maintainer on 2026-11-24, before the 4.0 spec). `worker.load(clustering)` gives a handle for a stored clustering, so the worker entry needs no `…FromClustering` functions. 3.8 adds it and marks every `…FromClustering` function `@deprecated` in both entries; 4.0 removes them. New cut-or-search functions are a `Clustering` method plus a handle method, with no function form (the first is the fixed-palette subset, reopened from "Declined" and built in 3.8; ROADMAP "Considered"). The clustering tag key is not versioned: 4.0 reads every 3.x clustering.
- **`Palette` keeps no methods:** `…WithPalette` takes a `PaletteLike` ("Methods go where losing them costs nothing"). The last open condition, ROADMAP item 6 (reusing dither recipes), ended as a recipe. A frame-mapper object is a separate question (ROADMAP "Considered").
- **The default colour space stays `'rgb'`.**
- **Indexed output:** `transparent` is `boolean | cutoff`, and `k` counts the transparent entry.
- **Errors:** every error carries a `code`, and `errorCodes` and `isCodedError` are exported. There is no error class of our own: errors that cross a worker, Electron's IPC or `postMessage` arrive as plain objects, so `instanceof` would mislead.
- **Names:**
  - `ProgressOptions`, not `RunOptions`;
  - `formatVersion` is a `number`;
  - there is one `ClusteringInfo` interface.
- **Not part of the API:** the names of the files in `dist/` (users copy the whole folder).
- **Declined so far** (reasons in ROADMAP "Considered, and why not (yet)"):
  - a built-in worker pool;
  - clustering several images in one call;
  - `isAbortError`;
  - a worker idle timeout;
  - palette file writers;
  - a matte colour;
  - smoothing palettes across frames;
  - a linear-light dither option (a recipe in the API reference covers it);
  - keeping ordered-dithering recipes between calls (a recipe in the guides, mapping frames in batches, covers it);
  - built-in swatch helpers: a ranking function, an ordering option on swatches, a one-call dominant colour (the guides' `rankSwatches` recipe covers them).
  - a built-in palette-size suggestion or elbow heuristic (the guides' `sizeForError` and `sizeForScore` recipes cover it).
- **Done in 4.0 part 1** (ROADMAP "4.0"): premultiplied alpha (`premultiplied: true`), with `RawImage` as a union split by `format` and unknown image keys rejected; narrowed result types. Straight output from a premultiplied source is a recipe, not an option (decided 2026-11-25).
- **Deferred to 4.0** (ROADMAP "4.0"): `alpha` and `transparent` throwing on formats without alpha; removing the `get…` names of the functions that cluster an image; the bare-image warnings (`rgb-as-rgba`, `gray-as-rgba`) becoming `invalid-argument` errors.

When the maintainer settles a new question, it is added here, or to the ROADMAP if it is a plan or a deferral, in the same change.
