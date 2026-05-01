import createWasmModule from './clustering.js';
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

    if (typeof ImageData !== 'undefined' && image instanceof ImageData) {
        return {data: new Uint8Array(image.data.buffer), format: 'rgba'};
    }

    if (typeof image !== 'object' || !image || !image.data || !image.format) {
        throw new Error("Invalid image: expected object with `data` and `format`.");
    }

    if (!(image.data instanceof Uint8Array) && !(image.data instanceof Uint8ClampedArray)) {
        throw new Error("Invalid image data: must be Uint8Array or Uint8ClampedArray.");
    }

    if (!Object.keys(codes).includes(image.format)) {
        throw new Error("Invalid format: must be 'rgb' or 'rgba'.");
    }

    return {data: image.data instanceof Uint8ClampedArray ? new Uint8Array(image.data.buffer) : image.data, format: image.format};

};

const getWrapper = (image) => {
    if (typeof ImageData !== 'undefined' && image instanceof ImageData) {
        const {width, height} = image;
        return (output) => new ImageData(new Uint8ClampedArray(output.buffer), width, height);
    }
    if (!(image instanceof Uint8Array) && typeof image === 'object' && image && image.data && image.format) {
        const {format} = image;
        return (output) => ({data: output, format});
    }
    return (output) => output;
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
    if (!imagePointer) throw new Error("Failed to allocate WASM memory.");
    let outputPointer = 0;
    try {
        Module.HEAPU8.set(image.data, imagePointer);
        outputPointer = Module._get_clustering(imagePointer, image.data.length, codes[image.format]);
        return unpack(outputPointer);
    } finally {
        Module._free(imagePointer);
        if (outputPointer) Module._free(outputPointer);
    }

};

export const getPalette = async (image, k) => {

    await init();
    image = load(image);
    check(k);

    const imagePointer = Module._malloc(image.data.length);
    if (!imagePointer) throw new Error("Failed to allocate WASM memory.");
    let outputPointer = 0;
    try {
        Module.HEAPU8.set(image.data, imagePointer);
        outputPointer = Module._get_palette(imagePointer, image.data.length, codes[image.format], k);
        return unpack(outputPointer);
    } finally {
        Module._free(imagePointer);
        if (outputPointer) Module._free(outputPointer);
    }

};

export const getPaletteFromClustering = async (clustering, k) => {

    await init();
    check(k);

    const clusteringPointer = Module._malloc(clustering.length);
    if (!clusteringPointer) throw new Error("Failed to allocate WASM memory.");
    let outputPointer = 0;
    try {
        Module.HEAPU8.set(clustering, clusteringPointer);
        outputPointer = Module._get_palette_from_clustering(clusteringPointer, clustering.length, k);
        return unpack(outputPointer);
    } finally {
        Module._free(clusteringPointer);
        if (outputPointer) Module._free(outputPointer);
    }

};

export const quantize = async (image, k) => {

    await init();
    const wrap = getWrapper(image);
    image = load(image);
    check(k);

    const imagePointer = Module._malloc(image.data.length);
    if (!imagePointer) throw new Error("Failed to allocate WASM memory.");
    let outputPointer = 0;
    try {
        Module.HEAPU8.set(image.data, imagePointer);
        outputPointer = Module._quantize(imagePointer, image.data.length, codes[image.format], k);
        return wrap(unpack(outputPointer));
    } finally {
        Module._free(imagePointer);
        if (outputPointer) Module._free(outputPointer);
    }

};

export const quantizeWithClustering = async (image, clustering, k) => {

    await init();
    const wrap = getWrapper(image);
    image = load(image);
    check(k);

    const imagePointer = Module._malloc(image.data.length);
    if (!imagePointer) throw new Error("Failed to allocate WASM memory.");
    const clusteringPointer = Module._malloc(clustering.length);
    if (!clusteringPointer) { Module._free(imagePointer); throw new Error("Failed to allocate WASM memory."); }
    let outputPointer = 0;
    try {
        Module.HEAPU8.set(image.data, imagePointer);
        Module.HEAPU8.set(clustering, clusteringPointer);
        outputPointer = Module._quantize_with_clustering(imagePointer, image.data.length, codes[image.format], clusteringPointer, clustering.length, k);
        return wrap(unpack(outputPointer));
    } finally {
        Module._free(imagePointer);
        Module._free(clusteringPointer);
        if (outputPointer) Module._free(outputPointer);
    }

};

export const quantizeWithPalette = async (image, palette) => {

    await init();
    const wrap = getWrapper(image);
    image = load(image);

    const imagePointer = Module._malloc(image.data.length);
    if (!imagePointer) throw new Error("Failed to allocate WASM memory.");
    const palettePointer = Module._malloc(palette.length);
    if (!palettePointer) { Module._free(imagePointer); throw new Error("Failed to allocate WASM memory."); }
    let outputPointer = 0;
    try {
        Module.HEAPU8.set(image.data, imagePointer);
        Module.HEAPU8.set(palette, palettePointer);
        outputPointer = Module._quantize_with_palette(imagePointer, image.data.length, codes[image.format], palettePointer, palette.length);
        return wrap(unpack(outputPointer));
    } finally {
        Module._free(imagePointer);
        Module._free(palettePointer);
        if (outputPointer) Module._free(outputPointer);
    }

};