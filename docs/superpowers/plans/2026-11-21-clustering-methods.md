# Methods on `Clustering`: Implementation Plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax for tracking. Do the tasks in order; each ends with a commit.

**Goal:** Every `Clustering` gets five async methods: `getPalette(k)`, `getSwatches(k)`, `getClusteringInfo()`, `quantize(image, k, options?)` and `quantizeToIndices(image, k, options?)`. Each one gives exactly what its `…FromClustering` function form gives. Nothing else in the API changes.

**Architecture:**
- `markClustering` in `src/shared.js` adds the methods as non-enumerable own properties: one shared function per method, which reads `this`.
- The methods call the library through an engine slot in `shared.js`. Only `src/index.js` fills it, as it is evaluated.
- A method checks its receiver, then the engine, then forwards to the function form. The function form already validates its arguments and takes the bytes before awaiting.
- With the slot empty (a worker-only app), a method rejects with `wasm-load-failed`.
- No C++, WebAssembly exports, clustering format, worker routing or build scripts change.

**Spec:** `docs/superpowers/specs/2026-11-21-clustering-methods-design.md`, with its error messages, docs sentences and record edits, quoted verbatim where this plan says "the spec's".

## Global constraints

- **Output is unchanged:** `test/golden.test.js` passes with no `UPDATE_GOLDEN`, and every existing test passes.
- **No new exports, options, option values, error codes or `ErrorArgument` values.** `test/api.test.js` must pass with the only addition being the method checks of Task 5.
- **A `Clustering` stays a plain `Uint8Array`:** `constructor === Uint8Array`, `Object.keys` lists only indices, and `toEqual(new Uint8Array(...))` and `node:assert.deepStrictEqual` pass. `Palette` and `Clustering` stay plain functions with `Symbol.hasInstance`.
- **Error messages keep the library's forms.** `Invalid <thing>: …` for argument errors; `wasm-load-failed` messages start like the existing ones (`Could not …`).
- **Tests import `dist/`, so rebuild first.** Run `npm run build` after any change to `src/`; no `build:wasm` is needed, since no C++ changes. Emscripten is needed only if `dist/clustering.*` is missing.
- **Long output goes to the scratchpad.** Read only the tail.
- **Commits** end with the session's attribution lines.

## Review focus

1. **The engine slot's module identity.** In ESM, `dist/index.mjs` and `dist/worker.mjs` import the same `dist/shared.mjs`, so importing both fills one slot. In CJS, `index.cjs` and `worker.cjs` share `shared.cjs`. A clustering marked by one module system's copy needs that copy's main entry. Tests: Task 1 and Task 2.
2. **The worker thread itself** imports `./index.mjs`, so the slot is filled there. Clusterings revived inside the thread have working methods, which is harmless, since the thread calls the functions. Check that `revive` is unaffected.
3. **`readHeader`'s `checked` WeakSet:** the method calls `readHeader(this)` and then the function calls it again. The second call must not re-run the CRC (the array is already in the set). This is speed only, but verify it.
4. **`noOptions` naming:** the function forms' messages must stay word for word as they are. Only the method path names `clustering.getPalette`.
5. **Bundlers:** `test/bundle.test.js` passes unchanged. No new dynamic import exists, so there is nothing new for bundlers to resolve.

---

### Task 1: The engine slot and the methods (main entry)

**Files:**
- Modify: `src/shared.js`, around `markClustering` (`:224`) and `Clustering` (`:252`).
- Modify: `src/index.js`: `noOptions` (`:727`), the three cuts (`:775`, `:805`, `:837`), and a `setEngine(...)` call after the exports.
- Create: `test/methods.test.js`.

**Interfaces:**
- **Produces (`src/shared.js`):** `export const setEngine = (engine) => {…}`, where `engine` is `{getPaletteFromClustering, getSwatchesFromClustering, getClusteringInfo, quantizeFromClustering, quantizeToIndicesFromClustering, cut}`.
  - `cut(name, clustering, k, extra)` is an internal entry point, so the method path can pass its own name to `noOptions`.
  - The engine object is internal: it isn't re-exported from either entry.
- **Produces (`src/index.js`):** `noOptions(name, extra, alternative = 'quantizeFromClustering')`. The exported functions call it as today. The methods pass `'clustering.getPalette'` (and so on) and `'clustering.quantize'`.

**Steps:**
- [ ] **Engine slot.** In `shared.js`: `let engine = null; export const setEngine = (value) => {engine = value;};`.
- [ ] **The methods.** Write `const methods = {getPalette(k, ...extra) {…}, …}`, where each method:
  1. If `!isUint8Array(this)`, rejects with `invalid-clustering` on `'clustering'`: the spec's "called without its clustering" message, with `describe(this)` in place of "undefined".
  2. Otherwise calls `readHeader(this)`, letting its error reject.
  3. If `engine === null`, rejects with `wasm-load-failed`, no argument, with the spec's "main entry not loaded" message, naming the method and its function form.
  4. Only for `quantize` and `quantizeToIndices`: if `typeof image === 'number'`, rejects with `invalid-argument` on `'image'`, with the spec's `clustering.quantize(16)` message.
  5. Returns the function form's promise: `engine.quantizeFromClustering(image, this, k, options)`, `engine.cut('clustering.getPalette', this, k, extra)`, and so on.

  Each method is a plain `function` (it needs `this`). It never throws synchronously: errors are returned as `Promise.reject(...)`, so a method behaves like an `async` function, but the forwarded call still starts synchronously and takes the bytes before any await.
- [ ] **Attach them.** Build `const methodDescriptors = Object.fromEntries(Object.entries(methods).map(([name, value]) => [name, {value}]))` once, and add `Object.defineProperties(bytes, methodDescriptors)` to `markClustering`. The defaults (non-enumerable, non-writable, non-configurable) match the tags.
- [ ] **Name the method form in `index.js`'s errors.**
  - Change `noOptions` to take `alternative`.
  - Move the bodies of `getPaletteFromClustering`, `getSwatchesFromClustering` and `getClusteringInfo` into internal functions that take the name.
  - The exported functions call those with their own names, so their messages are unchanged.
  - At the end of the file: `setEngine({...})`.
- [ ] **Write `test/methods.test.js`**, importing from `../dist/index.mjs`:
  - **Equality:** for each source (`getClustering(img)`, `new Clustering(bytes)`, and a handle's `getClustering()` from `dist/worker.mjs`), each of the five methods equals its function form (`toEqual`).
  - **Inherited defaults:**
    - an OKLab clustering's `quantize(img, 8)` equals `quantizeFromClustering(img, c, 8)` and differs from it with `{colorSpace: 'rgb'}`;
    - a clustering made with `transparent: 128` gives a `transparentIndex` from `quantizeToIndices` without options.
  - **Errors:** check `code`, `argument` and the message, by `toThrow` with a regex on the key phrase:
    - a detached `getPalette` gives `invalid-clustering` / `'clustering'`;
    - `clustering.getPalette.call(palette, 4)` gives readHeader's palette message;
    - `quantize(16)` and `quantizeToIndices(16)` give `invalid-argument` / `'image'`;
    - `getPalette(4, {})` gives `invalid-argument` / `'options'`, with a message naming `clustering.getPalette` and `clustering.quantize`;
    - a v2 fixture (`fixtures/clusterings/v2.bin` wrapped in `new Clustering`) gives `unsupported-version` for `getSwatches` and `getClusteringInfo`.
  - **Plain bytes:**
    - `expect(c).toEqual(new Uint8Array(c))`;
    - `assert.deepStrictEqual(c, new Uint8Array(c))`;
    - `Object.keys(c)` equals the index keys;
    - `c.slice().getPalette === undefined`;
    - `structuredClone(c).getPalette === undefined`.
  - **Function forms unchanged:** `getPaletteFromClustering(c, 4, {})` still names `getPaletteFromClustering` and `quantizeFromClustering`.
- [ ] **Run the tests:** `npm run build && npx vitest run test/methods.test.js test/api.test.js test/errors.test.js > $S/t1.txt 2>&1; tail -30 $S/t1.txt`. Expect them to pass. `api.test.js` may fail only on the declaration snapshot, which Task 3 updates.
- [ ] **Commit:** "Methods on Clustering: getPalette, getSwatches, getClusteringInfo, quantize, quantizeToIndices".

### Task 2: Without the main entry, and across module systems

**Files:**
- Create: `test/methods-worker-only.test.js` (ESM, imports only `../dist/worker.mjs`).
- Modify: `test/cjs.test.js`, `test/inputs.test.js`, and the browser app's checks under `test/browser/app/`.

**Steps:**
- [ ] **`test/methods-worker-only.test.js`.**
  - Its imports are only from `../dist/worker.mjs`. Vitest isolates files, so `index.mjs` isn't loaded in it; assert that with a guard: the file never imports it.
  - `await getClustering(img)` from the worker entry, then every method rejects with `code: 'wasm-load-failed'`, `argument: undefined`. The message contains `'agglomerative-clustering'` and the method's function form.
  - Then `await import('../dist/index.mjs')`, and the same methods resolve. This proves the slot is shared within ESM, in that import order.
  - Call `terminate()` in `afterAll`.
- [ ] **`test/cjs.test.js`.**
  - With `require('../dist/worker.cjs')` alone in a child process (`node -e`, so no ESM main entry is loaded), a method rejects with `wasm-load-failed`.
  - After `require('../dist/index.cjs')`, it resolves.
  - A clustering marked by `index.cjs` has working methods.
- [ ] **`test/inputs.test.js`.** Add `clustering.quantize(image, k)` and `clustering.quantizeToIndices(image, k)` to the table of calls whose image is changed right after the call. Both entries' clusterings, with the main entry loaded.
- [ ] **Browser app.** Import both entries, make a clustering with the worker entry, and check that `clustering.getPalette(4)` equals `getPaletteFromClustering(clustering, 4)`.
- [ ] **Run the tests:**
  - `npm run build && npx vitest run test/methods-worker-only.test.js test/cjs.test.js test/inputs.test.js test/jest.test.js > $S/t2.txt 2>&1; tail -30 $S/t2.txt`;
  - `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome BUNDLERS=vite npm run test:browser > $S/b.txt 2>&1; tail -20 $S/b.txt`.
- [ ] **Commit:** "Clustering methods: reject without the main entry, tested in both module systems and a browser".

### Task 3: Types

**Files:**
- Modify: `src/index.d.ts` (`class Clustering`, `:135`).
- Modify: `src/worker.d.ts` (the hover comment, `:14`).
- Modify: `test/types/main.mts`, `main-commonjs.cts`, `node-only.mts`, `worker.mts`.
- Modify: `test/api/*.snap.txt`.

**Steps:**
- [ ] Add the spec's five declarations, with their doc comments, to `class Clustering` (`this: Clustering` on each).
- [ ] Replace the `worker.d.ts` comment with the spec's sentence.
- [ ] **Type tests.**
  - Each method's result type: `Palette`, `Swatches`, `ClusteringInfo`, `ImageResult<I>` (a `RawImage` stays a `RawImage`, an `ImageData` stays an `ImageData`), and `IndexedImage`.
  - `@ts-expect-error` for `const { getPalette } = c; getPalette(4)`, for `c.quantize(16)`, and for `c.getPalette(4, {})`.
  - Add `interface Mine extends Clustering {}` and check it compiles.
  - The Node-only config compiles.
- [ ] **Run:** `npm run build && npm run test:types > $S/t3.txt 2>&1; tail -20 $S/t3.txt`.
- [ ] **Snapshots.** Run `npx vitest run test/api.test.js -u`, review `git diff test/api/` (only the five members and the comment should be added), and re-run without `-u`.
- [ ] **Commit:** "Clustering methods: declarations and type tests".

### Task 4: Docs

**Files:**
- Modify: `docs/api.md`: a new "Clustering methods" section after "Palette and Clustering", the `…FromClustering` entries, "Worker entry", "TypeScript", and the error table.
- Modify: `README.md` (the slider example `:73-80`, and the table `:95-102`).
- Modify: `docs/guides.md` (the cluster-once recipes and the slider).
- Modify: `demo/index.html`.

**Steps:**
- [ ] **The api.md "Clustering methods" section.**
  - A short intro: what the methods are, and that `new Clustering(bytes)` gets them.
  - A `####` per method, with `Options:` lines for `quantize` and `quantizeToIndices` that list the same keys as their function forms.
  - The thread and cast caveats.
- [ ] Each `…FromClustering` entry starts with "The function form of `clustering.…`."
- [ ] Add the spec's sentences to "Worker entry" and "TypeScript", and extend the `wasm-load-failed` row.
- [ ] **README.**
  - The slider uses `clustering.getPalette(k)`.
  - The table's middle column reads like "`clustering.getPalette(k)` (`getPaletteFromClustering`)", with a footnote for worker users.
  - Update the paragraph under the table.
- [ ] **Guides and demo.**
  - Switch the cluster-once recipes, the slider and the demo to the methods.
  - Leave `chooseThreads` and `improveThreads` alone unless the method form reads better. `test/recipes.test.js` keeps them in step with the text.
- [ ] **Run:** `npx vitest run test/api.test.js test/recipes.test.js > $S/t4.txt 2>&1; tail -30 $S/t4.txt`. Expect `api.test.js` to fail only for the method `Options:` lists, which Task 5 teaches it to read. Links and anchors must pass.
- [ ] **Commit:** "Clustering methods: API reference, README, guides and demo".

### Task 5: `test/api.test.js` reads the methods

**Files:** modify `test/api.test.js`.

**Steps:**
- [ ] **Check the methods exist.** A `Clustering` from `getClustering` has exactly the five method names as non-enumerable own properties, and `docs/api.md` has a `####` entry for each, as `clustering.<name>(`.
- [ ] **Compare the `Options:` lists.** For `clustering.quantize` and `clustering.quantizeToIndices`, compare the listed keys with the keys their function forms enforce (reuse `enforcedKeys('quantizeFromClustering')` and `enforcedKeys('quantizeToIndicesFromClustering')`).
- [ ] **Check the declarations.** `index.d.ts` declares every method name that the run-time object has, and no others.
- [ ] **Run:** `npx vitest run test/api.test.js > $S/t5.txt 2>&1; tail -20 $S/t5.txt`. Expect it to pass.
- [ ] **Commit:** "api test: methods on Clustering are documented, declared and listed with their options".

### Task 6: Record edits

**Files:** `CHANGELOG.md`, `docs/ROADMAP.md`, `docs/PRINCIPLES.md`, `CLAUDE.md`.

**Steps:**
- [ ] **CHANGELOG, under "Unreleased", "Added":**
  - the five methods;
  - that `slice`, `subarray` and clones give plain bytes without them;
  - that `Clustering`'s type gained members (a hand-written `interface X extends Clustering` declaring its own `getPalette` or `quantize` could clash);
  - that the methods need the main entry on the calling thread.
- [ ] **ROADMAP:** every edit in the spec's "Record edits":
  - item 4 done, with its open questions answered;
  - the "Larger, later" entry folded into it;
  - the `getInfo` and "already a class" corrections;
  - three "Considered" entries;
  - the fixed-subset and swatch-helper notes;
  - the 4.0 additions, and the 4.0 note with its three ways out.
- [ ] **PRINCIPLES:** the new settled decision on how the methods work, with its rejected alternatives. (The naming rules, the methods rule and the `get…` decisions already landed before implementation; check that nothing in this branch contradicts them.)
- [ ] **CLAUDE.md:** in the `Palette`/`Clustering` paragraph, replace "duplicated in `src/worker.js`" with the methods and the engine slot that only `index.js` fills, and say that methods forward to the function forms (so a change to a function form changes its method).
- [ ] **Run:** `npx vitest run test/api.test.js > $S/t6.txt 2>&1; tail -10 $S/t6.txt`. It checks the links and anchors in the docs.
- [ ] **Commit:** "Record the Clustering methods: changelog, roadmap, principles and CLAUDE.md".

### Task 7: Full verification and final review

**Steps:**
- [ ] **Full suite:** `npm run build && npm test > $S/all.txt 2>&1; tail -40 $S/all.txt`. Expect every test to pass, and `test/golden.test.js` to pass untouched.
- [ ] **Types:** `npm run test:types`.
- [ ] **Browser:** `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:browser`, with both bundlers.
- [ ] **Diff for the reviewers:** `git diff master...HEAD > $S/branch.diff`.
- [ ] **Final review, run in parallel:**
  - `api-steward`, `roadmap-steward` and `scope-steward` on `$S/branch.diff`, at stage `final review`;
  - a code review of the branch.
- [ ] Fix what they find, or note a rebuttal next to each finding. Re-run the affected tests.
- [ ] Summarise the reviews' verdicts and findings, with evidence lines, in the message that asks the maintainer to merge. Open a PR only if the maintainer asks.
