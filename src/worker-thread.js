// Runs inside the worker started by worker.js: receives calls, runs them with the main entry, and posts results
// back, transferring every result buffer. Imports `./index.mjs`, which exists only in dist/ (like clustering.js).
import * as ac from './index.mjs';

// Images kept in the worker by `cluster`, with their clusterings, by handle id.
const handles = new Map();

const handle = (id) => {
    const entry = handles.get(id);
    if (!entry) {throw Object.assign(new Error("Invalid handle: it was released, or belongs to another worker."), {code: 'invalid-handle'});}
    return entry;
};

const methods = {
    ...ac,
    cluster: async (id, image, options) => {
        handles.set(id, {image, clustering: await ac.getClustering(image, options)});
    },
    release: async (id) => {handles.delete(id);},
    handleGetClustering: async (id) => handle(id).clustering.slice(),
    handleGetPalette: async (id, k) => ac.getPaletteFromClustering(handle(id).clustering, k),
    handleGetPaletteWeights: async (id, k) => ac.getPaletteWeights(handle(id).clustering, k),
    handleGetClusteringInfo: async (id) => ac.getClusteringInfo(handle(id).clustering),
    handleQuantize: async (id, k, options) => ac.quantizeWithClustering(handle(id).image, handle(id).clustering, k, options),
    handleQuantizeToIndices: async (id, k, options) => ac.quantizeToIndicesWithClustering(handle(id).image, handle(id).clustering, k, options),
};

// The buffers in a result, to transfer rather than copy. Results are freshly allocated, so nothing here uses them.
const buffers = (value) => {
    if (ArrayBuffer.isView(value)) {return [value.buffer];}
    if (value && typeof value === 'object') {return Object.values(value).filter(ArrayBuffer.isView).map((view) => view.buffer);}
    return [];
};

const respond = async ({id, method, args}, post) => {
    try {
        if (!Object.hasOwn(methods, method)) {throw Object.assign(new Error(`Unknown method '${method}'.`), {code: 'invalid-argument'});}
        const result = await methods[method](...args);
        post({id, result}, [...new Set(buffers(result))]);
    } catch (error) {
        // Errors cross as plain data: the caller's side rebuilds them with the same name, message and code.
        post({id, error: error instanceof Error
            ? {name: error.name, message: error.message, code: error.code, stack: error.stack}
            : {name: 'Error', message: String(error), code: 'worker-failed'}});
    }
};

// No top-level await: bundlers build workers as classic scripts by default (Vite's 'iife'), which can't have it.
if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof self.addEventListener === 'function') {
    self.addEventListener('message', (event) => respond(event.data, (message, transfer) => self.postMessage(message, transfer)));
} else {
    import(/* webpackIgnore: true */ /* @vite-ignore */ 'node:worker_threads').then(({parentPort}) => {
        parentPort.on('message', (data) => respond(data, (message, transfer) => parentPort.postMessage(message, transfer)));
    });
}
