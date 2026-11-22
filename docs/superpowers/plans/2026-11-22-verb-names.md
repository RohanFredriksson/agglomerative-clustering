# Verb names for the functions that cluster (3.4.0): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `buildClustering`, `buildPalette` and `buildSwatches` join both entries and `AgglomerativeWorker`. `getClustering`, `getPalette` and `getSwatches` become `@deprecated` names for the very same functions. Nothing else changes.

**Architecture:**
- **Main entry:** `src/index.js` renames the three exports to their `build…` names and adds `export const getPalette = buildPalette;` (and the other two).
- **Worker entry:** `makeWorker` in `src/worker.js` builds its instance under the old names, as now. After its loops it adds `instance.buildPalette = instance.getPalette` (and the other two). Calls therefore still post the old wire names, and `worker-thread.js` and the routing tables are untouched. The shared exports get `build…` functions, with the old names as aliases.
- **Types:** `src/index.d.ts` and `src/worker.d.ts` declare each new name in full and each old name as its own `@deprecated` declaration.
- **Unchanged:** no C++, WebAssembly, format or option changes.

**Tech Stack:** JavaScript (ES modules, Babel to CJS), TypeScript declarations, vitest, Jest 30 (CJS check), Playwright/Vite/webpack browser check.

**Spec:** `docs/superpowers/specs/2026-11-22-verb-names-design.md` (approved 2026-11-22). This plan quotes its decisions; read it for the reasons.

## Global Constraints

- **Output is unchanged:** `test/golden.test.js` passes with no `UPDATE_GOLDEN`.
- **The same function, not a wrapper:** `getPalette === buildPalette` holds in `dist/index.mjs`, `dist/index.cjs`, `dist/worker.mjs`, and on every `createWorker()` instance. The same holds for the other two pairs.
- **No new options, option values, error codes or `ErrorArgument` values. No run-time deprecation warning.**
- **Unchanged:**
  - every `Clustering` method and every handle method (`handle.getClustering()` included);
  - `getPaletteFromClustering`, `getSwatchesFromClustering`, `getClusteringInfo`;
  - `worker.cluster`;
  - `src/worker-thread.js`.
- **`@deprecated`** goes only on the old function declarations, the old `AgglomerativeWorker` members and the old worker shared exports. Each tag reads: `@deprecated Renamed {@link buildX} in 3.4.0 (the same function). Removed in 4.0.`
- **Messages keep the `Invalid <thing>: ...` form.**
- **Tests import `dist/`:** run `npm run build` after every change to `src/` (`build:js` is enough; no C++ changes).
- **Long output goes to the scratchpad.** Read only the tail.
- **Commits are the user's** (memory `commits-authored-by-user`): `git -c user.name="Rohan Fredriksson" -c user.email=rohan.fredriksson@gmail.com commit …`, with no Claude trailers. Branch: `docs/3.4-names-spec`. Its first commit is the spec, this plan and the ROADMAP housekeeping already in the working tree.

## Review Focus

1. **The CommonJS build keeps the identity.** Babel's output for `export const getPalette = buildPalette` must give `require(...).getPalette === require(...).buildPalette`. This includes Jest's fallback to `clustering.cjs`. Test: Task 1 Step 1 (`cjs` case); `test/jest.test.js` in Task 4.
2. **A deprecated worker name called before the worker has started** must copy or transfer bytes and reject exactly as the new name does, because they are one function. Test: Task 1 Step 1 (`before start` case).
3. **The stale-name patterns must not flag the names that stay:**
   - `handle.getClustering()`, `clustering.getPalette(k)`, `handle.getSwatches(k)`, `getPaletteFromClustering`, `getClusteringInfo`, `worker.cluster(image)`;
   - but they must flag `getPalette(photo, 128)`, `worker.getPalette(frame, 8, { … })`, `import { getPalette }` and `{ getPalette: vi.fn() }`.

   Test: Task 3 Step 1 (pattern unit cases).
4. **Mirroring tests list both spellings.** `Object.keys(instance)` gains three keys, so `test/api.test.js` "mirrors the main entry" and the `AgglomerativeWorker` property list must both include them. Tests: Task 2 and Task 3.
5. **Code that runs against older builds** (bench `--ac`, `fixtures/clusterings/make.mjs`, `test/browser/app`, `test/published/smoke.mjs`) still works with a 3.3.0 `dist`. Test: Task 4 Step 4.

---

### Task 1: Runtime: both entries, worker instances, messages

**Files:**
- Modify: `src/index.js:741` (`getClustering`), `:758` (`getPalette`), `:833` (`getSwatches`).
- Modify: `src/worker.js`:
  - after the `for (const name of otherFunctions)` loop (`:528`), add three aliases;
  - at the shared exports (`:655-658`), the three exports and their aliases.
- Modify: the messages in `src/shared.js` (`:321`, `:392`, `:397`, `:402`, `:405`, `:449`) and the one at `src/index.js:383`. Grep `src/` for any other message naming `getClustering`, `getPalette(` or `getSwatches`.
- Test (create): `test/verb-names.test.js`.
- Test (modify): the files that assert on these messages (grep `test/` for `from getClustering`, `Palettes come from getPalette`).

**Interfaces:**
- Produces:
  - main and worker entries: `buildClustering(image, options?) → Promise<Clustering>`, `buildPalette(image, k, options?) → Promise<Palette>`, `buildSwatches(image, k, options?) → Promise<Swatches>`;
  - the old names as identical function objects;
  - the same members on `AgglomerativeWorker` instances.

- [ ] **Step 1: Write `test/verb-names.test.js`**
  - `'each old name is the new function, in the ES module build'`: for each `[old, now]` in `[['getClustering','buildClustering'],['getPalette','buildPalette'],['getSwatches','buildSwatches']]`, `expect(main[old]).toBe(main[now])` and `expect(workerEntry[old]).toBe(workerEntry[now])`.
  - `'… in the CommonJS build'`: `createRequire(import.meta.url)('../dist/index.cjs')`, the same three `toBe`.
  - `'… on a worker instance'`: `const w = createWorker()`, then `expect(w[old]).toBe(w[now])` for each pair, and `w.terminate()` in `finally`.
  - `'the new names give what the old ones gave'`: on the 64-pixel test image used by `test/api.test.js:56`:
    - `buildPalette(image, 3)` `toEqual` `getPalette(image, 3)`;
    - `buildClustering` gives bytes equal to `getClustering`'s;
    - `buildSwatches(image, 3)` `toEqual` `getSwatches(image, 3)`.
  - `'before start'`: on a fresh `createWorker()`, call `w.getPalette(image, 0)` before any other call, and `w.buildPalette(image, 0)` on another fresh one. Both reject `toMatchObject({ code: 'invalid-argument', argument: 'k' })`.
  - `'messages name the new functions'`:
    - `getPaletteFromClustering(new Uint8Array(9), 2)` rejects with a message containing `buildClustering` and not matching `/\bgetClustering\b/`;
    - `quantizeWithPalette(image, clustering)` rejects with a message containing `buildClustering`.
- [ ] **Step 2: Run it.** `npm run build:js && npx vitest run test/verb-names.test.js`. Expect FAIL, with `buildPalette` undefined.
- [ ] **Step 3: Implement.**
  - `src/index.js`: rename the three `export const`s to `build…`, and add `export const getClustering = buildClustering;` and the other two directly below each one.
  - `src/worker.js`: `instance.buildClustering = instance.getClustering;` and the other two, after the loops.
  - Shared exports: `export const buildPalette = (...args) => sharedWorker().buildPalette(...args); export const getPalette = buildPalette;` and so on.
  - Messages: replace each `getClustering` with `buildClustering` and each `getPalette` (image form) with `buildPalette`, keeping `getPaletteFromClustering` and the rest of each sentence word for word.
  - Update the tests that match these messages.
- [ ] **Step 4: Run.** `npm run build:js && npx vitest run --exclude test/api.test.js > $SCRATCH/t1.log 2>&1; tail -20 $SCRATCH/t1.log`. Expect all pass. `test/api.test.js` fails until Task 3, because the exports outrun the types and docs.
- [ ] **Step 5: Commit** "Add buildClustering, buildPalette and buildSwatches; old names are the same functions".

### Task 2: Types

**Files:**
- Modify: `src/index.d.ts:374`, `:384`, `:420`, and each doc comment naming the three (`:128`, `:203`, `:226`, `:296`, `:355`, `:378`, `:423`, `:504`; grep for the rest).
- Modify: `src/worker.d.ts`:
  - the `AgglomerativeWorker` members (`:95-98`), with a new member and a deprecated member for each;
  - the shared exports (`:131-136`).
- Test: `test/types/main.mts`, `main-commonjs.cts`, `worker.mts`, `worker-commonjs.cts`, `node-only.mts`, `shapes.mts`, `union.mts`, `disposable.mts`. Use the new names, and add one deprecated-name call per entry in `main.mts`, `main-commonjs.cts` and `worker.mts`.
- Snapshots: `test/api/index.d.ts.snap.txt`, `test/api/worker.d.ts.snap.txt`.

**Interfaces:**
- Consumes: the Task 1 runtime.
- Produces: declarations for the three new names in both files, and `AgglomerativeWorker` with six clustering members.

- [ ] **Step 1: Declare.**
  - Each new function carries today's full doc comment, with its text saying `buildClustering` where it said `getClustering`.
  - Each old name is its own `export function getPalette(image: ImageLike, k: number, options?: ClusteringOptions): Promise<Palette>;`, carrying only the deprecation tag from Global Constraints.
  - `AgglomerativeWorker` gets `buildPalette(…)` with a one-line doc and `getPalette(…)` with the tag.
  - The worker's `export const buildPalette: AgglomerativeWorker['buildPalette'];` takes the existing "The main entry's `buildPalette`, run in the shared worker" comment. `export const getPalette: AgglomerativeWorker['getPalette'];` gets the tag.
  - `Clustering`, `ClusteringHandle` and their members gain no tag.
- [ ] **Step 2: Run.** `npm run build && npm run test:types > $SCRATCH/t2.log 2>&1; tail -20 $SCRATCH/t2.log`. Expect a pass.
- [ ] **Step 3: Snapshots.** Run `npx vitest run test/api.test.js -t "snapshot" -u`. Review `git diff test/api/`: the only change should be three new declarations per file plus the three new members. Then run `npx vitest run test/api.test.js -t "declarations"` and expect a pass, including "document every exported declaration".
- [ ] **Step 4: Commit** "Types: build… names; old names @deprecated".

### Task 3: API docs, the migration guide, and `test/api.test.js`

**Files:**
- Modify: `docs/api.md`:
  - each entry renamed (`### \`buildPalette(image, k, options?)\`` and the others), with `Options:` lines unchanged;
  - a "Deprecated names" section at the end of the functions, one line: ``Deprecated names: `getClustering`, `getPalette` and `getSwatches` are the same functions as `buildClustering`, `buildPalette` and `buildSwatches`, removed in 4.0 (see [Migrating](migrating.md#deprecated-in-34-removed-in-40)).``;
  - a sentence where `buildClustering` and `worker.cluster` meet: one returns the clustering's bytes, the other a handle that keeps the image and its clustering in the worker.
- Modify: `docs/migrating.md`. Add a new top section, `## Deprecated in 3.4 (removed in 4.0)`, above `## From 2.x to 3.0`, holding the spec's four points:
  - the old-to-new table;
  - "find and replace; nothing else changes";
  - the `get…` methods that stay;
  - mock factories and spies.
- Modify: `README.md`, `docs/guides.md`, `docs/environments.md` (including the mock example at `:184`), `docs/performance.md`, `docs/troubleshooting.md`, `docs/how-it-works.md`, `demo/index.html`. Use the new names throughout. Prose that means a method writes it with its receiver.
- Modify: `test/api.test.js`.

**Interfaces:**
- Consumes: the Task 2 declarations.

- [ ] **Step 1: Change `test/api.test.js` first.**
  - Add `const deprecated = { getClustering: 'buildClustering', getPalette: 'buildPalette', getSwatches: 'buildSwatches' };`.
  - `callArguments` gains the three `build…` keys, with the same arguments as their old names.
  - "documents every function" and "lists … exactly the options" skip `deprecated` keys. The `arrayContaining` at `:202` names `buildClustering` and `buildPalette`.
  - New `it('lists each deprecated name in its own section, as the same function')`. The section `api.match(/^Deprecated names:[^\n]*$/m)` contains `` `name` `` for each old name, and `main[old]` is `toBe(main[now])`.
  - The stale-name test gains `const staleCalls = [/(?<![.\w])get(Clustering|Palette|Swatches)\b/, /\.get(Palette|Swatches)\([^,)]*,/, /\.getClustering\([^)\s]/];`. These are checked over `userDocs` plus `docs/how-it-works.md`, with the "Deprecated names" line removed from `api.md` first. On failure, report the file and the offending line.
  - A pattern unit case, `it('stale-call patterns flag the old functions and spare the names that stay')`:
    - must match: ``getPalette(photo, 128)``, ``worker.getPalette(frame, 8, { signal })``, ``import { getPalette } from``, ``{ getPalette: vi.fn() }``, ``ac.getClustering(image)``;
    - must not match: ``handle.getClustering()``, ``clustering.getPalette(k)``, ``handle.getSwatches(k)``, ``getPaletteFromClustering(c, k)``, ``getClusteringInfo(c)``, ``worker.cluster(image)``, ``buildPalette(image, k)``.
- [ ] **Step 2: Run.** `npx vitest run test/api.test.js > $SCRATCH/t3.log 2>&1; tail -30 $SCRATCH/t3.log`. Expect FAIL: missing api.md entries and stale lines in the docs, but the pattern unit case passes.
- [ ] **Step 3: Edit the docs** as listed under Files.
- [ ] **Step 4: Run** `npx vitest run test/api.test.js`. Expect a pass.
- [ ] **Step 5: Commit** "Docs: lead with the build… names; migration notes".

### Task 4: Tests, benches and scripts move to the new names; code for older builds falls back

**Files:**
- Modify: every file under `test/` and `bench/` that calls the three old names (list them with `grep -rlwE "getClustering|getPalette|getSwatches" test bench`). Change only the one-shot calls; `.getPalette(k)` on a clustering or a handle stays.
- Keep the old names on purpose in:
  - `test/cjs.test.js`;
  - `test/jest/main.jest.cjs` and `test/jest/worker.jest.cjs` (one call each);
  - `test/verb-names.test.js`.
- Fallback (new name if present, else old):
  - `bench/lib/quantizers.js:33-36`: `const build = ac.buildPalette ?? ac.getPalette;`, and likewise for `buildClustering`;
  - `fixtures/clusterings/make.mjs`;
  - `test/browser/app/main.js`.
- Modify: `test/published/smoke.mjs`. Keep the old-name calls (lines 37, 72, 80), and add: `if (typeof ac.buildPalette === 'function') { assert.strictEqual(ac.buildPalette, ac.getPalette); assert.deepStrictEqual([...await ac.buildPalette(img, 4)], [...await ac.getPalette(img, 4)]); }`. Do the same for the worker entry.

- [ ] **Step 1: Edit** as listed above.
- [ ] **Step 2: Run the suite.** `npm run build && npm test > $SCRATCH/t4.log 2>&1; tail -30 $SCRATCH/t4.log`. Expect every test to pass, including `golden`, `jest`, `bundle` and `cjs`.
- [ ] **Step 3: Run the browser check.** `npm run test:browser > $SCRATCH/t4b.log 2>&1; tail -20 $SCRATCH/t4b.log`. If Playwright's revision is missing, use the `CHROMIUM_PATH` given in CLAUDE.md. Expect a pass for Vite and webpack.
- [ ] **Step 4: Run against an older build.**
  - `npm pack agglomerative-clustering@3.3.0` into `$SCRATCH/old/` and unpack it there.
  - `node bench/run.js --ac old=$SCRATCH/old/package/dist/index.mjs --libs none --kodak-limit 1 --k 16 --sets kodak` runs.
  - `node test/published/smoke.mjs` against that copy passes (read the file's header for how it picks the package).
- [ ] **Step 5: Commit** "Tests and benches use the build… names; older builds still run".

### Task 5: Ground truth and the CHANGELOG

**Files:**
- Modify: `docs/stability.md:9`. After "add functions (with their methods on `Clustering`)", add: "Interfaces the library implements (`Clustering`, `AgglomerativeWorker`, `ClusteringHandle`) gain members when functions are added; implement them yourself only in tests, and expect to add members."
- Modify: `docs/PRINCIPLES.md`:
  - "Names follow their family" (`:44`) uses `buildPalette` as its example verb name, and no longer says "Today's … predate this rule";
  - "Compatibility" (`:53`) notes the stability.md exception;
  - "Settled decisions" gains "**The verb is `build…`** (3.4.0)", with the survey and the rejected verbs in two lines, from the spec's "The verb" section;
  - the 3.0-names decision (`:61`) notes the 3.4.0 deprecations.
- Modify: `docs/ROADMAP.md`, with every edit in the spec's "Ground truth, same change" ROADMAP list:
  - item 5's `optionsIndex` line is corrected, and item 5 is not yet marked released (that is the release commit);
  - the 4.0 removal entry names `build…` and the wire-name rename, and drops its stale-check bullet;
  - the spec's name table goes into the `…FromClustering` entry;
  - the notes on the subset-search verb, "Swatch helpers" and `buildClustering([frames])`.
- Modify: `CHANGELOG.md`. Add an `## Unreleased (3.4.0)` section with:
  - the renames;
  - the lint warning (`@typescript-eslint/no-deprecated`, `sonarjs/deprecation`);
  - the `AgglomerativeWorker` warning, linking `docs/stability.md`;
  - "output is unchanged".

- [ ] **Step 1: Edit** as listed above.
- [ ] **Step 2: Run** `npx vitest run test/api.test.js`. Expect a pass: links and anchors, and no stale names in the user docs.
- [ ] **Step 3: Commit** "Record the build… names: stability, principles, roadmap, changelog".

### Task 6: Final review

- [ ] **Step 1: Full suite.** Run `npm run build && npm test && npm run test:types`, all passing, and `git status` clean apart from the scratchpad.
- [ ] **Step 2: Reviews, in parallel.** Write `git diff master...HEAD` to `$SCRATCH/branch.diff`. Run the code reviewer, then `roadmap-steward`, `api-steward` and `scope-steward` on it, at stage `final review`.
- [ ] **Step 3: Bring the findings to the maintainer** with each finding's evidence line, and a rebuttal next to any you disagree with. Fix what they accept, then open the PR. Its body carries no Claude attribution (memory `commits-authored-by-user`).
