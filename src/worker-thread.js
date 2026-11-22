// Runs inside the worker started by worker.js: receives calls, runs them with the main entry, and posts results
// back, transferring every result buffer. Imports `./index.mjs`, which exists only in dist/ (like clustering.js).
import * as ac from './index.mjs';
import {MARK, mark, revive, isPalette} from './shared.js';

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

// Palettes and clusterings cross the boundary as markers (shared.js): arguments are revived here, and results are marked
// before they are posted.
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

// A turn of the event loop, so messages already sent to this thread (cancels) are read first. In Node, setImmediate runs
// after the pending messages. In a browser, a message to itself on a MessageChannel: it is queued behind the messages
// already waiting, as they are posted messages too, and unlike a zero timeout it isn't stretched to 4 ms when timers
// nest (as they do along a queue of calls), which made each skipped call cost 4 ms.
const nextTurn = typeof setImmediate === 'function' ? () => new Promise((resolve) => setImmediate(resolve))
    : typeof MessageChannel === 'function' ? (() => {
        const channel = new MessageChannel(), waiting = [];
        channel.port1.onmessage = () => waiting.shift()();
        return () => new Promise((resolve) => {waiting.push(resolve); channel.port2.postMessage(null);});
    })()
    : () => new Promise((resolve) => setTimeout(resolve, 0));

// A call sent only to check its arguments (its caller's signal was aborted before it was made): it runs with a signal that
// is already aborted, so the main entry validates the arguments, reports the first wrong one, and does no work.
const alreadyAborted = () => {const controller = new AbortController(); controller.abort(); return controller;};

const respond = async ({id, method, args, progress, check}, post) => {
    const controller = check ? alreadyAborted() : controllers.get(id);
    try {
        // The call before this one may have run in one piece (mapping does), with no turn of the event loop for a cancel
        // of this call to arrive; take one before starting, so a call cancelled while it waited never runs.
        if (controller && !controller.signal.aborted) {await nextTurn();}
        if (controller && controller.signal.aborted && !check) {return;}
        if (!Object.prototype.hasOwnProperty.call(methods, method)) {throw Object.assign(new Error(`Unknown method '${method}'.`), {code: 'invalid-argument'});}
        if (controller || progress) {
            args = args.slice();
            const index = optionsIndex[method];
            const options = {...(args[index] || {})};
            if (controller) {options.signal = controller.signal;}
            if (progress) {options.onProgress = (fraction) => post({id, progress: fraction});}
            args[index] = options;
        }
        const result = mark(await methods[method](...args.map(revive)));
        post({id, result}, [...new Set(buffers(result))]);
    } catch (error) {
        // A cancelled call has already been rejected on the other side (a check reports what it found).
        if (controller && controller.signal.aborted && !check) {return;}
        // Errors cross as plain data: the caller's side rebuilds them with the same name, message and code.
        post({id, error: error instanceof Error
            ? {name: error.name, message: error.message, code: error.code, argument: error.argument, stack: error.stack}
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
    // A check runs at once, beside whatever is running: its caller has already aborted, so it must not wait for other calls.
    // It only validates: every function checks its signal before it puts anything in the WebAssembly heap, so it can't
    // disturb a clustering running in slices, or grow the heap.
    if (data.check) {respond(data, post).catch(() => {}); return;}
    if (data.cancellable) {controllers.set(data.id, new AbortController());}
    // respond() answers every failure itself; this catch only keeps one unforeseen rejection (an error that can't be posted)
    // from leaving the queue rejected, which would silently stop the thread from running any later call.
    queue = queue.then(() => respond(data, post)).catch(() => {});
};

// No top-level await: bundlers build workers as classic scripts by default (Vite's 'iife'), which can't have it.
// Where Node's APIs exist (Node, Deno, Bun) the thread was usually started through worker_threads and talks through
// parentPort. Bun also defines the browser's `self.postMessage` inside such a thread, so `self` is not checked first. But a
// Web Worker can have Node's globals too (Electron with nodeIntegrationInWorker) and no worker_threads, or no parentPort:
// then it talks through `self`. Messages that arrive while that is decided are kept, since a Web Worker drops messages
// that find no listener. (`globalThis.process`, so bundlers don't take this for a use of Node's `process` to polyfill.)
const runtime = globalThis.process;
const isNode = !!(runtime && runtime.versions && runtime.versions.node);
const hasSelf = typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof self.addEventListener === 'function';
const viaSelf = (early = []) => {
    const post = (message, transfer) => self.postMessage(message, transfer);
    self.addEventListener('message', (event) => onMessage(event.data, post));
    for (const data of early) {onMessage(data, post);}
};
if (!isNode && hasSelf) {
    viaSelf();
} else {
    const early = [];
    const keep = (event) => early.push(event.data);
    if (hasSelf) {self.addEventListener('message', keep);}
    const fallback = () => {
        if (!hasSelf) {return;}
        self.removeEventListener('message', keep);
        viaSelf(early);
    };
    // Built at run time so no bundler tries to resolve it (see worker.js).
    import(/* webpackIgnore: true */ /* @vite-ignore */ ['node', 'worker_threads'].join(':')).then(({parentPort}) => {
        if (!parentPort) {fallback(); return;}
        if (hasSelf) {self.removeEventListener('message', keep);}
        parentPort.on('message', (data) => onMessage(data, (message, transfer) => parentPort.postMessage(message, transfer)));
    }, fallback);
}
