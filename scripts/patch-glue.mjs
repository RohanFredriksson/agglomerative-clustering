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
//    which fetches the .wasm or uses the module it was given. Electron gives its pages (process.type 'renderer', which
//    the glue already excludes) and their Web Workers ('worker', with nodeIntegrationInWorker) Node's globals but not
//    Node's module loader, so those take the web path as well.
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

const fromFile = '&&globalThis.process?.type!="worker"&&typeof import.meta.url=="string"&&import.meta.url.startsWith("file:")';
patch('Node detection', (text) => text.includes(fromFile), /var ENVIRONMENT_IS_NODE=[^;]*process[^;]*;/g,
    (match) => `${match.slice(0, -1)}${fromFile};`);

// 3. The glue's Node-only code uses Node's `process` bare (process.argv, process.exitCode). Parcel and some other bundlers
//    add a `process` polyfill for any bare use, and fail the build where they may not install it (--no-autoinstall, CI).
//    Through globalThis it is the same object in Node, and nothing for a bundler to provide.
const bare = /(?<![.\w$'"])process\b(?=\s*[.[])/g;
source = source.replace(bare, 'globalThis.process');

writeFileSync(file, source);

// 4. A CommonJS copy, dist/clustering.cjs, for module systems that can't require() an ES module: Jest's (in its default
//    CommonJS mode, with or without jsdom) throws "Must use import to load ES Module", and can't run import() at all
//    without --experimental-vm-modules. index.cjs requires the ES glue first, which Node (20.19 and later) and every
//    bundler accept, and this copy only when that throws, so it only ever runs in Node-like runtimes. It reaches Node's
//    modules through process.getBuiltinModule (Node 20.16 and later, Bun, Deno, and Jest's sandbox) rather than
//    require("node:fs"), so a bundler that sees both requires in index.cjs finds nothing here to resolve.
const replaceOnce = (text, name, pattern, replace) => {
    const found = text.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)) || [];
    if (found.length !== 1) {
        throw new Error(`patch-glue (CommonJS copy, ${name}): expected exactly one match in the Emscripten glue, found ${found.length}. Update scripts/patch-glue.mjs for this Emscripten version.`);
    }
    return text.replace(pattern, replace);
};
let common = source;
common = replaceOnce(common, 'node:module import', /const\{createRequire\}=await\(import\([^;]*\)\);var require=createRequire\(import\.meta\.url\)/,
    'var require=(name)=>process.getBuiltinModule(name)');
common = replaceOnce(common, 'Node detection', /typeof import\.meta\.url=="string"&&import\.meta\.url\.startsWith\("file:"\)/,
    'typeof __filename=="string"&&typeof process.getBuiltinModule=="function"');
common = replaceOnce(common, 'export', /export default createWasmModule;?/, 'module.exports=createWasmModule;');
common = common.replaceAll('import.meta.url', '__agglomerativeGlueUrl');
if (/\bimport\s*\(|\bimport\.meta\b|^\s*export\s/m.test(common)) {
    throw new Error('patch-glue (CommonJS copy): ES module syntax is left in the CommonJS glue. Update scripts/patch-glue.mjs for this Emscripten version.');
}
// The glue's own URL, as import.meta.url would give it: this file's, in Node.
common = `"use strict";var __agglomerativeGlueUrl=typeof __filename=="string"&&typeof process!="undefined"&&typeof process.getBuiltinModule=="function"?process.getBuiltinModule("node:url").pathToFileURL(__filename).href:"";\n${common}`;
writeFileSync(new URL('../dist/clustering.cjs', import.meta.url), common);
