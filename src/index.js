import createWasmModule from './clustering.js';
import {
    parseDither,
    version, fail, colorSpaceCodes, colorSpaces, colorSpaceName, isUint8Array, isUint8ClampedArray, isArrayBufferLike, isOptionsObject, snapshot, isPalette, isClustering, markPalette, markClustering, setEngine, imageHint,
    latestVersion, imageFormats, channels, hasAlpha, formatNames, detachedError, describe, readHeader, checkPalette, isDetached, imageDataLike, isImageData, checkImageDataPixels, maxBytes, sizeText, tooLarge, sniffImageFormat, bareRgbWarning, warnOnce,
} from './shared.js';

// The library's version, the stored-data format version, and the Palette and Clustering types (see shared.js).
export {version, Palette, Clustering, errorCodes, isCodedError, ditherMethods, ditherSteps, colorSpaces, imageFormats, alphaModes} from './shared.js';
// The version of stored data (clusterings) this build writes. It reads this one and format 2 (see readHeader). Unlike
// `version`, it changes only when the stored format does, so a 3.x release that keeps the format keeps this number.
export const formatVersion = latestVersion;

// Checked by tag rather than `instanceof`, so values from another realm are recognised: an ImageData from an iframe's
// canvas, a WebAssembly.Module compiled by a bundler's runtime (Next.js Edge's `import wasm from '…wasm?module'`), a URL
// from a vm context. A tag can be faked, but only on purpose, and the value is then used as what it claims to be.
const tagOf = (value) => Object.prototype.toString.call(value);
const isWasmModule = (value) => typeof value === 'object' && value !== null
    && ((typeof WebAssembly !== 'undefined' && value instanceof WebAssembly.Module) || tagOf(value) === '[object WebAssembly.Module]');
const isURL = (value) => typeof value === 'object' && value !== null && ((typeof URL !== 'undefined' && value instanceof URL) || tagOf(value) === '[object URL]');

const codes = {'rgba': 0, 'rgb': 1, 'bgra': 2, 'rgbx': 3, 'bgrx': 4};
// A hint for a format name that isn't one: the right case, the name other libraries use for the same bytes, or the nearest
// supported layout.
const formatHint = (format) => {
    if (typeof format !== 'string') {return '';}
    const lower = format.toLowerCase();
    if (lower !== format && imageFormats.includes(lower)) {return ` Format names are lower case: '${lower}'.`;}
    if (lower === 'xrgb' || lower === 'rgb24') {return " Cairo RGB24 (xRGB) is BGRX in memory on little-endian machines: pass 'bgrx'.";}
    if (lower === 'argb' || lower === 'argb32') {return " Cairo and node-canvas ARGB32 is BGRA in memory on little-endian machines, and premultiplied: convert it to straight alpha and pass 'bgra' (see Input in the API docs).";}
    if (lower === 'bgr' || lower === 'bgr24') {return " 24-bit BGR isn't supported: widen each pixel to 4 bytes and pass 'bgrx'.";}
    return '';
};
const alphaModeCodes = {'ignore': 0, 'weight': 1};
let Module = null;



// Turns init's `wasm` option into the settings the Emscripten glue understands. The glue finds its .wasm file next to
// itself by default (`new URL('clustering.wasm', import.meta.url)`); this lets a caller say where it is, or hand over
// the bytes or an already compiled module, for CDNs, strict CSPs and runtimes (such as Cloudflare Workers) that
// cannot fetch or compile it that way. `onError` receives instantiation errors, which the glue would otherwise swallow.
const wasmSettings = (wasm, onError) => {
    if (wasm === undefined) {return {};}
    if (typeof wasm === 'string' || isURL(wasm)) {
        const location = String(wasm);
        return {locateFile: (path, directory) => path.endsWith('.wasm') ? location : directory + path};
    }
    // Bytes and compiled modules go through `instantiateWasm`: this build of the glue reads no `wasmBinary` setting. The glue
    // sets itself up on the instance inside `receive`, which throws for a module that isn't this one (it has other exports);
    // that is reported as a failed load rather than left to escape, which would leave the load waiting forever.
    const accept = (receive) => (instance) => {
        try {receive(instance);} catch (error) {
            onError(Object.assign(new Error("it is not agglomerative-clustering's module (it lacks the memory and functions this script uses)"), {cause: error}));
        }
    };
    if (isArrayBufferLike(wasm) || ArrayBuffer.isView(wasm)) {
        const source = isArrayBufferLike(wasm) ? wasm : new Uint8Array(wasm.buffer, wasm.byteOffset, wasm.byteLength);
        return {instantiateWasm: (imports, receive) => {WebAssembly.instantiate(source, imports).then(({instance}) => accept(receive)(instance), onError);}};
    }
    if (isWasmModule(wasm)) {
        return {instantiateWasm: (imports, receive) => {WebAssembly.instantiate(wasm, imports).then(accept(receive), onError);}};
    }
    throw fail('invalid-argument', "Invalid wasm: must be a URL or path string, a URL, an ArrayBuffer or typed array of the .wasm bytes, or a WebAssembly.Module.", 'options.wasm');
};

// A module that cannot be loaded is the commonest first-run failure: a 404, a Content-Security-Policy that blocks it, a
// bundler that moved the file, an engine without WebAssembly SIMD. The engine's own error (a CompileError, a failed fetch)
// says little about which, so the message leads with what happened and then gives the likely fix for where it ran.
// The smallest module that uses a SIMD instruction (from wasm-feature-detect), to tell an old engine from a missing file.
const simdProbe = [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11];
const hasSimd = () => {
    try {return typeof WebAssembly === 'object' && WebAssembly.validate(new Uint8Array(simdProbe));} catch (error) {return false;}
};
// Node itself (or Bun), not a runtime that imitates it: Cloudflare Workers with nodejs_compat and Deno also define
// process.versions.node, but their navigator.userAgent says what they are (Node 20 has no navigator at all).
const isNodeLike = !!(globalThis.process && globalThis.process.versions && globalThis.process.versions.node)
    && (typeof navigator === 'undefined' || /^(Node\.js|Bun)\//.test(String(navigator.userAgent)));
// A browser page or worker, as opposed to a server-side runtime that isn't Node (Cloudflare Workers, Vercel's edge runtime,
// Deno Deploy): only those have a document, a worker scope or a browser's user agent.
const isBrowserLike = () => typeof document !== 'undefined' || typeof WorkerGlobalScope !== 'undefined'
    || (typeof navigator !== 'undefined' && /Mozilla\//.test(String(navigator.userAgent)));
// Where the advice for a server runtime ends: a deployment that left the .wasm behind.
const deployAdvice = "In a serverless deployment (AWS Lambda, Vercel or Netlify functions), the bundler or file tracer may have left the package's dist/ files out: include node_modules/agglomerative-clustering/dist in the function's files, or leave the package unbundled (external).";
// Emscripten appends advice about its own debug build, which doesn't apply to this package's users.
const assertionsAdvice = /\s*\(?Build with -sASSERTIONS for more info\.?\)?/;
const wasmLoadFailed = (cause, given) => {
    const text = String(cause && cause.message !== undefined ? cause.message : cause).split('\n')[0];
    // Emscripten wraps a failed compile in Aborted(...), which is how it stops itself, not part of the reason.
    let reason = text.replace(assertionsAdvice, '').trim().replace(/\.+$/, '');
    const aborted = /^Aborted\((.*)\)$/.exec(reason);
    if (aborted) {reason = aborted[1].replace(/\.+$/, '');}
    // The cause keeps Emscripten's own message, without that advice.
    if (cause && typeof cause.message === 'string' && assertionsAdvice.test(cause.message)) {
        try {cause.message = cause.message.replace(assertionsAdvice, '');} catch (error) {/* read-only: leave it */}
    }
    // Where an explicit init({ wasm }) URL or path pointed, to name in the message.
    const where = typeof given === 'string' ? ` (${given})` : '';
    let advice;
    if (/disallowed by embedder|code generation disallowed/i.test(text) && !isNodeLike && !isBrowserLike()) {
        // Edge runtimes (Cloudflare Workers, Vercel's edge runtime) compile WebAssembly only at build time, from an import.
        advice = "This runtime doesn't compile WebAssembly while it runs, from bytes or from a URL (edge runtimes such as Cloudflare Workers and Vercel's): import clustering.wasm as a module, which the bundler compiles when it builds (in Wrangler a plain import of 'agglomerative-clustering/clustering.wasm'; in Next.js a relative path with ?module), and pass it to init({ wasm }) before the first call, as the docs show for Cloudflare Workers and Next.js (https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/environments.md).";
    } else if (/(memory|allocate)/i.test(text) && /(could not|cannot|can't|failed to|out of) (allocate|memory|reserve)/i.test(text)) {
        // A 64-bit engine reserves the module's whole address range up front (about 10 GB of virtual memory per instance),
        // though it only uses what it needs; an address-space limit refuses that reservation.
        advice = "The engine couldn't reserve memory for the module. Each instance reserves a large range of address space up front (about 10 GB of virtual memory on 64-bit engines, of which it uses only what it needs), so a limit on virtual memory (ulimit -v, or a container's address-space limit) refuses it: lift that limit, or run fewer instances (each worker has its own).";
    } else if (/Content.Security.Policy|blocked by CSP|wasm-eval|unsafe-eval|CompileError: .*(disallowed|refused)/i.test(text)) {
        // Chrome's message names 'wasm-eval', which Chrome rejects in an extension's manifest; 'wasm-unsafe-eval' is the one.
        // Which policy applies depends on where the module is compiled: a worker started from a blob: URL (the worker entry
        // does that for a script from another origin, a content script's included) follows the page's.
        advice = "A Content-Security-Policy blocks compiling WebAssembly: add 'wasm-unsafe-eval' to the script-src of the policy that applies. That is the page's for a page and for the worker entry's worker (also when started from a content script, whose worker follows the page's policy); for a browser extension's own pages, offscreen document and service worker, it is content_security_policy.extension_pages in the manifest.";
    } else if (!hasSimd()) {
        advice = "This engine has no WebAssembly SIMD, which the module needs (Chrome and Edge 91, Firefox 89, Safari 16.4, Node 16.4 or newer).";
    } else if (/magic (word|number)|BufferSource argument is empty|wasm validation error: at offset [0-4]:/i.test(text)) {
        // What a 404 page, or a server's fallback HTML page, looks like once it has been compiled as WebAssembly.
        if (given === true) {
            reason = `the bytes given to init({ wasm }) are not a WebAssembly module (${reason})`;
            advice = "Pass this package's clustering.wasm: its bytes, its URL or path, or the module compiled from it.";
        } else {
            reason = `the file loaded as clustering.wasm${where} is not WebAssembly (${reason}): most likely an error page (a 404) or a fallback HTML page served in its place`;
            advice = given
                ? "Check that URL or path: it must be this package's clustering.wasm, served with the application/wasm type."
                : "Check that clustering.wasm is served next to the script or emitted by your bundler (open its URL in the browser), or say where it is with init({ wasm }).";
        }
    } else if (/dynamically imported module|node:module/i.test(text)) {
        // The glue took its Node path somewhere that has Node's globals but not Node's module loader.
        reason = `Node's module loader isn't available here, in a page or worker with Node's globals but not its loader (${reason})`;
        advice = "Load the package where it can take its browser path, or report this environment as an issue.";
    } else if (isNodeLike && typeof given === 'string' && /^https?:/i.test(given)) {
        // Node fetches an http(s) URL itself (see nodeWasmFile), so the server or the network failed, not a path.
        reason = `the .wasm file could not be fetched${where}: ${reason}`;
        advice = "Check that this machine can reach that URL and that it serves this package's clustering.wasm. On a server, a path to the package's own copy (or its bytes) avoids the request.";
    } else if (/XMLHttpRequest is not defined|both async and sync fetching|failed to fetch|NetworkError|404|ENOENT/i.test(text) && isNodeLike) {
        // In Node the file is read from disk, so the browser's reasons (a CSP, an extension's resources) don't apply.
        reason = given ? `the .wasm file could not be read${where}` : 'the .wasm file could not be read (the package looks for clustering.wasm next to its script)';
        advice = given
            ? `Check that path: it must be this package's clustering.wasm (relative paths are read from the working directory, ${globalThis.process.cwd()}). ${deployAdvice}`
            : `Keep the package's dist/ files together, or say where clustering.wasm is with init({ wasm: path }). ${deployAdvice}`;
    } else if (/XMLHttpRequest is not defined|both async and sync fetching|failed to fetch|NetworkError|404|ENOENT/i.test(text)) {
        reason = given ? `the .wasm file could not be fetched${where}` : 'the .wasm file could not be fetched (the package looks for clustering.wasm next to its script)';
        const blocked = " If it is there, something may block the request: a Content-Security-Policy's connect-src, or, in a browser extension's content script, a clustering.wasm not listed in web_accessible_resources (the browser's console names the URL).";
        advice = given
            ? `Check that URL or path: it must be this package's clustering.wasm, served (not a 404) with the application/wasm type.${blocked}`
            : `Check that clustering.wasm is served next to the script or emitted by your bundler, or say where it is with init({ wasm }).${blocked}`;
    } else if (given) {
        advice = `Check what init({ wasm }) was given${where}: it must be this package's clustering.wasm (its URL or path, its bytes, or the module compiled from it).`;
    } else if (isNodeLike) {
        // The glue's `new URL('clustering.wasm', import.meta.url)`, with import.meta emptied by a CommonJS bundle.
        if (/Invalid URL/i.test(reason)) {reason = "the package doesn't know where clustering.wasm is (bundled into CommonJS, it has lost its own URL)";}
        advice = `If the package was bundled (a server build, a CommonJS bundle from esbuild or Rollup, a plugin's single file), the bundler moved clustering.wasm or dropped what tells the package where it is, and the package's own copy wasn't found from the working directory either: leave the package out of the bundle (mark it external; in Next.js, serverExternalPackages: ['agglomerative-clustering']), or say where the file is with init({ wasm: path }) or give its bytes. ${deployAdvice}`;
    } else if (!isBrowserLike()) {
        // A server runtime that isn't Node (an edge runtime, Deno Deploy): it has no page, so a CSP or a 404 page are unlikely.
        if (/Invalid URL/i.test(reason)) {reason = "the package can't tell where clustering.wasm is in this runtime";}
        advice = "Give the module to init({ wasm }) before the first call: in an edge runtime (Cloudflare Workers, Vercel's), import clustering.wasm as a compiled module (the docs show how for Cloudflare Workers and Next.js: https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/environments.md); elsewhere its bytes or URL.";
    } else {
        advice = "Check that clustering.wasm is served next to the script (not a 404, and with the application/wasm type) and allowed by the page's Content-Security-Policy, or say where it is with init({ wasm }).";
    }
    return Object.assign(fail('wasm-load-failed', `Could not load the WebAssembly module: ${reason || 'unknown error'}. ${advice}`), {cause});
};

// The .wasm and the script that drives it are built together, and the byte layouts and entry points between them are
// not a public interface. One left over from another version (a stale cache, a CDN serving an old file, an `init({ wasm })`
// pointing at the wrong one) would misbehave in ways nothing explains, so the module says which version it is and a
// mismatch is reported when it loads.
const checkWasmVersion = (instance) => {
    // A module from before 3.0 has no version export (the glue's wrapper then throws or returns nothing), and one that isn't
    // this library's at all may have none either: both are reported as a version mismatch, never as a stray TypeError.
    let found = '';
    try {
        const pointer = instance._library_version();
        const heap = instance.HEAPU8;
        if (typeof pointer === 'number' && pointer > 0 && heap) {
            let end = pointer;
            while (heap[end] !== 0 && end - pointer < 64) {end++;}
            found = String.fromCharCode(...heap.subarray(pointer, end));
        }
    } catch (error) {/* no version export */}
    const expected = `agglomerative-clustering@${version}`;
    if (found !== expected) {
        const what = found ? found : 'from another version (one from before 3.0, which does not say which, or not this library\'s module at all)';
        throw fail('wasm-load-failed', `The WebAssembly module is ${what}, but this script is ${expected}: a stale or mixed-up clustering.wasm (a cache or CDN serving another version, or init({ wasm }) pointing at one). Serve the .wasm that came with this version of the package.`);
    }
};

// Instantiates the module from init's `wasm` option (undefined: the glue finds the .wasm next to itself).
const instantiate = (wasm) => {
    let reject;
    const failed = new Promise((_, r) => {reject = r;});
    failed.catch(() => {});
    // The glue's own console output (failed fetches, "Aborted()") is turned off: every failure reaches the caller as an error.
    const quiet = {print: () => {}, printErr: () => {}};
    return Promise.race([createWasmModule({...quiet, ...wasmSettings(wasm, reject)}), failed]);
};

// The bytes of this package's clustering.wasm as Node resolves it from the working directory, for when the copy next to
// the script is missing (see acquire). The specifiers are built at run time so bundlers leave them alone (see worker.js).
const packagedWasm = async () => {
    const {createRequire} = await import(/* webpackIgnore: true */ /* @vite-ignore */ ['node', 'module'].join(':'));
    const {readFile} = await import(/* webpackIgnore: true */ /* @vite-ignore */ ['node', 'fs/promises'].join(':'));
    const file = createRequire(`${globalThis.process.cwd()}/`).resolve('agglomerative-clustering/clustering.wasm');
    return readFile(file);
};

// In Node, init({ wasm }) given a path or a file: URL reads the file here and hands the glue its bytes. The glue reads files
// itself only when it knows it runs in Node, which it tells from import.meta.url; in a server build bundled into CommonJS
// (esbuild, Rollup, a VS Code or Obsidian plugin) that is gone, so it would try to fetch the path as if in a browser.
// Anything else (an http(s) URL, bytes, a module) is left as it is. Returns null when the option is not a file.
const nodeWasmFile = async (wasm) => {
    if (!isNodeLike) {return null;}
    const text = typeof wasm === 'string' ? wasm : isURL(wasm) ? wasm.href : null;
    if (text === null) {return null;}
    const isFileUrl = /^file:/i.test(text);
    // A string with a scheme (http:, data:, blob:) is a URL; a Windows drive letter (C:\) is a path.
    // An http(s) URL is fetched here: the glue would read it as a file path in Node.
    if (/^https?:/i.test(text)) {
        const response = await fetch(text);
        if (!response.ok) {throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);}
        return new Uint8Array(await response.arrayBuffer());
    }
    if (!isFileUrl && /^[a-z][a-z0-9+.-]+:/i.test(text) && !/^[a-z]:[\\/]/i.test(text)) {return null;}
    const {readFile} = await import(/* webpackIgnore: true */ /* @vite-ignore */ ['node', 'fs/promises'].join(':'));
    if (!isFileUrl) {return readFile(text);}
    const {fileURLToPath} = await import(/* webpackIgnore: true */ /* @vite-ignore */ ['node', 'url'].join(':'));
    return readFile(fileURLToPath(text));
};

// The module loads once: concurrent calls share one load, and a load that fails is forgotten, so it can be retried.
let loading = null;

// Calls get the instance they run on from `acquire` and keep using it, so replacing the current instance (see `discard`)
// never changes the module under a call already in flight.
const acquire = async (options) => {

    if (options === undefined) {options = {};}
    if (!isOptionsObject(options)) {
        throw fail('invalid-argument', "Invalid options: expected an object.", 'options');
    }
    options = snapshot(options);
    for (const key of Object.keys(options)) {
        if (key !== 'wasm') {throw fail('invalid-argument', `Invalid option '${key}': expected wasm.`, `options.${key}`);}
    }
    // Checked on every call, so a bad value is reported even when the module is already loaded.
    wasmSettings(options.wasm, () => {});
    if (Module) {return Module;}

    if (!loading) {
        const wasm = options.wasm;
        loading = (async () => {
            let instance;
            try {
                const file = await nodeWasmFile(wasm);
                instance = await instantiate(file === null ? wasm : file);
            } catch (error) {
                // In Node, a bundler that rewrote the glue's `new URL('clustering.wasm', import.meta.url)` (a Next.js server
                // build, say) leaves it pointing at a file that isn't there. The package's own copy is then looked for the
                // way Node resolves packages, from the working directory; if that fails too, the first error is reported.
                const fallback = wasm === undefined && isNodeLike ? await packagedWasm().catch(() => null) : null;
                if (!fallback) {throw wasmLoadFailed(error, typeof wasm === 'string' ? wasm : isURL(wasm) ? wasm.href : wasm !== undefined);}
                instance = await instantiate(fallback).catch(() => {throw wasmLoadFailed(error, false);});
            }
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
// WebAssembly memory only grows: an instance that once held a huge image keeps all that memory for the life of the process.
// So when a call leaves the heap larger than this, the instance is retired like an aborted one: calls already running keep
// it, the next call loads a fresh one (a few milliseconds, next to the seconds such an image took), and the old memory is
// freed when nothing uses it any more.
const retireAbove = 256 * 1024 * 1024;
const retireIfLarge = (instance) => {
    if (instance.HEAPU8 && instance.HEAPU8.length > retireAbove) {discard(instance);}
};
// What to try depends on the call: a large input has to shrink whatever else changes, and `precision: 6` helps only a
// clustering (`precision` given) that isn't already at 6 or below.
const outOfMemory = (bytes, precision) => {
    const large = bytes >= 2 ** 28;
    const tries = [];
    if (large) {tries.push(`scale the image down (its pixels alone are ${sizeText(bytes)}; a few megapixels give as good a palette)`);}
    if (precision > 6) {tries.push('try `precision: 6`, which bounds the memory an image with very many colours needs');}
    if (!large) {tries.push('use a smaller image');}
    const text = tries.join(', or ');
    return fail('out-of-memory', `The WebAssembly module ran out of memory (it can use up to 2 GB for one image). ${text[0].toUpperCase()}${text.slice(1)}.`);
};

const unpack = (wasm, pointer) => {
    const lengthBuffer = new Uint8Array(wasm.HEAPU8.subarray(pointer, pointer + 4));
    const length = lengthBuffer[0] | (lengthBuffer[1] << 8) | (lengthBuffer[2] << 16) | (lengthBuffer[3] << 24);
    const outputBuffer = new Uint8Array(wasm.HEAPU8.subarray(pointer + 4, pointer + 4 + length));
    return outputBuffer;
};

// A Uint8Array over exactly the same bytes, so views into a larger buffer (subarrays) stay views of their own range.
const bytes = (data) => isUint8Array(data) ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);




// The bytes a call works on are read when it is made, as with any function that takes an array: the caller may reuse
// or change the array as soon as the call returns. Once the module is loaded the bytes go into its memory before the
// call returns; until then (the first call) a copy is kept for when it has loaded.
const held = (data) => Module ? data : data.slice();

// width and height are copied to results and used for dithering, so each must make sense on its own: a whole number of
// pixels that divides the pixel count (and, when both are given, account for exactly the pixels in the data).
const checkSize = (pixels, size, name, argument) => {
    if (size === undefined) {return;}
    if (!Number.isInteger(size) || size < 0) {
        throw fail('invalid-argument', `Invalid ${name}: must be a whole number of pixels.`, argument);
    }
    if (pixels > 0 && (size === 0 || pixels % size !== 0)) {
        throw fail('invalid-argument', `Invalid ${name}: ${size} does not divide the image's ${pixels} pixels into whole rows.`, argument);
    }
};

// The rgb-as-rgba warning for an image, decided before load() and given only once the call's own checks have passed,
// just before it starts work, so the one warning isn't spent on a call that fails anyway (PRINCIPLES "Warnings").
const noWarning = () => {};
const warningFor = (image) => {
    const code = bareRgbWarning(image);
    return code ? () => warnOnce(code, image.byteLength) : noWarning;
};

const load = (image) => {

    if (isClustering(image) || isPalette(image)) {
        const what = isClustering(image) ? 'a clustering (from buildClustering)' : 'a palette';
        const fix = isClustering(image) ? 'To cut a palette from it, use getPaletteFromClustering (or quantizeFromClustering to map an image with it).' : 'To map an image to it, use quantizeWithPalette(image, palette).';
        throw fail('invalid-argument', `Invalid image: this is ${what}, not pixels. ${fix}`, 'image');
    }

    if (ArrayBuffer.isView(image) && isDetached(image)) {
        throw detachedError('bare');
    }

    if (isUint8Array(image)) {
        const encoded = sniffImageFormat(image);
        if (encoded) {
            throw fail('invalid-argument', `Invalid image: these bytes are an encoded ${encoded} file, not pixels. Decode them to pixels first and pass those ("Decoding image files" in the guides has a recipe for Node, browsers and edge runtimes). If they really are raw RGBA pixels, pass { data, format: 'rgba' } to say so.`, 'image');
        }
        if (image.length % 4 !== 0) {throw fail('invalid-argument', "Invalid image data: length must be a multiple of 4 for 'rgba'.", 'image');}
        return {data: held(image), format: 'rgba'};
    }

    if (isImageData(image)) {
        if (isDetached(image.data)) {
            throw detachedError('imagedata');
        }
        checkImageDataPixels(image);
        return {data: held(bytes(image.data)), format: 'rgba', width: image.width};
    }

    if (ArrayBuffer.isView(image)) {
        throw fail('invalid-argument', "Invalid image: a bare typed array must be a Uint8Array of RGBA bytes. For a Uint8ClampedArray such as imageData.data, pass the ImageData itself or { data, format: 'rgba' }.", 'image');
    }

    if (typeof image !== 'object' || !image || !image.data || !image.format) {
        throw fail('invalid-argument', `Invalid image: expected object with \`data\` and \`format\`.${imageHint(image)}`, 'image');
    }

    if (!isUint8Array(image.data) && !isUint8ClampedArray(image.data)) {
        throw fail('invalid-argument', "Invalid image data: must be Uint8Array or Uint8ClampedArray.", 'image');
    }
    if (isDetached(image.data)) {
        throw detachedError('data');
    }

    if (!imageFormats.includes(image.format)) {
        throw fail('invalid-argument', `Invalid format: got ${describe(image.format)}; it must be ${formatNames}.${formatHint(image.format)}`, 'image');
    }

    const stride = channels(image.format);
    if (image.data.length % stride !== 0) {
        throw fail('invalid-argument', `Invalid image data: length must be a multiple of ${stride} for '${image.format}'.`, 'image');
    }

    const pixels = image.data.length / stride;
    checkSize(pixels, image.width, 'image width', 'image');
    checkSize(pixels, image.height, 'image height', 'image');
    if (image.width !== undefined && image.height !== undefined && image.width * image.height !== pixels) {
        throw fail('invalid-argument', `Invalid image: width x height (${image.width} x ${image.height}) does not match its ${pixels} pixels.`, 'image');
    }

    return {data: held(bytes(image.data)), format: image.format, width: image.width};

};

const getWrapper = (image) => {
    if (isImageData(image)) {
        // In the input's own class and colour space (see imageDataLike).
        return (output) => imageDataLike(image, new Uint8ClampedArray(output.buffer));
    }
    if (!isUint8Array(image) && typeof image === 'object' && image && image.data && image.format) {
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
const unpackIndices = (output, image, colorSpace) => {
    const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
    const entries = view.getUint32(0, true);
    const transparent = view.getInt32(4, true);
    const indexBytes = view.getUint32(8, true);
    const palette = markPalette(output.slice(12, 12 + 3 * entries), colorSpace);
    const start = 12 + 3 * entries;
    const count = (output.length - start) / indexBytes;
    const Indices = indexBytes === 1 ? Uint8Array : indexBytes === 2 ? Uint16Array : Uint32Array;
    const indices = new Indices(count);
    // Little-endian, like the WASM heap, which Emscripten's own typed-array views already assume of the host.
    new Uint8Array(indices.buffer).set(output.subarray(start));
    // `colors` is the palette without the transparent entry, ready to map with again (the entry is black and takes no part in matching)
    const colors = transparent < 0 ? palette : markPalette(palette.slice(0, 3 * transparent), colorSpace);
    const result = {palette, colors, indices, indexBits: 8 * indexBytes, transparentIndex: transparent < 0 ? null : transparent};
    if (!isUint8Array(image)) {
        if (image.width !== undefined) {result.width = image.width;}
        if (image.height !== undefined) {result.height = image.height;}
    }
    return result;
};

// Returns k, validated. Any k above the number of colours means all of them, so it is capped at the largest value
// the WASM side holds (a larger one would overflow its int).
const check = (k) => {

    if (typeof k !== 'number' || !Number.isInteger(k) || k <= 0) {
        // A string is the usual slip (an input's `value`), so it gets its own fix.
        const got = typeof k === 'string' ? ` Got the string ${JSON.stringify(k.length > 20 ? `${k.slice(0, 20)}…` : k)}: convert it first, e.g. Number(input.value).`
            : typeof k === 'number' ? ` Got ${k}.` : ` Got ${k === null ? 'null' : typeof k}.`;
        throw fail('invalid-argument', `Invalid k: must be a whole number of colours, 1 or more.${got}`, 'k');
    }
    return Math.min(k, 0x7FFFFFFF);

}

// Validates `options` against the keys a function accepts and fills in defaults:
//   colorSpace: 'rgb' (default) or 'oklab', the space colours are clustered and matched in; when mapping with a
//               clustering, the default is the space the clustering was made in (code -1)
//   alpha:      'weight' (default) counts RGBA pixels in proportion to their opacity; 'ignore' counts every pixel
//   precision:  bits per channel, 1-8 (default 8, exact); lower values group similar colours before clustering
//   dither:     false (default), true or a strength in [0, 1] (Floyd-Steinberg), a method name, or { method, strength, steps } (see parseDither)
//   width:      image width in pixels, needed to dither a Uint8Array or a RawImage without `width`
//   signal, onProgress: an AbortSignal and a progress callback, which make the clustering run in slices (see clusterInSlices)
//   transparent: false (default), true (cutoff 128) or a cutoff from 1 to 255: pixels with alpha below it are left out of clustering (and the rest count whole);
//               indexed output also gives them their own entry, which counts towards k

// The settings of dither, which a caller may write as options of their own; naming one of these gets a pointer to the
// object form.
const ditherSettings = ['ditherMethod', 'ditherStrength', 'ditherSteps', 'method', 'strength', 'steps', 'mix'];

const parseOptions = (options, allowed, image) => {

    if (options === undefined) {options = {};}
    if (!isOptionsObject(options)) {
        throw fail('invalid-argument', "Invalid options: expected an object.", 'options');
    }
    options = snapshot(options);
    for (const key of Object.keys(options)) {
        if (!allowed.includes(key)) {
            const hint = allowed.includes('dither') && ditherSettings.includes(key) ? ' Dithering settings go inside the dither option: dither: { method, strength, steps }.'
                : key === 'onProgress' && allowed.includes('signal') ? ' The functions that only map pixels take just signal, checked before they start: for progress, map the image in strips of rows (https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/guides.md#cancelling-or-showing-progress-while-mapping-a-large-image).' : '';
            throw fail('invalid-argument', `Invalid option '${key}': expected one of ${allowed.join(', ')}.${hint}`, `options.${key}`);
        }
    }

    const colorSpace = options.colorSpace === undefined ? 'rgb' : options.colorSpace;
    if (!colorSpaces.includes(colorSpace)) {
        throw fail('invalid-argument', "Invalid colorSpace: must be 'rgb' or 'oklab'.", 'options.colorSpace');
    }

    const alpha = options.alpha === undefined ? 'weight' : options.alpha;
    if (!Object.keys(alphaModeCodes).includes(alpha)) {
        throw fail('invalid-argument', "Invalid alpha: must be 'weight' or 'ignore'.", 'options.alpha');
    }

    const precision = options.precision === undefined ? 8 : options.precision;
    if (typeof precision !== 'number' || !Number.isInteger(precision) || precision < 1 || precision > 8) {
        throw fail('invalid-argument', "Invalid precision: must be an integer from 1 to 8.", 'options.precision');
    }

    const {strength: dither, method: ditherMethod, steps: ditherSteps} = parseDither(options.dither);

    // The image's own width and options.width are two sources for one fact: they may repeat each other, but not disagree
    // (a wrong row length would dither without an error, as long as it divides the pixel count).
    if (options.width !== undefined && image && image.width !== undefined && options.width !== image.width) {
        throw fail('invalid-argument', `Invalid width: options.width (${options.width}) does not match the image's width (${image.width}).`, 'options.width');
    }
    if (options.width !== undefined && image) {
        checkSize(image.data.length / channels(image.format), options.width, 'width', 'options.width');
    }
    const width = options.width !== undefined ? options.width : image ? image.width : undefined;
    if (dither > 0) {
        const stride = channels(image.format);
        if (typeof width !== 'number' || !Number.isInteger(width) || width <= 0) {
            throw fail('invalid-argument', "Invalid width: dithering needs the image width, as `options.width` or the image's `width`.", 'options.width');
        }
        if ((image.data.length / stride) % width !== 0) {
            throw fail('invalid-argument', "Invalid width: the image's pixel count is not a multiple of it.", 'options.width');
        }
    }

    const signal = options.signal;
    if (signal !== undefined && (signal === null || typeof signal !== 'object' || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function')) {
        throw fail('invalid-argument', "Invalid signal: must be an AbortSignal.", 'options.signal');
    }
    const onProgress = options.onProgress;
    if (onProgress !== undefined && typeof onProgress !== 'function') {
        throw fail('invalid-argument', "Invalid onProgress: must be a function.", 'options.onProgress');
    }

    // The alpha cutoff for indexed output: 0 for none, else the pixels with alpha below it are transparent.
    const transparentOption = options.transparent === undefined ? false : options.transparent;
    const transparent = transparentOption === false ? 0 : transparentOption === true ? 128 : transparentOption;
    if (!Number.isInteger(transparent) || transparent < 0 || transparent > 255 || (transparent === 0 && transparentOption !== false)) {
        throw fail('invalid-argument', "Invalid transparent: must be a boolean or an integer alpha cutoff from 1 to 255.", 'options.transparent');
    }

    // A cutoff replaces opacity weighting (pixels count whole or not at all), so naming both would leave one of them ignored.
    if (transparent > 0 && options.alpha !== undefined) {
        throw fail('invalid-argument', "Invalid options: `transparent` replaces `alpha` (with a cutoff, pixels count whole or not at all), so give one or the other.", 'options');
    }

    return {colorSpace: colorSpaceCodes[colorSpace], colorSpaceGiven: options.colorSpace !== undefined, alpha: alphaModeCodes[alpha], precision, dither, ditherMethod, ditherSteps, width: dither > 0 ? width : 0, transparent, transparentGiven: options.transparent !== undefined, signal, onProgress};

};

const controlOptions = ['signal', 'onProgress'];
const clusterOptions = ['colorSpace', 'precision', 'alpha', 'transparent', ...controlOptions];
const quantizeOptions = [...clusterOptions, 'dither', 'width'];
// The functions that only map pixels take just `signal`, checked before they start: mapping runs in one piece (milliseconds
// for a photo, seconds for a large image dithered; the guides show how to map in strips or cancel through a worker).
const mapOptions = ['colorSpace', 'dither', 'width', 'signal'];
const quantizeIndexOptions = quantizeOptions;
const mapIndexOptions = [...mapOptions, 'transparent'];



// An empty palette is what getPalette gives for an image with no visible pixels, and mapping such an image with it is
// fine. Mapping visible pixels to it has no answer (they would all come out black), so that is an error. `cutoff` is the
// alpha from which an RGBA pixel needs a colour.
const checkNotEmpty = (palette, image, cutoff) => {
    if (palette.length > 0) {return;}
    const data = image.data;
    let visible = hasAlpha(image.format) ? false : data.length > 0;
    for (let i = 3; !visible && hasAlpha(image.format) && i < data.length; i += 4) {visible = data[i] >= cutoff;}
    if (visible) {throw fail('invalid-argument', "Invalid palette: it is empty, but the image has visible pixels to map to it.", 'palette');}
};

// The space to match pixels to a palette in: the one the caller names, else the one a Palette was made in, else RGB.
const matchingSpace = (o, palette) => o.colorSpaceGiven ? o.colorSpace : colorSpaceCodes[isPalette(palette) ? palette.colorSpace : 'rgb'];

// Allocates `length` bytes in the WASM heap, or throws a coded out-of-memory error.
const allocate = (wasm, length) => {
    if (length >= maxBytes) {throw tooLarge(length);}
    const pointer = wasm._malloc(length);
    if (!pointer) {throw fail('out-of-memory', length >= 2 ** 28 ? `Failed to allocate ${sizeText(length)} of WASM memory for the input: the module has at most 2 GB in all, so an image this size leaves too little room for the work on it. Scale the image down first.` : "Failed to allocate WASM memory.");}
    return pointer;
};

// Copies each buffer into the WASM heap, calls `fn` with their pointers, and returns the unpacked output,
// freeing everything afterwards. `precision` is given for a clustering, for the out-of-memory advice.
const call = (wasm, buffers, fn, precision) => {
    const pointers = [];
    let outputPointer = 0;
    let aborted = false;
    try {
        for (const buffer of buffers) {
            const pointer = allocate(wasm, buffer.length);
            pointers.push(pointer);
            wasm.HEAPU8.set(buffer, pointer);
        }
        outputPointer = fn(...pointers);
        // Only the functions that read a clustering return nothing: when its records don't fit together (see
        // _get_palette_from_clustering), which a clustering whose checksum matches never does.
        if (!outputPointer) {throw fail('invalid-clustering', "Invalid clustering: its records don't fit together, so it is damaged or isn't a clustering. Cluster the image again.", 'clustering');}
        return unpack(wasm, outputPointer);
    } catch (error) {
        if (!isAbort(error)) {throw error;}
        aborted = true;
        discard(wasm);
        throw outOfMemory(buffers[0].length, precision);
    } finally {
        // After an abort the instance is being thrown away, and its allocator can't be trusted.
        if (!aborted) {
            for (const pointer of pointers) {wasm._free(pointer);}
            if (outputPointer) {wasm._free(outputPointer);}
            retireIfLarge(wasm);
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
    const imagePointer = allocate(wasm, image.data.length);
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
        throw outOfMemory(image.data.length, o.precision);
    } finally {
        if (!aborted) {
            if (job) {wasm._clustering_job_free(job);}
            wasm._free(imagePointer);
            retireIfLarge(wasm);
        }
    }
};

// The functions that read a clustering take no options: a clustering already says how it was made. An options object passed
// anyway (say { colorSpace: 'oklab' }, expecting it to apply) would be silently ignored, so it is an error. undefined is fine.
// `name` is how the caller wrote the call: the function, or the method (`clustering.getPalette`), whose message points at
// the method form of mapping.
const noOptions = (name, extra) => {
    if (extra.some((value) => value !== undefined)) {
        const alternative = name.startsWith('clustering.') ? 'clustering.quantize' : 'quantizeFromClustering';
        throw fail('invalid-argument', `Invalid arguments: ${name} takes no options (a clustering already records its colour space, precision and cutoff). To map pixels with other options, use ${alternative}.`, 'options');
    }
};

// Every function checks its arguments and takes its bytes (see `held`) before it waits for anything: when the module is
// already loaded, `Module || await acquire()` doesn't wait, and the work up to the first slice of a long clustering
// happens before the call returns.

export const buildClustering = async (image, options) => {

    const warn = warningFor(image);
    image = load(image);
    const o = parseOptions(options, clusterOptions, image);
    warn();
    const wasm = Module || await acquire();

    if (isControlled(o)) {
        const report = reporter(o);
        const clustering = await clusterInSlices(wasm, image, o, report, 1);
        report(1);
        return markClustering(clustering);
    }

    return markClustering(call(wasm, [image.data], (imagePointer) => wasm._get_clustering(imagePointer, image.data.length, codes[image.format], o.colorSpace, o.precision, o.alpha, o.transparent), o.precision));

};
/** @deprecated The same function as buildClustering, its name before 3.4.0. Removed in 4.0. */
export const getClustering = buildClustering;

export const buildPalette = async (image, k, options) => {

    const warn = warningFor(image);
    image = load(image);
    k = check(k);
    const o = parseOptions(options, clusterOptions, image);
    warn();
    const wasm = Module || await acquire();

    if (isControlled(o)) {
        const report = reporter(o);
        const clustering = await clusterInSlices(wasm, image, o, report, 0.99);
        checkAborted(o.signal);
        const palette = call(wasm, [clustering], (clusteringPointer) => wasm._get_palette_from_clustering(clusteringPointer, clustering.length, k));
        report(1);
        return markPalette(palette, colorSpaceName(o.colorSpace));
    }

    return markPalette(call(wasm, [image.data], (imagePointer) => wasm._get_palette(imagePointer, image.data.length, codes[image.format], k, o.colorSpace, o.precision, o.alpha, o.transparent), o.precision), colorSpaceName(o.colorSpace));

};
/** @deprecated The same function as buildPalette, its name before 3.4.0. Removed in 4.0. */
export const getPalette = buildPalette;

// The cuts take the name they were called by, for their messages: the functions below, or the methods on Clustering.
const cutPalette = async (name, clustering, k, extra) => {

    const header = readHeader(clustering);
    k = check(k);
    noOptions(name, extra);
    clustering = held(clustering);
    const wasm = Module || await acquire();

    return markPalette(call(wasm, [clustering], (clusteringPointer) => wasm._get_palette_from_clustering(clusteringPointer, clustering.length, k)), colorSpaceName(header.colorSpace));

};

export const getPaletteFromClustering = (clustering, k, ...extra) => cutPalette('getPaletteFromClustering', clustering, k, extra);

// The weight of each colour in the k-colour cut, in pixels (opacity-weighted), read from the clustering's records.
const weightsOf = (wasm, clustering, header, k) => {
    const bytes = call(wasm, [clustering], (clusteringPointer) => wasm._get_palette_weights(clusteringPointer, clustering.length, k));
    if (header.merges > 0 && bytes.length === 0) {throw fail('invalid-clustering', "Invalid clustering: its weights are inconsistent.", 'clustering');}
    return new Float64Array(bytes.buffer, bytes.byteOffset, bytes.length / 8);
};

// The functions that report weights (swatches, the error curve) need a clustering from 3.x: 2.x recorded none. The others
// (palettes and mapping) still read 2.x clusterings.
const needsWeights = (header) => {
    if (header.version < 3) {
        throw fail('unsupported-version', `Unsupported clustering: format version ${header.version} (agglomerative-clustering ${header.version}.x) has no weights. Cluster the image again.`, 'clustering');
    }
};

// A palette with the weight and share of the image of each of its colours, from one cut of one clustering, so the three
// arrays line up by construction. Weights are pixels: fully transparent pixels count 0 and partly transparent ones in
// proportion to their opacity, as in clustering. Shares are the weights divided by their total, so they sum to 1.
const cutSwatches = async (name, clustering, k, extra) => {

    const header = readHeader(clustering);
    k = check(k);
    noOptions(name, extra);
    needsWeights(header);
    clustering = held(clustering);
    const wasm = Module || await acquire();

    const palette = markPalette(call(wasm, [clustering], (clusteringPointer) => wasm._get_palette_from_clustering(clusteringPointer, clustering.length, k)), colorSpaceName(header.colorSpace));
    const weights = weightsOf(wasm, clustering, header, k);
    let total = 0;
    for (const weight of weights) {total += weight;}
    const shares = new Float64Array(weights.length);
    if (total > 0) {for (let i = 0; i < weights.length; i++) {shares[i] = weights[i] / total;}}
    return {palette, weights, shares};

};

export const getSwatchesFromClustering = (clustering, k, ...extra) => cutSwatches('getSwatchesFromClustering', clustering, k, extra);

// The same for an image: clusters it, then cuts, like getPalette.
export const buildSwatches = async (image, k, options) => {

    // Arguments are checked in the order they are given (image, then k, then options), as in every other function.
    load(image);
    k = check(k);
    return getSwatchesFromClustering(await buildClustering(image, options), k);

};
/** @deprecated The same function as buildSwatches, its name before 3.4.0. Removed in 4.0. */
export const getSwatches = buildSwatches;

// What a clustering holds, read from its header and records without the WASM module. `mse[k - 1]` is the mean
// squared error per channel of the k-colour clustering: each pixel's squared distance to its cluster's colour,
// weighted as in clustering, in 8-bit RGB values (RGB) or OKLab units (OKLab).
const readInfo = async (name, clustering, extra) => {

    const header = readHeader(clustering);
    noOptions(name, extra);
    needsWeights(header);
    const colors = header.merges + (clustering.length >= header.headerLength + 3 ? 1 : 0);
    const info = {formatVersion: header.version, colorSpace: colorSpaceName(header.colorSpace), precision: header.precision, transparent: header.transparent === 0 ? false : header.transparent, maxColors: colors, totalWeight: 0, mse: null, explained: null};

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
    // Errors are sums of squares, so a cost that is negative or not a number can only come from damaged bytes (a clustering
    // from 3.0.0-beta.1 has no checksum to catch them first).
    for (let i = 0; i < colors; i++) {
        if (!(info.mse[i] >= 0) || !Number.isFinite(info.mse[i])) {throw fail('invalid-clustering', "Invalid clustering: its recorded errors are not valid numbers, so it is damaged. Cluster the image again.", 'clustering');}
    }
    // The share of the image's variance each palette size keeps; 1 throughout for an image of one colour.
    for (let i = 0; i < colors; i++) {
        info.explained[i] = info.mse[0] > 0 ? Math.max(0, Math.min(1, 1 - info.mse[i] / info.mse[0])) : 1;
    }
    return info;

};

export const getClusteringInfo = (clustering, ...extra) => readInfo('getClusteringInfo', clustering, extra);

export const quantize = async (image, k, options) => {

    const warn = warningFor(image);
    const wrap = getWrapper(image);
    image = load(image);
    k = check(k);
    const o = parseOptions(options, quantizeOptions, image);
    warn();
    const wasm = Module || await acquire();

    if (isControlled(o)) {
        const report = reporter(o);
        const clustering = await clusterInSlices(wasm, image, o, report, 0.9);
        checkAborted(o.signal);
        const mapped = wrap(call(wasm, [image.data, clustering], (imagePointer, clusteringPointer) => wasm._quantize_with_clustering(imagePointer, image.data.length, codes[image.format], clusteringPointer, clustering.length, k, o.colorSpace, o.dither, o.ditherMethod, o.ditherSteps, o.width)));
        report(1);
        return mapped;
    }

    return wrap(call(wasm, [image.data], (imagePointer) => wasm._quantize(imagePointer, image.data.length, codes[image.format], k, o.colorSpace, o.precision, o.alpha, o.dither, o.ditherMethod, o.ditherSteps, o.width, o.transparent), o.precision));

};

export const quantizeFromClustering = async (image, clustering, k, options) => {

    const warn = warningFor(image);
    const wrap = getWrapper(image);
    image = load(image);
    readHeader(clustering);
    k = check(k);
    const o = parseOptions(options, mapOptions, image);
    clustering = held(clustering);
    warn();
    const wasm = Module || await acquire();
    checkAborted(o.signal);
    const colorSpace = o.colorSpaceGiven ? o.colorSpace : -1;

    const result = wrap(call(wasm, [image.data, clustering], (imagePointer, clusteringPointer) => wasm._quantize_with_clustering(imagePointer, image.data.length, codes[image.format], clusteringPointer, clustering.length, k, colorSpace, o.dither, o.ditherMethod, o.ditherSteps, o.width)));
    return result;

};

export const quantizeWithPalette = async (image, palette, options) => {

    const warn = warningFor(image);
    const wrap = getWrapper(image);
    image = load(image);
    checkPalette(palette);
    const o = parseOptions(options, mapOptions, image);
    checkNotEmpty(palette, image, 1);
    const space = matchingSpace(o, palette);
    palette = held(palette);
    warn();
    const wasm = Module || await acquire();
    checkAborted(o.signal);

    const result = wrap(call(wasm, [image.data, palette], (imagePointer, palettePointer) => wasm._quantize_with_palette(imagePointer, image.data.length, codes[image.format], palettePointer, palette.length, space, o.dither, o.ditherMethod, o.ditherSteps, o.width)));
    return result;

};

export const quantizeToIndices = async (image, k, options) => {

    const warn = warningFor(image);
    const original = image;
    image = load(image);
    k = check(k);
    const o = parseOptions(options, quantizeIndexOptions, image);
    warn();
    const wasm = Module || await acquire();

    if (isControlled(o)) {
        const report = reporter(o);
        const clustering = await clusterInSlices(wasm, image, o, report, 0.9);
        checkAborted(o.signal);
        const indexed = unpackIndices(call(wasm, [image.data, clustering], (imagePointer, clusteringPointer) => wasm._quantize_indices_with_clustering(imagePointer, image.data.length, codes[image.format], clusteringPointer, clustering.length, k, o.colorSpace, o.dither, o.ditherMethod, o.ditherSteps, o.width, o.transparent)), original, colorSpaceName(o.colorSpace));
        report(1);
        return indexed;
    }

    return unpackIndices(call(wasm, [image.data], (imagePointer) => wasm._quantize_indices(imagePointer, image.data.length, codes[image.format], k, o.colorSpace, o.precision, o.alpha, o.dither, o.ditherMethod, o.ditherSteps, o.width, o.transparent), o.precision), original, colorSpaceName(o.colorSpace));

};

export const quantizeToIndicesFromClustering = async (image, clustering, k, options) => {

    const warn = warningFor(image);
    const original = image;
    image = load(image);
    const header = readHeader(clustering);
    k = check(k);
    const o = parseOptions(options, mapIndexOptions, image);
    clustering = held(clustering);
    warn();
    const wasm = Module || await acquire();
    checkAborted(o.signal);
    const colorSpace = o.colorSpaceGiven ? o.colorSpace : -1;

    // The cutoff the clustering was made with is the default, so clustering and mapping agree unless a cutoff is named.
    const cutoff = o.transparentGiven ? o.transparent : header.transparent;

    const result = unpackIndices(call(wasm, [image.data, clustering], (imagePointer, clusteringPointer) => wasm._quantize_indices_with_clustering(imagePointer, image.data.length, codes[image.format], clusteringPointer, clustering.length, k, colorSpace, o.dither, o.ditherMethod, o.ditherSteps, o.width, cutoff)), original, colorSpaceName(header.colorSpace));
    return result;

};

export const quantizeToIndicesWithPalette = async (image, palette, options) => {

    const warn = warningFor(image);
    const original = image;
    image = load(image);
    checkPalette(palette);
    const o = parseOptions(options, mapIndexOptions, image);
    checkNotEmpty(palette, image, o.transparent > 0 ? o.transparent : 1);
    const space = matchingSpace(o, palette);
    const paletteSpace = isPalette(palette) ? palette.colorSpace : colorSpaceName(space);
    palette = held(palette);
    warn();
    const wasm = Module || await acquire();
    checkAborted(o.signal);

    const result = unpackIndices(call(wasm, [image.data, palette], (imagePointer, palettePointer) => wasm._quantize_indices_with_palette(imagePointer, image.data.length, codes[image.format], palettePointer, palette.length, space, o.dither, o.ditherMethod, o.ditherSteps, o.width, o.transparent)), original, paletteSpace);
    return result;

};

// The methods on Clustering (shared.js) run through these. Only this entry fills the slot, so the methods need it loaded.
setEngine({cut: cutPalette, cutSwatches, info: readInfo, quantizeFromClustering, quantizeToIndicesFromClustering});
