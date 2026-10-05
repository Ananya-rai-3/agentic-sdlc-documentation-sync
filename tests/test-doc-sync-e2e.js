// doc-sync end to end: fixture discovery, report rendering, report.js check and the hook (T-24).
const { spawnSync } = require('child_process');
const path = require('path');
const { writeFile, commitAll, removeRepo } = require('./helpers');
const { buildScenarioRepo } = require('./fixtures/doc-sync/build.js');

const projectRoot = path.join(__dirname, '..');
const scriptDirectory = path.join(projectRoot, '.claude', 'scripts', 'doc-sync');
const hookPath = path.join(projectRoot, '.claude', 'hooks', 'doc-sync-completeness-check.js');
const report = require(path.join(scriptDirectory, 'report.js'));
const discover = require(path.join(scriptDirectory, 'discover.js'));
const { resolveBase, computeFingerprint } = require(path.join(scriptDirectory, 'fingerprint.js'));

let failures = 0;
function check(label, condition) {
    if (!condition) failures++;
    console.log(`[${condition ? 'PASS' : 'FAIL'}] ${label}`);
}

const repo = buildScenarioRepo('signature-change');
const prCommand = { tool_name: 'Bash', tool_input: { command: 'gh pr create --fill' } };

function runHook(input) {
    const result = spawnSync('node', [hookPath], {
        input: JSON.stringify(input),
        cwd: repo.root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: repo.root },
        encoding: 'utf8',
    });
    return { status: result.status, stderr: result.stderr };
}

function cleanReportData() {
    const base = resolveBase(repo.root, {});
    return {
        status: 'COMPLETE',
        base,
        syncBase: repo.git('rev-parse', 'HEAD').trim(),
        fingerprint: computeFingerprint(repo.root, base),
        reason: '',
        checked: ['README.md', 'docs/textutil.md', 'src/textutil.js'],
        findings: [
            { id: 'F-01', class: 'STALE', location: 'docs/textutil.md', evidence: 'truncate gained options', status: 'RESOLVED' },
            { id: 'F-02', class: 'MISSING', location: 'docs/textutil.md', evidence: 'wordCount undocumented', status: 'RESOLVED' },
            { id: 'F-03', class: 'AMBIGUOUS', location: 'docs/textutil.md', evidence: 'vague sentence, human: "leave as is"', status: 'ACKNOWLEDGED' },
        ],
        changes: [
            { finding: 'F-01', file: 'docs/textutil.md', lines: '1', summary: 'updated signature' },
            { finding: 'F-02', file: 'docs/textutil.md', lines: '2', summary: 'documented wordCount' },
        ],
        validation: [{ finding: 'F-01', check: 'links', result: 'PASS' }],
        conclusion: 'Synced.',
    };
}

function checkViaCli() {
    return spawnSync('node', [path.join(scriptDirectory, 'report.js'), 'check'], {
        cwd: repo.root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: repo.root },
        encoding: 'utf8',
    });
}

const discovered = discover.discoverAll(repo.root, {});
check('FR-10: discovery on the fixture finds the changed source file', discovered.changedFiles.includes('src/textutil.js'));

check('FR-11: without a report the hook blocks PR creation', runHook(prCommand).status === 2);
check('FR-11: without a report report.js check fails', checkViaCli().status !== 0);
check('NFR-04: a non-PR command is never blocked', runHook({ tool_name: 'Bash', tool_input: { command: 'git status' } }).status === 0);

const data = cleanReportData();
check('FR-07: a scripted report round-trips through the parser', JSON.stringify(report.parseReport(report.renderReport(data)).findings.map((finding) => finding.id)) === JSON.stringify(['F-01', 'F-02', 'F-03']));
writeFile(repo.root, 'docs/doc-sync-report.md', report.renderReport(data));
commitAll(repo, 'docs: sync documentation with implementation');

const passing = runHook(prCommand);
check('FR-10: a clean, current report lets the hook pass', passing.status === 0);
check('FR-10: a clean, current report passes report.js check', checkViaCli().status === 0);

writeFile(repo.root, 'src/textutil.js', `${require('fs').readFileSync(path.join(repo.root, 'src', 'textutil.js'), 'utf8')}\nfunction extra() {}\n`);
commitAll(repo, 'rework: later code change');
const afterCodeChange = runHook(prCommand);
check('NFR-03: a later code change invalidates the report', afterCodeChange.status === 2 && afterCodeChange.stderr.includes('FINGERPRINT_STALE'));

const withNewReport = { ...cleanReportData(), findings: [{ id: 'F-01', class: 'STALE', location: 'README.md', evidence: 'x', status: 'OPEN' }], changes: [] };
writeFile(repo.root, 'docs/doc-sync-report.md', report.renderReport(withNewReport));
commitAll(repo, 'docs: report with open finding');
check('FR-07: an open STALE finding re-blocks the hook', runHook(prCommand).status === 2);

removeRepo(repo);

const regression = spawnSync('node', [path.join(__dirname, 'test-pipeline-status.js')], { cwd: projectRoot, encoding: 'utf8' });
check('C-01: the existing pipeline-status tests still pass', regression.status === 0);

console.log(`\n${failures === 0 ? 'ALL DOC-SYNC E2E TESTS PASSED' : failures + ' DOC-SYNC E2E TEST(S) FAILED'}`);
process.exitCode = failures === 0 ? 0 : 1;
