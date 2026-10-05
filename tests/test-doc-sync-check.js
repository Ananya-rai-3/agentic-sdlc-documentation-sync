// doc-sync gate logic: checkReport reasons and the report.js check CLI (T-07).
const { spawnSync } = require('child_process');
const path = require('path');
const { createRepo, writeFile, commitAll, removeRepo } = require('./helpers');

const scriptPath = path.join(__dirname, '..', '.claude', 'scripts', 'doc-sync', 'report.js');
const report = require(scriptPath);
const { resolveBase, computeFingerprint } = require(path.join(__dirname, '..', '.claude', 'scripts', 'doc-sync', 'fingerprint.js'));

let failures = 0;
function check(label, condition) {
    if (!condition) failures++;
    console.log(`[${condition ? 'PASS' : 'FAIL'}] ${label}`);
}

const repo = createRepo('docsync-check-');
writeFile(repo.root, 'README.md', '# Demo\n');
writeFile(repo.root, 'src/a.js', 'module.exports = 1;\n');
commitAll(repo, 'init');
repo.git('switch', '-q', '-c', 'feature');
writeFile(repo.root, 'src/a.js', 'module.exports = 2;\n');
const syncBase = commitAll(repo, 'code change');
const base = resolveBase(repo.root, {});
const fingerprint = computeFingerprint(repo.root, base);

const baseData = {
    status: 'COMPLETE',
    base,
    syncBase,
    fingerprint,
    reason: '',
    checked: ['README.md', 'src/a.js'],
    findings: [
        { id: 'F-01', class: 'STALE', location: 'README.md', evidence: 'wrong', status: 'RESOLVED' },
        { id: 'F-02', class: 'AMBIGUOUS', location: 'README.md', evidence: 'vague; human said "ok"', status: 'ACKNOWLEDGED' },
    ],
    changes: [{ finding: 'F-01', file: 'README.md', lines: '1', summary: 'fixed' }],
    validation: [{ finding: 'F-01', check: 'links', result: 'PASS' }],
    conclusion: 'Synced.',
};
const evaluate = (overrides) => report.checkReport(report.renderReport({ ...baseData, ...overrides }), { cwd: repo.root, env: {} });
const codesOf = (result) => result.reasons.map((reason) => reason.code);
const blockedWith = (result, code) => !result.ok && codesOf(result).includes(code) && result.reasons.find((reason) => reason.code === code).message.length > 0;

const clean = evaluate({});
check('FR-11: a complete, current, clean report passes', clean.ok && clean.reasons.length === 0);
check('FR-11: a clean report with no findings and the explicit statement passes', evaluate({ findings: [], changes: [], validation: [], conclusion: 'No documentation changes required.' }).ok);

check('FR-11: unparsable text is blocked as REPORT_UNPARSABLE', report.checkReport('garbage', { cwd: repo.root, env: {} }).reasons[0].code === 'REPORT_UNPARSABLE');
check('NFR-04: an odd-column table row is blocked as unparsable', report.checkReport(report.renderReport(baseData).replace('| F-01 | STALE |', '| F-01 |'), { cwd: repo.root, env: {} }).reasons[0].code === 'REPORT_UNPARSABLE');
check('FR-07: NEEDS_HUMAN status is blocked and names the status and reason', blockedWith(evaluate({ status: 'NEEDS_HUMAN', reason: 'too many files' }), 'STATUS_NOT_COMPLETE') && evaluate({ status: 'NEEDS_HUMAN', reason: 'too many files' }).reasons[0].message.includes('too many files'));
check('FR-07: FAILED status is blocked', blockedWith(evaluate({ status: 'FAILED', reason: 'boom' }), 'STATUS_NOT_COMPLETE'));
check('FR-11: fingerprint mismatch is blocked as FINGERPRINT_STALE', blockedWith(evaluate({ fingerprint: '0'.repeat(64) }), 'FINGERPRINT_STALE'));
check('NFR-04: the report Base value is ignored (a forged Base does not matter)', evaluate({ base: 'f'.repeat(40) }).ok);
check('FR-07: OPEN STALE finding is blocked', blockedWith(evaluate({ findings: [{ ...baseData.findings[0], status: 'OPEN' }, baseData.findings[1]] }), 'FINDING_UNRESOLVED'));
check('FR-07: OPEN MISSING finding is blocked', blockedWith(evaluate({ findings: [{ id: 'F-03', class: 'MISSING', location: 'README.md', evidence: 'x', status: 'OPEN' }] }), 'FINDING_UNRESOLVED'));
check('FR-07: ACKNOWLEDGED does not excuse a STALE finding', blockedWith(evaluate({ findings: [{ ...baseData.findings[0], status: 'ACKNOWLEDGED' }, baseData.findings[1]] }), 'FINDING_UNRESOLVED'));
check('FR-04: OPEN AMBIGUOUS finding is blocked', blockedWith(evaluate({ findings: [baseData.findings[0], { ...baseData.findings[1], status: 'OPEN' }] }), 'AMBIGUOUS_NOT_ACKNOWLEDGED'));
check('FR-04: RESOLVED (edited) AMBIGUOUS finding is blocked', blockedWith(evaluate({ findings: [baseData.findings[0], { ...baseData.findings[1], status: 'RESOLVED' }] }), 'AMBIGUOUS_NOT_ACKNOWLEDGED'));
check('NFR-03: RESOLVED finding without a Changes row is blocked', blockedWith(evaluate({ changes: [] }), 'CHANGE_ROW_MISSING'));
check('NFR-03: Changes row for an unknown finding is blocked', blockedWith(evaluate({ changes: [...baseData.changes, { finding: 'F-09', file: 'README.md', lines: '1', summary: 'x' }] }), 'CHANGE_UNKNOWN_FINDING'));
check('FR-07: empty Checked section is blocked', blockedWith(evaluate({ checked: [] }), 'CHECKED_EMPTY'));
check('FR-07: no findings without the explicit statement is blocked', blockedWith(evaluate({ findings: [], changes: [], validation: [], conclusion: 'All good.' }), 'NO_CHANGES_STATEMENT_MISSING'));
check('NFR-04: multiple problems are all reported together', codesOf(evaluate({ fingerprint: '0'.repeat(64), checked: [] })).length === 2);

const brokenBase = report.checkReport(report.renderReport(baseData), { cwd: repo.root, env: { DOC_SYNC_BASE: 'no-such-ref' } });
check('NFR-04: unresolvable base fails closed with BASE_OR_FINGERPRINT_FAILED', !brokenBase.ok && codesOf(brokenBase).includes('BASE_OR_FINGERPRINT_FAILED'));

writeFile(repo.root, 'src/a.js', 'module.exports = 3;\n');
commitAll(repo, 'later code change');
check('FR-11: a later code change invalidates a previously valid report', blockedWith(report.checkReport(report.renderReport(baseData), { cwd: repo.root, env: {} }), 'FINGERPRINT_STALE'));
repo.git('reset', '-q', '--hard', 'HEAD~1');

const run = () => spawnSync('node', [scriptPath, 'check'], { cwd: repo.root, env: { ...process.env, CLAUDE_PROJECT_DIR: repo.root }, encoding: 'utf8' });
const missing = run();
check('FR-11: check CLI exits non-zero and names REPORT_MISSING when there is no report', missing.status === 1 && missing.stderr.includes('REPORT_MISSING'));
writeFile(repo.root, 'docs/doc-sync-report.md', report.renderReport({ ...baseData, fingerprint: '0'.repeat(64) }));
commitAll(repo, 'docs: sync');
const stale = run();
check('FR-11: check CLI exits 1 and names the reason for a stale report', stale.status === 1 && stale.stderr.includes('FINGERPRINT_STALE'));
writeFile(repo.root, 'docs/doc-sync-report.md', report.renderReport(baseData));
commitAll(repo, 'docs: fix report');
const good = run();
check('FR-11: check CLI exits 0 when the gate would pass', good.status === 0 && good.stdout.includes('OK'));

removeRepo(repo);
console.log(`\n${failures === 0 ? 'ALL DOC-SYNC CHECK TESTS PASSED' : failures + ' DOC-SYNC CHECK TEST(S) FAILED'}`);
process.exitCode = failures === 0 ? 0 : 1;
