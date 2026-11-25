import { ImageData } from 'canvas';

// Polyfill ImageData for Node.js so the library's ImageData branch is exercisable in tests.
globalThis.ImageData = ImageData;
