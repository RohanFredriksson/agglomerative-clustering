// Post-processes the Emscripten glue (dist/clustering.js) after `em++`. The glue loads Node's `module` with a dynamic
// import that only runs under Node, but bundlers read a literal specifier statically: webpack stops with
// "UnhandledSchemeError" on the `node:` scheme for a browser target, esbuild (and so Wrangler for Cloudflare Workers)
// stops with "Could not resolve", and Vite warns that the module was externalized. Comment hints are not enough
// (esbuild ignores them for a literal), so the specifier is built at run time, which no bundler tries to resolve;
// the hints are kept for those that do honour them. Node resolves it exactly as before, and browsers and Workers
// never reach it. The build fails if the import isn't found exactly once, so a changed Emscripten output can't
// silently skip this.
import { readFileSync, writeFileSync } from 'fs';

const file = new URL('../dist/clustering.js', import.meta.url);
const source = readFileSync(file, 'utf8');
const hinted = 'import(/* webpackIgnore: true */ /* @vite-ignore */ ';

if (source.includes(hinted)) {process.exit(0);}   // already patched

const pattern = /import\((["'])(node:)?module\1\)/g;
const found = source.match(pattern) || [];
if (found.length !== 1) {
    throw new Error(`Expected exactly one import("module") in the Emscripten glue, found ${found.length}. Update scripts/patch-glue.mjs for this Emscripten version.`);
}
writeFileSync(file, source.replace(pattern, (match, quote, scheme) => `${hinted}${scheme ? '["node", "module"].join(":")' : '["module"].join("")'})`));
