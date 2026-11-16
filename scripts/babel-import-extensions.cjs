// Babel copies import specifiers as they are, but src/*.js is built twice, into dist/*.mjs (ES modules) and dist/*.cjs
// (CommonJS), so a relative './shared.js' would point at a file that doesn't exist in dist. This rewrites relative
// '.js' specifiers to the extension of the build being made. './clustering.js' is the Emscripten glue, which really is
// called that in dist, so it is left alone, as are specifiers that already say '.mjs' or '.cjs'.
module.exports = function importExtensions() {
    const extension = process.env.BABEL_ENV === 'cjs' ? '.cjs' : '.mjs';
    const rewrite = (source) => {
        if (!source || !/^\.\.?\//.test(source.value) || !source.value.endsWith('.js') || /\/clustering\.js$/.test(source.value)) {return;}
        source.value = source.value.slice(0, -3) + extension;
    };
    return {
        name: 'import-extensions',
        visitor: {
            ImportDeclaration(path) {rewrite(path.node.source);},
            ExportNamedDeclaration(path) {rewrite(path.node.source);},
            ExportAllDeclaration(path) {rewrite(path.node.source);},
        },
    };
};
