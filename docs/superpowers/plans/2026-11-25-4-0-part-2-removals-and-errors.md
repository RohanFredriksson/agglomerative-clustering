# 4.0 part 2: removals and new errors, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish 4.0's breaking changes: drop Node 20, turn the bare-image warnings into errors, reject `transparent` on formats without alpha, and remove the `…FromClustering` and `get…` function names from both entries.

**Architecture:** Each item is already decided in `docs/ROADMAP.md` ("4.0: breaking changes, collected"), which serves as the spec. Internal implementations stay where methods and handles need them (the engine slot in `src/shared.js`); only the public function exports go. Tests, bench and demo move to the 4.0 names first, so the removal task only deletes.

**Tech Stack:** JavaScript (ES modules, Babel to CJS), TypeScript declarations, vitest, Emscripten WebAssembly (no C++ change expected), GitHub Actions.

**Spec:** `docs/ROADMAP.md`, section "4.0: breaking changes, collected" (the bullets "Drop Node 20", "The bare-image warnings become errors", "`alpha` and `transparent` on a format without alpha throw", "Remove the `…FromClustering` functions", "Remove the `get…` names"), with `docs/PRINCIPLES.md` "Settled decisions" and `docs/stability.md`. Part 1 (premultiplied input, image keys, narrowed results) is released in 4.0.0-beta.1 and beta.2.

## Global Constraints

- `engines.node` becomes exactly `>=22.12.0`; `.babelrc` targets `node >= 22.12`; CI tests Node 22 and 24 (every matrix that lists 20).
- Every new error is made with `fail('invalid-argument', message, argument)`; no new error codes. Main entry and worker entry give the same `message`, `code` and `argument`.
- Bare-image error copy, exactly (argument `'image'`; `${n}` is the array's byte length, `toLocaleString('en-US')`, as in the 3.x warnings):
  - RGB: `Invalid image: these ${n} bytes look like RGB (3 per pixel) or grey, not RGBA, and a bare Uint8Array is read as RGBA (4 per pixel). If it is RGB, pass { data, format: 'rgb' } (sharp's .raw() gives RGB for an image without alpha unless you add .ensureAlpha()). If it is grey (fast-png's decode() of a grey PNG), expand it to RGBA: format: 'rgb' would misread it too. If it really is RGBA, pass { data, format: 'rgba' } to say so.`
  - Grey: `Invalid image: these ${n} bytes look like grey (1 per pixel), not RGBA, and a bare Uint8Array is read as RGBA (4 per pixel). fast-png's decode() gives this for a grey PNG (rows below 8 bits stay packed) and for a palette PNG's indices. Expand 8-bit grey to RGBA, or decode with something that gives RGBA (pngjs, or sharp with .ensureAlpha()); there is no grey format to pass. If it really is RGBA, pass { data, format: 'rgba' } to say so.`
  - Grey and alpha: `Invalid image: these ${n} bytes look like grey and alpha (2 per pixel), not RGBA, and a bare Uint8Array is read as RGBA (4 per pixel). fast-png's decode() gives this for a grey PNG with alpha. Expand it to RGBA, or decode with something that gives RGBA (pngjs, or sharp with .ensureAlpha()); there is no grey format to pass. If it really is RGBA, pass { data, format: 'rgba' } to say so.`
- The bare-image rule is `bareLayout` exactly as shipped in 3.6.0–4.0.0-beta.2 (same predicate: a bare `Uint8Array` that isn't a palette or clustering, after the encoded-file and multiple-of-4 checks; RGB decides first). It rejects every input 3.x warned about, every time (no "once").
- `transparent` error copy, exactly (argument `'options.transparent'`): `` Invalid transparent: '${format}' has no alpha, so no pixel can be transparent. Leave transparent out (false is accepted). `` For `'rgbx'` and `'bgrx'` it continues `` If the fourth byte really is alpha, use 'rgba' or 'bgra'. `` (the BI_RGB bitmap case that motivated the rule). Only `transparent: true` or a cutoff given in the call's own options throws, and only after the existing value check, so `transparent: 0` keeps today's `must be a boolean or an integer alpha cutoff` message; `transparent: false`, both `alpha` values, and a clustering's stored cutoff used as the default never throw.
- Removed from both entries (exports, types, worker routing): `getClustering(image)`, `getPalette(image, k)`, `getSwatches(image, k)`, `getPaletteFromClustering`, `getSwatchesFromClustering`, the function `getClusteringInfo(c)`, `quantizeFromClustering`, `quantizeToIndicesFromClustering`. Unaffected: every `get…` method on `Clustering` and handles. The 4.0 name table is in ROADMAP (under "Remove the `…FromClustering` functions").
- The worker's wire names for the clustering functions become `buildClustering`, `buildPalette`, `buildSwatches`. A worker script from another version (3.x's thread answers an unknown method with `Unknown method '…'.`) rejects with `worker-failed`, not `invalid-argument` (the caller's arguments are fine): `` The worker script is from another version of agglomerative-clustering ('${method}' is unknown to it). Use the worker-thread.mjs from this version. ``
- No error message, hint or doc names a removed function (the clustering-as-image hint in `load` points at `clustering.getPalette(k)` / `clustering.quantize(image, k)`).
- Golden hashes (`test/golden.json`) must not change; clustering and mapping output is untouched.
- Commits are authored as the repo's git user, with no Co-Authored-By or Claude-Session trailers. No `await using` in tests (Node 22 can't parse it).

## Review Focus

1. **A real RGBA image the rule misreads is now refused, not warned about.** Kodak photos, a flat UI screenshot, grey-looking RGBA and a premultiplied white mask, as bare arrays, must still be accepted. Task 2 pins this on the existing `test/bare-rgb-check.test.js` / `test/bare-grey-check.test.js` "passes" cases (now asserting no throw), and re-runs the corpus measurements.
2. **Shared option objects across formats.** `{ transparent: false, alpha: 'ignore' }` with an `'rgb'` image keeps working. A clustering made from RGBA with `transparent: true`, then `clustering.quantizeToIndices(rgbImage, k)` with no options, uses the stored cutoff and doesn't throw. Task 3 tests both.
3. **A 3.x worker script with a 4.0 entry** (`createWorker({ script })` pointing at an old `worker-thread.mjs`): after the wire rename the entry sends `buildClustering`, which a 3.x thread rejects as an unknown method. It must reject with the Global Constraints `worker-failed` message, not hang and not blame the caller's arguments. Task 5 tests it with a stub worker script that answers every call as 3.8's thread answers an unknown method.
4. **Check order on bare arrays.** An encoded PNG passed bare still gets the encoded-file error, and a length that isn't a multiple of 4 still gets its own error, before the bare-layout check. Task 2 tests both.
5. **No message names a removed function.** Task 5 adds a test that scans the built `dist/*.mjs` and `dist/*.cjs` strings and the docs for the removed names.

---

### Task 1: Drop Node 20

**Files:**
- Modify: `package.json` (`engines`), `.babelrc` (targets), `.github/workflows/ci.yml` (the `[20, 22, 24]` and `[20, 24]` matrices), `.github/workflows/published.yml` (`[20, 24]`).
- Modify docs: `README.md:29`, `docs/environments.md` (lines 22 and 124: the supported list, the CI list, and "the AWS Lambda Node 20 image"), `docs/migrating.md` "From 3.x to 4.0" (a bullet: Node 22.12+; Node 20 users stay on 3.8, patched on request), `CHANGELOG.md` `## 4.0.0` Breaking, `CLAUDE.md` (the `engines` text and "Node 20/22/24 CI matrix").
- Test: `test/cjs.test.js` or a new `test/engines.test.js`.

- [ ] **Step 1:** Write `'engines and Babel targets agree on Node 22.12'`: `package.json`'s `engines.node` is `'>=22.12.0'`, and `.babelrc`'s targets string contains `node >= 22.12`. Run `npx vitest run test/engines.test.js`; expected FAIL.
- [ ] **Step 2:** Make the changes listed under Files. Windows and published-package matrices become `[22, 24]`; the main test matrix `[22, 24]`. Any `if: matrix.node == 24` stays.
- [ ] **Step 3:** `npm run build && npm test && npm run test:types`; expected PASS. `grep -rn "Node 20\|20\.19\|node: \[20" README.md docs CLAUDE.md .github package.json .babelrc` lists only history (CHANGELOG entries for past releases, ROADMAP history).
- [ ] **Step 4:** Commit "4.0: drop Node 20 (engines >=22.12.0, CI on 22 and 24)".

### Task 2: The bare-image warnings become errors

**Files:**
- Modify: `src/shared.js` (`bareImageWarning`, `warnOnce`, `warningText`, `warned`, `silenceWarnings`, `resetWarnings`), `src/index.js` (`warningFor` and its call sites; `load`), `src/worker.js` (the three `bareImageWarning` call sites), `src/worker-thread.js` (`silenceWarnings`).
- Modify docs: `docs/api.md` "Warnings" (both codes leave it; the section says there are none, and that a warning, if one is ever added, bridges to an error in the next major), the "Input" text on bare arrays, `docs/troubleshooting.md` rows for the two warnings, `docs/migrating.md` "From 3.x to 4.0", `CHANGELOG.md` Breaking.
- Test: `test/bare-rgb-check.test.js`, `test/bare-grey-check.test.js`, `test/warnings.test.js` (becomes the error test, or is replaced by `test/bare-image-errors.test.js`).

**Interfaces:**
- Produces: `export const bareImageError = (image) => Error | null` in `src/shared.js`: the coded error from the Global Constraints copy for a bare `Uint8Array` whose `bareLayout` is `'rgb'`, `'grey'` or `'grey-alpha'`, else `null`. Same skip rules as today's `bareImageWarning` minus the `warned` set. `bareLayout` is unchanged.

- [ ] **Step 1: Failing tests.** In the check tests, every case that today expects a warning now expects the call to reject with the exact message for its layout, `code: 'invalid-argument'`, `argument: 'image'`, on every call (two calls in a row both reject). Every "passes" case now expects no throw. Add: an encoded PNG passed bare gets the encoded-file error; a bare array of length `4n + 2` gets its length error; `{ data, format: 'rgba' }` with the same RGB-looking bytes is accepted. Worker entry: the same three layouts reject with identical message/code/argument and no `postMessage` (spy on `Worker.prototype.postMessage`), and `transfer: true` leaves the caller's array intact on rejection. Run; expected FAIL.
- [ ] **Step 2: Implement.** `load` in `src/index.js` throws `bareImageError(image)` for bare arrays after the encoded-file and length checks; the worker's `send` does the same before posting. Remove `warningFor`, `warnOnce`, `warningText`, `warned`, `silenceWarnings` and `resetWarnings` and every use (tests that called `resetWarnings` drop it). Existing tests that passed RGB- or grey-looking bare arrays as RGBA switch to `{ data, format: 'rgba' }`; list each in the report.
- [ ] **Step 3: Measure again.** Run `node bench/spikes/bare-rgb/measure.mjs` and `node bench/spikes/bare-grey/check.mjs` (or the corpus scripts their headers name) and confirm the flagged and passed counts equal those in their `results*.txt` from 3.5/3.6; record the run in the report, naming which of the two corpora actually ran. Same rule, so they must match; if a script needs network images it can't fetch, say so and skip.
- [ ] **Step 4:** `npm run build:js && npm test && npm run test:types && npx vitest run test/api.test.js`; expected PASS.
- [ ] **Step 5:** Commit "4.0: bare RGB and grey arrays are errors (rgb-as-rgba, gray-as-rgba retired)".

### Task 3: `transparent` on a format without alpha throws

**Files:**
- Modify: `src/index.js` (every function that takes `transparent`: `buildClustering`, `buildPalette`, `buildSwatches`, `quantize`, `quantizeToIndices`, `quantizeToIndicesWithPalette`, and the functions behind the `Clustering` methods `quantize` and `quantizeToIndices`).
- Modify docs: `docs/api.md` (the `transparent` row in the options table and its text: throws on `'rgb'`, `'rgbx'`, `'bgrx'` when it asks for something), `docs/migrating.md`, `CHANGELOG.md` Breaking.
- Test: `test/transparent-formats.test.js` (new).

**Interfaces:**
- Produces: `checkTransparentFormat(format, options, o)` (local to `src/index.js`): throws the Global Constraints error when `hasAlpha(format)` is false and the call's own `options.transparent` is `true` or a number. Runs after the image, `k` and options are parsed (argument order: image, k, options).

- [ ] **Step 1: Failing tests.** For each format `'rgb'`, `'rgbx'`, `'bgrx'` and each function and method above: `transparent: true` and `transparent: 128` reject with the exact message (format named), `code 'invalid-argument'`, `argument 'options.transparent'`; `transparent: false`, `alpha: 'weight'`, `alpha: 'ignore'` and no options resolve. `'rgba'` and `'bgra'` with `transparent: true` resolve as today. Review Focus 2: a clustering from an RGBA image with `transparent: true`, then `clustering.quantizeToIndices(rgbImage, 8)` with no options, resolves. Worker entry: the same cases through `createWorker()` functions, `worker.cluster(rgbImage)` then `.quantizeToIndices(8, { transparent: true })` and `.quantize(8, { transparent: true })`, and a `worker.load(clustering)` handle's `quantizeToIndices(rgbImage, 8, { transparent: true })`, give identical errors (no change in `worker-thread.js` is expected; the tests show it). `transparent: 0` on `'rgb'` gets the existing value message. Run; expected FAIL.
- [ ] **Step 2: Implement** `checkTransparentFormat` and call it in each function after options are parsed.
- [ ] **Step 3:** `npm run build:js && npm test && npm run test:types && npx vitest run test/api.test.js`; expected PASS.
- [ ] **Step 4:** Commit "4.0: transparent on a format without alpha is an error".

### Task 4: Move tests, bench and demo to the 4.0 names

No library change: the suite, the bench harness and the demo stop calling the names Task 5 removes, so Task 5's diff is only deletions.

**Files:**
- Modify: every file under `test/`, `bench/lib/`, `bench/*.js`, `bench/*.bench.js`, `test/browser/app/`, `demo/` that calls `getClustering(image)`, `getPalette(image, k)`, `getSwatches(image, k)`, `getPaletteFromClustering`, `getSwatchesFromClustering`, `getClusteringInfo(c)`, `quantizeFromClustering` or `quantizeToIndicesFromClustering`, except the tests that exist to test those functions (left for Task 5 to delete) and `test/api.test.js`.
- Not modified: `bench/spikes/**` (each spike records the version it ran against).
- `fixtures/clusterings/make.mjs` runs against old release builds too: make it use the 4.0 forms when present (`buildClustering`, `clustering.getPalette(k)`, `clustering.getClusteringInfo()`) and keep the old function forms as the fallback for builds without them. Never regenerate an existing fixture.

- [ ] **Step 1:** Rewrite each call with its 4.0 form from the ROADMAP name table: `buildClustering/buildPalette/buildSwatches(image, …)`; `clustering.getPalette(k)`, `.getSwatches(k)`, `.getClusteringInfo()`, `.quantize(image, k, options)`, `.quantizeToIndices(image, k, options)`; on the worker entry the same functions, handle methods and `worker.load(clustering)`. A test that compares a function form with its method keeps one side and says so in a comment only if the comparison was its purpose (then leave it for Task 5).
- [ ] **Step 2:** `npm test && npm run test:types`; expected PASS with the same count as before. `UPDATE_GOLDEN` is not set, and `test/golden.json` is unchanged. `CHROMIUM_PATH=$(ls -d ~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome | tail -1) npm run test:browser` passes. `npm run bench -- --run` (or `node bench/run.js --libs none --kodak-limit 1 --k 16`) runs without error.
- [ ] **Step 3:** Commit "Tests, bench and demo use the 4.0 names".

### Task 5: Remove the `…FromClustering` and `get…` functions from both entries

**Files:**
- Modify: `src/index.js` (exports; the internal implementations the engine uses stay, unexported), `src/shared.js` (engine wiring if it names the exports), `src/worker.js` (`imageFunctions`, `mappedImageFunctions`, `clusteringOnlyFunctions`, `otherFunctions`, `optionsPosition`, the `build…` aliases, wire names), `src/worker-thread.js` (`optionsIndex` and routing keys, `ac.getClustering`/`ac.getClusteringInfo` calls), `src/index.d.ts`, `src/worker.d.ts`, `test/types/*`, `test/api/*.snap.txt`.
- Modify docs: `docs/api.md` (delete "Deprecated names" and "Deprecated function forms"; fix any link to them), `docs/migrating.md` (a table from each removed name to its 4.0 form, from the ROADMAP name table), `CHANGELOG.md` Breaking, the hints and messages in `src/` that name removed functions.
- Test: delete the tests whose subject is a removed function; add `test/removed-names.test.js`.

**Interfaces:**
- Consumes: Task 4 (nothing else calls the removed names).
- Produces: wire names `buildClustering`, `buildPalette`, `buildSwatches` (worker.js sends them, worker-thread.js routes them).

- [ ] **Step 1: Failing tests** in `test/removed-names.test.js`: for both entries, `import * as entry` has none of the removed names as keys; `Clustering` methods and handle methods all still exist; the strings in every `dist/*.mjs` and `dist/*.cjs` and every file in `docs/` (except CHANGELOG history and `docs/migrating.md`'s mapping table) contain none of the removed names as a call (`getPaletteFromClustering(`, `getSwatchesFromClustering(`, `quantizeFromClustering(`, `quantizeToIndicesFromClustering(`, `getClusteringInfo(c` …; method calls like `.getPalette(` are allowed); with `createWorker({ script })` pointing at a stub worker script that answers every call as 3.8's thread answers an unknown method (`{ error: { message: "Unknown method 'buildClustering'.", code: 'invalid-argument' } }` in the reply shape `worker-thread.js` uses), `worker.buildPalette(image, 4)` rejects within 2 s (`timeLimit(2000)`) with `code: 'worker-failed'` and the Global Constraints message. In `test/types/*`: `// @ts-expect-error` on importing each removed name from both entries. Run; expected FAIL.
- [ ] **Step 2: Implement** the removal and the wire rename. `worker-thread.js` calls `ac.buildClustering(...)` and the clustering's own `getClusteringInfo()` instead of the removed functions; the handle methods `getClustering()`, `getPalette(k)`, `getSwatches(k)` and `getClusteringInfo()` stay. In `worker.js`, map a remote error whose message is `Unknown method '…'.` to the `worker-failed` error. `docs/migrating.md` adds a line for `createWorker({ script })` users: copy the new `worker-thread.mjs`. The CHANGELOG entry links the migrating table (a removed name in CommonJS is just `undefined is not a function`). Remove the `@deprecated` declarations from both `.d.ts` files. Update `test/api.test.js` only where it lists functions to check, and its removed-names list if it has one.
- [ ] **Step 3:** `npm run build:js && npm test && npm run test:types`; review the snapshot diff (only removals), then `npx vitest run test/api.test.js -u`. `npm run test:browser` passes.
- [ ] **Step 4:** Commit "4.0: remove the …FromClustering and get… functions from both entries".

### Task 6: The remaining clone error names its argument

Not a ROADMAP 4.0 item: a non-breaking fix from `api-steward`'s review of the beta 1 round fixes (PR #74), where images stopped reaching this error but options, `k`, palettes and clusterings still get `Invalid argument: …` with no `argument`. It rides on this branch because it changes the same routing code as Task 5.

**Files:**
- Modify: `src/worker.js` (the `DataCloneError` mapping, around line 529).
- Test: `test/worker.test.js` (its existing un-cloneable cases).

- [ ] **Step 1: Failing test.** For a function as `options`, a Symbol as `k`, a class as a palette (`quantizeWithPalette`), and a clustering with a function attached (`worker.load`): the rejection's message starts `Invalid options: `, `Invalid k: `, `Invalid palette: `, `Invalid clustering: ` respectively, continues `it cannot be sent to the worker (`, and has `argument` `'options'`, `'k'`, `'palette'`, `'clustering'`. Run; expected FAIL.
- [ ] **Step 2: Implement:** on `DataCloneError`, find the first argument that fails `structuredClone` alone and name it from the call's argument names (each function's parameter list is known in worker.js); fall back to today's `Invalid argument: …` only if none fails alone.
- [ ] **Step 3:** `npm run build:js && npx vitest run test/worker.test.js && npm test`; expected PASS.
- [ ] **Step 4:** Commit "Worker: a value that can't be sent names its argument".

### Task 7: The record, and cleanup

**Files:**
- Modify: `src/index.js` (drop the unused `formatHint` import).
- `docs/ROADMAP.md`: the 4.0 intro ("built in two parts… then the removals"); mark done in part 2, in past tense, the bullets "Drop Node 20", "The bare-image warnings become errors", "`alpha` and `transparent` … throw", "Remove the `…FromClustering` functions" and "Remove the `get…` names", and the narrowed-results entry that still reads as a plan; Next items 8 and 9 and the "Later, if asked for" `format: 'gray'` entry ("silence `gray-as-rgba`"), which read as live warnings.
- `docs/PRINCIPLES.md`: lines ~50–51 ("4.0 removes them", "removed in 4.0") to past tense; ~71–77 (the warnings rule stays; its history says `rgb-as-rgba` and `gray-as-rgba` became errors in 4.0, and the "keep working through 3.x … `…FromClustering` … is open" sentence goes); the "Deferred to 4.0" line (~111) becomes "Done in 4.0".
- `docs/stability.md` (~10): the warnings rule stays valid; say 4.0 has no warnings.
- `CLAUDE.md`: the removed names (the "Methods on `Clustering`" paragraph, the "Worker entry" `@deprecated` sentence), the worker routing lists, the warnings machinery ("Shown once", `AgglomerativeClusteringWarning`), Node 22.
- `CHANGELOG.md`: the `## 4.0.0` intro no longer says removals come in later betas.

- [ ] **Step 1:** Make the changes. `npx vitest run test/api.test.js`; expected PASS.
- [ ] **Step 2:** Commit "4.0: the record for part 2".

### Task 8: Whole-suite checks

- [ ] **Step 1:** `source ~/.local/share/emsdk/emsdk_env.sh && npm run build && npm test && npm run test:types`, output to a file; report counts.
- [ ] **Step 2:** `CHROMIUM_PATH=$(ls -d ~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome | tail -1) npm run test:browser`: every check `ok` in Vite, webpack and Parcel.
- [ ] **Step 3:** `scripts/asan-test.sh`, then `npm run build`: every test passes, no sanitizer reports.
- [ ] **Step 4:** `node --check` under Node 22 (podman `node:22`) on every new or changed test file.
- [ ] **Step 5:** Final branch review (the controller): `git diff master...HEAD` to a file; the code reviewer plus `roadmap-steward`, `api-steward` and `scope-steward` on Sonnet; findings as an artifact page; PR with no trailers. The user merges; then 4.0.0-beta.3.
