// The `agglomerative-clustering/worker` entry: the same API, run in a Web Worker (browsers) or a worker thread
// (Node), so clustering doesn't block the calling thread. `createWorker()` starts a worker with every function of
// the main entry as a method, plus `cluster`, which keeps an image and its clustering in the worker behind a
// handle, so re-cutting and re-mapping it copies nothing across. The functions exported directly use one shared
// worker, started on first use.

import {fail, isCodedError, detachedError, isOptionsObject, isUint8Array, isUint8ClampedArray, snapshot, parseDither, mark, revive, latestVersion, imageHint, isDetached, imageDataLike, isImageData, checkImageDataPixels, maxBytes, tooLarge, bareImageWarning, warnOnce, readHeader, checkImageBody, imageCopy} from './shared.js';

// The same version, types and data-format version as the main entry (one implementation, in shared.js).
export {version, Palette, Clustering, errorCodes, isCodedError, ditherMethods, ditherSteps, colorSpaces, imageFormats, alphaModes} from './shared.js';
export const formatVersion = latestVersion;

// Node's worker_threads, where this script runs from a file in Node, Bun or Deno (from npm). A runtime that only imitates Node
// (Cloudflare Workers with nodejs_compat, a CDN copy in Deno) defines process.versions.node too, but isn't loaded from a file.
// A DOM in Node (jsdom or happy-dom, in tests) defines `window` but has no Worker, so it uses worker_threads too; a page with
// Node's globals and a real Worker (an Electron renderer with nodeIntegration) uses the Web Worker. `globalThis.process`, so
// bundlers don't take this for a use of Node's `process` and add a polyfill (Parcel installs one).
const runtime = globalThis.process;
const scriptUrl = typeof import.meta.url === 'string' ? import.meta.url : '';
// Electron's pages, their Web Workers and service-worker preload realms (process.type 'renderer', 'worker' and
// 'service-worker') have Node's globals but no worker_threads.
const hasNode = !!(runtime && runtime.versions && runtime.versions.node) && !['renderer', 'worker', 'service-worker'].includes(runtime.type)
    && (typeof window === 'undefined' || typeof Worker !== 'function');
const isNode = hasNode && scriptUrl.startsWith('file:');
// Node itself (or Bun) with this script bundled into CommonJS, where import.meta.url is gone: worker_threads still works, with
// the script given, or the package's own copy. Runtimes that imitate Node say what they are in navigator.userAgent.
const isBundledNode = hasNode && !scriptUrl && (typeof navigator === 'undefined' || /^(Node\.js|Bun)\//.test(String(navigator.userAgent)));

// The worker thread's script in Node: the one next to this file, which imports the main entry (index.mjs) next to it. A
// server bundle (Next.js with webpack or Turbopack) copies the script elsewhere without what it imports, and may hand
// over its URL as another realm's URL object, which Node's Worker rejects. Then the package's own copy is used, found the
// way Node resolves packages from the working directory. Built from strings so Node's own URL class makes it.
// `chosen` is the script given with createWorker({ script }): a URL, or a path (relative to the working directory).
const nodeWorkerScript = async (chosen) => {
    const load = (name) => import(/* webpackIgnore: true */ /* @vite-ignore */ ['node', name].join(':'));
    if (chosen) {
        if (/^[a-z][a-z0-9+.-]+:/i.test(chosen) && !/^[a-z]:[\\/]/i.test(chosen)) {return new URL(chosen);}
        const [{resolve}, {pathToFileURL}] = await Promise.all([load('path'), load('url')]);
        return pathToFileURL(resolve(chosen));
    }
    // The base is a variable so bundlers don't take this Node-only URL for an asset to emit (Vite would copy the script a
    // second time for it): they look for `new URL('…', import.meta.url)` written out, which the browser branch of `start` keeps.
    const here = scriptUrl;
    const file = './worker-thread.mjs';
    let script = null;
    try {
        const made = new URL(file, here || undefined);
        script = new URL(typeof made.href === 'string' ? made.href : String(made));
    } catch (error) {/* a URL Node can't read: use the package's copy */}
    try {
        const [{existsSync}, {fileURLToPath, pathToFileURL}] = await Promise.all([load('fs'), load('url')]);
        if (script && script.protocol === 'file:' && existsSync(fileURLToPath(script)) && existsSync(fileURLToPath(new URL('./index.mjs', script)))) {return script;}
        const {createRequire} = await load('module');
        const packaged = new URL('./dist/worker-thread.mjs', pathToFileURL(createRequire(`${runtime.cwd()}/`).resolve('agglomerative-clustering/package.json')));
        if (existsSync(fileURLToPath(packaged))) {return packaged;}
    } catch (error) {/* not found: start the script as it is, and report what happens */}
    if (!script) {throw fail('worker-failed', `Worker failed: ${noWorker()}`);}
    return script;
};

// Whether a worker script at `url` is on another origin than the page (or worker) starting it.
const webOrigins = ['http:', 'https:', 'chrome-extension:', 'moz-extension:', 'safari-web-extension:'];
const isCrossOrigin = (url) => {
    try {
        const here = typeof location !== 'undefined' && location.origin;
        // http(s), and an extension's own scheme in a content script, which runs with the page's origin. (Not file:,
        // which webpack gives import.meta.url at build time, nor blob: or data:.)
        return Boolean(here) && here !== 'null' && webOrigins.includes(url.protocol) && url.origin !== here;
    } catch (error) {return false;}
};

// Whether the page (or worker) has an opaque origin: a sandboxed iframe without allow-same-origin, or a data: page.
const isOpaqueOrigin = () => {
    try {return typeof location !== 'undefined' && location.origin === 'null';} catch (error) {return false;}
};

// The page's (or worker's) base URL, to resolve relative URLs given in options against: the page, as fetch would, not the
// worker script's folder, where the worker would otherwise resolve them.
const pageBase = () => {
    try {
        if (typeof document !== 'undefined' && typeof document.baseURI === 'string') {return document.baseURI;}
        if (typeof location !== 'undefined' && typeof location.href === 'string') {return location.href;}
    } catch (error) {/* no page */}
    return undefined;
};

// Why the worker can't start where there is no Worker, by what the runtime is.
const noWorker = () => {
    if (!scriptUrl) {
        return "the worker entry can't find its worker script: it doesn't know its own URL, so it was bundled into CommonJS or a classic script, or loaded with require() (which gives the CommonJS build, made for Node and Jest). Import it as an ES module, or say where the script is with createWorker({ script }) (a copy of the package's dist/worker-thread.mjs, served next to the rest of dist/).";
    }
    if (typeof ServiceWorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof ServiceWorkerGlobalScope) {
        return "this runtime has no Worker: a service worker (a browser extension's background script, for one) can't start threads. Use the main entry, 'agglomerative-clustering', there; it runs off the page's main thread already.";
    }
    return "this runtime has no Worker (a service worker, Cloudflare Workers or another edge runtime, or a test environment without worker support can't start threads). Use the main entry, 'agglomerative-clustering', instead.";
};

// Starts the worker and returns {post, terminate, ref, unref}, with messages delivered to `receive`. `chosen` is the
// script given with createWorker({ script }) (a URL, or in Node a path), or null for the package's own.
const start = async (receive, chosen) => {
    if (!isNode && !isBundledNode) {
        if (typeof Worker !== 'function' || (!scriptUrl && !chosen)) {throw fail('worker-failed', `Worker failed: ${noWorker()}`);}
        // Where the script is when the package is used unbundled (from a CDN, say). The base is a variable so bundlers
        // leave this one alone; they rewrite the literal `new Worker(new URL(...))` below, which must stay written out.
        const here = scriptUrl;
        const script = chosen ? new URL(chosen, pageBase()) : new URL('./worker-thread.mjs', here);
        const crossOrigin = isCrossOrigin(script);
        // A page with an opaque origin (a sandboxed iframe without allow-same-origin, as plugin hosts such as Figma use) can't
        // start a worker from any http(s) script, nor, in Chromium, from a blob: URL; a data: URL module can, and imports it.
        const opaque = !crossOrigin && isOpaqueOrigin() && webOrigins.includes(script.protocol);
        const scriptHint = "Check that worker-thread.mjs is served (open its URL), with index.mjs, shared.mjs, choose.mjs, clustering.js and clustering.wasm next to it, which it imports, or say where your copy of dist/ is with createWorker({ script }) or, for the shared worker, init({ script }).";
        let worker, source = null;
        try {
            if (opaque) {
                worker = new Worker(`data:text/javascript,${encodeURIComponent(`import ${JSON.stringify(script.href)};`)}`, {type: 'module'});
            } else if (chosen && !crossOrigin) {
                worker = new Worker(script, {type: 'module'});
            } else if (crossOrigin) {
                // A page can't start a worker from another origin's script, but a worker of its own can import one: a one-line
                // module from a blob URL, which imports the script by its full URL (CDNs send the CORS headers that needs). A
                // Content-Security-Policy then needs `worker-src blob:` and the script's origin.
                source = URL.createObjectURL(new Blob([`import ${JSON.stringify(script.href)};`], {type: 'text/javascript'}));
                worker = new Worker(source, {type: 'module'});
                setTimeout(() => URL.revokeObjectURL(source), 60000);
            } else {
                // Written out in full so bundlers (Vite, webpack 5, Parcel) find and bundle the worker script.
                worker = new Worker(new URL('./worker-thread.mjs', import.meta.url), {type: 'module'});
            }
        } catch (error) {
            throw Object.assign(fail('worker-failed', `Worker failed: ${error && error.message} ${scriptHint}`), {cause: error});
        }
        worker.addEventListener('message', (event) => receive(event.data));
        worker.addEventListener('error', (event) => receive({failure: event.message ? `${event.message} ${scriptHint}` : crossOrigin
            ? `The worker failed to start: its script comes from another origin (${script.origin}), so it was started through a blob: URL, which also failed. Check that the server sends CORS headers, and that a Content-Security-Policy allows the worker: worker-src needs both blob: and ${script.origin} (the blob: worker imports the script from there). Or serve a copy of dist/ from this origin and say where with createWorker({ script }) or init({ script }).`
            : opaque
                ? `The worker failed to start from this page, whose origin is opaque (a sandboxed iframe): it was started from a data: URL importing ${script.href}, which needs CORS headers on that script and on what it imports. Or bundle worker-thread.mjs and its imports into one file, and pass it as a data: URL with createWorker({ script }).`
                : script.protocol === 'blob:' && isOpaqueOrigin()
                    // Chromium refuses blob: workers in an opaque origin; the docs' single-file recipe uses a data: URL.
                    ? `The worker failed to start from ${script.href}: in a sandboxed iframe (an opaque origin, as plugin hosts such as Figma use) Chromium can't start a worker from a blob: URL. Pass the bundled worker script as a data: URL instead, createWorker({ script: 'data:text/javascript;base64,…', wasm: bytes }) (see "Plugins and single-file hosts" in https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/docs/environments.md).`
                    : `The worker failed to start${chosen ? ` from ${script.href}` : ''}. ${scriptHint} A Content-Security-Policy must also allow it as a worker (worker-src).`}));
        return {post: (message, transfer) => worker.postMessage(message, transfer), terminate: () => worker.terminate(), ref: () => {}, unref: () => {}};
    }
    // The specifier is built at run time so no bundler tries to resolve it (esbuild ignores comment hints on a literal).
    const {Worker: NodeWorker} = await import(/* webpackIgnore: true */ /* @vite-ignore */ ['node', 'worker_threads'].join(':'));
    // The worker script needs none of the parent's flags, and some (like --input-type) are invalid in a worker.
    const worker = new NodeWorker(await nodeWorkerScript(chosen), {execArgv: []});
    worker.on('message', receive);
    // A worker script that can't be found, or that can't find what it imports: a copy of dist/ split up or bundled away.
    const missing = (error) => error && (error.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find module|import\.meta' outside a module|Qualified path resolution failed/.test(String(error.message)));
    // Yarn Plug'n'Play keeps packages in zip archives, which Node reads ES modules from only through Yarn's loader.
    const inZip = (error) => /\.zip[\\/]/.test(String(error && error.message));
    worker.on('error', (error) => receive({failure: missing(error)
        ? inZip(error)
            ? `${String(error.message).split('\n')[0]}. Under Yarn Plug'n'Play the package sits in a zip archive, which a worker thread can load its ES modules from only through Yarn's loader: run the app with yarn node (or node --require ./.pnp.cjs --loader ./.pnp.loader.mjs), or unplug the package (yarn unplug agglomerative-clustering). Otherwise keep dist/ together and say where it is with createWorker({ script }).`
            : `${String(error.message).split('\n')[0]}. The worker script (worker-thread.mjs) needs index.mjs, shared.mjs, choose.mjs, clustering.js and clustering.wasm next to it: keep dist/ together, and say where it is with createWorker({ script }) or, for the shared worker, init({ script }) (a path, or a file: URL). In a serverless deployment (AWS Lambda, Vercel or Netlify functions), the file tracer may have left them out: include node_modules/agglomerative-clustering/dist in the function's files.`
        : error.message}));
    worker.on('exit', (code) => receive({failure: `The worker exited unexpectedly (code ${code}).`}));
    worker.unref();
    return {post: (message, transfer) => worker.postMessage(message, transfer), terminate: () => worker.terminate(), ref: () => worker.ref(), unref: () => worker.unref()};
};

// Checked by tag as well as `instanceof`, so a module compiled by a bundler's runtime is recognised (see index.js).
const tagOf = (value) => Object.prototype.toString.call(value);
const isWasmModule = (value) => typeof value === 'object' && value !== null
    && ((typeof WebAssembly !== 'undefined' && value instanceof WebAssembly.Module) || tagOf(value) === '[object WebAssembly.Module]');

// A copy of the bytes in an argument (a typed array, or an image's `data`), for a call made before the worker is ready to
// take it: the caller may change or reuse its arrays as soon as the call returns, as with the main entry. Once the worker
// is running, a call posts (and so copies or transfers) its arguments before it returns.
const own = (value) => {
    if (ArrayBuffer.isView(value)) {
        const copy = value.slice();
        // A Palette or Clustering keeps its tags (slice gives a plain array).
        for (const key of Object.getOwnPropertySymbols(value)) {Object.defineProperty(copy, key, {value: value[key]});}
        if (Object.prototype.hasOwnProperty.call(value, 'colorSpace')) {Object.defineProperty(copy, 'colorSpace', {value: value.colorSpace});}
        return copy;
    }
    if (isOptionsObject(value) && ArrayBuffer.isView(value.data)) {return {...value, data: value.data.slice()};}
    return value;
};

// Images cross to the worker as plain {data, format, width?, height?} objects (ImageData can't cross into Node
// worker threads, and its clamped array needn't), and mapped images are rebuilt in the caller's type on return.
// Anything else is sent as it is, so the worker's validation gives the usual errors.
// Things that aren't pixels and can't be posted (a canvas, an image element, an ImageBitmap, a Blob) are reported here with
// the main entry's hint, rather than as the structured clone's own error, which says nothing about what to pass instead.
const notPixels = (image) => image !== null && typeof image === 'object' && !ArrayBuffer.isView(image) && !isImageData(image)
    && (typeof image.getContext === 'function' || typeof image.close === 'function' || typeof image.nodeName === 'string'
        || (typeof image.arrayBuffer === 'function' && typeof image.type === 'string'));

const send = (image) => {
    if (notPixels(image)) {throw fail('invalid-argument', `Invalid image: expected object with \`data\` and \`format\`.${imageHint(image)}`, 'image');}
    // An image object goes through the main entry's own checks here (its fields read once, then shape, data, detached buffer, format,
    // sizes, unknown keys, premultiplied), so what can't be sent is reported as the main entry reports it, before anything is posted.
    // A function, a Symbol or a thenable gets the shape error rather than the structured clone's.
    if (!ArrayBuffer.isView(image) && !isImageData(image)) {
        const copy = imageCopy(image);
        if (copy === image) {
            if (typeof image !== 'object' || image === null) {throw fail('invalid-argument', `Invalid image: expected object with \`data\` and \`format\`.${imageHint(image)}`, 'image');}
        } else {
            const premultiplied = checkImageBody(copy);
            if (copy.data.byteLength >= maxBytes) {throw tooLarge(copy.data.byteLength);}
            const sent = {data: copy.data, format: copy.format};
            if (copy.premultiplied !== undefined) {sent.premultiplied = premultiplied;}
            if (copy.width !== undefined) {sent.width = copy.width;}
            if (copy.height !== undefined) {sent.height = copy.height;}
            return sent;
        }
    }
    // A detached buffer (transferred to a worker created with transfer: true, say) is reported as the main entry reports it.
    const pixels = ArrayBuffer.isView(image) ? image : isImageData(image) && ArrayBuffer.isView(image.data) ? image.data : null;
    if (pixels && isDetached(pixels)) {
        throw detachedError(ArrayBuffer.isView(image) ? 'bare' : isImageData(image) ? 'imagedata' : 'data');
    }
    // Too large for the module, as the main entry reports it, before a copy is made to send (or, from 4 GB, fails to be).
    if (pixels && pixels.byteLength >= maxBytes) {throw tooLarge(pixels.byteLength);}
    if (isImageData(image)) {
        checkImageDataPixels(image);
        const data = image.data;
        return {data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), format: 'rgba', width: image.width, height: image.height};
    }
    return image;
};

// The worker returns what the main entry gives for the image it was sent: the same type for a Uint8Array or a
// RawImage, and a RawImage for ImageData, which is turned back into ImageData here.
const rebuild = (image) => {
    if (isImageData(image)) {
        return (result) => imageDataLike(image, new Uint8ClampedArray(result.data.buffer, result.data.byteOffset, result.data.byteLength));
    }
    return (result) => result;
};

// The buffer behind an image's pixels, to transfer when the worker was created with `transfer: true`: only when the
// pixels are the whole of an ordinary ArrayBuffer. Transferring empties every view of the buffer, so a view into part
// of a larger one (a subarray, a small Node Buffer from Node's shared pool) is copied instead, as is shared memory.
const pixelBuffers = (sent) => {
    const data = ArrayBuffer.isView(sent) ? sent : sent && ArrayBuffer.isView(sent.data) ? sent.data : null;
    if (!data || !(data.buffer instanceof ArrayBuffer) || data.byteOffset !== 0 || data.byteLength !== data.buffer.byteLength) {return [];}
    return [data.buffer];
};

// Rebuilds an error that happened in the worker: same name, message and code as the main entry gives for the same
// input, the stack of the call that failed (`origin`, made when the call was sent), and the worker's own stack as `cause`.
const remoteError = (info, origin) => {
    const error = new Error(info.message);
    if (info.name && info.name !== 'Error') {error.name = info.name;}
    if (info.code !== undefined) {error.code = info.code;}
    if (info.argument !== undefined) {error.argument = info.argument;}
    if (origin.stack) {error.stack = `${error.name}: ${error.message}${origin.stack.slice(origin.stack.indexOf('\n'))}`;}
    if (info.stack) {
        const cause = new Error(info.message);
        cause.name = error.name;
        cause.stack = info.stack;
        error.cause = cause;
    }
    return error;
};

// Checks the `wasm` option (see init in the main entry) and makes it fit for posting to the worker: a URL becomes its
// string, and bytes and compiled modules are cloned across.
const wasmOption = (wasm) => {
    // A relative URL is resolved here, against the page, as fetch would; in the worker it would resolve against the worker
    // script's folder. In Node it is a path, which the worker thread resolves against the same working directory.
    if (typeof wasm === 'string') {
        if (isNode || isBundledNode) {return wasm;}
        try {return new URL(wasm, pageBase()).href;} catch (error) {return wasm;}
    }
    if (typeof wasm === 'object' && wasm !== null && ((typeof URL !== 'undefined' && wasm instanceof URL) || tagOf(wasm) === '[object URL]')) {return wasm.href;}
    if (wasm instanceof ArrayBuffer || tagOf(wasm) === '[object ArrayBuffer]' || ArrayBuffer.isView(wasm)) {return wasm;}
    if (isWasmModule(wasm)) {return wasm;}
    throw fail('invalid-argument', "Invalid wasm: must be a URL or path string, a URL, an ArrayBuffer or typed array of the .wasm bytes, or a WebAssembly.Module.", 'options.wasm');
};

// The `script` option: the worker script to start, for setups where the package's own can't be found or bundled (Angular's
// application builder, esbuild or Rollup without a worker plugin, a bundled Electron main process): a copy of the package's
// dist/worker-thread.mjs, served or kept next to the rest of dist/, which it imports. A URL, or a string: in browsers
// resolved against the page, in Node a path relative to the working directory (or a file: URL).
const scriptOption = (script) => {
    if (typeof script === 'string' && script.length > 0) {return isNode || isBundledNode ? script : new URL(script, pageBase()).href;}
    if (typeof script === 'object' && script !== null && ((typeof URL !== 'undefined' && script instanceof URL) || tagOf(script) === '[object URL]')) {return script.href;}
    throw fail('invalid-argument', "Invalid script: must be the URL (or in Node, the path) of a copy of the package's dist/worker-thread.mjs, as a string or a URL.", 'options.script');
};

// Options for init: `wasm`, and for the shared worker `script`, or none.
const initOptions = (options, allowScript) => {
    if (options === undefined) {return undefined;}
    if (!isOptionsObject(options)) {throw fail('invalid-argument', "Invalid options: expected an object.", 'options');}
    options = snapshot(options);
    for (const key of Object.keys(options)) {
        if (key === 'script' && !allowScript) {throw fail('invalid-argument', "Invalid option 'script': a worker's script is chosen when it is created, with createWorker({ script }).", 'options.script');}
        if (key !== 'wasm' && key !== 'script') {throw fail('invalid-argument', `Invalid option '${key}': expected ${allowScript ? 'script, wasm' : 'wasm'}.`, `options.${key}`);}
    }
    const checked = options.wasm === undefined ? {} : {wasm: wasmOption(options.wasm)};
    if (options.script !== undefined) {checked.script = scriptOption(options.script);}
    return checked;
};

// A signal and a progress callback can't cross to the worker, so they stay on this side: the options are sent without
// them, a cancel message is sent when the signal aborts, and the worker's progress messages call the callback.
const takeControls = (options, ditherAllowed = true) => {
    // Anything but an ordinary object goes on as it is, for the worker's own validation to reject. An ordinary one is copied
    // once first: structured cloning drops inherited properties, and the copy is what gets validated and sent.
    if (!isOptionsObject(options)) {return {options, signal: undefined, onProgress: undefined};}
    options = snapshot(options);
    // The dither setting is an object of its own, which structured cloning would copy without its inherited keys (or not
    // at all, for a Proxy or a function): read it here the way the main entry does, and send a plain copy.
    // A function that takes no dither option rejects the key whatever its value, as the main entry does: send a value that
    // can cross, for the worker's validation to name the option.
    if (!ditherAllowed && 'dither' in options) {options.dither = null;}
    if (options.dither !== null && (typeof options.dither === 'object' || typeof options.dither === 'function' || typeof options.dither === 'symbol')) {
        // One read of each setting (a getter could answer differently twice): the copy is what is checked and sent.
        const copy = isOptionsObject(options.dither) ? Object.assign({}, snapshot(options.dither)) : options.dither;
        // A wrong setting is the worker's to report, after the image and k, as the main entry orders its checks. Only a
        // copy that can't be sent is reported here.
        try {parseDither(copy);} catch (error) {if (!sendable(copy)) {throw error;}}
        options.dither = copy;
    }
    // The signal and the progress callback can't cross to the worker, so they are kept here and the worker gets its own.
    // A wrong one crosses as `null` instead, which the worker's validation
    // rejects with the main entry's error, after the image and k: the main entry checks the options last. (This relies on
    // those messages not echoing the value: if they ever say what they got, send a stand-in that reads the same.)
    const {signal, onProgress} = options;
    const badSignal = signal !== undefined && (signal === null || typeof signal !== 'object' || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function');
    const badProgress = onProgress !== undefined && typeof onProgress !== 'function';
    const {signal: _signal, onProgress: _onProgress, ...rest} = options;
    if (badSignal || badProgress) {
        return {options: {...rest, ...(badSignal ? {signal: null} : {}), ...(badProgress ? {onProgress: null} : {})}, signal: undefined, onProgress: undefined};
    }
    if (signal === undefined && onProgress === undefined) {return {options, signal, onProgress};}
    return {options: rest, signal, onProgress};
};

// Whether a value survives being posted to the worker.
const sendable = (value) => {
    if (typeof structuredClone !== 'function') {return true;}
    try {structuredClone(value); return true;} catch (error) {return false;}
};

// Where the options sit among a function's arguments after the image (see takeControls).
const optionsPosition = {getClustering: 0, getPalette: 1, getSwatches: 1, quantize: 1, quantizeFromClustering: 2, quantizeWithPalette: 1, quantizeToIndices: 1, quantizeToIndicesFromClustering: 2, quantizeToIndicesWithPalette: 1};

// Like fetch: an aborted call rejects with the signal's reason, an AbortError unless the caller gave another.
const abortReason = (signal) => signal.reason !== undefined ? signal.reason : new DOMException('This operation was aborted', 'AbortError');

const imageFunctions = ['getClustering', 'getPalette', 'getSwatches', 'quantize', 'quantizeFromClustering', 'quantizeWithPalette', 'quantizeToIndices', 'quantizeToIndicesFromClustering', 'quantizeToIndicesWithPalette'];
const mappedImageFunctions = ['quantize', 'quantizeFromClustering', 'quantizeWithPalette'];
// The functions that only cluster, and so take no dither option.
const clusteringOnlyFunctions = ['getClustering', 'getPalette', 'getSwatches'];
const otherFunctions = ['getPaletteFromClustering', 'getSwatchesFromClustering', 'getClusteringInfo'];

// Calls each worker's `abandon` once the worker made by createWorker() has been garbage-collected (see `abandoned`).
const abandonment = typeof FinalizationRegistry === 'function' ? new FinalizationRegistry((abandon) => abandon()) : null;

// `allowScript`: whether init takes `script` (the shared worker's; createWorker takes it as an option instead).
const makeWorker = (options, allowScript) => {

    if (options === undefined) {options = {};}
    if (!isOptionsObject(options)) {throw fail('invalid-argument', "Invalid options: expected an object.", 'options');}
    options = snapshot(options);
    for (const key of Object.keys(options)) {
        if (key !== 'transfer' && key !== 'wasm' && key !== 'script') {throw fail('invalid-argument', `Invalid option '${key}': expected script, transfer, wasm.`, `options.${key}`);}
    }
    if (options.transfer !== undefined && typeof options.transfer !== 'boolean') {throw fail('invalid-argument', "Invalid transfer: must be a boolean.", 'options.transfer');}
    const transfer = options.transfer === true;
    // The worker script to start instead of the package's own (see scriptOption); set by init({ script }) for the shared one.
    let script = options.script === undefined ? null : scriptOption(options.script);
    // Where the worker finds its .wasm: sent as the worker's first call, and repeated until it has succeeded.
    const initialWasm = options.wasm === undefined ? undefined : wasmOption(options.wasm);
    let initial = initialWasm === undefined ? null : {wasm: initialWasm};
    let initialising = null;

    let connection = null;
    let starting = null;
    // Counts the workers this instance has started, so a late message or error from one it already dropped is ignored.
    let generation = 0;
    let startingGeneration = 0;
    let terminated = false;
    // A worker created with createWorker() and then dropped without terminate() would keep its thread (and its memory) until
    // the process or page ends: a running worker is never garbage-collected. So once the instance itself has been collected
    // (`abandoned`), no call is in flight (`active`) and no handle is left (`liveHandles`), the thread is stopped. Nothing
    // the worker's own listeners reach refers to `instance`, which is what lets it be collected while the thread runs.
    let active = 0;
    let liveHandles = 0;
    let abandoned = false;
    let nextId = 1;
    let nextHandle = 1;
    const pending = new Map();
    // Whether a call made now is posted before it returns (see `own`).
    const ready = () => connection !== null && !initial;
    // The image of a call made before the worker is ready: with `transfer: true` its buffer is moved out of the caller's
    // hands at once (a structured clone that transfers it, so the caller's array empties now, as it would on posting),
    // otherwise copied.
    const take = (sent) => {
        const buffers = transfer ? pixelBuffers(sent) : [];
        if (buffers.length > 0 && typeof structuredClone === 'function') {
            try {return structuredClone(sent, {transfer: buffers});} catch (error) {/* untransferable: copy it */}
        }
        return own(sent);
    };

    // Safety net for handles dropped without release(): when a handle is garbage-collected, the worker frees what it
    // kept for it. Best-effort, since collection time is up to the engine; release() or `await using` is the contract.
    const reclaim = typeof FinalizationRegistry === 'function'
        ? new FinalizationRegistry((id) => {
            liveHandles--;
            // The last thing keeping an abandoned worker going: stopping it frees everything, so there is nothing to release.
            if (abandoned && liveHandles === 0) {stopIfAbandoned(); return;}
            if (!terminated) {invoke('release', [id], [], new Error()).catch(() => {});}
        })
        : null;

    // A worker that failed (could not start, crashed or exited) is dropped: the calls waiting on it get the failure, and
    // the next call starts a new one, which either works or fails the same clear way. Without this, later calls would be
    // posted to a thread that will never answer and hang forever. Handles kept in the dropped worker are gone with it.
    const lose = (reason) => {
        const lost = connection;
        generation++;
        connection = null;
        starting = null;
        initialising = null;
        if (initialWasm !== undefined) {initial = {wasm: initialWasm};}
        const calls = [...pending.values()];
        pending.clear();
        for (const call of calls) {call.cleanup(); call.reject(fail('worker-failed', reason));}
        if (lost) {try {Promise.resolve(lost.terminate()).catch(() => {});} catch (ignored) {/* already gone */}}
    };

    const receive = (message) => {
        if (message.failure !== undefined) {
            if (!terminated) {lose(`Worker failed: ${message.failure}`);}
            return;
        }
        const call = pending.get(message.id);
        if (!call) {return;}
        if (message.progress !== undefined) {
            // As on the main thread, a callback that throws fails the call (with its error) and stops the work.
            if (call.onProgress) {
                try {call.onProgress(message.progress);} catch (error) {
                    pending.delete(message.id);
                    call.cleanup();
                    if (pending.size === 0 && connection) {connection.unref();}
                    try {connection.post({cancel: message.id}, []);} catch (ignored) {/* the worker is gone anyway */}
                    call.reject(error);
                }
            }
            return;
        }
        pending.delete(message.id);
        call.cleanup();
        if (pending.size === 0 && connection) {connection.unref();}
        if (message.error !== undefined) {call.reject(remoteError(message.error, call.origin));} else {call.resolve(revive(message.result));}
    };

    // `origin` is an Error made in the caller's own (non-async) function, for the stack of a failure: async helpers
    // from transpiled code would otherwise fill the stack's frame limit before the caller shows up.
    const run = async (method, args, transferable, origin, controls = {}) => {
        if (terminated) {throw fail('worker-terminated', "Worker terminated.");}
        if (!connection) {
            if (!starting) {
                const mine = ++generation;
                startingGeneration = mine;
                // A start that fails is not kept, so the next call tries again.
                starting = start((message) => {if (mine === generation) {receive(message);}}, script).catch((error) => {
                    if (mine === generation) {starting = null;}
                    if (error && error.code === 'worker-failed') {throw error;}
                    throw Object.assign(fail('worker-failed', `Worker failed: ${error && error.message}`), {cause: error});
                });
            }
            const waitingFor = startingGeneration;
            const started = await starting;
            // terminate() stops the worker that was starting itself, once (not once per call that waited for it).
            if (terminated) {throw fail('worker-terminated', "Worker terminated.");}
            // The worker may have failed in the instant between starting and being adopted; it has been dropped then.
            if (waitingFor !== generation) {throw fail('worker-failed', 'Worker failed while starting.');}
            connection = connection || started;
        }
        if (initial && !(method === 'init' && args.length > 0 && args[0].wasm !== undefined)) {
            initialising = initialising || post('init', [initial], [], origin).then(() => {initial = null;}, (error) => {initialising = null; throw error;});
            await initialising;
        }
        return post(method, args, transferable, origin, controls);
    };

    // Every call counts as in flight from the moment it is made (while the worker starts, too) until it settles, so an
    // abandoned worker is never stopped under a call: `createWorker().getPalette(image)` keeps only the promise.
    const invoke = (...args) => {
        active++;
        const settled = () => {active--; stopIfAbandoned();};
        return run(...args).then((value) => {settled(); return value;}, (error) => {settled(); throw error;});
    };

    const post = (method, args, transferable, origin, {signal, onProgress, check} = {}) => {
        if (terminated) {return Promise.reject(fail('worker-terminated', "Worker terminated."));}
        if (signal && signal.aborted) {return Promise.reject(abortReason(signal));}
        const id = nextId++;
        return new Promise((resolve, reject) => {
            if (pending.size === 0) {connection.ref();}
            const call = {resolve, reject, origin, onProgress, cleanup: () => {}};
            if (signal) {
                // Rejects at once; the worker is told to stop (it may still be working on an earlier call or this one,
                // and drops whatever it produces). The thread no longer keeps a Node process alive for this call.
                const abort = () => {
                    if (!pending.delete(id)) {return;}
                    if (pending.size === 0) {connection.unref();}
                    try {connection.post({cancel: id}, []);} catch (error) {/* the worker is gone anyway */}
                    reject(abortReason(signal));
                };
                signal.addEventListener('abort', abort, {once: true});
                call.cleanup = () => signal.removeEventListener('abort', abort);
            }
            pending.set(id, call);
            try {
                const message = {id, method, args: args.map(mark), cancellable: signal !== undefined || onProgress !== undefined, progress: onProgress !== undefined, ...(check ? {check} : {})};
                try {
                    connection.post(message, transfer ? transferable : []);
                } catch (error) {
                    // Some whole buffers still can't be transferred (Node marks some untransferable): copy them instead.
                    // A message that can't be copied either fails the same way again, and is reported below.
                    if (!(transfer && transferable.length > 0 && error && error.name === 'DataCloneError')) {throw error;}
                    connection.post(message, []);
                }
            } catch (error) {
                pending.delete(id);
                call.cleanup();
                if (pending.size === 0) {connection.unref();}
                // A value that can't be structured-cloned (a function, symbol or promise) is an invalid argument, as it
                // would be if the main entry were called with it.
                reject(error && error.name === 'DataCloneError' ? Object.assign(fail('invalid-argument', `Invalid argument: it cannot be sent to the worker (${error.message})`), {cause: error}) : error);
            }
        });
    };

    const instance = {};

    for (const name of imageFunctions) {
        const mapped = mappedImageFunctions.includes(name);
        instance[name] = (image, ...rest) => {
            const origin = new Error();
            return (async () => {
                const position = optionsPosition[name];
                const {options, signal, onProgress} = takeControls(rest[position], !clusteringOnlyFunctions.includes(name));
                let args = rest.slice();
                if (position < args.length) {args[position] = options;}
                if (signal && signal.aborted) {
                    // The main entry reports a wrong argument before an abort, so the worker checks the arguments (a
                    // copy, never transferred: an aborted call leaves the image with the caller) without doing the work.
                    try {
                        await invoke(name, [own(send(image)), ...args.map(own)], [], origin, {check: true});
                    } catch (error) {
                        if (isCodedError(error) && error.argument !== undefined) {throw error;}
                    }
                    throw abortReason(signal);
                }
                // The bare-image warning is decided here, on the caller's side and before a transfer can empty the
                // array, and given once the call succeeds: the thread checks the other arguments, and its own copy is
                // silenced (PRINCIPLES "Warnings").
                const warning = bareImageWarning(image);
                const byteLength = warning ? image.byteLength : 0;
                let sent = send(image);
                if (!ready()) {sent = take(sent); args = args.map(own);}
                const result = await invoke(name, [sent, ...args], pixelBuffers(sent), origin, {signal, onProgress});
                if (warning) {warnOnce(warning, byteLength);}
                return mapped ? rebuild(image)(result) : result;
            })();
        };
    }
    for (const name of otherFunctions) {
        instance[name] = (...args) => invoke(name, ready() ? args : args.map(own), [], new Error());
    }
    // 3.4.0's names for the functions that cluster an image. The old names are the same functions, and they still name the
    // call on the wire, so a worker script copied from an older version still understands it.
    instance.buildClustering = instance.getClustering;
    instance.buildPalette = instance.getPalette;
    instance.buildSwatches = instance.getSwatches;

    instance.init = (initArgs) => {
        const origin = new Error();
        let checked;
        try {
            checked = initOptions(initArgs, allowScript);
            if (checked !== undefined && checked.script !== undefined) {
                // The script decides how the worker starts, so it can only be chosen before it has.
                const chosen = checked.script;
                if ((connection || starting) && chosen !== script) {
                    throw fail('invalid-argument', "Invalid script: the worker has already started. Call init({ script }) before any other call (or terminate() first).", 'options.script');
                }
                script = chosen;
                const {script: _script, ...rest} = checked;
                checked = rest;
            }
        } catch (error) {return Promise.reject(error);}
        return invoke('init', checked === undefined || Object.keys(checked).length === 0 ? [] : [checked], [], origin).then(() => undefined);
    };

    // Whether a value is an image where a palette size was expected (a pixel array, an ImageData or `{data, ...}`).
    const looksLikeImage = (value) => value !== null && typeof value === 'object' && (isUint8Array(value) || isUint8ClampedArray(value) || isImageData(value) || 'data' in value);
    // Builds the handle object for what the worker keeps under `id`: `kind` is 'image' (from `cluster`: an image and its
    // clustering) or 'clustering' (from `load`: a clustering alone). `output` turns a mapped result back into the type of the image given.
    const makeHandle = (id, kind, output) => {
        let released = false;
        // Every method goes through `use`, which refers to `handle`, so a method kept after the handle itself is dropped
        // keeps it alive and it is not reclaimed while still in use.
        const use = (method, args, controls) => {
            if (released || !handle) {return Promise.reject(fail('invalid-handle', "Invalid handle: it was released."));}
            return invoke(method, [id, ...args], [], new Error(), controls);
        };
        // Calls with mapping options, whose signal and progress callback stay on this side (see takeControls).
        const withControls = (method, leading, mapOptions) => {
            let taken;
            try {taken = takeControls(mapOptions);} catch (error) {return Promise.reject(error);}
            return use(method, [...leading, taken.options], {signal: taken.signal, onProgress: taken.onProgress});
        };
        // The cuts take no options (the handle's clustering already says how it was made): one passed anyway is an error,
        // as in the main entry, rather than silently ignored.
        const plain = (method, name, args, extra) => extra.some((value) => value !== undefined)
            ? Promise.reject(fail('invalid-argument', `Invalid arguments: handle.${name} takes no options. To map pixels with options, use handle.quantize.`, 'options'))
            : use(method, args);
        // An image where k belongs is a mix-up between the two kinds of handle: say so, rather than "k must be an integer".
        const imageAsK = (name, k) => looksLikeImage(k)
            ? Promise.reject(fail('invalid-argument', `Invalid k: this handle holds an image (from worker.cluster) and maps it with ${name}(k); pass k, not an image. To map other images with a stored clustering, use worker.load(clustering).`, 'k'))
            : null;
        const handle = {
            getPalette: (k, ...extra) => plain('handleGetPalette', 'getPalette', [k], extra),
            getSwatches: (k, ...extra) => plain('handleGetSwatches', 'getSwatches', [k], extra),
            getClusteringInfo: (...extra) => plain('handleGetClusteringInfo', 'getClusteringInfo', [], extra),
            // Takes the signal only: the main entry's chooseFrom takes no progress callback, so one given crosses as null for
            // the thread to reject with the main entry's own error.
            // That relies on the thread injecting a progress poster only for calls that have one (see `optionsIndex` in
            // worker-thread.js): the null is then the only onProgress it sees, so its own option check rejects it.
            chooseFrom: (palette, k, chooseOptions) => {
                let taken;
                try {taken = takeControls(chooseOptions, false);} catch (error) {return Promise.reject(error);}
                const sent = taken.onProgress !== undefined ? {...taken.options, onProgress: null} : taken.options;
                return use('handleChooseFrom', [palette, k, sent], {signal: taken.signal});
            },
            release: async () => {
                if (released) {return;}
                released = true;
                liveHandles--;
                if (reclaim) {reclaim.unregister(handle);}
                // If the worker has been terminated there is nothing left to free (so `await using` and
                // terminate() can come in either order); any other failure is reported.
                try {await invoke('release', [id], [], new Error());} catch (error) {if (error.code !== 'worker-terminated') {throw error;}}
                stopIfAbandoned();
            },
        };
        if (kind === 'image') {
            Object.assign(handle, {
                getClustering: (...extra) => plain('handleGetClustering', 'getClustering', [], extra),
                quantize: (k, mapOptions) => imageAsK('quantize', k) || (async () => output(await withControls('handleQuantize', [k], mapOptions)))(),
                quantizeToIndices: (k, mapOptions) => imageAsK('quantizeToIndices', k) || withControls('handleQuantizeToIndices', [k], mapOptions),
                quantizeWithPalette: async (palette, mapOptions) => output(await withControls('handleQuantizeWithPalette', [palette], mapOptions)),
                quantizeToIndicesWithPalette: (palette, mapOptions) => withControls('handleQuantizeToIndicesWithPalette', [palette], mapOptions),
            });
        }
        if (kind === 'clustering') {
            // The handle holds no image: each call maps the image it is given, and returns the type of that image.
            const mapping = (name, method, mapped) => (image, k, mapOptions) => {
                if (typeof image === 'number') {return Promise.reject(fail('invalid-argument', "Invalid image: this handle holds a clustering, not an image (from worker.load); pass the image, then k.", 'image'));}
                const origin = new Error();
                return (async () => {
                    if (released || !handle) {throw fail('invalid-handle', "Invalid handle: it was released.");}
                    const {options, signal, onProgress} = takeControls(mapOptions);
                    if (signal && signal.aborted) {
                        // As the functions on the worker do: a wrong argument is reported before the abort.
                        try {
                            await invoke(method, [id, own(send(image)), k, options], [], origin, {check: true});
                        } catch (error) {
                            if (isCodedError(error) && error.argument !== undefined) {throw error;}
                        }
                        throw abortReason(signal);
                    }
                    const warning = bareImageWarning(image);
                    const byteLength = warning ? image.byteLength : 0;
                    let sent = send(image);
                    const ahead = !ready();
                    if (ahead) {sent = take(sent);}
                    const result = await invoke(method, [id, sent, ahead ? own(k) : k, options], pixelBuffers(sent), origin, {signal, onProgress});
                    if (warning) {warnOnce(warning, byteLength);}
                    return mapped ? rebuild(image)(result) : result;
                })();
            };
            Object.assign(handle, {
                quantize: mapping('quantize', 'handleQuantizeImage', true),
                quantizeToIndices: mapping('quantizeToIndices', 'handleQuantizeToIndicesImage', false),
            });
        }
        // `await using handle = await worker.cluster(image)` releases it at the end of the block.
        if (typeof Symbol.asyncDispose === 'symbol') {handle[Symbol.asyncDispose] = handle.release;}
        if (reclaim) {reclaim.register(handle, id, handle);}
        return handle;
    };

    // Clusters `image` and keeps it, with its clustering, in the worker.
    instance.cluster = (image, clusterOptions) => {
        const origin = new Error();
        return (async () => {
            const {options, signal, onProgress} = takeControls(clusterOptions, false);
            if (signal && signal.aborted) {throw abortReason(signal);}
            const id = nextHandle++;
            const warning = bareImageWarning(image);
            const byteLength = warning ? image.byteLength : 0;
            const sent = ready() ? send(image) : take(send(image));
            // Counted from before the call, so an abandoned worker isn't stopped between the call settling and the handle
            // existing (see `abandoned`).
            liveHandles++;
            try {
                await invoke('cluster', [id, sent, options], pixelBuffers(sent), origin, {signal, onProgress});
            } catch (error) {
                liveHandles--;
                // A cancelled call is rejected at once, but the worker may have finished it just before it heard: it
                // would then keep the image and clustering with nobody able to release them. Releasing an unknown handle
                // is harmless, and this message follows the cluster call in the worker's queue.
                if (!terminated) {invoke('release', [id], [], new Error()).catch(() => {});}
                throw error;
            }
            if (warning) {warnOnce(warning, byteLength);}
            return makeHandle(id, 'image', rebuild(image));
        })();
    };

    // Keeps a stored clustering in the worker, for cutting it and mapping images with it without sending it again.
    instance.load = (clustering, ...extra) => {
        const origin = new Error();
        return (async () => {
            // Checked, and the bytes taken, before anything is awaited (see `own`): a damaged clustering, a palette or an
            // image is reported here, and nothing is posted.
            if (extra.length > 0) {throw fail('invalid-argument', "Invalid arguments: load takes the clustering only. Options go to the handle's methods.", 'options');}
            readHeader(clustering);
            const id = nextHandle++;
            const sent = ready() ? clustering : take(clustering);
            liveHandles++;
            try {
                await invoke('load', [id, sent], pixelBuffers(sent), origin);
            } catch (error) {
                liveHandles--;
                if (!terminated) {invoke('release', [id], [], new Error()).catch(() => {});}
                throw error;
            }
            return makeHandle(id, 'clustering');
        })();
    };

    // Stops the worker. Calls still waiting are rejected, and later calls fail. Every call of it returns the same promise,
    // so a second terminate() made while the first is running also waits until the thread has gone.
    let stopping = null;
    const stop = () => stopping = stopping || (async () => {
        terminated = true;
        for (const call of pending.values()) {call.cleanup(); call.reject(fail('worker-terminated', "Worker terminated."));}
        pending.clear();
        if (connection) {await connection.terminate();}
        else if (starting) {try {(await starting).terminate();} catch (ignored) {/* it never started */}}
    })();
    // An abandoned worker is stopped once nothing can use it any more (see `abandoned`).
    const stopIfAbandoned = () => {
        if (abandoned && active === 0 && liveHandles === 0 && !terminated) {stop().catch(() => {});}
    };
    instance.terminate = stop;
    // `await using worker = createWorker()` terminates it at the end of the block.
    if (typeof Symbol.asyncDispose === 'symbol') {instance[Symbol.asyncDispose] = stop;}
    if (allowScript === false && abandonment) {abandonment.register(instance, () => {abandoned = true; stopIfAbandoned();});}

    return instance;

};

export const createWorker = (options) => makeWorker(options, false);

let shared = null;
const sharedWorker = () => (shared = shared || makeWorker({}, true));

// Stops the shared worker, rejecting calls still waiting. The next call starts a fresh one.
export const terminate = async () => {
    if (!shared) {return;}
    const stopping = shared;
    shared = null;
    await stopping.terminate();
};

export const init = (...args) => sharedWorker().init(...args);
export const buildClustering = (...args) => sharedWorker().buildClustering(...args);
export const getClustering = buildClustering;
export const buildPalette = (...args) => sharedWorker().buildPalette(...args);
export const getPalette = buildPalette;
export const getPaletteFromClustering = (...args) => sharedWorker().getPaletteFromClustering(...args);
export const buildSwatches = (...args) => sharedWorker().buildSwatches(...args);
export const getSwatches = buildSwatches;
export const getSwatchesFromClustering = (...args) => sharedWorker().getSwatchesFromClustering(...args);
export const getClusteringInfo = (...args) => sharedWorker().getClusteringInfo(...args);
export const quantize = (...args) => sharedWorker().quantize(...args);
export const quantizeFromClustering = (...args) => sharedWorker().quantizeFromClustering(...args);
export const quantizeWithPalette = (...args) => sharedWorker().quantizeWithPalette(...args);
export const quantizeToIndices = (...args) => sharedWorker().quantizeToIndices(...args);
export const quantizeToIndicesFromClustering = (...args) => sharedWorker().quantizeToIndicesFromClustering(...args);
export const quantizeToIndicesWithPalette = (...args) => sharedWorker().quantizeToIndicesWithPalette(...args);
