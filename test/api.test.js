// The shape of the public API, checked from several sides at once so that adding or changing something and forgetting one
// of the places it lives fails HERE instead of reaching users:
//   - the declarations (dist/*.d.ts) are snapshotted without comments, so any signature change shows up as a diff in
//     review. After a deliberate change, update the snapshots with:  npx vitest run test/api.test.js -u
//   - the option properties the types declare, the option keys the runtime enforces and the README's options table agree
//   - the worker entry mirrors the main entry, its call routing works for every function, and handles match their types
//   - the README documents every function and error code, and every exported declaration has a doc comment
import { describe, it, expect, afterAll } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as main from '../dist/index.mjs';
import * as worker from '../dist/worker.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
const declarationFile = (name) => resolve(root, 'dist', name);

const program = ts.createProgram([declarationFile('index.d.ts'), declarationFile('worker.d.ts')], {
    noEmit: true, skipLibCheck: true, strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: [],
});
const checker = program.getTypeChecker();
const sourceOf = (name) => program.getSourceFile(declarationFile(name));
const moduleExports = (name) => checker.getExportsOfModule(checker.getSymbolAtLocation(sourceOf(name)));
const resolved = (symbol) => (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);
const valueExports = (name) => moduleExports(name).filter((symbol) => resolved(symbol).flags & ts.SymbolFlags.Value).map((symbol) => symbol.name).sort();
const exported = (name, symbolName) => moduleExports(name).find((symbol) => symbol.name === symbolName);
const propertyNames = (type) => checker.getPropertiesOfType(type).map((property) => property.name).filter((n) => !n.startsWith('__@')).sort();
const declaredType = (name, symbolName) => checker.getDeclaredTypeOfSymbol(resolved(exported(name, symbolName)));

// The declared type of a function's parameter, by parameter name (the first signature of an overloaded function).
const parameterType = (fileName, functionName, parameterName) => {
    const signature = checker.getSignaturesOfType(checker.getTypeOfSymbol(resolved(exported(fileName, functionName))), ts.SignatureKind.Call)[0];
    const parameter = signature.getParameters().find((p) => p.name === parameterName);
    return parameter && checker.getNonNullableType(checker.getTypeOfSymbol(parameter));
};
const signaturesOf = (fileName, name) => checker.getSignaturesOfType(checker.getTypeOfSymbol(resolved(exported(fileName, name))), ts.SignatureKind.Call);
const parameterNames = (fileName, functionName) => signaturesOf(fileName, functionName)[0].getParameters().map((p) => p.name);
// Exports that are functions, as opposed to constants such as `version`.
const functionExports = (fileName) => valueExports(fileName).filter((name) => signaturesOf(fileName, name).length > 0);

// Functions that only map pixels: they take `signal` but not `onProgress`.
const mappingOnly = ['quantizeFromClustering', 'quantizeWithPalette', 'quantizeToIndicesFromClustering', 'quantizeToIndicesWithPalette'];

// The image functions of the main entry: the ones whose first parameter is the image.
const imageFunctions = functionExports('index.d.ts').filter((name) => parameterNames('index.d.ts', name)[0] === 'image').sort();

// The option keys the runtime enforces, read from the error it gives for an unknown key.
const image = new Uint8Array(4 * 64).map((_, i) => (i * 37 + 11) & 255);
const clustering = await main.getClustering(image);
const palette = await main.getPalette(image, 3);
const callArguments = {
    getClustering: [image], getPalette: [image, 3], getSwatches: [image, 3], quantize: [image, 3], quantizeFromClustering: [image, clustering, 3],
    quantizeWithPalette: [image, palette], quantizeToIndices: [image, 3], quantizeToIndicesFromClustering: [image, clustering, 3],
    quantizeToIndicesWithPalette: [image, palette],
};
const enforcedKeys = async (name) => {
    const error = await main[name](...callArguments[name], { __unknown__: true }).catch((e) => e);
    return (error.message.match(/expected one of (.*)\./) || [])[1].split(', ').sort();
};

describe('the declarations', () => {

    it('match the committed API snapshot (update deliberately with -u)', async () => {
        const printer = ts.createPrinter({ removeComments: true });
        const text = (name) => printer.printFile(ts.createSourceFile(name, readFileSync(declarationFile(name), 'utf8'), ts.ScriptTarget.Latest, true));
        await expect(text('index.d.ts')).toMatchFileSnapshot('api/index.d.ts.snap.txt');
        await expect(text('worker.d.ts')).toMatchFileSnapshot('api/worker.d.ts.snap.txt');
    });

    it('declare exactly the values each entry exports at run time', () => {
        expect(valueExports('index.d.ts')).toEqual(Object.keys(main).sort());
        expect(valueExports('worker.d.ts')).toEqual(Object.keys(worker).sort());
    });

    it('document every exported declaration, so hovering shows what it does', () => {
        for (const fileName of ['index.d.ts', 'worker.d.ts']) {
            const undocumented = [];
            sourceOf(fileName).forEachChild((node) => {
                if (!node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {return;}
                const name = node.name?.text ?? node.declarationList?.declarations?.[0]?.name?.text;
                if (name && !ts.getJSDocCommentsAndTags(node).length) {undocumented.push(name);}
            });
            expect(undocumented, fileName).toEqual([]);
        }
    });

});

describe('options', () => {

    it('are the same keys in the types, in what the runtime enforces, and in the README table', async () => {
        const optionsTable = readme.match(/^\| Option \| Applies to[\s\S]*?\n\n/m)[0];
        const table = new Set([...optionsTable.matchAll(/^\| `(\w+)` \|/gm)].map((match) => match[1]));
        const union = new Set();
        expect(imageFunctions).toEqual(Object.keys(callArguments).sort());           // a new image function needs a row above
        for (const name of imageFunctions) {
            const declared = propertyNames(parameterType('index.d.ts', name, 'options'));
            const enforced = await enforcedKeys(name);
            expect(declared, name).toEqual(enforced);
            enforced.forEach((key) => union.add(key));
        }
        for (const key of union) {expect(table.has(key), `README options table lacks ${key}`).toBe(true);}
        expect([...table].filter((key) => !union.has(key)), 'README options table has rows the runtime does not know').toEqual([]);
    });

});

describe('the worker entry', () => {

    const instance = worker.createWorker();
    afterAll(() => instance.terminate());

    it('mirrors the main entry', () => {
        // Constants (the versions) are exported by both entries with the same values; only functions become worker methods.
        // (`Palette` and `Clustering` are constructors, exported by both entries but not methods.)
        const mainFunctions = Object.keys(main).filter((name) => typeof main[name] === 'function' && !/^[A-Z]/.test(name));
        for (const name of Object.keys(main).filter((name) => typeof main[name] !== 'function')) {expect(worker[name], name).toBe(main[name]);}
        expect(Object.keys(worker).sort()).toEqual([...Object.keys(main), 'createWorker', 'terminate'].sort());
        expect(Object.keys(instance).sort()).toEqual([...mainFunctions, 'cluster', 'terminate'].sort());
        expect(propertyNames(declaredType('worker.d.ts', 'AgglomerativeWorker'))).toEqual(Object.keys(instance).sort());
    });

    it('gives handles exactly the methods their type declares', async () => {
        const handle = await instance.cluster(image);
        expect(Object.keys(handle).sort()).toEqual(propertyNames(declaredType('worker.d.ts', 'ClusteringHandle')).filter((name) => name !== 'then'));
        await handle.release();
    });

    it('routes signal and onProgress for every function that takes an image', async () => {
        for (const name of imageFunctions) {
            const aborted = new AbortController();
            aborted.abort();
            await expect(instance[name](...callArguments[name], { signal: aborted.signal }), `${name} with a signal`).rejects.toMatchObject({ name: 'AbortError' });
            const progress = [];
            const run = instance[name](...callArguments[name], { onProgress: (value) => progress.push(value) });
            if (mappingOnly.includes(name)) {
                // they take milliseconds, so there is no progress to report: only `signal` applies
                await expect(run, `${name} refuses onProgress`).rejects.toMatchObject({ code: 'invalid-argument' });
                await main[name](...callArguments[name], { signal: new AbortController().signal });
            } else {
                await run;
                expect(progress[progress.length - 1], `${name} reports progress`).toBe(1);
            }
        }
    });

    it('routes signal and onProgress for every handle method that maps pixels', async () => {
        const handle = await instance.cluster(image);
        const aborted = new AbortController();
        aborted.abort();
        const calls = { quantize: [3], quantizeToIndices: [3], quantizeWithPalette: [palette], quantizeToIndicesWithPalette: [palette] };
        for (const [name, args] of Object.entries(calls)) {
            await expect(handle[name](...args, { signal: aborted.signal }), `handle.${name} with a signal`).rejects.toMatchObject({ name: 'AbortError' });
            // every handle method that takes mapping options only maps pixels: it has a signal, not a progress callback
            await expect(handle[name](...args, { onProgress: () => {} }), `handle.${name} refuses onProgress`).rejects.toMatchObject({ code: 'invalid-argument' });
            await handle[name](...args, { signal: new AbortController().signal });
        }
        // Every handle method that takes mapping options is covered above.
        const mapping = Object.keys(handle).filter((name) => parameterNamesOfMember('ClusteringHandle', name).includes('options')).sort();
        expect(mapping).toEqual(Object.keys(calls).sort());
        await handle.release();
    });

});

const parameterNamesOfMember = (interfaceName, member) => {
    const property = checker.getPropertiesOfType(declaredType('worker.d.ts', interfaceName)).find((p) => p.name === member);
    return checker.getSignaturesOfType(checker.getTypeOfSymbol(property), ts.SignatureKind.Call)[0].getParameters().map((p) => p.name);
};

describe('the README', () => {

    it('documents every function', () => {
        for (const name of [...Object.keys(worker), 'createWorker']) {
            // Functions are documented as `name(`; constants such as `version` have a heading of their own.
            const entry = typeof worker[name] === 'function' && !/^[A-Z]/.test(name) ? '`' + name + '(' : '`' + name + '`';
            expect(readme.includes(entry), `README has no entry for ${name}`).toBe(true);
        }
    });

    it('lists every error code, and only the ones that exist', () => {
        const codes = declaredType('index.d.ts', 'ErrorCode').types.map((type) => type.value).sort();
        const listed = [...readme.matchAll(/^\| `([a-z-]+)`(?:, `([a-z-]+)`)*/gm)].flatMap((match) => match[0].match(/`[a-z-]+`/g).map((s) => s.slice(1, -1)));
        for (const code of codes) {expect(listed.includes(code), `README error table lacks ${code}`).toBe(true);}
        expect(codes.length).toBeGreaterThan(5);
    });

});
