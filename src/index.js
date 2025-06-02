import createWasmModule from '../dist/clustering.js';
import { data } from './image.js';

let Module = null;

async function init() {
    if (!Module) {Module = await createWasmModule();}
}

function unpack(pointer) {
    const lengthBuffer = new Uint8Array(Module.HEAPU8.subarray(pointer, pointer + 4));
    const length = lengthBuffer[0] | (lengthBuffer[1] << 8) | (lengthBuffer[2] << 16) | (lengthBuffer[3] << 24);
    const outputBuffer = new Uint8Array(Module.HEAPU8.subarray(pointer + 4, pointer + 4 + length));
    return outputBuffer;
}

export async function process(input) {

    await init();
    if (!(input instanceof Uint8Array)) {throw new TypeError('Input must be a Uint8Array');}
    
    const inputPointer = Module._malloc(input.length);
    Module.HEAPU8.set(input, inputPointer);

    const outputPointer = Module._quantize(inputPointer, input.length, 1, 10);
    const output = unpack(outputPointer);

    Module._free(inputPointer);
    Module._free(outputPointer);

    return output;

}

let f = async () => {
    let result = await process(new Uint8Array(data));
    console.log(result);
}; f();

