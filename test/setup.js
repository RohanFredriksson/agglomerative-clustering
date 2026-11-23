import { ImageData } from 'canvas';
import { afterEach } from 'vitest';

// Polyfill ImageData for Node.js so the library's ImageData branch is exercisable in tests.
globalThis.ImageData = ImageData;

// The library warns about likely mistakes (the rgb-as-rgba warning, docs/api.md "Warnings"). A test that warns by accident
// is passing bad input, or the check has a false positive, so it fails here; a file that expects warnings sets
// globalThis.__acExpectWarnings. The state is once per copy of the library, so this catches the first warning per file.
// Kept on globalThis: the listener is installed once per process, and this file runs again for each test file.
globalThis.__acExpectWarnings = false;
const unexpected = globalThis.__acUnexpectedWarnings ??= [];
if (!globalThis.__acWarningGuard) {
    globalThis.__acWarningGuard = true;
    process.on('warning', (warning) => {
        if (warning.name === 'AgglomerativeClusteringWarning' && !globalThis.__acExpectWarnings) {unexpected.push(warning.message);}
    });
}
afterEach(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (unexpected.length > 0) {
        const messages = unexpected.splice(0);
        throw new Error(`Unexpected AgglomerativeClusteringWarning: ${messages.join(' | ')}`);
    }
});
