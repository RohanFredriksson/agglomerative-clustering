// Value brief spike: the browser recipe (createImageBitmap + OffscreenCanvas + getImageData) against the sharp reference.
// CHROMIUM_PATH=... node recipes-browser.mjs > results-browser.txt   (after node make-images.mjs and npm run build)
//
// Runs the recipe in headless Chromium on each test file, brings the pixels back and compares them with sharp's
// (orientation applied, profiles converted to sRGB, straight 8-bit RGBA): size, mean channel difference, and the
// quality of the 16-colour palette the decoded pixels give, measured on the reference pixels. Also times the decode.
import * as ac from '../../../dist/index.mjs';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { readdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('../../../node_modules/playwright-core');
const dir = new URL('./images/', import.meta.url).pathname;
const files = ['photo.png', 'photo.jpg', 'rotated.jpg', 'p3.jpg', 'indexed.png', 'grey.png', 'deep.png', 'alpha.png', 'onebit.png', 'photo.gif', 'photo.webp', 'photo.avif', 'large.jpg'];

const pw = `${homedir()}/.cache/ms-playwright`;
const executablePath = process.env.CHROMIUM_PATH ?? `${pw}/${readdirSync(pw).filter((d) => d.startsWith('chromium-')).sort().at(-1)}/chrome-linux64/chrome`;
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();
await page.goto('about:blank');

// The recipe, as it runs in the page (main thread or worker alike): 6 lines.
const recipe = `async (blob) => {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
}`;

async function mappingError(reference, palette) {
    const mapped = await ac.quantizeWithPalette(reference, palette);
    const a = reference.data, b = mapped.data;
    let sum = 0, n = 0;
    for (let i = 0; i < a.length; i += 4) {
        if (a[i + 3] === 0) {continue;}
        for (let c = 0; c < 3; c++) {sum += (a[i + c] - b[i + c]) ** 2;}
        n += 3;
    }
    return sum / n;
}

console.log(`Chromium ${browser.version()}; recipe:\n${recipe}\n`);
for (const file of files) {
    const bytes = await readFile(dir + file);
    const { data, info } = await sharp(bytes).rotate().toColourspace('srgb').ensureAlpha().raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
    const reference = { data, format: 'rgba', width: info.width, height: info.height };
    const result = await page.evaluate(async ({ base64, recipe, runs }) => {
        const blob = new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))]);
        const decode = eval(recipe);
        const ms = [];
        let image;
        for (let i = 0; i < runs; i++) {const t = performance.now(); image = await decode(blob); ms.push(performance.now() - t);}
        ms.sort((a, b) => a - b);
        return { width: image.width, height: image.height, data: btoa(Array.from(image.data, (v) => String.fromCharCode(v)).join('')), ms: ms[ms.length >> 1] };
    }, { base64: bytes.toString('base64'), recipe, runs: file === 'large.jpg' ? 3 : 7 }).catch((error) => ({ error: error.message.split('\n')[0] }));
    if (result.error) {console.log(`${file.padEnd(12)} decode fails: ${result.error.slice(0, 100)}`); continue;}
    const pixels = new Uint8Array(Buffer.from(result.data, 'base64'));
    let line = `${file.padEnd(12)} decode ${result.ms.toFixed(1).padStart(6)} ms  `;
    if (result.width !== reference.width || result.height !== reference.height) {
        line += `${result.width}×${result.height}, reference ${reference.width}×${reference.height}`;
    } else {
        let sum = 0, worst = 0, translucent = 0, translucentSum = 0;
        for (let i = 0; i < pixels.length; i++) {
            const d = Math.abs(pixels[i] - data[i]);
            sum += d; worst = Math.max(worst, d);
            if (i % 4 !== 3 && data[i - (i % 4) + 3] > 0 && data[i - (i % 4) + 3] < 32) {translucent++; translucentSum += d;}
        }
        line += `mean |Δ| ${(sum / pixels.length).toFixed(2)}, max ${worst}` + (translucent ? `, mean |Δ| where alpha < 32: ${(translucentSum / translucent).toFixed(2)}` : '');
    }
    const best = await mappingError(reference, await ac.buildPalette(reference, 16));
    const error = await mappingError(reference, await ac.buildPalette({ data: pixels, format: 'rgba' }, 16));
    console.log(`${line}; palette mapping MSE ${(error / best).toFixed(2)}× reference`);
}
await browser.close();
