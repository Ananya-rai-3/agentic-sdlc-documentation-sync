---
paths:
  - ".mcp.json"
  - ".env*"
  - ".claude/**"
---

# Secrets and config rules

- Never write a token, password, or API key into `.mcp.json`, settings, agents, skills, or docs. Reference environment variables with `${VAR}` (see `.env.example` for the names).
- `.env`, `.claude/settings.local.json`, and key/cert files are git-ignored. The `commit-guard` hook blocks staging them and blocks diffs that look like secrets.
- If a secret has appeared in a file, a log, or the conversation, tell the user to rotate it.
- Do not loosen hook or permission settings to get past a block. Report the block to the user.
