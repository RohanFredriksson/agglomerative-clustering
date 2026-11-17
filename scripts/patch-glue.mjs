// Post-processes the Emscripten glue (dist/clustering.js) after `em++`. Each patch must find what it changes exactly once,
// so a changed Emscripten output fails the build instead of silently skipping one; a patch already applied is left alone.
//
// 1. The glue loads Node's `module` with a dynamic import that only runs under Node, but bundlers read a literal specifier
//    statically: webpack stops with "UnhandledSchemeError" on the `node:` scheme for a browser target, esbuild (and so
//    Wrangler for Cloudflare Workers) stops with "Could not resolve", and Vite warns that the module was externalized.
//    Comment hints are not enough (esbuild ignores them for a literal), so the specifier is built at run time, which no
//    bundler tries to resolve; the hints are kept for those that do honour them. Node resolves it exactly as before, and
//    browsers and Workers never reach it.
//
// 2. The glue decides it runs in Node when `process.versions.node` exists. Runtimes that imitate Node define that too:
//    Cloudflare Workers with a recent compatibility date or `nodejs_compat`, Nitro's Cloudflare build (Nuxt), and Deno
//    running the package from a CDN URL. The glue then takes its Node path (createRequire(import.meta.url), node:fs) and
//    fails before it looks at a module passed to init({ wasm }). Node, Bun and Deno running from npm, and server bundles,
//    load the glue from a file, so being loaded from a `file:` URL is required too; everything else takes the web path,
//    which fetches the .wasm or uses the module it was given.
import { readFileSync, writeFileSync } from 'fs';

const file = new URL('../dist/clustering.js', import.meta.url);
let source = readFileSync(file, 'utf8');

const patch = (name, applied, pattern, replace) => {
    if (applied(source)) {return;}
    const found = source.match(pattern) || [];
    if (found.length !== 1) {
        throw new Error(`patch-glue (${name}): expected exactly one match in the Emscripten glue, found ${found.length}. Update scripts/patch-glue.mjs for this Emscripten version.`);
    }
    source = source.replace(pattern, replace);
};

const hinted = 'import(/* webpackIgnore: true */ /* @vite-ignore */ ';
patch('node:module import', (text) => text.includes(hinted), /import\((["'])(node:)?module\1\)/g,
    (match, quote, scheme) => `${hinted}${scheme ? '["node", "module"].join(":")' : '["module"].join("")'})`);

const fromFile = '&&typeof import.meta.url=="string"&&import.meta.url.startsWith("file:")';
patch('Node detection', (text) => text.includes(fromFile), /var ENVIRONMENT_IS_NODE=[^;]*process[^;]*;/g,
    (match) => `${match.slice(0, -1)}${fromFile};`);

writeFileSync(file, source);
