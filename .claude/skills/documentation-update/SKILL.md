---
name: documentation-update
description: Apply section-scoped edits for STALE and MISSING findings through the write allow-list, preserving headings and tone, and never touching AMBIGUOUS items. Used by the documentation-sync agent (step 4 of 5).
---

# Documentation update

Input: findings from `stale-documentation-detection`.

## Rules

- Edit only the section named in a STALE or MISSING finding. Do not rewrite the whole file, reorder sections, or change anything else.
- Preserve existing headings, heading levels, formatting, terminology and tone. Change only the wrong facts.
- STALE: correct the claim to match the code fact in the finding's Evidence.
- MISSING placement: add the content to the nearest existing relevant section; if none exists, add a new section at the end of the relevant doc, or at the end of `README.md` if no doc is relevant.
- AMBIGUOUS findings are never edited. Leave them `OPEN` for a human.
- Use only relative Markdown links, and only to files or headings that exist.
- Do not add secrets, tokens or machine-specific paths to any doc.
- Do not execute examples. Write or fix examples by reading the code.

## Allowed writes

Writes go through Edit/Write only, and are limited to: `README.md`, files under `docs/` (not phase documents and not `docs/pipeline-status.md`), `docs/doc-sync-report.md`, and, for comment fixes only, source files changed on this branch. The agent's write guard hook (`.claude/hooks/doc-sync-write-guard.js`) blocks anything else. To pre-check a path, run `node .claude/scripts/doc-sync/report.js check-paths <path>...` (exit 0 all allowed, 1 some not allowed, 2 usage error). A blocked write is final: do not retry it via Bash (`sed -i`, redirects, `git checkout`), and never edit `.env*`, `.claude/**`, `.pipeline/**` or `logs/**`.

Source edits are limited to comments (outdated comment text matching a documented claim). Never change code. If you edit any source comment, the agent must re-run the project tests afterwards.

## Output

For each edit: finding id, file, line range, one-line summary. These become the report's `Changes` rows. Keep the finding `OPEN` until `documentation-validation` passes.
