// doc-sync post-sync integrity checks in checkReport (T-08), on throwaway git repos.
const path = require('path');
const { createRepo, writeFile, commitAll, removeRepo } = require('./helpers');

const scriptDirectory = path.join(__dirname, '..', '.claude', 'scripts', 'doc-sync');
const report = require(path.join(scriptDirectory, 'report.js'));
const { resolveBase, computeFingerprint } = require(path.join(scriptDirectory, 'fingerprint.js'));

let failures = 0;
function check(label, condition) {
    if (!condition) failures++;
    console.log(`[${condition ? 'PASS' : 'FAIL'}] ${label}`);
}

const repo = createRepo('docsync-integrity-');
writeFile(repo.root, 'README.md', '# Demo\n');
writeFile(repo.root, 'src/a.js', 'function a() {}\nmodule.exports = { a };\n');
writeFile(repo.root, 'src/untouched.js', 'function u() {}\nmodule.exports = { u };\n');
writeFile(repo.root, 'docs/requirements.md', 'phase\n');
commitAll(repo, 'init');
repo.git('switch', '-q', '-c', 'feature');
writeFile(repo.root, 'src/a.js', 'function a(x) {}\nmodule.exports = { a };\n');
const syncBase = commitAll(repo, 'code change');
const otherBranchSha = (() => {
    repo.git('switch', '-q', '-c', 'side');
    writeFile(repo.root, 'side.txt', 's');
    const sha = commitAll(repo, 'side');
    repo.git('switch', '-q', 'feature');
    return sha;
})();

const reset = () => {
    repo.git('reset', '-q', '--hard', syncBase);
    repo.git('clean', '-q', '-fd');
};
const passRow = { finding: 'F-01', check: 'npm test re-run', result: 'PASS' };
const row = (file) => ({ finding: 'F-01', file, lines: '1', summary: 'edit' });

function evaluate({ changes = [], validation = [], syncBaseValue = syncBase } = {}) {
    const base = resolveBase(repo.root, {});
    const text = report.renderReport({
        status: 'COMPLETE',
        base,
        syncBase: syncBaseValue,
        fingerprint: computeFingerprint(repo.root, base),
        reason: '',
        checked: ['README.md'],
        findings: [{ id: 'F-01', class: 'STALE', location: 'README.md', evidence: 'e', status: 'RESOLVED' }],
        changes: changes.length > 0 ? changes : [row('README.md')],
        validation,
        conclusion: 'done',
    });
    const result = report.checkReport(text, { cwd: repo.root, env: {} });
    return { ok: result.ok, codes: result.reasons.map((reason) => reason.code), reasons: result.reasons };
}

reset();
writeFile(repo.root, 'README.md', '# Demo\n\nupdated\n');
commitAll(repo, 'docs: sync');
check('NFR-03: a docs-only sync listed in Changes passes', evaluate().ok);

writeFile(repo.root, 'docs/new-topic.md', 'new\n');
commitAll(repo, 'docs: new file');
const unlisted = evaluate();
check('NFR-03: a doc changed after Sync-Base but missing from Changes is blocked', unlisted.codes.includes('CHANGE_NOT_LISTED') && unlisted.reasons.some((r) => r.message.includes('docs/new-topic.md')));
check('NFR-03: listing it in Changes makes the report pass', evaluate({ changes: [row('README.md'), row('docs/new-topic.md')] }).ok);

reset();
writeFile(repo.root, 'docs/requirements.md', 'edited by the sync\n');
commitAll(repo, 'docs: touched phase doc');
check('H-04: editing a phase document is blocked as PATH_NOT_ALLOWED', evaluate({ changes: [row('docs/requirements.md')] }).codes.includes('PATH_NOT_ALLOWED'));

reset();
writeFile(repo.root, '.claude/settings.json', '{}\n');
commitAll(repo, 'sneaky');
check('H-04: editing .claude after Sync-Base is blocked', evaluate({ changes: [row('.claude/settings.json')] }).codes.includes('PATH_NOT_ALLOWED'));

reset();
writeFile(repo.root, 'src/untouched.js', '// new comment\nfunction u() {}\nmodule.exports = { u };\n');
commitAll(repo, 'comment in unchanged file');
check('NFR-02: a comment edit in a file the branch never changed is blocked', evaluate({ changes: [row('src/untouched.js')], validation: [passRow] }).codes.includes('PATH_NOT_ALLOWED'));

reset();
writeFile(repo.root, 'src/a.js', '// documents a\nfunction a(x) {}\nmodule.exports = { a };\n');
commitAll(repo, 'comment edit');
check('M-03: comment-only edit with a passing test re-run passes', evaluate({ changes: [row('src/a.js')], validation: [passRow] }).ok);
check('M-03: comment-only edit without a test re-run is blocked as TEST_RERUN_MISSING', evaluate({ changes: [row('src/a.js')], validation: [{ finding: 'F-01', check: 'links', result: 'PASS' }] }).codes.includes('TEST_RERUN_MISSING'));
check('M-03: comment-only edit with a failing test re-run is blocked', evaluate({ changes: [row('src/a.js')], validation: [{ ...passRow, result: 'FAIL' }] }).codes.includes('TEST_RERUN_MISSING'));

reset();
writeFile(repo.root, 'src/a.js', 'function a(x) { return 1; }\nmodule.exports = { a };\n');
commitAll(repo, 'real code edit');
check('M-03: a real code change after Sync-Base is blocked as NON_COMMENT_CODE_CHANGE', evaluate({ changes: [row('src/a.js')], validation: [passRow] }).codes.includes('NON_COMMENT_CODE_CHANGE'));

reset();
writeFile(repo.root, 'src/a.js', '// c\nfunction a(x) { return 1; }\nmodule.exports = { a };\n');
commitAll(repo, 'mixed edit');
check('M-03: a comment added next to a code change is still blocked', evaluate({ changes: [row('src/a.js')], validation: [passRow] }).codes.includes('NON_COMMENT_CODE_CHANGE'));

reset();
check('M-04: Sync-Base on another branch is blocked as SYNC_BASE_NOT_ANCESTOR', evaluate({ syncBaseValue: otherBranchSha }).codes.includes('SYNC_BASE_NOT_ANCESTOR'));
check('M-04: Sync-Base that is not a commit id is blocked as SYNC_BASE_INVALID', evaluate({ syncBaseValue: '--output=x' }).codes.includes('SYNC_BASE_INVALID'));
const baseSha = resolveBase(repo.root, {});
check('M-04: Sync-Base set to the base (hiding the code diff) is blocked', !evaluate({ syncBaseValue: baseSha }).ok);
check('M-04: Sync-Base equal to HEAD with no sync changes passes', evaluate().ok);

reset();
writeFile(repo.root, 'src/a.js', 'function a(x) { return 2; }\nmodule.exports = { a };\n');
const dirtyCode = evaluate();
check('H-03: an uncommitted tracked-file edit is blocked as DIRTY_TREE', dirtyCode.codes.includes('DIRTY_TREE'));
reset();
writeFile(repo.root, 'docs/untracked.md', 'x\n');
check('H-03: a new uncommitted docs file is blocked as DIRTY_TREE', evaluate().codes.includes('DIRTY_TREE'));
reset();
writeFile(repo.root, 'scratch.tmp', 'x\n');
check('H-03: an untracked file outside docs is ignored', evaluate().ok);
reset();
writeFile(repo.root, 'logs/ticket.md', 'x\n');
writeFile(repo.root, '.pipeline/status.json', '{}\n');
check('H-03: uncommitted logs and .pipeline files are tolerated (orchestrator bookkeeping)', evaluate().ok);
commitAll(repo, 'bookkeeping');
check('H-03: committed logs and .pipeline files after Sync-Base are tolerated', evaluate().ok);

reset();
writeFile(repo.root, 'docs/doc-sync-report.md', 'draft\n');
check('H-03: an uncommitted report is blocked as REPORT_UNCOMMITTED', evaluate().codes.includes('REPORT_UNCOMMITTED'));
commitAll(repo, 'docs: report');
check('H-03: the committed report is accepted', evaluate().ok);

removeRepo(repo);
console.log(`\n${failures === 0 ? 'ALL DOC-SYNC INTEGRITY TESTS PASSED' : failures + ' DOC-SYNC INTEGRITY TEST(S) FAILED'}`);
process.exitCode = failures === 0 ? 0 : 1;
