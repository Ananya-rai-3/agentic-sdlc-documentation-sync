// settings.json wiring for the doc-sync hook and env defaults (T-19).
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));

let failures = 0;
function check(label, condition) {
    if (!condition) failures++;
    console.log(`[${condition ? 'PASS' : 'FAIL'}] ${label}`);
}

const HOOK_COMMAND = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/doc-sync-completeness-check.js"';
const preToolUse = (settings.hooks && settings.hooks.PreToolUse) || [];
const docSyncEntry = preToolUse.find((entry) => entry.matcher === 'Bash|mcp__github__create_pull_request');

check('FR-11: settings.json parses and has PreToolUse hooks', preToolUse.length >= 2);
check('FR-11: doc-sync matcher covers Bash and the MCP create_pull_request tool', Boolean(docSyncEntry));
check('FR-11: doc-sync entry runs the completeness hook', Boolean(docSyncEntry) && docSyncEntry.hooks.length === 1 && docSyncEntry.hooks[0].type === 'command' && docSyncEntry.hooks[0].command === HOOK_COMMAND);

const hookFiles = [
    '.claude/hooks/doc-sync-completeness-check.js',
    '.claude/hooks/doc-sync-write-guard.js',
    '.claude/hooks/commit-guard.js',
    '.claude/hooks/pr-gate.js',
];
for (const hookFile of hookFiles) {
    const absolute = path.join(root, hookFile);
    check(`NFR-04: ${hookFile} exists`, fs.existsSync(absolute));
    const syntax = spawnSync(process.execPath, ['--check', absolute], { encoding: 'utf8' });
    check(`NFR-04: ${hookFile} has valid syntax`, syntax.status === 0);
}

check('NFR-06: DOC_SYNC_MAX_FILES defaults to 20', settings.env.DOC_SYNC_MAX_FILES === '20');
check('NFR-06: DOC_SYNC_MAX_ITEMS defaults to 15', settings.env.DOC_SYNC_MAX_ITEMS === '15');

let committed = null;
try {
    committed = JSON.parse(execFileSync('git', ['show', 'HEAD:.claude/settings.json'], { cwd: root, encoding: 'utf8' }));
} catch {
    committed = null;
}
check('H-01: committed settings.json is readable for comparison', committed !== null);
if (committed) {
    const committedEntries = committed.hooks.PreToolUse;
    check('H-01: existing commit-guard/pr-gate entry is unchanged and still first', JSON.stringify(preToolUse[0]) === JSON.stringify(committedEntries[0]));
    check('H-01: no pre-existing PreToolUse entry was altered', committedEntries.every((entry, index) => JSON.stringify(preToolUse[index]) === JSON.stringify(entry)));
    check('H-02: SessionStart and PostToolUse hooks are unchanged', JSON.stringify(settings.hooks.SessionStart) === JSON.stringify(committed.hooks.SessionStart) && JSON.stringify(settings.hooks.PostToolUse) === JSON.stringify(committed.hooks.PostToolUse));
    check('H-02: permissions are unchanged', JSON.stringify(settings.permissions) === JSON.stringify(committed.permissions));
    check('H-02: pre-existing env values are unchanged', Object.entries(committed.env).every(([key, value]) => settings.env[key] === value));
    check('H-02: enabledMcpjsonServers is unchanged', JSON.stringify(settings.enabledMcpjsonServers) === JSON.stringify(committed.enabledMcpjsonServers));
}

console.log(`\n${failures === 0 ? 'ALL DOC-SYNC WIRING TESTS PASSED' : failures + ' DOC-SYNC WIRING TEST(S) FAILED'}`);
process.exitCode = failures === 0 ? 0 : 1;
