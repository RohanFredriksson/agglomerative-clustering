// The edge recipe (edge/decode.js) under wrangler dev: node measure-edge.mjs > results-edge.txt, with
// `cd edge && npx wrangler dev --port 8799` running. Times are wall-clock per request from this client (median of 5),
// minus a request that sends the same bytes and does nothing; palettes are compared with the same call on sharp's pixels.
import * as ac from '../../../dist/index.mjs';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const base = 'http://127.0.0.1:8799';
const dir = new URL('./images/', import.meta.url).pathname;
const files = ['photo.png', 'photo.jpg', 'rotated.jpg', 'p3.jpg', 'indexed.png', 'grey.png', 'deep.png', 'alpha.png', 'onebit.png', 'photo.gif', 'photo.webp', 'large.jpg'];
const median = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
async function post(path, body) {
    const t = performance.now();
    const response = await fetch(base + path, { method: 'POST', body });
    const json = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    return { ms: performance.now() - t, json };
}
async function timed(path, body) {const runs = []; let json; for (let i = 0; i < 5; i++) {const r = await post(path, body); runs.push(r.ms); json = r.json;} return { ms: median(runs), json };}

for (const file of files) {
    const bytes = await readFile(dir + file);
    const noop = await timed('/noop', bytes), decode = await timed('/decode', bytes), colors = await timed('/colors', bytes);
    if (colors.json.error || !colors.json.palette) {console.log(`${file.padEnd(12)} fails: ${JSON.stringify(colors.json).slice(0, 120)}`); continue;}
    const { data, info } = await sharp(bytes).rotate().toColourspace('srgb').ensureAlpha().raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
    const reference = await ac.buildSwatches({ data, format: 'rgba', width: info.width, height: info.height }, 5, { precision: 6 });
    const same = colors.json.palette.every((v, i) => v === reference.palette[i]);
    const shape = colors.json.width === info.width && colors.json.height === info.height ? 'upright' : `${colors.json.width}×${colors.json.height}, reference ${info.width}×${info.height}`;
    let worst = 0;
    for (let i = 0; i < colors.json.palette.length; i++) {worst = Math.max(worst, Math.abs(colors.json.palette[i] - reference.palette[i]));}
    console.log(`${file.padEnd(12)} decode ${(decode.ms - noop.ms).toFixed(0).padStart(5)} ms, decode + buildSwatches(5, precision 6) ${(colors.ms - noop.ms).toFixed(0).padStart(5)} ms; ${shape}; 5-colour palette ${same ? 'identical to sharp\'s' : `differs from sharp's by up to ${worst}`}`);
}
