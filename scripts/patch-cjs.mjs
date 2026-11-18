// Post-processes the CommonJS build (dist/index.cjs) after Babel. Its require of the Emscripten glue, an ES module, works
// in Node (20.19 and later, which can require() ES modules) and in bundlers, but Jest's module system can't load it
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
