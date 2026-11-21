# 3.3.0: methods on `Clustering`

ROADMAP item 4. The surface was designed with the `api-steward` reviewer before this spec was written, at the maintainer's request. The maintainer's brief: this is a new style that need not copy the old one, and it may be the API that 4.0 leads with for the cluster-once workflow, even though nothing is deprecated now.

## Why

- **Cluster once, cut anywhere** is the library's point, but today it reads as `getPaletteFromClustering(clustering, k)` and `quantizeFromClustering(image, clustering, k)`. Users must learn a second family of names to use the feature that sets the library apart.
- **The worker's handle already reads the way we want:** `handle.getPalette(k)`. Methods bring the same reading to the main entry, and to stored clusterings.
- **It can be the 4.0 shape** without changing anything else:
  - one-shot functions for a single result;
  - methods for cluster-once;
  - `…WithPalette` for palettes;
  - handles for off-thread work.

## Surface

Five methods on every `Clustering`. Each is the function's name with `FromClustering` dropped, and the clustering becomes the receiver.

```ts
export class Clustering extends Uint8Array {
    constructor(bytes: Uint8Array | Uint8ClampedArray | readonly number[]);
    constructor(buffer: ArrayBufferLike, byteOffset?: number, length?: number);
    readonly [clusteringBrand]: true;
    /** The k-colour palette, as getPaletteFromClustering(this, k). Takes no options. */
    getPalette(this: Clustering, k: number): Promise<Palette>;
    /** Palette, weights and shares, as getSwatchesFromClustering(this, k). Needs a 3.x clustering. */
    getSwatches(this: Clustering, k: number): Promise<Swatches>;
    /** The error curve and totals, as getClusteringInfo(this). Needs a 3.x clustering. */
    getClusteringInfo(this: Clustering): Promise<ClusteringInfo>;
    /** Maps image to the k-colour palette, as quantizeFromClustering(image, this, k, options). */
    quantize<I extends ImageLike>(this: Clustering, image: I, k: number, options?: MappingOptions): Promise<ImageResult<I>>;
    /** Indexed output, as quantizeToIndicesFromClustering(image, this, k, options). */
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

- **New public names:** the five methods. There are no new exports, options, option values, error codes, `ErrorArgument` values or image fields.
- **Results, defaults and errors are those of the function forms:**
  - `quantize` matches in the clustering's colour space unless `colorSpace` is given;
  - `quantizeToIndices` uses the clustering's cutoff unless `transparent` is given;
  - `getSwatches` and `getClusteringInfo` throw for a 2.x clustering, as the function forms do.
- **No `getClustering()`** (it would return the receiver), and **no `quantizeWithPalette`** (the clustering adds nothing to it).

## Decisions, with the reasons

1. **The methods are non-enumerable own properties.** `markClustering` (`src/shared.js`) adds them next to the tags, as one shared function per method that reads `this`.
   - **A `Clustering` stays a plain tagged `Uint8Array` made by a plain function** (settled decision), so these still pass:
     - `constructor === Uint8Array`;
     - Jest's and Vitest's `toEqual`, and `node:assert.deepStrictEqual` (which compares prototypes);
     - the "Store" promise: the value is the bytes.
   - **Every tagged value gets them:**
     - `getClustering` results;
     - `new Clustering(bytes)`;
     - `handle.getClustering()`;
     - clusterings revived from the worker.
   - **`slice`, `subarray` and clones drop them**, as they already drop the tags.
   - **Rejected:**
     - *a prototype or subclass:* it fails `deepStrictEqual` and puts V8's typed-array fast paths at risk;
     - *a non-byte object with `.bytes`* (the WebCodecs shape): it breaks storing a clustering as it is, and reopens two settled decisions.
2. **The methods are async.**
   - A `Clustering` can exist before the module loads (`new Clustering(bytes)`), and `retireIfLarge` can unload the module after any call.
   - Browsers can't compile the module synchronously.
   - The handle and the functions are async too.
   - A sync method could never become async without a breaking change.
   - Once the module is loaded, a cut settles in about a microtask, which is fine for a slider.
   - There is no `info` getter, because a getter would have to be sync.
3. **The names come from the families and match the handle's.**
   - It is `getClusteringInfo`, not the roadmap's `getInfo`. It is mechanical (drop `FromClustering`) and identical in the function, the handle and the method; the roadmap's line is corrected.
   - It is not `palette(k)`: `get…` is settled.
   - `clustering.quantize(image, k, options)` has the one-shot `quantize`'s signature, while `handle.quantize(k, options)` differs because the handle holds an image. The error for `clustering.quantize(16)` points at this (see Errors).
4. **Methods run on the calling thread, whichever entry made the clustering.**
   - Identical bytes behave identically, after storage, cloning or revival.
   - A cut in-thread is faster than posting about a megabyte to a worker.
   - Work off the thread keeps its two forms: the worker entry's functions, and `worker.cluster()` handles.
   - **Mechanism.** `shared.js` holds an engine slot, and the methods call through it.
     - `index.js` fills the slot unconditionally when it is evaluated.
     - `worker.js` fills it only if it is empty, with a lazy loader: `import('./index.mjs')`, or `require('./index.cjs')` in its CommonJS build.
     - With both entries loaded, the main entry wins in either import order. Each ESM/CJS copy of `shared.js` is self-consistent.
   - **Rejected:**
     - *route to the worker that made it:* that worker can be terminated, and the route is undefined for `new Clustering(bytes)`;
     - *the main entry if loaded, else the worker:* a third-party import would change your threading.
5. **Take the bytes before awaiting** (the CLAUDE.md rule).
   - With the engine loaded, a method calls the function form at once, and the function form already does this.
   - On the worker entry's lazy path, the method validates and copies `this`, the image and a palette-free set of options synchronously, then awaits the import. `test/inputs.test.js` covers the methods in both entries.
6. **Arguments are checked in the order they are written:** the receiver, then the image, `k` and the options. It is not plain delegation, which would check the image first.
7. **`Palette` gets no `quantize` method,** and the decision is recorded in ROADMAP "Considered".
   - Fixed palettes are usually plain arrays (`PaletteLike`).
   - A method would need a `new Palette([...])` wrap on that path, or leave two ways to map with a palette. `…WithPalette` stays the one way.
   - Clusterings are always made or wrapped by the library, so methods cost them nothing.

## Errors

All are made with `fail`, and the argument names are unchanged: `'clustering'` for the receiver, then `'image'`, `'k'`, `'options'` and `'options.<key>'`.

- **Called without its clustering** (`const { getPalette } = clustering; getPalette(8)`, or `this` isn't a clustering): `invalid-clustering` on `'clustering'`. The message:

  > Invalid clustering: getPalette was called without its clustering (this is undefined). Call it as clustering.getPalette(k), or use getPaletteFromClustering(clustering, k).

  The value received is shown in place of `undefined`. Strict TypeScript catches this case through the `this:` parameter.
- **`clustering.quantize(16)`**, the handle's shape: `invalid-argument` on `'image'`. The message:

  > Invalid image: got 16. clustering.quantize takes the image first: clustering.quantize(image, k). (A worker handle's quantize(k) maps the image it holds.)

  The same applies to `quantizeToIndices`.
- **Extra arguments to a cut:** the existing `noOptions` error, naming the method form. The message:

  > Invalid arguments: clustering.getPalette takes no options (a clustering already records its colour space, precision and cutoff). To map pixels with other options, use clustering.quantize.
- **A cast instead of the constructor** (`stored as Clustering`) compiles, and then fails with the engine's `TypeError: … is not a function`. We accept this: the only fix is a prototype. The docs say it in "TypeScript", and every example uses `new Clustering(bytes)`.

## Types

- **Adding members to the class breaks nothing that compiled:**
  - `interface X extends Clustering` inherits the methods;
  - a plain `Uint8Array` was already not assignable (because of the brand);
  - no method name clashes with ES2024+ `Uint8Array` members (`toBase64`, `setFromHex`).
- `worker.d.ts` re-exports the class, so it needs no change. The Node-only config is fine: `ImageLike` goes through `PlatformImageData`.
- **`test/types/*` gets:**
  - each method, in both module systems and the Node-only config;
  - `@ts-expect-error` for a detached call, for `clustering.quantize(16)`, and for options on a cut.
- `test/api/*.snap.txt` is updated after the diff is reviewed.

## Docs

- **`docs/api.md`:**
  - a "Clustering methods" section after "Palette and Clustering", with an `Options:` list for `quantize` and `quantizeToIndices` (so `test/api.test.js` can compare them; the test is extended to read methods);
  - each `…FromClustering` entry says "the function form of `clustering.…`";
  - "Worker entry" gets: "A `Clustering`'s methods run on the calling thread, whichever entry made it; for work off the thread, use this entry's functions or `worker.cluster()`."
  - "TypeScript" gets the cast caveat.
- **README:** the function table gets a methods column in place of the `…FromClustering` one, with a footnote on the thread. The slider example uses the methods.
- **Guides:**
  - the cluster-once recipes and the slider use the methods;
  - `chooseThreads`/`improveThreads` keep whichever reads better (`test/recipes.test.js` checks them against the text);
  - `demo/index.html` uses the methods.
- **CHANGELOG:** a 3.3.0 entry.
- **ROADMAP:**
  - item 4 is marked done with its open questions answered (async; `new Clustering(bytes)` behaves the same);
  - the "Larger, later" entry is folded into it;
  - `getInfo` is corrected to `getClusteringInfo`, and "`Clustering` is already a class" to "a tagged `Uint8Array`";
  - the Palette method goes into "Considered";
  - the 4.0 note below goes into the 4.0 section.
- **PRINCIPLES "Settled decisions":** methods on `Clustering` are own properties, async, run on the calling thread, and named after the functions without `FromClustering`.

## Tests

- **Every method gives byte-identical results to its function form,** in both entries. This holds:
  - for clusterings from `getClustering`, `new Clustering(bytes)`, a handle and the worker entry;
  - in RGB and OKLab, with and without a transparent cutoff.
- **Errors:** a detached call, `quantize(16)`, extra options, and a 2.x clustering for `getSwatches`/`getClusteringInfo`, each checked for code, argument and message.
- **Plain bytes:** `toEqual(new Uint8Array(...))` and `deepStrictEqual` still pass on a `Clustering`, and `Object.keys` has no methods.
- **Engine slot:**
  - with only the worker entry imported, methods load the main entry lazily (ESM and CJS);
  - with both imported, in either order, the main entry is used.
- **`test/inputs.test.js`** changes the arrays right after each method call.
- The browser test calls one method from a worker-entry clustering, and `test/bundle.test.js` passes with the worker entry's dynamic import of `./index.mjs`.
- Output is unchanged, so the golden tests pass untouched.

## 4.0 (recorded in the ROADMAP's 4.0 section)

- **What leads:**
  - one-shot functions for single results;
  - `Clustering` methods for cluster-once;
  - `…WithPalette` for palettes;
  - functions and handles in the worker entry.
- **What may be deprecated:** the `…FromClustering` functions, decided by use.
- **A gap to settle before deprecating them:** in the worker entry they are the only off-thread way to cut or map a *stored* clustering, since a handle needs an image and methods run on the calling thread. So 4.0 either:
  - keeps the worker entry's `…FromClustering` functions, which leaves the two entries mirroring each other only in part; or
  - first adds a handle made from a clustering (for example `worker.load(clustering)`), additively in 3.x if it is asked for.

## Unchanged

- The C++, the WebAssembly exports, the clustering format and its fixtures.
- Golden hashes, and every existing call and its output.
- `worker.d.ts`, and the handle.
