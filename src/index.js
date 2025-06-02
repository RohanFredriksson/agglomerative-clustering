import createWasmModule from '../dist/clustering.js';
import { data } from './image.js';

let Module = null;

const codes = {"rgba": 0, "rgb": 1};

const init = async () => {
    if (!Module) {Module = await createWasmModule();}
};

const unpack = (pointer) => {
    const lengthBuffer = new Uint8Array(Module.HEAPU8.subarray(pointer, pointer + 4));
    const length = lengthBuffer[0] | (lengthBuffer[1] << 8) | (lengthBuffer[2] << 16) | (lengthBuffer[3] << 24);
    const outputBuffer = new Uint8Array(Module.HEAPU8.subarray(pointer + 4, pointer + 4 + length));
    return outputBuffer;
};

const load = (image) => {

    if (image instanceof Uint8Array) {return {data: image, format: 'rgba'};}

    const checks = [
        image,
        typeof image === "object",
        image.data,
        image.data instanceof Uint8Array,
        image.format,
        image.format === "rgb" || image.format === "rgba",
    ]

    checks.forEach((check) => {
        if (!check) {throw new Error("Unsupported image image type");}
    });

    return image

};

export const getClustering = async (image) => {

    await init();
    image = load(image);

    const imagePointer = Module._malloc(image.data.length);
    Module.HEAPU8.set(image.data, imagePointer);

    const outputPointer = Module._get_clustering(imagePointer, image.data.length, codes[image.format]);
    const output = unpack(outputPointer);

    Module._free(imagePointer);
    Module._free(outputPointer);

    return output;

};

export const getPalette = async (image, k) => {

    await init();
    image = load(image);

    const imagePointer = Module._malloc(image.data.length);
    Module.HEAPU8.set(image.data, imagePointer);

    const outputPointer = Module._get_palette(imagePointer, image.data.length, codes[image.format], k);
    const output = unpack(outputPointer);

    Module._free(imagePointer);
    Module._free(outputPointer);

    return output;

};

export const getPaletteFromClustering = async (image, clustering, k) => {

    await init();
    image = load(image);

    const clusteringPointer = Module._malloc(clustering.length);
    Module.HEAPU8.set(clustering, clusteringPointer);

    const outputPointer = Module._get_palette_from_clustering(clusteringPointer, clustering.length, k);
    const output = unpack(outputPointer);

    Module._free(clusteringPointer);
    Module._free(outputPointer);

    return output;

};

export const quantize = async (image, k) => {

    await init();
    image = load(image);
    
    const imagePointer = Module._malloc(image.data.length);
    Module.HEAPU8.set(image.data, imagePointer);

    const outputPointer = Module._quantize(imagePointer, image.data.length, codes[image.format], k);
    const output = unpack(outputPointer);

    Module._free(imagePointer);
    Module._free(outputPointer);

    return output;

};

export const quantizeWithClustering = async (image, clustering, k) => {

    await init();
    image = load(image);

    const imagePointer = Module._malloc(image.data.length);
    const clusteringPointer = Module._malloc(clustering.length);
    Module.HEAPU8.set(image.data, imagePointer);
    Module.HEAPU8.set(clustering, clusteringPointer);

    const outputPointer = Module._quantize_with_clustering(imagePointer, image.data.length, codes[image.format], clusteringPointer, clustering.length, k);
    const output = unpack(outputPointer);

    Module._free(imagePointer);
    Module._free(clusteringPointer);
    Module._free(outputPointer);

    return output;

};

export const quantizeWithPalette = async (image, palette) => {

    await init();
    image = load(image);

    const imagePointer = Module._malloc(image.data.length);
    const palettePointer = Module._malloc(palette.length);
    Module.HEAPU8.set(image.data, imagePointer);
    Module.HEAPU8.set(palette, palettePointer);

    const outputPointer = Module._quantize_with_palette(imagePointer, image.data.length, codes[image.format], palettePointer, palette.length);
    const output = unpack(outputPointer);

    Module._free(imagePointer);
    Module._free(palettePointer);
    Module._free(outputPointer);

    return output;

};

let f = async () => {

    const image = {data: new Uint8Array(data), format: 'rgb'}
    const clustering = await getClustering(image);
    const palette = await getPalette(image, 30);
    
    console.log(clustering);
    console.log(palette);
    console.log(await getPaletteFromClustering(clustering, 20));
    console.log(await quantize(image, 50));
    console.log(await quantizeWithClustering(image, clustering, 5));
    console.log(await quantizeWithPalette(image, palette));

}; f();

