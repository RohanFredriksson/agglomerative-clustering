import createWasmModule from './clustering.js';
const codes = {'rgba': 0, 'rgb': 1};
const colorSpaces = {'rgb': 0, 'oklab': 1};
const alphaModes = {'ignore': 0, 'weight': 1};
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

// A Uint8Array over exactly the same bytes, so views into a larger buffer (subarrays) stay views of their own range.
const bytes = (data) => data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

const load = (image) => {

    if (image instanceof Uint8Array) {
        if (image.length % 4 !== 0) {throw new Error("Invalid image data: length must be a multiple of 4 for 'rgba'.");}
        return {data: image, format: 'rgba'};
    }

    if (typeof ImageData !== 'undefined' && image instanceof ImageData) {
        return {data: bytes(image.data), format: 'rgba', width: image.width};
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

    const channels = image.format === 'rgb' ? 3 : 4;
    if (image.data.length % channels !== 0) {
        throw new Error(`Invalid image data: length must be a multiple of ${channels} for '${image.format}'.`);
    }

    return {data: bytes(image.data), format: image.format, width: image.width};

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

// Decodes _quantize_indices output: [entries, transparent index, index bytes] as 32-bit little-endian values, then
// the palette, then the indices. `image` is the caller's original input, for its width and height.
const unpackIndices = (output, image) => {
    const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
    const entries = view.getUint32(0, true);
    const transparentIndex = view.getInt32(4, true);
    const indexBytes = view.getUint32(8, true);
    const palette = output.slice(12, 12 + 3 * entries);
    const start = 12 + 3 * entries;
    const count = (output.length - start) / indexBytes;
    const Indices = indexBytes === 1 ? Uint8Array : indexBytes === 2 ? Uint16Array : Uint32Array;
    const indices = new Indices(count);
    // Little-endian, like the WASM heap, which Emscripten's own typed-array views already assume of the host.
    new Uint8Array(indices.buffer).set(output.subarray(start));
    const result = {palette, indices, transparentIndex};
    if (!(image instanceof Uint8Array)) {
        if (image.width !== undefined) {result.width = image.width;}
        if (image.height !== undefined) {result.height = image.height;}
    }
    return result;
};

const check = (k) => {

    if (typeof k !== 'number' || !Number.isInteger(k) || k <= 0) {
        throw new Error("Invalid k: must be a strictly positive integer.")
    }

}

// Validates `options` against the keys a function accepts and fills in defaults:
//   colorSpace: 'rgb' (default) or 'oklab', the space colours are clustered and matched in; when mapping with a
//               clustering, the default is the space the clustering was made in (code -1)
//   alpha:      'weight' (default) counts RGBA pixels in proportion to their opacity; 'ignore' counts every pixel
//   precision:  bits per channel, 1-8 (default 8, exact); lower values group similar colours before clustering
//   dither:     false (default), true, or a strength in [0, 1]; error diffusion when mapping pixels
//   width:      image width in pixels, needed to dither a Uint8Array or a RawImage without `width`
//   transparentIndex: false (default) or true; for indexed output, gives fully transparent pixels their own entry
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

    const alpha = options.alpha === undefined ? 'weight' : options.alpha;
    if (!Object.keys(alphaModes).includes(alpha)) {
        throw new Error("Invalid alpha: must be 'weight' or 'ignore'.");
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

    const transparentIndex = options.transparentIndex === undefined ? false : options.transparentIndex;
    if (typeof transparentIndex !== 'boolean') {
        throw new Error("Invalid transparentIndex: must be a boolean.");
    }

    return {colorSpace: colorSpaces[colorSpace], colorSpaceGiven: options.colorSpace !== undefined, alpha: alphaModes[alpha], precision, dither, width: dither > 0 ? width : 0, transparentIndex};

};

const clusterOptions = ['colorSpace', 'precision', 'alpha'];
const quantizeOptions = ['colorSpace', 'precision', 'alpha', 'dither', 'width'];
const mapOptions = ['colorSpace', 'dither', 'width'];
const quantizeIndexOptions = [...quantizeOptions, 'transparentIndex'];
const mapIndexOptions = [...mapOptions, 'transparentIndex'];

// Reads a clustering's header, or throws if it isn't a clustering this version can read. Version 1 (1.x) has no
// header and is told apart by its length, 0 or 3 more than a multiple of 9, which no later version has (they pad
// to 4 or 7 more). Later versions start with the magic byte 0xAC and their version number.
//   version 2: [0xAC, 2, colour space, precision], then 9-byte records of colours
//   version 3: [0xAC, 3, header length, record length, colour space, precision, weight unit, weight shift,
//              total weight (u32 LE), ...], then records of colours, parent index, lighter weight and cost
const latestVersion = 3;
const readHeader = (clustering) => {
    if (!(clustering instanceof Uint8Array)) {
        throw new Error("Invalid clustering: must be a Uint8Array from getClustering.");
    }
    const length = clustering.length;
    if (length % 9 === 0 || length % 9 === 3) {
        return {version: 1, colorSpace: 0, precision: null, headerLength: 0, recordLength: 9, merges: length === 0 ? 0 : (length - 3) / 9};
    }
    if (length >= 4 && clustering[0] === 0xAC) {
        const version = clustering[1];
        if (version === 2 && clustering[2] <= 1 && (length === 4 || length % 9 === 7)) {
            return {version, colorSpace: clustering[2], precision: clustering[3], headerLength: 4, recordLength: 9, merges: length === 4 ? 0 : (length - 7) / 9};
        }
        if (version === 3 && length >= 13) {
            const headerLength = clustering[2], recordLength = clustering[3];
            if (headerLength >= 13 && recordLength >= 21 && headerLength <= length && clustering[4] <= 1) {
                const merges = length < headerLength + 3 ? 0 : Math.floor((length - headerLength - 3) / recordLength);
                const padding = length < headerLength + 3 ? length - headerLength : length - headerLength - 3 - merges * recordLength;
                if (padding < 9) {return {version, colorSpace: clustering[4], precision: clustering[5], headerLength, recordLength, merges};}
            }
        }
        if (version > latestVersion) {
            throw new Error(`Invalid clustering: format version ${version} is newer than this version of agglomerative-clustering reads. Upgrade the package.`);
        }
    }
    throw new Error("Invalid clustering: not a clustering from getClustering.");
};

// Palettes are flat RGB bytes. An empty palette is allowed: it is what getPalette gives for a fully transparent
// image, and quantize maps such an image the same way.
const checkPalette = (palette) => {
    if (!(palette instanceof Uint8Array) && !(palette instanceof Uint8ClampedArray) && !Array.isArray(palette)) {
        throw new Error("Invalid palette: must be a Uint8Array of RGB bytes.");
    }
    if (palette.length % 3 !== 0) {
        throw new Error("Invalid palette: length must be a multiple of 3 (flat RGB bytes).");
    }
};

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

    return call([image.data], (imagePointer) => Module._get_clustering(imagePointer, image.data.length, codes[image.format], o.colorSpace, o.precision, o.alpha));

};

export const getPalette = async (image, k, options) => {

    await init();
    image = load(image);
    check(k);
    const o = parseOptions(options, clusterOptions, image);

    return call([image.data], (imagePointer) => Module._get_palette(imagePointer, image.data.length, codes[image.format], k, o.colorSpace, o.precision, o.alpha));

};

export const getPaletteFromClustering = async (clustering, k) => {

    await init();
    readHeader(clustering);
    check(k);

    return call([clustering], (clusteringPointer) => Module._get_palette_from_clustering(clusteringPointer, clustering.length, k));

};

// The weight of each colour in getPaletteFromClustering(clustering, k), in pixels: fully transparent pixels count
// 0 and partly transparent ones in proportion to their opacity, as they did in clustering.
export const getPaletteWeights = async (clustering, k) => {

    await init();
    const header = readHeader(clustering);
    check(k);
    if (header.version < 3) {
        throw new Error(`Invalid clustering: format version ${header.version} (agglomerative-clustering ${header.version}.x) has no weights. Cluster the image again.`);
    }

    const bytes = call([clustering], (clusteringPointer) => Module._get_palette_weights(clusteringPointer, clustering.length, k));
    if (header.merges > 0 && bytes.length === 0) {throw new Error("Invalid clustering: its weights are inconsistent.");}
    return new Float64Array(bytes.buffer, bytes.byteOffset, bytes.length / 8);

};

// What a clustering holds, read from its header and records without the WASM module. `errors[k - 1]` is the mean
// squared error per channel of the k-colour clustering: each pixel's squared distance to its cluster's colour,
// weighted as in clustering, in 8-bit RGB values (RGB) or OKLab units (OKLab).
export const getClusteringInfo = async (clustering) => {

    const header = readHeader(clustering);
    const colors = header.merges + (clustering.length >= header.headerLength + 3 ? 1 : 0);
    const info = {version: header.version, colorSpace: header.colorSpace === 1 ? 'oklab' : 'rgb', precision: header.precision, colors, totalWeight: null, errors: null};
    if (header.version < 3) {return info;}

    const view = new DataView(clustering.buffer, clustering.byteOffset, clustering.byteLength);
    const pixels = 2 ** clustering[7] / (clustering[6] === 1 ? 255 : 1);
    const total = view.getUint32(8, true);
    info.totalWeight = total * pixels;
    info.errors = new Float64Array(colors);
    let remaining = 0;
    for (let i = header.merges - 1; i >= 0; i--) {
        remaining += view.getFloat32(header.headerLength + 3 + i * header.recordLength + 17, true);
        info.errors[i] = remaining / total / 3;
    }
    return info;

};

export const quantize = async (image, k, options) => {

    await init();
    const wrap = getWrapper(image);
    image = load(image);
    check(k);
    const o = parseOptions(options, quantizeOptions, image);

    return wrap(call([image.data], (imagePointer) => Module._quantize(imagePointer, image.data.length, codes[image.format], k, o.colorSpace, o.precision, o.alpha, o.dither, o.width)));

};

export const quantizeWithClustering = async (image, clustering, k, options) => {

    await init();
    const wrap = getWrapper(image);
    image = load(image);
    readHeader(clustering);
    check(k);
    const o = parseOptions(options, mapOptions, image);
    const colorSpace = o.colorSpaceGiven ? o.colorSpace : -1;

    return wrap(call([image.data, clustering], (imagePointer, clusteringPointer) => Module._quantize_with_clustering(imagePointer, image.data.length, codes[image.format], clusteringPointer, clustering.length, k, colorSpace, o.dither, o.width)));

};

export const quantizeWithPalette = async (image, palette, options) => {

    await init();
    const wrap = getWrapper(image);
    image = load(image);
    checkPalette(palette);
    const o = parseOptions(options, mapOptions, image);

    return wrap(call([image.data, palette], (imagePointer, palettePointer) => Module._quantize_with_palette(imagePointer, image.data.length, codes[image.format], palettePointer, palette.length, o.colorSpace, o.dither, o.width)));

};

export const quantizeToIndices = async (image, k, options) => {

    await init();
    const original = image;
    image = load(image);
    check(k);
    const o = parseOptions(options, quantizeIndexOptions, image);

    return unpackIndices(call([image.data], (imagePointer) => Module._quantize_indices(imagePointer, image.data.length, codes[image.format], k, o.colorSpace, o.precision, o.alpha, o.dither, o.width, o.transparentIndex ? 1 : 0)), original);

};

export const quantizeToIndicesWithClustering = async (image, clustering, k, options) => {

    await init();
    const original = image;
    image = load(image);
    readHeader(clustering);
    check(k);
    const o = parseOptions(options, mapIndexOptions, image);
    const colorSpace = o.colorSpaceGiven ? o.colorSpace : -1;

    return unpackIndices(call([image.data, clustering], (imagePointer, clusteringPointer) => Module._quantize_indices_with_clustering(imagePointer, image.data.length, codes[image.format], clusteringPointer, clustering.length, k, colorSpace, o.dither, o.width, o.transparentIndex ? 1 : 0)), original);

};

export const quantizeToIndicesWithPalette = async (image, palette, options) => {

    await init();
    const original = image;
    image = load(image);
    checkPalette(palette);
    const o = parseOptions(options, mapIndexOptions, image);

    return unpackIndices(call([image.data, palette], (imagePointer, palettePointer) => Module._quantize_indices_with_palette(imagePointer, image.data.length, codes[image.format], palettePointer, palette.length, o.colorSpace, o.dither, o.width, o.transparentIndex ? 1 : 0)), original);

};
