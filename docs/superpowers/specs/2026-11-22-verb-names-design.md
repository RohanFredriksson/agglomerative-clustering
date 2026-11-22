# 3.4.0: verb names for the functions that cluster

ROADMAP item 5. It carries out the 3.3.0 settled decision "`get…` means a read, from 4.0" (PRINCIPLES): the three functions that cluster an image get verb names, the old names keep working through 3.x as `@deprecated` copies, and 4.0 removes them.

## Why

- `getPalette(image, k)` clusters a whole image (about 70 ms on a photo). `clustering.getPalette(k)` reads a stored clustering (about 0.4 ms). Since 3.3.0 they sit side by side, under one name.
- From 4.0, `get…` names only reads and cuts. Without that rule, every new name that does work (a subset search, say) has to choose between the read prefix and a verb, and the family drifts.
- 3.4.0 comes before anything else that adds a name, so nothing new is built on a `get…` name it would lose.

## The verb: `build…`

The maintainer chose it on 2026-11-22, after a survey of other libraries.

- **The leading quantizers do the work under a verb and read results under `get…`, as 4.0 will:**
  - libimagequant: `quantizer.quantizeImage(…)`, then `result.getPalette()` and `result.remapImage(…)`;
  - image-q: `buildPalette(images, { colors })`, then `applyPalette(image, palette)`;
  - Android Palette: `Palette.from(bitmap).generate()`, then `getDominantSwatch()`;
  - Pillow: `image.quantize(colors)`, then `image.getpalette()`;
  - SciPy: `linkage(X, 'ward')`, then `fcluster(Z, t)` to cut.
- **The most common verb, `quantize`, is already ours for mapping.** `build` is the next best:
  - image-q, the fullest JavaScript quantizer, uses `buildPalette` with exactly this meaning (image in, palette out) and maps with a separate call, as `quantizeWithPalette` does here;
  - all three nouns take it naturally: you build a hierarchy, a palette, a set of swatches.
- **The one-shot palette libraries (color-thief, node-vibrant, fast-average-color) use `get`.** That is why 3.0 kept it. The 3.3.0 decision supersedes that reason for calls that do work.
- **Rejected:**
  - `extract…`: one smaller library (extract-colors) uses it, and `extractClustering` reads oddly.
  - `generate…`: Android uses it, but `generateClustering` reads oddly.
  - `compute…`: accurate but bland, with no precedent in this field.
  - `make…`: `makePalette(image, k)` reads as building a palette from colours, like `new Palette([...])`.
  - `cluster…` and `load…`: ruled out by the ROADMAP (`worker.cluster(image)` returns a handle; `worker.load(clustering)` is a 4.0 option).

## Surface in 3.4.0

| New name | Deprecated name (same function) | Arguments |
|---|---|---|
| `buildClustering` | `getClustering` | `(image, options?)` |
| `buildPalette` | `getPalette` | `(image, k, options?)` |
| `buildSwatches` | `getSwatches` | `(image, k, options?)` |

- **Where:** the main entry (ES module and CommonJS), the worker entry's shared exports, and the members of `AgglomerativeWorker` (`createWorker()`).
- **A pure rename:** the same arguments, options, `signal` and `onProgress`, results, errors and error `argument` names. Output is byte-identical, and `test/golden.test.js` passes unchanged.
- **The deprecated name is the same function object** (`getPalette === buildPalette`) in each entry and on each worker object. Nothing in the clustering functions' messages names the function called, so no message has to know which name was used.
- **No warning at run time.** The library never logs (the glue's `print` is a no-op), and stability.md promises deprecation through the types. The types, the docs and the CHANGELOG carry it.
- **Unchanged:**
  - every method on `Clustering`;
  - every handle method, `handle.getClustering()` included (handle methods read the handle's kept data);
  - `getPaletteFromClustering`, `getSwatchesFromClustering`, `getClusteringInfo`;
  - `quantize*`, `worker.cluster`, error codes, `ErrorArgument`, `formatVersion`.

### Worker entry

- **The wire names don't change in 3.x.** The caller's side posts `getClustering`, `getPalette` and `getSwatches` for both spellings, so `src/worker-thread.js` and its `optionsIndex` are untouched.
  - Why: `createWorker({ script })` can still point at a stale copied `worker-thread.mjs` from an older version, which would answer a new wire name with `Unknown method`.
  - 4.0 renames the wire names along with the removal.
  - This replaces ROADMAP item 5's "`optionsIndex` gains the new keys". The caller-side tables in `src/worker.js` (`optionsPosition`, `imageFunctions`, `clusteringOnlyFunctions`) gain the new keys only where they're looked up by the name the caller used.
- **Requirement:** each new name behaves exactly as the old one through the worker: transfer, cancel, progress, and the errors before and after the worker starts.

### Types (`src/index.d.ts`, `src/worker.d.ts`)

- **Each new function** gets its own declaration with the full doc comment that the old one has today.
- **Each deprecated name** gets a declaration of its own, never an export alias: a JSDoc tag on `export { buildPalette as getPalette }` doesn't reliably reach the alias. For example: `/** @deprecated Renamed {@link buildPalette} in 3.4.0 (the same function). Removed in 4.0. */ export function getPalette(image: ImageLike, k: number, options?: ClusteringOptions): Promise<Palette>;`. Editors must show it struck through, and the `{@link}` makes the hover clickable.
- **Where `@deprecated` goes:** on the `index.d.ts` functions, the `AgglomerativeWorker` members, and the worker entry's shared exports. The shared exports need their own tag as well as the member's, since they are typed `AgglomerativeWorker['getPalette']`. Never on `clustering.getPalette`, `handle.getPalette`, `handle.getClustering` or any other method that keeps its name.
- **Every doc comment that names a deprecated function** names the new one instead. For example, `Clustering`'s comment says where a clustering comes from.
- **`test/types/*`** use the new names, plus one line per deprecated name to show it still compiles. `test/api/*.snap.txt` are updated after review.

### Messages

Every error message and hint that names one of the three functions names the new one. Today those are:
- the `invalid-clustering` messages in `src/shared.js` ("not a clustering from getClustering", "Palettes come from getPalette and getPaletteFromClustering", "must be a Uint8Array from getClustering");
- the palette-is-a-clustering message ("this is a clustering (from getClustering)").

The builder greps for any others. Tests that match these messages change with them.

### Docs

- **`docs/api.md`:**
  - Each function's entry goes under its new name, with its `Options:` list (`test/api.test.js` compares these with the code, so it must learn the new names).
  - The old names get a one-line "Deprecated names" section: the three old names, "the same functions, removed in 4.0", and a link to `docs/migrating.md`, which holds the table.
  - `test/api.test.js` exempts the deprecated names from the entry and `Options:` checks, and checks instead that each deprecated export is listed in that section. 4.0 deletes this rule along with the names.
  - A sentence where `buildClustering` and `worker.cluster` meet: one returns the clustering's bytes, the other a handle that keeps the image and its clustering in the worker.
- **README, `docs/guides.md`, `environments.md`, `performance.md`, `troubleshooting.md`, `how-it-works.md` and `demo/index.html`** use the new names throughout.
- **`docs/migrating.md`** gets a section "Deprecated in 3.4 (removed in 4.0)", above "From 2.x to 3.0":
  - the old-to-new table;
  - "find and replace; nothing else changes";
  - the `get…` methods that stay, so a find-and-replace doesn't touch `clustering.getPalette(k)` or `handle.getPalette(k)`;
  - "update mock factories and spies with the call sites": the two names are one function, but a mock replaces only one name. The mock example in `docs/environments.md` moves to `buildPalette`.
- **The stale-name check in `test/api.test.js`** tells the functions from the methods, which keep the names, by position and arity rather than by argument name. Methods take `(k)` or `()`; the functions take an image first. It flags three patterns:
  - `/(?<![.\w])get(Clustering|Palette|Swatches)\b/`: a bare name not after a dot, which catches imports, prose and mock factories (`…FromClustering` and `getClusteringInfo` don't match, because of the `\b`);
  - `/\.get(Palette|Swatches)\([^,)]*,/`: a dotted call with two or more arguments, such as `worker.getPalette(img, k)`;
  - `/\.getClustering\([^)\s]/`: a dotted `getClustering` with an argument.

  Prose that means a method writes it with its receiver (`clustering.getPalette`). The check exempts `docs/migrating.md`, the CHANGELOG and the "Deprecated names" section, which name the old forms on purpose. A call-shape check like `getPalette(image` alone would miss calls the docs already contain, such as `getPalette(photo, 128, …)` and `worker.getPalette(frame, 8, …)`.
- **CHANGELOG (3.4.0):**
  - the renames;
  - a warning that lint rules for deprecated APIs (`@typescript-eslint/no-deprecated`, `sonarjs/deprecation`) will flag `getPalette(image, k)`;
  - a warning that `AgglomerativeWorker` gains three members, so a hand-written implementation or typed mock must add them;
  - "output is unchanged".

### Code that runs against older builds

Four files load a build that may be older than 3.4 and must keep working on one:
- `bench/lib/quantizers.js` (`--ac name=path` benchmarks other builds side by side, such as a released version);
- `fixtures/clusterings/make.mjs` (it writes a fixture from a given release);
- `test/browser/app`: `npm run test:browser` runs it against `dist/`, and `.github/workflows/published.yml` against packages on npm (any PR that touches it, and `workflow_dispatch` for any version);
- `test/published/smoke.mjs`, which `published.yml` runs against npm.

The first three use the new name when the build has it and fall back to the old one. The published smoke test keeps the old names, which work with every version and test the deprecated names against the real package. It also calls the new names when the version under test has them.

The rest of the repository's tests, benches and the Jest files move to the new names. These keep using the old names on purpose, so the deprecated names stay covered:
- `test/cjs.test.js`;
- a test that checks the same-function identity in both entries and on a worker object;
- one deprecated-name call through each entry (ESM, CommonJS, worker).

### Ground truth, same change

- **stability.md** (the maintainer approved this on 2026-11-22) gains, beside "add functions (with their methods on `Clustering`)", the line: interfaces the library implements (`Clustering`, `AgglomerativeWorker`, `ClusteringHandle`) gain members when functions are added; implement them yourself only in tests, and expect to add members. The CHANGELOG's `AgglomerativeWorker` warning links to it.
- **PRINCIPLES:**
  - "Compatibility" notes that exception, pointing to stability.md.
  - "Names follow their family" uses `buildPalette` as its example of a verb name.
  - A settled decision records `build…` and its reasons (the survey above).
  - The "Settled decisions" line about the 3.0 names notes the 3.4.0 deprecations.
- **ROADMAP:**
  - item 5 is marked released (in the release commit), and its "`optionsIndex` gains the new keys" is corrected (see Worker entry);
  - the 4.0 removal entry names `buildClustering`, `buildPalette` and `buildSwatches`, says the worker's wire names are renamed then, and drops "the docs' stale-name check matches call shapes", which 3.4.0 does;
  - the 4.0 `…FromClustering` entry gets the name table below, so it lives in the ROADMAP and not only in this spec;
  - the subset search in "Considered" notes that `build…` is taken by "cluster an image", so it needs another verb;
  - "Swatch helpers" writes `buildSwatches` and `getSwatchesFromClustering` where it says `getSwatches`, and notes that a helper that clusters an image takes a verb name;
  - "Clustering several images at once" writes `buildClustering([frames])`.

## The 4.0 name table

**The guarantee:** under either outcome of the `…FromClustering` question (ROADMAP 4.0), a name is kept or removed, never renamed. No name 3.4.0 introduces changes again, so no family is renamed twice.

| Family | One-shot (main and worker) | Method on `Clustering` | Handle method | Cut or map of a stored clustering: **A**, `…FromClustering` kept | **B**, deprecated in the main entry |
|---|---|---|---|---|---|
| Clustering | `buildClustering(image)` | — | `getClustering()` | — | — |
| Palette | `buildPalette(image, k)` | `getPalette(k)` | `getPalette(k)` | `getPaletteFromClustering(c, k)` | the method; worker: see below |
| Swatches | `buildSwatches(image, k)` | `getSwatches(k)` | `getSwatches(k)` | `getSwatchesFromClustering(c, k)` | same |
| Info | — | `getClusteringInfo()` | `getClusteringInfo()` | `getClusteringInfo(c)` | `getClusteringInfo(c)` kept or deprecated with the others, decided with the 4.0 question |
| Mapped image | `quantize(image, k)` | `quantize(image, k)` | `quantize(k)` | `quantizeFromClustering(image, c, k)` | same |
| Indexed image | `quantizeToIndices(image, k)` | `quantizeToIndices(image, k)` | `quantizeToIndices(k)` | `quantizeToIndicesFromClustering(image, c, k)` | same |
| With a palette | `quantizeWithPalette`, `quantizeToIndicesWithPalette` | — | the same names | — | — |
| Worker handle | `worker.cluster(image)` | — | — | — | — |

**Under B, the worker entry's stored-clustering path** is one of the ROADMAP's three ways out:
1. keep its `…FromClustering` functions;
2. deprecate only the main entry's;
3. `worker.load(clustering)`, a handle whose methods keep the handle's names above. Its mapping methods' shape is still open: it holds no image, so its `quantize` can't be `(k)` (ROADMAP 4.0).

Each way keeps every name in the table or removes it; none renames one.

## Goals, non-goals, anti-goals

- **Goals:**
  - three verb names that pair with their cuts and read as a family with `quantize`;
  - the most common call stays plain: `buildPalette(image, k)`, the successor of the most-used 2.x call, needs no options;
  - old names that keep working unchanged through 3.x, marked so editors and linters show it;
  - docs that lead with the new names.
- **Non-goals:**
  - deciding the `…FromClustering` question;
  - `worker.load`;
  - any change to methods, handles, options or output.
- **Anti-goals:**
  - two names for one function left in 4.0;
  - a 4.0 table that would rename a 3.4.0 name again;
  - a deprecation that changes what any existing call returns or throws;
  - a deprecated alias that drifts from the new function.

## Left to the builder

- How the `.d.ts` spells each deprecated declaration, provided it is a declaration of its own (see Types), editors show it struck through, hovers show the signature, and the snapshots read cleanly.
- The wording of messages and docs, within "Messages keep the `Invalid <thing>: ...` form".
- The order of commits.

## Review

Four reviews read the first draft. This version includes their findings:
- **Builder check:** found that `test/published/smoke.mjs` and `test/browser/app` run against packages already on npm (now in "Code that runs against older builds"), and that the API-docs test needed a rule for deprecated names (now in Docs).
- **`scope-steward`, in scope:**
  - Trim 2 was taken: the api.md section is one line.
  - Trim 1 (post the new name; the thread learns only it) was superseded by `api-steward`'s wire-name finding. Keeping the old wire names touches the thread even less and is safe with a stale worker script.
- **`roadmap-steward`, concerns, no conflict:**
  - the Info row under outcome B, now "decided with the 4.0 question";
  - `worker.load`'s mapping shape, marked open;
  - the stale old names in the ROADMAP's "Swatch helpers" and "Considered" entries;
  - "the most common call stays plain", now a goal;
  - the stale-name check moved forward from 4.0, now noted;
  - the table copied into the ROADMAP.
  - All of these are in the sections above.
- **`api-steward`, concerns, no conflict:**
  - the stale-name check's patterns, now three patterns that catch today's calls;
  - the wire names, now kept;
  - deprecated declarations, now each its own, with `{@link}`;
  - mocks, now covered in migrating.md.
  - All of these are in the sections above.
- **Both stewards, for the maintainer:** add a sentence to stability.md that interfaces the library implements (`Clustering`, `AgglomerativeWorker`, `ClusteringHandle`) gain members when functions are added. PRINCIPLES "Compatibility" sends anything that stops 3.x code compiling to 4.0, and today only the 3.3.0 CHANGELOG and ROADMAP item 5 accept this. The maintainer approved it on 2026-11-22, along with the spec; it is in "Ground truth, same change".
