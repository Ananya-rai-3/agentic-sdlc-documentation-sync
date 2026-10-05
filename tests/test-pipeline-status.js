// State machine behind .pipeline/status.json: ordering, idempotency, gates, rework cap, resume.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const script = path.join(__dirname, '..', '.claude', 'scripts', 'pipeline-status.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-'));
fs.mkdirSync(path.join(root, 'docs'));
const env = { ...process.env, CLAUDE_PROJECT_DIR: root, PIPELINE_MODE: 'gated', PIPELINE_MAX_REWORK_LOOPS: '2' };
const ps = (...args) => { const r = spawnSync('node', [script, ...args], { env, encoding: 'utf8' }); return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
const state = () => JSON.parse(fs.readFileSync(path.join(root, '.pipeline', 'status.json'), 'utf8'));
const doc = (name, text) => fs.writeFileSync(path.join(root, 'docs', name), text);

let failures = 0;
function check(label, condition) {
    if (!condition) failures++;
    console.log(`[${condition ? 'PASS' : 'FAIL'}] ${label}`);
}

check('no pipeline before init', ps('next').out.startsWith('NO_PIPELINE'));
check('init starts at requirements', ps('init', 'no-ticket', 'demo').out === 'RUN requirements (step 1)');
check('init refuses to overwrite a running pipeline', ps('init', 'x', 'y').code === 1);
check('cannot skip ahead to architecture', ps('start', 'architecture').code === 1);

ps('start', 'requirements');
check('gated: done requirements opens an approval gate', ps('done', 'requirements').out === 'APPROVE after:requirements');
check('WAITING_APPROVAL is its own state', state().state === 'WAITING_APPROVAL' && state().steps.requirements === 'WAITING_APPROVAL');
check('cannot start a step while waiting for approval', ps('start', 'architecture').code === 1);
check('approve continues to architecture', ps('approve').out === 'RUN architecture (step 2)');

ps('start', 'architecture'); ps('done', 'architecture');
check('COMPLETE steps are not run again', ps('start', 'requirements').code === 1 && ps('start', 'architecture').code === 1);

// resume: a fresh process reads only status.json
check('resume points at design-review', ps('next').out === 'RUN design-review (step 3)');

// design-review rework cap
doc('design-review.md', '- **Verdict:** NEEDS REWORK\n');
ps('start', 'design-review');
check('verdict detects NEEDS REWORK', ps('verdict', 'design-review').out.startsWith('REWORK'));
check('rework 1 resets architecture + design-review', ps('rework', 'architecture', 'design-review').out.startsWith('rework 1/2') && state().steps.architecture === 'PENDING');
ps('start', 'architecture'); ps('done', 'architecture'); ps('start', 'design-review');
check('rework 2 allowed', ps('rework', 'architecture', 'design-review').out.startsWith('rework 2/2') && state().rework_count === 2);
ps('start', 'architecture'); ps('done', 'architecture'); ps('start', 'design-review');
const blocked = ps('rework', 'architecture', 'design-review');
check('third rework BLOCKS (exit 3)', blocked.code === 3 && state().state === 'BLOCKED' && blocked.out.startsWith('BLOCKED'));
check('BLOCKED is distinct from WAITING_APPROVAL and FAILED', state().state !== 'WAITING_APPROVAL' && state().state !== 'FAILED');
check('cannot start while BLOCKED', ps('start', 'design-review').code === 1);
check('retry clears the block and resets the count', ps('retry').out.startsWith('RUN design-review') && state().rework_count === 0);

doc('design-review.md', '- **Verdict:** APPROVED\n');
ps('start', 'design-review');
check('verdict PASS on approval', ps('verdict', 'design-review').out === 'PASS');
check('design-review gate opens', ps('done', 'design-review').out === 'APPROVE after:design_review');
check('revise sends the step back for changes', ps('revise').out === 'RUN design-review (step 3)' && state().steps.design_review === 'PENDING');
ps('start', 'design-review'); ps('done', 'design-review'); ps('approve');
ps('start', 'implementation_plan'); ps('done', 'implementation_plan'); ps('approve');

// implement artifact check and code-review verdicts
doc('impl-plan.md', '| T-01 | x | y | - | 1h | DONE |\n| T-02 | x | y | - | 1h | TODO |\n');
check('implement check fails while tasks are TODO', ps('check', 'implement').code === 1);
doc('impl-plan.md', '| T-01 | x | y | - | 1h | DONE |\n');
check('implement check passes when all tasks DONE', ps('check', 'implement').code === 0);
ps('start', 'implement'); ps('done', 'implement'); ps('start', 'code-review');
const table = '| # | File | Line | Issue | Recommendation |\n|---|------|------|-------|----------------|\n';
doc('code-review.md', `- **Verdict:** APPROVED WITH CHANGES\n### CRITICAL — x\n${table}### HIGH — x\n${table}| 1 | a.js | 3 | bug | fix |\n### MEDIUM — x\n${table}| 1 | b.js | 1 | meh | fix |\n`);
check('open High finding triggers rework', ps('verdict', 'code-review').out.startsWith('REWORK 1'));
doc('code-review.md', `- **Verdict:** APPROVED\n### CRITICAL — x\n${table}### HIGH — x\n${table}### MEDIUM — x\n${table}| 1 | b.js | 1 | meh | fix |\n`);
check('Medium-only findings pass', ps('verdict', 'code-review').out === 'PASS');
ps('done', 'code-review'); ps('start', 'verify');
doc('verification-report.md', '- **Ready for PR:** NO — tests fail\n');
check('Ready for PR: NO triggers rework', ps('verdict', 'verify').out.startsWith('REWORK'));
doc('verification-report.md', '- **Ready for PR:** YES\n');
check('Ready for PR: YES passes', ps('verdict', 'verify').out === 'PASS');

check('PR gate is always a human gate', ps('done', 'verify').out === 'APPROVE before:create_pr');
check('cannot create PR before approval', ps('start', 'create-pr').code === 1);
ps('approve'); ps('start', 'create-pr');
check('finishing create-pr completes the pipeline', ps('done', 'create-pr').out === 'DONE' && state().state === 'COMPLETE');

// generated summary
const md = fs.readFileSync(path.join(root, 'docs', 'pipeline-status.md'), 'utf8');
check('summary shows state, gate, rework count and the step table', /Pipeline State:\*\* COMPLETE/.test(md) && /Gate:\*\* none/.test(md) && /Rework Count:\*\* 0 \/ 2/.test(md) && /\| Create PR \| COMPLETE \|/.test(md));

// hook rejects a hand-corrupted file
fs.writeFileSync(path.join(root, '.pipeline', 'status.json'), JSON.stringify({ ...state(), state: 'DONE' }));
const hook = spawnSync('node', [script, '--hook'], { env, input: JSON.stringify({ tool_input: { file_path: path.join(root, '.pipeline', 'status.json') } }), encoding: 'utf8' });
check('--hook rejects an invalid state value (exit 2)', hook.status === 2);

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'ALL PIPELINE-STATUS TESTS PASSED' : failures + ' PIPELINE-STATUS TEST(S) FAILED'}`);
process.exitCode = failures === 0 ? 0 : 1;
