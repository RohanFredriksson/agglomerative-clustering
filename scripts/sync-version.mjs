// Keeps the library version in step across the places that carry a copy of it: package.json is the source, and
// src/shared.js (which both entries export it from) and src/version.hpp (which the .wasm is built from, so the module can say which version it
// is) are rewritten to match. `npm version` runs this (the "version" script) before it commits, so a release commit
// always has all of them; `--check` (run first by `npm run build`) fails if any copy differs, so a mismatch can't be
// built or published. Fails too if a marker is missing, so a reworded line can't silently stop being synced.
import { readFileSync, writeFileSync } from 'fs';

const root = new URL('../', import.meta.url);
const version = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).version;
const check = process.argv.includes('--check');

const targets = [
    ['src/shared.js', /^export const version = '[^']*';$/m, `export const version = '${version}';`],
    ['src/version.hpp', /^#define AGGLOMERATIVE_CLUSTERING_VERSION "[^"]*"$/m, `#define AGGLOMERATIVE_CLUSTERING_VERSION "agglomerative-clustering@${version}"`],
];

let stale = 0;
for (const [path, pattern, line] of targets) {
    const file = new URL(path, root);
    const source = readFileSync(file, 'utf8');
    if (!pattern.test(source)) {throw new Error(`${path}: the version line was not found. Update scripts/sync-version.mjs.`);}
    const updated = source.replace(pattern, line);
    if (updated === source) {continue;}
    if (check) {console.error(`${path} does not carry version ${version}. Run: node scripts/sync-version.mjs`); stale++;} else {writeFileSync(file, updated);}
}
if (stale) {process.exit(1);}
