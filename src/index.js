import createWasmModule from '../dist/clustering.js';
import { data } from './image.js';

let module = null;

async function init() {
    if (!module) {module = await createWasmModule();}
    return module;
}

export async function process(input) {

    const Module = await init();

    if (!(input instanceof Uint8Array)) {
        throw new TypeError('Input must be a Uint8Array');
    }

    const len = input.length;
    const inputPtr = Module._malloc(len);
    Module.HEAPU8.set(input, inputPtr);

    const outputPtr = Module._get_clustering(inputPtr, len, 1);
    const outputLenBuffer = new Uint8Array(Module.HEAPU8.subarray(outputPtr, outputPtr + 4));
    const outputLen = outputLenBuffer[0] | (outputLenBuffer[1] << 8) | (outputLenBuffer[2] << 16) | (outputLenBuffer[3] << 24);
    const clusteringBuffer = new Uint8Array(Module.HEAPU8.subarray(outputPtr + 4, outputPtr + 4 + outputLen));
    console.log(outputLen);
    console.log(clusteringBuffer);

    //const output = new Uint8Array(Module.HEAPU8.subarray(outputPtr, outputPtr + len));
    Module._free(inputPtr);
    Module._free(outputPtr);
    //return new Uint8Array(output);
    return new Uint8Array([]);

    /*
    const len = input.length;
    const inputPtr = Module._malloc(len);
    Module.HEAPU8.set(input, inputPtr);
    const outputPtr = Module._process(inputPtr, len);
    const output = new Uint8Array(Module.HEAPU8.subarray(outputPtr, outputPtr + len));
    Module._free(inputPtr);
    Module._free(outputPtr);
    return new Uint8Array(output);
    */

}

let f = async () => {
    let result = await process(new Uint8Array(data));
    console.log(result);
}; f();

