// Question 4, browsers: loads the -pthread build (build/lib-threaded.mjs) and the single-threaded one (build/lib-base.mjs)
// on a page served with and without cross-origin isolation (COOP same-origin + COEP require-corp), in Chromium, Firefox and
// WebKit through Playwright. Reports what the page sees (crossOriginIsolated, SharedArrayBuffer), whether the threaded build
// starts, and the time to start. Usage: node browser-sab.mjs   (needs build-lib.sh builds of base and threaded)
import http from 'http';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../../../package.json'));
const pw = require('playwright-core');
const types = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };
const page = `<!doctype html><meta charset=utf-8><script type=module>
const out = { crossOriginIsolated: self.crossOriginIsolated, SharedArrayBuffer: typeof SharedArrayBuffer };
try { new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true }); out.sharedMemoryConstructs = true; } catch (e) { out.sharedMemoryConstructs = String(e); }
const pixels = new Uint8Array(256 * 256 * 4).map((_, i) => (i * 7) & 255);
const palette = new Uint8Array([0,0,0, 255,255,255, 255,0,0, 0,0,255]);
async function run(file, threads) {
  const t0 = performance.now();
  try {
    const create = (await import('/' + file)).default;
    const M = await Promise.race([create(), new Promise((_, r) => setTimeout(() => r(new Error('timeout after 10 s')), 10000))]);
    const t1 = performance.now();
    const ip = M._malloc(pixels.length); M.HEAPU8.set(pixels, ip);
    const pp = M._malloc(palette.length); M.HEAPU8.set(palette, pp);
    const r = M._quantize_with_palette_threaded ? M._quantize_with_palette_threaded(ip, pixels.length, 0, pp, palette.length, 0, 0, 0, 0, 256, threads) : M._quantize_with_palette(ip, pixels.length, 0, pp, palette.length, 0, 0, 0, 0, 256);
    const t2 = performance.now();
    return { ok: true, startMs: Math.round(t1 - t0), callMs: Math.round(t2 - t1), outputBytes: new DataView(M.HEAPU8.buffer).getUint32(r, true) };
  } catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 200), afterMs: Math.round(performance.now() - t0) }; }
}
out.single = await run('lib-base.mjs', 1);
out.threaded = await run('lib-threaded.mjs', 4);
// the run-time choice a library could make
out.canUseThreads = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated === true;
out.chosen = out.canUseThreads ? 'threaded' : 'single';
document.title = JSON.stringify(out);
</script>`;
function serve(isolated) {
    return new Promise((resolve) => {
        const s = http.createServer((req, res) => {
            const url = req.url.split('?')[0];
            const h = { 'Cache-Control': 'no-store' };
            if (isolated) { h['Cross-Origin-Opener-Policy'] = 'same-origin'; h['Cross-Origin-Embedder-Policy'] = 'require-corp'; h['Cross-Origin-Resource-Policy'] = 'same-origin'; }
            if (url === '/' || url === '/index.html') { res.writeHead(200, { ...h, 'Content-Type': 'text/html' }); return res.end(page); }
            const f = join(here, 'build', url.slice(1));
            if (!existsSync(f) || url.includes('..')) { res.writeHead(404, h); return res.end(); }
            const ext = url.slice(url.lastIndexOf('.'));
            res.writeHead(200, { ...h, 'Content-Type': types[ext] || 'application/octet-stream' }); res.end(readFileSync(f));
        }).listen(0, '127.0.0.1', () => resolve(s));
    });
}
const pick = (dir, prefix, exe) => { const base = join(process.env.HOME, '.cache/ms-playwright'); const d = existsSync(base) ? readdirSync(base).filter((x) => x.startsWith(prefix)).sort().pop() : null; return d ? join(base, d, exe) : null; };
const browsers = [['chromium', pw.chromium, process.env.CHROMIUM_PATH || pick('', 'chromium-', 'chrome-linux64/chrome')], ['firefox', pw.firefox, pick('', 'firefox-', 'firefox/firefox')], ['webkit', pw.webkit, pick('', 'webkit-', 'pw_run.sh')]];
const results = [];
for (const [name, engine, exe] of browsers) {
    for (const isolated of [false, true]) {
        const server = await serve(isolated);
        let r;
        try {
            const browser = await engine.launch({ headless: true, ...(exe && existsSync(exe) ? { executablePath: exe } : {}) });
            const p = await browser.newPage();
            const errors = []; p.on('pageerror', (e) => errors.push(String(e).slice(0, 150)));
            await p.goto(`http://127.0.0.1:${server.address().port}/`);
            await p.waitForFunction(() => document.title.startsWith('{'), null, { timeout: 30000 });
            r = JSON.parse(await p.title()); if (errors.length) r.pageErrors = errors;
            await browser.close();
        } catch (e) { r = { launchError: String(e.message).split('\n')[0].slice(0, 200) }; }
        server.close();
        results.push({ browser: name, isolated, ...r });
        console.log(JSON.stringify(results.at(-1)));
    }
}
