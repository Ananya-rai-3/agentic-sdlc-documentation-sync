# Pipeline rules (always loaded)

- Phase order is fixed: requirements → architecture → design-review → impl-plan → implement → code-review → verify → (stage 7b documentation sync, see `pipeline-orchestration`) → create-pr. Never start a step whose previous phase document is missing; halt and run the prior agent.
- Pipeline state lives in `.pipeline/status.json`, changed only through `node .claude/scripts/pipeline-status.js`. Read `docs/pipeline-status.md` (generated) to see it. Never edit either by hand, and never read ticket logs to find state.
- Only the orchestrator (`/pipeline`) changes pipeline state. Phase agents write their document and their ticket log, nothing else.
- `PIPELINE_MODE` (env) controls human gates: `gated` (default) stops after steps 1, 3, 4 and before 8; `auto` stops only before 8. Pushing and creating the PR always need explicit user confirmation.
- Rework loops (design-review "Needs Rework", code-review Critical/High findings, verify "Ready for PR: NO") are capped at `PIPELINE_MAX_REWORK_LOOPS`. After that the pipeline is BLOCKED and the human decides.
- Commit each phase document with its ticket log and `.pipeline/status.json` before starting the next step.
