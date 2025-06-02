import createWasmModule from '../dist/clustering.js';
import { data } from './image.js';

let module = null;

async function init() {
    if (!module) {module = await createWasmModule();}
    return module;
}

function unpack(Module, pointer) {
    const lengthBuffer = new Uint8Array(Module.HEAPU8.subarray(pointer, pointer + 4));
    const length = lengthBuffer[0] | (lengthBuffer[1] << 8) | (lengthBuffer[2] << 16) | (lengthBuffer[3] << 24);
    const outputBuffer = new Uint8Array(Module.HEAPU8.subarray(pointer + 4, pointer + 4 + length));
    return outputBuffer;
}

export async function process(input) {

    const Module = await init();

    if (!(input instanceof Uint8Array)) {
        throw new TypeError('Input must be a Uint8Array');
    }

    const inputPointer = Module._malloc(input.length);
    Module.HEAPU8.set(input, inputPointer);

    const outputPointer = Module._quantize(inputPointer, input.length, 1, 10);
    const output = unpack(Module, outputPointer);

    Module._free(inputPointer);
    Module._free(outputPointer);

    return output;

}

let f = async () => {
    let result = await process(new Uint8Array(data));
    console.log(result);
}; f();

