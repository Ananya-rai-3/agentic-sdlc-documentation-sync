// commit-guard and pr-gate hooks, exercised against a throwaway git repo.
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hooks = path.join(__dirname, '..', '.claude', 'hooks');
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
g('init', '-q', '-b', 'master');
g('config', 'user.email', 't@example.com');
g('config', 'user.name', 't');
fs.writeFileSync(path.join(repo, 'a.txt'), 'x');
g('add', '-A');
g('commit', '-q', '-m', 'init');

const run = (hook, command) => spawnSync('node', [path.join(hooks, hook)], {
    input: JSON.stringify({ tool_input: { command } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
    encoding: 'utf8',
}).status;

let failures = 0;
function check(label, condition) {
    if (!condition) failures++;
    console.log(`[${condition ? 'PASS' : 'FAIL'}] ${label}`);
}
const guard = (command) => run('commit-guard.js', command);
const PUSH = 'git ' + 'push';

// pushes while on master
check('bare push on master is blocked', guard(PUSH) === 2);
check('push origin on master is blocked', guard(`${PUSH} origin`) === 2);
check('push origin HEAD on master is blocked', guard(`${PUSH} origin HEAD`) === 2);
check('push origin master is blocked', guard(`${PUSH} origin master`) === 2);
check('force push is blocked', guard(`${PUSH} --force origin feat`) === 2);
check('force push inside a compound command is blocked', guard(`echo hi && ${PUSH} -f origin feat`) === 2);

g('switch', '-q', '-c', 'feat');
check('bare push on a feature branch is allowed', guard(PUSH) === 0);
check('push -u origin feat is allowed', guard(`${PUSH} -u origin feat`) === 0);
check('push HEAD:main is blocked from a feature branch', guard(`${PUSH} origin HEAD:main`) === 2);
check('non-push git command is allowed', guard('git branch -f x HEAD') === 0);

// staging and committing sensitive files
fs.writeFileSync(path.join(repo, '.env'), 'TOKEN=abc');
check('staging .env is blocked', guard('git add .env') === 2);
check('staging .env.example is allowed', guard('git add .env.example') === 0);
check('add -A && commit with an untracked .env is blocked', guard('git add -A && git commit -m x') === 2);
check('commit -am does not auto-stage an untracked .env', guard('git commit -am x') === 0);
fs.unlinkSync(path.join(repo, '.env'));

fs.writeFileSync(path.join(repo, '.env.example'), 'GITHUB_PERSONAL_ACCESS_TOKEN=\n');
check('.env.example may be committed', guard('git add -A && git commit -m x') === 0);

fs.writeFileSync(path.join(repo, 'b.js'), 'const t = "ghp_' + 'a'.repeat(30) + '";');
check('a token in an untracked file is blocked', guard('git add -A && git commit -m x') === 2);
fs.unlinkSync(path.join(repo, 'b.js'));

fs.writeFileSync(path.join(repo, '.mcp.json'), '{"env":{"GITHUB_PERSONAL_ACCESS_TOKEN":"${GITHUB_PERSONAL_ACCESS_TOKEN}"}}');
check('.mcp.json with a ${VAR} reference may be committed', guard('git add -A && git commit -m x') === 0);
fs.writeFileSync(path.join(repo, '.mcp.json'), '{"env":{"GITHUB_PERSONAL_ACCESS_TOKEN":"literalvalue123"}}');
check('.mcp.json with a literal credential is blocked', guard('git add -A && git commit -m x') === 2);

// pr-gate
const prGate = (command) => run('pr-gate.js', command);
const PR = 'gh pr ' + 'create --title x';
check('pr-gate ignores other commands', prGate('git status') === 0);
check('PR is blocked without a verification report', prGate(PR) === 2);
fs.mkdirSync(path.join(repo, 'docs'));
fs.writeFileSync(path.join(repo, 'docs', 'verification-report.md'), '- **Ready for PR:** NO — tests fail\n');
check('PR is blocked when Ready for PR is NO', prGate(PR) === 2);
fs.writeFileSync(path.join(repo, 'docs', 'verification-report.md'), '- **Ready for PR:** YES / NO — template\n');
check('PR is blocked on the unfilled YES / NO template', prGate(PR) === 2);
fs.writeFileSync(path.join(repo, 'docs', 'verification-report.md'), '- **Ready for PR:** YES\n');
check('PR is allowed when Ready for PR is YES', prGate(PR) === 0);

fs.rmSync(repo, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'ALL COMMIT-GUARD TESTS PASSED' : failures + ' COMMIT-GUARD TEST(S) FAILED'}`);
process.exitCode = failures === 0 ? 0 : 1;
