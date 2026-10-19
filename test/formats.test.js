// Every clustering format version must stay readable. fixtures/clusterings holds a clustering of each version,
// made by the release that introduced it, with that release's palettes (see fixtures/clusterings/make.mjs).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getPaletteFromClustering, getPaletteWeights, getClusteringInfo, quantizeWithClustering } from '../dist/index.mjs';
import { fixtureImage, sizes } from '../fixtures/clusterings/image.js';

const folder = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/clusterings');
const versions = readdirSync(folder).filter((name) => /^v\d+\.bin$/.test(name)).map((name) => Number(name.slice(1, -4))).sort((a, b) => a - b);

const triples = (palette) => Array.from({ length: palette.length / 3 }, (_, i) => Array.from(palette.slice(i * 3, i * 3 + 3)).join(','));

it('has a fixture for every format version', () => {
    expect(versions).toEqual(versions.map((_, i) => i + 1));
    expect(versions.length).toBeGreaterThanOrEqual(2);
});

describe.each(versions)('format version %i', (version) => {

    const clustering = new Uint8Array(readFileSync(resolve(folder, `v${version}.bin`)));
    const { palettes, weights, errors } = JSON.parse(readFileSync(resolve(folder, `v${version}.json`), 'utf8'));

    it('gives the palettes of the release that wrote it', async () => {
        for (const k of sizes) {
            const palette = await getPaletteFromClustering(clustering, k);
            // 1.x palettes came in no particular order, so only their colours must match.
            if (version === 1) {expect(triples(palette).sort()).toEqual(triples(palettes[k]).sort());}
            else {expect(Array.from(palette)).toEqual(palettes[k]);}
        }
    });

    it('quantizes with it', async () => {
        const result = await quantizeWithClustering(fixtureImage(), clustering, 8);
        expect(result.length).toBe(fixtureImage().length);
    });

    if (version >= 3) {
        it('gives the weights and error curve of the release that wrote it', async () => {
            for (const k of sizes) {expect(Array.from(await getPaletteWeights(clustering, k))).toEqual(weights[k]);}
            expect(Array.from((await getClusteringInfo(clustering)).errors)).toEqual(errors);
        });
    } else {
        it('has no weights or error curve', async () => {
            await expect(getPaletteWeights(clustering, 4)).rejects.toThrow('has no weights');
            const info = await getClusteringInfo(clustering);
            expect([info.version, info.totalWeight, info.errors]).toEqual([version, null, null]);
        });
    }

    if (version >= 2) {
        it('starts with the magic byte and its version, and keeps out of 1.x lengths', () => {
            expect([clustering[0], clustering[1]]).toEqual([0xAC, version]);
            expect([4, 7]).toContain(clustering.length % 9);
        });
    }

});
