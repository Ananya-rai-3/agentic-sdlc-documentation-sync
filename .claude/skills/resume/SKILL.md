---
name: resume
description: Resume an in-progress SDLC pipeline from .pipeline/status.json. Reports where it stopped and continues from that step without repeating completed ones.
---

# Resume

1. Run `node .claude/scripts/pipeline-status.js` and show the table. Do not read ticket logs to find state.
2. If `next` is `NO_PIPELINE`, tell the user to start one with `/pipeline <story>` and stop.
3. Otherwise say in one line where it stopped and what happens next (for example: "Design Review is waiting for approval").
4. Continue by following the `pipeline-orchestration` skill from its loop. It handles gates, blocks and already-completed steps; do not re-implement that logic here.

Resuming mid-`implement` is handled by the `implement` agent itself, which reads its task list from the ticket log (`log` field in `.pipeline/status.json`).
