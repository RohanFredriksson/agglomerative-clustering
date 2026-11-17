// The `agglomerative-clustering/worker` entry: the same API, run in a Web Worker (browsers) or a worker thread
// (Node), so clustering doesn't block the calling thread. `createWorker()` starts a worker with every function of
// the main entry as a method, plus `cluster`, which keeps an image and its clustering in the worker behind a
// handle, so re-cutting and re-mapping it copies nothing across. The functions exported directly use one shared
// worker, started on first use.

import {fail, isOptionsObject, snapshot, mark, revive, latestVersion, imageHint} from './shared.js';

// The same version, types and data-format version as the main entry (one implementation, in shared.js).
export {version, Palette, Clustering} from './shared.js';
export const formatVersion = latestVersion;

// Node's worker_threads, where this script runs from a file in Node, Bun or Deno (from npm). A runtime that only imitates Node
// (Cloudflare Workers with nodejs_compat, a CDN copy in Deno) defines process.versions.node too, but isn't loaded from a file.
const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node) && typeof window === 'undefined'
    && typeof import.meta.url === 'string' && import.meta.url.startsWith('file:');

// The worker thread's script in Node: the one next to this file, which imports the main entry (index.mjs) next to it. A
// server bundle (Next.js with webpack or Turbopack) copies the script elsewhere without what it imports, and may hand
// over its URL as another realm's URL object, which Node's Worker rejects. Then the package's own copy is used, found the
// way Node resolves packages from the working directory. Built from strings so Node's own URL class makes it.
const nodeWorkerScript = async () => {
    const load = (name) => import(/* webpackIgnore: true */ /* @vite-ignore */ ['node', name].join(':'));
    // The base is a variable so bundlers don't take this Node-only URL for an asset to emit (Vite would copy the script a
    // second time for it): they look for `new URL('…', import.meta.url)` written out, which the browser branch of `start` keeps.
    const here = import.meta.url;
    const file = './worker-thread.mjs';
    let script = null;
    try {
        const made = new URL(file, here);
        script = new URL(typeof made.href === 'string' ? made.href : String(made));
    } catch (error) {/* a URL Node can't read: use the package's copy */}
    try {
        const [{existsSync}, {fileURLToPath, pathToFileURL}] = await Promise.all([load('fs'), load('url')]);
        if (script && script.protocol === 'file:' && existsSync(fileURLToPath(script)) && existsSync(fileURLToPath(new URL('./index.mjs', script)))) {return script;}
        const {createRequire} = await load('module');
        const packaged = new URL('./dist/worker-thread.mjs', pathToFileURL(createRequire(`${process.cwd()}/`).resolve('agglomerative-clustering/package.json')));
        if (existsSync(fileURLToPath(packaged))) {return packaged;}
    } catch (error) {/* not found: start the script as it is, and report what happens */}
    return script || new URL(file, here);
};

// Whether a worker script at `url` is on another origin than the page (or worker) starting it.
const isCrossOrigin = (url) => {
    try {
        const here = typeof location !== 'undefined' && location.origin;
        return Boolean(here) && here !== 'null' && (url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== here;
    } catch (error) {return false;}
};

// Starts the worker and returns {post, terminate, ref, unref}, with messages delivered to `receive`.
const start = async (receive) => {
    if (!isNode) {
        if (typeof Worker !== 'function') {
            throw fail('worker-failed', "Worker failed: this runtime has no Worker (Cloudflare Workers, for one, can't start threads). Use the main entry, 'agglomerative-clustering', instead.");
        }
        // Where the script is when the package is used unbundled (from a CDN, say). The base is a variable so bundlers
        // leave this one alone; they rewrite the literal `new Worker(new URL(...))` below, which must stay written out.
        const here = import.meta.url;
        const script = new URL('./worker-thread.mjs', here);
        const crossOrigin = isCrossOrigin(script);
        let worker, source = null;
        if (crossOrigin) {
            // A page can't start a worker from another origin's script, but a worker of its own can import one: a one-line
            // module from a blob URL, which imports the script by its full URL (CDNs send the CORS headers that needs). A
            // Content-Security-Policy then needs `worker-src blob:`.
            source = URL.createObjectURL(new Blob([`import ${JSON.stringify(script.href)};`], {type: 'text/javascript'}));
            worker = new Worker(source, {type: 'module'});
            setTimeout(() => URL.revokeObjectURL(source), 60000);
        } else {
            // Written out in full so bundlers (Vite, webpack 5, Parcel) find and bundle the worker script.
            worker = new Worker(new URL('./worker-thread.mjs', import.meta.url), {type: 'module'});
        }
        worker.addEventListener('message', (event) => receive(event.data));
        worker.addEventListener('error', (event) => receive({failure: event.message || (crossOrigin
            ? `The worker failed to start: its script comes from another origin (${script.origin}), so it was started through a blob: URL, which also failed. Check that the server sends CORS headers and that a Content-Security-Policy allows worker-src blob:.`
            : 'The worker failed to start: check that its script (worker-thread) is served next to the package, or emitted by your bundler, and that a Content-Security-Policy allows it as a worker.')}));
        return {post: (message, transfer) => worker.postMessage(message, transfer), terminate: () => worker.terminate(), ref: () => {}, unref: () => {}};
    }
    // The specifier is built at run time so no bundler tries to resolve it (esbuild ignores comment hints on a literal).
    const {Worker: NodeWorker} = await import(/* webpackIgnore: true */ /* @vite-ignore */ ['node', 'worker_threads'].join(':'));
    // The worker script needs none of the parent's flags, and some (like --input-type) are invalid in a worker.
    const worker = new NodeWorker(await nodeWorkerScript(), {execArgv: []});
    worker.on('message', receive);
    worker.on('error', (error) => receive({failure: error.message}));
    worker.on('exit', (code) => receive({failure: `The worker exited unexpectedly (code ${code}).`}));
    worker.unref();
    return {post: (message, transfer) => worker.postMessage(message, transfer), terminate: () => worker.terminate(), ref: () => worker.ref(), unref: () => worker.unref()};
};

// Checked by tag as well as `instanceof`, so an ImageData from another realm (an iframe's canvas) or a module compiled by a
// bundler's runtime is recognised (see index.js).
const tagOf = (value) => Object.prototype.toString.call(value);
const isImageData = (value) => typeof value === 'object' && value !== null
    && ((typeof ImageData !== 'undefined' && value instanceof ImageData) || tagOf(value) === '[object ImageData]');
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
    if (isImageData(image)) {
        const data = image.data;
        return {data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), format: 'rgba', width: image.width, height: image.height};
    }
    if (image && typeof image === 'object' && !ArrayBuffer.isView(image) && ArrayBuffer.isView(image.data)) {
        const sent = {data: image.data, format: image.format};
        if (image.width !== undefined) {sent.width = image.width;}
        if (image.height !== undefined) {sent.height = image.height;}
        return sent;
    }
    return image;
};

// The worker returns what the main entry gives for the image it was sent: the same type for a Uint8Array or a
// RawImage, and a RawImage for ImageData, which is turned back into ImageData here.
const rebuild = (image) => {
    if (isImageData(image)) {
        const {width, height, colorSpace} = image;
        return (result) => new ImageData(new Uint8ClampedArray(result.data.buffer, result.data.byteOffset, result.data.byteLength), width, height, colorSpace ? {colorSpace} : undefined);
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
    if (typeof wasm === 'string') {return wasm;}
    if (typeof wasm === 'object' && wasm !== null && ((typeof URL !== 'undefined' && wasm instanceof URL) || tagOf(wasm) === '[object URL]')) {return wasm.href;}
    if (wasm instanceof ArrayBuffer || tagOf(wasm) === '[object ArrayBuffer]' || ArrayBuffer.isView(wasm)) {return wasm;}
    if (isWasmModule(wasm)) {return wasm;}
    throw fail('invalid-argument', "Invalid wasm: must be a URL or path string, a URL, an ArrayBuffer or typed array of the .wasm bytes, or a WebAssembly.Module.", 'options.wasm');
};

// Options for init: only `wasm`, or none.
const initOptions = (options) => {
    if (options === undefined) {return undefined;}
    if (!isOptionsObject(options)) {throw fail('invalid-argument', "Invalid options: expected an object.", 'options');}
    options = snapshot(options);
    for (const key of Object.keys(options)) {
        if (key !== 'wasm') {throw fail('invalid-argument', `Invalid option '${key}': expected wasm.`, `options.${key}`);}
    }
    return options.wasm === undefined ? {} : {wasm: wasmOption(options.wasm)};
};

// A signal and a progress callback can't cross to the worker, so they stay on this side: the options are sent without
// them, a cancel message is sent when the signal aborts, and the worker's progress messages call the callback.
const takeControls = (options, progressAllowed = true) => {
    // Anything but an ordinary object goes on as it is, for the worker's own validation to reject. An ordinary one is copied
    // once first: structured cloning drops inherited properties, and the copy is what gets validated and sent.
    if (!isOptionsObject(options)) {return {options, signal: undefined, onProgress: undefined};}
    options = snapshot(options);
    const {signal, onProgress} = options;
    if (!progressAllowed && onProgress !== undefined) {throw fail('invalid-argument', "Invalid option 'onProgress': the functions that only map pixels take just `signal`.", 'options.onProgress');}
    if (signal === undefined && onProgress === undefined) {return {options, signal, onProgress};}
    if (signal !== undefined && (signal === null || typeof signal !== 'object' || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function')) {throw fail('invalid-argument', "Invalid signal: must be an AbortSignal.", 'options.signal');}
    if (onProgress !== undefined && typeof onProgress !== 'function') {throw fail('invalid-argument', "Invalid onProgress: must be a function.", 'options.onProgress');}
    const {signal: _signal, onProgress: _onProgress, ...rest} = options;
    return {options: rest, signal, onProgress};
};

// Where the options sit among a function's arguments after the image (see takeControls).
const optionsPosition = {getClustering: 0, getPalette: 1, getSwatches: 1, quantize: 1, quantizeFromClustering: 2, quantizeWithPalette: 1, quantizeToIndices: 1, quantizeToIndicesFromClustering: 2, quantizeToIndicesWithPalette: 1};

// Like fetch: an aborted call rejects with the signal's reason, an AbortError unless the caller gave another.
const abortReason = (signal) => signal.reason !== undefined ? signal.reason : new DOMException('This operation was aborted', 'AbortError');

const imageFunctions = ['getClustering', 'getPalette', 'getSwatches', 'quantize', 'quantizeFromClustering', 'quantizeWithPalette', 'quantizeToIndices', 'quantizeToIndicesFromClustering', 'quantizeToIndicesWithPalette'];
const mappedImageFunctions = ['quantize', 'quantizeFromClustering', 'quantizeWithPalette'];
// These only map pixels, so they take a signal but no progress callback (see mapOptions in index.js).
const mappingOnlyFunctions = ['quantizeFromClustering', 'quantizeWithPalette', 'quantizeToIndicesFromClustering', 'quantizeToIndicesWithPalette'];
const otherFunctions = ['getPaletteFromClustering', 'getSwatchesFromClustering', 'getClusteringInfo'];

export const createWorker = (options) => {

    if (options === undefined) {options = {};}
    if (!isOptionsObject(options)) {throw fail('invalid-argument', "Invalid options: expected an object.", 'options');}
    options = snapshot(options);
    for (const key of Object.keys(options)) {
        if (key !== 'transfer' && key !== 'wasm') {throw fail('invalid-argument', `Invalid option '${key}': expected transfer, wasm.`, `options.${key}`);}
    }
    if (options.transfer !== undefined && typeof options.transfer !== 'boolean') {throw fail('invalid-argument', "Invalid transfer: must be a boolean.", 'options.transfer');}
    const transfer = options.transfer === true;
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
        ? new FinalizationRegistry((id) => {if (!terminated) {invoke('release', [id], [], new Error()).catch(() => {});}})
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
    const invoke = async (method, args, transferable, origin, controls = {}) => {
        if (terminated) {throw fail('worker-terminated', "Worker terminated.");}
        if (!connection) {
            if (!starting) {
                const mine = ++generation;
                startingGeneration = mine;
                // A start that fails is not kept, so the next call tries again.
                starting = start((message) => {if (mine === generation) {receive(message);}}).catch((error) => {
                    if (mine === generation) {starting = null;}
                    throw Object.assign(fail('worker-failed', `Worker failed: ${error && error.message}`), {cause: error});
                });
            }
            const waitingFor = startingGeneration;
            const started = await starting;
            if (terminated) {started.terminate(); throw fail('worker-terminated', "Worker terminated.");}
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

    const post = (method, args, transferable, origin, {signal, onProgress} = {}) => {
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
                const message = {id, method, args: args.map(mark), cancellable: signal !== undefined || onProgress !== undefined, progress: onProgress !== undefined};
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
                const {options, signal, onProgress} = takeControls(rest[position], !mappingOnlyFunctions.includes(name));
                // Checked before the image is copied or transferred away, so an aborted call leaves it with the caller.
                if (signal && signal.aborted) {throw abortReason(signal);}
                let args = rest.slice();
                if (position < args.length) {args[position] = options;}
                let sent = send(image);
                if (!ready()) {sent = take(sent); args = args.map(own);}
                const result = await invoke(name, [sent, ...args], pixelBuffers(sent), origin, {signal, onProgress});
                return mapped ? rebuild(image)(result) : result;
            })();
        };
    }
    for (const name of otherFunctions) {
        instance[name] = (...args) => invoke(name, ready() ? args : args.map(own), [], new Error());
    }

    instance.init = (initArgs) => {
        const origin = new Error();
        let checked;
        try {checked = initOptions(initArgs);} catch (error) {return Promise.reject(error);}
        return invoke('init', checked === undefined ? [] : [checked], [], origin).then(() => undefined);
    };

    // Clusters `image` and keeps it, with its clustering, in the worker.
    instance.cluster = (image, clusterOptions) => {
        const origin = new Error();
        return (async () => {
            const {options, signal, onProgress} = takeControls(clusterOptions);
            if (signal && signal.aborted) {throw abortReason(signal);}
            const id = nextHandle++;
            const sent = ready() ? send(image) : take(send(image));
            try {
                await invoke('cluster', [id, sent, options], pixelBuffers(sent), origin, {signal, onProgress});
            } catch (error) {
                // A cancelled call is rejected at once, but the worker may have finished it just before it heard: it
                // would then keep the image and clustering with nobody able to release them. Releasing an unknown handle
                // is harmless, and this message follows the cluster call in the worker's queue.
                if (!terminated) {invoke('release', [id], [], new Error()).catch(() => {});}
                throw error;
            }
            const output = rebuild(image);
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
                try {taken = takeControls(mapOptions, false);} catch (error) {return Promise.reject(error);}
                return use(method, [...leading, taken.options], {signal: taken.signal, onProgress: taken.onProgress});
            };
            // The cuts take no options (the handle's clustering already says how it was made): one passed anyway is an error,
            // as in the main entry, rather than silently ignored.
            const plain = (method, name, args, extra) => extra.some((value) => value !== undefined)
                ? Promise.reject(fail('invalid-argument', `Invalid arguments: handle.${name} takes no options. To map pixels with options, use handle.quantize.`, 'options'))
                : use(method, args);
            const handle = {
                getClustering: (...extra) => plain('handleGetClustering', 'getClustering', [], extra),
                getPalette: (k, ...extra) => plain('handleGetPalette', 'getPalette', [k], extra),
                getSwatches: (k, ...extra) => plain('handleGetSwatches', 'getSwatches', [k], extra),
                getClusteringInfo: (...extra) => plain('handleGetClusteringInfo', 'getClusteringInfo', [], extra),
                quantize: async (k, mapOptions) => output(await withControls('handleQuantize', [k], mapOptions)),
                quantizeToIndices: (k, mapOptions) => withControls('handleQuantizeToIndices', [k], mapOptions),
                quantizeWithPalette: async (palette, mapOptions) => output(await withControls('handleQuantizeWithPalette', [palette], mapOptions)),
                quantizeToIndicesWithPalette: (palette, mapOptions) => withControls('handleQuantizeToIndicesWithPalette', [palette], mapOptions),
                release: async () => {
                    if (released) {return;}
                    released = true;
                    if (reclaim) {reclaim.unregister(handle);}
                    // If the worker has been terminated there is nothing left to free (so `await using` and
                    // terminate() can come in either order); any other failure is reported.
                    try {await invoke('release', [id], [], new Error());} catch (error) {if (error.code !== 'worker-terminated') {throw error;}}
                },
            };
            // `await using handle = await worker.cluster(image)` releases it at the end of the block.
            if (typeof Symbol.asyncDispose === 'symbol') {handle[Symbol.asyncDispose] = handle.release;}
            if (reclaim) {reclaim.register(handle, id, handle);}
            return handle;
        })();
    };

    // Stops the worker. Calls still waiting are rejected, and later calls fail.
    instance.terminate = async () => {
        if (terminated) {return;}
        terminated = true;
        for (const call of pending.values()) {call.cleanup(); call.reject(fail('worker-terminated', "Worker terminated."));}
        pending.clear();
        if (connection) {await connection.terminate();}
        else if (starting) {try {(await starting).terminate();} catch (ignored) {/* it never started */}}
    };

    return instance;

};

let shared = null;
const sharedWorker = () => (shared = shared || createWorker());

// Stops the shared worker, rejecting calls still waiting. The next call starts a fresh one.
export const terminate = async () => {
    if (!shared) {return;}
    const stopping = shared;
    shared = null;
    await stopping.terminate();
};

export const init = (...args) => sharedWorker().init(...args);
export const getClustering = (...args) => sharedWorker().getClustering(...args);
export const getPalette = (...args) => sharedWorker().getPalette(...args);
export const getPaletteFromClustering = (...args) => sharedWorker().getPaletteFromClustering(...args);
export const getSwatches = (...args) => sharedWorker().getSwatches(...args);
export const getSwatchesFromClustering = (...args) => sharedWorker().getSwatchesFromClustering(...args);
export const getClusteringInfo = (...args) => sharedWorker().getClusteringInfo(...args);
export const quantize = (...args) => sharedWorker().quantize(...args);
export const quantizeFromClustering = (...args) => sharedWorker().quantizeFromClustering(...args);
export const quantizeWithPalette = (...args) => sharedWorker().quantizeWithPalette(...args);
export const quantizeToIndices = (...args) => sharedWorker().quantizeToIndices(...args);
export const quantizeToIndicesFromClustering = (...args) => sharedWorker().quantizeToIndicesFromClustering(...args);
export const quantizeToIndicesWithPalette = (...args) => sharedWorker().quantizeToIndicesWithPalette(...args);
