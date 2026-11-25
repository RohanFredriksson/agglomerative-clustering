// Post-processes the CommonJS build (dist/index.cjs) after Babel. Its require of the Emscripten glue, an ES module, works
// in Node (22.12 and later, which can require() ES modules) and in bundlers, but Jest's module system can't load it
// ("Must use import to load ES Module"). Then the CommonJS copy of the glue (dist/clustering.cjs, see patch-glue.mjs) is
// used instead.
import { readFileSync, writeFileSync } from 'fs';

const file = new URL('../dist/index.cjs', import.meta.url);
const source = readFileSync(file, 'utf8');
const pattern = /require\("\.\/clustering\.js"\)/g;
const found = source.match(pattern) || [];
if (found.length !== 1) {
    throw new Error(`patch-cjs: expected exactly one require of ./clustering.js in dist/index.cjs, found ${found.length}.`);
}
writeFileSync(file, source.replace(pattern, '(() => {\n  try {\n    return require("./clustering.js");\n  } catch (error) {\n    // A module system that can\'t require() an ES module (Jest): the CommonJS copy of the glue.\n    return require("./clustering.cjs");\n  }\n})()'));

// The worker entry's CommonJS build, dist/worker.cjs, for require() in Node and in Jest's default CommonJS mode (which can't
// load an ES module at all). It finds its worker script (worker-thread.mjs, an ES module that Node runs itself, outside
// Jest's module system) from its own location, as import.meta.url would give it: __filename, in Node. Elsewhere (a browser
// bundle that require()s it) it has none, and says to import the ES module or pass createWorker({ script }).
const workerFile = new URL('../dist/worker.cjs', import.meta.url);
let worker = readFileSync(workerFile, 'utf8');
const metaUrl = /import\.meta\.url/g;
if ((worker.match(metaUrl) || []).length < 2) {
    throw new Error('patch-cjs: expected import.meta.url in dist/worker.cjs (the worker entry finds its script from it).');
}
worker = worker.replace(metaUrl, '__agglomerativeWorkerUrl');
if (/\bimport\.meta\b|\bimport\s*\(/.test(worker)) {
    throw new Error('patch-cjs: ES module syntax is left in dist/worker.cjs.');
}
const prefix = 'var __agglomerativeWorkerUrl = typeof __filename == "string" && globalThis.process && typeof globalThis.process.getBuiltinModule == "function" ? globalThis.process.getBuiltinModule("node:url").pathToFileURL(__filename).href : "";\n';
worker = worker.startsWith('"use strict";') ? worker.replace('"use strict";', `"use strict";\n${prefix}`) : `${prefix}${worker}`;
// File tracers that pack serverless functions (@vercel/nft, which Vercel and Netlify use) find a CommonJS module's files
// from `__dirname` paths, not from the run-time URL above, so without this they leave worker-thread.mjs (and everything
// it imports, which they then follow) out of the function. Never called: it is only there to be read.
worker += '\n// For file tracers (see scripts/patch-cjs.mjs); never called.\n// eslint-disable-next-line no-unused-vars\nvar __agglomerativeTracedFiles = function () {\n  return [__dirname + "/worker-thread.mjs"];\n};\n';
writeFileSync(workerFile, worker);
