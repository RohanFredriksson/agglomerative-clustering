# Bare RGB Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn once, through `process.emitWarning` or `console.warn`, when a bare `Uint8Array` passed as an image looks like RGB bytes, without changing any result. Ships as 3.5.0.

**Architecture:** One check and one gate in `src/shared.js`, used by both entries. The main entry asks the gate about each image and emits just before it starts work. The worker entry asks on the caller's thread and emits when the call succeeds. The worker thread's copy is silenced.

**Tech Stack:** plain ES modules (Babel to `.mjs`/`.cjs`), vitest, Node `worker_threads`.

**Spec:** `docs/superpowers/specs/2026-11-23-bare-rgb-warning-design.md`, from the brief `docs/superpowers/briefs/2026-11-23-bare-rgb-brief.md`. The rule's reference implementation is `bench/spikes/bare-rgb/check.mjs`.

## Global Constraints

- **Code** `rgb-as-rgba`, **type** `AgglomerativeClusteringWarning`, delivered with `process.emitWarning(message, { type, code })` when `typeof globalThis.process?.emitWarning === 'function'`, else `console.warn('agglomerative-clustering [rgb-as-rgba]: ' + message)`.
- **The message, verbatim except for the byte count** (formatted with `toLocaleString('en-US')`):
  `This image (1,179,648 bytes) looks like RGB bytes (3 per pixel) passed as a bare Uint8Array, which is read as RGBA (4 per pixel) and would give wrong colours. If it is RGB, pass { data, format: 'rgb' } (sharp's .raw() gives RGB unless you add .ensureAlpha()). If it really is RGBA, pass { data, format: 'rgba' } to say so. From 4.0 this is an error. Shown once.`
- **The rule's constants:**
  - floor of 192 bytes;
  - 512 windows of 96 bytes, starting on multiples of 12 (the whole array when it is at most 512 × 96 bytes);
  - eps 0.05 and colour threshold 1.25, with four-equal-bytes share < 0.5;
  - grey test: equal triples > 0.9 and equal colour bytes < 0.6.
- **Exports:** nothing new is exported from `index.js` or `worker.js`. No type changes, so `test/api/*.snap.txt` stays unchanged.
- **Results:** no result, error message or error order changes. `test/golden.test.js` and `test/validation-order.test.js` must pass untouched.
- **Commits:** authored by the user, no attribution trailers: `git -c user.name="Rohan Fredriksson" -c user.email=rohan.fredriksson@gmail.com commit`.
- **Build before tests:** they import `dist/`. Run `npm run build:js` after JS changes. A full `npm run build` needs `em++` (`source ~/.local/share/emsdk/emsdk_env.sh`); no C++ changes here.
- **Timing:** `process.emitWarning` emits on `process.nextTick`. Tests await `new Promise((r) => setImmediate(r))` before counting warnings.

## Review Focus

1. **A Node `Buffer` from sharp.** It is a `Uint8Array` (tag `[object Uint8Array]`), often a view into a pooled `ArrayBuffer` at a non-zero `byteOffset`. It must be checked like any bare array, sampling only its own range. Test in Task 1.
2. **The CommonJS build** (`dist/index.cjs`, with its own `shared.cjs`) warns too, once per copy. Test in Task 2.
3. **A bundler's `process` polyfill without `emitWarning`** (webpack/Vite shims) must fall back to `console.warn` and not throw. Test in Task 2, with `emitWarning` hidden.
4. **Several bare-RGB calls made before the module has loaded**, all in flight together, give exactly one warning, not one per call. Test in Task 2.
5. **A worker created with `transfer: true`, called before it is ready**: the check runs before `take` empties the array, and the warning still comes once. Test in Task 3.

---

### Task 1: The check and the gate

**Files:**
- Modify: `src/shared.js`: add `looksLikeRgb`, `bareRgbWarning`, the warned-codes state, and `sniffImageFormat` (moved from `src/index.js`, with its `ascii` helper).
- Modify: `src/index.js:315-360`: delete the moved code and import `sniffImageFormat` from `./shared.js`. `load` keeps its error unchanged.
- Modify: `bench/spikes/bare-rgb/measure.mjs`: also import the shipped `looksLikeRgb` from `../../../dist/shared.mjs`, and print `Shipped check decided differently from check.mjs: N of M images`.
- Test: `test/bare-rgb-check.test.js` (new).

**Interfaces:**
- Produces:
  - `looksLikeRgb(bytes: Uint8Array): boolean`: the rule, deciding exactly as `check.mjs` does;
  - `bareRgbWarning(image: unknown): 'rgb-as-rgba' | null`: `null` when the code is already in the warned set, when `image` is not `isUint8Array`, when it `isPalette`/`isClustering`, when `sniffImageFormat(image)` is non-null, or when `image.length % 4 !== 0`; otherwise `'rgb-as-rgba'` if `looksLikeRgb(image)`;
  - `sniffImageFormat(bytes)`: unchanged behaviour;
  - a module-level `warned: Set<string>` that Task 2's functions write to.

- [ ] **Step 1: Write the failing tests** in `test/bare-rgb-check.test.js`, importing from `../dist/shared.mjs`. They use synthetic images built in the file:
  - `rgbOf(w, h, fill)` and `rgbaOf(w, h, fill, alpha)`;
  - a 64×64 hue gradient (`hsv(x/64, 0.85, 0.3 + 0.7·y/64)`);
  - a 64×64 grey ramp (`v = round(255·(x+y)/126)`);
  - an LCG noise image.

  Assertions:
  - `looksLikeRgb(gradient as RGB) === true`, and the same at 16×16 (768 bytes, the whole-array path);
  - `looksLikeRgb(grey ramp as RGB) === true` (the grey test);
  - `looksLikeRgb(gradient as opaque RGBA) === false`;
  - `looksLikeRgb(gradient RGBA, alpha = feathered circle, transparent pixels zeroed) === false`;
  - `looksLikeRgb(premultiplied white mask: each pixel (a, a, a, a) with a = grey ramp) === false`;
  - `looksLikeRgb(noise RGB) === false` (a harmless miss: both readings look alike);
  - `looksLikeRgb(new Uint8Array(188)) === false`, under the floor;
  - **Buffer (Review Focus 1):** `looksLikeRgb(Buffer.from(gradientRgb)) === true`. The gradient RGB written at offset 4096 into a 64 KB buffer of opaque-RGBA bytes, then `new Uint8Array(big.buffer, 4096, n)`, also gives `true`: only its own range is sampled;
  - `bareRgbWarning(gradientRgb) === 'rgb-as-rgba'`;
  - `bareRgbWarning` is `null` for each of:
    - `{ data: gradientRgb, format: 'rgba' }`;
    - `new Palette(gradientRgb.subarray(0, 768))` (256 colours);
    - a PNG signature followed by the gradient bytes;
    - a length of 4n+2;
    - a `Uint8ClampedArray`.

- [ ] **Step 2: Run to verify they fail.** `npm run build:js && npx vitest run test/bare-rgb-check.test.js`. Expected: FAIL, `looksLikeRgb is not a function`.

- [ ] **Step 3: Implement** the two functions in `src/shared.js`, and move `sniffImageFormat`. `looksLikeRgb` is `check.mjs`'s `looksLikeRgb` with `MIN_BYTES` inlined; only the colour-score line differs in form, `(e4 / n + 0.05) / (e3 / n + 0.05)`. The grey counts skip units equal to the unit before, exactly as in `check.mjs`.

- [ ] **Step 4: Run to verify they pass.** Same command. Expected: PASS. Then `npx vitest run test/validation.test.js test/validation-order.test.js test/inputs.test.js`: PASS, since the encoded-file errors are unchanged.

- [ ] **Step 5: Check against the corpus.** `node bench/spikes/bare-rgb/measure.mjs > bench/spikes/bare-rgb/results.txt` (needs `fixtures/images/bare-rgb/`; run `fetch-images.mjs` first if missing). Expected: the line `Shipped check decided differently from check.mjs: 0 of 4038 images`.

- [ ] **Step 6: Commit** `src/shared.js src/index.js test/bare-rgb-check.test.js bench/spikes/bare-rgb/measure.mjs bench/spikes/bare-rgb/results.txt`. Message: "Bare RGB: the check and the gate, in shared.js".

---

### Task 2: The warning in the main entry

**Files:**
- Modify: `src/shared.js`: `warnOnce`, `silenceWarnings`, `resetWarnings`.
- Modify: `src/index.js`, each function that takes an image: `buildClustering` (741), `buildPalette` (760), `quantize` (887), `quantizeFromClustering` (908), `quantizeWithPalette` (925), `quantizeToIndices` (942), `quantizeToIndicesFromClustering` (963) and `quantizeToIndicesWithPalette` (983). `buildSwatches` warns through `buildClustering` and needs no change.
- Modify: `test/setup.js`: the guard.
- Test: `test/warnings.test.js` (new).

**Interfaces:**
- Consumes: `bareRgbWarning` and `warned` (Task 1).
- Produces:
  - `warnOnce(code: 'rgb-as-rgba', byteLength: number): void`: adds `code` to `warned` and delivers the Global Constraints message. It is a no-op if the code is already there.
  - `silenceWarnings(): void`: adds every known code to `warned`, so the gate also skips the sampling.
  - `resetWarnings(): void`: clears `warned`; for tests only.
  - None of them is exported from the package entries.

- [ ] **Step 1: Write the failing tests** in `test/warnings.test.js`. It sets `globalThis.__acExpectWarnings = true` (the setup guard's opt-out), calls `resetWarnings()` in `beforeEach`, and collects `process.on('warning')` events whose `name` is `AgglomerativeClusteringWarning`. It uses Task 1's synthetic images: a 64×64 gradient as RGB is "bare RGB".
  - `warns once`: `await buildPalette(bareRgb, 8)`, then a tick, gives one warning with `code === 'rgb-as-rgba'` and a message containing `(12,288 bytes)` and `From 4.0 this is an error`. A second `buildPalette(bareRgb, 8)` adds none.
  - `every image function warns`: in turn, after `resetWarnings()`, each of `buildClustering`, `buildSwatches`, `quantize`, `quantizeWithPalette` and `quantizeToIndices` gives exactly one, as does `clustering.quantize(bareRgb, 4)` on a `Clustering`.
  - `silent`:
    - bare gradient RGBA;
    - `{ data: bareRgb, format: 'rgb' }`;
    - `{ data: bareRgb, format: 'rgba' }`;
    - `new ImageData(...)` of the RGBA;
    - `new Uint8Array(188)`;
    - a 256-colour `Palette` (rejects with `invalid-argument`) and a `Clustering` passed as the image.

    Each gives 0 warnings.
  - `not spent on a rejected call`: bare RGB with `k = 0`, with `{ bogus: 1 }`, and to `quantizeWithPalette(bareRgb, new Uint8Array(4))` each reject and give 0 warnings. A following valid `buildPalette(bareRgb, 8)` gives 1.
  - `rejected images never warn`: a PNG signature followed by the gradient bytes, and the RGB bytes trimmed to a length of 4n+2: both reject, 0 warnings.
  - `pure side effect`: `buildPalette(bareRgb, 8)` and `buildPalette({ data: bareRgb, format: 'rgba' }, 8)` give `toEqual` bytes, and the same for `quantize(…, 8)`'s `data`.
  - `console fallback` (Review Focus 3): with `process.emitWarning` replaced by `undefined` (restored in `finally`) and `console.warn` spied, one call gives one `console.warn` call. Its first argument starts with `agglomerative-clustering [rgb-as-rgba]: This image`.
  - `concurrent first calls` (Review Focus 4): run in a child process (`node --input-type=module -e`), so the module hasn't loaded yet. It fires `Promise.all` of three `buildPalette(bareRgb, 8)` calls, then counts warnings with `process.on('warning')`, which must be exactly `1`.
  - `CommonJS copy` (Review Focus 2): a child process that `require`s `dist/index.cjs` and makes one bare-RGB call prints exactly one `rgb-as-rgba` warning to stderr.

- [ ] **Step 2: Add the guard to `test/setup.js`.** Install it once per process (a `globalThis` flag). It records each `AgglomerativeClusteringWarning` whose test file hasn't set `globalThis.__acExpectWarnings`, and an `afterEach` fails with the recorded messages if any were recorded, then clears them.

- [ ] **Step 3: Run to verify they fail.** `npm run build:js && npx vitest run test/warnings.test.js`. Expected: FAIL (`resetWarnings is not a function`, or 0 warnings where 1 is expected).

- [ ] **Step 4: Implement.** Add the three functions to `src/shared.js`. In each listed function of `src/index.js`, take `const warning = bareRgbWarning(image)` as its first statement, before `image = load(image)` reassigns it. Then call `if (warning) {warnOnce(warning, …byteLength)}` on the line before `const wasm = Module || await acquire();`. One small helper in `index.js` is expected.

- [ ] **Step 5: Run to verify they pass.** `npx vitest run test/warnings.test.js test/bare-rgb-check.test.js`. Expected: PASS.

- [ ] **Step 6: Run the whole suite.** `npm test`. Expected: all pass, and the setup guard fails nothing. A guard failure means an existing test passes bare RGB. Find out why: an intended misread gets `globalThis.__acExpectWarnings = true` with a comment; otherwise the test's input is wrong. Report which it was.

- [ ] **Step 7: Commit** `src/shared.js src/index.js test/setup.js test/warnings.test.js`. Message: "Bare RGB: warn once in the main entry".

---

### Task 3: The worker entry and thread

**Files:**
- Modify: `src/worker.js`, the `imageFunctions` loop (around line 520) and `instance.cluster` (579).
- Modify: `src/worker-thread.js`: call `silenceWarnings()` at the top level, after the imports.
- Test: `test/warnings.test.js`: a `describe('worker entry')` block.

**Interfaces:**
- Consumes: `bareRgbWarning`, `warnOnce`, `silenceWarnings` (Tasks 1 and 2), imported from `./shared.js`.
- Produces: no new names.

- [ ] **Step 1: Write the failing tests:**
  - `worker call warns once, on the caller's side, after it succeeds`: `createWorker()` from `../dist/worker.mjs`, then `await worker.buildPalette(bareRgb, 8)`, gives 1 warning in this process. A second call gives none.
  - `worker.cluster(bareRgb)` gives 1.
  - `not on a rejected call`: `worker.buildPalette(bareRgb, 0)` rejects, 0 warnings. Then a valid call gives 1.
  - `a palette passed to the worker as the image` (256 colours) rejects, 0 warnings.
  - `transfer: true before ready` (Review Focus 5): `createWorker({ transfer: true })`, then at once `worker.buildPalette(bareRgb, 8)` (the array empties), gives exactly 1 warning. The message names the original byte count.
  - `nothing from the thread`: a child process that runs one worker bare-RGB call and one `createWorker({ script })` call, with `script` pointing at `dist/worker-thread.mjs`. Its stderr contains `rgb-as-rgba` exactly once. Node forwards a worker thread's own `emitWarning` output to stderr, so a second line would show a thread warning.
  - Each test terminates its worker.

- [ ] **Step 2: Run to verify they fail.** `npm run build:js && npx vitest run test/warnings.test.js -t "worker"`. Expected: FAIL, 0 caller-side warnings.

- [ ] **Step 3: Implement.**
  - In both paths of `src/worker.js`, take `const warning = bareRgbWarning(image)` before `send(image)`, and keep the original `image.byteLength` in a local.
  - After `await invoke(...)` resolves, call `if (warning) {warnOnce(warning, byteLength)}` and only then return.
  - The `signal.aborted` path throws before invoking, so it never warns.
  - In `src/worker-thread.js`, call `silenceWarnings()`.

- [ ] **Step 4: Run to verify they pass.** `npx vitest run test/warnings.test.js`, then `npx vitest run test/worker*.test.js test/methods-worker-only.test.js test/bundle.test.js`. Expected: PASS.

- [ ] **Step 5: Commit** `src/worker.js src/worker-thread.js test/warnings.test.js`. Message: "Bare RGB: warn on the caller's side in the worker entry, silence the thread".

---

### Task 4: Docs and records

**Files:**
- Modify: `docs/api.md`: a "Warnings" subsection after the error table, and a sentence and link in the Input bullet "A bare `Uint8Array` is read as RGBA" (line 83).
- Modify: `README.md:85`, `docs/guides.md:97`, `docs/stability.md:10`, `docs/ROADMAP.md` (lines 45, 82, 86 and the 4.0 section), and `CHANGELOG.md` ("Unreleased").
- Test: `test/api.test.js` (existing; it checks links, anchors and names in the docs).

**Interfaces:** none.

- [ ] **Step 1: Write the docs**, following the spec's "Docs" section point by point.
  - **The "Warnings" subsection** has the heading `### Warnings`, so the anchor is `#warnings`. Its content:
    - the code and what triggers it;
    - the two fixes;
    - silencing: by being explicit, `--no-warnings`/`NODE_NO_WARNINGS=1`, or `process.on('warning')` and filtering by `code`;
    - `--trace-warnings` to find the call site;
    - "once per copy of the library (an app that loads both the ES-module and CommonJS builds can see it twice)";
    - that in the worker entry it comes after the call succeeds;
    - "From 4.0 this is an `invalid-argument` error".
  - **Figures** carry `<!-- bench/spikes/bare-rgb/measure.mjs → results.txt -->`.
  - **README:** "RGB bytes passed bare are read as RGBA; the library warns when it sees this (an error from 4.0), so pass them as `{ data, format: 'rgb' }`." No version number in the prose.
  - **The guides bullet:** the same clause, linking to `api.md#warnings`.
  - **stability.md**, in the line 10 paragraph:
    - warnings join the list of what a minor release may add;
    - a warning goes through `process.emitWarning` in Node and `console.warn` elsewhere, once per code, for a call that the next major version will reject;
    - it never changes a result, and saying what the input is (`{ data, format }`) silences it;
    - the inputs that trigger it may change in a minor release, only after measuring again for false positives, but results never do.
  - **ROADMAP:**
    - line 45 becomes "All eight are done (3, 6 and 7 as recipes)";
    - item 8, "**Warning on RGB bytes passed bare (released as 3.5.0).**", moves from "Larger, later" with its reasons: the brief, 0 of 2,103, the warning convention in PRINCIPLES;
    - line 82 is adjusted to match;
    - "Larger, later" gets "1- and 2-channel grey passed bare" (no measured rule yet; 2-channel first, 274–1,980× the error; ignore fast-png's packed rows, which no byte test can repair);
    - the 4.0 section gets the spec's full entry for the throw;
    - the 4.0 `alpha`/`transparent` entry gains "a 3.x warning under the convention is possible, not planned".
  - **CHANGELOG:** "## Unreleased" becomes "## Unreleased (3.5.0)", and the line "Docs only: output and the API are unchanged" becomes "Output is unchanged; one new warning". The new entry covers:
    - the warning and its code;
    - how to silence it;
    - that tools which fail on console output or stderr (jest-fail-on-console, parsed stderr) will see it for bare RGB input.

- [ ] **Step 2: Run the docs checks.** `npx vitest run test/api.test.js`. Expected: PASS, with no broken anchor or link.

- [ ] **Step 3: Commit** the six docs files. Message: "Bare RGB: docs, stability promise, ROADMAP and CHANGELOG for 3.5.0".

---

### Task 5: Whole-branch verification and review

**Files:** none changed unless a check fails.

- [ ] **Step 1: Run the full checks.** Expected: all pass.
  - `source ~/.local/share/emsdk/emsdk_env.sh && npm run build`
  - `npm test`
  - `npm run test:types`
  - `npm run test:browser`, which needs Chromium (see CLAUDE.md for `CHROMIUM_PATH`).
- [ ] **Step 2: Run the final review** (CLAUDE.md "Design review"). Write `git diff master...HEAD` to a file in the scratchpad, then run in parallel `roadmap-steward`, `api-steward` and `scope-steward` on it (stage `final review`), plus a code review of the diff.
- [ ] **Step 3: Fix confirmed findings** (one commit each). Then report the verdicts to the maintainer, with each finding's evidence line, before opening the PR.
