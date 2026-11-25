import { quantize, type ImageFormat, type RawImage } from './index.js';
declare const px: Uint8Array;
declare const f: ImageFormat;
declare const flag: boolean;
declare const channels: 3 | 4;
declare const premul: boolean;

// 1 literal mistake (should be caught)
export const c1 = quantize({ data: px, format: 'rgb', premultiplied: true }, 16);
// 2 forwarded config, non-literal format
export const c2 = quantize({ data: px, format: f, premultiplied: flag }, 16);
// 3 helper: channel count picks format, premultiplied from a flag
export function c3() {
  const format = channels === 3 ? 'rgb' : 'rgba';
  return quantize({ data: px, format, premultiplied: premul }, 16);
}
// 3b same with premultiplied only meaningful for 4 channels, written as spread
export function c3b() {
  const format = channels === 3 ? 'rgb' : 'rgba';
  return quantize({ data: px, format, ...(format === 'rgba' ? { premultiplied: premul } : {}) }, 16);
}
// 4 node-canvas raw: bgra premultiplied
export const c4 = quantize({ data: px, format: 'bgra', premultiplied: true, width: 10 }, 16);
// 5 Electron toBitmap wrapper, platform picks format; bitmap is bgra premultiplied
export function c5(buf: Buffer, w: number) { return quantize({ data: buf, format: 'bgra', premultiplied: true, width: w }, 16); }
// 6 typed variable of RawImage (all formats) assigned a boolean flag
export function c6(i: RawImage, p: boolean) { return quantize({ ...i, premultiplied: p }, 16); }
// 7 declared config object type
interface Cfg { format: 'rgb' | 'rgbx'; premultiplied: boolean }
export function c7(c: Cfg) { return quantize({ data: px, ...c }, 16); }
// 8 premultiplied: false on rgb (must compile)
export const c8 = quantize({ data: px, format: 'rgb', premultiplied: false }, 16);
// 9 bgrx with premultiplied: true (canvas surfaces without alpha; plausible mistake)
export const c9 = quantize({ data: px, format: 'bgrx', premultiplied: true }, 16);
// 10 wrapper function taking RawImage<'rgb'> param with boolean
export function c10(i: RawImage<'rgb'>) { return quantize({ ...i, premultiplied: flag }, 16); }
