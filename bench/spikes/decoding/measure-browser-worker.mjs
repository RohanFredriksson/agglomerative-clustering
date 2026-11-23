// The browser recipe on the main thread against in a worker: how long the main thread is blocked (the longest task a
// PerformanceObserver sees) while decoding the 12 MP JPEG, and the decode time. node measure-browser-worker.mjs > results-browser-worker.txt
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { readdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('../../../node_modules/playwright-core');
const pw = `${homedir()}/.cache/ms-playwright`;
const executablePath = process.env.CHROMIUM_PATH ?? `${pw}/${readdirSync(pw).filter((d) => d.startsWith('chromium-')).sort().at(-1)}/chrome-linux64/chrome`;
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();
await page.goto('about:blank');

const recipe = `async function decodeImage(blob) {
    const bitmap = await createImageBitmap(blob, OPTIONS);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return context.getImageData(0, 0, canvas.width, canvas.height);
}`;

for (const [label, options] of [['no options', '{}'], ["the browser agent's options", "{ imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'default' }"], ["imageOrientation alone", "{ imageOrientation: 'from-image' }"], ["premultiplyAlpha alone", "{ premultiplyAlpha: 'none' }"], ["colorSpaceConversion alone", "{ colorSpaceConversion: 'default' }"]]) for (const file of ['large.jpg', 'photo.jpg', 'alpha.png', 'animated.gif', 'animated.webp']) {
    const base64 = (await readFile(new URL(`./images/${file}`, import.meta.url))).toString('base64');
    const result = await page.evaluate(async ({ base64, recipe }) => {
        const blob = new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))]);
        const decodeImage = eval(`(${recipe})`);
        const worker = new Worker(URL.createObjectURL(new Blob([`${recipe}\nonmessage = async (e) => { const t = performance.now(); const image = await decodeImage(e.data); postMessage({ ms: performance.now() - t, width: image.width, red: image.data[0] === 255 && image.data[1] === 0 && image.data[2] === 0 }); };`])));
        const tasks = [];
        new PerformanceObserver((list) => {for (const entry of list.getEntries()) {tasks.push(entry.duration);}}).observe({ type: 'longtask' });
        const settle = () => new Promise((resolve) => setTimeout(resolve, 200));
        const runs = { main: [], worker: [] }, longest = { main: [], worker: [] };
        for (let i = 0; i < 5; i++) {
            await settle(); tasks.length = 0;
            let t = performance.now(); await decodeImage(blob); runs.main.push(performance.now() - t);
            await settle(); longest.main.push(Math.max(0, ...tasks)); tasks.length = 0;
            t = performance.now();
            const ms = await new Promise((resolve) => {worker.onmessage = (e) => resolve(e.data.ms); worker.postMessage(blob);});
            runs.worker.push(ms);
            await settle(); longest.worker.push(Math.max(0, ...tasks));
        }
        const median = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1];
        const first = await decodeImage(blob);
        return { frame: first.data[0] === 255 && first.data[1] === 0 && first.data[2] === 0 ? 'second frame' : 'first frame', main: median(runs.main), worker: median(runs.worker), longestMain: median(longest.main), longestWorker: median(longest.worker) };
    }, { base64, recipe: recipe.replace("OPTIONS", options) });
    console.log(`${label}, ${file.padEnd(10)} main thread: decode ${result.main.toFixed(0)} ms, longest task ${result.longestMain.toFixed(0)} ms; in a worker: decode ${result.worker.toFixed(0)} ms, longest main-thread task ${result.longestWorker.toFixed(0)} ms (medians of 5; 0 = none over 50 ms); gives the ${result.frame}`);
}
await browser.close();
