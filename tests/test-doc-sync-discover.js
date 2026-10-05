// doc-sync discovery: changed files, symbol extraction, size thresholds (T-04).
const path = require('path');
const { createRepo, writeFile, commitAll, removeRepo } = require('./helpers');
const discover = require(path.join(__dirname, '..', '.claude', 'scripts', 'doc-sync', 'discover.js'));

let failures = 0;
function check(label, condition) {
    if (!condition) failures++;
    console.log(`[${condition ? 'PASS' : 'FAIL'}] ${label}`);
}
function throws(fn) {
    try {
        fn();
        return false;
    } catch {
        return true;
    }
}

const before = `// header comment mentions fakeSymbol(a, b)
const note = "module.exports = { inString: 1 }";
function slugify(text) { return text; }
function truncate(text, max) { return text.slice(0, max); }
function removed(value) { return value; }
function unchanged(a) { return a; }
class Greeter { constructor(name) { this.name = name; } }
module.exports = { slugify, truncate, removed, unchanged, Greeter };
`;
const after = `// header comment mentions fakeSymbol(a, b)
const note = "module.exports = { inString: 1 }";
function slugify(text) { return text; }
function truncate(text, max, options = {}) { return text.slice(0, max); }
const wordCount = (text) => text.split(' ').length;
const limit = process.env.TEXT_LIMIT;
function unchanged(a) { return a; }
class Greeter { constructor(name, greeting) { this.name = name; } }
module.exports = {
  slugify,
  truncate,
  wordCount,
  unchanged,
  Greeter,
  inline: function (x, y) { return x + y; },
  method(z) { return z; },
};
exports.helper = async (input) => input;
`;

const repo = createRepo('docsync-discover-');
writeFile(repo.root, 'README.md', '# Demo\n');
writeFile(repo.root, 'src/textutil.js', before);
writeFile(repo.root, 'src/untouched.js', 'module.exports = { stays };\nfunction stays() {}\n');
writeFile(repo.root, 'config/app.json', JSON.stringify({ port: 80, nested: { old: true } }));
writeFile(repo.root, '.claude/tool.js', 'module.exports = { tool };\nfunction tool() {}\n');
commitAll(repo, 'base');
repo.git('switch', '-q', '-c', 'feature');
writeFile(repo.root, 'src/textutil.js', after);
writeFile(repo.root, 'config/app.json', JSON.stringify({ port: 8080, nested: { fresh: 1 } }));
writeFile(repo.root, '.claude/tool.js', 'module.exports = { tool, newTool };\nfunction tool() {}\nfunction newTool(a) {}\n');
writeFile(repo.root, 'tests/test-x.js', 'module.exports = { fixture };\nfunction fixture() {}\n');
writeFile(repo.root, 'docs/guide.md', 'doc\n');
commitAll(repo, 'feature work');

const changed = discover.listChanged(repo.root, {});
const paths = changed.entries.map((entry) => entry.path).sort();
check('FR-01: changed files come from the base...HEAD diff', JSON.stringify(paths) === JSON.stringify(['.claude/tool.js', 'config/app.json', 'docs/guide.md', 'src/textutil.js', 'tests/test-x.js']));
check('FR-01: unchanged files are not listed', !paths.includes('src/untouched.js') && !paths.includes('README.md'));
check('FR-01: changedPaths returns plain path strings', discover.changedPaths(repo.root, {}).length === 5);
check('FR-01: entries carry the git status letter', changed.entries.find((entry) => entry.path === 'src/textutil.js').status === 'M' && changed.entries.find((entry) => entry.path === 'docs/guide.md').status === 'A');

const symbols = discover.changedSymbols(repo.root, {});
const named = (list, name) => list.find((symbol) => symbol.name === name);
check('FR-01: changed signature is reported with before and after', named(symbols.changed, 'truncate') && named(symbols.changed, 'truncate').signature === '(text, max, options = {})' && named(symbols.changed, 'truncate').previousSignature === '(text, max)');
check('FR-01: changed class constructor is reported', named(symbols.changed, 'Greeter') && named(symbols.changed, 'Greeter').signature.includes('(name, greeting)'));
check('FR-01: new arrow function export is reported as added with its signature', named(symbols.added, 'wordCount') && named(symbols.added, 'wordCount').signature === '(text)' && named(symbols.added, 'wordCount').kind === 'function');
check('FR-01: removed export is reported', named(symbols.removed, 'removed') && named(symbols.removed, 'removed').file === 'src/textutil.js');
check('FR-01: unchanged export is not reported', !named(symbols.changed, 'unchanged') && !named(symbols.added, 'unchanged') && !named(symbols.removed, 'unchanged') && !named(symbols.changed, 'slugify'));
check('FR-01: inline function and method shorthand exports are extracted', named(symbols.added, 'inline').signature === '(x, y)' && named(symbols.added, 'method').signature === '(z)');
check('FR-01: exports.name assignments are extracted', named(symbols.added, 'helper') && named(symbols.added, 'helper').signature === '(input)');
check('FR-01: env variable reads are reported as config', named(symbols.added, 'TEXT_LIMIT') && named(symbols.added, 'TEXT_LIMIT').kind === 'config');
check('FR-01: strings and comments are not mistaken for code', !named(symbols.added, 'inString') && !named(symbols.added, 'fakeSymbol'));
check('FR-01: JSON config key changes and additions are reported', named(symbols.changed, 'port').previousSignature === '80' && named(symbols.added, 'nested.fresh') && named(symbols.removed, 'nested.old'));
check('NFR-05: tooling, test and doc files are not scanned for public symbols', !named(symbols.added, 'newTool') && !named(symbols.added, 'fixture'));

const parsed = discover.extractJavaScriptSymbols('export function a(x) {}\nexport class B { constructor(y) {} }\nexport const c = (z) => z;\nexport { a as renamed };\n');
check('FR-01: ES module exports are extracted', parsed.get('a').signature === '(x)' && parsed.get('B').kind === 'class' && parsed.get('c').signature === '(z)' && parsed.get('renamed').signature === '(x)');
check('FR-01: default CommonJS function export is extracted', discover.extractJavaScriptSymbols('module.exports = function (a, b) {};').get('module.exports').signature === '(a, b)');

check('FR-01: an object export does not produce a spurious default export', !discover.extractJavaScriptSymbols('module.exports = { a };\nfunction a() {}').has('module.exports'));

check('NFR-06: defaults are 20 files and 15 items', discover.readLimits({}).maxFiles === 20 && discover.readLimits({}).maxItems === 15);
check('NFR-06: env overrides the limits', discover.readLimits({ DOC_SYNC_MAX_FILES: '3', DOC_SYNC_MAX_ITEMS: '2' }).maxFiles === 3);
check('NFR-06: counts at the limit do not exceed', !discover.checkThresholds({ files: 20, items: 15 }, {}).exceeded);
const exceeded = discover.checkThresholds({ files: 21, items: 16 }, {});
check('NFR-06: counts above the limits exceed and name both reasons', exceeded.exceeded && exceeded.reasons.length === 2 && exceeded.reasons[0].includes('DOC_SYNC_MAX_FILES'));
check('NFR-06: a lowered limit takes effect', discover.checkThresholds({ files: 5 }, { DOC_SYNC_MAX_FILES: '4' }).exceeded);
check('L-05: invalid limit values fail closed', throws(() => discover.readLimits({ DOC_SYNC_MAX_FILES: 'lots' })) && throws(() => discover.readLimits({ DOC_SYNC_MAX_ITEMS: '0' })));
check('NFR-04: unresolvable base fails closed', throws(() => discover.listChanged(repo.root, { DOC_SYNC_BASE: 'missing-ref' })));

// ---- part 2: reference search (T-05)
writeFile(repo.root, 'README.md', '# Demo\n\n## Text utilities\n\nCall `truncate(text, max)` to shorten. Also see src/textutil.js.\n\n```\n# Not a heading truncate(\n```\n\n## Other\n\nNothing relevant here.\n');
writeFile(repo.root, 'docs/guide.md', '# Guide\n\n### Slug helpers\n\nUse Greeter for hello. truncated is a different word, as is mytruncate.\n');
writeFile(repo.root, 'docs/legacy-notes.md', '# Legacy\n\nCompletely unrelated stale text about the old billing system.\n');
writeFile(repo.root, 'docs/architecture.md', '# Architecture\n\ntruncate is mentioned in a phase document and must be ignored.\n');
writeFile(repo.root, 'docs/doc-sync-report.md', 'truncate in the report must be ignored.\n');
writeFile(repo.root, 'docs/pipeline-status.md', 'truncate in status must be ignored.\n');
const everything = discover.discoverAll(repo.root, {});
const docsHit = (doc) => everything.references.filter((reference) => reference.doc === doc);

check('FR-01: README reference to a changed symbol is found with its section', docsHit('README.md').some((r) => r.reference === 'truncate' && r.section === 'Text utilities' && r.kind === 'symbol'));
check('FR-01: README reference to a changed file path is found', docsHit('README.md').some((r) => r.reference === 'src/textutil.js' && r.kind === 'file'));
check('FR-01: heading-like text inside a code fence does not change the section', docsHit('README.md').every((r) => r.section !== 'Not a heading truncate('));
check('FR-01: docs reference carries the nearest heading', docsHit('docs/guide.md').some((r) => r.reference === 'Greeter' && r.section === 'Slug helpers'));
check('FR-01: word-boundary match ignores truncated and mytruncate', !docsHit('docs/guide.md').some((r) => r.reference === 'truncate'));
check('FR-08: unrelated stale document is never returned', docsHit('docs/legacy-notes.md').length === 0);
check('FR-08: phase documents, report and pipeline-status are excluded', ['docs/architecture.md', 'docs/doc-sync-report.md', 'docs/pipeline-status.md'].every((doc) => docsHit(doc).length === 0));
check('FR-01: references are limited to relevant docs and code comments', everything.references.every((r) => ['README.md', 'docs/guide.md', 'src/textutil.js', '.claude/tool.js', 'tests/test-x.js', 'config/app.json'].includes(r.doc)));
check('FR-01: comments of changed files are searched', discover.findReferences(repo.root, { added: [], removed: [], changed: [{ name: 'fakeSymbol' }] }, [{ status: 'M', path: 'src/textutil.js' }]).some((r) => r.doc === 'src/textutil.js' && r.section === 'comments' && r.line === 1));
check('FR-01: added symbol with no documentation reference is listed as undocumented', everything.undocumented.some((s) => s.name === 'wordCount') && !everything.undocumented.some((s) => s.name === 'Greeter'));
check('FR-01: output is JSON-serialisable and carries base, files and thresholds', Array.isArray(JSON.parse(JSON.stringify(everything)).changedFiles) && everything.thresholds.exceeded === false);
check('NFR-05: nothing is searched when no symbols or files changed', discover.findReferences(repo.root, { added: [], removed: [], changed: [] }, []).length === 0);

removeRepo(repo);
console.log(`\n${failures === 0 ? 'ALL DOC-SYNC DISCOVER TESTS PASSED' : failures + ' DOC-SYNC DISCOVER TEST(S) FAILED'}`);
process.exitCode = failures === 0 ? 0 : 1;
