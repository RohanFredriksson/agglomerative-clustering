// The guides' edge recipe: file bytes → { data, format, width, height }, with squoosh's decoders (jsquash) and omggif.
import decodePng, { init as initPng } from '@jsquash/png/decode.js';
import decodeJpeg, { init as initJpeg } from '@jsquash/jpeg/decode.js';
import decodeWebp, { init as initWebp } from '@jsquash/webp/decode.js';
import pngWasm from '@jsquash/png/codec/pkg/squoosh_png_bg.wasm';
import jpegWasm from '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm';
import webpWasm from '@jsquash/webp/codec/dec/webp_dec.wasm';
import { GifReader } from 'omggif';

const ready = Promise.all([initPng(pngWasm), initJpeg(jpegWasm), initWebp(webpWasm)]);

export async function decodeImage(bytes) {
  await ready;
  const ascii = (start, text) => String.fromCharCode(...bytes.subarray(start, start + text.length)) === text;
  let image;
  if (ascii(1, 'PNG')) {image = await decodePng(bytes.slice().buffer);}
  else if (bytes[0] === 0xFF && bytes[1] === 0xD8) {image = await decodeJpeg(bytes.slice().buffer, { preserveOrientation: true });}
  else if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) {image = await decodeWebp(bytes.slice().buffer);}
  else if (ascii(0, 'GIF')) {
    const gif = new GifReader(bytes);     // first frame only
    const data = new Uint8Array(gif.width * gif.height * 4);
    gif.decodeAndBlitFrameRGBA(0, data);
    return { data, format: 'rgba', width: gif.width, height: gif.height };
  } else {throw new Error('Unsupported image format: send PNG, JPEG, WebP or GIF');}
  return { data: new Uint8Array(image.data.buffer), format: 'rgba', width: image.width, height: image.height };
}
