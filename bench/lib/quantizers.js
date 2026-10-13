/**
 * Adapters giving every library the same interface:
 *
 *   palette(image, k)         -> Uint8Array of flat RGB bytes (what the library chose)
 *   paletteSweep(image, ks)?  -> one palette per k, for libraries that reuse work across k
 *   quantize(image, k)?       -> RGBA Uint8Array using the library's own pixel mapping (optional)
 *
 * `image` is { width, height, rgba } with rgba a Uint8Array. Input conversion into each
 * library's own format is part of the timed call, because a user has to pay it too.
 */

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

const require = createRequire(import.meta.url);

/** agglomerative-clustering, loaded from a built dist/index.mjs (this repo's by default). */
export async function agglomerative(name = 'agglomerative', distPath = 'dist/index.mjs') {
    const ac = await import(pathToFileURL(resolve(distPath)).href);
    await ac.init();
    return {
        name,
        palette: (image, k) => ac.getPalette(image.rgba, k),
        // The point of a hierarchical clustering: cluster once, then cut it at any k.
        paletteSweep: async (image, ks) => {
            const clustering = await ac.getClustering(image.rgba);
            const palettes = [];
            for (const k of ks) {palettes.push(await ac.getPaletteFromClustering(clustering, k));}
            return palettes;
        },
        quantize: (image, k) => ac.quantize(image.rgba, k),
    };
}

/** image-q's palette quantizers: 'neuquant', 'rgbquant' or 'wuquant'. Default options otherwise. */
export function imageQ(algorithm) {
    const iq = require('image-q');
    const container = (image) => iq.utils.PointContainer.fromUint8Array(image.rgba, image.width, image.height);
    const build = (pc, k) => iq.buildPaletteSync([pc], { paletteQuantization: algorithm, colors: k });
    return {
        name: `image-q ${algorithm}`,
        palette: (image, k) => {
            const points = build(container(image), k).getPointContainer().getPointArray();
            const out = new Uint8Array(points.length * 3);
            points.forEach((p, i) => {out[i * 3] = p.r; out[i * 3 + 1] = p.g; out[i * 3 + 2] = p.b;});
            return out;
        },
        quantize: (image, k) => {
            const pc = container(image);
            return iq.applyPaletteSync(pc, build(pc, k)).toUint8Array();
        },
    };
}

/** MMCQ (modified median cut, from Leptonica), the algorithm color-thief uses. Palette only. */
export function mmcq() {
    const quantize = require('quantize');
    return {
        name: 'mmcq (quantize)',
        palette: (image, k) => {
            const pixels = new Array(image.width * image.height);
            for (let i = 0, p = 0; i < image.rgba.length; i += 4, p++) {
                pixels[p] = [image.rgba[i], image.rgba[i + 1], image.rgba[i + 2]];
            }
            const cmap = quantize(pixels, k);
            return Uint8Array.from(cmap ? cmap.palette().flat() : []);
        },
    };
}

/** libimagequant (pngquant's engine) via libimagequant-wasm. Default speed (4), dithering off. */
export function libimagequant() {
    const path = require.resolve('libimagequant-wasm/wasm/libimagequant_wasm.js');
    let liq;
    const run = (image, k) => {
        const quantizer = new liq.ImageQuantizer();
        quantizer.setMaxColors(k);
        quantizer.setQuality(0, 100);
        const data = new Uint8ClampedArray(image.rgba.buffer, image.rgba.byteOffset, image.rgba.length);
        const result = quantizer.quantizeImage(data, image.width, image.height);
        quantizer.free();
        return { result, data };
    };
    return {
        name: 'libimagequant',
        init: async () => {
            liq = await import(pathToFileURL(path).href);
            liq.initSync({ module: readFileSync(path.replace(/\.js$/, '_bg.wasm')) });
        },
        palette: (image, k) => {
            const { result } = run(image, k);
            const palette = result.getPalette();
            result.free();
            return Uint8Array.from(palette.flatMap(([r, g, b]) => [r, g, b]));
        },
        quantize: (image, k) => {
            const { result, data } = run(image, k);
            result.setDithering(0);
            const out = result.remapImage(data, image.width, image.height);
            result.free();
            return new Uint8Array(out.buffer, out.byteOffset, out.length);
        },
    };
}

export const LIBRARIES = {
    'neuquant': () => imageQ('neuquant'),
    'wuquant': () => imageQ('wuquant'),
    'rgbquant': () => imageQ('rgbquant'),
    'mmcq': () => mmcq(),
    'libimagequant': () => libimagequant(),
};
