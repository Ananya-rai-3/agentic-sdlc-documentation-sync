'use strict';
// Offline check of repository-relative links and heading anchors in Markdown sections.
const fs = require('fs');
const path = require('path');
const common = require('./common');

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function stripInlineFormatting(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*~`]/g, '')
    .trim();
}

// GitHub-style heading slug: lower-case, drop punctuation, spaces to hyphens.
function slugify(headingText) {
  return stripInlineFormatting(headingText)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, '')
    .replace(/ /g, '-');
}

// Parses headings outside code fences. Returns [{ level, text, slug, line }] with unique slugs.
function parseHeadings(markdown) {
  const headings = [];
  const used = new Map();
  let insideFence = false;
  markdown.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      insideFence = !insideFence;
      return;
    }
    if (insideFence) return;
    const match = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (!match) return;
    const base = slugify(match[2]);
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    headings.push({ level: match[1].length, text: match[2], slug: count === 0 ? base : `${base}-${count}`, line: index + 1 });
  });
  return headings;
}

// Line range [from, to] (1-based, inclusive) of the section with this heading text, or null.
function sectionRange(markdown, headingText) {
  const lines = markdown.split(/\r?\n/);
  const headings = parseHeadings(markdown);
  const start = headings.find((heading) => heading.text === headingText);
  if (!start) return null;
  const next = headings.find((heading) => heading.line > start.line && heading.level <= start.level);
  return [start.line, next ? next.line - 1 : lines.length];
}

function extractLinks(markdown, fromLine, toLine) {
  const links = [];
  let insideFence = false;
  markdown.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNumber = index + 1;
    if (/^\s*(```|~~~)/.test(rawLine)) {
      insideFence = !insideFence;
      return;
    }
    if (insideFence || lineNumber < fromLine || lineNumber > toLine) return;
    const line = rawLine.replace(/`[^`]*`/g, (code) => ' '.repeat(code.length));
    for (const match of line.matchAll(/!?\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g)) {
      links.push({ line: lineNumber, target: match[1].replace(/^<|>$/g, '') });
    }
    const definition = /^\s{0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/.exec(line);
    if (definition) links.push({ line: lineNumber, target: definition[1].replace(/^<|>$/g, '') });
  });
  return links;
}

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function insideRoot(root, absolutePath) {
  const relative = path.relative(root, absolutePath);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// Checks the links of one Markdown file. options: { root, sections } (sections: heading texts; omitted = whole file).
function checkLinks(filePath, options = {}) {
  const root = path.resolve(options.root || common.projectRoot());
  const absoluteFile = path.resolve(root, filePath);
  const markdown = fs.readFileSync(absoluteFile, 'utf8');
  const total = markdown.split(/\r?\n/).length;
  const ranges = [];
  if (options.sections && options.sections.length > 0) {
    for (const section of options.sections) {
      const range = sectionRange(markdown, section);
      if (!range) return { file: filePath, checked: 0, broken: [{ line: 0, target: section, reason: 'section not found' }] };
      ranges.push(range);
    }
  } else {
    ranges.push([1, total]);
  }

  const headingCache = new Map();
  const slugsOf = (absolutePath) => {
    if (!headingCache.has(absolutePath)) headingCache.set(absolutePath, new Set(parseHeadings(fs.readFileSync(absolutePath, 'utf8')).map((heading) => heading.slug)));
    return headingCache.get(absolutePath);
  };

  const broken = [];
  let checked = 0;
  const seen = new Set();
  for (const [from, to] of ranges) {
    for (const link of extractLinks(markdown, from, to)) {
      const identity = `${link.line}:${link.target}`;
      if (seen.has(identity) || EXTERNAL.test(link.target)) continue;
      seen.add(identity);
      checked += 1;
      const hashIndex = link.target.indexOf('#');
      const pathPart = safeDecode(hashIndex === -1 ? link.target : link.target.slice(0, hashIndex)).split('?')[0];
      const anchor = hashIndex === -1 ? '' : safeDecode(link.target.slice(hashIndex + 1));
      const targetFile = pathPart === '' ? absoluteFile : pathPart.startsWith('/') ? path.join(root, pathPart) : path.resolve(path.dirname(absoluteFile), pathPart);
      if (!insideRoot(root, targetFile)) {
        broken.push({ line: link.line, target: link.target, reason: 'target is outside the repository' });
        continue;
      }
      let stats;
      try {
        stats = fs.statSync(targetFile);
      } catch {
        broken.push({ line: link.line, target: link.target, reason: 'file not found' });
        continue;
      }
      if (anchor !== '' && stats.isFile() && /\.(?:md|markdown)$/i.test(targetFile) && !slugsOf(targetFile).has(anchor.toLowerCase())) {
        broken.push({ line: link.line, target: link.target, reason: 'anchor not found' });
      }
    }
  }
  return { file: filePath, checked, broken };
}

module.exports = { checkLinks, parseHeadings, slugify };

if (require.main === module) {
  const args = process.argv.slice(2);
  const sections = [];
  let file = null;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--section' && args[index + 1] !== undefined) sections.push(args[++index]);
    else file = args[index];
  }
  if (!file) {
    process.stderr.write('usage: links.js <markdown-file> [--section "Heading"]...\n');
    process.exitCode = 2;
  } else {
    try {
      const result = checkLinks(file, { sections });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = result.broken.length === 0 ? 0 : 1;
    } catch (error) {
      process.stderr.write(`doc-sync links: ${error.message}\n`);
      process.exitCode = 2;
    }
  }
}
