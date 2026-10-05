// PreToolUse(Write|Edit), scoped to the documentation-sync agent: only the doc-sync write allow-list may be
// modified (README.md, docs/** minus phase documents, the report, and files changed on this branch).
// Fails closed: unparsable input or any error exits 2. Does not use lib.readInput() (fails open).
const fs = require('fs');
const path = require('path');

function blockAndExit(message) {
  try {
    fs.writeSync(2, `${message}\n`);
  } catch {
    // stderr unavailable; the exit code is what blocks
  }
  process.exit(2);
}

process.on('uncaughtException', (error) => {
  blockAndExit(`Blocked: doc-sync write guard failed unexpectedly (${error && error.message}). Failing closed.`);
});

function readHookInput() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (error) {
    blockAndExit(`Blocked: doc-sync write guard could not parse its input (${error.message}). Failing closed.`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    blockAndExit('Blocked: doc-sync write guard received unexpected input. Failing closed.');
  }
  return parsed;
}

function main() {
  const input = readHookInput();
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const target = toolInput.file_path;
  if (typeof target !== 'string' || target.trim() === '') {
    blockAndExit('Blocked: doc-sync write guard found no file_path in the tool input. Failing closed.');
  }

  const scripts = path.join(__dirname, '..', 'scripts', 'doc-sync');
  const common = require(path.join(scripts, 'common.js'));
  const docSync = require(path.join(scripts, 'report.js'));
  const discover = require(path.join(scripts, 'discover.js'));
  const root = common.projectRoot();

  // If the changed-file list cannot be computed, only README.md and docs/** stay writable.
  let changedFiles = [];
  try {
    changedFiles = discover.changedPaths(root);
  } catch {
    changedFiles = [];
  }

  const verdict = docSync.checkPath(target, { root, changedFiles });
  if (!verdict.allowed) {
    blockAndExit(`Blocked: the documentation-sync agent may not write ${target} (${verdict.reason}). Allowed: README.md, docs/** (not phase documents or pipeline-status.md), docs/doc-sync-report.md, and files changed on this branch (comments only).`);
  }
  process.exit(0);
}

main();
