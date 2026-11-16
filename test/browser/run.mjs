// Bundler and browser smoke test: npm run test:browser (after npm run build).
// Installs this package (by symlink) into a temporary project, bundles test/browser/app with each bundler (Vite and
// webpack 5), serves the bundle, and runs it in a headless browser. This checks what Node tests can't: that a bundler
// follows the package's exports, emits the worker script and the .wasm, and that the worker runs in a browser.
// Browsers: Chromium (CHROMIUM_PATH if set, else the installed Chrome, as on GitHub's Ubuntu runners, else Playwright's).
// BROWSERS=chromium,webkit adds WebKit, whose launcher is WEBKIT_PATH (Playwright's pw_run.sh) if set.
// BUNDLERS=vite or BUNDLERS=webpack runs one of them.
import { build } from 'vite';
import webpack from 'webpack';
import { chromium, webkit } from 'playwright-core';
import { createServer } from 'http';
import { mkdtemp, mkdir, symlink, cp, readFile, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, extname, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const bundlers = (process.env.BUNDLERS || 'vite,webpack').split(',');
const browsers = (process.env.BROWSERS || 'chromium').split(',');

// How each bundler is run, and how the app gets the URL of the package's .wasm (each bundler spells it differently).
const bundle = {
    vite: {
        wasmUrl: "import url from 'agglomerative-clustering/clustering.wasm?url';\nexport default url;\n",
        run: async (project) => {
            await build({ root: join(project, 'app'), logLevel: 'warn', build: { outDir: join(project, 'out'), emptyOutDir: true } });
        },
    },
    webpack: {
        wasmUrl: "export default new URL('agglomerative-clustering/clustering.wasm', import.meta.url).href;\n",
        run: async (project) => {
            await writeFile(join(project, 'app', 'index.html'), '<!doctype html>\n<html><head><meta charset="utf-8"><title>webpack</title></head><body><script src="./main.bundle.js"></script></body></html>\n');
            const compiler = webpack({
                mode: 'production', target: 'web', context: join(project, 'app'), entry: './main.js',
                output: { path: join(project, 'out'), filename: 'main.bundle.js', publicPath: '' },
            });
            const stats = await new Promise((done, fail) => compiler.run((error, result) => (error ? fail(error) : done(result))));
            await new Promise((done) => compiler.close(done));
            if (stats.hasErrors()) {throw new Error(`webpack failed:\n${stats.toString({ all: false, errors: true })}`);}
            if (stats.hasWarnings()) {console.log(`webpack warnings:\n${stats.toString({ all: false, warnings: true })}`);}
            await cp(join(project, 'app', 'index.html'), join(project, 'out', 'index.html'));
        },
    },
};

const launchBrowser = (name) => {
    if (name === 'webkit') {return webkit.launch(process.env.WEBKIT_PATH ? { executablePath: process.env.WEBKIT_PATH } : {});}
    const launch = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' };
    return chromium.launch(launch).catch(() => chromium.launch());
};

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm' };

for (const bundler of bundlers) {
    const project = await mkdtemp(join(tmpdir(), `ac-browser-${bundler}-`));
    let server, browser;
    try {
        await mkdir(join(project, 'node_modules'));
        await symlink(root, join(project, 'node_modules', 'agglomerative-clustering'), 'dir');
        await writeFile(join(project, 'package.json'), '{ "type": "module" }\n');
        await cp(join(root, 'test/browser/app'), join(project, 'app'), { recursive: true });
        await writeFile(join(project, 'app', 'wasm-url.js'), bundle[bundler].wasmUrl);
        await bundle[bundler].run(project);

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

        for (const name of browsers) {
            browser = await launchBrowser(name);
            const page = await browser.newPage();
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            // Browsers ask for /favicon.ico on their own; any other failed request is an error.
            page.on('requestfailed', (request) => errors.push(`Request failed: ${request.url()}`));
            page.on('response', (response) => {if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {errors.push(`HTTP ${response.status()}: ${response.url()}`);}});
            await page.goto(`http://127.0.0.1:${server.address().port}/`);
            const result = await page.waitForFunction(() => window.result, null, { timeout: 30_000 }).then((handle) => handle.jsonValue());

            if (result.error) {throw new Error(`The page failed (${bundler}, ${name}): ${result.error}`);}
            const failed = Object.entries(result.checks).filter(([, passed]) => !passed).map(([check]) => check);
            console.log(`${bundler} in ${name}:`);
            for (const [check, passed] of Object.entries(result.checks)) {console.log(`${passed ? '  ok  ' : '  FAIL'} ${check}`);}
            if (errors.length) {console.log(`  Browser errors:\n${errors.join('\n')}`);}
            if (failed.length || errors.length) {process.exitCode = 1;}
            await browser.close();
            browser = null;
        }
    } catch (error) {
        console.log(String(error && error.stack || error));
        process.exitCode = 1;
    } finally {
        await browser?.close();
        server?.close();
        await rm(project, { recursive: true, force: true });
    }
}
