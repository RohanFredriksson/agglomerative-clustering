export default { async fetch() {
  const out = { SharedArrayBuffer: typeof SharedArrayBuffer, Worker: typeof Worker, crossOriginIsolated: String(globalThis.crossOriginIsolated), threadsNavigator: typeof navigator === 'object' ? navigator.userAgent : 'none' };
  try { new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true }); out.sharedMemory = 'constructs'; } catch (e) { out.sharedMemory = String(e).slice(0, 100); }
  return new Response(JSON.stringify(out));
} };
