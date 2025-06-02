# Agglomerative Clustering

Agglomerative Clustering is module which provides a WebAssembly-backed interface for performing image clustering, palette extraction, and color quantization on raw image data.

## Features

- ✅ Extract clustering information from image data
- 🎨 Generate color palettes from raw images or clustering
- ✂️ Quantize images using clustering or palette data
- 🕹️ Async interface with lazy WASM initialization
- 💾 Works directly with raw `Uint8Array` image buffers (`rgb` or `rgba`)

## Installation

```sh
npm install agglomerative-clustering
```

## Usage
```js
import { quantize } from 'agglomerative-clustering';
import sharp from 'sharp';

async function loadImage(path) {
    const image = sharp(path);
    const { data, info } = await image.raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data: data }
}

async function saveImage(path, width, height, data) {
    await sharp(data, {
        raw: {
            width: width,
            height: height,
            channels: 4,
        }
    }).toFile(path);
}

(async () => {

    // Number of clusters
    const k = 8;

    // Load the image
    const { width, height, data } = await loadImage('example.png');
    const array = new Uint8Array(data.length);
    array.set(data);

    // Perform the image quantization
    const processed = await quantize(array, k);
    const buffer = Buffer.from(processed);
    
    // Save the result
    await saveImage('example_quantized.png', width, height, buffer);

})();

```