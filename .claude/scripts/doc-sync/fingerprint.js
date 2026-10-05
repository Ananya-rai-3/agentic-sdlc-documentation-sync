'use strict';
// Base resolution and the change fingerprint that ties a doc-sync report to the current non-doc diff.
const crypto = require('crypto');
const common = require('./common');

// Paths whose changes never alter the fingerprint: documentation and pipeline bookkeeping.
const FINGERPRINT_EXCLUDES = ['README.md', 'docs/', '.pipeline/', 'logs/'];

function commitExists(cwd, ref) {
  try {
    common.runGit(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

// Merge-base of HEAD with DOC_SYNC_BASE if set, else master, else origin/master. Throws when none resolves.
function resolveBase(cwd, env = process.env) {
  const override = env.DOC_SYNC_BASE;
  let candidates = ['master', 'origin/master'];
  if (override !== undefined && override !== '') {
    if (override.startsWith('-')) throw new Error(`DOC_SYNC_BASE is not a valid ref: ${override}`);
    candidates = [override];
  }
  for (const ref of candidates) {
    if (!commitExists(cwd, ref)) continue;
    try {
      return common.runGit(cwd, ['merge-base', ref, 'HEAD']).trim();
    } catch (error) {
      throw new Error(`cannot compute merge-base of ${ref} and HEAD: ${error.message}`);
    }
  }
  throw new Error(`cannot resolve a base branch (tried ${candidates.join(', ')}); set DOC_SYNC_BASE`);
}

// SHA-256 over sorted (status, path, blob-sha) of changed non-documentation files in base...HEAD.
function computeFingerprint(cwd, base) {
  const pathspecs = ['--', ':/', ...FINGERPRINT_EXCLUDES.map((entry) => `:(top,exclude)${entry}`)];
  const output = common.runGit(cwd, ['diff', '--raw', '--no-abbrev', '--no-renames', '-z', `${base}...HEAD`, ...pathspecs]);
  const tokens = common.splitNul(output);
  const entries = [];
  for (let index = 0; index < tokens.length; index += 2) {
    const fields = tokens[index].replace(/^:/, '').split(' ');
    const filePath = tokens[index + 1];
    if (fields.length !== 5 || filePath === undefined) throw new Error(`unexpected git diff --raw output: ${tokens[index]}`);
    entries.push({ status: fields[4], path: filePath, blob: fields[3] });
  }
  entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const hash = crypto.createHash('sha256');
  for (const entry of entries) hash.update(`${entry.status}\t${entry.path}\t${entry.blob}\n`);
  return hash.digest('hex');
}

module.exports = { resolveBase, computeFingerprint, FINGERPRINT_EXCLUDES };

if (require.main === module) {
  try {
    const cwd = common.projectRoot();
    const base = resolveBase(cwd);
    process.stdout.write(`${JSON.stringify({ base, fingerprint: computeFingerprint(cwd, base) })}\n`);
  } catch (error) {
    process.stderr.write(`doc-sync fingerprint: ${error.message}\n`);
    process.exitCode = 2;
  }
}
