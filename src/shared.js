// Shared by both entries (index.js and worker.js) and the worker thread: errors, option snapshots, reading a clustering's
// header, the Palette and Clustering types, and the markers that carry those types across the worker boundary. Imported as
// './shared.js'; the build rewrites that to './shared.mjs' or './shared.cjs' (scripts/babel-import-extensions.cjs).

// The library's version: package.json is the source, and scripts/sync-version.mjs keeps this line (and the copy the .wasm
// is built from, src/version.hpp) in step with it. Do not edit it by hand.
export const version = '3.6.0';

export const colorSpaceCodes = {'rgb': 0, 'oklab': 1};
// Every option whose value is one of a fixed set of names has the set exported as a frozen list (like errorCodes,
// ditherMethods and ditherSteps), for building a choice from it or checking a value against it.
export const colorSpaces = Object.freeze(Object.keys(colorSpaceCodes));
export const imageFormats = Object.freeze(['rgb', 'rgba', 'bgra', 'rgbx', 'bgrx']);
// Bytes per pixel of an image format: 3 for 'rgb', 4 for the rest.
export const channels = (format) => format === 'rgb' ? 3 : 4;
// Whether an image format's fourth byte is alpha ('rgbx' and 'bgrx' have a padding byte there instead).
export const hasAlpha = (format) => format === 'rgba' || format === 'bgra';
// The accepted formats as text, for messages: 'rgb', 'rgba', 'bgra', 'rgbx' or 'bgrx'.
export const formatNames = imageFormats.map((f) => `'${f}'`).join(', ').replace(/, ([^,]*)$/, ' or $1');

// The error for an image whose pixels were transferred away (detached): `what` is 'bare' (a typed array passed as the
// image), 'imagedata' or 'data' (a { data, format } object). Both entries report it in these words.
export const detachedError = (what) => fail('invalid-argument', what === 'imagedata'
    ? "Invalid image: the ImageData's pixels were transferred away (detached), for example to a worker created with transfer: true."
    : `Invalid image${what === 'data' ? ' data' : ''}: its buffer was transferred away (detached), for example to a worker created with transfer: true, so it has no pixels left. Pass a copy if you need to keep using it.`, 'image');
export const alphaModes = Object.freeze(['weight', 'ignore']);
export const colorSpaceName = (code) => code === 1 ? 'oklab' : 'rgb';

// Every error this library throws is an Error with a `code` saying what went wrong, so callers needn't match on message
// text: 'invalid-argument' (image, k, options, palette), 'invalid-clustering', 'unsupported-version' (a clustering from a
// newer format, or an older one without what was asked for), 'out-of-memory', 'wasm-load-failed', and in the worker entry
// 'worker-terminated', 'worker-failed' and 'invalid-handle'. When the error is about one argument, `argument` names it
// for programs (the message is for people): 'image', 'k', 'clustering', 'palette', 'options', or 'options.<key>' for
// one option.
// Every code `fail` gives, for programs that branch on them or forward them (a wrapper package, an IPC bridge).
export const errorCodes = Object.freeze(['invalid-argument', 'invalid-clustering', 'unsupported-version', 'out-of-memory', 'wasm-load-failed', 'worker-terminated', 'worker-failed', 'invalid-handle']);

// Whether `value` is one of this library's errors: an error (or, after crossing Electron's IPC or a postMessage, a plain
// object) with a string message and one of `errorCodes`. Checking `code` alone isn't enough: Node's own errors have a
// `code` too ('ENOENT'), and an abort rejects with the signal's reason, which has none.
export const isCodedError = (value) => value !== null && typeof value === 'object'
    && typeof value.message === 'string' && typeof value.code === 'string' && errorCodes.includes(value.code);

export const fail = (code, message, argument) => Object.assign(new Error(message), argument === undefined ? {code} : {code, argument});

// The module's memory is at most 2 GB (MAXIMUM_MEMORY in build:wasm) and its allocator takes a 32-bit signed size, so a
// buffer of 2 GB or more can never be copied in: _malloc would read its length as negative, or (from 4 GB) wrap it to a
// small number and hand back a block too short for the copy. Such buffers are rejected before any allocation, and the
// worker entry rejects them before sending, as the main entry does (from 4 GB a buffer can't even be cloned to send).
export const maxBytes = 2 ** 31;
export const sizeText = (bytes) => bytes >= 2 ** 30 ? `${(bytes / 2 ** 30).toFixed(2)} GB` : `${Math.round(bytes / 2 ** 20)} MB`;
export const tooLarge = (bytes) => fail('out-of-memory', `The input is ${sizeText(bytes)}, more than the WebAssembly module can hold: it has at most 2 GB in all, for the pixels and the work on them, so an image's pixel data must stay under about 1.9 GB (about 480 megapixels at 4 bytes per pixel). Scale the image down for its palette (a few megapixels give as good a one), and map a full-size image in strips with quantizeWithPalette.`);

// Type checks by tag rather than `instanceof`, so values from another realm (an iframe, a vm context, a test sandbox,
// whose Uint8Array is a different constructor) are recognised. A Node Buffer is a Uint8Array by tag too.
const tag = (value) => Object.prototype.toString.call(value);
export const isUint8Array = (value) => ArrayBuffer.isView(value) && tag(value) === '[object Uint8Array]';
export const isUint8ClampedArray = (value) => ArrayBuffer.isView(value) && tag(value) === '[object Uint8ClampedArray]';
export const isArrayBufferLike = (value) => tag(value) === '[object ArrayBuffer]' || tag(value) === '[object SharedArrayBuffer]';

// A typed array whose buffer was transferred away (to a worker, say) is empty and can't be read or viewed.
export const isDetached = (view) => {
    const buffer = view.buffer;
    if (typeof buffer.detached === 'boolean') {return buffer.detached;}
    try {new Uint8Array(buffer, 0, 0); return false;} catch (error) {return true;}
};

// An ImageData: checked by tag as well as `instanceof`, so one from another realm (an iframe's canvas) is recognised, and by
// its class's name with the shape of one, for implementations that have neither the tag nor the global (node-canvas under
// jsdom, skia-canvas, whose tag is plain [object Object]).
export const isImageData = (value) => typeof value === 'object' && value !== null
    && ((typeof ImageData !== 'undefined' && value instanceof ImageData) || tag(value) === '[object ImageData]'
        || (typeof value.constructor === 'function' && value.constructor.name === 'ImageData'
            && isUint8ClampedArray(value.data) && Number.isInteger(value.width) && Number.isInteger(value.height)));

// ImageData can hold other pixel formats than 8-bit RGBA (Chromium's pixelFormat: 'rgba-float16', with a Float16Array of
// pixels). The library reads 8-bit RGBA only, so those are rejected, rather than read as the bytes of their floats.
export const checkImageDataPixels = (image) => {
    if (isUint8ClampedArray(image.data)) {
        // skia-canvas's ImageData can hold other layouts in the same clamped array ({ colorType: 'bgra' }, 'rgb888x',
        // 'gray8', ...), and node-canvas's other pixel formats ('A8', 'RGB16_565') give fewer bytes: read as RGBA, they give
        // swapped colours or the wrong pixel count, so they are rejected, with the { data, format } to pass where one fits.
        // skia-canvas stores short and canonical spellings ('rgba' or 'RGBA8888', 'bgra' or 'BGRA8888', 'rgb' or 'RGB888x').
        const colorType = image.colorType;
        const kind = typeof colorType === 'string' ? colorType.toLowerCase() : colorType;
        if (kind !== undefined && kind !== 'rgba' && kind !== 'rgba8888') {
            const format = kind === 'bgra' || kind === 'bgra8888' ? 'bgra' : kind === 'rgb' || kind === 'rgb888x' ? 'rgbx' : null;
            const instead = format ? ` Pass { data: imageData.data, format: '${format}', width, height } instead.` : " Ask for colorType 'rgba'.";
            throw fail('invalid-argument', `Invalid image: this ImageData holds ${describe(colorType)} pixels, and an ImageData is read as 8-bit RGBA.${instead}`, 'image');
        }
        const needed = image.width * image.height * 4;
        if (image.data.length !== needed) {
            throw fail('invalid-argument', `Invalid image: this ImageData's data has ${image.data.length} bytes, but ${image.width} x ${image.height} RGBA pixels need ${needed}.`, 'image');
        }
        return;
    }
    const format = typeof image.pixelFormat === 'string' ? ` (pixelFormat: '${image.pixelFormat}')` : '';
    throw fail('invalid-argument', `Invalid image: this ImageData doesn't hold 8-bit RGBA pixels${format}, and the library reads only those. Ask for 8-bit pixels with getImageData(x, y, width, height, { pixelFormat: 'rgba-unorm8' }), or draw it to a canvas with the default format and take getImageData() from that.`, 'image');
};

// An ImageData like `like`, with these pixels: made with `like`'s own class where it has one, so an ImageData from another
// implementation (node-canvas, in Node or under jsdom) comes back as one that implementation accepts, and where there is
// no global ImageData at all. The colour space is kept ('display-p3' canvases), since the pixels are still in it.
export const imageDataLike = (like, pixels) => {
    const {width, height, colorSpace} = like;
    const own = like.constructor;
    const make = typeof own === 'function' && own.name === 'ImageData' ? own : typeof ImageData === 'function' ? ImageData : null;
    if (!make) {throw fail('invalid-argument', "Invalid image: an ImageData whose class can't be used to make the result. Pass { data, format: 'rgba', width } instead.", 'image');}
    return colorSpace ? new make(pixels, width, height, {colorSpace}) : new make(pixels, width, height);
};

// What to say about something that isn't an image, when it is a common thing to pass by mistake: each has a one-line fix.
export const imageHint = (image) => {
    const decode = " Decode it to pixels first, then pass them.";
    if (image === undefined || image === null) {return ` Got ${image}.`;}
    if (typeof image === 'string') {return ` Got a string (a file name, URL or data URL?): load and decode it to pixels first.`;}
    if (typeof image !== 'object') {return ` Got a ${typeof image}.`;}
    if (Array.isArray(image)) {return " Got a plain array: use new Uint8Array(array) for RGBA bytes, or { data: new Uint8Array(array), format: 'rgb' }.";}
    if (isArrayBufferLike(image)) {return " Got an ArrayBuffer, which has no pixel layout: wrap it, new Uint8Array(buffer) for RGBA bytes (if it holds an encoded image file, decode it first).";}
    if (typeof image.getContext === 'function') {return " Got a canvas: pass its pixels, canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).";}
    if (typeof image.arrayBuffer === 'function' && typeof image.type === 'string') {return " Got a Blob or File, which is an encoded image:" + decode + " (createImageBitmap(blob), draw it to a canvas, then getImageData()).";}
    if (typeof image.copyTo === 'function' && typeof image.codedWidth === 'number') {return " Got a VideoFrame: copy its pixels with frame.copyTo(buffer, { format: 'BGRA' }) and pass { data: buffer, format: 'bgra', width: frame.visibleRect.width, height: frame.visibleRect.height } (or 'BGRX' and 'bgrx' for frames without alpha).";}
    if (typeof image.close === 'function' || typeof image.nodeName === 'string') {return " Got an image element or ImageBitmap: draw it to a canvas (or OffscreenCanvas) and pass getImageData().";}
    if (image.data && !image.format) {return ` It has \`data\` but no \`format\`: add format: 'rgba' (or another of ${formatNames}) to use it as a RawImage.`;}
    return '';
};

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

// ----- Dithering ------------------------------------------------------------------------------------------------------
// The dither methods and their codes in C, and the step counts ordered dithering takes (the counts that divide the 64
// cells of its 8x8 matrix evenly). Steps 0 tells C to choose: 64 for a palette of two colours, else 16.
const ditherMethodCodes = {'floyd-steinberg': 0, 'atkinson': 1, 'ordered': 2};
// The method names and step counts, exported (like errorCodes) for code that builds options from a form.
export const ditherMethods = Object.freeze(Object.keys(ditherMethodCodes));
export const ditherSteps = Object.freeze([2, 4, 8, 16, 32, 64]);

// A short description of a value for an error message.
export const describe = (value) => typeof value === 'string' ? `'${value}'`
    : typeof value === 'number' || typeof value === 'boolean' || value === null ? String(value)
    : Array.isArray(value) ? 'an array' : typeof value === 'object' ? `a ${Object.prototype.toString.call(value).slice(8, -1)}` : `a ${typeof value}`;

// Reads every form of the dither option: false/undefined (off), true or a strength from 0 to 1 (Floyd-Steinberg, as in
// 3.0), a method name, or an object { method, strength, steps } that the plain forms are shorthands for.
// Returns {strength, method, steps}, with strength 0 meaning no dithering and steps 0 meaning the default.
export const parseDither = (value) => {
    const invalid = (key, message) => fail('invalid-argument', message, key === undefined ? 'options.dither' : `options.dither.${key}`);
    // What a value from a form most likely meant: 'none' for no dithering, or a number given as a string.
    const numeric = (v) => typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v));
    const asNumber = (v) => numeric(v) ? ` It is a string: pass a number, for example Number(value).` : '';
    const wrongForm = () => invalid(undefined, `Invalid dither: got ${describe(value)}; it must be a boolean, a strength from 0 to 1, 'floyd-steinberg', 'atkinson', 'ordered', or an object { method, strength, steps }.${
        typeof value === 'string' && ['none', 'off', 'false'].includes(value.trim().toLowerCase()) ? ' Use false for no dithering.' : asNumber(value)}`);
    const has = (key) => Object.prototype.hasOwnProperty.call(ditherMethodCodes, key);
    if (value === undefined || value === false) {return {strength: 0, method: 0, steps: 0};}
    if (value === true) {return {strength: 1, method: 0, steps: 0};}
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value < 0 || value > 1) {throw wrongForm();}
        return {strength: value, method: 0, steps: 0};
    }
    if (typeof value === 'string' && has(value)) {return {strength: 1, method: ditherMethodCodes[value], steps: 0};}
    if (!isOptionsObject(value)) {throw wrongForm();}
    const object = snapshot(value);
    for (const key of Object.keys(object)) {
        if (!['method', 'strength', 'steps'].includes(key)) {throw invalid(key, `Invalid dither option '${key}': expected method, strength or steps.`);}
    }
    const methodName = object.method === undefined ? 'floyd-steinberg' : object.method;
    if (typeof methodName !== 'string' || !has(methodName)) {
        throw invalid('method', `Invalid dither.method: got ${describe(methodName)}; it must be 'floyd-steinberg', 'atkinson' or 'ordered'.`);
    }
    const strength = object.strength === undefined ? 1 : object.strength;
    if (typeof strength !== 'number' || !Number.isFinite(strength) || strength < 0 || strength > 1) {
        throw invalid('strength', `Invalid dither.strength: got ${describe(strength)}; it must be a number from 0 to 1.${asNumber(strength)}`);
    }
    if (object.steps !== undefined && methodName !== 'ordered') {
        throw invalid('steps', `Invalid dither.steps: only ordered dithering takes steps, so write dither: { method: 'ordered', steps }.`);
    }
    if (object.steps !== undefined && !ditherSteps.includes(object.steps)) {
        throw invalid('steps', `Invalid dither.steps: got ${describe(object.steps)}; it must be 2, 4, 8, 16, 32 or 64.${asNumber(object.steps)}`);
    }
    return {strength, method: ditherMethodCodes[methodName], steps: object.steps === undefined ? 0 : object.steps};
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

// ----- Encoded image files -------------------------------------------------------------------------------------------
// A bare Uint8Array is taken to be raw RGBA pixels, so the commonest mistake is handing over the bytes of an image *file*
// (fs.readFile, fetch().arrayBuffer()): it passes as pixels whenever its length is a multiple of 4 and gives a palette of
// nonsense. The signatures of the common formats are recognised so that it is reported instead. Only a bare Uint8Array is
// looked at: an ImageData or a { data, format } object has said what its bytes are, so it is never second-guessed, and a
// bare array that really is raw pixels can be passed as { data, format: 'rgba' } to say so.
//
// Decoding is left to the caller: the library has no decoders and no dependency on one (PRINCIPLES "Settled
// decisions"), and the guides' "Decoding image files" gives a recipe per environment, which the message points to.
const ascii = (bytes, at, text) => {
    for (let i = 0; i < text.length; i++) {if (bytes[at + i] !== text.charCodeAt(i)) {return false;}}
    return true;
};

// The name of the encoded image format `bytes` starts with, or null. Signatures are long enough, or have enough structure
// beyond the first few bytes, that raw pixels all but never match.
export const sniffImageFormat = (bytes) => {
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

// ----- RGB and grey bytes passed bare -------------------------------------------------------------------------------
// The other common way to get a bare array wrong is bytes of another layout: RGB (sharp's plain .raw()), or grey and grey
// with alpha (fast-png's decode() of a grey PNG). Read as RGBA, every pixel takes bytes from its neighbours and one of them
// as its alpha, and nothing fails while the length divides by 4. They are never reinterpreted (a bare array is RGBA,
// PRINCIPLES), only reported: a warning in 3.x, an error from 4.0.
//
// The rules use E(k), the mean change between a byte and the one k before it (bench/spikes/bare-rgb/ and
// bench/spikes/bare-grey/: no false positives on 2,984 real RGBA images).
// - RGB, decided first: real RGBA changes least at a step of 4, RGB at a step of 3. A premultiplied white mask,
//   (a, a, a, a), also scores high, so pixels with four equal bytes overrule it. Grey RGB is too smooth for that score,
//   but where it changes its bytes come in equal triples at a step of 3 and not of 4.
// - Grey and alpha (2 bytes a pixel): smooth at a step of 2 and rough at a step of 1, since grey and alpha bytes alternate.
// - Grey (1 byte a pixel): smoothest at a step of 1, unless most changing pixels have four equal bytes, which is real
//   RGBA (grey with alpha = grey). The RGB rule goes first because near-grey RGB can look the same; it then keeps the
//   rgb-as-rgba code, whose text covers grey too.
// Units equal to the one before are skipped by the equal-byte counts, since flat areas read the same either way. It
// samples 512 windows of 96 bytes (each on a multiple of 12, a pixel under every reading, one in each 512th of the
// array), so it costs about 0.35 ms at any size. Returns 'rgb', 'grey', 'grey-alpha' or null.
const bareFloor = 192, bareWindow = 96, bareWindows = 512;
export const bareLayout = (d) => {
    if (d.length < bareFloor) {return null;}
    const whole = d.length <= bareWindow * bareWindows;
    const windows = whole ? 1 : bareWindows, size = whole ? d.length : bareWindow;
    const step = whole ? 0 : Math.floor((d.length - bareWindow) / (bareWindows - 1) / 12) * 12;
    // Each window starts at a fixed pseudo-random multiple of 12 within its slot. Evenly spaced starts would alias with
    // the image's rows (768×512 RGBA spaces them exactly one row apart), so every window would see only the left edge,
    // and a cutout's transparent margin would hide the rest of the image.
    const slots = step / 12, last = d.length - size;
    const startOf = (w) => (whole ? 0 : Math.min(w * step + ((Math.imul(w + 1, 0x9E3779B1) >>> 0) % slots) * 12, last - (last % 12)));
    let e1 = 0, e2 = 0, e3 = 0, e4 = 0, n = 0, g3 = 0, n3 = 0, g4 = 0, q4 = 0, n4 = 0;
    for (let w = 0; w < windows; w++) {
        const start = startOf(w), end = start + size;
        for (let i = start + 4; i < end; i++) {
            const v = d[i], a = v - d[i - 1], b = v - d[i - 2], c = v - d[i - 3], e = v - d[i - 4];
            e1 += a < 0 ? -a : a;
            e2 += b < 0 ? -b : b;
            e3 += c < 0 ? -c : c;
            e4 += e < 0 ? -e : e;
        }
        n += size - 4;
        for (let i = start + 3; i + 2 < end; i += 3) {
            if (d[i] === d[i - 3] && d[i + 1] === d[i - 2] && d[i + 2] === d[i - 1]) {continue;}
            n3++;
            if (d[i] === d[i + 1] && d[i] === d[i + 2]) {g3++;}
        }
        for (let i = start + 4; i + 3 < end; i += 4) {
            if (d[i] === d[i - 4] && d[i + 1] === d[i - 3] && d[i + 2] === d[i - 2] && d[i + 3] === d[i - 1]) {continue;}
            n4++;
            if (d[i] === d[i + 1] && d[i] === d[i + 2]) {g4++; if (d[i] === d[i + 3]) {q4++;}}
        }
    }
    const E1 = e1 / n + 0.05, E2 = e2 / n + 0.05, E3 = e3 / n + 0.05, E4 = e4 / n + 0.05;
    const fewQuads = q4 < 0.5 * Math.max(1, n4);
    const layout = (E4 / E3 > 1.25 && fewQuads) || (g3 > 0.9 * Math.max(1, n3) && g4 < 0.6 * Math.max(1, n4)) ? 'rgb'
        : E4 / E2 > 1.1 && E2 / E1 < 0.5 ? 'grey-alpha'
            : E4 / E1 > 1.5 && fewQuads ? 'grey' : null;
    if (layout === null) {return null;}
    // Bytes that mostly rise by one fixed step ((i * k) & 255, the usual fake image in tests) are pixels of no layout, and
    // score 4/3 as RGB or 4 as grey whatever the step. Counted only for arrays about to be flagged, a second pass over the
    // same windows, so RGBA (the usual input) doesn't pay for it.
    let ramp = 0;
    for (let w = 0; w < windows; w++) {
        const start = startOf(w), end = start + size;
        for (let i = start + 4; i < end; i++) {
            const rise = (d[i] - d[i - 1]) & 255;
            if (rise !== 0 && rise === ((d[i - 1] - d[i - 2]) & 255)) {ramp++;}
        }
    }
    return ramp <= 0.5 * n ? layout : null;
};
export const looksLikeRgb = (d) => bareLayout(d) === 'rgb';

// Codes already warned in this copy of the library (PRINCIPLES: once per code, per copy).
const warned = new Set();
const bareCodes = {rgb: 'rgb-as-rgba', grey: 'gray-as-rgba', 'grey-alpha': 'gray-as-rgba'};

// The warning a bare image calls for, as {code, layout}, or null. It skips everything the main entry rejects (palettes
// and clusterings passed as the image, encoded files, lengths that aren't a multiple of 4), so a call never both warns
// about its image and rejects it, and both entries share this one order. An array of one layout never takes another's
// code because its own was already used: it is classified first, and only then is its code checked.
export const bareImageWarning = (image) => {
    if ((warned.has('rgb-as-rgba') && warned.has('gray-as-rgba')) || !isUint8Array(image) || isPalette(image) || isClustering(image)) {return null;}
    if (sniffImageFormat(image) !== null || image.length % 4 !== 0) {return null;}
    const layout = bareLayout(image);
    return layout === null || warned.has(bareCodes[layout]) ? null : {code: bareCodes[layout], layout};
};

// The text of each warning. Delivered through process.emitWarning in Node, Bun and Deno (--no-warnings,
// process.on('warning') and --trace-warnings then work), else console.warn. Runtimes that imitate Node have an
// emitWarning that may print nothing (Cloudflare Workers with nodejs_compat), so they are told apart by
// navigator.userAgent, as worker.js does; a bundler's `process` polyfill has no emitWarning, and `globalThis.process`
// keeps Parcel from adding one.
const nodeLike = () => typeof navigator === 'undefined' || /^(Node\.js|Bun|Deno)\//.test(String(navigator.userAgent));
const warningText = {
    'rgb-as-rgba': (byteLength) => `This image (${byteLength.toLocaleString('en-US')} bytes) looks like RGB bytes (3 per pixel), or grey, passed as a bare Uint8Array, which is read as RGBA (4 per pixel) and would give wrong colours. If it is RGB, pass { data, format: 'rgb' } (sharp's .raw() gives RGB for an image without alpha unless you add .ensureAlpha()). If it is grey (fast-png's decode() of a grey PNG), expand it to RGBA; format: 'rgb' would misread it too. If it really is RGBA, pass { data, format: 'rgba' } to say so. From 4.0 this is an error. Shown once.`,
    'gray-as-rgba': (byteLength, layout) => (layout === 'grey-alpha'
        ? `This image (${byteLength.toLocaleString('en-US')} bytes) looks like grey and alpha bytes (2 per pixel) passed as a bare Uint8Array, which is read as RGBA (4 per pixel) and would give wrong colours. fast-png's decode() gives this for a grey PNG with alpha.`
        : `This image (${byteLength.toLocaleString('en-US')} bytes) looks like grey bytes (1 per pixel) passed as a bare Uint8Array, which is read as RGBA (4 per pixel) and would give wrong colours. fast-png's decode() gives this for a grey PNG (rows below 8 bits stay packed) and for a palette PNG's indices.`)
        + ` Expand ${layout === 'grey-alpha' ? 'it' : '8-bit grey'} to RGBA, or decode with something that gives RGBA (pngjs, or sharp with .ensureAlpha()). There is no grey format to pass. If it really is RGBA, pass { data, format: 'rgba' } to say so. From 4.0 this is an error. Shown once.`,
};
// `warning` is what bareImageWarning returned: {code, layout}.
export const warnOnce = ({code, layout}, byteLength) => {
    if (warned.has(code)) {return;}
    warned.add(code);
    const message = warningText[code](byteLength, layout);
    const runtime = globalThis.process;
    if (runtime && typeof runtime.emitWarning === 'function' && nodeLike()) {runtime.emitWarning(message, {type: 'AgglomerativeClusteringWarning', code});}
    else if (typeof console !== 'undefined') {console.warn(`agglomerative-clustering [${code}]: ${message}`);}
};
// The worker thread's copy: its caller's side checks and warns (PRINCIPLES), so here every code counts as warned, which
// also skips the sampling.
export const silenceWarnings = () => {for (const code of Object.keys(warningText)) {warned.add(code);}};
// For tests.
export const resetWarnings = () => {warned.clear();};
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
// Methods on a clustering: `clustering.getPalette(k)` is `getPaletteFromClustering(clustering, k)`, and so on. They are
// non-enumerable own properties, added with the tags, so a clustering stays a plain Uint8Array (`toEqual` and
// `deepStrictEqual` against plain bytes still pass), and slices and clones drop them as they drop the tags. They run on the
// calling thread with the main entry's functions, which the main entry puts in `engine` when it is evaluated; the worker
// entry puts nothing there, so in a worker-only app the methods reject and say what to import. Each copy of this file (the
// ES module and the CommonJS build) has its own slot, filled by the main entry of the same module system.
let engine = null;
// The first main entry evaluated keeps the slot: it is the one an app loads and gives `init({ wasm })`, so a later copy
// (a duplicated chunk, a query-string import) doesn't re-point every clustering at a module of its own that isn't set up.
export const setEngine = (value) => {if (engine === null) {engine = value;}};
// Each method's call shape and its function form, for messages.
const methodNames = {
    getPalette: ['getPalette(k)', 'getPaletteFromClustering(clustering, k)'],
    getSwatches: ['getSwatches(k)', 'getSwatchesFromClustering(clustering, k)'],
    getClusteringInfo: ['getClusteringInfo()', 'getClusteringInfo(clustering)'],
    quantize: ['quantize(image, k)', 'quantizeFromClustering(image, clustering, k)'],
    quantizeToIndices: ['quantizeToIndices(image, k)', 'quantizeToIndicesFromClustering(image, clustering, k)'],
};
// Checks the receiver before anything else, since it is written first, then (for the mapping methods) that the image isn't
// the worker handle's `k`, then that the main entry is loaded.
const receive = (name, receiver, image) => {
    const [shape, form] = methodNames[name];
    if (!isUint8Array(receiver)) {
        throw fail('invalid-clustering', `Invalid clustering: ${name} was called without its clustering (this is ${receiver === undefined ? 'undefined' : describe(receiver)}). Call it as clustering.${shape}, or use ${form}.`, 'clustering');
    }
    readHeader(receiver);
    if (image !== undefined) {checkImageFirst(name, image.value);}
    if (engine === null) {
        throw fail('wasm-load-failed', `clustering.${name} can't run here: a clustering's methods run on the calling thread with the main entry, 'agglomerative-clustering', of the copy of the package that made it, and that entry isn't loaded on this thread (this clustering came from the worker entry, or from another copy, such as the other module system's build). Import 'agglomerative-clustering' in this thread (and call its init({ wasm }) if you set where the module comes from), wrap the bytes with new Clustering(bytes) from the main entry you use, or call ${form} from 'agglomerative-clustering/worker', which runs in the worker.`);
    }
    return engine;
};
// The worker handle's quantize(k) maps the image it holds; this one takes the image first, so a number there is that mistake.
const checkImageFirst = (name, image) => {
    if (typeof image === 'number') {
        throw fail('invalid-argument', `Invalid image: got ${image}. clustering.${name} takes the image first: clustering.${name}(image, k). (A worker handle's ${name}(k) maps the image it holds.)`, 'image');
    }
};
// Plain functions (they read `this`) that return a promise and never throw: errors are rejections, as from the functions.
const methods = {
    getPalette(k, ...extra) {
        try {return receive('getPalette', this).cut('clustering.getPalette', this, k, extra);} catch (error) {return Promise.reject(error);}
    },
    getSwatches(k, ...extra) {
        try {return receive('getSwatches', this).cutSwatches('clustering.getSwatches', this, k, extra);} catch (error) {return Promise.reject(error);}
    },
    getClusteringInfo(...extra) {
        try {return receive('getClusteringInfo', this).info('clustering.getClusteringInfo', this, extra);} catch (error) {return Promise.reject(error);}
    },
    quantize(image, k, options) {
        try {
            return receive('quantize', this, {value: image}).quantizeFromClustering(image, this, k, options);
        } catch (error) {return Promise.reject(error);}
    },
    quantizeToIndices(image, k, options) {
        try {
            return receive('quantizeToIndices', this, {value: image}).quantizeToIndicesFromClustering(image, this, k, options);
        } catch (error) {return Promise.reject(error);}
    },
};
// Writable and configurable like any method (so `vi.spyOn(clustering, 'getPalette')` works), and not enumerable.
const methodDescriptors = Object.fromEntries(Object.entries(methods).map(([name, value]) => [name, {value, writable: true, configurable: true}]));
export const markClustering = (bytes) => {
    // Made by this library (or checked by `Clustering`), so its checksum needn't be checked again (see readHeader).
    checked.add(bytes);
    Object.defineProperty(bytes, clusteringBrand, {value: true});
    Object.defineProperty(bytes, inspect, {value: clusteringView});
    Object.defineProperties(bytes, methodDescriptors);
    return bytes;
};

// Flat RGB bytes with the colour space they were made in, so mapping with one matches the way it was made. `new Palette(bytes,
// 'oklab')` copies `bytes` (or makes `length` zeros, or takes an array of byte values) and returns a Uint8Array tagged so.
// A function and not a `class`, because it returns a plain Uint8Array and answers `instanceof` itself, which transpiled class
// checks would trip over.
export function Palette(source, colorSpace = 'rgb') {
    if (!colorSpaces.includes(colorSpace)) {throw fail('invalid-argument', "Invalid colorSpace: must be 'rgb' or 'oklab'.", 'colorSpace');}
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
        throw fail('invalid-clustering', "Invalid clustering: expected its bytes (a Uint8Array, or an ArrayBuffer with an optional offset and length) from buildClustering.", 'clustering');
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
//              colours, parent index, lighter weight and cost; from 3.0.0-beta.2 the header holds a checksum (bytes 17-20)
export const latestVersion = 3;

// The version of stored data (clusterings) this build writes. It reads this one and format 2 (see readHeader). Unlike
// `version`, it changes only when the stored format does, so a 3.x release that keeps the format keeps this number.
export const formatVersion = latestVersion;

// ----- Checksums -----------------------------------------------------------------------------------------------------
// From 3.0.0-beta.2, a version 3 header holds the CRC-32 of the whole clustering (bytes 17-20, read as zeros while it is
// computed; see src/clustering.cpp). 0 means none: beta.1 wrote zeros there. A clustering is checked the first time it
// is used, and the arrays that passed (and the ones this library made) are remembered, so cutting one clustering
// again and again checks it once. Changing a clustering's bytes after that is not detected here, but the records are
// also checked as they are replayed, so it still can't give a palette of the wrong size.
const checksumAt = 17;
// Computed 8 bytes at a time with eight tables (slicing-by-8), about 4 times faster than byte by byte: a clustering of a
// photo is 1-2 MB, and is checked the first time it is used.
let crcTables = null;
const crc32 = (bytes) => {
    if (!crcTables) {
        crcTables = Array.from({length: 8}, () => new Uint32Array(256));
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let b = 0; b < 8; b++) {c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;}
            crcTables[0][n] = c >>> 0;
        }
        for (let n = 0; n < 256; n++) {
            for (let t = 1; t < 8; t++) {crcTables[t][n] = (crcTables[t - 1][n] >>> 8) ^ crcTables[0][crcTables[t - 1][n] & 0xFF];}
        }
    }
    const [t0, t1, t2, t3, t4, t5, t6, t7] = crcTables;
    let crc = 0xFFFFFFFF;
    const byte = (i) => (i >= checksumAt && i < checksumAt + 4 ? 0 : bytes[i]);
    let i = 0;
    // The checksum field lies in the first 24 bytes, which go byte by byte; the rest 8 at a time.
    for (; i < Math.min(24, bytes.length); i++) {crc = t0[(crc ^ byte(i)) & 0xFF] ^ (crc >>> 8);}
    const end = bytes.length - 7;
    for (; i < end; i += 8) {
        const a = (crc ^ (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24))) >>> 0;
        crc = t7[a & 0xFF] ^ t6[(a >>> 8) & 0xFF] ^ t5[(a >>> 16) & 0xFF] ^ t4[a >>> 24]
            ^ t3[bytes[i + 4]] ^ t2[bytes[i + 5]] ^ t1[bytes[i + 6]] ^ t0[bytes[i + 7]];
    }
    for (; i < bytes.length; i++) {crc = t0[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);}
    return (crc ^ 0xFFFFFFFF) >>> 0;
};
const checked = new WeakSet();
const damaged = () => fail('invalid-clustering', "Invalid clustering: its bytes are damaged (the checksum doesn't match): it was truncated, changed or mixed up with other data after buildClustering made it. Cluster the image again.", 'clustering');

// The message for bytes that aren't a clustering: 1.x clusterings are mentioned only for bytes that could be one (no header,
// and a length of 0 or 3 more than a multiple of 9).
const notAClustering = (clustering) => {
    const length = clustering.length;
    if (clustering[0] !== 0xAC && (length % 9 === 0 || length % 9 === 3)) {
        return fail('invalid-clustering', "Invalid clustering: not a clustering from buildClustering. If it was stored by agglomerative-clustering 1.x, that format is no longer read: cluster the image again.", 'clustering');
    }
    if (clustering[0] === 0xAC && length >= 2 && (clustering[1] === 2 || clustering[1] === 3)) {
        return fail('invalid-clustering', `Invalid clustering: it starts like a format ${clustering[1]} clustering, but its length or header doesn't fit one (${length} bytes): it was probably truncated or damaged. Cluster the image again.`, 'clustering');
    }
    return fail('invalid-clustering', `Invalid clustering: not a clustering from buildClustering (${length} bytes that don't start with a clustering header).`, 'clustering');
};

export const readHeader = (clustering) => {
    if (isPalette(clustering)) {
        throw fail('invalid-clustering', "Invalid clustering: this is a palette, not a clustering. Palettes come from buildPalette and getPaletteFromClustering; a clustering comes from buildClustering.", 'clustering');
    }
    if (!isUint8Array(clustering)) {
        throw fail('invalid-clustering', "Invalid clustering: must be a Uint8Array from buildClustering.", 'clustering');
    }
    const length = clustering.length;
    if (length >= 4 && clustering[0] === 0xAC) {
        const version = clustering[1];
        if (version === 2 && clustering[2] <= 1 && (length === 4 || length % 9 === 7)) {
            return {version, colorSpace: clustering[2], precision: clustering[3], transparent: 0, headerLength: 4, recordLength: 9, merges: length === 4 ? 0 : (length - 7) / 9};
        }
        if (version === 3 && length >= 13) {
            const headerLength = clustering[2], recordLength = clustering[3];
            // Header lengths are 22 (every release) or 13 (the fixture from before 3.0.0-beta.1, kept readable by the format
            // rules), or longer from a later release that adds fields. 14 to 20 was never written: it is a damaged length, which
            // would also put the checksum field out of reach, so the checksum couldn't catch it.
            if ((headerLength === 13 || headerLength >= checksumAt + 4) && recordLength >= 21 && headerLength <= length) {
                // A header field with a fixed set of meanings (colour space, weight unit) that holds a value this version
                // doesn't know is how a later release would add one, so it asks for an upgrade rather than misreading it.
                if (clustering[4] > 1 || clustering[6] > 1) {
                    throw fail('unsupported-version', "Unsupported clustering: it uses a colour space or weight unit that this version of agglomerative-clustering does not know. If it came from a newer version, upgrade the package; otherwise it is damaged.", 'clustering');
                }
                const merges = length < headerLength + 3 ? 0 : Math.floor((length - headerLength - 3) / recordLength);
                const padding = length < headerLength + 3 ? length - headerLength : length - headerLength - 3 - merges * recordLength;
                if (padding < 9) {
                    // A 13-byte header (from before 3.0.0-beta.1) has no checksum field. A damaged header length of 13 skips this
                    // check, but then the records don't line up, which the replay reports.
                    if (!checked.has(clustering) && headerLength >= checksumAt + 4) {
                        const stored = (clustering[checksumAt] | (clustering[checksumAt + 1] << 8) | (clustering[checksumAt + 2] << 16) | (clustering[checksumAt + 3] << 24)) >>> 0;
                        if (stored !== 0 && stored !== crc32(clustering)) {throw damaged();}
                        checked.add(clustering);
                    }
                    return {version, colorSpace: clustering[4], precision: clustering[5], transparent: clustering[12], headerLength, recordLength, merges};
                }
            }
        }
        if (version > latestVersion) {
            throw fail('unsupported-version', `Unsupported clustering: format version ${version} is newer than this version of agglomerative-clustering reads. Upgrade the package.`, 'clustering');
        }
    }
    throw notAClustering(clustering);
};

// Palettes are flat RGB bytes. An empty palette is allowed: it is what getPalette gives for a fully transparent
// image, and quantize maps such an image the same way.
export const checkPalette = (palette) => {
    if (isClustering(palette)) {
        throw fail('invalid-argument', "Invalid palette: this is a clustering (from buildClustering), not a palette. Cut a palette from it with getPaletteFromClustering, or map with quantizeFromClustering.", 'palette');
    }
    if (!isUint8Array(palette) && !isUint8ClampedArray(palette) && !Array.isArray(palette)) {
        throw fail('invalid-argument', "Invalid palette: must be a Uint8Array of RGB bytes.", 'palette');
    }
    if (Array.isArray(palette) && palette.some((value) => Array.isArray(value) || ArrayBuffer.isView(value))) {
        throw fail('invalid-argument', "Invalid palette: a plain array must be flat RGB bytes, integers from 0 to 255, not an array of [r, g, b] colours. Flatten it first: colours.flat().", 'palette');
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
