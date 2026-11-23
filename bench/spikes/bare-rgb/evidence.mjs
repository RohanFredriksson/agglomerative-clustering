// The check on the decoding brief's own failing case: sharp's plain .raw() (as in
// bench/spikes/decoding/recipes-node.mjs, "sharp, naive") on each test file, passed bare.
//   node bench/spikes/bare-rgb/evidence.mjs > bench/spikes/bare-rgb/results-evidence.txt
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { looksLikeRgb } from './check.mjs';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../decoding/images');
for (const file of (await readdir(dir)).sort()) {
    try {
        const { data, info } = await sharp(await readFile(join(dir, file))).raw().toBuffer({ resolveWithObject: true });
        const bytes = new Uint8Array(data);
        const rejectedToday = bytes.length % 4 !== 0;
        console.log(`${file.padEnd(14)} ${info.width}×${info.height}, ${info.channels} channels, depth ${info.depth}: ` +
            (info.channels === 4 ? 'RGBA, nothing to detect' : rejectedToday ? 'length not a multiple of 4: rejected today' : `check ${looksLikeRgb(bytes) ? 'flags it' : 'MISSES it'}`));
    } catch (e) {console.log(`${file.padEnd(14)} sharp fails: ${e.message}`);}
}
