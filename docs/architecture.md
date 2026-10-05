# System Architecture

## Overview
Automated Documentation Sync adds a documentation-sync stage to the existing Claude Code SDLC pipeline. It runs after verification (step 7) and before PR creation (step 8): it discovers documentation affected by the branch diff, classifies it as STALE / MISSING / AMBIGUOUS, edits only affected sections, re-validates them, writes `docs/doc-sync-report.md`, and commits on the feature branch. A PreToolUse hook blocks `gh pr create` unless the report is present, current and clean. Everything is built from the repo's existing building blocks (a `.claude/` agent, five skills, plain Node.js scripts and hooks, tests under `tests/`); there is no server or external service.

## Technology Stack
| Layer | Choice | Justification |
|-------|--------|---------------|
| Language | Node.js (plain CommonJS, no dependencies) | Matches existing hooks and `pipeline-status.js`; no install step; runs on Windows and POSIX (NFR-05). |
| Framework | Claude Code agent + skills + hooks (`.claude/agents`, `.claude/skills`, `.claude/hooks`) | Existing conventions. Deterministic work (diff, symbol extraction, link checks, report parsing, gating) is in scripts; semantic judgement (does the claim match the code) is done by the agent via skills. |
| Storage | Git working tree: `docs/doc-sync-report.md` (Markdown with fixed structure) | The report is both audit trail and gate input (NFR-01, NFR-03). No database. |
| Infrastructure | Local git + the developer's Claude Code session; `git diff <base>...HEAD` | Work is proportional to the diff (NFR-05). No CI/network dependency; link checks are repo-relative so they are offline. |

NFR coverage: NFR-01 fixed report grammar and section-scoped edits; NFR-02 write allow-list enforced by script (see Doc Writer Guard); NFR-03 findings-to-edits traceability plus existing `commit-guard`; NFR-04 gate fails closed; NFR-05 diff-scoped discovery; NFR-06 size threshold (see decisions).

## Component Diagram
```
 verify (step 7) COMPLETE
        |
        v
 +--------------------------+      +-----------------------+
 | documentation-sync agent |----->| scripts/doc-sync/     |
 | (.claude/agents)         |      |  discover.js          |
 |  uses 5 skills:          |      |  links.js             |
 |  discovery -> comparison |      |  fingerprint.js       |
 |  -> stale-detection ->   |      |  report.js (parse/    |
 |  update -> validation    |      |   render/validate)    |
 +-----------+--------------+      +-----------+-----------+
             | edits (allow-listed; PreToolUse|Write,Edit
             |  doc-sync-write-guard, agent-scoped)
             v                                 v
 README.md, docs/**, code comments      docs/doc-sync-report.md
             |                                 |
             +--------> git commit (same branch)
                                               |
 create-pr (step 8) --`gh pr create` or MCP create_pull_request--> [PreToolUse hooks,
                                         run in PARALLEL, any exit 2 blocks]
                                         commit-guard
                                         pr-gate (verification report)
                                         doc-sync-completeness-check --reads--> report + git

 Orchestrator preflight (7b): at gate before:create_pr, run `report.js check`; if not
 COMPLETE, run documentation-sync, re-check, only then show the gate (see Data Flow).
```

## Components

### documentation-sync agent (`.claude/agents/documentation-sync.md`)
- **Responsibility:** Orchestrates the sync: runs the five skills in order, enforces the size threshold, applies edits, writes the report, commits docs on the current branch, appends an audit line to the ticket log. Fails closed: any error or undecidable state writes `Status: FAILED` or `NEEDS_HUMAN` with a reason (FR-01..FR-09, NFR-04).
- **Inputs:** Current branch diff against base (`DOC_SYNC_BASE`, default merge-base with `master`), `docs/verification-report.md` (must show `Ready for PR: YES`), ticket log path from `.pipeline/status.json`.
- **Outputs:** Doc edits, `docs/doc-sync-report.md`, a commit `docs: sync documentation with implementation`, log entry.
- **Dependencies:** The five skills, `scripts/doc-sync/*`, git. Never edits `.pipeline/status.json` or `docs/pipeline-status.md`.
- **Tool restriction (review fix):** frontmatter `tools:` is limited to Read, Glob, Grep, Edit, Write, Bash, Skill (no WebFetch/WebSearch/MCP), because doc and comment text is untrusted input (prompt injection). Documentation examples are never executed in v1 (NFR-02 satisfied by not executing).
- **Idempotent/resumable (review fix):** it is safe to run repeatedly. On start it checks the worktree: uncommitted edits in allow-listed paths are re-validated and kept; any other dirty path means `NEEDS_HUMAN`. Re-runs compute findings from the current code and docs but the report's `Changes` table is rebuilt from `git diff Sync-Base..HEAD` over doc paths, so earlier edits are not lost from the audit trail. `Sync-Base` is the HEAD before the first doc-sync commit and is kept when an existing report has an ancestor `Sync-Base`.
- **Commit ownership (review fix):** when run by the orchestrator, the agent does not commit; the orchestrator commits docs + report + log in one commit `docs: sync documentation with implementation` (consistent with the other steps). Standalone, the agent commits itself after user confirmation.
- **Human acknowledgement:** the agent sets an AMBIGUOUS finding to `ACKNOWLEDGED` only when the invoking prompt carries the human's explicit instruction, and quotes it in the Evidence cell; it never self-acknowledges.

### documentation-discovery skill (FR-01, FR-08)
- **Responsibility:** Find documentation affected by the diff only. Runs `discover.js` to list changed files and extract changed/added/removed public symbols (exported functions, classes, config keys) by regex, then searches `README.md`, `docs/**` (excluding phase documents and `pipeline-status.md`, per requirements) and changed-file comments/docstrings for references to those files or symbols.
- **Inputs:** git diff, doc corpus.
- **Outputs:** JSON list of {doc, section, referenced symbol/file}; no unrelated documents.
- **Dependencies:** `discover.js`.

### code-documentation-comparison skill (FR-02)
- **Responsibility:** For each discovered location, extract the claim (signature, behavior, example, config key) and the corresponding code fact and record match / mismatch / undecidable.
- **Inputs:** Discovery output, current code.
- **Outputs:** Claim / code fact / result records.
- **Dependencies:** Agent reasoning; deterministic signature comparison where `discover.js` can extract signatures.

### stale-documentation-detection skill (FR-03, FR-04)
- **Responsibility:** Classify: mismatch -> STALE; new public symbol with no documentation reference -> MISSING; claim that cannot be clearly judged -> AMBIGUOUS (never edited, listed for human). Assigns finding IDs `F-01..`.
- **Inputs:** Comparison records, symbol list.
- **Outputs:** Finding list with class, location and evidence.
- **Dependencies:** None beyond the above.

### documentation-update skill (FR-05)
- **Responsibility:** Edit only the flagged section for STALE and MISSING items, preserving headings, formatting and tone; MISSING items are added to the nearest existing relevant section, or as a new section at the end of the relevant doc (README if none). All writes go through the path allow-list check.
- **Inputs:** Findings, doc files.
- **Outputs:** Edited sections; per-finding record of file and line range.
- **Dependencies:** `report.js check-paths` (allow-list: `README.md`, `docs/**` minus excluded docs, and comments/docstrings of changed files; `.env*` never read).

### documentation-validation skill (FR-06)
- **Responsibility:** Re-read each updated section against code; run `links.js` on the updated sections (repository-relative links and anchors only); check code examples for name/signature/config-key consistency without executing them (execution only if side-effect free, NFR-02). Records pass/fail per check; a failure leaves the finding OPEN.
- **Inputs:** Updated sections.
- **Outputs:** Check results in the report.
- **Dependencies:** `links.js`.

### doc-sync scripts (`.claude/scripts/doc-sync/`)
- **Responsibility:** Deterministic helpers: `discover.js` (diff + symbols + reference search), `links.js` (relative link/anchor resolution), `fingerprint.js`, `report.js` (render, parse and validate the report grammar; `check` and `check-paths` subcommands; shared by the agent, the orchestrator preflight and the hooks).
- **Fingerprint definition (review fix):** SHA-256 over the sorted list of `(status, path, blob-sha)` from `git diff --raw --no-renames -z <base>...HEAD -- . ':(exclude)README.md' ':(exclude)docs/'`, i.e. content hashes of changed non-doc files, not diff text. This is independent of autocrlf, diff algorithm, color and textconv settings, so Windows and POSIX agree. The base is computed by the shared `resolveBase()` (merge-base with `DOC_SYNC_BASE`, else `master`, else `origin/master`; failure means block). The hook never trusts the report's `Base:` value; it recomputes the base itself.
- **Inputs/Outputs:** CLI args / stdout JSON; `report.js` exports `parseReport(text)` and `checkReport(text, ctx)`. `report.js check` exits 0 only when the report would pass the gate (used by the orchestrator preflight).
- **Windows:** the report is always written with LF and parsed with `\r?\n`; all path comparisons normalize `\` to `/`, resolve with `path.resolve` plus `fs.realpathSync`, reject `..` and symlinks leaving the repo, and compare case-insensitively on `win32`.
- **Dependencies:** Node.js stdlib, git.

### doc-sync-completeness-check hook (`.claude/hooks/doc-sync-completeness-check.js`) (FR-10, FR-11, NFR-04)
- **Responsibility:** On PR creation, block (exit 2, message names the reason) unless `docs/doc-sync-report.md` exists, parses, has `Status: COMPLETE`, its `Fingerprint` equals the freshly computed one (so it is "for the current change"), has no finding with class STALE/MISSING that is not `RESOLVED`, and every AMBIGUOUS finding is `ACKNOWLEDGED`. It additionally enforces (review fixes): (a) report and doc-sync edits are committed and no tracked file outside `.pipeline/`, `logs/` and `docs/pipeline-status.md` is dirty; (b) `Sync-Base` is an ancestor of HEAD and `git diff --name-only Sync-Base..HEAD` contains only allow-listed paths, each listed in the `Changes` table; non-doc files in that range may differ only on comment lines (conservative check: every added/removed line, trimmed, starts with `//`, `/*`, `*`, `#` or is blank), otherwise block; (c) if any non-doc file was edited by the sync, the report's `Validation` table must show a passing test re-run.
- **Triggers (review fix):** registered with matcher `Bash|mcp__github__create_pull_request`. Bash: command matches `/\bgh\b[^;&|]*\bpr\s+create\b/` (also covers `gh -R x pr create`) or `gh api` calls to a `/pulls` POST. MCP: `tool_name === mcp__github__create_pull_request`. When a head branch is given (`--head`, or MCP `head`), it must equal the current branch, otherwise block. For any other Bash command the hook exits 0 after the cheap regex test, without loading git or `report.js` (it runs on every Bash call).
- **Fail-closed implementation (review fix):** Claude Code treats only exit code 2 as blocking; an uncaught exception, a missing module or a syntax error exits 1 and does NOT block. The hook therefore wraps all logic (including `require`s done lazily after the regex test) in `try/catch` plus `process.on('uncaughtException')` that exit 2 for PR-creation commands. It does not use `lib.readInput()` (which swallows JSON errors and yields `{}`, i.e. fail open); unparsable stdin exits 2. A test asserts the hook file and its modules exist and load.
- **Ordering (review fix):** hooks matching the same event run in parallel, not in listed order. The design must not depend on order: each hook is independent and any exit 2 blocks. Messages from several blocking hooks may appear together.
- **Inputs:** Hook JSON on stdin, report, git.
- **Outputs:** Exit 0 or exit 2 with message.
- **Dependencies:** `lib.js` (`block` only), `report.js`, `fingerprint.js`.

### doc-sync-write-guard hook (`.claude/hooks/doc-sync-write-guard.js`) (NFR-02, review fix)
- **Responsibility:** Makes the write allow-list enforceable rather than prompt-only. Declared in the `documentation-sync` agent's frontmatter `hooks:` as PreToolUse for `Write|Edit`, so it applies only while that agent runs. Blocks (exit 2) any write whose normalized real path is not `README.md`, a `docs/**` file outside the excluded set (phase docs, `pipeline-status.md`), `docs/doc-sync-report.md`, or a file in the changed-file list. Any `.env*`, `.claude/**`, `.pipeline/**`, `logs/**` target is blocked (the log append goes through the orchestrator).
- **Limits:** cannot stop Bash-side writes (`sed -i`, redirects) or verify "comments only" in source files. The authoritative backstop is the completeness hook's post-hoc `git diff Sync-Base..HEAD` check above, which covers committed changes, plus its dirty-tree check for uncommitted ones.
- **Dependencies:** `report.js check-paths` logic (single implementation).

### Report format (`docs/doc-sync-report.md`, FR-07, NFR-01)
Fixed headings: `# Documentation Sync Report`; a header block with `Status:` (COMPLETE | NEEDS_HUMAN | FAILED), `Base:` (informational only), `Sync-Base:` (HEAD before the first doc-sync commit), `Fingerprint:`, `Reason:` (required unless COMPLETE); table cells escape `|` as `\|` and the parser rejects (fails closed) any row with a wrong column count; `## Checked` (non-empty list of documents/sections and files examined); `## Findings` table `| ID | Class | Location | Evidence | Status |` with Status in OPEN | RESOLVED | ACKNOWLEDGED; `## Changes` table `| Finding | File | Lines | Summary |` (every RESOLVED finding has a change row); `## Validation` table `| Finding | Check | Result |`; `## Conclusion` containing the literal `No documentation changes required` when there are no findings. The doc-artifact-templates skill gets a new `doc-sync-report.md` section (new document, existing templates untouched).

### Existing files to change (smallest set)
- `.claude/settings.json`: add a second PreToolUse entry with matcher `Bash|mcp__github__create_pull_request` for `doc-sync-completeness-check.js` (the existing Bash entry with commit-guard and pr-gate is unchanged; order is irrelevant because hooks run in parallel); add env `DOC_SYNC_MAX_FILES` and `DOC_SYNC_MAX_ITEMS`; no new permission entries are needed because git is invoked from inside the node scripts and `Bash(node .claude/scripts/*)` already covers them.
- `.claude/agents/orchestrator.md` and `.claude/skills/pipeline-orchestration/SKILL.md` (review fix, replaces "after step 7"): `PS done verify` immediately opens gate `before:create_pr`, so `PS next` returns `APPROVE before:create_pr` and a "run after step 7" rule would never fire. Stage 7b is therefore a preflight in the `APPROVE before:create_pr` branch of the loop: run `node .claude/scripts/doc-sync/report.js check`; on non-zero, invoke `documentation-sync` (add it to the orchestrator's Agent tool list), commit its output, re-run `check`; if still not COMPLETE (NEEDS_HUMAN/FAILED) show the reason and stop without presenting the gate for approval. The gate summary also shows the doc-sync result. State lives in the report plus fingerprint, never in `status.json`, so any interruption is resumed by the next `/pipeline` run (`PS next` -> `APPROVE before:create_pr` -> preflight fails -> agent re-runs). Rework (`PS rework`) changes code, the fingerprint no longer matches, and the preflight re-runs automatically. Tradeoff: `/status` and `docs/pipeline-status.md` show `APPROVE before:create_pr` while doc sync is pending; the orchestrator prints "doc sync pending" in its summary line.
- `.claude/agents/create-pr.md`: add precondition "doc-sync report is COMPLETE" and mention the hook.
- `CLAUDE.md` and `.claude/rules/pipeline.md`: document the stage (labelled "7b", between steps 7 and 8), the report, and the hook; add `doc-sync-report.md` to the phase-documents list and `docs-artifacts.md` rule.
- `.claude/skills/doc-artifact-templates/SKILL.md`: add the report template.
- `.claude/commands/pipeline.md`: mention the stage.
- NOT changed: `.claude/scripts/pipeline-status.js` (`STEPS`, 8 states), `.pipeline/status.json` schema, `pr-gate.js`, `commit-guard.js`, `tests/test-pipeline-status.js`.
- Known pre-existing gap, NOT changed here (decision for the owner): `pr-gate.js` matches only the `gh pr create` Bash string and so is also bypassed by MCP `create_pull_request`; its stale-report check also does not tie `Ready for PR: YES` to the current code. Recommended follow-up: add the same matcher and a tool-name branch to `pr-gate`.
- New: agent, 5 skills (`.claude/skills/<name>/SKILL.md`), 4 scripts, 2 hooks (completeness check, write guard), `tests/test-doc-sync-*.js` (flat, plain node, per `test-harness-conventions`), fixtures under `tests/fixtures/doc-sync/`, demo under `src/`.

### Demonstration feature (`src/`, FR-12)
- **Responsibility:** A tiny dependency-free module `src/textutil.js` exporting `slugify(text)` and `truncate(text, max)`, documented in `README.md` ("Text utilities") and `docs/textutil.md`. The demo change renames/changes the `truncate` signature (adds an `ellipsis` option) and adds a new public `wordCount(text)`, producing one STALE (README and docs signature) and one MISSING (`wordCount`) finding, plus one deliberately vague sentence for an AMBIGUOUS item. A deliberately stale unrelated `docs/legacy-notes.md` demonstrates FR-08.
- **Inputs/Outputs:** Strings in, strings/numbers out; pure functions, no I/O.
- **Dependencies:** None.

## Data Flow
1. Step 7 `verify` completes with `Ready for PR: YES`; `PS done verify` opens gate `before:create_pr`. Before presenting it, the orchestrator preflight runs `report.js check`; if it fails, it invokes `documentation-sync` (or the user does, standalone).
2. Agent checks the worktree, then computes the base (merge-base with `master`) and the changed file list; if files > `DOC_SYNC_MAX_FILES` it writes `Status: NEEDS_HUMAN` and stops.
3. Discovery lists affected doc locations; unrelated docs are never read for claims.
4. Comparison and detection produce findings F-xx (STALE / MISSING / AMBIGUOUS); if findings > `DOC_SYNC_MAX_ITEMS`, stop with `NEEDS_HUMAN`, no edits.
5. Update edits only STALE/MISSING sections via the path allow-list; AMBIGUOUS items stay untouched and are listed.
6. Validation re-checks updated sections and relative links; a failed check keeps the finding OPEN (agent retries once, then `NEEDS_HUMAN`).
7. If any source comment was edited, the agent re-runs the project tests and records the result in `Validation`. It then computes the fingerprint, renders the report (with `Sync-Base`), and the docs + report + log are committed on the current branch by the orchestrator (no new branch, no push).
8. A human reviews the report; AMBIGUOUS items must be marked ACKNOWLEDGED (human edit of the report, or the agent quoting an explicit human instruction).
9. The preflight re-checks, then the gate is shown and, after approval, `create-pr` runs `gh pr create`; the hooks commit-guard, pr-gate and doc-sync-completeness-check run in parallel and any failure blocks with a named reason. Push and PR still need explicit user confirmation.

## External Integrations
| Integration | Purpose | Auth Method |
|-------------|---------|-------------|
| Local git CLI | Diff, merge-base, commit on the feature branch | Local user credentials; no push in this stage |
| Existing GitHub MCP / `gh` (step 8 only) | PR creation, gated by the new hook | Existing env-var token; unchanged |

No new external services; external URL checking is out of scope.

## Key Design Decisions
| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Placement: new unnumbered stage "7b" between verify and create-pr, run by the orchestrator, state evidenced by the report (not a new `status.json` step) | FR-10 needs only ordering. Keeping 8 steps leaves `STEPS`, the status.json schema, `pipeline-status.js`, its tests and `/status` untouched (requirements: no renumbering). Doc commits happen after verification but touch only docs and source comments; the completeness hook enforces that via the `Sync-Base..HEAD` path and comment-only check plus a test re-run when comments changed (the fingerprint alone does not prove "unchanged since verify", because it is computed after comment edits). Placement is realised as a preflight at gate `before:create_pr`, not as a step. | New step 9 / renumber (touches schema, validator, hook, tests, every doc); sub-step inside verify (verify would write files and commit, mixing roles); pre-step inside create-pr (merges two concerns, PR agent then edits docs unreviewed) |
| Gate: separate hook `doc-sync-completeness-check.js`, registered beside `pr-gate` | Single responsibility, independently testable, matches name in the story, existing `pr-gate` and its behavior stay unchanged; both run on the same matcher so both must pass. | Extend `pr-gate` (couples two reports, larger regression surface) |
| "Current change" = fingerprint of the non-documentation diff stored in the report | Detects a stale report after later code changes without relying on commit SHAs, which the doc commit itself changes. | HEAD SHA (invalidated by the doc commit); timestamps (unreliable) |
| Default size threshold: 20 changed files or 15 findings, via env `DOC_SYNC_MAX_FILES=20`, `DOC_SYNC_MAX_ITEMS=15` in `settings.json` | 20 files matches the NFR-05 "typical branch"; 15 findings keeps the doc diff reviewable. Configurable without code changes. Above it: stop, `NEEDS_HUMAN`, gate blocks until human narrows scope or raises the value. | Fixed constants (not configurable); lines-changed threshold (harder to explain) |
| Demo: `src/textutil.js` (slugify / truncate / wordCount) | Pure, tiny, dependency-free, trivially testable, naturally yields STALE (signature change), MISSING (new function) and AMBIGUOUS examples. | A CLI or HTTP endpoint (more surface than needed); a config-key demo (less natural docs) |
| Link checking: repository-relative links and anchors in updated sections only | Offline, deterministic, no network or SSRF risk (NFR-02, NFR-05); matches the requirements assumption. | External URL checks (flaky, network dependency, out of scope) |
| Split deterministic scripts from agent judgement | Discovery, links, fingerprint and report grammar must be reproducible and unit-testable; classification of meaning needs the model. Report format is parsed by the hook, not by the model. | All-LLM approach (non-deterministic gate); AST-based multi-language parsing (heavy; the regex extractor targets JS and is declared as such) |
| Fail closed everywhere | Missing, unparseable, stale-fingerprint or exception paths all block (NFR-04). | Fail open with warning |
| Write allow-list enforced by the agent-scoped `doc-sync-write-guard` hook (Write/Edit) and re-verified post-hoc by the completeness hook from `git diff Sync-Base..HEAD` | NFR-02: never write outside README, `docs/**` (minus phase docs) and changed-file comments; `.env*` is already denied in `settings.json`. Bash-side writes cannot be intercepted by the write guard, hence the post-hoc check. | Trust the prompt only; a global Write/Edit hook (would also fire for other agents) |
| Excluded docs: phase documents, `pipeline-status.md`, `doc-sync-report.md` itself | Owned by other agents (requirements). | Include them (would conflict with owners) |

## Open Risks
- Semantic comparison and AMBIGUOUS classification rely on model judgement, so results are not fully reproducible. Mitigation: deterministic reference discovery, mandatory evidence per finding, human acknowledgement of AMBIGUOUS items; residual false negatives are still possible.
- The symbol extractor is regex-based and JS-oriented; other languages in a future repo would be under-detected (MISSING items missed). Fixture tests cover JS only.
- The gate checks the report's format and fingerprint, not truth: an agent (or human) that writes a falsely clean report passes. The report is committed and reviewable in the PR, which is the compensating control.
- The fingerprint excludes `README.md` and `docs/`, so a code-comment-only edit after the report invalidates it (intended) but forces a re-run; documentation edited after the report is not detected by the gate.
- Docs committed after `verify` mean the PR contains commits not covered by the verification run; a docs edit that breaks a doc-tested example would not be caught by tests. Mitigation: validation step and doc-only edit allow-list.
- The completeness hook now also matches MCP `create_pull_request` and `gh api .../pulls`; the existing `pr-gate` still has the MCP gap (see Existing files). Other routes (raw `curl`, the GitHub web UI, another clone) remain outside any local hook; the human approval gate and PR review are the compensating controls.
- `Sync-Base` is written by the agent, so a dishonest agent could set it to HEAD and hide edits from the path check; mitigations are the write guard, the dirty-tree check and PR review of the committed report.
- Orchestrator and agent-prompt changes are prose; there is no automated test for "orchestrator invokes doc sync". Only scripts, the hook and the fixtures are testable with plain node.
- Windows path handling and `git merge-base` when `master` is absent locally (base resolution fails) must fail closed with a clear message.
- Size thresholds (20 / 15) are guesses; real branches may need tuning.
