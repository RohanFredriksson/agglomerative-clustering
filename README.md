# Agglomerative Clustering

A high-performance implementation of hierarchical agglomerative clustering (HAC), optimized for speed and scalability. This package uses WebAssembly (WASM) to accelerate computation, making it suitable for large datasets and real-time clustering tasks in the browser or Node.js environments.

It includes an interface for performing image clustering, palette extraction, and color quantization directly on raw image data, making it a powerful tool for graphics processing, image analysis, and visual data simplification.

## Features

- ✅ Extract clustering information from image data
- 🎨 Generate color palettes from raw images or clustering
- ✂️ Quantize images using clustering or palette data
- 🕹️ Async interface with lazy WASM initialization
- 💾 Works with `Uint8Array`, `Uint8ClampedArray`, and `ImageData` inputs (`rgb` or `rgba`)
- 📦 TypeScript declarations included

## Installation

```sh
npm install agglomerative-clustering
```

## Input types

All functions that accept an image accept any of the following input types:

```ts
// Plain raw RGBA buffer — format defaults to 'rgba'
Uint8Array

// Browser Canvas ImageData — always treated as 'rgba'
ImageData

// Explicit format object — use this for 'rgb' data or Uint8ClampedArray buffers
{ data: Uint8Array | Uint8ClampedArray, format: 'rgb' | 'rgba' }
```

The three `quantize*` functions mirror the input type in their return value: passing a `Uint8Array` returns a `Uint8Array`, passing an `ImageData` returns an `ImageData`, and passing an object returns an object with the same `format`.

## Usage

### Node.js (with sharp)

```js
import { quantize } from 'agglomerative-clustering';
import sharp from 'sharp';

async function loadImage(path) {
    const { data, info } = await sharp(path).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data: new Uint8Array(data.buffer) };
}

async function saveImage(path, width, height, data) {
    await sharp(data, { raw: { width, height, channels: 4 } }).toFile(path);
}

(async () => {

    const k = 8;
    const { width, height, data } = await loadImage('example.png');

    // Quantize — result is the same type as the input (Uint8Array here)
    const processed = await quantize(data, k);

    await saveImage('example_quantized.png', width, height, Buffer.from(processed));

})();
```

### Browser (with Canvas)

```js
import { quantize } from 'agglomerative-clustering';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

// Pass ImageData directly — result is a new ImageData with the same dimensions
const result = await quantize(imageData, 8);
ctx.putImageData(result, 0, 0);
```

### Reusing clustering across multiple palette sizes

```js
import { getClustering, getPaletteFromClustering, quantizeWithClustering } from 'agglomerative-clustering';

const data = new Uint8Array(/* raw rgba bytes */);

// Compute clustering once
const clustering = await getClustering(data);

// Derive different palette sizes without recomputing the clustering
const palette4  = await getPaletteFromClustering(clustering, 4);
const palette16 = await getPaletteFromClustering(clustering, 16);

// Quantize using the precomputed clustering
const quantized = await quantizeWithClustering(data, clustering, 8);
```

## API

### `init(): Promise<void>`
Pre-initializes the WASM module. All other functions call this lazily, so explicit use is optional — useful for warming up the module before processing a batch of images.

### `getClustering(image): Promise<Uint8Array>`
Computes a compact hierarchical clustering from the image's color histogram. The result can be passed to `getPaletteFromClustering` or `quantizeWithClustering` to avoid redundant work.

### `getPalette(image, k): Promise<Uint8Array>`
Returns a palette of up to `k` colors as a flat RGB byte array (`k * 3` bytes).

### `getPaletteFromClustering(clustering, k): Promise<Uint8Array>`
Derives a palette of up to `k` colors from a precomputed clustering.

### `quantize(image, k): Promise<Uint8Array | ImageData | RawImage>`
Quantizes the image to at most `k` colors. Return type matches the input type.

### `quantizeWithClustering(image, clustering, k): Promise<Uint8Array | ImageData | RawImage>`
Quantizes using a precomputed clustering. Return type matches the input type.

### `quantizeWithPalette(image, palette): Promise<Uint8Array | ImageData | RawImage>`
Quantizes using an already-computed palette. Return type matches the input type.