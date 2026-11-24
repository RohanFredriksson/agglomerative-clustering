# Value brief: a gzipped copy of the WebAssembly in the package

ROADMAP "Smaller WebAssembly, further", "Still open": "plugin hosts that take one file (Figma, Obsidian) embed the module as base64 (115 KB in 3.7.0, or 53 KB gzipped first), and a gzipped copy in the package for `DecompressionStream` would help them."

## Who asked

The maintainer, choosing it from the roadmap ("let's do 1 and then 2 afterwards", 2026-11-24). No outside user has asked. Under the revised test (PRINCIPLES "Settled decisions") test 2 needs the maintainer to state the use case; the roadmap's is single-file plugin hosts.

## The symptom

Examples of what a plugin author would search for; no one has written these:

- "My Figma plugin is 160 KB and half of it is the WebAssembly."
- "How do I make the embedded `.wasm` smaller?"
- "Obsidian plugin size."

## The best recipe

Gzip the module at build time, embed it with the bundler's binary loader, decompress it with `DecompressionStream`, and pass the bytes to `init({ wasm })`. docs/environments.md already ends its "The `.wasm` as bytes" bullet with "(decompress it with `DecompressionStream` before passing it)", but never shows how to make the gzipped file.

- **Length:**
  - one build line: `node -e "…zlib.gzipSync(readFileSync(require.resolve('agglomerative-clustering/clustering.wasm')), { level: 9 })…"`, or `gzip -9k` on the file;
  - three runtime lines: a `Blob` stream piped through `DecompressionStream('gzip')`, read back with `new Response(…).arrayBuffer()`, then `init({ wasm })`.
- **Size** (an esbuild bundle of the main entry with the module embedded, `bench/spikes/wasm-gzip/recipe.mjs` → `results-recipe.txt`):
  - **Raw module:** 160.9 KB, or 70.5 KB if the host gzips the bundle.
  - **Gzipped module:** 101.7 KB, or 58.8 KB.
- **Speed:**
  - **Chromium:** decompressing takes 2.3 ms the first time and 1.2 ms after (`browser.mjs` → `results-browser.txt`).
  - **Node:** a fresh process took 70 ms the first time, which is Node loading its web-streams code. It doesn't matter for plugins, which run in browsers or Electron.
- **Traps:**
  - **Hosts without `DecompressionStream`:** Figma's plugin main thread is a restricted JavaScript sandbox. Whether it has the API is not checked here, and its UI iframe does. A host without it needs a JavaScript inflater, or the raw module.
  - **Remembering to gzip:** the user must gzip again whenever they upgrade the package, or they embed the old module. The library then reports a version mismatch at load, as `wasm-load-failed`, so this is loud, not silent.

## What a built-in adds over it

- **What it would be:** a `dist/clustering.wasm.gz` file, exported as `agglomerative-clustering/clustering.wasm.gz`.
- **What it saves:** the build line, and the trap of a stale file after an upgrade (the shipped copy always matches its version).
- **What it doesn't change:** the three runtime lines stay, since the library can't decompress for the user without carrying an inflater or relying on `DecompressionStream` itself. Neither does it change the size: 40.6 KB either way.
- **Its cost:**
  - an export kept for the major version (stability.md lists `agglomerative-clustering/clustering.wasm` as API, and this would be a second file);
  - 40 KB more in every install's `node_modules` and the tarball;
  - a build step and a test.

## Weighing

The recipe is one build line plus three runtime lines that the docs already half describe, and a built-in removes only the build line. Test 1 (needs the library) fails: nothing here needs the library's internals. Test 5 (smallest shape): the smallest built-in is still a new export kept for the major version.

## Review (2026-11-24)

- **`scope-steward`: recipe.** Test 1 fails: the recipe needs no internals. Test 5 fails: the smallest built-in is still an export kept for the major version, and asset compression is the bundler's job. Run the gzip on every build so the file can't go stale. Check Figma's main thread before naming it. Give both sizes (59 KB saved as shipped, about 12 KB when the host gzips).
- **`user-advocate`: recipe is enough.** It built and ran a six-line esbuild plugin that gzips `clustering.wasm` as it bundles (101.6 KB bundle, clusters correctly). The import stays `agglomerative-clustering/clustering.wasm`, needs no `.gz` loader, and can't go stale; it should be the docs' primary form. `init({ wasm })` takes the `ArrayBuffer`, so the runtime part is two lines. Passing the gzipped bytes undecompressed gives `wasm-load-failed` ("expected magic word 00 61 73 6d, found 1f 8b 08 00"), which never says gzip: a message-only hint for the gzip magic would turn that into a fix. Vite (vite-plugin-singlefile) has no binary loader, which is unmeasured and applies to the raw module today too.

## Recommendation

**Recipe.** Complete the docs' existing bullet in docs/environments.md with the esbuild plugin (primary) and `gzip -9k` (other toolchains), the two runtime lines, both sizes, and the `DecompressionStream` caveat (decompress in Figma's UI iframe, or embed the module raw), and test it in `test/recipes.test.js`. Optionally, have the `wasm-load-failed` message say "these bytes are gzipped: decompress them first" when they start with gzip's magic (`1f 8b`): message text only, no API. Then mark the ROADMAP's "Still open" as done by recipe, and record a gzipped copy in the package under "Considered". Reopen if a host with no build step at all needs it, or if users report copying the build step wrong (PRINCIPLES "Recipes are reviewed again").
