---
name: doc-artifact-templates
description: Required sections and formatting rules for every SDLC phase document. Load this skill before writing requirements.md, architecture.md, design-review.md, impl-plan.md, or verification-report.md to ensure consistent structure across all agent handoffs.
---

# SDLC Document Templates

Every phase document must follow its template exactly. Do not add, rename, or remove top-level sections — downstream agents parse these headings by name. Fill every section; never leave a placeholder like `...` or `TBD` in the final committed file.

---

## requirements.md

```markdown
# Requirements

## User Story
> (verbatim story text — quote block, no paraphrasing)

## Functional Requirements
| ID | Requirement | Acceptance Criterion |
|----|-------------|----------------------|
| FR-01 | ... | ... |

## Non-Functional Requirements
| ID | Category | Requirement |
|----|----------|-------------|
| NFR-01 | Performance | ... |
| NFR-02 | Security | ... |

## Assumptions
- ...

## Out of Scope
- ...

## Open Questions
- (any unresolved items; remove section if empty)
```

**Rules**
- FR IDs must be sequential: FR-01, FR-02, …
- NFR categories must be one of: Performance, Security, Scalability, Availability, Maintainability, Compliance.
- Acceptance criteria must be testable (observable behaviour, not intent).

---

## architecture.md

```markdown
# System Architecture

## Overview
(2–3 sentences: what the system does and its primary deployment model)

## Technology Stack
| Layer | Choice | Justification |
|-------|--------|---------------|
| Language | ... | ... |
| Framework | ... | ... |
| Storage | ... | ... |
| Infrastructure | ... | ... |

## Component Diagram
(ASCII box-and-arrow diagram showing all major components and their connections)

## Components

### <ComponentName>
- **Responsibility:** ...
- **Inputs:** ...
- **Outputs:** ...
- **Dependencies:** ...

(one subsection per component)

## Data Flow
1. ...
2. ...

## External Integrations
| Integration | Purpose | Auth Method |
|-------------|---------|-------------|
| ... | ... | ... |

## Key Design Decisions
| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| ... | ... | ... |

## Open Risks
- ...
```

**Rules**
- Every FR from requirements.md must be traceable to at least one component.
- Every NFR must be addressed in either Technology Stack justification or Key Design Decisions.
- Remove "Open Risks" section only if design-review has closed all risks.

---

## design-review.md

```markdown
# Design Review

## Review Summary
- **Reviewed:** architecture.md
- **Reviewer:** Claude (agentic review)
- **Date:** YYYY-MM-DD
- **Verdict:** APPROVED / APPROVED WITH CHANGES / NEEDS REWORK

## Findings

### CRITICAL
| # | Finding | Impact | Recommendation | Status |
|---|---------|--------|----------------|--------|
| C-01 | ... | ... | ... | Fixed / Open |

### HIGH
| # | Finding | Impact | Recommendation | Status |
|---|---------|--------|----------------|--------|

### MEDIUM
| # | Finding | Impact | Recommendation | Status |
|---|---------|--------|----------------|--------|

### LOW / SUGGESTIONS
| # | Finding | Recommendation |
|---|---------|----------------|

## Agreed Design Decisions
- ...

## Architecture Changes Applied
- [ ] C-01: (description of fix applied to architecture.md)
```

**Rules**
- Verdict must be NEEDS REWORK if any CRITICAL finding is Open.
- Every CRITICAL and HIGH finding must have a recommendation, not just a description.
- "Architecture Changes Applied" checklist must match every CRITICAL/HIGH fix committed to architecture.md.

---

## impl-plan.md

```markdown
# Implementation Plan

## Summary
(1–2 sentences: overall approach and estimated total scope)

## Task List
| ID | Category | Task | Depends On | Estimate | Status |
|----|----------|------|------------|----------|--------|
| T-01 | infra | ... | — | Xh | TODO |

## Blocked Tasks
- T-XX is BLOCKED BY T-YY because: (reason)

## Out of Scope for This Sprint
- ...

## Definition of Done
- All TODO tasks reach DONE status.
- All tests pass (unit + integration).
- `verification-report.md` is generated and clean.
- PR is created and passes reviewer checklist.
```

**Rules**
- Category must be one of: `infra`, `backend`, `frontend`, `test`, `docs`.
- Status must be one of: `TODO`, `IN PROGRESS`, `DONE`, `BLOCKED`.
- Every task that has a dependency must list the ID(s) in "Depends On".
- No task should span more than 4 hours — split if larger.
- Remove "Blocked Tasks" section only if there are no blocked tasks.

---

## verification-report.md

```markdown
# Verification Report

## Test Results

### Unit Tests
(paste test runner output verbatim)

- **Total:** X | **Passed:** X | **Failed:** X | **Skipped:** X

### Integration Tests
(paste test runner output verbatim, or "Not applicable")

- **Total:** X | **Passed:** X | **Failed:** X

## Linter Results
- **Errors:** X | **Warnings:** X
- Notable issues: (list, or "None")

## Acceptance Criteria Check
| FR ID | Criterion | Result | Notes |
|-------|-----------|--------|-------|
| FR-01 | ... | PASS / FAIL / NOT FOUND | ... |

## Overall Verdict
- **Tests:** PASS / FAIL
- **Lint:** CLEAN / ISSUES
- **Acceptance Criteria:** X/Y passed
- **Ready for PR:** YES / NO — (reason if NO)
```

**Rules**
- Every FR from requirements.md must appear in the Acceptance Criteria Check table.
- "Ready for PR" must be YES only when Tests = PASS, Lint = CLEAN, and all FRs = PASS.
- Never mark a criterion PASS based on code inspection alone — run the test or manually verify the behaviour.

---

## doc-sync-report.md

Written by the `documentation-sync` agent and parsed by `.claude/scripts/doc-sync/report.js`. The grammar is fixed: do not add, rename, reorder or remove headings or table columns.

```markdown
# Documentation Sync Report

Status: COMPLETE | NEEDS_HUMAN | FAILED
Base: <commit sha>
Sync-Base: <commit sha>
Fingerprint: <value from fingerprint.js>
Reason: <required unless Status is COMPLETE; omit the line when COMPLETE>

## Checked
- <document, section or file examined; never empty>

## Findings
| ID | Class | Location | Evidence | Status |
|---|---|---|---|---|
| F-01 | STALE / MISSING / AMBIGUOUS | <doc path and section> | <quoted evidence, secrets redacted> | OPEN / RESOLVED / ACKNOWLEDGED |

## Changes
| Finding | File | Lines | Summary |
|---|---|---|---|
| F-01 | <doc path> | <line range> | <what changed> |

## Validation
| Finding | Check | Result |
|---|---|---|
| F-01 | <check performed> | PASS / FAIL <detail> |

## Conclusion
<summary; with no findings it must contain "No documentation changes required">
```

**Rules**
- Header lines are `Key: value` on one line. Escape `|` in table cells as `\|`. Finding ids are unique (`F-01`...).
- `COMPLETE` requires no OPEN findings, a current fingerprint and a committed report; the rest is enforced by `report.js check`.
