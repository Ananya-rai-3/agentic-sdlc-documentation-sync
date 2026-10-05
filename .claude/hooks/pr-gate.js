// PreToolUse(Bash): `gh pr create` requires a passing verification report. Exit 2 = block.
const fs = require('fs');
const path = require('path');
const { readInput, block } = require('./lib');

const cmd = (readInput().tool_input || {}).command || '';
if (!/\bgh\s+pr\s+create\b/.test(cmd)) process.exit(0);

const report = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), 'docs', 'verification-report.md');
if (!fs.existsSync(report)) {
  block('Blocked: docs/verification-report.md not found. Run the `verify` agent (step 7) before creating the PR.');
}
const text = fs.readFileSync(report, 'utf8');
if (!/Ready for PR:?\**:?\s*\**\s*YES\b(?!\s*\/\s*NO)/i.test(text)) {
  block('Blocked: docs/verification-report.md does not show "Ready for PR: YES". Resolve verification failures first.');
}
process.exit(0);
