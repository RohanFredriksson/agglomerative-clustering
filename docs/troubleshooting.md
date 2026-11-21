# Troubleshooting

Every error has a `code` (see [Errors](api.md#errors)), and its message says what to check. The table goes by what you see.

| What you see | Why | What to do |
|---|---|---|
| `wasm-load-failed` | The `.wasm` is missing, blocked, served from another version, moved by a server bundle, or the browser has no WebAssembly SIMD. | Check the file is served and the Content-Security-Policy allows `'wasm-unsafe-eval'`; say where it is with `init({ wasm })` ([Loading the WebAssembly module](environments.md#loading-the-webassembly-module)). In Next.js, see [Next.js](environments.md#nextjs). |
| `wasm-load-failed` from a `Clustering` method ("can't run here") | Only the worker entry is imported on this thread, so the methods have no module to run on. | Import `agglomerative-clustering` there too (with `init({ wasm })` if you set where the module comes from), wrap the bytes with `new Clustering(bytes)` from the main entry you use (when it is the other module system's build), or use the worker entry's `…FromClustering` functions, which run in the worker. See [Clustering methods](api.md#clustering-methods). |
| `wasm-load-failed` mentioning a Content-Security-Policy | The page or extension forbids compiling WebAssembly. | Add `'wasm-unsafe-eval'` to `script-src`: the page's for the worker entry's worker, also from a content script. |
| `wasm-load-failed`: "is not WebAssembly" | An error page (a 404, or a server's fallback page) was served in place of `clustering.wasm`. | Open the `.wasm` URL in the browser; copy the file where it is expected, or say where it is with `init({ wasm })`. |
| `wasm-load-failed` in an edge runtime ("disallowed by embedder") | Edge runtimes compile WebAssembly only at build time. | Import the module and pass it to `init`: see [Cloudflare Workers](environments.md#deno-bun-and-cloudflare-workers) and [Next.js](environments.md#nextjs). |
| `wasm-load-failed` under `ulimit -v` | Each instance reserves about 10 GB of address space. | Limit resident memory instead (see [Memory](performance.md#memory)). |
| `invalid-argument` naming a PNG, JPEG, … | You passed an image file's bytes, not pixels. | Decode it first (canvas or `createImageBitmap` in a browser, sharp in Node). |
| `invalid-argument` for a canvas, `Blob` or `ImageBitmap` | Those aren't pixels. | Draw to a canvas and pass `getImageData()`. |
| A palette of nonsense, no error | RGB bytes were passed bare, so they were read as RGBA. | Pass `{ data, format: 'rgb', width }`, or add an alpha channel (`sharp(...).ensureAlpha()`). |
| The palette isn't sorted by how much of the image each colour covers | Palettes come in split order, so they nest. | Sort by `shares` (see [Heaviest first](guides.md#heaviest-first)), or accept the order. |
| `quantizeWithPalette` maps differently from a plain-bytes palette | A `Palette` is matched in the space it was made in, unless you name one. | Pass `colorSpace` explicitly if you want a specific space. |
| A stored OKLab palette maps differently from when it was made | Storage dropped its colour space, so it is matched in RGB. | Store `palette.colorSpace` too and restore it with `new Palette(bytes, colorSpace)` (see [Palette and Clustering](api.md#palette-and-clustering)). |
| `invalid-clustering` for a clustering you stored | Its bytes changed in storage (truncated, re-encoded, mixed up). | Cluster the image again, and check how it is stored: as a binary blob, or base64 that is decoded in full. |
| `unsupported-version` for a stored clustering | It is from 2.x (no weights, for swatches and `getClusteringInfo`) or from a newer version. | Cluster the image again, or upgrade the package. |
| TypeScript says a `Uint8Array` isn't a `Clustering` | Stored bytes lost their type. | `new Clustering(bytes)` (see [Palette and Clustering](api.md#palette-and-clustering)). |
| `out-of-memory` | An image with very many distinct colours, or pixel data over about 1.9 GB. | Scale the image down, or use `precision: 6` (see [Large images](performance.md#large-images)). |
| The worker doesn't start under a bundler (`worker-failed`, or a 404 for `worker-thread.mjs`) | The bundler didn't emit the worker script (Angular, esbuild, Rollup). | Copy the package's `dist/` folder and pass `createWorker({ script })`: see [Angular, esbuild, Rollup and other bundlers](environments.md#angular-esbuild-rollup-and-other-bundlers). |
| `worker-failed` with the worker entry from a CDN, under a CSP | `worker-src` allows `blob:` but not the CDN the worker imports from. | `worker-src blob: <the CDN's origin>`. |
| `worker-failed` in a serverless function, "Cannot find module … worker-thread.mjs" | The bundler or file tracer left the worker's files out. | Leave the package external, or ship `dist/` and pass `createWorker({ script })`: see [Serverless functions](environments.md#serverless-functions-aws-lambda-vercel-netlify). |
| `worker-failed` under Yarn Plug'n'Play, a path inside a `.zip` | Node can't load the worker's ES modules from the zip without Yarn's loader. | Run with `yarn node`, or `yarn unplug agglomerative-clustering`. |
| Threads and memory grow in a long-running process | `createWorker()` workers that were dropped without `terminate()`. | Reuse a few workers, or terminate each one (see [Servers](performance.md#servers)). |
| Jest: "Must use import to load ES Module" (or "Cannot use import statement" for `/worker`) | An older package version; this one loads in Jest's CommonJS mode, both entries. | Upgrade to the latest version. |
