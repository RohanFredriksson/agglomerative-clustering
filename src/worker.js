// The `agglomerative-clustering/worker` entry: the same API, run in a Web Worker (browsers) or a worker thread
// (Node), so clustering doesn't block the calling thread. `createWorker()` starts a worker with every function of
// the main entry as a method, plus `cluster`, which keeps an image and its clustering in the worker behind a
// handle, so re-cutting and re-mapping it copies nothing across. The functions exported directly use one shared
// worker, started on first use.

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

const imageFunctions = ['getClustering', 'getPalette', 'quantize', 'quantizeWithClustering', 'quantizeWithPalette', 'quantizeToIndices', 'quantizeToIndicesWithClustering', 'quantizeToIndicesWithPalette'];
const mappedImageFunctions = ['quantize', 'quantizeWithClustering', 'quantizeWithPalette'];
const otherFunctions = ['getPaletteFromClustering', 'getPaletteWeights', 'getClusteringInfo'];

export const createWorker = (options) => {

    if (options === undefined) {options = {};}
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {throw new Error("Invalid options: expected an object.");}
    for (const key of Object.keys(options)) {
        if (key !== 'transfer') {throw new Error(`Invalid option '${key}': expected transfer.`);}
    }
    if (options.transfer !== undefined && typeof options.transfer !== 'boolean') {throw new Error("Invalid transfer: must be a boolean.");}
    const transfer = options.transfer === true;

    let connection = null;
    let starting = null;
    let terminated = false;
    let nextId = 1;
    let nextHandle = 1;
    const pending = new Map();

    const receive = (message) => {
        if (message.failure !== undefined) {
            for (const {reject} of pending.values()) {reject(new Error(`Worker failed: ${message.failure}`));}
            pending.clear();
            return;
        }
        const call = pending.get(message.id);
        if (!call) {return;}
        pending.delete(message.id);
        if (pending.size === 0 && connection) {connection.unref();}
        if (message.error !== undefined) {call.reject(new Error(message.error));} else {call.resolve(message.result);}
    };

    const invoke = async (method, args, transferable = []) => {
        if (terminated) {throw new Error("Worker terminated.");}
        if (!connection) {
            starting = starting || start(receive);
            connection = await starting;
            if (terminated) {connection.terminate(); throw new Error("Worker terminated.");}
        }
        const id = nextId++;
        return new Promise((resolve, reject) => {
            if (pending.size === 0) {connection.ref();}
            pending.set(id, {resolve, reject});
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
        instance[name] = async (image, ...rest) => {
            const sent = send(image);
            const result = await invoke(name, [sent, ...rest], pixelBuffers(sent));
            return mapped ? rebuild(image)(result) : result;
        };
    }
    for (const name of otherFunctions) {
        instance[name] = (...args) => invoke(name, args);
    }

    instance.init = async () => {await invoke('init', []);};

    // Clusters `image` and keeps it, with its clustering, in the worker.
    instance.cluster = async (image, clusterOptions) => {
        const id = nextHandle++;
        const sent = send(image);
        await invoke('cluster', [id, sent, clusterOptions], pixelBuffers(sent));
        const output = rebuild(image);
        let released = false;
        const use = (method, args) => {
            if (released) {return Promise.reject(new Error("Invalid handle: it was released."));}
            return invoke(method, [id, ...args]);
        };
        return {
            getClustering: () => use('handleGetClustering', []),
            getPalette: (k) => use('handleGetPalette', [k]),
            getPaletteWeights: (k) => use('handleGetPaletteWeights', [k]),
            getInfo: () => use('handleGetInfo', []),
            quantize: async (k, mapOptions) => output(await use('handleQuantize', [k, mapOptions])),
            quantizeToIndices: (k, mapOptions) => use('handleQuantizeToIndices', [k, mapOptions]),
            release: async () => {
                if (released) {return;}
                released = true;
                await invoke('release', [id]);
            },
        };
    };

    // Stops the worker. Calls still waiting are rejected, and later calls fail.
    instance.terminate = async () => {
        if (terminated) {return;}
        terminated = true;
        for (const {reject} of pending.values()) {reject(new Error("Worker terminated."));}
        pending.clear();
        if (connection) {await connection.terminate();}
        else if (starting) {(await starting).terminate();}
    };

    return instance;

};

let shared = null;
const sharedWorker = () => (shared = shared || createWorker());

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
