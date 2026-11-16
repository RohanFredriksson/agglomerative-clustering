// Shared by both entries (index.js and worker.js) and the worker thread: errors, option snapshots, reading a clustering's
// header, the Palette and Clustering types, and the markers that carry those types across the worker boundary. Imported as
// './shared.js'; the build rewrites that to './shared.mjs' or './shared.cjs' (scripts/babel-import-extensions.cjs).

// The library's version: package.json is the source, and scripts/sync-version.mjs keeps this line (and the copy the .wasm
// is built from, src/version.hpp) in step with it. Do not edit it by hand.
export const version = '2.0.0';

export const colorSpaces = {'rgb': 0, 'oklab': 1};
export const colorSpaceName = (code) => code === 1 ? 'oklab' : 'rgb';

// Every error this library throws is an Error with a `code` saying what went wrong, so callers needn't match on message
// text: 'invalid-argument' (image, k, options, palette), 'invalid-clustering', 'unsupported-version' (a clustering from a
// newer format, or an older one without what was asked for), 'out-of-memory', 'wasm-load-failed', and in the worker entry
// 'worker-terminated', 'worker-failed' and 'invalid-handle'. When the error is about one argument, `argument` names it
// for programs (the message is for people): 'image', 'k', 'clustering', 'palette', 'options', or 'options.<key>' for
// one option.
export const fail = (code, message, argument) => Object.assign(new Error(message), argument === undefined ? {code} : {code, argument});

// Type checks by tag rather than `instanceof`, so values from another realm (an iframe, a vm context, a test sandbox,
// whose Uint8Array is a different constructor) are recognised. A Node Buffer is a Uint8Array by tag too.
const tag = (value) => Object.prototype.toString.call(value);
export const isUint8Array = (value) => ArrayBuffer.isView(value) && tag(value) === '[object Uint8Array]';
export const isUint8ClampedArray = (value) => ArrayBuffer.isView(value) && tag(value) === '[object Uint8ClampedArray]';
export const isArrayBufferLike = (value) => tag(value) === '[object ArrayBuffer]' || tag(value) === '[object SharedArrayBuffer]';

// An options object is an ordinary object. A Map, Date, ArrayBuffer or typed array has no own keys and would pass as
// `{}`, silently ignoring what the caller meant. Checked by tag rather than prototype so objects from another realm
// (an iframe, a test sandbox) are fine.
export const isOptionsObject = (value) => value !== null && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]';

// One plain copy of an options object, taken once: every enumerable property, own or inherited (so options layered with
// Object.create(defaults) work and an inherited typo is still caught), each read a single time. Everything after this
// uses the copy, so what is validated is what is used, even if a property is a getter that answers differently each time.
// The copy has no prototype, so a key like '__proto__' is just a name.
export const snapshot = (options) => {
    const copy = Object.create(null);
    for (const key in options) {copy[key] = options[key];}
    return copy;
};

// ----- Palette and Clustering ----------------------------------------------------------------------------------------
// Palettes and clusterings are byte arrays, and nothing about a Uint8Array says which one it is, or (for a palette) which
// colour space its colours were made in. So the ones this library returns are ordinary Uint8Arrays carrying two hidden,
// non-enumerable tags: what they are (a symbol property) and, for a palette, `colorSpace`. Being plain Uint8Arrays is the
// point: everything that takes bytes takes them (indexing, `subarray`, files, encoders), `constructor` is Uint8Array, so
// `toEqual(new Uint8Array(...))` in a test still passes, and `slice`, `subarray` and structured clones (postMessage,
// IndexedDB) give plain untagged Uint8Arrays. `Palette` and `Clustering` are how to make one by hand, and `instanceof`
// recognises them. The tags are found by a symbol registered with Symbol.for, so a copy of the library loaded twice (the
// ES module and CommonJS builds, a bundler's duplicate, the worker entry's own copy) recognises the other's.
const paletteBrand = Symbol.for('agglomerative-clustering.palette');
const clusteringBrand = Symbol.for('agglomerative-clustering.clustering');
export const isPalette = (value) => isUint8Array(value) && value[paletteBrand] === true;
export const isClustering = (value) => isUint8Array(value) && value[clusteringBrand] === true;
// Node's console.log and util.inspect call this (other environments ignore it), so the tag shows when debugging:
// `Palette(oklab) [ 12, 34, ... ]` rather than a plain `Uint8Array(…)`.
const inspect = Symbol.for('nodejs.util.inspect.custom');
const view = (label) => function (depth, options, nodeInspect) {
    const plain = new Uint8Array(this.buffer, this.byteOffset, this.length);
    return `${label(this)} ${typeof nodeInspect === 'function' ? nodeInspect(plain, options) : `[${plain.length} bytes]`}`;
};
const paletteView = view((palette) => `Palette(${palette.colorSpace})`);
const clusteringView = view(() => 'Clustering');
export const markPalette = (bytes, colorSpace) => {
    Object.defineProperty(bytes, paletteBrand, {value: true});
    Object.defineProperty(bytes, 'colorSpace', {value: colorSpace});
    Object.defineProperty(bytes, inspect, {value: paletteView});
    return bytes;
};
export const markClustering = (bytes) => {
    Object.defineProperty(bytes, clusteringBrand, {value: true});
    Object.defineProperty(bytes, inspect, {value: clusteringView});
    return bytes;
};

// Flat RGB bytes with the colour space they were made in, so mapping with one matches the way it was made. `new Palette(bytes,
// 'oklab')` copies `bytes` (or makes `length` zeros, or takes an array of byte values) and returns a Uint8Array tagged so.
// A function and not a `class`, because it returns a plain Uint8Array and answers `instanceof` itself, which transpiled class
// checks would trip over.
export function Palette(source, colorSpace = 'rgb') {
    if (!Object.keys(colorSpaces).includes(colorSpace)) {throw fail('invalid-argument', "Invalid colorSpace: must be 'rgb' or 'oklab'.", 'colorSpace');}
    if (source === undefined) {source = 0;}
    // The same rules as for a palette passed to a function, so a Palette can't hold what they would reject: a number coerced to a
    // byte (300 would become 44), a string turned into 0, or a length that isn't whole colours.
    if (typeof source === 'number') {
        if (!Number.isInteger(source) || source < 0 || source % 3 !== 0) {throw fail('invalid-argument', "Invalid palette: a length must be a whole number of bytes, a multiple of 3 (flat RGB bytes).", 'palette');}
    } else {
        checkPalette(source);
    }
    return markPalette(new Uint8Array(source), colorSpace);
}
Object.defineProperty(Palette, Symbol.hasInstance, {value: isPalette});

// The bytes of a clustering, checked: `new Clustering(bytes)` is how stored clusterings get their type back. Arguments are
// those of a Uint8Array (bytes to copy, or a buffer with an offset and length to view).
export function Clustering(...args) {
    const [source] = args;
    // Bytes, or a buffer to view: never a number (a length would allocate and make an empty clustering) or anything a Uint8Array
    // would coerce. A plain array must hold byte values, as for a palette.
    const isBuffer = isArrayBufferLike(source);
    if (!isUint8Array(source) && !isUint8ClampedArray(source) && !isBuffer && !Array.isArray(source)) {
        throw fail('invalid-clustering', "Invalid clustering: expected its bytes (a Uint8Array, or an ArrayBuffer with an optional offset and length) from getClustering.", 'clustering');
    }
    if (Array.isArray(source) && !source.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
        throw fail('invalid-clustering', "Invalid clustering: a plain array must hold byte values, integers from 0 to 255.", 'clustering');
    }
    let bytes;
    try {bytes = new Uint8Array(...args);} catch (error) {throw fail('invalid-clustering', `Invalid clustering: ${error.message}.`, 'clustering');}
    readHeader(bytes);
    return markClustering(bytes);
}
Object.defineProperty(Clustering, Symbol.hasInstance, {value: isClustering});

// Reads a clustering's header, or throws if it isn't a clustering this version can read. Clusterings start with the
// magic byte 0xAC and their version number (2 or 3). Clusterings from 1.x had no header and could only be recognised by
// their length, which many other byte strings share (a palette of the right size passed as a clustering was accepted
// and gave nonsense), so they are no longer read.
//   version 2: [0xAC, 2, colour space, precision], then 9-byte records of colours
//   version 3: [0xAC, 3, header length, record length, colour space, precision, weight unit, weight shift,
//              total weight (u32 LE), 0, grouped error (f32 LE, from header length 17), ...], then records of
//              colours, parent index, lighter weight and cost
export const latestVersion = 3;

// The version of stored data (clusterings) this build writes. It reads this one and format 2 (see readHeader). Unlike
// `version`, it changes only when the stored format does, so a 3.x release that keeps the format keeps this number.
export const formatVersion = latestVersion;
export const readHeader = (clustering) => {
    if (isPalette(clustering)) {
        throw fail('invalid-clustering', "Invalid clustering: this is a palette, not a clustering. Palettes come from getPalette and getPaletteFromClustering; a clustering comes from getClustering.", 'clustering');
    }
    if (!isUint8Array(clustering)) {
        throw fail('invalid-clustering', "Invalid clustering: must be a Uint8Array from getClustering.", 'clustering');
    }
    const length = clustering.length;
    if (length >= 4 && clustering[0] === 0xAC) {
        const version = clustering[1];
        if (version === 2 && clustering[2] <= 1 && (length === 4 || length % 9 === 7)) {
            return {version, colorSpace: clustering[2], precision: clustering[3], transparent: 0, headerLength: 4, recordLength: 9, merges: length === 4 ? 0 : (length - 7) / 9};
        }
        if (version === 3 && length >= 13) {
            const headerLength = clustering[2], recordLength = clustering[3];
            if (headerLength >= 13 && recordLength >= 21 && headerLength <= length) {
                // A header field with a fixed set of meanings (colour space, weight unit) that holds a value this version
                // doesn't know is how a later release would add one, so it asks for an upgrade rather than misreading it.
                if (clustering[4] > 1 || clustering[6] > 1) {
                    throw fail('unsupported-version', "Invalid clustering: it uses a colour space or weight unit that this version of agglomerative-clustering does not know. If it came from a newer version, upgrade the package; otherwise it is damaged.", 'clustering');
                }
                const merges = length < headerLength + 3 ? 0 : Math.floor((length - headerLength - 3) / recordLength);
                const padding = length < headerLength + 3 ? length - headerLength : length - headerLength - 3 - merges * recordLength;
                if (padding < 9) {return {version, colorSpace: clustering[4], precision: clustering[5], transparent: clustering[12], headerLength, recordLength, merges};}
            }
        }
        if (version > latestVersion) {
            throw fail('unsupported-version', `Invalid clustering: format version ${version} is newer than this version of agglomerative-clustering reads. Upgrade the package.`, 'clustering');
        }
    }
    throw fail('invalid-clustering', "Invalid clustering: not a clustering from getClustering. (Clusterings from agglomerative-clustering 1.x are no longer read: cluster the image again.)", 'clustering');
};

// Palettes are flat RGB bytes. An empty palette is allowed: it is what getPalette gives for a fully transparent
// image, and quantize maps such an image the same way.
export const checkPalette = (palette) => {
    if (isClustering(palette)) {
        throw fail('invalid-argument', "Invalid palette: this is a clustering (from getClustering), not a palette. Cut a palette from it with getPaletteFromClustering, or map with quantizeFromClustering.", 'palette');
    }
    if (!isUint8Array(palette) && !isUint8ClampedArray(palette) && !Array.isArray(palette)) {
        throw fail('invalid-argument', "Invalid palette: must be a Uint8Array of RGB bytes.", 'palette');
    }
    if (palette.length % 3 !== 0) {
        throw fail('invalid-argument', "Invalid palette: length must be a multiple of 3 (flat RGB bytes).", 'palette');
    }
    // Typed arrays are bytes already. A plain array is copied into bytes, which would turn an array of [r, g, b] colours
    // into zeros, strings into numbers and 300 into 44 without a word, so it must hold byte values.
    if (Array.isArray(palette)) {
        for (const value of palette) {
            if (!Number.isInteger(value) || value < 0 || value > 255) {
                throw fail('invalid-argument', "Invalid palette: a plain array must be flat RGB bytes, integers from 0 to 255 (not an array of [r, g, b] colours).", 'palette');
            }
        }
    }
};

// ----- Across the worker boundary ------------------------------------------------------------------------------------
// A structured clone drops the tags (a palette's colour space with them), so palettes and clusterings cross to and from the
// worker thread as small markers and become typed arrays again on the other side: `mark` before posting (an argument, a
// result, or a property of a result), `revive` after receiving.
export const MARK = '__agglomerativeClustering';
const markOne = (value) => {
    if (isPalette(value)) {return {[MARK]: 'palette', bytes: new Uint8Array(value.buffer, value.byteOffset, value.length), colorSpace: value.colorSpace};}
    if (isClustering(value)) {return {[MARK]: 'clustering', bytes: new Uint8Array(value.buffer, value.byteOffset, value.length)};}
    return value;
};
export const mark = (value) => {
    if (!value || typeof value !== 'object' || ArrayBuffer.isView(value)) {return markOne(value);}
    if (!isOptionsObject(value)) {return value;}
    return Object.fromEntries(Object.entries(value).map(([key, part]) => [key, markOne(part)]));
};
const reviveOne = (value) => {
    if (!value || typeof value !== 'object' || !value[MARK]) {return value;}
    if (value[MARK] === 'palette') {return markPalette(new Uint8Array(value.bytes.buffer, value.bytes.byteOffset, value.bytes.length), value.colorSpace);}
    return markClustering(new Uint8Array(value.bytes.buffer, value.bytes.byteOffset, value.bytes.length));
};
export const revive = (value) => {
    if (!value || typeof value !== 'object' || ArrayBuffer.isView(value)) {return value;}
    if (value[MARK]) {return reviveOne(value);}
    if (!isOptionsObject(value)) {return value;}
    for (const key of Object.keys(value)) {value[key] = reviveOne(value[key]);}
    return value;
};
