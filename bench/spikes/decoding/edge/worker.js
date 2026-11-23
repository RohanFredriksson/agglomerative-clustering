// Spike harness: POST a file to /decode (decode only), /colors (decode + buildSwatches) or /noop.
import { init, buildSwatches } from 'agglomerative-clustering';
import wasm from 'agglomerative-clustering/clustering.wasm';
import { decodeImage } from './decode.js';

const ready = init({ wasm });
export default {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (path === '/noop') {return Response.json({ bytes: bytes.length });}
    await ready;
    const image = await decodeImage(bytes);
    let sum = 0;
    for (let i = 0; i < image.data.length; i += 4099) {sum += image.data[i];}
    if (path === '/decode') {return Response.json({ width: image.width, height: image.height, sum });}
    const { palette, shares } = await buildSwatches(image, 5, { precision: 6 });
    return Response.json({ width: image.width, height: image.height, palette: Array.from(palette), shares: Array.from(shares) });
  },
};
