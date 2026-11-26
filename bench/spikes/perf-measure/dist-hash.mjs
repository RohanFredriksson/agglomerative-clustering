// The shipped dist/ clustering of an image as the driver's FNV-1a 64-bit hash, to show the instrumented builds cluster
// exactly as the shipped one. Usage: node dist-hash.mjs k23 [k03 ...]
import { buildClustering } from '../../../dist/index.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const here = dirname(fileURLToPath(import.meta.url));
const meta = JSON.parse(readFileSync(join(here, 'data/images.json'), 'utf8'));
for (const name of process.argv.slice(2)) {
    const raw = readFileSync(join(here, `data/${name}.rgba`));
    const c = await buildClustering({ data: new Uint8Array(raw.buffer, raw.byteOffset, raw.length), format: 'rgba', width: meta[name].width, height: meta[name].height });
    let h = 1469598103934665603n; for (const b of c) { h ^= BigInt(b); h = (h * 1099511628211n) & 0xFFFFFFFFFFFFFFFFn; }
    console.log(name, h.toString(16).padStart(16, '0'));
}
