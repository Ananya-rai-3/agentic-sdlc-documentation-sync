// doc-sync-completeness-check hook: gate decisions end to end against throwaway repos (T-10).
const { spawnSync } = require('child_process');
const path = require('path');
const { createRepo, writeFile, commitAll, removeRepo } = require('./helpers');

const scriptDirectory = path.join(__dirname, '..', '.claude', 'scripts', 'doc-sync');
const hookPath = path.join(__dirname, '..', '.claude', 'hooks', 'doc-sync-completeness-check.js');
const report = require(path.join(scriptDirectory, 'report.js'));
const { resolveBase, computeFingerprint } = require(path.join(scriptDirectory, 'fingerprint.js'));

let failures = 0;
function check(label, condition) {
    if (!condition) failures++;
    console.log(`[${condition ? 'PASS' : 'FAIL'}] ${label}`);
}

const repo = createRepo('docsync-gate-');
writeFile(repo.root, 'README.md', '# Demo\n');
writeFile(repo.root, 'src/a.js', 'function a() {}\nmodule.exports = { a };\n');
commitAll(repo, 'init');
repo.git('switch', '-q', '-c', 'feature');
writeFile(repo.root, 'src/a.js', 'function a(x) {}\nmodule.exports = { a };\n');
const syncBase = commitAll(repo, 'code change');

const cliCommand = { tool_name: 'Bash', tool_input: { command: 'gh pr create --fill' } };
const apiCommand = { tool_name: 'Bash', tool_input: { command: 'gh api repos/o/r/pulls -X POST -f title=t -f head=feature' } };
const mcpCommand = { tool_name: 'mcp__github__create_pull_request', tool_input: { owner: 'o', repo: 'r', title: 't', head: 'feature', base: 'master' } };

function runHook(input) {
    const result = spawnSync('node', [hookPath], {
        input: JSON.stringify(input),
        cwd: repo.root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: repo.root },
        encoding: 'utf8',
    });
    return { status: result.status, stderr: result.stderr };
}

function reportData(overrides = {}) {
    const base = resolveBase(repo.root, {});
    return {
        status: 'COMPLETE',
        base,
        syncBase,
        fingerprint: computeFingerprint(repo.root, base),
        reason: '',
        checked: ['README.md', 'src/a.js'],
        findings: [
            { id: 'F-01', class: 'STALE', location: 'README.md', evidence: 'signature', status: 'RESOLVED' },
            { id: 'F-02', class: 'AMBIGUOUS', location: 'README.md', evidence: 'vague, human: "fine"', status: 'ACKNOWLEDGED' },
        ],
        changes: [{ finding: 'F-01', file: 'README.md', lines: '3', summary: 'fixed signature' }],
        validation: [{ finding: 'F-01', check: 'links', result: 'PASS' }],
        conclusion: 'Synced.',
        ...overrides,
    };
}
function commitReport(data) {
    writeFile(repo.root, 'docs/doc-sync-report.md', report.renderReport(data));
    commitAll(repo, 'docs: sync documentation with implementation');
}
const blocked = (outcome, code) => outcome.status === 2 && outcome.stderr.includes(code);

check('FR-11: no report blocks with REPORT_MISSING', blocked(runHook(cliCommand), 'REPORT_MISSING'));

writeFile(repo.root, 'README.md', '# Demo\n\nfixed\n');
commitAll(repo, 'docs: edit');
commitReport(reportData({ fingerprint: '0'.repeat(64) }));
const stale = runHook(cliCommand);
check('FR-10: stale fingerprint blocks and names FINGERPRINT_STALE', blocked(stale, 'FINGERPRINT_STALE'));
check('NFR-04: the block message tells the user how to proceed', stale.stderr.includes('documentation-sync'));

commitReport(reportData({ findings: [{ id: 'F-01', class: 'STALE', location: 'README.md', evidence: 'x', status: 'OPEN' }] }));
check('FR-07: unresolved STALE blocks', blocked(runHook(cliCommand), 'FINDING_UNRESOLVED'));

commitReport(reportData({ findings: [{ id: 'F-01', class: 'MISSING', location: 'README.md', evidence: 'x', status: 'OPEN' }] }));
check('FR-07: unresolved MISSING blocks', blocked(runHook(cliCommand), 'FINDING_UNRESOLVED'));

commitReport(reportData({ findings: [{ id: 'F-02', class: 'AMBIGUOUS', location: 'README.md', evidence: 'x', status: 'OPEN' }], changes: [] }));
check('FR-04: unacknowledged AMBIGUOUS blocks', blocked(runHook(cliCommand), 'AMBIGUOUS_NOT_ACKNOWLEDGED'));

commitReport(reportData({ status: 'NEEDS_HUMAN', reason: 'above size threshold' }));
check('FR-07: NEEDS_HUMAN blocks and the reason is shown', blocked(runHook(cliCommand), 'STATUS_NOT_COMPLETE') && runHook(cliCommand).stderr.includes('above size threshold'));

commitReport(reportData({ syncBase: 'f'.repeat(40) }));
check('M-04: Sync-Base that is not in the history blocks', runHook(cliCommand).status === 2);

commitReport(reportData({ base: 'f'.repeat(40) }));
check('NFR-04: a forged Base in the report is ignored (hook recomputes it)', runHook(cliCommand).status === 0);

commitReport(reportData());
check('FR-11: a clean current report allows gh pr create', runHook(cliCommand).status === 0);
check('M-02: the same clean report allows the gh api variant', runHook(apiCommand).status === 0);
check('M-02: the same clean report allows the MCP variant', runHook(mcpCommand).status === 0);
check('M-02: a head different from the current branch is still blocked with a clean report', blocked(runHook({ ...mcpCommand, tool_input: { ...mcpCommand.tool_input, head: 'other' } }), 'HEAD_BRANCH_MISMATCH'));

writeFile(repo.root, 'docs/doc-sync-report.md', report.renderReport(reportData()) + '\nedited\n');
check('H-03: an uncommitted report edit blocks', blocked(runHook(cliCommand), 'REPORT_UNCOMMITTED'));
repo.git('checkout', '--', 'docs/doc-sync-report.md');

writeFile(repo.root, 'README.md', '# Demo\n\nuncommitted docs edit\n');
check('H-03: a dirty tracked file blocks with DIRTY_TREE', blocked(runHook(cliCommand), 'DIRTY_TREE'));
repo.git('checkout', '--', 'README.md');
check('H-03: restoring the tree allows the PR again', runHook(cliCommand).status === 0);

writeFile(repo.root, 'logs/no-ticket_x.md', 'log update\n');
check('H-03: an uncommitted ticket log does not block', runHook(cliCommand).status === 0);

writeFile(repo.root, '.claude/settings.json', '{}\n');
commitAll(repo, 'sneak a config change after the sync');
check('H-04: a path outside the allow-list changed after Sync-Base blocks with PATH_NOT_ALLOWED', blocked(runHook(cliCommand), 'PATH_NOT_ALLOWED') || blocked(runHook(cliCommand), 'CHANGE_NOT_LISTED'));
repo.git('reset', '-q', '--hard', 'HEAD~1');

writeFile(repo.root, 'src/a.js', 'function a(x, y) {}\nmodule.exports = { a };\n');
commitAll(repo, 'rework: code changed after the sync');
check('FR-10: a code change after the report invalidates it (rework re-blocks)', blocked(runHook(cliCommand), 'FINGERPRINT_STALE'));

removeRepo(repo);
console.log(`\n${failures === 0 ? 'ALL DOC-SYNC HOOK GATE TESTS PASSED' : failures + ' DOC-SYNC HOOK GATE TEST(S) FAILED'}`);
process.exitCode = failures === 0 ? 0 : 1;
