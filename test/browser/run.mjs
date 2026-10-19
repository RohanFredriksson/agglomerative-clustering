// Bundler and browser smoke test: npm run test:browser (after npm run build).
// Installs this package (by symlink) into a temporary project, bundles test/browser/app with Vite, serves the
// bundle, and runs it in headless Chromium. This checks what Node tests can't: that a bundler follows the
// package's exports, emits the worker script and the .wasm, and that the worker runs in a browser.
// Chromium: CHROMIUM_PATH if set, else the installed Chrome (as on GitHub's Ubuntu runners), else Playwright's.
import { build } from 'vite';
import { chromium } from 'playwright-core';
import { createServer } from 'http';
import { mkdtemp, mkdir, symlink, cp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, extname, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const project = await mkdtemp(join(tmpdir(), 'ac-browser-'));
let server, browser;

try {
    await mkdir(join(project, 'node_modules'));
    await symlink(root, join(project, 'node_modules', 'agglomerative-clustering'), 'dir');
    await cp(join(root, 'test/browser/app'), join(project, 'app'), { recursive: true });
    await build({ root: join(project, 'app'), logLevel: 'warn', build: { outDir: join(project, 'out'), emptyOutDir: true } });

    const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm' };
    server = createServer(async (request, response) => {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const file = join(project, 'out', pathname.endsWith('/') ? `${pathname}index.html` : pathname);
        try {
            const body = await readFile(file);
            response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
            response.end(body);
        } catch {
            response.writeHead(404);
            response.end();
        }
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));

    const launch = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' };
    browser = await chromium.launch(launch).catch(() => chromium.launch());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Browsers ask for /favicon.ico on their own; any other failed request is an error.
    page.on('requestfailed', (request) => errors.push(`Request failed: ${request.url()}`));
    page.on('response', (response) => {if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {errors.push(`HTTP ${response.status()}: ${response.url()}`);}});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result = await page.waitForFunction(() => window.result, null, { timeout: 30_000 }).then((handle) => handle.jsonValue());

    if (result.error) {throw new Error(`The page failed: ${result.error}`);}
    const failed = Object.entries(result.checks).filter(([, passed]) => !passed).map(([name]) => name);
    for (const [name, passed] of Object.entries(result.checks)) {console.log(`${passed ? 'ok  ' : 'FAIL'} ${name}`);}
    if (errors.length) {console.log(`Browser errors:\n${errors.join('\n')}`);}
    if (failed.length || errors.length) {process.exitCode = 1;}
} finally {
    await browser?.close();
    server?.close();
    await rm(project, { recursive: true, force: true });
}
