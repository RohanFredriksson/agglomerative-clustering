// Jest in its default CommonJS mode, in the node and jsdom environments: the setups most test suites use (run by
// test/jest.test.js). Jest's module system can't require() an ES module, so this checks that the CommonJS builds (of both entries) load
// without --experimental-vm-modules or any transform.
const path = require('path');
const rootDir = path.resolve(__dirname, '../..');
const project = (testEnvironment) => ({
    displayName: testEnvironment,
    rootDir,
    testEnvironment,
    testMatch: ['<rootDir>/test/jest/**/*.jest.cjs'],
    // The package by its own name, as an app would import it (Jest doesn't resolve a package's name from inside it).
    moduleNameMapper: {'^agglomerative-clustering$': '<rootDir>/dist/index.cjs', '^agglomerative-clustering/worker$': '<rootDir>/dist/worker.cjs'},
    transform: {},
});
module.exports = {projects: [project('node'), project('jsdom')]};
