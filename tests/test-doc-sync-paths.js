// doc-sync write allow-list: checkPath and the check-paths CLI (T-02).
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRepo, writeFile, removeRepo } = require('./helpers');

const scriptPath = path.join(__dirname, '..', '.claude', 'scripts', 'doc-sync', 'report.js');
const report = require(scriptPath);

let failures = 0;
function check(label, condition) {
    if (!condition) failures++;
    console.log(`[${condition ? 'PASS' : 'FAIL'}] ${label}`);
}

const repo = createRepo('docsync-paths-');
for (const file of ['README.md', 'docs/guide.md', 'docs/requirements.md', 'docs/pipeline-status.md', 'docs/doc-sync-report.md', 'src/app.js', 'src/other.js', '.env', '.claude/settings.json', '.pipeline/status.json', 'logs/a.md']) {
    writeFile(repo.root, file, 'x');
}
const context = { root: repo.root, changedFiles: ['src/app.js', '.claude/settings.json', 'docs/requirements.md'] };
const allowed = (target, ctx = context) => report.checkPath(target, ctx).allowed;

check('NFR-02: README.md is allowed', allowed('README.md'));
check('NFR-02: docs file is allowed', allowed('docs/guide.md'));
check('NFR-02: new docs file (not yet existing) is allowed', allowed('docs/new/section.md'));
check('NFR-02: doc-sync report is allowed', allowed('docs/doc-sync-report.md'));
check('NFR-02: changed source file is allowed', allowed('src/app.js'));
check('NFR-02: unchanged source file is blocked', !allowed('src/other.js'));
check('NFR-02: phase document is blocked even if changed', !allowed('docs/requirements.md'));
check('NFR-02: pipeline-status.md is blocked', !allowed('docs/pipeline-status.md'));
check('NFR-02: .env is blocked', !allowed('.env'));
check('NFR-02: nested .env.local is blocked', !allowed('docs/.env.local'));
check('NFR-02: .claude is blocked even if changed', !allowed('.claude/settings.json'));
check('NFR-02: .pipeline is blocked', !allowed('.pipeline/status.json'));
check('NFR-02: logs is blocked', !allowed('logs/a.md'));
check('NFR-02: .git is blocked', !allowed('docs/.git/config'));
check('H-04: parent traversal is blocked', !allowed('docs/../.env') && !allowed('../outside.md'));
check('L-01: backslash traversal is blocked', !allowed('docs\\..\\.env'));
check('L-01: backslash path to an allowed file is allowed', allowed('docs\\guide.md'));
check('L-01: backslash path to a blocked file is blocked', !allowed('logs\\a.md') && !allowed('docs\\requirements.md'));
check('NFR-02: absolute path inside the repo is allowed', allowed(path.join(repo.root, 'README.md')));
check('NFR-02: absolute path outside the repo is blocked', !allowed(path.join(os.tmpdir(), 'elsewhere.md')));
check('NFR-02: empty, non-string and NUL paths are blocked', !allowed('') && !allowed(undefined) && !allowed('docs/a\0.md'));
check('NFR-02: the repository root itself is blocked', !allowed('.'));

const caseVariantAllowed = allowed('DOCS/REQUIREMENTS.md', context);
const caseVariantBlockedPaths = !allowed('LOGS/a.md') && !allowed('.CLAUDE/settings.json');
if (process.platform === 'win32') {
    check('L-01: case variants of blocked locations are blocked on win32', !caseVariantAllowed && caseVariantBlockedPaths);
    check('L-01: case variant of README is allowed on win32', allowed('readme.md'));
} else {
    check('L-01: case variants do not resolve to blocked files on POSIX', !allowed('LOGS/a.md') || !fs.existsSync(path.join(repo.root, 'LOGS')));
}

let symlinkCreated = false;
try {
    fs.symlinkSync(path.join(repo.root, 'logs'), path.join(repo.root, 'docs', 'linked-logs'), 'junction');
    symlinkCreated = true;
} catch (error) {
    console.log(`(symlink checks skipped: ${error.code})`);
}
if (symlinkCreated) {
    check('H-04: link inside docs pointing at logs is blocked', !allowed('docs/linked-logs/a.md'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'docsync-out-'));
    fs.symlinkSync(outside, path.join(repo.root, 'docs', 'linked-out'), 'junction');
    check('H-04: link inside docs pointing outside the repository is blocked', !allowed('docs/linked-out/file.md'));
    fs.rmSync(outside, { recursive: true, force: true });
}

const run = (...args) => spawnSync('node', [scriptPath, 'check-paths', ...args], { cwd: repo.root, env: { ...process.env, CLAUDE_PROJECT_DIR: repo.root }, encoding: 'utf8' });
const okRun = run('README.md', 'docs/guide.md');
check('NFR-02: check-paths CLI exits 0 when every path is allowed', okRun.status === 0 && JSON.parse(okRun.stdout).length === 2);
const badRun = run('README.md', '.env');
check('NFR-02: check-paths CLI exits 1 when any path is blocked', badRun.status === 1 && JSON.parse(badRun.stdout)[1].allowed === false);
check('NFR-02: check-paths CLI without arguments is a usage error', run().status === 2);

removeRepo(repo);
console.log(`\n${failures === 0 ? 'ALL DOC-SYNC PATH TESTS PASSED' : failures + ' DOC-SYNC PATH TEST(S) FAILED'}`);
process.exitCode = failures === 0 ? 0 : 1;
