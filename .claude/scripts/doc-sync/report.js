'use strict';
// Report grammar (render/parse), write allow-list, and the gate logic for docs/doc-sync-report.md.
const fs = require('fs');
const path = require('path');
const common = require('./common');
const fingerprint = require('./fingerprint');

const TITLE = '# Documentation Sync Report';
const STATUSES = ['COMPLETE', 'NEEDS_HUMAN', 'FAILED'];
const FINDING_CLASSES = ['STALE', 'MISSING', 'AMBIGUOUS'];
const FINDING_STATUSES = ['OPEN', 'RESOLVED', 'ACKNOWLEDGED'];
const HEADER_KEYS = ['Status', 'Base', 'Sync-Base', 'Fingerprint', 'Reason'];
const REQUIRED_HEADINGS = ['Checked', 'Findings', 'Changes', 'Validation', 'Conclusion'];
const FINDINGS_COLUMNS = ['ID', 'Class', 'Location', 'Evidence', 'Status'];
const CHANGES_COLUMNS = ['Finding', 'File', 'Lines', 'Summary'];
const VALIDATION_COLUMNS = ['Finding', 'Check', 'Result'];
const NO_CHANGES_PHRASE = 'No documentation changes required';

class ReportFormatError extends Error {}

function formatError(message) {
  return new ReportFormatError(message);
}

// ---------------------------------------------------------------- rendering

function singleLine(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\r?\n|\r/g, ' ')
    .trim();
}

function escapeCell(value) {
  return singleLine(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

function renderTable(columns, rows) {
  const lines = [
    `| ${columns.join(' | ')} |`,
    `|${columns.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`),
  ];
  return lines.join('\n');
}

function renderReport(data) {
  const lines = [TITLE, ''];
  const headerValues = {
    Status: data.status,
    Base: data.base,
    'Sync-Base': data.syncBase,
    Fingerprint: data.fingerprint,
    Reason: data.reason,
  };
  for (const key of HEADER_KEYS) {
    const value = singleLine(headerValues[key]);
    if (key === 'Reason' && value === '') continue;
    lines.push(`${key}: ${value}`);
  }
  lines.push('', '## Checked');
  for (const item of data.checked || []) lines.push(`- ${singleLine(item)}`);
  lines.push('', '## Findings', renderTable(FINDINGS_COLUMNS, (data.findings || []).map((f) => [f.id, f.class, f.location, f.evidence, f.status])));
  lines.push('', '## Changes', renderTable(CHANGES_COLUMNS, (data.changes || []).map((c) => [c.finding, c.file, c.lines, c.summary])));
  lines.push('', '## Validation', renderTable(VALIDATION_COLUMNS, (data.validation || []).map((v) => [v.finding, v.check, v.result])));
  lines.push('', '## Conclusion', String(data.conclusion || '').replace(/\r\n?/g, '\n').trim(), '');
  const text = lines.join('\n');
  parseReport(text);
  return text;
}

// ----------------------------------------------------------------- parsing

function splitRow(line, expectedColumns, context) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|') || trimmed.length < 2) {
    throw formatError(`${context}: row is not a table row: ${line}`);
  }
  const cells = [];
  let current = '';
  let index = 1;
  while (index < trimmed.length) {
    const character = trimmed[index];
    const next = trimmed[index + 1];
    if (character === '\\' && (next === '\\' || next === '|')) {
      current += next;
      index += 2;
      continue;
    }
    if (character === '|') {
      cells.push(current.trim());
      current = '';
      index += 1;
      continue;
    }
    current += character;
    index += 1;
  }
  if (current.trim() !== '') throw formatError(`${context}: row does not end with a pipe: ${line}`);
  if (cells.length !== expectedColumns) {
    throw formatError(`${context}: expected ${expectedColumns} columns, found ${cells.length}: ${line}`);
  }
  return cells;
}

function parseTable(lines, columns, context) {
  const rows = lines.filter((line) => line.trim() !== '');
  if (rows.length < 2) throw formatError(`${context}: table header or separator missing`);
  const header = splitRow(rows[0], columns.length, `${context} header`);
  if (header.join('|') !== columns.join('|')) {
    throw formatError(`${context}: header must be | ${columns.join(' | ')} |`);
  }
  const separator = rows[1].trim();
  const separatorCells = separator.replace(/^\|/, '').replace(/\|$/, '').split('|');
  if (separatorCells.length !== columns.length || !separatorCells.every((cell) => /^\s*:?-+:?\s*$/.test(cell))) {
    throw formatError(`${context}: separator row is malformed`);
  }
  return rows.slice(2).map((line) => splitRow(line, columns.length, context));
}

function parseHeader(lines) {
  const header = {};
  for (const line of lines) {
    if (line.trim() === '') continue;
    const match = /^([A-Za-z-]+):[ \t]*(.*)$/.exec(line);
    if (!match || !HEADER_KEYS.includes(match[1])) throw formatError(`header: unexpected line: ${line}`);
    if (Object.prototype.hasOwnProperty.call(header, match[1])) throw formatError(`header: duplicate ${match[1]}`);
    header[match[1]] = match[2].trim();
  }
  return header;
}

function parseReport(text) {
  if (typeof text !== 'string') throw formatError('report text is not a string');
  const lines = text.split(/\r?\n/);
  let cursor = 0;
  while (cursor < lines.length && lines[cursor].trim() === '') cursor += 1;
  if (lines[cursor] === undefined || lines[cursor].trim() !== TITLE) throw formatError(`first line must be "${TITLE}"`);
  cursor += 1;

  const headerLines = [];
  while (cursor < lines.length && !lines[cursor].startsWith('## ')) headerLines.push(lines[cursor++]);
  const header = parseHeader(headerLines);

  const sections = new Map();
  let currentName = null;
  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (line.startsWith('## ')) {
      currentName = line.slice(3).trim();
      if (!REQUIRED_HEADINGS.includes(currentName)) throw formatError(`unknown heading: ${line}`);
      if (sections.has(currentName)) throw formatError(`duplicate heading: ${line}`);
      sections.set(currentName, []);
    } else {
      sections.get(currentName).push(line);
    }
  }
  const orderedNames = [...sections.keys()];
  if (orderedNames.join('|') !== REQUIRED_HEADINGS.join('|')) {
    throw formatError(`headings must be, in order: ${REQUIRED_HEADINGS.join(', ')}`);
  }

  if (!STATUSES.includes(header.Status)) throw formatError(`Status must be one of ${STATUSES.join(', ')}`);
  for (const key of ['Base', 'Sync-Base', 'Fingerprint']) {
    if (header[key] === undefined) throw formatError(`header: ${key} is missing`);
  }
  if (header.Status !== 'COMPLETE' && !header.Reason) throw formatError('header: Reason is required unless Status is COMPLETE');

  const checked = sections.get('Checked').filter((line) => line.trim() !== '').map((line) => {
    const match = /^\s*[-*]\s+(.+)$/.exec(line);
    if (!match) throw formatError(`Checked: expected a bullet item: ${line}`);
    return match[1].trim();
  });

  const findings = parseTable(sections.get('Findings'), FINDINGS_COLUMNS, 'Findings').map(([id, findingClass, location, evidence, status]) => {
    if (!/^F-\d{2,}$/.test(id)) throw formatError(`Findings: bad id ${id}`);
    if (!FINDING_CLASSES.includes(findingClass)) throw formatError(`Findings: bad class ${findingClass} for ${id}`);
    if (!FINDING_STATUSES.includes(status)) throw formatError(`Findings: bad status ${status} for ${id}`);
    return { id, class: findingClass, location, evidence, status };
  });
  const identifiers = findings.map((finding) => finding.id);
  if (new Set(identifiers).size !== identifiers.length) throw formatError('Findings: duplicate finding id');

  const changes = parseTable(sections.get('Changes'), CHANGES_COLUMNS, 'Changes').map(([finding, file, lines_, summary]) => ({ finding, file, lines: lines_, summary }));
  const validation = parseTable(sections.get('Validation'), VALIDATION_COLUMNS, 'Validation').map(([finding, check, result]) => ({ finding, check, result }));
  const conclusion = sections.get('Conclusion').join('\n').trim();

  return {
    status: header.Status,
    base: header.Base,
    syncBase: header['Sync-Base'],
    fingerprint: header.Fingerprint,
    reason: header.Reason || '',
    checked,
    findings,
    changes,
    validation,
    conclusion,
  };
}

// -------------------------------------------------------------- path guard

const DENIED_TOP_LEVEL = ['.claude', '.pipeline', 'logs'];

// Resolves symlinks for the deepest existing ancestor and appends the not-yet-existing remainder.
function realpathLenient(target) {
  let current = target;
  const remainder = [];
  for (;;) {
    try {
      const real = fs.realpathSync.native(current);
      return remainder.length > 0 ? path.join(real, ...remainder.reverse()) : real;
    } catch (error) {
      let isSymlink = false;
      try {
        isSymlink = fs.lstatSync(current).isSymbolicLink();
      } catch {
        isSymlink = false;
      }
      if (isSymlink) throw new Error('dangling symlink');
      const parent = path.dirname(current);
      if (parent === current) throw error;
      remainder.push(path.basename(current));
      current = parent;
    }
  }
}

// ctx: { root, changedFiles }. Returns { allowed, reason, path } where path is repo-relative with forward slashes.
function checkPath(inputPath, ctx = {}) {
  const deny = (reason) => ({ allowed: false, reason, path: null });
  if (typeof inputPath !== 'string' || inputPath.trim() === '' || inputPath.includes('\0')) return deny('INVALID_PATH');
  const posixInput = common.toPosix(inputPath);
  if (posixInput.split('/').includes('..')) return deny('TRAVERSAL');

  let relative;
  try {
    const rootReal = fs.realpathSync.native(ctx.root || common.projectRoot());
    const real = realpathLenient(path.resolve(rootReal, posixInput));
    relative = path.relative(rootReal, real);
  } catch (error) {
    return deny(`UNRESOLVABLE: ${error.message}`);
  }
  if (relative === '' || path.isAbsolute(relative) || relative.split(/[\\/]/)[0] === '..') return deny('OUTSIDE_REPOSITORY');

  const relativePosix = common.toPosix(relative);
  const comparablePath = common.comparable(relativePosix);
  const segments = comparablePath.split('/');
  if (common.IS_WINDOWS && (comparablePath.includes(':') || segments.some((segment) => /[. ]$/.test(segment)))) {
    return deny('UNSAFE_WINDOWS_PATH');
  }
  if (DENIED_TOP_LEVEL.includes(segments[0]) || segments.includes('.git') || segments[segments.length - 1].startsWith('.env')) {
    return deny('DENIED_LOCATION');
  }
  if (common.isExcludedDoc(relativePosix)) return deny('EXCLUDED_DOCUMENT');

  const changed = new Set((ctx.changedFiles || []).map(common.comparable));
  const allowed =
    comparablePath === common.comparable('README.md') ||
    comparablePath === common.comparable('CHANGELOG.md') ||
    comparablePath === common.comparable(common.REPORT_PATH) ||
    comparablePath.startsWith('docs/') ||
    changed.has(comparablePath);
  return allowed ? { allowed: true, reason: '', path: relativePosix } : deny('NOT_ALLOW_LISTED');
}

// --------------------------------------------------------------- gate logic

function reasonOf(code, message) {
  return { code, message };
}

function formatReasons(reasons) {
  return reasons.map((entry) => `${entry.code}: ${entry.message}`);
}

function findingReasons(report) {
  const reasons = [];
  const changedFindings = new Set(report.changes.map((change) => change.finding));
  const knownFindings = new Set(report.findings.map((finding) => finding.id));
  for (const finding of report.findings) {
    if (finding.class === 'AMBIGUOUS') {
      if (finding.status !== 'ACKNOWLEDGED') {
        reasons.push(reasonOf('AMBIGUOUS_NOT_ACKNOWLEDGED', `${finding.id} is AMBIGUOUS and has status ${finding.status}; a human must acknowledge it`));
      }
    } else if (finding.status !== 'RESOLVED') {
      reasons.push(reasonOf('FINDING_UNRESOLVED', `${finding.id} (${finding.class}) is ${finding.status}, not RESOLVED`));
    } else if (!changedFindings.has(finding.id)) {
      reasons.push(reasonOf('CHANGE_ROW_MISSING', `${finding.id} is RESOLVED but has no row in Changes`));
    }
  }
  for (const change of report.changes) {
    if (!knownFindings.has(change.finding)) {
      reasons.push(reasonOf('CHANGE_UNKNOWN_FINDING', `Changes row references unknown finding ${change.finding}`));
    }
  }
  return reasons;
}

function coreReasons(report, cwd, env) {
  const reasons = [];
  if (report.status !== 'COMPLETE') {
    reasons.push(reasonOf('STATUS_NOT_COMPLETE', `Status is ${report.status}${report.reason ? ` (${report.reason})` : ''}`));
  }
  let base = null;
  try {
    base = fingerprint.resolveBase(cwd, env);
    const fresh = fingerprint.computeFingerprint(cwd, base);
    if (fresh !== report.fingerprint) {
      reasons.push(reasonOf('FINGERPRINT_STALE', 'the code changed after the report was written; re-run documentation-sync'));
    }
  } catch (error) {
    base = null;
    reasons.push(reasonOf('BASE_OR_FINGERPRINT_FAILED', error.message));
  }
  if (report.checked.length === 0) reasons.push(reasonOf('CHECKED_EMPTY', 'the Checked section lists nothing'));
  reasons.push(...findingReasons(report));
  if (report.findings.length === 0 && !report.conclusion.includes(NO_CHANGES_PHRASE)) {
    reasons.push(reasonOf('NO_CHANGES_STATEMENT_MISSING', `no findings but Conclusion lacks "${NO_CHANGES_PHRASE}"`));
  }
  return { reasons, base };
}

// ------------------------------------------------- post-sync integrity checks

const COMMENT_LINE = /^(?:\/\/|\/\*|\*|#)/;

function listGitPaths(cwd, args) {
  return common.splitNul(common.runGit(cwd, args));
}

function isDocumentationPath(relativePath) {
  const target = common.comparable(relativePath);
  return target === common.comparable('README.md') || target.startsWith('docs/');
}

// True when every added or removed line of the file between syncBase and HEAD is blank or a comment.
function changesOnlyComments(cwd, syncBase, filePath) {
  const diff = common.runGit(cwd, ['diff', '-U0', '--no-renames', `${syncBase}..HEAD`, '--', filePath]);
  if (/^Binary files |^GIT binary patch/m.test(diff)) return false;
  return diff
    .split(/\r?\n/)
    .filter((line) => (line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---'))
    .map((line) => line.slice(1).trim())
    .every((content) => content === '' || COMMENT_LINE.test(content));
}

function passingTestRerun(report) {
  return report.validation.some((row) => /test/i.test(row.check) && /^PASS/i.test(row.result));
}

function worktreeReasons(cwd) {
  const reasons = [];
  const dirty = [];
  for (const entry of listGitPaths(cwd, ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all'])) {
    const state = entry.slice(0, 2);
    const filePath = entry.slice(3);
    if (common.comparable(filePath) === common.comparable(common.REPORT_PATH)) {
      reasons.push(reasonOf('REPORT_UNCOMMITTED', `${common.REPORT_PATH} has uncommitted changes; commit the documentation sync first`));
    } else if (common.isPipelineBookkeeping(filePath)) {
      continue;
    } else if (state === '??' && !common.comparable(filePath).startsWith('docs/')) {
      continue;
    } else {
      dirty.push(filePath);
    }
  }
  if (dirty.length > 0) {
    reasons.push(reasonOf('DIRTY_TREE', `uncommitted changes outside pipeline bookkeeping: ${dirty.slice(0, 5).join(', ')}${dirty.length > 5 ? ', ...' : ''}`));
  }
  return reasons;
}

function syncRangeReasons(report, cwd, base) {
  const syncBase = report.syncBase;
  if (!/^[0-9a-f]{7,64}$/i.test(syncBase)) return [reasonOf('SYNC_BASE_INVALID', `Sync-Base "${syncBase}" is not a commit id`)];
  try {
    common.runGit(cwd, ['merge-base', '--is-ancestor', syncBase, 'HEAD']);
  } catch {
    return [reasonOf('SYNC_BASE_NOT_ANCESTOR', `Sync-Base ${syncBase} is not an ancestor of HEAD`)];
  }
  try {
    common.runGit(cwd, ['merge-base', '--is-ancestor', base, syncBase]);
  } catch {
    return [reasonOf('SYNC_BASE_BEFORE_BASE', `Sync-Base ${syncBase} is not on the branch after the base`)];
  }

  const reasons = [];
  const changedBeforeSync = listGitPaths(cwd, ['diff', '--name-only', '--no-renames', '-z', `${base}...${syncBase}`]);
  const syncFiles = listGitPaths(cwd, ['diff', '--name-only', '--no-renames', '-z', `${syncBase}..HEAD`]).filter((file) => !common.isPipelineBookkeeping(file));
  const listedFiles = new Set(report.changes.map((change) => common.comparable(change.file)));
  let editedNonDocument = false;
  for (const file of syncFiles) {
    const verdict = checkPath(file, { root: cwd, changedFiles: changedBeforeSync });
    if (!verdict.allowed) {
      reasons.push(reasonOf('PATH_NOT_ALLOWED', `${file} was changed after Sync-Base but is not writable by the sync (${verdict.reason})`));
      continue;
    }
    if (!listedFiles.has(common.comparable(file))) {
      reasons.push(reasonOf('CHANGE_NOT_LISTED', `${file} was changed after Sync-Base but is not in the Changes table`));
    }
    if (!isDocumentationPath(file)) {
      editedNonDocument = true;
      if (!changesOnlyComments(cwd, syncBase, file)) {
        reasons.push(reasonOf('NON_COMMENT_CODE_CHANGE', `${file} has changes other than comments after Sync-Base`));
      }
    }
  }
  if (editedNonDocument && !passingTestRerun(report)) {
    reasons.push(reasonOf('TEST_RERUN_MISSING', 'source comments were edited but Validation has no passing test re-run'));
  }
  return reasons;
}

function integrityReasons(report, cwd, base) {
  try {
    return [...syncRangeReasons(report, cwd, base), ...worktreeReasons(cwd)];
  } catch (error) {
    return [reasonOf('INTEGRITY_CHECK_FAILED', error.message)];
  }
}

// ctx: { cwd, env }. Returns { ok, reasons: [{ code, message }] }; the report's own Base is never trusted.
function checkReport(text, ctx = {}) {
  const cwd = ctx.cwd || common.projectRoot();
  const env = ctx.env || process.env;
  let report;
  try {
    report = parseReport(text);
  } catch (error) {
    return { ok: false, reasons: [reasonOf('REPORT_UNPARSABLE', error.message)] };
  }
  const { reasons, base } = coreReasons(report, cwd, env);
  if (base) reasons.push(...integrityReasons(report, cwd, base));
  return { ok: reasons.length === 0, reasons };
}

function checkReportFile(cwd, env) {
  const reportFile = path.join(cwd, ...common.REPORT_PATH.split('/'));
  let text;
  try {
    text = fs.readFileSync(reportFile, 'utf8');
  } catch {
    return { ok: false, reasons: [reasonOf('REPORT_MISSING', `${common.REPORT_PATH} not found or unreadable`)] };
  }
  return checkReport(text, { cwd, env });
}

module.exports = {
  checkReport,
  checkReportFile,
  formatReasons,
  checkPath,
  REQUIRED_HEADINGS,
  STATUSES,
  FINDING_CLASSES,
  FINDING_STATUSES,
  FINDINGS_COLUMNS,
  CHANGES_COLUMNS,
  VALIDATION_COLUMNS,
  NO_CHANGES_PHRASE,
  ReportFormatError,
  renderReport,
  parseReport,
};

// ---------------------------------------------------------------------- CLI

function runCli(argv) {
  const [command, ...rest] = argv;
  if (command === 'check') {
    const result = checkReportFile(common.projectRoot(), process.env);
    if (result.ok) {
      process.stdout.write('doc-sync report: OK\n');
      return 0;
    }
    process.stderr.write(`doc-sync report check failed:\n  ${formatReasons(result.reasons).join('\n  ')}\n`);
    return 1;
  }
  if (command === 'check-paths') {
    if (rest.length === 0) {
      process.stderr.write('usage: report.js check-paths <path>...\n');
      return 2;
    }
    const root = common.projectRoot();
    let changedFiles = [];
    try {
      changedFiles = require('./discover').changedPaths(root);
    } catch {
      changedFiles = [];
    }
    const results = rest.map((target) => ({ input: target, ...checkPath(target, { root, changedFiles }) }));
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return results.every((result) => result.allowed) ? 0 : 1;
  }
  process.stderr.write('usage: report.js <check|check-paths> ...\n');
  return 2;
}

if (require.main === module) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`doc-sync report: ${error.message}\n`);
    process.exitCode = 2;
  }
}
