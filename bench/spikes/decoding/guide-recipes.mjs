// The guides' sharp and edge recipes exactly as written there, on the files the guide makes claims about: the P3 and
// 16-bit files (sharp: against the spike's longer reference chain), and two-frame animations (which frame comes back).
// node guide-recipes.mjs > results-guide-recipes.txt
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { GifReader } from 'omggif';
import decodePng, { init as initPng } from '@jsquash/png/decode.js';
import decodeJpeg, { init as initJpeg } from '@jsquash/jpeg/decode.js';
import decodeWebp, { init as initWebp } from '@jsquash/webp/decode.js';

const require = createRequire(import.meta.url);
const compile = async (path) => WebAssembly.compile(await readFile(require.resolve(path)));
const ready = Promise.all([initPng(await compile('@jsquash/png/codec/pkg/squoosh_png_bg.wasm')), initJpeg(await compile('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm')), initWebp(await compile('@jsquash/webp/codec/dec/webp_dec.wasm'))]);

async function decodeWithSharp(input) {
    const { data, info } = await sharp(input).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, format: 'rgba', width: info.width, height: info.height };
}
async function decodeOnTheEdge(bytes) {
    await ready;
    const ascii = (start, text) => String.fromCharCode(...bytes.subarray(start, start + text.length)) === text;
    let image;
    if (ascii(1, 'PNG')) {image = await decodePng(bytes.slice().buffer);}
    else if (bytes[0] === 0xFF && bytes[1] === 0xD8) {image = await decodeJpeg(bytes.slice().buffer, { preserveOrientation: true });}
    else if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) {image = await decodeWebp(bytes.slice().buffer);}
    else if (ascii(0, 'GIF')) {
        const gif = new GifReader(bytes);
        const data = new Uint8Array(gif.width * gif.height * 4);
        gif.decodeAndBlitFrameRGBA(0, data);
        return { data, format: 'rgba', width: gif.width, height: gif.height };
    } else {throw new Error('Unsupported image format: send PNG, JPEG, WebP or GIF');}
    return { data: new Uint8Array(image.data.buffer), format: 'rgba', width: image.width, height: image.height };
}

const dir = new URL('./images/', import.meta.url).pathname;
for (const file of ['p3.jpg', 'deep.png', 'grey.png', 'rotated.jpg']) {
    const bytes = await readFile(dir + file);
    const guide = await decodeWithSharp(bytes);
    const { data, info } = await sharp(bytes).rotate().toColourspace('srgb').ensureAlpha().raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
    let diff = 0; for (let i = 0; i < data.length; i++) {diff += Math.abs(data[i] - guide.data[i]);}
    console.log(`sharp, the guide's chain, ${file}: ${guide.width}×${guide.height}, mean |Δ| from .toColourspace('srgb').raw({ depth: 'uchar' }) ${(diff / data.length).toFixed(3)}`);
}
// Which frame: the photo's first pixel is not red; frame 2 is solid red.
const frame = (image) => {const [r, g, b] = image.data; return r === 255 && g === 0 && b === 0 ? 'the second (red)' : 'the first'; };
for (const file of ['animated.gif', 'animated.webp']) {
    const bytes = new Uint8Array(await readFile(dir + file));
    for (const [name, decode] of [['sharp', decodeWithSharp], ['edge', decodeOnTheEdge]]) {
        try {const image = await decode(bytes); console.log(`${name}, ${file}: ${image.width}×${image.height}, ${frame(image)} frame`);}
        catch (error) {console.log(`${name}, ${file}: fails: ${error.message}`);}
    }
}
