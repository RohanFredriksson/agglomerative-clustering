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
    const {Worker: NodeWorker} = await import(/* webpackIgnore: true */ /* @vite-ignore */ 'node:worker_threads');
    // The worker script needs none of the parent's flags, and some (like --input-type) are invalid in a worker.
    const worker = new NodeWorker(new URL('./worker-thread.mjs', import.meta.url), {execArgv: []});
    worker.on('message', receive);
    worker.on('error', (error) => receive({failure: error.message}));
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

const imageFunctions = ['getClustering', 'getPalette', 'quantize', 'quantizeWithClustering', 'quantizeWithPalette', 'quantizeToIndices', 'quantizeToIndicesWithClustering', 'quantizeToIndicesWithPalette'];
const mappedImageFunctions = ['quantize', 'quantizeWithClustering', 'quantizeWithPalette'];
const otherFunctions = ['getPaletteFromClustering', 'getPaletteWeights', 'getClusteringInfo'];

export const createWorker = (options) => {

    if (options === undefined) {options = {};}
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {throw fail('invalid-argument', "Invalid options: expected an object.");}
    for (const key of Object.keys(options)) {
        if (key !== 'transfer') {throw fail('invalid-argument', `Invalid option '${key}': expected transfer.`);}
    }
    if (options.transfer !== undefined && typeof options.transfer !== 'boolean') {throw fail('invalid-argument', "Invalid transfer: must be a boolean.");}
    const transfer = options.transfer === true;

    let connection = null;
    let starting = null;
    let terminated = false;
    let nextId = 1;
    let nextHandle = 1;
    const pending = new Map();

    // Safety net for handles dropped without release(): when a handle is garbage-collected, the worker frees what it
    // kept for it. Best-effort, since collection time is up to the engine; release() or `await using` is the contract.
    const reclaim = typeof FinalizationRegistry === 'function'
        ? new FinalizationRegistry((id) => {if (!terminated) {invoke('release', [id], [], new Error()).catch(() => {});}})
        : null;

    const receive = (message) => {
        if (message.failure !== undefined) {
            for (const {reject} of pending.values()) {reject(fail('worker-failed', `Worker failed: ${message.failure}`));}
            pending.clear();
            return;
        }
        const call = pending.get(message.id);
        if (!call) {return;}
        pending.delete(message.id);
        if (pending.size === 0 && connection) {connection.unref();}
        if (message.error !== undefined) {call.reject(remoteError(message.error, call.origin));} else {call.resolve(message.result);}
    };

    // `origin` is an Error made in the caller's own (non-async) function, for the stack of a failure: async helpers
    // from transpiled code would otherwise fill the stack's frame limit before the caller shows up.
    const invoke = async (method, args, transferable, origin) => {
        if (terminated) {throw fail('worker-terminated', "Worker terminated.");}
        if (!connection) {
            starting = starting || start(receive);
            connection = await starting;
            if (terminated) {connection.terminate(); throw fail('worker-terminated', "Worker terminated.");}
        }
        const id = nextId++;
        return new Promise((resolve, reject) => {
            if (pending.size === 0) {connection.ref();}
            pending.set(id, {resolve, reject, origin});
            try {
                connection.post({id, method, args}, transfer ? transferable : []);
            } catch (error) {
                pending.delete(id);
                if (pending.size === 0) {connection.unref();}
                reject(error);
            }
        });
    };

    const instance = {};

    for (const name of imageFunctions) {
        const mapped = mappedImageFunctions.includes(name);
        instance[name] = (image, ...rest) => {
            const origin = new Error();
            return (async () => {
                const sent = send(image);
                const result = await invoke(name, [sent, ...rest], pixelBuffers(sent), origin);
                return mapped ? rebuild(image)(result) : result;
            })();
        };
    }
    for (const name of otherFunctions) {
        instance[name] = (...args) => invoke(name, args, [], new Error());
    }

    instance.init = () => invoke('init', [], [], new Error()).then(() => undefined);

    // Clusters `image` and keeps it, with its clustering, in the worker.
    instance.cluster = (image, clusterOptions) => {
        const origin = new Error();
        return (async () => {
            const id = nextHandle++;
            const sent = send(image);
            await invoke('cluster', [id, sent, clusterOptions], pixelBuffers(sent), origin);
            const output = rebuild(image);
            let released = false;
            // Every method goes through `use`, which refers to `handle`, so a method kept after the handle itself is dropped
            // keeps it alive and it is not reclaimed while still in use.
            const use = (method, args) => {
                if (released || !handle) {return Promise.reject(fail('invalid-handle', "Invalid handle: it was released."));}
                return invoke(method, [id, ...args], [], new Error());
            };
            const handle = {
                getClustering: () => use('handleGetClustering', []),
                getPalette: (k) => use('handleGetPalette', [k]),
                getPaletteWeights: (k) => use('handleGetPaletteWeights', [k]),
                getClusteringInfo: () => use('handleGetClusteringInfo', []),
                quantize: async (k, mapOptions) => output(await use('handleQuantize', [k, mapOptions])),
                quantizeToIndices: (k, mapOptions) => use('handleQuantizeToIndices', [k, mapOptions]),
                release: async () => {
                    if (released) {return;}
                    released = true;
                    if (reclaim) {reclaim.unregister(handle);}
                    await invoke('release', [id], [], new Error());
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
        for (const {reject} of pending.values()) {reject(fail('worker-terminated', "Worker terminated."));}
        pending.clear();
        if (connection) {await connection.terminate();}
        else if (starting) {(await starting).terminate();}
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

export const init = () => sharedWorker().init();
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
