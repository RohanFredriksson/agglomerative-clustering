# 3.3.0: methods on `Clustering`

ROADMAP item 4.
- **Who designed it:** the `api-steward` reviewer designed the surface before this spec was written, at the maintainer's request.
- **Revised after review:** the roadmap, API and scope reviewers read the first draft, and this version includes their findings. Review history is at the end.
- **The maintainer's brief:** this is a new style, and it need not copy the old one. It may be the API that 4.0 leads with for the cluster-once workflow, though nothing is deprecated now.

## Why

- **Cluster once, cut anywhere** is the library's point. Today it reads `getPaletteFromClustering(clustering, k)` and `quantizeFromClustering(image, clustering, k)`, so the feature that sets the library apart needs a second family of names.
- **The worker's handle already reads the way we want:** `handle.getPalette(k)`. Methods bring that reading to the main entry, and to stored clusterings.
- **It can be the 4.0 shape** without changing anything else:
  - one-shot functions for a single result;
  - methods for cluster-once;
  - `…WithPalette` for palettes;
  - handles for off-thread work.
- **Where the request comes from:** the naming review before 3.0.0 (ROADMAP), not a user request or an exploratory round. It adds no capability. It is a second, easier spelling of calls that exist, which the ROADMAP accepts for 3.x ("documented as the function form").

## Surface

Five methods on every `Clustering`. Each takes the function's name without `FromClustering`, and the clustering becomes the receiver. Item 4 listed four. `quantizeToIndices` is added, since `quantizeToIndicesFromClustering` exists and the handle has it.

```ts
export class Clustering extends Uint8Array {
    constructor(bytes: Uint8Array | Uint8ClampedArray | readonly number[]);
    constructor(buffer: ArrayBufferLike, byteOffset?: number, length?: number);
    readonly [clusteringBrand]: true;
    /** The k-colour palette, as `getPaletteFromClustering(this, k)`. Takes no options. Runs on the calling thread, with the main entry. */
    getPalette(this: Clustering, k: number): Promise<Palette>;
    /** Palette, weights and shares, as `getSwatchesFromClustering(this, k)`. Needs a 3.x clustering. Runs on the calling thread, with the main entry. */
    getSwatches(this: Clustering, k: number): Promise<Swatches>;
    /** The error curve and totals, as `getClusteringInfo(this)`. Needs a 3.x clustering. Runs on the calling thread, with the main entry. */
    getClusteringInfo(this: Clustering): Promise<ClusteringInfo>;
    /** Maps `image` to the k-colour palette, as `quantizeFromClustering(image, this, k, options)`. Runs on the calling thread, with the main entry. */
    quantize<I extends ImageLike>(this: Clustering, image: I, k: number, options?: MappingOptions): Promise<ImageResult<I>>;
    /** Indexed output, as `quantizeToIndicesFromClustering(image, this, k, options)`. Runs on the calling thread, with the main entry. */
    quantizeToIndices(this: Clustering, image: ImageLike, k: number, options?: MappingIndexOptions): Promise<IndexedImage>;
}
```

```js
const clustering = await getClustering(image, { colorSpace: 'oklab' });
slider.oninput = async () => show(await clustering.getPalette(+slider.value));
const { explained } = await clustering.getClusteringInfo();
const mapped = await clustering.quantize(image, 16, { dither: 'atkinson' });
const restored = new Clustering(await db.get('clustering'));   // has the same five methods
```

- **New public names:** the five methods. No new exports, options, option values, error codes, `ErrorArgument` values or image fields.
- **Results, defaults and errors are those of the function forms:**
  - `quantize` matches in the clustering's colour space unless `colorSpace` is given.
  - `quantizeToIndices` uses the clustering's cutoff unless `transparent` is given.
  - `getSwatches` and `getClusteringInfo` throw for a 2.x clustering, as the functions do.
- **No `getClustering()`:** it would return the receiver.
- **No `quantizeWithPalette`:** the clustering adds nothing to it.

## Decisions, with the reasons

1. **The methods are non-enumerable own properties.** `markClustering` (`src/shared.js`) adds them next to the tags: one shared function per method, which reads `this`.
   - **A `Clustering` stays a plain tagged `Uint8Array` made by a plain function** (settled decision), so these still hold:
     - `constructor === Uint8Array`;
     - Jest's and Vitest's `toEqual` pass;
     - `node:assert.deepStrictEqual` passes (it compares prototypes);
     - the "Store" promise: the value is the bytes.
   - **Every tagged value has them:**
     - `getClustering` results;
     - `new Clustering(bytes)`;
     - `handle.getClustering()`;
     - clusterings revived from the worker.
   - **`slice`, `subarray` and clones drop them,** as they drop the tags.
   - **Rejected: a prototype or subclass.** It fails `deepStrictEqual` and risks V8's typed-array fast paths.
   - **Rejected: a non-byte object with `.bytes`,** the WebCodecs shape. It breaks storing a clustering as it is, and reopens two settled decisions.
2. **The methods are async.**
   - A `Clustering` can exist before the module loads (`new Clustering(bytes)`).
   - `retireIfLarge` can unload the module after any call.
   - Browsers can't compile the module synchronously.
   - The handle and the functions are async.
   - A sync method could never become async without a breaking change.
   - With the module loaded, a cut settles in about a microtask, which is fine for a slider.
   - No `info` getter, since a getter would have to be sync.
3. **The names come from the families and match the handle's.**
   - **`getClusteringInfo`, not the roadmap's `getInfo`.** It is mechanical (drop `FromClustering`) and identical in the function, the handle and the method. The roadmap's line is corrected.
   - **Not `palette(k)`:** the cuts are reads, so `get…` (PRINCIPLES "Names follow their family": `get…` names only reads and cuts, and work gets a verb).
   - **`quantize`'s signature:** `clustering.quantize(image, k, options)` has the one-shot `quantize`'s signature. `handle.quantize(k, options)` differs because the handle holds an image. The error for `clustering.quantize(16)` points at this (see Errors).
4. **Methods run on the calling thread, with the main entry. Without the main entry, they reject.**
   - **The mechanism:**
     - `shared.js` holds an engine slot, and only `index.js` fills it, when it is evaluated.
     - `worker.js` fills nothing.
     - With the slot empty (a worker-only app), a method rejects with `wasm-load-failed` and says what to import (see Errors).
     - The slot is per copy: each ESM and CJS copy of `shared.js` has its own. A clustering marked by the CJS copy needs the CJS main entry.
   - **Why the calling thread:**
     - Identical bytes behave identically, after storage, cloning or revival.
     - A cut in-thread is faster than posting about a megabyte to a worker.
     - Off-thread work keeps its two forms: the worker entry's functions, and `worker.cluster()` handles.
   - **Why not load the main entry lazily from the worker entry** (the first draft). Nobody has asked for methods in worker-only apps, and the loader had real costs:
     - It would ignore `createWorker({ wasm })`, so it would fail on exactly the CDNs, strict CSPs and edge runtimes where users set it.
     - It would pull `index.mjs`, the glue and the `.wasm` into every worker-only bundle.
     - It would run heavy mapping on the thread the user chose the worker entry to keep free.
     - It needed a Babel visitor for dynamic imports, `patch-cjs` changes, and a second copy-before-await path.
     - Adding a loader later is additive; removing one would break code.
   - **Why not a global slot** (`Symbol.for` on `globalThis`), which would let a CJS-marked clustering find an ESM main entry:
     - it needs a global;
     - it needs a rule for which copy wins;
     - it would send calls to an engine of another version (a 3.4 method's options rejected by a 3.3 engine);
     - the case it fixes is rare, and the error names it.
     - It can be added later, additively.
   - **Rejected: route calls to the worker that made the clustering.** That worker can be terminated, and the route is undefined for `new Clustering(bytes)`.
   - **Rejected: use the main entry if loaded, else the worker.** A third-party import would change where your code runs. Under the chosen design, an import changes only *whether* methods work, never *where* they run.
5. **A method checks its receiver, then forwards.**
   - **The order:**
     - if `this` isn't a `Uint8Array`, the detached message;
     - otherwise `readHeader(this)`, which gives its usual messages and accepts valid untagged bytes, as the functions do;
     - then the engine slot;
     - then the function form, called at once.
   - **Taking the bytes before awaiting** (the CLAUDE.md rule): the function form already does it, so the method adds no copying of its own.
   - **One argument is checked before forwarding:** a number where the image goes (see Errors).
6. **`Palette` gets no `quantize` method.** It is recorded in ROADMAP "Considered".
   - Fixed palettes are usually plain arrays (`PaletteLike`). A method would need a `new Palette([...])` wrap on that path, or leave two ways to map with a palette.
   - The entry says: "palette mapping stays `…WithPalette`, unless item 6 (a prepared palette for reusing dither recipes) decides otherwise". So item 5's open question stays open.
   - Clusterings are always made or wrapped by the library, so methods cost them nothing.

## Errors

All are made with `fail`. Argument names are unchanged: `'clustering'` for the receiver, then `'image'`, `'k'`, `'options'` and `'options.<key>'`.

- **Called without its clustering:** `invalid-clustering` on `'clustering'`, when `this` isn't a `Uint8Array`, as in `const { getPalette } = clustering; getPalette(8)`. Strict TypeScript catches it through the `this:` parameter. The message shows the value received:
  > Invalid clustering: getPalette was called without its clustering (this is undefined). Call it as clustering.getPalette(k), or use getPaletteFromClustering(clustering, k).
- **`this` is bytes but not a clustering** (`clustering.getPalette.call(palette, 4)`): `readHeader`'s existing messages, for example "this is a palette, not a clustering".
- **Main entry not loaded:** `wasm-load-failed`, with no argument. The method and its function form are filled in per method:
  > Could not use the WebAssembly module: clustering.getPalette runs on the calling thread with the main entry, 'agglomerative-clustering', which isn't loaded here (this clustering came from the worker entry, or from the other module system's copy of the package). Import the main entry in this thread, or cut the clustering in the worker with getPaletteFromClustering(clustering, k) from 'agglomerative-clustering/worker'.

  Why this code: the bytes are fine and no argument is wrong. The fix is setup, as with a misplaced `.wasm`, so code that handles `wasm-load-failed` already does the right thing. The api.md error table's `wasm-load-failed` row adds: "or a `Clustering` method was called where the main entry isn't loaded".
- **`clustering.quantize(16)`** (the handle's shape): `invalid-argument` on `'image'`. The same goes for `quantizeToIndices`:
  > Invalid image: got 16. clustering.quantize takes the image first: clustering.quantize(image, k). (A worker handle's quantize(k) maps the image it holds.)
- **Extra arguments to a cut:** the existing `noOptions` error, naming the method form:
  > Invalid arguments: clustering.getPalette takes no options (a clustering already records its colour space, precision and cutoff). To map pixels with other options, use clustering.quantize.
- **A cast instead of the constructor** (`stored as Clustering`) compiles, then fails with the engine's `TypeError: … is not a function`. This is accepted: the only fix is a prototype. The docs say so, and every example uses `new Clustering(bytes)`.

## Types

- **Adding members to the class breaks nothing that compiled:**
  - `interface X extends Clustering` inherits the methods. Only one that declares its own conflicting `getPalette` or `quantize` could clash, and the CHANGELOG says so.
  - A plain `Uint8Array` already couldn't be assigned (the brand).
  - No name clashes with ES2024+ `Uint8Array` members (`toBase64`, `setFromHex`).
- **The `worker.d.ts` hover comment on `Clustering`:** "The same class as the main entry's `Clustering`. Its methods run on the calling thread and need the main entry imported there; off the thread, use this entry's `…FromClustering` functions or `cluster()`."
- **The Node-only config is fine:** `ImageLike` goes through `PlatformImageData`.
- **`test/types/*` gets:**
  - each method, in both module systems and the Node-only config;
  - `@ts-expect-error` for a detached call, for `clustering.quantize(16)` and for options on a cut.
- **`test/api/*.snap.txt`** is updated after the diff is reviewed.

## Docs

- **`docs/api.md`:**
  - **A new "Clustering methods" section** after "Palette and Clustering", with `Options:` lists for `quantize` and `quantizeToIndices`. `test/api.test.js` is extended to read methods.
  - **Each `…FromClustering` entry** says "the function form of `clustering.…`".
  - **"Worker entry"** gets: "A `Clustering`'s methods run on the calling thread, using the main entry: import `agglomerative-clustering` in that thread (and call its `init({ wasm })` if you set where the module comes from), or they reject with `wasm-load-failed`. To cut or map a clustering off the thread, use this entry's functions (`getPaletteFromClustering(clustering, k)` and the rest) or a `worker.cluster()` handle."
  - **"TypeScript"** gets the cast caveat, and: "Types can't tell whether the main entry is loaded: in a worker-only app the methods compile, then reject with `wasm-load-failed`."
  - **The error table's** `wasm-load-failed` row, as above.
- **README:** the methods take the cluster-once column, and the function form stays visible in each cell, for example "`clustering.getPalette(k)` (`getPaletteFromClustering`)". A footnote points worker users at the function form. The slider example uses the methods.
- **Guides:**
  - The cluster-once recipes and the slider use the methods.
  - `chooseThreads` and `improveThreads` keep whichever reads better (`test/recipes.test.js` checks them against the text).
  - `demo/index.html` uses the methods.
- **CHANGELOG, 3.3.0:**
  - the methods;
  - that `slice`, `subarray` and clones give plain bytes without them;
  - that `Clustering`'s type gained members;
  - that 4.0 renames `getClustering`, `getPalette` and `getSwatches`, and the new names arrive in 3.4.0.
- **CLAUDE.md:** the `Palette`/`Clustering` paragraph no longer says "duplicated in `src/worker.js`". It describes the methods and the engine slot in `shared.js`, which only `index.js` fills.

## Record edits, in the same change

- **ROADMAP:**
  - **Item 4:** marked done. Its open questions are answered (async; `new Clustering(bytes)` behaves the same). Its additions are noted: `quantizeToIndices`, and `getClusteringInfo` for `getInfo`.
  - **The "Larger, later" entry** is folded into item 4. "`Clustering` is already a class" is corrected to "a tagged `Uint8Array`".
  - **"Considered":**
    - a `Palette` method, worded to leave item 6 open (Decision 6; numbered 5 before the verb-names item was added);
    - a lazy loader in the worker entry, and a global engine slot, each with its reasons (Decision 4).
  - **"Choosing N colours from a fixed palette, built in"** reads: "a method on `Clustering` with a verb name, sharing its function form's stem (by the naming rule)".
  - **"Swatch helpers":** a `getSwatches` option would also come to `clustering.getSwatches`, which rejects options today.
  - **The 4.0 section:**
    - "and the `Clustering` methods" is added to "Narrowed result types", to premultiplied output and to "`alpha` and `transparent` … throw";
    - the note below is added.
- **PRINCIPLES:**
  - **Already landed, before implementation** (decided with the maintainer while designing this release, and reviewed separately): the `get…` and method naming rules in "Names follow their family", the "Methods go where losing them costs nothing" rule, the settled decisions "The 3.0 function names keep working through 3.x" and "`get…` means a read, from 4.0", and ROADMAP item 5 (verb names, 3.4.0) with its 4.0 entry.
  - **A new settled decision:** methods on `Clustering` are non-enumerable own properties, async, run on the calling thread with the main entry of the same copy, and reject with `wasm-load-failed` without it. The rejected alternatives are listed with their reasons:
    - a prototype or subclass (fails `deepStrictEqual`);
    - a `.bytes` object (breaks storing);
    - routing to the worker that made the clustering (terminable, undefined for stored bytes);
    - main entry or else worker (an import would change threading);
    - a lazy loader and a global slot (open as additive later changes, not rejected for good).

## Tests

- **Equality:** one check per method for each source (`getClustering`, `new Clustering(bytes)`, `handle.getClustering()`) that it equals the function form.
- **Inherited defaults:** `quantize` uses the clustering's colour space (an OKLab clustering), and `quantizeToIndices` uses its cutoff.
- **Errors**, each checked for code, argument and message:
  - a detached call;
  - a palette as `this`;
  - `quantize(16)`;
  - extra options;
  - a 2.x clustering for `getSwatches` and `getClusteringInfo`;
  - the main entry not loaded: with only the worker entry, in ESM and in CJS (`test/cjs.test.js`), each method rejects with `wasm-load-failed` and the message.
- **Plain bytes:** `toEqual(new Uint8Array(...))` and `deepStrictEqual` pass on a `Clustering`, and `Object.keys` lists no methods.
- **`test/inputs.test.js`:** one row for each method that takes an image (`quantize`, `quantizeToIndices`), changing the image right after the call.
- **Browser test:** imports both entries, and calls a method on a clustering from the worker entry.
- **Golden tests:** output is unchanged, so they pass untouched.

## 4.0 (recorded in the ROADMAP's 4.0 section)

- **What leads:**
  - one-shot functions for single results;
  - `Clustering` methods for cluster-once;
  - `…WithPalette` for palettes;
  - in the worker entry, functions and handles.
- **What may be deprecated:** the `…FromClustering` functions, decided by how much they are used.
- **A gap to settle first:** in the worker entry, `…FromClustering` is the only off-thread way to cut or map a *stored* clustering. A handle needs an image, and methods run on the calling thread. Three ways out:
  1. **Keep the worker entry's `…FromClustering`.** The entries would then mirror each other only in part.
  2. **Deprecate them in the main entry only,** and keep the worker's as its stored-clustering form. This is weaker against "Both entries behave alike".
  3. **Add a handle made from a clustering** (`worker.load(clustering)`, for example). The roadmap's "off the main thread, the handle is the answer" favours it. It holds no image, so its `quantize` needs a shape of its own (`(image, k)`, or no mapping methods), and that has to be decided before it is built. It waits for a request.

## Unchanged

- The C++, the WebAssembly exports, the clustering format and fixtures.
- The golden hashes.
- Every existing call and its output.
- The handle, and the build scripts.
- `worker.d.ts`, apart from one comment.

## Review history

- **Design:** `api-steward`, before drafting. It designed the surface in "Surface" and Decisions 1–3.
- **First draft:** reviewed by all three.
  - **roadmap-steward: concerns.** It asked for the PRINCIPLES naming rule and settled-decision wording, the third 4.0 option, keeping item 5 open, the 4.0 entries naming the methods, and the stale ROADMAP entries. All adopted.
  - **scope-steward: trim.** It asked to drop the lazy loader, name the request's source, shrink the test matrix and simplify argument checking. All adopted.
  - **api-steward: concerns.** Its three concerns were about the lazy loader: the build couldn't emit it, it ignored `wasm`, and it duplicated validation. They are moot after the trim. Its notes were adopted: the receiver checked through `readHeader`, hover docs, README cells, CLAUDE.md and the CHANGELOG line. It then designed the error, the per-copy slot and the docs sentences for the trimmed version.
