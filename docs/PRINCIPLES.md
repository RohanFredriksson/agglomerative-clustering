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
- **Decoding files:** an open roadmap item ("Larger, later"). Today an encoded file is recognised and rejected with a message.
- **Image processing that isn't quantization:** resizing, compositing onto a background, colour management. Converting premultiplied pixels is a recipe until 4.0, where it is planned.
- **Application policy:** worker pools and their queueing, smoothing palettes across video frames, picking a palette size for the user. These depend on the app, so they are recipes.
- **Neighbouring jobs that other tools do better:** compression-tuned PNG pipelines (libimagequant, pngquant), a few vivid "dominant" UI colours (color-thief, node-vibrant), palettes with translucent entries.

## The test for a new feature

A feature belongs in the library when all of these hold:
1. **It needs the library.** It uses the tree, the WebAssembly heap or the pixel loops, or a user can't do it correctly and fast enough in a few lines outside. Otherwise it is a recipe in the guides.
2. **Someone asked for it**, in an issue or an exploratory round, for a use case the README names or should name. A feature nobody asked for is not added.
3. **Its policy isn't the app's.** If the right setting depends on the application (timing, queueing, weights), it stays in the application.
4. **It doesn't change what the library is:** no state kept across calls, no second engine, no runtime dependency and no large growth of the WebAssembly, unless the feature is worth that cost on its own, and the reasons are written down.
5. **It fits the shapes that exist:** a new value of an option before a new option, an option before a new function, and a function before a new entry point. Choose the smallest that solves it, and only when it can be kept working for the rest of the major version.

## API design

The mechanical conventions are in `CLAUDE.md`: option shapes, lists of names, errors made with `fail`, argument names, and taking the bytes before awaiting. The principles behind them:
- **One way to say a thing,** now and after planned changes. An additive 3.x feature that would leave 4.0 with two ways to do one thing conflicts with the roadmap, even though it breaks nothing today.
  - Example: while designing 3.2.0, format names like `'bgra-premultiplied'` were turned down because 4.0 plans a `premultiplied` property.
- **Names follow their family:**
  - `get…` for the functions that cluster an image;
  - `…FromClustering` for those that take a stored clustering;
  - `…WithPalette` for those that take a palette.
  - A new name should read as a sibling of the names around it.
- **Mistakes are errors, never silent wrong output.** Inputs are validated, unknown option keys throw, and messages say what was received and what would work. Every error has a `code`, and an `argument` when it is about one.
- **Both entries behave alike.** The worker entry takes the same arguments and gives the same results and errors as the main entry.
- **Types describe what happens at run time.** Strict TypeScript catches what it can, but not at the cost of breaking existing code. Conditional parameter types break generic wrappers, and narrowed result types break a `let` reused across calls (both were prototyped).
- **Compatibility:** [stability.md](stability.md). Within 3.x, changes are additive, and widening a union of names is allowed. Anything that changes what an existing call returns, or stops code that compiles against 3.x from compiling, goes to the roadmap's 4.0 section.
- **Measured against well-made libraries.** A new API should hold up next to the platform's own (`ImageData`, WebCodecs, `AbortSignal`) and to sharp's. Look for clear names, few concepts, defaults that suit most callers, and errors that teach.

## Settled decisions

These were argued through and decided. Reopen one only with new evidence, and only the maintainer reopens it.
- **Palettes are flat, opaque RGB bytes in split order.** Alpha belongs to pixels: `quantize` passes it through, and indexed output uses a transparent entry. Palette entries with alpha were spiked (`spike/rgba-4d`) and dropped (ROADMAP "Later, if asked for").
- **A bare `Uint8Array` is RGBA.** Other layouts are given as `{ data, format }`.
- **The function names stay:** `get…`, `…FromClustering` and `…WithPalette`. `get…` was reviewed before 3.0.0 and kept: the cheap cuts are getters, the Promise says the heavy ones do work, it matches color-thief and node-vibrant, and `getPalette` was the most-used 2.x call.
- **`Palette` and `Clustering` are tagged plain `Uint8Array`s, made by plain functions,** not subclasses (a subclass breaks `toEqual(new Uint8Array(…))` in users' tests) and not `class`es.
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
  - smoothing palettes across frames.
- **Deferred to 4.0** (ROADMAP "4.0"): premultiplied alpha, with `RawImage` as a union split by `format` and unknown image keys rejected; narrowed result types.

When the maintainer settles a new question, it is added here, or to the ROADMAP if it is a plan or a deferral, in the same change.
