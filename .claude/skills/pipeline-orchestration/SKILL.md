---
name: pipeline-orchestration
description: Run or resume the 8-step SDLC pipeline by delegating each step to its agent, tracking state in .pipeline/status.json, honouring human gates and rework limits. Load when the user runs /pipeline or /resume, asks to "run the whole pipeline", or when acting as the orchestrator.
---

# Pipeline Orchestration

You coordinate; sub-agents work. Subagents cannot spawn other subagents, so this runs only in the main thread (or `claude --agent orchestrator`).

## State

- `.pipeline/status.json` is the single source of truth. It changes only through the status script, referred to below as `PS`:
  `node .claude/scripts/pipeline-status.js <command>`
- `docs/pipeline-status.md` is the generated summary. `logs/` is audit history written by the agents. Do not read logs to find state.
- `PS next` returns exactly one line: `RUN|RESUME <agent> (step N)`, `APPROVE <gate>`, `BLOCKED|FAILED <step>: <reason>`, `DONE`, or `NO_PIPELINE`.
- `PS` refuses to start a step whose predecessors are not COMPLETE, and refuses to re-run a COMPLETE step. That is what makes `/pipeline` safe to run again at any time.
- Gates and the rework cap come from `PIPELINE_MODE` and `PIPELINE_MAX_REWORK_LOOPS`; the script reads them, you do not.

## Loop

Repeat until you must stop:

1. Run `PS next`.
2. Act on the result:
   - `NO_PIPELINE`: take the ticket id (Jira key, else `no-ticket`) and a kebab-case slug from the story, run `PS init <ticket> <slug>`, then loop. If the user gave no story, ask for it.
   - `DONE`: print the status table and stop.
   - `BLOCKED` or `FAILED`: show the reason and ask the human what to do. After they fix it, run `PS retry` and loop.
   - `APPROVE <gate>`: **stop and ask the human.** For `after:<step>` summarise the step's document in at most 10 lines. For `before:create_pr` first run Stage 7b below, then show the verification result and the doc-sync result and ask for explicit confirmation to push and open the PR. Approved: `PS approve`. Changes requested: `PS revise`, then re-run that step with their feedback. No answer yet: stop.
   - `RUN` or `RESUME <agent>`: run the step (below), then loop.

## Running a step

1. `PS start <agent>`.
2. Invoke that agent with the Agent tool. Pass the ticket, slug, log path, and (step 1 only) the story source. Tell it not to touch `.pipeline/status.json` and that you commit. Do not paste document contents; agents read `docs/` themselves. If a step needs the human (clarifying questions, per-task approval in `implement`), relay their questions one at a time and re-invoke with the answers. In `auto` mode tell `implement` the human pre-approved each task.
3. `PS check <agent>`. If it prints `MISSING ...`, run `PS fail <agent> "<reason>"` and stop.
4. Review steps only (`design-review`, `code-review`, `verify`): `PS verdict <agent>`. On `REWORK`, run the matching command below instead of `done`.
5. `PS done <agent>`. The script advances, or opens a gate.
6. Commit the step's document(s), the log, `.pipeline/status.json` and `docs/pipeline-status.md` together (for `implement`, the code and tests it reports changing). Never push.

## Stage 7b: documentation sync

Runs only in the `APPROVE before:create_pr` branch, before the gate is presented. It is not a pipeline step: state lives only in `docs/doc-sync-report.md` plus its fingerprint, never in `status.json`, and any rework or later code change invalidates the report.

1. Run `node .claude/scripts/doc-sync/report.js check` (exit 0 = satisfied, 1 = not satisfied with reasons, 2 = error). Exit 0: skip to step 5.
2. Otherwise invoke the `documentation-sync` agent (pass ticket, slug, log path; tell it not to touch `.pipeline/status.json` and that you commit; relay any human instruction to acknowledge an AMBIGUOUS item verbatim).
3. Commit the docs, `docs/doc-sync-report.md` and the log as `docs: sync documentation with implementation`. The report must be committed before the check can pass (`REPORT_UNCOMMITTED`). Never push.
4. Run `report.js check` again. If it still fails, or the report is `NEEDS_HUMAN` or `FAILED`, show the reasons and stop without presenting the gate; after the human acts, repeat from step 1.
5. Present the gate with the doc-sync result (`Status`, finding counts). If the check was not yet satisfied, say "doc sync pending". The `doc-sync-completeness-check` hook independently blocks PR creation until the check passes.

## Rework

| Review fails | Command | Runs again |
|---|---|---|
| design-review verdict NEEDS REWORK | `PS rework architecture design-review` | architecture, design-review |
| code-review has Critical/High findings | `PS rework implement code-review` | implement, code-review |
| verify says `Ready for PR: NO` | `PS rework implement verify` | implement, code-review, verify |

`PS rework` counts the loop in `rework_count` and resets the affected steps to PENDING. When it exits with code 3 the cap is reached, the pipeline is BLOCKED, and you ask the human. The count resets when the review step finally passes.

## Finish

The pipeline ends when `PS next` says `DONE`. Whenever you stop (gate, block, or done), print the table from `PS` (no arguments) and one line saying what the user must do next. Nothing else.
