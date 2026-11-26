// Mapping identity across every image format (the identity script above uses RGBA only): rgba, bgra, rgbx, bgrx and rgb images made from a
// Kodak crop with varied alpha, `premultiplied` where allowed, k = 1, 2, 16 and 300, four dither settings, `quantize` and `quantizeToIndices`
// (with `transparent` where the format has alpha), 4.1.0 against new, one-shot and sliced (`onProgress`). Odd widths and sizes below the memo's.
// Usage: node release-formats.mjs <old dist dir> <new dist dir> <raw rgba file> <width>
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
const [oldDir, newDir, file, widthArg] = process.argv.slice(2);
const old = await import(oldDir + '/index.mjs'), neu = await import(newDir + '/index.mjs');
const raw = readFileSync(file), full = Number(widthArg);
const hash = (a) => createHash('sha256').update(a).digest('hex');
let same = 0, different = 0;
for (const [width, height] of [[full, 200], [97, 61], [1, 1], [3, 1]]) {
    const pixels = width * height;
    const rgba = new Uint8Array(pixels * 4);
    for (let i = 0; i < pixels; i++) {
        const source = (i * 7 % (raw.length / 4 | 0)) * 4;
        for (let c = 0; c < 4; c++) rgba[i * 4 + c] = raw[source + c];
        rgba[i * 4 + 3] = i % 5 === 0 ? 0 : i % 3 === 0 ? 77 : 255;
    }
    for (const format of ['rgba', 'bgra', 'rgbx', 'bgrx', 'rgb']) {
        const bytes = format === 'rgb' ? new Uint8Array(pixels * 3).map((_, i) => rgba[((i / 3 | 0) * 4) + i % 3]) : rgba;
        for (const premultiplied of format === 'rgba' || format === 'bgra' ? [false, true] : [false]) {
            const image = {data: bytes, format, width, height, ...(premultiplied ? {premultiplied} : {})};
            const alpha = format === 'rgba' || format === 'bgra';
            const a = await old.buildClustering(image), b = await neu.buildClustering(image);
            for (const k of [1, 2, 16, 300]) for (const dither of [false, 'floyd-steinberg', 'atkinson', {method: 'ordered', steps: 16}]) {
                const options = {dither, ...(alpha ? {transparent: true} : {})};
                const jobs = [
                    (l, c, o) => c.quantize(image, k, {dither}).then((r) => r.data), (l, c, o) => c.quantize(image, k, {dither, onProgress() {}}).then((r) => r.data),
                    (l, c, o) => c.quantizeToIndices(image, k, options).then((r) => r.indices), (l, c, o) => c.quantizeToIndices(image, k, {...options, onProgress() {}}).then((r) => r.indices),
                ];
                const results = [];
                for (const job of jobs) results.push([hash(await job(old, a)), hash(await job(neu, b))]);
                const ok = results.every(([x, y]) => x === y);
                if (ok) same++; else {different++; console.log('DIFFERS', width, height, format, premultiplied, k, JSON.stringify(dither));}
            }
        }
    }
}
console.log(`${same} cases identical, ${different} different`);
process.exit(different ? 1 : 0);
