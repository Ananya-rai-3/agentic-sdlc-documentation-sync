// PreToolUse(Bash): blocks unsafe git add/commit/push. Exit 2 = block.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { readInput, block } = require('./lib');

const cmd = (readInput().tool_input || {}).command || '';
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// .env.example is meant to be committed; real env files, keys and certs are not.
const SENSITIVE_FILE = /(^|[\\/])(\.env(\..*)?|.*\.pem|.*\.key|id_rsa|credentials\.json)$/i;
const SAFE_FILE = /(^|[\\/])\.env\.example$/i;
const isSensitive = (f) => SENSITIVE_FILE.test(f) && !SAFE_FILE.test(f);
const SECRET_PATTERN = /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|ATATT[A-Za-z0-9_\-=]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[A-Za-z0-9]{32,})/;
// .mcp.json may be committed, but only with ${VAR} references, never literal credentials.
const HARDCODED_MCP_SECRET = /"[A-Za-z_]*(TOKEN|SECRET|KEY|PASSWORD)[A-Za-z_]*"\s*:\s*"(?!\$\{)[^"]+"/i;

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const lines = (s) => s.split('\n').filter(Boolean);

if (/\bgit\s+add\b/.test(cmd)) {
  const staged = cmd.split(/\s+/).filter((t) => isSensitive(t.replace(/["']/g, '')));
  if (staged.length) {
    block(`Blocked: refusing to stage sensitive file(s): ${staged.join(', ')}. Add them to .gitignore instead.`);
  }
}

if (/\bgit\s+commit\b/.test(cmd)) {
  // `git add ... && git commit` runs as one command, so nothing is staged yet when this hook fires.
  // Also inspect the working tree when the same command stages or auto-stages changes.
  const hasAdd = /\bgit\s+add\b/.test(cmd);
  const includeWorktree = hasAdd || /\bgit\s+commit\b[^;&|]*\s(-[a-zA-Z]*a[a-zA-Z]*|--all)\b/.test(cmd);
  const files = new Set();
  let added = [];
  try {
    lines(git('diff', '--cached', '--name-only')).forEach((f) => files.add(f));
    let diff = git('diff', '--cached', '-U0');
    if (includeWorktree) {
      lines(git('diff', '--name-only')).forEach((f) => files.add(f));
      diff += '\n' + git('diff', '-U0');
      for (const f of hasAdd ? lines(git('ls-files', '--others', '--exclude-standard')) : []) {
        files.add(f);
        try {
          const abs = path.join(root, f);
          if (fs.statSync(abs).size < 1e6) diff += '\n' + fs.readFileSync(abs, 'utf8').split('\n').map((l) => '+' + l).join('\n');
        } catch {}
      }
    }
    added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  } catch {
    process.exit(0);
  }
  const badFiles = [...files].filter(isSensitive);
  if (badFiles.length) {
    block(`Blocked commit: sensitive file(s) in this commit: ${badFiles.join(', ')}. Unstage with 'git restore --staged <file>' or git-ignore them.`);
  }
  if (added.some((l) => SECRET_PATTERN.test(l))) {
    block('Blocked commit: changes appear to contain a secret or token. Remove it and use an environment variable.');
  }
  if ([...files].some((f) => /(^|\/)\.mcp\.json$/.test(f)) && added.some((l) => HARDCODED_MCP_SECRET.test(l))) {
    block('Blocked commit: .mcp.json has a hard-coded credential. Use a ${ENV_VAR} reference instead.');
  }
}

const push = cmd.match(/\bgit\s+push\b([^;&|]*)/);
if (push) {
  const args = push[1].split(/\s+/).filter(Boolean);
  if (args.some((a) => /^(-f|--force|--force-with-lease.*|--mirror|--delete)$/.test(a) || /^\+/.test(a))) {
    block('Blocked: force/destructive push requires explicit user action.');
  }
  const positional = args.filter((a) => !a.startsWith('-'));
  const targetsProtected = positional.some((a) => /(^|:)(main|master)$/.test(a));
  // `git push`, `git push origin` and `git push origin HEAD` all push the current branch.
  let onProtected = false;
  if (positional.length < 2 || positional.includes('HEAD')) {
    try {
      onProtected = /^(main|master)$/.test(git('rev-parse', '--abbrev-ref', 'HEAD').trim());
    } catch {}
  }
  if (targetsProtected || onProtected) {
    block('Blocked: do not push directly to main/master. Push a feature branch and open a PR.');
  }
}

process.exit(0);
