import createWasmModule from '../dist/clustering.js';

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
    const outputPtr = Module._process(inputPtr, len);
    const output = new Uint8Array(Module.HEAPU8.subarray(outputPtr, outputPtr + len));
    Module._free(inputPtr);
    Module._free(outputPtr);
    return new Uint8Array(output);

}

let f = async () => {
    let result = await process(new Uint8Array([1, 2, 3]));
    console.log(result);
}; f();

