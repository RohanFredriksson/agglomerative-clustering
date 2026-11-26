// Reference: the FNV-1a 64 hash of the clustering that the shipped dist/ gives (WebAssembly, public buildClustering) for every image in
// data/images.json at full precision, precision 6 and in OKLab. Writes results/ref-hashes.json. Usage: node ref-hashes.mjs [image ...]
import { buildClustering } from '../../../dist/index.mjs';
import { readFileSync, writeFileSync, existsSync } from 'fs';
const meta = JSON.parse(readFileSync('data/images.json', 'utf8'));
const out = existsSync('results/ref-hashes.json') ? JSON.parse(readFileSync('results/ref-hashes.json', 'utf8')) : {};
const fnv = (b) => { let h = 1469598103934665603n; for (const x of b) { h ^= BigInt(x); h = (h * 1099511628211n) & 0xFFFFFFFFFFFFFFFFn; } return h.toString(16).padStart(16, '0'); };
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(meta);
const cfgs = { rgb8: {}, rgb6: { precision: 6 }, oklab8: { colorSpace: 'oklab' } };
for (const name of names) {
    const raw = readFileSync(`data/${name}.rgba`);
    const image = { data: new Uint8Array(raw.buffer, raw.byteOffset, raw.length), format: 'rgba', width: meta[name].width, height: meta[name].height };
    out[name] ??= {};
    for (const [cfg, options] of Object.entries(cfgs)) {
        if (out[name][cfg]) continue;
        const t = performance.now();
        out[name][cfg] = fnv(await buildClustering(image, options));
        console.log(name, cfg, out[name][cfg], Math.round(performance.now() - t) + ' ms');
        writeFileSync('results/ref-hashes.json', JSON.stringify(out, null, 1));
    }
}
