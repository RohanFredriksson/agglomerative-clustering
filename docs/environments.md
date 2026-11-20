# Environments

Most setups need nothing: Node, Vite, webpack 5, Rsbuild, SvelteKit, Nuxt and Next.js client code find the WebAssembly module and the worker script themselves. This page covers the ones that need a line of configuration, and how to tell the package where its files are when a bundler moves them.

- [Where it runs](#where-it-runs)
- [Loading the WebAssembly module](#loading-the-webassembly-module)
- [From a CDN, without a build step](#from-a-cdn-without-a-build-step)
- [Deno, Bun and Cloudflare Workers](#deno-bun-and-cloudflare-workers)
- [Next.js](#nextjs)
- [SvelteKit, Nuxt and other frameworks](#sveltekit-nuxt-and-other-frameworks)
- [Angular, esbuild, Rollup and other bundlers](#angular-esbuild-rollup-and-other-bundlers)
- [Serverless functions: AWS Lambda, Vercel, Netlify](#serverless-functions-aws-lambda-vercel-netlify)
- [pnpm, Yarn Plug'n'Play and monorepos](#pnpm-yarn-plugnplay-and-monorepos)
- [Electron](#electron)
- [Browser extensions](#browser-extensions)
- [Plugins and single-file hosts: Figma, VS Code, Obsidian](#plugins-and-single-file-hosts-figma-vs-code-obsidian)
- [Testing code that uses it](#testing-code-that-uses-it)
- [Writing a package that wraps it](#writing-a-package-that-wraps-it)

## Where it runs

Node 20.19+ and 22.12+ (CI tests Node 20, 22 and 24, on Linux and Windows), and browsers with WebAssembly SIMD: Chrome and Edge 91, Firefox 89, Safari 16.4 or newer ([support table](https://caniuse.com/wasm-simd)). CI bundles a test page with Vite and webpack 5 and runs it in Chromium, Firefox and WebKit on Linux and in Safari on macOS, loads `dist/` from another origin as a page using a CDN does, starts the worker entry from a sandboxed iframe, and runs both entries under Jest. In a browser without SIMD, or where the `.wasm` is blocked or missing, `init` and every other call reject with a `wasm-load-failed` error.

Checked by hand, not in CI: Deno 2.9, Bun 1.4, Cloudflare Workers (Wrangler, workerd), Vercel's edge runtime, the AWS Lambda Node image, pnpm and Yarn Plug'n'Play, SvelteKit, Nuxt, Astro, React Router, Angular, Next.js and Parcel 2.

## Loading the WebAssembly module

By default the module is found next to the package's script, which Node and bundlers such as Vite handle. Otherwise, say where it is before any other call (the first load that succeeds wins):

```js
await init({ wasm: 'https://cdn.example.com/clustering.wasm' });      // a URL or path string, or a URL
await init({ wasm: await (await fetch(url)).arrayBuffer() });          // the bytes
await init({ wasm: wasmModule });                                      // a compiled WebAssembly.Module
```

The package exports the file as `agglomerative-clustering/clustering.wasm`, so a bundler that imports `.wasm` files as compiled modules (Wrangler, for Cloudflare Workers) can give you `wasmModule`. In Node a path or `file:` URL is read from disk, also when the package is bundled into CommonJS, and an `http(s)` URL is fetched. A strict Content-Security-Policy needs `'wasm-unsafe-eval'` in `script-src`. `createWorker({ wasm })` passes the same option to a worker.

**Copying files.** When you copy the package's files for a bundler or host that doesn't emit them, copy the whole `dist/` folder and keep the `.mjs` names (they are ES modules by their extension). Which files the worker script imports isn't part of the API, and can change in a minor release.

## From a CDN, without a build step

```html
<script type="module">
  import { getSwatches } from 'https://cdn.jsdelivr.net/npm/agglomerative-clustering@3/dist/index.mjs';
  import { createWorker } from 'https://cdn.jsdelivr.net/npm/agglomerative-clustering@3/dist/worker.mjs';
</script>
```

- **Paths.** Import `dist/index.mjs` and `dist/worker.mjs` by their paths (jsDelivr and unpkg don't follow the package's `exports` for subpaths such as `/worker`); `https://esm.sh/agglomerative-clustering@3` works too. The `.wasm` is found next to the script, so `init` needs no `wasm` option. Pin an exact version in production, as `@3.0.0` rather than the range `@3`.
- **Content-Security-Policy.** It needs the CDN in `script-src` and `connect-src` (the `.wasm` is fetched) and `'wasm-unsafe-eval'` in `script-src`. The worker entry starts its worker through a `blob:` script that imports from the CDN, so it also needs `worker-src blob:` *and* the CDN: `worker-src blob: https://cdn.jsdelivr.net`.

## Deno, Bun and Cloudflare Workers

- **Bun** needs nothing: `bun add agglomerative-clustering`, then both entries work as in Node.
- **Deno**: `import { getPalette } from 'npm:agglomerative-clustering'`, run with `--allow-read` (the `.wasm` is read from the package). Importing from a CDN URL works too, without it. The worker entry runs on Deno's `worker_threads`, which is about 3 times slower per call than the main entry; for a few calls, use the main entry. Deno doesn't install npm versions less than a day old by default, so on the day of a release it may quietly install the previous one (`"minimumDependencyAge": 0` in `deno.json` turns that off; the exported `version` says what you got).
- **Cloudflare Workers**: Wrangler imports a `.wasm` file as a compiled module, so give it to `init` before the first call. There are no threads, so use the main entry.

  ```js
  import { init, getSwatches } from 'agglomerative-clustering';
  import wasm from 'agglomerative-clustering/clustering.wasm';

  const ready = init({ wasm });
  export default {
    async fetch(request) {
      await ready;
      // … decode the upload to pixels (fast-png works here), then getSwatches(pixels, 8)
    },
  };
  ```

## Next.js

Checked with Next.js 16, under Turbopack and webpack, in production builds:

- **Client components** need nothing: the main entry and the worker entry both work as they are.
- **Route handlers and Server Components** (the Node runtime) work as they are too. A server bundle moves the package's files away from each other, so the library then loads `clustering.wasm` and the worker script from the package in `node_modules`, found from the directory the server runs in. If your deployment doesn't ship `node_modules` with the server (a `standalone` output copied elsewhere, say), leave the package out of the bundle instead, which keeps its files together:

  ```js
  // next.config.js
  export default { serverExternalPackages: ['agglomerative-clustering'] };
  ```
- **The Edge runtime** can't fetch or compile a `.wasm` file itself, so import the module and pass it to `init`. The import has to be a relative path to the file (the bundler drops the `?module` query from a package path):

  ```ts
  import { init, getSwatches } from 'agglomerative-clustering';
  // @ts-expect-error -- `?module` gives a compiled WebAssembly.Module
  import wasm from '../../../node_modules/agglomerative-clustering/dist/clustering.wasm?module';

  export const runtime = 'edge';

  export async function POST(request: Request) {
    await init({ wasm });   // loads once; later calls return at once
    // … decode the upload to pixels, then getSwatches(pixels, 8)
  }
  ```

## SvelteKit, Nuxt and other frameworks

SvelteKit (adapter-node) and Nuxt (Nitro's node-server) need no configuration, in development and production builds: the worker entry for pages, the main entry in server routes. Importing either entry during server rendering is safe, and `createWorker()` starts no thread until its first call. On Nitro's Cloudflare preset, turn on `nitro: { experimental: { wasm: true } }` and pass the module from `import wasm from 'agglomerative-clustering/clustering.wasm?module'` to `init`, as for the [Edge runtime](#nextjs).

## Angular, esbuild, Rollup and other bundlers

The main entry works in all of them, except that an Angular production build needs `init({ wasm })` (below). The worker entry needs its script (`worker-thread.mjs`, which imports the package's other files), and some bundlers emit neither it nor `clustering.wasm`. A worker call then fails at run time with `worker-failed` or `wasm-load-failed`, often only after deploying, because a dev server serves `node_modules` as it is. Copy the package's whole `dist/` folder out as static assets and say where it is:

```js
import { createWorker } from 'agglomerative-clustering/worker';
const worker = createWorker({
  script: '/assets/agglomerative-clustering/worker-thread.mjs',   // relative URLs resolve against the page
  wasm: '/assets/agglomerative-clustering/clustering.wasm',
});
```

- **Angular** (the default `application` builder): add the files to the app's `angular.json` assets, then use the code above. Production builds don't emit `clustering.wasm` for the main entry either, so in the browser call `init({ wasm: '/assets/agglomerative-clustering/clustering.wasm' })` before the first call (the dev server works without it). With SSR, the server bundle finds the package's files from the directory the server starts in: start it from the project directory, or give the server its own `init({ wasm: path })`. zone.js needs nothing.

  ```json
  "assets": [{ "glob": "**/*", "input": "node_modules/agglomerative-clustering/dist", "output": "assets/agglomerative-clustering" }]
  ```
- **esbuild, Rollup and `bun build`** do not recognise `new Worker(new URL(...))`, so copy the whole `dist/` folder into the output and give `script` (and `wasm`). Rollup users can also build `worker-thread.mjs` as a second entry.
- **Vite, webpack 5 and Rsbuild** find the script themselves. So does **Parcel 2**, once it reads package `exports` (without this it can't resolve `agglomerative-clustering/worker`): set `"@parcel/resolver-default": { "packageExports": true }` in your `package.json`.
- **A server bundle** (esbuild or Rollup with a Node target, CommonJS or ES module): leave the package external if you ship `node_modules`. Bundled, it finds its files from the working directory, if at all: pass `init({ wasm: path })` and `createWorker({ script: path })`, with paths to copies of `dist/` that you ship.

## Serverless functions: AWS Lambda, Vercel, Netlify

Both entries run in Node functions (checked in the AWS Lambda Node 20 image, with a read-only code directory, and with the file tracers Vercel and Netlify use). Unbundled, with `node_modules` in the package or a layer, nothing is needed. Bundled:

- **An ES module bundle** finds `clustering.wasm` next to itself: copy `node_modules/agglomerative-clustering/dist/clustering.wasm` beside the bundle. **A CommonJS bundle** has lost the package's own location: pass `init({ wasm: path })`, with a path to the copy you ship.
- **The worker entry** needs `worker-thread.mjs` and the files it imports: leave the package external, or ship a copy of `dist/` and pass `createWorker({ script: path })`. Netlify's esbuild bundler moves them apart, so list the package in `external_node_modules`.
- **Size and cold starts:** the files a function needs are about 180 KB (235 KB with the worker). Loading the module takes 10 to 70 ms, and a first palette of a 1-megapixel image at `precision: 6` came 0.3 to 0.5 s after a cold start; calling `init()` early doesn't make the first palette faster.
- **Edge functions** (Vercel's edge runtime, Cloudflare) can't compile WebAssembly while they run: import the module as for [Next.js](#nextjs) and [Cloudflare Workers](#deno-bun-and-cloudflare-workers).

## pnpm, Yarn Plug'n'Play and monorepos

pnpm (isolated or hoisted) and Yarn Plug'n'Play need nothing for the main entry. Under Plug'n'Play the package stays in its zip archive, and the worker entry's thread loads its ES modules from there only through Yarn's loader: run with `yarn node` (or `node --require ./.pnp.cjs --loader ./.pnp.loader.mjs`), or `yarn unplug agglomerative-clustering`. Yarn 4 holds back versions published in the last day by default, so to try a release on its first day set `npmMinimalAgeGate: 0` in `.yarnrc.yml`.

Two versions in one process (a monorepo whose packages depend on different releases) each load their own module and don't share state; clusterings and palettes pass between them, and `isCodedError` recognises either one's errors.

## Electron

Everything works in dev and in an app packaged with `asar` (no `asarUnpack`), in the renderer, the main process and a `utilityProcess`, loaded from `file://`, a custom scheme or a dev server. For responsiveness, **decode in the renderer and use `agglomerative-clustering/worker`** there: the main entry in the main process blocks the whole app for the length of a clustering.

- **Keep the package external in a bundled main process** (electron-vite does by default; with webpack or esbuild mark it external). A bundle that inlines it finds the `.wasm` and worker script only when the app starts from the project directory, which a packaged app doesn't. If you must bundle it, pass `init({ wasm })` for the main entry and `createWorker({ script })` for the worker.
- **`nodeIntegrationInWorker: true`** is supported: the worker script talks through `self` there.
- **Errors lose their `code` and `argument` crossing Electron's IPC** (only the message survives), so send `{ message, code, argument }` yourself; `isCodedError` accepts that object on the other side.
- **`nativeImage` gives BGRA pixels** (Skia's native order in Electron on Windows, macOS and Linux): pass them as `format: 'bgra'`, and a mapped image comes back in the same order for `nativeImage.createFromBitmap`. They are also **premultiplied** (`toBitmap()` writes Skia's premultiplied N32), while the library reads straight alpha. Opaque images (screenshots, captures, opaque pages) are the same either way; for partly transparent ones, convert on the way in and out (premultiplied input is [planned for 4.0](ROADMAP.md#40-breaking-changes-collected)):

  ```js
  // In the main process (or a preload script): nativeImage and Buffer aren't in a sandboxed renderer.
  const { width, height } = img.getSize();
  const data = img.toBitmap();
  for (let i = 0; i < data.length; i += 4) {   // premultiplied to straight
      const a = data[i + 3];
      for (let c = i; c < i + 3; c++) {data[c] = a ? Math.min(255, Math.round(data[c] * 255 / a)) : 0;}
  }
  const result = await quantize({ data, format: 'bgra', width, height }, 16);
  for (let i = 0; i < result.data.length; i += 4) {   // straight to premultiplied
      const a = result.data[i + 3];
      for (let c = i; c < i + 3; c++) {result.data[c] = Math.round(result.data[c] * a / 255);}
  }
  const reduced = nativeImage.createFromBitmap(Buffer.from(result.data.buffer, result.data.byteOffset, result.data.byteLength), { width, height });
  ```

## Browser extensions

The main entry runs in every extension context: a Manifest V3 service worker, an offscreen document, extension pages and content scripts (a page's own Content-Security-Policy does not apply to the main entry in a content script). Tested in Chrome and in Firefox's extension pages and background.

- **Manifest CSP.** Compiling WebAssembly in the service worker, an offscreen document or an extension page needs `'wasm-unsafe-eval'` (not `'wasm-eval'`, which Chrome refuses in a manifest): `"content_security_policy": { "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" }`. The main entry in a content script needs nothing.
- **A service worker has no `Worker`**, so use the main entry there, which already keeps the page's thread free. The worker entry works in an offscreen document or an extension page. In a content script it starts its worker through a `blob:` URL, and that worker follows the *page's* policy, so it works only on pages whose CSP allows `worker-src blob:` and `'wasm-unsafe-eval'` (or has no CSP); on other pages, use the main entry in the content script, or hand the pixels to an offscreen document.
- **Files.** With Vite and CRXJS the `.wasm` and worker script are emitted and made web-accessible for you. Without a bundler, copy `dist/` into the extension and list its files under `web_accessible_resources` if a content script loads them (all of them: a `.wasm` left out fails as "could not be fetched", and only the browser's console names the key).
- **Cross-origin images:** a service worker can fetch them with host permissions (a content script gets a tainted canvas), so cluster there. Typed arrays become plain objects through `chrome.runtime.sendMessage`: convert with `Array.from(palette)` and back with `new Uint8Array(...)`.

## Plugins and single-file hosts: Figma, VS Code, Obsidian

Some hosts load a plugin as one file, or a few fixed ones, so the package's `.wasm` and worker script can't sit next to it. Embed them, and say where everything is: in these hosts the package can't find its own files. (Tested against stand-ins for these hosts: a sandboxed iframe, a Node host process, an Electron renderer. Not inside the apps themselves.)

- **The `.wasm` as bytes.** Import it with your bundler's binary loader (esbuild: `--loader:.wasm=binary`, importing `agglomerative-clustering/clustering.wasm`) and pass the bytes: `init({ wasm: bytes })` for the main entry, `createWorker({ wasm: bytes })` for a worker. Set esbuild's `target` (such as `es2022`), or the decoder it emits may use `Uint8Array.fromBase64`, which not every runtime has. The file is about 92 KB, 122 KB as base64, and 54 KB gzipped then base64 (decompress it with `DecompressionStream` before passing it).
- **The worker script as a `data:` URL.** Bundle `node_modules/agglomerative-clustering/dist/worker-thread.mjs` into one ES module (esbuild `--bundle --format=esm`) and pass it as `createWorker({ script: 'data:text/javascript;base64,…', wasm: bytes })`. In a sandboxed iframe (Figma's UI) a `blob:` worker fails in Chromium; a `data:` one works. The main entry alone is often enough for a plugin's images, and needs only the bytes.
- **VS Code.** The extension host is Node: bundle your extension with the package external and ship it in `node_modules`, or bundle it and pass a path to a `.wasm` you ship (`init({ wasm: path.join(context.extensionPath, 'dist', 'clustering.wasm') })`); a bundled extension otherwise looks for the package from the working directory, which is not your extension's. A webview's CSP needs `'wasm-unsafe-eval'` in `script-src`, and `worker-src` for the worker entry.
- **Obsidian** ships `main.js`, `manifest.json` and `styles.css` only, so embed the `.wasm` bytes. Its renderer has Node's globals and a real `Worker`, so both entries work once given the bytes (and, for workers, the `data:` script).
- **Get it wrong** and the error says so: a bundled main entry without its `.wasm` fails with `wasm-load-failed` asking for `init({ wasm })`, and a worker without its script with `worker-failed` naming `createWorker({ script })`.

## Testing code that uses it

- **Vitest** needs no configuration, in node, jsdom, happy-dom and browser mode. **Storybook** (Vite builder) works as it is.
- **Jest** works in its default CommonJS mode, in the node and jsdom environments, with both entries, without transforms or `--experimental-vm-modules` (both have CommonJS builds). Mocha and `node:test` work too.
- **jsdom and happy-dom** have no `ImageData` (install `canvas`, `@napi-rs/canvas` or `skia-canvas`, or pass `{ data, format: 'rgba', width }`) and no `Worker`: the worker entry then uses a Node worker thread, which is fine for tests. Results come back in the class of the `ImageData` you passed.
- **Leaks.** Call `terminate()` (from `agglomerative-clustering/worker`, or on a `createWorker()`) in `afterAll`. It doesn't stop Jest from exiting, but each test file otherwise leaves a worker thread, 15 to 30 MB, in the process until the run ends.
- **Mocking.** Mock the module with a factory (`vi.mock('agglomerative-clustering', () => ({ getPalette: vi.fn(...) }))`), or in Vitest keep the real `Palette` with `importOriginal`. Build fake palettes with `new Palette(bytes, colorSpace)`, and fake errors as `Object.assign(new Error(message), { code: 'invalid-argument' })` (`isCodedError` accepts them).
- **Snapshots.** Palettes (and swatches, indices, mapped pixels) are identical across platforms, Node versions and browsers, and within a major version change only for a bug fix that the changelog names: snapshot them, and expect to update a snapshot when such a fix lands. Clustering bytes are not promised to stay the same, so don't hash them. `toEqual` doesn't see a palette's `colorSpace`: compare it explicitly.
- Fake timers don't affect it. An unawaited call still running at the end holds Jest open until it finishes.

## Writing a package that wraps it

Make `agglomerative-clustering` a **`peerDependency`** and keep it **external** in your build (tsup `external`, Rollup `external`): the app's bundler then finds the worker script and `.wasm` once, with one copy in the output. Bundling it into your package leaves `./worker-thread.mjs` unresolved. Re-export `errorCodes`, `isCodedError` and the types you need (`CodedError`, `ErrorCode`, `ClusteringOptions`, …), check `version` against your supported range at run time, and let your users pass `wasm` and `script` through. Importing it on the server (SSR) doesn't run anything: only calls load the module.
