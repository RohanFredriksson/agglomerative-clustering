// clustering.chooseFrom against the recipe of 3.7.2 (test/reference/fixed-palette-recipe.js, the guides' snippet) on the
// 24 Kodak photos: where the recipe's snap gives n entries, the indices must be the same.
import { describe, it, expect } from 'vitest';
import * as entry from '../../dist/index.mjs';
import { recipe } from '../reference/fixed-palette-recipe.js';
import { PALETTES } from '../../bench/spikes/fixed-subset.js';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../fixtures/kodak.js';
import { timeLimit } from '../timeout.js';

const { chooseThreads, improveThreads } = recipe(entry);
const charts = PALETTES.filter((p) => p.name === 'threads' || p.name === 'dense');

describe('chooseFrom against the 3.7.2 recipe', () => {

    it('chooseFrom matches the 3.7.2 recipe on the 24 Kodak photos', async () => {
        let compared = 0, fill = 0;
        const different = [];
        for (const image of KODAK_IMAGES) {
            const { rgba } = await getImageRgba(await ensureImage(image));
            const clustering = await entry.buildClustering(rgba);
            for (const { name: chartName, colours: chart } of charts) {
                for (const n of [6, 12, 24, 40]) {
                    const snapped = await chooseThreads(clustering, chart, n);
                    for (const space of ['rgb', 'oklab']) {
                        if (snapped.length !== n) {fill++; continue;}
                        const ref = (await improveThreads(clustering, chart, snapped, space)).sort((a, b) => a - b);
                        const { indices } = await clustering.chooseFrom(chart, n, { colorSpace: space });
                        compared++;
                        if (JSON.stringify(indices) !== JSON.stringify(ref)) {different.push(`${image.name} ${chartName} n=${n} ${space}: ${indices} vs ${ref}`);}
                    }
                }
            }
        }
        console.log(`parity: ${compared} cases compared, ${fill} on the fill path`);
        expect(different).toEqual([]);
        expect(fill, `${fill} cases where the recipe's snap gave fewer than n entries (compared ${compared})`).toBe(0);
    }, timeLimit(300_000));

});
