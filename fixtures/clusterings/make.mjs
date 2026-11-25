// Writes a clustering fixture: node fixtures/clusterings/make.mjs <format version> <path to a build's index.mjs> [release]
// It clusters fixtureImage() with that build and stores the clustering (v<N>.bin) and that build's own palettes
// for each size (v<N>.json), plus weights and the error curve from builds that have them. `release` labels an
// unreleased build; it defaults to the build's package.json version. Fixtures are made once per format version, with the release that introduced it, and
// never regenerated: test/formats.test.js checks the current reader still gives the same palettes. (v1.bin, from the
// published 1.1.4, is kept as a negative case: 3.0 stopped reading 1.x clusterings.)
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fixtureImage, sizes } from './image.js';

const [version, build, release] = process.argv.slice(2);
const library = await import(resolve(build));
const here = dirname(fileURLToPath(import.meta.url));

const clustering = await (library.buildClustering ?? library.getClustering)(fixtureImage());   // 3.4.0 renamed it
const fixture = { made_with: release ?? (await import(resolve(dirname(build), '../package.json'), { with: { type: 'json' } })).default.version, palettes: {} };
// 4.0 forms (methods on the clustering) when the build has them; builds before 3.3 only have the function forms.
const palette = (k) => clustering.getPalette ? clustering.getPalette(k) : library.getPaletteFromClustering(clustering, k);
const swatches = (k) => clustering.getSwatches ? clustering.getSwatches(k) : library.getSwatchesFromClustering(clustering, k);
const info = () => clustering.getClusteringInfo ? clustering.getClusteringInfo() : library.getClusteringInfo(clustering);
for (const k of sizes) {fixture.palettes[k] = Array.from(await palette(k));}
if (clustering.getSwatches || library.getSwatchesFromClustering) {
    fixture.weights = {};
    for (const k of sizes) {fixture.weights[k] = Array.from((await swatches(k)).weights);}
    fixture.mse = Array.from((await info()).mse);
}

writeFileSync(resolve(here, `v${version}.bin`), clustering);
writeFileSync(resolve(here, `v${version}.json`), JSON.stringify(fixture) + '\n');
