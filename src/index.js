import createWasmModule from '../dist/clustering.js';
const codes = {'rgba': 0, 'rgb': 1};
let Module = null;

export const init = async () => {
    if (!Module) {Module = await createWasmModule();}
};

const unpack = (pointer) => {
    const lengthBuffer = new Uint8Array(Module.HEAPU8.subarray(pointer, pointer + 4));
    const length = lengthBuffer[0] | (lengthBuffer[1] << 8) | (lengthBuffer[2] << 16) | (lengthBuffer[3] << 24);
    const outputBuffer = new Uint8Array(Module.HEAPU8.subarray(pointer + 4, pointer + 4 + length));
    return outputBuffer;
};

const load = (image) => {

    if (image instanceof Uint8Array) {
        return {data: image, format: 'rgba'};
    }

    if (typeof image !== 'object' || !image || !image.data || !image.format) {
        throw new Error("Invalid image: expected object with `data` and `format`.");
    }

    if (!(image.data instanceof Uint8Array)) {
        throw new Error("Invalid image data: must be Uint8Array.");
    }

    if (!Object.keys(codes).includes(image.format)) {
        throw new Error("Invalid format: must be 'rgb' or 'rgba'.");
    }

    return image

};

const check = (k) => {

    if (typeof k !== 'number' || !Number.isInteger(k) || k <= 0) {
        throw new Error("Invalid k: must be a strictly positive integer.")
    }

}

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
    check(k);

    const imagePointer = Module._malloc(image.data.length);
    Module.HEAPU8.set(image.data, imagePointer);

    const outputPointer = Module._get_palette(imagePointer, image.data.length, codes[image.format], k);
    const output = unpack(outputPointer);

    Module._free(imagePointer);
    Module._free(outputPointer);

    return output;

};

export const getPaletteFromClustering = async (clustering, k) => {

    await init();
    check(k);

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
    check(k);
    
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
    check(k);

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