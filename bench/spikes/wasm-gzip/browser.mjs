// Decompressing the gzipped module with DecompressionStream in headless Chromium (what a plugin's UI or an Electron
// renderer runs), first call in a fresh page and a repeat; median of 5 fresh pages. CHROMIUM_PATH as for npm run test:browser.
//   CHROMIUM_PATH=... node bench/spikes/wasm-gzip/browser.mjs > bench/spikes/wasm-gzip/results-browser.txt
import { chromium } from 'playwright-core';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const gz = gzipSync(readFileSync(new URL('../../../dist/clustering.wasm', import.meta.url)), { level: 9 });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const first = [], again = [];
for (let i = 0; i < 5; i++) {
    const page = await browser.newPage();
    const [a, b] = await page.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const run = async () => {
            const t0 = performance.now();
            const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
            const out = new Uint8Array(await new Response(stream).arrayBuffer());
            if (out.length < 80000) {throw new Error('short');}
            return performance.now() - t0;
        };
        return [await run(), await run()];
    }, gz.toString('base64'));
    first.push(a); again.push(b);
    await page.close();
}
await browser.close();
const median = (v) => v.sort((x, y) => x - y)[2].toFixed(2);
console.log(`Chromium, DecompressionStream('gzip') of ${gz.length} bytes to the module: first call ${median(first)} ms, repeat ${median(again)} ms (medians of 5 pages)`);
