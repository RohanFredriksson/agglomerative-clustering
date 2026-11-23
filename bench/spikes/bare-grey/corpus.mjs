// The test corpus: bench/spikes/bare-rgb's real RGBA images (negatives, all of them), and 1- and 2-channel grey
// versions of the same sources passed bare (positives), each with the true image for measuring harm.
//   node bench/spikes/bare-rgb/fetch-images.mjs   (once: the emoji sets)
import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { quantize } from '../../../dist/index.mjs';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../../fixtures/kodak.js';
import { syntheticImages } from '../../lib/images.js';

const here = dirname(fileURLToPath(import.meta.url));
const emojiRoot = join(here, '../../../fixtures/images/bare-rgb');

export const luma = (r, g, b) => Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
export function rgbaFrom(rgb, alphaAt) {
    const n = rgb.length / 3, out = new Uint8Array(n * 4);
    for (let p = 0; p < n; p++) {
        out[4 * p] = rgb[3 * p]; out[4 * p + 1] = rgb[3 * p + 1]; out[4 * p + 2] = rgb[3 * p + 2];
        out[4 * p + 3] = alphaAt(p, rgb[3 * p], rgb[3 * p + 1], rgb[3 * p + 2]);
    }
    return out;
}
const stripAlpha = (rgba) => {
    const n = rgba.length / 4, out = new Uint8Array(n * 3);
    for (let p = 0; p < n; p++) {out[3 * p] = rgba[4 * p]; out[3 * p + 1] = rgba[4 * p + 1]; out[3 * p + 2] = rgba[4 * p + 2];}
    return out;
};
const onBackground = (rgba, bg) => {
    const n = rgba.length / 4, out = new Uint8Array(n * 3);
    for (let p = 0; p < n; p++) {const a = rgba[4 * p + 3] / 255; for (let c = 0; c < 3; c++) {out[3 * p + c] = Math.round(rgba[4 * p + c] * a + bg * (1 - a));}}
    return out;
};
const premultiply = (rgba) => {
    const out = new Uint8Array(rgba);
    for (let p = 0; p < out.length; p += 4) {const a = out[p + 3]; for (let c = 0; c < 3; c++) {out[p + c] = Math.round(out[p + c] * a / 255);}}
    return out;
};
const greyOf = (rgb) => {const n = rgb.length / 3, out = new Uint8Array(n); for (let p = 0; p < n; p++) {out[p] = luma(rgb[3 * p], rgb[3 * p + 1], rgb[3 * p + 2]);} return out;};
const expandGrey = (g) => {const out = new Uint8Array(g.length * 3); for (let p = 0; p < g.length; p++) {out[3 * p] = out[3 * p + 1] = out[3 * p + 2] = g[p];} return out;};
// Grey + alpha (2 channels), and the true image as RGBA (grey expanded, alpha kept)
const greyAlpha = (g, alphaAt) => {
    const ga = new Uint8Array(g.length * 2), rgba = new Uint8Array(g.length * 4);
    for (let p = 0; p < g.length; p++) {
        const a = alphaAt(p, g[p]);
        ga[2 * p] = g[p]; ga[2 * p + 1] = a;
        rgba[4 * p] = rgba[4 * p + 1] = rgba[4 * p + 2] = g[p]; rgba[4 * p + 3] = a;
    }
    return { bytes: ga, truth: rgba };
};
// Grey + alpha from an RGBA image: luma of the colour, its alpha (an emoji or a cutout saved as a grey PNG)
const greyAlphaOfRgba = (rgba) => {
    const n = rgba.length / 4, g = new Uint8Array(n);
    for (let p = 0; p < n; p++) {g[p] = luma(rgba[4 * p], rgba[4 * p + 1], rgba[4 * p + 2]);}
    return greyAlpha(g, (p) => rgba[4 * p + 3]);
};
function crop(px, width, side, channels) {
    const height = px.length / channels / width, x0 = (width - side) >> 1, y0 = (height - side) >> 1;
    const out = new Uint8Array(side * side * channels);
    for (let y = 0; y < side; y++) {out.set(px.subarray(((y0 + y) * width + x0) * channels, ((y0 + y) * width + x0 + side) * channels), y * side * channels);}
    return out;
}
function rng(seed) {let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);}

// Yields { kind: 'rgba' | 'grey1' | 'grey2' | 'rgb', group, name, bytes, truth?, truthFormat? }. For positives, truth is the
// image as the library should have been given it (grey expanded to RGB, or RGBA for grey + alpha).
export async function* corpus({ emoji = true, crops = [2, 4, 8, 16, 32, 64] } = {}) {
    for (const img of KODAK_IMAGES) {
        const { rgba, width, height } = await getImageRgba(await ensureImage(img));
        const rgb = stripAlpha(rgba), g = greyOf(rgb), r = rng(7);
        const cx = width / 2, cy = height / 2, radius = 0.4 * Math.min(width, height);
        const featherAt = (p) => {const x = p % width, y = (p / width) | 0; return Math.round(255 * Math.min(1, Math.max(0, (radius - Math.hypot(x - cx, y - cy)) / 32)));};
        const cutout = rgbaFrom(rgb, featherAt);
        for (let p = 0; p < cutout.length; p += 4) {if (cutout[p + 3] === 0) {cutout[p] = cutout[p + 1] = cutout[p + 2] = 0;}}
        const grey = expandGrey(g);
        const white = new Uint8Array(rgb.length).fill(255);
        const negatives = {
            'opaque': rgbaFrom(rgb, () => 255),
            'feathered cutout': cutout,
            'alpha ramp': rgbaFrom(rgb, (p) => Math.round(255 * (p % width) / (width - 1))),
            'alpha = luma': rgbaFrom(rgb, (p, a, b, c) => luma(a, b, c)),
            'alpha 128': rgbaFrom(rgb, () => 128),
            'alpha noise': rgbaFrom(rgb, () => (r() * 256) | 0),
            'premultiplied cutout': premultiply(cutout),
            'premultiplied alpha = luma': premultiply(rgbaFrom(rgb, (p, a, b, c) => luma(a, b, c))),
            'grey opaque': rgbaFrom(grey, () => 255),
            'grey, alpha = luma': rgbaFrom(grey, (p, a) => a),
            'grey feathered cutout': rgbaFrom(grey, featherAt),
            'white, alpha = luma (mask)': rgbaFrom(white, (p) => g[p]),
            'premultiplied white mask': premultiply(rgbaFrom(white, (p) => g[p])),
            'black, alpha = luma (shadow)': rgbaFrom(new Uint8Array(rgb.length), (p) => 255 - g[p]),
        };
        for (const [variant, bytes] of Object.entries(negatives)) {yield { kind: 'rgba', group: `kodak: ${variant}`, name: img.name, bytes };}
        yield { kind: 'grey1', group: 'kodak: grey', name: img.name, bytes: g, truth: grey, truthFormat: 'rgb' };
        // 3-channel RGB passed bare (the 3.5.0 warning's case), to see which rule each kind sets off
        yield { kind: 'rgb', group: 'kodak: rgb', name: img.name, bytes: rgb };
        yield { kind: 'rgb', group: 'kodak: grey as rgb', name: img.name, bytes: grey };
        // with a flat margin, which evenly spaced sampling windows could see alone (they started one row apart at 768×512)
        {
            const blackCut = new Uint8Array(rgb.length);
            for (let p = 0; p < blackCut.length / 3; p++) {const a = featherAt(p) / 255; for (let c = 0; c < 3; c++) {blackCut[3 * p + c] = Math.round(rgb[3 * p + c] * a);}}
            yield { kind: 'rgb', group: 'kodak: rgb cutout on black', name: img.name, bytes: blackCut };
            const ga = new Uint8Array(g.length * 2);
            for (let p = 0; p < g.length; p++) {const a = featherAt(p); ga[2 * p] = a ? g[p] : 0; ga[2 * p + 1] = a;}
            yield { kind: 'grey2', group: 'kodak: grey + alpha, cutout, transparent zeroed', name: img.name, bytes: ga, flatMargin: true };
        }
        for (const [variant, alphaAt] of Object.entries({ 'alpha 255': () => 255, 'feathered cutout': featherAt, 'alpha ramp': (p) => Math.round(255 * (p % width) / (width - 1)) })) {
            const { bytes, truth } = greyAlpha(g, alphaAt);
            yield { kind: 'grey2', group: `kodak: grey + alpha, ${variant}`, name: img.name, bytes, truth, truthFormat: 'rgba' };
        }
        // dithered: colour (negatives) and grey to 2 and 8 levels (positives), both methods
        for (const dither of ['floyd-steinberg', 'ordered']) {
            const { data } = await quantize({ data: rgb, format: 'rgb', width }, 16, { dither });
            yield { kind: 'rgba', group: `kodak: dithered (${dither}), opaque`, name: img.name, bytes: rgbaFrom(new Uint8Array(data), () => 255) };
            for (const levels of [2, 8]) {
                const palette = new Uint8Array(levels * 3).map((_, i) => Math.round(255 * Math.floor(i / 3) / (levels - 1)));
                const { quantizeWithPalette } = await import('../../../dist/index.mjs');
                const { data: dd } = await quantizeWithPalette({ data: grey, format: 'rgb', width }, palette, { dither });
                const d1 = new Uint8Array(dd.length / 3); for (let p = 0; p < d1.length; p++) {d1[p] = dd[3 * p];}
                yield { kind: 'grey1', group: `kodak: grey dithered to ${levels} (${dither})`, name: img.name, bytes: d1, truth: new Uint8Array(dd), truthFormat: 'rgb' };
            }
        }
        // pixel art: a 96×64 cut to 12 colours, upscaled 8×; grey version too
        {
            const small = new Uint8Array(96 * 64 * 3);
            for (let y = 0; y < 64; y++) {for (let x = 0; x < 96; x++) {for (let c = 0; c < 3; c++) {small[(y * 96 + x) * 3 + c] = rgb[((y * 8) * width + x * 8) * 3 + c];}}}
            const { data } = await quantize({ data: small, format: 'rgb' }, 12);
            const art = new Uint8Array(width * height * 3);
            for (let y = 0; y < height; y++) {for (let x = 0; x < width; x++) {for (let c = 0; c < 3; c++) {art[(y * width + x) * 3 + c] = data[((y >> 3) * 96 + (x >> 3)) * 3 + c];}}}
            const spriteAlpha = (p) => (((p % width) >> 3) % 5 === 0 ? 0 : 255);
            yield { kind: 'rgba', group: 'kodak: pixel art, sprite alpha', name: img.name, bytes: rgbaFrom(art, spriteAlpha) };
            const ag = greyOf(art);
            yield { kind: 'grey1', group: 'kodak: grey pixel art', name: img.name, bytes: ag, truth: expandGrey(ag), truthFormat: 'rgb' };
            const { bytes, truth } = greyAlpha(ag, spriteAlpha);
            yield { kind: 'grey2', group: 'kodak: grey pixel art + sprite alpha', name: img.name, bytes, truth, truthFormat: 'rgba' };
        }
        for (const side of crops) {
            yield { kind: 'rgba', group: `kodak crop ${side}×${side}: opaque`, name: img.name, bytes: rgbaFrom(crop(rgb, width, side, 3), () => 255) };
            yield { kind: 'rgb', group: `kodak crop ${side}×${side}: rgb`, name: img.name, bytes: crop(rgb, width, side, 3) };
            const cg = crop(g, width, side, 1);
            yield { kind: 'grey1', group: `kodak crop ${side}×${side}: grey`, name: img.name, bytes: cg, truth: expandGrey(cg), truthFormat: 'rgb' };
            const { bytes, truth } = greyAlpha(cg, () => 255);
            yield { kind: 'grey2', group: `kodak crop ${side}×${side}: grey + alpha 255`, name: img.name, bytes, truth, truthFormat: 'rgba' };
        }
    }
    for (const img of syntheticImages()) {
        yield { kind: 'rgba', group: 'synthetic: opaque', name: img.name, bytes: img.rgba };
        const g = greyOf(stripAlpha(img.rgba));
        yield { kind: 'grey1', group: 'synthetic: grey', name: img.name, bytes: g, truth: expandGrey(g), truthFormat: 'rgb' };
        const { bytes, truth } = greyAlpha(g, () => 255);
        yield { kind: 'grey2', group: 'synthetic: grey + alpha 255', name: img.name, bytes, truth, truthFormat: 'rgba' };
    }
    if (!emoji) {return;}
    for (const set of ['twemoji', 'noto']) {
        for (const file of (await readdir(join(emojiRoot, set))).sort()) {
            const { data } = await sharp(join(emojiRoot, set, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            const rgba = new Uint8Array(data);
            yield { kind: 'rgba', group: `${set}: rgba`, name: file, bytes: rgba };
            yield { kind: 'rgba', group: `${set}: premultiplied`, name: file, bytes: premultiply(rgba) };
            const { bytes, truth } = greyAlphaOfRgba(rgba);
            yield { kind: 'grey2', group: `${set}: grey + alpha`, name: file, bytes, truth, truthFormat: 'rgba' };
            // their grey + alpha as RGBA is a real RGBA image too (an icon saved grey, decoded to RGBA)
            yield { kind: 'rgba', group: `${set}: grey rgba`, name: file, bytes: truth };
            yield { kind: 'rgb', group: `${set}: rgb on white`, name: file, bytes: onBackground(rgba, 255) };
            yield { kind: 'rgb', group: `${set}: rgb on black`, name: file, bytes: onBackground(rgba, 0) };
            const w = greyOf(onBackground(rgba, 255));
            yield { kind: 'grey1', group: `${set}: grey on white`, name: file, bytes: w, truth: expandGrey(w), truthFormat: 'rgb' };
        }
    }
}
