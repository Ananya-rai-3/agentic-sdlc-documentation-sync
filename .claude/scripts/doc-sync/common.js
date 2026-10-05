'use strict';
// Shared helpers for the doc-sync scripts and hooks: git runner, path normalisation, exclusion lists.
const { execFileSync } = require('child_process');

const IS_WINDOWS = process.platform === 'win32';
const REPORT_PATH = 'docs/doc-sync-report.md';
const PHASE_DOCUMENTS = [
  'requirements.md',
  'architecture.md',
  'design-review.md',
  'impl-plan.md',
  'code-review.md',
  'verification-report.md',
];
const EXCLUDED_DOCS = [...PHASE_DOCUMENTS.map((name) => `docs/${name}`), 'docs/pipeline-status.md'];

function runGit(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function toPosix(value) {
  return String(value).replace(/\\/g, '/');
}

// Form used for every path comparison: forward slashes, lower-cased on win32.
function comparable(value) {
  const posix = toPosix(value);
  return IS_WINDOWS ? posix.toLowerCase() : posix;
}

function splitNul(output) {
  return output.split('\0').filter((entry) => entry.length > 0);
}

function projectRoot(env = process.env) {
  return env.CLAUDE_PROJECT_DIR || process.cwd();
}

function isExcludedDoc(relativePath) {
  const target = comparable(relativePath);
  return EXCLUDED_DOCS.some((excluded) => comparable(excluded) === target);
}

// Documents that discovery may search and the agent may edit for claims.
function isSearchableDoc(relativePath) {
  const target = comparable(relativePath);
  if (target === comparable(REPORT_PATH)) return false;
  if (isExcludedDoc(relativePath)) return false;
  return target === comparable('README.md') || target.startsWith('docs/');
}

// Pipeline bookkeeping that the orchestrator commits alongside documentation.
function isPipelineBookkeeping(relativePath) {
  const target = comparable(relativePath);
  return (
    target.startsWith('.pipeline/') ||
    target.startsWith('logs/') ||
    target === 'docs/pipeline-status.md' ||
    target === comparable(REPORT_PATH)
  );
}

module.exports = {
  IS_WINDOWS,
  REPORT_PATH,
  PHASE_DOCUMENTS,
  EXCLUDED_DOCS,
  runGit,
  toPosix,
  comparable,
  splitNul,
  projectRoot,
  isExcludedDoc,
  isSearchableDoc,
  isPipelineBookkeeping,
};
