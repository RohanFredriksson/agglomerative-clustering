# Design: warn on RGB bytes passed bare (3.5.0)

Value brief: `docs/superpowers/briefs/2026-11-23-bare-rgb-brief.md` (maintainer's choice: option (b), a warning in 3.x and an error in 4.0). Measurements and the candidate check: `bench/spikes/bare-rgb/` (`check.mjs`, `results.txt`, `results-evidence.txt`). The convention for warnings is settled in PRINCIPLES "Warnings only bridge to an error in the next major".

## Intent

A bare `Uint8Array` is read as RGBA. RGB bytes passed bare, which is what sharp's plain `.raw()` gives, are misread with no error whenever their length divides by 4. The palette then maps with 1.75–3.5× the error on photos and 1.1–3.4× on grey. 3.5.0 tells the caller once, without changing any result. 4.0 makes the same check an error.

**Goals**
- Flag bare RGB in every function that takes an image, in both entries, on the caller's side, and at most once per copy of the library.
- Change no result, error or type. The only cost a caller can notice is about 0.4 ms per call (0.32 ms as first measured, before the byte-ramp rule; see the brief's "Changed during implementation"), and nothing once it has warned.
- Make the warning teach: what was seen, both fixes, and that 4.0 rejects it.

**Non-goals**
- 1- and 2-channel grey (no measured rule; ROADMAP "Larger, later").
- Inspecting `ImageData` or `{ data, format }` input: those have said what their bytes are.
- Any option, setter or export to control warnings.

**Anti-goals**, failures even if it works:
- A false positive on real RGBA. The brief measured 0 of 2,103; any change to the rule must be measured again in `bench/spikes/bare-rgb/`.
- Spending the one warning on a call that fails its own checks, which leaves the corrected call silent.
- Two warnings for one call: the worker thread's copy of the library warning as well as the caller's.

## Approaches

The maintainer chose between them in the brief:
- **(a) A 4.0 throw only.** Nothing new in 3.x.
- **(b) A 3.x warning that becomes the 4.0 throw. Chosen.**

How to deliver the warning was settled with `api-steward`'s findings:
- **`process.emitWarning` where it exists, `console.warn` elsewhere.** Chosen.
- **`console.warn` only.** Rejected: Node users would get no switch and no way to catch it, and pressure for an option would follow.
- **An `onWarning` option or a global setter.** Rejected: API surface that 4.0 must remove, and state kept across calls.

When to emit it (raised by the builder check and `api-steward`):
- **As soon as the image is read.** Rejected: `load` runs before `k`, the options and the palette are checked, so a call with a bad `k` would warn and then throw, and use up the warning.
- **Once the call's own checks have passed. Chosen.** In the main entry that is just before it starts work. In the worker entry, whose other checks run in the thread, it is when the call succeeds.

## The design

### The check (`src/shared.js`)

`looksLikeRgb(bytes)` is the rule measured in `bench/spikes/bare-rgb/check.mjs`:
- **The size floor:** arrays under 192 bytes are never flagged.
- **Sampling:** 512 windows of 96 bytes, each starting on a multiple of 12, spread evenly; the whole array when it is shorter than 512 × 96 bytes.
- **The colour test:** score = (mean |d[i] − d[i−4]| + 0.05) / (mean |d[i] − d[i−3]| + 0.05). It flags when the score is above 1.25 and fewer than half of the changing 4-byte pixels have four equal bytes.
- **The grey test:** among changing 3-byte units, more than 90% have three equal bytes, and among changing 4-byte pixels, fewer than 60% have equal colour bytes.
- **The byte-ramp test** (added during implementation; the brief's "Changed during implementation"): arrays whose bytes mostly rise by one fixed non-zero step (`(i * k) & 255`, the usual fake image in tests) are never flagged.

### One gate for both entries (`src/shared.js`)

`bareRgbWarning(image)` returns `'rgb-as-rgba'` or `null`. It returns `null` at once in any of these cases:
- `rgb-as-rgba` was already warned, or this copy is silenced;
- `image` isn't a bare `Uint8Array`;
- it is a `Palette` or `Clustering`: a palette of 64 colours or more is flat RGB bytes, exactly what the rule flags;
- `sniffImageFormat` recognises a file;
- its length isn't a multiple of 4.

Otherwise it returns the code when `looksLikeRgb` says so. `sniffImageFormat` moves to `shared.js` for this. `load` keeps its own errors as they are, and the gate only reads.

Every case the gate skips is one the main entry rejects, or one that has said what it is. So the order of checks lives in one place, and the entries can't drift apart.

### The warning (`src/shared.js`)

`warnOnce(code, bytes)`:
- **Delivery:** when `typeof globalThis.process?.emitWarning === 'function'` and the runtime is Node, Bun or Deno (no `navigator`, or a `navigator.userAgent` starting `Node.js/`, `Bun/` or `Deno/`, as `worker.js` tells them apart), it calls `process.emitWarning(message, { type: 'AgglomerativeClusteringWarning', code })`; otherwise `console.warn` with `agglomerative-clustering [code]: ` and the message. Cloudflare Workers with `nodejs_compat` has an `emitWarning` that reaches `process.on('warning')` but prints nothing (checked under `wrangler dev`), so it takes `console.warn`. A bundler's `process` polyfill has no `emitWarning`, and `globalThis.process` keeps Parcel from adding one (see `scripts/patch-glue.mjs`).
- **State:** a module-level set of codes already warned.
- **`silenceWarnings()`** (internal): marks every code as warned, so a silenced copy also skips the sampling. `worker-thread.js` calls it once at start; the thread imports the same `shared.mjs` instance as its `index.mjs`.
- **`resetWarnings()`** (internal, for tests): clears the set.
- Neither is exported from the package entries.

The message names the image by its size:

> This image (1,179,648 bytes) looks like RGB bytes (3 per pixel) passed as a bare Uint8Array, which is read as RGBA (4 per pixel) and would give wrong colours. If it is RGB, pass { data, format: 'rgb' } (sharp's .raw() gives RGB for an image without alpha unless you add .ensureAlpha()). If it really is RGBA, pass { data, format: 'rgba' } to say so. From 4.0 this is an error. Shown once.

The code is `rgb-as-rgba`.

### Where it runs

- **Main entry:** each function that takes an image calls the gate on its original `image` argument and keeps the code. It emits just before `Module || await acquire()`, once its synchronous checks (`k`, options, palette, clustering, size) have passed. A later failure (out of memory, an abort, the module failing to load) can still follow the warning. That's accepted, since those aren't mistakes in the arguments. This covers the `Clustering` methods through their function forms.
- **Worker entry:**
  - `send` calls the gate on the caller's thread for a bare `Uint8Array`, before `own`/`take`, so a `transfer: true` call hasn't moved the bytes yet.
  - The code is kept with the pending call and emitted when the thread's reply succeeds. So a call that the thread rejects (`k`, options, palette) doesn't warn, and the warning arrives after the work.
  - This covers the worker's functions and `worker.cluster(image)`.
- **Worker thread:** silenced, and still gives every error itself.

### Docs

- **`docs/api.md`:**
  - a "Warnings" subsection next to the error table, covering:
    - the one code, and what triggers it;
    - the two fixes;
    - how to silence it: by being explicit, or with Node's own switches;
    - `--trace-warnings`, to find the call site in a dependency;
    - that it is shown once per copy of the library (an app that loads both the ES-module and CommonJS builds can see it twice);
    - that 4.0 makes it an `invalid-argument` error;
  - the Input bullet "A bare `Uint8Array` is read as RGBA" gains a sentence on the warning, linking to it.
- **README:** "RGB bytes passed bare are read as RGBA; the library warns when it sees this (an error from 4.0), so pass them as `{ data, format: 'rgb' }`." No version number in the prose.
- **Guides, decoding pitfalls:** the same clause, linking to api.md "Warnings" rather than repeating the fixes.
- **`docs/stability.md:10`:**
  - add warnings to what a minor release may add;
  - a warning goes through `process.emitWarning` in Node and `console.warn` elsewhere, once per code, for a call that the next major version will reject;
  - it never changes a result, and saying what the input is (`{ data, format }`) silences it;
  - the inputs that trigger it may change in a minor release (only after measuring again for false positives), but results never do.
- **ROADMAP:**
  - "Next": the "Larger, later" item becomes item 8, "(released as 3.5.0)", keeping its reasons (the brief, 0 of 2,103, 4.0 for the throw). The header becomes "All eight are done".
  - 4.0 gets a full entry:
    - `invalid-argument` on `'image'`, on exactly the inputs 3.x warns about (or more after measuring again, never fewer);
    - it runs after the encoded-file and multiple-of-4 checks;
    - the escape hatch is `{ data, format: 'rgba' }`;
    - `rgb-as-rgba` leaves api.md "Warnings", which is then empty unless a new bridge is added.
  - The 4.0 `alpha`/`transparent` entry gains: "a 3.x warning under the convention is possible, not planned".
  - "Larger, later" gets "1- and 2-channel grey passed bare", 2-channel first (274–1,980× the error).
- **CHANGELOG:**
  - "Unreleased" becomes "Unreleased (3.5.0)", and its "Docs only" line becomes "Output is unchanged; one new warning";
  - the entry says how to silence it, and that tools which fail on console output or stderr (jest-fail-on-console, parsed stderr) will see it for bare RGB input.
- Any figures in the docs carry an HTML comment naming `bench/spikes/bare-rgb/results.txt`.

### Tests (`test/warnings.test.js`)

Each test resets the state with `resetWarnings()` and listens on `process.on('warning')`.
- **Warns once:** bare Kodak RGB with `buildPalette` gives exactly one warning, with `name` `AgglomerativeClusteringWarning`, `code` `rgb-as-rgba` and the byte count in the message. A second call gives none.
- **The console fallback:** with `process.emitWarning` hidden, it warns through `console.warn` with the prefix.
- **Silent cases:**
  - bare Kodak RGBA;
  - emoji RGBA;
  - the same RGB passed as `{ data, format: 'rgb' }` or `{ data, format: 'rgba' }`;
  - `ImageData`;
  - arrays under 192 bytes;
  - a 256-colour `Palette` or a `Clustering` passed as the image.
- **No warning on a rejected call,** in each entry: bare RGB with `k = 0`, with an unknown option, and to `quantizeWithPalette` with a bad palette. Then a corrected call warns, which shows the warning wasn't used up. Also an encoded PNG passed bare, and RGB whose length isn't a multiple of 4.
- **A pure side effect:** bare RGB gives byte-identical output to the same bytes as `{ data, format: 'rgba' }`, for `buildPalette` and `quantize`.
- **Worker entry:**
  - a bare RGB call warns exactly once, on the caller's side, after it succeeds;
  - nothing comes from the thread, including with `transfer: true`, a call made before the worker is ready, and `createWorker({ script })`.
- **The rule:** `looksLikeRgb` gives the brief's answers on a small fixed set (a Kodak photo as RGB, grey RGB, RGBA, a premultiplied white mask, an emoji), so a change to the rule fails a test. The full corpus stays in the spike.
- **The test suite itself:** `test/setup.js` listens for `AgglomerativeClusteringWarning` and fails the test that caused one. `test/warnings.test.js` opts out. The state is once per module instance, so the guard catches the first accidental warning per test file, not every one. That's enough to turn the suite's synthetic RGBA images into extra false-positive checks.

### Left to the builder

- How `looksLikeRgb` is written, as long as it decides exactly as `check.mjs` does on the spike's corpus. Rerun `measure.mjs` against the shipped function, imported from `dist/shared.mjs`.
- How each main-entry function carries the code to its emit point (one helper is expected).
- How the worker entry keeps the code with the pending call.
- The wording of the docs, within the facts above.

### Release

3.5.0, a minor release. This is new behaviour that stability.md, once amended, permits. There are no type changes, so the `test/api.test.js` snapshots stay the same.
