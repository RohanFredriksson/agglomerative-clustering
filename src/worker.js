// The `agglomerative-clustering/worker` entry: the same API, run in a Web Worker (browsers) or a worker thread
// (Node), so clustering doesn't block the calling thread. `createWorker()` starts a worker with every function of
// the main entry as a method, plus `cluster`, which keeps an image and its clustering in the worker behind a
// handle, so re-cutting and re-mapping it copies nothing across. The functions exported directly use one shared
// worker, started on first use.

const fail = (code, message) => Object.assign(new Error(message), {code});

const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node) && typeof window === 'undefined';

// Starts the worker and returns {post, terminate, ref, unref}, with messages delivered to `receive`.
const start = async (receive) => {
    if (!isNode) {
        // Written out in full so bundlers (Vite, webpack 5, Parcel) find and bundle the worker script.
        const worker = new Worker(new URL('./worker-thread.mjs', import.meta.url), {type: 'module'});
        worker.addEventListener('message', (event) => receive(event.data));
        worker.addEventListener('error', (event) => receive({failure: event.message || 'The worker failed to start.'}));
        return {post: (message, transfer) => worker.postMessage(message, transfer), terminate: () => worker.terminate(), ref: () => {}, unref: () => {}};
    }
    // The specifier is built at run time so no bundler tries to resolve it (esbuild ignores comment hints on a literal).
    const {Worker: NodeWorker} = await import(/* webpackIgnore: true */ /* @vite-ignore */ ['node', 'worker_threads'].join(':'));
    // The worker script needs none of the parent's flags, and some (like --input-type) are invalid in a worker.
    const worker = new NodeWorker(new URL('./worker-thread.mjs', import.meta.url), {execArgv: []});
    worker.on('message', receive);
    worker.on('error', (error) => receive({failure: error.message}));
    worker.on('exit', (code) => receive({failure: `The worker exited unexpectedly (code ${code}).`}));
    worker.unref();
    return {post: (message, transfer) => worker.postMessage(message, transfer), terminate: () => worker.terminate(), ref: () => worker.ref(), unref: () => worker.unref()};
};

// Images cross to the worker as plain {data, format, width?, height?} objects (ImageData can't cross into Node
// worker threads, and its clamped array needn't), and mapped images are rebuilt in the caller's type on return.
// Anything else is sent as it is, so the worker's validation gives the usual errors.
const send = (image) => {
    if (typeof ImageData !== 'undefined' && image instanceof ImageData) {
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
    if (typeof ImageData !== 'undefined' && image instanceof ImageData) {
        const {width, height} = image;
        return (result) => new ImageData(new Uint8ClampedArray(result.data.buffer, result.data.byteOffset, result.data.byteLength), width, height);
    }
    return (result) => result;
};

// The buffer behind an image's pixels, to transfer when the worker was created with `transfer: true`.
const pixelBuffers = (sent) => {
    const data = ArrayBuffer.isView(sent) ? sent : sent && ArrayBuffer.isView(sent.data) ? sent.data : null;
    return data ? [data.buffer] : [];
};

// Rebuilds an error that happened in the worker: same name, message and code as the main entry gives for the same
// input, the stack of the call that failed (`origin`, made when the call was sent), and the worker's own stack as `cause`.
const remoteError = (info, origin) => {
    const error = new Error(info.message);
    if (info.name && info.name !== 'Error') {error.name = info.name;}
    if (info.code !== undefined) {error.code = info.code;}
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
    if (typeof URL !== 'undefined' && wasm instanceof URL) {return wasm.href;}
    if (wasm instanceof ArrayBuffer || ArrayBuffer.isView(wasm)) {return wasm;}
    if (typeof WebAssembly !== 'undefined' && wasm instanceof WebAssembly.Module) {return wasm;}
    throw fail('invalid-argument', "Invalid wasm: must be a URL or path string, a URL, an ArrayBuffer or typed array of the .wasm bytes, or a WebAssembly.Module.");
};

// Options for init: only `wasm`, or none.
const initOptions = (options) => {
    if (options === undefined) {return undefined;}
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {throw fail('invalid-argument', "Invalid options: expected an object.");}
    for (const key of Object.keys(options)) {
        if (key !== 'wasm') {throw fail('invalid-argument', `Invalid option '${key}': expected wasm.`);}
    }
    return options.wasm === undefined ? {} : {wasm: wasmOption(options.wasm)};
};

// A signal and a progress callback can't cross to the worker, so they stay on this side: the options are sent without
// them, a cancel message is sent when the signal aborts, and the worker's progress messages call the callback.
const takeControls = (options) => {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {return {options, signal: undefined, onProgress: undefined};}
    const {signal, onProgress} = options;
    if (signal === undefined && onProgress === undefined) {return {options, signal, onProgress};}
    if (signal !== undefined && (signal === null || typeof signal !== 'object' || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function')) {throw fail('invalid-argument', "Invalid signal: must be an AbortSignal.");}
    if (onProgress !== undefined && typeof onProgress !== 'function') {throw fail('invalid-argument', "Invalid onProgress: must be a function.");}
    const {signal: _signal, onProgress: _onProgress, ...rest} = options;
    return {options: rest, signal, onProgress};
};

// Where the options sit among a function's arguments after the image (see takeControls).
const optionsPosition = {getClustering: 0, getPalette: 1, quantize: 1, quantizeWithClustering: 2, quantizeWithPalette: 1, quantizeToIndices: 1, quantizeToIndicesWithClustering: 2, quantizeToIndicesWithPalette: 1};

// Like fetch: an aborted call rejects with the signal's reason, an AbortError unless the caller gave another.
const abortReason = (signal) => signal.reason !== undefined ? signal.reason : new DOMException('This operation was aborted', 'AbortError');

const imageFunctions = ['getClustering', 'getPalette', 'quantize', 'quantizeWithClustering', 'quantizeWithPalette', 'quantizeToIndices', 'quantizeToIndicesWithClustering', 'quantizeToIndicesWithPalette'];
const mappedImageFunctions = ['quantize', 'quantizeWithClustering', 'quantizeWithPalette'];
const otherFunctions = ['getPaletteFromClustering', 'getPaletteWeights', 'getClusteringInfo'];

export const createWorker = (options) => {

    if (options === undefined) {options = {};}
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {throw fail('invalid-argument', "Invalid options: expected an object.");}
    for (const key of Object.keys(options)) {
        if (key !== 'transfer' && key !== 'wasm') {throw fail('invalid-argument', `Invalid option '${key}': expected transfer, wasm.`);}
    }
    if (options.transfer !== undefined && typeof options.transfer !== 'boolean') {throw fail('invalid-argument', "Invalid transfer: must be a boolean.");}
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
        if (message.error !== undefined) {call.reject(remoteError(message.error, call.origin));} else {call.resolve(message.result);}
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
                connection.post({id, method, args, cancellable: signal !== undefined || onProgress !== undefined, progress: onProgress !== undefined}, transfer ? transferable : []);
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
                const {options, signal, onProgress} = takeControls(rest[position]);
                // Checked before the image is copied or transferred away, so an aborted call leaves it with the caller.
                if (signal && signal.aborted) {throw abortReason(signal);}
                const args = rest.slice();
                if (position < args.length) {args[position] = options;}
                const sent = send(image);
                const result = await invoke(name, [sent, ...args], pixelBuffers(sent), origin, {signal, onProgress});
                return mapped ? rebuild(image)(result) : result;
            })();
        };
    }
    for (const name of otherFunctions) {
        instance[name] = (...args) => invoke(name, args, [], new Error());
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
            const sent = send(image);
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
                try {taken = takeControls(mapOptions);} catch (error) {return Promise.reject(error);}
                return use(method, [...leading, taken.options], {signal: taken.signal, onProgress: taken.onProgress});
            };
            const handle = {
                getClustering: () => use('handleGetClustering', []),
                getPalette: (k) => use('handleGetPalette', [k]),
                getPaletteWeights: (k) => use('handleGetPaletteWeights', [k]),
                getClusteringInfo: () => use('handleGetClusteringInfo', []),
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
export const getPaletteWeights = (...args) => sharedWorker().getPaletteWeights(...args);
export const getClusteringInfo = (...args) => sharedWorker().getClusteringInfo(...args);
export const quantize = (...args) => sharedWorker().quantize(...args);
export const quantizeWithClustering = (...args) => sharedWorker().quantizeWithClustering(...args);
export const quantizeWithPalette = (...args) => sharedWorker().quantizeWithPalette(...args);
export const quantizeToIndices = (...args) => sharedWorker().quantizeToIndices(...args);
export const quantizeToIndicesWithClustering = (...args) => sharedWorker().quantizeToIndicesWithClustering(...args);
export const quantizeToIndicesWithPalette = (...args) => sharedWorker().quantizeToIndicesWithPalette(...args);
