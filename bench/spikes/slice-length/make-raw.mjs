// Writes the slice-skew images as raw RGBA files: node make-raw.mjs <dir>
import { writeFileSync } from 'fs';
let seed = 1;
const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8) & 255;
function image(width, height, fill) { const data = new Uint8Array(width * height * 4); for (let i = 0; i < width * height; i++) { const [r, g, b] = fill(i); data.set([r, g, b, 255], i * 4); } return data; }
const block = (i) => [100 + (i & 63), 100 + ((i >> 6) & 63), 100 + ((i >> 12) & 63)];
const dark = (i) => [i & 63, (i >> 6) & 63, (i >> 12) & 63];
const dir = process.argv[2];
writeFileSync(dir + '/block.rgba', image(512, 640, (i) => i < 262144 ? block(i) : [rand(), rand(), rand()]));
writeFileSync(dir + '/dark.rgba', image(512, 640, (i) => i < 262144 ? dark(i) : [rand(), rand(), rand()]));
writeFileSync(dir + '/noise.rgba', image(1024, 1024, () => [rand(), rand(), rand()]));
