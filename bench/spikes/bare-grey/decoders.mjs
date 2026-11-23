// Which decoders hand back 1- or 2-channel bytes, and for which files? Each grey file is decoded the way the
// decoder's README leads with, and the result's bytes per pixel and length are reported.
//   node bench/spikes/bare-grey/decoders.mjs > bench/spikes/bare-grey/results-decoders.txt
// Uses the decoding spike's installed packages (cd bench/spikes/decoding && npm install --cache <dir>).
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../decoding/package.json', import.meta.url));
const load = async (name) => import(require.resolve(name));
const sharp = (await load('sharp')).default;
const fastPng = await load('fast-png');
const { PNG } = await load('pngjs');
const jpeg = await load('jpeg-js');

const dir = fileURLToPath(new URL('./images/', import.meta.url));
await mkdir(dir, { recursive: true });
const src = fileURLToPath(new URL('../../../fixtures/images/kodim23.png', import.meta.url));
const grey = await sharp(src).greyscale().raw().toBuffer({ resolveWithObject: true });
const { width, height } = grey.info;
const pixels = width * height;
const g = grey.data;
const ga = Buffer.alloc(width * height * 2);
for (let p = 0; p < width * height; p++) {ga[2 * p] = g[p]; ga[2 * p + 1] = Math.round(255 * (1 - (p % width) / (width - 1)));}
// Written with fast-png's encoder, which keeps the colour type it is given (sharp turns 1- and 2-channel raw input into RGB
// PNGs unless told the colour space), and with sharp told 'b-w', as a sharp user would write a grey file.
const enc = (data, channels, depth = 8) => Buffer.from(fastPng.encode({ width, height, data, channels, depth }));
const bw = (data, channels) => sharp(data, { raw: { width, height, channels } }).toColourspace('b-w').png().toBuffer();
const opaque = Buffer.from(ga.map((v, i) => (i & 1 ? 255 : v)));
const g16 = new Uint16Array(pixels); for (let p = 0; p < pixels; p++) {g16[p] = g[p] * 257;}
const g1 = new Uint8Array(Math.ceil(width / 8) * height);
for (let y = 0; y < height; y++) {for (let x = 0; x < width; x++) {if (g[y * width + x] >= 128) {g1[y * Math.ceil(width / 8) + (x >> 3)] |= 0x80 >> (x & 7);}}}
const files = {
    'grey8.png (fast-png, colour type 0)': enc(g, 1),
    'grey-alpha.png (fast-png, colour type 4, alpha ramp)': enc(ga, 2),
    'grey-opaque-alpha.png (fast-png, colour type 4, alpha 255)': enc(opaque, 2),
    'grey16.png (fast-png, colour type 0, 16-bit)': enc(g16, 1, 16),
    'grey1.png (fast-png, colour type 0, 1-bit)': enc(g1, 1, 1),
    'grey8.png (sharp b-w)': await bw(g, 1),
    'grey-alpha.png (sharp b-w)': await bw(ga, 2),
    'grey.jpg (sharp b-w)': await sharp(g, { raw: { width, height, channels: 1 } }).toColourspace('b-w').jpeg({ quality: 90 }).toBuffer(),
};
const describe = (bytes, extra = '') => {
    const per = bytes.length / pixels;
    return `${bytes.length} bytes = ${per} per pixel${bytes.length % 4 ? ', not a multiple of 4 (rejected today)' : ', a multiple of 4 (read as RGBA)'}${extra}`;
};
console.log(`Source: kodim23 in grey, ${width}×${height} (${pixels} pixels)\n`);
for (const [name, buf] of Object.entries(files)) {
    if (!buf) {console.log(`${name}: could not be written`); continue;}
    console.log(`== ${name}`);
    const tries = {
        'sharp(file).raw()': async () => {const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true }); return describe(data, `, info.channels ${info.channels}, depth ${info.depth}`);},
        'sharp(file).ensureAlpha().raw()': async () => {const { data } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return describe(data);},
        'fast-png decode(file).data': async () => {const r = fastPng.decode(buf); return describe(r.data, `, channels ${r.channels}, depth ${r.depth}, ${r.data.constructor.name}`);},
        'pngjs PNG.sync.read(file).data': async () => describe(PNG.sync.read(buf).data),
        'jpeg-js decode(file).data': async () => describe(jpeg.decode(buf).data),
        'jpeg-js decode(file, {formatAsRGBA: false}).data': async () => describe(jpeg.decode(buf, { formatAsRGBA: false }).data),
    };
    for (const [how, run] of Object.entries(tries)) {
        if (name.includes('.jpg') !== how.startsWith('jpeg') && !how.startsWith('sharp')) {continue;}
        try {console.log(`  ${how.padEnd(48)} ${await run()}`);} catch (e) {console.log(`  ${how.padEnd(48)} fails: ${e.message.split('\n')[0]}`);}
    }
}
