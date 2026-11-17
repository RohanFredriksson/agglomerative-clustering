// Bundler and browser smoke test: npm run test:browser (after npm run build).
// Installs this package (by symlink) into a temporary project, bundles test/browser/app with each bundler (Vite and
// webpack 5), serves the bundle, and runs it in a headless browser. This checks what Node tests can't: that a bundler
// follows the package's exports, emits the worker script and the .wasm, and that the worker runs in a browser.
// Browsers: Chromium (CHROMIUM_PATH if set, else the installed Chrome, as on GitHub's Ubuntu runners, else Playwright's).
// BROWSERS=chromium,firefox,webkit adds Playwright's Firefox (FIREFOX_PATH if set) and WebKit (WEBKIT_PATH, Playwright's
// pw_run.sh, if set). BROWSERS=safari runs the real Safari on macOS through safaridriver (Apple's WebDriver, enabled once
// with `sudo safaridriver --enable`); Playwright's WebKit is close to Safari but is not Safari.
// BUNDLERS=vite or BUNDLERS=webpack runs one of them. PACKAGE=agglomerative-clustering@next (any npm install spec)
// installs that from the registry instead of linking this checkout, to check what was published.
import { build } from 'vite';
import webpack from 'webpack';
import { chromium, firefox, webkit } from 'playwright-core';
import { spawn, execFileSync } from 'child_process';
import { createServer } from 'http';
import { mkdtemp, mkdir, symlink, cp, readFile, writeFile, rm, realpath } from 'fs/promises';
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

// Safari has no Playwright driver, so it is driven over WebDriver: a session, a page load, and polling for window.result.
// It returns the same shape the Playwright path reads, with page errors as the app reports them in result.error.
const runInSafari = async (url) => {
    const port = 4444 + Math.floor(Math.random() * 1000);
    const driver = spawn('safaridriver', ['--port', String(port)], { stdio: 'ignore' });
    const base = `http://127.0.0.1:${port}`;
    const request = async (method, path, body) => {
        const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
        const json = await response.json();
        if (!response.ok) {throw new Error(`safaridriver ${method} ${path}: ${JSON.stringify(json.value)}`);}
        return json.value;
    };
    let session;
    try {
        for (let tries = 0; ; tries++) {
            try {session = await request('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } }); break;} catch (error) {
                if (tries > 40) {throw error;}
                await new Promise((done) => setTimeout(done, 250));
            }
        }
        const id = session.sessionId;
        await request('POST', `/session/${id}/url`, { url });
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
            const value = await request('POST', `/session/${id}/execute/sync`, { script: 'return window.result ? JSON.stringify(window.result) : null;', args: [] });
            if (value) {return { result: JSON.parse(value), version: session.capabilities && session.capabilities.browserVersion };}
            await new Promise((done) => setTimeout(done, 250));
        }
        throw new Error('Safari: the page did not finish within 60 s');
    } finally {
        if (session) {await request('DELETE', `/session/${session.sessionId}`).catch(() => {});}
        driver.kill();
    }
};

const launchBrowser = (name) => {
    if (name === 'webkit') {return webkit.launch(process.env.WEBKIT_PATH ? { executablePath: process.env.WEBKIT_PATH } : {});}
    if (name === 'firefox') {return firefox.launch(process.env.FIREFOX_PATH ? { executablePath: process.env.FIREFOX_PATH } : {});}
    // Chromium throttles timers on pages it treats as in the background, which a headless page on a busy CI runner can be;
    // the responsiveness check measures timer gaps, so throttling would measure Chromium's power saving, not our slicing.
    const args = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
    const launch = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args } : { channel: 'chrome', args };
    return chromium.launch(launch).catch(() => chromium.launch({ args }));
};

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm' };

for (const bundler of bundlers) {
    // The real path: on macOS the temp directory is behind a symlink (/var -> /private/var), and Vite then sees the
    // project's files outside its root and emits them under ../../ paths, which it refuses.
    const project = await realpath(await mkdtemp(join(tmpdir(), `ac-browser-${bundler}-`)));
    let server, browser;
    try {
        await writeFile(join(project, 'package.json'), '{ "type": "module" }\n');
        if (process.env.PACKAGE) {
            execFileSync('npm', ['install', '--no-save', '--no-audit', '--no-fund', process.env.PACKAGE], { cwd: project, stdio: 'inherit', shell: process.platform === 'win32' });
            const { version } = JSON.parse(await readFile(join(project, 'node_modules/agglomerative-clustering/package.json'), 'utf8'));
            console.log(`${bundler}: agglomerative-clustering@${version} from npm`);
        } else {
            await mkdir(join(project, 'node_modules'));
            await symlink(root, join(project, 'node_modules', 'agglomerative-clustering'), 'dir');
        }
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
            if (name === 'safari') {
                const { result, version } = await runInSafari(`http://127.0.0.1:${server.address().port}/`);
                if (result.error) {throw new Error(`The page failed (${bundler}, Safari ${version}): ${result.error}`);}
                console.log(`${bundler} in Safari ${version}:`);
                for (const [check, passed] of Object.entries(result.checks)) {console.log(`${passed ? '  ok  ' : '  FAIL'} ${check}${!passed && result.details && result.details[check] ? ` (${result.details[check]})` : ''}`);}
                if (Object.values(result.checks).some((passed) => !passed)) {process.exitCode = 1;}
                continue;
            }
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
            for (const [check, passed] of Object.entries(result.checks)) {console.log(`${passed ? '  ok  ' : '  FAIL'} ${check}${!passed && result.details && result.details[check] ? ` (${result.details[check]})` : ''}`);}
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
