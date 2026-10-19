// Golden outputs: SHA-256 hashes of clusterings, palettes and quantized images, stored in test/golden.json.
// Speed changes are meant to leave every output byte-identical; this test enforces it. When a change is meant to
// alter output, regenerate the file and say so in the commit:
//
//   UPDATE_GOLDEN=1 npx vitest run test/golden.test.js
//
// Images are synthetic (generated in code, no fonts or canvas drawing, so identical on every machine) plus two
// Kodak photos, which are downloaded on first use like the visual tests.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { init, getClustering, getPaletteFromClustering, quantize, quantizeWithPalette } from '../dist/index.mjs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../fixtures/kodak.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = resolve(__dirname, 'golden.json');
const update = Boolean(process.env.UPDATE_GOLDEN);
const golden = existsSync(GOLDEN_PATH) ? JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) : {};
const actual = {};

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

function fromPixels(width, height, fill) {
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {rgba.set(fill(x, y), (y * width + x) * 4);}
    }
    return { rgba, width, height };
}

function hsv(h, s, v) {
    const i = Math.floor(h * 6), f = h * 6 - i;
    const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function noise(side) {
    let s = 0xdeadbeef;
    return fromPixels(side, side, () => {
        const next = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) >>> 24;
        return [next(), next(), next(), 255];
    });
}

const synthetic = {
    'gradient-hsv': () => fromPixels(384, 256, (x, y) => [...hsv(x / 384, 0.85, 0.15 + 0.85 * (1 - y / 256)), 255]),
    'gradient-rgb': () => fromPixels(384, 256, (x, y) => [Math.round(x / 383 * 255), Math.round(y / 255 * 255), 96, 255]),
    'noise': () => noise(256),
    // Every alpha from 0 to 255, so partial weights, skipped pixels and preserved alpha are all covered.
    'alpha': () => fromPixels(256, 128, (x, y) => [...hsv(y / 128, 0.7, 0.9), x]),
    // Only fully opaque or fully transparent pixels: must cluster exactly like the visible pixels alone.
    'binary-alpha': () => fromPixels(256, 128, (x, y) => [x, y * 2, (x * y) & 255, (x + y) % 3 ? 255 : 0]),
};

const kodak = [KODAK_IMAGES[4], KODAK_IMAGES[22]];

const images = {};

beforeAll(async () => {
    await init();
    for (const [name, make] of Object.entries(synthetic)) {images[name] = make();}
    for (const image of kodak) {
        const { rgba, width, height } = await getImageRgba(await ensureImage(image));
        images[image.name] = { rgba, width, height };
    }
}, 120_000);

afterAll(() => {
    if (update) {writeFileSync(GOLDEN_PATH, JSON.stringify(actual, null, 2) + '\n');}
});

function check(key, bytes) {
    actual[key] = hash(bytes);
    if (!update) {expect(actual[key], `${key} changed; if intended, run with UPDATE_GOLDEN=1`).toBe(golden[key]);}
}

describe.each([...Object.keys(synthetic), ...kodak.map((image) => image.name)])('%s', (name) => {

    it('clusterings and palettes', async () => {
        const { rgba } = images[name];
        for (const [label, options] of [['rgb', {}], ['oklab', { colorSpace: 'oklab' }], ['rgb-p6', { precision: 6 }], ['oklab-p5', { colorSpace: 'oklab', precision: 5 }], ['ignore-alpha', { alpha: 'ignore' }]]) {
            const clustering = await getClustering(rgba, options);
            check(`${name}/clustering/${label}`, clustering);
            for (const k of [16, 256]) {check(`${name}/palette/${label}/${k}`, await getPaletteFromClustering(clustering, k));}
        }
    }, 60_000);

    it('quantized images', async () => {
        const { rgba, width } = images[name];
        check(`${name}/quantize/rgb/16`, await quantize(rgba, 16));
        check(`${name}/quantize/oklab/64`, await quantize(rgba, 64, { colorSpace: 'oklab' }));
        check(`${name}/quantize/rgb/16/dither`, await quantize(rgba, 16, { dither: true, width }));
        check(`${name}/quantize/oklab/64/dither-0.5`, await quantize(rgba, 64, { colorSpace: 'oklab', dither: 0.5, width }));
        // Above 256 colours, mapping uses the k-d tree instead of the cell index.
        const large = await getPaletteFromClustering(await getClustering(rgba), 400);
        check(`${name}/map/rgb/400`, await quantizeWithPalette(rgba, large));
        check(`${name}/map/oklab/400`, await quantizeWithPalette(rgba, large, { colorSpace: 'oklab' }));
    }, 60_000);

});

it('golden.json has no stale entries', () => {
    if (!update) {expect(Object.keys(golden).sort()).toEqual(Object.keys(actual).sort());}
});
