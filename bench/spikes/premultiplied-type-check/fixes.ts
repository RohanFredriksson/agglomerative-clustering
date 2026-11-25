import { quantize, type ImageFormat, type RawImage } from './index.js';
declare const px: Uint8Array; declare const f: ImageFormat; declare const flag: boolean; declare const channels: 3|4;
// F1: cast
export const f1 = quantize({ data: px, format: f, premultiplied: flag } as RawImage, 16);
// F2: branch on format
export const f2 = (f === 'rgba' || f === 'bgra') ? quantize({ data: px, format: f, premultiplied: flag }, 16) : quantize({ data: px, format: f }, 16);
// F3: helper-narrowed ternary
export function f3() { return channels === 3 ? quantize({ data: px, format: 'rgb' }, 16) : quantize({ data: px, format: 'rgba', premultiplied: flag }, 16); }
// F4: false-coerce still boolean
export const f4 = quantize({ data: px, format: f, premultiplied: flag && (f==='rgba'||f==='bgra') }, 16);
// F5: premultiplied: flag as const false-literal for rgb
export const f5 = quantize({ data: px, format: 'rgb', premultiplied: flag as false }, 16);
