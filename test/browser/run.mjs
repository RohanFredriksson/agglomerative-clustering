// Bundler and browser smoke test: npm run test:browser (after npm run build).
// Installs this package (by symlink) into a temporary project, bundles test/browser/app with each bundler (Vite,
// webpack 5 and Parcel 2), serves the bundle, and runs it in a headless browser. This checks what Node tests can't: that a bundler
// follows the package's exports, emits the worker script and the .wasm, and that the worker runs in a browser.
// Browsers: Chromium (CHROMIUM_PATH if set, else the installed Chrome, as on GitHub's Ubuntu runners, else Playwright's).
// BROWSERS=chromium,firefox,webkit adds Playwright's Firefox (FIREFOX_PATH if set) and WebKit (WEBKIT_PATH, Playwright's
// pw_run.sh, if set). BROWSERS=safari runs the real Safari on macOS through safaridriver (Apple's WebDriver, enabled once
// with `sudo safaridriver --enable`); Playwright's WebKit is close to Safari but is not Safari.
// BUNDLERS=vite, webpack or parcel runs one of them; BUNDLERS=cdn skips bundling and loads the package's dist/ from a second
// server on another origin, as a page that imports it from a CDN does (the worker then has to start across origins). PACKAGE=agglomerative-clustering@next (any npm install spec)
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
const bundlers = (process.env.BUNDLERS || 'vite,webpack,parcel,cdn').split(',');
const browsers = (process.env.BROWSERS || 'chromium').split(',');

// How each bundler is run, and how the app gets the URL of the package's .wasm (each bundler spells it differently).
const bundle = {
    vite: {
        wasmUrl: "import url from 'agglomerative-clustering/clustering.wasm?url';\nexport default url;\n",
        run: async (project) => {
            await build({ root: join(project, 'app'), logLevel: 'warn', build: { outDir: join(project, 'out'), emptyOutDir: true } });
        },
    },
    cdn: {
        wasmUrl: '',
        // A page that imports the package from another origin (?cdn=...), with no bundler, and reports checks like the app.
        run: async (project) => {
            await mkdir(join(project, 'out'), { recursive: true });
            // The worker script bundled into one file, as docs/environments.md has single-file hosts do, to start from a data: URL.
            const { build: esbuild } = await import('esbuild');
            await esbuild({ entryPoints: [join(project, 'node_modules', 'agglomerative-clustering', 'dist', 'worker-thread.mjs')], bundle: true, format: 'esm', target: 'es2022', outfile: join(project, 'out', 'worker-bundle.mjs'), logLevel: 'error' });
            await writeFile(join(project, 'out', 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>cdn</title></head><body><script type="module">
const cdn = new URLSearchParams(location.search).get('cdn');
const messages = new URLSearchParams(location.search).has('messages');
const checks = {}, details = {};
const check = async (name, run) => {console.log('check ' + name); try {checks[name] = await run();} catch (error) {checks[name] = false; details[name] = String(error && error.message);}};
try {
    const ac = await import(cdn + '/index.mjs');
    const w = await import(cdn + '/worker.mjs');
    const image = new Uint8Array(4 * 64).map((_, i) => (i * 37 + 11) & 255);
    const expected = Array.from(await ac.getPalette(image, 4)).join();
    await check('cdnMainEntry', async () => expected.split(',').length === 12);
    await check('cdnWorkerAcrossOrigins', async () => Array.from(await w.getPalette(image, 4)).join() === expected);
    await check('cdnWorkerHandle', async () => {
        const worker = w.createWorker();
        const handle = await worker.cluster(image);
        const same = Array.from(await handle.getPalette(4)).join() === expected;
        await worker.terminate();
        return same;
    });
    // A worker script given with createWorker({ script }), as for bundlers that don't emit the package's own (Angular,
    // esbuild): here on another origin, so it starts through a blob: URL as the package's own script does.
    await check('workerScriptOption', async () => {
        const worker = w.createWorker({ script: cdn + '/worker-thread.mjs' });
        const same = Array.from(await worker.getPalette(image, 4)).join() === expected;
        await worker.terminate();
        return same;
    });
    // A Web Worker that also has Node's globals (Electron with nodeIntegrationInWorker) but no worker_threads: the
    // thread talks through self instead of waiting forever for a parentPort.
    await check('workerWithNodeGlobals', async () => {
        // Static imports, which run in order before the worker takes messages: one that defines the globals, then the script.
        const blob = (text) => URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
        const globals = blob('globalThis.process = { versions: { node: "22.0.0" } };');
        const script = blob('import ' + JSON.stringify(globals) + '; import ' + JSON.stringify(cdn + '/worker-thread.mjs') + ';');
        const worker = w.createWorker({ script });
        const timeout = new Promise((done) => setTimeout(() => done('HUNG'), 15000));
        const palette = await Promise.race([worker.getPalette(image, 4), timeout]);
        await worker.terminate();
        if (palette === 'HUNG') {throw new Error('the call never settled');}
        return Array.from(palette).join() === expected;
    });
    // A sandboxed iframe without allow-same-origin (a plugin host's, such as Figma's) has an opaque origin, from which no
    // worker starts from an http(s) script (nor, in Chromium, a blob: one): the worker entry starts it from a data: URL.
    await check('workerInSandboxedIframe', async () => {
        const frame = document.createElement('iframe');
        frame.sandbox = 'allow-scripts';
        frame.srcdoc = '<script type="module">const w = await import(' + JSON.stringify(cdn + '/worker.mjs') + ');'
            + 'const image = new Uint8Array(4 * 64).map((_, i) => (i * 37 + 11) & 255);'
            + 'w.getPalette(image, 4).then((p) => parent.postMessage({ palette: Array.from(p).join() }, "*"), (e) => parent.postMessage({ error: e.message }, "*"));'
            + '<\\/script>';
        const answer = new Promise((done) => addEventListener('message', (event) => {if (event.source === frame.contentWindow) {done(event.data);}}));
        document.body.append(frame);
        const reply = await Promise.race([answer, new Promise((done) => setTimeout(() => done({ error: 'no answer from the iframe' }), 20000))]);
        frame.remove();
        if (reply.error) {throw new Error(reply.error);}
        return reply.palette === expected;
    });
    if (messages) {
        // A worker started from a blob: URL inside the sandbox: Chromium refuses it, and the error points at the data: URL the
        // docs use (other engines may start it, which is fine).
        await check('blobWorkerInSandboxNamesDataUrl', async () => {
            const frame = document.createElement('iframe');
            frame.sandbox = 'allow-scripts';
            frame.srcdoc = '<script type="module">const w = await import(' + JSON.stringify(cdn + '/worker.mjs') + ');'
                + 'const script = URL.createObjectURL(new Blob(["import " + JSON.stringify(' + JSON.stringify(cdn + '/worker-thread.mjs') + ') + ";"], { type: "text/javascript" }));'
                + 'const worker = w.createWorker({ script });'
                + 'worker.getPalette(new Uint8Array(4 * 64).map((_, i) => (i * 37 + 11) & 255), 4).then(() => parent.postMessage({ ok: "started" }, "*"), (e) => parent.postMessage({ message: e.message }, "*")).finally(() => worker.terminate());'
                + '<\\/script>';
            const answer = new Promise((done) => addEventListener('message', (event) => {if (event.source === frame.contentWindow) {done(event.data);}}));
            document.body.append(frame);
            const reply = await Promise.race([answer, new Promise((done) => setTimeout(() => done({ message: 'no answer from the iframe' }), 20000))]);
            frame.remove();
            if (reply.ok) {return true;}
            if (!/data: URL/.test(reply.message)) {throw new Error(reply.message);}
            return true;
        });
        // The worker script bundled into a data: URL and started without wasm: nothing is next to it, and the error says to
        // pass the bytes to createWorker, not to serve a file.
        await check('dataWorkerWithoutWasmNamesCreateWorker', async () => {
            const text = await (await fetch('./worker-bundle.mjs')).text();
            const script = 'data:text/javascript;base64,' + btoa(unescape(encodeURIComponent(text)));
            const worker = w.createWorker({ script });
            const error = await worker.getPalette(image, 4).then(() => null, (e) => e);
            await worker.terminate();
            if (!error) {throw new Error('it loaded the module without being given it');}
            if (error.code !== 'wasm-load-failed' || !error.message.includes('createWorker({ script, wasm')) {throw new Error(error.message);}
            return true;
        });
    }
    window.result = { checks, details };
} catch (error) {
    window.result = { error: String(error && error.stack || error) };
}
</script></body></html>
`);
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
    parcel: {
        // Parcel reads new URL('a/b', import.meta.url) as the relative path it is, so the package's file needs its url: prefix.
        wasmUrl: "import url from 'url:agglomerative-clustering/clustering.wasm';\nexport default url;\n",
        run: async (project) => {
            // Parcel follows package exports only when asked, as docs/environments.md tells its users.
            await writeFile(join(project, 'package.json'), `${JSON.stringify({ type: 'module', '@parcel/resolver-default': { packageExports: true } }, null, 2)}\n`);
            const { Parcel } = await import('@parcel/core');
            const parcel = new Parcel({
                entries: 'app/index.html', defaultConfig: fileURLToPath(import.meta.resolve('@parcel/config-default')),
                cacheDir: '.parcel-cache', shouldDisableCache: true, mode: 'production', logLevel: 'warn',
                defaultTargetOptions: { distDir: 'out', publicUrl: './' },
            });
            // Parcel resolves entries against the working directory, whatever projectRoot says.
            const cwd = process.cwd();
            process.chdir(project);
            try {await parcel.run();} finally {process.chdir(cwd);}
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
    let server, browser, cdnServer;
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

        // For the CDN case, the package's dist/ is served from a second origin (another port), with CORS headers as CDNs send.
        let query = '';
        if (bundler === 'cdn') {
            const dist = join(project, 'node_modules', 'agglomerative-clustering', 'dist');
            cdnServer = createServer(async (request, response) => {
                try {
                    const file = join(dist, decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
                    const body = await readFile(file);
                    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
                    response.end(body);
                } catch {
                    response.writeHead(404);
                    response.end();
                }
            });
            await new Promise((done) => cdnServer.listen(0, '127.0.0.1', done));
            // The checks of error messages added in 3.7.2 run on this checkout, and on a published package only from 3.7.2.
            const { version } = JSON.parse(await readFile(join(project, 'node_modules/agglomerative-clustering/package.json'), 'utf8'));
            const [major, minor, patch] = version.split(/[.-]/).map(Number);
            const messages = !process.env.PACKAGE || major > 3 || (major === 3 && (minor > 7 || (minor === 7 && patch >= 2)));
            query = `?cdn=${encodeURIComponent(`http://127.0.0.1:${cdnServer.address().port}`)}${messages ? '&messages=1' : ''}`;
        }

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
                const { result, version } = await runInSafari(`http://127.0.0.1:${server.address().port}/${query}`);
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
            // The page's console, shown when it fails or never reports.
            const logs = [];
            page.on('console', (message) => logs.push(`${message.type()}: ${message.text()}`));
            // Browsers ask for /favicon.ico on their own; any other failed request is an error.
            // (Except node:worker_threads, which the worker thread tries first where Node's globals exist: workerWithNodeGlobals.)
            page.on('requestfailed', (request) => {if (!request.url().startsWith('node:')) {errors.push(`Request failed: ${request.url()}`);}});
            page.on('response', (response) => {if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {errors.push(`HTTP ${response.status()}: ${response.url()}`);}});
            await page.goto(`http://127.0.0.1:${server.address().port}/${query}`);
            const result = await page.waitForFunction(() => window.result, null, { timeout: 60_000 }).then((handle) => handle.jsonValue(), (error) => {
                throw new Error(`${error.message}\n  Console:\n${logs.join('\n')}\n  Browser errors:\n${errors.join('\n')}`);
            });

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
        cdnServer?.close();
        await rm(project, { recursive: true, force: true });
    }
}
