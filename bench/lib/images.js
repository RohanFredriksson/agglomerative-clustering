/**
 * Image sets for the benchmark harness.
 *
 * - kodak:     the 24 Kodak photos (768×512), downloaded on first use.
 * - synthetic: generated in code, so they need no network and are identical on every run:
 *              smooth gradients, a flat-colour "graphic" with anti-aliased edges, and
 *              uniform noise (the worst case for clustering: almost every pixel is unique).
 *
 * Every loader returns { set, name, width, height, pixels, rgba } with rgba a Uint8Array.
 */

import { createCanvas } from 'canvas';
import { KODAK_IMAGES, ensureImage, getImageRgba } from '../../fixtures/kodak.js';

export const SETS = ['kodak', 'synthetic'];

function fromCanvas(set, name, canvas) {
    const { width, height } = canvas;
    const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
    return { set, name, width, height, pixels: width * height, rgba: new Uint8Array(data.buffer) };
}

function fromPixels(set, name, width, height, fill) {
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const o = (y * width + x) * 4;
            const [r, g, b] = fill(x, y);
            rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
        }
    }
    return { set, name, width, height, pixels: width * height, rgba };
}

function hsvToRgb(h, s, v) {
    const i = Math.floor(h * 6), f = h * 6 - i;
    const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function noise(side) {
    const rgba = new Uint8Array(side * side * 4);
    let s = 0xdeadbeef;
    for (let i = 0; i < rgba.length; i++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        rgba[i] = (i & 3) === 3 ? 255 : s >>> 24;
    }
    return { set: 'synthetic', name: `noise-${side}`, width: side, height: side, pixels: side * side, rgba };
}

function graphic() {
    // Logo/illustration-like: a handful of flat colours, anti-aliased shapes and text.
    const canvas = createCanvas(768, 512);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f4efe6'; ctx.fillRect(0, 0, 768, 512);
    const colours = ['#1d3557', '#e63946', '#2a9d8f', '#e9c46a', '#f4a261', '#264653', '#8338ec', '#06d6a0'];
    let s = 12345;
    const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < 40; i++) {
        ctx.fillStyle = colours[i % colours.length];
        ctx.beginPath();
        if (i % 2) {ctx.arc(rand() * 768, rand() * 512, 10 + rand() * 70, 0, Math.PI * 2);}
        else {ctx.rect(rand() * 700, rand() * 450, 20 + rand() * 150, 20 + rand() * 100);}
        ctx.fill();
    }
    ctx.fillStyle = '#111111';
    ctx.font = 'bold 64px sans-serif';
    ctx.fillText('Palette 123', 40, 470);
    return fromCanvas('synthetic', 'graphic', canvas);
}

export function syntheticImages() {
    return [
        // Hue across x, value across y: smooth, many unique colours, banding shows quickly.
        fromPixels('synthetic', 'gradient-hsv', 768, 512, (x, y) => hsvToRgb(x / 768, 0.85, 0.15 + 0.85 * (1 - y / 512))),
        // Two-channel ramp: a dense 2D sheet of colours in RGB space.
        fromPixels('synthetic', 'gradient-rgb', 768, 512, (x, y) => [Math.round(x / 767 * 255), Math.round(y / 511 * 255), 96]),
        graphic(),
        noise(512),
        noise(1024),
    ];
}

/** Yields images one at a time so only one Kodak photo is decoded in memory at once. */
export async function* loadImages(sets, { kodakLimit = KODAK_IMAGES.length } = {}) {
    if (sets.includes('kodak')) {
        for (const img of KODAK_IMAGES.slice(0, kodakLimit)) {
            const path = await ensureImage(img);
            const { rgba, width, height, pixels } = await getImageRgba(path);
            yield { set: 'kodak', name: img.name, width, height, pixels, rgba };
        }
    }
    if (sets.includes('synthetic')) {
        for (const image of syntheticImages()) {yield image;}
    }
}

export function countUniqueColours(rgba) {
    const seen = new Uint8Array(1 << 21); // 2^24 bits
    let count = 0;
    for (let i = 0; i < rgba.length; i += 4) {
        const c = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
        const bit = 1 << (c & 7);
        if (!(seen[c >> 3] & bit)) {seen[c >> 3] |= bit; count++;}
    }
    return count;
}
