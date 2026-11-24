// The shape of the public API, checked from several sides at once so that adding or changing something and forgetting one
// of the places it lives fails HERE instead of reaching users:
//   - the declarations (dist/*.d.ts) are snapshotted without comments, so any signature change shows up as a diff in
//     review. After a deliberate change, update the snapshots with:  npx vitest run test/api.test.js -u
//   - the option properties the types declare, the option keys the runtime enforces and the options table in docs/api.md agree
//   - the worker entry mirrors the main entry, its call routing works for every function, and handles match their types
//   - docs/api.md documents every function and error code, every exported declaration has a doc comment, and the README and
//     docs link only to files and headings that exist
import { describe, it, expect, afterAll } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as main from '../dist/index.mjs';
import * as worker from '../dist/worker.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const readme = read('README.md');
const api = read('docs/api.md');
// The user documentation: the README and the pages it links for using the library.
const userDocs = ['README.md', 'docs/api.md', 'docs/guides.md', 'docs/environments.md', 'docs/performance.md', 'docs/troubleshooting.md'];
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

// The image functions of the main entry: the ones whose first parameter is the image.
const imageFunctions = functionExports('index.d.ts').filter((name) => parameterNames('index.d.ts', name)[0] === 'image').sort();

// The option keys the runtime enforces, read from the error it gives for an unknown key.
const image = new Uint8Array(4 * 64).map((_, i) => (i * 37 + 11) & 255);
const clustering = await main.getClustering(image);
const palette = await main.getPalette(image, 3);
const callArguments = {
    buildClustering: [image], buildPalette: [image, 3], buildSwatches: [image, 3],
    getClustering: [image], getPalette: [image, 3], getSwatches: [image, 3], quantize: [image, 3], quantizeFromClustering: [image, clustering, 3],
    quantizeWithPalette: [image, palette], quantizeToIndices: [image, 3], quantizeToIndicesFromClustering: [image, clustering, 3],
    quantizeToIndicesWithPalette: [image, palette],
};
// The names the functions that cluster an image had before 3.4.0, and their new names. The old names are the same
// functions, documented in one line under the "Deprecated names" heading of docs/api.md, and 4.0 removes them (and this map).
const deprecated = { getClustering: 'buildClustering', getPalette: 'buildPalette', getSwatches: 'buildSwatches' };
const deprecatedSection = /^### Deprecated names\n([^\n]*)\n?/m;

// Calls of the old names in prose and examples. The methods on a clustering or a handle keep the names, so these tell the
// functions apart by shape: a bare name (an import, a mock factory, a call), a dotted getPalette or getSwatches call with
// two or more arguments (a worker's), or a dotted getClustering with an argument. A worker has no get… method but the
// functions, so any `worker.get…` is one of them, however the call is laid out (over several lines, or only named in prose).
// Blind spot: an old name after another receiver (`api.getPalette` in prose) is only caught as a call.
const staleCalls = [/(?<![.\w])get(Clustering|Palette|Swatches)\b/, /\.get(Palette|Swatches)\([^,)]*,/, /\.getClustering\([^)\s]/, /\bworker\.get(Clustering|Palette|Swatches)\b/];
const staleCall = (line) => staleCalls.some((pattern) => pattern.test(line));
// Old names written on purpose: another library's function of the same name (the guides compare them), and the
// feature test a wrapper supporting versions before 3.4 needs (environments.md, "Writing a package that wraps it").
const intentional = ['color-thief `getPalette(image, n)`', "`ac.buildPalette ?? ac.getPalette`"];

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

    it('mark exactly the old names deprecated, and never the methods that keep them', () => {
        const isDeprecated = (symbol) => resolved(symbol).getJsDocTags(checker).some((tag) => tag.name === 'deprecated');
        for (const fileName of ['index.d.ts', 'worker.d.ts']) {
            const marked = moduleExports(fileName).filter(isDeprecated).map((symbol) => symbol.name).sort();
            expect(marked, fileName).toEqual(Object.keys(deprecated).sort());
        }
        const membersMarked = (interfaceName) => checker.getPropertiesOfType(declaredType(interfaceName === 'Clustering' ? 'index.d.ts' : 'worker.d.ts', interfaceName)).filter(isDeprecated).map((p) => p.name).sort();
        expect(membersMarked('AgglomerativeWorker')).toEqual(Object.keys(deprecated).sort());
        expect(membersMarked('ClusteringHandle')).toEqual([]);
        expect(membersMarked('Clustering')).toEqual([]);
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

    it('are the same keys in the types, in what the runtime enforces, and in the table in docs/api.md', async () => {
        const optionsTable = api.match(/^\| Option \| Applies to[\s\S]*?\n\n/m)[0];
        const table = new Set([...optionsTable.matchAll(/^\| `(\w+)` \|/gm)].map((match) => match[1]));
        const union = new Set();
        expect(imageFunctions).toEqual(Object.keys(callArguments).sort());           // a new image function needs a row above
        for (const name of imageFunctions) {
            const declared = propertyNames(parameterType('index.d.ts', name, 'options'));
            const enforced = await enforcedKeys(name);
            expect(declared, name).toEqual(enforced);
            enforced.forEach((key) => union.add(key));
        }
        for (const key of union) {expect(table.has(key), `The options table lacks ${key}`).toBe(true);}
        expect([...table].filter((key) => !union.has(key)), 'The options table has rows the runtime does not know').toEqual([]);
    });

});

describe('the worker entry', () => {

    const instance = worker.createWorker();
    afterAll(() => instance.terminate());

    it('mirrors the main entry', () => {
        // Constants (the versions) are exported by both entries with the same values; only functions become worker methods.
        // (`Palette` and `Clustering` are constructors, and `isCodedError` a synchronous helper: exported by both entries,
        // the same function, but not methods.)
        const helpers = ['isCodedError'];
        const mainFunctions = Object.keys(main).filter((name) => typeof main[name] === 'function' && !/^[A-Z]/.test(name) && !helpers.includes(name));
        for (const name of Object.keys(main).filter((name) => typeof main[name] !== 'function' || helpers.includes(name))) {expect(worker[name], name).toBe(main[name]);}
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
            await instance[name](...callArguments[name], { onProgress: (value) => progress.push(value) });
            expect(progress[progress.length - 1], `${name} reports progress`).toBe(1);
        }
    });

    it('routes signal and onProgress for every handle method that maps pixels', async () => {
        const handle = await instance.cluster(image);
        const aborted = new AbortController();
        aborted.abort();
        const calls = { quantize: [3], quantizeToIndices: [3], quantizeWithPalette: [palette], quantizeToIndicesWithPalette: [palette] };
        for (const [name, args] of Object.entries(calls)) {
            await expect(handle[name](...args, { signal: aborted.signal }), `handle.${name} with a signal`).rejects.toMatchObject({ name: 'AbortError' });
            const progress = [];
            await handle[name](...args, { onProgress: (value) => progress.push(value) });
            expect(progress[progress.length - 1], `handle.${name} reports progress`).toBe(1);
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

describe('the API reference (docs/api.md)', () => {

    it('documents every function', () => {
        for (const name of [...Object.keys(worker), 'createWorker'].filter((name) => !(name in deprecated))) {
            // Functions are documented as `name(`; constants such as `version` have a heading of their own.
            const entry = typeof worker[name] === 'function' && !/^[A-Z]/.test(name) ? '`' + name + '(' : '`' + name + '`';
            expect(api.includes(entry), `docs/api.md has no entry for ${name}`).toBe(true);
        }
    });

    it('lists, for each function, exactly the options it accepts', async () => {
        const checked = [];
        for (const name of Object.keys(callArguments).filter((name) => !(name in deprecated))) {
            const section = api.match(new RegExp('^###[^\\n]*`' + name + '\\([^\\n]*\\n([\\s\\S]*?)(?=^###? )', 'm'));
            expect(section, `docs/api.md has a section for ${name}`).not.toBeNull();
            const line = (section[1].match(/Options: ([^\n]*)/) || [])[1];
            if (!line || /those of|theirs/.test(line)) {continue;}          // these point at another function's list
            const listed = [...line.matchAll(/`(\w+)`/g)].map((m) => m[1]).filter((word) => !/^(getPaletteFromClustering|quantizeFromClustering)$/.test(word)).sort();
            expect(listed, `Options listed for ${name}`).toEqual(await enforcedKeys(name));
            checked.push(name);
        }
        expect(checked).toEqual(expect.arrayContaining(['buildClustering', 'buildPalette', 'quantize', 'quantizeFromClustering', 'quantizeWithPalette']));
    });

    it('lists each deprecated name under its own heading, as the same function as its new name', () => {
        const section = api.match(deprecatedSection);
        expect(section, 'docs/api.md has a "### Deprecated names" heading with a line under it').not.toBeNull();
        expect(api.includes('[deprecated names](#deprecated-names)'), 'the contents at the top of docs/api.md link the section').toBe(true);
        for (const [old, now] of Object.entries(deprecated)) {
            expect(section[1].includes('`' + old + '('), `the line gives ${old}'s signature`).toBe(true);
            expect(section[1].includes('`' + now + '`'), `the line names ${now}`).toBe(true);
            expect(main[old], old).toBe(main[now]);
            expect(worker[old], `worker ${old}`).toBe(worker[now]);
        }
    });

    it('stale-call patterns flag the old functions and spare the names that stay', () => {
        const flagged = ['getPalette(photo, 128)', 'worker.getPalette(frame, 8, { signal })', "import { getPalette } from 'agglomerative-clustering'", '{ getPalette: vi.fn() }', 'ac.getClustering(image)', 'call getSwatches once', 'worker.getPalette(\n', 'the worker.getSwatches call', 'await worker.getClustering(image)'];
        const spared = ['handle.getClustering()', 'clustering.getPalette(k)', 'handle.getSwatches(k)', 'getPaletteFromClustering(c, k)', 'getClusteringInfo(c)', 'worker.cluster(image)', 'buildPalette(image, k)', 'getSwatchesFromClustering(clustering, 8)', 'worker.getPaletteFromClustering(c, 8)', 'worker.getClusteringInfo(c)'];
        for (const line of flagged) {expect(staleCall(line), line).toBe(true);}
        for (const line of spared) {expect(staleCall(line), line).toBe(false);}
    });

    it('call the functions that cluster by their 3.4.0 names', () => {
        for (const file of [...userDocs, 'docs/how-it-works.md']) {
            let text = file === 'docs/api.md' ? read(file).replace(deprecatedSection, '') : read(file);
            for (const phrase of intentional) {text = text.replaceAll(phrase, '');}
            const stale = text.split('\n').filter(staleCall);
            expect(stale, `${file} still calls an old name`).toEqual([]);
        }
    });

    it('does not use names that no longer exist', () => {
        // Each of these was renamed or removed; a match is a sentence nobody updated.
        const stale = ['getPaletteWeights', 'info.version', 'mse[colors', 'at `colors`', 'reserveTransparent', 'getPaletteFromClustering(clustering, k): Promise<Uint8Array>'];
        for (const file of userDocs) {
            const text = read(file);
            for (const phrase of stale) {expect(text.includes(phrase), `${file} still says ${phrase}`).toBe(false);}
            // quantizeWithClustering is the 2.x name: it belongs only in the migration notes, where the rename is explained
            expect(text.includes('quantizeWithClustering'), `${file} still says quantizeWithClustering`).toBe(false);
        }
        const migrating = readFileSync(resolve(root, 'docs/migrating.md'), 'utf8');
        const uses = migrating.split('\n').filter((line) => line.includes('quantizeWithClustering'));
        expect(uses.length).toBeGreaterThan(0);
        expect(uses.every((line) => /rename|now `quantizeFromClustering`/.test(line)), uses.join('\n')).toBe(true);
    });

    it('lists every error code, and only the ones that exist', () => {
        const codes = declaredType('index.d.ts', 'ErrorCode').types.map((type) => type.value).sort();
        const listed = [...api.matchAll(/^\| `([a-z-]+)`(?:, `([a-z-]+)`)*/gm)].flatMap((match) => match[0].match(/`[a-z-]+`/g).map((s) => s.slice(1, -1)));
        for (const code of codes) {expect(listed.includes(code), `The error table lacks ${code}`).toBe(true);}
        expect(codes.length).toBeGreaterThan(5);
    });

});

describe('methods on Clustering', () => {

    // The methods a clustering has at run time: its own non-index properties that are functions.
    const runtime = Object.getOwnPropertyNames(clustering).filter((name) => !/^\d+$/.test(name) && typeof clustering[name] === 'function').sort();
    // The methods the class declares in index.d.ts.
    const clusteringClass = sourceOf('index.d.ts').statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === 'Clustering');
    const declared = clusteringClass.members.filter(ts.isMethodDeclaration).map((member) => member.name.getText()).sort();
    // A method's function form: its name with `FromClustering`, or the same name when the function already says it (getClusteringInfo).
    const functionForm = (name) => (main[`${name}FromClustering`] ? `${name}FromClustering` : name);

    it('are declared exactly as they exist at run time', () => {
        expect(runtime.length).toBeGreaterThan(0);
        expect(declared).toEqual(runtime);
    });

    // Methods with no function form (PRINCIPLES "Settled decisions"): new ones are methods only.
    const methodOnly = ['chooseFrom'];

    it('each have a function form in both entries, named by dropping FromClustering', () => {
        for (const name of runtime.filter((name) => !methodOnly.includes(name))) {
            const form = functionForm(name);
            expect(typeof main[form], `${name} has a function form in the main entry`).toBe('function');
            expect(typeof worker[form], `${name} has a function form in the worker entry`).toBe('function');
            expect(form === name || form === `${name}FromClustering`, `${name}'s function form is ${name}FromClustering`).toBe(true);
        }
    });

    it('are each documented in docs/api.md, with the options they accept', async () => {
        const checked = [];
        for (const name of runtime) {
            const section = api.match(new RegExp('^###[^\\n]*`clustering\\.' + name + '\\([^\\n]*\\n([\\s\\S]*?)(?=^###? )', 'm'));
            expect(section, `docs/api.md has a section for clustering.${name}`).not.toBeNull();
            const form = functionForm(name);
            if (methodOnly.includes(name)) {
                const error = await clustering[name](new Uint8Array(30), 4, { __unknown__: true }).catch((e) => e);
                const enforced = error.message.match(/expected one of (.*)\./)[1].split(', ').sort();
                const line = (section[1].match(/Options: ([^\n]*)/) || [])[1];
                expect(line, `clustering.${name} has an Options line`).toBeDefined();
                expect([...line.matchAll(/`(\w+)`/g)].map((m) => m[1]).sort(), `Options listed for clustering.${name}`).toEqual(enforced);
                checked.push(name);
                continue;
            }
            if (!callArguments[form]) {continue;}   // the cuts take no options
            // The method enforces exactly what its function form does, and its Options line lists that.
            const args = callArguments[form].filter((value) => value !== clustering);
            const error = await clustering[name](...args, { __unknown__: true }).catch((e) => e);
            const enforced = (error.message.match(/expected one of (.*)\./) || [])[1].split(', ').sort();
            expect(enforced, `clustering.${name} enforces ${form}'s options`).toEqual(await enforcedKeys(form));
            const line = (section[1].match(/Options: ([^\n]*)/) || [])[1];
            expect(line, `clustering.${name} has an Options line`).toBeDefined();
            expect([...line.matchAll(/`(\w+)`/g)].map((m) => m[1]).sort(), `Options listed for clustering.${name}`).toEqual(enforced);
            checked.push(name);
        }
        expect(checked.sort()).toEqual(['chooseFrom', 'quantize', 'quantizeToIndices']);
    });

});

describe('the documentation files', () => {

    const docs = [...userDocs.slice(1), 'docs/migrating.md', 'docs/stability.md', 'docs/how-it-works.md', 'docs/ROADMAP.md'];
    const github = 'https://github.com/RohanFredriksson/agglomerative-clustering/blob/master/';
    // GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens.
    const anchorsOf = (text) => new Set([...text.matchAll(/^#{1,6} (.+)$/gm)].map((m) => m[1].toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-')));

    it('are linked from the README, and every relative link in the README and docs points at a file that exists', async () => {
        const { existsSync } = await import('fs');
        const checkLinks = (file, text) => {
            for (const match of text.matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)(#[^)\s]*)?\)/g)) {
                const target = resolve(root, dirname(file), match[1]);
                expect(existsSync(target), `${file} links to ${match[1]}, which does not exist`).toBe(true);
            }
        };
        checkLinks('README.md', readme);
        for (const doc of docs) {
            // As an absolute GitHub URL: the npm package doesn't contain docs/, so a relative link would be dead there.
            expect(readme.includes(`${github}${doc}`), `README does not link ${doc}`).toBe(true);
            checkLinks(doc, read(doc));
        }
    });

    it('send readers to headings that exist, in the same file or another', () => {
        for (const file of ['README.md', ...docs]) {
            const text = read(file);
            // In the same file (#anchor), in another doc (other.md#anchor), or from the README by GitHub URL.
            const links = [
                ...[...text.matchAll(/\]\(#([^)]+)\)/g)].map((m) => [file, m[1]]),
                ...[...text.matchAll(/\]\((?!https?:)([^)#\s]+\.md)#([^)]+)\)/g)].map((m) => [resolve(root, dirname(file), m[1]).slice(root.length + 1), m[2]]),
                ...[...text.matchAll(new RegExp(`\\]\\(${github.replace(/[.]/g, '\\.')}([^)#\\s]+\\.md)#([^)]+)\\)`, 'g'))].map((m) => [m[1], m[2]]),
            ];
            for (const [target, anchor] of links) {
                expect(anchorsOf(read(target)).has(anchor), `${file} links to ${target}#${anchor}, which is not a heading`).toBe(true);
            }
        }
    });
});
