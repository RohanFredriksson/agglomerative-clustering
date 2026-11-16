import createWasmModule from './clustering.js';
// The library's version: package.json is the source, and scripts/sync-version.mjs keeps this line (and the copy in
// worker.js and the one the .wasm is built from) in step with it. Do not edit it by hand.
export const version = '2.0.0';

const codes = {'rgba': 0, 'rgb': 1};
const colorSpaces = {'rgb': 0, 'oklab': 1};
const alphaModes = {'ignore': 0, 'weight': 1};
let Module = null;

// Every error this library throws is an Error with a `code` saying what went wrong, so callers needn't match on
// message text: 'invalid-argument' (image, k, options, palette), 'invalid-clustering', 'unsupported-version' (a
// clustering from a newer format, or an older one without what was asked for), 'out-of-memory', 'wasm-load-failed'. The worker entry adds
// 'worker-terminated', 'worker-failed' and 'invalid-handle'.
const fail = (code, message) => Object.assign(new Error(message), {code});

// Turns init's `wasm` option into the settings the Emscripten glue understands. The glue finds its .wasm file next to
// itself by default (`new URL('clustering.wasm', import.meta.url)`); this lets a caller say where it is, or hand over
// the bytes or an already compiled module, for CDNs, strict CSPs and runtimes (such as Cloudflare Workers) that
// cannot fetch or compile it that way. `onError` receives instantiation errors, which the glue would otherwise swallow.
const wasmSettings = (wasm, onError) => {
    if (wasm === undefined) {return {};}
    if (typeof wasm === 'string' || wasm instanceof URL) {
        const location = String(wasm);
        return {locateFile: (path, directory) => path.endsWith('.wasm') ? location : directory + path};
    }
    // Bytes and compiled modules go through `instantiateWasm`: this build of the glue reads no `wasmBinary` setting.
    if (wasm instanceof ArrayBuffer || ArrayBuffer.isView(wasm)) {
        const source = wasm instanceof ArrayBuffer ? wasm : new Uint8Array(wasm.buffer, wasm.byteOffset, wasm.byteLength);
        return {instantiateWasm: (imports, receive) => {WebAssembly.instantiate(source, imports).then(({instance}) => receive(instance), onError);}};
    }
    if (typeof WebAssembly !== 'undefined' && wasm instanceof WebAssembly.Module) {
        return {instantiateWasm: (imports, receive) => {WebAssembly.instantiate(wasm, imports).then(receive, onError);}};
    }
    throw fail('invalid-argument', "Invalid wasm: must be a URL or path string, a URL, an ArrayBuffer or typed array of the .wasm bytes, or a WebAssembly.Module.");
};

// A module that cannot be loaded is the commonest first-run failure: a 404, a Content-Security-Policy that blocks it, a
// browser without WebAssembly SIMD. The engine's own error (a CompileError, a failed fetch) says little about which.
const wasmLoadFailed = (cause) => Object.assign(fail('wasm-load-failed', `Could not load the WebAssembly module (${String(cause && cause.message !== undefined ? cause.message : cause).split('\n')[0].slice(0, 140)}). It needs WebAssembly with SIMD (Chrome and Edge 91, Firefox 89, Safari 16.4 or newer). If the file is missing or blocked, check that the .wasm is served and allowed by the page's Content-Security-Policy, or say where it is with init({ wasm }).`), {cause});

// The .wasm and the script that drives it are built together, and the byte layouts and entry points between them are
// not a public interface. One left over from another version (a stale cache, a CDN serving an old file, an `init({ wasm })`
// pointing at the wrong one) would misbehave in ways nothing explains, so the module says which version it is and a
// mismatch is reported when it loads.
const checkWasmVersion = (instance) => {
    let found = 'an unknown version (from before 3.0)';
    if (typeof instance._library_version === 'function') {
        const heap = instance.HEAPU8;
        let end = instance._library_version();
        const start = end;
        while (heap[end] !== 0 && end - start < 64) {end++;}
        found = String.fromCharCode(...heap.subarray(start, end));
    }
    const expected = `agglomerative-clustering@${version}`;
    if (found !== expected) {
        throw fail('wasm-load-failed', `The WebAssembly module is ${found}, but this script is ${expected}: a stale or mixed-up clustering.wasm (a cache or CDN serving another version, or init({ wasm }) pointing at one). Serve the .wasm that came with this version of the package.`);
    }
};

// The module loads once: concurrent calls share one load, and a load that fails is forgotten, so it can be retried.
let loading = null;

// Calls get the instance they run on from `acquire` and keep using it, so replacing the current instance (see `discard`)
// never changes the module under a call already in flight.
const acquire = async (options) => {

    if (options === undefined) {options = {};}
    if (!isOptionsObject(options)) {
        throw fail('invalid-argument', "Invalid options: expected an object.");
    }
    options = snapshot(options);
    for (const key of Object.keys(options)) {
        if (key !== 'wasm') {throw fail('invalid-argument', `Invalid option '${key}': expected wasm.`);}
    }
    // Checked on every call, so a bad value is reported even when the module is already loaded.
    let reject;
    const failed = new Promise((_, r) => {reject = r;});
    failed.catch(() => {});
    const settings = wasmSettings(options.wasm, reject);
    if (Module) {return Module;}

    if (!loading) {
        loading = (async () => {
            const instance = await Promise.race([createWasmModule(settings), failed]).catch((error) => {throw wasmLoadFailed(error);});
            checkWasmVersion(instance);
            Module = instance;
            return instance;
        })().catch((error) => {
            loading = null;
            throw error;
        });
    }
    return loading;

};

// Loads the WebAssembly module. Every other function does this on first use, so calling it is optional, except to
// say where the .wasm file is (`wasm`), which must come before anything else. The first load that succeeds wins:
// later calls, with or without options, get the same module.
export const init = async (options) => {await acquire(options);};

// A WebAssembly abort, which is what running out of memory looks like, leaves the instance's heap full of whatever the
// failed call had allocated and never freed (the abort skips destructors), so every later large call on it would fail
// too. The instance is therefore discarded: the next call loads a fresh one, and calls already running keep theirs.
const isAbort = (error) => error instanceof Error && error.name === 'RuntimeError' && /^Aborted\(/.test(error.message);
const discard = (instance) => {
    if (Module === instance) {Module = null; loading = null;}
};
const outOfMemory = () => fail('out-of-memory', "The WebAssembly module ran out of memory (it can use up to 2 GB for one image). Try `precision: 6`, which bounds the memory an image with very many colours needs, or a smaller image.");

const unpack = (wasm, pointer) => {
    const lengthBuffer = new Uint8Array(wasm.HEAPU8.subarray(pointer, pointer + 4));
    const length = lengthBuffer[0] | (lengthBuffer[1] << 8) | (lengthBuffer[2] << 16) | (lengthBuffer[3] << 24);
    const outputBuffer = new Uint8Array(wasm.HEAPU8.subarray(pointer + 4, pointer + 4 + length));
    return outputBuffer;
};

// A Uint8Array over exactly the same bytes, so views into a larger buffer (subarrays) stay views of their own range.
const bytes = (data) => data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

// ----- Encoded image files -------------------------------------------------------------------------------------------
// A bare Uint8Array is taken to be raw RGBA pixels, so the commonest mistake is handing over the bytes of an image *file*
// (fs.readFile, fetch().arrayBuffer()): it passes as pixels whenever its length is a multiple of 4 and gives a palette of
// nonsense. The signatures of the common formats are recognised so that it is reported instead. Only a bare Uint8Array is
// looked at: an ImageData or a { data, format } object has said what its bytes are, so it is never second-guessed, and a
// bare array that really is raw pixels can be passed as { data, format: 'rgba' } to say so.
//
// This is also where decoding would go. The library doesn't decode files today (that needs a decoder per format, and
// sharp, pngjs, createImageBitmap and the like already do it); when it does, a file recognised here is decoded into
// { data, format, width, height } instead of rejected, and `load` becomes asynchronous. See docs/ROADMAP.md.
const ascii = (bytes, at, text) => {
    for (let i = 0; i < text.length; i++) {if (bytes[at + i] !== text.charCodeAt(i)) {return false;}}
    return true;
};

// The name of the encoded image format `bytes` starts with, or null. Signatures are long enough, or have enough structure
// beyond the first few bytes, that raw pixels all but never match.
const sniffImageFormat = (bytes) => {
    const length = bytes.length;
    if (length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 'PNG') && bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) {return 'PNG';}
    // JPEG: FF D8, then a first segment: a marker that has a length (not a restart or a stuffed byte) and a length that fits
    if (length >= 6 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF && bytes[3] >= 0xC0 && bytes[3] <= 0xFE && !(bytes[3] >= 0xD0 && bytes[3] <= 0xD9)
        && (bytes[4] << 8 | bytes[5]) >= 2 && 4 + (bytes[4] << 8 | bytes[5]) <= length) {return 'JPEG';}
    if (length >= 6 && (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a'))) {return 'GIF';}
    if (length >= 12 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) {return 'WebP';}
    // BMP: 'BM', then the file's own length and two zero reserved fields, and a known header size
    if (length >= 18 && bytes[0] === 0x42 && bytes[1] === 0x4D && bytes[6] === 0 && bytes[7] === 0 && bytes[8] === 0 && bytes[9] === 0
        && (bytes[2] | (bytes[3] << 8) | (bytes[4] << 16) | (bytes[5] << 24)) === length && [12, 40, 52, 56, 64, 108, 124].includes(bytes[14]) && bytes[15] === 0 && bytes[16] === 0 && bytes[17] === 0) {return 'BMP';}
    // TIFF: a byte order mark and 42, then the offset of the first directory, which must lie in the file and start with a plausible entry count
    if (length >= 12) {
        const little = bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2A && bytes[3] === 0;
        const big = bytes[0] === 0x4D && bytes[1] === 0x4D && bytes[2] === 0 && bytes[3] === 0x2A;
        if (little || big) {
            const u16 = (at) => (little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1]);
            const offset = little ? (bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)) >>> 0 : ((bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7]) >>> 0;
            if (offset >= 8 && offset + 2 <= length && u16(offset) >= 1 && u16(offset) <= 4096) {return 'TIFF';}
        }
    }
    // ISO base media: a 'ftyp' box, then a brand
    if (length >= 12 && ascii(bytes, 4, 'ftyp')) {
        if (ascii(bytes, 8, 'avif') || ascii(bytes, 8, 'avis')) {return 'AVIF';}
        if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].some((brand) => ascii(bytes, 8, brand))) {return 'HEIC';}
    }
    return null;
};

const load = (image) => {

    if (image instanceof Uint8Array) {
        const encoded = sniffImageFormat(image);
        if (encoded) {
            throw fail('invalid-argument', `Invalid image: these bytes are an encoded ${encoded} file, not pixels. Decode it first (in a browser, draw it to a canvas or use createImageBitmap, then pass getImageData(); in Node use sharp, pngjs or similar) and pass the raw pixels. If they really are raw RGBA pixels, pass { data, format: 'rgba' } to say so.`);
        }
        if (image.length % 4 !== 0) {throw fail('invalid-argument', "Invalid image data: length must be a multiple of 4 for 'rgba'.");}
        return {data: image, format: 'rgba'};
    }

    if (typeof ImageData !== 'undefined' && image instanceof ImageData) {
        return {data: bytes(image.data), format: 'rgba', width: image.width};
    }

    if (ArrayBuffer.isView(image)) {
        throw fail('invalid-argument', "Invalid image: a bare typed array must be a Uint8Array of RGBA bytes. For a Uint8ClampedArray such as imageData.data, pass the ImageData itself or { data, format: 'rgba' }.");
    }

    if (typeof image !== 'object' || !image || !image.data || !image.format) {
        const hint = image && typeof image === 'object' && image.data && !image.format ? " It has `data` but no `format`: add format: 'rgba' (or 'rgb') to use it as a RawImage." : '';
        throw fail('invalid-argument', `Invalid image: expected object with \`data\` and \`format\`.${hint}`);
    }

    if (!(image.data instanceof Uint8Array) && !(image.data instanceof Uint8ClampedArray)) {
        throw fail('invalid-argument', "Invalid image data: must be Uint8Array or Uint8ClampedArray.");
    }

    if (!Object.keys(codes).includes(image.format)) {
        throw fail('invalid-argument', "Invalid format: must be 'rgb' or 'rgba'.");
    }

    const channels = image.format === 'rgb' ? 3 : 4;
    if (image.data.length % channels !== 0) {
        throw fail('invalid-argument', `Invalid image data: length must be a multiple of ${channels} for '${image.format}'.`);
    }

    // width and height are copied to results and used for dithering, so they must make sense: whole numbers that, when
    // both are given, account for exactly the pixels in the data.
    for (const key of ['width', 'height']) {
        const value = image[key];
        if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
            throw fail('invalid-argument', `Invalid image ${key}: must be a whole number of pixels.`);
        }
    }
    if (image.width !== undefined && image.height !== undefined && image.width * image.height !== image.data.length / channels) {
        throw fail('invalid-argument', `Invalid image: width x height (${image.width} x ${image.height}) does not match its ${image.data.length / channels} pixels.`);
    }

    return {data: bytes(image.data), format: image.format, width: image.width};

};

const getWrapper = (image) => {
    if (typeof ImageData !== 'undefined' && image instanceof ImageData) {
        // The pixels stay in the colour space they came in ('display-p3' canvases), so the result must say so.
        const {width, height, colorSpace} = image;
        return (output) => new ImageData(new Uint8ClampedArray(output.buffer), width, height, colorSpace ? {colorSpace} : undefined);
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
    const transparent = view.getInt32(4, true);
    const indexBytes = view.getUint32(8, true);
    const palette = output.slice(12, 12 + 3 * entries);
    const start = 12 + 3 * entries;
    const count = (output.length - start) / indexBytes;
    const Indices = indexBytes === 1 ? Uint8Array : indexBytes === 2 ? Uint16Array : Uint32Array;
    const indices = new Indices(count);
    // Little-endian, like the WASM heap, which Emscripten's own typed-array views already assume of the host.
    new Uint8Array(indices.buffer).set(output.subarray(start));
    const result = {palette, indices, indexBits: 8 * indexBytes, transparentIndex: transparent < 0 ? null : transparent};
    if (!(image instanceof Uint8Array)) {
        if (image.width !== undefined) {result.width = image.width;}
        if (image.height !== undefined) {result.height = image.height;}
    }
    return result;
};

// Returns k, validated. Any k above the number of colours means all of them, so it is capped at the largest value
// the WASM side holds (a larger one would overflow its int).
const check = (k) => {

    if (typeof k !== 'number' || !Number.isInteger(k) || k <= 0) {
        throw fail('invalid-argument', "Invalid k: must be a strictly positive integer.")
    }
    return Math.min(k, 0x7FFFFFFF);

}

// Validates `options` against the keys a function accepts and fills in defaults:
//   colorSpace: 'rgb' (default) or 'oklab', the space colours are clustered and matched in; when mapping with a
//               clustering, the default is the space the clustering was made in (code -1)
//   alpha:      'weight' (default) counts RGBA pixels in proportion to their opacity; 'ignore' counts every pixel
//   precision:  bits per channel, 1-8 (default 8, exact); lower values group similar colours before clustering
//   dither:     false (default), true, or a strength in [0, 1]; error diffusion when mapping pixels
//   width:      image width in pixels, needed to dither a Uint8Array or a RawImage without `width`
//   signal, onProgress: an AbortSignal and a progress callback, which make the clustering run in slices (see clusterInSlices)
//   transparent: false (default), true (cutoff 128) or a cutoff from 1 to 255: pixels with alpha below it are left out of clustering (and the rest count whole);
//               indexed output also gives them their own entry, which counts towards k
// An options object is an ordinary object. A Map, Date, ArrayBuffer or typed array has no own keys and would pass as
// `{}`, silently ignoring what the caller meant. Checked by tag rather than prototype so objects from another realm
// (an iframe, a test sandbox) are fine.
const isOptionsObject = (value) => value !== null && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]';

// One plain copy of an options object, taken once: every enumerable property, own or inherited (so options layered with
// Object.create(defaults) work and an inherited typo is still caught), each read a single time. Everything after this
// uses the copy, so what is validated is what is used, even if a property is a getter that answers differently each time.
// The copy has no prototype, so a key like '__proto__' is just a name.
const snapshot = (options) => {
    const copy = Object.create(null);
    for (const key in options) {copy[key] = options[key];}
    return copy;
};

const parseOptions = (options, allowed, image) => {

    if (options === undefined) {options = {};}
    if (!isOptionsObject(options)) {
        throw fail('invalid-argument', "Invalid options: expected an object.");
    }
    options = snapshot(options);
    for (const key of Object.keys(options)) {
        if (!allowed.includes(key)) {throw fail('invalid-argument', `Invalid option '${key}': expected one of ${allowed.join(', ')}.`);}
    }

    const colorSpace = options.colorSpace === undefined ? 'rgb' : options.colorSpace;
    if (!Object.keys(colorSpaces).includes(colorSpace)) {
        throw fail('invalid-argument', "Invalid colorSpace: must be 'rgb' or 'oklab'.");
    }

    const alpha = options.alpha === undefined ? 'weight' : options.alpha;
    if (!Object.keys(alphaModes).includes(alpha)) {
        throw fail('invalid-argument', "Invalid alpha: must be 'weight' or 'ignore'.");
    }

    const precision = options.precision === undefined ? 8 : options.precision;
    if (typeof precision !== 'number' || !Number.isInteger(precision) || precision < 1 || precision > 8) {
        throw fail('invalid-argument', "Invalid precision: must be an integer from 1 to 8.");
    }

    const dither = options.dither === undefined || options.dither === false ? 0 : options.dither === true ? 1 : options.dither;
    if (typeof dither !== 'number' || !Number.isFinite(dither) || dither < 0 || dither > 1) {
        throw fail('invalid-argument', "Invalid dither: must be a boolean or a number from 0 to 1.");
    }

    // The image's own width and options.width are two sources for one fact: they may repeat each other, but not disagree
    // (a wrong row length would dither without an error, as long as it divides the pixel count).
    if (options.width !== undefined && image && image.width !== undefined && options.width !== image.width) {
        throw fail('invalid-argument', `Invalid width: options.width (${options.width}) does not match the image's width (${image.width}).`);
    }
    const width = options.width !== undefined ? options.width : image ? image.width : undefined;
    if (dither > 0) {
        const channels = image.format === 'rgb' ? 3 : 4;
        if (typeof width !== 'number' || !Number.isInteger(width) || width <= 0) {
            throw fail('invalid-argument', "Invalid width: dithering needs the image width, as `options.width` or the image's `width`.");
        }
        if ((image.data.length / channels) % width !== 0) {
            throw fail('invalid-argument', "Invalid width: the image's pixel count is not a multiple of it.");
        }
    }

    const signal = options.signal;
    if (signal !== undefined && (signal === null || typeof signal !== 'object' || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function')) {
        throw fail('invalid-argument', "Invalid signal: must be an AbortSignal.");
    }
    const onProgress = options.onProgress;
    if (onProgress !== undefined && typeof onProgress !== 'function') {
        throw fail('invalid-argument', "Invalid onProgress: must be a function.");
    }

    // The alpha cutoff for indexed output: 0 for none, else the pixels with alpha below it are transparent.
    const transparentOption = options.transparent === undefined ? false : options.transparent;
    const transparent = transparentOption === false ? 0 : transparentOption === true ? 128 : transparentOption;
    if (!Number.isInteger(transparent) || transparent < 0 || transparent > 255 || (transparent === 0 && transparentOption !== false)) {
        throw fail('invalid-argument', "Invalid transparent: must be a boolean or an integer alpha cutoff from 1 to 255.");
    }

    return {colorSpace: colorSpaces[colorSpace], colorSpaceGiven: options.colorSpace !== undefined, alpha: alphaModes[alpha], precision, dither, width: dither > 0 ? width : 0, transparent, signal, onProgress};

};

const controlOptions = ['signal', 'onProgress'];
const clusterOptions = ['colorSpace', 'precision', 'alpha', 'transparent', ...controlOptions];
const quantizeOptions = [...clusterOptions, 'dither', 'width'];
const mapOptions = ['colorSpace', 'dither', 'width', ...controlOptions];
const quantizeIndexOptions = quantizeOptions;
const mapIndexOptions = [...mapOptions, 'transparent'];

// Reads a clustering's header, or throws if it isn't a clustering this version can read. Clusterings start with the
// magic byte 0xAC and their version number (2 or 3). Clusterings from 1.x had no header and could only be recognised by
// their length, which many other byte strings share (a palette of the right size passed as a clustering was accepted
// and gave nonsense), so they are no longer read.
//   version 2: [0xAC, 2, colour space, precision], then 9-byte records of colours
//   version 3: [0xAC, 3, header length, record length, colour space, precision, weight unit, weight shift,
//              total weight (u32 LE), 0, grouped error (f32 LE, from header length 17), ...], then records of
//              colours, parent index, lighter weight and cost
const latestVersion = 3;

// The version of stored data (clusterings) this build writes. It reads this one and format 2 (see readHeader). Unlike
// `version`, it changes only when the stored format does, so a 3.x release that keeps the format keeps this number.
export const formatVersion = latestVersion;
const readHeader = (clustering) => {
    if (!(clustering instanceof Uint8Array)) {
        throw fail('invalid-clustering', "Invalid clustering: must be a Uint8Array from getClustering.");
    }
    const length = clustering.length;
    if (length >= 4 && clustering[0] === 0xAC) {
        const version = clustering[1];
        if (version === 2 && clustering[2] <= 1 && (length === 4 || length % 9 === 7)) {
            return {version, colorSpace: clustering[2], precision: clustering[3], headerLength: 4, recordLength: 9, merges: length === 4 ? 0 : (length - 7) / 9};
        }
        if (version === 3 && length >= 13) {
            const headerLength = clustering[2], recordLength = clustering[3];
            if (headerLength >= 13 && recordLength >= 21 && headerLength <= length) {
                // A header field with a fixed set of meanings (colour space, weight unit) that holds a value this version
                // doesn't know is how a later release would add one, so it asks for an upgrade rather than misreading it.
                if (clustering[4] > 1 || clustering[6] > 1) {
                    throw fail('unsupported-version', "Invalid clustering: it uses a colour space or weight unit that this version of agglomerative-clustering does not know. If it came from a newer version, upgrade the package; otherwise it is damaged.");
                }
                const merges = length < headerLength + 3 ? 0 : Math.floor((length - headerLength - 3) / recordLength);
                const padding = length < headerLength + 3 ? length - headerLength : length - headerLength - 3 - merges * recordLength;
                if (padding < 9) {return {version, colorSpace: clustering[4], precision: clustering[5], headerLength, recordLength, merges};}
            }
        }
        if (version > latestVersion) {
            throw fail('unsupported-version', `Invalid clustering: format version ${version} is newer than this version of agglomerative-clustering reads. Upgrade the package.`);
        }
    }
    throw fail('invalid-clustering', "Invalid clustering: not a clustering from getClustering. (Clusterings from agglomerative-clustering 1.x are no longer read: cluster the image again.)");
};

// Palettes are flat RGB bytes. An empty palette is allowed: it is what getPalette gives for a fully transparent
// image, and quantize maps such an image the same way.
const checkPalette = (palette) => {
    if (!(palette instanceof Uint8Array) && !(palette instanceof Uint8ClampedArray) && !Array.isArray(palette)) {
        throw fail('invalid-argument', "Invalid palette: must be a Uint8Array of RGB bytes.");
    }
    if (palette.length % 3 !== 0) {
        throw fail('invalid-argument', "Invalid palette: length must be a multiple of 3 (flat RGB bytes).");
    }
    // Typed arrays are bytes already. A plain array is copied into bytes, which would turn an array of [r, g, b] colours
    // into zeros, strings into numbers and 300 into 44 without a word, so it must hold byte values.
    if (Array.isArray(palette)) {
        for (const value of palette) {
            if (!Number.isInteger(value) || value < 0 || value > 255) {
                throw fail('invalid-argument', "Invalid palette: a plain array must be flat RGB bytes, integers from 0 to 255 (not an array of [r, g, b] colours).");
            }
        }
    }
};

// Copies each buffer into the WASM heap, calls `fn` with their pointers, and returns the unpacked output,
// freeing everything afterwards.
const call = (wasm, buffers, fn) => {
    const pointers = [];
    let outputPointer = 0;
    let aborted = false;
    try {
        for (const buffer of buffers) {
            const pointer = wasm._malloc(buffer.length);
            if (!pointer) {throw fail('out-of-memory', "Failed to allocate WASM memory.");}
            pointers.push(pointer);
            wasm.HEAPU8.set(buffer, pointer);
        }
        outputPointer = fn(...pointers);
        return unpack(wasm, outputPointer);
    } catch (error) {
        if (!isAbort(error)) {throw error;}
        aborted = true;
        discard(wasm);
        throw outOfMemory();
    } finally {
        // After an abort the instance is being thrown away, and its allocator can't be trusted.
        if (!aborted) {
            for (const pointer of pointers) {wasm._free(pointer);}
            if (outputPointer) {wasm._free(outputPointer);}
        }
    }
};

// ----- Interruptible work -------------------------------------------------------------------------------------------
// A call given a `signal` or an `onProgress` runs its clustering in slices of about `sliceMs` milliseconds, giving the
// event loop a turn between them: the signal is checked (and progress reported) each time, other tasks can run, and
// in a worker thread the cancel message is read. Without either the call runs in one go, as it always did. The
// result is the same either way: the slices are the same steps in the same order.

const sliceMs = 10;

// Gives other tasks (a cancel message, timers, painting) a turn.
const yieldNow = () => {
    if (typeof setImmediate === 'function') {return new Promise((resolve) => setImmediate(resolve));}
    if (typeof MessageChannel === 'function') {
        return new Promise((resolve) => {
            const {port1, port2} = new MessageChannel();
            port1.onmessage = () => {port1.close(); port2.close(); resolve();};
            port2.postMessage(null);
        });
    }
    return new Promise((resolve) => setTimeout(resolve, 0));
};

// Like fetch, an aborted call rejects with the signal's reason (an AbortError unless the caller gave another).
const checkAborted = (signal) => {
    if (signal && signal.aborted) {
        throw signal.reason !== undefined ? signal.reason : new DOMException('This operation was aborted', 'AbortError');
    }
};

// Reports progress as a fraction from 0 to 1, never going backwards and only when it changes.
const reporter = (o) => {
    let last = -1;
    return (fraction) => {
        const value = Math.min(1, Math.max(0, fraction));
        if (o.onProgress && value > last) {last = value; o.onProgress(value);}
    };
};

const isControlled = (o) => o.signal !== undefined || o.onProgress !== undefined;

// Clusters in slices and returns the clustering. `share` is the part of the whole call's progress this takes.
const clusterInSlices = async (wasm, image, o, report, share) => {
    checkAborted(o.signal);
    const imagePointer = wasm._malloc(image.data.length);
    if (!imagePointer) {throw fail('out-of-memory', "Failed to allocate WASM memory.");}
    let job = 0;
    let aborted = false;
    try {
        wasm.HEAPU8.set(image.data, imagePointer);
        job = wasm._clustering_job_start(imagePointer, image.data.length, codes[image.format], o.colorSpace, o.precision, o.alpha, o.transparent);
        report(0);
        while (true) {
            const progress = wasm._clustering_job_step(job, sliceMs);
            if (progress >= 1000) {break;}
            report(share * progress / 1000);
            await yieldNow();
            checkAborted(o.signal);
        }
        const pointer = wasm._clustering_job_result(job);
        try {return unpack(wasm, pointer);} finally {wasm._free(pointer);}
    } catch (error) {
        if (!isAbort(error)) {throw error;}
        aborted = true;
        discard(wasm);
        throw outOfMemory();
    } finally {
        if (!aborted) {
            if (job) {wasm._clustering_job_free(job);}
            wasm._free(imagePointer);
        }
    }
};

export const getClustering = async (image, options) => {

    const wasm = await acquire();
    image = load(image);
    const o = parseOptions(options, clusterOptions, image);

    if (isControlled(o)) {
        const report = reporter(o);
        const clustering = await clusterInSlices(wasm, image, o, report, 1);
        report(1);
        return clustering;
    }

    return call(wasm, [image.data], (imagePointer) => wasm._get_clustering(imagePointer, image.data.length, codes[image.format], o.colorSpace, o.precision, o.alpha, o.transparent));

};

export const getPalette = async (image, k, options) => {

    const wasm = await acquire();
    image = load(image);
    k = check(k);
    const o = parseOptions(options, clusterOptions, image);

    if (isControlled(o)) {
        const report = reporter(o);
        const clustering = await clusterInSlices(wasm, image, o, report, 0.99);
        checkAborted(o.signal);
        const palette = call(wasm, [clustering], (clusteringPointer) => wasm._get_palette_from_clustering(clusteringPointer, clustering.length, k));
        report(1);
        return palette;
    }

    return call(wasm, [image.data], (imagePointer) => wasm._get_palette(imagePointer, image.data.length, codes[image.format], k, o.colorSpace, o.precision, o.alpha, o.transparent));

};

export const getPaletteFromClustering = async (clustering, k) => {

    const wasm = await acquire();
    readHeader(clustering);
    k = check(k);

    return call(wasm, [clustering], (clusteringPointer) => wasm._get_palette_from_clustering(clusteringPointer, clustering.length, k));

};

// The weight of each colour in the k-colour cut, in pixels (opacity-weighted), read from the clustering's records.
const weightsOf = (wasm, clustering, header, k) => {
    const bytes = call(wasm, [clustering], (clusteringPointer) => wasm._get_palette_weights(clusteringPointer, clustering.length, k));
    if (header.merges > 0 && bytes.length === 0) {throw fail('invalid-clustering', "Invalid clustering: its weights are inconsistent.");}
    return new Float64Array(bytes.buffer, bytes.byteOffset, bytes.length / 8);
};

// A palette with the weight and share of the image of each of its colours, from one cut of one clustering, so the three
// arrays line up by construction. Weights are pixels: fully transparent pixels count 0 and partly transparent ones in
// proportion to their opacity, as in clustering. Shares are the weights divided by their total, so they sum to 1.
export const getSwatchesFromClustering = async (clustering, k) => {

    const wasm = await acquire();
    const header = readHeader(clustering);
    k = check(k);
    if (header.version < 3) {
        throw fail('unsupported-version', `Invalid clustering: format version ${header.version} (agglomerative-clustering ${header.version}.x) has no weights. Cluster the image again.`);
    }

    const palette = call(wasm, [clustering], (clusteringPointer) => wasm._get_palette_from_clustering(clusteringPointer, clustering.length, k));
    const weights = weightsOf(wasm, clustering, header, k);
    let total = 0;
    for (const weight of weights) {total += weight;}
    const shares = new Float64Array(weights.length);
    if (total > 0) {for (let i = 0; i < weights.length; i++) {shares[i] = weights[i] / total;}}
    return {palette, weights, shares};

};

// The same for an image: clusters it, then cuts, like getPalette.
export const getSwatches = async (image, k, options) => {

    // Arguments are checked in the order they are given (image, then k, then options), as in every other function.
    load(image);
    k = check(k);
    return getSwatchesFromClustering(await getClustering(image, options), k);

};

// What a clustering holds, read from its header and records without the WASM module. `mse[k - 1]` is the mean
// squared error per channel of the k-colour clustering: each pixel's squared distance to its cluster's colour,
// weighted as in clustering, in 8-bit RGB values (RGB) or OKLab units (OKLab).
export const getClusteringInfo = async (clustering) => {

    const header = readHeader(clustering);
    const colors = header.merges + (clustering.length >= header.headerLength + 3 ? 1 : 0);
    const info = {formatVersion: header.version, colorSpace: header.colorSpace === 1 ? 'oklab' : 'rgb', precision: header.precision, maxColors: colors, totalWeight: null, mse: null, explained: null};
    if (header.version < 3) {return info;}

    const view = new DataView(clustering.buffer, clustering.byteOffset, clustering.byteLength);
    const pixels = 2 ** clustering[7] / (clustering[6] === 1 ? 255 : 1);
    const total = view.getUint32(8, true);
    info.totalWeight = total * pixels;
    info.mse = new Float64Array(colors);
    info.explained = new Float64Array(colors);
    // The error of the leaf clusters: what `precision` below 8 discarded by grouping colours (0 before it was recorded).
    let remaining = header.headerLength >= 17 ? view.getFloat32(13, true) : 0;
    if (colors > 0) {info.mse[colors - 1] = remaining / total / 3;}
    for (let i = header.merges - 1; i >= 0; i--) {
        remaining += view.getFloat32(header.headerLength + 3 + i * header.recordLength + 17, true);
        info.mse[i] = remaining / total / 3;
    }
    // The share of the image's variance each palette size keeps; 1 throughout for an image of one colour.
    for (let i = 0; i < colors; i++) {
        info.explained[i] = info.mse[0] > 0 ? Math.max(0, Math.min(1, 1 - info.mse[i] / info.mse[0])) : 1;
    }
    return info;

};

export const quantize = async (image, k, options) => {

    const wasm = await acquire();
    const wrap = getWrapper(image);
    image = load(image);
    k = check(k);
    const o = parseOptions(options, quantizeOptions, image);

    if (isControlled(o)) {
        const report = reporter(o);
        const clustering = await clusterInSlices(wasm, image, o, report, 0.9);
        checkAborted(o.signal);
        const mapped = wrap(call(wasm, [image.data, clustering], (imagePointer, clusteringPointer) => wasm._quantize_with_clustering(imagePointer, image.data.length, codes[image.format], clusteringPointer, clustering.length, k, o.colorSpace, o.dither, o.width)));
        report(1);
        return mapped;
    }

    return wrap(call(wasm, [image.data], (imagePointer) => wasm._quantize(imagePointer, image.data.length, codes[image.format], k, o.colorSpace, o.precision, o.alpha, o.dither, o.width, o.transparent)));

};

export const quantizeFromClustering = async (image, clustering, k, options) => {

    const wasm = await acquire();
    const wrap = getWrapper(image);
    image = load(image);
    readHeader(clustering);
    k = check(k);
    const o = parseOptions(options, mapOptions, image);
    checkAborted(o.signal);
    const colorSpace = o.colorSpaceGiven ? o.colorSpace : -1;

    const result = wrap(call(wasm, [image.data, clustering], (imagePointer, clusteringPointer) => wasm._quantize_with_clustering(imagePointer, image.data.length, codes[image.format], clusteringPointer, clustering.length, k, colorSpace, o.dither, o.width)));
    reporter(o)(1);

    return result;

};

export const quantizeWithPalette = async (image, palette, options) => {

    const wasm = await acquire();
    const wrap = getWrapper(image);
    image = load(image);
    checkPalette(palette);
    const o = parseOptions(options, mapOptions, image);
    checkAborted(o.signal);

    const result = wrap(call(wasm, [image.data, palette], (imagePointer, palettePointer) => wasm._quantize_with_palette(imagePointer, image.data.length, codes[image.format], palettePointer, palette.length, o.colorSpace, o.dither, o.width)));
    reporter(o)(1);

    return result;

};

export const quantizeToIndices = async (image, k, options) => {

    const wasm = await acquire();
    const original = image;
    image = load(image);
    k = check(k);
    const o = parseOptions(options, quantizeIndexOptions, image);

    if (isControlled(o)) {
        const report = reporter(o);
        const clustering = await clusterInSlices(wasm, image, o, report, 0.9);
        checkAborted(o.signal);
        const indexed = unpackIndices(call(wasm, [image.data, clustering], (imagePointer, clusteringPointer) => wasm._quantize_indices_with_clustering(imagePointer, image.data.length, codes[image.format], clusteringPointer, clustering.length, k, o.colorSpace, o.dither, o.width, o.transparent)), original);
        report(1);
        return indexed;
    }

    return unpackIndices(call(wasm, [image.data], (imagePointer) => wasm._quantize_indices(imagePointer, image.data.length, codes[image.format], k, o.colorSpace, o.precision, o.alpha, o.dither, o.width, o.transparent)), original);

};

export const quantizeToIndicesFromClustering = async (image, clustering, k, options) => {

    const wasm = await acquire();
    const original = image;
    image = load(image);
    readHeader(clustering);
    k = check(k);
    const o = parseOptions(options, mapIndexOptions, image);
    checkAborted(o.signal);
    const colorSpace = o.colorSpaceGiven ? o.colorSpace : -1;

    const result = unpackIndices(call(wasm, [image.data, clustering], (imagePointer, clusteringPointer) => wasm._quantize_indices_with_clustering(imagePointer, image.data.length, codes[image.format], clusteringPointer, clustering.length, k, colorSpace, o.dither, o.width, o.transparent)), original);
    reporter(o)(1);

    return result;

};

export const quantizeToIndicesWithPalette = async (image, palette, options) => {

    const wasm = await acquire();
    const original = image;
    image = load(image);
    checkPalette(palette);
    const o = parseOptions(options, mapIndexOptions, image);
    checkAborted(o.signal);

    const result = unpackIndices(call(wasm, [image.data, palette], (imagePointer, palettePointer) => wasm._quantize_indices_with_palette(imagePointer, image.data.length, codes[image.format], palettePointer, palette.length, o.colorSpace, o.dither, o.width, o.transparent)), original);
    reporter(o)(1);

    return result;

};
