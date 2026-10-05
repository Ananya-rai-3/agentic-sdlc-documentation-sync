# Agentic SDLC – Automated Documentation Sync

An 8-step software delivery lifecycle driven entirely by Claude Code:
agents do the work, skills hold the templates and conventions, rules and
hooks keep the pipeline safe, and a human approves at the gates.

The repository currently contains the pipeline framework only. No
business application has been built yet; the first story to flow through
it is in `user-story/automated-documentation-sync.md`.

## Quick start

1. Set the secrets listed in `.env.example` as OS environment variables
   (on Windows: `setx NAME "value"`, then restart the terminal).
2. Start Claude Code in this folder.
3. Run `/pipeline user-story/automated-documentation-sync.md`.
4. Run `/status` at any time to see where the pipeline is.

## The pipeline

```
story -> requirements -> architecture -> design-review -> impl-plan
      -> implement -> code-review -> verify -> create-pr
```

| Step | Agent | Output |
|---|---|---|
| 1 | `requirements` | `docs/requirements.md` |
| 2 | `architecture` | `docs/architecture.md` |
| 3 | `design-review` | `docs/design-review.md` (updates architecture) |
| 4 | `impl-plan` | `docs/impl-plan.md` |
| 5 | `implement` | source code and tests under `tests/` |
| 6 | `code-review` | `docs/code-review.md` |
| 7 | `verify` | `docs/verification-report.md` |
| 8 | `create-pr` | pull request, changelog entry, reviewer checklist |

`sdlc-reviewer` can be called at any step for an independent adversarial
review. `orchestrator` runs all steps in one go.

Failures loop back: design-review "Needs Rework" goes to architecture;
open Critical/High code-review findings or `Ready for PR: NO` go to
implement. Loops are capped (see Configuration), then the ticket is
marked BLOCKED for a human.

## Commands

| Command | What it does |
|---|---|
| `/pipeline [story]` | Starts the pipeline, or resumes it when no story is given. Stops only at human gates; completed steps never re-run |
| `/status` | Prints the pipeline status table without reading any logs |
| `/resume` | Reports where the pipeline stopped and continues from there |
| `/review <step>` | Independent adversarial review of a step |

## Human gates and configuration

Set in `.claude/settings.json` under `env`:

| Variable | Default | Meaning |
|---|---|---|
| `PIPELINE_MODE` | `gated` | `gated` stops for approval after steps 1, 3, 4 and before 8. `auto` stops only before 8 |
| `PIPELINE_MAX_REWORK_LOOPS` | `2` | Rework loops allowed per review before the pipeline is BLOCKED |
| `PIPELINE_STATUS_FILE` | `docs/pipeline-status.md` | Where the status file is written |

Pushing and opening the PR always need your explicit confirmation.

## Pipeline state

The pipeline is a small state machine with three layers:

| Layer | File | Role |
|---|---|---|
| State | `.pipeline/status.json` | Single source of truth: current step, state, gate, rework count, status of each step |
| Summary | `docs/pipeline-status.md` | Generated table for humans and agents. Read this, never the logs |
| History | `logs/<ticket>_<slug>.md` | Audit trail written by the agents. Not used to decide what runs next |

Step status is `PENDING`, `IN_PROGRESS`, `COMPLETE`, `WAITING_APPROVAL`, `FAILED` or `BLOCKED`.
`WAITING_APPROVAL` is a normal human gate; `BLOCKED` (rework cap hit) and
`FAILED` (missing artifact) need a human decision before `retry`.

Only the orchestrator changes state, and only through
`node .claude/scripts/pipeline-status.js` (`next`, `start`, `done`, `approve`,
`revise`, `rework`, `retry`, `check`, `verdict`). The script refuses to start a
step whose predecessors are incomplete or one that is already `COMPLETE`, which
is what makes `/pipeline` resumable and idempotent.

Roles: the **orchestrator** coordinates (reads state, invokes, validates,
records, commits). **Sub-agents** each do one SDLC task. **MCP** is a tool
connection, **skills** are reusable instructions, **hooks** enforce safety.

## Hooks

| Hook | Enforces |
|---|---|
| `commit-guard` | No staging of `.env`/key files, no commits containing tokens or a hard-coded `.mcp.json` credential, no force-push, no direct push to main/master |
| `pr-gate` | `gh pr create` is blocked unless `docs/verification-report.md` says `Ready for PR: YES` |
| `doc-sync-completeness-check` | PR creation (CLI, REST API or MCP) is blocked unless `docs/doc-sync-report.md` is `COMPLETE` and current for the code diff. Fails closed |
| `doc-sync-write-guard` | The `documentation-sync` agent can only write docs, its report and comments in changed source files |
| `pipeline-status.js` | Not an enforcement hook: the state machine/renderer. Hooked at session start (summary) and after edits to `status.json` (re-render, reject invalid JSON) |

## Rules (`.claude/rules/`)

| File | Loads when |
|---|---|
| `pipeline.md` | Always: phase order, gates, rework limits |
| `docs-artifacts.md` | Working under `docs/` |
| `tests.md` | Working under `tests/` |
| `logs-and-status.md` | Working under `logs/` or `.pipeline/` |
| `security.md` | Touching `.mcp.json`, `.env*`, or `.claude/` |

## Skills (`.claude/skills/`)

| Skill | Used for |
|---|---|
| `pipeline-orchestration` | The procedure behind `/pipeline` and the `orchestrator` agent |
| `resume` | `/resume`: report state, then hand off to `pipeline-orchestration` |
| `doc-artifact-templates` | Required sections of every phase document |
| `test-harness-conventions` | Test layout, naming, and assertion style |
| `documentation-discovery`, `code-documentation-comparison`, `stale-documentation-detection`, `documentation-update`, `documentation-validation` | The five stages of the `documentation-sync` agent (stage 7b, run by the orchestrator before the PR gate) |

## MCP servers (`.mcp.json`)

| Server | Used for | Needs |
|---|---|---|
| `github` | Branches, PRs, issues | `GITHUB_PERSONAL_ACCESS_TOKEN` |
| `atlassian` | Jira stories, Confluence specs one-time OAuth sign-in via `/mcp` (no token) |
| `playwright` | Browser checks, used only by the `verify` agent | nothing |

Secrets are never stored in the repo. `.mcp.json` reads them from
environment variables.

## Ticket logs

Each ticket has `logs/<ticket-id>_<slug>.md` (or `no-ticket_<slug>.md`),
copied from `logs/_template.md`. Logs are audit history; `implement` also
records its task progress there so it can resume mid-step.

## Text utilities

`src/textutil.js` is a small demonstration module with no dependencies. It is
the code the documentation-sync feature is exercised on. Full reference:
[docs/textutil.md](docs/textutil.md).

| Function | Description |
|---|---|
| `slugify(text)` | Lowercase, hyphen-separated slug of `text` |
| `truncate(text, max, options)` | `text` cut to its first `max` characters; `options.ellipsis` (string, default `''`) is appended only when the text was cut |
| `wordCount(text)` | Number of whitespace-separated words in `text` |

## Layout

```
.claude/
  agents/      8 pipeline agents + sdlc-reviewer + orchestrator + documentation-sync
  commands/    /pipeline, /status, /review
  hooks/       commit-guard, pr-gate, doc-sync hooks, shared lib
  rules/       pipeline + path-scoped rules
  scripts/     pipeline-status.js (state machine + renderer)
  skills/      pipeline-orchestration, resume, doc-artifact-templates, test-harness-conventions
  settings.json
docs/          phase documents and pipeline-status.md
.pipeline/      status.json (pipeline state)
logs/          per-ticket logs and _template.md
tests/         guard and state-machine tests, plus those the implement agent writes
user-story/    input stories
.mcp.json  .env.example  CLAUDE.md
```
