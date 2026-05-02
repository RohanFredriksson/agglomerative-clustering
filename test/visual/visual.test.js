// Visual tests — outputs are written to test/visual/output/synthetic/ for developer inspection.
// No pixel-level assertions are made; correctness is verified by eye.
import { describe, it, expect } from 'vitest';
import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { quantize, getPalette } from '../../dist/index.mjs';

const OUTPUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'output', 'synthetic');
mkdirSync(OUTPUT_DIR, { recursive: true });

function writeOutput(name, data, width, height) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(data);
    ctx.putImageData(imageData, 0, 0);
    writeFileSync(resolve(OUTPUT_DIR, `${name}.png`), canvas.toBuffer('image/png'));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Build an RGBA gradient sweeping from red (top-left) to blue (bottom-right).
 * The gradual colour variation means quantisation visibly posterises the image,
 * making differences between algorithm outputs easy to spot.
 */
function makeGradientRGBA(width, height) {
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            data[i + 0] = Math.round(255 * (1 - x / (width - 1)));   // R
            data[i + 1] = 0;                                           // G
            data[i + 2] = Math.round(255 * (x / (width - 1)));        // B
            data[i + 3] = 255;                                         // A
        }
    }
    return data;
}

/**
 * Build an RGBA image with four solid colour quadrants:
 * red (TL), green (TR), blue (BL), yellow (BR).
 */
function makeQuadrantRGBA(width, height) {
    const data = new Uint8Array(width * height * 4);
    const hw = Math.floor(width / 2);
    const hh = Math.floor(height / 2);
    const colors = [
        [255,   0,   0, 255], // top-left     — red
        [  0, 255,   0, 255], // top-right    — green
        [  0,   0, 255, 255], // bottom-left  — blue
        [255, 255,   0, 255], // bottom-right — yellow
    ];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const quadrant = (y >= hh ? 2 : 0) + (x >= hw ? 1 : 0);
            const i = (y * width + x) * 4;
            data[i + 0] = colors[quadrant][0];
            data[i + 1] = colors[quadrant][1];
            data[i + 2] = colors[quadrant][2];
            data[i + 3] = colors[quadrant][3];
        }
    }
    return data;
}

/**
 * Build a rainbow RGBA image cycling through hues row by row.
 * Provides a richer colour space to stress-test palette reduction.
 */
function makeRainbowRGBA(width, height) {
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const hue = ((x + y * width) / (width * height)) * 360;
            const [r, g, b] = hslToRgb(hue, 1, 0.5);
            const i = (y * width + x) * 4;
            data[i + 0] = r;
            data[i + 1] = g;
            data[i + 2] = b;
            data[i + 3] = 255;
        }
    }
    return data;
}

function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60)       { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else              { r = c; g = 0; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render a palette as a horizontal strip (each colour = one pixel wide, full height).
 * Width = k, height = 64.
 */
function paletteToRGBA(palette, k) {
    const height = 64;
    const data = new Uint8Array(k * height * 4);
    for (let col = 0; col < k; col++) {
        for (let row = 0; row < height; row++) {
            const i = (row * k + col) * 4;
            data[i + 0] = palette[col * 3 + 0];
            data[i + 1] = palette[col * 3 + 1];
            data[i + 2] = palette[col * 3 + 2];
            data[i + 3] = 255;
        }
    }
    return data;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const W = 128, H = 128;
const gradient   = makeGradientRGBA(W, H);
const quadrant   = makeQuadrantRGBA(W, H);
const rainbow    = makeRainbowRGBA(W, H);

describe('visual — quantize outputs', () => {

    it('gradient quantized to k=2', async () => {
        const result = await quantize(gradient, 2);
        expect(result).toBeInstanceOf(Uint8Array);
        writeOutput('quantize-gradient-k2', result, W, H);
    });

    it('gradient quantized to k=4', async () => {
        const result = await quantize(gradient, 4);
        expect(result).toBeInstanceOf(Uint8Array);
        writeOutput('quantize-gradient-k4', result, W, H);
    });

    it('gradient quantized to k=8', async () => {
        const result = await quantize(gradient, 8);
        expect(result).toBeInstanceOf(Uint8Array);
        writeOutput('quantize-gradient-k8', result, W, H);
    });

    it('gradient quantized to k=16', async () => {
        const result = await quantize(gradient, 16);
        expect(result).toBeInstanceOf(Uint8Array);
        writeOutput('quantize-gradient-k16', result, W, H);
    });

    it('gradient quantized to k=32', async () => {
        const result = await quantize(gradient, 32);
        expect(result).toBeInstanceOf(Uint8Array);
        writeOutput('quantize-gradient-k32', result, W, H);
    });

    it('gradient quantized to k=64', async () => {
        const result = await quantize(gradient, 64);
        expect(result).toBeInstanceOf(Uint8Array);
        writeOutput('quantize-gradient-k64', result, W, H);
    });

    it('quadrant quantized to k=2', async () => {
        const result = await quantize(quadrant, 2);
        expect(result).toBeInstanceOf(Uint8Array);
        writeOutput('quantize-quadrant-k2', result, W, H);
    });

    it('quadrant quantized to k=4', async () => {
        const result = await quantize(quadrant, 4);
        expect(result).toBeInstanceOf(Uint8Array);
        writeOutput('quantize-quadrant-k4', result, W, H);
    });

    it('quadrant quantized to k=8', async () => {
        const result = await quantize(quadrant, 8);
        expect(result).toBeInstanceOf(Uint8Array);
        writeOutput('quantize-quadrant-k8', result, W, H);
    });

    it('rainbow quantized to k=2', async () => {
        const result = await quantize(rainbow, 2);
        expect(result).toBeInstanceOf(Uint8Array);
        writeOutput('quantize-rainbow-k2', result, W, H);
    });

    it('rainbow quantized to k=4', async () => {
        const result = await quantize(rainbow, 4);
        expect(result).toBeInstanceOf(Uint8Array);
        writeOutput('quantize-rainbow-k4', result, W, H);
    });

    it('rainbow quantized to k=8', async () => {
        const result = await quantize(rainbow, 8);
        expect(result).toBeInstanceOf(Uint8Array);
        writeOutput('quantize-rainbow-k8', result, W, H);
    });

    it('rainbow quantized to k=16', async () => {
        const result = await quantize(rainbow, 16);
        expect(result).toBeInstanceOf(Uint8Array);
        writeOutput('quantize-rainbow-k16', result, W, H);
    });

    it('rainbow quantized to k=32', async () => {
        const result = await quantize(rainbow, 32);
        expect(result).toBeInstanceOf(Uint8Array);
        writeOutput('quantize-rainbow-k32', result, W, H);
    });

    it('rainbow quantized to k=64', async () => {
        const result = await quantize(rainbow, 64);
        expect(result).toBeInstanceOf(Uint8Array);
        writeOutput('quantize-rainbow-k64', result, W, H);
    });

});

describe('visual — palette outputs', () => {

    it('gradient palette k=4', async () => {
        const palette = await getPalette(gradient, 4);
        expect(palette).toBeInstanceOf(Uint8Array);
        writeOutput('palette-gradient-k4', paletteToRGBA(palette, 4), 4, 64);
    });

    it('gradient palette k=8', async () => {
        const palette = await getPalette(gradient, 8);
        expect(palette).toBeInstanceOf(Uint8Array);
        writeOutput('palette-gradient-k8', paletteToRGBA(palette, 8), 8, 64);
    });

    it('gradient palette k=16', async () => {
        const palette = await getPalette(gradient, 16);
        expect(palette).toBeInstanceOf(Uint8Array);
        writeOutput('palette-gradient-k16', paletteToRGBA(palette, 16), 16, 64);
    });

    it('gradient palette k=32', async () => {
        const palette = await getPalette(gradient, 32);
        expect(palette).toBeInstanceOf(Uint8Array);
        writeOutput('palette-gradient-k32', paletteToRGBA(palette, 32), 32, 64);
    });

    it('gradient palette k=64', async () => {
        const palette = await getPalette(gradient, 64);
        expect(palette).toBeInstanceOf(Uint8Array);
        writeOutput('palette-gradient-k64', paletteToRGBA(palette, 64), 64, 64);
    });

    it('rainbow palette k=4', async () => {
        const palette = await getPalette(rainbow, 4);
        expect(palette).toBeInstanceOf(Uint8Array);
        writeOutput('palette-rainbow-k4', paletteToRGBA(palette, 4), 4, 64);
    });

    it('rainbow palette k=8', async () => {
        const palette = await getPalette(rainbow, 8);
        expect(palette).toBeInstanceOf(Uint8Array);
        writeOutput('palette-rainbow-k8', paletteToRGBA(palette, 8), 8, 64);
    });

    it('rainbow palette k=16', async () => {
        const palette = await getPalette(rainbow, 16);
        expect(palette).toBeInstanceOf(Uint8Array);
        writeOutput('palette-rainbow-k16', paletteToRGBA(palette, 16), 16, 64);
    });

    it('rainbow palette k=32', async () => {
        const palette = await getPalette(rainbow, 32);
        expect(palette).toBeInstanceOf(Uint8Array);
        writeOutput('palette-rainbow-k32', paletteToRGBA(palette, 32), 32, 64);
    });

    it('rainbow palette k=64', async () => {
        const palette = await getPalette(rainbow, 64);
        expect(palette).toBeInstanceOf(Uint8Array);
        writeOutput('palette-rainbow-k64', paletteToRGBA(palette, 64), 64, 64);
    });

});
