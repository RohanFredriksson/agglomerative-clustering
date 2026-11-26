import {loadavg} from 'os';
// Cost of the JS boundary's two big copies at 20 MP (80 MB): into the WebAssembly heap (HEAPU8.set) and out of it (unpack: new Uint8Array(subarray)),
// against alternatives that give the same bytes: subarray.slice(), and a pre-sized new Uint8Array + set. Median of 9, on a WebAssembly.Memory.
const N = 80 * 1024 * 1024;
const memory = new WebAssembly.Memory({initial: 3 * N / 65536 + 16, maximum: 32768});
const heap = new Uint8Array(memory.buffer);
const src = new Uint8Array(N); for (let i = 0; i < N; i += 4096) src[i] = i >> 12;
const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
const time = (f) => { const r = []; for (let i = 0; i < 9; i++) { const t = performance.now(); f(); r.push(performance.now() - t); } return median(r); };
console.log('load', loadavg());
console.log('set into heap            ', time(() => heap.set(src, 1 << 20)).toFixed(1), 'ms');
console.log('new Uint8Array(subarray) ', time(() => new Uint8Array(heap.subarray(1 << 20, (1 << 20) + N))).toFixed(1), 'ms');
console.log('subarray.slice()         ', time(() => heap.subarray(1 << 20, (1 << 20) + N).slice()).toFixed(1), 'ms');
console.log('new Uint8Array(N)+set    ', time(() => { const o = new Uint8Array(N); o.set(heap.subarray(1 << 20, (1 << 20) + N)); }).toFixed(1), 'ms');
console.log('Uint8Array.from copyWithin-free: heap.buffer.slice', time(() => memory.buffer.slice(1 << 20, (1 << 20) + N)).toFixed(1), 'ms');
