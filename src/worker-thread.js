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

// A palette doesn't say which colour space it was made in. A handle's palette almost always came from the handle itself,
// so mapping with it should match in the space the handle was clustered in, as handle.quantize does, unless the caller
// names one. Options that aren't an ordinary object are passed on as they are for the main entry to reject.
const inClusteringSpace = async (id, options, palette) => {
    if (options !== undefined && Object.prototype.toString.call(options) !== '[object Object]') {return options;}
    // A Palette knows the space it was made in; the main entry uses that unless one is named.
    if (isPalette(palette) && !(options && options.colorSpace !== undefined)) {return options;}
    const {colorSpace} = await ac.getClusteringInfo(handle(id).clustering);
    return {...options, colorSpace: options && options.colorSpace !== undefined ? options.colorSpace : colorSpace};
};

// A palette and a clustering are Uint8Array subclasses that a structured clone turns into plain ones, losing a palette's colour
// space. So they cross as markers (see `pack` and `revive` in worker.js): arguments are revived into the classes here, and
// results are marked before they are posted.
const MARK = '__agglomerativeClustering';
const paletteBrand = Symbol.for('agglomerative-clustering.palette');
const clusteringBrand = Symbol.for('agglomerative-clustering.clustering');
const isPalette = (value) => value instanceof Uint8Array && value[paletteBrand] === true;
const isClustering = (value) => value instanceof Uint8Array && value[clusteringBrand] === true;
const revive = (value) => value && typeof value === 'object' && value[MARK] === 'palette' ? new ac.Palette(value.bytes, value.colorSpace) : value;
const mark = (value) => {
    if (isPalette(value)) {return {[MARK]: 'palette', bytes: new Uint8Array(value.buffer, value.byteOffset, value.length), colorSpace: value.colorSpace};}
    if (isClustering(value)) {return {[MARK]: 'clustering', bytes: new Uint8Array(value.buffer, value.byteOffset, value.length)};}
    return value;
};
const serialise = (result) => {
    if (!result || typeof result !== 'object' || ArrayBuffer.isView(result)) {return mark(result);}
    return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, mark(value)]));
};

// The functions of the main entry, by name (not its classes and constants).
const functions = Object.fromEntries(Object.entries(ac).filter(([name, value]) => typeof value === 'function' && !/^[A-Z]/.test(name)));

const methods = {
    ...functions,
    cluster: async (id, image, options) => {
        handles.set(id, {image, clustering: await ac.getClustering(image, options)});
    },
    release: async (id) => {handles.delete(id);},
    handleGetClustering: async (id) => new ac.Clustering(handle(id).clustering),
    handleGetPalette: async (id, k) => ac.getPaletteFromClustering(handle(id).clustering, k),
    handleGetSwatches: async (id, k) => ac.getSwatchesFromClustering(handle(id).clustering, k),
    handleGetClusteringInfo: async (id) => ac.getClusteringInfo(handle(id).clustering),
    handleQuantize: async (id, k, options) => ac.quantizeFromClustering(handle(id).image, handle(id).clustering, k, options),
    handleQuantizeToIndices: async (id, k, options) => ac.quantizeToIndicesFromClustering(handle(id).image, handle(id).clustering, k, options),
    handleQuantizeWithPalette: async (id, palette, options) => ac.quantizeWithPalette(handle(id).image, palette, await inClusteringSpace(id, options, palette)),
    handleQuantizeToIndicesWithPalette: async (id, palette, options) => ac.quantizeToIndicesWithPalette(handle(id).image, palette, await inClusteringSpace(id, options, palette)),
};

// The buffers in a result, to transfer rather than copy. Results are freshly allocated, so nothing here uses them.
const buffers = (value) => {
    if (ArrayBuffer.isView(value)) {return [value.buffer];}
    if (value && typeof value === 'object') {
        if (value[MARK]) {return [value.bytes.buffer];}
        return Object.values(value).flatMap((part) => ArrayBuffer.isView(part) ? [part.buffer] : part && typeof part === 'object' && part[MARK] ? [part.bytes.buffer] : []);
    }
    return [];
};

// Where the options sit among each method's arguments, to give them the call's signal and progress callback.
const optionsIndex = {
    getClustering: 1, getPalette: 2, getSwatches: 2, quantize: 2, quantizeFromClustering: 3, quantizeWithPalette: 2,
    quantizeToIndices: 2, quantizeToIndicesFromClustering: 3, quantizeToIndicesWithPalette: 2,
    cluster: 2, handleQuantize: 2, handleQuantizeToIndices: 2, handleQuantizeWithPalette: 2, handleQuantizeToIndicesWithPalette: 2,
};

// One AbortController per call that can be cancelled, by call id. It exists from the moment the call arrives, so a call
// still waiting its turn can be cancelled and never starts.
const controllers = new Map();

const respond = async ({id, method, args, progress}, post) => {
    const controller = controllers.get(id);
    try {
        if (controller && controller.signal.aborted) {return;}
        if (!Object.hasOwn(methods, method)) {throw Object.assign(new Error(`Unknown method '${method}'.`), {code: 'invalid-argument'});}
        if (controller || progress) {
            args = args.slice();
            const index = optionsIndex[method];
            const options = {...(args[index] || {})};
            if (controller) {options.signal = controller.signal;}
            if (progress) {options.onProgress = (fraction) => post({id, progress: fraction});}
            args[index] = options;
        }
        const result = serialise(await methods[method](...args.map(revive)));
        post({id, result}, [...new Set(buffers(result))]);
    } catch (error) {
        // A cancelled call has already been rejected on the other side.
        if (controller && controller.signal.aborted) {return;}
        // Errors cross as plain data: the caller's side rebuilds them with the same name, message and code.
        post({id, error: error instanceof Error
            ? {name: error.name, message: error.message, code: error.code, stack: error.stack}
            : {name: 'Error', message: String(error), code: 'worker-failed'}});
    } finally {
        controllers.delete(id);
    }
};

// Calls run one at a time, in the order they arrived. A call that takes several turns of the event loop (a clustering run
// in slices) lets messages in between, which is how a cancel reaches it; without the queue, later calls would run
// in between its slices instead of after it.
let queue = Promise.resolve();
const onMessage = (data, post) => {
    if (data.cancel !== undefined) {
        const controller = controllers.get(data.cancel);
        if (controller) {controller.abort();}
        return;
    }
    if (data.cancellable) {controllers.set(data.id, new AbortController());}
    // respond() answers every failure itself; this catch only keeps one unforeseen rejection (an error that can't be posted)
    // from leaving the queue rejected, which would silently stop the thread from running any later call.
    queue = queue.then(() => respond(data, post)).catch(() => {});
};

// No top-level await: bundlers build workers as classic scripts by default (Vite's 'iife'), which can't have it.
// Decided the way worker.js decides how it started this thread: where Node's APIs exist (Node, Deno, Bun), the thread was
// started through worker_threads and talks through parentPort. Bun also defines the browser's `self.postMessage`
// inside such a thread, so checking `self` first would listen on a channel the parent never writes to.
const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node);
if (!isNode && typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof self.addEventListener === 'function') {
    self.addEventListener('message', (event) => onMessage(event.data, (message, transfer) => self.postMessage(message, transfer)));
} else {
    // Built at run time so no bundler tries to resolve it (see worker.js).
    import(/* webpackIgnore: true */ /* @vite-ignore */ ['node', 'worker_threads'].join(':')).then(({parentPort}) => {
        parentPort.on('message', (data) => onMessage(data, (message, transfer) => parentPort.postMessage(message, transfer)));
    });
}
