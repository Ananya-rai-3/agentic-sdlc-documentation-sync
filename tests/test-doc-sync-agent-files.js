// documentation-sync agent and its five skills: files exist, frontmatter is consistent, referenced scripts exist (T-15..T-18).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const SKILL_NAMES = [
    'documentation-discovery',
    'code-documentation-comparison',
    'stale-documentation-detection',
    'documentation-update',
    'documentation-validation',
];
const ALLOWED_TOOLS = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash', 'Skill'];

let failures = 0;
function check(label, condition) {
    if (!condition) failures++;
    console.log(`[${condition ? 'PASS' : 'FAIL'}] ${label}`);
}

function readIfExists(relativePath) {
    const target = path.join(root, ...relativePath.split('/'));
    return fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : null;
}

function frontmatter(text) {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(text || '');
    return match ? match[1] : '';
}

function frontmatterValue(block, key) {
    const match = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(block);
    return match ? match[1].trim() : null;
}

const files = {};
for (const name of SKILL_NAMES) {
    const relativePath = `.claude/skills/${name}/SKILL.md`;
    files[relativePath] = readIfExists(relativePath);
    check(`T-15..17: ${relativePath} exists`, files[relativePath] !== null);
    const block = frontmatter(files[relativePath]);
    check(`T-15..17: ${name} frontmatter name matches folder`, frontmatterValue(block, 'name') === name);
    check(`T-15..17: ${name} has a description`, (frontmatterValue(block, 'description') || '').length > 20);
}

const agentPath = '.claude/agents/documentation-sync.md';
const agentText = readIfExists(agentPath);
files[agentPath] = agentText;
check('T-18: agent file exists', agentText !== null);
const agentBlock = frontmatter(agentText);
check('T-18: agent frontmatter name matches file name', frontmatterValue(agentBlock, 'name') === 'documentation-sync');

const toolsLine = frontmatterValue(agentBlock, 'tools');
const tools = toolsLine === null ? [] : toolsLine.split(',').map((tool) => tool.trim()).filter(Boolean);
check('T-18: agent lists the restricted tools exactly', ALLOWED_TOOLS.every((tool) => tools.includes(tool)) && tools.length === ALLOWED_TOOLS.length);
check('T-18: agent grants no tool beyond the allowed list', tools.every((tool) => ALLOWED_TOOLS.includes(tool)));
check('T-18: agent has a PreToolUse hook for Write|Edit', /PreToolUse:/.test(agentBlock) && /matcher:\s*"Write\|Edit"/.test(agentBlock));
check('T-18: agent hook runs the write guard', /command:.*\.claude\/hooks\/doc-sync-write-guard\.js/.test(agentBlock));

const body = (agentText || '').slice(agentBlock.length);
check('T-18: agent never edits status.json or pipeline-status.md', /Never edit `\.pipeline\/status\.json` or `docs\/pipeline-status\.md`/.test(body));
check('T-18: agent has NEEDS_HUMAN and FAILED handling', /NEEDS_HUMAN/.test(body) && /FAILED/.test(body));
check('T-18: agent names all five skills in order', (() => {
    const positions = SKILL_NAMES.map((name) => body.indexOf(`\`${name}\``));
    return positions.every((position) => position >= 0);
})());
check('T-18: agent covers commit ownership and AMBIGUOUS acknowledgement', /orchestrator commits/.test(body) && /ACKNOWLEDGED/.test(body) && /explicit instruction/.test(body));

const referencedPaths = new Set();
for (const text of Object.values(files)) {
    if (text === null) continue;
    for (const match of text.matchAll(/\.claude\/[A-Za-z0-9_./-]+\.js/g)) referencedPaths.add(match[0]);
}
const expectedReferences = ['discover.js', 'report.js', 'links.js', 'fingerprint.js', 'doc-sync-write-guard.js'];
check('T-15..18: the new files reference the four scripts and the write guard', expectedReferences.every((name) => [...referencedPaths].some((entry) => entry.endsWith(`/${name}`))));
for (const referenced of referencedPaths) {
    check(`T-15..18: referenced ${referenced} exists on disk`, fs.existsSync(path.join(root, ...referenced.split('/'))));
}

console.log(failures === 0 ? '\nAll doc-sync agent file tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
