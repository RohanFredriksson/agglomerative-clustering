// Palettes cut from two stored clusterings (through dist/index.mjs) at several k: how many colours differ, and the image
// error of each palette under nearest-colour mapping is not computed here (see error-curves.mjs for the clustering error).
// Usage: node compare-palettes.mjs a.bin b.bin
import { Clustering, init } from '../../../dist/index.mjs';
import { readFileSync } from 'fs';
await init();
const [a, b] = await Promise.all(process.argv.slice(2).map(async (f) => new Clustering(new Uint8Array(readFileSync(f)))));
for (const k of [2, 16, 64, 256, 1024, 4096, 16384, 32768, 65536, 262144].filter((k) => k <= 200000)) {
    const pa = await a.getPalette(k), pb = await b.getPalette(k);
    const sa = new Set(), sb = new Set();
    for (let i = 0; i < pa.length; i += 3) sa.add(pa[i] << 16 | pa[i + 1] << 8 | pa[i + 2]);
    for (let i = 0; i < pb.length; i += 3) sb.add(pb[i] << 16 | pb[i + 1] << 8 | pb[i + 2]);
    let same = 0; for (const c of sa) if (sb.has(c)) same++;
    console.log(`k=${k}: ${sa.size} colours vs ${sb.size}, shared ${same}`);
}
