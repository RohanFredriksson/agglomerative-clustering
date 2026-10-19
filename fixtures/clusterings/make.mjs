// Writes a clustering fixture: node fixtures/clusterings/make.mjs <format version> <path to a build's index.mjs> [release]
// It clusters fixtureImage() with that build and stores the clustering (v<N>.bin) and that build's own palettes
// for each size (v<N>.json), plus weights and the error curve from builds that have them. `release` labels an
// unreleased build; it defaults to the build's package.json version. Fixtures are made once per format version, with the release that introduced it, and
// never regenerated: test/formats.test.js checks the current reader still gives the same palettes.
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fixtureImage, sizes } from './image.js';

const [version, build, release] = process.argv.slice(2);
const library = await import(resolve(build));
const here = dirname(fileURLToPath(import.meta.url));

const clustering = await library.getClustering(fixtureImage());
const fixture = { made_with: release ?? (await import(resolve(dirname(build), '../package.json'), { with: { type: 'json' } })).default.version, palettes: {} };
for (const k of sizes) {fixture.palettes[k] = Array.from(await library.getPaletteFromClustering(clustering, k));}
if (library.getPaletteWeights) {
    fixture.weights = {};
    for (const k of sizes) {fixture.weights[k] = Array.from(await library.getPaletteWeights(clustering, k));}
    fixture.errors = Array.from((await library.getClusteringInfo(clustering)).errors);
}

writeFileSync(resolve(here, `v${version}.bin`), clustering);
writeFileSync(resolve(here, `v${version}.json`), JSON.stringify(fixture) + '\n');
