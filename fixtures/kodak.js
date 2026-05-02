/**
 * Shared helpers for the Kodak Lossless True Color Image Suite.
 * 24 natural photos at 768×512 — the standard dataset for image quality benchmarking.
 *
 * Images are downloaded on first use and cached in fixtures/images/ (gitignored).
 */

import { createCanvas, loadImage as canvasLoadImage } from 'canvas';
import { mkdir, access, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const IMAGES_DIR = join(__dirname, 'images');

export const KODAK_IMAGES = Array.from({ length: 24 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return {
        name: `kodim${n}`,
        urls: [
            `https://r0k.us/graphics/kodak/kodak/kodim${n}.png`,
            `https://huggingface.co/datasets/dblasko/kodak/resolve/main/kodim${n}.png`,
        ],
    };
});

/**
 * Ensures the image is downloaded and cached. Returns the local file path.
 * If already present on disk, returns immediately without a network request.
 */
export async function ensureImage({ name, urls }) {
    await mkdir(IMAGES_DIR, { recursive: true });
    const path = join(IMAGES_DIR, `${name}.png`);
    try {
        await access(path);
        return path;
    } catch {
        process.stdout.write(`  Downloading ${name}... `);
        let lastError;
        for (const url of urls) {
            try {
                const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                await writeFile(path, Buffer.from(await res.arrayBuffer()));
                console.log('done');
                return path;
            } catch (err) {
                lastError = err;
            }
        }
        throw new Error(`Failed to download ${name} from all sources: ${lastError.message}`);
    }
}

/**
 * Loads an image from a local file path and returns its raw RGBA buffer.
 */
export async function getImageRgba(path) {
    const img = await canvasLoadImage(path);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, img.width, img.height);
    return {
        rgba:   new Uint8Array(data.buffer),
        pixels: img.width * img.height,
        width:  img.width,
        height: img.height,
    };
}
