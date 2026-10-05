// doc-sync-completeness-check hook: trigger detection and fail-closed shell (T-09).
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRepo, writeFile, commitAll, removeRepo } = require('./helpers');

const claudeDirectory = path.join(__dirname, '..', '.claude');
const hookPath = path.join(claudeDirectory, 'hooks', 'doc-sync-completeness-check.js');

let failures = 0;
function check(label, condition) {
    if (!condition) failures++;
    console.log(`[${condition ? 'PASS' : 'FAIL'}] ${label}`);
}

const repo = createRepo('docsync-trigger-');
writeFile(repo.root, 'README.md', '# Demo\n');
commitAll(repo, 'init');
repo.git('switch', '-q', '-c', 'feature');
writeFile(repo.root, 'src/a.js', 'module.exports = 1;\n');
commitAll(repo, 'change');

function runHook(stdin, options = {}) {
    const result = spawnSync('node', [options.hook || hookPath], {
        input: typeof stdin === 'string' ? stdin : JSON.stringify(stdin),
        cwd: options.cwd || repo.root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: options.projectDir || repo.root },
        encoding: 'utf8',
    });
    return { status: result.status, stderr: result.stderr };
}
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });

const harmless = ['ls -la', 'git status', 'git commit -m "update docs"', 'gh pr list', 'gh pr view 3', 'gh pr merge 3', 'gh api repos/o/r/pulls', 'gh api repos/o/r/pulls/5/comments -f body=x', 'gh api -H "Accept: x" repos/o/r/issues -X POST', 'node tests/test-x.js'];
for (const command of harmless) {
    const outcome = runHook(bash(command));
    check(`FR-11: non-PR command exits 0 silently: ${command}`, outcome.status === 0 && outcome.stderr === '');
}
const outsideRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'docsync-norepo-'));
const nonPrOutsideRepo = runHook(bash('ls'), { cwd: outsideRepo, projectDir: path.join(outsideRepo, 'missing') });
check('L-04: a non-PR command needs no git repository, report or script (exits 0)', nonPrOutsideRepo.status === 0);
check('L-04: other tool names without a PR command exit 0', runHook({ tool_name: 'Read', tool_input: { file_path: 'x' } }).status === 0 && runHook({ tool_name: 'mcp__github__get_issue', tool_input: {} }).status === 0);

for (const raw of ['not json', '', '[]', 'null', '"text"', '{"tool_input":']) {
    const outcome = runHook(raw);
    check(`H-02: unparsable or unexpected stdin exits 2: ${JSON.stringify(raw)}`, outcome.status === 2 && /Failing closed/.test(outcome.stderr));
}

const triggers = [
    ['gh pr create --title x --body y', bash('gh pr create --title x --body y')],
    ['gh pr create with extra spaces', bash('gh   pr   create --fill')],
    ['gh -R owner/repo pr create', bash('gh -R owner/repo pr create --fill')],
    ['gh pr create after &&', bash('git status && gh pr create --fill')],
    ['gh api POST to /pulls with -X', bash('gh api repos/o/r/pulls -X POST -f title=x -f head=feature -f base=master')],
    ['gh api POST to /pulls with --method', bash('gh api --method POST /repos/o/r/pulls -f title=x')],
    ['gh api /pulls with only -f fields (implies POST)', bash('gh api repos/o/r/pulls -f title=x')],
    ['MCP create_pull_request', { tool_name: 'mcp__github__create_pull_request', tool_input: { owner: 'o', repo: 'r', title: 't', head: 'feature', base: 'master' } }],
];
for (const [label, input] of triggers) {
    const outcome = runHook(input);
    check(`FR-11: ${label} is treated as PR creation (blocked without a report)`, outcome.status === 2 && outcome.stderr.includes('REPORT_MISSING'));
}

const mismatch = runHook(bash('gh pr create --head other-branch --fill'));
check('M-02: --head different from the current branch is blocked', mismatch.status === 2 && mismatch.stderr.includes('HEAD_BRANCH_MISMATCH'));
check('M-02: --head with owner prefix is compared by branch name', runHook(bash('gh pr create --head owner:other --fill')).stderr.includes('HEAD_BRANCH_MISMATCH') && !runHook(bash('gh pr create --head owner:feature --fill')).stderr.includes('HEAD_BRANCH_MISMATCH'));
check('M-02: --head equal to the current branch is not a mismatch', !runHook(bash('gh pr create --head feature --fill')).stderr.includes('HEAD_BRANCH_MISMATCH'));
check('M-02: -H short form is checked too', runHook(bash('gh pr create -H other --fill')).stderr.includes('HEAD_BRANCH_MISMATCH'));
check('M-02: MCP head different from the current branch is blocked', runHook({ tool_name: 'mcp__github__create_pull_request', tool_input: { head: 'other' } }).stderr.includes('HEAD_BRANCH_MISMATCH'));
check('M-02: gh api head field different from the current branch is blocked', runHook(bash('gh api repos/o/r/pulls -f head=other -f title=x')).stderr.includes('HEAD_BRANCH_MISMATCH'));
check('M-02: gh api -H header flag is not mistaken for a head branch', !runHook(bash('gh api -H "Accept: x" repos/o/r/pulls -f title=x')).stderr.includes('HEAD_BRANCH_MISMATCH'));

const changeDirectory = runHook(bash('cd /tmp/other && gh pr create --fill'));
check('L-02: cd before gh pr create is blocked with its reason', changeDirectory.status === 2 && /change-directory/.test(changeDirectory.stderr));
check('L-02: git -C before gh pr create is blocked', /change-directory/.test(runHook(bash('git -C ../x status; gh pr create --fill')).stderr));
check('L-02: cd after the PR command does not matter', !/change-directory/.test(runHook(bash('gh pr create --fill && cd ..')).stderr));

check('L-04: hook and the modules it loads exist and load', (() => {
    try {
        for (const file of ['common.js', 'fingerprint.js', 'report.js', 'discover.js', 'links.js']) require(path.join(claudeDirectory, 'scripts', 'doc-sync', file));
        require.resolve(hookPath);
        return true;
    } catch {
        return false;
    }
})());

const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'docsync-isolated-'));
fs.mkdirSync(path.join(isolated, 'hooks'));
fs.copyFileSync(hookPath, path.join(isolated, 'hooks', 'doc-sync-completeness-check.js'));
const isolatedHook = path.join(isolated, 'hooks', 'doc-sync-completeness-check.js');
const missingModule = runHook(bash('gh pr create --fill'), { hook: isolatedHook });
check('H-02: a missing module on a PR command exits 2 (fails closed, not exit 1)', missingModule.status === 2 && /Failing closed/.test(missingModule.stderr));
check('H-02: a missing module does not affect non-PR commands', runHook(bash('ls'), { hook: isolatedHook }).status === 0);

fs.rmSync(outsideRepo, { recursive: true, force: true });
fs.rmSync(isolated, { recursive: true, force: true });
removeRepo(repo);
console.log(`\n${failures === 0 ? 'ALL DOC-SYNC HOOK TRIGGER TESTS PASSED' : failures + ' DOC-SYNC HOOK TRIGGER TEST(S) FAILED'}`);
process.exitCode = failures === 0 ? 0 : 1;
