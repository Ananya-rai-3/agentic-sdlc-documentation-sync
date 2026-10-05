// doc-sync-write-guard hook: allow-list enforcement for Write/Edit (T-11).
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRepo, writeFile, commitAll, removeRepo } = require('./helpers');

const hookPath = path.join(__dirname, '..', '.claude', 'hooks', 'doc-sync-write-guard.js');

let failures = 0;
function check(label, condition) {
    if (!condition) failures++;
    console.log(`[${condition ? 'PASS' : 'FAIL'}] ${label}`);
}

const repo = createRepo('docsync-guard-');
for (const file of ['README.md', 'docs/guide.md', 'docs/requirements.md', 'docs/architecture.md', 'docs/pipeline-status.md', 'src/changed.js', 'src/unchanged.js', '.env', 'logs/a.md']) {
    writeFile(repo.root, file, 'x\n');
}
commitAll(repo, 'init');
repo.git('switch', '-q', '-c', 'feature');
writeFile(repo.root, 'src/changed.js', 'y\n');
writeFile(repo.root, '.claude/settings.json', '{}\n');
commitAll(repo, 'change');

function runGuard(stdin, projectDir = repo.root) {
    const result = spawnSync('node', [hookPath], {
        input: typeof stdin === 'string' ? stdin : JSON.stringify(stdin),
        cwd: repo.root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
        encoding: 'utf8',
    });
    return { status: result.status, stderr: result.stderr };
}
const write = (filePath, tool = 'Write') => runGuard({ tool_name: tool, tool_input: { file_path: filePath, content: 'x' } });
const absolute = (relativePath) => path.join(repo.root, ...relativePath.split('/'));

check('NFR-02: README.md is allowed', write('README.md').status === 0);
check('NFR-02: Edit on a docs file is allowed', write('docs/guide.md', 'Edit').status === 0);
check('NFR-02: absolute path to a docs file is allowed', write(absolute('docs/guide.md')).status === 0);
check('NFR-02: a new docs file is allowed', write('docs/new/page.md').status === 0);
check('NFR-02: the doc-sync report is allowed', write('docs/doc-sync-report.md').status === 0);
check('NFR-02: a source file changed on the branch is allowed', write('src/changed.js').status === 0);

for (const [label, target] of [
    ['phase document', 'docs/requirements.md'],
    ['another phase document', 'docs/architecture.md'],
    ['pipeline-status.md', 'docs/pipeline-status.md'],
    ['.env', '.env'],
    ['nested .env.local', 'docs/.env.local'],
    ['.claude file even though changed', '.claude/settings.json'],
    ['.pipeline file', '.pipeline/status.json'],
    ['logs file', 'logs/a.md'],
    ['unchanged source file', 'src/unchanged.js'],
    ['parent traversal', 'docs/../.env'],
    ['traversal outside the repo', '../outside.md'],
    ['backslash traversal', 'docs\\..\\.env'],
    ['backslash path to logs', 'logs\\a.md'],
    ['backslash path to a phase document', 'docs\\requirements.md'],
    ['absolute path outside the repo', path.join(os.tmpdir(), 'elsewhere.md')],
]) {
    const outcome = write(target);
    check(`H-04: ${label} is blocked (${target})`, outcome.status === 2 && outcome.stderr.includes('may not write'));
}
if (process.platform === 'win32') {
    check('L-01: case variants of blocked locations are blocked on win32', write('LOGS/a.md').status === 2 && write('Docs/Requirements.MD').status === 2 && write('.CLAUDE/settings.json').status === 2);
}

check('H-04: unparsable stdin exits 2', runGuard('not json').status === 2);
check('H-04: empty stdin exits 2', runGuard('').status === 2);
check('H-04: a missing file_path exits 2', runGuard({ tool_name: 'Write', tool_input: {} }).status === 2);
check('H-04: a non-string file_path exits 2', runGuard({ tool_name: 'Write', tool_input: { file_path: 42 } }).status === 2);
check('H-04: a non-object payload exits 2', runGuard('[]').status === 2);

const noBase = createRepo('docsync-guard-nobase-');
writeFile(noBase.root, 'README.md', 'x\n');
writeFile(noBase.root, 'src/a.js', 'x\n');
commitAll(noBase, 'init');
noBase.git('branch', '-q', '-m', 'trunk');
const withoutBase = (target) => runGuard({ tool_name: 'Write', tool_input: { file_path: target } }, noBase.root);
check('NFR-04: when the base cannot be resolved README and docs stay writable', withoutBase('README.md').status === 0);
check('NFR-04: when the base cannot be resolved source files are blocked', withoutBase('src/a.js').status === 2);

const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'docsync-guard-isolated-'));
fs.mkdirSync(path.join(isolated, 'hooks'));
fs.copyFileSync(hookPath, path.join(isolated, 'hooks', 'doc-sync-write-guard.js'));
const isolatedRun = spawnSync('node', [path.join(isolated, 'hooks', 'doc-sync-write-guard.js')], {
    input: JSON.stringify({ tool_input: { file_path: 'README.md' } }),
    cwd: repo.root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo.root },
    encoding: 'utf8',
});
check('H-04: a missing module exits 2 (fails closed, not exit 1)', isolatedRun.status === 2);

fs.rmSync(isolated, { recursive: true, force: true });
removeRepo(repo);
removeRepo(noBase);
console.log(`\n${failures === 0 ? 'ALL DOC-SYNC WRITE GUARD TESTS PASSED' : failures + ' DOC-SYNC WRITE GUARD TEST(S) FAILED'}`);
process.exitCode = failures === 0 ? 0 : 1;
