'use strict';
// Diff-scoped discovery: changed files, changed public JS symbols / config keys, size limits.
const fs = require('fs');
const path = require('path');
const common = require('./common');
const { resolveBase } = require('./fingerprint');

const DEFAULT_MAX_FILES = 20;
const DEFAULT_MAX_ITEMS = 15;
const SOURCE_EXTENSIONS = /\.(?:js|cjs|mjs)$/i;
const MAX_JSON_BYTES = 200 * 1024;
// Tooling, tests and bookkeeping are not product code whose public surface needs documenting.
const NON_PRODUCT_PREFIXES = ['tests/', '.claude/', '.pipeline/', 'logs/', 'node_modules/'];

// ------------------------------------------------------------- changed files

function listChanged(cwd, env = process.env) {
  const base = resolveBase(cwd, env);
  const tokens = common.splitNul(common.runGit(cwd, ['diff', '--name-status', '--no-renames', '-z', `${base}...HEAD`]));
  const entries = [];
  for (let index = 0; index < tokens.length; index += 2) {
    if (tokens[index + 1] === undefined) throw new Error('unexpected git diff --name-status output');
    entries.push({ status: tokens[index][0], path: tokens[index + 1] });
  }
  return { base, entries };
}

function changedPaths(cwd, env = process.env) {
  return listChanged(cwd, env).entries.map((entry) => entry.path);
}

function readAt(cwd, revision, filePath) {
  try {
    return common.runGit(cwd, ['show', `${revision}:${filePath}`]);
  } catch {
    return null;
  }
}

// -------------------------------------------------------------- size limits

function parseLimit(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^[1-9]\d*$/.test(String(raw).trim())) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return Number(String(raw).trim());
}

function readLimits(env = process.env) {
  return {
    maxFiles: parseLimit(env, 'DOC_SYNC_MAX_FILES', DEFAULT_MAX_FILES),
    maxItems: parseLimit(env, 'DOC_SYNC_MAX_ITEMS', DEFAULT_MAX_ITEMS),
  };
}

// counts: { files, items }. Returns the limits used so callers can log them.
function checkThresholds(counts, env = process.env) {
  const limits = readLimits(env);
  const reasons = [];
  if (counts.files !== undefined && counts.files > limits.maxFiles) {
    reasons.push(`${counts.files} changed files exceeds DOC_SYNC_MAX_FILES=${limits.maxFiles}`);
  }
  if (counts.items !== undefined && counts.items > limits.maxItems) {
    reasons.push(`${counts.items} items exceeds DOC_SYNC_MAX_ITEMS=${limits.maxItems}`);
  }
  return { exceeded: reasons.length > 0, reasons, ...limits };
}

// ------------------------------------------------------------ source scanning

// Walks the source once, producing a copy where comments and string contents are blanked
// (same length, newlines kept) plus the comment segments.
function scanSource(source) {
  let masked = '';
  const comments = [];
  let index = 0;
  const length = source.length;
  const blank = (text) => text.replace(/[^\n]/g, ' ');
  while (index < length) {
    const character = source[index];
    const next = source[index + 1];
    if (character === '/' && next === '/') {
      let end = index;
      while (end < length && source[end] !== '\n') end += 1;
      comments.push({ start: index, end });
      masked += blank(source.slice(index, end));
      index = end;
    } else if (character === '/' && next === '*') {
      let end = source.indexOf('*/', index + 2);
      end = end === -1 ? length : end + 2;
      comments.push({ start: index, end });
      masked += blank(source.slice(index, end));
      index = end;
    } else if (character === '"' || character === "'" || character === '`') {
      let end = index + 1;
      while (end < length && source[end] !== character) {
        if (source[end] === '\\') end += 1;
        else if (source[end] === '\n' && character !== '`') break;
        end += 1;
      }
      end = Math.min(end, length);
      const closed = end < length && source[end] === character;
      masked += character + blank(source.slice(index + 1, end)) + (closed ? character : '');
      index = closed ? end + 1 : end;
    } else {
      masked += character;
      index += 1;
    }
  }
  return { masked, comments };
}

function matchBalanced(masked, openIndex) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const stack = [];
  for (let index = openIndex; index < masked.length; index += 1) {
    const character = masked[index];
    if (pairs[character]) stack.push(pairs[character]);
    else if (character === ')' || character === '}' || character === ']') {
      if (stack.pop() !== character) return -1;
      if (stack.length === 0) return index;
    }
  }
  return -1;
}

function normalizeSignature(text) {
  return text.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parameterSignature(source, masked, openIndex) {
  const close = matchBalanced(masked, openIndex);
  return close === -1 ? null : normalizeSignature(source.slice(openIndex, close + 1));
}

function describeClass(source, masked, classIndex) {
  const bodyStart = masked.indexOf('{', classIndex);
  if (bodyStart === -1) return { kind: 'class', signature: 'class' };
  const heritage = normalizeSignature(masked.slice(classIndex, bodyStart)).replace(/^class\s*[\w$]*\s*/, '');
  const bodyEnd = matchBalanced(masked, bodyStart);
  const body = masked.slice(bodyStart, bodyEnd === -1 ? masked.length : bodyEnd);
  const constructorMatch = /\bconstructor\s*\(/.exec(body);
  let constructorSignature = '()';
  if (constructorMatch) {
    constructorSignature = parameterSignature(source, masked, bodyStart + constructorMatch.index + constructorMatch[0].length - 1) || '()';
  }
  return { kind: 'class', signature: normalizeSignature(`class ${heritage}${constructorSignature}`) };
}

// Describes the expression starting at `start` (a function, arrow, class or identifier).
function describeAt(source, masked, start) {
  const window = masked.slice(start, start + 4000);
  let match = /^(?:async\s+)?function\s*\*?\s*[\w$]*\s*\(/.exec(window);
  if (match) {
    const signature = parameterSignature(source, masked, start + match[0].length - 1);
    if (signature) return { kind: 'function', signature };
  }
  match = /^(?:async\s*)?\(/.exec(window);
  if (match) {
    const open = start + match[0].length - 1;
    const close = matchBalanced(masked, open);
    if (close !== -1 && /^\s*=>/.test(masked.slice(close + 1, close + 12))) {
      return { kind: 'function', signature: normalizeSignature(source.slice(open, close + 1)) };
    }
  }
  match = /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/.exec(window);
  if (match) return { kind: 'function', signature: `(${match[1]})` };
  if (/^class\b/.test(window)) return describeClass(source, masked, start);
  match = /^([A-Za-z_$][\w$]*)\s*(?:[;,}\n]|$)/.exec(window);
  if (match) return findDefinition(source, masked, match[1]) || { kind: 'value', signature: '' };
  return { kind: 'value', signature: '' };
}

function findDefinition(source, masked, name) {
  const escaped = escapeRegExp(name);
  let match = new RegExp(`(?:^|[^\\w$.])(?:async\\s+)?function\\s*\\*?\\s*${escaped}\\s*\\(`).exec(masked);
  if (match) {
    const signature = parameterSignature(source, masked, match.index + match[0].length - 1);
    if (signature) return { kind: 'function', signature };
  }
  match = new RegExp(`(?:^|[^\\w$.])(?:const|let|var)\\s+${escaped}\\s*=\\s*`).exec(masked);
  if (match) {
    const described = describeAt(source, masked, match.index + match[0].length);
    if (described.kind !== 'value' || described.signature) return described;
  }
  match = new RegExp(`(?:^|[^\\w$.])class\\s+${escaped}\\b`).exec(masked);
  if (match) return describeClass(source, masked, match.index + match[0].indexOf('class'));
  return null;
}

function splitTopLevel(masked, start, end) {
  const parts = [];
  let depth = 0;
  let partStart = start;
  for (let index = start; index < end; index += 1) {
    const character = masked[index];
    if ('({['.includes(character)) depth += 1;
    else if (')}]'.includes(character)) depth -= 1;
    else if (character === ',' && depth === 0) {
      parts.push([partStart, index]);
      partStart = index + 1;
    }
  }
  parts.push([partStart, end]);
  return parts;
}

function collectObjectExports(source, masked, openIndex, symbols) {
  const close = matchBalanced(masked, openIndex);
  if (close === -1) return;
  for (const [from, to] of splitTopLevel(masked, openIndex + 1, close)) {
    const segment = masked.slice(from, to);
    const start = from + (segment.length - segment.trimStart().length);
    const text = segment.trim();
    if (text === '' || text.startsWith('...')) continue;
    let match = /^([A-Za-z_$][\w$]*)\s*:\s*/.exec(text);
    if (match) {
      symbols.set(match[1], describeAt(source, masked, start + match[0].length));
      continue;
    }
    match = /^(?:async\s+)?\*?\s*([A-Za-z_$][\w$]*)\s*\(/.exec(text);
    if (match) {
      const signature = parameterSignature(source, masked, start + match[0].length - 1);
      symbols.set(match[1], { kind: 'function', signature: signature || '()' });
      continue;
    }
    match = /^([A-Za-z_$][\w$]*)$/.exec(text);
    if (match) symbols.set(match[1], findDefinition(source, masked, match[1]) || { kind: 'value', signature: '' });
  }
}

function extractJavaScriptSymbols(source) {
  const { masked } = scanSource(source);
  const symbols = new Map();

  for (const match of masked.matchAll(/(?:^|[^\w$.])module\.exports\s*=\s*(?=\{)/g)) {
    collectObjectExports(source, masked, match.index + match[0].length, symbols);
  }
  for (const match of masked.matchAll(/(?:^|[^\w$.])module\.exports\s*=\s*(?![\s{])/g)) {
    symbols.set('module.exports', describeAt(source, masked, match.index + match[0].length));
  }
  for (const match of masked.matchAll(/(?:^|[^\w$.])(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=\s*/g)) {
    symbols.set(match[1], describeAt(source, masked, match.index + match[0].length));
  }
  for (const match of masked.matchAll(/(?:^|[^\w$.])export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
    symbols.set(match[1], { kind: 'function', signature: parameterSignature(source, masked, match.index + match[0].length - 1) || '()' });
  }
  for (const match of masked.matchAll(/(?:^|[^\w$.])export\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/g)) {
    symbols.set(match[1], describeClass(source, masked, match.index + match[0].indexOf('class')));
  }
  for (const match of masked.matchAll(/(?:^|[^\w$.])export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g)) {
    symbols.set(match[1], describeAt(source, masked, match.index + match[0].length));
  }
  for (const match of masked.matchAll(/(?:^|[^\w$.])export\s*\{([^}]*)\}/g)) {
    for (const specifier of match[1].split(',')) {
      const parts = specifier.trim().split(/\s+as\s+/);
      if (!/^[A-Za-z_$][\w$]*$/.test(parts[0] || '')) continue;
      symbols.set(parts[1] || parts[0], findDefinition(source, masked, parts[0]) || { kind: 'value', signature: '' });
    }
  }
  for (const match of masked.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) {
    if (!symbols.has(match[1])) symbols.set(match[1], { kind: 'config', signature: '' });
  }
  return symbols;
}

function flattenJson(value, prefix, symbols) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flattenJson(child, prefix ? `${prefix}.${key}` : key, symbols);
    return;
  }
  if (prefix) symbols.set(prefix, { kind: 'config', signature: JSON.stringify(value).slice(0, 120) });
}

function extractSymbolsFromContent(filePath, content) {
  if (content === null) return new Map();
  if (SOURCE_EXTENSIONS.test(filePath)) return extractJavaScriptSymbols(content);
  if (/\.json$/i.test(filePath) && content.length <= MAX_JSON_BYTES && !/package-lock\.json$/i.test(filePath)) {
    const symbols = new Map();
    try {
      flattenJson(JSON.parse(content), '', symbols);
    } catch {
      return new Map();
    }
    return symbols;
  }
  return new Map();
}

function isProductSource(filePath) {
  const target = common.comparable(filePath);
  if (NON_PRODUCT_PREFIXES.some((prefix) => target.startsWith(prefix))) return false;
  return SOURCE_EXTENSIONS.test(target) || /\.json$/i.test(target);
}

// Compares the symbols of every changed product file between the base and HEAD.
function changedSymbols(cwd, env = process.env) {
  const { base, entries } = listChanged(cwd, env);
  const result = { added: [], removed: [], changed: [] };
  for (const entry of entries) {
    if (!isProductSource(entry.path)) continue;
    const before = entry.status === 'A' ? new Map() : extractSymbolsFromContent(entry.path, readAt(cwd, base, entry.path));
    const after = entry.status === 'D' ? new Map() : extractSymbolsFromContent(entry.path, readAt(cwd, 'HEAD', entry.path));
    for (const [name, symbol] of after) {
      const previous = before.get(name);
      if (!previous) result.added.push({ file: entry.path, name, ...symbol });
      else if (previous.kind !== symbol.kind || previous.signature !== symbol.signature) {
        result.changed.push({ file: entry.path, name, kind: symbol.kind, signature: symbol.signature, previousSignature: previous.signature });
      }
    }
    for (const [name, symbol] of before) {
      if (!after.has(name)) result.removed.push({ file: entry.path, name, ...symbol });
    }
  }
  return result;
}

// --------------------------------------------------------- reference search

const SEARCHABLE_TEXT = /\.(?:md|markdown|txt|rst)$/i;
const MAX_DOC_BYTES = 1024 * 1024;

function listSearchableDocs(root) {
  const found = [];
  const visit = (relativeDir) => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(relativePath);
      else if (entry.isFile() && SEARCHABLE_TEXT.test(entry.name) && common.isSearchableDoc(relativePath)) found.push(relativePath);
    }
  };
  visit('docs');
  if (fs.existsSync(path.join(root, 'README.md'))) found.push('README.md');
  return found.sort();
}

function readTextFile(root, relativePath) {
  const target = path.join(root, ...relativePath.split('/'));
  if (fs.statSync(target).size > MAX_DOC_BYTES) return null;
  return fs.readFileSync(target, 'utf8');
}

function termPattern(term) {
  return new RegExp(`(?<![\\w$])${escapeRegExp(term)}(?![\\w$])`);
}

function buildTerms(symbols, entries) {
  const terms = [];
  const seen = new Set();
  const add = (text, kind) => {
    const key = `${kind}:${text}`;
    if (text && !seen.has(key)) {
      seen.add(key);
      terms.push({ text, kind, pattern: termPattern(text) });
    }
  };
  for (const list of [symbols.added, symbols.removed, symbols.changed]) {
    for (const symbol of list) if (!symbol.name.includes('module.exports')) add(symbol.name, 'symbol');
  }
  for (const entry of entries) {
    if (common.isSearchableDoc(entry.path) || common.isPipelineBookkeeping(entry.path)) continue;
    add(entry.path, 'file');
    const baseName = path.posix.basename(entry.path);
    if (baseName.length > 3) add(baseName, 'file');
  }
  return terms;
}

function matchLine(line, terms) {
  return terms.filter((term) => term.pattern.test(line));
}

function searchMarkdown(relativePath, text, terms) {
  const references = [];
  let section = '';
  let insideFence = false;
  text.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) insideFence = !insideFence;
    else if (!insideFence) {
      const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
      if (heading) section = heading[1];
    }
    for (const term of matchLine(line, terms)) {
      references.push({ doc: relativePath, section, line: index + 1, reference: term.text, kind: term.kind, text: line.trim().slice(0, 160) });
    }
  });
  return references;
}

function searchComments(relativePath, source, terms) {
  const references = [];
  const { comments } = scanSource(source);
  for (const comment of comments) {
    const startLine = source.slice(0, comment.start).split('\n').length;
    source.slice(comment.start, comment.end).split('\n').forEach((line, offset) => {
      for (const term of matchLine(line, terms)) {
        references.push({ doc: relativePath, section: 'comments', line: startLine + offset, reference: term.text, kind: term.kind, text: line.trim().slice(0, 160) });
      }
    });
  }
  return references;
}

// Searches README, docs and comments of changed JS files for the given terms; unrelated text is never returned.
function findReferences(root, symbols, entries) {
  const terms = buildTerms(symbols, entries);
  const references = [];
  if (terms.length === 0) return references;
  for (const relativePath of listSearchableDocs(root)) {
    const text = readTextFile(root, relativePath);
    if (text !== null) references.push(...searchMarkdown(relativePath, text, terms));
  }
  for (const entry of entries) {
    if (entry.status === 'D' || !SOURCE_EXTENSIONS.test(entry.path)) continue;
    let source;
    try {
      source = readTextFile(root, entry.path);
    } catch {
      continue;
    }
    if (source !== null) references.push(...searchComments(entry.path, source, terms));
  }
  return references;
}

function discoverAll(cwd, env = process.env) {
  const { base, entries } = listChanged(cwd, env);
  const symbols = changedSymbols(cwd, env);
  const references = findReferences(cwd, symbols, entries);
  const documented = new Set(references.filter((reference) => reference.kind === 'symbol' && common.isSearchableDoc(reference.doc)).map((reference) => reference.reference));
  const undocumented = symbols.added.filter((symbol) => !documented.has(symbol.name));
  const itemCount = symbols.added.length + symbols.removed.length + symbols.changed.length;
  return {
    base,
    changedFiles: entries.map((entry) => entry.path),
    symbols,
    references,
    undocumented,
    thresholds: checkThresholds({ files: entries.length, items: itemCount }, env),
  };
}

module.exports = {
  findReferences,
  discoverAll,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_ITEMS,
  listChanged,
  changedPaths,
  readLimits,
  checkThresholds,
  scanSource,
  extractJavaScriptSymbols,
  extractSymbolsFromContent,
  changedSymbols,
};

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(discoverAll(common.projectRoot()), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`doc-sync discover: ${error.message}\n`);
    process.exitCode = 2;
  }
}
