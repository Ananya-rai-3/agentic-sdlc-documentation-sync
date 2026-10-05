# Agentic SDLC Pipeline — Claude Code

This project implements a full **8-step Agentic Software Delivery Lifecycle (SDLC)** powered entirely by Claude Code. Every phase — from requirements to PR — is driven through Claude agents, skills, and hooks.

## How It Works

| Component | Location | Purpose |
|---|---|---|
| Project instructions | `CLAUDE.md` (this file) | Global rules and context for all agents |
| SDLC agents | `.claude/agents/*.md` | One agent per SDLC phase |
| Pipeline state | `.pipeline/status.json` | Single source of truth: current step, gate, rework count, per-step status. Changed only via `.claude/scripts/pipeline-status.js` |
| Ticket logs | `logs/<ticket-id>_<slug>.md` | Audit history per ticket (decisions, results, `implement` task progress). Not used to decide pipeline state |
| Log template | `logs/_template.md` | Blank log file copied for each new ticket |
| Resume skill | `.claude/skills/resume/SKILL.md` | `/resume` — reports where the pipeline stopped and continues via the orchestration skill |
| Permissions + hooks | `.claude/settings.json` | Auto-allowed commands, env, and all hook wiring |
| Hooks | `.claude/hooks/*.js` | `commit-guard` (secrets, force-push, pushes to main), `pr-gate` (no PR without `Ready for PR: YES`), `doc-sync-completeness-check` (no PR without a COMPLETE, current `docs/doc-sync-report.md`) |
| Rules | `.claude/rules/*.md` | Always-on pipeline rules plus path-scoped rules for docs, tests, logs, secrets |
| Commands | `.claude/commands/*.md` | `/pipeline` (run all steps), `/status`, `/review` |
| Orchestration | `.claude/skills/pipeline-orchestration/` + `.claude/agents/orchestrator.md` | Coordinates steps 1-8: reads state, invokes the sub-agent, validates, records, stops at human gates |
| Pipeline status | `docs/pipeline-status.md` | Small table generated from `status.json` by `.claude/scripts/pipeline-status.js`; read this instead of the logs |
| MCP servers | `.mcp.json` | GitHub, Atlassian (Jira/Confluence), Playwright. Secrets come from env vars (see `.env.example`) |

## SDLC Phases

Invoke these agents in order to drive the complete lifecycle:

| Step | Agent | Output |
|---|---|---|
| 1 | `requirements` | `docs/requirements.md` |
| 2 | `architecture` | `docs/architecture.md` |
| 3 | `design-review` | `docs/design-review.md` (updates `docs/architecture.md`) |
| 4 | `impl-plan` | `docs/impl-plan.md` |
| 5 | `implement` | Source code + tests |
| 6 | `code-review` | `docs/code-review.md` |
| 7 | `verify` | Test output + `docs/verification-report.md` |
| 8 | `create-pr` | PR description, changelog, review checklist |

Between steps 7 and 8 the orchestrator runs an unnumbered **stage 7b** (documentation sync) with the `documentation-sync` agent, which writes `docs/doc-sync-report.md`; see the `pipeline-orchestration` skill. It is not a pipeline step in `status.json`.

All agents live in `.claude/agents/`. An additional `sdlc-reviewer` agent is available at any step for independent adversarial review.

## General Behaviour Rules

- Always read the previous phase's output document before starting the next phase.
- Never skip a phase; if a document is missing, halt and prompt the user to run the prior agent.
- All generated SDLC phase documents (`requirements.md`, `architecture.md`, `design-review.md`, `impl-plan.md`, `code-review.md`, `verification-report.md`, `doc-sync-report.md`) live in the `docs/` directory. Never write them to the project root.
- When clarifying requirements or architecture, ask questions one at a time and wait for a response before asking the next.
- The human is the final approver at every gate. Never auto-merge or auto-push without explicit user confirmation.
- When acting as a reviewer (steps 3 and 6), be critical — surface real risks, not just praise.

## State and Logging Rules

- Pipeline state is `.pipeline/status.json`. Only the orchestrator changes it, only through `node .claude/scripts/pipeline-status.js`. Phase agents never edit it.
- To check progress, read `docs/pipeline-status.md` or run `/status`. Do not read logs to find out where a ticket is; the status file is regenerated automatically and must never be edited by hand.
- To start or continue a pipeline, run `/pipeline` (or `/resume`). Completed steps are never run again.
- Every agent reads its ticket log (path in `status.json` → `log`) at startup and writes a short entry on completion. Logs are audit history only: `logs/<ticket-id>_<slug>.md`, or `no-ticket_<slug>.md` when there is no Jira key.
- The `implement` agent updates its log **after every individual task**, so it can resume mid-step.
- Log files are committed alongside their corresponding phase document.

## Project Context

- Source user stories may come from Jira, Confluence, or a local Word/text document.
- Commit each phase document before moving to the next step.
- Changelog lives in `CHANGELOG.md` at the project root.
- All tests go under `tests/`.

## Atlassian Integration

This project has the Atlassian MCP server connected. Use it to:
- Fetch user stories and acceptance criteria from Jira (`search` / `getJiraIssue`)
- Read technical specs from Confluence (`getConfluencePage` / `searchConfluenceUsingCql`)
- Create and link issues back after implementation

## Security Rules

- Never hard-code secrets, tokens, or credentials in any generated file.
- Validate all user input at system boundaries.
- Flag any dependency with a known CVE during the `code-review` agent step.
