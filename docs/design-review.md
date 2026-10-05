# Design Review

## Review Summary
- **Reviewed:** docs/architecture.md
- **Reviewer:** Claude (agentic review)
- **Date:** 2026-10-01
- **Verdict:** APPROVED WITH CHANGES

## Findings

### CRITICAL
| # | Finding | Impact | Recommendation | Status |
|---|---------|--------|----------------|--------|
| C-01 | Stage "7b" cannot run in the real state machine. `pipeline-status.js` `complete()` sets `WAITING_APPROVAL` / gate `before:create_pr` the moment `PS done verify` runs, so `PS next` returns `APPROVE before:create_pr` and the orchestrator loop (driven only by `PS next`) goes straight to the PR gate. A rule "after step 7 delegate to documentation-sync" has no branch to live in. If doc sync is interrupted, `PS next` still says APPROVE, so nothing resumes it, and the user could approve the gate with no sync done (only the hook would then stop `create-pr`). | FR-10 ordering and resumability are not met; the feature silently never runs in `/pipeline`. | Run 7b as a preflight inside the `APPROVE before:create_pr` branch: `report.js check` (report + fingerprint, no status.json state); if it fails, run the agent, commit, re-check, and only show the gate when it passes. State is derived from the report, so interrupted runs resume and rework invalidates the report automatically. Make the agent idempotent. | Fixed |

### HIGH
| # | Finding | Impact | Recommendation | Status |
|---|---------|--------|----------------|--------|
| H-01 | Gate is bypassable: `pr-gate` and the planned hook match only the `gh pr create` Bash string. `.claude/settings.json` has no matcher for `mcp__github__create_pull_request` (github MCP is enabled), nor for `gh -R x pr create` or `gh api`. `head` can also differ from the checked-out branch. | FR-11/NFR-04: PR can be created without a clean report. | Register the completeness hook with matcher `Bash\|mcp__github__create_pull_request`, use a looser gh regex, handle `gh api .../pulls`, require head == current branch. Existing `pr-gate` gap recorded as a follow-up (see M-01). | Fixed |
| H-02 | "Any exception also blocks" is not true for Node hooks: Claude Code blocks only on exit 2; an uncaught exception, syntax error or missing module exits 1 (non-blocking). `lib.readInput()` also swallows invalid JSON and returns `{}`, which makes every hook fail open. | NFR-04 fail-closed claim is false in practice. | Wrap all logic in try/catch + `uncaughtException` handler exiting 2 for PR-creation commands, lazy-require after the cheap regex test, exit 2 on unparsable stdin, test that the hook loads. | Fixed |
| H-03 | Docs/comment commits after verify weaken the guarantee: the fingerprint is computed after comment edits and excludes docs, so it proves only report-to-current-code, not "code unchanged since verify". Nothing stops a source edit beyond comments, and tests are not re-run. Uncommitted changes are invisible to `git diff base...HEAD`. The fingerprint also hashed diff text, which varies with autocrlf/diff config (Windows). | Verified code can differ from PR code. | Fingerprint = hash of (status, path, blob-sha) list; add `Sync-Base`; hook checks `Sync-Base..HEAD` paths against the allow-list and the `Changes` table, comment-only lines in source files, dirty-tree check, test re-run when comments changed. | Fixed |
| H-04 | The write allow-list is prompt-only. `report.js check-paths` is advisory; the agent has Write/Edit/Bash and nothing intercepts writes. The architecture also referenced a "Doc Writer Guard" component that was never defined. | NFR-02 unenforced; prompt injection in docs/comments could redirect writes. | Agent-scoped PreToolUse(Write\|Edit) `doc-sync-write-guard` hook (frontmatter hooks) with normalized real-path, case-insensitive-on-Windows checks, plus post-hoc enforcement in the completeness hook; restrict agent tools; never execute examples in v1. | Fixed |

### MEDIUM
| # | Finding | Impact | Recommendation | Status |
|---|---------|--------|----------------|--------|
| M-01 | Existing `pr-gate.js` has the same MCP bypass and does not bind `Ready for PR: YES` to the current code (a stale YES passes after later commits). `commit-guard.js` also fails open on git errors. | Pre-existing weaknesses, outside this change. | Owner decision: add the matcher and a tool-name branch to `pr-gate`; add a verified-HEAD line to the verification report. Not changed here to keep the regression surface small. | Open |
| M-02 | Claim "hooks run in order commit-guard, pr-gate, doc-sync" is wrong: hooks for one event run in parallel. | Misleading design; error messages may interleave. | Design must not depend on order; corrected in architecture. | Fixed |
| M-03 | Re-run after an interrupted sync loses audit trail: a second run sees docs already fixed and would report "no changes required". Partial uncommitted edits were not handled. | NFR-03 traceability gap. | Rebuild `Changes` from `git diff Sync-Base..HEAD`; worktree check on start. | Fixed |
| M-04 | The hook trusted the report's `Base:`; a falsified base shrinks the fingerprinted diff. AMBIGUOUS self-acknowledgement by the agent defeats the human review. | Gate integrity. | Hook recomputes the base; agent acknowledges only with a quoted human instruction. | Fixed |
| M-05 | Commit ownership conflicted with the repo convention (orchestrator commits, agents do not). | Duplicate or missing commits, log not committed. | Orchestrator commits when orchestrated; agent commits only standalone. | Fixed |
| M-06 | `/status`, `pipeline-status.md` and the session banner cannot show doc sync pending (state is outside status.json). | Operator confusion. | Accepted tradeoff; orchestrator prints "doc sync pending". Revisit if this becomes noisy. | Open |

### LOW / SUGGESTIONS
| # | Finding | Recommendation |
|---|---------|----------------|
| L-01 | Windows: CRLF in report, `\` paths, case-insensitive FS, symlinks, `master` absent locally (only `origin/master`). | Handled in `report.js`/`resolveBase()` spec (LF writes, `\r?\n`, realpath, fallback to `origin/master`, otherwise block). Add tests on these. |
| L-02 | Hook runs on every Bash call. | Cheap regex pre-check before loading anything; keep under ~50 ms for non-PR commands. |
| L-03 | `Bash(node .claude/scripts/*)` also lets any agent call `pipeline-status.js done ...`. | Pre-existing; consider narrowing in a follow-up. |
| L-04 | Hook evaluates the repo at `CLAUDE_PROJECT_DIR`; a command with `cd other && gh pr create` targets another repo. | Block when the command contains `cd`/`-C` before `gh pr create`, or document the limit. |
| L-05 | Size thresholds 20 / 15 are guesses; the NEEDS_HUMAN override path (raise env, re-run) should be documented in the agent prompt. | Keep configurable; log the chosen values in the report. |
| L-06 | Report Evidence cells could copy secrets from comments. | Rely on commit-guard scanning at commit; instruct agent to redact. |

## Agreed Design Decisions
- Separate hook `doc-sync-completeness-check` (not extending `pr-gate`), matching `Bash|mcp__github__create_pull_request`.
- Stage 7b is not a `status.json` step; it is an idempotent preflight at gate `before:create_pr`, with state derived from the committed report and fingerprint.
- Fingerprint is a hash of changed non-doc blob SHAs, computed with a hook-owned base; verified-code integrity is backed by path and comment-only checks on `Sync-Base..HEAD`.
- Fail closed means explicit exit 2 on every error path.
- Write allow-list enforced by an agent-scoped write guard plus post-hoc git verification.
- Examples are not executed in v1; relative links only; JS-only symbol extractor declared.

## Architecture Changes Applied
- [x] C-01: Stage 7b realised as a preflight in the `APPROVE before:create_pr` branch (orchestrator/SKILL changes, Data Flow, diagram, idempotent agent, decision row updated).
- [x] H-01: Hook matcher extended to MCP `create_pull_request` / `gh api`, looser gh regex, head-branch check; `pr-gate` gap noted.
- [x] H-02: Fail-closed implementation rules for the hook (exit 2 wrappers, no `readInput` swallow, load test).
- [x] H-03: Fingerprint redefined (blob SHAs), `Sync-Base`, post-sync path/comment-only/dirty-tree/test re-run checks.
- [x] H-04: New `doc-sync-write-guard` hook, restricted agent tools, no example execution, decision row updated.
- [x] M-02..M-05: hook parallelism, audit rebuild, hook-owned base, commit ownership, human-only acknowledgement.
