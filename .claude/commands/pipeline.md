---
description: Start or resume the SDLC pipeline (steps 1-8), stopping only at human gates
argument-hint: <jira-key | path to story | pasted story>   (omit to resume)
---

Load the `pipeline-orchestration` skill and run it now for: $ARGUMENTS

Before the final `before:create_pr` gate the skill runs stage 7b (documentation sync) automatically.

If no story was given, resume the existing pipeline (the skill's first action, `PS next`, tells you where it stands). Completed steps are never run again. If there is no pipeline either, ask the user for the story source.
