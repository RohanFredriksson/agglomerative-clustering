import createWasmModule from './clustering.js';
const codes = {'rgba': 0, 'rgb': 1};
const colorSpaces = {'rgb': 0, 'oklab': 1};
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
        return {data: new Uint8Array(image.data.buffer), format: 'rgba', width: image.width};
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

    return {data: image.data instanceof Uint8ClampedArray ? new Uint8Array(image.data.buffer) : image.data, format: image.format, width: image.width};

};

const getWrapper = (image) => {
    if (typeof ImageData !== 'undefined' && image instanceof ImageData) {
        const {width, height} = image;
        return (output) => new ImageData(new Uint8ClampedArray(output.buffer), width, height);
    }
    if (!(image instanceof Uint8Array) && typeof image === 'object' && image && image.data && image.format) {
        const {format, width, height} = image;
        return (output) => {
            const result = {data: output, format};
            if (width !== undefined) {result.width = width;}
            if (height !== undefined) {result.height = height;}
            return result;
        };
    }
    return (output) => output;
};

const check = (k) => {

    if (typeof k !== 'number' || !Number.isInteger(k) || k <= 0) {
        throw new Error("Invalid k: must be a strictly positive integer.")
    }

}

// Validates `options` against the keys a function accepts and fills in defaults:
//   colorSpace: 'rgb' (default) or 'oklab', the space colours are clustered and matched in
//   precision:  bits per channel, 1-8 (default 8, exact); lower values group similar colours before clustering
//   dither:     false (default), true, or a strength in [0, 1]; error diffusion when mapping pixels
//   width:      image width in pixels, needed to dither a Uint8Array or a RawImage without `width`
const parseOptions = (options, allowed, image) => {

    if (options === undefined) {options = {};}
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
        throw new Error("Invalid options: expected an object.");
    }
    for (const key of Object.keys(options)) {
        if (!allowed.includes(key)) {throw new Error(`Invalid option '${key}': expected one of ${allowed.join(', ')}.`);}
    }

    const colorSpace = options.colorSpace === undefined ? 'rgb' : options.colorSpace;
    if (!Object.keys(colorSpaces).includes(colorSpace)) {
        throw new Error("Invalid colorSpace: must be 'rgb' or 'oklab'.");
    }

    const precision = options.precision === undefined ? 8 : options.precision;
    if (typeof precision !== 'number' || !Number.isInteger(precision) || precision < 1 || precision > 8) {
        throw new Error("Invalid precision: must be an integer from 1 to 8.");
    }

    const dither = options.dither === undefined || options.dither === false ? 0 : options.dither === true ? 1 : options.dither;
    if (typeof dither !== 'number' || !Number.isFinite(dither) || dither < 0 || dither > 1) {
        throw new Error("Invalid dither: must be a boolean or a number from 0 to 1.");
    }

    const width = options.width !== undefined ? options.width : image ? image.width : undefined;
    if (dither > 0) {
        const channels = image.format === 'rgb' ? 3 : 4;
        if (typeof width !== 'number' || !Number.isInteger(width) || width <= 0) {
            throw new Error("Invalid width: dithering needs the image width, as `options.width` or the image's `width`.");
        }
        if ((image.data.length / channels) % width !== 0) {
            throw new Error("Invalid width: the image's pixel count is not a multiple of it.");
        }
    }

    return {colorSpace: colorSpaces[colorSpace], precision, dither, width: dither > 0 ? width : 0};

};

const clusterOptions = ['colorSpace', 'precision'];
const quantizeOptions = ['colorSpace', 'precision', 'dither', 'width'];
const mapOptions = ['colorSpace', 'dither', 'width'];

// Copies each buffer into the WASM heap, calls `fn` with their pointers, and returns the unpacked output,
// freeing everything afterwards.
const call = (buffers, fn) => {
    const pointers = [];
    let outputPointer = 0;
    try {
        for (const buffer of buffers) {
            const pointer = Module._malloc(buffer.length);
            if (!pointer) {throw new Error("Failed to allocate WASM memory.");}
            pointers.push(pointer);
            Module.HEAPU8.set(buffer, pointer);
        }
        outputPointer = fn(...pointers);
        return unpack(outputPointer);
    } finally {
        for (const pointer of pointers) {Module._free(pointer);}
        if (outputPointer) {Module._free(outputPointer);}
    }
};

export const getClustering = async (image, options) => {

    await init();
    image = load(image);
    const o = parseOptions(options, clusterOptions, image);

    return call([image.data], (imagePointer) => Module._get_clustering(imagePointer, image.data.length, codes[image.format], o.colorSpace, o.precision));

};

export const getPalette = async (image, k, options) => {

    await init();
    image = load(image);
    check(k);
    const o = parseOptions(options, clusterOptions, image);

    return call([image.data], (imagePointer) => Module._get_palette(imagePointer, image.data.length, codes[image.format], k, o.colorSpace, o.precision));

};

export const getPaletteFromClustering = async (clustering, k) => {

    await init();
    check(k);

    return call([clustering], (clusteringPointer) => Module._get_palette_from_clustering(clusteringPointer, clustering.length, k));

};

export const quantize = async (image, k, options) => {

    await init();
    const wrap = getWrapper(image);
    image = load(image);
    check(k);
    const o = parseOptions(options, quantizeOptions, image);

    return wrap(call([image.data], (imagePointer) => Module._quantize(imagePointer, image.data.length, codes[image.format], k, o.colorSpace, o.precision, o.dither, o.width)));

};

export const quantizeWithClustering = async (image, clustering, k, options) => {

    await init();
    const wrap = getWrapper(image);
    image = load(image);
    check(k);
    const o = parseOptions(options, mapOptions, image);

    return wrap(call([image.data, clustering], (imagePointer, clusteringPointer) => Module._quantize_with_clustering(imagePointer, image.data.length, codes[image.format], clusteringPointer, clustering.length, k, o.colorSpace, o.dither, o.width)));

};

export const quantizeWithPalette = async (image, palette, options) => {

    await init();
    const wrap = getWrapper(image);
    image = load(image);
    const o = parseOptions(options, mapOptions, image);

    return wrap(call([image.data, palette], (imagePointer, palettePointer) => Module._quantize_with_palette(imagePointer, image.data.length, codes[image.format], palettePointer, palette.length, o.colorSpace, o.dither, o.width)));

};
