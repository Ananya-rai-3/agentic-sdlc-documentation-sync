// PreToolUse(Bash|mcp__github__create_pull_request): blocks PR creation unless docs/doc-sync-report.md is
// COMPLETE, current for the code diff, and the sync left the tree clean. Exit 2 = block.
// Fails closed: only exit code 2 blocks in Claude Code, so every error path below exits 2.
// Deliberately does not use lib.readInput(), which turns unparsable stdin into {} (fail open).
const fs = require('fs');
const path = require('path');

const GH_PR_CREATE = /\bgh\b[^;&|]*\bpr\s+create\b/;
const GH_API = /\bgh\s+api\b/;
const GH_API_PULLS = /\/pulls(?![\w/-])/;
const GH_API_WRITES = /(?:-X\s*POST|--method[=\s]+POST|\s-f\s|\s-F\s|--field\b|--raw-field\b|--input\b)/i;
const MCP_CREATE_PULL_REQUEST = 'mcp__github__create_pull_request';

function blockAndExit(message) {
  try {
    fs.writeSync(2, `${message}\n`);
  } catch {
    // stderr unavailable; the exit code is what blocks
  }
  process.exit(2);
}

process.on('uncaughtException', (error) => {
  blockAndExit(`Blocked: doc-sync completeness hook failed unexpectedly (${error && error.message}). Failing closed.`);
});

function readHookInput() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (error) {
    blockAndExit(`Blocked: doc-sync completeness hook could not parse its input (${error.message}). Failing closed.`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    blockAndExit('Blocked: doc-sync completeness hook received unexpected input. Failing closed.');
  }
  return parsed;
}

function extractHead(command, isApiCall) {
  if (!isApiCall) {
    const flagged = /(?:--head|\s-H)(?:=|\s+)["']?([^\s"']+)/.exec(command);
    return flagged ? flagged[1] : null;
  }
  const field = /(?:-f|-F|--field|--raw-field)\s+["']?head=([^\s"']+)/.exec(command);
  return field ? field[1] : null;
}

// Returns null when the call is not a PR creation, else { head, commandPrefix }.
function detectPullRequestCreation(input) {
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  if (input.tool_name === MCP_CREATE_PULL_REQUEST) {
    return { head: typeof toolInput.head === 'string' ? toolInput.head : null, commandPrefix: '' };
  }
  const command = typeof toolInput.command === 'string' ? toolInput.command : '';
  const ghCreate = GH_PR_CREATE.exec(command);
  if (ghCreate) return { head: extractHead(command, false), commandPrefix: command.slice(0, ghCreate.index) };
  if (GH_API.test(command) && GH_API_PULLS.test(command) && GH_API_WRITES.test(command)) {
    return { head: extractHead(command, true), commandPrefix: command.slice(0, command.search(GH_API)) };
  }
  return null;
}

function main() {
  const input = readHookInput();
  const request = detectPullRequestCreation(input);
  if (!request) process.exit(0);

  const scripts = path.join(__dirname, '..', 'scripts', 'doc-sync');
  const common = require(path.join(scripts, 'common.js'));
  const docSync = require(path.join(scripts, 'report.js'));
  const root = common.projectRoot();
  const problems = [];

  if (/(?:^|[\s;&|(])(?:cd|pushd|Set-Location)\s|\s-C\s/.test(request.commandPrefix)) {
    problems.push('PR creation must run from the repository root; change-directory or -C before the PR command is not allowed');
  }
  if (request.head) {
    const headBranch = request.head.includes(':') ? request.head.split(':').pop() : request.head;
    let currentBranch = '';
    try {
      currentBranch = common.runGit(root, ['symbolic-ref', '--short', '-q', 'HEAD']).trim();
    } catch {
      currentBranch = '';
    }
    if (headBranch !== currentBranch) {
      problems.push(`HEAD_BRANCH_MISMATCH: PR head "${request.head}" is not the checked-out branch "${currentBranch || 'detached HEAD'}"; the doc-sync report covers only the current branch`);
    }
  }

  const result = docSync.checkReportFile(root, process.env);
  if (!result.ok) problems.push(...docSync.formatReasons(result.reasons));

  if (problems.length > 0) {
    blockAndExit(`Blocked: documentation sync is not complete for this change.\n  - ${problems.join('\n  - ')}\nRun the documentation-sync agent (stage 7b) and commit its output before creating the PR.`);
  }
  process.exit(0);
}

main();
