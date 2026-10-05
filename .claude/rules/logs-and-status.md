---
paths:
  - "logs/**"
  - ".pipeline/**"
---

# Ticket log and status rules

- `.pipeline/status.json` is pipeline state (current step, gate, rework count, per-step status: PENDING, IN_PROGRESS, COMPLETE, WAITING_APPROVAL, FAILED, BLOCKED). Change it only with `node .claude/scripts/pipeline-status.js`; a hook rejects hand edits that break the schema.
- Logs are audit history: `logs/<ticket-id>_<slug>.md` (`no-ticket_<slug>.md` when there is no Jira key), copied from `logs/_template.md`. The path is the `log` field of `status.json`.
- Log what was decided and the result in a line or two per step, not transcripts or command output.
- `implement` also keeps `Tasks Remaining` / `Last Task Done` in its log after every task, so it can resume mid-step.
- Nothing may decide pipeline progress from a log. If the two disagree, `status.json` wins.
