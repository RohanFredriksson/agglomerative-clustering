import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { decode } from 'fast-png';

// The README's media, made by docs/media/make.mjs. This checks the budget and that nothing is transparent (a
// transparent swatch strip disappears on GitHub's dark theme).
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../docs/media');
const resultsPath = path.join(dir, 'results.json');
const present = existsSync(resultsPath);
if (!present) console.warn('test/media.test.js skipped: docs/media/results.json is missing; run `node docs/media/make.mjs` to make the media.');

const required = ['hero.gif', 'nesting.png', 'pixel-art.gif', 'eink.png', 'threads.png', 'transparency.png', 'swatches.png', 'animation.gif'];
const cards = ['pixel-art.gif', 'eink.png', 'threads.png', 'transparency.png', 'swatches.png', 'animation.gif'];
const size = (name) => statSync(path.join(dir, name)).size;

describe.skipIf(!present)('README media', () => {
    const results = present ? JSON.parse(readFileSync(resultsPath, 'utf8')) : {};

    it('has every file', () => {
        for (const name of required) expect(existsSync(path.join(dir, name)), name).toBe(true);
    });
    it('keeps the hero to 1.5 MB', () => {
        expect(size('hero.gif')).toBeLessThanOrEqual(1572864);
    });
    it('keeps the total to 6 MB', () => {
        expect(required.reduce((sum, name) => sum + size(name), 0)).toBeLessThanOrEqual(6291456);
    });
    it('keeps the cards to 700 KB on average', () => {
        expect(cards.reduce((sum, name) => sum + size(name), 0) / cards.length).toBeLessThanOrEqual(716800);
    });
    it('has no transparent pixel in any PNG', () => {
        for (const name of required.filter((n) => n.endsWith('.png'))) {
            const png = decode(readFileSync(path.join(dir, name)));
            if (png.channels !== 4) continue; // no alpha channel at all
            for (let i = 3; i < png.data.length; i += 4) {
                if (png.data[i] !== 255) throw new Error(`${name}: alpha ${png.data[i]} at pixel ${(i - 3) / 4}`);
            }
        }
    });
    it('records its measurements', () => {
        for (const key of ['machine', 'node', 'load', 'hero', 'files']) expect(results, key).toHaveProperty(key);
        expect(results.load).toHaveProperty('before');
        expect(results.load).toHaveProperty('after');
        for (const key of ['width', 'height', 'clusterMs', 'cutsMs', 'totalMs']) expect(results.hero[key], key).toBeTypeOf('number');
        for (const name of required) expect(results.files[name], name).toBe(size(name));
    });
});
