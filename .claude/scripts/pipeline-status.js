// Pipeline state machine + renderer. Deterministic, zero model tokens.
// Source of truth: .pipeline/status.json (written ONLY by this script, i.e. by the orchestrator).
// Derived view:    docs/pipeline-status.md (regenerated on every change, never edited by hand).
//
//   node pipeline-status.js                      print the status table (also rewrites the .md)
//   node pipeline-status.js next                 one line: what to do now (RUN|RESUME|APPROVE|BLOCKED|FAILED|DONE)
//   node pipeline-status.js init <ticket> <slug> [--force]
//   node pipeline-status.js start <step>         PENDING -> IN_PROGRESS (refuses if an earlier step is not COMPLETE)
//   node pipeline-status.js done <step>          IN_PROGRESS -> COMPLETE, or WAITING_APPROVAL if a gate follows
//   node pipeline-status.js fail <step> [reason] step -> FAILED
//   node pipeline-status.js approve              pass the current human gate
//   node pipeline-status.js revise               human asked for changes at a gate: re-run that step
//   node pipeline-status.js rework <from> <review>   review failed: reset from..review to PENDING, count the loop,
//                                                BLOCKED once PIPELINE_MAX_REWORK_LOOPS is exceeded
//   node pipeline-status.js retry                human fixed a BLOCKED/FAILED step: re-run it
//   node pipeline-status.js check <step>         does the step's expected artifact exist?
//   node pipeline-status.js verdict <step>       PASS | REWORK for design_review, code_review, verify
//   node pipeline-status.js --hook               PostToolUse: re-render/validate when status.json was edited
//   node pipeline-status.js --session            SessionStart: one-line summary
// <step> is a number 1-8, a key (design_review) or an agent name (design-review, impl-plan).
const fs = require('fs');
const path = require('path');

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const statusFile = path.join(root, '.pipeline', 'status.json');
const outFile = path.join(root, process.env.PIPELINE_STATUS_FILE || 'docs/pipeline-status.md');
const MAX_REWORK = parseInt(process.env.PIPELINE_MAX_REWORK_LOOPS || '2', 10);
const GATED = (process.env.PIPELINE_MODE || 'gated') !== 'auto';

const STEPS = [
  { key: 'requirements', agent: 'requirements', label: 'Requirements' },
  { key: 'architecture', agent: 'architecture', label: 'Architecture' },
  { key: 'design_review', agent: 'design-review', label: 'Design Review' },
  { key: 'implementation_plan', agent: 'impl-plan', label: 'Implementation Plan' },
  { key: 'implement', agent: 'implement', label: 'Implementation' },
  { key: 'code_review', agent: 'code-review', label: 'Code Review' },
  { key: 'verify', agent: 'verify', label: 'Verification' },
  { key: 'create_pr', agent: 'create-pr', label: 'Create PR' },
];
const STATES = ['PENDING', 'IN_PROGRESS', 'COMPLETE', 'WAITING_APPROVAL', 'FAILED', 'BLOCKED'];
// Human approval after these steps (gated mode). Approval before create_pr is always required.
const GATE_AFTER = GATED ? ['requirements', 'design_review', 'implementation_plan'] : [];

const die = (msg) => { process.stderr.write(`pipeline: ${msg}\n`); process.exit(1); };
const today = () => new Date().toISOString().slice(0, 10);

function resolve(arg) {
  const a = String(arg || '').trim().toLowerCase().replace(/-/g, '_');
  const i = /^\d+$/.test(a) ? parseInt(a, 10) - 1 : STEPS.findIndex((s) => s.key === a || s.agent.replace(/-/g, '_') === a);
  if (!STEPS[i]) die(`unknown step "${arg}"`);
  return i;
}

function load() {
  if (!fs.existsSync(statusFile)) return null;
  try { return JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch (e) { die(`.pipeline/status.json is not valid JSON: ${e.message}`); }
}

function validate(s) {
  const bad = [];
  if (!STATES.includes(s.state)) bad.push(`state "${s.state}"`);
  for (const st of STEPS) if (!STATES.includes((s.steps || {})[st.key])) bad.push(`steps.${st.key} "${(s.steps || {})[st.key]}"`);
  return bad;
}

function save(s) {
  s.updated = today();
  fs.mkdirSync(path.dirname(statusFile), { recursive: true });
  fs.writeFileSync(statusFile + '.tmp', JSON.stringify(s, null, 2) + '\n');
  fs.renameSync(statusFile + '.tmp', statusFile);
  render(s);
}

function nextAction(s) {
  if (!s) return 'NO_PIPELINE: run /pipeline <story>';
  if (s.state === 'COMPLETE') return 'DONE';
  if (s.state === 'BLOCKED') return `BLOCKED ${STEPS[s.current_step - 1].key}: ${s.reason || 'needs human'}`;
  if (s.state === 'FAILED') return `FAILED ${STEPS[s.current_step - 1].key}: ${s.reason || 'needs human'}`;
  if (s.state === 'WAITING_APPROVAL') return `APPROVE ${s.gate}`;
  const i = STEPS.findIndex((st) => s.steps[st.key] !== 'COMPLETE');
  if (i < 0) return 'DONE';
  const verb = s.steps[STEPS[i].key] === 'IN_PROGRESS' ? 'RESUME' : 'RUN';
  return `${verb} ${STEPS[i].agent} (step ${i + 1})`;
}

function render(s) {
  let body;
  if (!s) {
    body = '# Pipeline Status\n\n_No pipeline running. Run `/pipeline <story>` to start one._\n';
  } else {
    const cur = STEPS[s.current_step - 1];
    body = [
      '# Pipeline Status',
      '',
      `_Generated by \`.claude/scripts/pipeline-status.js\` from \`.pipeline/status.json\`. Do not edit by hand. Updated: ${s.updated}_`,
      '',
      `- **Ticket:** ${s.ticket}_${s.slug}`,
      `- **Current Step:** ${s.current_step} — ${cur.label}`,
      `- **Pipeline State:** ${s.state}`,
      `- **Gate:** ${s.gate || 'none'}`,
      `- **Rework Count:** ${s.rework_count} / ${MAX_REWORK}`,
      ...(s.reason ? [`- **Reason:** ${s.reason}`] : []),
      `- **Next:** ${nextAction(s)}`,
      '',
      '| Step | Status |',
      '|---|---|',
      ...STEPS.map((st) => `| ${st.label} | ${s.steps[st.key]} |`),
      '',
    ].join('\n');
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, body);
  return body;
}

function need() {
  const s = load();
  if (!s) die('no pipeline. Run: node .claude/scripts/pipeline-status.js init <ticket> <slug>');
  return s;
}

// A step may start only if every earlier step is COMPLETE and it has not already finished.
function start(s, i) {
  const k = STEPS[i].key;
  if (s.steps[k] === 'COMPLETE') die(`${k} is already COMPLETE; not running it again`);
  if (['BLOCKED', 'FAILED'].includes(s.state)) die(`pipeline is ${s.state}; resolve it first (retry)`);
  if (s.state === 'WAITING_APPROVAL') die(`waiting for approval (${s.gate}); approve first`);
  for (let j = 0; j < i; j++) if (s.steps[STEPS[j].key] !== 'COMPLETE') die(`${STEPS[j].key} is ${s.steps[STEPS[j].key]}; cannot start ${k}`);
  s.steps[k] = 'IN_PROGRESS';
  s.current_step = i + 1;
  s.state = 'IN_PROGRESS';
  s.gate = null;
}

function complete(s, i) {
  s.steps[STEPS[i].key] = 'COMPLETE';
  s.gate = null;
  if (i === STEPS.length - 1) { s.state = 'COMPLETE'; s.current_step = STEPS.length; return; }
  s.current_step = i + 2;
  if (STEPS[i + 1].key === 'create_pr') { s.state = 'WAITING_APPROVAL'; s.gate = 'before:create_pr'; } else s.state = 'IN_PROGRESS';
}

// ---- artifact checks -------------------------------------------------------
const read = (p) => (fs.existsSync(path.join(root, p)) ? fs.readFileSync(path.join(root, p), 'utf8') : null);
const ARTIFACT = {
  requirements: 'docs/requirements.md',
  architecture: 'docs/architecture.md',
  design_review: 'docs/design-review.md',
  implementation_plan: 'docs/impl-plan.md',
  implement: 'docs/impl-plan.md',
  code_review: 'docs/code-review.md',
  verify: 'docs/verification-report.md',
  create_pr: 'CHANGELOG.md',
};

function check(key) {
  const file = ARTIFACT[key];
  const text = read(file);
  if (text === null) return `MISSING ${file}`;
  if (key === 'implement' && /^\|\s*T-\d+.*\|\s*(TODO|IN PROGRESS)\s*\|\s*$/m.test(text)) return 'MISSING implement: impl-plan.md still has TODO/IN PROGRESS tasks';
  if (key === 'verify' && !/Ready for PR:/i.test(text)) return 'MISSING verification-report.md has no "Ready for PR:" line';
  return `OK ${file}`;
}

function rowsUnder(text, heading) {
  const m = text.match(new RegExp(`^###\\s+${heading}[^\\n]*\\n([\\s\\S]*?)(?=^#{2,3}\\s|(?![\\s\\S]))`, 'im'));
  if (!m) return 0;
  return m[1].split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*(#|-)/.test(l) && !/^\|[\s|:-]*$/.test(l)).length;
}

function verdict(key) {
  const text = read(ARTIFACT[key]);
  if (text === null) die(`${ARTIFACT[key]} not found`);
  if (key === 'design_review') return /Verdict:\**\s*\**\s*NEEDS REWORK/i.test(text) ? 'REWORK design-review verdict is NEEDS REWORK' : 'PASS';
  if (key === 'code_review') {
    const n = rowsUnder(text, 'CRITICAL') + rowsUnder(text, 'HIGH');
    return n > 0 || /Verdict:\**\s*\**\s*REQUEST CHANGES/i.test(text) ? `REWORK ${n} Critical/High finding(s) or REQUEST CHANGES` : 'PASS';
  }
  if (key === 'verify') return /Ready for PR:?\**:?\s*\**\s*YES\b(?!\s*\/\s*NO)/i.test(text) ? 'PASS' : 'REWORK verification says Ready for PR is not YES';
  return die(`${key} is not a review step`);
}

// ---- main ------------------------------------------------------------------
const [cmd, a1, a2, ...rest] = process.argv.slice(2);

if (cmd === '--hook') {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch {}
  const target = ((input.tool_input || {}).file_path || '').replace(/\\/g, '/');
  if (!/\/\.pipeline\/status\.json$/.test(target)) process.exit(0);
  const s = load();
  const bad = validate(s || { steps: {} });
  if (bad.length) { process.stderr.write(`Invalid .pipeline/status.json: ${bad.join(', ')}. Use pipeline-status.js commands instead of editing it.\n`); process.exit(2); }
  render(s);
  process.exit(0);
}

if (cmd === '--session') {
  const s = load();
  render(s);
  if (s) console.log(`Pipeline ${s.ticket}_${s.slug}: step ${s.current_step}/8 ${s.state}${s.gate ? ` (gate ${s.gate})` : ''}. Next: ${nextAction(s)}. Details: ${path.relative(root, outFile).replace(/\\/g, '/')}`);
  process.exit(0);
}

if (cmd === 'init') {
  if (!a1 || !a2) die('usage: init <ticket> <slug> [--force]');
  const old = load();
  if (old && old.state !== 'COMPLETE' && ![a2, ...rest].includes('--force')) die(`pipeline for ${old.ticket}_${old.slug} is ${old.state}; finish it or pass --force`);
  const s = {
    ticket: a1, slug: a2, log: `logs/${a1}_${a2}.md`, current_step: 1, state: 'IN_PROGRESS', gate: null, rework_count: 0, reason: null, updated: today(),
    steps: Object.fromEntries(STEPS.map((st) => [st.key, 'PENDING'])),
  };
  save(s);
  console.log(nextAction(s));
} else if (cmd === 'next') {
  console.log(nextAction(load()));
} else if (cmd === 'start') {
  const s = need(); start(s, resolve(a1)); save(s); console.log(`started ${STEPS[resolve(a1)].key}`);
} else if (cmd === 'done') {
  const s = need(); const i = resolve(a1); const k = STEPS[i].key;
  if (s.steps[k] !== 'IN_PROGRESS') die(`${k} is ${s.steps[k]}, expected IN_PROGRESS`);
  if (['design_review', 'code_review', 'verify'].includes(k)) s.rework_count = 0;
  if (GATE_AFTER.includes(k)) { s.steps[k] = 'WAITING_APPROVAL'; s.state = 'WAITING_APPROVAL'; s.gate = `after:${k}`; } else complete(s, i);
  save(s); console.log(nextAction(s));
} else if (cmd === 'fail') {
  const s = need(); const i = resolve(a1);
  s.steps[STEPS[i].key] = 'FAILED'; s.state = 'FAILED'; s.current_step = i + 1; s.reason = [a2, ...rest].filter(Boolean).join(' ') || null;
  save(s); console.log(nextAction(s));
} else if (cmd === 'approve') {
  const s = need();
  if (s.state !== 'WAITING_APPROVAL') die(`nothing to approve (state ${s.state})`);
  const [kind, key] = s.gate.split(':');
  if (kind === 'after') complete(s, resolve(key)); else { s.state = 'IN_PROGRESS'; s.gate = null; }
  save(s); console.log(nextAction(s));
} else if (cmd === 'revise') {
  const s = need();
  if (s.state !== 'WAITING_APPROVAL') die(`no gate is open (state ${s.state})`);
  const [kind, key] = s.gate.split(':');
  if (kind === 'after') s.steps[key] = 'PENDING';
  s.state = 'IN_PROGRESS'; s.gate = null; if (kind === 'after') s.current_step = resolve(key) + 1;
  save(s); console.log(nextAction(s));
} else if (cmd === 'rework') {
  const s = need(); const from = resolve(a1); const review = resolve(a2);
  if (from > review) die('rework: <from> must not come after <review>');
  if (s.rework_count >= MAX_REWORK) {
    s.steps[STEPS[review].key] = 'BLOCKED'; s.state = 'BLOCKED'; s.current_step = review + 1;
    s.reason = `${STEPS[review].key} still failing after ${MAX_REWORK} rework loops`;
    save(s); console.log(nextAction(s)); process.exit(3);
  }
  s.rework_count += 1;
  for (let j = from; j <= review; j++) s.steps[STEPS[j].key] = 'PENDING';
  s.current_step = from + 1; s.state = 'IN_PROGRESS'; s.gate = null; s.reason = null;
  save(s); console.log(`rework ${s.rework_count}/${MAX_REWORK}: ${nextAction(s)}`);
} else if (cmd === 'retry') {
  const s = need();
  if (!['BLOCKED', 'FAILED'].includes(s.state)) die(`nothing to retry (state ${s.state})`);
  for (const st of STEPS) if (['BLOCKED', 'FAILED'].includes(s.steps[st.key])) s.steps[st.key] = 'PENDING';
  s.state = 'IN_PROGRESS'; s.rework_count = 0; s.reason = null;
  save(s); console.log(nextAction(s));
} else if (cmd === 'check') {
  const out = check(STEPS[resolve(a1)].key); console.log(out); process.exit(out.startsWith('OK') ? 0 : 1);
} else if (cmd === 'verdict') {
  console.log(verdict(STEPS[resolve(a1)].key));
} else if (!cmd || cmd === 'show' || cmd === 'render') {
  console.log(render(load()));
} else {
  die(`unknown command "${cmd}"`);
}
