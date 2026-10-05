---
paths:
  - "docs/**"
---

# Phase document rules

- Load the `doc-artifact-templates` skill before writing any phase document, and follow its required sections.
- Phase documents live in `docs/` (flat): `requirements.md`, `architecture.md`, `design-review.md`, `impl-plan.md`, `code-review.md`, `verification-report.md`, `doc-sync-report.md`. Never in the project root.
- `verification-report.md` must contain a literal `Ready for PR: YES` or `Ready for PR: NO` line. The `pr-gate` hook reads it before a PR can be created.
- `doc-sync-report.md` follows the fixed grammar in `doc-artifact-templates` and is checked by `node .claude/scripts/doc-sync/report.js check`; the `doc-sync-completeness-check` hook blocks PR creation unless it is COMPLETE and current.
- Reviewer documents (design-review, code-review) must list real risks with severity. Do not write approval-only reviews.
