// Mapping identity through the JavaScript API: for each image (raw RGBA in data/), colour space (RGB, OKLab), k (2, 16, 64, 256) and dither
// (none, floyd-steinberg, atkinson, ordered with 16 and 64 steps), `quantize` and `quantizeToIndices` of the build in <new dist> and of the
// build in <old dist> (4.1.0) are compared byte for byte; the new build's sliced path (an `onProgress` callback) is compared too.
// Usage: node release-map-identity.mjs <old dist dir> <new dist dir> <image,image,...>   -> prints a line per image and a total; exit 1 on any difference.
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
const [oldDir, newDir, names] = process.argv.slice(2);
const old = await import(oldDir + '/index.mjs'), neu = await import(newDir + '/index.mjs');
const meta = JSON.parse(readFileSync(new URL('./data/images.json', import.meta.url), 'utf8'));
const dithers = {none: false, fs: 'floyd-steinberg', atkinson: 'atkinson', ord16: {method: 'ordered', steps: 16}, ord64: {method: 'ordered', steps: 64}};
const hash = (a) => createHash('sha256').update(a).digest('hex');
let same = 0, different = 0;
for (const name of names.split(',')) {
    const raw = readFileSync(new URL(`./data/${name}.rgba`, import.meta.url));
    const image = {data: new Uint8Array(raw.buffer, raw.byteOffset, raw.length), format: 'rgba', width: meta[name].width, height: meta[name].height};
    for (const colorSpace of ['rgb', 'oklab']) {
        const a = await old.buildClustering(image, {colorSpace}), b = await neu.buildClustering(image, {colorSpace});
        if (hash(a) !== hash(b)) {different++; console.log('CLUSTERING DIFFERS', name, colorSpace);}
        for (const k of [2, 16, 64, 256]) for (const [label, dither] of Object.entries(dithers)) {
            const options = {dither};
            const results = [
                hash((await a.quantize(image, k, options)).data), hash((await b.quantize(image, k, options)).data),
                hash((await b.quantize(image, k, {...options, onProgress() {}})).data),
                hash((await a.quantizeToIndices(image, k, options)).indices), hash((await b.quantizeToIndices(image, k, options)).indices),
                hash((await b.quantizeToIndices(image, k, {...options, onProgress() {}})).indices),
            ];
            const ok = results[0] === results[1] && results[1] === results[2] && results[3] === results[4] && results[4] === results[5];
            if (ok) same++; else {different++; console.log('DIFFERS', name, colorSpace, k, label, results.map((r) => r.slice(0, 8)).join(' '));}
        }
    }
    console.log(name, 'done');
}
console.log(`${same} cases identical, ${different} different (each case: quantize and quantizeToIndices, 4.1.0 against new, one-shot and sliced)`);
process.exit(different ? 1 : 0);
