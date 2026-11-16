// Every clustering format version from 2 on must stay readable. fixtures/clusterings holds a clustering of each version,
// made by the release that introduced it, with that release's palettes (see fixtures/clusterings/make.mjs). The 1.x
// clustering is kept as a negative case: it had no header and could only be recognised by its length, which many other
// byte strings share, so 3.0 stopped reading it.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getPaletteFromClustering, getSwatchesFromClustering, getClusteringInfo, quantizeWithClustering } from '../dist/index.mjs';

// The weight of each colour in a cut, from the swatches (the weights alone used to be a function of their own).
const weightsOf = async (clustering, k) => (await getSwatchesFromClustering(clustering, k)).weights;

import { fixtureImage, sizes } from '../fixtures/clusterings/image.js';

const folder = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/clusterings');
const versions = readdirSync(folder).filter((name) => /^v\d+\.bin$/.test(name)).map((name) => Number(name.slice(1, -4))).sort((a, b) => a - b);

it('has a fixture for every format version', () => {
    expect(versions).toEqual(versions.map((_, i) => i + 1));
    expect(versions.length).toBeGreaterThanOrEqual(3);
});

describe('format version 1 (1.x), which is no longer read', () => {

    const legacy = new Uint8Array(readFileSync(resolve(folder, 'v1.bin')));

    it('is rejected by every function that takes a clustering, with a message that says what to do', async () => {
        for (const call of [
            () => getPaletteFromClustering(legacy, 8),
            () => weightsOf(legacy, 8),
            () => getClusteringInfo(legacy),
            () => quantizeWithClustering(fixtureImage(), legacy, 8),
        ]) {
            const error = await call().catch((e) => e);
            expect(error.code).toBe('invalid-clustering');
            expect(error.message).toContain('1.x');
            expect(error.message).toContain('cluster the image again');
        }
    });

});

describe.each(versions.filter((version) => version >= 2))('format version %i', (version) => {

    const clustering = new Uint8Array(readFileSync(resolve(folder, `v${version}.bin`)));
    const { palettes, weights, mse } = JSON.parse(readFileSync(resolve(folder, `v${version}.json`), 'utf8'));

    it('gives the palettes of the release that wrote it', async () => {
        for (const k of sizes) {
            const palette = await getPaletteFromClustering(clustering, k);
            expect(Array.from(palette)).toEqual(palettes[k]);
        }
    });

    it('quantizes with it', async () => {
        const result = await quantizeWithClustering(fixtureImage(), clustering, 8);
        expect(result.length).toBe(fixtureImage().length);
    });

    if (version >= 3) {
        it('gives the weights and error curve of the release that wrote it', async () => {
            for (const k of sizes) {expect(Array.from(await weightsOf(clustering, k))).toEqual(weights[k]);}
            expect(Array.from((await getClusteringInfo(clustering)).mse)).toEqual(mse);
        });
    } else {
        it('has no weights or error curve', async () => {
            await expect(weightsOf(clustering, 4)).rejects.toThrow('has no weights');
            const info = await getClusteringInfo(clustering);
            expect([info.version, info.totalWeight, info.mse, info.explained]).toEqual([version, null, null, null]);
        });
    }

    it('starts with the magic byte and its version', () => {
        expect([clustering[0], clustering[1]]).toEqual([0xAC, version]);
        expect([4, 7]).toContain(clustering.length % 9);
    });

});
