// Value brief spike: how well do the ways users decode files in Node feed the library?
// node recipes-node.mjs > results-node.txt   (after node make-images.mjs and npm run build at the repo root)
//
// For each recipe and file: whether the result reaches the library, whether it is right (same size and orientation as
// the reference, mean channel difference from it), the quality of the 16-colour palette it gives, measured on the
// reference pixels (MSE per channel of mapping them to that palette: a garbage palette shows up here), and decode time
// against buildPalette time. The reference is the sharp recipe, which applies EXIF orientation, converts embedded
// colour profiles to sRGB and returns 8-bit RGBA whatever the file holds.
import * as ac from '../../../dist/index.mjs';
import sharp from 'sharp';
import { PNG } from 'pngjs';
import * as fastPng from 'fast-png';
import jpeg from 'jpeg-js';
import omggif from 'omggif';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dir = new URL('./images/', import.meta.url).pathname;
const files = ['photo.png', 'photo.jpg', 'rotated.jpg', 'p3.jpg', 'indexed.png', 'grey.png', 'deep.png', 'alpha.png', 'onebit.png', 'photo.gif', 'photo.webp', 'photo.avif', 'large.jpg'];

// ----- The recipes, as a user would write them -------------------------------------------------------------------------

const recipes = {
    // The docs' advice: sharp, rotated, as 8-bit sRGB RGBA.
    'sharp': async (bytes) => {
        const { data, info } = await sharp(bytes).rotate().toColourspace('srgb').ensureAlpha().raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
        return { data, format: 'rgba', width: info.width, height: info.height };
    },
    // What sharp's own README leads with for raw pixels, passed as a bare array.
    'sharp, naive': async (bytes) => {
        const { data } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
        return data;
    },
    // Pure JavaScript, for runtimes without native modules: pngjs (expands every PNG to 8-bit RGBA), jpeg-js, omggif.
    'pngjs + jpeg-js + omggif': async (bytes) => {
        if (bytes[0] === 0x89) {
            const png = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length));   // pngjs needs a Buffer, not a Uint8Array
            return { data: png.data, format: 'rgba', width: png.width, height: png.height };
        }
        if (bytes[0] === 0xFF) {
            const image = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024, maxResolutionInMP: 200 });
            return { data: image.data, format: 'rgba', width: image.width, height: image.height };
        }
        if (bytes[0] === 0x47) {
            const gif = new omggif.GifReader(bytes);
            const data = new Uint8Array(gif.width * gif.height * 4);
            gif.decodeAndBlitFrameRGBA(0, data);
            return { data, format: 'rgba', width: gif.width, height: gif.height };
        }
        throw new Error('format not supported by this recipe');
    },
    // fast-png, the decoder this repo's own guides use for writing: returns channels and depth as the file has them.
    'fast-png, as returned': async (bytes) => {
        if (bytes[0] !== 0x89) {throw new Error('PNG only');}
        const png = fastPng.decode(bytes);
        return { data: png.data, format: png.channels === 4 ? 'rgba' : 'rgb', width: png.width, height: png.height };
    },
    // The squoosh codecs in WebAssembly, the usual choice for edge runtimes: give ImageData-shaped RGBA.
    'jsquash (WebAssembly)': async (bytes) => {
        const kind = bytes[0] === 0x89 ? 'png' : bytes[0] === 0xFF ? 'jpeg' : bytes[8] === 0x57 ? 'webp' : bytes[4] === 0x66 ? 'avif' : null;
        if (!kind) {throw new Error('format not supported by this recipe');}
        const image = await jsquash(kind, bytes);
        return { data: new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.length), format: 'rgba', width: image.width, height: image.height };
    },
};

const jsquashModules = {};
const jsquashWasm = { png: '@jsquash/png/codec/pkg/squoosh_png_bg.wasm', jpeg: '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm', webp: '@jsquash/webp/codec/dec/webp_dec.wasm', avif: '@jsquash/avif/codec/dec/avif_dec.wasm' };
async function jsquash(kind, bytes) {
    if (!jsquashModules[kind]) {
        const module = await import(`@jsquash/${kind}/decode.js`);
        const compiled = await WebAssembly.compile(await readFile(require.resolve(jsquashWasm[kind])));
        await module.init(kind === 'png' ? compiled : { instantiateWasm: (imports, done) => { WebAssembly.instantiate(compiled, imports).then((i) => done(i, compiled)); return {}; } });
        jsquashModules[kind] = module;
    }
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
    return jsquashModules[kind].default(copy);
}

// ----- Measuring ---------------------------------------------------------------------------------------------------------

const median = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
async function time(fn, runs) {
    const ms = [];
    let result;
    for (let i = 0; i < runs; i++) {const t = performance.now(); result = await fn(); ms.push(performance.now() - t);}
    return { result, ms: median(ms) };
}

const asRGBA = (image) => (ArrayBuffer.isView(image) ? image : image.data);

// MSE per channel of mapping the reference pixels to `palette`, over pixels with alpha > 0.
async function mappingError(reference, palette) {
    const mapped = await ac.quantizeWithPalette(reference, palette);
    const a = reference.data, b = mapped.data;
    let sum = 0, n = 0;
    for (let i = 0; i < a.length; i += 4) {
        if (a[i + 3] === 0) {continue;}
        for (let c = 0; c < 3; c++) {sum += (a[i + c] - b[i + c]) ** 2;}
        n += 3;
    }
    return sum / n;
}

function difference(reference, image) {
    if (ArrayBuffer.isView(image)) {return 'bare array';}
    if (image.width !== reference.width || image.height !== reference.height) {return `${image.width}×${image.height}, reference ${reference.width}×${reference.height}`;}
    if (image.format !== 'rgba' || image.data.length !== reference.data.length) {return `${image.format}, ${image.data.constructor.name}`;}
    let sum = 0;
    for (let i = 0; i < image.data.length; i++) {sum += Math.abs(image.data[i] - reference.data[i]);}
    return `mean |Δ| ${(sum / image.data.length).toFixed(2)}`;
}

const k = 16;
for (const file of files) {
    const bytes = new Uint8Array(await readFile(dir + file));
    const runs = file === 'large.jpg' ? 3 : 7;
    const reference = await recipes.sharp(bytes);
    const referencePalette = await ac.buildPalette(reference, k);
    const best = await mappingError(reference, referencePalette);
    const cluster = await time(() => ac.buildPalette(reference, k), runs);
    console.log(`\n${file} (${reference.width}×${reference.height}, ${(bytes.length / 1024).toFixed(0)} KB): buildPalette(k=${k}) ${cluster.ms.toFixed(1)} ms, reference mapping MSE ${best.toFixed(1)}`);
    for (const [name, recipe] of Object.entries(recipes)) {
        let decoded;
        try {decoded = await time(() => recipe(bytes), runs);} catch (error) {console.log(`  ${name.padEnd(26)} decode fails: ${error.message.slice(0, 90)}`); continue;}
        let verdict;
        try {
            const palette = await ac.buildPalette(decoded.result, k);
            const error = await mappingError(reference, palette);
            verdict = `palette ${palette.length / 3} colours, mapping MSE ${error.toFixed(1)} (${(error / best).toFixed(2)}× reference)`;
        } catch (error) {verdict = `library error: ${error.message.slice(0, 80)}`;}
        console.log(`  ${name.padEnd(26)} decode ${decoded.ms.toFixed(1).padStart(7)} ms  ${difference(reference, decoded.result).padEnd(28)} ${verdict}`);
    }
}
