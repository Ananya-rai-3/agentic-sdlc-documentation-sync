// doc-sync base resolution and change fingerprint (T-03), using throwaway git repos.
const path = require('path');
const { createRepo, writeFile, commitAll, removeRepo } = require('./helpers');
const { resolveBase, computeFingerprint } = require(path.join(__dirname, '..', '.claude', 'scripts', 'doc-sync', 'fingerprint.js'));

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

function featureRepo() {
    const repo = createRepo('docsync-fp-');
    writeFile(repo.root, 'README.md', '# Demo\n');
    writeFile(repo.root, 'src/a.js', 'module.exports = 1;\n');
    const masterSha = commitAll(repo, 'init');
    repo.git('switch', '-q', '-c', 'feature');
    writeFile(repo.root, 'src/a.js', 'module.exports = 2;\n');
    commitAll(repo, 'change code');
    return { repo, masterSha };
}

const { repo, masterSha } = featureRepo();
check('H-03: base is the merge-base with master', resolveBase(repo.root, {}) === masterSha);
check('H-03: DOC_SYNC_BASE overrides the default', resolveBase(repo.root, { DOC_SYNC_BASE: masterSha }) === masterSha);
check('M-04: unresolvable DOC_SYNC_BASE throws', throws(() => resolveBase(repo.root, { DOC_SYNC_BASE: 'no-such-ref' })));
check('M-04: DOC_SYNC_BASE that looks like an option throws', throws(() => resolveBase(repo.root, { DOC_SYNC_BASE: '--output=x' })));

const first = computeFingerprint(repo.root, masterSha);
check('FR-10: fingerprint is a SHA-256 hex digest', /^[0-9a-f]{64}$/.test(first));
check('FR-10: fingerprint is deterministic', computeFingerprint(repo.root, masterSha) === first);

writeFile(repo.root, 'README.md', '# Demo\n\nmore docs\n');
writeFile(repo.root, 'docs/guide.md', 'guide\n');
writeFile(repo.root, 'logs/a.md', 'log\n');
writeFile(repo.root, '.pipeline/status.json', '{}\n');
commitAll(repo, 'docs and bookkeeping');
check('FR-11: README, docs, logs and .pipeline edits do not change the fingerprint', computeFingerprint(repo.root, masterSha) === first);

writeFile(repo.root, 'src/a.js', '// comment only\nmodule.exports = 2;\n');
commitAll(repo, 'comment edit');
const afterComment = computeFingerprint(repo.root, masterSha);
check('FR-11: a code comment edit changes the fingerprint', afterComment !== first);

writeFile(repo.root, 'src/b.js', 'module.exports = 3;\n');
commitAll(repo, 'new file');
check('FR-11: a new code file changes the fingerprint', computeFingerprint(repo.root, masterSha) !== afterComment);

const crlfSetup = featureRepo();
const lfFingerprint = computeFingerprint(crlfSetup.repo.root, crlfSetup.masterSha);
crlfSetup.repo.git('config', 'core.autocrlf', 'true');
crlfSetup.repo.git('config', 'diff.noprefix', 'true');
crlfSetup.repo.git('config', 'color.ui', 'always');
check('NFR-04: fingerprint is unaffected by autocrlf, noprefix and color settings', computeFingerprint(crlfSetup.repo.root, crlfSetup.masterSha) === lfFingerprint);

const noMaster = createRepo('docsync-nomaster-');
writeFile(noMaster.root, 'a.txt', 'x');
commitAll(noMaster, 'init');
noMaster.git('switch', '-q', '-c', 'other');
noMaster.git('branch', '-q', '-m', 'master', 'trunk');
check('M-04: missing base branch fails closed with an error', throws(() => resolveBase(noMaster.root, {})));
check('M-04: fingerprint with an invalid base throws', throws(() => computeFingerprint(repo.root, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')));

removeRepo(repo);
removeRepo(crlfSetup.repo);
removeRepo(noMaster);
console.log(`\n${failures === 0 ? 'ALL DOC-SYNC FINGERPRINT TESTS PASSED' : failures + ' DOC-SYNC FINGERPRINT TEST(S) FAILED'}`);
process.exitCode = failures === 0 ? 0 : 1;
