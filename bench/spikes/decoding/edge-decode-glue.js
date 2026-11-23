import { decode as decodePng, convertIndexedToRgb } from 'fast-png';
import jpeg from 'jpeg-js';

const MAX_MP = 40; // reject huge images before decoding

// File bytes -> { data, format, width, height } that agglomerative-clustering accepts.
export function decodeImage(bytes) {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return fromPng(b);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return fromJpeg(b);
  const kind = b[0] === 0x47 && b[1] === 0x49 ? 'GIF'
    : String.fromCharCode(...b.subarray(8, 12)) === 'WEBP' ? 'WebP'
    : String.fromCharCode(...b.subarray(4, 12)).startsWith('ftypavi') ? 'AVIF' : 'unknown';
  throw Object.assign(new Error(`Unsupported image format: ${kind} (send PNG or JPEG)`), { status: 415 });
}

function unpackBits(packed, w, h, depth) {
  const out = new Uint8Array(w * h), rowBytes = Math.ceil((w * depth) / 8), mask = (1 << depth) - 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const bit = x * depth, byte = packed[y * rowBytes + (bit >> 3)];
    out[y * w + x] = (byte >> (8 - depth - (bit & 7))) & mask;
  }
  return out;
}

function pngSize(b) { // IHDR width/height, big-endian, at bytes 16..23
  const v = new DataView(b.buffer, b.byteOffset);
  return [v.getUint32(16), v.getUint32(20)];
}

function fromPng(b) {
  const [w, h] = pngSize(b);
  if (w * h > MAX_MP * 1e6) throw Object.assign(new Error(`Image too large: ${w}x${h}`), { status: 413 });
  let png = decodePng(b);
  let { data, channels, depth, width, height } = png;
  if (png.palette) { data = convertIndexedToRgb(png); channels = data.length / (width * height); depth = 8; }
  else if (depth < 8) { data = unpackBits(data, width, height, depth); }   // 1/2/4-bit gray stays packed
  const n = width * height;
  const out = new Uint8Array(n * 4);
  const shift = depth === 16 ? 8 : 0;           // 16-bit -> 8-bit
  const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1; // 1/2/4-bit gray -> 8-bit
  for (let i = 0; i < n; i++) {
    const s = i * channels, o = i * 4;
    const get = (c) => (shift ? data[s + c] >> shift : Math.round(data[s + c] * scale));
    if (channels <= 2) {                         // gray, gray+alpha
      const g = get(0);
      out[o] = out[o + 1] = out[o + 2] = g;
      out[o + 3] = channels === 2 ? get(1) : 255;
    } else {
      out[o] = get(0); out[o + 1] = get(1); out[o + 2] = get(2);
      out[o + 3] = channels === 4 ? get(3) : 255;
    }
  }
  return { data: out, format: 'rgba', width, height };
}

function fromJpeg(b) {
  const img = jpeg.decode(b, { useTArray: true, formatAsRGBA: false, maxResolutionInMP: MAX_MP, maxMemoryUsageInMB: 1024 });
  return { data: img.data, format: 'rgb', width: img.width, height: img.height };
}

// Box-downscale so the long side is at most `max` (docs: 512 px changes the palette ~2%, 3-8x faster).
export function downscale(img, max = 512) {
  const { width: w, height: h, data, format } = img;
  const step = Math.ceil(Math.max(w, h) / max);
  if (step <= 1) return img;
  const bpp = format === 'rgb' ? 3 : 4;
  const W = Math.floor(w / step), H = Math.floor(h / step);
  const out = new Uint8Array(W * H * bpp);
  const acc = new Uint32Array(bpp);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    acc.fill(0);
    for (let dy = 0; dy < step; dy++) {
      let s = ((y * step + dy) * w + x * step) * bpp;
      for (let dx = 0; dx < step; dx++, s += bpp) for (let c = 0; c < bpp; c++) acc[c] += data[s + c];
    }
    const o = (y * W + x) * bpp, n = step * step;
    for (let c = 0; c < bpp; c++) out[o + c] = Math.round(acc[c] / n);
  }
  return { data: out, format, width: W, height: H };
}
