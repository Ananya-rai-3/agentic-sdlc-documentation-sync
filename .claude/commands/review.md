---
description: Get an independent adversarial review of a pipeline step
argument-hint: <step name or document path, e.g. architecture>
---

Invoke the `sdlc-reviewer` agent on: $ARGUMENTS

If no argument was given, use the step shown as current in `docs/pipeline-status.md`. Report its findings ranked by severity. Do not apply fixes unless the user asks.
