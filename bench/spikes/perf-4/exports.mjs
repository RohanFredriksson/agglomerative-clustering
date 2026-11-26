// Prints the EXPORTED_FUNCTIONS list of the repo's build:wasm script.
import { readFileSync } from 'fs';
const s = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).scripts['build:wasm'];
console.log(s.match(/EXPORTED_FUNCTIONS=\\"(.*?)\\"/)?.[1] ?? s.match(/EXPORTED_FUNCTIONS="(.*?)"/)[1]);
